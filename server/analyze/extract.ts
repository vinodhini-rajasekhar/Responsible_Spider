import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { Segment } from '../../shared/types.ts';
import { scoreInjection } from './injection.ts';

/**
 * Splits a page into text segments and records *why* each one would or would
 * not be seen by a human. This is a static approximation: it understands inline
 * styles and simple `.class` / `#id` / `tag` rules in <style> blocks, not the
 * full cascade, external stylesheets or JavaScript-rendered content.
 */

type Decls = Record<string, string>;

const BLOCK = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'aside', 'header', 'footer',
  'blockquote', 'td', 'th', 'figcaption', 'pre', 'main', 'nav', 'dd', 'dt', 'noscript', 'template', 'body',
]);
const SKIP = new Set(['script', 'style', 'svg', 'head']);
const WHITE = /^(#fff|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*1\s*\))$/i;

function parseDecls(src: string): Decls {
  const out: Decls = {};
  for (const part of src.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase().replace(/\s*!important/, '');
  }
  return out;
}

function parseStyleRules($: CheerioAPI): Map<string, Decls> {
  const rules = new Map<string, Decls>();
  $('style').each((_, el) => {
    const css = $(el).text().replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls = parseDecls(m[2]);
      for (const sel of m[1].split(',').map((s) => s.trim())) {
        if (/^[.#]?[\w-]+$/.test(sel)) rules.set(sel, { ...(rules.get(sel) ?? {}), ...decls });
      }
    }
  });
  return rules;
}

function px(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^(-?[\d.]+)(px|em|rem|pt|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'em' || m[2] === 'rem' ? n * 16 : n;
}

function hidingReasons(d: Decls, el: Element, inheritedBg: string | null): string[] {
  const r: string[] = [];
  if (d.display === 'none') r.push('display: none');
  if (d.visibility === 'hidden' || d.visibility === 'collapse') r.push('visibility: hidden');
  if (d.opacity !== undefined && parseFloat(d.opacity) < 0.05) r.push('opacity ≈ 0');
  const fs = px(d['font-size']);
  if (fs !== null && fs <= 2) r.push(`font-size ${d['font-size']}`);
  const bg = d['background-color'] ?? d.background ?? inheritedBg;
  if (d.color) {
    if (bg && d.color === bg) r.push('text colour matches background');
    else if (!bg && WHITE.test(d.color)) r.push('white text on default white page');
  }
  if ((d.position === 'absolute' || d.position === 'fixed') && [d.left, d.top, d.right].some((v) => (px(v) ?? 0) <= -500)) {
    r.push('positioned off-screen');
  }
  if ((px(d['text-indent']) ?? 0) <= -500) r.push('text-indent off-screen');
  if ((px(d.height) === 0 || px(d.width) === 0 || px(d['max-height']) === 0) && d.overflow === 'hidden') r.push('zero-size box with overflow hidden');
  if (/rect\(\s*0/.test(d.clip ?? '') || /inset\(\s*50%/.test(d['clip-path'] ?? '')) r.push('clipped to nothing');
  if (el.attribs?.hidden !== undefined) r.push('hidden attribute');
  if (el.name === 'noscript') r.push('<noscript> (only shown without JavaScript)');
  if (el.name === 'template') r.push('<template> (never rendered)');
  return r;
}

function describe(el: Element): string {
  const id = el.attribs?.id ? `#${el.attribs.id}` : '';
  const cls = el.attribs?.class ? `.${el.attribs.class.trim().split(/\s+/).join('.')}` : '';
  return `${el.name}${id}${cls}`;
}

export interface Extraction {
  title: string;
  segments: Segment[];
  links: string[];
  metaRobots: string;
  metaTdm: string | null;
  licenseHref: string | null;
  copyrightNotice: string | null;
}

export function extractPage(html: string, baseUrl: string): Extraction {
  const $ = load(html);
  const rules = parseStyleRules($);
  const segments: Segment[] = [];
  const index = new Map<string, number>();

  const declsFor = (el: Element): Decls => {
    const d: Decls = { ...(rules.get(el.name) ?? {}) };
    for (const c of (el.attribs?.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(d, rules.get(`.${c}`) ?? {});
    if (el.attribs?.id) Object.assign(d, rules.get(`#${el.attribs.id}`) ?? {});
    if (el.attribs?.style) Object.assign(d, parseDecls(el.attribs.style));
    return d;
  };

  const push = (text: string, where: string, reasons: string[], key: string | null) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (key && index.has(key)) {
      const s = segments[index.get(key)!];
      s.text = `${s.text} ${clean}`;
      return;
    }
    segments.push({ id: segments.length, text: clean, where, hidden: reasons.length > 0, hiddenReasons: reasons, injectionScore: 0, injectionSignals: [] });
    if (key) index.set(key, segments.length - 1);
  };

  let blockSeq = 0;
  const walk = (node: AnyNode, reasons: string[], block: { id: number; where: string }, bg: string | null) => {
    if (node.type === 'comment') {
      push((node as unknown as { data: string }).data, `<!-- comment --> in ${block.where}`, ['HTML comment (never rendered)'], null);
      return;
    }
    if (node.type === 'text') {
      const data = (node as unknown as { data: string }).data;
      push(data, block.where, reasons, `${block.id}|${reasons.join('|')}`);
      return;
    }
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return;
    const el = node as Element;
    if (SKIP.has(el.name)) return;
    const d = declsFor(el);
    const own = hidingReasons(d, el, bg);
    const next = own.length ? [...reasons, ...own.filter((x) => !reasons.includes(x))] : reasons;
    const nextBg = d['background-color'] ?? d.background ?? bg;
    const nextBlock = BLOCK.has(el.name) || own.length ? { id: ++blockSeq, where: describe(el) } : block;

    if (el.name === 'img' && el.attribs?.alt) {
      push(el.attribs.alt, `${describe(el)} alt text`, [...next, 'image alt text (not shown on screen)'], null);
    }
    if (el.attribs?.title && el.name !== 'html') {
      push(el.attribs.title, `${describe(el)} title attribute`, [...next, 'title tooltip (hover only)'], null);
    }
    // noscript children arrive as raw text in cheerio; re-parse so nested markup is seen.
    if (el.name === 'noscript') {
      const inner = load($(el).html() ?? '').root().text();
      push(inner, describe(el), next, null);
      return;
    }
    for (const child of el.children ?? []) walk(child as AnyNode, next, nextBlock, nextBg);
  };

  const body = $('body').get(0);
  if (body) walk(body as AnyNode, [], { id: 0, where: 'body' }, null);
  // Comments before <body> (e.g. in <head>) still reach naive HTML-to-LLM pipelines.
  $('head').contents().each((_, n) => {
    if (n.type === 'comment') push((n as unknown as { data: string }).data, '<!-- comment --> in head', ['HTML comment (never rendered)'], null);
  });

  for (const s of segments) {
    const r = scoreInjection(s.text, s.hidden);
    s.injectionScore = r.score;
    s.injectionSignals = r.signals;
  }

  const links = new Set<string>();
  $('a[href]').each((_, a) => {
    try {
      const u = new URL($(a).attr('href')!, baseUrl);
      u.hash = '';
      if (u.protocol === 'http:' || u.protocol === 'https:') links.add(u.toString());
    } catch {
      /* ignore malformed hrefs */
    }
  });

  const bodyText = $('body').text();
  const copyright = bodyText.match(/(©|\(c\)|copyright)[^.\n]{0,80}(all rights reserved)?/i);

  return {
    title: $('title').first().text().trim() || $('h1').first().text().trim() || baseUrl,
    segments,
    links: [...links],
    metaRobots: [$('meta[name="robots"]').attr('content'), $('meta[name="googlebot"]').attr('content')].filter(Boolean).join(', ').toLowerCase(),
    metaTdm: $('meta[name="tdm-reservation"]').attr('content') ?? null,
    licenseHref: $('link[rel="license"]').attr('href') ?? $('a[rel="license"]').attr('href') ?? null,
    copyrightNotice: copyright ? copyright[0].trim() : null,
  };
}
