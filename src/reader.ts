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

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  const a = left.toString();
  const b = right.toString();
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeMarkdown(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('讲解文件不是有效的 UTF-8 文本，请按 UTF-8 编码重新保存。'); }
}

export class Reader implements vscode.Disposable {
  private reading?: Reading;
  private operation?: ReadingOperation;

  constructor(
    private readonly sources: SourceReader,
    private readonly presentation: Presentation,
    private readonly progress: vscode.Memento,
  ) {}

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

  private progressKey(reading: Reading): string {
    const location = (uri: vscode.Uri): string => process.platform === 'win32' ? uri.toString().toLowerCase() : uri.toString();
    return 'codeExplanation.progress.' + sha256([location(reading.project), location(reading.file), reading.explanation.id].join('\0'));
  }

  private saveProgress(reading: Reading): void {
    const step = reading.explanation.steps[reading.index];
    const title = reading.explanation.title;
    void this.progress.update(this.progressKey(reading), step.id).then(undefined, error => {
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
    if (!file.path.toLowerCase().endsWith('.md')) throw new Error('请选择按讲解文件格式生成的 .md 文件。');
    const bytes = await vscode.workspace.fs.readFile(file);
    const text = decodeMarkdown(bytes);
    return parseExplanation(text);
  }

  async open(file?: vscode.Uri): Promise<void> {
    const operation = this.begin('opening');
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        void vscode.window.showWarningMessage('请先在 VS Code 中打开项目文件夹，再打开讲解。代码路径将相对所选项目解析。');
        return;
      }
      const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
        folders.map(value => ({ label: value.name, description: value.uri.fsPath, folder: value })),
        { title: '选择讲解所对应的项目' }, operation.token,
      ).then(value => value?.folder);
      if (!this.current(operation)) return;
      if (!folder) {
        return;
      }
      if (folder.uri.scheme !== 'file') {
        void vscode.window.showWarningMessage('首版需要打开本机项目文件夹，才能读取本地文件和 Git 历史。');
        return;
      }
      const chosen = file ?? (await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { 'Markdown 讲解文件': ['md'] }, title: '选择已保存的 Markdown 讲解文件' }))?.[0];
      if (!this.current(operation)) return;
      if (!chosen) {
        return;
      }
      try {
        const explanation = await this.readSaved(chosen);
        if (!this.current(operation)) return;
        operation.kind = 'reading';
        const previous = this.reading;
        if (previous) {
          this.saveProgress(previous);
          for (const subscription of previous.subscriptions) subscription.dispose();
        }
        this.presentation.clear();
        this.presentation.releaseBody();
        const reading: Reading = { project: folder.uri, file: chosen, explanation, index: 0, subscriptions: [] };
        const saved = this.progress.get<string>(this.progressKey(reading));
        const index = explanation.steps.findIndex(step => step.id === saved);
        if (index >= 0) reading.index = index;
        this.reading = reading;
        this.presentation.setFileError();
        this.subscribe(reading);
        this.saveProgress(reading);
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
      const text = decodeMarkdown(bytes);
      if (normalizeText(text) !== reading.explanation.markdown) {
        const explanation = parseExplanation(text);
        const previous = reading.explanation;
        const stepId = previous.steps[reading.index].id;
        this.saveProgress(reading);
        reading.explanation = explanation;
        reading.index = explanation.id === previous.id ? Math.max(0, explanation.steps.findIndex(step => step.id === stepId)) : 0;
        this.presentation.releaseBody();
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
    this.presentation.updateNavigation(reading.explanation, reading.index, reading.fileError, true);
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
      if (this.current(operation)) this.presentation.updateNavigation(reading.explanation, reading.index, reading.fileError);
    } catch (error) {
      if (!this.current(operation)) return;
      this.presentation.clear();
      const reason = `步骤“${step.title}”无法定位：${message(error)}`;
      this.presentation.updateNavigation(reading.explanation, reading.index, [reading.fileError, reason].filter(Boolean).join('\n'));
      void vscode.window.showWarningMessage(reason);
      try {
        await this.presentation.showBody(reading.file, reading.explanation, step, operation.token);
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
    if (!reading) return;
    const operation = this.begin();
    try {
      await this.presentation.showBody(reading.file, reading.explanation, reading.explanation.steps[reading.index], operation.token);
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
  }

  dispose(): void { this.stop(); }
}
