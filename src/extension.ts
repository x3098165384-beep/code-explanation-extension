import * as vscode from 'vscode';
import { Presentation } from './presentation';
import { Reader, type OpenLocation } from './reader';
import { Sidebar } from './sidebar';
import { SourceReader } from './sources';

export function activate(context: vscode.ExtensionContext): void {
  const sources = new SourceReader();
  const presentation = new Presentation();
  const reader = new Reader(sources, presentation, context.globalState);
  const sidebar = new Sidebar(reader);
  const tree = vscode.window.createTreeView('codeExplanation.lectures', { treeDataProvider: sidebar, showCollapseAll: true });
  context.subscriptions.push(new vscode.Disposable(() => {
    tree.dispose();
    sidebar.dispose();
    reader.dispose();
    presentation.dispose();
    sources.dispose();
  }));
  const commands: Record<string, (...args: unknown[]) => unknown> = {
    open: file => reader.open(file instanceof vscode.Uri ? file : undefined),
    openLocation: (file, location) => reader.open(file as vscode.Uri, location as OpenLocation),
    previous: () => reader.move(-1),
    next: () => reader.move(1),
    select: () => reader.select(),
    body: () => reader.showBody(),
    stop: () => reader.stop(),
  };
  for (const [name, action] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(`codeExplanation.${name}`, async (...args: unknown[]) => {
      try { await action(...args); }
      catch (error) { void vscode.window.showErrorMessage(`讲解操作未完成：${error instanceof Error ? error.message : String(error)}`); }
    }));
  }
}
