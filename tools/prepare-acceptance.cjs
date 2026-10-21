const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { javascriptFormatting } = require('../dist/code-formatting');
const { parseExplanation } = require('../dist/explanation');

const repositoryRoot = path.resolve(__dirname, '..');
const directory = path.join(repositoryRoot, '.scratch', 'first-release', 'runtime', 'acceptance');
const project = path.join(directory, 'project');
const manifestPath = path.join(directory, 'manifest.json');
const hooks = path.join(directory, 'empty-hooks');
const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const digest = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const environment = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete environment[key];

function git(...args) {
  return execFileSync('git', [
    '--no-optional-locks', '-c', 'core.autocrlf=false', '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false',
    '-c', 'user.name=XGH', '-c', 'user.email=xgh@example.invalid', '-C', project, ...args,
  ], { encoding: 'utf8', windowsHide: true, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
}

function assertRepository() {
  if (!samePath(fs.realpathSync(project), path.join(fs.realpathSync(directory), 'project'))) {
    throw new Error('演示工程不能通过目录链接指向本次验收目录之外。');
  }
  if (!fs.statSync(path.join(project, '.git')).isDirectory() || !samePath(git('rev-parse', '--show-toplevel').trim(), project)) {
    throw new Error('演示工程必须拥有自己的 .git 目录，不能使用插件项目的 Git 仓库。');
  }
}

function write(relative, content) {
  const filename = path.join(project, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content, { encoding: 'utf8', flag: 'wx' });
}

function contentAt(commit, relative) {
  return normalize(git('show', `${commit}:${relative}`));
}

function range(text, fragment) {
  const lines = normalize(text).split('\n');
  const selected = normalize(fragment).split('\n');
  const starts = [];
  for (let start = 0; start + selected.length <= lines.length; start++) {
    if (lines.slice(start, start + selected.length).join('\n') === selected.join('\n')) starts.push(start);
  }
  if (starts.length !== 1 || !fragment.trim()) throw new Error('生成目标时未找到唯一的实际非空代码范围。');
  return { startLine: starts[0] + 1, endLine: starts[0] + selected.length, sha256: digest(selected.join('\n')) };
}

function reference(kind, relative, text, commit) {
  const formatting = kind === 'workspace' ? javascriptFormatting(text) : undefined;
  return { kind, path: relative, exists: true, ...(kind === 'git' ? { commit } : {}), sha256: digest(normalize(text)), ...(formatting ? { formattingSha256: formatting.fileSha256 } : {}) };
}

function makeLecture(before, after, current, unsaved) {
  const invoice = normalize(fs.readFileSync(path.join(project, 'src', 'invoice.js'), 'utf8'));
  const previousCharge = contentAt(before, 'src/charge.js');
  const revisedCharge = contentAt(after, 'src/charge.js');
  const formatter = contentAt(after, 'src/format-amount.js');
  const legacy = contentAt(before, 'src/legacy-charge.js');
  const sources = {
    'invoice-current': reference('workspace', 'src/invoice.js', invoice),
    'charge-before': reference('git', 'src/charge.js', previousCharge, before),
    'charge-after': reference('git', 'src/charge.js', revisedCharge, after),
    'charge-current': reference('workspace', 'src/charge.js', current),
    'formatter-before': { kind: 'git', path: 'src/format-amount.js', exists: false, commit: before },
    'formatter-after': reference('git', 'src/format-amount.js', formatter, after),
    'legacy-before': reference('git', 'src/legacy-charge.js', legacy, before),
    'legacy-after': { kind: 'git', path: 'src/legacy-charge.js', exists: false, commit: after },
    'formatter-current': reference('workspace', 'src/format-amount.js', normalize(fs.readFileSync(path.join(project, 'src', 'format-amount.js'), 'utf8'))),
  };
  const id = crypto.randomUUID();
  const removed = range(previousCharge, '  return unitPrice * seats;');
  const guard = range(revisedCharge, ['  if (seats <= 0) {', '    return 0;', '  }'].join('\n'));
  const steps = [
    {
      title: '从账单函数跟到金额计算',
      metadata: { kind: 'file', source: 'invoice-current', target: range(invoice, '  const amount = calculateCharge(unitPrice, seats);\n  return { seats, amount };') },
      body: [
        '`createInvoice` 接收每个席位的单价 `unitPrice` 和席位数量 `seats`。这里的 `calculateCharge(unitPrice, seats)` 先把这两个值交给金额计算函数，得到本次金额。',
        '`const amount` 声明当前调用使用的金额变量，等号把计算结果交给它。下一行 `return { seats, amount };` 返回一个对象，对象里保存席位数量和金额。调用方因此能一起取得这两项数据。',
        '**按执行顺序阅读：**\n\n1. 使用传入的单价和数量调用金额计算。\n2. 把返回值保存到 `amount`。\n3. 把数量和金额组成对象，返回给上层调用方。',
        '```javascript\nconst amount = calculateCharge(unitPrice, seats);\nreturn { seats, amount };\n```',
        '代码块只用于阅读，插件不会把它插入源码。普通链接示例：[VS Code Markdown 说明](https://code.visualstudio.com/docs/languages/markdown)。接下来先看历史普通文件，再依次查看真实 diff；这些步骤属于同一份讲解。',
      ].join('\n\n'),
    },
    {
      title: '单独阅读旧提交中的金额算法',
      metadata: { kind: 'file', source: 'charge-before', target: removed },
      body: '`unitPrice * seats` 把每个席位的单价乘以席位数量，`return` 直接把乘积返回。本步来自旧提交中的普通文件，即使编辑器当前已经有数量检查和其他修改，这里仍应读取该提交的原始语句。',
    },
    {
      title: '在改前侧查看被删除的直接返回',
      metadata: { kind: 'diff', comparison: 'commits', left: 'charge-before', right: 'charge-after', targets: { left: removed } },
      body: '旧写法把乘法与返回合在同一句中。数量为零时返回零；数量为负且单价为正时会返回负金额。它在本次比较的左侧显示为删除行。右侧仍应保留完整的新版本，不能因为本步只讲左侧就退回普通文件。',
    },
    {
      title: '在改后侧查看保存结果和返回的两行',
      metadata: { kind: 'diff', comparison: 'commits', left: 'charge-before', right: 'charge-after', targets: { right: range(revisedCharge, '  const subtotal = unitPrice * seats;\n  return subtotal;') } },
      body: '`const subtotal` 声明本次计算的小计。右边的乘法先执行，结果赋给这个变量。下一行 `return subtotal;` 返回已算好的小计并结束函数。这两行位于改后侧；前一步的正文和额外高亮应在切换时清除。',
    },
    {
      title: '对照直接计算与新增的数量检查',
      metadata: { kind: 'diff', comparison: 'commits', left: 'charge-before', right: 'charge-after', targets: { left: removed, right: guard } },
      body: '`seats <= 0` 判断席位数量是否小于或等于零。条件成立时执行 `return 0;`，立即结束本次调用，不再进行后面的金额计算。左侧直接返回乘积，右侧先排除无效数量。两处范围应同时高亮，正文只在右侧显示一次。',
    },
    {
      title: unsaved ? '一起查看暂存、未暂存和未保存的金额修改' : '一起查看暂存和未暂存的金额修改',
      metadata: {
        kind: 'diff', comparison: 'working-tree', left: 'charge-after', right: 'charge-current',
        targets: { left: range(revisedCharge, revisedCharge.replace(/\n$/, '')), right: range(current, current.replace(/\n$/, '')) },
      },
      body: [
        '左侧是生成这份讲解时的最近提交，右侧是当前编辑器内容。讲解记录了左侧的完整提交标识；以后产生新提交，旧的未提交比较应提示基准改变，而固定提交步骤仍读取原来的版本。',
        '- `seats <= 0 || unitPrice < 0` 是已经暂存的修改。`||` 表示任一条件成立就提前返回零，新增部分排除了负单价。\n- `Math.round(unitPrice * seats * 100) / 100` 是尚未暂存的修改。它把乘积放大一百倍，取最近的整数，再除以一百，把本次结果保留到小数点后两位。',
        unsaved
          ? '`return subtotal + 2;` 是需要你手动放到编辑器、并保持未保存的修改：先给小计增加两元，再返回。磁盘仍应是 `return subtotal;`。如果没有先做这项编辑，本步找不到完整的预期目标是正常的，不能通过读取磁盘文本冒充已经做了未保存修改。'
          : '当前磁盘仍是 `return subtotal;`，返回小计。本份讲解按实际磁盘内容生成，可以先直接打开；测试未保存修改时请使用另一份 `lecture-unsaved.md`，并按说明先在编辑器修改返回语句。',
      ].join('\n\n'),
    },
    {
      title: '读取整个新增文件，改前侧保持为空',
      metadata: { kind: 'diff', comparison: 'commits', left: 'formatter-before', right: 'formatter-after', targets: { right: range(formatter, '  return `${amount.toFixed(2)} 元`;') } },
      body: '`amount.toFixed(2)` 把金额转换成保留两位小数的字符串，外层模板字符串再追加“元”。这个文件在旧提交中确实不存在，因此左侧为空。这里的空白来自已确认的文件新增，不是把读取失败隐藏起来。',
    },
    {
      title: '读取整个删除文件，改后侧保持为空',
      metadata: { kind: 'diff', comparison: 'commits', left: 'legacy-before', right: 'legacy-after', targets: { left: range(legacy, '  return unitPrice * seats;') } },
      body: '`legacyCharge` 是旧的直接乘法入口。这次修改已经删除整个文件，所以正文只对应左侧的返回语句；右侧为空，表示新提交确实没有该文件。插件不能借用当前文件或其他提交来填补这一侧。',
    },
    {
      title: '回到当前格式化函数，并保留最后一步',
      metadata: { kind: 'file', source: 'formatter-current', target: range(formatter, '  return `${amount.toFixed(2)} 元`;') },
      body: '这一步从历史比较回到当前项目中的格式化函数。`return` 返回带两位小数和单位的字符串，不改变传入的数值。到达最后一步后，正文应继续显示，下一步不再前进；只有你选择停止时才清除正文和额外高亮。',
    },
  ];
  const parts = [
    '<!-- code-explanation', JSON.stringify({ version: 1, id, sources }, null, 2), '-->',
    '# 席位账单的调用、历史修改和当前修改', '',
    unsaved ? '本份讲解针对手动准备的未保存返回语句。先按使用说明修改编辑器，保持未保存，再打开本文件。' : '本份讲解针对工具实际生成的磁盘内容，可在选择演示项目后直接打开。', '',
  ];
  const ids = [];
  for (const step of steps) {
    const metadata = step.metadata;
    const sourceName = metadata.kind === 'file' ? metadata.source : metadata.right;
    if (sources[sourceName].kind === 'workspace') {
      const text = sourceName === 'charge-current' ? current : sourceName === 'invoice-current' ? invoice : formatter;
      const target = metadata.kind === 'file' ? metadata.target : metadata.targets.right;
      const formattingHash = target && javascriptFormatting(text)?.rangeSha256(target.startLine, target.endLine);
      if (formattingHash) target.formattingSha256 = formattingHash;
    }
    const stepId = crypto.randomUUID();
    ids.push(stepId);
    parts.push('<!-- step', JSON.stringify({ id: stepId, ...step.metadata }, null, 2), '-->', `## ${step.title}`, '', step.body, '');
  }
  return { id, stepIds: ids, markdown: parts.join('\n') };
}

function report(manifest, reused) {
  console.log(reused ? '已确认并保留现有验收工程；未覆盖文件、重建 Git 或改变现有修改。' : '已准备新的独立验收工程和两份讲解；尚未启动 VS Code 或执行界面验收。');
  console.log(`演示项目：${project}`);
  console.log(`磁盘内容讲解：${manifest.lectures.disk.path}`);
  console.log(`未保存内容讲解：${manifest.lectures.unsaved.path}`);
  console.log(`改前提交：${manifest.beforeCommit}`);
  console.log(`改后提交：${manifest.afterCommit}`);
  console.log('测试未保存内容前，请在演示项目的 src/charge.js 中把 return subtotal; 改为 return subtotal + 2;，保持未保存。');
  console.log(`记录位置：${manifestPath}`);
}

function prepareFormattingLecture(manifest) {
  const output = path.join(directory, 'lecture-formatting.md');
  if (fs.existsSync(output)) throw new Error(`格式验收讲解已存在，未覆盖：${output}`);
  const input = fs.readFileSync(manifest.lectures.unsaved.path, 'utf8');
  const lecture = parseExplanation(input);
  const texts = {};
  for (const [name, source] of Object.entries(lecture.sources)) {
    if (source.kind !== 'workspace' || !source.exists) continue;
    let text = normalize(fs.readFileSync(path.join(project, source.path), 'utf8'));
    if (source.path === manifest.unsavedEdit.path) {
      if (text.indexOf(manifest.unsavedEdit.find) < 0 || text.indexOf(manifest.unsavedEdit.find) !== text.lastIndexOf(manifest.unsavedEdit.find)) throw new Error('磁盘示例已变化，无法唯一准备预期未保存文本；未改写源码或讲解。');
      text = text.replace(manifest.unsavedEdit.find, manifest.unsavedEdit.replace);
    }
    if (digest(text) !== source.sha256) throw new Error(`${source.path} 与原讲解基准不符，未创建新讲解。`);
    texts[name] = text;
  }
  const header = JSON.parse(/^<!-- code-explanation\r?\n([\s\S]*?)\r?\n-->/.exec(input)[1]);
  header.id = crypto.randomUUID();
  for (const [name, text] of Object.entries(texts)) {
    const formatting = javascriptFormatting(text);
    if (formatting) header.sources[name].formattingSha256 = formatting.fileSha256;
  }
  const outputText = input.replace(/<!-- (code-explanation|step)\r?\n([\s\S]*?)\r?\n-->/g, (_block, kind, json) => {
    const value = kind === 'code-explanation' ? header : JSON.parse(json);
    if (kind === 'step') {
      const name = value.kind === 'file' ? value.source : value.right;
      const target = value.kind === 'file' ? value.target : value.targets.right;
      if (target && header.sources[name].formattingSha256) {
        const rangeHash = javascriptFormatting(texts[name])?.rangeSha256(target.startLine, target.endLine);
        if (rangeHash) target.formattingSha256 = rangeHash;
      }
    }
    return `<!-- ${kind}\n${JSON.stringify(value, null, 2)}\n-->`;
  });
  parseExplanation(outputText);
  fs.writeFileSync(output, outputText, { flag: 'wx' });
  console.log(`已另建格式变化验收讲解：${output}`);
  console.log('旧讲解、代码、Git 和编辑器未保存内容未修改；第 6 步仍要求 return subtotal + 2;，允许分号前增加空格。');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('先构建插件，再执行 node tools/prepare-acceptance.cjs 创建独立验收工程；--reuse 只检查并保留；--formatting 为已有工程另建 lecture-formatting.md，不改源码或旧讲解。');
    return;
  }
  if (args.some(arg => arg !== '--reuse' && arg !== '--formatting') || args.length > 1) throw new Error('只支持 --reuse、--formatting 或 --help 参数。');
  if (fs.existsSync(directory)) {
    if (!args.length) throw new Error(`验收目录已经存在，未覆盖任何文件。确认要保留并复用现有工程后，使用 --reuse：${directory}`);
    const saved = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (saved.version !== 1 || saved.kind !== 'code-explanation-acceptance' || !samePath(saved.projectRoot, project)) {
      throw new Error('现有目录没有匹配的验收记录，不能当作本工具生成的工程复用。');
    }
    for (const [kind, filename] of [['disk', 'lecture-disk.md'], ['unsaved', 'lecture-unsaved.md']]) {
      const lecture = saved.lectures?.[kind];
      const expected = path.join(directory, filename);
      if (!lecture || typeof lecture.path !== 'string' || !samePath(lecture.path, expected) || !fs.existsSync(expected)) {
        throw new Error(`现有验收记录没有匹配的 ${filename}，未修改任何文件。`);
      }
    }
    assertRepository();
    for (const commit of [saved.beforeCommit, saved.afterCommit]) {
      if (typeof commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) || git('cat-file', '-t', commit).trim() !== 'commit') throw new Error('现有验收记录中的提交无法确认，未修改任何文件。');
    }
    if (args.includes('--formatting')) prepareFormattingLecture(saved);
    else report(saved, true);
    return;
  }
  if (args.length) throw new Error('验收目录尚不存在，请先不带参数执行准备。');
  let ancestor = path.dirname(directory);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const relativeAncestor = path.relative(fs.realpathSync(repositoryRoot), fs.realpathSync(ancestor));
  if (relativeAncestor === '..' || relativeAncestor.startsWith('..' + path.sep) || path.isAbsolute(relativeAncestor)) throw new Error('验收目录的实际父目录不在当前插件项目内，停止准备。');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(hooks);
  git('init', '--initial-branch=main');
  assertRepository();
  write('package.json', JSON.stringify({ name: 'seat-invoice-acceptance', private: true, type: 'module' }, null, 2) + '\n');
  write('src/invoice.js', [
    "import { calculateCharge } from './charge.js';", '',
    'export function createInvoice(unitPrice, seats) {',
    '  const amount = calculateCharge(unitPrice, seats);',
    '  return { seats, amount };', '}', '',
  ].join('\n'));
  write('src/charge.js', ['export function calculateCharge(unitPrice, seats) {', '  return unitPrice * seats;', '}', ''].join('\n'));
  write('src/legacy-charge.js', ['export function legacyCharge(unitPrice, seats) {', '  return unitPrice * seats;', '}', ''].join('\n'));
  git('add', '--', 'package.json', 'src');
  git('commit', '-m', '建立席位账单和旧金额计算');
  const before = git('rev-parse', 'HEAD').trim();
  const revised = [
    'export function calculateCharge(unitPrice, seats) {',
    '  if (seats <= 0) {', '    return 0;', '  }', '',
    '  const subtotal = unitPrice * seats;', '  return subtotal;', '}', '',
  ].join('\n');
  fs.writeFileSync(path.join(project, 'src', 'charge.js'), revised);
  fs.unlinkSync(path.join(project, 'src', 'legacy-charge.js'));
  write('src/format-amount.js', ['export function formatAmount(amount) {', '  return `${amount.toFixed(2)} 元`;', '}', ''].join('\n'));
  git('add', '-A', '--', 'src');
  git('commit', '-m', '排除无效数量并加入金额格式化');
  const after = git('rev-parse', 'HEAD').trim();
  const staged = revised.replace('if (seats <= 0)', 'if (seats <= 0 || unitPrice < 0)');
  fs.writeFileSync(path.join(project, 'src', 'charge.js'), staged);
  git('add', '--', 'src/charge.js');
  const unstaged = staged.replace('const subtotal = unitPrice * seats;', 'const subtotal = Math.round(unitPrice * seats * 100) / 100;');
  fs.writeFileSync(path.join(project, 'src', 'charge.js'), unstaged);
  const actual = normalize(fs.readFileSync(path.join(project, 'src', 'charge.js'), 'utf8'));
  const unsavedEdit = { path: 'src/charge.js', find: 'return subtotal;', replace: 'return subtotal + 2;' };
  const editorText = actual.replace(unsavedEdit.find, unsavedEdit.replace);
  if (editorText === actual || actual.indexOf(unsavedEdit.find) !== actual.lastIndexOf(unsavedEdit.find)) throw new Error('不能唯一确定手动未保存修改的位置。');
  const diskLecture = makeLecture(before, after, actual, false);
  const unsavedLecture = makeLecture(before, after, editorText, true);
  const diskPath = path.join(directory, 'lecture-disk.md');
  const unsavedPath = path.join(directory, 'lecture-unsaved.md');
  fs.writeFileSync(diskPath, diskLecture.markdown, { flag: 'wx' });
  fs.writeFileSync(unsavedPath, unsavedLecture.markdown, { flag: 'wx' });
  const disk = {};
  for (const relative of git('ls-files', '-z').split('\0').filter(Boolean)) disk[relative] = digest(fs.readFileSync(path.join(project, relative)));
  const manifest = {
    version: 1, kind: 'code-explanation-acceptance', generatedAt: new Date().toISOString(), projectRoot: project,
    beforeCommit: before, afterCommit: after,
    lectures: {
      disk: { path: diskPath, id: diskLecture.id, stepIds: diskLecture.stepIds },
      unsaved: { path: unsavedPath, id: unsavedLecture.id, stepIds: unsavedLecture.stepIds },
    },
    unsavedEdit: { ...unsavedEdit, expectedSha256: digest(editorText) },
    baseline: {
      head: git('rev-parse', 'HEAD').trim(), status: git('status', '--porcelain=v1'), index: git('ls-files', '--stage'), disk,
      stagedDiffSha256: digest(git('diff', '--cached', '--no-ext-diff', '--binary')),
      unstagedDiffSha256: digest(git('diff', '--no-ext-diff', '--binary')),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  report(manifest, false);
}

try { main(); } catch (error) {
  console.error(`准备验收工程未完成：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
