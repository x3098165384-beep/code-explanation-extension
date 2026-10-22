import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import { decodeHTML } from 'entities';

const markdown = new MarkdownIt({ html: false });

const palettes = {
  dark: { background: '#10141b', border: '#49515d', text: '#d4d4d4', keyword: '#569cd6', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', title: '#dcdcaa', type: '#4ec9b0' },
  light: { background: '#f4f5f7', border: '#a5abb4', text: '#24292f', keyword: '#0000ff', string: '#a31515', number: '#098658', comment: '#008000', title: '#795e26', type: '#267f99' },
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

// 只生成当前正文的矢量代码框，不保存源码、图片文件或跨步骤缓存。
function codeImage(code: string, language: string, light: boolean): string {
  const colors = light ? palettes.light : palettes.dark;
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escape(code);
  const rows: { text: string; color: string }[][] = [[]];
  const stack: string[] = [colors.text];
  let columns = 0;
  for (const token of highlighted.match(/<span class="[^"]+">|<\/span>|[^<]+/g) ?? []) {
    if (token.startsWith('<span')) {
      const kind = /hljs-([a-z]+)/.exec(token)?.[1];
      stack.push(colors[kind as keyof typeof colors] ?? stack.at(-1)!);
    } else if (token === '</span>') stack.pop();
    else {
      for (const character of decodeHTML(token)) {
        const width = character === '\t' ? 4 - columns % 4 : character.codePointAt(0)! > 255 ? 2 : 1;
        if (character === '\n') { rows.push([]); columns = 0; continue; }
        if (columns + width > 80) { rows.push([]); columns = 0; }
        const text = character === '\t' ? ' '.repeat(width) : character;
        const color = stack.at(-1)!;
        const last = rows.at(-1)!.at(-1);
        if (last?.color === color) last.text += text;
        else rows.at(-1)!.push({ text, color });
        columns += width;
      }
    }
  }
  if (code.endsWith('\n') && !rows.at(-1)!.length) rows.pop();
  const height = rows.length * 22 + 32;
  const content = rows.map((row, index) => `<text x="18" y="${33 + index * 22}" xml:space="preserve">${row.map(part => `<tspan fill="${part.color}">${escape(part.text)}</tspan>`).join('')}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${height}" viewBox="0 0 720 ${height}"><rect x="0.5" y="0.5" width="719" height="${height - 1}" rx="5" fill="${colors.background}" stroke="${colors.border}"/><g font-family="Consolas,Menlo,monospace" font-size="14">${content}</g></svg>`;
  return `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" alt="${escape(code.trimEnd())}" title="${escape(language || '代码')}" />`;
}

markdown.renderer.rules.fence = (tokens, index, _options, environment) => {
  const token = tokens[index];
  return `<p>${codeImage(token.content, token.info.trim().split(/\s+/)[0], environment.light)}</p>\n`;
};
markdown.renderer.rules.code_block = (tokens, index, _options, environment) => `<p>${codeImage(tokens[index].content, '', environment.light)}</p>\n`;

export function displayMarkdown(body: string, light: boolean): string {
  // 原文 HTML 当作文字显示；只有本模块生成的图片和 Markdown 结构成为 HTML。
  return markdown.render(body, { light });
}
