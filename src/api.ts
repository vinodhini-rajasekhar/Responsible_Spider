import type { AblationResult, AgentRun, AppConfig, CrawlEvent } from '../shared/types.ts';

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`API unavailable (${res.status})`);
  return res.json();
}

export function startCrawl(params: { seed: string; maxPages: number; compare: boolean; agent: boolean }, onEvent: (e: CrawlEvent) => void, onClose: (error?: string) => void): () => void {
  const qs = new URLSearchParams({ seed: params.seed, maxPages: String(params.maxPages), compare: params.compare ? '1' : '0', agent: params.agent ? '1' : '0' });
  const es = new EventSource(`/api/crawl?${qs}`);
  let finished = false;
  es.onmessage = (m) => {
    const e = JSON.parse(m.data) as CrawlEvent;
    onEvent(e);
    if (e.type === 'done' || e.type === 'error') {
      finished = true;
      es.close();
      onClose(e.type === 'error' ? e.message : undefined);
    }
  };
  es.onerror = () => {
    es.close();
    if (!finished) onClose('Connection to the crawler closed unexpectedly.');
    finished = true;
  };
  return () => {
    finished = true;
    es.close();
    onClose();
  };
}

export async function explainCausally(url: string): Promise<{ baseline: AgentRun; results: AblationResult[] }> {
  const res = await fetch('/api/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? 'Explanation failed');
  return body;
}

export async function getEval(): Promise<EvalResults | null> {
  const res = await fetch('/api/eval');
  return res.ok ? res.json() : null;
}

export interface EvalRow {
  key: string;
  label: string;
  n: number;
  detected: number;
  naiveHijacked: number;
  guardedHijacked: number;
}

export interface EvalResults {
  generatedAt: string;
  model: string;
  simulated: boolean;
  threshold: number;
  cases: number;
  detector: { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; fpr: number };
  agent: { attacks: number; naiveASR: number; guardedASR: number; benignUtilityNaive: number; benignUtilityGuarded: number; benignFalseRefusals: number };
  byTechnique: EvalRow[];
  byPayload: EvalRow[];
  falsePositives: string[];
  misses: string[];
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
