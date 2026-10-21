const fs = require('node:fs');
const { normalizeText, sha256, javascriptFormatting, supportsJavaScriptFormatting } = require('../dist/code-formatting');

const args = process.argv.slice(2);
const [filename, first, last, input] = args;
if (args.length < 3 || args.length > 4 || (input && input !== '--stdin')) {
  console.error('用法：node tools/code-reference.cjs <代码文件> <首行> <末行> [--stdin]。--stdin 从标准输入读取实际文本；默认读取文件，不修改源码。');
  process.exitCode = 1;
} else {
  try {
    if (/^[\\/]|[:\\]/.test(filename) || filename.split('/').includes('..')) throw new Error('请在代码项目目录运行，并使用项目内以 / 分隔的相对路径。');
    const text = normalizeText(fs.readFileSync(input ? 0 : filename, 'utf8'));
    const startLine = Number(first), endLine = Number(last), lines = text.split('\n');
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) throw new Error('首行和末行必须是实际存在的行号，末行不能小于首行。');
    const selected = lines.slice(startLine - 1, endLine).join('\n');
    if (!selected.trim()) throw new Error('目标范围不能全部为空白。');
    const source = { kind: 'workspace', path: filename.replaceAll('\\', '/'), exists: true, sha256: sha256(text) };
    const target = { startLine, endLine, sha256: sha256(selected) };
    const formatting = supportsJavaScriptFormatting(filename) ? javascriptFormatting(text) : undefined;
    const rangeHash = formatting?.rangeSha256(startLine, endLine);
    if (formatting && rangeHash) { source.formattingSha256 = formatting.fileSha256; target.formattingSha256 = rangeHash; }
    console.log(JSON.stringify({ source, target }, null, 2));
  } catch (error) {
    console.error(`无法生成代码引用：${error.message}`);
    process.exitCode = 1;
  }
}
