import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compileSlide, DECK_SIZE_WIDTHS, isFlatSlideHtml, LIMITS, readSourceSlide, SLIDE_HEIGHT, slidePath, type Slide } from '@open-artifact/slides-core';
import { Dialog, HistoryPanel } from '@open-artifact/ui';
import { SlideView, useElementSize } from '../render/SlideView.tsx';
import { slideHistory } from '../services/history.ts';
import { resolveSrc, session } from '../services/session.ts';
import { deckFaces } from '../state/deck.ts';

type Preview = NonNullable<ReturnType<typeof slideHistory.store.getState>['preview']>;

function PreviousSlides({ preview }: { preview: Preview }): ReactNode {
  const [at, select] = useState(0);
  const [rendered, setRendered] = useState<{ slide: Slide; assets: Map<string, string> } | null>(null);
  const slide = rendered?.slide;
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);
  const width = DECK_SIZE_WIDTHS[preview.index.size ?? '16:9'];
  const scale = size ? Math.min(size.w / width, size.h / SLIDE_HEIGHT) : 0;
  const id = preview.order[at];
  useEffect(() => {
    let active = true;
    const assets = new Map<string, string>();
    setRendered(null);
    setError('');
    if (!id) return;
    const path = slidePath(id);
    async function read(): Promise<void> {
      if ((preview.files[path]?.size ?? 0) > LIMITS.slideFileBytes) throw new Error('This slide is too large to preview.');
      const text = await slideHistory.capability()!.read(preview.version, path);
      const opts = { id, index: at, faces: deckFaces(preview.index), lints: false };
      const result = preview.source && !isFlatSlideHtml(text) ? readSourceSlide(text, preview.source, opts) : compileSlide(text, opts);
      if (result.held) throw new Error(result.diagnostics.find(item => item.level === 'error')?.message ?? 'This slide could not be read.');
      // Uploads have immutable addresses. Copied design-system files can change between versions.
      await Promise.all(result.assets.filter(src => src.startsWith('project/')).map(async src => {
        const bytes = await slideHistory.capability()!.readBytes(preview.version, src);
        if (active) assets.set(src, URL.createObjectURL(new Blob([bytes as BlobPart], {
          type: src.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '',
        })));
      }));
      if (active) setRendered({ slide: result.slide, assets });
    }
    void read().catch(reason => { if (active) setError(String(reason)); });
    return () => {
      active = false;
      for (const url of assets.values()) URL.revokeObjectURL(url);
    };
  }, [preview, id, at]);

  return <section className="flex min-w-0 flex-1 flex-col gap-3" aria-label="Read-only slide preview">
    <label className="flex items-center gap-2 text-sm">Slide
      <select className="max-w-full rounded border border-line p-1" value={at} onChange={event => select(Number(event.target.value))}>
        {preview.order.map((item, i) => <option key={item} value={i}>{i + 1}. {item}</option>)}
      </select>
    </label>
    <div ref={container} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-stage">
      {slide && scale > 0 ? <div className="relative" style={{ width: width * scale, height: SLIDE_HEIGHT * scale }}>
        <SlideView slide={slide} options={{ mode: 'thumb', resolveSrc: src => rendered.assets.get(src) ?? resolveSrc(src) }} style={{ width, transformOrigin: 'top left', transform: `scale(${scale})` }} />
      </div> : <span role="status">{error || (id ? 'Loading slide…' : 'No slides in this version')}</span>}
    </div>
    {slide?.notes && <p className="max-h-24 overflow-auto whitespace-pre-wrap text-sm">{slide.notes}</p>}
  </section>;
}

/** History diffs, whole-version and single-file restores use the same controls as other artifact types. */
export function HistoryDialog(): ReactNode {
  const { open, previewing, preview, error, loading } = slideHistory.store();
  const history = slideHistory.capability();
  if (!history || !open) return null;
  return <Dialog open onOpenChange={value => slideHistory.toggle(value)} title="Version history" className="w-[min(64rem,calc(100vw-2rem))]">
    <div className="flex h-[min(65vh,36rem)] gap-4 max-sm:flex-col">
      <HistoryPanel history={history} viewerId={session().viewer.id} previewing={previewing}
        onPreview={n => void slideHistory.preview(n)} className={previewing === null ? 'min-w-0 flex-1' : 'min-h-0 w-72 max-w-full shrink overflow-auto'} />
      {previewing !== null && (loading || error ? <p role="status">{error || 'Loading version…'}</p> :
        preview && <PreviousSlides key={preview.version} preview={preview} />)}
    </div>
  </Dialog>;
}
