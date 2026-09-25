import { Icon, type IconName } from '../../ui'
import { DRAWN_PATHS } from '../../ui/icons/drawn'
import { PANE_PATHS } from '../../ui/icons/pane'

const THEMES = ['light', 'dark', 'hc-light', 'hc-dark'] as const
const SWATCHES = [
  'window-bg',
  'content-bg',
  'sidebar-bg',
  'label',
  'label-secondary',
  'label-tertiary',
  'separator',
  'accent',
  'accent-text',
  'focus-ring',
  'menu-highlight',
  'selection-inactive',
  'row-alt',
  'control-outline',
  'scrim',
  'bubble-in',
  'bubble-out',
  'system-red',
  'system-green',
  'system-orange',
]

function IconGrid({ title, names }: { title: string; names: string[] }) {
  return (
    <>
      <h3 className="eyebrow">
        {title} · {names.length}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 4 }}>
        {names.map((name) => (
          <div
            key={name}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '10px 4px',
            }}
          >
            <Icon name={name as IconName} size={24} />
            <span style={{ fontSize: 11, color: 'var(--label-secondary)' }}>{name}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Pane tokens in all four themes and the full icon set (Pane originals vs glyphs drawn for this app). */
export function FoundationGallery() {
  return (
    <>
      <section className="gallery__section" data-testid="token-swatches">
        <h2 className="eyebrow">TOKENS · 4 THEMES</h2>
        {THEMES.map((theme) => (
          <div
            key={theme}
            data-theme={theme}
            style={{
              background: 'var(--window-bg)',
              color: 'var(--label)',
              padding: 12,
              borderRadius: 'var(--radius-menu)',
              boxShadow: 'var(--shadow-outline)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{theme}</div>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 8 }}
            >
              {SWATCHES.map((token) => (
                <div key={token} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span
                    style={{
                      height: 28,
                      borderRadius: 'var(--radius-field)',
                      background: `var(--${token})`,
                      boxShadow: 'var(--shadow-control)',
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--label-secondary)' }}>{token}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="gallery__section" data-testid="icon-overview">
        <h2 className="eyebrow">
          ICONS · {Object.keys(PANE_PATHS).length + Object.keys(DRAWN_PATHS).length}
        </h2>
        <IconGrid title="PANE" names={Object.keys(PANE_PATHS)} />
        <IconGrid title="DRAWN" names={Object.keys(DRAWN_PATHS)} />
      </section>
    </>
  )
}
