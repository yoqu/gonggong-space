import {
  type AgentKind,
  type MachineDto,
  OFFICIAL_PROVIDER,
  type ProviderStoreView,
  type ProviderView,
} from '@gonggong/protocol'
import { type ReactNode, useEffect, useState } from 'react'
import { locale, t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, AlertDialog, Button, GroupBox, Presence, Skeleton, toast } from '../../ui'
import { AGENT_LABEL, AGENTS } from '../bots/model'
import { ProviderEditor } from './ProviderEditor'
import { CcSwitchImport, LinkImport } from './ProviderImports'
import { OFFICIAL_NAME, removalLines, SessionLines, useProviderSwitch } from './providers'

/** 供应商 of a machine (design §4.2): read and written live on the machine, which alone keeps them. */
export function ProvidersPanel({ machine }: { machine: MachineDto }) {
  const [view, setView] = useState<ProviderStoreView | null>(null)
  const [error, setError] = useState('')
  const base = `/machines/${machine.id}/providers`

  useEffect(() => {
    api.get<ProviderStoreView>(base).then(setView, (e) => setError(errorText(e)))
  }, [base])

  const switcher = useProviderSwitch(async ({ agent, choice }) => {
    try {
      setView(await api.put<ProviderStoreView>(`${base}/default`, { agent, choice }))
      toast({
        type: 'success',
        message: t('{agent} 的本机默认已切换，新会话生效', { agent: AGENT_LABEL[agent] }),
      })
    } catch (e) {
      toastError(e)
    }
  })

  if (error) return <Alert variant="error" description={error} />
  if (!view) return <Skeleton count={4} />
  return (
    <div className="mx">
      {AGENTS.map((agent) => (
        <ProviderBox
          key={agent}
          machine={machine}
          agent={agent}
          view={view}
          onView={setView}
          onSwitch={(a, choice, v = view) => switcher.request({ agent: a, choice }, v)}
        />
      ))}
      {switcher.dialog}
    </div>
  )
}

type Open =
  | { kind: 'editor'; editing: ProviderView | null }
  | { kind: 'ccswitch' }
  | { kind: 'link' }
  | { kind: 'remove'; provider: ProviderView }
  | null

/** One agent's providers: the machine default (radio), add / edit / remove and the imports. */
function ProviderBox({
  machine,
  agent,
  view,
  onView,
  onSwitch,
}: {
  machine: MachineDto
  agent: AgentKind
  view: ProviderStoreView
  onView: (view: ProviderStoreView) => void
  /** Asks to make `choice` the default, confirming first when sessions keep the old one; `v` is the view to use. */
  onSwitch: (agent: AgentKind, choice: string, v?: ProviderStoreView) => void
}) {
  const [open, setOpenState] = useState<Open>(null)
  // Presence keeps a closed dialog mounted: a new key makes each opening start fresh.
  const [seq, setSeq] = useState(0)
  const setOpen = (o: Open) => {
    if (o) setSeq((n) => n + 1)
    setOpenState(o)
  }
  const close = () => setOpen(null)
  const current = view.machine[agent] ?? OFFICIAL_PROVIDER
  const list = view.providers.filter((p) => p.agent === agent)
  const removing = open?.kind === 'remove' ? open.provider : null
  const title = t('{agent} 供应商', { agent: AGENT_LABEL[agent] })

  const row = (value: string, name: string, sub: string, actions?: ReactNode) => (
    <div key={value} className="mx-row">
      <label className="ui-radio mx-row__main mx-radio">
        <input
          type="radio"
          name={`provider-${machine.id}-${agent}`}
          value={value}
          checked={current === value}
          onChange={() => onSwitch(agent, value)}
        />
        <span className="ui-radio__dot" />
        <span className="mx-row__main">
          <span>{name}</span>
          <span className="mx-sub mx-ellipsis">{sub}</span>
        </span>
      </label>
      {actions}
    </div>
  )

  const remove = async (p: ProviderView) => {
    close()
    try {
      onView(await api.del<ProviderStoreView>(`/machines/${machine.id}/providers/${p.id}`))
      toast({ type: 'success', message: t('已删除供应商 {name}', { name: p.name }) })
    } catch (e) {
      toastError(e)
    }
  }
  const removeNote =
    removing &&
    [
      current === removing.id ? t('它是本机默认，删除后本机默认改为官方登录。') : '',
      Object.values(view.bots).includes(removing.id) ? t('单独设置为它的 Bot 改为继承本机默认。') : '',
    ]
      .filter(Boolean)
      .join(locale === 'en' ? ' ' : '')
  const removeLines = removing ? removalLines(view, removing.id) : []

  return (
    <section aria-label={title} className="mx-section">
      <div className="mx-section__head">
        <span className="mx-row__main">
          <span className="mx-strong">{title}</span>
          <span className="mx-sub">
            {t('选中的是本机默认，新会话使用它；进行中的会话开启新会话后才切换')}
          </span>
        </span>
      </div>
      <GroupBox>
        {row(OFFICIAL_PROVIDER, OFFICIAL_NAME, t('使用这台机器上 CLI 自己的登录与配置'))}
        {list.map((p) =>
          row(
            p.id,
            p.name,
            [p.baseUrl, p.model, `Key ${p.apiKey}`].filter(Boolean).join(' · '),
            <>
              <Button size="small" onClick={() => setOpen({ kind: 'editor', editing: p })}>
                {t('编辑…')}
              </Button>
              <Button size="small" onClick={() => setOpen({ kind: 'remove', provider: p })}>
                {t('删除')}
              </Button>
            </>,
          ),
        )}
        <div className="mx-row mx-row--end">
          {machine.features.includes('ccSwitch') ? (
            <Button size="small" onClick={() => setOpen({ kind: 'ccswitch' })}>
              {t('从 CC Switch 导入…')}
            </Button>
          ) : null}
          <Button size="small" onClick={() => setOpen({ kind: 'link' })}>
            {t('粘贴链接导入…')}
          </Button>
          <Button size="small" variant="primary" onClick={() => setOpen({ kind: 'editor', editing: null })}>
            {t('新增…')}
          </Button>
        </div>
      </GroupBox>
      <Presence>
        {open?.kind === 'editor' ? (
          <ProviderEditor
            key={seq}
            machineId={machine.id}
            agent={agent}
            editing={open.editing}
            onClose={close}
            onSaved={({ id, view: v }, setDefault) => {
              close()
              onView(v)
              toast({ type: 'success', message: t('供应商已保存') })
              if (setDefault) onSwitch(agent, id, v)
            }}
          />
        ) : null}
      </Presence>
      <Presence>
        {open?.kind === 'ccswitch' ? (
          <CcSwitchImport
            key={seq}
            machineId={machine.id}
            agent={agent}
            onClose={close}
            onImported={({ imported, view: v }, currentId) => {
              close()
              onView(v)
              toast({
                type: 'success',
                message: t('已从 CC Switch 导入 {n} 个供应商', { n: imported.length }),
              })
              if (currentId) onSwitch(agent, currentId, v)
            }}
          />
        ) : null}
      </Presence>
      <Presence>
        {open?.kind === 'link' ? (
          <LinkImport
            key={seq}
            machineId={machine.id}
            onClose={close}
            onImported={({ id, view: v }, setDefault) => {
              close()
              onView(v)
              const p = v.providers.find((x) => x.id === id)
              toast({ type: 'success', message: t('已导入供应商 {name}', { name: p?.name ?? '' }) })
              if (setDefault && p) onSwitch(p.agent, id, v)
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
