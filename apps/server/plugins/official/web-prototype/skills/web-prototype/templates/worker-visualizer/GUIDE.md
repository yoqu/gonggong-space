# Worker Visualizer

Craft: read ../../craft/animation-discipline.md, ../../craft/state-coverage.md before writing.

Design system: optional — this template has its own visual language; use the design system only for accent colour and fonts.

Produce a single self-contained `index.html` that moves heavy per-frame compute (particles, simulation, physics, fractals, data/audio visualizers) into a Web Worker and renders the result to a canvas, keeping the main thread at a smooth 60fps.

## Resource map

```
templates/worker-visualizer/
├── GUIDE.md      ← you're reading this
└── example.html  ← a working 12k-particle SharedArrayBuffer sim (READ FIRST)
```

The page is served as a plain static file. Blob Web Workers work there, but the preview is not guaranteed to be cross-origin isolated, so `SharedArrayBuffer` may be unavailable — the `postMessage` fallback is the path many viewers will see and must animate just as well.

## Workflow

### Step 0 — Read the reference
Read `example.html` — a finished example of this template; study its structure and quality bar, do not copy its copy. Note the split: the worker integrates positions each tick; the main thread only reads + draws. It feature-detects `crossOriginIsolated` and uses a `SharedArrayBuffer` for zero-copy when available, falling back to a transferable `postMessage` copy otherwise. Always ship that fallback so the page still animates if isolation is off.

### Step 1 — Choose the workload
Pick ONE compute-bound job worth offloading:
- **Particle / N-body field** (default): thousands of bodies with a cheap force law.
- **Fractal**: Mandelbrot/Julia escape-time into an `ImageData` buffer.
- **Cellular automata / reaction-diffusion**: grid updated in the worker.
- **Data/audio visualizer**: transform a stream into bars/rings each frame.

### Step 2 — Build `index.html`
- **One file, zero external requests.** Build the worker from a `Blob` + `URL.createObjectURL` (inline its source), or embed it as a `data:` URL.
- **Prefer SharedArrayBuffer** for large per-frame state: allocate on the main thread, pass the `SharedArrayBuffer` to the worker, and read the same `Float32Array`/`Uint8ClampedArray` view while drawing. Guard on `typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated`.
- **Fallback path**: if not isolated, `postMessage` a transferable `ArrayBuffer` each frame.
- Consider `OffscreenCanvas` + `canvas.transferControlToOffscreen()` to render inside the worker for the heaviest scenes.
- `data-section` on the canvas stage and the HUD.

### Step 3 — Overlay + brand
- HUD with the title and 2–3 live stat tiles (particle count, transport mode, fps). Map accent color to the design system's `tokens.css` when one is selected; otherwise a dark ground with one vivid accent.

### Step 4 — Self-review (P0), then `../../references/critique.md`
- [ ] Worker constructs with no SecurityError; sim runs.
- [ ] Main-thread render holds ~60fps under the full workload.
- [ ] `SharedArrayBuffer` path engages when `crossOriginIsolated` is true; `postMessage` fallback engages otherwise — verify BOTH branches degrade cleanly.
- [ ] No unbounded growth: velocities/positions stay stable over minutes.
- [ ] The "Transport" stat truthfully reports which path is live.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
