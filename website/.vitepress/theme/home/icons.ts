// Hand-drawn 48px line icons: ink strokes (currentColor) with one amber dot each, drawn in via `.draw` paths.
const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const dot = (cx: number, cy: number, r = 2.4) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--amber)" stroke="none"/>`

export const ICONS = {
  chat: svg(
    `<path class="draw" pathLength="1" d="M7 12.5c0-2.5 2-4.5 4.5-4.5h19c2.5 0 4.5 2 4.5 4.5v10c0 2.5-2 4.5-4.5 4.5H17l-6.5 5.5v-5.5h-.5C8.6 27 7 25 7 22.5z"/>` +
      `<path class="draw" pathLength="1" d="M38.5 18.5h.5c2 0 3.5 1.6 3.5 3.5v9c0 2-1.5 3.5-3.5 3.5h-1v4.5l-5.5-4.5H23.5c-2 0-3.5-1.5-3.5-3.5v-.5"/>` +
      `<path d="M14 17.5h13M14 22h8"/>` +
      dot(31, 15.2),
  ),
  server: svg(
    `<rect class="draw" pathLength="1" x="10" y="7" width="28" height="13" rx="3.5"/>` +
      `<rect class="draw" pathLength="1" x="10" y="23" width="28" height="13" rx="3.5"/>` +
      `<path d="M16 13.5h9M16 29.5h9M24 36v5M14 41h20"/>` +
      dot(32, 13.5) +
      `<circle cx="32" cy="29.5" r="1.6" fill="currentColor" stroke="none"/>`,
  ),
  laptop: svg(
    `<rect class="draw" pathLength="1" x="9" y="9" width="30" height="21" rx="3"/>` +
      `<path class="draw" pathLength="1" d="M4.5 36.5h39l-2.5 3.5H7z"/>` +
      `<path d="m15 16 4 3.5-4 3.5M22 23h7"/>` +
      dot(34, 15),
  ),
  eye: svg(
    `<path class="draw" pathLength="1" d="M4.5 24C9 15.5 16 11 24 11s15 4.5 19.5 13C39 32.5 32 37 24 37S9 32.5 4.5 24z"/>` +
      `<circle class="draw" pathLength="1" cx="24" cy="24" r="7.5"/>` +
      dot(24, 24, 3.2) +
      `<path d="M24 4v3M11 7.5l2 2.5M37 7.5l-2 2.5"/>`,
  ),
  seal: svg(
    `<path class="draw" pathLength="1" d="M24 5 40 10.5v11C40 31.5 33.5 39 24 43 14.5 39 8 31.5 8 21.5v-11z"/>` +
      `<path class="draw" pathLength="1" d="m17 23.5 5 5 9-10"/>` +
      dot(36, 12),
  ),
  preview: svg(
    `<rect class="draw" pathLength="1" x="5" y="8" width="38" height="28" rx="4"/>` +
      `<path d="M5 15h38M10 11.5h.01M14 11.5h.01M18 11.5h.01"/>` +
      `<path class="draw" pathLength="1" d="m21 21 9 5-9 5z"/>` +
      dot(36, 40) +
      `<path d="M28 40h-9"/>`,
  ),
  compass: svg(
    `<circle class="draw" pathLength="1" cx="24" cy="24" r="17"/>` +
      `<path d="M24 5v4M24 39v4M5 24h4M39 24h4"/>` +
      `<path class="draw" pathLength="1" d="m18 30 3.5-8.5L30 18l-3.5 8.5z"/>` +
      dot(24, 24, 2.2),
  ),
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
}
