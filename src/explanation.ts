import MarkdownIt from 'markdown-it';
import { parseTree, type Node, type ParseError } from 'jsonc-parser';
import type { Explanation, Source, Step, Target } from './model';
import { javascriptFormatting, normalizeText, sha256, supportsJavaScriptFormatting } from './code-formatting';
export { normalizeText, sha256 } from './code-formatting';

const markdown = new MarkdownIt({ html: true });
type MarkdownToken = ReturnType<typeof markdown.parse>[number];
type JsonObject = Record<string, unknown>;

interface Declaration {
  kind: 'code-explanation' | 'step';
  tokenIndex: number;
  startLine: number;
  value: JsonObject;
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}必须是 JSON 对象。`);
  }
  return value as JsonObject;
}

function fields(value: JsonObject, allowed: string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${name}包含不允许的字段“${key}”。`);
  }
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}必须是非空字符串。`);
  return value;
}

function hash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name}必须是 64 位小写十六进制 SHA-256 摘要。`);
  }
  return value;
}

function sourcePath(value: unknown, name: string): string {
  const relative = string(value, name);
  if (/^[\/\\]/.test(relative) || /[:\\\u0000-\u001f\u007f]/.test(relative)) {
    throw new Error(`${name}必须是项目内使用 / 分隔的相对文件路径，不能是绝对路径或 URL。`);
  }
  let depth = 0;
  for (const part of relative.split('/')) {
    if (part === '..') depth--;
    else if (part && part !== '.') depth++;
    if (depth < 0) throw new Error(`${name}越出了所选项目，不能引用项目外的文件。`);
  }
  if (depth === 0 || relative.endsWith('/')) throw new Error(`${name}必须指向项目内的文件。`);
  return relative;
}

function checkJson(node: Node, name: string): void {
  if (node.type === 'string' && typeof node.value === 'string' && node.value.includes('-->')) {
    throw new Error(`${name}的 JSON 字符串不能包含结束 HTML 备注的 -->。`);
  }
  if (node.type === 'object') {
    const names = new Set<string>();
    for (const property of node.children ?? []) {
      const key: unknown = property.children?.[0]?.value;
      if (typeof key === 'string') {
        if (names.has(key)) throw new Error(`${name}的 JSON 包含重复属性“${key}”。`);
        names.add(key);
      }
    }
  }
  for (const child of node.children ?? []) checkJson(child, name);
}

function declarations(tokens: MarkdownToken[]): Declaration[] {
  const result: Declaration[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== 'html_block' || token.level !== 0 || !token.map) continue;
    const candidate = /^ {0,3}<!--[\t ]+(code-explanation|step)(?=[\s>])/.exec(token.content);
    if (!candidate) continue;
    const name = `第 ${token.map[0] + 1} 行的${candidate[1] === 'step' ? '步骤备注' : '讲解文件头'}`;
    const block = /^ {0,3}<!--[\t ]+(code-explanation|step)[\t ]*\n([\s\S]*?)\n[\t ]*-->[\t ]*\n?$/.exec(token.content);
    if (!block || block[2].includes('-->')) {
      throw new Error(`${name}不完整或格式不正确。开始标记和结束标记 --> 必须各自独占一行。`);
    }
    const errors: ParseError[] = [];
    const tree = parseTree(block[2], errors, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
    if (!tree || errors.length) {
      throw new Error(`${name}的 JSON 不完整或格式错误，不能包含注释或尾随逗号。`);
    }
    checkJson(tree, name);
    const value: unknown = JSON.parse(block[2]);
    result.push({ kind: block[1] as Declaration['kind'], tokenIndex: index, startLine: token.map[0], value: object(value, name) });
  }
  return result;
}

function nextBlock(tokens: MarkdownToken[], after: number): number {
  for (let index = after + 1; index < tokens.length; index++) {
    if (tokens[index].level === 0 && tokens[index].map) return index;
  }
  return -1;
}

function heading(tokens: MarkdownToken[], after: number, level: 'h1' | 'h2', name: string): { title: string; start: number; end: number } {
  const index = nextBlock(tokens, after);
  const token = tokens[index];
  if (!token || token.type !== 'heading_open' || token.tag !== level || !token.map) {
    throw new Error(`${name}后必须紧接${level === 'h1' ? '一级' : '二级'} Markdown 标题。`);
  }
  const title = tokens[index + 1]?.content.trim();
  if (!title) throw new Error(`${name}的标题不能为空。`);
  return { title, start: token.map[0], end: token.map[1] };
}

function parseSource(value: unknown, name: string): Source {
  const source = object(value, name);
  if (source.kind !== 'workspace' && source.kind !== 'git') {
    throw new Error(`${name}的 kind 必须是 workspace 或 git。`);
  }
  if (typeof source.exists !== 'boolean') throw new Error(`${name}的 exists 必须是 true 或 false。`);
  const allowed = ['kind', 'path', 'exists'];
  if (source.kind === 'git') allowed.push('commit');
  if (source.exists) allowed.push('sha256');
  if (source.exists && source.kind === 'workspace') allowed.push('formattingSha256');
  fields(source, allowed, name);
  const relative = sourcePath(source.path, `${name}的 path`);
  let formattingSha256: string | undefined;
  if (Object.prototype.hasOwnProperty.call(source, 'formattingSha256')) {
    if (!supportsJavaScriptFormatting(relative)) throw new Error(`${name}的 formattingSha256 只支持 .js、.mjs、.cjs 当前文件。`);
    formattingSha256 = hash(source.formattingSha256, `${name}的 formattingSha256`);
  }
  let content: { kind: 'workspace'; path: string } | { kind: 'git'; path: string; commit: string };
  if (source.kind === 'git') {
    if (typeof source.commit !== 'string' || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(source.commit)) {
      throw new Error(`${name}的 commit 必须是 40 或 64 位完整十六进制提交标识，不能使用分支、标签或缩写。`);
    }
    content = { kind: 'git', path: relative, commit: source.commit.toLowerCase() };
  } else {
    content = { kind: 'workspace', path: relative };
  }
  return source.exists
    ? { ...content, exists: true, sha256: hash(source.sha256, `${name}的 sha256`), ...(formattingSha256 ? { formattingSha256 } : {}) }
    : { ...content, exists: false };
}

function parseTarget(value: unknown, name: string, source: Source): Target {
  const target = object(value, name);
  fields(target, ['startLine', 'endLine', 'sha256', 'formattingSha256'], name);
  if (typeof target.startLine !== 'number' || !Number.isSafeInteger(target.startLine) || target.startLine < 1) {
    throw new Error(`${name}的 startLine 必须是从 1 开始的正整数。`);
  }
  if (typeof target.endLine !== 'number' || !Number.isSafeInteger(target.endLine) || target.endLine < target.startLine) {
    throw new Error(`${name}的 endLine 必须是整数，且不小于 startLine。`);
  }
  let formattingSha256: string | undefined;
  if (Object.prototype.hasOwnProperty.call(target, 'formattingSha256')) {
    if (source.kind !== 'workspace' || !source.exists || !source.formattingSha256) throw new Error(`${name}的格式摘要需要对应当前文件先提供 formattingSha256。`);
    formattingSha256 = hash(target.formattingSha256, `${name}的 formattingSha256`);
  }
  return { startLine: target.startLine, endLine: target.endLine, sha256: hash(target.sha256, `${name}的 sha256`), ...(formattingSha256 ? { formattingSha256 } : {}) };
}

function sourceName(value: unknown, sources: Record<string, Source>, name: string): string {
  const key = string(value, name);
  if (!Object.prototype.hasOwnProperty.call(sources, key)) throw new Error(`${name}引用了文件头未声明的代码引用“${key}”。`);
  return key;
}

function parseStep(value: JsonObject, sources: Record<string, Source>, body: { title: string; body: string; headingLine: number }, name: string): Step {
  const id = string(value.id, `${name}的 id`);
  if (value.kind === 'file') {
    fields(value, ['id', 'kind', 'source', 'target'], name);
    const source = sourceName(value.source, sources, `${name}的 source`);
    if (!sources[source].exists) throw new Error(`${name}是普通脚本步骤，不能引用预期不存在的文件“${source}”。`);
    return { ...body, id, kind: 'file', source, target: parseTarget(value.target, `${name}的 target`, sources[source]) };
  }
  if (value.kind !== 'diff') throw new Error(`${name}的 kind 必须是 file 或 diff。`);
  fields(value, ['id', 'kind', 'comparison', 'left', 'right', 'targets'], name);
  if (value.comparison !== 'commits' && value.comparison !== 'working-tree') {
    throw new Error(`${name}的 comparison 必须是 commits 或 working-tree。`);
  }
  const left = sourceName(value.left, sources, `${name}的 left`);
  const right = sourceName(value.right, sources, `${name}的 right`);
  const before = sources[left];
  const after = sources[right];
  if (before.kind !== 'git' || (value.comparison === 'commits' ? after.kind !== 'git' : after.kind !== 'workspace')) {
    throw new Error(`${name}的比较种类与两侧代码引用不符：commits 需要两侧均为 git，working-tree 需要左侧 git、右侧 workspace。`);
  }
  if (!before.exists && !after.exists) throw new Error(`${name}的两侧文件不能都预期不存在。`);
  const rawTargets = object(value.targets, `${name}的 targets`);
  fields(rawTargets, ['left', 'right'], `${name}的 targets`);
  if (!Object.keys(rawTargets).length) throw new Error(`${name}的 targets 至少需要 left 或 right 目标。`);
  const targets: { left?: Target; right?: Target } = {};
  for (const side of ['left', 'right'] as const) {
    if (!Object.prototype.hasOwnProperty.call(rawTargets, side)) continue;
    if (!(side === 'left' ? before : after).exists) {
      throw new Error(`${name}的 ${side} 侧文件预期不存在，不能设置目标范围。`);
    }
    targets[side] = parseTarget(rawTargets[side], `${name}的 targets.${side}`, side === 'left' ? before : after);
  }
  return { ...body, id, kind: 'diff', comparison: value.comparison, left, right, targets };
}

function bodyLines(lines: string[], start: number, end: number): string {
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end).join('\n');
}

export function parseExplanation(text: string): Explanation {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const tokens = markdown.parse(normalized, {});
  const declared = declarations(tokens);
  const headers = declared.filter(item => item.kind === 'code-explanation');
  if (headers.length !== 1) throw new Error('讲解文件必须在开头包含且只包含一份 code-explanation 文件头。');
  const header = headers[0];
  if (header.tokenIndex !== tokens.findIndex(token => token.level === 0 && token.map !== null) || lines.slice(0, header.startLine).some(line => line.trim())) {
    throw new Error('code-explanation 文件头必须是讲解文件开头的第一个 Markdown 块。');
  }
  fields(header.value, ['version', 'id', 'sources'], '讲解文件头');
  if (header.value.version !== 1) throw new Error('讲解文件头的 version 必须是整数 1；当前不支持其他格式版本。');
  const id = string(header.value.id, '讲解文件头的 id');
  const rawSources = object(header.value.sources, '讲解文件头的 sources');
  const sources: Record<string, Source> = Object.create(null) as Record<string, Source>;
  for (const [key, value] of Object.entries(rawSources)) {
    string(key, '代码引用名称');
    sources[key] = parseSource(value, `代码引用“${key}”`);
  }
  const title = heading(tokens, header.tokenIndex, 'h1', '讲解文件头');
  if (tokens.filter(token => token.type === 'heading_open' && token.level === 0 && token.tag === 'h1').length !== 1) {
    throw new Error('讲解文件必须只有一个顶层一级标题，步骤标题使用二级标题。');
  }
  const stepDeclarations = declared.filter(item => item.kind === 'step');
  if (!stepDeclarations.length) throw new Error('讲解文件至少需要一个 step 步骤备注。');
  const steps: Step[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < stepDeclarations.length; index++) {
    const declaration = stepDeclarations[index];
    const name = `第 ${declaration.startLine + 1} 行的步骤`;
    if (declaration.startLine < title.end) throw new Error(`${name}必须位于讲解的一级标题之后。`);
    const stepTitle = heading(tokens, declaration.tokenIndex, 'h2', name);
    const end = stepDeclarations[index + 1]?.startLine ?? lines.length;
    const body = bodyLines(lines, stepTitle.end, end);
    if (!body.trim()) throw new Error(`${name}“${stepTitle.title}”的正文不能为空。`);
    const step = parseStep(declaration.value, sources, { title: stepTitle.title, body, headingLine: stepTitle.start }, name);
    if (ids.has(step.id)) throw new Error(`步骤标识“${step.id}”重复；每个步骤的 id 必须唯一。`);
    ids.add(step.id);
    steps.push(step);
  }
  return { id, title: title.title, sources, steps, markdown: normalized };
}

export function checkTarget(source: Source, text: string, target: Target): { startLine: number; endLine: number; notice?: string } {
  if (!source.exists) throw new Error(`文件“${source.path}”预期不存在，不能定位代码目标。`);
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const unchanged = sha256(normalized) === source.sha256;
  const version = source.kind === 'git' ? `Git 提交 ${source.commit} 中的` : '当前';
  if (source.kind === 'git' && !unchanged) {
    throw new Error(`${version}文件“${source.path}”与记录的整文件摘要不一致，请修正讲解中的代码引用。`);
  }
  if (unchanged) {
    if (target.endLine > lines.length) throw new Error(`${version}文件“${source.path}”没有第 ${target.startLine} 至 ${target.endLine} 行，目标越界。`);
    const range = lines.slice(target.startLine - 1, target.endLine).join('\n');
    if (!range.trim()) throw new Error(`${version}文件“${source.path}”的目标范围全部为空白，不能挂接讲解。`);
    if (sha256(range) !== target.sha256) throw new Error(`${version}文件“${source.path}”第 ${target.startLine} 至 ${target.endLine} 行与目标摘要不一致，请更新定位信息。`);
    return { startLine: target.startLine, endLine: target.endLine };
  }
  const height = target.endLine - target.startLine + 1;
  const formatting = source.kind === 'workspace' && supportsJavaScriptFormatting(source.path) && source.formattingSha256 && target.formattingSha256
    ? javascriptFormatting(normalized) : undefined;
  const allowFormatting = formatting?.fileSha256 === source.formattingSha256 && !!formatting;
  let found: number | undefined;
  let count = 0;
  for (let start = 0; start + height <= lines.length; start++) {
    const range = lines.slice(start, start + height).join('\n');
    const matches = allowFormatting
      ? formatting.rangeSha256(start + 1, start + height) === target.formattingSha256
      : sha256(range) === target.sha256;
    if (range.trim() && matches) {
      found = start;
      count++;
    }
  }
  if (count === 0 || found === undefined) {
    throw new Error(`当前文件“${source.path}”已有变化，找不到可确认对应的目标。仅有受支持且带格式摘要的空格、Tab 或缩进变化可以继续；请更新该步骤的讲解及定位。`);
  }
  if (count > 1) throw new Error(`当前文件“${source.path}”有 ${count} 处与原目标对应的文本，不能唯一确定讲解位置，请更新该步骤的定位。`);
  return {
    startLine: found + 1,
    endLine: found + height,
    notice: allowFormatting && sha256(lines.slice(found, found + height).join('\n')) !== target.sha256
      ? `文件“${source.path}”的代码格式已变化，本段代码符号、字面值、注释及换行仍对应；讲解含义未重新核对。`
      : `文件“${source.path}”已有其他修改，本段文本仍一致；这不代表讲解的业务含义已经重新核对。`,
  };
}
