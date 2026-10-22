const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { pause } = require('./renderer.cjs');

async function browserConnection(config) {
  const version = await (await fetch(`http://127.0.0.1:${config.port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data), request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id); clearTimeout(request.timer);
    value.error ? request.reject(new Error(value.error.message)) : request.resolve(value.result);
  });
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => { pending.delete(key); reject(new Error(`正文读取超时：${method}`)); }, 10000);
        pending.set(key, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); },
  };
}

exports.verify = async context => {
  const { config, renderer, checkpoint, wait, command, parseExplanation, normalizeText, diskFile, diskRaw,
    project, open, go, shown, stop, edit, assertBaseline } = context;
  const isolation = JSON.parse(fs.readFileSync(path.join(config.runRoot, 'copy-expected-isolation.json'), 'utf8').replace(/^\uFEFF/, ''));
  const probe = (operation, ...args) => JSON.parse(execFileSync(path.join(config.runRoot, 'ClipboardProbe.exe'),
    [isolation.station, operation, ...args.map(String)], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''));
  const identity = probe('identity');
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  assert.equal(identity.station, isolation.station); assert.equal(identity.desktop, isolation.desktop);
  fs.writeFileSync(path.join(config.runRoot, 'body-copy-isolation.json'), JSON.stringify({ identity, expected: isolation }, null, 2));
  await renderer.protocol('Emulation.setFocusEmulationEnabled', { enabled: true });
  const browser = await browserConnection(config), records = [];
  const saveCopies = () => fs.writeFileSync(path.join(config.runRoot, 'body-copy-results.json'), JSON.stringify(records, null, 2));
  const value = JSON.parse(diskRaw);
  value.id = randomUUID(); value.title = '完整讲解：代码和翻译分开阅读';
  value.description = '这是完整简介。\n\n- 按步骤阅读\n- 选择或复制代码\n\n<script>window.authorExecuted=true</script>\n\n[作者命令](command:codeExplanation.bodyForbidden)';
  const code = 'var action = actions[_step];\n\tvar label = "C:\\temp\\中文";\n\nif (_hasPath && !PreparePath(action)) return false;\n';
  for (const step of value.steps) step.body = `\`\`\`csharp\n${code}\`\`\`\n\n用变量 action 保存当前动作。\n\n如果配置了路径，但无法准备路径，返回 false。`;
  let lecture, target;
  const write = object => {
    const raw = JSON.stringify(object, null, 2) + '\n';
    fs.writeFileSync(diskFile, raw); return parseExplanation(raw);
  };
  const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
    tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('codeExplanation.body'));
  const evaluate = async expression => {
    const result = await browser.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, target.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const body = expression => evaluate(`(() => {const doc=document.getElementById('active-frame')?.contentDocument;if(!doc)return null;return (${expression});})()`);
  async function findBody() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const { targetInfos } = await browser.call('Target.getTargets');
      for (const info of targetInfos.filter(info => info.type === 'iframe' && info.url.startsWith('vscode-webview:'))) {
        const { sessionId } = await browser.call('Target.attachToTarget', { targetId: info.targetId, flatten: true });
        target = { sessionId, info };
        const id = await body(`doc.getElementById('explanation-body')?.dataset.explanationId`);
        if (id === lecture.id) return;
        await browser.call('Target.detachFromTarget', { sessionId }); target = undefined;
      }
      await pause(100);
    }
    throw new Error('未找到本轮正式讲解正文页。');
  }
  async function bodyWait(name, check) {
    await wait(name, async () => {
      try { return !!target && await check(); } catch { return false; }
    });
  }
  async function current(id) {
    await bodyWait('正文已定位当前步骤', async () => await body(`doc.querySelector('[data-current-step]')?.dataset.stepId`) === id);
  }
  async function offsets() {
    const id = await evaluate(`new URL(location.href).searchParams.get('id')`);
    const outer = await renderer.evaluate(`(() => {const f=[...document.querySelectorAll('iframe.webview')].find(f=>f.name===${JSON.stringify(id)});if(!f)throw new Error('正文外层未显示');const r=f.getBoundingClientRect();return{x:r.left,y:r.top};})()`);
    const inner = await evaluate(`(() => {const r=document.getElementById('active-frame').getBoundingClientRect();return{x:r.left,y:r.top};})()`);
    return { x: outer.x + inner.x, y: outer.y + inner.y };
  }
  async function click(point) {
    const offset = await offsets(); point = { x: point.x + offset.x, y: point.y + offset.y };
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function beforeCopy() {
    const sentinel = `body-before-${randomUUID()}`; await vscode.env.clipboard.writeText(sentinel);
    const before = probe('read'); assert.equal(before.text, sentinel);
    assert.equal(before.ownerProcessId, isolation.mainProcessId); assert.equal(before.ownerThreadDesktop, identity.desktop);
    return before;
  }
  async function result(name, expected, before, selected) {
    const native = probe('read'), actual = await vscode.env.clipboard.readText();
    const record = { name, expected, selected, actual, native, beforeSequence: before.sequence,
      passed: normalizeText(actual) === expected && normalizeText(native.text) === expected && native.sequence !== before.sequence &&
        native.ownerProcessId === isolation.mainProcessId && native.ownerThreadDesktop === identity.desktop &&
        (selected === undefined || normalizeText(selected) === expected) };
    records.push(record); saveCopies(); assert.equal(record.passed, true, JSON.stringify(record));
  }
  async function selectCopy(name, start, end) {
    await body(`(()=>{const c=doc.querySelector('[data-current-step] code');c.scrollIntoView({block:'center'});return true;})()`);
    await pause(80);
    const points = await body(`(()=>{const c=doc.querySelector('[data-current-step] code'),nodes=[];let offset=0;const visit=n=>{if(n.nodeType===3){nodes.push({node:n,start:offset,end:offset+n.nodeValue.length});offset+=n.nodeValue.length;}else for(const child of n.childNodes)visit(child);};visit(c);const point=(i,last)=>{const n=nodes.find(n=>i>=n.start&&i<n.end);if(!n)throw new Error('无法量取代码字符');const range=doc.createRange();range.setStart(n.node,i-n.start);range.setEnd(n.node,i-n.start+1);const r=range.getBoundingClientRect();return{x:last?r.right-.2:r.left+.2,y:r.top+r.height/2};};return{start:point(${start},false),end:point(${end - 1},true)};})()`);
    const offset = await offsets();
    for (const point of [points.start, points.end]) { point.x += offset.x; point.y += offset.y; }
    const before = await beforeCopy();
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1,
      x: points.start.x + (points.end.x - points.start.x) * i / 12, y: points.start.y + (points.end.y - points.start.y) * i / 12 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', clickCount: 1 });
    const selected = await evaluate(`document.getElementById('active-frame').contentWindow.getSelection().toString()`);
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await pause(120); await result(name, code.slice(start, end), before, selected);
  }
  async function linkPoint(selector) {
    return body(`(()=>{const a=doc.querySelector(${JSON.stringify(selector)});if(!a)throw new Error('未找到复制入口');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,href:a.getAttribute('href')};})()`);
  }
  async function wholeCopy(name, expected = code) {
    const before = await beforeCopy(), point = await linkPoint('[data-current-step] a[href^="#copy-"]');
    await click(point); await pause(160); await result(name, expected, before); return point.href;
  }
  let forbidden = 0;
  const forbiddenCommand = vscode.commands.registerCommand('codeExplanation.bodyForbidden', () => forbidden++);
  let sourcePath, sourceText;
  try {
    lecture = write(value);
    await checkpoint('正式完整正文显示标题简介全部步骤，并按稳定标识定位当前步骤', async () => {
      await open(diskFile, lecture); await go(lecture, 2); await command('body'); await findBody(); await current(lecture.steps[1].id);
      assert.equal(tabs().length, 1);
      const state = await body(`({title:doc.querySelector('h1').textContent,sections:doc.querySelectorAll('section').length,list:doc.querySelectorAll('.description li').length,code:doc.querySelector('[data-current-step] code').textContent,raw:doc.body.innerText,html:doc.body.innerHTML,top:doc.querySelector('[data-current-step]').getBoundingClientRect().top})`);
      assert.equal(state.title, value.title); assert.equal(state.sections, value.steps.length); assert.equal(state.list, 2); assert.equal(state.code, code);
      assert.ok(state.top >= 0 && state.top < 300, JSON.stringify(state));
      assert.doesNotMatch(state.raw, /"sources"|"targets"|\\n/); assert.ok(state.raw.includes('<script>window.authorExecuted=true</script>'));
      assert.equal(await body(`[...doc.querySelectorAll('script')].some(script=>script.textContent.includes('authorExecuted'))`), false);
      assert.equal(await body(`doc.defaultView.authorExecuted===undefined`), true);
      assert.equal(await body(`!!doc.querySelector('a[href^="command:"]')`), false); assert.equal(forbidden, 0);
      await body(`(()=>{doc.defaultView.scrollTo(0,0);return true;})()`);
      await renderer.screenshot('body-overview.png');
      await body(`(()=>{doc.querySelector('[data-current-step]').scrollIntoView({block:'start'});return true;})()`);
    }, 'body-complete.png');
    let oldLink;
    await checkpoint('正文实际拖选、普通复制和整块复制保留字符、Tab与空行', async () => {
      await selectCopy('正文局部代码', 4, 10);
      await selectCopy('正文跨行Tab和中文路径', 0, code.indexOf('\n\n'));
      await selectCopy('正文跨空行代码', 0, code.trimEnd().length);
      oldLink = await wholeCopy('正文整块代码包括末尾换行');
    }, 'body-copied.png');
    await checkpoint('保存和重排更新同一正文页，保持当前步骤且不夺取代码焦点', async () => {
      const originalTab = tabs()[0];
      await go(lecture, 1); await current(lecture.steps[0].id);
      const changed = structuredClone(value); changed.steps[0].body += '\n\n正文已经保存更新。';
      changed.steps = [...changed.steps.slice(1), changed.steps[0]]; lecture = write(changed);
      await shown(lecture, lecture.steps.length); await current(value.steps[0].id);
      await bodyWait('保存后正文更新', async () => await body(`doc.body.innerText.includes('正文已经保存更新。')`));
      assert.equal(tabs()[0], originalTab); assert.ok(vscode.window.activeTextEditor);
      await command('body'); await wholeCopy('保存重排后的整块代码');
      const obsolete = structuredClone(changed); obsolete.steps.at(-1).body += `\n\n[旧的复制入口](${oldLink})`;
      lecture = write(obsolete); await shown(lecture, lecture.steps.length); await current(value.steps[0].id);
      await bodyWait('保存后的正文包含原先入口', async () => await body(`!!doc.querySelector('[data-current-step] a[href="${oldLink}"]')`));
      await command('body');
      const before = await beforeCopy();
      await click(await linkPoint(`[data-current-step] a[href="${oldLink}"]`)); await pause(160);
      assert.equal(probe('read').sequence, before.sequence); assert.equal(probe('read').text, before.text);
    }, 'body-updated.png');
    await checkpoint('无效JSON和暂时读不到文件保留完整旧正文，修复后移除旧内容标识', async () => {
      const valid = JSON.stringify(value, null, 2); lecture = write(value); await shown(lecture, 1); await current(value.steps[0].id);
      fs.writeFileSync(diskFile, '{"title":"不能接受的新标题",');
      await wait('无效JSON保留原讲解', state => state.status.includes('新讲解尚未加载'));
      await bodyWait('明确标记旧正文', async () => await body(`doc.body.innerText.includes('上一次成功加载的讲解')`));
      await bodyWait('文件错误只显示一次', async () => await body(`doc.getElementById('step-notice').textContent`) === '');
      assert.equal(await body(`doc.body.innerText.includes('不能接受的新标题')`), false);
      await body(`(()=>{doc.defaultView.scrollTo(0,0);return true;})()`);
      await renderer.screenshot('body-stale.png');
      lecture = write(value); await shown(lecture, 1);
      await bodyWait('修复后移除旧内容标识', async () => !await body(`doc.body.innerText.includes('上一次成功加载的讲解')`));
      fs.unlinkSync(diskFile);
      await wait('暂时读不到JSON', state => state.status.includes('新讲解尚未加载'));
      await bodyWait('缺失文件仍保留旧正文', async () => await body(`doc.body.innerText.includes('上一次成功加载的讲解')`));
      fs.writeFileSync(diskFile, valid); await shown(lecture, 1);
      await bodyWait('文件恢复后正常正文', async () => !await body(`doc.body.innerText.includes('上一次成功加载的讲解')`));
    }, 'body-json-recovered.png');
    await checkpoint('代码失效移除行内范围并说明原因，正文可复制，修复恢复行内阅读', async () => {
      sourcePath = lecture.sources[lecture.steps[0].source].path;
      sourceText = fs.readFileSync(path.join(project, sourcePath), 'utf8');
      await edit(sourcePath, sourceText.replace('calculateCharge(unitPrice, seats);', 'calculateCharge(unitPrice + 1, seats);'));
      await wait('代码失效后移除行内显示', state => state.comments.length === 0 && state.highlights.length === 0 && !state.status.includes('正在读取'));
      await bodyWait('正文显示具体定位错误', async () => await body(`doc.getElementById('step-notice').textContent.includes('无法定位')`));
      await current(lecture.steps[0].id); await wholeCopy('失效步骤正文仍可整块复制');
      await renderer.screenshot('body-invalid-source.png');
      await edit(sourcePath, sourceText); await shown(lecture, 1);
      await bodyWait('修复后正文错误消失', async () => await body(`doc.getElementById('step-notice').textContent`) === '');
      assert.equal(tabs().length, 1);
      const sourceDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project, sourcePath)));
      await vscode.window.showTextDocument(sourceDocument, { viewColumn: vscode.window.visibleTextEditors[0]?.viewColumn });
      await vscode.commands.executeCommand('workbench.action.files.revert');
      assert.equal(sourceDocument.isDirty, false);
      await command('body');
      await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => !(tab.input instanceof vscode.TabInputWebview)));
      await go(lecture, 2); await current(lecture.steps[1].id);
      assert.equal(tabs().length, 1);
      assert.ok(await body(`doc.documentElement.clientWidth > 0 && doc.documentElement.clientHeight > 0`));
      await go(lecture, 1); await current(lecture.steps[0].id);
    }, 'body-source-recovered.png');
    await checkpoint('删除步骤和更换讲解使用阅读流程的结果，关闭后不自行重建', async () => {
      const changed = structuredClone(value); changed.steps.shift(); lecture = write(changed);
      await shown(lecture, 1); await current(changed.steps[0].id);
      const replacement = structuredClone(value); replacement.id = randomUUID(); replacement.title = '另一份已接受的讲解';
      lecture = write(replacement); await shown(lecture, 1);
      await bodyWait('替换正文全部内容', async () => await body(`doc.getElementById('explanation-body').dataset.explanationId`) === replacement.id);
      assert.equal(await body(`doc.querySelector('h1').textContent`), replacement.title);
      await vscode.window.tabGroups.close(tabs()); assert.equal(tabs().length, 0);
      replacement.steps[0].body += '\n\n关闭后保存。'; lecture = write(replacement); await shown(lecture, 1);
      await wait('关闭后保存已被接受', state => state.comments[0]?.text.includes('关闭后保存。'));
      assert.equal(tabs().length, 0);
      await command('body'); target = undefined; await findBody(); await current(replacement.steps[0].id);
      await wholeCopy('关闭重开正文代码');
    }, 'body-reopened.png');
    await checkpoint('停止释放正文，保存和迟到更新不能重新显示，源码及Git保持原样', async () => {
      const before = await beforeCopy(); await stop(); assert.equal(tabs().length, 0);
      fs.writeFileSync(diskFile, JSON.stringify(value)); await pause(500);
      assert.equal(tabs().length, 0); assert.equal(probe('read').sequence, before.sequence);
      assert.equal(forbidden, 0); assertBaseline();
    }, 'body-stopped.png');
  } finally {
    if (sourcePath && sourceText !== undefined) await edit(sourcePath, sourceText);
    await command('stop'); forbiddenCommand.dispose(); browser.close(); fs.writeFileSync(diskFile, diskRaw); saveCopies();
  }
};
