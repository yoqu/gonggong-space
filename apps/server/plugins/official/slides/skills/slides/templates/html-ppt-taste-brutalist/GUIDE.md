# Tactical Telemetry / CRT Terminal

A 16:9 deck for project debriefs, security reviews, infra incident write-ups, ops walkthroughs, and any "we are not selling, we are reporting" presentation. Reads like a declassified mission packet, not a pitch deck. Commits to ONE substrate (dark CRT) — never mix with a light mode in the same artifact.

`example.html` is a finished example of this template — study its structure, density and finish, do not copy its copy.

## Source

Distilled from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) — `skills/brutalist-skill/SKILL.md` §2.2 (Tactical Telemetry & CRT Terminal). Deck system follows the project's existing `html-ppt` convention (16:9 slides, vertical-stack fallback when opened directly).

## Start here

- `example.html` is a self-contained 16:9 deck (inline CSS, Google Fonts link). Copy it to `design/<slug>/index.html` and replace content section by section; keep the class structure. Keep the paging script at the end of `<body>` (← → / PgUp PgDn scroll one slide; it exposes `window.deck`). No assets from `../html-ppt/` are required.
- Speaker-notes conventions and the self-contained-folder rule follow `../html-ppt/GUIDE.md`; if you add notes, put them in `<aside class="notes">` (hidden) — never as visible text.
- Fonts: Every font stack keeps a Chinese fallback — sans: `"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; serif: `"Songti SC","Noto Serif SC",serif`. Google Fonts links may stay. Copy is Chinese with `<html lang="zh-CN">`.

## Hard rules

- **Substrate:** deactivated-CRT charcoal `#0A0A0A` / `#121212`. Never pure black.
- **Foreground:** white phosphor `#EAEAEA`. Secondary `#9A9A98`.
- **Accent:** ONE color — hazard red `#E61919`. Used on alerts, classifications, the latest data point. Never as a slide background fill.
- **Optional:** terminal green `#4AF626` for ONE specific UI element across the entire deck (e.g. a single status indicator). Omit if it doesn't earn its place.
- **Type:** monospace dominates. JetBrains Mono / IBM Plex Mono for body and meta. Heavy condensed grotesque (Archivo Black / Inter Black) only for slide titles. Chinese titles fall back to a heavy sans (`"PingFang SC","Noto Sans SC"` at 900).
- **Title scale:** `clamp(56px, 7vw, 96px)`, uppercase, tracking `-0.04em`, leading `0.9`. Check the cover at ~1280px wide: the giant numeral + title block must not overflow — shrink the numeral before the title.
- **Geometry:** `border-radius: 0`. Visible 1px hairlines (`#2A2A28` on charcoal). Use `display: grid; gap: 1px` over a hairline-colored background to render perfect cells.
- **Scanline overlay:** subtle `repeating-linear-gradient` at `2px / 4px` cycle, opacity ≤ `0.08`, applied as a fixed pointer-events-none layer.
- **Phosphor noise:** optional SVG-grain pseudo-element, opacity ≤ `0.06`.
- **Slide chrome:** every slide carries top register strip — classification, slide ID, timestamp, coordinates — and a bottom bar with serial number + page.

## Banned

- `border-radius` above 0.
- Drop shadows, gradients, glassmorphism, glow.
- Color other than charcoal, phosphor, hazard red, and at most one terminal-green element.
- Sans-serif body fonts. Monospace is the body.
- Pitch-deck "delight" — emoji, illustration, stock photography, friendly icons.
- Light-mode slides anywhere in the same deck.
- Slide transitions other than instant cuts.

## Required slide archetypes (10–14 total)

1. **Classification cover** — giant numeral or call-sign on the left, redaction bar above the title, mono meta column on the right.
2. **Briefing strip** — eight-cell mono register with mission ID, dates, principals, classification.
3. **Numbered objectives** — three to five hairline-separated theses, each with `>>>` marker.
4. **Telemetry grid** — `display: grid; gap: 1px` of mono key-value cells; red highlight on the variant that breaks the trend.
5. **Threat / risk register** — hairline table with severity column in red.
6. **Sequence / timeline** — vertical mono list, 2-px vertical rule on the left, hazard markers on critical events.
7. **Diagram / wiring** — pure-CSS box-and-line schematic; rectangles with hairlines, ASCII arrows.
8. **Specimen** — single mono character or word at viewport-bleeding scale, used as a visual fulcrum.
9. **Alert** — diagonal hazard-stripe block (`repeating-linear-gradient(135deg, ...)`) with the most important sentence in the deck.
10. **Audit log** — append-only mono entries with timestamp + actor + event.
11. **Closing colophon** — operator, system, build, classification, sign-off line.

## Motion

This aesthetic is mechanical and instant.
- Cuts between slides — no fades. Optionally a 60ms flicker (`opacity: 0.85 → 1`).
- A blinking caret on the cover (`▌`) and a single pulse on the live status dot. Nothing else moves.
- The example is a vertical stack of 100vh slides with no script; if you add keyboard paging, keep it an instant scroll-to-next-section.

## Linked edits

- Every slide hand-writes its position three times: `.topbar` `SLIDE NN / 11`, `.botbar` `PAGE NN / 11` and the incrementing `SERIAL OPN-04 / 07NN` — renumber all of them (and the total) when slides change.
- The deck length is also stated on the cover: `.stamp` `PKT · 04 / 11` and the lede `Eleven slides.`; section headers repeat the slide number in `.ascii-frame` (`05 / open risks …`).
- The mission ID (`OPN-04`) and the cover numeral `.cover .num` (`04`) recur in every topbar, serial and the cover `<dl>` — rename them everywhere at once.
- `--hazard` `#E61919` is repeated as `rgba(230,25,25,…)` in `--hazard-soft` and the `.alertbox` hazard-stripe gradient; `--green` `#4AF626` as `rgba(74,246,38,…)` in the status-dot shadow and `@keyframes pulse`; `.sev-md` uses a raw `#E0A819`.
- The risk register `.risk .table` is a 6-column grid with one `.h` header row; the narrow-screen media query hides cells via `nth-child(6n+4/5/6)`, so adding or removing a column means updating the header, the grid template and those selectors.
- The paging script at the end of `<body>` reads `.deck > .slide` and picks the current slide by `offsetTop` vs `scrollY` — keep slides as direct children of `.deck` in one vertical stack, and keep its `window.deck = { slides, index, go }` line.

## Print

Supported. Browser print (Cmd/Ctrl+P → Save as PDF) gives one 1920×1080 page per slide; deck-toolkit.js lays the slides out for print, so keep it loaded. The blinking caret and pulsing status dot print in a static state.

## Pre-flight

- [ ] Substrate is charcoal, foreground is phosphor, only accent is hazard red
- [ ] All `border-radius` is 0; all corners are 90°
- [ ] Title slide includes classification + serial + timestamp + coordinates
- [ ] At least one `display: grid; gap: 1px` telemetry module
- [ ] Scanline overlay applied as fixed pointer-events-none element, opacity ≤ 0.08
- [ ] At least one diagonal hazard-stripe alert block
- [ ] ASCII syntax decoration (`[ ... ]`, `>>>`, `///`) appears at least four times across the deck
- [ ] Numeric data uses tabular-nums + monospace
- [ ] No emojis, no curves, no gradients, no shadow effects
- [ ] Terminal green appears on zero or one element only — never as text body color
- [ ] Chinese fallback in every font stack; `<html lang="zh-CN">`.
