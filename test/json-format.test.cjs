const assert = require('node:assert/strict');
const test = require('node:test');
const { parseExplanation, sha256 } = require('../dist/explanation');

function example() {
  const text = 'return value;';
  return { version: 2, id: 'lecture', title: '讲解', sources: {
    code: { kind: 'workspace', path: 'src/example.js', exists: true, sha256: sha256(text) },
  }, steps: [{ id: 'step', kind: 'file', title: '返回', body: '返回当前值。', source: 'code',
    target: { startLine: 1, endLine: 1, sha256: sha256(text) } }] };
}

test('JSON 还原 Markdown、引号、路径和换行，正文中的旧备注不创建步骤', () => {
  const value = example();
  value.description = '简介 "引号" C:\\temp\n第二段';
  value.steps[0].body = '```js\n\treturn "C:\\temp";\n```\n\n<!-- step\n{}\n-->\n## 正文标题';
  const raw = '\uFEFF' + JSON.stringify(value, null, 2).replace(/\n/g, '\r\n');
  const parsed = parseExplanation(raw);
  assert.equal(parsed.description, value.description);
  assert.equal(parsed.steps[0].body, value.steps[0].body);
  assert.equal(parsed.steps.length, 1);
  assert.equal(parsed.text, raw.slice(1).replace(/\r\n/g, '\n'));
  delete value.description;
  assert.equal(parseExplanation(JSON.stringify(value)).description, '');
});

for (const [name, change, message] of [
  ['未知版本', value => value.version = 1, /version.*2/],
  ['未知顶层字段', value => value.extra = true, /extra/],
  ['重复步骤标识', value => value.steps.push(value.steps[0]), /重复/],
  ['未声明引用', value => value.steps[0].source = 'missing', /未声明/],
  ['未知步骤字段', value => value.steps[0].headingLine = 1, /headingLine/],
  ['越出项目路径', value => value.sources.code.path = '../example.js', /越出了/],
  ['空白正文', value => value.steps[0].body = ' \n', /body.*非空/],
  ['无效简介', value => value.description = 1, /description/],
]) test(`JSON 拒绝${name}并说明原因`, () => {
  const value = example(); change(value);
  assert.throws(() => parseExplanation(JSON.stringify(value)), message);
});

test('JSON 拒绝重复属性、注释、尾随逗号和旧 Markdown 封装', () => {
  const raw = JSON.stringify(example());
  assert.throws(() => parseExplanation(raw.replace('"version":2', '"version":2,"version":2')), /重复属性/);
  assert.throws(() => parseExplanation(raw.replace('"startLine":1', '"startLine":1,"startLine":1')), /重复属性/);
  for (const invalid of ['// 注释\n' + raw, raw.slice(0, -1) + ',}', '<!-- code-explanation\n' + raw + '\n-->']) {
    assert.throws(() => parseExplanation(invalid), /完整的 JSON/);
  }
});
