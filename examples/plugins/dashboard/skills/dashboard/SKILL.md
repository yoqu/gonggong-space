---
name: dashboard
description: >-
  Build a clickable desktop data dashboard prototype (overview, detail and drill-down screens) as a hosted gonggong
  artifact: gg-artifact.json plus one HTML file per screen in design/<slug>/. Use when a creation request names this
  plugin, or when someone asks for a metrics dashboard, a BI board or a report screen.
---

# Dashboard Skill

You write the screens of a dashboard; the platform owns the shell around them (canvas, device frame, navigation
between screens, element editing). This plugin's shell is `shell/` next to this file (declared as `artifact.kit` in
the plugin manifest): never edit it and never copy it into the artifact folder when the creation message says the
artifact is hosted.

## Output contract

```
design/<slug>/
├── gg-artifact.json   ← { "title", "device": "desktop", "entry": "<screen id>",
│                          "screens": [{ "id", "title", "file": "screens/<id>.html", "prompt": "<设计说明>" }] }
├── tokens.css         ← :root custom properties only (--color-x, --rounded-x, --space-x) and .t-x type classes
└── screens/<id>.html  ← one full HTML document per screen
```

Every screen:

```html
<!doctype html>
<html lang="zh-CN" data-gg-device="desktop">
<head>
<meta charset="utf-8">
<title>总览</title>
<link rel="stylesheet" href="../_gg/gg-kit.css">
<link rel="stylesheet" href="../tokens.css">
<script src="../_gg/gg-kit.js" defer></script>
<style>/* this screen's styles, tokens only */</style>
</head>
<body>
  <section data-section="kpis">…</section>
</body>
</html>
```

- Links between screens: `data-gg-link="<screen id>"` on the clickable element, `data-gg-back` on back buttons.
- Mark each block with `data-section` so people can point at it.
- Charts are inline SVG drawn from the numbers on the screen; no chart libraries, no external resources.
- Numbers stay consistent across screens (a total on the overview equals the sum on its detail screen).

## Workflow

1. Read the request (`需求`) and attachments; list the metrics, the audience and the screens. Default: 总览 plus one
   detail screen per key metric.
2. Write `tokens.css` (a calm neutral palette with one accent unless the group gave a design), then
   `gg-artifact.json` with every screen's `prompt` (what it is for, its sections, where its links go).
3. Write the screens: KPI cards with period-over-period change, one trend chart, one ranking, a detail table; every
   KPI card links to its detail screen.
4. Reply with the screens you made and the assumptions you took for the numbers.
