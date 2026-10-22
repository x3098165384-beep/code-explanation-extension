import * as vscode from 'vscode';
import { parseExplanation } from './explanation';
import { Reader, type OpenLocation } from './reader';

interface Lecture {
  file: vscode.Uri;
  id: string;
  title: string;
  steps: { id: string; title: string }[];
}

type CatalogEntry = Lecture | { file: vscode.Uri; error: string };
type Section = 'recent' | 'project';

interface Catalog {
  folder: vscode.WorkspaceFolder;
  directory?: vscode.Uri;
  entries: CatalogEntry[];
  recent: CatalogEntry[];
  note?: string;
  subscriptions: vscode.Disposable[];
  recentSubscriptions: vscode.Disposable[];
  loading?: vscode.CancellationTokenSource;
}

type Item = { kind: 'project'; catalog: Catalog }
  | { kind: 'section'; catalog: Catalog; section: Section }
  | { kind: 'continue'; catalog: Catalog; file?: vscode.Uri; entry?: CatalogEntry }
  | { kind: 'lecture'; catalog: Catalog; lecture: Lecture; section: Section }
  | { kind: 'step'; catalog: Catalog; lecture: Lecture; section: Section; step: Lecture['steps'][number]; index: number }
  | { kind: 'note'; text: string; detail?: string; file?: vscode.Uri; openProject?: vscode.Uri };

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
      reader.onDidOpenExplanation(project => {
        const catalog = this.catalogs.find(value => key(value.folder.uri) === key(project));
        if (catalog) { this.watchRecent(catalog); void this.load(catalog); }
      }),
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
    for (const subscription of [...catalog.subscriptions, ...catalog.recentSubscriptions]) subscription.dispose();
  }

  private configure(): void {
    for (const catalog of this.catalogs) this.release(catalog);
    this.catalogs = (vscode.workspace.workspaceFolders ?? []).map(folder => {
      const catalog: Catalog = { folder, entries: [], recent: [], subscriptions: [], recentSubscriptions: [] };
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
    for (const catalog of this.catalogs) {
      this.watchRecent(catalog);
      void this.load(catalog);
    }
  }

  private watchRecent(catalog: Catalog): void {
    for (const subscription of catalog.recentSubscriptions) subscription.dispose();
    catalog.recentSubscriptions = [];
    for (const file of this.reader.recentFiles(catalog.folder.uri)) {
      if (catalog.directory && key(file).startsWith(key(catalog.directory).replace(/\/$/, '') + '/')) continue;
      const name = file.path.split('/').pop()!.replace(/[[\]{}*?]/g, character => `[${character}]`);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(file, '..'), name));
      const update = (): void => { if (this.catalogs.includes(catalog)) void this.load(catalog); };
      catalog.recentSubscriptions.push(watcher, watcher.onDidCreate(update), watcher.onDidChange(update), watcher.onDidDelete(update));
    }
  }

  private async metadata(file: vscode.Uri): Promise<CatalogEntry> {
    try {
      const bytes = await vscode.workspace.fs.readFile(file);
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const explanation = parseExplanation(text);
      return { file, id: explanation.id, title: explanation.title,
        steps: explanation.steps.map(step => ({ id: step.id, title: step.title })) };
    } catch (error) { return { file, error: reason(error) }; }
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
          entries.push(await this.metadata(file));
        }
      }
    };
    let note = catalog.directory ? undefined : catalog.note;
    try {
      if (catalog.directory) {
        await readDirectory(catalog.directory);
        if (!entries.length) note = `目录“${catalog.directory.fsPath}”中还没有 JSON 讲解。`;
      }
    } catch (error) {
      note = error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
        ? `讲解目录“${catalog.directory!.fsPath}”尚不存在。`
        : `无法读取讲解目录“${catalog.directory!.fsPath}”：${reason(error)}`;
    }
    const recent: CatalogEntry[] = [];
    for (const file of this.reader.recentFiles(catalog.folder.uri)) {
      if (loading.token.isCancellationRequested) return;
      recent.push(entries.find(entry => key(entry.file) === key(file)) ?? await this.metadata(file));
    }
    if (loading.token.isCancellationRequested) return;
    catalog.entries = entries.sort((a, b) => a.file.path.localeCompare(b.file.path));
    catalog.recent = recent;
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
      const file = this.reader.recentFiles(catalog.folder.uri)[0];
      return [{ kind: 'continue', catalog, file, entry: file ? catalog.recent.find(entry => key(entry.file) === key(file)) : undefined },
        { kind: 'section', catalog, section: 'recent' }, { kind: 'section', catalog, section: 'project' }];
    }
    if (item.kind === 'section') {
      const { catalog } = item;
      if (item.section === 'project' && catalog.note) return [{ kind: 'note', text: catalog.note }];
      const entries = item.section === 'recent' ? catalog.recent : catalog.entries;
      if (catalog.loading && !entries.length) return [{ kind: 'note', text: '正在读取项目讲解…' }];
      if (!entries.length) return [{ kind: 'note', text: '还没有打开过讲解。' }];
      return entries.map(entry => 'error' in entry
        ? { kind: 'note', text: entry.file.path.split('/').pop()!, detail: `无法读取“${entry.file.fsPath}”：${entry.error}`, file: entry.file,
          openProject: item.section === 'recent' ? catalog.folder.uri : undefined }
        : { kind: 'lecture', catalog, lecture: entry, section: item.section });
    }
    if (item.kind === 'lecture') return item.lecture.steps.map((step, index) => ({ kind: 'step', catalog: item.catalog, lecture: item.lecture, section: item.section, step, index }));
    return [];
  }

  getTreeItem(item: Item): vscode.TreeItem {
    if (item.kind === 'note') {
      const result = new vscode.TreeItem(item.text);
      result.tooltip = item.detail ?? item.text;
      result.iconPath = new vscode.ThemeIcon(item.file ? 'warning' : 'info');
      if (item.file) result.description = '无法读取';
      if (item.openProject) result.command = { command: 'codeExplanation.openLocation', title: '阅读讲解', arguments: [item.file, { project: item.openProject }] };
      return result;
    }
    if (item.kind === 'section') {
      const result = new vscode.TreeItem(item.section === 'recent' ? '最近打开' : '项目讲解', vscode.TreeItemCollapsibleState.Expanded);
      result.id = [key(item.catalog.folder.uri), 'section', item.section].join('\0');
      return result;
    }
    if (item.kind === 'continue') {
      const result = new vscode.TreeItem('继续上次讲解');
      result.id = [key(item.catalog.folder.uri), 'continue'].join('\0');
      result.iconPath = new vscode.ThemeIcon('play');
      const entry = item.entry;
      if (!item.file) result.description = '尚无记录';
      else if (!entry) {
        result.description = item.file.path.split('/').pop();
        result.tooltip = item.file.fsPath;
        result.command = { command: 'codeExplanation.openLocation', title: '继续上次讲解', arguments: [item.file, { project: item.catalog.folder.uri }] };
      }
      else {
        const location: OpenLocation = { project: item.catalog.folder.uri };
        if ('id' in entry) location.explanationId = entry.id;
        result.command = { command: 'codeExplanation.openLocation', title: '继续上次讲解', arguments: [entry.file, location] };
        if ('error' in entry) result.description = `${entry.file.path.split('/').pop()} · 无法读取`;
        else {
          const position = this.reader.position;
          const active = position?.explanationId === entry.id && key(position.project) === key(item.catalog.folder.uri) && key(position.file) === key(entry.file);
          const index = active ? position.index : entry.steps.findIndex(step => step.id === this.reader.savedStep(item.catalog.folder.uri, entry.file, entry.id));
          result.description = `${entry.title}${index >= 0 ? ` · ${index + 1}/${active ? position.total : entry.steps.length}` : ''}`;
        }
        result.tooltip = 'error' in entry ? `无法读取“${entry.file.fsPath}”：${entry.error}` : `${entry.title}\n${entry.file.fsPath}`;
      }
      return result;
    }
    if (item.kind === 'project') {
      const result = new vscode.TreeItem(item.catalog.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      result.id = [key(item.catalog.folder.uri), 'project'].join('\0');
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
    result.id = [key(catalog.folder.uri), item.section, key(lecture.file), lecture.id, item.kind === 'step' ? item.step.id : ''].join('\0');
    result.command = { command: 'codeExplanation.openLocation', title: '阅读讲解', arguments: [lecture.file, item.kind === 'step' ? { ...location, stepId: item.step.id } : location] };
    if (item.kind === 'lecture') {
      const path = vscode.workspace.asRelativePath(lecture.file, false);
      result.description = `${active ? '正在阅读 · ' : ''}${index >= 0 ? `${index + 1}/${active ? position.total : lecture.steps.length} · ` : ''}${path}`;
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
