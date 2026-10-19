import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { loadSite, preFetchChecks, type SiteContext } from '../server/analyze/consent.ts';

const ROBOTS = ['User-agent: GPTBot', 'Disallow: /blog/', '', 'User-agent: *', 'Disallow: /private/'].join('\n');

let server: Server;
let origin: string;
let site: SiteContext;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ROBOTS);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  site = await loadSite(origin);
});

after(() => server.close());

const status = (path: string, id: string) => preFetchChecks(`${origin}${path}`, site).find((c) => c.id === id)?.status;

test('an open path passes both robots checks', () => {
  assert.equal(status('/about', 'robots-self'), 'pass');
  assert.equal(status('/about', 'robots-ai'), 'pass');
});

test('a path closed to all crawlers fails the self check', () => {
  assert.equal(status('/private/notes', 'robots-self'), 'fail');
});

test('a path closed only to an AI-training bot is treated as an AI opt-out', () => {
  assert.equal(status('/blog/tomatoes', 'robots-self'), 'pass');
  assert.equal(status('/blog/tomatoes', 'robots-ai'), 'fail');
});

test('the AI opt-out check cites the robots.txt line as evidence', () => {
  const check = preFetchChecks(`${origin}/blog/tomatoes`, site).find((c) => c.id === 'robots-ai');
  assert.match(check?.evidence ?? '', /line 2/);
});
