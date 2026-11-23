import { stageParts } from './stage.ts';

const told = new Set<string>();
const CSS_URL = /url\(\s*(?:"([^"\\]*(?:\\[\s\S][^"\\]*)*)|'([^'\\]*(?:\\[\s\S][^'\\]*)*)|([^'")\s]*))/g;

function once(key: string, message: string): void {
  if (told.has(key)) return;
  told.add(key);
  console.error('raster-safety: ' + message);
}

const isOutside = (url: string): boolean => url !== '' && !url.startsWith('data:') && !url.startsWith('#');

/** What on the stage an exported frame cannot show, said once each; and focus a film asked for, taken back. */
export function scanStage(): void {
  const parts = stageParts();
  if (!parts) return;
  const { stage, fontStyle } = parts;
  for (const image of stage.querySelectorAll('img')) {
    const source = image.getAttribute('src') ?? '';
    if (source && !source.startsWith('data:'))
      once('img:' + source.slice(0, 40), '<img src> must be a data: URL (kit.assets.url): "' + source.slice(0, 60) + '" will not appear in exported frames');
  }
  if (stage.querySelector('iframe')) once('iframe', '<iframe> inside the stage cannot be exported');
  if (stage.querySelector('link[rel=stylesheet]')) once('link', 'external stylesheets are blocked; put CSS in a module and kit.css() it');
  for (const focused of stage.querySelectorAll('[autofocus]')) focused.removeAttribute('autofocus');
  for (const node of stage.querySelectorAll('*')) {
    if (node.scrollTop || node.scrollLeft) {
      once('scroll', 'an element is scrolled (scrollTop/scrollLeft); exported frames ignore scroll offsets, so animate a translateY instead');
      break;
    }
  }
  const texts: string[] = [];
  for (const styled of stage.querySelectorAll('[style*="url("]')) texts.push(styled.getAttribute('style') ?? '');
  for (const sheet of stage.querySelectorAll('style')) if (sheet !== fontStyle) texts.push(sheet.textContent ?? '');
  for (const text of texts) {
    for (const match of text.matchAll(CSS_URL)) {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (isOutside(url)) {
        once('cssurl', 'CSS uses url(' + url.slice(0, 40) + ') that is not a data: URL; it will not load here (inline it as an asset data: URL or drop the rule)');
        return;
      }
    }
  }
}
