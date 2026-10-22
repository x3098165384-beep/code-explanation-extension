import * as vscode from 'vscode';
import { parseExplanation } from './explanation';
import { Reader, type OpenLocation } from './reader';

interface Lecture {
  file: vscode.Uri;
  id: string;
  title: string;
  steps: { id: string; title: string }[];
}

interface Catalog {
  folder: vscode.WorkspaceFolder;
  directory?: vscode.Uri;
  entries: (Lecture | { file: vscode.Uri; error: string })[];
  note?: string;
  subscriptions: vscode.Disposable[];
  loading?: vscode.CancellationTokenSource;
}

type Item = { kind: 'project'; catalog: Catalog }
  | { kind: 'lecture'; catalog: Catalog; lecture: Lecture }
  | { kind: 'step'; catalog: Catalog; lecture: Lecture; step: Lecture['steps'][number]; index: number }
  | { kind: 'note'; text: string; detail?: string; file?: vscode.Uri };

function key(uri: vscode.Uri): string {
  const value = uri.toString();
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export class Sidebar implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private catalogs: Catalog[] = [];
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly reader: Reader) {
    this.subscriptions = [
      reader.onDidChangeReading(() => this.changed.fire(undefined)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.configure()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('codeExplanation.directory')) this.configure();
      }),
    ];
    this.configure();
  }

  private release(catalog: Catalog): void {
    catalog.loading?.cancel();
    catalog.loading?.dispose();
    for (const subscription of catalog.subscriptions) subscription.dispose();
  }

  private configure(): void {
    for (const catalog of this.catalogs) this.release(catalog);
    this.catalogs = (vscode.workspace.workspaceFolders ?? []).map(folder => {
      const catalog: Catalog = { folder, entries: [], subscriptions: [] };
      const configured = vscode.workspace.getConfiguration('codeExplanation', folder.uri).get<unknown>('directory', '.code-explanations');
      const directory = typeof configured === 'string' ? configured.replaceAll('\\', '/') : '';
      if (folder.uri.scheme !== 'file') catalog.note = '请打开本机项目文件夹，才能读取项目讲解。';
      else if (typeof configured !== 'string') catalog.note = '讲解目录设置需要填写项目内的相对目录，请在项目设置中改正。';
      else if (!directory || !directory.split('/').some(part => part && part !== '.') || directory.startsWith('/') || directory.includes(':') || directory.split('/').includes('..')) {
        catalog.note = `讲解目录“${directory}”无效，请在项目设置中填写项目内的相对目录。`;
      } else {
        catalog.directory = vscode.Uri.joinPath(folder.uri, directory);
        const update = (): void => { if (this.catalogs.includes(catalog)) void this.load(catalog); };
        const name = catalog.directory.path.split('/').pop()!.replace(/[[\]{}*?]/g, character => `[${character}]`);
        const patterns = [new vscode.RelativePattern(catalog.directory, '**/*'), new vscode.RelativePattern(vscode.Uri.joinPath(catalog.directory, '..'), name)];
        for (const pattern of patterns) {
          const watcher = vscode.workspace.createFileSystemWatcher(pattern);
          catalog.subscriptions.push(watcher, watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update));
        }
      }
      return catalog;
    });
    this.changed.fire(undefined);
    for (const catalog of this.catalogs) if (catalog.directory) void this.load(catalog);
  }

  private async load(catalog: Catalog): Promise<void> {
    catalog.loading?.cancel();
    catalog.loading?.dispose();
    const loading = new vscode.CancellationTokenSource();
    catalog.loading = loading;
    const entries: Catalog['entries'] = [];
    const readDirectory = async (directory: vscode.Uri): Promise<void> => {
      const children = await vscode.workspace.fs.readDirectory(directory);
      for (const [name, type] of children) {
        if (loading.token.isCancellationRequested) return;
        const file = vscode.Uri.joinPath(directory, name);
        if (type === vscode.FileType.Directory) {
          try { await readDirectory(file); }
          catch (error) { entries.push({ file, error: reason(error) }); }
        } else if (type === vscode.FileType.File && name.toLowerCase().endsWith('.json')) {
          try {
            const bytes = await vscode.workspace.fs.readFile(file);
            const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            const explanation = parseExplanation(text);
            entries.push({ file, id: explanation.id, title: explanation.title,
              steps: explanation.steps.map(step => ({ id: step.id, title: step.title })) });
          } catch (error) { entries.push({ file, error: reason(error) }); }
        }
      }
    };
    let note: string | undefined;
    try {
      await readDirectory(catalog.directory!);
      if (!entries.length) note = `目录“${catalog.directory!.fsPath}”中还没有 JSON 讲解。`;
    } catch (error) {
      note = error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
        ? `讲解目录“${catalog.directory!.fsPath}”尚不存在。`
        : `无法读取讲解目录“${catalog.directory!.fsPath}”：${reason(error)}`;
    }
    if (loading.token.isCancellationRequested) return;
    catalog.entries = entries.sort((a, b) => a.file.path.localeCompare(b.file.path));
    catalog.note = note;
    catalog.loading = undefined;
    loading.dispose();
    this.changed.fire(undefined);
  }

  getChildren(item?: Item): Item[] {
    if (!item) return this.catalogs.length ? this.catalogs.map(catalog => ({ kind: 'project', catalog }))
      : [{ kind: 'note', text: '请先打开项目文件夹，再查看项目讲解。' }];
    if (item.kind === 'project') {
      const { catalog } = item;
      if (catalog.note) return [{ kind: 'note', text: catalog.note }];
      if (catalog.loading && !catalog.entries.length) return [{ kind: 'note', text: '正在读取项目讲解…' }];
      return catalog.entries.map(entry => 'error' in entry
        ? { kind: 'note', text: entry.file.path.split('/').pop()!, detail: `无法读取“${entry.file.fsPath}”：${entry.error}`, file: entry.file }
        : { kind: 'lecture', catalog, lecture: entry });
    }
    if (item.kind === 'lecture') return item.lecture.steps.map((step, index) => ({ kind: 'step', catalog: item.catalog, lecture: item.lecture, step, index }));
    return [];
  }

  getTreeItem(item: Item): vscode.TreeItem {
    if (item.kind === 'note') {
      const result = new vscode.TreeItem(item.text);
      result.tooltip = item.detail ?? item.text;
      result.iconPath = new vscode.ThemeIcon(item.file ? 'warning' : 'info');
      if (item.file) result.description = '无法读取';
      return result;
    }
    if (item.kind === 'project') {
      const result = new vscode.TreeItem(item.catalog.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      result.id = key(item.catalog.folder.uri);
      result.tooltip = item.catalog.directory?.fsPath ?? item.catalog.folder.uri.fsPath;
      result.iconPath = new vscode.ThemeIcon('root-folder');
      return result;
    }
    const { catalog, lecture } = item;
    const position = this.reader.position;
    const active = position?.explanationId === lecture.id && key(position.project) === key(catalog.folder.uri) && key(position.file) === key(lecture.file);
    const saved = this.reader.savedStep(catalog.folder.uri, lecture.file, lecture.id);
    const index = active ? position.index : lecture.steps.findIndex(step => step.id === saved);
    const location: OpenLocation = { project: catalog.folder.uri, explanationId: lecture.id };
    const result = new vscode.TreeItem(item.kind === 'lecture' ? lecture.title : `${item.index + 1}. ${item.step.title}`,
      item.kind === 'lecture' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    result.id = [key(catalog.folder.uri), key(lecture.file), lecture.id, item.kind === 'step' ? item.step.id : ''].join('\0');
    result.command = { command: 'codeExplanation.openLocation', title: '阅读讲解', arguments: [lecture.file, item.kind === 'step' ? { ...location, stepId: item.step.id } : location] };
    if (item.kind === 'lecture') {
      const path = vscode.workspace.asRelativePath(lecture.file, false);
      result.description = `${active ? '正在阅读 · ' : ''}${index >= 0 ? `${index + 1}/${lecture.steps.length} · ` : ''}${path}`;
      result.tooltip = `${lecture.title}\n${lecture.file.fsPath}`;
      result.iconPath = new vscode.ThemeIcon(active ? 'book' : 'file-text');
    } else {
      result.description = active && position.stepId === item.step.id ? '当前步骤' : undefined;
      result.iconPath = new vscode.ThemeIcon(active && position.stepId === item.step.id ? 'arrow-right' : 'circle-outline');
    }
    return result;
  }

  dispose(): void {
    for (const catalog of this.catalogs) this.release(catalog);
    this.catalogs = [];
    for (const subscription of this.subscriptions) subscription.dispose();
    this.changed.dispose();
  }
}
