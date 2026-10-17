import type { Check, CrawlEvent, CrawlStats, PageReport, Segment } from '../shared/types.ts';
import { USER_AGENT, loadSite, postFetchChecks, preFetchChecks } from './analyze/consent.ts';
import { extractPage } from './analyze/extract.ts';
import { QUARANTINE_THRESHOLD } from './analyze/injection.ts';
import { findPii } from './analyze/pii.ts';
import { compareAgents, judgeInjections } from './llm.ts';

export interface CrawlOptions {
  seed: string;
  maxPages: number;
  /** Shadow-fetch opted-out pages to show what a naive scraper would take. Only allowed on the lab origin. */
  compare: boolean;
  runAgent: boolean;
  minDelayMs: number;
}

/** Page content kept in memory so the UI can request causal explanations later. */
export const pageCache = new Map<string, { title: string; segments: Segment[] }>();

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

function securityChecks(segments: Segment[]): Check[] {
  const hidden = segments.filter((s) => s.hidden);
  const visualHidden = hidden.filter((s) => !s.hiddenReasons.every((r) => r.startsWith('image alt text') || r.startsWith('title tooltip')));
  const flagged = segments.filter((s) => s.injectionScore >= QUARANTINE_THRESHOLD).sort((a, b) => b.injectionScore - a.injectionScore);
  const checks: Check[] = [
    {
      id: 'hidden', layer: 'security', label: 'Text a human can see matches text an AI reads',
      status: visualHidden.length ? 'warn' : 'pass',
      detail: visualHidden.length
        ? `${visualHidden.length} text segment(s) are invisible to people but would reach a naive AI pipeline (${[...new Set(visualHidden.flatMap((s) => s.hiddenReasons))].slice(0, 3).join('; ')}). They are dropped before the Responsible Spider agent.`
        : hidden.length ? `Only alt/title text is hidden (${hidden.length}); kept unless it looks like an instruction.` : 'No hidden text.',
    },
  ];
  const cleared = segments.filter((s) => s.injectionSignals.some((x) => x.startsWith('cleared by context judge')));
  checks.push({
    id: 'injection', layer: 'security', label: 'No instructions aimed at AI systems',
    status: flagged.length ? 'fail' : cleared.length ? 'pass' : 'pass',
    detail: flagged.length
      ? `${flagged.length} segment(s) scored ≥ ${QUARANTINE_THRESHOLD} for prompt injection and were quarantined after a full-sentence context check. Top signals: ${flagged[0].injectionSignals.slice(0, 3).join('; ')}.`
      : cleared.length
        ? `Short-phrase heuristics raised ${cleared.length} candidate(s), but the context judge cleared them as ordinary prose (not an injection).`
        : 'No segment crossed the quarantine threshold.',
    evidence: flagged[0]
      ? `${flagged[0].where}: "${flagged[0].text.slice(0, 160)}${flagged[0].text.length > 160 ? '…' : ''}"`
      : cleared[0]
        ? `${cleared[0].where}: ${cleared[0].injectionSignals.find((x) => x.startsWith('cleared by'))}`
        : undefined,
  });
  return checks;
}

export async function crawl(opts: CrawlOptions, emit: (e: CrawlEvent) => void, signal: AbortSignal, meta: { model: string; simulated: boolean }) {
  const seed = new URL(opts.seed);
  seed.hash = '';
  const origin = seed.origin;
  emit({ type: 'start', seed: seed.toString(), origin, compare: opts.compare, maxPages: opts.maxPages, ...meta });

  const site = await loadSite(origin);
  emit({ type: 'site', policy: site.policy });

  const stats: CrawlStats = { pages: 0, collected: 0, redacted: 0, quarantined: 0, skipped: 0, errors: 0, piiRedacted: 0, hiddenSegments: 0, injectionsFlagged: 0, naiveHijacked: 0, guardedHijacked: 0 };
  const queue: { url: string; depth: number; parent: string | null }[] = [{ url: seed.toString(), depth: 0, parent: null }];
  const seen = new Set([seed.toString()]);
  emit({ type: 'discover', url: seed.toString(), parent: null, depth: 0 });
  const delayMs = Math.max(opts.minDelayMs, (site.policy.crawlDelay ?? 0) * 1000);
  let lastFetch = 0;

  while (queue.length && stats.pages < opts.maxPages && !signal.aborted) {
    const { url, depth, parent } = queue.shift()!;
    const u = new URL(url);
    const report: PageReport = {
      id: url, url, path: u.pathname + u.search, depth, parent, title: u.pathname, httpStatus: null,
      decision: 'collected', naiveDecision: 'collected', reason: '', checks: preFetchChecks(url, site), links: [], segments: [], pii: [],
      visibleChars: 0, hiddenChars: 0, injectionRisk: 0, fetchedByResponsible: true,
    };
    const preFail = report.checks.find((c) => c.status === 'fail');
    stats.pages++;

    if (preFail && !opts.compare) {
      report.decision = 'skipped';
      report.naiveDecision = 'collected';
      report.fetchedByResponsible = false;
      report.reason = `Not fetched: ${preFail.label.toLowerCase()} failed. ${preFail.detail}`;
      stats.skipped++;
      emit({ type: 'page', report });
      continue;
    }

    const wait = lastFetch + delayMs - Date.now();
    if (wait > 0) await sleep(wait, signal);
    if (signal.aborted) break;
    lastFetch = Date.now();

    let res: Response;
    let html: string;
    try {
      res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'follow' });
      report.httpStatus = res.status;
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) throw new Error(res.ok ? `not HTML (${type || 'unknown type'})` : `HTTP ${res.status}`);
      html = (await res.text()).slice(0, 1_500_000);
    } catch (err) {
      report.decision = 'error';
      report.naiveDecision = 'error';
      report.reason = `Fetch failed: ${(err as Error).message}`;
      stats.errors++;
      emit({ type: 'page', report });
      continue;
    }

    const ex = extractPage(html, url);
    // Context-check candidates before quarantine. With AI agent off, use the fast local
    // judge only so crawls never stall on OpenAI rate limits.
    await judgeInjections(ex.segments, { llm: opts.runAgent });
    const post = postFetchChecks(res.headers, ex);
    report.title = ex.title;
    report.segments = ex.segments;
    report.pii = findPii(ex.segments.map((s) => s.text).join('\n'));
    report.visibleChars = ex.segments.filter((s) => !s.hidden).reduce((n, s) => n + s.text.length, 0);
    report.hiddenChars = ex.segments.filter((s) => s.hidden).reduce((n, s) => n + s.text.length, 0);
    report.injectionRisk = Math.max(0, ...ex.segments.map((s) => s.injectionScore));
    report.checks.push(...post.checks);
    if (report.pii.length) {
      const kinds = [...new Set(report.pii.map((p) => p.kind))];
      report.checks.push({ id: 'pii', layer: 'privacy', label: 'No personal data', status: 'warn', detail: `${report.pii.length} item(s) of personal data (${kinds.join(', ')}) are redacted before storage or model input.`, evidence: report.pii.slice(0, 3).map((p) => `${p.kind}: ${p.value.replace(/(.{3}).+(.{2})/, '$1…$2')}`).join('; ') });
    } else {
      report.checks.push({ id: 'pii', layer: 'privacy', label: 'No personal data', status: 'pass', detail: 'No emails, phone numbers, SSNs, card numbers or IPs detected.' });
    }
    report.checks.push(...securityChecks(ex.segments));
    pageCache.set(url, { title: ex.title, segments: ex.segments });
    if (pageCache.size > 500) pageCache.delete(pageCache.keys().next().value!);

    const consentFail = preFail ?? post.checks.find((c) => c.layer === 'consent' && c.status === 'fail');
    const flagged = ex.segments.filter((s) => s.injectionScore >= QUARANTINE_THRESHOLD).length;
    stats.hiddenSegments += ex.segments.filter((s) => s.hidden).length;
    stats.injectionsFlagged += flagged;

    if (consentFail) {
      report.decision = 'skipped';
      report.fetchedByResponsible = !preFail;
      report.reason = preFail
        ? `A responsible crawler would never fetch this page (${preFail.label.toLowerCase()} failed). Shown only because naive-comparison mode is on for the lab site.`
        : `Fetched, then discarded: ${consentFail.detail}`;
      stats.skipped++;
    } else if (flagged) {
      report.decision = 'quarantined';
      report.reason = `Collected with ${flagged} instruction-like segment(s) quarantined; the Responsible Spider agent never sees them.`;
      stats.quarantined++;
    } else if (report.pii.length) {
      report.decision = 'redacted';
      report.reason = `Collected with ${report.pii.length} personal-data item(s) redacted.`;
      stats.redacted++;
      stats.piiRedacted += report.pii.length;
    } else {
      report.decision = 'collected';
      report.reason = 'All consent, privacy and security checks passed.';
      stats.collected++;
    }

    if (post.follow) {
      for (const link of ex.links) {
        const lu = new URL(link);
        if (lu.origin !== origin || seen.has(link) || /\.(png|jpe?g|gif|svg|pdf|zip|css|js)$/i.test(lu.pathname)) continue;
        seen.add(link);
        report.links.push(link);
        queue.push({ url: link, depth: depth + 1, parent: url });
      }
    }
    // Emit the decision receipt immediately so the UI never stalls on the model.
    emit({ type: 'page', report: { ...report, agent: undefined } });
    for (const link of report.links) emit({ type: 'discover', url: link, parent: url, depth: depth + 1 });

    if (opts.runAgent && (report.decision !== 'skipped' || opts.compare) && ex.segments.length) {
      try {
        report.agent = await compareAgents(ex.title, ex.segments, report.pii);
        if (report.agent.naive.hijacked) stats.naiveHijacked++;
        if (report.agent.guarded.hijacked) stats.guardedHijacked++;
        emit({ type: 'page', report });
      } catch (err) {
        report.checks.push({ id: 'agent', layer: 'security', label: 'AI agent run', status: 'warn', detail: `Model call failed: ${(err as Error).message}` });
        emit({ type: 'page', report });
      }
    }
  }
  emit({ type: 'done', stats });
}
