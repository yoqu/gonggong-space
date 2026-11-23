/**
 * Page addresses: the page shown is kept in the address as `#page=<id>`,
 * so a copied link opens that page and the browser's back and forward step
 * between the pages visited. Other `#` parameters are kept.
 */

/** The page named by a location hash, or `null`. */
export function pageFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const page = params.get('page');
  return page ? page : null;
}

/** The hash showing `page` (`null`: none), keeping other parameters. */
export function hashForPage(hash: string, page: string | null): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (page) params.set('page', page);
  else params.delete('page');
  const text = params.toString();
  return text ? `#${text}` : '';
}

/**
 * The shareable link to a page: the editor's address without its query
 * (which can carry session parameters), with the page in the hash.
 */
export function pageLink(href: string, page: string | null): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}${hashForPage(url.hash, page)}`;
}

/** What {@link syncPageHistory} needs from an editor: plain callbacks, no store. */
export interface PageHistoryHost {
  /** The page shown now (`null`: the first / only page). */
  current(): string | null;
  /** Shows a page (from back / forward). */
  show(page: string | null): void;
  /** Whether a page id exists. */
  exists(page: string): boolean;
  /** The page to show when the address names none. */
  fallback(): string | null;
  /** Calls `listener` whenever the page shown changes; returns an unsubscribe. */
  subscribe(listener: (page: string | null) => void): () => void;
}

/**
 * Keeps the address bar's `#page=` in step with the page shown: a page
 * switch pushes a history entry, back and forward switch back. Returns a
 * dispose function. Works on `window`'s location and history.
 */
export function syncPageHistory(host: PageHistoryHost): () => void {
  let applying = false;
  const write = (page: string | null, push: boolean): void => {
    const hash = hashForPage(location.hash, page);
    if (hash === location.hash || (!hash && !location.hash)) return;
    const url = `${location.pathname}${location.search}${hash}`;
    try {
      if (push) history.pushState(history.state, '', url);
      else history.replaceState(history.state, '', url);
    } catch {
      // Sandboxed frames may refuse history changes.
    }
  };
  write(host.current(), false);
  const unsubscribe = host.subscribe((page) => {
    if (!applying) write(page, true);
  });
  const onPop = (): void => {
    const named = pageFromHash(location.hash);
    const page = named && host.exists(named) ? named : host.fallback();
    if (page === host.current()) return;
    applying = true;
    try {
      host.show(page);
    } finally {
      applying = false;
    }
  };
  window.addEventListener('popstate', onPop);
  return () => {
    unsubscribe();
    window.removeEventListener('popstate', onPop);
  };
}
