import {
  AGENT_KINDS,
  AGENT_META,
  type AgentKind,
  canUse,
  type ProviderStoreView,
  type ProviderView,
} from '@gonggong/protocol'
import { useState } from 'react'
import { locale, t } from '../../i18n'
import { toastError } from '../../lib/errors'
import { AlertDialog, Button, GroupBox, Presence, Tag, toast } from '../../ui'
import { PROTOCOL_AGENT, PROTOCOL_LABEL } from '../agents/model'
import type { AgentsSource } from '../agents/source'
import { providerSummary } from './agentSettings'
import { ProviderEditor } from './ProviderEditor'
import { CcSwitchImport, LinkImport } from './ProviderImports'
import { removalLines, SessionLines } from './providers'

type Open = { kind: 'ccswitch' } | { kind: 'link' } | { kind: 'remove'; provider: ProviderView } | null

/** The provider editor: null = closed; `editing` null = a new provider; `seq` remounts it on each opening. */
export type EditorState = { editing: ProviderView | null; seq?: number } | null

const names = (agents: AgentKind[]) => agents.map((a) => AGENT_META[a].name).join(t('、'))

/** `https://api.kimi.com/coding/ · Key ****abcd`: where each protocol goes, then the key. */
const summary = (p: ProviderView) =>
  [
    ...[...new Set(p.endpoints.map((e) => e.configDir ?? e.baseUrl))],
    ...p.endpoints.map((e) => providerSummary(e.env)),
    p.endpoints.every((e) => e.configDir) ? '' : `Key ${p.apiKey}`,
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * 供应商 of the machine (one list for all agents): each vendor with the protocols it serves, add / edit / remove
 * and the imports. Each agent picks its default among those it can run on, in its details.
 */
export function ProvidersPanel({
  source,
  view,
  onView,
  editor,
  onEditor,
}: {
  source: AgentsSource
  view: ProviderStoreView
  onView: (view: ProviderStoreView) => void
  editor: EditorState
  onEditor: (e: EditorState) => void
}) {
  const [open, setOpenState] = useState<Open>(null)
  // Presence keeps a closed dialog mounted: a new key makes each opening start fresh.
  const [seq, setSeq] = useState(0)
  const setOpen = (o: Open) => {
    if (o) setSeq((n) => n + 1)
    setOpenState(o)
  }
  const close = () => setOpen(null)
  const removing = open?.kind === 'remove' ? open.provider : null
  const defaultsOf = (id: string) => AGENT_KINDS.filter((a) => view.machine[a]?.provider === id)

  const remove = async (p: ProviderView) => {
    close()
    try {
      onView(await source.removeProvider(p.id))
      toast({ type: 'success', message: t('已删除供应商 {name}', { name: p.name }) })
    } catch (e) {
      toastError(e)
    }
  }
  /** Makes `id` the default of each agent, one after another (the machine saves one change at a time). */
  const makeDefault = async (pairs: [AgentKind, string][], v: ProviderStoreView) => {
    let next = v
    try {
      for (const [agent, id] of pairs) next = await source.setDefault(agent, id, null)
    } catch (e) {
      toastError(e)
    }
    onView(next)
  }
  const removeNote =
    removing &&
    [
      defaultsOf(removing.id).length
        ? t('它是 {agents} 的默认，删除后改为官方登录。', { agents: names(defaultsOf(removing.id)) })
        : '',
      Object.values(view.bots).includes(removing.id) ? t('单独设置为它的 Bot 会改回使用电脑默认。') : '',
    ]
      .filter(Boolean)
      .join(locale === 'en' ? ' ' : '')
  const removeLines = removing ? removalLines(view, removing.id) : []

  return (
    <section aria-label={t('供应商#nav')} className="mx-section">
      <div className="mx-section__head">
        <span className="mx-row__main">
          <span className="mx-strong">{t('供应商#nav')}</span>
          <span className="mx-sub">
            {source.features.includes('protocolProviders')
              ? t('一个供应商可提供多种协议，每个 Agent 在详情里选用协议对得上的')
              : t('这台电脑的客户端版本较旧，一个供应商只能登记一种协议；升级客户端后可登记多种')}
          </span>
        </span>
      </div>
      <GroupBox>
        {view.providers.length ? null : (
          <div className="mx-row mx-sub">{t('还没有供应商，Agent 使用官方登录')}</div>
        )}
        {view.providers.map((p) => {
          const defaults = defaultsOf(p.id)
          return (
            <div key={p.id} className="mx-row">
              <span className="mx-row__main">
                <span className="mx-row__title">
                  <span>{p.name}</span>
                  <span className="ag-protocols">
                    {p.endpoints.map((e) => (
                      <Tag key={e.protocol} tone="purple">
                        {PROTOCOL_LABEL[e.protocol]}
                      </Tag>
                    ))}
                  </span>
                  {defaults.length ? (
                    <Tag tone="blue">{t('{agents} 的默认', { agents: names(defaults) })}</Tag>
                  ) : null}
                </span>
                <span className="mx-sub mx-ellipsis">{summary(p)}</span>
              </span>
              <Button size="small" onClick={() => onEditor({ editing: p })}>
                {t('编辑…')}
              </Button>
              <Button size="small" onClick={() => setOpen({ kind: 'remove', provider: p })}>
                {t('删除')}
              </Button>
            </div>
          )
        })}
        <div className="mx-row mx-row--end">
          {source.ccSwitch ? (
            <Button size="small" onClick={() => setOpen({ kind: 'ccswitch' })}>
              {t('从 CC Switch 导入…')}
            </Button>
          ) : null}
          <Button size="small" onClick={() => setOpen({ kind: 'link' })}>
            {t('粘贴链接导入…')}
          </Button>
          <Button size="small" variant="primary" onClick={() => onEditor({ editing: null })}>
            {t('新增…')}
          </Button>
        </div>
      </GroupBox>
      <Presence>
        {editor ? (
          <ProviderEditor
            key={editor.seq}
            source={source}
            editing={editor.editing}
            onClose={() => onEditor(null)}
            onSaved={({ view: v }) => {
              onEditor(null)
              onView(v)
              toast({ type: 'success', message: t('供应商已保存') })
            }}
          />
        ) : null}
      </Presence>
      <Presence>
        {open?.kind === 'ccswitch' ? (
          <CcSwitchImport
            key={seq}
            source={source}
            onClose={close}
            onImported={({ imported, view: v }, defaults) => {
              close()
              toast({
                type: 'success',
                message: t('已从 CC Switch 导入 {n} 个供应商', { n: imported.length }),
              })
              void makeDefault(defaults, v)
            }}
          />
        ) : null}
      </Presence>
      <Presence>
        {open?.kind === 'link' ? (
          <LinkImport
            key={seq}
            source={source}
            onClose={close}
            onImported={({ id, view: v }, setDefault) => {
              close()
              const p = v.providers.find((x) => x.id === id)
              toast({ type: 'success', message: t('已导入供应商 {name}', { name: p?.name ?? '' }) })
              const agents = p && setDefault ? linkAgents(p) : []
              void makeDefault(
                agents.map((a) => [a, id]),
                v,
              )
            }}
          />
        ) : null}
      </Presence>
      <AlertDialog
        open={removing !== null}
        onClose={close}
        title={t('要删除供应商 {name} 吗？', { name: removing?.name ?? '' })}
        message={removeNote || undefined}
        detail={removeLines.length ? <SessionLines lines={removeLines} /> : undefined}
        actions={[
          { label: t('取消'), onClick: close },
          {
            label: t('删除'),
            variant: 'destructive',
            onClick: () => {
              if (removing) void remove(removing)
            },
          },
        ]}
      />
    </section>
  )
}

/** The agents an imported link was made for: each protocol's own agent that can run on it. */
const linkAgents = (p: ProviderView) =>
  [...new Set(p.endpoints.map((e) => PROTOCOL_AGENT[e.protocol]))].filter((a) => canUse(p, a))
