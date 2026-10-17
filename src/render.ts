import type { Spider } from './spider';

const SHELL = '#f2ebe0';
const SHELL_DIM = 'rgba(242, 235, 224, 0.55)';
const CREASE = 'rgba(13, 15, 19, 0.22)';
const EYE = '#0d0f13';

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

/** Draw a tapered two-bone spider leg. Knee already bows away from the body via IK. */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  hip: { x: number; y: number },
  knee: { x: number; y: number },
  foot: { x: number; y: number },
  s: number,
  highlight: boolean,
  stepping: boolean,
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = highlight ? '#ffffff' : SHELL;

  // Fake a third joint on the lower bone for a classic spider silhouette (IK stays 2-bone).
  const tarsusT = 0.62;
  const ankle = {
    x: knee.x + (foot.x - knee.x) * tarsusT,
    y: knee.y + (foot.y - knee.y) * tarsusT,
  };

  // Femur — thickest
  ctx.lineWidth = (highlight ? 4.6 : 3.8) * s;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.stroke();

  // Tibia
  ctx.lineWidth = (highlight ? 3.0 : 2.5) * s;
  ctx.beginPath();
  ctx.moveTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();

  // Tarsus — thinnest
  ctx.lineWidth = (highlight ? 2.0 : 1.6) * s;
  ctx.beginPath();
  ctx.moveTo(ankle.x, ankle.y);
  ctx.lineTo(foot.x, foot.y);
  ctx.stroke();

  // Claw tip
  ctx.lineWidth = 1.1 * s;
  const a = Math.atan2(foot.y - ankle.y, foot.x - ankle.x);
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(foot.x + Math.cos(a + 0.7) * 3.4 * s, foot.y + Math.sin(a + 0.7) * 3.4 * s);
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(foot.x + Math.cos(a - 0.7) * 3.4 * s, foot.y + Math.sin(a - 0.7) * 3.4 * s);
  ctx.stroke();

  ctx.fillStyle = SHELL;
  ctx.beginPath();
  ctx.arc(knee.x, knee.y, 2.3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ankle.x, ankle.y, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = stepping ? SHELL_DIM : SHELL;
  ctx.beginPath();
  ctx.arc(foot.x, foot.y, (stepping ? 2.2 : 1.5) * s, 0, Math.PI * 2);
  ctx.fill();
}

export function drawSpider(ctx: CanvasRenderingContext2D, sp: Spider, highlight: string | null) {
  const s = sp.scale;

  // Soft contact shadow so the body reads as sitting on the web.
  ctx.save();
  ctx.translate(sp.pos.x, sp.pos.y);
  ctx.rotate(sp.heading);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(-4 * s, 2 * s, 22 * s, 10 * s, 0, 0, Math.PI * 2);
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
    drawLeg(ctx, leg.hip, leg.knee, { x: fx, y: fy }, s, highlight === leg.name, leg.state === 'stepping');
  }

  ctx.save();
  ctx.translate(sp.pos.x, sp.pos.y);
  ctx.rotate(sp.heading);

  // Pedipalps (front feelers) — short, forward, spider-like.
  ctx.strokeStyle = SHELL;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.7 * s;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(10 * s, side * 3.5 * s);
    ctx.quadraticCurveTo(16 * s, side * 7 * s, 19 * s, side * 3 * s);
    ctx.stroke();
    ctx.fillStyle = SHELL;
    ctx.beginPath();
    ctx.arc(19 * s, side * 3 * s, 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Abdomen — large teardrop behind the cephalothorax (classic spider silhouette).
  ctx.fillStyle = SHELL;
  ctx.beginPath();
  ctx.moveTo(-2 * s, 0);
  ctx.bezierCurveTo(-6 * s, -14 * s, -28 * s, -13 * s, -32 * s, 0);
  ctx.bezierCurveTo(-28 * s, 13 * s, -6 * s, 14 * s, -2 * s, 0);
  ctx.closePath();
  ctx.fill();

  // Soft abdomen segments
  ctx.strokeStyle = CREASE;
  ctx.lineWidth = 1.2 * s;
  for (const x of [-12, -18, -24]) {
    ctx.beginPath();
    ctx.ellipse(x * s, 0, 2.2 * s, 8.5 * s, 0, -0.9, 0.9);
    ctx.stroke();
  }

  // Cephalothorax — flatter oval body the legs attach to.
  ctx.fillStyle = SHELL;
  ctx.beginPath();
  ctx.ellipse(4 * s, 0, 12 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Narrow waist between abdomen and cephalothorax
  ctx.beginPath();
  ctx.ellipse(-2 * s, 0, 3.2 * s, 4 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head / carapace front
  ctx.beginPath();
  ctx.ellipse(12 * s, 0, 5.5 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye cluster (4+2 arrangement reads as a spider at this size)
  ctx.fillStyle = EYE;
  const eyes: [number, number, number][] = [
    [14.2, 1.8, 1.15],
    [14.2, -1.8, 1.15],
    [12.4, 3.2, 0.75],
    [12.4, -3.2, 0.75],
    [11.2, 1.4, 0.55],
    [11.2, -1.4, 0.55],
  ];
  for (const [x, y, r] of eyes) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle chelicerae (fangs)
  ctx.strokeStyle = EYE;
  ctx.lineWidth = 1.1 * s;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(15.5 * s, side * 1.2 * s);
    ctx.lineTo(17.5 * s, side * 2.4 * s);
    ctx.stroke();
  }

  ctx.restore();
}
