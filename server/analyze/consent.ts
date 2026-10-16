import robotsParser from 'robots-parser';
import type { BotPolicy, Check, SitePolicy } from '../../shared/types.ts';
import type { Extraction } from './extract.ts';

export const USER_AGENT = 'ResponsibleSpider/1.0 (+research crawler; honours robots.txt, noai, TDMRep, ai.txt)';
export const UA_TOKEN = 'ResponsibleSpider';

export const AI_BOTS: { bot: string; owner: string; purpose: string }[] = [
  { bot: 'GPTBot', owner: 'OpenAI', purpose: 'model training' },
  { bot: 'ChatGPT-User', owner: 'OpenAI', purpose: 'live browsing for users' },
  { bot: 'OAI-SearchBot', owner: 'OpenAI', purpose: 'AI search index' },
  { bot: 'ClaudeBot', owner: 'Anthropic', purpose: 'model training' },
  { bot: 'anthropic-ai', owner: 'Anthropic', purpose: 'model training (legacy token)' },
  { bot: 'Google-Extended', owner: 'Google', purpose: 'Gemini training' },
  { bot: 'CCBot', owner: 'Common Crawl', purpose: 'open web dataset' },
  { bot: 'PerplexityBot', owner: 'Perplexity', purpose: 'AI search index' },
  { bot: 'Bytespider', owner: 'ByteDance', purpose: 'model training' },
  { bot: 'Applebot-Extended', owner: 'Apple', purpose: 'model training' },
  { bot: 'meta-externalagent', owner: 'Meta', purpose: 'model training' },
  { bot: 'cohere-ai', owner: 'Cohere', purpose: 'model training' },
];
const TRAINING_BOTS = new Set(['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'CCBot', 'Bytespider', 'Applebot-Extended', 'meta-externalagent', 'cohere-ai']);

type Robots = ReturnType<typeof robotsParser>;

export interface SiteContext {
  policy: SitePolicy;
  robots: Robots;
  robotsLines: string[];
  aiTxtRobots: Robots | null;
  tdmRules: { location: string; reservation: number; policy?: string }[];
}

async function fetchText(url: string, timeoutMs = 8000): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    return { status: res.status, text: res.ok ? await res.text() : '' };
  } catch {
    return null;
  }
}

export async function loadSite(origin: string): Promise<SiteContext> {
  const [robotsRes, aiRes, tdmRes] = await Promise.all([
    fetchText(`${origin}/robots.txt`),
    fetchText(`${origin}/ai.txt`),
    fetchText(`${origin}/.well-known/tdmrep.json`),
  ]);
  const robotsText = robotsRes?.status === 200 ? robotsRes.text.slice(0, 200_000) : '';
  const robots = robotsParser(`${origin}/robots.txt`, robotsText);
  const root = `${origin}/`;
  const bots: BotPolicy[] = AI_BOTS.map((b) => ({
    ...b,
    rootAllowed: robots.isAllowed(root, b.bot) !== false,
    line: robots.getMatchingLineNumber(root, b.bot),
  }));

  const aiTxt = aiRes?.status === 200 && !/<html/i.test(aiRes.text) ? aiRes.text.slice(0, 20_000) : null;
  let tdmRules: SiteContext['tdmRules'] = [];
  let tdmRep: string | null = null;
  if (tdmRes?.status === 200) {
    try {
      const parsed = JSON.parse(tdmRes.text);
      if (Array.isArray(parsed)) {
        tdmRules = parsed;
        tdmRep = tdmRes.text.slice(0, 5000);
      }
    } catch {
      /* not a TDMRep file */
    }
  }

  return {
    policy: {
      origin,
      robotsFound: !!robotsText,
      robotsText: robotsText.slice(0, 6000),
      crawlDelay: robots.getCrawlDelay(UA_TOKEN) ?? robots.getCrawlDelay('*') ?? null,
      bots,
      aiTxt,
      tdmRep,
    },
    robots,
    robotsLines: robotsText.split('\n'),
    aiTxtRobots: aiTxt ? robotsParser(`${origin}/ai.txt`, aiTxt) : null,
    tdmRules,
  };
}

function lineEvidence(site: SiteContext, line: number): string | undefined {
  if (line < 1) return undefined;
  return `robots.txt line ${line}: ${site.robotsLines[line - 1]?.trim()}`;
}

function globMatch(pattern: string, path: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`);
  return re.test(path);
}

/** Checks that can be answered before fetching. A failure means the responsible crawler never requests the page. */
export function preFetchChecks(url: string, site: SiteContext): Check[] {
  const checks: Check[] = [];
  const path = new URL(url).pathname;

  const selfAllowed = site.robots.isAllowed(url, UA_TOKEN) !== false;
  checks.push({
    id: 'robots-self', layer: 'consent', label: 'robots.txt permits this crawler',
    status: selfAllowed ? 'pass' : 'fail',
    detail: site.policy.robotsFound
      ? selfAllowed ? `No rule blocks ${UA_TOKEN} (or *) from ${path}.` : `The site blocks ${UA_TOKEN}/all crawlers from ${path}.`
      : 'No robots.txt found — by convention everything is allowed.',
    evidence: lineEvidence(site, site.robots.getMatchingLineNumber(url, UA_TOKEN)),
  });

  const blockedAi = AI_BOTS.filter((b) => TRAINING_BOTS.has(b.bot) && site.robots.isAllowed(url, b.bot) === false);
  const firstLine = blockedAi.length ? site.robots.getMatchingLineNumber(url, blockedAi[0].bot) : -1;
  checks.push({
    id: 'robots-ai', layer: 'consent', label: 'Site has not opted out of AI training',
    status: blockedAi.length ? 'fail' : 'pass',
    detail: blockedAi.length
      ? `${path} is closed to AI-training crawlers (${blockedAi.map((b) => b.bot).join(', ')}). We collect for AI use, so we treat this as an opt-out even though our own user-agent isn't named.`
      : 'No AI-training crawler is disallowed here.',
    evidence: lineEvidence(site, firstLine),
  });

  if (site.aiTxtRobots) {
    const ok = site.aiTxtRobots.isAllowed(url, '*') !== false;
    checks.push({
      id: 'ai-txt', layer: 'consent', label: 'ai.txt permits AI use',
      status: ok ? 'pass' : 'fail',
      detail: ok ? 'ai.txt does not reserve this path.' : `ai.txt disallows AI use of ${path}.`,
      evidence: `ai.txt line ${site.aiTxtRobots.getMatchingLineNumber(url, '*')}`,
    });
  }

  const tdm = site.tdmRules.find((r) => globMatch(r.location, path));
  if (site.tdmRules.length) {
    checks.push({
      id: 'tdmrep', layer: 'consent', label: 'No text-and-data-mining reservation (TDMRep)',
      status: tdm?.reservation === 1 ? 'fail' : 'pass',
      detail: tdm?.reservation === 1
        ? `/.well-known/tdmrep.json reserves TDM rights for "${tdm.location}" (EU DSM Directive Art. 4 opt-out).`
        : 'tdmrep.json exists but does not reserve this path.',
      evidence: tdm ? JSON.stringify(tdm) : undefined,
    });
  }

  if (site.policy.crawlDelay) {
    checks.push({
      id: 'crawl-delay', layer: 'politeness', label: 'Crawl-delay honoured', status: 'info',
      detail: `robots.txt asks for ${site.policy.crawlDelay}s between requests; the crawler waits at least that long.`,
    });
  }
  return checks;
}

/** Signals only visible after fetching: headers and in-page markup. A failure means content is discarded. */
export function postFetchChecks(headers: Headers, ex: Extraction): { checks: Check[]; follow: boolean } {
  const checks: Check[] = [];
  const xRobots = (headers.get('x-robots-tag') ?? '').toLowerCase();
  const directives = `${ex.metaRobots}, ${xRobots}`;
  const noai = /\bnoai\b/.test(directives);
  const noimageai = /\bnoimageai\b/.test(directives);
  const nofollow = /\b(nofollow|none)\b/.test(directives);
  const noindex = /\b(noindex|none)\b/.test(directives);

  checks.push({
    id: 'noai', layer: 'consent', label: 'No "noai" directive',
    status: noai ? 'fail' : 'pass',
    detail: noai
      ? 'The page opts out of AI use via a noai directive. Content is discarded after fetch (the signal is only discoverable by fetching).'
      : noimageai ? 'Images are opted out (noimageai); text is allowed.' : 'No noai/noimageai directive.',
    evidence: directives.replace(/^,\s*|,\s*$/g, '') ? `robots directives: ${directives.replace(/^,\s*|,\s*$/g, '')}` : undefined,
  });

  const tdmHeader = headers.get('tdm-reservation');
  const tdmReserved = ex.metaTdm === '1' || tdmHeader === '1';
  if (ex.metaTdm !== null || tdmHeader !== null) {
    checks.push({
      id: 'tdm-meta', layer: 'consent', label: 'No in-page TDM reservation',
      status: tdmReserved ? 'fail' : 'pass',
      detail: tdmReserved ? 'tdm-reservation=1 — the publisher reserves text-and-data-mining rights.' : 'tdm-reservation present but set to 0.',
      evidence: ex.metaTdm !== null ? `<meta name="tdm-reservation" content="${ex.metaTdm}">` : `TDM-Reservation: ${tdmHeader}`,
    });
  }

  if (nofollow) {
    checks.push({ id: 'nofollow', layer: 'politeness', label: 'Links may be followed', status: 'warn', detail: 'nofollow: links on this page are not queued.' });
  }
  if (noindex) {
    checks.push({ id: 'noindex', layer: 'consent', label: 'Indexing preference', status: 'info', detail: 'noindex: the page asks not to be indexed by search engines. Not an AI opt-out, but noted.' });
  }

  if (ex.licenseHref) {
    const cc = /creativecommons\.org\/(licenses|publicdomain)\/([\w-]+)/i.exec(ex.licenseHref);
    const nc = cc && /nc/i.test(cc[2]);
    checks.push({
      id: 'license', layer: 'consent', label: 'Licence permits reuse',
      status: nc ? 'warn' : 'pass',
      detail: cc ? `Creative Commons ${cc[2].toUpperCase()}${nc ? ' — non-commercial only; commercial model training would breach it.' : ' — reuse allowed with attribution.'}` : `Declared licence: ${ex.licenseHref}`,
      evidence: ex.licenseHref,
    });
  } else if (ex.copyrightNotice) {
    checks.push({
      id: 'license', layer: 'consent', label: 'Licence permits reuse', status: 'warn',
      detail: 'No open licence; a copyright notice is present. Reuse rests on fair use / TDM exceptions, which vary by jurisdiction.',
      evidence: ex.copyrightNotice,
    });
  } else {
    checks.push({ id: 'license', layer: 'consent', label: 'Licence permits reuse', status: 'info', detail: 'No licence or copyright notice found.' });
  }

  return { checks, follow: !nofollow };
}
