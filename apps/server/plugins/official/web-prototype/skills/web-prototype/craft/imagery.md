# Imagery

A prototype without pictures reads as a wireframe. Design tools like Stitch put a real image in every image slot (hero, cover, product, avatar, map), and people judge a prototype first by those images. Plan the images with the screens and fill every slot you can; a `.gg-ph` placeholder is the last resort, not the default.

## Plan

While planning the screens, list each image slot: what it shows, its ratio and size on screen, and whether text sits on it. Write the subject like a photo brief — subject, setting, light, mood, camera angle — in the product's world ("an electric sightseeing boat on a calm green lake at golden hour, side view, people on board"), not a generic stock word ("boat").

Every screen that a person would remember for a picture (home, detail, landing, profile, result) gets at least one real image or illustration as its visual anchor.

## Sources, first that works wins

1. **Attachments and `refs/`** — the requester's own photos, logos and screenshots.
2. **An image generation tool you have** (an MCP or CLI that generates images): generate each slot from its photo brief at the slot's ratio, save it under `assets/`.
3. **Free photo libraries, downloaded into `assets/`** (never hotlinked):
   - Wikimedia Commons (no key; most files CC BY / CC BY-SA / public domain):
     ```bash
     curl -s 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=electric%20boat%20lake%20filetype:bitmap&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1080'
     ```
     Each page's `imageinfo[0].thumburl` is a 1080-wide JPEG; `extmetadata.LicenseShortName` and `Artist` are the credit.
   - Unsplash (Unsplash License, no attribution required): find photos with web search (`site:unsplash.com/photos <subject>`), open the photo page and download its `images.unsplash.com/photo-…` URL with `?w=1080&q=80&fm=jpg`.
   Search in English with concrete nouns; try 2–3 queries per slot and pick the photo that fits the brief and the design system's mood (light, palette, calm vs lively).
4. **Inline SVG illustration** for things no photo can show: maps and routes, floor plans, diagrams, empty states, abstract banners. Draw them with the design system's colours (`currentColor` or `var(--color-…)` in `fill`/`stroke`), not as a grey box. A map needs to read as a real place at a glance, so build it in layers:
   - land as the base (a light tint), then water bodies with irregular curved shorelines (`path` with cubic curves, not ellipses), islands inside them, parks and green areas in a second tint;
   - a road and path network: a few wide roads, more thin paths, drawn as strokes in the surface colour with a slightly darker casing underneath, crossing the land and following shorelines;
   - small grey building blocks along roads near the points of interest, and place labels in a small muted text style along roads and on land, not on top of pins;
   - only then the product layer: pins or vehicles with a soft shadow, the user's location with a pulse ring, a route as a thick stroke in the primary colour with rounded caps, ETA bubbles anchored to pins.
   Make the map fill its slot edge to edge (`preserveAspectRatio="xMidYMid slice"`) and let a sheet or card overlap its bottom edge.
5. **`.gg-ph` placeholder** only when nothing above fits (a logo or product shot that must be the real one, or no network). Label it with the photo brief.

## Rules

- Download with `curl -L --fail -o assets/<slot-name>.jpg '<url>'` and check each file: open it (look at it), confirm it is the subject you wanted, and that it is a real JPEG/PNG/WebP (`file assets/*`). Delete misses and failed downloads.
- Keep each file under 500 KB: download a 720–1080px-wide version (or shrink with `sips -Z 1080` on macOS / `convert -resize 1080x` elsewhere).
- Reference images relatively (`../assets/<name>.jpg`) with `alt` describing what is shown, `object-fit: cover`, and the slot's real ratio. Text on photos sits on the design system's scrim (a gradient from transparent to the scrim token), never directly on a busy photo.
- People: use photos of people only for avatars, hosts or staff, never as fake testimonials or with invented names of real people. Brand logos, app icons and product shots of real brands are never downloaded — use the requester's or a labelled placeholder.
- Record every downloaded image in `assets/CREDITS.md`: file, source page URL, author, licence. Mention in the reply that the images are stock or generated stand-ins for real photography.
- Keep one coherent look: similar light and colour temperature across a screen; crop to the slot instead of shrinking a wide photo into a tall one.
