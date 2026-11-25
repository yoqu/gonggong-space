import type { ArtifactDto, WorkDto } from '@gonggong/protocol'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Button, Dialog, Presence, Select, toast } from '../../ui'
import { ArtifactTab } from '../artifacts/ArtifactTab'
import { ArtifactPage } from '../artifacts/host'
import { useArtifactManager } from '../artifacts/share'
import { hostArtifact, setArtifactVisibility, useArtifact } from '../artifacts/store'

/**
 * A work I may change, on its own page: the editor straight away, no group chat beside it. Discussion happens where it
 * is shared to (分享到群聊).
 */
export function WorkEditor({ work, onBack }: { work: WorkDto; onBack: () => void }) {
  const [sharing, setSharing] = useState(false)
  const a = useArtifact(work.id)?.artifact
  const page = useMemo(() => ({ leave: onBack }), [onBack])
  useEffect(() => hostArtifact(work.id), [work.id])
  return (
    <section className="works works--editor" aria-label={work.title}>
      <header className="works__head">
        <Button size="small" variant="plain" icon="chevron-left" aria-label={t('返回作品')} onClick={onBack}>
          {t('作品')}
        </Button>
        <div className="works__titles">
          <h1 className="works__title">{a?.title ?? work.title}</h1>
        </div>
        <span className="spacer" />
        <Button size="small" icon="message" disabled={!a} onClick={() => setSharing(true)}>
          {t('分享到群聊')}
        </Button>
      </header>
      <div className="works__editor">
        <ArtifactPage.Provider value={page}>
          <ArtifactTab
            tab={{ kind: 'artifact', artifactId: work.id, title: work.title }}
            tabKey={`work:${work.id}`}
            active
          />
        </ArtifactPage.Provider>
      </div>
      <Presence>
        {sharing && a ? <ShareToChatDialog artifact={a} onClose={() => setSharing(false)} /> : null}
      </Presence>
    </section>
  )
}

/** 分享到群聊: posts the work's card in a group I am in; other groups need it visible to the team first. */
function ShareToChatDialog({ artifact: a, onClose }: { artifact: ArtifactDto; onClose: () => void }) {
  const navigate = useNavigate()
  const groups = useWorkspace((s) => s.groups)
  const manager = useArtifactManager(a.groupId, a.botId, a.createdBy, a.canManage)
  const options = groups
    .filter((g) => g.id === a.groupId || g.kind === 'group')
    .sort((x, y) => Number(y.id === a.groupId) - Number(x.id === a.groupId))
    .map((g) => ({
      value: g.id,
      label: g.id === a.groupId ? t('{group}（作品所在群）', { group: g.name }) : g.name,
    }))
  const [target, setTarget] = useState<string | null>(options[0]?.value ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const widen = !!target && target !== a.groupId && a.visibility !== 'team'
  const share = async () => {
    if (!target) return
    setBusy(true)
    try {
      if (widen) await setArtifactVisibility(a.id, 'team')
      await api.post(`/artifacts/${a.id}/post`, { groupId: target })
      toast({
        type: 'success',
        message: t('已分享到群聊'),
        action: { label: t('去群聊'), onClick: () => navigate(`/g/${target}`) },
      })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('分享「{title}」到群聊', { title: a.title })}
      message={t('群里会出现作品卡片，大家可以在群聊里讨论；编辑仍在作品页进行')}
      onClose={onClose}
      closeOnScrim={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('分享'),
          variant: 'primary',
          disabled: !target || busy || (widen && !manager),
          onClick: () => void share(),
        },
      ]}
    >
      <Select
        label={t('分享到')}
        options={options}
        value={target}
        onChange={setTarget}
        placeholder={t('选择群')}
      />
      {widen ? (
        <Alert
          variant={manager ? 'info' : 'warning'}
          description={
            manager
              ? t('分享到其他群会把作品设为「团队可见」，该群成员可以查看，进作品所在群后才能修改')
              : t('作品还不是团队可见，只有创建人、Bot 主人或群管理员能分享到其他群')
          }
        />
      ) : null}
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
