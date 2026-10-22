const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.verify = async ({ config, renderer, checkpoint, wait, command, parseExplanation, sha256, normalizeText, disk, diskFile }) => {
  const project = path.join(config.fixture, 'project');
  let lectureFile, lecture;
  if (config.explanationPath) {
    const raw = fs.readFileSync(config.explanationPath, 'utf8');
    lecture = parseExplanation(raw);
    for (const source of Object.values(lecture.sources)) {
      assert.equal(source.kind, 'workspace');
      const from = path.resolve(config.explanationProject, source.path);
      assert.ok(from.startsWith(path.resolve(config.explanationProject) + path.sep));
      const to = path.join(project, source.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    lectureFile = path.join(config.runRoot, 'layout-lecture.md');
    fs.writeFileSync(lectureFile, raw);
  } else {
    lectureFile = diskFile; lecture = disk;
  }
  const codeFrames = () => renderer.evaluate(`(() => {
    const body = document.querySelector('.review-widget .comment-body');
    return [...(body?.querySelectorAll('img[src^="data:image/svg+xml;base64,"]') || [])].map(img => ({
      loaded: img.complete && img.naturalWidth > 0, width: img.getBoundingClientRect().width,
      height: img.getBoundingClientRect().height, alt: img.alt,
      top: img.getBoundingClientRect().top, bottom: img.getBoundingClientRect().bottom,
      svg: new TextDecoder().decode(Uint8Array.from(atob(img.src.split(',')[1]), character => character.charCodeAt(0))),
    }));
  })()`);
  await checkpoint('深色行内代码框有底色、边框、留白和高亮，真实讲解显示简短翻译', async () => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    await command('open', vscode.Uri.file(lectureFile));
    const opened = await wait('讲解已加载', state => state.comments.length === 1 && !state.status.includes('正在读取'));
    let index = Number(/(\d+)\/\d+：/.exec(opened.status)?.[1]);
    assert.ok(index);
    const target = config.explanationPath ? 3 : 1;
    while (index !== target) { await command(index < target ? 'next' : 'previous'); index += index < target ? 1 : -1; }
    await wait('当前讲解代码框', state => state.comments.length === 1 && !state.status.includes('正在读取') && state.comments[0].text.includes(config.explanationPath ? '用变量 action 保存当前动作' : lecture.steps[0].title));
    await wait('代码图片完成加载', async () => (await codeFrames()).length > 0 && (await codeFrames()).every(img => img.loaded));
    const frames = await codeFrames();
    for (const frame of frames) {
      assert.ok(frame.width > 100 && frame.height > 20);
      assert.match(frame.svg, /<rect[^>]+fill="#10141b"[^>]+stroke="#49515d"/);
      assert.match(frame.svg, /x="18"/); assert.match(frame.svg, /<tspan fill=/);
    }
    if (config.explanationPath) assert.ok(frames.some(frame => frame.alt === 'var action = actions[_step];'));
    await wait('代码框进入实际截图范围', async () => (await codeFrames()).some(frame => frame.top > 100 && frame.bottom < 1000));
    fs.writeFileSync(path.join(config.runRoot, 'layout-frames.json'), JSON.stringify(frames, null, 2));
  }, '46-inline-code-dark.png');
  if (config.explanationPath) {
    await renderer.evaluate(`(() => {
      const body = document.querySelector('.review-widget .comment-body');
      const image = [...body.querySelectorAll('img')].find(img => img.alt === '_hasPath = action.path != null;');
      if (!image) throw new Error('未找到路径判断代码框');
      body.scrollTop += image.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    })()`);
    await renderer.screenshot('46-inline-code-path.png');
  }

  await checkpoint('浅色主题自动更新代码框，特殊字符保持原文且 HTML 不执行', async () => {
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
    await wait('浅色代码框重新显示', async () => (await codeFrames()).some(img => img.loaded && img.svg.includes('fill="#f4f5f7"')));
    await renderer.screenshot('47-inline-code-light.png');
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    const file = path.join(project, 'layout-special.cs');
    const code = String.raw`if (ready && count < 3) return "<script>&中文</script> C:\\temp\\path";` + '\n';
    fs.writeFileSync(file, code);
    const header = { version: 1, id: 'layout-special', sources: { code: { kind: 'workspace', path: 'layout-special.cs', exists: true, sha256: sha256(normalizeText(code)) } } };
    const step = { id: 'special', kind: 'file', source: 'code', target: { startLine: 1, endLine: 1, sha256: sha256(code.trimEnd()) } };
    const special = `<!-- code-explanation\n${JSON.stringify(header)}\n-->\n# 字符验收\n<!-- step\n${JSON.stringify(step)}\n-->\n## 特殊字符\n\n\`\`\`csharp\n${code}\`\`\`\n\n准备好且数量不足 3，就返回这段文字。\n\n<script>window.codeExplanationExecuted = true</script>`;
    const fileMd = path.join(config.runRoot, 'layout-special.md'); fs.writeFileSync(fileMd, special);
    await command('open', vscode.Uri.file(fileMd));
    await wait('特殊字符代码框', async state => state.comments.length === 1 && !state.status.includes('正在读取') && (await codeFrames()).some(img => img.loaded && img.svg.includes('中文')));
    const specialFrame = (await codeFrames())[0];
    const decode = require('entities').decodeHTML;
    const renderedCode = [...specialFrame.svg.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)].map(match => decode(match[1])).join('');
    assert.equal(renderedCode, code.trimEnd());
    const safe = await renderer.evaluate(`({ executed: !!window.codeExplanationExecuted, scripts: document.querySelectorAll('.review-widget script').length })`);
    assert.equal(safe.executed, false); assert.equal(safe.scripts, 0);
  }, '48-inline-code-special.png');

  await checkpoint('实际 diff 两侧定位保留，代码框显示且停止清除', async () => {
    await command('open', vscode.Uri.file(diskFile));
    let state = await wait('已打开演示讲解', state => state.comments.length === 1 && !state.status.includes('正在读取'));
    let current = Number(/(\d+)\/\d+：/.exec(state.status)?.[1]);
    assert.ok(current);
    while (current !== 5) { await command(current < 5 ? 'next' : 'previous'); current += current < 5 ? 1 : -1; }
    const both = disk.steps[4];
    const rightText = (await vscode.workspace.openTextDocument(vscode.window.tabGroups.activeTabGroup.activeTab.input.modified)).getText();
    const snippet = rightText.split('\n').slice(both.targets.right.startLine - 1, both.targets.right.endLine).join('\n');
    const header = { version: 1, id: 'layout-diff', sources: { [both.left]: disk.sources[both.left], [both.right]: disk.sources[both.right] } };
    const metadata = { id: 'both', kind: 'diff', comparison: both.comparison, left: both.left, right: both.right, targets: both.targets };
    const raw = `<!-- code-explanation\n${JSON.stringify(header)}\n-->\n# diff 代码框\n<!-- step\n${JSON.stringify(metadata)}\n-->\n## 对照直接计算与新增的数量检查\n\n\`\`\`javascript\n${snippet}\n\`\`\`\n\n席位数小于等于 0，就返回 0，不再计算金额。`;
    const file = path.join(config.runRoot, 'layout-diff.md'); fs.writeFileSync(file, raw);
    await command('open', vscode.Uri.file(file));
    await wait('双侧 diff 代码框', state => state.comments.length === 1 && !state.status.includes('正在读取') && state.comments[0].side === 'right' && state.highlights.some(h => h.side === 'left') && state.highlights.some(h => h.side === 'right'));
    await wait('diff 中代码框完成加载', async () => (await codeFrames()).some(img => img.loaded));
    assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputTextDiff);
    await renderer.screenshot('49-code-block-diff.png');
    await command('stop');
    await wait('停止后移除代码框', state => !state.comments.length && !state.highlights.length);
  });
};
