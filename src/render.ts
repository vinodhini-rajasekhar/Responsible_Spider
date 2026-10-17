import type { Spider } from './spider';

const SHELL = '#f2ebe0';
const CREASE = 'rgba(13, 15, 19, 0.22)';
const EYE = '#0d0f13';
/** Body size relative to the leg scale; matches HIP_X / HIP_Y in spider.ts. */
const BODY = 1.25;

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, w, h);
  // Soft web hint under the graph (dots only — graph draws its own rings).
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  const step = 32;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

type P = { x: number; y: number };

/** Filled segment that tapers from width w0 at a to w1 at b, with rounded ends. */
function taper(ctx: CanvasRenderingContext2D, a: P, b: P, w0: number, w1: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  ctx.beginPath();
  ctx.moveTo(a.x + nx * w0, a.y + ny * w0);
  ctx.lineTo(b.x + nx * w1, b.y + ny * w1);
  ctx.arc(b.x, b.y, w1, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.lineTo(a.x - nx * w0, a.y - ny * w0);
  ctx.arc(a.x, a.y, w0, ang - Math.PI / 2, ang + Math.PI / 2, true);
  ctx.fill();
}

/**
 * Draw a jointed spider leg: femur, then a lower leg with a soft second bend.
 * The IK is two-bone; the ankle is offset outward from the body so the leg arcs like a real spider's.
 */
function drawLeg(ctx: CanvasRenderingContext2D, body: P, hip: P, knee: P, foot: P, s: number, highlight: boolean) {
  ctx.fillStyle = highlight ? '#ffffff' : SHELL;

  const t = 0.56;
  const mid = { x: knee.x + (foot.x - knee.x) * t, y: knee.y + (foot.y - knee.y) * t };
  const len = Math.hypot(foot.x - knee.x, foot.y - knee.y) || 1;
  let px = -(foot.y - knee.y) / len;
  let py = (foot.x - knee.x) / len;
  if (px * (mid.x - body.x) + py * (mid.y - body.y) < 0) {
    px = -px;
    py = -py;
  }
  const bow = len * 0.07;
  const ankle = { x: mid.x + px * bow, y: mid.y + py * bow };

  const k = highlight ? 1.15 : 1;
  taper(ctx, hip, knee, 2.6 * s * k, 2.1 * s * k);
  taper(ctx, knee, ankle, 2.0 * s * k, 1.45 * s * k);
  taper(ctx, ankle, foot, 1.35 * s * k, 0.45 * s * k);
}

export function drawSpider(ctx: CanvasRenderingContext2D, sp: Spider, highlight: string | null) {
  const s = sp.scale;
  const b = s * BODY;

  // Soft contact shadow so the body reads as sitting on the web.
  ctx.save();
  ctx.translate(sp.pos.x, sp.pos.y);
  ctx.rotate(sp.heading);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(-8 * b, 2 * b, 24 * b, 12 * b, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (const leg of sp.legs) {
    let fx = leg.foot.x;
    let fy = leg.foot.y;
    if (leg.state === 'stepping') {
      const lift = Math.sin(Math.PI * Math.min(1, leg.swingT)) * 0.18;
      fx += (leg.hip.x - fx) * lift;
      fy += (leg.hip.y - fy) * lift;
    }
    drawLeg(ctx, sp.pos, leg.hip, leg.knee, { x: fx, y: fy }, s, highlight === leg.name);
  }

  ctx.save();
  ctx.translate(sp.pos.x, sp.pos.y);
  ctx.rotate(sp.heading);
  ctx.fillStyle = SHELL;

  // Short hooked chelicerae at the front, curling inward.
  ctx.strokeStyle = SHELL;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2 * b;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(10 * b, side * 2.6 * b);
    ctx.quadraticCurveTo(16.5 * b, side * 4.6 * b, 15.6 * b, side * 1.3 * b);
    ctx.stroke();
  }

  // Large oval abdomen behind a small waist.
  ctx.beginPath();
  ctx.ellipse(-17 * b, 0, 14.5 * b, 11 * b, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-2.5 * b, 0, 3 * b, 3.6 * b, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rounded cephalothorax the legs attach to.
  ctx.beginPath();
  ctx.ellipse(3.5 * b, 0, 8.8 * b, 8 * b, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CREASE;
  ctx.beginPath();
  ctx.ellipse(-17 * b, 0, 8 * b, 1.1 * b, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = EYE;
  const eyes: [number, number, number][] = [
    [9.6, 1.5, 0.95],
    [9.6, -1.5, 0.95],
    [8.4, 3.1, 0.65],
    [8.4, -3.1, 0.65],
  ];
  for (const [x, y, r] of eyes) {
    ctx.beginPath();
    ctx.arc(x * b, y * b, r * b, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
