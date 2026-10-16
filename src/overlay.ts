import type { Vec } from './ik';
import type { Group, Leg, Params, Spider } from './spider';

export const GROUP_COLOR: Record<Group, string> = { A: '#2dd4bf', B: '#fb923c' };
const ALERT = '#f87171';
const LABEL_FONT = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(13,15,19,0.82)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 8, w, 16, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

function arrow(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, color: string) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - Math.cos(a - 0.4) * 9, to.y - Math.sin(a - 0.4) * 9);
  ctx.lineTo(to.x - Math.cos(a + 0.4) * 9, to.y - Math.sin(a + 0.4) * 9);
  ctx.closePath();
  ctx.fill();
}

/** Drawn beneath the spider: thresholds, targets and drift vectors. */
export function drawOverlayUnder(ctx: CanvasRenderingContext2D, sp: Spider, p: Params, pointer: Vec, highlight: string | null) {
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sp.pos.x, sp.pos.y);
  ctx.lineTo(pointer.x, pointer.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, 9, 0, Math.PI * 2);
  ctx.moveTo(pointer.x - 15, pointer.y);
  ctx.lineTo(pointer.x + 15, pointer.y);
  ctx.moveTo(pointer.x, pointer.y - 15);
  ctx.lineTo(pointer.x, pointer.y + 15);
  ctx.stroke();

  for (const leg of sp.legs) drawLegUnder(ctx, sp, leg, p, highlight === leg.name);
  ctx.restore();
}

function drawLegUnder(ctx: CanvasRenderingContext2D, sp: Spider, leg: Leg, p: Params, hl: boolean) {
  const color = GROUP_COLOR[leg.group];
  const active = leg.group === sp.activeGroup;
  ctx.globalAlpha = hl ? 1 : active ? 0.9 : 0.4;

  if (hl) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(leg.hip.x, leg.hip.y, leg.upper + leg.lower, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = active ? 1.6 : 1;
  ctx.setLineDash(active ? [] : [3, 4]);
  ctx.beginPath();
  ctx.arc(leg.target.x, leg.target.y, p.threshold, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(leg.target.x - 5, leg.target.y);
  ctx.lineTo(leg.target.x + 5, leg.target.y);
  ctx.moveTo(leg.target.x, leg.target.y - 5);
  ctx.lineTo(leg.target.x, leg.target.y + 5);
  ctx.stroke();

  const lx = leg.landing.x;
  const ly = leg.landing.y;
  if (Math.hypot(lx - leg.target.x, ly - leg.target.y) > 2) {
    ctx.beginPath();
    ctx.moveTo(lx, ly - 4);
    ctx.lineTo(lx + 4, ly);
    ctx.lineTo(lx, ly + 4);
    ctx.lineTo(lx - 4, ly);
    ctx.closePath();
    ctx.stroke();
  }

  if (leg.state === 'stepping') {
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(leg.swingFrom.x, leg.swingFrom.y);
    ctx.lineTo(leg.swingTo.x, leg.swingTo.y);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const over = leg.drift > p.threshold;
    ctx.strokeStyle = over ? ALERT : color;
    ctx.lineWidth = over ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(leg.foot.x, leg.foot.y);
    ctx.lineTo(leg.target.x, leg.target.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Drawn on top of the spider: angles, labels and the velocity vector. */
export function drawOverlayOver(ctx: CanvasRenderingContext2D, sp: Spider, p: Params, highlight: string | null) {
  ctx.save();
  const spd = Math.hypot(sp.vel.x, sp.vel.y);
  if (spd > 4) {
    const k = 0.35;
    arrow(ctx, sp.pos, { x: sp.pos.x + sp.vel.x * k, y: sp.pos.y + sp.vel.y * k }, '#a5b4fc');
  }

  for (const leg of sp.legs) {
    const hl = highlight === leg.name;
    const color = GROUP_COLOR[leg.group];
    const active = leg.group === sp.activeGroup;
    ctx.globalAlpha = hl || active ? 1 : 0.55;

    // Knee interior angle arc.
    const a1 = Math.atan2(leg.hip.y - leg.knee.y, leg.hip.x - leg.knee.x);
    const a2 = Math.atan2(leg.foot.y - leg.knee.y, leg.foot.x - leg.knee.x);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(leg.knee.x, leg.knee.y, 10, a1, a1 + diff, diff < 0);
    ctx.stroke();

    const ox = leg.knee.x - sp.pos.x;
    const oy = leg.knee.y - sp.pos.y;
    const on = Math.hypot(ox, oy) || 1;
    label(ctx, `${Math.round(leg.kneeDeg)}°`, leg.knee.x + (ox / on) * 18, leg.knee.y + (oy / on) * 18, leg.clamped ? ALERT : color);

    const tx = leg.target.x - sp.pos.x;
    const ty = leg.target.y - sp.pos.y;
    const tn = Math.hypot(tx, ty) || 1;
    const over = leg.drift > p.threshold && leg.state !== 'stepping';
    const tag = leg.state === 'stepping' ? `${leg.name} ↑` : `${leg.name} ${Math.round(leg.drift)}px`;
    label(ctx, tag, leg.target.x + (tx / tn) * (p.threshold + 12), leg.target.y + (ty / tn) * (p.threshold + 12), over ? ALERT : color);

    if (hl) {
      label(ctx, `hip ${Math.round(leg.hipDeg)}°`, leg.hip.x + (leg.knee.x - leg.hip.x) * 0.5, leg.hip.y + (leg.knee.y - leg.hip.y) * 0.5 - 14, '#ffffff');
    }
  }
  ctx.globalAlpha = 1;
  label(ctx, `group ${sp.activeGroup} active`, sp.pos.x, sp.pos.y - (sp.legs[0].upper + sp.legs[0].lower) - 18, GROUP_COLOR[sp.activeGroup]);
  ctx.restore();
}
