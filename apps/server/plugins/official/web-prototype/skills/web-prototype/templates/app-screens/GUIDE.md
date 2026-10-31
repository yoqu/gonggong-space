# App screens — multi-screen mobile / mini program prototype

A clickable set of screens for one product flow, rendered by the platform shell inside a device frame. You write the **business content only**: which screens exist, what is on each, how they link. The shell, device chrome, navigation runtime and base styles are platform-owned (`kit/`) and you never edit them.

Reference: `example/` is a finished three-screen 麓客+ prototype (home, event detail, sign-up result) built on `design-systems/luke-plus`. Match its structure and layout finish; do not copy its content into an unrelated product. Its images are `.gg-ph` placeholders only to keep the plugin small — your screens fill image slots with real images (`craft/imagery.md`).

## What to build

- One screen per item in `页面清单` (screens). Without a list, decide the smallest flow that covers the brief (usually 2–4 screens: entry, list or feed, detail, one action result) and say so in the reply.
- `device`: `miniprogram` for WeChat mini programs (the default when the design system or brief says 小程序), `mobile` for a native app, `desktop` only when the brief is clearly a web app.
- Every tap that leads somewhere drawn gets `data-gg-link="<screen id>"`; every back arrow gets `data-gg-back`. Taps that lead nowhere drawn stay inert (`href="#"` or a plain `button`).

## Layout rules per device

All sizes are CSS px on the device width (miniprogram 375, mobile 390). The kit exposes the device chrome as variables; use them instead of magic numbers:

| Variable | Use |
|---|---|
| `--gg-status-bar` | top inset of the status bar (the shell draws the bar) |
| `--gg-capsule-top`, `--gg-capsule-height`, `--gg-capsule-width`, `--gg-capsule-right` | the WeChat capsule (miniprogram only, drawn by the shell). A custom top bar puts its row at `top: var(--gg-capsule-top)` with `height: var(--gg-capsule-height)` and keeps clear of the capsule on the right |
| `--gg-nav-height` | full height of a custom navigation bar (status bar + nav row) |
| `--gg-safe-bottom` | home-indicator inset; fixed bottom bars add it to their bottom padding, scrolling content reserves it |

- Do not draw a status bar, capsule or home indicator yourself.
- Immersive tops (a photo under the status bar) set `"statusBar": "light"` on that screen in `gg-artifact.json` so the shell draws white status text.
- Fixed bottom bars (tab bar, action bar) use `position: fixed; bottom: 0` and the body reserves their height plus `--gg-safe-bottom`.
- Horizontal lists use the kit class `gg-scroll-x`; show part of the next card to signal scrolling.

## Design system

- Every colour, radius, spacing step and text style comes from `tokens.css`: `var(--color-…)`, `var(--rounded-…)`, `var(--space-…)`, and the `.t-<style>` classes for type. Tints use `color-mix(in srgb, var(--color-…) N%, transparent)`.
- `DESIGN.md` → `components` describes the design system's components (sizes, which tokens they use); build them exactly that way, and follow its Do's and Don'ts.
- Only the design system's own values. If a value you need is missing (a size not on the scale), use the nearest step; never add a colour.

## Content

- Real, specific copy in the request's language: plausible names, dates, prices and counts that agree across screens (the card's date equals the detail's date).
- Images: follow `craft/imagery.md` — attachments, then generated images, then free photos downloaded into `assets/`, SVG illustrations for maps and diagrams. `<div class="gg-ph" data-label="photo brief, ratio"></div>` (`data-tone="dark"` under white text) only for a slot nothing can fill. Never hotlink.
- Avatars without a photo: initials on a tinted token colour, not a grey box.
- Icons: inline SVG in the design system's icon style (line weight, caps, fill). Use them generously the way shipped apps do — before section titles, on meta lines (time, distance, people, price), as the leading mark of list rows and inside status chips — so rows scan at a glance. Define each icon once per screen as a `<symbol>` in a hidden `<svg>` at the top of `<body>` and place it with `<svg class="i"><use href="#i-clock"/></svg>`.

## Visual finish

Aim for a screen someone would screenshot, not a form:

- **One visual anchor per screen** — a photo, map or illustration, or a big number, at the top or at the signature module. Immersive tops (photo or map running under the status bar) suit entry and detail screens.
- **Depth through layers, within the design system** — a sheet or card overlapping the hero by a few steps, the system's own elevation and frosted surfaces where `DESIGN.md` defines them; flat systems get depth from image vs surface contrast instead.
- **Rhythm** — alternate dense and airy sections; vary row patterns (a featured card, then a compact list) instead of repeating one row shape down the page.
- **Status and meta as chips** — small tinted labels (`color-mix` on a token) for states, tags and counts, so a row is scannable at a glance.
- **Numbers as heroes** — prices, ETAs, counts and scores in the system's strongest text style with their unit smaller beside them. When `DESIGN.md` has no display style, the one hero number of a screen may scale its largest text token (`font-size: calc(var(--text-<style>-size) * 1.75)`).
- **A full first view** — at the device size (375×812 miniprogram, 390×844 mobile) the first view is full: no empty band above a fixed bar. When a screen runs short, bring up the next useful module (vehicle or product types, offers, recent orders) or let the hero grow.
- **Overlays stay clear** — chips, bubbles and labels floating on a map or photo never cover pins, vehicles, faces or each other.
- **Navigation that fits the screen** — top-level screens (the entry, a role's home, lists reached from tabs) get the product's tab bar as `DESIGN.md` describes it (`bottom-tab-bar`), with tabs named for this product; flows get a back bar and one fixed primary action at the bottom.

## Checklist (P0 = must pass)

- P0 `gg-artifact.json` lists every screen; ids are kebab-case and each `file` is `screens/<id>.html`.
- P1 Every screen in `gg-artifact.json` has a `prompt` (its design brief) that matches what the screen shows.
- P0 Every `data-gg-link` points at an existing screen id; the entry screen exists.
- P0 No hex, `rgb()` or named colours in screen files; no font sizes or radii outside the tokens.
- P0 Nothing hidden under the status bar, capsule, tab bar or home indicator.
- P0 Each screen opens on its own (`screens/<id>.html`) and inside the shell.
- P1 Every top-level region has `data-section`.
- P1 Touch targets at least 44px where the design system allows (icons can keep a small glyph inside a larger hit area).
- P1 Lists show 3+ items and look full at the device width.
- P1 Image slots hold real images or illustrations (`craft/imagery.md`); every image file loads, and `assets/CREDITS.md` lists the downloaded ones.
- P1 Each screen has its visual anchor and signature module from the brief.
- P1 Top-level screens carry the tab bar; flow screens a back bar.
