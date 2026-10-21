const fs = require('node:fs');
const path = require('node:path');

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

exports.connect = async function (config) {
  const deadline = Date.now() + 20000;
  let target;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${config.port}/json/list`)).json();
      target = targets.find(item => item.type === 'page' && item.url.includes('workbench'));
      if (target) break;
    } catch {}
    await pause(100);
  }
  if (!target) throw new Error('未找到本次后台测试的渲染进程。');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    const request = pending.get(value.id);
    if (!request) return;
    pending.delete(value.id);
    clearTimeout(request.timer);
    if (value.error) request.reject(new Error(value.error.message));
    else request.resolve(value.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`后台渲染读取超时：${method}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const title = await evaluate('document.title');
  if (!title.includes(config.runName)) { socket.close(); throw new Error('渲染进程标题与本次独立测试不符，未读取或操作界面。'); }
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  return {
    evaluate,
    async scrollCommentToBottom() {
      return evaluate(`(() => {
        const body = document.querySelector('.review-widget .comment-body');
        if (!body) return null;
        body.scrollTop = body.scrollHeight;
        const last = body.querySelector('.rendered-markdown')?.lastElementChild;
        const viewport = body.getBoundingClientRect(), end = last?.getBoundingClientRect();
        return { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
          lastVisible: !!end && end.bottom <= viewport.bottom + 1 && end.top >= viewport.top - 1 };
      })()`);
    },
    async state() {
      return evaluate(`(() => {
        const visible = element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const side = element => {
          if (element.closest('.editor.original, .original-in-monaco-diff-editor')) return 'left';
          if (element.closest('.editor.modified, .modified-in-monaco-diff-editor')) return 'right';
          const diff = element.closest('.monaco-diff-editor');
          if (!diff) return 'file';
          const r = diff.getBoundingClientRect();
          return element.getBoundingClientRect().x < r.x + r.width / 2 ? 'left' : 'right';
        };
        const rules = [];
        const probe = document.createElement('span');
        probe.style.cssText = 'visibility:hidden;position:absolute;background-color:var(--vscode-editor-findMatchHighlightBackground);border:1px solid var(--vscode-editor-findMatchBorder)';
        document.querySelector('.monaco-workbench').appendChild(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        for (const sheet of document.styleSheets) {
          try { for (const rule of sheet.cssRules) {
            if (rule.selectorText?.includes('TextEditorDecorationType') && rule.style?.backgroundColor === color && rule.style?.borderWidth === '1px' && rule.style?.borderStyle === 'solid') rules.push(rule.selectorText);
          } } catch {}
        }
        const highlights = rules.flatMap(selector => [...document.querySelectorAll(selector)]).filter(visible).map(element => ({
          side: side(element), x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y,
          height: element.getBoundingClientRect().height, className: element.className,
        }));
        const comments = [...document.querySelectorAll('.review-widget')].filter(visible).map(element => ({
          text: element.innerText, x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y,
          side: side(element), range: element.querySelector('.comments-container')?.getAttribute('aria-label'),
          ancestors: Array.from((function*(node) { while (node) { yield node.className; node = node.parentElement; } })(element)),
          markdown: element.querySelector('.rendered-markdown')?.innerHTML,
        }));
        return { title: document.title, comments, status: document.querySelector('.part.statusbar')?.innerText,
          highlights, highlightColor: color, highlightSelectors: rules, text: document.body.innerText };
      })()`);
    },
    async screenshot(filename) {
      const content = state => JSON.stringify({ title: state.title,
        progress: /\d+\/\d+：[^\n]*/.exec(state.status)?.[0],
        comments: state.comments.map(comment => [comment.text, comment.side, comment.range]) });
      for (let attempt = 0; attempt < 20; attempt++) {
        const before = await this.state();
        if (before.status.includes('正在读取')) { await pause(100); continue; }
        const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const after = await this.state();
        if (after.status.includes('正在读取') || content(before) !== content(after)) { await pause(100); continue; }
        fs.writeFileSync(path.join(config.runRoot, filename), Buffer.from(result.data, 'base64')); return;
      }
      throw new Error(`截图期间界面持续变化，未记录为完成截图：${filename}`);
    },
    close() { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('后台渲染连接已结束。')); } pending.clear(); socket.close(); },
  };
};
exports.pause = pause;
