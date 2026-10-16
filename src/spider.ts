import { angleDiff, dist, lerp, solveTwoBone, vec, type Vec } from './ik';

export type Group = 'A' | 'B';
export type LegState = 'planted' | 'waiting' | 'stepping';
export type DecisionKind = 'step' | 'forced' | 'wait' | 'switch';

export interface Params {
  threshold: number;
  speed: number;
  legLength: number;
}

export interface Decision {
  t: number;
  kind: DecisionKind;
  group?: Group;
  leg?: string;
  text: string;
}

export interface Leg {
  name: string;
  side: -1 | 1;
  index: number;
  group: Group;
  hipLocal: Vec;
  restLocal: Vec;
  upper: number;
  lower: number;
  hip: Vec;
  knee: Vec;
  foot: Vec;
  /** Rest anchor in world space; drift is measured from here. */
  target: Vec;
  /** Where a new step will land: the anchor plus a velocity lead. */
  landing: Vec;
  drift: number;
  state: LegState;
  swingFrom: Vec;
  swingTo: Vec;
  swingT: number;
  swingDur: number;
  /** Upper-segment angle relative to body heading, degrees. */
  hipDeg: number;
  /** Interior knee angle, degrees (180 = straight). */
  kneeDeg: number;
  clamped: boolean;
  reachRatio: number;
  steps: number;
}

// Classic alternating tetrapod: diagonal neighbours never share a group.
const GROUP_OF: Record<string, Group> = {
  L1: 'A', R2: 'A', L3: 'A', R4: 'A',
  R1: 'B', L2: 'B', R3: 'B', L4: 'B',
};

const HIP_X = [9, 4, -1, -6];
const REST_ANGLE_DEG = [38, 78, 112, 148];
const LEN_MULT = [1.05, 0.95, 0.92, 1.0];
const OVERSTRETCH = 0.97;
const FORCE_FACTOR = 2.4;

export class Spider {
  pos: Vec;
  vel = vec();
  heading = -Math.PI / 2;
  legs: Leg[] = [];
  activeGroup: Group = 'A';
  lastSteppedGroup: Group = 'B';
  time = 0;
  switches = 0;
  totalSteps = 0;
  forcedSteps = 0;
  scale = 1;
  stepDuration = 0.15;
  pointerDist = 0;

  constructor(x: number, y: number, params: Params) {
    this.pos = vec(x, y);
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < 4; i++) {
        const name = `${side < 0 ? 'L' : 'R'}${i + 1}`;
        this.legs.push({
          name, side, index: i, group: GROUP_OF[name],
          hipLocal: vec(), restLocal: vec(), upper: 0, lower: 0,
          hip: vec(), knee: vec(), foot: vec(), target: vec(), landing: vec(),
          drift: 0, state: 'planted',
          swingFrom: vec(), swingTo: vec(), swingT: 0, swingDur: 0.15,
          hipDeg: 0, kneeDeg: 0, clamped: false, reachRatio: 0, steps: 0,
        });
      }
    }
    this.layout(params);
    this.plantAll();
  }

  /** Recompute leg geometry from the leg-length parameter. */
  layout(params: Params) {
    const L = params.legLength;
    const s = (this.scale = L / 72);
    for (const leg of this.legs) {
      const i = leg.index;
      const m = LEN_MULT[i];
      leg.upper = L * 0.62 * m;
      leg.lower = L * 0.7 * m;
      const a = (REST_ANGLE_DEG[i] * Math.PI) / 180;
      const r = L * 0.74 * m;
      leg.hipLocal = vec(HIP_X[i] * s, leg.side * 5 * s);
      leg.restLocal = vec(leg.hipLocal.x + Math.cos(a) * r, leg.side * (5 * s + Math.sin(a) * r));
    }
  }

  plantAll() {
    for (const leg of this.legs) {
      const t = this.toWorld(leg.restLocal);
      leg.foot = { ...t };
      leg.target = { ...t };
      leg.landing = { ...t };
      leg.state = 'planted';
    }
    this.solveIK();
  }

  toWorld(p: Vec): Vec {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return { x: this.pos.x + p.x * c - p.y * s, y: this.pos.y + p.x * s + p.y * c };
  }

  update(dtRaw: number, pointer: Vec, params: Params): Decision[] {
    const out: Decision[] = [];
    const dt = Math.min(dtRaw, 1 / 20);
    if (dt <= 0) return out;
    this.time += dt;
    const s = this.scale;

    // --- Body: steer toward the pointer with an arrival slowdown.
    const dx = pointer.x - this.pos.x;
    const dy = pointer.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    this.pointerDist = d;
    const arrive = 90 * s;
    const desired = d < 3 ? 0 : params.speed * Math.min(1, d / arrive);
    const dvx = d > 0 ? (dx / d) * desired : 0;
    const dvy = d > 0 ? (dy / d) * desired : 0;
    const k = 1 - Math.exp(-dt * 7);
    this.vel.x += (dvx - this.vel.x) * k;
    this.vel.y += (dvy - this.vel.y) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    const spd = Math.hypot(this.vel.x, this.vel.y);
    if (spd > 6) {
      const want = Math.atan2(this.vel.y, this.vel.x);
      this.heading += angleDiff(this.heading, want) * (1 - Math.exp(-dt * 6));
    }

    const thr = params.threshold;
    // Size swings so the body travels under ~0.8× threshold while a group is airborne;
    // otherwise the waiting group falls behind faster than it can catch up.
    this.stepDuration = Math.min(0.2, Math.max(0.055, (0.8 * thr) / Math.max(1, params.speed)));
    // Feet land ahead of their rest anchor along the velocity, buying stance time.
    // Capped below the threshold so a fresh landing never immediately re-triggers.
    let leadX = this.vel.x * this.stepDuration * 1.6;
    let leadY = this.vel.y * this.stepDuration * 1.6;
    const leadLen = Math.hypot(leadX, leadY);
    const leadMax = thr * 0.85;
    if (leadLen > leadMax) {
      leadX *= leadMax / leadLen;
      leadY *= leadMax / leadLen;
    }

    // --- Legs: update targets, advance swings, measure drift.
    for (const leg of this.legs) {
      leg.hip = this.toWorld(leg.hipLocal);
      leg.target = this.toWorld(leg.restLocal);
      leg.landing = { x: leg.target.x + leadX, y: leg.target.y + leadY };

      if (leg.state === 'stepping') {
        leg.swingT += dt / leg.swingDur;
        // Keep retargeting mid-swing so the foot lands where the body will be.
        leg.swingTo = { ...leg.landing };
        const t = Math.min(1, leg.swingT);
        const e = t * t * (3 - 2 * t);
        leg.foot = { x: lerp(leg.swingFrom.x, leg.swingTo.x, e), y: lerp(leg.swingFrom.y, leg.swingTo.y, e) };
        if (t >= 1) {
          leg.state = 'planted';
          leg.foot = { ...leg.swingTo };
        }
      }
      leg.drift = dist(leg.foot, leg.target);
    }

    const swinging = this.legs.filter((l) => l.state === 'stepping');
    const needs = (l: Leg) => l.state !== 'stepping' && l.drift > thr;

    // --- Gait arbitration: only switch groups when nobody is mid-air.
    if (swinging.length === 0) {
      const other: Group = this.activeGroup === 'A' ? 'B' : 'A';
      const needActive = this.legs.filter((l) => l.group === this.activeGroup && needs(l));
      const needOther = this.legs.filter((l) => l.group === other && needs(l));
      if (needOther.length > 0 && (this.lastSteppedGroup === this.activeGroup || needActive.length === 0)) {
        const why =
          needActive.length === 0
            ? `group ${this.activeGroup} has no legs over threshold`
            : `group ${this.activeGroup} just stepped (alternation)`;
        out.push({
          t: this.time, kind: 'switch', group: other,
          text: `Gait → group ${other}: ${why}; ${needOther.length} leg${needOther.length > 1 ? 's' : ''} in ${other} need a step`,
        });
        this.activeGroup = other;
        this.switches++;
      }
    }

    // --- Per-leg step decisions.
    for (const leg of this.legs) {
      if (leg.state === 'stepping') continue;
      const reach = dist(leg.hip, leg.foot) / (leg.upper + leg.lower);
      const overstretched = reach > OVERSTRETCH;
      const runaway = leg.drift > thr * FORCE_FACTOR;

      if (overstretched || runaway) {
        const why = overstretched
          ? `leg overstretched (${Math.round(reach * 100)}% of reach)`
          : `drift ${Math.round(leg.drift)}px > ${FORCE_FACTOR}× threshold`;
        this.startStep(leg);
        this.forcedSteps++;
        out.push({ t: this.time, kind: 'forced', leg: leg.name, group: leg.group, text: `Leg ${leg.name} FORCED step: ${why}, overriding gait group ${this.activeGroup}` });
        continue;
      }

      if (leg.drift > thr) {
        if (leg.group === this.activeGroup) {
          this.startStep(leg);
          this.lastSteppedGroup = leg.group;
          out.push({ t: this.time, kind: 'step', leg: leg.name, group: leg.group, text: `Leg ${leg.name} stepped: drift ${Math.round(leg.drift)}px > threshold ${Math.round(thr)}px, group ${leg.group} active` });
        } else if (leg.state !== 'waiting') {
          leg.state = 'waiting';
          out.push({ t: this.time, kind: 'wait', leg: leg.name, group: leg.group, text: `Leg ${leg.name} held: drift ${Math.round(leg.drift)}px > ${Math.round(thr)}px but group ${this.activeGroup} owns the gait` });
        }
      } else if (leg.state === 'waiting') {
        leg.state = 'planted';
      }
    }

    this.solveIK();
    return out;
  }

  /** Solve IK for rendering and the explain overlay. */
  solveIK() {
    for (const leg of this.legs) {
      leg.hip = this.toWorld(leg.hipLocal);
      const ik = solveTwoBone(leg.hip, leg.foot, leg.upper, leg.lower, this.pos);
      leg.knee = ik.knee;
      leg.clamped = ik.clamped;
      leg.reachRatio = ik.reachRatio;
      leg.kneeDeg = (ik.kneeAngle * 180) / Math.PI;
      leg.hipDeg = (angleDiff(this.heading, ik.upperAngle) * 180) / Math.PI;
    }
  }

  private startStep(leg: Leg) {
    leg.state = 'stepping';
    leg.swingFrom = { ...leg.foot };
    leg.swingTo = { ...leg.landing };
    leg.swingT = 0;
    leg.swingDur = this.stepDuration;
    leg.steps++;
    this.totalSteps++;
  }
}
