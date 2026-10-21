import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { checkTarget, normalizeText, sha256 } from './explanation';
import type { CodeSnapshot, Explanation, ResolvedStep, Source, Step, Target } from './model';

const scheme = 'code-explanation-source';

interface VirtualSource {
  project: string;
  path: string;
  kind: 'git' | 'workspace';
  exists: boolean;
  repository?: string;
  commit?: string;
  side?: 'left' | 'right';
}

interface ReadSource {
  snapshot: CodeSnapshot;
  repository?: string;
}

function cancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) throw new vscode.CancellationError();
}

function pathKey(value: string): string {
  const absolute = path.resolve(value);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function isWithin(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function notFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sourcePath(project: vscode.Uri, relative: string): Promise<string> {
  if (project.scheme !== 'file') throw new Error('当前只支持本机项目，请先在 VS Code 中打开本机项目文件夹。');
  if (!relative || relative.includes('\\') || /[\u0000-\u001f\u007f]/.test(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes(':')) {
    throw new Error(`代码路径 ${relative} 必须是项目内使用 / 分隔的相对文件路径。`);
  }
  const root = path.resolve(project.fsPath);
  const full = path.resolve(root, relative);
  if (!isWithin(root, full) || pathKey(root) === pathKey(full)) throw new Error(`代码路径 ${relative} 超出了所选项目。`);
  const physicalRoot = await fs.realpath(root);
  let ancestor = full;
  while (true) {
    try {
      const physical = await fs.realpath(ancestor);
      if (!isWithin(physicalRoot, physical)) throw new Error(`代码路径 ${relative} 通过符号链接指向了所选项目以外，不能读取。`);
      return full;
    } catch (error) {
      if (!notFound(error)) throw error;
      try {
        const entry = await fs.lstat(ancestor);
        if (entry.isSymbolicLink()) throw new Error(`代码路径 ${relative} 包含目标无法读取的符号链接，不能把它当成不存在的文件。`);
      } catch (entryError) {
        if (!notFound(entryError)) throw entryError;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor || !isWithin(root, parent)) throw new Error(`无法确认代码路径 ${relative} 位于所选项目内。`);
      ancestor = parent;
    }
  }
}

function openDocument(fullPath: string): vscode.TextDocument | undefined {
  const documents = vscode.workspace.textDocuments.filter(document => !document.isClosed && (document.uri.scheme === 'file' || document.uri.scheme === 'untitled') && path.isAbsolute(document.uri.fsPath) && pathKey(document.uri.fsPath) === pathKey(fullPath));
  return documents.find(document => document.uri.scheme === 'file') ?? documents[0];
}

async function workspaceExists(fullPath: string): Promise<boolean> {
  if (openDocument(fullPath)) return true;
  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) throw new Error(`代码路径 ${fullPath} 不是文件。`);
    return true;
  } catch (error) {
    if (notFound(error)) return false;
    throw error;
  }
}

function git(cwd: string, args: string[], token: vscode.CancellationToken): Promise<Buffer> {
  cancelled(token);
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete env[key];
    let subscription: vscode.Disposable | undefined;
    const child = execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { windowsHide: true, env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      subscription?.dispose();
      if (token.isCancellationRequested) reject(new vscode.CancellationError());
      else if (error) reject(new Error(`Git 读取失败：${stderr.toString('utf8').trim() || error.message}`));
      else resolve(stdout);
    });
    subscription = token.onCancellationRequested(() => { child.kill(); });
    if (token.isCancellationRequested) child.kill();
  });
}

function utf8(bytes: Uint8Array, object: string): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`${object} 不是可读取的 UTF-8 文本。`); }
}

async function repositoryFor(fullPath: string, token: vscode.CancellationToken): Promise<string> {
  let directory = path.dirname(fullPath);
  while (true) {
    cancelled(token);
    try {
      if ((await fs.stat(directory)).isDirectory()) break;
    } catch (error) {
      if (!notFound(error)) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`找不到代码路径 ${fullPath} 所属的本地 Git 仓库。`);
    directory = parent;
  }
  try {
    const root = utf8(await git(directory, ['rev-parse', '--show-toplevel'], token), 'Git 仓库位置').trim();
    const physicalRoot = await fs.realpath(root);
    if (!isWithin(physicalRoot, await fs.realpath(directory))) throw new Error('Git 返回的仓库位置不包含代码目录。');
    return physicalRoot;
  } catch (error) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    throw new Error(`无法确定 ${fullPath} 所属的本地 Git 仓库：${message(error)}`);
  }
}

async function gitPath(repository: string, fullPath: string): Promise<string> {
  let ancestor = path.dirname(fullPath);
  while (true) {
    try {
      const physical = await fs.realpath(ancestor);
      const physicalFile = path.resolve(physical, path.relative(ancestor, fullPath));
      if (!isWithin(repository, physicalFile)) throw new Error(`代码路径 ${fullPath} 不属于 Git 仓库 ${repository}。`);
      return path.relative(repository, physicalFile).split(path.sep).join('/');
    } catch (error) {
      if (!notFound(error)) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw new Error(`无法确认 ${fullPath} 在 Git 仓库中的路径。`);
      ancestor = parent;
    }
  }
}

async function readGit(repository: string, commit: string, relative: string, expectedExists: boolean, token: vscode.CancellationToken): Promise<string> {
  if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(commit)) throw new Error(`Git 提交 ${commit} 不是完整提交标识。`);
  let type: string;
  try { type = utf8(await git(repository, ['cat-file', '-t', commit], token), 'Git 对象类型').trim(); }
  catch (error) {
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    throw new Error(`无法读取 Git 提交 ${commit}：${message(error)}`);
  }
  if (type !== 'commit') throw new Error(`Git 对象 ${commit} 不是提交，不能作为讲解版本。`);
  const entries = utf8(await git(repository, ['ls-tree', '-z', '--full-tree', commit, '--', `:(literal)${relative}`], token), 'Git 文件目录').split('\0').filter(Boolean);
  const entry = entries.find(value => value.slice(value.indexOf('\t') + 1) === relative);
  if (!entry) {
    if (expectedExists) throw new Error(`Git 提交 ${commit} 中不存在文件 ${relative}。`);
    return '';
  }
  if (!expectedExists) throw new Error(`Git 提交 ${commit} 中实际存在 ${relative}，不能显示为空白一侧。`);
  if (!/^\d+ blob [0-9a-f]+\t/.test(entry)) throw new Error(`Git 提交 ${commit} 中的 ${relative} 不是普通文件内容。`);
  return utf8(await git(repository, ['cat-file', 'blob', `${commit}:${relative}`], token), `Git 提交 ${commit} 中的 ${relative}`);
}

function virtualUri(value: VirtualSource): vscode.Uri {
  return vscode.Uri.from({ scheme, authority: value.kind === 'git' ? value.commit!.toLowerCase() : 'workspace', path: '/' + value.path, query: JSON.stringify(value) });
}

function virtualSource(uri: vscode.Uri): VirtualSource {
  let value: unknown;
  try { value = JSON.parse(uri.query); } catch { throw new Error('讲解的只读代码地址无效，请重新打开对应步骤。'); }
  if (!value || typeof value !== 'object') throw new Error('讲解的只读代码地址缺少代码引用信息。');
  const source = value as VirtualSource;
  if (typeof source.project !== 'string' || typeof source.path !== 'string' || typeof source.exists !== 'boolean' || (source.kind !== 'git' && source.kind !== 'workspace') || (source.kind === 'git' && (typeof source.repository !== 'string' || typeof source.commit !== 'string')) || (source.kind === 'workspace' && source.exists)) {
    throw new Error('讲解的只读代码地址包含无效的项目、版本或存在状态。');
  }
  return source;
}

export class SourceReader implements vscode.Disposable {
  private readonly provider: vscode.Disposable;

  constructor() {
    this.provider = vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent: async (uri, token) => {
        const source = virtualSource(uri);
        const full = await sourcePath(vscode.Uri.file(source.project), source.path);
        cancelled(token);
        if (source.kind === 'workspace') {
          if (await workspaceExists(full)) throw new Error(`当前文件 ${source.path} 已存在，不能继续显示为空白一侧。`);
          return '';
        }
        const repository = await repositoryFor(full, token);
        if (pathKey(repository) !== pathKey(source.repository!)) throw new Error(`代码路径 ${source.path} 所属仓库已变化，请重新打开步骤。`);
        return readGit(repository, source.commit!, await gitPath(repository, full), source.exists, token);
      },
    });
  }

  async resolve(project: vscode.Uri, explanation: Explanation, step: Step, token: vscode.CancellationToken): Promise<ResolvedStep> {
    cancelled(token);
    const targets: ResolvedStep['targets'] = [];
    const notices: string[] = [];
    const targetFor = (source: Source, snapshot: CodeSnapshot, target: Target, side: 'file' | 'left' | 'right') => {
      const result = checkTarget(source, snapshot.document.getText(), target);
      const start = result.startLine - 1;
      const end = result.endLine - 1;
      targets.push({ side, range: new vscode.Range(start, 0, end, snapshot.document.lineAt(end).text.length) });
      if (result.notice) notices.push(result.notice);
    };
    if (step.kind === 'file') {
      const source = explanation.sources[step.source];
      const read = await this.readSource(project, source, token);
      cancelled(token);
      targetFor(source, read.snapshot, step.target, 'file');
      return { kind: 'file', right: read.snapshot, targets, notices };
    }
    const leftSource = explanation.sources[step.left];
    const rightSource = explanation.sources[step.right];
    const left = await this.readSource(project, leftSource, token, 'left');
    const right = await this.readSource(project, rightSource, token, 'right');
    cancelled(token);
    const leftRepository = left.repository ?? await repositoryFor(await sourcePath(project, leftSource.path), token);
    const rightRepository = right.repository ?? await repositoryFor(await sourcePath(project, rightSource.path), token);
    if (pathKey(leftRepository) !== pathKey(rightRepository)) throw new Error(`diff 的 ${leftSource.path} 和 ${rightSource.path} 不属于同一个 Git 仓库。`);
    let expectedHead: ResolvedStep['expectedHead'];
    if (step.comparison === 'working-tree') {
      if (leftSource.kind !== 'git') throw new Error('未提交修改的改前侧必须引用生成讲解时的 Git 提交。');
      const head = utf8(await git(leftRepository, ['rev-parse', '--verify', 'HEAD'], token), '当前 Git 提交').trim();
      if (head.toLowerCase() !== leftSource.commit.toLowerCase()) throw new Error(`未提交修改的基准已变化：讲解记录 ${leftSource.commit}，当前 HEAD 为 ${head}。请让生成讲解的工具更新本步引用。`);
      expectedHead = { repository: leftRepository, commit: leftSource.commit };
    }
    if (step.targets.left) targetFor(leftSource, left.snapshot, step.targets.left, 'left');
    if (step.targets.right) targetFor(rightSource, right.snapshot, step.targets.right, 'right');
    cancelled(token);
    return { kind: 'diff', left: left.snapshot, right: right.snapshot, targets, notices, expectedHead };
  }

  async isCurrent(resolved: ResolvedStep, token: vscode.CancellationToken): Promise<boolean> {
    cancelled(token);
    for (const snapshot of [resolved.left, resolved.right]) {
      if (!snapshot) continue;
      if (snapshot.uri.scheme === scheme) {
        const source = virtualSource(snapshot.uri);
        if (source.kind === 'workspace') {
          try {
            if (await workspaceExists(await sourcePath(vscode.Uri.file(source.project), source.path))) return false;
          } catch { return false; }
        }
      }
    }
    if (resolved.expectedHead) {
      try {
        const head = utf8(await git(resolved.expectedHead.repository, ['rev-parse', '--verify', 'HEAD'], token), '当前 Git 提交').trim();
        if (head.toLowerCase() !== resolved.expectedHead.commit.toLowerCase()) return false;
      } catch (error) {
        if (token.isCancellationRequested) throw error;
        return false;
      }
    }
    cancelled(token);
    return [resolved.left, resolved.right].every(snapshot => !snapshot || (
      !snapshot.document.isClosed && snapshot.document.version === snapshot.version &&
      ((snapshot.uri.scheme !== 'file' && snapshot.uri.scheme !== 'untitled') || openDocument(snapshot.uri.fsPath) === snapshot.document)
    ));
  }

  watch(project: vscode.Uri, explanation: Explanation, onChange: () => void): vscode.Disposable {
    const cancellation = new vscode.CancellationTokenSource();
    const subscriptions: vscode.Disposable[] = [cancellation];
    const files = new Set(Object.values(explanation.sources).map(source => pathKey(path.resolve(project.fsPath, source.path))));
    const relevant = (uri: vscode.Uri) => (uri.scheme === 'file' || uri.scheme === 'untitled') && files.has(pathKey(uri.fsPath));
    const affectsFile = (uri: vscode.Uri) => uri.scheme === 'file' && [...files].some(file => isWithin(pathKey(uri.fsPath), file));
    subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length && relevant(event.document.uri)) onChange(); }));
    subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => { if (document.isUntitled && relevant(document.uri)) onChange(); }));
    subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => { if (relevant(document.uri)) onChange(); }));
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project, '**/*'));
    subscriptions.push(watcher, watcher.onDidCreate(uri => { if (affectsFile(uri)) onChange(); }), watcher.onDidChange(uri => { if (relevant(uri)) onChange(); }), watcher.onDidDelete(uri => { if (affectsFile(uri)) onChange(); }));
    subscriptions.push(vscode.workspace.onDidCreateFiles(event => { if (event.files.some(affectsFile)) onChange(); }));
    subscriptions.push(vscode.workspace.onDidDeleteFiles(event => { if (event.files.some(affectsFile)) onChange(); }));
    subscriptions.push(vscode.workspace.onDidRenameFiles(event => { if (event.files.some(file => affectsFile(file.oldUri) || affectsFile(file.newUri))) onChange(); }));
    const gitDirectories = new Set<string>();
    const repositories = new Set<string>();
    const watchDirectory = (directory: string) => {
      if (gitDirectories.has(pathKey(directory)) || cancellation.token.isCancellationRequested) return;
      gitDirectories.add(pathKey(directory));
      for (const pattern of ['{HEAD,index,packed-refs,commondir,config}', 'refs/**']) {
        const gitWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(directory), pattern));
        subscriptions.push(gitWatcher, gitWatcher.onDidCreate(onChange), gitWatcher.onDidChange(onChange), gitWatcher.onDidDelete(onChange));
      }
    };
    void (async () => {
      for (const source of Object.values(explanation.sources)) {
        if (cancellation.token.isCancellationRequested) return;
        try {
          const repository = await repositoryFor(await sourcePath(project, source.path), cancellation.token);
          if (repositories.has(pathKey(repository))) continue;
          repositories.add(pathKey(repository));
          const gitDirectory = utf8(await git(repository, ['rev-parse', '--absolute-git-dir'], cancellation.token), 'Git 元数据目录').trim();
          const commonDirectory = utf8(await git(repository, ['rev-parse', '--git-common-dir'], cancellation.token), 'Git 共享元数据目录').trim();
          watchDirectory(path.resolve(repository, gitDirectory));
          watchDirectory(path.resolve(repository, commonDirectory));
        } catch {
          if (cancellation.token.isCancellationRequested) return;
          // 无法读取的仓库由打开步骤时的读取流程说明，不把订阅建立失败误报为文件不存在。
        }
      }
      if (!cancellation.token.isCancellationRequested) onChange();
    })();
    return new vscode.Disposable(() => {
      cancellation.cancel();
      for (const subscription of subscriptions) subscription.dispose();
      subscriptions.length = 0;
    });
  }

  dispose(): void {
    this.provider.dispose();
  }

  private async readSource(project: vscode.Uri, source: Source, token: vscode.CancellationToken, side?: 'left' | 'right'): Promise<ReadSource> {
    try {
      const full = await sourcePath(project, source.path);
      cancelled(token);
      if (source.kind === 'workspace') {
        const exists = await workspaceExists(full);
        if (exists !== source.exists) throw new Error(exists ? '当前编辑器或磁盘中实际存在该文件，不能显示为空白一侧。' : '当前编辑器和磁盘中均不存在该文件。');
        const uri = exists ? (openDocument(full)?.uri ?? vscode.Uri.file(full)) : virtualUri({ project: project.fsPath, path: source.path, kind: 'workspace', exists: false });
        const document = await vscode.workspace.openTextDocument(uri);
        cancelled(token);
        return { snapshot: { uri: document.uri, document, version: document.version } };
      }
      const repository = await repositoryFor(full, token);
      const relative = await gitPath(repository, full);
      const text = await readGit(repository, source.commit, relative, source.exists, token);
      if (source.exists && sha256(normalizeText(text)) !== source.sha256) throw new Error(`指定 Git 提交 ${source.commit} 的文件摘要与讲解记录不符，请更新代码引用。`);
      const uri = virtualUri({ project: project.fsPath, path: source.path, kind: 'git', exists: source.exists, repository, commit: source.commit, side });
      const document = await vscode.workspace.openTextDocument(uri);
      cancelled(token);
      if (normalizeText(document.getText()) !== normalizeText(text)) throw new Error('只读编辑器内容与本次实际读取的 Git 内容不同，不能使用旧文本显示讲解。');
      return { snapshot: { uri: document.uri, document, version: document.version }, repository };
    } catch (error) {
      if (token.isCancellationRequested || error instanceof vscode.CancellationError) throw new vscode.CancellationError();
      throw new Error(`无法读取代码 ${source.path}：${message(error)}`);
    }
  }
}
