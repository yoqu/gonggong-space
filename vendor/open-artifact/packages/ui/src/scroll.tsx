/**
 * Scrolling regions that keyboard users can reach.
 */
import { forwardRef, useCallback, useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from 'react';
import { cn } from './cn.ts';
import { scrollsOverflow, tabbableElements } from './focusables.ts';

/**
 * Whether the element's content overflows an axis that scrolls, kept current
 * as the element or its children resize and as children come and go.
 */
export function useHasScrollOverflow(ref: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) return;
    const measure = () => {
      const style = view.getComputedStyle(element);
      setOverflowing(
        scrollsOverflow({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        }),
      );
    };
    measure();
    if (typeof view.ResizeObserver !== 'function') return;
    const resize = new view.ResizeObserver(measure);
    const watched = new Set<Element>();
    const watch = (node: Node) => {
      if (node.nodeType !== 1) return;
      const child = node as Element;
      // `display: contents` boxes have no size of their own; watch what they hold.
      if (view.getComputedStyle(child).display === 'contents') {
        child.childNodes.forEach(watch);
        return;
      }
      if (!watched.has(child)) {
        watched.add(child);
        resize.observe(child);
      }
    };
    resize.observe(element);
    element.childNodes.forEach(watch);
    const mutations = new view.MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(watch);
      for (const child of watched) {
        if (!element.contains(child)) {
          resize.unobserve(child);
          watched.delete(child);
        }
      }
      measure();
    });
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
  return overflowing;
}

/** Props of {@link ScrollBody}. */
export interface ScrollBodyProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Accessible name used when the region becomes a tab stop. Defaults to the
   * enclosing dialog's title, else "Panel content".
   */
  label?: string;
}

/**
 * A scrolling region (give it a max height and `overflow-auto`). When its
 * content overflows and holds no tab stop of its own, it becomes a named,
 * focusable group so keyboard users can Tab to it and scroll it; otherwise
 * it stays out of the tab order.
 */
export const ScrollBody = forwardRef<HTMLDivElement, ScrollBodyProps>(function ScrollBody(
  { label, className, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      ref.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const overflowing = useHasScrollOverflow(ref);
  const [needsStop, setNeedsStop] = useState(false);
  const [labelledBy, setLabelledBy] = useState<string | null>(null);
  useLayoutEffect(() => {
    const body = ref.current;
    const view = body?.ownerDocument.defaultView;
    if (!overflowing || !body || !view) return;
    const update = () => {
      setNeedsStop(tabbableElements(body).length === 0);
      setLabelledBy(body.closest('[role="dialog"], [role="alertdialog"]')?.getAttribute('aria-labelledby') ?? null);
    };
    update();
    const observer = new view.MutationObserver(update);
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'disabled', 'hidden', 'href', 'contenteditable'] });
    return () => observer.disconnect();
  }, [overflowing]);
  const focusable = overflowing && needsStop;
  return (
    <div
      ref={setRef}
      {...(focusable
        ? {
            role: 'group',
            tabIndex: 0,
            'aria-labelledby': label === undefined ? (labelledBy ?? undefined) : undefined,
            'aria-label': label ?? (labelledBy === null ? 'Panel content' : undefined),
          }
        : {})}
      className={cn(focusable && 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', className)}
      {...rest}
    />
  );
});
