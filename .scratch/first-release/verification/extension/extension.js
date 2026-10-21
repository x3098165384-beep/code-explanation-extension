const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const scheme = 'inline-validation-git';
let manifestPath;
let expectedFixtureRoot;
let expectedEvidenceDirectory;
let controller;
let thread;
let decoration;
let operation;
let currentIndex;
let currentTargets = [];
let baseline;
let statusItems = [];

const digest = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const uriKey = uri => uri.toString();

function manifest() {
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const root = path.resolve(value.fixtureRoot);
  const samePath = (left, right) => {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  };
  const expectedPhysicalRoot = path.join(fs.realpathSync(path.dirname(expectedFixtureRoot)), 'workspace');
  if (!samePath(root, expectedFixtureRoot) || !samePath(fs.realpathSync(root), expectedPhysicalRoot)) {
    throw new Error('示例工程必须是扩展旁 runtime/workspace 中准备的独立目录。');
  }
  if (!samePath(path.resolve(value.evidenceDirectory), expectedEvidenceDirectory)) throw new Error('运行记录必须保存在本次验证的 evidence 目录。');
  value.fixtureRoot = root;
  if (!samePath(git(value, 'rev-parse', '--show-toplevel').trim(), root)) throw new Error('示例工程必须有自己的 Git 仓库，不能借用外层项目的仓库。');
  return value;
}

function fixturePath(data, relative) {
  const result = path.resolve(data.fixtureRoot, relative);
  if (!result.startsWith(data.fixtureRoot + path.sep)) {
    throw new Error('代码路径超出了本次验证的独立示例工程。');
  }
  return result;
}

function git(data, ...args) {
  return execFileSync('git', ['-C', data.fixtureRoot, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
}

function requireCommit(data, commit) {
  try {
    git(data, 'cat-file', '-e', `${commit}^{commit}`);
  } catch {
    throw new Error(`无法读取 Git 提交 ${commit}，不能把读取失败当成空文件。`);
  }
}

function gitUri(data, commit, relative, mustBeAbsent = false) {
  requireCommit(data, commit);
  let exists = true;
  try { git(data, 'cat-file', '-e', `${commit}:${relative}`); } catch { exists = false; }
  if (mustBeAbsent && exists) throw new Error(`该版本实际存在 ${relative}，不能显示为空白一侧。`);
  if (!mustBeAbsent && !exists) throw new Error(`Git 版本中不存在文件 ${relative}。`);
  return vscode.Uri.from({ scheme, authority: commit, path: '/' + relative, query: mustBeAbsent ? 'empty=1' : '' });
}

function fileUri(data, relative) {
  return vscode.Uri.file(fixturePath(data, relative));
}

function rangeFor(document, firstLine, lastLine = firstLine) {
  const first = firstLine - 1;
  const last = lastLine - 1;
  if (first < 0 || last >= document.lineCount || first > last) {
    throw new Error(`目标行 ${firstLine} 至 ${lastLine} 超出 ${document.uri.path} 的实际内容。`);
  }
  return new vscode.Range(first, 0, last, document.lineAt(last).text.length);
}

function scenarios(data) {
  const main = data.files.main;
  return [
    { title: '普通脚本：调用方的逐句讲解', kind: 'file', file: data.files.caller, target: [5, 5], body: ordinaryBody },
    { title: '历史 diff：改前删除行', kind: 'commits', file: main, leftTarget: [5, 5], body: '改前的 `return price * quantity;` 先计算单价与数量的乘积，再把结果返回给调用方。\n\n这条原语句在本次 diff 中被删除。改后仍会做乘法，但先排除无效数量，再保存并返回结果。' },
    { title: '历史 diff：改后新增行', kind: 'commits', file: main, rightTarget: [10, 11], body: '`int total` 声明名为 `total` 的整数变量。等号右侧先计算 `price * quantity`，再把乘积赋给它。\n\n下一行 `return total;` 把这个结果返回给调用方，并结束方法。' },
    { title: '历史 diff：同一步指出两侧', kind: 'commits', file: main, leftTarget: [5, 5], rightTarget: [5, 8], body: '改前直接返回 `price * quantity`。数量为负数且单价为正时，会得到负的价格。\n\n改后的 `quantity <= 0` 表示数量小于或等于零。条件成立时执行 `return 0;`，立即结束调用；否则再执行后面的价格计算。\n\n两侧突出显示分别对应原来的直接计算，以及新增的提前返回。正文只在改后侧显示一次。' },
    { title: '当前修改：已暂存、未暂存和未保存', kind: 'working', file: main, leftTarget: [5, 11], rightTarget: [5, 11], body: '左侧读取最近一次真实提交，右侧读取当前编辑器内容。\n\n- `quantity <= 0 || price < 0` 是已经暂存的条件修改：数量不大于零，或者单价为负时，都会提前返回零。\n- `checked(price * quantity)` 是尚未暂存的修改：乘法溢出时会报告错误。\n- `return total + 1;` 是本次准备命令制造的未保存示例：它只存在于编辑器中，磁盘仍是 `return total;`。\n\n阅读和跳转不应保存这个示例，也不应改变暂存区。' },
    { title: '整个新增文件：改前侧确实不存在', kind: 'added', file: data.files.added, rightTarget: [5, 5], body: '这个文件在改前提交中确实不存在，因此改前侧为空白；改后侧读取新增文件的真实 Git 内容。\n\n`return 0;` 返回整数零，并结束这次调用。不存在的文件和读取不到的 Git 提交必须分开处理。' },
    { title: '整个删除文件：改后侧确实不存在', kind: 'deleted', file: data.files.deleted, leftTarget: [5, 5], body: '这个文件在改前提交中存在，在改后提交中确实不存在。因此只在改前侧阅读删除的语句。\n\n`price * quantity` 是单价乘数量，`return` 把这个乘积交给调用方。右侧空白来自已确认的文件删除。' },
    { title: '无效提交：不能当成空文件', kind: 'missing', file: main, body: '' },
  ];
}

const ordinaryBody = [
  '### 从调用方开始读',
  '`PriceCalculator` 是负责计算价格的类，`GetPrice` 是计算方法。括号里的 `price` 是传入的单价，`quantity` 是数量。',
  '`PriceCalculator.GetPrice(price, quantity)` 先调用计算方法，得到一个整数结果。前面的 `return` 再把结果交给调用 `GetTotal` 的代码。这里使用计算方法的返回值，没有自己再算一次。',
  '**按执行顺序看：**\n\n1. 取得这次传入的单价和数量。\n2. 调用价格计算方法。\n3. 等方法返回后，把结果返回给上层调用方。',
  '```csharp\nreturn PriceCalculator.GetPrice(price, quantity);\n```',
  '代码块只用于阅读，不提供插入源码操作。普通链接也可显示：[VS Code Markdown 说明](https://code.visualstudio.com/docs/languages/markdown)。',
  '这段较长的讲解用于检查原生行内评论的实际阅读效果：段落应自然换行，列表和代码块应能辨认，正文不应因为步骤切换而重复堆积。是否合格必须结合真实窗口截图判断，不能只凭这段 Markdown 已传入接口。',
].join('\n\n');

function activeTabInfo() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!tab) return null;
  const input = tab.input;
  if (input instanceof vscode.TabInputTextDiff) return { kind: 'diff', label: tab.label, original: uriKey(input.original), modified: uriKey(input.modified), isDirty: tab.isDirty };
  if (input instanceof vscode.TabInputText) return { kind: 'file', label: tab.label, uri: uriKey(input.uri), isDirty: tab.isDirty };
  return { kind: input?.constructor?.name || 'unknown', label: tab.label };
}

function sourceState(data) {
  const listed = git(data, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const disk = {};
  for (const relative of [...new Set(listed)].sort()) {
    const full = fixturePath(data, relative);
    disk[relative] = fs.existsSync(full) ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') : null;
  }
  const documents = [];
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== 'file') continue;
    const relative = path.relative(data.fixtureRoot, document.uri.fsPath);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
    documents.push({ path: relative.replaceAll('\\', '/'), uri: uriKey(document.uri), isDirty: document.isDirty, sha256: digest(document.getText()), version: document.version });
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  return {
    head: git(data, 'rev-parse', 'HEAD').trim(),
    status: git(data, 'status', '--porcelain=v1'),
    index: git(data, 'ls-files', '--stage'),
    stagedDiffSha256: digest(git(data, 'diff', '--cached', '--no-ext-diff', '--binary')),
    unstagedDiffSha256: digest(git(data, 'diff', '--no-ext-diff', '--binary')),
    disk,
    documents,
  };
}

function compareSources(before, after) {
  const fields = ['head', 'status', 'index', 'stagedDiffSha256', 'unstagedDiffSha256', 'disk'];
  const unchanged = fields.every(key => JSON.stringify(before[key]) === JSON.stringify(after[key]));
  const dirtyBefore = before.documents.filter(document => document.isDirty);
  const dirtyUnchanged = dirtyBefore.length > 0 && dirtyBefore.every(original => after.documents.some(current => current.path === original.path && current.isDirty && current.sha256 === original.sha256));
  const noOtherDocumentChanged = before.documents.length > 0 && after.documents.length > 0 && after.documents.every(current => {
    const original = before.documents.find(document => document.path === current.path);
    return original ? original.isDirty === current.isDirty && original.sha256 === current.sha256 : !current.isDirty;
  });
  return { gitAndDiskUnchanged: unchanged, baselineDirtyDocumentCount: dirtyBefore.length, currentDocumentCount: after.documents.length, preparedDirtyDocumentsUnchanged: dirtyUnchanged, noOtherDocumentChanged };
}

function writeEvidence(event, extra = {}) {
  const data = manifest();
  const sources = sourceState(data);
  const value = {
    event, recordedAt: new Date().toISOString(), vscodeVersion: vscode.version,
    index: currentIndex === undefined ? null : currentIndex + 1,
    title: currentIndex === undefined ? null : scenarios(data)[currentIndex].title,
    activeTab: activeTabInfo(),
    visibleEditors: vscode.window.visibleTextEditors.map(editor => ({ uri: uriKey(editor.document.uri), isDirty: editor.document.isDirty, lineCount: editor.document.lineCount, viewColumn: editor.viewColumn })),
    comment: thread ? { uri: uriKey(thread.uri), range: { startLine: thread.range.start.line + 1, endLine: thread.range.end.line + 1 }, count: thread.comments.length } : null,
    highlightedTargets: currentTargets,
    sourceState: sources,
    comparisonToBaseline: baseline ? compareSources(baseline, sources) : null,
    ...extra,
  };
  fs.mkdirSync(data.evidenceDirectory, { recursive: true });
  const safeEvent = event.replace(/[^a-z0-9-]/g, '-');
  const filename = `${Date.now()}-${safeEvent}-${crypto.randomBytes(3).toString('hex')}.json`;
  fs.writeFileSync(path.join(data.evidenceDirectory, filename), JSON.stringify(value, null, 2) + '\n');
  fs.writeFileSync(path.join(data.evidenceDirectory, 'latest.json'), JSON.stringify(value, null, 2) + '\n');
  return value;
}

function clearReading() {
  operation?.cancel();
  operation?.dispose();
  operation = undefined;
  thread?.dispose();
  thread = undefined;
  decoration?.dispose();
  decoration = undefined;
  currentTargets = [];
}

function updateStatus(title) {
  const count = scenarios(manifest()).length;
  statusItems[0].text = '$(arrow-left) 上一步';
  statusItems[1].text = currentIndex === undefined ? '选择验证步骤' : `行内讲解验证 ${currentIndex + 1}/${count}：${title}`;
  statusItems[2].text = '下一步 $(arrow-right)';
  statusItems[3].text = '$(primitive-square) 停止验证';
  for (const item of statusItems) item.show();
}

async function visibleEditorsFor(uris, token) {
  const find = () => uris.map(uri => vscode.window.visibleTextEditors.find(editor => uriKey(editor.document.uri) === uriKey(uri)));
  const immediate = find();
  if (immediate.every(Boolean)) return immediate;
  if (token.isCancellationRequested) throw new Error('本次显示已取消。');
  return new Promise((resolve, reject) => {
    let timeout;
    let change;
    let cancel;
    const finish = (error, result) => { clearTimeout(timeout); change?.dispose(); cancel?.dispose(); error ? reject(error) : resolve(result); };
    change = vscode.window.onDidChangeVisibleTextEditors(() => { const result = find(); if (result.every(Boolean)) finish(null, result); });
    cancel = token.onCancellationRequested(() => finish(new Error('本次显示已取消。')));
    timeout = setTimeout(() => finish(new Error('VS Code 未在等待期间提供目标文本编辑器，需要检查实际 diff 显示。')), 5000);
  });
}

async function showCase(index) {
  const data = manifest();
  const cases = scenarios(data);
  if (index < 0 || index >= cases.length) return;
  if (!baseline) baseline = sourceState(data);
  clearReading();
  currentIndex = index;
  const cancel = new vscode.CancellationTokenSource();
  operation = cancel;
  const token = cancel.token;
  const item = cases[index];
  updateStatus(item.title);
  try {
    if (item.kind === 'missing') {
      requireCommit(data, '0000000000000000000000000000000000000000');
      throw new Error('无效提交未被拒绝，需要检查验证实现。');
    }
    let left;
    let right;
    let targetUris;
    if (item.kind === 'file') {
      right = fileUri(data, item.file);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(right), { preview: false });
      targetUris = [right];
    } else {
      left = gitUri(data, item.kind === 'working' ? data.afterCommit : data.beforeCommit, item.file, item.kind === 'added');
      right = item.kind === 'working' ? fileUri(data, item.file) : gitUri(data, data.afterCommit, item.file, item.kind === 'deleted');
      if (token.isCancellationRequested) return;
      const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const alreadyOpen = active instanceof vscode.TabInputTextDiff && uriKey(active.original) === uriKey(left) && uriKey(active.modified) === uriKey(right);
      if (!alreadyOpen) await vscode.commands.executeCommand('vscode.diff', left, right, `行内讲解验证：${path.basename(item.file)}`, { preview: false });
      targetUris = [left, right];
    }
    if (token.isCancellationRequested) return;
    const editors = await visibleEditorsFor(targetUris, token);
    if (token.isCancellationRequested) return;
    decoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: 'rgba(255, 180, 40, 0.22)', border: '1px solid rgba(255, 180, 40, 0.75)' });
    const specs = item.kind === 'file' ? [{ editor: editors[0], lines: item.target, side: 'file' }] : [
      ...(item.leftTarget ? [{ editor: editors[0], lines: item.leftTarget, side: 'left' }] : []),
      ...(item.rightTarget ? [{ editor: editors[1], lines: item.rightTarget, side: 'right' }] : []),
    ];
    for (const target of specs) {
      const range = rangeFor(target.editor.document, ...target.lines);
      target.editor.setDecorations(decoration, [range]);
      target.editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      currentTargets.push({ side: target.side, uri: uriKey(target.editor.document.uri), startLine: range.start.line + 1, endLine: range.end.line + 1, actualText: target.editor.document.getText(range), isDirty: target.editor.document.isDirty });
    }
    const anchor = specs.at(-1);
    const range = rangeFor(anchor.editor.document, ...anchor.lines);
    const body = new vscode.MarkdownString(`## ${item.title}\n\n${item.body}\n\n---\n\n[上一步](command:inlineValidation.previous) · [下一步](command:inlineValidation.next) · [选择步骤](command:inlineValidation.select) · [停止](command:inlineValidation.stop)`);
    body.isTrusted = { enabledCommands: ['inlineValidation.previous', 'inlineValidation.next', 'inlineValidation.select', 'inlineValidation.stop'] };
    body.supportHtml = false;
    thread = controller.createCommentThread(anchor.editor.document.uri, range, [{ body, mode: vscode.CommentMode.Preview, author: { name: '行内讲解验证' } }]);
    thread.label = `第 ${index + 1} 步，共 ${cases.length} 步`;
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    writeEvidence('case-shown');
  } catch (error) {
    if (token.isCancellationRequested) return;
    clearReading();
    writeEvidence('case-error', { error: error.message, expectedMissingCommit: item.kind === 'missing' });
    await vscode.window.showErrorMessage(error.message);
  }
}

async function prepareUnsaved() {
  const data = manifest();
  clearReading();
  currentIndex = undefined;
  const edit = data.unsavedEdit || { path: data.files.main, find: 'return total;', replace: 'return total + 1;' };
  const physicalFile = fs.realpathSync(fixturePath(data, edit.path));
  const physicalRoot = fs.realpathSync(data.fixtureRoot);
  if (!physicalFile.startsWith(physicalRoot + path.sep)) throw new Error('未保存示例的文件必须实际位于独立示例目录内，不能通过链接指向外部文件。');
  const document = await vscode.workspace.openTextDocument(fileUri(data, edit.path));
  const text = document.getText();
  let expectedText = text;
  if (!text.includes(edit.replace)) {
    const position = text.indexOf(edit.find);
    if (position < 0 || position !== text.lastIndexOf(edit.find)) throw new Error('独立示例中没有唯一的待修改返回语句，无法准备未保存内容。');
    const change = new vscode.WorkspaceEdit();
    change.replace(document.uri, new vscode.Range(document.positionAt(position), document.positionAt(position + edit.find.length)), edit.replace);
    expectedText = text.slice(0, position) + edit.replace + text.slice(position + edit.find.length);
    if (!await vscode.workspace.applyEdit(change)) throw new Error('VS Code 未接受独立示例的未保存修改。');
  }
  await vscode.window.showTextDocument(document, { preview: false });
  if (!document.isDirty) throw new Error('示例文档当前没有未保存的修改，不能记录为已准备未保存示例。');
  if (document.getText() !== expectedText) throw new Error('示例文档的实际内容与准备后的预期内容不同，不能记录为准备成功。');
  baseline = sourceState(data);
  const relative = path.relative(data.fixtureRoot, document.uri.fsPath).replaceAll('\\', '/');
  const preparedDocument = baseline.documents.find(value => value.path === relative);
  const expectedSha256 = digest(expectedText);
  if (!preparedDocument || !preparedDocument.isDirty || preparedDocument.sha256 !== expectedSha256) {
    baseline = undefined;
    throw new Error('运行记录没有包含实际修改的未保存文档，不能开始未保存内容的前后对照。');
  }
  writeEvidence('prepared-unsaved', { preparedDocument: { ...preparedDocument, expectedSha256, matchesExpectedText: true } });
  updateStatus('已准备未保存示例，请开始验证');
  await vscode.window.showInformationMessage('已在独立示例中准备未保存的 return total + 1;，阅读验证不会保存它。');
}

async function choose() {
  const items = scenarios(manifest()).map((item, index) => ({ label: `${index + 1}. ${item.title}`, index }));
  const result = await vscode.window.showQuickPick(items, { title: '选择要在真实 VS Code 中验证的步骤' });
  if (result) await showCase(result.index);
}

function stop() {
  clearReading();
  currentIndex = undefined;
  for (const item of statusItems) item.hide();
  writeEvidence('stopped', { cleanup: { commentThreadDisposed: true, decorationDisposed: true, pendingReadingCancelled: true } });
  baseline = undefined;
}

function activate(context) {
  expectedFixtureRoot = path.resolve(context.extensionPath, '../runtime/workspace');
  expectedEvidenceDirectory = path.resolve(context.extensionPath, '../evidence');
  manifestPath = process.env.CODE_EXPLANATION_VERIFY_MANIFEST || path.resolve(context.extensionPath, '../runtime/manifest.json');
  controller = vscode.comments.createCommentController('inline-validation', '行内讲解验证');
  context.subscriptions.push(controller);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(scheme, {
    provideTextDocumentContent(uri) {
      const data = manifest();
      const relative = uri.path.slice(1);
      fixturePath(data, relative);
      const empty = uri.query === 'empty=1';
      gitUri(data, uri.authority, relative, empty);
      return empty ? '' : git(data, 'show', `${uri.authority}:${relative}`);
    },
  }));
  for (const [command, priority] of [['previous', 103], ['select', 102], ['next', 101], ['stop', 100]]) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    item.command = `inlineValidation.${command}`;
    statusItems.push(item);
    context.subscriptions.push(item);
  }
  const commands = {
    prepareUnsaved,
    start: () => showCase(0),
    select: choose,
    previous: () => showCase((currentIndex ?? 1) - 1),
    next: () => showCase((currentIndex ?? -1) + 1),
    capture: () => { writeEvidence('manual-capture'); return vscode.window.showInformationMessage('已记录当前标签页、编辑器、目标范围及源码状态；显示效果仍需截图核对。'); },
    stop,
  };
  for (const [name, action] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(`inlineValidation.${name}`, async () => {
      try { await action(); } catch (error) { await vscode.window.showErrorMessage(`行内讲解验证未完成：${error.message}`); }
    }));
  }
  context.subscriptions.push({ dispose() { clearReading(); statusItems = []; } });
  try { writeEvidence('activated'); } catch (error) { console.error(`行内讲解验证尚未读取示例：${error.message}`); }
}

function deactivate() {
  clearReading();
}

module.exports = { activate, deactivate };
