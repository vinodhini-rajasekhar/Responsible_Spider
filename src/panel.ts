import { GROUP_COLOR } from './overlay';
import type { Decision, Leg, Params, Spider } from './spider';

const LOG_CAP = 120;
const GAIT_COLS = 240;
const LEG_ORDER = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Panel {
  hovered: string | null = null;
  showWaits = true;
  private rows = new Map<string, HTMLTableRowElement>();
  private log = $<HTMLOListElement>('log');
  private logEmpty = $('log-empty');
  private gait = $<HTMLCanvasElement>('gait');
  private history: Uint8Array[] = [];
  private lastTableUpdate = 0;

  constructor(spider: Spider) {
    const body = $('leg-rows');
    for (const name of LEG_ORDER) {
      const leg = spider.legs.find((l) => l.name === name)!;
      const tr = document.createElement('tr');
      tr.dataset.leg = name;
      tr.innerHTML = `
        <td><span class="leg-tag" style="--c:${GROUP_COLOR[leg.group]}">${name}<small>${leg.group}</small></span></td>
        <td><div class="bar"><i></i><b></b></div><span class="num drift"></span></td>
        <td class="num hip"></td>
        <td class="num knee"></td>
        <td class="why"></td>`;
      tr.addEventListener('pointerenter', () => (this.hovered = name));
      tr.addEventListener('pointerleave', () => (this.hovered = null));
      tr.addEventListener('click', () => (this.hovered = this.hovered === name ? null : name));
      body.appendChild(tr);
      this.rows.set(name, tr);
    }
    $('clear-log').addEventListener('click', () => this.clearLog());
    $<HTMLInputElement>('show-waits').addEventListener('change', (e) => {
      this.showWaits = (e.target as HTMLInputElement).checked;
      this.log.classList.toggle('hide-waits', !this.showWaits);
    });
  }

  clearLog() {
    this.log.replaceChildren();
    this.logEmpty.hidden = false;
  }

  pushDecisions(ds: Decision[]) {
    if (!ds.length) return;
    const frag = document.createDocumentFragment();
    for (const d of ds) {
      const li = document.createElement('li');
      li.className = `log-${d.kind}`;
      const g = d.group ? `style="--c:${GROUP_COLOR[d.group]}"` : '';
      li.innerHTML = `<time>${d.t.toFixed(2)}s</time><span class="kind" ${g}>${d.kind}</span><span class="msg"></span>`;
      (li.querySelector('.msg') as HTMLElement).textContent = d.text;
      frag.prepend(li);
    }
    this.log.prepend(frag);
    while (this.log.childElementCount > LOG_CAP) this.log.lastElementChild!.remove();
    this.logEmpty.hidden = true;
  }

  recordGait(sp: Spider) {
    const col = new Uint8Array(8);
    LEG_ORDER.forEach((n, i) => {
      col[i] = sp.legs.find((l) => l.name === n)!.state === 'stepping' ? 1 : 0;
    });
    this.history.push(col);
    if (this.history.length > GAIT_COLS) this.history.shift();
  }

  drawGait(sp: Spider) {
    const c = this.gait;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const labelW = 26;
    const rowH = h / 8;
    const colW = (w - labelW) / GAIT_COLS;
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'middle';
    LEG_ORDER.forEach((name, i) => {
      const leg = sp.legs.find((l) => l.name === name)!;
      const y = i * rowH;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(labelW, y, w - labelW, rowH);
      ctx.fillStyle = GROUP_COLOR[leg.group];
      ctx.fillText(name, 2, y + rowH / 2);
      const off = GAIT_COLS - this.history.length;
      for (let x = 0; x < this.history.length; x++) {
        if (this.history[x][i]) ctx.fillRect(labelW + (off + x) * colW, y + 2, Math.ceil(colW), rowH - 4);
      }
    });
  }

  updateStats(sp: Spider, p: Params, now: number) {
    if (now - this.lastTableUpdate < 90) return;
    this.lastTableUpdate = now;
    const pill = $('active-group');
    pill.textContent = `Group ${sp.activeGroup} active`;
    pill.className = `pill pill-${sp.activeGroup.toLowerCase()}`;
    $('s-speed').textContent = `${Math.round(Math.hypot(sp.vel.x, sp.vel.y))} px/s`;
    $('s-dist').textContent = `${Math.round(sp.pointerDist)} px`;
    $('s-dur').textContent = `${Math.round(sp.stepDuration * 1000)} ms`;
    $('s-steps').textContent = String(sp.totalSteps);
    $('s-switch').textContent = String(sp.switches);
    $('s-forced').textContent = String(sp.forcedSteps);

    for (const leg of sp.legs) {
      const tr = this.rows.get(leg.name)!;
      const ratio = Math.min(1.6, leg.drift / p.threshold);
      const bar = tr.querySelector('.bar i') as HTMLElement;
      bar.style.width = `${(ratio / 1.6) * 100}%`;
      bar.classList.toggle('over', ratio > 1 && leg.state !== 'stepping');
      (tr.querySelector('.bar b') as HTMLElement).style.left = `${(1 / 1.6) * 100}%`;
      (tr.querySelector('.drift') as HTMLElement).textContent = `${Math.round(leg.drift)}/${Math.round(p.threshold)}`;
      (tr.querySelector('.hip') as HTMLElement).textContent = `${Math.round(leg.hipDeg)}°`;
      (tr.querySelector('.knee') as HTMLElement).textContent = `${Math.round(leg.kneeDeg)}°`;
      (tr.querySelector('.why') as HTMLElement).textContent = explainLeg(leg, sp, p);
      tr.className = `state-${leg.state}${this.hovered === leg.name ? ' hovered' : ''}`;
    }
  }
}

function explainLeg(leg: Leg, sp: Spider, p: Params): string {
  if (leg.state === 'stepping') return `In the air — ${Math.round(Math.min(1, leg.swingT) * 100)}% of swing`;
  if (leg.state === 'waiting') return `Held — over threshold, waiting for group ${leg.group}`;
  if (leg.clamped) return 'Planted — at full reach';
  const margin = Math.round(p.threshold - leg.drift);
  return leg.group === sp.activeGroup ? `Planted — ${margin}px of slack` : `Planted — ${margin}px slack, group idle`;
}
