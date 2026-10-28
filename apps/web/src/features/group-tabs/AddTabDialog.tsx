import {
  GROUP_TAB_TITLE_MAX,
  type GroupDto,
  type GroupTabDto,
  type GroupTabEntry,
  type GroupTabTargetReq,
} from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Dialog, Form, FormRow, SegmentedControl, Select, Spinner, TextField } from '../../ui'
import { useKnowledge } from '../knowledge/api'
import { groupTabsApi } from './store'

type Kind = 'link' | 'knowledge' | 'file' | 'entry'
const KINDS: { value: Kind; label: string }[] = [
  { value: 'link', label: t('链接#tab') },
  { value: 'knowledge', label: t('知识库#kb') },
  { value: 'file', label: t('文件#tab') },
  { value: 'entry', label: t('入口#tab') },
]
const ENTRIES: { value: GroupTabEntry; label: string }[] = [
  { value: 'notice', label: t('群公告') },
  { value: 'pins', label: t('置顶消息') },
  { value: 'schedules', label: t('定时任务') },
  { value: 'git-log', label: t('Git 日志') },
]
const LINK = /^https?:\/\/\S+$/i
const FORM = 'add-group-tab'

/** ＋ of the tab bar: a link (its page title filled in, editable), a knowledge entry, a workspace file or an entry. */
export function AddTabDialog({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('link')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  // A title typed by hand is never replaced by the fetched one.
  const typed = useRef(false)
  const [fetching, setFetching] = useState(false)
  const [knowledgeId, setKnowledgeId] = useState<string | null>(null)
  const allBots = useWorkspace((s) => s.bots)
  const bots = group.botIds.flatMap((id) => allBots.filter((b) => b.id === id))
  const [botId, setBotId] = useState<string | null>(bots[0]?.id ?? null)
  const [path, setPath] = useState('')
  const [entry, setEntry] = useState<GroupTabEntry>('notice')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const kb = useKnowledge(group.id, '')

  const link = url.trim()
  useEffect(() => {
    if (kind !== 'link' || !LINK.test(link)) return
    let live = true
    setFetching(true)
    const timer = setTimeout(() => {
      groupTabsApi
        .linkMeta(link)
        .then((m) => {
          if (live && m.title && !typed.current) setTitle(m.title.slice(0, GROUP_TAB_TITLE_MAX))
        })
        .catch(() => {})
        .finally(() => live && setFetching(false))
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
      setFetching(false)
    }
  }, [kind, link])

  const target: GroupTabTargetReq | null =
    kind === 'link'
      ? LINK.test(link)
        ? { kind, url: link }
        : null
      : kind === 'knowledge'
        ? knowledgeId
          ? { kind, knowledgeId }
          : null
        : kind === 'file'
          ? botId && path.trim()
            ? { kind, botId, path: path.trim().replace(/^\.?\//, '') }
            : null
          : entry === 'git-log'
            ? botId
              ? { kind, entry, botId }
              : null
            : { kind, entry }

  const submit = async () => {
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      await groupTabsApi.create(group.id, { target, ...(title.trim() ? { title: title.trim() } : {}) })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const botPicker = (
    <FormRow label={t('Bot')}>
      <Select
        label={t('Bot')}
        options={bots.map((b) => ({ value: b.id, label: b.name }))}
        value={botId}
        onChange={setBotId}
        placeholder={bots.length ? t('请选择') : t('本群还没有 Bot')}
        disabled={!bots.length}
      />
    </FormRow>
  )

  return (
    <Dialog
      open
      width={480}
      title={t('添加标签')}
      message={t('标签显示在群顶部，所有成员都能看到和打开。')}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('添加'), variant: 'primary', type: 'submit', form: FORM, disabled: !target || busy },
      ]}
    >
      <SegmentedControl
        aria-label={t('标签类型')}
        items={KINDS}
        value={kind}
        onChange={(k) => {
          setKind(k)
          setError('')
        }}
      />
      <Form id={FORM} className="gtab-form" onSubmit={() => void submit()}>
        {kind === 'link' ? (
          <FormRow label={t('链接地址')}>
            <TextField
              autoFocus
              aria-label={t('链接地址')}
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              suffix={fetching ? <Spinner size={12} /> : undefined}
            />
          </FormRow>
        ) : kind === 'knowledge' ? (
          <FormRow label={t('知识库条目')}>
            <Select
              label={t('知识库条目')}
              options={(kb.data?.entries ?? []).map((e) => ({ value: e.id, label: e.title }))}
              value={knowledgeId}
              onChange={setKnowledgeId}
              placeholder={kb.data && !kb.data.entries.length ? t('知识库还没有条目') : t('请选择')}
              disabled={!kb.data?.entries.length}
            />
          </FormRow>
        ) : kind === 'file' ? (
          <>
            {botPicker}
            <FormRow label={t('文件路径')} hint={t('Bot 工作区内的相对路径，如 docs/需求.md')}>
              <TextField
                aria-label={t('文件路径')}
                placeholder="docs/README.md"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </FormRow>
          </>
        ) : (
          <>
            <FormRow label={t('入口')}>
              <Select label={t('入口')} options={ENTRIES} value={entry} onChange={setEntry} />
            </FormRow>
            {entry === 'git-log' ? botPicker : null}
          </>
        )}
        <FormRow label={t('标题')} hint={kind === 'link' ? t('留空时使用网页标题') : t('留空时使用默认名称')}>
          <TextField
            aria-label={t('标题')}
            maxLength={GROUP_TAB_TITLE_MAX}
            value={title}
            error={error || undefined}
            onChange={(e) => {
              typed.current = !!e.target.value
              setTitle(e.target.value)
            }}
          />
        </FormRow>
      </Form>
    </Dialog>
  )
}

export function RenameTabDialog({
  groupId,
  tab,
  onClose,
}: {
  groupId: string
  tab: GroupTabDto
  onClose: () => void
}) {
  const [title, setTitle] = useState(tab.title)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const form = 'rename-group-tab'
  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await groupTabsApi.rename(groupId, tab.id, title.trim())
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      width={400}
      title={t('重命名标签')}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', type: 'submit', form, disabled: !title.trim() || busy },
      ]}
    >
      <Form id={form} onSubmit={() => void submit()}>
        <FormRow label={t('标题')}>
          <TextField
            autoFocus
            aria-label={t('标题')}
            maxLength={GROUP_TAB_TITLE_MAX}
            value={title}
            error={error || undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormRow>
      </Form>
    </Dialog>
  )
}
