import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { Explanation, Step } from './model';
import { displayMarkdown } from './markdown-display';

function escape(text: string): string {
  return text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** 管理正文页及该页可复制的代码；活动讲解和当前步骤仍由 Reader 管理。 */
export class BodyView implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly copies = new Map<string, string>();
  private nonce?: string;
  private notice?: string;

  get active(): boolean { return this.panel?.active ?? false; }

  show(file: vscode.Uri, explanation: Explanation, step: Step, fileError?: string): void {
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel('codeExplanation.body', '讲解正文', vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [],
      });
      this.panel = panel;
      const received = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const event = message as { type?: unknown; nonce?: unknown; token?: unknown };
        if (this.panel !== panel || event.nonce !== this.nonce) return;
        if (event.type === 'ready') {
          this.sendNotice();
        } else if (event.type === 'copy' && typeof event.token === 'string') {
          const code = this.copies.get(event.token);
          if (code !== undefined) await vscode.env.clipboard.writeText(code);
        }
      });
      panel.onDidDispose(() => {
        received.dispose();
        if (this.panel !== panel) return;
        this.panel = undefined;
        this.copies.clear();
        this.nonce = undefined;
        this.notice = undefined;
      });
    }
    this.render(file, explanation, step, fileError);
    this.panel.reveal(this.panel.viewColumn);
  }

  update(file: vscode.Uri, explanation: Explanation, step: Step, fileError?: string): void {
    if (!this.panel) return;
    this.notice = undefined;
    this.render(file, explanation, step, fileError);
  }

  setNotice(message?: string): void {
    this.notice = message;
    this.sendNotice();
  }

  private sendNotice(): void {
    if (this.panel && this.nonce) {
      void this.panel.webview.postMessage({ type: 'notice', nonce: this.nonce, text: this.notice ?? '' });
    }
  }

  private render(file: vscode.Uri, explanation: Explanation, step: Step, fileError?: string): void {
    const panel = this.panel!;
    const nonce = randomUUID();
    this.nonce = nonce;
    this.copies.clear();
    const theme = vscode.window.activeColorTheme.kind;
    const light = theme === vscode.ColorThemeKind.Light || theme === vscode.ColorThemeKind.HighContrastLight;
    const markdown = (text: string): string => displayMarkdown(text, light, code => {
      const token = randomUUID();
      this.copies.set(token, code);
      return `#copy-${token}`;
    });
    const sections = explanation.steps.map((current, index) => `<section data-step-id="${escape(current.id)}"${current.id === step.id ? ' data-current-step="true"' : ''}>
      <h2><span class="step-number">第 ${index + 1} 步</span>${escape(current.title)}</h2>${markdown(current.body)}</section>`).join('\n');
    panel.title = `${explanation.title} · 正文`;
    panel.webview.html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(explanation.title)}</title>
<style>
body{color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.7;margin:0;padding:24px 28px 80px;overflow-wrap:anywhere}
main{max-width:960px;margin:0 auto}h1{font-size:1.75em;line-height:1.35;margin:0 0 18px}h2{font-size:1.35em;line-height:1.5;margin:0 0 18px}.description{color:var(--vscode-descriptionForeground);margin-bottom:32px}
section{padding:24px 0;border-top:1px solid var(--vscode-panel-border);scroll-margin-top:18px}.step-number{display:block;font-size:.75em;font-weight:400;color:var(--vscode-descriptionForeground);margin-bottom:4px}
section[data-current-step]{border-top-color:var(--vscode-focusBorder)}p{margin:12px 0}a{color:var(--vscode-textLink-foreground)}a:hover{color:var(--vscode-textLink-activeForeground)}
code{font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size)}p code,li code{background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px}
blockquote{margin:16px 0;padding:12px 16px;background:var(--vscode-textCodeBlock-background);border-left:3px solid var(--vscode-textBlockQuote-border)}pre{margin:0;white-space:pre;overflow:auto;tab-size:4;line-height:1.6;user-select:text}pre code{white-space:pre}blockquote+p:has(a[href^="#copy-"]){margin-top:-8px;font-size:.9em}
.notice{padding:12px 16px;margin:0 0 20px;border-left:3px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);white-space:pre-wrap}.notice:empty{display:none}.stale{font-weight:600}ul,ol{padding-left:24px}table{border-collapse:collapse}td,th{padding:6px 12px;border:1px solid var(--vscode-panel-border)}
</style></head><body><main id="explanation-body" data-explanation-id="${escape(explanation.id)}" data-file="${escape(file.toString())}">
${fileError ? `<div id="file-notice" class="notice"><div class="stale">上一次成功加载的讲解</div>${escape(fileError)}</div>` : ''}
<div id="step-notice" class="notice">${escape(this.notice ?? '')}</div><h1>${escape(explanation.title)}</h1>
<div class="description">${markdown(explanation.description)}</div>${sections}</main>
<script nonce="${nonce}">
const api=acquireVsCodeApi();const nonce=${JSON.stringify(nonce)};
document.addEventListener('click',event=>{const link=event.target.closest('a');if(!link)return;const href=link.getAttribute('href')||'';if(href.startsWith('#copy-')){event.preventDefault();api.postMessage({type:'copy',nonce,token:href.slice(6)});}});
window.addEventListener('message',event=>{const message=event.data;if(message&&message.type==='notice'&&message.nonce===nonce)document.getElementById('step-notice').textContent=message.text;});
document.querySelector('[data-current-step]')?.scrollIntoView({block:'start'});api.postMessage({type:'ready',nonce});
</script></body></html>`;
  }

  dispose(): void {
    const panel = this.panel;
    this.panel = undefined;
    this.copies.clear();
    this.nonce = undefined;
    this.notice = undefined;
    panel?.dispose();
  }
}
