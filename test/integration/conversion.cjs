const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { pause } = require('./renderer.cjs');

exports.verify = async context => {
  const { config, renderer, checkpoint, wait, command, parseExplanation, normalizeText, sha256,
    diskFile, diskRaw, project, git, open, go, shown, stop, assertAnchor, activeDiff, assertBaseline } = context;
  assert.ok(config.explanationPath && config.explanationProject, '需要明确本次转换后的讲解与代码项目。');
  const sourceProject = fs.realpathSync(config.explanationProject);
  const inputFile = fs.realpathSync(config.explanationPath);
  const within = (root, file) => {
    const relative = path.relative(root, file);
    return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  assert.ok(within(fs.realpathSync(config.runRoot), fs.realpathSync(project)), '只能写入本轮独立验收工程。');
  assert.notEqual(sourceProject.toLowerCase(), fs.realpathSync(project).toLowerCase());
  const originals = new Map(), createdFiles = [], createdDirectories = [], copies = [];
  const results = { inputFile, sourceProject, originalInputs: [], steps: [], copies };
  const save = () => fs.writeFileSync(path.join(config.runRoot, 'conversion-results.json'), JSON.stringify(results, null, 2));
  function readOriginal(file) {
    if (!originals.has(file)) originals.set(file, fs.readFileSync(file));
    return originals.get(file);
  }
  function writeFixture(file, bytes) {
    assert.ok(within(project, file), '新增验收文件必须位于独立代码项目内。');
    assert.equal(fs.existsSync(file), false, `不覆盖已有文件：${file}`);
    const missing = [];
    for (let directory = path.dirname(file); !fs.existsSync(directory); directory = path.dirname(directory)) missing.push(directory);
    for (const directory of missing.reverse()) { fs.mkdirSync(directory); createdDirectories.push(directory); }
    assert.ok(within(fs.realpathSync(project), fs.realpathSync(path.dirname(file))), '验收目录不能通过链接指向工程外。');
    fs.writeFileSync(file, bytes, { flag: 'wx' }); createdFiles.push(file);
  }
  const sourceRaw = readOriginal(inputFile), lecture = parseExplanation(sourceRaw.toString('utf8'));
  assert.equal(lecture.steps.length, 12, '本次应验证指定的 12 步转换案例。');
  assert.ok(lecture.steps.every(step => step.kind === 'file'));
  const lectureFile = path.join(project, '.code-explanations', 'conversion-original.json');
  const blockCodes = body => Array.from(body.matchAll(/^```[^\n]*\n([\s\S]*?)^```[\t ]*$/gm), match => match[1]);
  const isolation = JSON.parse(fs.readFileSync(path.join(config.runRoot, 'copy-expected-isolation.json'), 'utf8').replace(/^\uFEFF/, ''));
  const probe = (operation, ...args) => JSON.parse(execFileSync(path.join(config.runRoot, 'ClipboardProbe.exe'),
    [isolation.station, operation, ...args.map(String)], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''));
  const identity = probe('identity');
  assert.notEqual(identity.station.toLowerCase(), 'winsta0');
  assert.equal(identity.station, isolation.station); assert.equal(identity.desktop, isolation.desktop);
  results.clipboardIsolation = { identity, expected: isolation };
  await renderer.protocol('Emulation.setFocusEmulationEnabled', { enabled: true });

  async function beforeCopy() {
    const sentinel = `conversion-copy-before-${randomUUID()}`;
    await vscode.env.clipboard.writeText(sentinel);
    const before = probe('read'); assert.equal(before.text, sentinel); return before;
  }
  async function recordCopy(name, expected, before, selected) {
    await pause(100);
    const native = probe('read'), actual = await vscode.env.clipboard.readText();
    assert.notEqual(native.sequence, before.sequence);
    assert.equal(native.ownerProcessId, isolation.mainProcessId); assert.equal(native.ownerThreadDesktop, identity.desktop);
    assert.equal(normalizeText(actual), expected); assert.equal(normalizeText(native.text), expected);
    if (selected !== undefined) assert.equal(normalizeText(selected), expected);
    copies.push({ name, expected, actual, selected, native, passed: true }); save();
  }
  async function wholeCopy(name, block, expected) {
    const before = await beforeCopy();
    const point = await renderer.evaluate(`(() => {
      const a=[...document.querySelectorAll('.review-widget a')].filter(a=>a.textContent==='复制这段代码')[${block}];if(!a)throw new Error('未找到本步复制入口');
      a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await recordCopy(name, expected, before);
  }
  async function selectCopy(name, block, code, start, end) {
    let previous, unchangedSince = 0;
    await wait('当前转换讲解的正文稳定', state => {
      const current = state.comments[0]?.markdown;
      if (!current || state.status.includes('正在读取') || previous !== current) {
        previous = current; unchangedSince = Date.now(); return false;
      }
      return Date.now() - unchangedSince >= 800;
    });
    const before = await beforeCopy();
    const points = await renderer.evaluate(`(() => {
      const code=document.querySelectorAll('.review-widget blockquote code')[${block}];if(!code)throw new Error('未找到本步代码块');code.scrollIntoView({block:'center'});
      const nodes=[];let offset=0;const visit=node=>{if(node.nodeType===Node.TEXT_NODE){nodes.push({node,start:offset,end:offset+node.nodeValue.length});offset+=node.nodeValue.length;}else for(const child of node.childNodes)visit(child);};visit(code);
      const point=(index,last)=>{const found=nodes.find(item=>index>=item.start&&index<item.end);if(!found)throw new Error('无法读取字符位置');const r=document.createRange();r.setStart(found.node,index-found.start);r.setEnd(found.node,index-found.start+1);const b=r.getBoundingClientRect();return{x:last?b.right-.2:b.left+.2,y:b.top+b.height/2};};
      return{start:point(${start},false),end:point(${end - 1},true)};
    })()`);
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.start, button: 'left', clickCount: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', clickCount: 1 });
    for (let index = 1; index <= 12; index++) await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseMoved',
      x: points.start.x + (points.end.x - points.start.x) * index / 12, y: points.start.y + (points.end.y - points.start.y) * index / 12, button: 'left', buttons: 1 });
    await renderer.protocol('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', clickCount: 1 });
    const selected = await renderer.evaluate('window.getSelection().toString()');
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await renderer.protocol('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await recordCopy(name, code.slice(start, end), before, selected);
  }

  try {
    await checkpoint('只读复制转换后的 JSON 及其实际磁盘引用，保持原标识、正文和摘要', async () => {
      writeFixture(lectureFile, sourceRaw);
      assert.deepStrictEqual(parseExplanation(fs.readFileSync(lectureFile, 'utf8')), lecture);
      for (const source of Object.values(lecture.sources)) {
        assert.equal(source.kind, 'workspace'); assert.equal(source.exists, true);
        const file = fs.realpathSync(path.resolve(sourceProject, source.path));
        assert.ok(within(sourceProject, file), '只读取所选项目中的实际引用。');
        const target = path.resolve(project, source.path), bytes = readOriginal(file);
        writeFixture(target, bytes); assert.deepStrictEqual(fs.readFileSync(target), bytes);
      }
      results.originalInputs = Array.from(originals, ([file, bytes]) => ({ file, bytes: bytes.length, sha256Before: sha256(bytes) }));
      results.lectureId = lecture.id; results.stepIds = lecture.steps.map(step => step.id); save();
    });
    for (const [offset, step] of lecture.steps.entries()) {
      const index = offset + 1;
      await checkpoint(`转换讲解第 ${index} 步：${step.title}，目标与实际引用一致`, async () => {
        if (index === 1) await open(lectureFile, lecture); else await go(lecture, index);
        const state = await shown(lecture, index, state => state.highlights.some(item => item.side === 'file'));
        assertAnchor(state, 'file', step.target.startLine, step.target.endLine);
        const expectedUri = vscode.Uri.file(path.resolve(project, lecture.sources[step.source].path));
        assert.equal(vscode.window.activeTextEditor.document.uri.toString(), expectedUri.toString());
        assert.ok(state.highlights.some(item => item.side === 'file'));
        assert.equal(state.comments.length, 1);
        results.steps.push({ step: index, id: step.id, title: step.title, uri: expectedUri.toString(),
          startLine: step.target.startLine, endLine: step.target.endLine, passed: true }); save();
      }, index === 3 ? 'conversion-begin-step.png' : index === 4 ? 'conversion-prepare-path.png' : undefined);
    }
    await checkpoint('转换正文保留直接翻译，路径判断代码真实拖选并复制', async () => {
      await go(lecture, 3);
      const codes = blockCodes(lecture.steps[2].body), index = codes.findIndex(code => code.includes('_hasPath = action.path != null;'));
      assert.ok(index >= 0);
      await selectCopy('转换后的路径判断局部代码', index, codes[index], 0, '_hasPath'.length);
      await wholeCopy('转换后的路径判断整块代码', index, codes[index]);
    }, 'conversion-path-condition-selected.png');
    await stop();
    const diffValue = JSON.parse(diskRaw);
    diffValue.id = `conversion-diff-${randomUUID()}`;
    for (const step of diffValue.steps) {
      const side = step.kind === 'file' ? 'source' : step.targets.right ? 'right' : 'left';
      const source = diffValue.sources[step[side]], target = step.kind === 'file' ? step.target : step.targets[side];
      const text = source.kind === 'git' ? git('show', `${source.commit}:${source.path}`) : fs.readFileSync(path.join(project, source.path), 'utf8');
      const code = normalizeText(text).split('\n').slice(target.startLine - 1, target.endLine).join('\n');
      step.body = `\`\`\`javascript\n${code}\n\`\`\`\n\n这段实际代码对应本步的判断、调用或返回。`;
    }
    const diffFile = path.join(project, '.code-explanations', 'conversion-diff.json');
    writeFixture(diffFile, JSON.stringify(diffValue, null, 2) + '\n');
    const diff = parseExplanation(fs.readFileSync(diffFile, 'utf8'));
    assert.deepStrictEqual(diff.sources, parseExplanation(diskRaw).sources);
    diff.steps.forEach((step, index) => {
      const { body, ...metadata } = step, { body: originalBody, ...originalMetadata } = parseExplanation(diskRaw).steps[index];
      assert.deepStrictEqual(metadata, originalMetadata);
    });
    await open(diffFile, diff);
    let previousDiff;
    for (const index of [3, 4, 5]) {
      const step = diff.steps[index - 1], side = step.targets.right ? 'right' : 'left', target = step.targets[side];
      await checkpoint(`实际 diff 第 ${index} 步：${side === 'left' ? '改前' : Object.keys(step.targets).length === 2 ? '双侧' : '改后'}目标及代码复制`, async () => {
        await go(diff, index);
        const state = await wait('当前 diff 两侧目标已显示', state => Object.keys(step.targets).every(targetSide => state.highlights.some(item => item.side === targetSide)));
        assertAnchor(state, side, target.startLine, target.endLine);
        const input = activeDiff();
        assert.equal(input.original.authority, diff.sources[step.left].commit);
        assert.equal(input.modified.authority, diff.sources[step.right].commit);
        if (previousDiff) assert.deepStrictEqual([input.original.toString(), input.modified.toString()], previousDiff);
        previousDiff = [input.original.toString(), input.modified.toString()];
        const code = blockCodes(step.body)[0]; await selectCopy(`diff 第 ${index} 步局部复制`, 0, code, 0, Math.min(8, code.trimEnd().length));
        if (index === 5) await wholeCopy('双侧 diff 整块代码', 0, code);
      }, `conversion-diff-${index}.png`);
    }
  } finally {
    await command('stop');
    for (const file of createdFiles.reverse()) {
      const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === vscode.Uri.file(file).toString());
      assert.ok(!document?.isDirty, `验收不能修改引用或讲解：${file}`);
      fs.unlinkSync(file);
    }
    for (const directory of createdDirectories.reverse()) fs.rmdirSync(directory);
    for (const [file, bytes] of originals) {
      const after = fs.readFileSync(file); assert.deepStrictEqual(after, bytes, `实际输入不能被验证改写：${file}`);
      const record = results.originalInputs.find(item => item.file === file); if (record) record.sha256After = sha256(after);
    }
    assert.equal(fs.readFileSync(diskFile, 'utf8'), diskRaw); assertBaseline();
    results.originalInputsUnchanged = true; results.fixtureBaselineUnchanged = true; save();
  }
};
