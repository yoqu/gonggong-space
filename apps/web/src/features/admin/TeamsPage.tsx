import type { AdminTeamDto, AdminUserDto } from '@gonggong/protocol'
import { useId, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Avatar,
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
import { AdminPage } from './AdminPage'

const day = (iso: string) => new Date(iso).toLocaleDateString()

/** 管理后台 · 团队 (plan §5): create a team for an owner, archive / restore, reassign the owner. */
export function TeamsPage() {
  const { data: teams, error, reload } = useGet<AdminTeamDto[]>('/admin/teams')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'owner'; team: AdminTeamDto } | null>(null)

  const archive = async (team: AdminTeamDto, restore: boolean) => {
    try {
      await api.post(`/admin/teams/${team.id}/${restore ? 'unarchive' : 'archive'}`)
      toast({ type: 'success', message: restore ? t('已恢复团队') : t('团队已归档') })
      reload()
    } catch (e) {
      toastError(e)
    }
  }
  const q = query.trim().toLowerCase()
  const shown = teams?.filter((x) => !q || `${x.name} ${x.ownerName ?? ''}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title={t('团队#nav')}
      desc={t('全部团队的所有者、成员数与状态；团队内的成员、邀请与配置由团队管理员在团队设置中管理。')}
      subtitle={teams ? t('{n} 个团队', { n: teams.length }) : undefined}
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
      {error ? <Alert variant="error" description={error} /> : null}
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
              ? { label: t('恢复团队'), value: 'restore' }
              : { label: t('归档团队'), value: 'archive', destructive: true },
          ]}
          onRowAction={(action, x) => {
            if (action === 'owner') setDialog({ kind: 'owner', team: x })
            else void archive(x, action === 'restore')
          }}
          emptyText={<EmptyState compact title={t('没有匹配的团队')} illustration={<NoResultsArt />} />}
          columns={[
            {
              key: 'name',
              title: t('团队'),
              sortable: true,
              render: (x) => (
                <>
                  <Avatar name={x.avatar || x.name} shape="square" size={18} />
                  {x.name}
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
  const users = (useGet<AdminUserDto[]>('/admin/users').data ?? []).filter((u) => !u.disabled)
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const formId = useId()

  const submit = async () => {
    if (!ownerId || (!team && !name.trim())) return
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
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: team ? t('保存') : t('创建'),
          variant: 'primary',
          type: 'submit',
          form: formId,
          disabled: busy || !ownerId || (!team && !name.trim()),
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
          <PopUpButton
            aria-label={t('所有者')}
            value={ownerId}
            placeholder={t('选择账号')}
            options={users.map((u) => ({ value: u.id, label: `${u.name} · ${u.account}` }))}
            onChange={setOwnerId}
          />
        </FormRow>
      </Form>
      {error ? <Alert variant="error" description={error} /> : null}
    </Dialog>
  )
}
