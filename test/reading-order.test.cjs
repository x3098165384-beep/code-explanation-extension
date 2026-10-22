const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const path = require('node:path');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function document(id = 'lecture', revision = '原正文', steps = ['first', 'second']) {
  const hash = '0'.repeat(64);
  return JSON.stringify({ version: 2, id, title: '讲解', sources: { code: { kind: 'workspace', path: 'example.js', exists: true, sha256: hash } },
    steps: steps.map(step => ({ id: step, kind: 'file', title: step, body: revision, source: 'code', target: { startLine: 1, endLine: 1, sha256: hash } })) });
}

function environment() {
  const snapshots = [];
  const warnings = [];
  const errors = [];
  const files = new Map();
  const storage = new Map();
  const savedListeners = new Set();
  let beforeRead;
  let beforeResolve;
  let beforeCurrent;
  let sourceChanged;
  let clearCount = 0;
  class Uri {
    constructor(value) { this.fsPath = path.resolve(value); this.path = this.fsPath.replaceAll('\\', '/'); this.scheme = 'file'; }
    static file(value) { return new Uri(value); }
    static parse(value) { if (!value.startsWith('file://')) throw new Error('不是文件位置'); return new Uri(value.slice(7)); }
    static joinPath(uri, ...parts) { return new Uri(path.join(uri.fsPath, ...parts)); }
    toString() { return 'file://' + this.path; }
  }
  class CancellationTokenSource {
    constructor() { this.token = { isCancellationRequested: false }; }
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  }
  const disposable = () => ({ dispose() {} });
  const vscode = {
    Uri, CancellationTokenSource,
    EventEmitter: class {
      constructor() { this.listeners = new Set(); this.event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }; }
      fire(value) { for (const listener of this.listeners) listener(value); }
      dispose() { this.listeners.clear(); }
    },
    RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
    workspace: {
      workspaceFolders: [{ name: '项目', uri: Uri.file('test-project') }],
      fs: { async readFile(file) {
        const pending = beforeRead?.(file);
        if (pending) return Buffer.from(await pending);
        if (!files.has(file.toString())) throw new Error('文件暂时不可读');
        return Buffer.from(files.get(file.toString()));
      } },
      createFileSystemWatcher() { return { dispose() {}, onDidCreate: disposable, onDidChange: disposable, onDidDelete: disposable }; },
      onDidSaveTextDocument(callback) { savedListeners.add(callback); return { dispose() { savedListeners.delete(callback); } }; },
    },
    window: {
      onDidChangeActiveColorTheme: disposable,
      showWarningMessage(value) { warnings.push(value); return Promise.resolve(); },
      showErrorMessage(value) { errors.push(value); return Promise.resolve(); },
      showQuickPick() { return Promise.resolve(undefined); },
      showOpenDialog() { return Promise.resolve(undefined); },
    },
  };
  const sources = {
    watch(project, explanation, callback) { sourceChanged = callback; return { dispose() { if (sourceChanged === callback) sourceChanged = undefined; } }; },
    async resolve(project, explanation, step, token) {
      const pending = beforeResolve?.(explanation, step);
      if (pending) await pending;
      return { name: step.id };
    },
    async isCurrent(result, token) { return beforeCurrent ? await beforeCurrent(result) : true; },
  };
  const presentation = {
    clear() { clearCount++; snapshots.length = 0; },
    releaseBody() {}, hideNavigation() {}, setFileError() {}, updateNavigation() {}, updateBody() {},
    async show(resolved, explanation, step, index, token) { snapshots.push({ lecture: explanation.id, step: step.id, body: step.body, index }); },
    async showBody(file, explanation, step, token) { snapshots.push({ fallback: true, step: step.id, body: step.body }); },
  };
  const originalLoad = Module._load;
  let Reader;
  Module._load = function(name, parent, isMain) { return name === 'vscode' ? vscode : originalLoad.call(this, name, parent, isMain); };
  try {
    delete require.cache[require.resolve('../dist/reader.js')];
    Reader = require('../dist/reader.js').Reader;
  } finally { Module._load = originalLoad; }
  const reader = new Reader(sources, presentation, { get: key => storage.get(key), update: (key, value) => { storage.set(key, value); return Promise.resolve(); } });
  const file = Uri.file('test-project/lecture.json');
  files.set(file.toString(), document());
  return { reader, file, files, snapshots, warnings, errors, storage, Uri,
    setRead: value => { beforeRead = value; }, setResolve: value => { beforeResolve = value; }, setCurrent: value => { beforeCurrent = value; },
    sourceChange: () => sourceChanged?.(),
    save: () => { for (const listener of [...savedListeners]) listener({ uri: file }); },
    clearCount: () => clearCount,
  };
}

test('源码尚在读取时查看正文，不取消当前步骤的行内定位', async () => {
  const env = environment();
  const source = deferred();
  env.setResolve(() => source.promise);
  const opening = env.reader.open(env.file);
  await new Promise(resolve => setImmediate(resolve));
  await env.reader.showBody();
  source.resolve(); await opening;
  assert.equal(env.snapshots.at(-1).fallback, undefined);
  assert.equal(env.snapshots.at(-1).step, 'first');
  assert.deepEqual(env.errors, []);
  env.reader.dispose();
});

test('先点击的文件读取迟到，不进入最近讲解或覆盖继续目标', async () => {
  const env = environment();
  const pending = deferred();
  env.setRead(file => file.toString() === env.file.toString() ? pending.promise : undefined);
  const older = env.reader.open(env.file);
  await new Promise(resolve => setImmediate(resolve));
  const another = env.Uri.file('test-project/newest.json');
  env.files.set(another.toString(), document('newest'));
  await env.reader.open(another);
  pending.resolve(document()); await older;
  assert.deepEqual(env.reader.recentFiles(env.reader.position.project).map(file => file.toString()), [another.toString()]);
  assert.equal(env.reader.position.explanationId, 'newest');
  env.reader.dispose();
});

for (const outcome of ['success', 'failure']) {
  test(`连续保存：旧读取迟到的${outcome === 'success' ? '成功' : '失败'}不覆盖新正文`, async () => {
    const env = environment();
    await env.reader.open(env.file);
    const old = deferred();
    let next = true;
    env.setRead(() => { if (next) { next = false; return old.promise; } });
    const older = env.reader.refresh();
    env.files.set(env.file.toString(), document('lecture', '最新正文'));
    await env.reader.refresh();
    if (outcome === 'success') old.resolve(document('lecture', '过期正文')); else old.reject(new Error('过期读取失败'));
    await older;
    assert.equal(env.snapshots.length, 1);
    assert.equal(env.snapshots[0].body, '最新正文');
    assert.deepEqual(env.errors, []);
    env.reader.dispose();
  });

  test(`快速跳转：上一步迟到的${outcome === 'success' ? '成功' : '失败'}不能改变当前步骤`, async () => {
    const env = environment();
    const old = deferred();
    env.setResolve((lecture, step) => step.id === 'first' ? old.promise : undefined);
    const opening = env.reader.open(env.file);
    await new Promise(resolve => setImmediate(resolve));
    await env.reader.move(1);
    if (outcome === 'success') old.resolve(); else old.reject(new Error('旧步骤读取失败'));
    await opening;
    assert.equal(env.snapshots.length, 1);
    assert.equal(env.snapshots[0].step, 'second');
    assert.deepEqual(env.warnings, []);
    env.reader.dispose();
  });

  test(`替换讲解：旧文件迟到的${outcome === 'success' ? '成功' : '失败'}不能替换新讲解`, async () => {
    const env = environment();
    await env.reader.open(env.file);
    const old = deferred();
    env.setRead(file => file.toString() === env.file.toString() ? old.promise : undefined);
    const older = env.reader.refresh();
    const another = env.Uri.file('test-project/another.json');
    env.files.set(another.toString(), document('another', '另一份讲解'));
    await env.reader.open(another);
    if (outcome === 'success') old.resolve(document('lecture', '旧讲解')); else old.reject(new Error('旧文件失败'));
    await older;
    assert.equal(env.snapshots.length, 1);
    assert.equal(env.snapshots[0].lecture, 'another');
    assert.deepEqual(env.errors, []);
    env.reader.dispose();
  });

  test(`停止：已保存文件读取迟到的${outcome === 'success' ? '成功' : '失败'}不能重启阅读`, async () => {
    const env = environment();
    await env.reader.open(env.file);
    const old = deferred();
    env.setRead(() => old.promise);
    const pending = env.reader.refresh();
    env.reader.stop();
    if (outcome === 'success') old.resolve(document()); else old.reject(new Error('停止后的旧错误'));
    await pending;
    env.save();
    env.sourceChange();
    assert.deepEqual(env.snapshots, []);
    assert.deepEqual(env.errors, []);
    assert.deepEqual(env.warnings, []);
    env.reader.dispose();
  });

  test(`停止：源码读取迟到的${outcome === 'success' ? '成功' : '失败'}不能恢复正文`, async () => {
    const env = environment();
    const old = deferred();
    env.setResolve(() => old.promise);
    const pending = env.reader.open(env.file);
    await new Promise(resolve => setImmediate(resolve));
    env.reader.stop();
    if (outcome === 'success') old.resolve(); else old.reject(new Error('迟到源码错误'));
    await pending;
    assert.deepEqual(env.snapshots, []);
    assert.deepEqual(env.warnings, []);
    env.reader.dispose();
  });
}

test('显示前的内容确认迟到时，停止仍阻止显示', async () => {
  const env = environment();
  const pendingCheck = deferred();
  env.setCurrent(() => pendingCheck.promise);
  const opening = env.reader.open(env.file);
  await new Promise(resolve => setImmediate(resolve));
  env.reader.stop();
  pendingCheck.resolve(true);
  await opening;
  assert.deepEqual(env.snapshots, []);
  env.reader.dispose();
});

test('当前源码尚未读完时打开无效讲解，仍恢复已经接受的讲解', async () => {
  const env = environment();
  const old = deferred();
  let first = true;
  env.setResolve(() => { if (first) { first = false; return old.promise; } });
  const opening = env.reader.open(env.file);
  await new Promise(resolve => setImmediate(resolve));
  const invalid = env.Uri.file('test-project/invalid.json');
  env.files.set(invalid.toString(), '还没有写完的讲解');
  await env.reader.open(invalid);
  old.resolve();
  await opening;
  assert.equal(env.snapshots.length, 1);
  assert.equal(env.snapshots[0].lecture, 'lecture');
  assert.equal(env.snapshots[0].step, 'first');
  assert.equal(env.errors.length, 1);
  env.reader.dispose();
});

test('打开另一份讲解期间，旧源码变化不能取消新的打开操作', async () => {
  const env = environment();
  await env.reader.open(env.file);
  const another = env.Uri.file('test-project/another.json');
  const pending = deferred();
  env.setRead(file => file.toString() === another.toString() ? pending.promise : undefined);
  const opening = env.reader.open(another);
  await new Promise(resolve => setImmediate(resolve));
  env.sourceChange();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(env.snapshots, []);
  pending.resolve(document('another', '另一份讲解'));
  await opening;
  assert.equal(env.snapshots.length, 1);
  assert.equal(env.snapshots[0].lecture, 'another');
  env.reader.dispose();
});

test('新讲解读取失败后重新检查旧讲解期间收到的更新', async () => {
  const env = environment();
  await env.reader.open(env.file);
  const another = env.Uri.file('test-project/another.json');
  const pending = deferred();
  env.setRead(file => file.toString() === another.toString() ? pending.promise : undefined);
  const opening = env.reader.open(another);
  await new Promise(resolve => setImmediate(resolve));
  env.files.set(env.file.toString(), document('lecture', '等待期间保存的新正文'));
  env.sourceChange();
  await new Promise(resolve => setImmediate(resolve));
  pending.resolve('没有写完的新讲解');
  await opening;
  assert.equal(env.errors.length, 1);
  assert.equal(env.snapshots[0].body, '等待期间保存的新正文');
  env.reader.dispose();
});
