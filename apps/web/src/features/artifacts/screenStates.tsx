import {
  type ArtifactState,
  defaultState,
  type GgArtifactManifest,
  screenDims,
  stateFromQuery,
  stateQuery,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Icon, MenuButton } from '../../ui'
import './screen-states.css'

type Chosen = { all: ArtifactState; screen: Record<string, ArtifactState> }

/**
 * Screen states (gg-kit.js, SKILL.md「Screen states」) on the canvas and in the prototype editor: a choice of a global
 * dim holds on every screen using it, a screen's own dim only there; the frame loads the state in its query.
 */
export function useScreenStates(manifest: GgArtifactManifest | null | undefined) {
  const [chosen, setChosen] = useState<Chosen>({ all: {}, screen: {} })
  const globals = new Set((manifest?.dims ?? []).map((d) => d.id))
  const dimsOf = (id: string) => (manifest ? screenDims(manifest, id) : [])
  const stateOf = (id: string) =>
    stateFromQuery(dimsOf(id), stateQuery({ ...chosen.all, ...chosen.screen[id] }))
  const query = (id: string) => (dimsOf(id).length ? `?${stateQuery(stateOf(id))}` : '')
  const choose = (id: string, set: ArtifactState | undefined) =>
    set &&
    setChosen((c) => {
      const all = { ...c.all }
      const own = { ...c.screen[id] }
      for (const [k, v] of Object.entries(set)) {
        if (globals.has(k)) all[k] = v
        else own[k] = v
      }
      return { all, screen: { ...c.screen, [id]: own } }
    })

  const picker = (id: string) => {
    const dims = dimsOf(id)
    if (!dims.length) return null
    const state = stateOf(id)
    const base = defaultState(dims)
    const changed = dims.filter((d) => state[d.id] !== base[d.id])
    const label = changed.length
      ? changed.map((d) => d.values.find((v) => v.id === state[d.id])?.label).join(' · ')
      : t('默认状态')
    return (
      <MenuButton
        className={cx('art-state', changed.length > 0 && 'art-state--on')}
        title={t('切换这一屏的状态')}
        aria-label={t('状态：{label}', { label })}
        data-testid={`art-state-${id}`}
        onPointerDown={(e) => e.stopPropagation()}
        items={dims.flatMap((d) => [
          { header: d.label },
          ...d.values.map((v) => ({
            label: v.label,
            value: `${d.id}=${v.id}`,
            radio: true,
            checked: state[d.id] === v.id,
          })),
        ])}
        onSelect={(v) => {
          const [k = '', value = ''] = v.split('=')
          choose(id, { [k]: value })
        }}
      >
        <Icon name="slider-horizontal" size={11} />
        <span>{label}</span>
      </MenuButton>
    )
  }

  /** The page a frame of the screen loads: its file and the state in the query. */
  const fileOf = (s: { id: string; file: string }) => `${s.file}${query(s.id)}`
  return { fileOf, query, choose, picker }
}
