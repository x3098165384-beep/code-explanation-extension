const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const hljs = require('highlight.js/lib/common');
const { pause } = require('./renderer.cjs');
const normalize = text => text.replace(/\r\n?/g, '\n');
const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function browserConnection(config) {
  const version = await (await fetch(`http://127.0.0.1:${config.port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const data = JSON.parse(event.data); const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer); data.error ? request.reject(new Error(data.error.message)) : request.resolve(data.result); });
  return { call(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`独立页面协议超时：${method}`)); }, 10000);
    pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id:key, method, params, ...(sessionId ? { sessionId } : {}) })); }); },
    close() { socket.close(); } };
}

exports.verify = async ({ config, renderer, checkpoint, wait, command, disk, diskFile }) => {
  const isolation = JSON.parse(fs.readFileSync(path.join(config.runRoot, 'copy-expected-isolation.json'), 'utf8').replace(/^\uFEFF/, ''));
  const probe = (operation, ...args) => JSON.parse(execFileSync(path.join(config.runRoot, 'ClipboardProbe.exe'), [isolation.station, operation, ...args.map(String)], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''));
  const identity = probe('identity');
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  assert.equal(identity.station, isolation.station); assert.equal(identity.desktop, isolation.desktop);
  const stationRecord = { ...isolation, helper: identity, clipboardWritten: false,
    extensionHost: { processId: process.pid, desktops: probe('process', process.pid) },
    main: { processId: isolation.mainProcessId, desktops: probe('process', isolation.mainProcessId) } };
  assert.ok(stationRecord.extensionHost.desktops.includes(identity.desktop));
  assert.ok(stationRecord.main.desktops.includes(identity.desktop));
  fs.writeFileSync(path.join(config.runRoot, 'copy-station.json'), JSON.stringify(stationRecord, null, 2));
  await checkpoint('复制前确认主进程、扩展及读取进程属于非交互测试环境', async () => { assert.equal(identity.station, isolation.station); });
  await renderer.protocol('Emulation.setFocusEmulationEnabled', { enabled: true });
  const records = [];
  const project = path.join(config.fixture, 'project');
  const manifest = JSON.parse(fs.readFileSync(path.join(config.fixture, 'manifest.json'), 'utf8'));
  const gitEnvironment = { ...process.env };
  for (const name of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete gitEnvironment[name];
  const baseline = () => ({
    head: execFileSync('git',['--no-optional-locks','-C',project,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true,env:gitEnvironment}).trim(),
    status: execFileSync('git',['--no-optional-locks','-C',project,'status','--porcelain=v1'],{encoding:'utf8',windowsHide:true,env:gitEnvironment}),
    index: execFileSync('git',['--no-optional-locks','-C',project,'ls-files','--stage'],{encoding:'utf8',windowsHide:true,env:gitEnvironment}),
    files: Object.fromEntries([...Object.keys(manifest.baseline.disk),'src/copy-proof.cs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(project,file))).digest('hex')]))
  });
  const saveCopies = () => fs.writeFileSync(path.join(config.runRoot, 'copy-results.json'), JSON.stringify(records, null, 2));
  const controller = vscode.comments.createCommentController('copy-proof', '行内文字复制验证');
  const copyCommand = 'codeExplanation.copyProofBlock';
  let thread, active, decoration, light = false, bodyTarget, bodyOffset, browser, panel, forbiddenExecuted = false;
  const callbacks = [vscode.commands.registerCommand(copyCommand, async token => {
    if (!active || active.token !== token) return false;
    await vscode.env.clipboard.writeText(active.code); return true;
  })];
  callbacks.push(vscode.commands.registerCommand('codeExplanation.copyProofForbidden', () => { forbiddenExecuted = true; }));
  function clear() {
    active = undefined; thread?.dispose(); thread = undefined; decoration?.dispose(); decoration = undefined;
  }
  function makeMarkdown(code, title, native = false) {
    const token = randomUUID(); active = { token, code };
    const link = `[复制这段代码](command:${copyCommand}?${encodeURIComponent(JSON.stringify([token]))})`;
    const colors = light ? { keyword: '#0000ff', string: '#a31515', number: '#098658', comment: '#008000', title: '#795e26' }
      : { keyword: '#569cd6', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', title: '#dcdcaa' };
    const highlight = hljs.highlight(code, { language: 'csharp', ignoreIllegals: true }).value.replace(/<span class="([^"]+)">/g, (_span, classes) => {
      const type = /hljs-([a-z]+)/.exec(classes)?.[1];
      return `<span style="color:${colors[type] || (light ? '#24292f' : '#d4d4d4')};">`;
    });
    const markup = native ? '> ```csharp\n' + code.split('\n').map(line => '> ' + line).join('\n') + '\n> ```'
      : `<blockquote><pre><code>${highlight.replace(/\t/g, '&#9;').replace(/\n/g, '&#10;')}</code></pre></blockquote>`;
    const md = new vscode.MarkdownString(`## ${title}\n\n${markup}\n\n${link}\n\n用变量 action 保存当前动作。有路径但准备失败，就返回 false。\n\n[正文中的其他命令](command:codeExplanation.copyProofForbidden)`);
    md.supportHtml = true; md.isTrusted = { enabledCommands: [copyCommand] }; return md;
  }
  async function show(document, range, code, title, native = false) {
    clear();
    thread = controller.createCommentThread(document.uri, range, [{ body: makeMarkdown(code, title, native), mode: vscode.CommentMode.Preview, author: { name: '行内文字复制验证' } }]);
    thread.canReply = false; thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === document.uri.toString())?.revealRange(new vscode.Range(range.end, range.end), vscode.TextEditorRevealType.AtTop);
    await wait(title, state => state.comments.length === 1 && state.comments[0].text.includes(title)); return active.token;
  }
  const selector = '.review-widget blockquote code, .review-widget .monaco-tokenized-source';
  async function drag(start, end) {
    const evaluate = bodyTarget ? bodyTarget.evaluate : renderer.evaluate;
    const area = await evaluate(`(() => {
      const doc = ${'${body}'};
      const code = doc.querySelector(${JSON.stringify(selector)}); if (!code) throw new Error('未找到当前代码文字');
      const nodes = []; let offset = 0;
      function visit(node) { if (node.nodeType === Node.TEXT_NODE) { nodes.push({ node, start: offset, end: offset + node.nodeValue.length }); offset += node.nodeValue.length; }
        else if (node.nodeName === 'BR') offset++; else for (const child of node.childNodes) visit(child); }
      visit(code);
      const point = (index, last) => { const found = nodes.find(item => index >= item.start && index < item.end); if (!found) throw new Error('无法量取字符位置 ' + index);
        const range = code.ownerDocument.createRange(); range.setStart(found.node, index - found.start); range.setEnd(found.node, index - found.start + 1); const r = range.getBoundingClientRect();
        return { x: last ? r.right - 0.2 : r.left + 0.2, y: r.top + r.height / 2 }; };
      return { start: point(${start}, false), end: point(${end - 1}, true) };
    })()`.replace('${body}', bodyTarget ? 'document.getElementById("active-frame").contentDocument' : 'document'));
    if (bodyOffset) for (const point of [area.start, area.end]) { point.x += bodyOffset.x; point.y += bodyOffset.y; }
    // 用真实点击先收起上一次选区，避免从已选文字上开始时变成拖动文字。
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...area.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...area.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...area.start, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step++) await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseMoved', x: area.start.x + (area.end.x - area.start.x) * step / 12, y: area.start.y + (area.end.y - area.start.y) * step / 12, button: 'left', buttons: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...area.end, button: 'left', clickCount: 1 });
    return evaluate(bodyTarget ? 'document.getElementById("active-frame").contentWindow.getSelection().toString()' : 'window.getSelection().toString()');
  }
  async function resetClipboard() {
    const sentinel = `copy-proof-before-${randomUUID()}`; await vscode.env.clipboard.writeText(sentinel);
    const before = probe('read'); assert.equal(before.text, sentinel); assert.equal(before.ownerProcessId, isolation.mainProcessId); assert.equal(before.ownerThreadDesktop, identity.desktop); stationRecord.clipboardWritten = true;
    fs.writeFileSync(path.join(config.runRoot, 'copy-station.json'), JSON.stringify(stationRecord, null, 2)); return before;
  }
  async function copySelection(name, code, start, end, strict = true) {
    const before = await resetClipboard(); const selected = await drag(start, end);
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await pause(120); const result = probe('read'); const actual = await vscode.env.clipboard.readText(); const expected = code.slice(start, end);
    const record = { name, method: 'CDP pointer drag and Ctrl+C', expected, selected, actual, native: result, beforeSequence: before.sequence,
      passed: normalize(actual) === expected && normalize(result.text) === expected && normalize(selected) === expected && result.sequence !== before.sequence && result.ownerProcessId === isolation.mainProcessId && result.ownerThreadDesktop === identity.desktop };
    records.push(record); saveCopies(); if (strict) assert.equal(record.passed, true, JSON.stringify(record)); return record;
  }
  async function wholeCopy(name, code) {
    const before = await resetClipboard();
    const point = await renderer.evaluate(`(() => {
      const a = [...document.querySelectorAll('.review-widget a')].find(a => a.textContent === '复制这段代码');
      if (!a) throw new Error('未找到整块复制入口'); const r = a.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 };
    })()`);
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await pause(200); const result = probe('read'); const actual = await vscode.env.clipboard.readText();
    records.push({ name, method: 'Click restricted block copy link', expected: code, actual, native: result, passed: normalize(actual) === code && normalize(result.text) === code && before.sequence !== result.sequence }); saveCopies();
    assert.equal(normalize(actual), code); assert.equal(normalize(result.text), code); assert.notEqual(before.sequence, result.sequence); assert.equal(result.ownerProcessId,isolation.mainProcessId); assert.equal(result.ownerThreadDesktop,identity.desktop);
  }
  async function stale(token) {
    const before = probe('read'); assert.equal(await vscode.commands.executeCommand(copyCommand, token), false);
    const after = probe('read'); assert.equal(after.sequence, before.sequence); assert.equal(after.text, before.text);
  }
  try {
    const code = 'var action = actions[_step];\n\tvar label = "C:\\temp\\中文";\n\nif (_hasPath && !PreparePath(action)) return false;\n// ' + 'longLine'.repeat(24);
    const file = path.join(config.fixture, 'project', 'src', 'copy-proof.cs'); fs.writeFileSync(file, code + '\n');
    const beforeBaseline = baseline();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const sourceBefore = document.getText(), dirtyBefore = document.isDirty; await vscode.window.showTextDocument(document);
    await show(document, new vscode.Range(0, 0, 0, 0), code, '核对原生代码块的 Tab', true);
    const nativeText = normalize(await renderer.evaluate(`document.querySelector('.review-widget .monaco-tokenized-source').innerText`));
    const nativeTab = await copySelection('原生围栏代码 Tab 调查（不是最终方案）', nativeText, 0, nativeText.indexOf('\n\n'), false);
    nativeTab.sourceExpected = code.slice(0, code.indexOf('\n\n'));
    nativeTab.sourcePreserved = normalize(nativeTab.actual) === nativeTab.sourceExpected;
    nativeTab.diagnostic = true; nativeTab.accepted = false;
    records.pop(); saveCopies();
    fs.writeFileSync(path.join(config.runRoot, 'native-code-tab.json'), JSON.stringify(nativeTab, null, 2)); await renderer.screenshot('copy-native-tab.png'); clear();
    await checkpoint('普通行内代码真实拖选保留字符、跨行及 Tab，整块复制来自当前正文', async () => {
      await show(document, new vscode.Range(0, 0, 0, 0), code, '普通代码：选择部分或整块复制');
      await copySelection('普通代码部分字符', code, 4, 10);
      await copySelection('普通代码跨行含 Tab 和中文路径', code, 0, code.indexOf('\n\n'));
      await copySelection('普通代码跨空行', code, 0, code.indexOf('\n//'));
      await renderer.screenshot('copy-file-selected.png'); await wholeCopy('普通代码整块及长行', code);
      const safety = await renderer.evaluate(`(() => { const q=document.querySelector('.review-widget blockquote');const c=q.querySelector('code');return {background:getComputedStyle(q).backgroundColor,spans:c.querySelectorAll('span').length,images:q.querySelectorAll('img').length};})()`);
      assert.notEqual(safety.background, 'rgba(0, 0, 0, 0)'); assert.ok(safety.spans > 1); assert.equal(safety.images, 0);
      assert.equal(document.getText(), sourceBefore); assert.equal(document.isDirty, dirtyBefore);
    }, 'copy-file-dark.png');
    await checkpoint('受控复制入口不授予正文中其他命令执行权限', async () => {
      const point = await renderer.evaluate(`(() => {const a=[...document.querySelectorAll('.review-widget a')].find(a=>a.textContent==='正文中的其他命令');const r=a.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await renderer.protocol('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await renderer.protocol('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await pause(100);
      assert.equal(forbiddenExecuted,false);
    });
    await checkpoint('浅色主题保留文字选择，重建后旧复制入口失效', async () => {
      const previous = active.token; light = true; await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
      await show(document, new vscode.Range(0, 0, 0, 0), code, '浅色代码：保留文字和复制'); await stale(previous);
      await copySelection('浅色行内部分代码', code, 4, 10); await wholeCopy('浅色行内整块代码', code);
    }, 'copy-file-light.png');
    light = false; await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    for (const [index, label] of [[3, '删除行'], [4, '新增行'], [5, '双侧目标']]) {
      await checkpoint(`${label}在实际 diff 正确一侧显示文字并可选择、整块复制`, async () => {
        clear(); await command('open', vscode.Uri.file(diskFile));
        const opened = await wait('演示讲解打开', state => state.comments.length === 1 && !state.status.includes('正在读取'));
        let current = Number(/(\d+)\/\d+：/.exec(opened.status)?.[1]);
        while (current !== index) { await command(current < index ? 'next' : 'previous'); current += current < index ? 1 : -1; }
        await wait('实际 diff 加载', state => state.comments.length === 1 && !state.status.includes('正在读取'));
        const input = vscode.window.tabGroups.activeTabGroup.activeTab.input; assert.ok(input instanceof vscode.TabInputTextDiff);
        const step = disk.steps[index - 1]; const documents = { left: await vscode.workspace.openTextDocument(input.original), right: await vscode.workspace.openTextDocument(input.modified) };
        const side = step.targets.right ? 'right' : 'left', target = step.targets[side];
        const snippet = normalize(documents[side].getText()).split('\n').slice(target.startLine - 1, target.endLine).join('\n'); await command('stop');
        const range = value => new vscode.Range(value.startLine - 1, 0, value.endLine - 1, 500);
        await show(documents[side], range(target), snippet, `${label}：对照真实代码`);
        decoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'), border: '1px solid', borderColor: new vscode.ThemeColor('editor.findMatchBorder') });
        for (const [which, value] of Object.entries(step.targets)) vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === documents[which].uri.toString())?.setDecorations(decoration, [range(value)]);
        const state = await wait('文字位于正确比较侧且范围已绘制', state => state.comments.length === 1 && state.comments[0].side === side && (index !== 5 || state.highlights.some(h => h.side === 'left') && state.highlights.some(h => h.side === 'right')));
        if (index === 5) { assert.ok(state.highlights.some(h => h.side === 'left')); assert.ok(state.highlights.some(h => h.side === 'right')); }
        assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
        await copySelection(`${label}局部选择`, snippet, 0, Math.min(6, snippet.indexOf('\n') < 0 ? snippet.length : snippet.indexOf('\n'))); await wholeCopy(`${label}整块复制`, snippet);
        if (index === 5) {
          await renderer.protocol('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false }); await pause(150);
          await copySelection('窄 diff 选择', snippet, 0, 6); await wholeCopy('窄 diff 整块', snippet); await renderer.screenshot('copy-diff-narrow.png');
          await renderer.protocol('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
        }
      }, `copy-diff-${index}.png`);
    }
    await checkpoint('切换、更新、替换和停止后旧复制入口不读取错误代码', async () => {
      const old = active.token; await vscode.window.showTextDocument(document); await show(document, new vscode.Range(0, 0, 0, 0), 'return false;', '更新后的步骤'); await stale(old);
      const changed = active.token; clear(); await stale(changed); await wait('停止移除正文及范围', state => state.comments.length === 0 && state.highlights.length === 0);
      assert.equal(document.getText(), sourceBefore); assert.equal(document.isDirty, dirtyBefore);
    });
    await checkpoint('最小排版正文页可拖选原文并通过独立入口复制整块', async () => {
      browser = await browserConnection(config);
      const processes = await browser.call('SystemInfo.getProcessInfo');
      stationRecord.renderers = processes.processInfo.filter(item => item.type === 'renderer').map(item => ({ processId:item.id, ...probe('process-info', item.id) }));
      fs.writeFileSync(path.join(config.runRoot, 'copy-station.json'), JSON.stringify(stationRecord,null,2));
      assert.ok(stationRecord.renderers.length);
      for (const item of stationRecord.renderers) {
        item.desktopInspection = item.desktops.length ? '已观察到线程桌面' : '无法从沙箱渲染进程读取线程桌面名称';
        if (item.desktops.length) assert.ok(item.desktops.includes(identity.desktop), JSON.stringify(item));
      }
      stationRecord.clipboardEvidence = '复制由本轮主进程处理；扩展接口与本轮窗口站的 Win32 CF_UNICODETEXT 实际结果逐项相同。未将不可读取的渲染线程名称宣称为已确认。';
      fs.writeFileSync(path.join(config.runRoot, 'copy-station.json'), JSON.stringify(stationRecord,null,2));
      panel = vscode.window.createWebviewPanel('copyProofBody', '完整讲解正文验证', vscode.ViewColumn.Active, { enableScripts:true });
      const token = randomUUID(); active = { token, code }; const nonce = randomUUID();
      callbacks.push(panel.webview.onDidReceiveMessage(async message => { if (message.type === 'copy' && active?.token === message.token) await vscode.commands.executeCommand(copyCommand, message.token); }));
      panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>body{color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:24px}blockquote{background:var(--vscode-textCodeBlock-background);padding:16px;margin:0}pre{white-space:pre;overflow:auto;font:14px Consolas,monospace}button{margin-top:12px}</style></head><body id="copy-proof-body" data-run="${config.runName}"><h1>排版后的完整讲解</h1><h2>当前步骤：直接翻译代码</h2><div class="review-widget"><blockquote><pre><code>${escape(code)}</code></pre></blockquote><button id="copy">复制这段代码</button></div><p>用变量 action 保存当前动作。</p><script nonce="${nonce}">const api=acquireVsCodeApi();document.getElementById('copy').onclick=()=>api.postMessage({type:'copy',token:${JSON.stringify(token)}});</script></body></html>`;
      const deadline = Date.now() + 15000;
      while (!bodyTarget && Date.now() < deadline) {
        const { targetInfos } = await browser.call('Target.getTargets');
        for (const info of targetInfos.filter(info => info.type === 'iframe' && info.url.startsWith('vscode-webview:'))) {
          const { sessionId } = await browser.call('Target.attachToTarget', { targetId:info.targetId, flatten:true });
          const evaluate = async expression => { const result = await browser.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId); if(result.exceptionDetails)throw new Error(result.exceptionDetails.text); return result.result.value; };
          const marker = await evaluate(`document.getElementById('active-frame')?.contentDocument?.getElementById('copy-proof-body')?.dataset.run`);
          if (marker === config.runName) { bodyTarget = { evaluate, sessionId, info }; break; }
          await browser.call('Target.detachFromTarget', { sessionId });
        }
        if (!bodyTarget) await pause(100);
      }
      if (!bodyTarget) { fs.writeFileSync(path.join(config.runRoot,'body-targets.json'),JSON.stringify(await browser.call('Target.getTargets'),null,2)); throw new Error('未找到本轮正文内部页面'); }
      const frameId = await bodyTarget.evaluate(`new URL(location.href).searchParams.get('id')`);
      const outer = await renderer.evaluate(`(() => { const frame=[...document.querySelectorAll('iframe.webview')].find(frame=>frame.name===${JSON.stringify(frameId)});if(!frame)throw new Error('正文外层位置缺失');const r=frame.getBoundingClientRect();return {x:r.left,y:r.top};})()`);
      const inner = await bodyTarget.evaluate(`(() => {const r=document.getElementById('active-frame').getBoundingClientRect();return {x:r.left,y:r.top};})()`);
      bodyOffset = { x:outer.x+inner.x,y:outer.y+inner.y };
      await copySelection('正文页局部代码',code,4,10); await copySelection('正文页跨行保留Tab',code,0,code.indexOf('\n\n'));
      await renderer.screenshot('copy-body-selected.png');
      const before = await resetClipboard(); const point = await bodyTarget.evaluate(`(() => { const r=document.getElementById('active-frame').contentDocument.getElementById('copy').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      point.x += bodyOffset.x; point.y += bodyOffset.y;
      await renderer.protocol('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1}); await renderer.protocol('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1}); await pause(200);
      const result=probe('read');assert.equal(normalize(result.text),code);assert.notEqual(result.sequence,before.sequence);
      assert.equal(result.ownerProcessId,isolation.mainProcessId);assert.equal(result.ownerThreadDesktop,identity.desktop);
      records.push({name:'正文页整块复制',method:'Click webview copy button',expected:code,actual:result.text,native:result,passed:true});saveCopies();
      await renderer.screenshot('copy-body.png');
      const old = active.token; panel.dispose(); panel=undefined; clear(); await stale(old); bodyTarget=undefined; bodyOffset=undefined;
    });
    const afterBaseline = baseline(); assert.deepEqual(afterBaseline,beforeBaseline);
    fs.writeFileSync(path.join(config.runRoot,'copy-source-unchanged.json'),JSON.stringify({before:beforeBaseline,after:afterBaseline,unchanged:true},null,2));
  } finally { clear(); panel?.dispose(); browser?.close(); controller.dispose(); callbacks.forEach(item => item.dispose()); }
};
