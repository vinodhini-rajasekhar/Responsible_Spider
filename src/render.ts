import type { Spider } from './spider';

const INK = '#ece6da';
const INK_DIM = 'rgba(236, 230, 218, 0.55)';

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  const step = 28;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
  }
}

export function drawSpider(ctx: CanvasRenderingContext2D, sp: Spider, highlight: string | null) {
  const s = sp.scale;

  for (const leg of sp.legs) {
    // Fake a lift during swing by pulling the drawn foot toward the hip.
    let fx = leg.foot.x;
    let fy = leg.foot.y;
    if (leg.state === 'stepping') {
      const lift = Math.sin(Math.PI * Math.min(1, leg.swingT)) * 0.12;
      fx += (leg.hip.x - fx) * lift;
      fy += (leg.hip.y - fy) * lift;
    }
    const hl = highlight === leg.name;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = hl ? '#ffffff' : INK;
    ctx.lineWidth = (hl ? 4.4 : 3.4) * s;
    ctx.beginPath();
    ctx.moveTo(leg.hip.x, leg.hip.y);
    ctx.lineTo(leg.knee.x, leg.knee.y);
    ctx.stroke();
    ctx.lineWidth = (hl ? 3 : 2) * s;
    ctx.beginPath();
    ctx.moveTo(leg.knee.x, leg.knee.y);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(leg.knee.x, leg.knee.y, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = leg.state === 'stepping' ? INK_DIM : INK;
    ctx.beginPath();
    ctx.arc(fx, fy, (leg.state === 'stepping' ? 2.6 : 1.8) * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(sp.pos.x, sp.pos.y);
  ctx.rotate(sp.heading);

  // Pedipalps
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8 * s;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(12 * s, side * 3 * s);
    ctx.quadraticCurveTo(18 * s, side * 5 * s, 20 * s, side * 2.5 * s);
    ctx.stroke();
  }

  // Abdomen
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(-17 * s, 0, 15 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d0f13';
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse((-12 - i * 5.5) * s, 0, 1.6 * s, (5 - i) * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Cephalothorax + head
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(3 * s, 0, 10 * s, 8.5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(11.5 * s, 0, 4.5 * s, 4.2 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#0d0f13';
  for (const [x, y, r] of [[13.5, 1.6, 1.1], [13.5, -1.6, 1.1], [11.6, 3, 0.7], [11.6, -3, 0.7]]) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
