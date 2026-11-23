/** Shared by the editor and the standalone HTML player. Keep the factory self-contained. */
export function createCountPlayer() {
  function findNumber(text: string): { value: number; start: number; end: number; decimals: number; grouped: boolean } | null {
    const match = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/.exec(text);
    if (!match) return null;
    const raw = match[0];
    const grouped = raw.includes(',');
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) return null;
    const decimals = raw.includes('.') ? raw.length - raw.indexOf('.') - 1 : 0;
    return { value, start: match.index, end: match.index + raw.length, decimals, grouped };
  }

  /** The text with its first number replaced by `value`, written the same way. */
  function countText(text: string, value: number): string {
    const found = findNumber(text);
    if (!found) return text;
    let written = value.toFixed(found.decimals);
    if (found.grouped) {
      const [whole, fraction] = written.split('.');
      written = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
    }
    return text.slice(0, found.start) + written + text.slice(found.end);
  }

  /** Ease-out (cubic), for count-ups. */
  function easeOut(t: number): number {
    const clamped = Math.min(1, Math.max(0, t));
    return 1 - (1 - clamped) ** 3;
  }

  /** Counts the first number in an element's text up from `from`. Returns a stop function. */
  function countUp(element: HTMLElement, count: { from: number; duration: number; delay: number }): () => void {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (findNumber((node as Text).data)) {
        text = node as Text;
        break;
      }
    }
    if (!text) return () => undefined;
    const target = text;
    const original = target.data;
    const to = findNumber(original)!.value;
    const start = performance.now() + count.delay;
    let frame = 0;
    const tick = (now: number): void => {
      const t = count.duration > 0 ? (now - start) / count.duration : 1;
      target.data = t >= 1 ? original : countText(original, count.from + (to - count.from) * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    target.data = countText(original, count.from);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      target.data = original;
    };
  }

  return { findNumber, countText, easeOut, countUp };
}

export const { findNumber, countText, easeOut, countUp } = createCountPlayer();
