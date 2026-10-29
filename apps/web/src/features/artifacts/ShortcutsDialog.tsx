import { t } from '../../i18n'
import { Dialog, Kbd } from '../../ui'
import { SHORTCUTS } from './menus'

/** The canvas shortcut sheet (?), Stitch capability list §9. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={t('快捷键')} width={640}>
      <div className="art-keys">
        {SHORTCUTS.map((g) => (
          <section key={g.title} className="art-keys__group">
            <h3>{g.title}</h3>
            {g.items.map((it) => (
              <div key={it.label} className={it.soon ? 'art-keys__row art-keys__row--soon' : 'art-keys__row'}>
                <span>
                  {it.label}
                  {it.soon ? <small>{t('即将支持')}</small> : null}
                </span>
                <Kbd keys={it.keys} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
