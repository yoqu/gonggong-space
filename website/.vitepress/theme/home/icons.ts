// Hand-drawn 48px line icons: ink strokes (currentColor) with one jade accent each, drawn in via `.draw` paths.
const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const jade = (d: string) => `<path d="${d}" fill="var(--jade)" stroke="none"/>`

export const ICONS = {
  chat: svg(
    `<path class="draw" pathLength="1" d="M7 12.5c0-2.5 2-4.5 4.5-4.5h19c2.5 0 4.5 2 4.5 4.5v10c0 2.5-2 4.5-4.5 4.5H17l-6.5 5.5v-5.5h-.5C8.6 27 7 25 7 22.5z"/>` +
      `<path class="draw" pathLength="1" d="M38.5 18.5h.5c2 0 3.5 1.6 3.5 3.5v9c0 2-1.5 3.5-3.5 3.5h-1v4.5l-5.5-4.5H23.5c-2 0-3.5-1.5-3.5-3.5v-.5"/>` +
      `<path d="M14 17.5h13M14 22h8"/>` +
      jade('M31 13.2 33 15.2 31 17.2 29 15.2Z'),
  ),
  server: svg(
    `<rect class="draw" pathLength="1" x="10" y="7" width="28" height="13" rx="3.5"/>` +
      `<rect class="draw" pathLength="1" x="10" y="23" width="28" height="13" rx="3.5"/>` +
      `<path d="M16 13.5h9M16 29.5h9M24 36v5M14 41h20"/>` +
      jade('M32 11.5 34 13.5 32 15.5 30 13.5Z') +
      `<circle cx="32" cy="29.5" r="1.6" fill="currentColor" stroke="none"/>`,
  ),
  laptop: svg(
    `<rect class="draw" pathLength="1" x="9" y="9" width="30" height="21" rx="3"/>` +
      `<path class="draw" pathLength="1" d="M4.5 36.5h39l-2.5 3.5H7z"/>` +
      `<path d="m15 16 4 3.5-4 3.5M22 23h7"/>` +
      jade('M34 13 36 15 34 17 32 15Z'),
  ),
  eye: svg(
    `<path class="draw" pathLength="1" d="M4.5 24C9 15.5 16 11 24 11s15 4.5 19.5 13C39 32.5 32 37 24 37S9 32.5 4.5 24z"/>` +
      `<circle class="draw" pathLength="1" cx="24" cy="24" r="7.5"/>` +
      jade('M24 20 28 24 24 28 20 24Z') +
      `<path d="M24 4v3M11 7.5l2 2.5M37 7.5l-2 2.5"/>`,
  ),
  seal: svg(
    `<path class="draw" pathLength="1" d="M24 5 40 10.5v11C40 31.5 33.5 39 24 43 14.5 39 8 31.5 8 21.5v-11z"/>` +
      `<rect x="17" y="16" width="14" height="14" rx="2" fill="var(--seal)" stroke="none"/>` +
      `<path d="M20.5 20h7M24 20v7M20.5 27h7" stroke="#fbf3ea" stroke-width="1.6"/>`,
  ),
  preview: svg(
    `<rect class="draw" pathLength="1" x="5" y="8" width="38" height="28" rx="4"/>` +
      `<path d="M5 15h38M10 11.5h.01M14 11.5h.01M18 11.5h.01"/>` +
      `<path class="draw" pathLength="1" d="m21 21 9 5-9 5z"/>` +
      jade('M36 36 40 40 36 44 32 40Z') +
      `<path d="M28 40h-9"/>`,
  ),
  compass: svg(
    `<circle class="draw" pathLength="1" cx="24" cy="24" r="17"/>` +
      `<path d="M24 5v4M24 39v4M5 24h4M39 24h4"/>` +
      `<path class="draw" pathLength="1" d="m18 30 3.5-8.5L30 18l-3.5 8.5z"/>` +
      jade('M24 21.5 26.5 24 24 26.5 21.5 24Z'),
  ),
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
}
