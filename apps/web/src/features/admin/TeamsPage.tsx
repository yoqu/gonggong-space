import type { AdminTeamDto, AdminUserDto } from '@gonggong/protocol'
import { useId, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { matchAny } from '../../lib/match'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  NoResultsArt,
  PopUpButton,
  Presence,
  SearchField,
  Spinner,
  Table,
  Tag,
  TextField,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'
import { TeamAvatar } from '../teams/TeamAvatar'
import { AdminPage, countLine } from './AdminPage'

const day = (iso: string) => new Date(iso).toLocaleDateString()

/** 管理后台 · 团队 (plan §5): create a team for an owner, archive / restore, reassign the owner. */
export function TeamsPage() {
  const { data: teams, error, loading, reload } = useGet<AdminTeamDto[]>('/admin/teams')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'owner'; team: AdminTeamDto } | null>(null)
  const [archiving, setArchiving] = useState<AdminTeamDto | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const restore = async (team: AdminTeamDto) => {
    if (restoringId) return
    setRestoringId(team.id)
    try {
      await api.post(`/admin/teams/${team.id}/unarchive`)
      toast({ type: 'success', message: t('已恢复团队') })
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setRestoringId(null)
    }
  }
  const shown = teams?.filter((x) => matchAny(query, x.name, x.ownerName))

  return (
    <AdminPage
      title={t('团队#nav')}
      desc={t('全部团队的所有者、成员数与状态；团队内的成员、邀请与配置由团队管理员在团队设置中管理。')}
      subtitle={
        teams ? countLine(t('{n} 个团队', { n: teams.length }), shown?.length, teams.length) : undefined
      }
      actions={
        <ToolbarGroup>
          <ToolbarButton
            icon="plus"
            label={t('新建团队…')}
            text={t('新建团队…')}
            onClick={() => setDialog({ kind: 'new' })}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder={t('搜索团队或所有者')} value={query} onChange={setQuery} />}
    >
      {error ? (
        <Alert variant="error" description={error}>
          <div style={{ marginTop: 'var(--space-8)' }}>
            <Button size="small" loading={loading} onClick={reload}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      ) : null}
      {shown ? (
        <Table<AdminTeamDto>
          aria-label={t('团队列表')}
          className="admin-grid"
          rows={shown}
          multiple={false}
          defaultSort={{ key: 'createdAt', dir: 'asc' }}
          rowActions={(x) => [
            { label: t('指定所有者…'), value: 'owner' },
            { separator: true as const },
            x.archivedAt
              ? { label: t('恢复团队'), value: 'restore', disabled: restoringId === x.id }
              : { label: t('归档团队'), value: 'archive', destructive: true },
          ]}
          onRowAction={(action, x) => {
            if (action === 'owner') setDialog({ kind: 'owner', team: x })
            else if (action === 'restore') void restore(x)
            else setArchiving(x)
          }}
          emptyText={<EmptyState compact title={t('没有匹配的团队')} illustration={<NoResultsArt />} />}
          columns={[
            {
              key: 'name',
              title: t('团队'),
              sortable: true,
              render: (x) => (
                <>
                  <TeamAvatar team={x} size={18} />
                  <span title={x.name}>{x.name}</span>
                </>
              ),
            },
            {
              key: 'ownerName',
              title: t('所有者'),
              width: 120,
              sortable: true,
              render: (x) => x.ownerName ?? '--',
            },
            { key: 'members', title: t('成员'), width: 72, align: 'right', sortable: true },
            {
              key: 'createdAt',
              title: t('创建时间'),
              width: 120,
              secondary: true,
              sortable: true,
              render: (x) => day(x.createdAt),
            },
            {
              key: 'archivedAt',
              title: t('状态'),
              width: 96,
              sortable: true,
              sortValue: (x) => (x.archivedAt ? 1 : 0),
              render: (x) => (x.archivedAt ? <Tag tone="gray">{t('已归档')}</Tag> : t('正常')),
            },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
      <Presence>
        {archiving ? (
          <ConfirmActionDialog
            title={t('要归档团队「{name}」吗？', { name: archiving.name })}
            message={t('归档后可以随时在这里恢复。')}
            consequences={[
              t('成员将无法进入该团队及其群聊，群消息转为只读'),
              t('该团队的 Bot 暂停运行；消息与审计记录保留'),
            ]}
            label={t('归档团队')}
            done={t('团队已归档')}
            run={() => api.post(`/admin/teams/${archiving.id}/archive`)}
            onDone={() => {
              setArchiving(null)
              reload()
            }}
            onClose={() => setArchiving(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {dialog ? (
          <TeamDialog
            team={dialog.kind === 'owner' ? dialog.team : null}
            onClose={() => setDialog(null)}
            onDone={() => {
              setDialog(null)
              reload()
            }}
          />
        ) : null}
      </Presence>
    </AdminPage>
  )
}

/** New team (team = null: name + owner) or another owner for `team`. */
function TeamDialog({
  team,
  onClose,
  onDone,
}: {
  team: AdminTeamDto | null
  onClose: () => void
  onDone: () => void
}) {
  const usersQ = useGet<AdminUserDto[]>('/admin/users')
  const users = (usersQ.data ?? []).filter((u) => !u.disabled)
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()
  const close = () => {
    if (!busy) onClose()
  }

  const submit = async () => {
    if (busy || !ownerId || (!team && !name.trim())) return
    setBusy(true)
    try {
      if (team) await api.put(`/admin/teams/${team.id}/owner`, { userId: ownerId })
      else await api.post('/admin/teams', { name: name.trim(), ownerId })
      toast({ type: 'success', message: team ? t('已指定所有者') : t('团队已创建') })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={team ? t('指定「{name}」的所有者', { name: team.name }) : t('新建团队')}
      message={team ? t('对方成为所有者（未加入则自动加入）；原所有者改为管理员。') : undefined}
      width={460}
      onClose={close}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: team ? t('保存') : t('创建'),
          variant: 'primary',
          type: 'submit',
          form: formId,
          disabled: busy || !ownerId || (!team && !name.trim()),
          loading: busy,
        },
      ]}
    >
      <Form id={formId} onSubmit={() => void submit()}>
        {team ? null : (
          <FormRow label={t('团队名称')}>
            <TextField
              aria-label={t('团队名称')}
              value={name}
              maxLength={40}
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </FormRow>
        )}
        <FormRow label={t('所有者')}>
          {usersQ.error && !usersQ.data ? (
            <Alert variant="error" title={t('加载账号列表失败')} description={usersQ.error}>
              <div style={{ marginTop: 'var(--space-8)' }}>
                <Button size="small" loading={usersQ.loading} onClick={usersQ.reload}>
                  {t('重试')}
                </Button>
              </div>
            </Alert>
          ) : !usersQ.data ? (
            <Spinner />
          ) : (
            <PopUpButton
              aria-label={t('所有者')}
              value={ownerId}
              placeholder={t('选择账号')}
              options={users.map((u) => ({ value: u.id, label: `${u.name} · ${u.account}` }))}
              onChange={setOwnerId}
            />
          )}
        </FormRow>
      </Form>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
