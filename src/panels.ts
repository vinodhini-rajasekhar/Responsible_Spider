import type { PageReport, SitePolicy } from '../shared/types.ts';
import { esc, getEval, type EvalRow } from './api.ts';
import { DECISION_COLOR, DECISION_LABEL } from './graph.ts';

export function renderPolicy(el: HTMLElement, p: SitePolicy) {
  const blocked = p.bots.filter((b) => !b.rootAllowed).length;
  el.innerHTML = `
  <section class="rc-sec">
    <h4>${esc(p.origin)}</h4>
    <p class="muted">${p.robotsFound ? `robots.txt found. ${blocked} of ${p.bots.length} known AI crawlers are blocked from the homepage.` : 'No robots.txt: by convention, everything is allowed.'}${p.crawlDelay ? ` Crawl-delay ${p.crawlDelay}s honoured.` : ''}</p>
    <table class="bots"><thead><tr><th>AI crawler</th><th>Owner</th><th>Purpose</th><th>Homepage</th></tr></thead><tbody>
      ${p.bots.map((b) => `<tr><td><code>${esc(b.bot)}</code></td><td>${esc(b.owner)}</td><td>${esc(b.purpose)}</td><td class="${b.rootAllowed ? 'good' : 'bad'}">${b.rootAllowed ? 'allowed' : 'blocked'}${b.line > 0 ? ` <span class="muted">L${b.line}</span>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Per-path rules can differ from the homepage; each page's receipt shows the exact rule applied.</p>
  </section>
  <section class="rc-sec"><h4>ai.txt</h4>${p.aiTxt ? `<pre>${esc(p.aiTxt.slice(0, 2000))}</pre>` : '<p class="muted">Not present.</p>'}</section>
  <section class="rc-sec"><h4>TDMRep (/.well-known/tdmrep.json)</h4>${p.tdmRep ? `<pre>${esc(p.tdmRep)}</pre>` : '<p class="muted">Not present.</p>'}</section>
  <section class="rc-sec"><h4>robots.txt</h4>${p.robotsText ? `<pre>${esc(p.robotsText)}</pre>` : '<p class="muted">Not present.</p>'}</section>`;
}

export class Log {
  private list: HTMLOListElement;
  private empty: HTMLElement;
  private count: HTMLElement;
  private n = 0;
  private onPick: (url: string) => void;
  constructor(onPick: (url: string) => void) {
    this.onPick = onPick;
    this.list = document.getElementById('log') as HTMLOListElement;
    this.empty = document.getElementById('log-empty')!;
    this.count = document.getElementById('log-count')!;
  }
  clear() {
    this.list.replaceChildren();
    this.n = 0;
    this.count.textContent = '';
    this.empty.hidden = false;
  }
  add(r: PageReport, t: number) {
    const li = document.createElement('li');
    li.style.setProperty('--c', DECISION_COLOR[r.decision]);
    li.innerHTML = `<time>${t.toFixed(1)}s</time><div><div class="lg-top"><b>${esc(DECISION_LABEL[r.decision])}</b><code>${esc(r.path)}</code></div><div class="lg-why">${esc(r.reason)}${r.agent?.naive.hijacked ? ` <span class="bad">Naive agent hijacked${r.agent.guarded.hijacked ? ', guarded too' : '; guarded agent safe'}.</span>` : ''}</div></div>`;
    li.addEventListener('click', () => this.onPick(r.url));
    this.list.prepend(li);
    this.n++;
    this.count.textContent = String(this.n);
    this.empty.hidden = true;
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function bars(rows: EvalRow[]): string {
  return `<table class="evt"><thead><tr><th></th><th>n</th><th>Detected</th><th>Naive hijacked</th><th>Guarded hijacked</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.n}</td>
    <td><span class="hbar good"><i style="width:${pct(r.detected / r.n)}"></i></span>${pct(r.detected / r.n)}</td>
    <td><span class="hbar bad"><i style="width:${pct(r.naiveHijacked / r.n)}"></i></span>${pct(r.naiveHijacked / r.n)}</td>
    <td><span class="hbar bad"><i style="width:${pct(r.guardedHijacked / r.n)}"></i></span>${pct(r.guardedHijacked / r.n)}</td></tr>`).join('')}
  </tbody></table>`;
}

export async function renderEval(el: HTMLElement) {
  const e = await getEval().catch(() => null);
  if (!e) {
    el.innerHTML = `<div class="placeholder"><h3>No evaluation yet</h3><p>Run <code>npm run eval</code> to score the detector and both agents on the ${'89'}-page benchmark. Results appear here.</p></div>`;
    return;
  }
  el.innerHTML = `
  <section class="rc-sec">
    <h4>Benchmark: ${e.cases} pages <span class="badge ${e.simulated ? 'badge-sim' : ''}">${esc(e.model)}</span></h4>
    <p class="muted small">Generated ${new Date(e.generatedAt).toLocaleString()} · quarantine threshold ${e.threshold}</p>
    <div class="kpis">
      <div><b>${pct(e.agent.naiveASR)}</b><span>Naive attack success</span></div>
      <div><b class="${e.agent.guardedASR > 0 ? 'bad' : 'good'}">${pct(e.agent.guardedASR)}</b><span>Guarded attack success</span></div>
      <div><b>${pct(e.detector.recall)}</b><span>Detector recall</span></div>
      <div><b>${pct(e.detector.fpr)}</b><span>False-positive rate</span></div>
      <div><b>${pct(e.agent.benignUtilityGuarded)}</b><span>Benign utility (guarded)</span></div>
      <div><b>${pct(e.agent.benignUtilityNaive)}</b><span>Benign utility (naive)</span></div>
    </div>
  </section>
  <section class="rc-sec"><h4>By hiding technique</h4>${bars(e.byTechnique)}</section>
  <section class="rc-sec"><h4>By attacker goal</h4>${bars(e.byPayload)}</section>
  <section class="rc-sec"><h4>Where it fails</h4>
    <p class="muted small">False positives (benign pages flagged): ${e.falsePositives.length ? e.falsePositives.map((x) => `<code>${esc(x)}</code>`).join(' ') : 'none'}</p>
    <p class="muted small">Missed attacks: ${e.misses.length ? e.misses.slice(0, 12).map((x) => `<code>${esc(x)}</code>`).join(' ') + (e.misses.length > 12 ? ` +${e.misses.length - 12} more` : '') : 'none'}</p>
  </section>`;
}
