const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { connect, pause } = require('./renderer.cjs');

exports.run = async function () {
  const root = process.env.CODE_EXPLANATION_BACKGROUND_RUN;
  if (!root) throw new Error('缺少独立后台验收目录。');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'configuration.json'), 'utf8').replace(/^\uFEFF/, ''));
  const manifest = JSON.parse(fs.readFileSync(path.join(config.fixture, 'manifest.json'), 'utf8'));
  const diskFile = manifest.lectures.disk.path;
  const unsavedFile = manifest.lectures.unsaved.path;
  const diskRaw = fs.readFileSync(diskFile, 'utf8');
  const project = manifest.projectRoot;
  const uri = relative => vscode.Uri.file(path.join(project, relative));
  const originalInvoice = fs.readFileSync(uri('src/invoice.js').fsPath, 'utf8');
  const originalCharge = fs.readFileSync(uri('src/charge.js').fsPath, 'utf8');
  const originalFormatter = fs.readFileSync(uri('src/format-amount.js').fsPath, 'utf8');
  const extension = vscode.extensions.getExtension('XGH.code-explanation-extension');
  if (!extension) throw new Error('未加载正式插件。');
  assert.ok(extension.extensionPath.toLowerCase().startsWith(root.toLowerCase()));
  const { parseExplanation, normalizeText, sha256 } = require(path.join(extension.extensionPath, 'dist/explanation'));
  const disk = parseExplanation(diskRaw), unsaved = parseExplanation(fs.readFileSync(unsavedFile, 'utf8'));
  const results = process.env.CODE_EXPLANATION_BACKGROUND_PHASE && fs.existsSync(path.join(root, 'results.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8')) : {
    vscodeVersion: vscode.version, extensionVersion: extension.packageJSON.version, packageSha256: config.packageSha256,
    extensionPath: extension.extensionPath, project, cases: [], startedAt: new Date().toISOString(),
  };
  const save = () => fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
  const renderer = await connect(config);
  const command = (name, ...args) => vscode.commands.executeCommand('codeExplanation.' + name, ...args);
  const gitEnvironment = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete gitEnvironment[key];
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', project, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnvironment });
  async function wait(name, check) {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const state = await renderer.state();
      if (await check(state)) return state;
      await pause(100);
    }
    const state = await renderer.state();
    fs.writeFileSync(path.join(root, 'failure-state.json'), JSON.stringify(state, null, 2));
    throw new Error(`等待后台界面超时：${name}`);
  }
  async function shown(lecture, index, extra = () => true) {
    return wait(lecture.steps[index - 1].title, state =>
      state.comments.length === 1 && state.comments[0].text.includes(lecture.steps[index - 1].title) &&
      state.status.includes(`${index}/${lecture.steps.length}：`) && !state.status.includes('正在读取') && extra(state));
  }
  async function open(filename, lecture, index = 1) {
    await command('open', vscode.Uri.file(filename));
    return shown(lecture, index);
  }
  async function go(lecture, index) {
    const state = await renderer.state();
    const current = Number(/(\d+)\/\d+：/.exec(state.status)?.[1]);
    assert.ok(current, '应有活动讲解编号');
    const action = index > current ? 'next' : 'previous';
    for (let value = current; value !== index; value += index > current ? 1 : -1) await command(action);
    return shown(lecture, index);
  }
  async function edit(relative, text) {
    const document = await vscode.workspace.openTextDocument(uri(relative));
    const change = new vscode.WorkspaceEdit();
    change.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(change), true);
    return document;
  }
  async function bodyShown(lecture, index, text) {
    return wait('排版正文显示当前成功内容', async () => {
      const body = await require('./body.cjs').readBody(config);
      return body?.id === lecture.id && body.current === lecture.steps[index - 1].id && body.text.includes(text ?? lecture.steps[index - 1].title);
    });
  }
  async function invalid(lecture, index) {
    await wait('对应失败后清除行内正文', state => state.comments.length === 0 && !state.highlights.length && !state.status.includes('正在读取') && state.status.includes(`${index}/${lecture.steps.length}：`));
    return bodyShown(lecture, index);
  }
  async function checkpoint(name, action, screenshot) {
    const item = { name, startedAt: new Date().toISOString() };
    results.cases.push(item); save();
    try {
      await action();
      if (screenshot) { await renderer.screenshot(screenshot); item.screenshot = screenshot; }
      item.result = '通过';
    } catch (error) {
      item.result = '失败'; item.error = error.stack;
      fs.writeFileSync(path.join(root, 'failure-state.json'), JSON.stringify(await renderer.state(), null, 2));
      await renderer.screenshot('failure.png').catch(() => {});
      throw error;
    } finally { item.finishedAt = new Date().toISOString(); save(); }
  }
  function activeDiff() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputTextDiff, '应为真实双侧比较');
    return input;
  }
  function assertAnchor(state, side, start, end = start) {
    assert.equal(state.comments[0].side, side);
    assert.ok(state.comments[0].range.includes(`lines ${start} through ${end}.`) || (start === end && state.comments[0].range.includes(`line ${start}.`)), state.comments[0].range);
  }
  async function stop() {
    await command('stop');
    return wait('停止后清理', state => state.comments.length === 0 && !state.status.includes('停止讲解') && !state.highlights.length);
  }
  function assertBaseline() {
    assert.equal(git('rev-parse', 'HEAD').trim(), manifest.baseline.head);
    assert.equal(git('status', '--porcelain=v1'), manifest.baseline.status);
    assert.equal(git('ls-files', '--stage'), manifest.baseline.index);
    for (const [relative, hash] of Object.entries(manifest.baseline.disk)) assert.equal(sha256(normalizeText(fs.readFileSync(uri(relative).fsPath, 'utf8'))), hash);
  }
  function replaceMetadata(raw, transform) {
    const value = JSON.parse(raw); transform('code-explanation', value);
    value.steps.forEach(step => transform('step', step));
    return JSON.stringify(value, null, 2) + '\n';
  }
  function lectureText(header, steps) {
    return JSON.stringify({ ...header, version: 2, title: '首版补充验收', steps: steps.map(({ metadata, title, body }) => ({ ...metadata, title, body })) }, null, 2) + '\n';
  }

  try {
    await extension.activate();
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await checkpoint('启动后不自动开始讲解', async () => {
      const state = await renderer.state();
      assert.equal(state.comments.length, 0); assert.ok(!state.status.includes('停止讲解'));
    });
    if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'layout') {
      await require('./layout.cjs').verify({ config, renderer, checkpoint, wait, command, parseExplanation, sha256, normalizeText, disk, diskFile });
      results.finishedAt = new Date().toISOString(); results.result = '通过'; save(); return;
    }
    if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'copy') {
      await require('./copy.cjs').verify({ config, renderer, checkpoint, wait, command, parseExplanation, sha256, normalizeText, disk, diskFile });
      results.finishedAt = new Date().toISOString(); results.result = '通过'; save(); return;
    }
    if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'json') {
      await require('./json.cjs').verify({ config, renderer, checkpoint, wait, command, parseExplanation, sha256, normalizeText,
        disk, diskFile, diskRaw, unsaved, unsavedFile, manifest, project, git, open, go, shown, stop, edit, assertAnchor, activeDiff, assertBaseline });
      results.finishedAt = new Date().toISOString(); results.result = '通过'; save(); return;
    }
    if (['body', 'conversion'].includes(process.env.CODE_EXPLANATION_BACKGROUND_PHASE) || /^(sidebar|recent)/.test(process.env.CODE_EXPLANATION_BACKGROUND_PHASE ?? '')) {
      const phase = process.env.CODE_EXPLANATION_BACKGROUND_PHASE;
      const module = ['body', 'conversion'].includes(phase) ? phase : phase.startsWith('recent') ? 'recent' : 'sidebar';
      await require('./' + module + '.cjs').verify({
        config, renderer, checkpoint, wait, command, parseExplanation, sha256, normalizeText,
        disk, diskFile, diskRaw, unsaved, unsavedFile, manifest, project, git, open, go, shown, stop, edit, assertAnchor, activeDiff, assertBaseline,
      });
      results.finishedAt = new Date().toISOString(); results.result = '通过'; save(); return;
    }
    if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE) {
      if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'restore') {
        await checkpoint('真实重启后主动恢复进度，已记录步骤删除后回第一步', async () => {
          await open(diskFile, disk, 5); await renderer.screenshot('24-restart-restored.png');
          await stop();
          const changed = JSON.parse(diskRaw); changed.steps.splice(4, 1);
          const deleted = JSON.stringify(changed);
          fs.writeFileSync(diskFile, deleted); await open(diskFile, parseExplanation(deleted), 1);
          fs.writeFileSync(diskFile, diskRaw); await shown(disk, 1); await go(disk, 5); await stop();
        });
      } else if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'lecture-edit') {
        await checkpoint('未保存的讲解编辑不替换正文，回看使用只读成功内容', async () => {
          await open(diskFile, disk, 5);
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(diskFile));
          const changed = replaceMetadata(diskRaw, (kind, value) => { if (kind === 'step' && value.id === disk.steps[4].id) value.body = '这段未保存的讲解正文不能替换当前阅读。'; });
          const change = new vscode.WorkspaceEdit();
          change.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), changed);
          assert.equal(await vscode.workspace.applyEdit(change), true); assert.equal(document.isDirty, true);
          await command('previous'); await shown(disk, 4); await command('next');
          await shown(disk, 5, state => !state.comments[0].text.includes('这段未保存'));
          await command('body');
          await bodyShown(disk, 5);
          assert.equal(fs.readFileSync(diskFile, 'utf8'), diskRaw);
          await renderer.screenshot('28-unsaved-lecture-body.png');
          await vscode.window.showTextDocument(document); await vscode.commands.executeCommand('workbench.action.files.revert');
          assert.equal(document.isDirty, false); await open(diskFile, disk, 5); await stop();
        });
      } else if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'no-project') {
        await checkpoint('没有项目时说明先打开文件夹，不创建活动讲解', async () => {
          assert.equal(vscode.workspace.workspaceFolders, undefined);
          await command('open', vscode.Uri.file(diskFile));
          const state = await wait('没有项目的操作说明', value => value.text.includes('请先在 VS Code 中打开项目文件夹'));
          assert.equal(state.comments.length, 0); assert.ok(!state.status.includes('停止讲解'));
        }, '35-no-project.png');
      } else if (process.env.CODE_EXPLANATION_BACKGROUND_PHASE === 'multiple-roots') {
        async function chooseProject(label) {
          await wait('选择讲解所对应的项目', state => state.text.includes('选择讲解所对应的项目'));
          await renderer.evaluate(`(() => {
            const input = document.querySelector('.quick-input-widget input');
            input.value = ${JSON.stringify(label)};
            input.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await wait('项目筛选结果', () => renderer.evaluate(`(() => {
            const rows = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].filter(row => row.getBoundingClientRect().height > 0);
            return rows.length === 1 && rows[0].innerText.includes(${JSON.stringify(label)});
          })()`));
          await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        }
        await checkpoint('多个项目明确选择，讲解文件的位置不决定代码项目', async () => {
          assert.equal(vscode.workspace.workspaceFolders.length, 2);
          const opening = command('open', vscode.Uri.file(diskFile));
          await chooseProject('另一个项目'); await opening; await shown(disk, 1);
          assert.equal(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase(), path.join(config.otherProject, 'src/invoice.js').toLowerCase());
        }, '30-selected-project.png');
        await checkpoint('取消项目选择保留原讲解，重新选择首个项目使用其源码', async () => {
          const opening = command('open', vscode.Uri.file(diskFile));
          await wait('再次选择项目', state => state.text.includes('选择讲解所对应的项目'));
          await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await opening;
          await shown(disk, 1);
          assert.equal(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase(), path.join(config.otherProject, 'src/invoice.js').toLowerCase());
          const another = command('open', vscode.Uri.file(diskFile));
          await chooseProject('首个项目'); await another; await shown(disk, 5);
          assert.equal(activeDiff().original.authority, manifest.beforeCommit);
          await stop();
        });
      } else {
        await checkpoint('同一讲解在另一项目中不混用进度', async () => {
          assert.notEqual(vscode.workspace.workspaceFolders[0].uri.fsPath.toLowerCase(), project.toLowerCase());
          await open(diskFile, disk, 1);
          assert.equal(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase(), path.join(config.otherProject, 'src/invoice.js').toLowerCase());
          results.otherProject = config.otherProject;
          await renderer.screenshot('25-project-isolation.png'); await stop();
        });
        await checkpoint('固定 Git 中真实存在的空文件保持存在状态', async () => {
          const otherGit = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', config.otherProject, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnvironment });
          const before = otherGit('rev-parse', 'HEAD').trim();
          const code = normalizeText(otherGit('show', `${before}:src/charge.js`));
          fs.writeFileSync(path.join(config.otherProject, 'src/empty.js'), ''); otherGit('add', '--', 'src/empty.js');
          otherGit('-c', 'user.name=XGH', '-c', 'user.email=xgh@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(path.dirname(config.otherProject), 'empty-hooks')}`, 'commit', '--only', '-m', '后台验收：真实 Git 空文件', '--', 'src/empty.js');
          const after = otherGit('rev-parse', 'HEAD').trim();
          const header = { version: 2, id: 'git-empty-file', sources: {
            before: { kind: 'git', path: 'src/charge.js', exists: true, commit: before, sha256: sha256(code) },
            empty: { kind: 'git', path: 'src/empty.js', exists: true, commit: after, sha256: sha256('') },
          } };
          const step = { id: 'git-empty-step', kind: 'diff', comparison: 'commits', left: 'before', right: 'empty', targets: {
            left: { startLine: 1, endLine: 8, sha256: sha256(code.split('\n').slice(0, 8).join('\n')) },
          } };
          const file = path.join(path.dirname(config.otherProject), 'lecture-git-empty.json');
          const raw = lectureText(header, [{ metadata: step, title: '改后文件存在，但内容为空', body: '右侧来自实际提交中的空文件；它存在，但不设置空白目标。正文放在左侧。' }]);
          fs.writeFileSync(file, raw); await open(file, parseExplanation(raw));
          const input = activeDiff(); assert.equal(JSON.parse(input.modified.query).exists, true);
          assert.equal((await vscode.workspace.openTextDocument(input.modified)).getText(), '');
          await renderer.screenshot('29-git-empty-file.png'); await stop();
        });
        await checkpoint('明确重命名前后路径可比较，固定摘要和存在状态错误不借用内容', async () => {
          const otherGit = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', config.otherProject, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnvironment });
          const before = otherGit('rev-parse', 'HEAD').trim();
          const code = normalizeText(otherGit('show', `${before}:src/format-amount.js`));
          fs.renameSync(path.join(config.otherProject, 'src/format-amount.js'), path.join(config.otherProject, 'src/format-label.js'));
          otherGit('add', '--', 'src/format-amount.js', 'src/format-label.js');
          otherGit('-c', 'user.name=XGH', '-c', 'user.email=xgh@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(path.dirname(config.otherProject), 'empty-hooks')}`,
            'commit', '--only', '-m', '后台验收：明确重命名路径', '--', 'src/format-amount.js', 'src/format-label.js');
          const after = otherGit('rev-parse', 'HEAD').trim();
          const target = { startLine: 2, endLine: 2, sha256: sha256(code.split('\n')[1]) };
          const header = { version: 2, id: 'rename-paths', sources: {
            before: { kind: 'git', path: 'src/format-amount.js', exists: true, commit: before, sha256: sha256(code) },
            after: { kind: 'git', path: 'src/format-label.js', exists: true, commit: after, sha256: sha256(code) },
          } };
          const steps = [
            { metadata: { id: 'fixed-head', kind: 'file', source: 'after', target }, title: 'HEAD 的固定内容仍来自 Git', body: '即使编辑器另有修改，固定引用仍读取提交。' },
            { metadata: { id: 'rename', kind: 'diff', comparison: 'commits', left: 'before', right: 'after', targets: { right: target } }, title: '明确比较重命名前后路径', body: '左右路径由讲解明确提供，不搜索其他文件。' },
          ];
          const filename = path.join(path.dirname(config.otherProject), 'lecture-rename.json');
          const raw = lectureText(header, steps), lecture = parseExplanation(raw); fs.writeFileSync(filename, raw);
          const current = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(config.otherProject, 'src/format-label.js')));
          const change = new vscode.WorkspaceEdit(); change.insert(current.uri, new vscode.Position(0, 0), '// 编辑器中的未保存变化\n');
          assert.equal(await vscode.workspace.applyEdit(change), true);
          await open(filename, lecture); assert.equal(vscode.window.activeTextEditor.document.getText(), code);
          assert.equal(vscode.window.activeTextEditor.document.uri.scheme, 'code-explanation-source');
          await go(lecture, 2);
          assert.equal(JSON.parse(activeDiff().original.query).path, 'src/format-amount.js');
          assert.equal(JSON.parse(activeDiff().modified.query).path, 'src/format-label.js');
          assert.equal(current.isDirty, true); await renderer.screenshot('36-renamed-paths.png');
          for (const wrong of ['hash', 'exists', 'range']) {
            const changed = structuredClone(header), changedSteps = structuredClone(steps);
            if (wrong === 'hash') changed.sources.before.sha256 = '0'.repeat(64);
            if (wrong === 'exists') { changed.sources.before.exists = false; delete changed.sources.before.sha256; }
            if (wrong === 'range') changedSteps[1].metadata.targets.right.endLine = 999;
            fs.writeFileSync(filename, lectureText(changed, changedSteps));
            await wait('固定引用错误清除正文', state => !state.comments.length && !state.highlights.length &&
              state.status.includes('2/2：') && !state.status.includes('正在读取') && !state.status.includes('新讲解尚未加载') &&
              vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
            fs.writeFileSync(filename, raw); await shown(lecture, 2);
          }
          assert.equal(current.isDirty, true); await stop();
        });
        await checkpoint('当前整个文件删除时右侧确实为空，已有文件不能冒充不存在', async () => {
          const otherGit = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', config.otherProject, ...args], { encoding: 'utf8', windowsHide: true, env: gitEnvironment });
          const relative = 'src/deleted-current.js';
          const file = path.join(config.otherProject, relative);
          fs.writeFileSync(file, 'export function removed() {\n  return 2;\n}\n');
          otherGit('add', '--', relative);
          otherGit('-c', 'user.name=XGH', '-c', 'user.email=xgh@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(path.dirname(config.otherProject), 'empty-hooks')}`,
            'commit', '--only', '-m', '后台验收：准备当前删除文件', '--', relative);
          const head = otherGit('rev-parse', 'HEAD').trim();
          assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.fsPath.toLowerCase() === file.toLowerCase()));
          const bytes = fs.readFileSync(file), code = normalizeText(bytes.toString('utf8'));
          const header = { version: 2, id: 'deleted-current-file', sources: {
            before: { kind: 'git', path: relative, exists: true, commit: head, sha256: sha256(code) },
            current: { kind: 'workspace', path: relative, exists: false },
          } };
          const raw = lectureText(header, [{ metadata: { id: 'deletion', kind: 'diff', comparison: 'working-tree', left: 'before', right: 'current',
            targets: { left: { startLine: 2, endLine: 2, sha256: sha256(code.split('\n')[1]) } } },
          title: '当前整个文件已删除', body: '左侧仍来自最近提交，右侧已经没有文件，不能借用别的内容。' }]);
          const filename = path.join(path.dirname(config.otherProject), 'lecture-working-delete.json'); fs.writeFileSync(filename, raw);
          fs.unlinkSync(file);
          try {
            await open(filename, parseExplanation(raw));
            assert.equal((await vscode.workspace.openTextDocument(activeDiff().modified)).getText(), '');
            await renderer.screenshot('37-working-deletion.png');
            fs.writeFileSync(file, bytes);
            await wait('已恢复文件不能继续显示空白侧', state => !state.comments.length && !state.highlights.length && !state.status.includes('正在读取') &&
              vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
            assert.equal(fs.readFileSync(file).equals(bytes), true); await stop();
          } finally { fs.writeFileSync(file, bytes); }
        });
      }
      results.finishedAt = new Date().toISOString(); results.result = '通过'; save(); return;
    }
    await checkpoint('普通脚本定位与长 Markdown 原生显示', async () => {
      const state = await open(diskFile, disk);
      assertAnchor(state, 'file', 4, 5);
      assert.match(state.comments[0].markdown, /<ol>/); assert.match(state.comments[0].markdown, /<strong>/);
      assert.match(state.comments[0].markdown, /<blockquote><pre><code>/); assert.match(state.comments[0].markdown, /<a /);
      assert.equal(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase(), uri('src/invoice.js').fsPath.toLowerCase());
      results.decorationSample = state.highlights;
      await renderer.screenshot('01-current-markdown.png');
      await wait('长正文末尾可读', async current => {
        const scroll = await renderer.scrollCommentToBottom();
        if (!scroll?.lastVisible || current.comments.length !== 1 || current.status.includes('正在读取')) return false;
        results.markdownScroll = scroll; return true;
      });
    }, '02-markdown-bottom.png');
    await checkpoint('固定 Git 普通文件与 diff 左侧删除行', async () => {
      await go(disk, 2);
      assert.ok(vscode.window.activeTextEditor.document.getText().includes('return unitPrice * seats;'));
      const state = await go(disk, 3);
      const input = activeDiff(); assert.equal(input.original.authority, manifest.beforeCommit);
      assert.equal(input.modified.authority, manifest.afterCommit); assertAnchor(state, 'left', 2);
    }, '03-diff-left.png');
    await checkpoint('同一真实 diff 右侧新增行', async () => {
      const previous = activeDiff();
      const state = await go(disk, 4); const next = activeDiff();
      assert.equal(previous.original.toString(), next.original.toString());
      assert.equal(previous.modified.toString(), next.modified.toString()); assertAnchor(state, 'right', 6, 7);
    }, '04-diff-right.png');
    await checkpoint('两侧目标同时高亮且正文只在右侧', async () => {
      const state = await go(disk, 5); assertAnchor(state, 'right', 2, 4);
      assert.ok(state.highlights.some(item => item.side === 'left'), JSON.stringify(state.highlights));
      assert.ok(state.highlights.some(item => item.side === 'right'), JSON.stringify(state.highlights));
    }, '05-diff-both.png');
    await checkpoint('暂存和未暂存内容同时出现在当前比较', async () => {
      await go(disk, 6); const input = activeDiff();
      assert.equal(input.original.authority, manifest.afterCommit); assert.equal(input.modified.scheme, 'file');
      const document = await vscode.workspace.openTextDocument(input.modified);
      assert.ok(document.getText().includes('unitPrice < 0')); assert.ok(document.getText().includes('Math.round'));
    }, '06-working.png');
    await checkpoint('整个新增文件和整个删除文件', async () => {
      const added = await go(disk, 7); assertAnchor(added, 'right', 2);
      assert.equal((await vscode.workspace.openTextDocument(activeDiff().original)).getText(), '');
      await renderer.screenshot('07-added.png');
      const removed = await go(disk, 8); assertAnchor(removed, 'left', 2);
      assert.equal((await vscode.workspace.openTextDocument(activeDiff().modified)).getText(), '');
    }, '08-deleted.png');
    await checkpoint('最后一步不自动停止，停止清理及主动恢复', async () => {
      await go(disk, 9); await command('next'); await shown(disk, 9);
      for (const index of [7, 6, 3, 2, 1, 9]) await go(disk, index);
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
      await stop(); assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, tabs);
      await renderer.screenshot('10-stopped.png'); await open(diskFile, disk, 9); assertBaseline();
    }, '11-resumed.png');
    await checkpoint('真实步骤列表选择和取消打开保留当前阅读', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('workbench.action.acceptSelectedQuickOpenItem'));
      const selected = command('select');
      await wait('步骤列表', state => state.text.includes('选择讲解步骤') && state.text.includes('1. ' + disk.steps[0].title));
      await renderer.screenshot('09-step-list.png');
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); await selected; await shown(disk, 1);
      const cancelled = command('open');
      await wait('文件选择', () => renderer.evaluate(`!!document.querySelector('.quick-input-widget:not([style*="display: none"])')`));
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await cancelled; await shown(disk, 1);
      await go(disk, 9);
    });
    await checkpoint('新建未落盘源码可普通阅读和比较，修改后立即重检', async () => {
      const file = uri('src/new-unsaved.js');
      assert.equal(fs.existsSync(file.fsPath), false);
      const document = await vscode.workspace.openTextDocument(file.with({ scheme: 'untitled' }));
      const code = 'export const fee = 2;\n';
      const change = new vscode.WorkspaceEdit(); change.insert(document.uri, new vscode.Position(0, 0), code);
      assert.equal(await vscode.workspace.applyEdit(change), true);
      assert.equal(document.isUntitled, true); assert.equal(document.isDirty, true);
      const target = { startLine: 1, endLine: 1, sha256: sha256(code.trimEnd()) };
      const raw = lectureText({ version: 2, id: 'new-unsaved', sources: {
        before: { kind: 'git', path: 'src/new-unsaved.js', commit: manifest.afterCommit, exists: false },
        current: { kind: 'workspace', path: 'src/new-unsaved.js', exists: true, sha256: sha256(code) },
      } }, [
        { metadata: { id: 'plain', kind: 'file', source: 'current', target }, title: '读取新建未保存源码', body: '`fee` 为 2。代码只在编辑器中，磁盘还没有该文件。' },
        { metadata: { id: 'diff', kind: 'diff', comparison: 'working-tree', left: 'before', right: 'current', targets: { right: target } }, title: '比较新增的未保存源码', body: '最近提交中没有该文件，右侧直接使用未保存文档。' },
      ]);
      const filename = path.join(config.fixture, 'lecture-new-unsaved.json'); fs.writeFileSync(filename, raw);
      const lecture = parseExplanation(raw);
      const state = await open(filename, lecture); assertAnchor(state, 'file', 1);
      assert.equal(vscode.window.activeTextEditor.document, document);
      await renderer.screenshot('31-untitled-file.png');
      await go(lecture, 2); assert.equal(activeDiff().modified.toString(), document.uri.toString());
      assert.equal((await vscode.workspace.openTextDocument(activeDiff().original)).getText(), '');
      await renderer.screenshot('32-untitled-diff.png');
      const modified = new vscode.WorkspaceEdit(); modified.replace(document.uri, new vscode.Range(0, 0, 0, code.trimEnd().length), 'export const fee = 3;');
      assert.equal(await vscode.workspace.applyEdit(modified), true);
      await wait('未保存新文件变化清除正文', value => !value.comments.length && !value.highlights.length && !value.status.includes('正在读取') &&
        vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputWebview);
      await renderer.screenshot('33-untitled-changed.png');
      const restore = new vscode.WorkspaceEdit(); restore.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), code);
      assert.equal(await vscode.workspace.applyEdit(restore), true); await shown(lecture, 2);
      await stop(); assert.equal(document.isDirty, true); assert.equal(normalizeText(document.getText()), code);
      assert.equal(fs.existsSync(file.fsPath), false); assertBaseline(); await open(diskFile, disk, 9);
    });
    await checkpoint('BOM 和 CRLF 可读，正文中的步骤标记不创建步骤', async () => {
      await go(disk, 1);
      const literal = '\n\n```md\n<!-- step\n{}\n-->\n## 代码中的标题\n```\n\n> <!-- step\n> {}\n> -->\n> ## 引用中的标题\n\n    <!-- step\n    {}\n    -->\n\n## 正文中的小标题\n\n这仍是第一步正文。';
      const raw = '\uFEFF' + replaceMetadata(diskRaw, (kind, value) => { if (kind === 'step' && value.id === disk.steps[0].id) value.body += literal; }).replace(/\n/g, '\r\n');
      fs.writeFileSync(diskFile, raw);
      await shown(disk, 1, value => value.comments[0].text.includes('这仍是第一步正文。'));
      assert.equal(parseExplanation(raw).steps.length, disk.steps.length);
      fs.writeFileSync(diskFile, diskRaw); await shown(disk, 1, value => !value.comments[0].text.includes('这仍是第一步正文。'));
      await go(disk, 9);
    });
    await checkpoint('讲解正文中的命令链接和 HTML 不获得执行或插入代码权限', async () => {
      let executed = 0;
      const registration = vscode.commands.registerCommand('codeExplanationBackgroundProbe', () => { executed++; });
      const filename = path.join(config.fixture, 'lecture-untrusted.json');
      const raw = lectureText({ version: 2, id: 'untrusted-body', sources: { current: disk.sources['invoice-current'] } },
      [{ metadata: { id: 'untrusted-step', kind: 'file', source: 'current', target: disk.steps[0].target },
        title: '正文只用于阅读', body: '[普通资料](https://example.com/reading)\n\n[不应执行](command:codeExplanationBackgroundProbe)\n\n<script>document.body.dataset.codeExplanationExecuted = "yes";</script>\n\n```js\nthrow new Error("这里只是正文");\n```' }]);
      fs.writeFileSync(filename, raw);
      try {
        await open(filename, parseExplanation(raw));
        const links = await renderer.evaluate(`(() => {
          const body = document.querySelector('.review-widget .rendered-markdown');
          const anchors = [...body.querySelectorAll('a')];
          const command = anchors.find(a => (a.getAttribute('data-href') || a.getAttribute('href') || '').startsWith('command:'));
          command?.click();
          return { external: anchors.some(a => (a.getAttribute('data-href') || a.getAttribute('href') || '').startsWith('https://example.com/reading')),
            script: !!body.querySelector('script'), executed: document.body.dataset.codeExplanationExecuted === 'yes' };
        })()`);
        assert.equal(links.external, true); assert.equal(links.script, false); assert.equal(links.executed, false);
        await command('next'); await shown(parseExplanation(raw), 1); assert.equal(executed, 0); assertBaseline();
        results.untrustedBody = links; await renderer.screenshot('34-untrusted-body.png');
      } finally { registration.dispose(); await stop(); }
      await open(diskFile, disk, 9);
    });
    await checkpoint('真实未保存文档参与 diff 且不写盘', async () => {
      const document = await edit('src/charge.js', originalCharge.replace('return subtotal;', 'return subtotal + 2;'));
      assert.equal(document.isDirty, true);
      await open(unsavedFile, unsaved); await go(unsaved, 6);
      assert.equal((await vscode.workspace.openTextDocument(activeDiff().modified)).getText(), document.getText());
      assert.ok(document.getText().includes('return subtotal + 2;')); assertBaseline();
    }, '12-unsaved.png');
    await checkpoint('分号前空格和缩进变化自动继续', async () => {
      const text = originalCharge.replace('  return subtotal;', '\treturn subtotal + 2 ;');
      const document = await edit('src/charge.js', text);
      const state = await shown(unsaved, 6, value => value.comments[0].text.includes('代码格式已变化'));
      assert.equal(document.isDirty, true); assertAnchor(state, 'right', 1, 8); assertBaseline();
      await renderer.scrollCommentToBottom();
    }, '13-formatting-accepted.png');
    await checkpoint('数字变化清除行内讲解并显示排版正文，恢复后自动回来', async () => {
      await edit('src/charge.js', originalCharge.replace('return subtotal;', 'return subtotal + 3;'));
      const state = await invalid(unsaved, 6); assert.equal(state.highlights.length, 0);
      await renderer.screenshot('14-code-changed.png');
      await edit('src/charge.js', originalCharge.replace('return subtotal;', 'return subtotal + 2 ;'));
      await shown(unsaved, 6, value => value.comments[0].text.includes('代码格式已变化'));
    }, '15-code-restored.png');
    await checkpoint('停止和重新打开仍保留未保存内容', async () => {
      const document = await vscode.workspace.openTextDocument(uri('src/charge.js'));
      const text = document.getText(); await stop();
      assert.equal(document.getText(), text); assert.equal(document.isDirty, true); assertBaseline();
      await open(unsavedFile, unsaved, 6); assert.equal(document.getText(), text); assert.equal(document.isDirty, true);
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      assert.equal(document.isDirty, false); assert.equal(document.getText(), originalCharge);
      await open(diskFile, disk, 9); await go(disk, 1);
    });
    await checkpoint('插行后的唯一重新定位与重复目标拒绝', async () => {
      await edit('src/invoice.js', '\n\n' + originalInvoice);
      const moved = await shown(disk, 1, value => value.comments[0].range.includes('lines 6 through 7.'));
      assertAnchor(moved, 'file', 6, 7); await renderer.screenshot('16-relocated.png');
      const fragment = normalizeText(originalInvoice).split('\n').slice(3, 5).join('\n');
      await edit('src/invoice.js', originalInvoice + '\n' + fragment + '\n');
      const invalidState = await invalid(disk, 1); assert.equal(invalidState.highlights.length, 0);
      await renderer.screenshot('17-ambiguous.png');
      await edit('src/invoice.js', originalInvoice); await shown(disk, 1);
    });
    await checkpoint('目标外修改允许唯一原文继续，模板内部空格不放宽', async () => {
      await edit('src/invoice.js', originalInvoice + '\n// 后台验收的无关注释\n');
      await shown(disk, 1, value => value.comments[0].text.includes('已有其他修改'));
      await edit('src/invoice.js', originalInvoice); await shown(disk, 1);
      await go(disk, 9); await edit('src/format-amount.js', originalFormatter.replace(' 元', '  元'));
      await invalid(disk, 9); await renderer.screenshot('18-template-changed.png');
      await edit('src/format-amount.js', originalFormatter); await shown(disk, 9);
    });
    await checkpoint('双侧目标任一失效时清除整步', async () => {
      await go(disk, 5);
      const changed = replaceMetadata(diskRaw, (kind, value) => {
        if (kind === 'step' && value.id === disk.steps[4].id) value.targets.right.sha256 = '0'.repeat(64);
      });
      fs.writeFileSync(diskFile, changed);
      const state = await invalid(disk, 5); assert.equal(state.highlights.length, 0);
      await renderer.screenshot('19-both-invalid.png');
      fs.writeFileSync(diskFile, diskRaw); await shown(disk, 5);
    });
    await checkpoint('保存正文和重排后保留步骤标识，删除后回第一步', async () => {
      const updated = replaceMetadata(diskRaw, (kind, value) => { if (kind === 'step' && value.id === disk.steps[4].id) value.body += '\n\n后台自动更新确认。'; });
      fs.writeFileSync(diskFile, updated); await shown(disk, 5, state => state.comments[0].text.includes('后台自动更新确认。'));
      const value = JSON.parse(updated), selected = value.steps.splice(4, 1)[0]; value.steps.unshift(selected);
      const reorderedRaw = JSON.stringify(value); fs.writeFileSync(diskFile, reorderedRaw);
      const reordered = parseExplanation(reorderedRaw); await shown(reordered, 1);
      assert.equal(reordered.steps[0].id, disk.steps[4].id); await renderer.screenshot('20-reordered.png');
      value.steps.shift(); const deleted = JSON.stringify(value); fs.writeFileSync(diskFile, deleted);
      await shown(parseExplanation(deleted), 1);
      fs.writeFileSync(diskFile, diskRaw); await shown(disk, 1);
    });
    await checkpoint('讲解标识改变从第一步开始', async () => {
      await go(disk, 5);
      const changed = replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.id = 'background-new-id'; });
      fs.writeFileSync(diskFile, changed); await shown(disk, 1);
      fs.writeFileSync(diskFile, diskRaw); await shown(disk, 1);
    });
    await checkpoint('无效更新保留旧正文，源码变化仍检查，只读正文及恢复', async () => {
      const invalidUpdates = [diskRaw.slice(0, 30), replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.version = 99; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'step') value.id = 'duplicate'; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'step' && value.target) value.target.startLine = 0; }),
        diskRaw.replace('"version": 2,', '"version": 2, "version": 2,'),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') delete value.sources; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.unknown = true; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.sources['invoice-current'].sha256 = 'INVALID'; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.sources['invoice-current'].path = '../project/src/invoice.js'; }),
        replaceMetadata(diskRaw, (kind, value) => { if (kind === 'code-explanation') value.sources['invoice-current'].path = uri('src/invoice.js').fsPath; })];
      results.invalidUpdateVariants = invalidUpdates.length;
      for (const raw of invalidUpdates) {
        assert.notEqual(raw, diskRaw, '每项无效更新必须实际改变讲解文件');
        fs.writeFileSync(diskFile, raw);
        await shown(disk, 1, state => state.status.includes('新讲解尚未加载'));
        fs.writeFileSync(diskFile, diskRaw); await shown(disk, 1, state => !state.status.includes('新讲解尚未加载'));
      }
      fs.writeFileSync(diskFile, invalidUpdates[0]); await shown(disk, 1, state => state.status.includes('新讲解尚未加载'));
      await edit('src/invoice.js', originalInvoice.replace('return { seats, amount };', 'return { seats };'));
      await invalid(disk, 1); await bodyShown(disk, 1, '上一次成功加载');
      await renderer.screenshot('21-accepted-body.png');
      fs.writeFileSync(diskFile, diskRaw); await wait('文件错误解除', state => !state.status.includes('新讲解尚未加载') && !state.status.includes('正在读取'));
      await edit('src/invoice.js', originalInvoice); await shown(disk, 1);
    });
    await checkpoint('讲解暂时不可读时提供只读正文并自动恢复', async () => {
      const renamed = diskFile + '.temporarily-unavailable';
      fs.renameSync(diskFile, renamed);
      await shown(disk, 1, state => state.status.includes('新讲解尚未加载'));
      await command('body');
      await bodyShown(disk, 1);
      fs.renameSync(renamed, diskFile); await shown(disk, 1, state => !state.status.includes('新讲解尚未加载'));
    });
    await checkpoint('首次无效文件和另一份无效讲解不替换有效阅读', async () => {
      const bad = path.join(config.fixture, 'invalid.json'); fs.writeFileSync(bad, '# 缺少文件头');
      await command('open', vscode.Uri.file(bad)); await shown(disk, 1);
      await stop(); await command('open', vscode.Uri.file(bad));
      const state = await renderer.state(); assert.equal(state.comments.length, 0); assert.ok(!state.status.includes('停止讲解'));
      await open(diskFile, disk, 1);
    });
    await checkpoint('同标识讲解移到新位置不混用进度', async () => {
      await go(disk, 5);
      const copy = path.join(config.fixture, 'lecture-copy.json'); fs.writeFileSync(copy, diskRaw);
      await open(copy, disk, 1); await open(diskFile, disk, 5);
    });
    await checkpoint('不存在的固定提交提示错误，恢复后继续', async () => {
      await go(disk, 3);
      fs.writeFileSync(diskFile, replaceMetadata(diskRaw, (kind, value) => {
        if (kind === 'code-explanation') value.sources['charge-before'].commit = '0'.repeat(40);
      }));
      await invalid(disk, 3); await renderer.screenshot('22-missing-commit.png');
      fs.writeFileSync(diskFile, diskRaw); await shown(disk, 3);
    });
    await checkpoint('不存在的 Git 文件路径不被当作空白成功', async () => {
      fs.writeFileSync(diskFile, replaceMetadata(diskRaw, (kind, value) => {
        if (kind === 'code-explanation') value.sources['charge-before'].path = 'src/missing.js';
      }));
      await invalid(disk, 3); fs.writeFileSync(diskFile, diskRaw); await shown(disk, 3);
    });
    await checkpoint('未加载的当前源码缺失，恢复文件后自动继续', async () => {
      const file = uri('src/unopened-invoice.js');
      const missingFile = path.join(config.fixture, 'lecture-missing-source.json');
      const raw = replaceMetadata(diskRaw, (kind, value) => {
        if (kind === 'code-explanation') { value.id = 'missing-source'; value.sources['invoice-current'].path = 'src/unopened-invoice.js'; }
      });
      fs.writeFileSync(file.fsPath, originalInvoice); fs.writeFileSync(missingFile, raw);
      assert.ok(!vscode.workspace.textDocuments.some(document => document.uri.toString().toLowerCase() === file.toString().toLowerCase()));
      const renamed = file.fsPath + '.temporarily-unavailable'; fs.renameSync(file.fsPath, renamed);
      await command('open', vscode.Uri.file(missingFile));
      await wait('未加载的源码缺失', state => !state.comments.length && !state.status.includes('正在读取') && state.text.includes('当前编辑器和磁盘中均不存在该文件'));
      await renderer.screenshot('26-source-missing.png');
      fs.renameSync(renamed, file.fsPath); await shown(parseExplanation(raw), 1); await stop();
      fs.unlinkSync(file.fsPath); await open(diskFile, disk, 3); await go(disk, 1);
    });
    await checkpoint('目标删除清除行内正文，恢复后重新显示', async () => {
      const fragment = normalizeText(originalInvoice).split('\n').slice(3, 5).join('\n');
      await edit('src/invoice.js', originalInvoice.replace(fragment, ''));
      await invalid(disk, 1);
      await edit('src/invoice.js', originalInvoice); await shown(disk, 1);
    });
    await checkpoint('真实空文件按存在处理，不冒充不存在侧', async () => {
      const empty = uri('src/empty.js'); fs.writeFileSync(empty.fsPath, '');
      const emptyFile = path.join(config.fixture, 'lecture-empty.json');
      const header = { version: 2, id: 'empty-file', sources: { empty: { kind: 'workspace', path: 'src/empty.js', exists: true, sha256: sha256('') } } };
      const step = { id: 'empty-step', kind: 'file', source: 'empty', target: { startLine: 1, endLine: 1, sha256: sha256('') } };
      fs.writeFileSync(emptyFile, lectureText(header, [{ metadata: step, title: '空文件没有非空目标', body: '空文件确实存在，但不能在空白范围挂接讲解。' }]));
      await command('open', vscode.Uri.file(emptyFile));
      await wait('空文件目标错误', state => !state.comments.length && state.text.includes('目标范围全部为空白'));
      await renderer.screenshot('27-empty-file.png'); await stop();
      const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === empty.toString());
      if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
      fs.unlinkSync(empty.fsPath); await open(diskFile, disk, 1);
    });
    await checkpoint('新 HEAD 使未提交比较失效，固定历史仍可读', async () => {
      assertBaseline(); await go(disk, 6);
      git('-c', 'user.name=XGH', '-c', 'user.email=xgh@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(config.fixture, 'empty-hooks')}`, 'commit', '--allow-empty', '--only', '-m', '后台验收：改变 HEAD');
      await invalid(disk, 6); await renderer.screenshot('23-head-changed.png');
      assert.equal(git('ls-files', '--stage'), manifest.baseline.index);
      assert.equal(git('status', '--porcelain=v1'), manifest.baseline.status);
      await go(disk, 5); await stop(); await open(diskFile, disk, 5);
    });
    await stop();
    results.finishedAt = new Date().toISOString(); results.result = '通过'; save();
  } catch (error) {
    results.result = '失败'; results.error = error.stack; save(); throw error;
  } finally {
    await command('stop').catch(() => {}); renderer.close();
  }
};
