import { createHash } from 'node:crypto';
import { parse, type Token } from 'acorn';

export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function supportsJavaScriptFormatting(filename: string): boolean {
  return /\.(?:js|mjs|cjs)$/i.test(filename);
}

interface Part { start: number; end: number; kind: string }

/** 只在完整 JavaScript 可解析时提供摘要；范围沿用完整文件的词法上下文。 */
export function javascriptFormatting(input: string): {
  fileSha256: string;
  rangeSha256(startLine: number, endLine: number): string | undefined;
} | undefined {
  const text = normalizeText(input);
  let parts: Part[] | undefined;
  for (const sourceType of ['module', 'script'] as const) {
    const parsed: Part[] = [];
    try {
      parse(text, {
        ecmaVersion: 'latest', sourceType, allowHashBang: true,
        onToken(token: Token) {
          if (token.type.label !== 'eof') parsed.push({ start: token.start, end: token.end, kind: token.type.label });
        },
        onComment(block, _value, start, end) { parsed.push({ start, end, kind: block ? 'Block' : 'Line' }); },
      });
      parts = parsed.sort((a, b) => a.start - b.start);
      break;
    } catch {
      // 不完整或不支持的语法继续使用原文检查，不猜测词法边界。
    }
  }
  if (!parts) return undefined;
  const parsed = parts;
  const lines = text.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }

  const signature = (start: number, end: number): string | undefined => {
    let low = 0;
    let high = parsed.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (parsed[middle].end <= start) low = middle + 1;
      else high = middle;
    }
    const content: string[][] = [];
    let cursor = start;
    for (let index = low; index < parsed.length && parsed[index].start < end; index++) {
      const part = parsed[index];
      if (part.start < start || part.end > end) return undefined;
      content.push([text.slice(cursor, part.start).replace(/[ \t]/g, ''), part.kind, text.slice(part.start, part.end)]);
      cursor = part.end;
    }
    content.push([text.slice(cursor, end).replace(/[ \t]/g, '')]);
    return sha256(JSON.stringify(content));
  };
  return {
    fileSha256: signature(0, text.length)!,
    rangeSha256(startLine, endLine) {
      if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) return undefined;
      return signature(offsets[startLine - 1], offsets[endLine - 1] + lines[endLine - 1].length);
    },
  };
}
