import { say } from './port.ts';

/*
 * Registered before any film code, and capturing: a film's own capturing listener on window would otherwise run
 * first and could stop these.
 */
export function watchNavigation(): void {
  const navigating = (): void => say({ type: 'navigating' });
  window.addEventListener('beforeunload', navigating, true);
  // `persisted` is read through its getter as it was before the film ran, which could redefine it to call every navigation a suspend.
  const persisted = typeof PageTransitionEvent === 'function' ? Object.getOwnPropertyDescriptor(PageTransitionEvent.prototype, 'persisted')?.get : undefined;
  window.addEventListener(
    'pagehide',
    (event) => {
      let suspended = false;
      try {
        suspended = !!persisted && Reflect.apply(persisted, event, []) === true;
      } catch {
        suspended = false;
      }
      if (!suspended) navigating();
    },
    true,
  );
}

/**
 * The stage is a picture: nothing in it may take keyboard focus from the player (a lifted composer carries
 * autofocus or calls focus()). A focus that lands anyway is handed back to the host's window.
 */
export function containFocus(): void {
  const parent = window.parent;
  try {
    HTMLElement.prototype.focus = (): void => {};
    SVGElement.prototype.focus = (): void => {};
  } catch {
    // Left as they are.
  }
  window.addEventListener('focus', () => {
    try {
      const active = document.activeElement;
      if (active instanceof HTMLElement || active instanceof SVGElement) active.blur();
      parent.focus();
    } catch {
      // A cross-origin focus refused: nothing else to do.
    }
  });
}

function hrefOf(link: Element): string {
  if (link instanceof HTMLAnchorElement || link instanceof HTMLAreaElement) return link.href;
  if (link instanceof SVGAElement) return link.href.baseVal;
  return '';
}

/** A link on the stage is never followed: the host is told of the click and decides. */
export function holdLinks(): void {
  const hold = (event: Event): void => {
    const target = event.target;
    const link = target instanceof Element ? target.closest('a[href], area[href]') : null;
    if (!link) return;
    event.preventDefault();
    if (event.type !== 'click') return;
    const href = hrefOf(link);
    if (/^https?:\/\//i.test(href)) say({ type: 'link', href: href.slice(0, 2048) });
  };
  for (const kind of ['click', 'auxclick']) document.addEventListener(kind, hold, true);
}
