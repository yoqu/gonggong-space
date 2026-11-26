import {
  type InheritedSkillDto,
  SKILL_PLUGIN,
  type SkillDetailDto,
  type SkillDto,
  type SkillFile,
  type SkillVersionDetailDto,
  type SkillVersionDto,
} from '@gonggong/protocol'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  AlertDialog,
  Button,
  ConfirmActionDialog,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  IconButton,
  Presence,
  Switch,
  Tag,
  Textarea,
  TextField,
  toast,
  useDiscardGuard,
} from '../../ui'
import { InheritedList } from './InheritedList'
import { folderSkillFiles, zipSkillFiles } from './skillFiles'

const TEMPLATE = `---
name: my-skill
description: ${t('说明这个 Skill 做什么、什么时候使用')}
---

`

export const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

type Dialogs =
  | { kind: 'edit'; skill: SkillDto | null }
  | { kind: 'history'; skill: SkillDto }
  | { kind: 'delete'; skill: SkillDto }

/** One layer's skills under `base`, read-only: what a plain team member sees of the team layer. */
export function SkillLayerView({ base }: { base: string }) {
  const { data, error } = useGet<SkillDto[]>(base)
  if (error) return <Alert variant="error" title={t('配置加载失败')} description={error} />
  if (!data?.length) return null
  return (
    <GroupBox>
      {data.map((s) => (
        <GroupRow
          key={s.id}
          className="cfg__item"
          label={
            <span className="cfg__name-line">
              <span className="cfg__name">{s.name}</span>
              <Tag tone="gray">{`v${s.version}`}</Tag>
            </span>
          }
          description={s.description}
          value={s.enabled ? t('已开启') : t('已关闭#off')}
        />
      ))}
    </GroupBox>
  )
}

/** One layer's skills under `base` (`/admin/skills`, `/teams/:id/skills`, `/groups/:id/skills`); every change saves at once. */
export function SkillLayerList({ base, tag }: { base: string; tag: string }) {
  const { data, error, loading, reload } = useGet<SkillDto[]>(base)
  const [open, setOpen] = useState<Dialogs | null>(null)
  const close = () => setOpen(null)
  const done = () => {
    close()
    reload()
  }

  const toggle = async (s: SkillDto, enabled: boolean) => {
    try {
      await api.patch(`${base}/${s.id}`, { enabled })
    } catch (e) {
      toast({ type: 'error', title: t('保存失败'), message: errorText(e) })
    }
    reload()
  }

  return (
    <>
      {error ? (
        <Alert
          variant="error"
          title={t('配置加载失败')}
          description={error}
          retrying={loading}
          onRetry={reload}
        />
      ) : null}
      {data?.length === 0 ? (
        <EmptyState
          icon="star"
          title={t('还没有 Skill')}
          description={t('上传 SKILL.md 所在的文件夹或 zip，保存后相关 Bot 下一轮即可使用。')}
        />
      ) : (
        <GroupBox>
          {data?.map((s) => (
            <GroupRow
              key={s.id}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{`/${SKILL_PLUGIN}:${s.name}`}</span>
                  <Tag tone="blue">{tag}</Tag>
                  <Tag tone="gray">{`v${s.version}`}</Tag>
                </span>
              }
              description={
                <>
                  {s.description}
                  <br />
                  {[s.updatedBy, ago(s.updatedAt), kb(s.size)].filter(Boolean).join(' · ')}
                </>
              }
            >
              <span className="cfg__controls">
                <IconButton
                  title={t('历史版本 {name}', { name: s.name })}
                  size="regular"
                  onClick={() => setOpen({ kind: 'history', skill: s })}
                >
                  {'clock' as const}
                </IconButton>
                <IconButton
                  title={t('编辑 {name}', { name: s.name })}
                  size="regular"
                  onClick={() => setOpen({ kind: 'edit', skill: s })}
                >
                  {'doc-text' as const}
                </IconButton>
                <IconButton
                  title={t('删除 {name}', { name: s.name })}
                  size="regular"
                  onClick={() => setOpen({ kind: 'delete', skill: s })}
                >
                  {'trash' as const}
                </IconButton>
                <Switch
                  ariaLabel={t('启用 {name}', { name: s.name })}
                  checked={s.enabled}
                  onChange={(on) => void toggle(s, on)}
                />
              </span>
            </GroupRow>
          ))}
        </GroupBox>
      )}
      <div className="cfg__foot">
        <span className="cfg__hint">{t('与仓库自带的同名 Skill 冲突时跳过团队版，运行卡片会提示。')}</span>
        <span className="spacer" />
        <Button disabled={!data} onClick={() => setOpen({ kind: 'edit', skill: null })}>
          {t('添加 Skill…')}
        </Button>
      </div>
      <Presence>
        {open?.kind === 'edit' ? (
          <SkillEditorDialog base={base} skill={open.skill} onClose={close} onSaved={done} />
        ) : open?.kind === 'history' ? (
          <SkillHistoryDialog base={base} skill={open.skill} onClose={close} onChanged={reload} />
        ) : open?.kind === 'delete' ? (
          <ConfirmActionDialog
            title={t('删除 Skill {name}？', { name: open.skill.name })}
            message={t('删除后历史版本一并移除，无法恢复。')}
            consequences={[t('相关 Bot 下一轮起不再加载这个 Skill')]}
            label={t('删除')}
            done={t('已删除 {name}', { name: open.skill.name })}
            run={() => api.del(`${base}/${open.skill.id}`)}
            onDone={done}
            onClose={close}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** Platform and team skills in effect for the group, each turned on or off for this group alone. */
export function InheritedSkillList({ groupId }: { groupId: string }) {
  return (
    <InheritedList<InheritedSkillDto>
      base={`/groups/${groupId}/inherited-skills`}
      row={(s) => ({
        name: s.name,
        label: `/${SKILL_PLUGIN}:${s.name}`,
        tags: [`v${s.version}`],
        description: s.description,
      })}
    />
  )
}

/** `webkitdirectory` is not in React's input attributes. */
export function FolderInput({
  inputRef,
  label = t('导入文件夹'),
  onFiles,
}: {
  inputRef?: RefObject<HTMLInputElement | null>
  label?: string
  onFiles: (files: File[]) => void
}) {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  useEffect(() => ref.current?.setAttribute('webkitdirectory', ''), [ref])
  return (
    <input
      ref={ref}
      type="file"
      hidden
      aria-label={label}
      onChange={(e) => {
        onFiles([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  )
}

function SkillEditorDialog({
  base,
  skill,
  onClose,
  onSaved,
}: {
  base: string
  skill: SkillDto | null
  onClose: () => void
  onSaved: () => void
}) {
  const detail = useGet<SkillDetailDto>(skill ? `${base}/${skill.id}` : null)
  const [files, setFiles] = useState<SkillFile[] | null>(
    skill ? null : [{ path: 'SKILL.md', content: TEMPLATE, encoding: 'utf8' }],
  )
  const [current, setCurrent] = useState('SKILL.md')
  const [newPath, setNewPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Set by every edit, so no per-keystroke diff of whole skills.
  const [dirty, setDirty] = useState(false)
  const folder = useRef<HTMLInputElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (detail.data && !files) setFiles(detail.data.files)
  }, [detail.data, files])

  const replace = async (load: Promise<SkillFile[]>) => {
    try {
      const next = await load
      if (!next.length) return setError(t('没有读到文件'))
      setFiles(next)
      setDirty(true)
      setCurrent(next.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : next[0]!.path)
      setError('')
    } catch (e) {
      setError(t('无法读取：{e}', { e: errorText(e) }))
    }
  }
  const guard = useDiscardGuard(dirty, onClose)
  const close = busy ? () => {} : guard.requestClose
  const selected = files?.find((f) => f.path === current)
  const edit = (content: string) => {
    setDirty(true)
    setFiles((fs) => fs?.map((f) => (f.path === current ? { ...f, content } : f)) ?? null)
  }
  const addFile = () => {
    const path = newPath.trim()
    if (!path || !files) return
    if (files.some((f) => f.path === path)) return setError(t('文件已存在：{path}', { path }))
    setFiles(
      [...files, { path, content: '', encoding: 'utf8' as const }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    )
    setDirty(true)
    setCurrent(path)
    setNewPath('')
    setError('')
  }
  const removeFile = (path: string) => {
    setDirty(true)
    setFiles((fs) => fs?.filter((f) => f.path !== path) ?? null)
    if (path === current) setCurrent('SKILL.md')
  }
  const save = async () => {
    if (!files) return
    setBusy(true)
    try {
      if (skill) await api.patch(`${base}/${skill.id}`, { files })
      else await api.post(base, { enabled: true, files })
      toast({ type: 'success', message: t('已保存，相关 Bot 下一轮生效') })
      onSaved()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog
        open
        title={skill ? t('编辑 Skill {name}', { name: skill.name }) : t('添加 Skill')}
        message={t('名称与描述取自 SKILL.md 顶部的 name / description 字段；每次保存生成一个新版本。')}
        width={760}
        onClose={close}
        closeOnBackdrop={false}
        actions={[
          { label: t('取消'), onClick: close, disabled: busy },
          {
            label: t('保存'),
            variant: 'primary',
            onClick: () => void save(),
            disabled: !files,
            loading: busy,
          },
        ]}
      >
        <div className="skill-ed__bar" inert={busy}>
          <Button size="small" onClick={() => folder.current?.click()}>
            {t('导入文件夹…')}
          </Button>
          <FolderInput inputRef={folder} onFiles={(fs) => void replace(folderSkillFiles(fs))} />
          <Button size="small" onClick={() => zip.current?.click()}>
            {t('导入 zip…')}
          </Button>
          <input
            ref={zip}
            type="file"
            accept=".zip,application/zip"
            hidden
            aria-label={t('导入 zip')}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void replace(zipSkillFiles(f))
              e.target.value = ''
            }}
          />
        </div>
        {error ? <Alert variant="error" title={error} /> : null}
        {detail.error ? <Alert variant="error" title={t('配置加载失败')} description={detail.error} /> : null}
        <div className="skill-ed" inert={busy}>
          <div className="skill-ed__files" role="listbox" aria-label={t('文件')}>
            {files?.map((f) => (
              <div key={f.path} className="skill-ed__file">
                <button
                  type="button"
                  role="option"
                  aria-selected={f.path === current}
                  className="skill-ed__path"
                  onClick={() => setCurrent(f.path)}
                >
                  {f.path}
                </button>
                {f.path === 'SKILL.md' ? null : (
                  <IconButton title={t('删除 {name}', { name: f.path })} onClick={() => removeFile(f.path)}>
                    {'xmark' as const}
                  </IconButton>
                )}
              </div>
            ))}
            <TextField
              aria-label={t('新文件路径')}
              mono
              value={newPath}
              placeholder="scripts/run.sh"
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFile()
              }}
            />
          </div>
          <div className="skill-ed__body">
            {selected?.encoding === 'base64' ? (
              <EmptyState
                icon="doc"
                title={t('二进制文件')}
                description={t('只能整体替换，不能在线编辑。')}
              />
            ) : selected ? (
              <Textarea
                className="ui-input--mono skill-ed__text"
                aria-label={selected.path}
                rows={18}
                value={selected.content}
                onChange={(e) => edit(e.target.value)}
              />
            ) : null}
          </div>
        </div>
      </Dialog>
      {guard.dialog}
    </>
  )
}

function SkillHistoryDialog({
  base,
  skill,
  onClose,
  onChanged,
}: {
  base: string
  skill: SkillDto
  onClose: () => void
  onChanged: () => void
}) {
  const url = `${base}/${skill.id}/versions`
  const versions = useGet<SkillVersionDto[]>(url)
  const [viewing, setViewing] = useState<string | null>(null)
  const activeId = viewing ?? versions.data?.find((v) => v.current)?.id ?? versions.data?.[0]?.id ?? null
  const view = useGet<SkillVersionDetailDto>(activeId ? `${url}/${activeId}` : null)
  const [confirming, setConfirming] = useState<SkillVersionDto | null>(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState('')

  const confirmRollback = async () => {
    if (!confirming || rolling) return
    setRolling(true)
    setError('')
    try {
      await api.post(`${base}/${skill.id}/rollback`, { versionId: confirming.id })
      toast({ type: 'success', message: t('已回滚到 v{n}，相关 Bot 下一轮生效', { n: confirming.version }) })
      setConfirming(null)
      setViewing(null)
      versions.reload()
      onChanged()
    } catch (e) {
      setError(errorText(e))
      setConfirming(null)
    } finally {
      setRolling(false)
    }
  }
  const main = view.data?.files.find((f) => f.path === 'SKILL.md')

  return (
    <>
      <Dialog
        open
        title={t('{name} 的历史版本', { name: skill.name })}
        width={620}
        onClose={onClose}
        actions={[{ label: t('完成'), variant: 'primary', onClick: onClose }]}
      >
        {error || versions.error ? <Alert variant="error" title={error || versions.error} /> : null}
        <GroupBox>
          {versions.data?.map((v) => (
            <GroupRow
              key={v.id}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{`v${v.version}`}</span>
                  {v.current ? <Tag tone="green">{t('当前')}</Tag> : null}
                </span>
              }
              description={[v.createdBy, ago(v.createdAt), kb(v.size)].filter(Boolean).join(' · ')}
            >
              <span className="cfg__controls">
                <Button size="small" onClick={() => setViewing(v.id)}>
                  {t('查看')}
                </Button>
                <Button size="small" disabled={v.current || rolling} onClick={() => setConfirming(v)}>
                  {t('回滚到此版本')}
                </Button>
              </span>
            </GroupRow>
          ))}
        </GroupBox>
        {view.data ? (
          <div className="skill-ed__view">
            <div className="cfg__eyebrow">
              {t('v{n} · {count} 个文件', { n: view.data.version, count: view.data.files.length })}
            </div>
            <pre className="skill-ed__pre">{main?.content}</pre>
          </div>
        ) : null}
      </Dialog>
      <Presence>
        {confirming ? (
          <AlertDialog
            open
            title={t('要回滚到版本 v{version} 吗？', { version: confirming.version })}
            message={t('当前内容会被替换为此版本。现有版本仍会保留在历史记录中，可随时切回。')}
            onClose={() => {
              if (!rolling) setConfirming(null)
            }}
            actions={[
              { label: t('取消'), disabled: rolling, onClick: () => setConfirming(null) },
              {
                label: t('回滚到此版本'),
                variant: 'destructive',
                disabled: rolling,
                loading: rolling,
                onClick: () => void confirmRollback(),
              },
            ]}
          />
        ) : null}
      </Presence>
    </>
  )
}
