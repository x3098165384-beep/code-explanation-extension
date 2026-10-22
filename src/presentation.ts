import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { CodeSnapshot, Explanation, ResolvedStep, Step } from './model';
import { normalizeText } from './explanation';
import { displayMarkdown } from './markdown-display';

const bodyScheme = 'code-explanation-body';
const copyCommand = 'codeExplanation.copyCodeBlock';

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}

function requireCurrent(snapshots: readonly CodeSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.document.isClosed || snapshot.document.version !== snapshot.version) {
      throw new Error(`代码 ${snapshot.uri.fsPath || snapshot.uri.path} 在显示前已经变化，需要重新检查对应位置。`);
    }
  }
}

export class Presentation implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('code-explanation', '行内代码讲解');
  private readonly previous = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 105);
  private readonly progress = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 104);
  private readonly next = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
  private readonly body = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  private readonly stop = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  private readonly fileError = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly bodyProvider: vscode.Disposable;
  private readonly bodyClosed: vscode.Disposable;
  private readonly copyHandler: vscode.Disposable;
  private readonly copies = new Map<string, string>();
  private thread?: vscode.CommentThread;
  private decoration?: vscode.TextEditorDecorationType;
  private pending?: vscode.CancellationTokenSource;
  private acceptedBody?: { uri: vscode.Uri; text: string };

  constructor() {
    this.copyHandler = vscode.commands.registerCommand(copyCommand, async (id: unknown) => {
      if (typeof id !== 'string') return false;
      const code = this.copies.get(id);
      if (code === undefined) return false;
      await vscode.env.clipboard.writeText(code);
      return true;
    });
    this.bodyProvider = vscode.workspace.registerTextDocumentContentProvider(bodyScheme, {
      provideTextDocumentContent: (uri, token) => {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        if (!this.acceptedBody || !sameUri(uri, this.acceptedBody.uri)) {
          throw new Error('这份讲解已停止或已被替换，请主动打开讲解后查看当前步骤正文。');
        }
        return this.acceptedBody.text;
      },
    });
    this.bodyClosed = vscode.workspace.onDidCloseTextDocument(document => {
      if (this.acceptedBody && sameUri(document.uri, this.acceptedBody.uri)) this.releaseBody();
    });
  }

  clear(): void {
    this.copies.clear();
    this.pending?.cancel();
    this.pending?.dispose();
    this.pending = undefined;
    this.thread?.dispose();
    this.thread = undefined;
    this.decoration?.dispose();
    this.decoration = undefined;
  }

  releaseBody(): void {
    this.acceptedBody = undefined;
  }

  private begin(token: vscode.CancellationToken): { source: vscode.CancellationTokenSource; cancel: vscode.Disposable } {
    this.pending?.cancel();
    this.pending?.dispose();
    const source = new vscode.CancellationTokenSource();
    this.pending = source;
    const cancel = token.onCancellationRequested(() => source.cancel());
    if (token.isCancellationRequested) source.cancel();
    return { source, cancel };
  }

  private check(source: vscode.CancellationTokenSource): void {
    if (this.pending !== source || source.token.isCancellationRequested) throw new vscode.CancellationError();
  }

  private finish(operation: { source: vscode.CancellationTokenSource; cancel: vscode.Disposable }): void {
    operation.cancel.dispose();
    operation.source.dispose();
    if (this.pending === operation.source) this.pending = undefined;
  }

  private async editorsFor(uris: readonly vscode.Uri[], token: vscode.CancellationToken): Promise<vscode.TextEditor[]> {
    const find = (): vscode.TextEditor[] | undefined => {
      const found = uris.map(uri => vscode.window.visibleTextEditors.find(editor => sameUri(editor.document.uri, uri)));
      return found.every((editor): editor is vscode.TextEditor => editor !== undefined) ? found : undefined;
    };
    if (token.isCancellationRequested) throw new vscode.CancellationError();
    const immediate = find();
    if (immediate) return immediate;
    return new Promise((resolve, reject) => {
      let change: vscode.Disposable | undefined;
      let cancel: vscode.Disposable | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, editors?: vscode.TextEditor[]): void => {
        change?.dispose();
        cancel?.dispose();
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve(editors!);
      };
      change = vscode.window.onDidChangeVisibleTextEditors(() => {
        const editors = find();
        if (editors) finish(undefined, editors);
      });
      cancel = token.onCancellationRequested(() => finish(new vscode.CancellationError()));
      timer = setTimeout(() => finish(new Error('VS Code 未能显示目标代码编辑器。查看 diff 时，请将比较切换为左右并排后重试。')), 5000);
      if (token.isCancellationRequested) finish(new vscode.CancellationError());
      else {
        const editors = find();
        if (editors) finish(undefined, editors);
      }
    });
  }

  async show(
    resolved: ResolvedStep,
    explanation: Explanation,
    step: Step,
    index: number,
    token: vscode.CancellationToken,
    file?: vscode.Uri,
  ): Promise<void> {
    this.clear();
    const operation = this.begin(token);
    try {
      this.check(operation.source);
      const snapshots = resolved.kind === 'file' ? [resolved.right] : [resolved.left!, resolved.right];
      requireCurrent(snapshots);
      if (resolved.kind === 'file') {
        await vscode.window.showTextDocument(resolved.right.document, { preview: false });
      } else {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        const existing = active instanceof vscode.TabInputTextDiff &&
          sameUri(active.original, resolved.left!.uri) && sameUri(active.modified, resolved.right.uri);
        if (!existing) {
          await vscode.commands.executeCommand('vscode.diff', resolved.left!.uri, resolved.right.uri, step.title, { preview: false });
        }
      }
      this.check(operation.source);
      const editors = await this.editorsFor(snapshots.map(snapshot => snapshot.uri), operation.source.token);
      this.check(operation.source);
      requireCurrent(snapshots);

      const decoration = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px solid',
        borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
      });
      this.decoration = decoration;
      for (const target of resolved.targets) {
        const editor = target.side === 'left' ? editors[0] : editors.at(-1)!;
        editor.setDecorations(decoration, [target.range]);
        editor.revealRange(target.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      const anchor = resolved.targets.find(target => target.side === 'right' || target.side === 'file') ?? resolved.targets[0];
      const anchorSnapshot = anchor.side === 'left' ? resolved.left! : resolved.right;
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = { enabledCommands: [copyCommand] };
      markdown.supportHtml = true;
      markdown.supportThemeIcons = false;
      if (file) markdown.baseUri = file;
      const theme = vscode.window.activeColorTheme.kind;
      markdown.appendMarkdown(displayMarkdown(`## ${step.title}\n\n${step.body}`,
        theme === vscode.ColorThemeKind.Light || theme === vscode.ColorThemeKind.HighContrastLight, code => {
          const id = randomUUID();
          this.copies.set(id, code);
          return `command:${copyCommand}?${encodeURIComponent(JSON.stringify([id]))}`;
        }));
      for (const notice of resolved.notices) {
        markdown.appendMarkdown('\n\n---\n\n');
        markdown.appendText(notice);
      }
      const thread = this.controller.createCommentThread(anchorSnapshot.uri, anchor.range, [{
        body: markdown,
        mode: vscode.CommentMode.Preview,
        author: { name: '行内代码讲解' },
      }]);
      this.thread = thread;
      thread.label = `${explanation.title} · 第 ${index + 1} 步，共 ${explanation.steps.length} 步`;
      thread.canReply = false;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      const anchorEditor = anchor.side === 'left' ? editors[0] : editors.at(-1)!;
      anchorEditor.revealRange(new vscode.Range(anchor.range.end, anchor.range.end), vscode.TextEditorRevealType.AtTop);
    } finally {
      this.finish(operation);
    }
  }

  updateNavigation(explanation: Explanation, index: number, error?: string, loading = false): void {
    this.previous.text = '$(arrow-left) 上一步';
    this.previous.command = index > 0 ? 'codeExplanation.previous' : undefined;
    this.previous.color = index > 0 ? undefined : new vscode.ThemeColor('disabledForeground');
    this.previous.tooltip = index > 0 ? '查看上一步讲解' : '已经是第一步';
    this.next.text = '下一步 $(arrow-right)';
    this.next.command = index < explanation.steps.length - 1 ? 'codeExplanation.next' : undefined;
    this.next.color = index < explanation.steps.length - 1 ? undefined : new vscode.ThemeColor('disabledForeground');
    this.next.tooltip = index < explanation.steps.length - 1 ? '查看下一步讲解' : '已经是最后一步，讲解会保留到停止';
    this.progress.text = `${loading ? '$(loading~spin)' : error ? '$(warning)' : '$(list-unordered)'} ${index + 1}/${explanation.steps.length}：${loading ? '正在读取 ' : ''}${explanation.steps[index].title}`;
    this.progress.command = 'codeExplanation.select';
    this.progress.tooltip = `${explanation.title}\n${loading ? '正在读取并核对本步代码，完成后会显示讲解。读取期间可以选择其他步骤或停止。' : error ?? '选择要阅读的步骤'}`;
    this.body.text = '$(markdown) 查看正文';
    this.body.command = 'codeExplanation.body';
    this.body.tooltip = '查看当前步骤的讲解正文';
    this.stop.text = '$(primitive-square) 停止讲解';
    this.stop.command = 'codeExplanation.stop';
    for (const item of [this.previous, this.progress, this.next, this.body, this.stop]) item.show();
  }

  hideNavigation(): void {
    for (const item of [this.previous, this.progress, this.next, this.body, this.stop, this.fileError]) item.hide();
  }

  setFileError(message?: string): void {
    if (!message) {
      this.fileError.hide();
      this.fileError.tooltip = undefined;
      return;
    }
    this.fileError.text = '$(warning) 新讲解尚未加载';
    this.fileError.tooltip = message;
    this.fileError.command = 'codeExplanation.body';
    this.fileError.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.fileError.show();
  }

  async showBody(file: vscode.Uri, explanation: Explanation, step: Step, token: vscode.CancellationToken): Promise<void> {
    const operation = this.begin(token);
    try {
      this.check(operation.source);
      let stale = true;
      try {
        const saved = await vscode.workspace.fs.readFile(file);
        this.check(operation.source);
        stale = normalizeText(new TextDecoder('utf-8', { fatal: true }).decode(saved)) !== explanation.text;
      } catch (error) {
        this.check(operation.source);
        if (error instanceof vscode.CancellationError) throw error;
      }
      this.check(operation.source);
      const lines = [...(stale ? ['# 上一次成功加载的讲解', ''] : []), `# ${explanation.title}`, '', explanation.description, ''];
      let headingLine = 0;
      for (const current of explanation.steps) {
        if (current.id === step.id) headingLine = lines.join('\n').split('\n').length;
        lines.push(`## ${current.title}`, '', normalizeText(current.body), '');
      }
      const text = lines.join('\n');
      if (this.acceptedBody?.text !== text) {
        this.acceptedBody = { uri: vscode.Uri.from({ scheme: bodyScheme, path: stale ? '/上一次成功加载的讲解.md' : '/讲解正文.md', query: randomUUID() }), text };
      }
      const document = await vscode.workspace.openTextDocument(this.acceptedBody.uri);
      this.check(operation.source);
      const range = new vscode.Range(headingLine, 0, headingLine, 0);
      const editor = await vscode.window.showTextDocument(document, { preview: false, selection: range });
      this.check(operation.source);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } finally {
      this.finish(operation);
    }
  }

  dispose(): void {
    this.clear();
    this.releaseBody();
    this.controller.dispose();
    this.bodyProvider.dispose();
    this.bodyClosed.dispose();
    this.copyHandler.dispose();
    for (const item of [this.previous, this.progress, this.next, this.body, this.stop, this.fileError]) item.dispose();
  }
}
