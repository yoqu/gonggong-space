import type { ArtifactEditOp } from '@gonggong/protocol'
import { t } from '../../i18n'
import { LINK_PREFIX, REF_PREFIX } from './geometry'

const kindOf = (id: string) =>
  id.startsWith(REF_PREFIX) ? 'ref' : id.startsWith(LINK_PREFIX) ? 'link' : 'screen'

/** Deleting the selected nodes (screens, references, links): what the confirmation says, and the ops of it. */
export function removal(ids: string[]) {
  const kinds = new Set(ids.map(kindOf))
  const only = kinds.size === 1 ? kindOf(ids[0] as string) : null
  const n = ids.length
  return {
    title:
      only === 'ref'
        ? t('删除 {n} 个参考文件？', { n })
        : only === 'link'
          ? t('删除 {n} 个链接？', { n })
          : only === 'screen'
            ? t('删除 {n} 个屏幕？', { n })
            : t('删除所选的 {n} 项？', { n }),
    consequence: kinds.has('screen')
      ? t('屏幕从产物中移除，生成一个新版本')
      : only === 'link'
        ? t('链接从画布移除，生成一个新版本')
        : t('参考文件从画布移除，生成一个新版本'),
    ops: ids.map((id): ArtifactEditOp => {
      const kind = kindOf(id)
      if (kind === 'ref') return { kind: 'ref-delete', id: id.slice(REF_PREFIX.length) }
      if (kind === 'link') return { kind: 'link-delete', id: id.slice(LINK_PREFIX.length) }
      return { kind: 'manifest', op: 'delete', screenId: id }
    }),
  }
}
