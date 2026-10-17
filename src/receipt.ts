import type { Check, Layer, PageReport, Segment } from '../shared/types.ts';
import { esc, explainCausally } from './api.ts';
import { DECISION_COLOR, DECISION_LABEL } from './graph.ts';

const LAYER_TITLE: Record<Layer, string> = { consent: 'Consent', privacy: 'Privacy', security: 'Security', politeness: 'Politeness' };
const ICON: Record<Check['status'], string> = { pass: '✓', fail: '✕', warn: '!', info: 'i' };

export function calloutFor(r: PageReport): { title: string; text: string } {
  const fail = r.checks.find((c) => c.status === 'fail' && c.layer === 'consent');
  switch (r.decision) {
    case 'skipped':
      return { title: '⊘ Skipped: no consent', text: fail ? `${fail.label} ✕ — ${fail.detail.split('. ')[0]}.` : r.reason };
    case 'quarantined': {
      const top = [...r.segments].sort((a, b) => b.injectionScore - a.injectionScore)[0];
      const how = top?.hidden ? `hidden via ${top.hiddenReasons[0]}` : 'in visible text';
      const agent = r.agent ? (r.agent.naive.hijacked ? ' Naive agent was hijacked; Responsible Spider agent was not.' : '') : '';
      return { title: '! Prompt injection quarantined', text: `Instruction aimed at AI ${how}, score ${top?.injectionScore.toFixed(2)}.${agent}` };
    }
    case 'redacted':
      return { title: '• Personal data redacted', text: `${r.pii.length} item(s) (${[...new Set(r.pii.map((p) => p.kind))].join(', ')}) removed before storage and model input.` };
    case 'error':
      return { title: '× Fetch failed', text: r.reason };
    default:
      return { title: '✓ Collected', text: r.agent?.naive.hijacked ? 'Checks passed, but the naive agent was still hijacked — a miss.' : 'All consent, privacy and security checks passed.' };
  }
}

function checkHtml(c: Check): string {
  return `<li class="check-row st-${c.status}">
    <span class="ck-icon" aria-label="${c.status}">${ICON[c.status]}</span>
    <div><div class="ck-label">${esc(c.label)}</div><div class="ck-detail">${esc(c.detail)}</div>${c.evidence ? `<code class="ck-evidence">${esc(c.evidence)}</code>` : ''}</div>
  </li>`;
}

function segmentHtml(s: Segment): string {
  const pct = Math.round(s.injectionScore * 100);
  const sev = s.injectionScore >= 0.5 ? 'high' : s.injectionScore > 0 ? 'mid' : 'low';
  return `<li class="seg ${s.hidden ? 'seg-hidden' : ''} sev-${sev}">
    <div class="seg-head"><code>#${s.id} ${esc(s.where)}</code>${s.injectionScore > 0 ? `<span class="score"><i style="width:${pct}%"></i></span><b>${s.injectionScore.toFixed(2)}</b>` : ''}</div>
    <p class="seg-text">${esc(s.text.length > 320 ? `${s.text.slice(0, 320)}…` : s.text)}</p>
    <div class="chips">${s.hiddenReasons.map((r) => `<span class="chip chip-hidden">${esc(r)}</span>`).join('')}${s.injectionSignals.map((r) => `<span class="chip chip-signal">${esc(r)}</span>`).join('')}</div>
  </li>`;
}

export function renderReceipt(el: HTMLElement, r: PageReport) {
  const layers = (['consent', 'privacy', 'security', 'politeness'] as Layer[]).filter((l) => r.checks.some((c) => c.layer === l));
  const suspicious = r.segments.filter((s) => s.hidden || s.injectionScore > 0);
  const visibleCount = r.segments.filter((s) => !s.hidden).length;
  const a = r.agent;
  el.innerHTML = `
  <article class="receipt">
    <header class="rc-head" style="--c:${DECISION_COLOR[r.decision]}">
      <span class="decision">${DECISION_LABEL[r.decision]}</span>
      <h3>${esc(r.title)}</h3>
      <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" class="url">${esc(r.url)}</a>
      <p class="reason">${esc(r.reason)}</p>
    </header>

    <div class="versus">
      <div><span class="vs-k">Naive scraper</span><span class="vs-v bad">${r.naiveDecision === 'error' ? 'Error' : `Takes everything${r.hiddenChars ? `, incl. ${r.hiddenChars} hidden chars` : ''}${r.pii.length ? ` + ${r.pii.length} PII` : ''}`}</span></div>
      <div><span class="vs-k">Responsible spider</span><span class="vs-v" style="color:${DECISION_COLOR[r.decision]}">${r.fetchedByResponsible ? DECISION_LABEL[r.decision] : 'Never requests the page'}</span></div>
    </div>

    ${layers.map((l) => `<section class="rc-sec"><h4>${LAYER_TITLE[l]}</h4><ul class="checks">${r.checks.filter((c) => c.layer === l).map(checkHtml).join('')}</ul></section>`).join('')}

    ${a ? `
    <section class="rc-sec">
      <h4>AI agent: “summarise this page for me” <span class="badge ${a.simulated ? 'badge-sim' : ''}">${esc(a.model)}</span></h4>
      <div class="agents">
        <div class="agent ${a.naive.hijacked ? 'hijacked' : ''}">
          <div class="agent-head"><b>Naive agent</b><span>${a.naive.hijacked ? 'HIJACKED' : 'ok'}</span></div>
          <p class="agent-desc">Reads all page text, hidden or not, as plain prompt.</p>
          <blockquote>${esc(a.naive.output)}</blockquote>
          ${a.naive.hijackSignals.map((s) => `<span class="chip chip-signal">${esc(s)}</span>`).join('')}
        </div>
        <div class="agent ${a.guarded.hijacked ? 'hijacked' : 'safe'}">
          <div class="agent-head"><b>Responsible Spider agent</b><span>${a.guarded.hijacked ? 'HIJACKED' : 'ok'}</span></div>
          <p class="agent-desc">Hidden text dropped, injections quarantined, PII redacted, spotlighted as data.</p>
          <blockquote>${esc(a.guarded.output)}</blockquote>
          ${a.guarded.hijackSignals.map((s) => `<span class="chip chip-signal">${esc(s)}</span>`).join('')}
        </div>
      </div>
      ${suspicious.length ? `<button class="btn btn-sm" id="explain-btn">Explain causally: which segment caused it?</button><div id="ablation"></div>` : ''}
    </section>` : ''}

    <section class="rc-sec">
      <h4>What an AI would read <span class="muted">${visibleCount} visible · ${r.segments.length - visibleCount} hidden segments</span></h4>
      ${suspicious.length ? `<ul class="segs">${suspicious.map(segmentHtml).join('')}</ul>` : '<p class="muted">Nothing hidden or instruction-like on this page.</p>'}
      ${visibleCount ? `<details><summary>Show ${visibleCount} visible segment(s)</summary><ul class="segs">${r.segments.filter((s) => !s.hidden && s.injectionScore === 0).map(segmentHtml).join('')}</ul></details>` : ''}
    </section>
  </article>`;

  el.querySelector<HTMLButtonElement>('#explain-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const out = el.querySelector<HTMLElement>('#ablation')!;
    btn.disabled = true;
    btn.textContent = 'Re-running the naive agent without each suspicious segment…';
    try {
      const { baseline, results } = await explainCausally(r.url);
      out.innerHTML = `<p class="muted">Leave-one-out ablation. Baseline naive run: <b class="${baseline.hijacked ? 'bad' : 'good'}">${baseline.hijacked ? 'hijacked' : 'not hijacked'}</b>. A segment is <b>causal</b> if removing it alone stops the hijack.</p>
      <ul class="segs">${results.map((x) => `<li class="seg ${x.causal ? 'sev-high' : 'sev-low'}"><div class="seg-head"><code>#${x.segmentId} ${esc(x.where)}</code><b>${x.causal ? 'CAUSAL' : baseline.hijacked ? (x.hijackedWithout ? 'not causal' : '—') : 'no hijack to explain'}</b></div><p class="seg-text">${esc(x.text)}</p></li>`).join('')}</ul>`;
      btn.remove();
    } catch (err) {
      out.innerHTML = `<p class="bad">${esc((err as Error).message)}</p>`;
      btn.disabled = false;
      btn.textContent = 'Retry causal explanation';
    }
  });
}
