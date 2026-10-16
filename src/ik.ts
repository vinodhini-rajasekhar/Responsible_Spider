export interface Vec {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec => ({ x, y });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface IKResult {
  knee: Vec;
  /** Absolute angle of the upper segment (radians). */
  upperAngle: number;
  /** Interior angle at the knee in radians (PI = fully straight). */
  kneeAngle: number;
  /** True when the foot is out of reach and the solution was clamped. */
  clamped: boolean;
  /** Hip-to-foot distance divided by max reach. */
  reachRatio: number;
}

/**
 * Analytic two-bone IK via the law of cosines. Of the two mirror solutions,
 * the knee farthest from `away` is chosen so knees always bow out from the body.
 */
export function solveTwoBone(hip: Vec, foot: Vec, upper: number, lower: number, away: Vec): IKResult {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const raw = Math.hypot(dx, dy);
  const maxReach = upper + lower;
  const minReach = Math.abs(upper - lower) + 0.001;
  const d = Math.min(Math.max(raw, minReach), maxReach - 0.001);
  const base = Math.atan2(dy, dx);

  const cosHip = (upper * upper + d * d - lower * lower) / (2 * upper * d);
  const hipOffset = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const cosKnee = (upper * upper + lower * lower - d * d) / (2 * upper * lower);
  const kneeAngle = Math.acos(Math.min(1, Math.max(-1, cosKnee)));

  const a1 = base + hipOffset;
  const a2 = base - hipOffset;
  const k1 = { x: hip.x + Math.cos(a1) * upper, y: hip.y + Math.sin(a1) * upper };
  const k2 = { x: hip.x + Math.cos(a2) * upper, y: hip.y + Math.sin(a2) * upper };
  const pickFirst = dist(k1, away) >= dist(k2, away);

  return {
    knee: pickFirst ? k1 : k2,
    upperAngle: pickFirst ? a1 : a2,
    kneeAngle,
    clamped: raw >= maxReach,
    reachRatio: raw / maxReach,
  };
}
