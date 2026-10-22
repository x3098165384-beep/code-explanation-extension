const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { pause } = require('./renderer.cjs');

exports.verify = async context => {
  const { config, renderer, checkpoint, wait, command, parseExplanation, normalizeText, diskFile, diskRaw, manifest,
    project, git, open, go, shown, stop, edit, assertAnchor, activeDiff, assertBaseline } = context;
  const isolation = JSON.parse(fs.readFileSync(path.join(config.runRoot, 'copy-expected-isolation.json'), 'utf8').replace(/^\uFEFF/, ''));
  const probe = (operation, ...args) => JSON.parse(execFileSync(path.join(config.runRoot, 'ClipboardProbe.exe'),
    [isolation.station, operation, ...args.map(String)], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''));
  const identity = probe('identity');
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  assert.equal(identity.station, isolation.station);
  assert.equal(identity.desktop, isolation.desktop);
  fs.writeFileSync(path.join(config.runRoot, 'json-copy-isolation.json'), JSON.stringify({ identity, expected: isolation }, null, 2));
  await renderer.protocol('Emulation.setFocusEmulationEnabled', { enabled: true });
  const copies = [];
  const saveCopies = () => fs.writeFileSync(path.join(config.runRoot, 'json-copy-results.json'), JSON.stringify(copies, null, 2));
  const value = JSON.parse(diskRaw);
  const readSource = source => source.kind === 'git' ? git('show', `${source.commit}:${source.path}`)
    : fs.readFileSync(path.join(project, source.path), 'utf8');
  for (const step of value.steps) {
    const side = step.kind === 'file' ? 'source' : step.targets.right ? 'right' : 'left';
    const source = value.sources[step[side]], target = step.kind === 'file' ? step.target : step.targets[side];
    const code = normalizeText(readSource(source)).split('\n').slice(target.startLine - 1, target.endLine).join('\n');
    step.body = `\`\`\`javascript\n${code}\n\`\`\`\n\n这段代码对应当前步骤指出的调用、判断或返回。`;
  }
  const special = '\tconst path = "C:\\temp\\中文";\n\n// 引号 "、反斜杠 \\ 和空行\n' + 'const longLine = "' + 'long'.repeat(45) + '";\n';
  value.description = '简介保留 "引号"、反斜杠 \\ 和换行。\n这是第二行简介。';
  value.steps[0].body += `\n\n以下是单独用于复制检查的假设文本，不作为源码定位依据。\n\n\`\`\`javascript\n${special}\`\`\`\n\n[不执行作者命令](command:codeExplanation.jsonForbidden)`;
  let lecture;
  const write = object => {
    const raw = JSON.stringify(object, null, 2) + '\n';
    fs.writeFileSync(diskFile, raw); return parseExplanation(raw);
  };
  lecture = write(value);
  const selector = '.review-widget blockquote code';
  async function settled() {
    let previous, unchangedSince = 0;
    await wait('文件监听更新结束且当前正文稳定', state => {
      const current = state.comments[0]?.markdown;
      if (!current || state.status.includes('正在读取') || previous !== current) {
        previous = current; unchangedSince = Date.now(); return false;
      }
      return Date.now() - unchangedSince >= 800;
    });
  }
  async function drag(codeIndex, start, end) {
    await settled();
    const points = await renderer.evaluate(`(() => {
      const code = document.querySelectorAll(${JSON.stringify(selector)})[${codeIndex}]; if (!code) throw new Error('未找到代码块');code.scrollIntoView({block:'center'});
      const nodes=[]; let offset=0; const visit=node=>{if(node.nodeType===Node.TEXT_NODE){nodes.push({node,start:offset,end:offset+node.nodeValue.length});offset+=node.nodeValue.length;}else for(const child of node.childNodes)visit(child);};visit(code);
      const point=(index,last)=>{const found=nodes.find(item=>index>=item.start&&index<item.end);if(!found)throw new Error('无法读取字符位置');const r=document.createRange();r.setStart(found.node,index-found.start);r.setEnd(found.node,index-found.start+1);const b=r.getBoundingClientRect();return{x:last?b.right-.2:b.left+.2,y:b.top+b.height/2};};
      return{start:point(${start},false),end:point(${end-1},true)};
    })()`);
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    for (let index = 1; index <= 12; index++) await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: points.start.x + (points.end.x - points.start.x) * index / 12, y: points.start.y + (points.end.y - points.start.y) * index / 12, button: 'left', buttons: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', clickCount: 1 });
    return renderer.evaluate('window.getSelection().toString()');
  }
  async function beforeCopy() {
    const sentinel = `json-copy-before-${randomUUID()}`;
    await vscode.env.clipboard.writeText(sentinel);
    const before = probe('read'); assert.equal(before.text, sentinel); return before;
  }
  async function result(name, expected, before, selected) {
    const native = probe('read');
    const actual = await vscode.env.clipboard.readText();
    assert.notEqual(native.sequence, before.sequence);
    assert.equal(native.ownerProcessId, isolation.mainProcessId);
    assert.equal(native.ownerThreadDesktop, identity.desktop);
    assert.equal(normalizeText(actual), expected); assert.equal(normalizeText(native.text), expected);
    if (selected !== undefined) assert.equal(normalizeText(selected), expected);
    copies.push({ name, expected, actual, selected, native, passed: true }); saveCopies();
  }
  async function selectCopy(name, codeIndex, code, start, end) {
    const before = await beforeCopy(); const selected = await drag(codeIndex, start, end);
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await pause(100); await result(name, code.slice(start, end), before, selected);
  }
  async function copyLink(index) {
    await settled();
    await wait('当前代码块复制入口已显示', async state => !state.status.includes('正在读取') &&
      await renderer.evaluate(`[...document.querySelectorAll('.review-widget a')].filter(a=>a.textContent==='复制这段代码').length > ${index}`));
    return renderer.evaluate(`(() => {const a=[...document.querySelectorAll('.review-widget a')].filter(a=>a.textContent==='复制这段代码')[${index}];if(!a)throw new Error('未找到复制入口');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,href:a.getAttribute('data-href')||a.getAttribute('href')};})()`);
  }
  async function wholeCopy(name, index, expected) {
    const before = await beforeCopy(), point = await copyLink(index);
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(120); await result(name, expected, before);
    return JSON.parse(decodeURIComponent(point.href.slice(point.href.indexOf('?') + 1)))[0];
  }
  const firstCode = value.steps[0].body.split('```javascript\n')[1].split('```')[0];
  let originalToken;
  let forbidden = 0;
  const forbiddenCommand = vscode.commands.registerCommand('codeExplanation.jsonForbidden', () => forbidden++);
  try {
    await checkpoint('正式 JSON 读取 BOM、CRLF、简介及当前代码，行内显示为可选择文字', async () => {
      fs.writeFileSync(diskFile, '\uFEFF' + (JSON.stringify(value, null, 2) + '\n').replace(/\n/g, '\r\n'));
      await open(diskFile, lecture);
      const markup = await renderer.evaluate(`document.querySelector('.review-widget .rendered-markdown').innerHTML`);
      assert.match(markup, /<blockquote>/); assert.match(markup, /<code>/); assert.doesNotMatch(markup, /data:image\/svg|<img/);
      assert.doesNotMatch(markup, /href="command:codeExplanation.jsonForbidden/); assert.equal(forbidden, 0);
      assertAnchor(await shown(lecture, 1), 'file', lecture.steps[0].target.startLine, lecture.steps[0].target.endLine);
    }, 'json-file.png');
    await checkpoint('正式代码块真实拖选、保留 Tab 和空行的整块复制及过期入口', async () => {
      await selectCopy('普通代码部分字符', 0, firstCode, 2, 8);
      await wholeCopy('普通源码整块复制', 0, firstCode);
      await selectCopy('假设文本跨行及Tab', 1, special, 0, special.indexOf('\nconst longLine'));
      originalToken = await wholeCopy('假设文本整块保真', 1, special);
    }, 'json-selected.png');
    await checkpoint('历史普通文件、删行、增行及双侧 diff 的正式导航和复制', async () => {
      for (const index of [2, 3, 4, 5, 7, 8]) {
        await go(lecture, index);
        const step = lecture.steps[index - 1], code = value.steps[index - 1].body.split('```javascript\n')[1].split('```')[0];
        if (step.kind === 'diff') {
          const input = activeDiff();
          const expectedSide = step.targets.right ? 'right' : 'left';
          const target = step.targets[expectedSide];
          await wait('比较两侧目标已绘制', state => Object.keys(step.targets).every(side => state.highlights.some(item => item.side === side)));
          assertAnchor(await shown(lecture, index), expectedSide, target.startLine, target.endLine);
          for (const side of ['left', 'right']) if (!lecture.sources[step[side]].exists) {
            assert.equal((await vscode.workspace.openTextDocument(side === 'left' ? input.original : input.modified)).getText(), '');
          }
        }
        await selectCopy(`第${index}步局部复制`, 0, code, 0, Math.min(8, code.trimEnd().length));
        await wholeCopy(`第${index}步整块复制`, 0, code);
      }
      const before = await beforeCopy(); assert.equal(await command('copyCodeBlock', originalToken), false);
      assert.equal(probe('read').sequence, before.sequence);
    }, 'json-diff.png');
    await checkpoint('当前未保存内容参与 diff，源码改变后清除失效位置', async () => {
      const changed = JSON.parse(fs.readFileSync(context.unsavedFile, 'utf8'));
      const edited = await edit(manifest.unsavedEdit.path, fs.readFileSync(path.join(project, manifest.unsavedEdit.path), 'utf8').replace(manifest.unsavedEdit.find, manifest.unsavedEdit.replace));
      fs.writeFileSync(context.unsavedFile, JSON.stringify(changed));
      await open(context.unsavedFile, parseExplanation(JSON.stringify(changed))); await go(parseExplanation(JSON.stringify(changed)), 6);
      activeDiff(); assert.ok(edited.isDirty);
      await edit(manifest.unsavedEdit.path, fs.readFileSync(path.join(project, manifest.unsavedEdit.path), 'utf8'));
      await stop(); await open(diskFile, lecture, 8); await go(lecture, 1);
      const source = lecture.sources[lecture.steps[0].source];
      const original = fs.readFileSync(path.join(project, source.path), 'utf8');
      await edit(source.path, original.replace('calculateCharge(unitPrice, seats);', 'calculateCharge(unitPrice + 1, seats);'));
      await wait('目标失效后可读正文', async state => { const body = await require('./body.cjs').readBody(config); return state.comments.length === 0 && state.highlights.length === 0 && body?.current === lecture.steps[0].id && body.text.includes(lecture.steps[0].title) && !body.text.includes('\"sources\"'); });
      await edit(source.path, original); await shown(lecture, 1);
    }, 'json-source-recovered.png');
    await checkpoint('JSON 保存自动更新及重排按步骤标识保持，删除当前步骤回第一步', async () => {
      const changed = structuredClone(value); changed.steps[0].body += '\n\n已保存的新正文。';
      lecture = write(changed); await wait('正文已自动更新', state => state.comments[0]?.text.includes('已保存的新正文。'));
      changed.steps = [...changed.steps.slice(1), changed.steps[0]]; lecture = write(changed); await shown(lecture, changed.steps.length);
      changed.steps.pop(); lecture = write(changed); await shown(lecture, 1);
      lecture = write(value); await wait('恢复完整步骤', state => state.status.includes(`/${lecture.steps.length}：`)); await go(lecture, 1);
    }, 'json-updated.png');
    await checkpoint('无效 JSON 更新保留已接受正文，修复后自动恢复', async () => {
      const valid = JSON.stringify(value, null, 2);
      const invalid = [valid.slice(0, -5), valid.replace('"version": 2', '"version": 2, "version": 2'),
        valid.replace('"version": 2', '"version": 99'), valid.replace('"version": 2', '"version": 2, "extra": true'),
        JSON.stringify({ ...value, steps: [value.steps[0], value.steps[0]] })];
      for (const raw of invalid) {
        fs.writeFileSync(diskFile, raw);
        await wait('错误更新尚未加载', state => state.status.includes('新讲解尚未加载') && state.comments.length === 1 && state.comments[0].text.includes(value.steps[0].title));
        lecture = write(value); await wait('修复已恢复', state => !state.status.includes('新讲解尚未加载') && state.comments.length === 1);
      }
    }, 'json-invalid-recovered.png');
    await checkpoint('旧 Markdown 与首次无效 JSON 被拒绝，不破坏当前阅读', async () => {
      const invalid = path.join(config.fixture, 'invalid.json'), legacy = path.join(config.fixture, 'old.md');
      fs.writeFileSync(invalid, '{'); fs.writeFileSync(legacy, '<!-- code-explanation\n{}\n-->\n# 旧讲解');
      await command('open', vscode.Uri.file(invalid)); await shown(lecture, 1);
      await command('open', vscode.Uri.file(legacy)); await shown(lecture, 1);
      await command('body');
      await wait('正式排版正文显示讲解', async () => { const body = await require('./body.cjs').readBody(config); return body?.id === value.id && body.text.includes(value.title) && !body.text.includes('\"version\"'); });
    }, 'json-body-fallback.png');
    await checkpoint('停止后清除正文、范围及旧复制入口，源码和 Git 保持', async () => {
      const before = await beforeCopy(); await stop(); assert.equal(await command('copyCodeBlock', originalToken), false);
      assert.equal(probe('read').sequence, before.sequence); assertBaseline();
    }, 'json-stopped.png');
  } finally {
    forbiddenCommand.dispose(); await command('stop'); fs.writeFileSync(diskFile, diskRaw); saveCopies();
  }
};
