import type { GroupDto, SecretNeedDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Button, Presence } from '../../ui'
import { SecretLayerList } from './SecretLayer'
import { NeedsDialog } from './SecretNeeds'

/** 群设置 · 密钥: the group layer over the inherited team and platform secrets; members only read it. */
export function GroupSecrets({ group, editable }: { group: GroupDto; editable: boolean }) {
  const bots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const needs = useGet<SecretNeedDto[]>(`/groups/${group.id}/secret-needs`)
  const [open, setOpen] = useState(false)
  const reloadList = useState(0)
  return (
    <>
      <div className="gs-note">
        {editable
          ? t('只对本群生效；与团队层、平台层同名时以群层为准。Bot 运行时以同名环境变量注入。')
          : t('仅群管理员可修改')}
      </div>
      {needs.data?.length ? (
        // Always here, so a snoozed banner is no dead end (plan Skill密钥声明 §6).
        <div className="gs-note">
          {t('本群的 Skill 声明了 {n} 个密钥', { n: new Set(needs.data.map((n) => n.spec.name)).size })}{' '}
          <Button size="small" onClick={() => setOpen(true)}>
            {t('配置密钥')}
          </Button>
        </div>
      ) : null}
      <SecretLayerList
        key={reloadList[0]}
        base={`/groups/${group.id}/secrets`}
        scope="group"
        bots={bots}
        editable={editable}
      />
      <Presence>
        {open && needs.data ? (
          <NeedsDialog
            groupId={group.id}
            needs={needs.data}
            onClose={() => setOpen(false)}
            onDone={() => {
              setOpen(false)
              needs.reload()
              reloadList[1]((n) => n + 1)
            }}
          />
        ) : null}
      </Presence>
    </>
  )
}
