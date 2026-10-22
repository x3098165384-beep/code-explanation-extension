import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

const markdown = new MarkdownIt({ html: false });
const validateLink = markdown.validateLink;
markdown.validateLink = link => !/^command:/i.test(link) && validateLink(link);

const palettes = {
  dark: { text: '#d4d4d4', keyword: '#569cd6', string: '#ce9178', number: '#b5cea8', comment: '#6a9955', title: '#dcdcaa', type: '#4ec9b0' },
  light: { text: '#24292f', keyword: '#0000ff', string: '#a31515', number: '#098658', comment: '#008000', title: '#795e26', type: '#267f99' },
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function codeBlock(code: string, language: string, light: boolean, copy?: (code: string) => string): string {
  const colors = light ? palettes.light : palettes.dark;
  const highlighted = language && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escape(code);
  const text = highlighted.replace(/<span class="([^"]+)">/g, (_span, classes: string) => {
    const kind = /hljs-([a-z]+)/.exec(classes)?.[1];
    return `<span style="color:${colors[kind as keyof typeof colors] ?? colors.text};">`;
  }).replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
  // 使用实体避开 VS Code Markdown 对 Tab 的展开；浏览器还原后仍是真实代码字符。
  const link = copy ? `<p><a href="${escape(copy(code))}">复制这段代码</a></p>` : '';
  return `<blockquote><pre><code>${text}</code></pre></blockquote>${link}\n`;
}

markdown.renderer.rules.fence = (tokens, index, _options, environment) => {
  const token = tokens[index];
  return codeBlock(token.content, token.info.trim().split(/\s+/)[0], environment.light, environment.copy);
};
markdown.renderer.rules.code_block = (tokens, index, _options, environment) => codeBlock(tokens[index].content, '', environment.light, environment.copy);

export function displayMarkdown(body: string, light: boolean, copy?: (code: string) => string): string {
  // 作者 HTML 及命令链接不执行；只有本模块生成的结构和受控复制链接成为 HTML。
  return markdown.render(body, { light, copy });
}
