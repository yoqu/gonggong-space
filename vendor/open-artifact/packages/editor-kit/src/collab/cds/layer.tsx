/**
 * Where the comments UI draws: a shadow root carrying its own stylesheet (comments-css.ts, compiled from
 * comments.css), so its class strings mean what they mean there and never meet the editor's own Tailwind.
 *
 * {@link CommentsLayer} is a shadow host in the editor's tree (a full-surface layer, a panel, a toolbar seat); its
 * children are portalled into the shadow root under a `.cds-root` (density, light or dark from the page, rem scale).
 * Views that may be drawn on their own (a thread card in a side panel) wrap themselves in one; inside a layer they
 * draw straight into it ({@link useInLayer}).
 *
 * Events: every host joins one shield (shield.ts), installed when this module loads, so a key typed in a comment
 * never reaches the editor's window and document listeners (its shortcuts), and presses in the layer never start its
 * gestures. React still bubbles the layer's events up the editor's component tree (a portal's events do), so the
 * layer stops them at its root (all but mouseup, which must reach the document).
 */

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { createContext, useContext, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { COMMENTS_CSS } from './comments-css.ts';
import { CdsRootContext } from './cds.tsx';
import { closeMenus } from './comment-card.tsx';
import { installShield, type Shield } from './shield.ts';

/** Set inside a layer: views draw straight into it. */
const InLayerContext = createContext(false);
export const useInLayer = (): boolean => useContext(InLayerContext);

let shield: Shield | null = null;
let sheet: CSSStyleSheet | null = null;

/** The window's shield, installed once (before an editor's own listeners, when this module loads in a browser). */
function shieldOf(win: Window & typeof globalThis): Shield {
  shield ??= installShield(win, {
    onPointerDown(inside, event) {
      if (!inside) {
        closeMenus();
        return;
      }
      const target = event.composedPath()[0];
      if (!(target instanceof win.Element) || !target.closest('[data-cds=Menu], [data-popup-open]')) closeMenus();
    },
  });
  return shield;
}

// The layer's font (Inter) is declared on the page by editor-kit's styles.css: @font-face is ignored in a shadow root.
if (typeof window !== 'undefined' && typeof document !== 'undefined') shieldOf(window as Window & typeof globalThis);

/** Puts the comments sheet in a shadow root: one constructed sheet shared by every layer, else a <style>. */
function adoptSheet(shadow: ShadowRoot): void {
  const win = shadow.ownerDocument.defaultView;
  if (win && 'adoptedStyleSheets' in shadow && typeof win.CSSStyleSheet === 'function') {
    try {
      if (!sheet) {
        sheet = new win.CSSStyleSheet();
        sheet.replaceSync(COMMENTS_CSS);
      }
      shadow.adoptedStyleSheets = [sheet];
      return;
    } catch {
      // A sheet from another realm, or no constructable sheets: a <style> instead.
    }
  }
  const style = shadow.ownerDocument.createElement('style');
  style.textContent = COMMENTS_CSS;
  shadow.append(style);
}

/** Dark when the page says so (data-mode, data-theme, a dark/light class), else when the system is; and the root font scale. */
export function usePageTheme(win: Window = window): { dark: boolean; remScale: number } {
  const read = (): { dark: boolean; remScale: number } => {
    const doc = win.document;
    const html = doc.documentElement;
    const attr = html.getAttribute('data-mode') ?? html.getAttribute('data-theme') ?? doc.body?.getAttribute('data-theme');
    const system = win.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    const dark = attr === 'dark' || html.classList.contains('dark') || (attr !== 'light' && !html.classList.contains('light') && system);
    const rootSize = Number.parseFloat(win.getComputedStyle(html).fontSize) || 16;
    return { dark, remScale: 16 / rootSize };
  };
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const update = (): void =>
      setTheme((prev) => {
        const next = read();
        return next.dark === prev.dark && next.remScale === prev.remScale ? prev : next;
      });
    const media = win.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    const observer = new MutationObserver(update);
    observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'class', 'style'] });
    if (win.document.body) observer.observe(win.document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media?.removeEventListener?.('change', update);
      observer.disconnect();
    };
  }, [win]);
  return theme;
}

const stop = (event: SyntheticEvent): void => event.stopPropagation();

export interface CommentsLayerProps {
  /** Classes of the host element (in the editor's tree, styled by the editor's CSS). */
  className?: string;
  style?: CSSProperties;
  /** Laid out as `display: contents` inside the shadow root (the default), or as a flex row (a toolbar seat). */
  inline?: boolean;
  /** An Escape no view in the layer took (default: nothing). */
  onEscape?(): boolean | void;
  children: ReactNode;
  /** A data attribute for the host, so an editor can find it. */
  mark?: string;
}

/** A shadow host whose children draw with the comments styles (see the module comment). */
export function CommentsLayer({ className, style, inline = false, onEscape, children, mark = 'data-comments-layer' }: CommentsLayerProps): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const { dark, remScale } = usePageTheme();

  useLayoutEffect(() => {
    if (!host) return;
    const win = host.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    if (!shadow.querySelector('[data-cds-container]')) {
      adoptSheet(shadow);
      const div = host.ownerDocument.createElement('div');
      div.setAttribute('data-cds-container', '');
      div.style.display = 'contents';
      shadow.append(div);
    }
    setContainer(shadow.querySelector<HTMLElement>('[data-cds-container]'));
    const release = win ? shieldOf(win).addHost(host) : undefined;
    return () => release?.();
  }, [host]);

  const root = (
    <div
      className="cds-root"
      data-density="comfortable"
      data-platform="web"
      data-mode={dark ? 'dark' : 'light'}
      style={{ '--cds-rem-scale': remScale, ...(inline ? { display: 'flex', alignItems: 'center' } : { display: 'contents' }) } as unknown as CSSProperties}
      // The layer's events stop here: past it, React would hand them to the editor's components.
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onMouseDown={stop}
      // Not mouseup: React's stop stops the native event too, and Base UI's menus disarm their press-drag-release from
      // a mouseup on the document (without it a menu item's click is taken twice). See shield.ts.
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onWheel={stop}
      onKeyUp={stop}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        if (closeMenus()) {
          event.preventDefault();
          return;
        }
        if (!event.defaultPrevented && !event.nativeEvent.isComposing && onEscape?.()) event.preventDefault();
      }}
    >
      <CdsRootContext.Provider value={{ container: portal, dark }}>
        <InLayerContext.Provider value={true}>
          <BaseTooltip.Provider>{children}</BaseTooltip.Provider>
        </InLayerContext.Provider>
      </CdsRootContext.Provider>
      {/* Menus and tooltips: over everything the layer draws (the All comments panel is z-index 40). */}
      <div ref={setPortal} style={{ position: 'relative', zIndex: 60 }} />
    </div>
  );

  const attrs = { [mark]: '' };
  return (
    <div ref={setHost} className={className} style={style} {...attrs}>
      {container ? createPortal(root, container) : null}
    </div>
  );
}

/** Draws `children` in a layer of their own unless already inside one. */
export function InLayer({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }): ReactNode {
  if (useInLayer()) return children;
  return (
    <CommentsLayer className={className} style={style}>
      {children}
    </CommentsLayer>
  );
}
