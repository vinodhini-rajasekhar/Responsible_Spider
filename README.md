# Responsible Spider

**An explainable AI web crawler that shows you, page by page, what it takes, what it refuses, and what tried to hijack it.**

AI companies build datasets and power "browse the web for me" agents with scrapers. Those scrapers are usually invisible. Nobody can see whether they honoured a site's opt-out, swept up someone's phone number, or obeyed a sentence hidden in white-on-white text that told the AI to lie. Responsible Spider makes all of that visible.

An animated spider walks a live map of a website. At each page it stops, checks it, and produces a **decision receipt**:

| Layer | What it checks | What it does |
|---|---|---|
| **Consent** | robots.txt (for itself *and* for AI-training bots such as GPTBot, CCBot, ClaudeBot and Google-Extended), `noai` / `noimageai`, TDMRep (`tdm-reservation`, `/.well-known/tdmrep.json`), `ai.txt`, licences and copyright notices | Never fetches opted-out pages, or discards them if the opt-out is only discoverable after fetching |
| **Privacy** | Emails, phone numbers, SSNs, Luhn-valid card numbers, IP addresses | Redacts them before storage or model input |
| **Security** | Text hidden from humans (display:none, white-on-white, zero font, off-screen, comments, alt text, `<noscript>`…), plus instruction-like text aimed at AI | Drops hidden text, quarantines likely prompt injections, and spotlights the rest as untrusted data |
| **Politeness** | Crawl-delay, `nofollow`, request rate | Waits and doesn't follow links when asked |

Every page is also summarised by two AI agents side by side. A **naive agent** reads the page the way most scrapers do: all text, hidden or not. The **Responsible Spider agent** reads it through the layers above. When the naive one gets hijacked, a **leave-one-out causal explanation** re-runs it without each suspicious segment and pinpoints which piece of hidden text caused the hijack.

> Built for a Responsible AI course final project (XAI, adversarial AI, AI governance). See [`docs/research.md`](docs/research.md) for the research questions, literature, method and results.

![Crawl in progress](docs/img/crawl.png)

## Quick start

Requires **Node 20+**.

```bash
npm install
cp .env.example .env        # optional: add your OpenAI key for real model runs
npm run dev
```

Then open **http://localhost:5317** and click **Crawl the lab site**.

`npm run dev` starts three things:

| Port | What |
|---|---|
| 5317 | Web UI (Vite) |
| 5319 | Crawler API (Express, server-sent events) |
| 5320 | **Willow Creek lab site**: a fake community-garden website with its own robots.txt, ai.txt and TDMRep file, booby-trapped with opt-outs, personal data and nine kinds of hidden prompt injection |

### OpenAI key (optional but recommended)

Put `OPENAI_API_KEY=sk-...` in `.env` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`; the poster eval used `gpt-4.1-mini` when `gpt-4o-mini`'s daily request budget was exhausted). Without a key, a **simulated model** stands in. It is deliberately gullible: it obeys any explicit instruction it is given, so the pipeline and UI are fully demoable offline. The UI labels it "Simulated model" everywhere. Simulated results show what the defence *filters*. They are **not** evidence about how real LLMs behave.

## Using it

- **Lab site**: the default seed. Turn on **Naive comparison** to also shadow-fetch opted-out pages and show what a consent-blind scraper would have taken. This is only allowed on the lab origin, never on real sites.
- **Benchmark**: crawls all 89 benchmark pages so you can watch the detector work at scale.
- **Any URL**: the crawler stays on the same origin, identifies itself honestly as `ResponsibleSpider/1.0`, waits at least 1s between requests (more if the site sets Crawl-delay), and is capped at 40 pages.
- Click any node, or any log entry, to open its receipt. In a receipt, **Explain causally** runs the leave-one-out attribution.
- **Site policy** shows the site's robots.txt rules for 12 known AI crawlers, plus its ai.txt and TDMRep files.
- **Evaluation** shows the latest benchmark results.

## Evaluation

```bash
npm run eval                 # 89-page injection benchmark (uses your OpenAI key if set)
npm run eval -- --no-agent   # detector only, no model calls
npm run audit                # real-world robots.txt audit of 49 popular sites
```

Results are written to `bench/results/` as JSON and Markdown, and the Evaluation tab reads them.

**Real-world audit (robots.txt, 16 Oct 2026):** 29 of 44 reachable popular sites (66%) block at least one AI crawler from their homepage. All 9 news sites do. 19 sites block GPTBot while still allowing Googlebot: "search yes, AI training no". Full table: [`bench/results/ai-bot-audit.md`](bench/results/ai-bot-audit.md).

**Benchmark — real model `gpt-4.1-mini`, stratified 17 pages (17 Oct 2026):** naive agent ASR **89%**, Responsible Spider agent ASR **0%**, benign utility 100%/100%, detector precision/recall 89%/89%, false-positive rate 13%. Missed attack: subtle visible phrasing. False positive: a benign article *about* prompt injection. Full 89-page simulated run and methods: [`docs/research.md`](docs/research.md#results), [`bench/results/latest.md`](bench/results/latest.md).

## Project layout

```
server/
  index.ts              API (5319) + lab site (5320)
  crawler.ts            BFS crawl, decisions, streaming events
  llm.ts                naive vs Responsible Spider agents, simulated model, leave-one-out ablation
  analyze/
    consent.ts          robots.txt / AI bots / ai.txt / TDMRep / noai / licence checks
    extract.ts          page → text segments + why each is (in)visible to humans
    injection.ts        transparent, weighted prompt-injection signals
    pii.ts              PII detection + redaction
  lab/
    site.ts             Willow Creek demo site
    templates.ts        articles + 9 hiding techniques
    payloads.ts         3 attacker goals with output detectors
    bench.ts            89-case benchmark generator
src/                    UI: canvas web graph + procedural spider + receipt panels
  graph.ts              radial "spider web" layout and drawing
  spider.ts, ik.ts      procedural spider (2-bone IK legs, tetrapod gait)
  receipt.ts, panels.ts receipts, site policy, log, evaluation views
shared/types.ts         types shared by server and UI
bench/                  run.ts (benchmark), ai-bot-audit.ts, sites.csv, results/
docs/research.md        research framing, literature, method, results, limitations
```

## Known limitations

- **Static visibility analysis.** Hidden text is detected from inline styles and simple `<style>` rules, not a real rendering engine. External stylesheets, the full cascade and JavaScript-rendered content are missed. A headless-browser pass would close most of this gap.
- **The heuristic detector can be evaded.** Injections phrased without trigger words get through (0% detected in the benchmark), and articles *about* injection get flagged. The detector is transparent by design, and its failures are part of what the project shows.
- **Opt-out signals are fragmented and voluntary.** robots.txt was built for search, not AI. `ai.txt`, `noai` and TDMRep have patchy adoption, and none of them is technically enforced.
- **Simulated results are circular.** The stand-in model obeys roughly the same patterns the detector looks for. Use a real model for real conclusions.
- **Small, synthetic benchmark.** It has 89 pages, 3 articles, 3 attacker goals and 9 techniques. Real attacks are more varied, and adaptive attackers would target the detector directly.

## Responsible use

The crawler is meant for research and education. It is rate-limited, origin-bound, identifies itself honestly, and refuses to shadow-fetch opted-out pages on any site except the bundled lab. Don't remove those guardrails to crawl sites that have said no. The lab site's attack pages are synthetic, and their "phishing" domain uses the reserved `.example` TLD.

## Credits

The procedural spider animation is inspired by Slava Rybin's ([@rybinfx](https://x.com/rybinfx)) cursor-following spider; this is an original implementation. Built with Vite, TypeScript, Canvas 2D, Express, cheerio and robots-parser.
