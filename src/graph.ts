import type { Decision, PageReport } from '../shared/types.ts';

export const DECISION_COLOR: Record<Decision | 'pending', string> = {
  collected: '#4ade80',
  redacted: '#facc15',
  quarantined: '#f87171',
  skipped: '#64748b',
  error: '#7f1d1d',
  pending: '#334155',
};

export const DECISION_LABEL: Record<Decision, string> = {
  collected: 'Collected',
  redacted: 'Collected · PII redacted',
  quarantined: 'Collected · injection quarantined',
  skipped: 'Skipped · consent',
  error: 'Error',
};

export interface GNode {
  url: string;
  label: string;
  parent: string | null;
  depth: number;
  children: string[];
  x: number;
  y: number;
  tx: number;
  ty: number;
  report: PageReport | null;
  revealedAt: number;
}

interface Callout {
  url: string;
  title: string;
  text: string;
  color: string;
  born: number;
}

const CALLOUT_MS = 3200;

function shortLabel(url: string): string {
  const u = new URL(url);
  const p = u.pathname + u.search;
  return p.length > 22 ? `…${p.slice(-21)}` : p;
}

export class Graph {
  nodes = new Map<string, GNode>();
  root: string | null = null;
  callouts: Callout[] = [];
  cx = 0;
  cy = 0;
  rx = 200;
  ry = 200;
  maxDepth = 1;

  /** Inner rings get proportionally more room: shallow pages are the most numerous. */
  ringFactor(depth: number) {
    return Math.pow(depth / this.maxDepth, 0.7);
  }

  clear() {
    this.nodes.clear();
    this.root = null;
    this.callouts = [];
  }

  add(url: string, parent: string | null, depth: number) {
    if (this.nodes.has(url)) return;
    const p = parent ? this.nodes.get(parent) : null;
    const n: GNode = { url, label: shortLabel(url), parent, depth, children: [], x: p?.x ?? this.cx, y: p?.y ?? this.cy, tx: 0, ty: 0, report: null, revealedAt: 0 };
    this.nodes.set(url, n);
    if (p) p.children.push(url);
    else this.root = url;
  }

  reveal(report: PageReport, now: number, callout: { title: string; text: string }) {
    const n = this.nodes.get(report.url);
    if (!n) return;
    n.report = report;
    n.revealedAt = now;
    this.callouts = [];
    this.callouts.push({ url: report.url, ...callout, color: DECISION_COLOR[report.decision], born: now });
  }

  /** Radial tree: depth → ring, siblings share their parent's angular wedge in proportion to subtree size. */
  layout(w: number, h: number) {
    this.cx = w / 2;
    this.cy = h / 2;
    if (!this.root) return;
    let maxDepth = 1;
    for (const n of this.nodes.values()) maxDepth = Math.max(maxDepth, n.depth);
    this.maxDepth = maxDepth;
    this.rx = Math.max(80, w / 2 - 80);
    this.ry = Math.max(80, h / 2 - 64);
    const leaves = new Map<string, number>();
    const count = (id: string): number => {
      const n = this.nodes.get(id)!;
      const c = n.children.length ? n.children.reduce((s, k) => s + count(k), 0) : 1;
      leaves.set(id, c);
      return c;
    };
    count(this.root);
    const place = (id: string, a0: number, a1: number, index: number, siblings: number) => {
      const n = this.nodes.get(id)!;
      const a = (a0 + a1) / 2;
      const stagger = siblings > 24 ? (index % 3) * 0.13 - 0.13 : 0;
      const f = n.depth === 0 ? 0 : this.ringFactor(n.depth) * (1 + stagger * 0.5);
      n.tx = this.cx + Math.cos(a) * this.rx * f;
      n.ty = this.cy + Math.sin(a) * this.ry * f;
      let start = a0;
      const total = leaves.get(id)!;
      n.children.forEach((k, i) => {
        const span = ((a1 - a0) * leaves.get(k)!) / total;
        place(k, start, start + span, i, n.children.length);
        start += span;
      });
    };
    place(this.root, -Math.PI / 2, (Math.PI * 3) / 2, 0, 1);
  }

  step(dt: number) {
    const k = 1 - Math.exp(-dt * 5);
    for (const n of this.nodes.values()) {
      n.x += (n.tx - n.x) * k;
      n.y += (n.ty - n.y) * k;
    }
  }

  hit(x: number, y: number): GNode | null {
    let best: GNode | null = null;
    let bd = 16;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  drawWeb(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.root) return;
    const spokes = 16;
    const outer = Math.hypot(w, h) / 2;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ctx.moveTo(this.cx, this.cy);
      ctx.lineTo(this.cx + Math.cos(a) * outer, this.cy + Math.sin(a) * outer);
    }
    const rings = [0.33, ...Array.from({ length: this.maxDepth }, (_, k) => this.ringFactor(k + 1)), 1.2];
    for (const [d, f] of rings.entries()) {
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const wob = 1 + 0.03 * Math.sin(i * 1.7 + d);
        const x = this.cx + Math.cos(a) * this.rx * f * wob;
        const y = this.cy + Math.sin(a) * this.ry * f * wob;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  draw(ctx: CanvasRenderingContext2D, now: number, state: { selected: string | null; hovered: string | null; inspecting: string | null; showAllLabels: boolean }) {
    for (const n of this.nodes.values()) {
      if (!n.parent) continue;
      const p = this.nodes.get(n.parent)!;
      const mx = (n.x + p.x) / 2;
      const my = (n.y + p.y) / 2 + 10;
      ctx.strokeStyle = n.report ? 'rgba(236, 230, 218, 0.32)' : 'rgba(236, 230, 218, 0.12)';
      ctx.lineWidth = n.report ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(mx, my, n.x, n.y);
      ctx.stroke();
    }

    for (const n of this.nodes.values()) {
      const r = n.depth === 0 ? 11 : 8;
      const d = n.report?.decision;
      const pop = n.revealedAt ? Math.max(0, 1 - (now - n.revealedAt) / 500) : 0;
      if (n.url === state.inspecting) {
        const pulse = (now / 600) % 1;
        ctx.strokeStyle = `rgba(165, 180, 252, ${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4 + pulse * 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * (1 + pop * 0.6), 0, Math.PI * 2);
      if (d) {
        ctx.fillStyle = DECISION_COLOR[d];
        ctx.fill();
      } else {
        ctx.fillStyle = '#0d0f13';
        ctx.fill();
        ctx.strokeStyle = DECISION_COLOR.pending;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (d) {
        ctx.fillStyle = '#0d0f13';
        ctx.font = `700 ${n.depth === 0 ? 12 : 10}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d === 'skipped' ? '⊘' : d === 'quarantined' ? '!' : d === 'redacted' ? '•' : d === 'error' ? '×' : '✓', n.x, n.y + 0.5);
      }
      if (n.report?.agent?.naive.hijacked) {
        ctx.strokeStyle = '#f87171';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.url === state.selected || n.url === state.hovered) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      const showLabel = state.showAllLabels || n.depth === 0 || n.url === state.selected || n.url === state.hovered || n.url === state.inspecting;
      if (showLabel) {
        ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = n.report ? 'rgba(226, 232, 240, 0.85)' : 'rgba(148, 163, 184, 0.6)';
        const below = n.y >= this.cy;
        ctx.fillText(n.label, n.x, below ? n.y + r + 6 : n.y - r - 18);
      }
    }
    this.drawCallouts(ctx, now);
  }

  private drawCallouts(ctx: CanvasRenderingContext2D, now: number) {
    this.callouts = this.callouts.filter((c) => now - c.born < CALLOUT_MS);
    for (const c of this.callouts) {
      const n = this.nodes.get(c.url);
      if (!n) continue;
      const age = (now - c.born) / CALLOUT_MS;
      ctx.globalAlpha = age > 0.8 ? (1 - age) / 0.2 : Math.min(1, (now - c.born) / 150);
      ctx.font = '700 12px ui-sans-serif, system-ui';
      const tw = ctx.measureText(c.title).width;
      ctx.font = '400 12px ui-sans-serif, system-ui';
      const lines = wrap(ctx, c.text, 260);
      const w = Math.max(tw, ...lines.map((l) => ctx.measureText(l).width)) + 20;
      const h = 26 + lines.length * 16;
      const right = n.x < this.cx;
      let x = right ? n.x + 22 : n.x - 22 - w;
      let y = n.y - h / 2;
      x = Math.max(8, Math.min(this.cx * 2 - w - 8, x));
      y = Math.max(8, Math.min(this.cy * 2 - h - 8, y));
      ctx.fillStyle = 'rgba(15, 18, 24, 0.94)';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '700 12px ui-sans-serif, system-ui';
      ctx.fillText(c.title, x + 10, y + 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '400 12px ui-sans-serif, system-ui';
      lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 26 + i * 16));
      ctx.globalAlpha = 1;
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && line) lines.push(line);
  else if (line) lines[2] = `${lines[2]}…`;
  return lines;
}
