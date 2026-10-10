import {
  SKILL_PLUGIN,
  type SkillDetailDto,
  type SkillDto,
  type SkillFile,
  type SkillVersionDetailDto,
  type SkillVersionDto,
} from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
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
} from '../../ui'
import { folderSkillFiles, zipSkillFiles } from './skillFiles'

const TEMPLATE = `---
name: my-skill
description: ${t('说明这个 skill 做什么、什么时候使用')}
---

`

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

type Dialogs =
  | { kind: 'edit'; skill: SkillDto | null }
  | { kind: 'history'; skill: SkillDto }
  | { kind: 'delete'; skill: SkillDto }

/** One layer's skills under `base` (`/admin/skills`, `/teams/:id/skills`, `/groups/:id/skills`); every change saves at once. */
export function SkillLayerList({ base, tag }: { base: string; tag: string }) {
  const { data, error, reload } = useGet<SkillDto[]>(base)
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
        <Alert variant="error" title={t('配置加载失败')} description={error}>
          <div className="cfg__retry">
            <Button size="small" onClick={reload}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
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
        <span className="cfg__hint">{t('与仓库自带的同名 skill 冲突时跳过团队版，运行卡片会提示。')}</span>
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
            consequences={[t('相关 Bot 下一轮起不再加载这个 skill')]}
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

/** `webkitdirectory` is not in React's input attributes. */
function FolderInput({ onFiles }: { onFiles: (files: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.setAttribute('webkitdirectory', ''), [])
  return (
    <input
      ref={ref}
      type="file"
      hidden
      aria-label={t('导入文件夹')}
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
  const folder = useRef<HTMLDivElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (detail.data && !files) setFiles(detail.data.files)
  }, [detail.data, files])

  const replace = async (load: Promise<SkillFile[]>) => {
    try {
      const next = await load
      if (!next.length) return setError(t('没有读到文件'))
      setFiles(next)
      setCurrent(next.some((f) => f.path === 'SKILL.md') ? 'SKILL.md' : next[0]!.path)
      setError('')
    } catch (e) {
      setError(t('无法读取：{e}', { e: errorText(e) }))
    }
  }
  const selected = files?.find((f) => f.path === current)
  const edit = (content: string) =>
    setFiles((fs) => fs?.map((f) => (f.path === current ? { ...f, content } : f)) ?? null)
  const addFile = () => {
    const path = newPath.trim()
    if (!path || !files) return
    if (files.some((f) => f.path === path)) return setError(t('文件已存在：{path}', { path }))
    setFiles(
      [...files, { path, content: '', encoding: 'utf8' as const }].sort((a, b) => (a.path < b.path ? -1 : 1)),
    )
    setCurrent(path)
    setNewPath('')
    setError('')
  }
  const removeFile = (path: string) => {
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
    <Dialog
      open
      title={skill ? t('编辑 Skill {name}', { name: skill.name }) : t('添加 Skill')}
      message={t('名称与描述取自 SKILL.md 开头的 frontmatter；每次保存生成一个新版本。')}
      width={760}
      onClose={onClose}
      closeOnBackdrop={false}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('保存'), variant: 'primary', onClick: () => void save(), disabled: !files || busy },
      ]}
    >
      <div className="skill-ed__bar" ref={folder}>
        <Button size="small" onClick={() => folder.current?.querySelector('input')?.click()}>
          {t('导入文件夹…')}
        </Button>
        <FolderInput onFiles={(fs) => void replace(folderSkillFiles(fs))} />
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
      <div className="skill-ed">
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
            <EmptyState icon="doc" title={t('二进制文件')} description={t('只能整体替换，不能在线编辑。')} />
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
  const view = useGet<SkillVersionDetailDto>(viewing ? `${url}/${viewing}` : null)
  const [error, setError] = useState('')

  const rollback = async (v: SkillVersionDto) => {
    try {
      await api.post(`${base}/${skill.id}/rollback`, { versionId: v.id })
      toast({ type: 'success', message: t('已回滚到 v{n}，相关 Bot 下一轮生效', { n: v.version }) })
      versions.reload()
      onChanged()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const main = view.data?.files.find((f) => f.path === 'SKILL.md')

  return (
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
              <Button size="small" disabled={v.current} onClick={() => void rollback(v)}>
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
  )
}
