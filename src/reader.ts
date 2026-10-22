import * as vscode from 'vscode';
import { normalizeText, parseExplanation, sha256 } from './explanation';
import type { Explanation } from './model';
import { Presentation } from './presentation';
import { SourceReader } from './sources';

interface Reading {
  project: vscode.Uri;
  file: vscode.Uri;
  explanation: Explanation;
  index: number;
  fileError?: string;
  subscriptions: vscode.Disposable[];
}

type ReadingOperation = vscode.CancellationTokenSource & { kind: 'opening' | 'reading' };

export interface OpenLocation {
  project: vscode.Uri;
  explanationId?: string;
  stepId?: string;
}

export interface ReadingPosition {
  project: vscode.Uri;
  file: vscode.Uri;
  explanationId: string;
  stepId: string;
  index: number;
  total: number;
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  const a = left.toString();
  const b = right.toString();
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeExplanation(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('讲解文件不是有效的 UTF-8 文本，请按 UTF-8 编码重新保存。'); }
}

export class Reader implements vscode.Disposable {
  private reading?: Reading;
  private operation?: ReadingOperation;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeReading = this.changed.event;
  private readonly opened = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidOpenExplanation = this.opened.event;

  constructor(
    private readonly sources: SourceReader,
    private readonly presentation: Presentation,
    private readonly progress: vscode.Memento,
  ) {}

  get position(): ReadingPosition | undefined {
    const reading = this.reading;
    if (!reading) return undefined;
    return { project: reading.project, file: reading.file, explanationId: reading.explanation.id,
      stepId: reading.explanation.steps[reading.index].id, index: reading.index, total: reading.explanation.steps.length };
  }

  savedStep(project: vscode.Uri, file: vscode.Uri, explanationId: string): string | undefined {
    return this.progress.get<string>(this.progressKey(project, file, explanationId));
  }

  private recentKey(project: vscode.Uri): string {
    const location = process.platform === 'win32' ? project.toString().toLowerCase() : project.toString();
    return 'codeExplanation.recent.' + sha256(location);
  }

  recentFiles(project: vscode.Uri): vscode.Uri[] {
    const stored = this.progress.get<unknown>(this.recentKey(project));
    if (!Array.isArray(stored)) return [];
    const files: vscode.Uri[] = [];
    for (const value of stored) {
      if (typeof value !== 'string') continue;
      try {
        const file = vscode.Uri.parse(value);
        if (file.scheme === 'file' && !files.some(previous => sameUri(previous, file))) files.push(file);
      } catch { /* 忽略无法还原为文件位置的记录。 */ }
      if (files.length === 20) break;
    }
    return files;
  }

  private remember(project: vscode.Uri, file: vscode.Uri): void {
    const files = [file, ...this.recentFiles(project).filter(previous => !sameUri(previous, file))].slice(0, 20);
    void this.progress.update(this.recentKey(project), files.map(value => value.toString())).then(undefined, error => {
      console.warn(`无法保存项目“${project.fsPath}”的最近讲解：${message(error)}`);
    });
    this.opened.fire(project);
  }

  private begin(kind: ReadingOperation['kind'] = 'reading'): ReadingOperation {
    this.operation?.cancel();
    this.operation?.dispose();
    const operation = Object.assign(new vscode.CancellationTokenSource(), { kind });
    this.operation = operation;
    return operation;
  }

  private current(operation: vscode.CancellationTokenSource): boolean {
    return this.operation === operation && !operation.token.isCancellationRequested;
  }

  private progressKey(project: vscode.Uri, file: vscode.Uri, explanationId: string): string {
    const location = (uri: vscode.Uri): string => process.platform === 'win32' ? uri.toString().toLowerCase() : uri.toString();
    return 'codeExplanation.progress.' + sha256([location(project), location(file), explanationId].join('\0'));
  }

  private saveProgress(reading: Reading): void {
    const step = reading.explanation.steps[reading.index];
    const title = reading.explanation.title;
    void this.progress.update(this.progressKey(reading.project, reading.file, reading.explanation.id), step.id).then(undefined, error => {
      console.warn(`无法保存讲解“${title}”的阅读进度：${message(error)}`);
    });
  }

  private subscribe(reading: Reading): void {
    for (const subscription of reading.subscriptions) subscription.dispose();
    reading.subscriptions = [];
    const changed = (): void => {
      if (this.reading !== reading) return;
      if (this.operation?.kind === 'opening') this.presentation.clear();
      else void this.refresh();
    };
    reading.subscriptions.push(this.sources.watch(reading.project, reading.explanation, changed));
    reading.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(changed));
    const parent = vscode.Uri.joinPath(reading.file, '..');
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, '*'));
    const savedFileChanged = (uri: vscode.Uri): void => {
      if (sameUri(uri, reading.file)) changed();
    };
    reading.subscriptions.push(watcher, watcher.onDidCreate(savedFileChanged), watcher.onDidChange(savedFileChanged), watcher.onDidDelete(savedFileChanged));
    reading.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
      if (sameUri(document.uri, reading.file)) changed();
    }));
  }

  private async readSaved(file: vscode.Uri): Promise<Explanation> {
    if (!file.path.toLowerCase().endsWith('.json')) throw new Error('请选择版本 2 JSON 讲解文件；旧 Markdown 需要由 agent 转换后再打开。');
    const bytes = await vscode.workspace.fs.readFile(file);
    const text = decodeExplanation(bytes);
    return parseExplanation(text);
  }

  async open(file?: vscode.Uri, location?: OpenLocation): Promise<void> {
    const operation = this.begin('opening');
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        void vscode.window.showWarningMessage('请先在 VS Code 中打开项目文件夹，再打开讲解。代码路径将相对所选项目解析。');
        return;
      }
      const folder = location ? folders.find(value => sameUri(value.uri, location.project)) : folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
        folders.map(value => ({ label: value.name, description: value.uri.fsPath, folder: value })),
        { title: '选择讲解所对应的项目' }, operation.token,
      ).then(value => value?.folder);
      if (!this.current(operation)) return;
      if (!folder) {
        if (location) void vscode.window.showWarningMessage(`讲解所属项目“${location.project.fsPath}”已不在当前窗口中，请重新打开该项目。`);
        return;
      }
      if (folder.uri.scheme !== 'file') {
        void vscode.window.showWarningMessage('首版需要打开本机项目文件夹，才能读取本地文件和 Git 历史。');
        return;
      }
      const chosen = file ?? (await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { 'JSON 讲解文件': ['json'] }, title: '选择已保存的 JSON 讲解文件' }))?.[0];
      if (!this.current(operation)) return;
      if (!chosen) {
        return;
      }
      try {
        const explanation = await this.readSaved(chosen);
        if (!this.current(operation)) return;
        if (location?.explanationId && explanation.id !== location.explanationId) throw new Error('讲解标识已更改，请在更新后的列表中重新选择。');
        if (location?.stepId && !explanation.steps.some(step => step.id === location.stepId)) throw new Error('所选步骤已被删除，请在更新后的列表中重新选择。');
        operation.kind = 'reading';
        const previous = this.reading;
        if (previous) {
          this.saveProgress(previous);
          for (const subscription of previous.subscriptions) subscription.dispose();
        }
        this.presentation.clear();
        const reading: Reading = { project: folder.uri, file: chosen, explanation, index: 0, subscriptions: [] };
        const saved = location?.stepId ?? this.savedStep(reading.project, reading.file, explanation.id);
        const index = explanation.steps.findIndex(step => step.id === saved);
        if (index >= 0) reading.index = index;
        this.reading = reading;
        this.presentation.setFileError();
        this.subscribe(reading);
        this.saveProgress(reading);
        this.remember(reading.project, reading.file);
        await this.display(reading, operation);
      } catch (error) {
        if (!this.current(operation)) return;
        void vscode.window.showErrorMessage(`无法打开讲解“${chosen.fsPath}”：${message(error)}`);
      }
    } finally {
      if (this.current(operation) && operation.kind === 'opening') {
        operation.kind = 'reading';
        if (this.reading) await this.refresh();
      }
    }
  }

  async refresh(): Promise<void> {
    const reading = this.reading;
    if (!reading) return;
    const operation = this.begin();
    this.presentation.clear();
    try {
      const bytes = await vscode.workspace.fs.readFile(reading.file);
      if (!this.current(operation)) return;
      const text = decodeExplanation(bytes);
      if (normalizeText(text) !== reading.explanation.text) {
        const explanation = parseExplanation(text);
        const previous = reading.explanation;
        const stepId = previous.steps[reading.index].id;
        this.saveProgress(reading);
        reading.explanation = explanation;
        reading.index = explanation.id === previous.id ? Math.max(0, explanation.steps.findIndex(step => step.id === stepId)) : 0;
        this.subscribe(reading);
        this.saveProgress(reading);
      }
      reading.fileError = undefined;
    } catch (error) {
      if (!this.current(operation)) return;
      reading.fileError = `新内容尚未加载，继续使用上一次成功加载的讲解。文件“${reading.file.fsPath}”：${message(error)}`;
    }
    if (!this.current(operation)) return;
    this.presentation.setFileError(reading.fileError);
    await this.display(reading, operation);
  }

  private async display(reading: Reading, operation: vscode.CancellationTokenSource): Promise<void> {
    if (!this.current(operation)) return;
    const step = reading.explanation.steps[reading.index];
    this.changed.fire();
    this.presentation.updateBody(reading.file, reading.explanation, step, reading.fileError);
    this.presentation.updateNavigation(reading.explanation, reading.index, undefined, true);
    try {
      const resolved = await this.sources.resolve(reading.project, reading.explanation, step, operation.token);
      if (!this.current(operation)) return;
      if (!await this.sources.isCurrent(resolved, operation.token)) {
        if (this.current(operation)) void this.refresh();
        return;
      }
      if (!this.current(operation)) return;
      await this.presentation.show(resolved, reading.explanation, step, reading.index, operation.token, reading.file);
      if (!this.current(operation)) return;
      if (!await this.sources.isCurrent(resolved, operation.token)) {
        if (this.current(operation)) {
          this.presentation.clear();
          void this.refresh();
        }
        return;
      }
      if (this.current(operation)) this.presentation.updateNavigation(reading.explanation, reading.index);
    } catch (error) {
      if (!this.current(operation)) return;
      this.presentation.clear();
      const reason = `步骤“${step.title}”无法定位：${message(error)}`;
      this.presentation.updateNavigation(reading.explanation, reading.index, reason);
      void vscode.window.showWarningMessage(reason);
      try {
        await this.presentation.showBody(reading.file, reading.explanation, step, operation.token, reading.fileError);
      } catch (bodyError) {
        if (this.current(operation)) void vscode.window.showErrorMessage(`无法显示步骤正文：${message(bodyError)}`);
      }
    }
  }

  async move(offset: number): Promise<void> {
    const reading = this.reading;
    if (!reading) return;
    const next = reading.index + offset;
    if (next < 0 || next >= reading.explanation.steps.length) return;
    reading.index = next;
    this.saveProgress(reading);
    await this.refresh();
  }

  async select(): Promise<void> {
    const reading = this.reading;
    if (!reading) return;
    const explanation = reading.explanation;
    const item = await vscode.window.showQuickPick(explanation.steps.map((step, index) => ({ label: `${index + 1}. ${step.title}`, description: step.id, id: step.id })), { title: '选择讲解步骤' });
    if (!item || this.reading !== reading || reading.explanation !== explanation) return;
    const index = explanation.steps.findIndex(step => step.id === item.id);
    if (index < 0) return;
    reading.index = index;
    this.saveProgress(reading);
    await this.refresh();
  }

  async showBody(): Promise<void> {
    const reading = this.reading;
    const operation = this.operation;
    if (!reading || !operation) return;
    try {
      await this.presentation.showBody(reading.file, reading.explanation, reading.explanation.steps[reading.index], operation.token, reading.fileError);
    } catch (error) {
      if (this.current(operation)) void vscode.window.showErrorMessage(`无法显示步骤正文：${message(error)}`);
    }
  }

  stop(): void {
    this.operation?.cancel();
    this.operation?.dispose();
    this.operation = undefined;
    const reading = this.reading;
    this.reading = undefined;
    if (reading) {
      this.saveProgress(reading);
      for (const subscription of reading.subscriptions) subscription.dispose();
      reading.subscriptions = [];
    }
    this.presentation.clear();
    this.presentation.releaseBody();
    this.presentation.hideNavigation();
    this.presentation.setFileError();
    this.changed.fire();
  }

  dispose(): void { this.stop(); this.changed.dispose(); this.opened.dispose(); }
}
