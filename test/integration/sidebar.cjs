const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');
const { pause } = require('./renderer.cjs');

exports.verify = async context => {
  const { config, renderer, checkpoint, wait, command, parseExplanation, diskRaw, diskFile, project, shown, stop, activeDiff, assertBaseline } = context;
  const phase = process.env.CODE_EXPLANATION_BACKGROUND_PHASE;
  const treeSelector = '.part.sidebar .monaco-list-row';
  const visible = `element => {const r=element.getBoundingClientRect();return r.width>0&&r.height>0;}`;
  const treeText = () => renderer.evaluate(`document.querySelector('.part.sidebar')?.innerText || ''`);
  async function clickPoint(point) {
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function activity() {
    const point = await renderer.evaluate(`(() => {
      const element=[...document.querySelectorAll('.activitybar [aria-label]')].find(element=>element.getAttribute('aria-label').startsWith('行内代码讲解')&&(${visible})(element));
      if(!element)throw new Error('未找到活动栏讲解图标');const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await clickPoint(point);
    await wait('讲解侧栏已打开', async () => (await treeText()).includes('项目讲解'));
  }
  async function rows(label, contains = '') {
    return renderer.evaluate(`(() => {let group='';return [...document.querySelectorAll(${JSON.stringify(treeSelector)})].map((row,index)=>{const label=row.querySelector('.label-name')?.textContent.trim();if(label==='最近打开'||label==='项目讲解')group=label;return{row,index,label,group};}).filter(item=>(${visible})(item.row)&&item.group==='项目讲解'&&item.label===${JSON.stringify(label)}&&item.row.innerText.includes(${JSON.stringify(contains)})).map(item=>({index:item.index,text:item.row.innerText,expanded:item.row.getAttribute('aria-expanded')}));})()`);
  }
  async function clickRow(label, contains = '', twistie = false) {
    await wait(`侧栏显示“${label}”`, async () => (await rows(label, contains)).length > 0);
    const selected = (await rows(label, contains))[0];
    const point = await renderer.evaluate(`(() => {
      const row=document.querySelectorAll(${JSON.stringify(treeSelector)})[${selected.index}];
      const target=row.querySelector(${JSON.stringify(twistie ? '.monaco-tl-twistie' : '.label-name')});target.scrollIntoView({block:'nearest'});const r=target.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await clickPoint(point);
  }
  async function expand(label, contains = '') {
    if ((await rows(label, contains))[0]?.expanded !== 'true') await clickRow(label, contains, true);
  }
  async function has(text) { return (await treeText()).toLowerCase().includes(text.toLowerCase()); }
  const roots = [];
  const createDirectory = directory => { assert.ok(path.resolve(directory).toLowerCase().startsWith(path.resolve(config.runRoot).toLowerCase()+path.sep)); assert.equal(fs.existsSync(directory), false); fs.mkdirSync(directory, { recursive: true }); roots.push(directory); };
  const settingsFiles = new Map();
  async function directorySetting(folder, value) {
    const settings = path.join(folder, '.vscode', 'settings.json');
    if (!settingsFiles.has(settings)) settingsFiles.set(settings, fs.existsSync(settings) ? fs.readFileSync(settings) : undefined);
    await vscode.workspace.getConfiguration('codeExplanation', vscode.Uri.file(folder)).update('directory', value, vscode.ConfigurationTarget.WorkspaceFolder);
  }
  const build = (raw, id, prefix) => {
    const value = JSON.parse(raw); value.id = id; value.title = '同名项目讲解';
    value.steps.forEach((step, index) => { step.title = `${prefix}步骤 ${index + 1}`; });
    return value;
  };
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const raw = JSON.stringify(value, null, 2)+'\n'; fs.writeFileSync(file, raw); return parseExplanation(raw); };
  try {
    await activity();
    if (phase === 'sidebar-no-project') {
      await checkpoint('无项目侧栏说明先打开文件夹，手动入口不创建阅读', async () => {
        assert.equal(vscode.workspace.workspaceFolders, undefined);
        await wait('无项目提示', () => has('请先打开项目文件夹'));
        await command('open', vscode.Uri.file(diskFile));
        const state = await wait('手动入口无项目提示', state => state.text.includes('请先在 VS Code 中打开项目文件夹'));
        assert.equal(state.comments.length, 0);
      }, 'sidebar-no-project.png');
      return;
    }
    if (phase === 'sidebar-multiple-roots') {
      const otherProject = config.otherProject;
      const otherManifest = JSON.parse(fs.readFileSync(path.join(otherProject, '..', 'manifest.json'), 'utf8'));
      const oneDirectory = path.join(project, '.code-explanations'), twoDirectory = path.join(otherProject, '.code-explanations');
      createDirectory(oneDirectory); createDirectory(twoDirectory);
      const one = write(path.join(oneDirectory, 'one.json'), build(diskRaw, 'sidebar-first-project', '首个项目'));
      const two = write(path.join(twoDirectory, 'two.json'), build(fs.readFileSync(otherManifest.lectures.disk.path, 'utf8'), 'sidebar-second-project', '另一个项目'));
      await checkpoint('多根工作区按项目列出同名讲解，点击步骤使用其所属项目', async () => {
        assert.equal(vscode.workspace.workspaceFolders.length, 2);
        await wait('两个项目目录均完成扫描', async () => (await rows('同名项目讲解')).length === 2);
        await expand('同名项目讲解', 'one.json');
        await clickRow('1. 首个项目步骤 1'); await shown(one, 1);
        assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase().startsWith(project.toLowerCase()));
        await expand('同名项目讲解', 'two.json');
        await clickRow('1. 另一个项目步骤 1'); await shown(two, 1);
        assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase().startsWith(otherProject.toLowerCase()));
      }, 'sidebar-multiple-projects.png');
      await checkpoint('多项目手动打开外部JSON明确选择项目，取消保留原阅读', async () => {
        const opening = command('open', vscode.Uri.file(diskFile));
        await wait('手动打开需要选择项目', state => state.text.includes('选择讲解所对应的项目'));
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); await opening; await shown(two, 1);
        const nextOpening = command('open', vscode.Uri.file(diskFile));
        await wait('手动打开再次选择项目', state => state.text.includes('选择讲解所对应的项目'));
        await renderer.evaluate(`(() => {const input=document.querySelector('.quick-input-widget input');input.value='首个项目';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await wait('首个项目筛选结果', () => renderer.evaluate(`[...document.querySelectorAll('.quick-input-list .monaco-list-row')].filter(${visible}).length===1`));
        await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); await nextOpening;
        await shown(parseExplanation(diskRaw), 1);
        assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.toLowerCase().startsWith(project.toLowerCase()));
      }, 'sidebar-manual-project.png');
      return;
    }
    const directory = path.join(project, '.code-explanations');
    const changedDirectory = path.join(project, 'lecture-files[演示]');
    await checkpoint('活动栏图标打开专用侧栏，缺少默认目录显示实际路径且不创建目录', async () => {
      assert.equal(fs.existsSync(directory), false);
      await wait('默认目录空状态', () => has(directory));
      assert.equal(fs.existsSync(directory), false);
      assert.equal((await renderer.state()).comments.length, 0);
    }, 'sidebar-empty.png');
    createDirectory(directory);
    const aFile = path.join(directory, 'a.json'), bFile = path.join(directory, 'nested', 'b.json');
    const aValue = build(diskRaw, 'sidebar-a', '目录一'), bValue = build(diskRaw, 'sidebar-b', '目录二');
    const a = write(aFile, aValue), b = write(bFile, bValue);
    const invalidFile = path.join(directory, 'broken.json'); fs.writeFileSync(invalidFile, '{"version":');
    await checkpoint('子目录和同名文件均列出，无效JSON显示文件名并保持其他文件可读', async () => {
      await wait('同名讲解及坏文件都出现', async () => (await rows(a.title)).length === 2 && await has('broken.json') && await has('无法读取'));
      const detail = await renderer.evaluate(`(() => {const row=[...document.querySelectorAll(${JSON.stringify(treeSelector)})].find(row=>row.innerText.includes('broken.json'));return row?.innerHTML;})()`);
      assert.ok(detail.includes('broken.json'));
      await expand(a.title, 'a.json'); await wait('展开步骤顺序', () => has(`1. ${a.steps[0].title}`));
      assert.equal((await renderer.state()).comments.length, 0);
      assert.ok(!vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff)));
    }, 'sidebar-expanded.png');
    await checkpoint('点击步骤在真实代码旁阅读，现有上下步同步侧栏，标题恢复保存步骤', async () => {
      await clickRow(`2. ${a.steps[1].title}`); await shown(a, 2);
      await wait('当前步骤显示', async () => (await rows(`2. ${a.steps[1].title}`))[0]?.text.includes('当前步骤'));
      await command('previous'); await shown(a, 1);
      await wait('上一步同步侧栏', async () => (await rows(`1. ${a.steps[0].title}`))[0]?.text.includes('当前步骤'));
      await command('next'); await shown(a, 2);
      await stop(); await clickRow(a.title, 'a.json'); await shown(a, 2);
    }, 'sidebar-file-progress.png');
    const diffIndex = b.steps.findIndex(step => step.kind === 'diff') + 1;
    await checkpoint('跨讲解点击diff步骤，代码比较和侧栏当前步骤一致', async () => {
      await expand(b.title, 'b.json'); await clickRow(`${diffIndex}. ${b.steps[diffIndex - 1].title}`);
      await shown(b, diffIndex); activeDiff();
      await wait('diff当前步骤显示', async () => (await rows(`${diffIndex}. ${b.steps[diffIndex - 1].title}`))[0]?.text.includes('当前步骤'));
    }, 'sidebar-diff-progress.png');
    await checkpoint('新增、修改、删除和恢复其他文件只刷新列表，不抢当前diff', async () => {
      aValue.title = '保存后的目录一'; write(aFile, aValue);
      await wait('其他标题更新', () => has(aValue.title)); await shown(b, diffIndex);
      fs.unlinkSync(aFile); await wait('其他文件删除', async () => !await has(aValue.title)); await shown(b, diffIndex);
      write(aFile, aValue); await wait('其他文件恢复', () => has(aValue.title)); await shown(b, diffIndex);
      fs.writeFileSync(invalidFile, JSON.stringify({ ...aValue, id: 'sidebar-recovered', title: '已修好的讲解' }));
      await wait('无效文件修复', () => has('已修好的讲解')); await shown(b, diffIndex);
    }, 'sidebar-watch.png');
    await checkpoint('旧步骤标识或被替换讲解不能按旧编号打开，失败保留当前阅读', async () => {
      const latest = structuredClone(aValue); latest.steps.shift(); write(aFile, latest);
      await wait('新步骤列表已加载', () => has(latest.title));
      await command('openLocation', vscode.Uri.file(aFile), { project: vscode.Uri.file(project), explanationId: a.id, stepId: a.steps[0].id });
      await shown(b, diffIndex);
      assert.ok((await renderer.state()).text.includes('所选步骤已被删除'));
      latest.id = 'sidebar-a-replaced'; write(aFile, latest);
      await command('openLocation', vscode.Uri.file(aFile), { project: vscode.Uri.file(project), explanationId: a.id });
      await shown(b, diffIndex);
      assert.ok((await renderer.state()).text.includes('讲解标识已更改'));
    });
    createDirectory(changedDirectory);
    const changedFile = path.join(changedDirectory, 'new.json');
    const changedValue = build(diskRaw, 'sidebar-directory-changed', '新目录'); changedValue.title = '改过目录的讲解';
    const changed = write(changedFile, changedValue);
    await checkpoint('项目目录设置立即重读，新旧目录更新均不切换当前阅读', async () => {
      await directorySetting(project, 'lecture-files[演示]');
      await wait('新目录讲解显示旧目录讲解离开', async () => (await rows(changed.title)).length===1 && (await rows(b.title)).length===0); await shown(b, diffIndex);
      const old = { ...aValue, title: '旧目录不再列出' }; write(aFile, old);
      await pause(250); assert.equal((await rows(old.title)).length, 0); await shown(b, diffIndex);
      fs.rmSync(changedDirectory, { recursive: true });
      await wait('新讲解根目录删除显示空状态', async () => await has(changedDirectory) && await has('尚不存在')); await shown(b, diffIndex);
      write(changedFile, changedValue);
      await wait('新讲解根目录恢复后重新列出', () => has(changed.title)); await shown(b, diffIndex);
      await expand(changed.title); await clickRow(`1. ${changed.steps[0].title}`); await shown(changed, 1);
    }, 'sidebar-directory-setting.png');
    await checkpoint('配置位置实际不是目录时显示读取错误，恢复目录设置后仍可继续', async () => {
      const notDirectory=path.join(project,'not-a-directory'); assert.equal(fs.existsSync(notDirectory),false);
      fs.writeFileSync(notDirectory,'这里是文件，不能作为讲解目录读取。'); roots.push(notDirectory);
      await directorySetting(project,'not-a-directory');
      await wait('目录读取失败说明实际路径',async()=>await has('无法读取讲解目录')&&await has(notDirectory));
      await shown(changed,1); await directorySetting(project,'lecture-files[演示]');
      await wait('恢复后项目讲解重新出现',async()=>(await rows(changed.title)).length===1); await shown(changed,1);
    },'sidebar-directory-unreadable.png');
    await checkpoint('停止保留侧栏和代码页，目录外手动打开仍使用原阅读入口', async () => {
      const before = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff).length;
      await stop(); assert.ok(await has(changed.title));
      assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputTextDiff).length, before);
      await command('open', vscode.Uri.file(diskFile)); await shown(parseExplanation(diskRaw), 1);
      await stop();
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
      await wait('浅色主题图标及侧栏可读', () => renderer.evaluate(`document.querySelector('.monaco-workbench').classList.contains('vs')`));
    }, 'sidebar-light.png');
  } finally {
    await command('stop');
    for (const [settings, bytes] of settingsFiles) {
      if (bytes) fs.writeFileSync(settings, bytes); else {
        fs.rmSync(settings, { force: true });
        const parent = path.dirname(settings); if (fs.existsSync(parent) && !fs.readdirSync(parent).length) fs.rmdirSync(parent);
      }
    }
    for (const directory of roots.reverse()) {
      assert.ok(path.resolve(directory).toLowerCase().startsWith(path.resolve(config.runRoot).toLowerCase()+path.sep));
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    assertBaseline();
  }
};
