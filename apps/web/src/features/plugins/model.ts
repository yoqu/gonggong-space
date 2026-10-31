import {
  AUTO_DESIGN_SYSTEM,
  type CreationCard,
  type CreationReq,
  type GroupPluginDto,
  type PluginBlocker,
  type PluginCategory,
  type PluginDto,
  type PluginManifest,
  templateInputs,
  usesDesignSystem,
} from '@gonggong/protocol'
import { t } from '../../i18n'
import type { IconName } from '../../ui'
import { AGENT_LABEL } from '../bots/model'

export const CATEGORY: Record<PluginCategory, { icon: IconName; color: string }> = {
  web: { icon: 'globe', color: 'var(--avatar-1)' },
  deck: { icon: 'slides', color: 'var(--avatar-3)' },
  poster: { icon: 'image', color: 'var(--avatar-5)' },
  dashboard: { icon: 'chart-bar', color: 'var(--avatar-2)' },
  video: { icon: 'video', color: 'var(--avatar-6)' },
  other: { icon: 'apps', color: 'var(--avatar-4)' },
}

export const LAYER_LABEL: Record<PluginDto['layer'], string> = {
  platform: t('平台层'),
  team: t('团队层'),
  group: t('群层'),
}

export const agentsText = (m: PluginManifest) => m.agents.map((a) => AGENT_LABEL[a]).join(t('、'))

export const secretsText = (m: PluginManifest) => m.secrets.join(t('、')) || '—'

/** `open-design@4f69a42` after the license. */
export const sourceText = (m: PluginManifest) =>
  [m.license, m.source && [m.source.name, m.source.revision].filter(Boolean).join('@')]
    .filter(Boolean)
    .join(' · ')

/** Why a bot cannot use the plugin now, as the panel and the settings page say it. */
export function blockerText(blocker: PluginBlocker, m: PluginManifest, botName: string) {
  switch (blocker) {
    case 'agent':
      return t('{bot} 不支持（仅 {agents}）', { bot: botName, agents: agentsText(m) })
    case 'daemon':
      return t('机器版本过低，需升级到 {min} 才能使用插件', { min: m.minDaemon })
    case 'offline':
      return t('机器离线')
    case 'secret':
      return t('缺少密钥 {names}，请在群设置「密钥」里填写', { names: m.secrets.join(t('、')) })
  }
}

export const BLOCKER_TAG: Record<PluginBlocker, { label: string; tone: 'gray' | 'orange' }> = {
  agent: { label: t('不支持'), tone: 'gray' },
  daemon: { label: t('需升级'), tone: 'orange' },
  offline: { label: t('离线'), tone: 'gray' },
  secret: { label: t('缺密钥'), tone: 'orange' },
}

export const previewUrl = (pluginId: string, path: string) =>
  `/api/plugins/${pluginId}/files/${path.split('/').map(encodeURIComponent).join('/')}`

export type CreationDraft = Omit<CreationReq, 'attachmentIds' | 'botId'> & { botId: string | null }

/** The request a creation card was made from: labels map back to input ids; values the manifest no longer knows are dropped. */
export function draftOfCard(
  card: Pick<CreationCard, 'inputs' | 'template' | 'designSystem' | 'directions' | 'botId'>,
  p: GroupPluginDto,
): CreationDraft {
  const inputs: CreationReq['inputs'] = {}
  for (const { label, value } of card.inputs) {
    const input = p.manifest.inputs.find((i) => i.label === label)
    if (input) inputs[input.id] = input.type === 'boolean' ? value === '是' : value
  }
  return {
    pluginId: p.id,
    templateId: card.template?.id ?? null,
    designSystemId: card.designSystem?.id ?? null,
    inputs,
    directions: card.directions,
    botId: card.botId,
  }
}

/** A fresh draft of the plugin: its first template and design system, the inputs' defaults. */
export function newDraft(p: GroupPluginDto, botId: string | null): CreationDraft {
  const inputs: CreationReq['inputs'] = {}
  for (const i of p.manifest.inputs) if (i.default !== null) inputs[i.id] = i.default
  const tpl = p.manifest.templates[0]
  return {
    pluginId: p.id,
    templateId: tpl?.id ?? null,
    designSystemId: !usesDesignSystem(p.manifest, tpl)
      ? null
      : p.manifest.composer
        ? AUTO_DESIGN_SYSTEM
        : (p.manifest.designSystems[0]?.id ?? null),
    inputs,
    directions: false,
    botId,
  }
}

/** Only the template's inputs; blank strings are left out, as if never filled. */
export function requestOf(d: CreationDraft, attachmentIds: string[], m: PluginManifest): CreationReq | null {
  if (!d.botId) return null
  const asked = new Set(
    templateInputs(
      m,
      m.templates.find((x) => x.id === d.templateId),
    ).map((i) => i.id),
  )
  const inputs = Object.fromEntries(
    Object.entries(d.inputs).filter(([k, v]) => asked.has(k) && (typeof v === 'boolean' || v.trim() !== '')),
  )
  return { ...d, inputs, botId: d.botId, attachmentIds }
}
