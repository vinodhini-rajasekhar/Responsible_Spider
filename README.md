# Spider XAI

An interactive procedural spider that follows your pointer, with an **Explain** layer that shows every decision the locomotion "agent" makes as it happens. It's built for an Explainable AI project. The goal is to show that even a hand-written controller is easier to trust once its targets, thresholds and arbitration rules are visible.

Inspired by the viral cursor-following spider demo by [@rybinfx](https://x.com/rybinfx) (Slava Rybin). This is an original implementation: none of his code is used.

## What you can see

- **Body steering**: the spider moves toward the mouse or touch point and slows down as it arrives. Its velocity is drawn as an arrow.
- **8 legs with two-bone IK**: each leg is solved with the law of cosines, and the knee always bows away from the body. Knee angles are drawn live, and an angle turns red when the leg is clamped at full reach.
- **Foot anchors and step thresholds**: every foot has a rest anchor (+) and a threshold circle. Once the foot drifts outside the circle, it wants to step. It lands ahead of the anchor along the velocity (◇), which buys it stance time.
- **Alternating tetrapod gait**: group A (L1, R2, L3, R4) and group B (R1, L2, R3, L4) take turns. Only the active group may step, and the groups swap only when every foot is planted. Safety overrides force a step if a leg overstretches or drifts more than 2.4× the threshold.
- **Explain panel**:
  - live stats
  - a scrolling gait diagram
  - a per-leg table showing drift against threshold, hip and knee angles, and a plain-English reason for each leg's state ("Held: over threshold, waiting for group B")
  - a decision log, for example `Leg L2 stepped: drift 42px > threshold 35px, group A active`
- **Parameters**: threshold, max speed, leg length and time scale, plus pause and single-frame stepping. Use them to watch how the parameters change behaviour. For example, a threshold larger than the leg's slack produces forced "overstretched" steps.

Hover a row in the leg table to highlight that leg and show its reach circle and hip angle.

Keyboard: `E` toggles Explain, `Space` pauses, `.` advances one frame.

## Run it locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5317
```

Other scripts:

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the build on http://localhost:5318
```

## Project layout

```
src/
  ik.ts        two-bone IK solver + vector helpers
  spider.ts    body steering, step policy, gait arbitration, decision events
  render.ts    spider + background drawing
  overlay.ts   explain overlay (thresholds, targets, drift, angles)
  panel.ts     side panel: stats, gait diagram, leg table, decision log
  main.ts      canvas setup, input, controls, animation loop
```

Stack: Vite + TypeScript, plain Canvas 2D and CSS, with no runtime dependencies.
