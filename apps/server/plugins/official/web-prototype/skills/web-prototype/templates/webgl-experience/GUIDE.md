# WebGL Experience

Craft: read ../../craft/animation-discipline.md before writing.

Design system: optional — this template has its own visual language; use the design system only for accent colour and fonts.

Produce a single self-contained `index.html` that renders a real-time WebGL (or WebGL2) visual full-screen — animated shaders, 3D scenes, generative visuals, particle fields — with a clean typographic overlay on top.

## Resource map

```
templates/webgl-experience/
├── GUIDE.md      ← you're reading this
└── example.html  ← a working WebGL2 aurora-field reference (READ FIRST)
```

The page is served as a plain static file; WebGL2 runs in any modern browser, so no special preview mode is needed. Prefer `webgl2` for modern features; fall back to `webgl` when the effect allows.

## Workflow

### Step 0 — Read the reference
Read `example.html` end to end — a finished example of this template; study its structure and quality bar, do not copy its copy. Note the shape: one full-viewport `<canvas>`, a fragment-shader draw loop on a fullscreen triangle, a DPR-aware resize, and a `requestAnimationFrame` tick. The overlay (`kicker` → `h1` → `sub`) is pure HTML/CSS layered above the canvas via `z-index`.

### Step 1 — Choose the visual
Pick ONE technique that fits the brief:
- **Fragment-shader field** (default): domain-warped fbm noise, flow fields, plasma, gradients. Cheapest, always 60fps.
- **Raymarched scene**: SDF spheres/boxes with soft shadows for a 3D hero.
- **Instanced geometry**: thousands of points/quads driven by a vertex shader.
- **Post-processed image**: sample a data-URI texture and distort/dither it.

### Step 2 — Build `index.html`
- Keep it **one file, zero external requests** (inline the shader source; embed any texture as a `data:` URI).
- Always: `alpha:false`, DPR clamped to 2, `viewport` on resize, and a guard that shows a graceful message if the context is null.
- Compile shaders with error logging (`getShaderInfoLog`) so a typo fails loudly, not silently black.
- `data-section` on the canvas stage and the overlay.

### Step 3 — Overlay + brand
- Map the two `:root`-level accent colors to the design system's `tokens.css` when one is selected; otherwise use a restrained dark palette with a single vivid accent (the reference uses lime `#63fe13`).
- Headline ≤ 14ch, one supporting line. Never cover the whole canvas — the visual is the hero.

### Step 4 — Self-review (P0), then `../../references/critique.md`
- [ ] Renders continuously at ~60fps; the FPS badge updates.
- [ ] No WebGL console errors; `getError()` clean after first frame.
- [ ] Resizes crisply on window resize (no stretching / blur).
- [ ] Readable overlay contrast over the brightest frame.
- [ ] Degrades to a message (not a blank page) if `webgl2` is unavailable.

## Output

Write the page to `design/<slug>/index.html` (assets next to it, relative paths), then follow SKILL.md: critique, publish.
