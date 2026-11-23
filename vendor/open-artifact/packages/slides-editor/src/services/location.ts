import { storedJson } from '@open-artifact/editor-kit';
import { SLIDE_FRAGMENT } from '@open-artifact/protocol';
import { linkedSlide, onlySuffix, readSlideLink, type OnlyPlace } from '../lib/slide-link.ts';
import { deckOrder, useDeck } from '../state/deck.ts';
import { useView } from '../state/view.ts';
import { session } from './session.ts';

/** The marker distinguishes numeric slide ids from older positional links. */
export function slideHash(id: string): string {
  return `#slide-~${id}`;
}

/** True for a slide link that asks for the slide on its own. */
function asksSlideOnly(hash: string): boolean {
  return readSlideLink(hash)?.only === true;
}

export function slideFromHash(hash: string = location.hash): string | null {
  const link = readSlideLink(hash);
  return link ? linkedSlide(link, deckOrder(useDeck.getState())) : null;
}

function positionStore(storage: () => Storage) {
  return storedJson<string>(`open-artifact-slides:position:${session().artifact.id}`, value => typeof value === 'string' ? value : null, storage);
}

/** Explicit links win over the last slide seen in this tab or artifact. */
export function initialSlide(): string | null {
  const order = deckOrder(useDeck.getState());
  const saved = positionStore(() => sessionStorage).read() ?? positionStore(() => localStorage).read();
  return slideFromHash() ?? (saved && order.includes(saved) ? saved : order[0] ?? null);
}

/** The place last reported, to answer a link to a slide that is not there. */
let reported: string | null = null;

function showPlace(hash: string): void {
  reported = hash;
  if (location.hash !== hash) history.replaceState(history.state, '', hash);
  session().shell?.currentSlide(hash);
}

/** A slide can be on screen in either the editor or the presenter; shown on its own, the place says where. */
export function reportSlide(id: string, only?: OnlyPlace): void {
  showPlace(slideHash(id) + (only ? onlySuffix(only) : ''));
  positionStore(() => sessionStorage).write(id);
  positionStore(() => localStorage).write(id);
}

export function startLocationSync(): void {
  const shell = session().shell;
  function report(): void {
    const current = useView.getState().current;
    if (current) reportSlide(current);
  }

  function follow(hash: string): void {
    if (!SLIDE_FRAGMENT.test(hash)) return;
    const id = slideFromHash(hash);
    const view = useView.getState();
    if (!id) {
      if (reported) showPlace(reported);
      else report();
      return;
    }
    if (asksSlideOnly(hash)) {
      if (view.mode !== 'edit') view.setMode('edit');
      view.present({ start: id, speaker: false, only: true });
      return;
    }
    if (view.presenting) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      view.present(null);
    }
    if (view.mode !== 'edit') view.setMode('edit');
    if (id === view.current) { report(); return; }
    view.showSlide(id);
  }

  const opening = location.hash;
  if (asksSlideOnly(opening)) follow(opening);
  else report();
  useView.subscribe((state, previous) => {
    if (state.current !== previous.current) report();
  });
  shell?.onCommand(command => {
    if (command.cmd === 'goto_slide') follow(command.hash);
  });
  window.addEventListener('hashchange', () => follow(location.hash));
}
