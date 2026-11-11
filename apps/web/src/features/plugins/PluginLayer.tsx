import type { GroupDto, GroupPluginDto, PluginDto, SkillFile } from '@gonggong/protocol'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt, toastError } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  EmptyState,
  GroupBox,
  GroupRow,
  IconButton,
  Presence,
  Switch,
  Tag,
  toast,
} from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { AGENT_LABEL } from '../bots/model'
import { folderSkillFiles, zipSkillFiles } from '../config/skillFiles'
import {
  agentsText,
  BLOCKER_TAG,
  blockerText,
  LAYER_LABEL,
  mcpNames,
  permissionsText,
  secretsText,
  sourceText,
} from './model'
import { PluginTile, pluginIcon } from './PluginTile'
import { loadPlugins, togglePlugin, useGroupPlugins } from './store'
import '../config/config.css'
import './plugins.css'

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

/** A plugin's manifest at a glance: title, name and version, layer, agents, secrets, license and source. */
function PluginInfo({ p, extra }: { p: PluginDto; extra?: ReactNode }) {
  const m = p.manifest
  return (
    <div className="plg-row">
      <PluginTile m={m} src={pluginIcon(p)} />
      <div className="plg-row__text">
        <div className="plg-row__title">
          <b>{m.title}</b>
          <span className="plg-row__id">{`${m.name} ${m.version}`}</span>
          <Tag tone={p.layer === 'group' ? 'blue' : 'gray'}>{LAYER_LABEL[p.layer]}</Tag>
          {p.builtin ? <Tag tone="gray">{t('内置')}</Tag> : null}
        </div>
        <div className="plg-row__desc">
          {[
            t('支持：{agents}', { agents: agentsText(m) }),
            t('需要密钥：{names}', { names: secretsText(m) }),
            t('最低机器版本 {v}', { v: m.minDaemon }),
          ].join(' · ')}
          {extra}
        </div>
        {m.permissions.length || m.contributes.mcp.length ? (
          <div className="plg-row__desc">
            {[
              t('权限：{list}', { list: permissionsText(m) }),
              t('MCP 服务：{names}', { names: mcpNames(m).join(t('、')) }),
            ].join(' · ')}
          </div>
        ) : null}
        <div className="plg-row__desc">{sourceText(m)}</div>
      </div>
    </div>
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
      aria-label={t('上传文件夹')}
      onChange={(e) => {
        onFiles([...(e.target.files ?? [])])
        e.target.value = ''
      }}
    />
  )
}

/** 上传文件夹… / 上传 zip…: a new plugin, or a new version of the layer's plugin of the same name. */
function PluginUpload({ base, onDone }: { base: string; onDone: () => void }) {
  const folder = useRef<HTMLSpanElement>(null)
  const zip = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const upload = async (read: Promise<SkillFile[]>) => {
    setBusy(true)
    try {
      const files = await read
      if (!files.length) throw new Error(t('没有读到文件'))
      const p = await api.post<PluginDto>(base, { files })
      toast({
        type: 'success',
        message: t('已上传 {title} {version}，下一轮任务生效', {
          title: p.manifest.title,
          version: p.manifest.version,
        }),
      })
      onDone()
    } catch (e) {
      toastError(e, t('上传失败'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="plg-upload" ref={folder}>
      <Button disabled={busy} onClick={() => folder.current?.querySelector('input')?.click()}>
        {t('上传文件夹…')}
      </Button>
      <FolderInput onFiles={(fs) => void upload(folderSkillFiles(fs))} />
      <Button disabled={busy} onClick={() => zip.current?.click()}>
        {t('上传 zip…')}
      </Button>
      <input
        ref={zip}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label={t('上传 zip')}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(zipSkillFiles(f))
          e.target.value = ''
        }}
      />
    </span>
  )
}

function DeletePlugin({ base, p, onDone }: { base: string; p: PluginDto; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton
        title={t('删除 {name}', { name: p.manifest.title })}
        size="regular"
        onClick={() => setOpen(true)}
      >
        {'trash' as const}
      </IconButton>
      <Presence>
        {open ? (
          <ConfirmActionDialog
            title={t('删除插件 {name}？', { name: p.manifest.title })}
            message={t('删除后历史版本一并移除，无法恢复。')}
            consequences={[t('用到它的群下一轮起不再加载这个插件')]}
            label={t('删除')}
            done={t('已删除 {name}', { name: p.manifest.title })}
            run={() => api.del(`${base}/${p.id}`)}
            onDone={() => {
              setOpen(false)
              onDone()
            }}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Presence>
    </>
  )
}

const UPLOAD_HINT = t('上传含 gonggong-plugin.json 的文件夹或 zip；同名插件再次上传即生成新版本。')

/** One layer's plugins under `base` (`/admin/plugins`, `/teams/:id/plugins`): upload and delete. */
export function PluginLayerList({ base }: { base: string }) {
  const { data, error, reload } = useGet<PluginDto[]>(base)
  return (
    <>
      {error ? <Alert variant="error" title={t('配置加载失败')} description={error} /> : null}
      {data?.length === 0 ? (
        <EmptyState icon="apps" title={t('还没有插件')} description={UPLOAD_HINT} />
      ) : (
        <GroupBox>
          {data?.map((p) => (
            <GroupRow
              key={p.id}
              className="cfg__item"
              label={<PluginInfo p={p} />}
              description={[p.updatedBy, ago(p.updatedAt), kb(p.size)].filter(Boolean).join(' · ')}
            >
              {p.builtin ? null : <DeletePlugin base={base} p={p} onDone={reload} />}
            </GroupRow>
          ))}
        </GroupBox>
      )}
      <div className="cfg__foot">
        {data?.length ? <span className="cfg__hint">{UPLOAD_HINT}</span> : null}
        <span className="spacer" />
        <PluginUpload base={base} onDone={reload} />
      </div>
    </>
  )
}

/** What a bot can do with the group's enabled plugins: how many it can use, or why none. */
function botAvailability(plugins: GroupPluginDto[], botId: string, botName: string) {
  const states = plugins.map((p) => ({ p, blocker: p.bots.find((b) => b.botId === botId)?.blocker ?? null }))
  const usable = states.filter((s) => !s.blocker).length
  if (usable)
    return { text: t('可使用 {n} 个插件', { n: usable }), tag: { label: t('可用'), tone: 'green' as const } }
  const first = states.find((s) => s.blocker)
  if (!first?.blocker) return null
  return { text: blockerText(first.blocker, first.p.manifest, botName), tag: BLOCKER_TAG[first.blocker] }
}

/** 群设置 · 插件 (prototype #manage): the group's switch per plugin, its own layer, and each bot's availability. */
export function GroupPluginsTab({ group, readOnly = false }: { group: GroupDto; readOnly?: boolean }) {
  const list = useGroupPlugins(group.id)
  const bots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const base = `/groups/${group.id}/plugins`
  const reload = () => loadPlugins(group.id)
  const enabled = list?.filter((p) => p.enabledInGroup) ?? []
  const nameOf = (botId: string) => bots.find((b) => b.id === botId)?.name ?? 'Bot'
  return (
    <>
      <h3 className="plg-heading">{t('本群插件')}</h3>
      <div className="gs-note">
        {t('启用后群成员可以在「创作」和 / 候选里使用。下一轮任务生效，不打断正在运行的任务。')}
      </div>
      <GroupBox>
        {list?.map((p) => {
          const unsupported = p.bots.filter((b) => b.blocker === 'agent')
          return (
            <GroupRow
              key={p.id}
              className="cfg__item"
              label={
                <PluginInfo
                  p={p}
                  extra={unsupported.map((b) => (
                    <span key={b.botId} className="plg-warn">
                      {` · ⚠ ${blockerText('agent', p.manifest, nameOf(b.botId))}`}
                    </span>
                  ))}
                />
              }
            >
              <span className="cfg__controls">
                {p.layer === 'group' && !readOnly ? <DeletePlugin base={base} p={p} onDone={reload} /> : null}
                <Switch
                  disabled={readOnly}
                  ariaLabel={t('在本群启用 {name}', { name: p.manifest.title })}
                  checked={p.enabledInGroup}
                  onChange={(on) => void attempt(() => togglePlugin(group.id, p.id, on))}
                />
              </span>
            </GroupRow>
          )
        })}
      </GroupBox>
      <div className="cfg__foot">
        <span className="cfg__hint">
          {t('上传到本群的插件只对本群生效；与团队层、平台层同名时以群层为准。')}
        </span>
        <span className="spacer" />
        {readOnly ? null : <PluginUpload base={base} onDone={reload} />}
      </div>
      {enabled.length && bots.length ? (
        <fieldset aria-label={t('Bot 可用性')} className="plg-section">
          <h3 className="plg-heading">{t('Bot 可用性')}</h3>
          <div className="gs-note">
            {t(
              '插件下发前会检查每个 Bot 的机器版本和 Agent 种类，不满足的不下发，并在这里和创作面板里写明原因。',
            )}
          </div>
          <GroupBox>
            {bots.map((b) => {
              const a = botAvailability(enabled, b.id, b.name)
              return (
                <GroupRow
                  key={b.id}
                  className="cfg__item"
                  label={
                    <span className="plg-bot">
                      <BotAvatar id={b.id} name={b.name} size={24} />
                      <b>{b.name}</b>
                      <Tag tone="gray">{AGENT_LABEL[b.agentKind]}</Tag>
                    </span>
                  }
                  description={a?.text}
                >
                  {a ? <Tag tone={a.tag.tone}>{a.tag.label}</Tag> : null}
                </GroupRow>
              )
            })}
          </GroupBox>
        </fieldset>
      ) : null}
    </>
  )
}
