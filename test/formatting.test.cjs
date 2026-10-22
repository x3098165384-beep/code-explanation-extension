const assert = require('node:assert/strict');
const test = require('node:test');
const { javascriptFormatting, normalizeText, sha256 } = require('../dist/code-formatting');
const { checkTarget, parseExplanation } = require('../dist/explanation');

function reference(text, startLine = 2, endLine = 2) {
  const normalized = normalizeText(text);
  const formatting = javascriptFormatting(normalized);
  assert.ok(formatting, '用于生成讲解的完整 JavaScript 应可解析');
  const source = { kind: 'workspace', path: 'example.js', exists: true, sha256: sha256(normalized), formattingSha256: formatting.fileSha256 };
  const target = { startLine, endLine, sha256: sha256(normalized.split('\n').slice(startLine - 1, endLine).join('\n')), formattingSha256: formatting.rangeSha256(startLine, endLine) };
  return { source, target };
}

for (const [name, before, after] of [
  ['分号前空格与缩进', '  return subtotal + 2;', '\treturn subtotal + 2 ;'],
  ['除法两侧空格', '  return a / b;', ' return a/b ;'],
  ['正则后的空格', '  return /a b/.test(value);', '\treturn /a b/ .test(value) ;'],
  ['模板表达式内部的空格', '  return `金额 ${value + 1} 元`;', ' return `金额 ${value+1} 元` ;'],
  ['注释外部的空格', '  return value; // 保留  注释', '\treturn value ;\t// 保留  注释'],
]) {
  test(`允许${name}并显示格式变化提示`, () => {
    const original = `function price(subtotal, a, b, value) {\n${before}\n}\n`;
    const changed = original.replace(before, after);
    const { source, target } = reference(original);
    assert.match(checkTarget(source, changed, target).notice, /代码格式已变化/);
  });
}

for (const [name, before, after] of [
  ['运算符', '  return a + b;', '  return a - b;'],
  ['符号边界', '  return a + +b;', '  return a++ + b;'],
  ['字符串内部空格', '  return "a b";', '  return "ab";'],
  ['正则内部空格', '  return /a b/.test(value);', '  return /ab/.test(value);'],
  ['模板文本空格', '  return `a b${value}`;', '  return `ab${value}`;'],
  ['注释内部空格', '  return value; // 保留  注释', '  return value; // 保留 注释'],
  ['分号删除', '  return value;', '  return value'],
  ['语法错误', '  return value;', '  return (;'],
]) {
  test(`拒绝${name}变化`, () => {
    const original = `function price(a, b, value) {\n${before}\n}\n`;
    const { source, target } = reference(original);
    assert.throws(() => checkTarget(source, original.replace(before, after), target), /找不到可确认对应的目标/);
  });
}

test('换行影响自动插入分号时仍拒绝', () => {
  const original = 'function price(value) {\n  return value;\n}\n';
  const { source, target } = reference(original);
  assert.throws(() => checkTarget(source, original.replace('return value;', 'return\n value;'), target));
});

test('其他代码也变化时不能借格式摘要继续', () => {
  const original = 'const fee = 1;\nfunction price(value) {\n  return value;\n}\n';
  const { source, target } = reference(original, 3, 3);
  assert.throws(() => checkTarget(source, original.replace('fee = 1', 'fee = 2').replace('return value;', 'return value ;'), target));
});

test('格式不同的重复候选与原文候选一并拒绝', () => {
  const original = 'function price() {\n  work();\n  work( );\n}\n';
  const { source, target } = reference(original);
  assert.throws(() => checkTarget(source, original.replace('  work( );', '\twork( );'), target), /有 2 处/);
});

test('缺少格式摘要及不支持的语言保持原文检查', () => {
  const original = 'function price(value) {\n  return value;\n}\n';
  const { source, target } = reference(original);
  const changed = original.replace('value;', 'value ;');
  assert.throws(() => checkTarget({ ...source, formattingSha256: undefined }, changed, target));
  assert.throws(() => checkTarget(source, changed, { ...target, formattingSha256: undefined }));
  assert.throws(() => checkTarget({ ...source, path: 'example.ts' }, changed, target));
});

test('多行字面值范围必须使用完整解析上下文且不能切开 token', () => {
  const text = 'const value = `a b\nc d`;\n';
  const formatting = javascriptFormatting(text);
  assert.ok(formatting);
  assert.equal(formatting.rangeSha256(1, 1), undefined);
  assert.equal(formatting.rangeSha256(2, 2), undefined);
  assert.ok(formatting.rangeSha256(1, 2));
});

test('解析失败和 JSX 不生成格式摘要，script 仍可解析', () => {
  assert.equal(javascriptFormatting('function ('), undefined);
  assert.equal(javascriptFormatting('const value = <div />;'), undefined);
  assert.ok(javascriptFormatting('with (value) { work(); }'));
});

test('JSON 版本 2 的格式摘要按来源校验，缺少可选摘要仍可读取', () => {
  const original = 'function price(value) {\n  return value;\n}\n';
  const { source, target } = reference(original);
  const json = () => JSON.stringify({ version: 2, id: 'lecture', title: '讲解', sources: { code: source }, steps: [{ id: 'step', kind: 'file', title: '返回', body: '正文', source: 'code', target }] });
  assert.equal(parseExplanation(json()).steps[0].target.formattingSha256, target.formattingSha256);
  source.path = 'example.py';
  assert.throws(() => parseExplanation(json()), /只支持/);
  source.path = 'example.js';
  delete source.formattingSha256;
  assert.throws(() => parseExplanation(json()), /需要对应当前文件/);
  delete target.formattingSha256;
  assert.equal(parseExplanation(json()).steps.length, 1);
});
