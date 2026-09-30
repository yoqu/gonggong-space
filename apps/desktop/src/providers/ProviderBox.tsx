import type { AgentKind } from '@gonggong/protocol'
import { AlertDialog, Button, GroupBox, toast } from '@web/ui'
import { type ReactNode, useState } from 'react'
import { ipc, type Providers, type ProviderView } from '../ipc'
import { fail } from '../lib/ui'
import { CcSwitchImport, LinkImport } from './ImportDialogs'
import { ProviderEditor } from './ProviderEditor'

export const OFFICIAL = 'official'
export const OFFICIAL_NAME = '官方登录'

type Open =
  | { kind: 'editor'; editing: ProviderView | null }
  | { kind: 'ccswitch' }
  | { kind: 'link' }
  | { kind: 'remove'; provider: ProviderView }
  | null

/** 本机供应商 of one agent: the machine default (radio), add / edit / remove and the imports. */
export function ProviderBox({
  agent,
  data,
  onChange,
  onSwitch,
}: {
  agent: AgentKind
  data: Providers
  onChange: () => void
  /** A confirmed switch of the machine default (`useProviderSwitch`). */
  onSwitch: (agent: AgentKind, choice: string) => void
}) {
  const [open, setOpen] = useState<Open>(null)
  const close = () => setOpen(null)
  const current = data.machine[agent] ?? OFFICIAL
  const list = data.providers.filter((p) => p.agent === agent)
  const removing = open?.kind === 'remove' ? open.provider : null

  const row = (value: string, name: string, sub: string, actions?: ReactNode) => (
    <div key={value} className="dk-row">
      <label className="ui-radio dk-row__main dk-provider">
        <input
          type="radio"
          name={`provider-${agent}`}
          value={value}
          checked={current === value}
          onChange={() => onSwitch(agent, value)}
        />
        <span className="ui-radio__dot" />
        <span className="dk-row__main">
          <span>{name}</span>
          <span className="dk-sub dk-ellipsis">{sub}</span>
        </span>
      </label>
      {actions}
    </div>
  )

  const removeNote = removing && [
    current === removing.id ? '它是本机默认，删除后本机默认改为官方登录。' : '',
    Object.values(data.bots).includes(removing.id) ? '单独设置为它的 Bot 改为继承本机默认。' : '',
    '正在使用它的会话下一轮会自动开启新会话。',
  ]

  return (
    <>
      <GroupBox>
        <div className="dk-row">
          <span className="dk-row__main">
            <span className="dk-strong">本机供应商</span>
            <span className="dk-sub">选中的是本机默认，新会话使用它；进行中的会话开启新会话后才切换</span>
          </span>
          {data.ccSwitch ? (
            <Button onClick={() => setOpen({ kind: 'ccswitch' })}>从 CC Switch 导入…</Button>
          ) : null}
          <Button onClick={() => setOpen({ kind: 'link' })}>粘贴链接导入…</Button>
          <Button onClick={() => setOpen({ kind: 'editor', editing: null })}>新增…</Button>
        </div>
        {row(OFFICIAL, OFFICIAL_NAME, '使用本机 CLI 自己的登录与配置')}
        {list.map((p) =>
          row(
            p.id,
            p.name,
            [p.baseUrl, p.model, `Key ${p.apiKey}`].filter(Boolean).join(' · '),
            <>
              <Button size="small" onClick={() => setOpen({ kind: 'editor', editing: p })}>
                编辑…
              </Button>
              <Button size="small" onClick={() => setOpen({ kind: 'remove', provider: p })}>
                删除
              </Button>
            </>,
          ),
        )}
      </GroupBox>
      {open?.kind === 'editor' ? (
        <ProviderEditor
          agent={agent}
          editing={open.editing}
          onClose={close}
          onSaved={(id, setDefault) => {
            close()
            toast({ type: 'success', message: '供应商已保存' })
            onChange()
            if (setDefault) onSwitch(agent, id)
          }}
        />
      ) : null}
      {open?.kind === 'ccswitch' ? (
        <CcSwitchImport
          agent={agent}
          onClose={close}
          onImported={(count, currentId) => {
            close()
            toast({ type: 'success', message: `已从 CC Switch 导入 ${count} 个供应商` })
            onChange()
            if (currentId) onSwitch(agent, currentId)
          }}
        />
      ) : null}
      {open?.kind === 'link' ? (
        <LinkImport
          onClose={close}
          onImported={(p, setDefault) => {
            close()
            toast({ type: 'success', message: `已导入供应商 ${p.name}` })
            onChange()
            if (setDefault) onSwitch(p.agent, p.id)
          }}
        />
      ) : null}
      <AlertDialog
        open={removing !== null}
        onClose={close}
        title={`要删除供应商 ${removing?.name ?? ''} 吗？`}
        message={removeNote?.join('')}
        actions={[
          { label: '取消', onClick: close },
          {
            label: '删除',
            variant: 'destructive',
            onClick: () => {
              if (!removing) return
              close()
              ipc.removeProvider(removing.id).then(onChange, fail)
            },
          },
        ]}
      />
    </>
  )
}
