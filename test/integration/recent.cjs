const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { pause } = require('./renderer.cjs');

exports.verify = async context => {
  const { config, renderer, checkpoint, wait, command, parseExplanation, diskRaw, project, shown, go, stop, manifest, git, sha256, normalizeText } = context;
  const phase = process.env.CODE_EXPLANATION_BACKGROUND_PHASE;
  const scenarioFile = path.join(config.runRoot, 'recent-scenario.json');
  const processesFile = path.join(config.runRoot, 'recent-processes.json');
  const rowsSelector = '.part.sidebar .monaco-list-row';
  const visible = `element=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0;}`;
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const uri = file => vscode.Uri.file(file);
  const projectName = folder => vscode.workspace.workspaceFolders.find(item => same(item.uri.fsPath, folder))?.name;
  const write = (file, value) => {
    assert.ok(path.resolve(file).toLowerCase().startsWith(path.resolve(config.runRoot).toLowerCase() + path.sep));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
    return parseExplanation(JSON.stringify(value));
  };
  const load = file => parseExplanation(fs.readFileSync(file, 'utf8'));
  function assertBaseline() {
    assert.equal(git('rev-parse', 'HEAD').trim(), manifest.baseline.head);
    assert.equal(git('ls-files', '--stage'), manifest.baseline.index);
    // 仅排除本模块明确创建的讲解；任何其他源码、索引或未跟踪文件变化仍需失败。
    assert.equal(git('status', '--porcelain=v1', '--', '.', ':(exclude).code-explanations/recent-a.json'), manifest.baseline.status);
    for (const [relative, hash] of Object.entries(manifest.baseline.disk)) {
      assert.equal(sha256(normalizeText(fs.readFileSync(path.join(project, relative), 'utf8'))), hash);
    }
  }
  const build = (raw, id, title, prefix) => {
    const value = JSON.parse(raw); value.id = id; value.title = title;
    value.steps.forEach((step, index) => { step.title = `${prefix}步骤 ${index + 1}`; });
    return value;
  };
  async function clickPoint(point) {
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function activity() {
    const open = await renderer.evaluate(`document.querySelector('.part.sidebar')?.innerText.includes('最近打开')`);
    if (!open) {
      const point = await renderer.evaluate(`(()=>{const e=[...document.querySelectorAll('.activitybar [aria-label]')].find(e=>e.getAttribute('aria-label').startsWith('行内代码讲解')&&(${visible})(e));if(!e)throw new Error('未找到讲解活动栏图标');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await clickPoint(point);
    }
    await wait('侧栏显示继续与最近入口', () => renderer.evaluate(`document.querySelector('.part.sidebar')?.innerText.includes('最近打开')`));
  }
  async function rows(label, folder, group) {
    const names = vscode.workspace.workspaceFolders.map(item => item.name);
    return renderer.evaluate(`(()=>{let project='',group='';const result=[];const all=[...document.querySelectorAll(${JSON.stringify(rowsSelector)})];for(let index=0;index<all.length;index++){const row=all[index];if(!(${visible})(row))continue;const label=row.querySelector('.label-name')?.textContent.trim();if(${JSON.stringify(names)}.includes(label)){project=label;group='';}else if(label==='最近打开'||label==='项目讲解'){group=label;}if(label===${JSON.stringify(label)}&&project===${JSON.stringify(projectName(folder))}&&(${JSON.stringify(group)}===undefined||group===${JSON.stringify(group)}))result.push({index,text:row.innerText,expanded:row.getAttribute('aria-expanded')});}return result;})()`);
  }
  async function clickRow(label, folder, group, twistie = false) {
    await wait(`侧栏显示 ${projectName(folder)} 的“${label}”`, async () => (await rows(label, folder, group)).length > 0);
    const row = (await rows(label, folder, group))[0];
    const point = await renderer.evaluate(`(()=>{const row=document.querySelectorAll(${JSON.stringify(rowsSelector)})[${row.index}];const e=row.querySelector(${JSON.stringify(twistie ? '.monaco-tl-twistie' : '.label-name')});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await clickPoint(point);
  }
  async function expand(label, folder, group) {
    if ((await rows(label, folder, group))[0]?.expanded !== 'true') await clickRow(label, folder, group, true);
  }
  async function continueReading(folder, lecture, index) {
    await clickRow('继续上次讲解', folder); await shown(lecture, index);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const locations = input instanceof vscode.TabInputTextDiff ? [input.original, input.modified] : [vscode.window.activeTextEditor.document.uri];
    for (const location of locations) {
      if (location.scheme === 'code-explanation-source') assert.ok(same(JSON.parse(location.query).project, folder));
      else {
        assert.equal(location.scheme, 'file');
        const relative = path.relative(folder, location.fsPath);
        assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
      }
    }
  }
  async function openFile(file, lecture, index = 1) {
    await command('open', uri(file)); await shown(lecture, index);
  }
  const recentKey = folder => 'codeExplanation.recent.' + createHash('sha256').update(uri(folder).toString().toLowerCase()).digest('hex');
  // 只读本轮普通 VS Code 写下的数据库。没有设置或替换被测插件的存储对象。
  function storage() {
    const files = [path.join(config.runRoot, 'user-data', 'User', 'globalStorage', 'state.vscdb'),
      path.join(config.runRoot, 'shared-data', 'sharedStorage', 'state.vscdb')].filter(file => fs.existsSync(file));
    const script = `const fs=require('node:fs');const{DatabaseSync}=require('node:sqlite');const result=[];for(const file of process.argv.slice(1)){const db=new DatabaseSync(file,{readOnly:true});try{for(const row of db.prepare("SELECT key,value FROM ItemTable WHERE lower(key) LIKE '%code-explanation-extension%'").all()){try{result.push({file,key:row.key,value:JSON.parse(Buffer.isBuffer(row.value)?row.value.toString():row.value)});}catch{}}}finally{db.close();}}process.stdout.write(JSON.stringify(result));`;
    const stores = files.length ? JSON.parse(execFileSync('node', ['--disable-warning=ExperimentalWarning', '-e', script, ...files], { encoding: 'utf8', windowsHide: true })) : [];
    return { files: files.flatMap(file => [file, file + '-wal'].filter(file => fs.existsSync(file)).map(file => {
      const bytes = fs.readFileSync(file), stat = fs.statSync(file);
      return { file, size: bytes.length, modifiedAt: stat.mtime.toISOString(), sha256: createHash('sha256').update(bytes).digest('hex') };
    })), stores };
  }
  async function stored(folder, check) {
    let snapshot;
    await wait('普通进程已将最近记录写到实际数据库', () => {
      snapshot = storage(); const store = snapshot.stores.find(item => Array.isArray(item.value?.[recentKey(folder)]));
      return !!store && check(store.value[recentKey(folder)], store.value);
    });
    return snapshot;
  }
  async function recordProcess(folder, expectedFirst) {
    const snapshot = await stored(folder, files => same(files[0], uri(expectedFirst).toString()));
    const records = fs.existsSync(processesFile) ? JSON.parse(fs.readFileSync(processesFile, 'utf8')) : [];
    const identity = JSON.parse(fs.readFileSync(path.join(config.runRoot, 'copy-expected-isolation.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.ok(!records.some(item => item.desktop === identity.desktop && same(item.project, folder)));
    records.push({ phase, extensionHostProcessId: process.pid, sessionId: vscode.env.sessionId, project: folder,
      mainProcessId: identity.mainProcessId, desktop: identity.desktop,
      userDataDirectory: path.join(config.runRoot, 'user-data'), databases: snapshot.files,
      records: snapshot.stores.filter(item => item.value && typeof item.value === 'object').map(item => ({ file: item.file, key: item.key,
        values: Object.fromEntries(Object.entries(item.value).filter(([key]) => key.startsWith('codeExplanation.recent.') || key.startsWith('codeExplanation.progress.'))) })) });
    fs.writeFileSync(processesFile, JSON.stringify(records, null, 2));
  }
  async function closeSourceTabs() {
    await stop();
    await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs));
    assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, 0);
    await pause(350);
  }
  let scenario = fs.existsSync(scenarioFile) ? JSON.parse(fs.readFileSync(scenarioFile, 'utf8')) : {};
  try {
    await activity();
    await checkpoint(`${phase} 启动只列出历史，不自动打开源码或开始讲解`, async () => {
      assert.equal((await renderer.state()).comments.length, 0);
      assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff).length, 0);
    });
    if (phase === 'recent') {
      const aFile = path.join(project, '.code-explanations', 'recent-a.json');
      const bFile = path.join(config.runRoot, 'recent', 'external-b.json');
      const aValue = build(diskRaw, 'recent-first-project-a', '项目内讲解', '项目内');
      const bValue = build(diskRaw, 'recent-first-project-b', '目录外讲解', '目录外');
      assert.equal(fs.existsSync(aFile), false);
      const a = write(aFile, aValue), b = write(bFile, bValue);
      scenario = { aFile, bFile, bStep: 4, finalStep: 2 };
      fs.writeFileSync(scenarioFile, JSON.stringify(scenario, null, 2));
      await checkpoint('首次成功打开目录内与目录外讲解，侧栏同时保留目录列表及最近记录', async () => {
        await wait('目录内讲解被发现', async () => (await rows(a.title, project, '项目讲解')).length === 1);
        assert.equal((await renderer.state()).comments.length, 0);
        assert.equal((await rows('继续上次讲解', project))[0]?.text.includes('尚无记录'), true);
        await clickRow(a.title, project, '项目讲解'); await shown(a, 1); await go(a, 2);
        await openFile(bFile, b); await go(b, scenario.bStep);
        await wait('目录外讲解进入最近列表', async () => (await rows(b.title, project, '最近打开')).length === 1);
        assert.equal((await rows(b.title, project, '项目讲解')).length, 0);
        assert.ok((await rows('继续上次讲解', project))[0]?.text.includes(b.title));
      }, 'recent-first-open.png');
      await checkpoint('取消、坏JSON和缺失文件不替换成功阅读及最近目标', async () => {
        const before = (await stored(project, files => same(files[0], uri(bFile).toString()))).stores.find(item => item.value?.[recentKey(project)]).value[recentKey(project)];
        const invalid = path.join(config.runRoot, 'recent', 'invalid.json'); fs.writeFileSync(invalid, '{');
        await command('open', uri(invalid)); await shown(b, scenario.bStep);
        await command('open', uri(path.join(config.runRoot, 'recent', 'missing.json'))); await shown(b, scenario.bStep);
        const opening = command('open');
        await wait('打开文件选择后可取消', () => renderer.evaluate(`!!document.querySelector('.quick-input-widget:not([style*="display: none"])')`));
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await opening; await shown(b, scenario.bStep);
        const after = (await stored(project, files => same(files[0], uri(bFile).toString()))).stores.find(item => item.value?.[recentKey(project)]).value[recentKey(project)];
        assert.deepEqual(after, before);
      }, 'recent-open-failed.png');
      await checkpoint('真实打开22份案例后只保留最近20个文件，并按文件去重和成功打开次序排序', async () => {
        const files = [];
        for (let index = 0; index < 22; index++) {
          const value = build(diskRaw, `recent-limit-${index}`, `最近记录上限案例 ${index + 1}`, '上限');
          value.steps = [value.steps[0]];
          const file = path.join(config.runRoot, 'recent', `limit-${index}.json`), lecture = write(file, value); files.push(uri(file).toString());
          await openFile(file, lecture);
        }
        await stored(project, current => current.length === 20 && current.every((file, index) => same(file, files[21 - index])));
        await openFile(scenario.aFile, a, 2);
        await openFile(scenario.bFile, b, scenario.bStep);
        await openFile(path.join(path.dirname(bFile), path.basename(bFile).toUpperCase()), b, scenario.bStep);
        await openFile(bFile, b, scenario.bStep);
        await stored(project, current => current.length === 20 && new Set(current.map(file => file.toLowerCase())).size === 20 &&
          same(current[0], uri(bFile).toString()) && same(current[1], uri(aFile).toString()));
      }, 'recent-limited.png');
      await checkpoint('停止仍保留继续入口，真实普通进程写下文件位置和步骤后退出', async () => {
        await stop(); await continueReading(project, b, scenario.bStep); await closeSourceTabs();
        await recordProcess(project, bFile); assertBaseline();
      }, 'recent-stopped-before-restart.png');
      return;
    }
    if (phase === 'recent-restore') {
      const a = load(scenario.aFile), b = load(scenario.bFile);
      await checkpoint('关闭后重启同一普通配置，主动点击继续恢复目录外讲解的真实步骤', async () => {
        await continueReading(project, b, scenario.bStep);
        await expand(a.title, project, '最近打开');
        await clickRow(`1. ${a.steps[0].title}`, project, '最近打开'); await shown(a, 1);
        await clickRow(a.title, project, '最近打开'); await shown(a, 1);
        await go(a, 2); await clickRow(b.title, project, '最近打开'); await shown(b, scenario.bStep);
      }, 'recent-restored.png');
      await checkpoint('恢复重新读取最新文件，标题变化和重排保持步骤标识，删除和新讲解回第一步', async () => {
        await go(b, 5); await stop();
        const changed = JSON.parse(fs.readFileSync(scenario.bFile, 'utf8'));
        const selected = changed.steps.splice(4, 1)[0]; changed.steps.push(selected); changed.title = '目录外讲解已更新';
        let lecture = write(scenario.bFile, changed);
        await wait('最近列表读取新标题', async () => (await rows(changed.title, project, '最近打开')).length === 1);
        await continueReading(project, lecture, lecture.steps.length); await stop();
        changed.steps.pop(); lecture = write(scenario.bFile, changed);
        await continueReading(project, lecture, 1); await stop();
        changed.id = 'recent-first-project-b-replaced'; changed.title = '目录外讲解使用新标识'; lecture = write(scenario.bFile, changed);
        await wait('最近列表接受新讲解标识', async () => (await rows(changed.title, project, '最近打开')).length === 1);
        await continueReading(project, lecture, 1);
      }, 'recent-updated-steps.png');
      await checkpoint('继续目标暂时缺失时说明具体文件，保留记录与已接受内容，恢复后仍能打开', async () => {
        const raw = fs.readFileSync(scenario.bFile, 'utf8'), lecture = parseExplanation(raw);
        fs.unlinkSync(scenario.bFile);
        await wait('最近文件缺失显示原因', async () => (await rows(path.basename(scenario.bFile), project, '最近打开')).some(row => row.text.includes('无法读取')));
        await clickRow('继续上次讲解', project);
        await wait('继续失败说明具体文件', state => state.text.includes('无法打开讲解') && state.text.toLowerCase().includes(path.basename(scenario.bFile).toLowerCase()));
        await stored(project, files => same(files[0], uri(scenario.bFile).toString()));
        await shown(lecture, 1);
        fs.writeFileSync(scenario.bFile, raw);
        await wait('最近文件恢复标题', async () => (await rows(lecture.title, project, '最近打开')).length === 1);
        await continueReading(project, lecture, 1);
        await clickRow(a.title, project, '最近打开'); await shown(a, 2);
        await closeSourceTabs(); await recordProcess(project, scenario.aFile); assertBaseline();
      }, 'recent-missing-recovered.png');
      return;
    }
    if (phase === 'recent-project') {
      const otherProject = config.otherProject;
      const manifest = JSON.parse(fs.readFileSync(path.join(otherProject, '..', 'manifest.json'), 'utf8'));
      const otherFile = path.join(otherProject, '.code-explanations', 'recent-other.json');
      const other = write(otherFile, build(fs.readFileSync(manifest.lectures.disk.path, 'utf8'), 'recent-second-project', '另一个项目的讲解', '另一个项目'));
      scenario.otherFile = otherFile; scenario.otherStep = 3;
      fs.writeFileSync(scenarioFile, JSON.stringify(scenario, null, 2));
      await checkpoint('同一配置打开另一项目没有首项目历史，成功阅读后仅保存本项目记录', async () => {
        assert.equal((await rows('继续上次讲解', otherProject))[0]?.text.includes('尚无记录'), true);
        assert.equal((await rows('项目内讲解', otherProject, '最近打开')).length, 0);
        assert.equal((await rows('目录外讲解使用新标识', otherProject, '最近打开')).length, 0);
        await clickRow(other.title, otherProject, '项目讲解'); await shown(other, 1); await go(other, scenario.otherStep);
        await closeSourceTabs(); await recordProcess(otherProject, otherFile);
        const snapshot = storage();
        const state = snapshot.stores.find(item => item.value?.[recentKey(otherProject)]).value;
        assert.ok(same(state[recentKey(project)][0], uri(scenario.aFile).toString()));
        assert.deepEqual(state[recentKey(otherProject)], [uri(otherFile).toString()]);
      }, 'recent-other-project.png');
      return;
    }
    if (phase === 'recent-multiple-roots') {
      const a = load(scenario.aFile), other = load(scenario.otherFile);
      await checkpoint('多根工作区各项目分别显示继续入口、最近记录和自己的阅读进度', async () => {
        assert.equal(vscode.workspace.workspaceFolders.length, 2);
        await continueReading(project, a, scenario.finalStep);
        await continueReading(config.otherProject, other, scenario.otherStep);
        const input = vscode.window.tabGroups.activeTabGroup.activeTab.input;
        assert.ok(input instanceof vscode.TabInputTextDiff);
        assert.ok((await rows('继续上次讲解', project))[0].text.includes(a.title));
        assert.ok((await rows('继续上次讲解', config.otherProject))[0].text.includes(other.title));
        const opening = command('open', uri(scenario.aFile));
        await wait('多根手动选择项目可取消', state => state.text.includes('选择讲解所对应的项目'));
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await opening; await shown(other, scenario.otherStep);
        await closeSourceTabs(); await recordProcess(project, scenario.aFile); await recordProcess(config.otherProject, scenario.otherFile);
      }, 'recent-multiple-projects.png');
      return;
    }
    if (phase === 'recent-restore-final') {
      const a = load(scenario.aFile);
      await checkpoint('返回首项目再重启，主动继续仍恢复原项目步骤，不混入另一项目记录', async () => {
        await continueReading(project, a, scenario.finalStep);
        assert.equal((await rows('另一个项目的讲解', project, '最近打开')).length, 0);
        await closeSourceTabs(); await recordProcess(project, scenario.aFile); assertBaseline();
        const records = JSON.parse(fs.readFileSync(processesFile, 'utf8'));
        assert.equal(new Set(records.map(item => item.desktop)).size, 5);
        assert.equal(new Set(records.map(item => item.userDataDirectory)).size, 1);
        assert.ok(records.every(item => item.databases.some(file => file.size > 0)));
      }, 'recent-final-restored.png');
      return;
    }
    throw new Error(`没有对应的最近讲解检查阶段：${phase}`);
  } finally { await command('stop'); }
};
