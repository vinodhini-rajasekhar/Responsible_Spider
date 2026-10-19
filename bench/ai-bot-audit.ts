/**
 * Real-world audit: which popular sites tell AI crawlers to stay out via robots.txt?
 * Fetches only /robots.txt (one polite request per site).
 *
 *   npm run audit
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import robotsParser from 'robots-parser';
import { AI_BOTS, USER_AGENT } from '../server/analyze/consent.ts';

const sites = readFileSync(fileURLToPath(new URL('./sites.csv', import.meta.url)), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [domain, category] = l.split(',').map((s) => s.trim());
    return { domain, category };
  });

interface SiteResult {
  domain: string;
  category: string;
  ok: boolean;
  blocked: string[];
  allowed: string[];
  searchBlocked: boolean;
}

async function audit(s: { domain: string; category: string }): Promise<SiteResult> {
  const url = `https://${s.domain}/robots.txt`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    const text = res.ok ? await res.text() : '';
    const robots = robotsParser(url, text);
    const root = `https://${s.domain}/`;
    const blocked = AI_BOTS.filter((b) => robots.isAllowed(root, b.bot) === false).map((b) => b.bot);
    return { ...s, ok: res.ok, blocked, allowed: AI_BOTS.map((b) => b.bot).filter((b) => !blocked.includes(b)), searchBlocked: robots.isAllowed(root, 'Googlebot') === false };
  } catch {
    return { ...s, ok: false, blocked: [], allowed: [], searchBlocked: false };
  }
}

const results: SiteResult[] = [];
for (const s of sites) {
  results.push(await audit(s));
  process.stdout.write(`\r  ${results.length}/${sites.length} sites`);
}
process.stdout.write('\n');

const ok = results.filter((r) => r.ok);
const perBot = AI_BOTS.map((b) => ({ ...b, blockedBy: ok.filter((r) => r.blocked.includes(b.bot)).length }));
const categories = [...new Set(ok.map((r) => r.category))].map((c) => {
  const rs = ok.filter((r) => r.category === c);
  return { category: c, sites: rs.length, anyAiBlocked: rs.filter((r) => r.blocked.length > 0).length };
});
const summary = {
  generatedAt: new Date().toISOString(),
  sitesAudited: ok.length,
  sitesFailed: results.length - ok.length,
  anyAiBlocked: ok.filter((r) => r.blocked.length > 0).length,
  gptBotBlockedButSearchAllowed: ok.filter((r) => r.blocked.includes('GPTBot') && !r.searchBlocked).length,
  perBot,
  categories,
  sites: results,
};

const dir = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}ai-bot-audit.json`, JSON.stringify(summary, null, 2));
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const md = `# AI-crawler opt-out audit (robots.txt)

Generated ${summary.generatedAt}. ${ok.length} sites audited (${summary.sitesFailed} unreachable).

**${summary.anyAiBlocked} of ${ok.length} sites (${pct(summary.anyAiBlocked, ok.length)}) block at least one AI crawler from their homepage.** ${summary.gptBotBlockedButSearchAllowed} block GPTBot while still allowing Googlebot, i.e. "search yes, AI training no".

## By crawler

| Crawler | Owner | Purpose | Sites blocking |
|---|---|---|---|
${perBot.map((b) => `| ${b.bot} | ${b.owner} | ${b.purpose} | ${b.blockedBy} (${pct(b.blockedBy, ok.length)}) |`).join('\n')}

## By category

| Category | Sites | Block ≥1 AI crawler |
|---|---|---|
${categories.map((c) => `| ${c.category} | ${c.sites} | ${c.anyAiBlocked} (${pct(c.anyAiBlocked, c.sites)}) |`).join('\n')}

## Per site

| Site | Category | Blocked AI crawlers |
|---|---|---|
${results.map((r) => `| ${r.domain} | ${r.category} | ${r.ok ? r.blocked.join(', ') || 'none' : 'unreachable'} |`).join('\n')}
`;
writeFileSync(`${dir}ai-bot-audit.md`, md);
console.log(md);
