import type * as vscode from 'vscode';

export type Source = ({ kind: 'workspace'; path: string } | { kind: 'git'; path: string; commit: string }) &
  ({ exists: true; sha256: string; formattingSha256?: string } | { exists: false });

export interface Target {
  startLine: number;
  endLine: number;
  sha256: string;
  formattingSha256?: string;
}

interface StepBody {
  id: string;
  title: string;
  body: string;
}

export type Step = StepBody & (
  | { kind: 'file'; source: string; target: Target }
  | { kind: 'diff'; comparison: 'commits' | 'working-tree'; left: string; right: string; targets: { left?: Target; right?: Target } }
);

export interface Explanation {
  id: string;
  title: string;
  description: string;
  sources: Record<string, Source>;
  steps: Step[];
  /** 已成功读取的 JSON 原文，仅在当前阅读期间保留，用于确认保存更新。 */
  text: string;
}

export interface CodeSnapshot {
  uri: vscode.Uri;
  document: vscode.TextDocument;
  version: number;
}

export interface ResolvedStep {
  kind: 'file' | 'diff';
  left?: CodeSnapshot;
  right: CodeSnapshot;
  targets: { side: 'file' | 'left' | 'right'; range: vscode.Range }[];
  notices: string[];
  /** 仅当前未提交比较需要在显示前再次确认 HEAD。 */
  expectedHead?: { repository: string; commit: string };
}
