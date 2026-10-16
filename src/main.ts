import './style.css';
import type { Vec } from './ik';
import { drawOverlayOver, drawOverlayUnder } from './overlay';
import { Panel } from './panel';
import { drawBackground, drawSpider } from './render';
import { Spider, type Params } from './spider';

type Settings = Params & { timeScale: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $('app');
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('scene');
const ctx = canvas.getContext('2d')!;

let width = 0;
let height = 0;

function defaults(): Settings {
  const m = Math.min(window.innerWidth, window.innerHeight);
  return {
    threshold: 32,
    speed: 320,
    legLength: Math.round(Math.max(55, Math.min(100, m * 0.12))),
    timeScale: 1,
  };
}

const settings: Settings = defaults();
const pointer: Vec = { x: 0, y: 0 };
let userControlled = false;
let explain = true;
let paused = false;
let stepOnce = false;
let showLabels = true;

const spider = new Spider(0, 0, settings);
const panel = new Panel(spider);

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
  if (first) {
    spider.pos = { x: width / 2, y: height / 2 };
    pointer.x = width / 2;
    pointer.y = height / 2;
    spider.plantAll();
  }
}
new ResizeObserver(resize).observe(stage);
resize();

function setPointer(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  pointer.x = Math.max(0, Math.min(width, e.clientX - r.left));
  pointer.y = Math.max(0, Math.min(height, e.clientY - r.top));
  if (!userControlled) {
    userControlled = true;
    $('hint').textContent = 'Following you. Tweak parameters in the panel to see behaviour change.';
  }
}
canvas.addEventListener('pointermove', setPointer);
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  setPointer(e);
});

// --- Controls
const sliderKeys = ['threshold', 'speed', 'legLength', 'timeScale'] as const;
const fmt: Record<(typeof sliderKeys)[number], (v: number) => string> = {
  threshold: (v) => `${v}px`,
  speed: (v) => `${v}px/s`,
  legLength: (v) => `${v}px`,
  timeScale: (v) => `${v.toFixed(2)}×`,
};

function syncSliders() {
  for (const key of sliderKeys) {
    $<HTMLInputElement>(key).value = String(settings[key]);
    $<HTMLOutputElement>(`o-${key}`).textContent = fmt[key](settings[key]);
  }
}
for (const key of sliderKeys) {
  $<HTMLInputElement>(key).addEventListener('input', (e) => {
    settings[key] = Number((e.target as HTMLInputElement).value);
    $<HTMLOutputElement>(`o-${key}`).textContent = fmt[key](settings[key]);
    if (key === 'legLength') {
      spider.layout(settings);
      spider.solveIK();
    }
  });
}
syncSliders();

$('reset').addEventListener('click', () => {
  Object.assign(settings, defaults());
  syncSliders();
  spider.layout(settings);
  spider.plantAll();
});

function setExplain(on: boolean) {
  explain = on;
  app.classList.toggle('explain-off', !on);
  const btn = $('toggle-explain');
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('.btn-label')!.textContent = `Explain: ${on ? 'on' : 'off'}`;
}
function setPaused(on: boolean) {
  paused = on;
  $('toggle-pause').textContent = on ? 'Resume' : 'Pause';
}
$('toggle-explain').addEventListener('click', () => setExplain(!explain));
$('toggle-pause').addEventListener('click', () => setPaused(!paused));
$('step-frame').addEventListener('click', () => {
  setPaused(true);
  stepOnce = true;
});
$<HTMLInputElement>('show-labels').addEventListener('change', (e) => {
  showLabels = (e.target as HTMLInputElement).checked;
});
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'e' || e.key === 'E') setExplain(!explain);
  else if (e.key === ' ') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.key === '.') {
    setPaused(true);
    stepOnce = true;
  }
});
setExplain(explain);

// Until the user takes over, wander on a slow Lissajous path so the demo is alive.
function autopilot(t: number) {
  const r = Math.min(width, height) * 0.32;
  pointer.x = width / 2 + Math.sin(t * 0.43) * r * 1.2;
  pointer.y = height / 2 + Math.sin(t * 0.71 + 1) * r * 0.8;
  pointer.x = Math.max(20, Math.min(width - 20, pointer.x));
  pointer.y = Math.max(20, Math.min(height - 20, pointer.y));
}

let last = performance.now();
let autoT = 0;
function frame(now: number) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  let dt = 0;
  if (stepOnce) {
    dt = 1 / 60;
    stepOnce = false;
  } else if (!paused) {
    dt = realDt * settings.timeScale;
  }

  if (dt > 0) {
    if (!userControlled) {
      autoT += dt;
      autopilot(autoT);
    }
    panel.pushDecisions(spider.update(dt, pointer, settings));
    panel.recordGait(spider);
  }

  drawBackground(ctx, width, height);
  const hl = explain ? panel.hovered : null;
  if (explain) drawOverlayUnder(ctx, spider, settings, pointer, hl);
  drawSpider(ctx, spider, hl);
  if (explain && showLabels) drawOverlayOver(ctx, spider, settings, hl);

  if (explain) {
    panel.drawGait(spider);
    panel.updateStats(spider, settings, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
