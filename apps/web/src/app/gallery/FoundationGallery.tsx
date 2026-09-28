import { avatarSrc, ROLES, roleCostume } from '../../features/bots/avatars'
import {
  ComingSoonArt,
  DeniedArt,
  EmptyChatArt,
  FailedArt,
  Icon,
  type IconName,
  MASCOT_ACTIONS,
  Mascot,
  NoBotsArt,
  NoChangesArt,
  NoDataArt,
  NoGroupsArt,
  NoMachinesArt,
  NoMembersArt,
  NoNotificationsArt,
  NoResultsArt,
  PickChatArt,
  UnsupportedArt,
} from '../../ui'
import { DRAWN_PATHS } from '../../ui/icons/drawn'
import { PANE_PATHS } from '../../ui/icons/pane'

const THEMES = ['light', 'dark', 'hc-light', 'hc-dark'] as const
const ARTS = {
  EmptyChatArt,
  PickChatArt,
  DeniedArt,
  FailedArt,
  NoBotsArt,
  NoMembersArt,
  NoNotificationsArt,
  NoResultsArt,
  NoDataArt,
  NoMachinesArt,
  NoGroupsArt,
  NoChangesArt,
  ComingSoonArt,
  UnsupportedArt,
}
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
            <span style={{ fontSize: 'var(--text-subheadline-size)', color: 'var(--label-secondary)' }}>
              {name}
            </span>
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
            <div style={{ fontSize: 'var(--text-callout-size)', fontWeight: 600, marginBottom: 8 }}>
              {theme}
            </div>
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
                  <span style={{ fontSize: 'var(--text-footnote-size)', color: 'var(--label-secondary)' }}>
                    {token}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="gallery__section" data-testid="mascot-overview">
        <h2 className="eyebrow">MASCOT · 共字君</h2>
        {(['light', 'dark'] as const).map((theme) => (
          <div
            key={theme}
            data-theme={theme}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
              gap: 8,
              padding: 12,
              background: 'var(--window-bg)',
              borderRadius: 'var(--radius-menu)',
            }}
          >
            {MASCOT_ACTIONS.map((a) => (
              <div
                key={a}
                style={{ display: 'grid', justifyItems: 'center', gap: 4, color: 'var(--label-secondary)' }}
              >
                <Mascot action={a} size={104} />
                {a}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mascot crop="head" size={32} />
              <Mascot crop="head" size={24} action="sleep" />
            </div>
          </div>
        ))}
      </section>

      <section className="gallery__section" data-testid="role-overview">
        <h2 className="eyebrow">BOT ROLES · 静态 / 运行中</h2>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}
        >
          {Object.entries(ROLES).map(([k, r]) => (
            <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <img
                src={avatarSrc(k as keyof typeof ROLES)}
                alt=""
                width={48}
                style={{ borderRadius: '28%' }}
              />
              <img
                src={avatarSrc(k as keyof typeof ROLES, true)}
                alt=""
                width={48}
                style={{ borderRadius: '28%' }}
              />
              <div>
                <b>{r.name}</b> · {r.title}
                <div style={{ fontSize: 'var(--text-footnote-size)', color: 'var(--label-secondary)' }}>
                  {r.trait}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="gallery__section" data-testid="role-mascots">
        <h2 className="eyebrow">ROLE MASCOTS · 对话界面动作</h2>
        {Object.keys(ROLES)
          .filter((k) => k !== 'role-gong')
          .map((k) => (
            <div key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {MASCOT_ACTIONS.map((a) => (
                <Mascot key={a} action={a} size={84} costume={roleCostume(k as keyof typeof ROLES)} />
              ))}
            </div>
          ))}
      </section>

      <section className="gallery__section" data-testid="art-overview">
        <h2 className="eyebrow">EMPTY STATE ART</h2>
        {(['light', 'dark'] as const).map((theme) => (
          <div
            key={theme}
            data-theme={theme}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
              gap: 8,
              padding: 12,
              background: 'var(--content-bg)',
              borderRadius: 'var(--radius-menu)',
            }}
          >
            {Object.entries(ARTS).map(([name, Art]) => (
              <div
                key={name}
                style={{ display: 'grid', justifyItems: 'center', color: 'var(--label-secondary)' }}
              >
                <div style={{ width: 160 }}>
                  <Art />
                </div>
                {name}
              </div>
            ))}
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
