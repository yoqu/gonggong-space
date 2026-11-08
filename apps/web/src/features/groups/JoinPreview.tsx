import type { DirectoryGroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Avatar, Button, Icon, Textarea, toast } from '../../ui'
import { teamSectionsApi, useTeamSections } from './sections'
import './groups.css'

/** A group filed under a 团队分区 that I am not in: what it is, and 加入 (public) or 申请加入 (private). */
export function JoinPreview({ group: g }: { group: DirectoryGroupDto }) {
  const section = useTeamSections((s) => s.sections.find((x) => x.id === g.teamSectionId))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    if ((await attempt(fn)) && done) toast({ type: 'success', message: done })
    setBusy(false)
  }
  const pub = g.visibility === 'public'
  return (
    <div className="chat__placeholder">
      <section className="join-preview" aria-label={t('入群预览')}>
        <Avatar name={g.name} src={g.avatar ?? undefined} shape="square" size={64} />
        <h2 className="join-preview__name">{g.name}</h2>
        <div className="join-preview__meta">
          {[section?.name, pub ? t('公开') : t('私有'), t('{n} 人', { n: g.memberCount })]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {g.notice ? <p className="join-preview__notice">{g.notice}</p> : null}
        <div className="join-preview__meta">{t('群管理员：{names}', { names: g.admins.join(t('、')) })}</div>
        {pub ? (
          <Button variant="primary" loading={busy} onClick={() => void run(() => teamSectionsApi.join(g.id))}>
            {t('加入')}
          </Button>
        ) : g.requestId ? (
          <>
            <div className="join-preview__sent">
              <Icon name="clock" size={14} />
              {t('已申请，等待群管理员处理')}
            </div>
            <Button
              loading={busy}
              onClick={() => void run(() => teamSectionsApi.cancel(g.requestId as string), t('已撤回申请'))}
            >
              {t('撤回申请')}
            </Button>
          </>
        ) : (
          <>
            <Textarea
              aria-label={t('申请说明')}
              className="join-preview__note"
              rows={3}
              maxLength={200}
              placeholder={t('说明来意（选填），如：负责退款对账，需要跟进')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                void run(
                  () => teamSectionsApi.request(g.id, note.trim()),
                  t('已发送申请，群管理员同意后即可进入'),
                )
              }
            >
              {t('申请加入')}
            </Button>
          </>
        )}
      </section>
    </div>
  )
}
