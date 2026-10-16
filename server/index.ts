import 'dotenv/config';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppConfig, CrawlEvent } from '../shared/types.ts';
import { crawl, pageCache } from './crawler.ts';
import { labRouter } from './lab/site.ts';
import { MODEL, SIMULATED, ablate } from './llm.ts';

const API_PORT = Number(process.env.API_PORT ?? 5319);
const LAB_PORT = Number(process.env.LAB_PORT ?? 5320);
const LAB_ORIGIN = process.env.LAB_ORIGIN ?? `http://127.0.0.1:${LAB_PORT}`;
const RESULTS = fileURLToPath(new URL('../bench/results/latest.json', import.meta.url));
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const api = express();
api.use(express.json());

api.get('/api/config', (_q, res) => {
  const cfg: AppConfig = { model: SIMULATED ? 'simulated-gullible-model' : MODEL, simulated: SIMULATED, labOrigin: LAB_ORIGIN };
  res.json(cfg);
});

api.get('/api/crawl', async (q, res) => {
  let seed: URL;
  try {
    seed = new URL(String(q.query.seed ?? `${LAB_ORIGIN}/`));
    if (!/^https?:$/.test(seed.protocol)) throw new Error('bad protocol');
  } catch {
    return void res.status(400).json({ error: 'Seed must be an http(s) URL.' });
  }
  const isLab = seed.origin === new URL(LAB_ORIGIN).origin;
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const emit = (e: CrawlEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await crawl(
      {
        seed: seed.toString(),
        maxPages: Math.min(Number(q.query.maxPages ?? 25) || 25, isLab ? 120 : 40),
        compare: isLab && q.query.compare === '1',
        runAgent: q.query.agent !== '0',
        minDelayMs: isLab ? 120 : 1000,
      },
      emit,
      controller.signal,
      { model: SIMULATED ? 'simulated-gullible-model' : MODEL, simulated: SIMULATED },
    );
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message });
  }
  res.end();
});

api.post('/api/explain', async (q, res) => {
  const cached = pageCache.get(String(q.body?.url ?? ''));
  if (!cached) return void res.status(404).json({ error: 'Page not in cache — crawl it first.' });
  try {
    res.json(await ablate(cached.title, cached.segments));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

api.get('/api/eval', (_q, res) => {
  if (!existsSync(RESULTS)) return void res.status(404).json({ error: 'No evaluation results yet. Run `npm run eval`.' });
  res.type('application/json').send(readFileSync(RESULTS, 'utf8'));
});

if (existsSync(DIST)) api.use(express.static(DIST));

api.listen(API_PORT, '0.0.0.0', () => console.log(`[api] http://127.0.0.1:${API_PORT}  model=${SIMULATED ? 'SIMULATED (set OPENAI_API_KEY for real runs)' : MODEL}`));

const lab = express();
lab.use(labRouter());
lab.listen(LAB_PORT, '0.0.0.0', () => console.log(`[lab] Willow Creek demo site on ${LAB_ORIGIN}`));
