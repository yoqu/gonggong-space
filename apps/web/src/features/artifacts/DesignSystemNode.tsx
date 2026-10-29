import type { CSSProperties } from 'react'
import { t } from '../../i18n'
import type { DesignTokens } from './tokens'

/** The artifact's tokens as `--a-*` custom properties, so they never shadow the site's own tokens. */
const scope = (tokens: DesignTokens) =>
  Object.fromEntries(tokens.vars.map(([k, v]) => [`--a-${k.slice(2)}`, v])) as CSSProperties

const COLOR_PREVIEW_MAX = 4

/**
 * The design-system node (Stitch capability list §3): the artifact's palette, type ramp, radius and spacing scales,
 * and a few components drawn with its tokens. Like a screen, it shows the artifact's look, not the site's theme.
 */
export function DesignSystemNode({ tokens }: { tokens: DesignTokens }) {
  return (
    <div className="art-ds" style={scope(tokens)} data-testid="art-design-system">
      <section className="art-ds__section">
        <h4>{t('色彩')}</h4>
        <div className="art-ds__colors">
          {tokens.colors.map((g) => (
            <div key={g.group} className="art-ds__group">
              <div className="art-ds__swatch" style={{ background: `var(--a-color-${g.items[0]?.name})` }} />
              {g.items.slice(0, COLOR_PREVIEW_MAX).map((c) => (
                <div key={c.name} className="art-ds__color">
                  <i style={{ background: `var(--a-color-${c.name})` }} />
                  <span>{c.name}</span>
                  <code>{c.value}</code>
                </div>
              ))}
              {g.items.length > COLOR_PREVIEW_MAX ? (
                <div className="art-ds__more">{`+${g.items.length - COLOR_PREVIEW_MAX}`}</div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      {tokens.type.length ? (
        <section className="art-ds__section">
          <h4>{t('字体')}</h4>
          {tokens.type.map((s) => (
            <div key={s.name} className="art-ds__type">
              <span
                className="art-ds__aa"
                style={{
                  fontSize: `var(--a-text-${s.name}-size)`,
                  fontWeight: `var(--a-text-${s.name}-weight)` as CSSProperties['fontWeight'],
                  lineHeight: `var(--a-text-${s.name}-leading)`,
                }}
              >
                Aa
              </span>
              <span className="art-ds__name">{s.name}</span>
              <code>{[s.size, s.weight, s.leading].filter(Boolean).join(' / ')}</code>
            </div>
          ))}
        </section>
      ) : null}
      <div className="art-ds__row">
        {tokens.radii.length ? (
          <section className="art-ds__section">
            <h4>{t('圆角')}</h4>
            <div className="art-ds__radii">
              {tokens.radii.map((r) => (
                <div key={r.name} className="art-ds__radius">
                  <i style={{ borderRadius: `var(--a-rounded-${r.name})` }} />
                  <span>{r.name}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {tokens.spacing.length ? (
          <section className="art-ds__section">
            <h4>{t('间距')}</h4>
            {tokens.spacing.map((s) => (
              <div key={s.name} className="art-ds__space">
                <span>{s.name}</span>
                <i style={{ width: `var(--a-space-${s.name})` }} />
                <code>{s.value}</code>
              </div>
            ))}
          </section>
        ) : null}
      </div>
      <section className="art-ds__section">
        <h4>{t('组件')}</h4>
        <div className="art-ds__components">
          <span className="art-ds__btn art-ds__btn--primary">{t('主要按钮')}</span>
          <span className="art-ds__btn art-ds__btn--secondary">{t('次要按钮')}</span>
          <span className="art-ds__btn art-ds__btn--outline">{t('描边按钮')}</span>
          <span className="art-ds__input">{t('搜索')}</span>
          <span className="art-ds__tag">{t('标签')}</span>
          <span className="art-ds__tag art-ds__tag--soft">{t('标签')}</span>
        </div>
      </section>
    </div>
  )
}
