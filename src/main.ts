import type { CrawlEvent, CrawlStats, PageReport } from '../shared/types.ts';
import { getConfig, startCrawl } from './api.ts';
import { Graph } from './graph.ts';
import type { Vec } from './ik.ts';
import { drawOverlayOver, drawOverlayUnder } from './overlay.ts';
import { Log, renderEval, renderPolicy } from './panels.ts';
import { calloutFor, renderReceipt } from './receipt.ts';
import { drawBackground, drawSpider } from './render.ts';
import { Spider, type Params } from './spider.ts';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('scene');
const ctx = canvas.getContext('2d')!;
const seedInput = $<HTMLInputElement>('seed');

let width = 0;
let height = 0;
let labOrigin = 'http://127.0.0.1:5320';

const graph = new Graph();
const params: Params = { threshold: 18, speed: 420, legLength: 44 };
const spider = new Spider(0, 0, params);
const target: Vec = { x: 0, y: 0 };

/** Reports arrive faster than the spider walks; they are revealed one by one as it reaches each node. */
const pending: PageReport[] = [];
let inspecting: string | null = null;
let dwell = 0;
let selected: string | null = null;
let hovered: string | null = null;
let crawlT0 = 0;
let stopCrawl: (() => void) | null = null;
let stats: CrawlStats | null = null;
let followSelection = true;
let speedMul = 1;
let showIK = false;
let crawling = false;

const log = new Log((url) => select(url));

function resize() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const first = width === 0;
  width = r.width;
  height = r.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  params.legLength = Math.round(Math.max(36, Math.min(64, Math.min(width, height) * 0.075)));
  params.threshold = Math.round(params.legLength * 0.4);
  spider.layout(params);
  graph.layout(width, height);
  if (first) {
    spider.pos = { x: width / 2, y: height / 2 };
    target.x = width / 2;
    target.y = height / 2;
    spider.plantAll();
  }
}
new ResizeObserver(resize).observe(stage);
resize();

// --- Tabs
const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]');
function showTab(name: string) {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll<HTMLElement>('.tab-body').forEach((b) => (b.hidden = b.id !== `tab-${name}`));
  if (name === 'eval') renderEval($('tab-eval'));
}
tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab!)));

function select(url: string, fromUser = true) {
  const n = graph.nodes.get(url);
  if (!n?.report) return;
  selected = url;
  if (fromUser) followSelection = false;
  renderReceipt($('tab-receipt'), n.report);
  if (fromUser) showTab('receipt');
}

function renderStats() {
  const el = $('stats');
  const revealed = [...graph.nodes.values()].filter((n) => n.report).map((n) => n.report!);
  if (!revealed.length && !crawling) {
    el.innerHTML = '';
    return;
  }
  const c = (d: string) => revealed.filter((r) => r.decision === d).length;
  const naive = revealed.filter((r) => r.agent?.naive.hijacked).length;
  const guarded = revealed.filter((r) => r.agent?.guarded.hijacked).length;
  const agentRuns = revealed.filter((r) => r.agent).length;
  el.innerHTML = `
    <span><b>${revealed.length}</b>/${graph.nodes.size} pages</span>
    <span class="s-collected"><b>${c('collected')}</b> collected</span>
    <span class="s-redacted"><b>${c('redacted')}</b> redacted</span>
    <span class="s-quarantined"><b>${c('quarantined')}</b> quarantined</span>
    <span class="s-skipped"><b>${c('skipped')}</b> skipped</span>
    ${agentRuns ? `<span class="s-hijack">AI hijacked: naive <b>${naive}</b> · guarded <b>${guarded}</b></span>` : ''}
    ${crawling ? '<span class="s-live">● crawling</span>' : stats ? '<span>done</span>' : ''}`;
}

function onEvent(e: CrawlEvent) {
  switch (e.type) {
    case 'start':
      crawlT0 = performance.now();
      break;
    case 'site':
      renderPolicy($('tab-policy'), e.policy);
      break;
    case 'discover':
      graph.add(e.url, e.parent, e.depth);
      graph.layout(width, height);
      break;
    case 'page': {
      const existing = graph.nodes.get(e.report.url);
      if (existing?.report) {
        // Second emit: AI agent finished — refresh the receipt without re-animating.
        existing.report = e.report;
        if (selected === e.report.url || followSelection) select(e.report.url, false);
      } else {
        const queued = pending.findIndex((p) => p.url === e.report.url);
        if (queued >= 0) pending[queued] = e.report;
        else pending.push(e.report);
      }
      break;
    }
    case 'done':
      stats = e.stats;
      break;
    case 'error':
      toast(`Crawler error: ${e.message}`);
      break;
  }
  renderStats();
}

function setCrawling(on: boolean) {
  crawling = on;
  $<HTMLButtonElement>('crawl').disabled = on;
  $<HTMLButtonElement>('stop').disabled = !on;
  renderStats();
}

function begin() {
  if (!seedInput.reportValidity()) return;
  stopCrawl?.();
  graph.clear();
  pending.length = 0;
  inspecting = null;
  selected = null;
  stats = null;
  followSelection = true;
  log.clear();
  $('empty').hidden = true;
  $('tab-receipt').innerHTML =
    '<div class="placeholder"><p>Crawling… the spider will stop at the first page and open its decision receipt. If AI agent is on, summaries fill in a moment later.</p></div>';
  setCrawling(true);
  const isLab = new URL(seedInput.value).origin === new URL(labOrigin).origin;
  stopCrawl = startCrawl(
    { seed: seedInput.value, maxPages: Number($<HTMLInputElement>('max-pages').value) || 25, compare: isLab && $<HTMLInputElement>('compare').checked, agent: $<HTMLInputElement>('agent').checked },
    onEvent,
    (err) => {
      stopCrawl = null;
      setCrawling(false);
      if (err) toast(err);
    },
  );
}

function revealNext(report: PageReport) {
  graph.reveal(report, performance.now(), calloutFor(report));
  log.add(report, (performance.now() - crawlT0) / 1000);
  if (followSelection) select(report.url, false);
  renderStats();
}

$('crawl-form').addEventListener('submit', (e) => {
  e.preventDefault();
  begin();
});
$('stop').addEventListener('click', () => stopCrawl?.());
$('use-lab').addEventListener('click', () => (seedInput.value = `${labOrigin}/`));
$('use-bench').addEventListener('click', () => {
  seedInput.value = `${labOrigin}/bench/`;
  $<HTMLInputElement>('max-pages').value = '90';
});
$('empty-start').addEventListener('click', () => {
  seedInput.value = `${labOrigin}/`;
  begin();
});
$('skip-anim').addEventListener('click', () => {
  while (pending.length) revealNext(pending.shift()!);
  inspecting = null;
});
$<HTMLInputElement>('speed').addEventListener('input', (e) => (speedMul = Number((e.target as HTMLInputElement).value)));
$<HTMLInputElement>('show-ik').addEventListener('change', (e) => (showIK = (e.target as HTMLInputElement).checked));

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  hovered = graph.hit(e.clientX - r.left, e.clientY - r.top)?.url ?? null;
  canvas.style.cursor = hovered ? 'pointer' : 'default';
});
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  const n = graph.hit(e.clientX - r.left, e.clientY - r.top);
  if (n?.report) select(n.url);
});

function toast(msg: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

getConfig()
  .then((cfg) => {
    labOrigin = cfg.labOrigin;
    seedInput.value = `${labOrigin}/`;
    const b = $('model-badge');
    b.textContent = cfg.simulated ? 'Simulated model' : cfg.model;
    b.classList.toggle('badge-sim', cfg.simulated);
    b.title = cfg.simulated ? 'No OPENAI_API_KEY set: a deliberately gullible simulated model stands in for the LLM.' : `AI agent uses ${cfg.model}`;
  })
  .catch(() => {
    $('model-badge').textContent = 'API offline';
    toast('Cannot reach the crawler API on port 5319. Start it with `npm run dev`.');
  });

// --- Animation loop
let last = performance.now();
let idleT = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  graph.step(dt);

  if (!inspecting && pending.length) {
    inspecting = pending[0].url;
    dwell = 0;
  }
  const node = inspecting ? graph.nodes.get(inspecting) : null;
  if (node) {
    target.x = node.x;
    target.y = node.y;
    if (Math.hypot(spider.pos.x - node.x, spider.pos.y - node.y) < 8) {
      dwell += dt * speedMul;
      if (dwell > 0.45) {
        revealNext(pending.shift()!);
        inspecting = null;
      }
    }
  } else if (!graph.root) {
    // Slow figure-eight so idle legs stay readable (not a frantic scribble).
    idleT += dt * 0.35;
    const r = Math.min(width, height) * 0.14;
    target.x = width / 2 + Math.sin(idleT) * r;
    target.y = height / 2 + Math.sin(idleT * 2) * r * 0.45;
  }

  const p = { ...params, speed: (graph.root ? params.speed : params.speed * 0.45) * speedMul };
  spider.update(dt, target, p);

  drawBackground(ctx, width, height);
  graph.drawWeb(ctx, width, height);
  graph.draw(ctx, now, { selected, hovered, inspecting, showAllLabels: graph.nodes.size <= (width < 600 ? 0 : 30) });
  if (showIK) drawOverlayUnder(ctx, spider, p, target, null);
  drawSpider(ctx, spider, null);
  if (showIK) drawOverlayOver(ctx, spider, p, null);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

