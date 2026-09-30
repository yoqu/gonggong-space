import type { AgentKind } from '@gonggong/protocol'
import { Checkbox, Dialog, GroupBox, Skeleton, Tag, TextField } from '@web/ui'
import { useEffect, useState } from 'react'
import { type Candidate, ipc, type ProviderView } from '../ipc'
import { AGENTS } from '../lib/labels'

/** 从 CC Switch 导入: this machine's CC Switch providers of `agent`, keys masked; all chosen by default. */
export function CcSwitchImport({
  agent,
  onClose,
  onImported,
}: {
  agent: AgentKind
  onClose: () => void
  /** `current`: the id of CC Switch's current provider to make the default, if chosen. */
  onImported: (count: number, current: string | null) => void
}) {
  const [list, setList] = useState<Candidate[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [setDefault, setSetDefault] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ipc.ccswitchPreview().then(
      (all) => {
        const mine = all.filter((c) => c.agent === agent)
        setList(mine)
        setChosen(mine.map((c) => c.key))
      },
      (e) => setError(String(e)),
    )
  }, [agent])

  const current = list?.find((c) => c.current && chosen.includes(c.key))
  const submit = async () => {
    setBusy(true)
    try {
      const ids = await ipc.ccswitchImport(chosen)
      const at = current ? chosen.indexOf(current.key) : -1
      onImported(ids.length, setDefault && at >= 0 ? (ids[at] ?? null) : null)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={`从 CC Switch 导入 ${AGENTS[agent].name} 供应商`}
      message="只读取本机的 CC Switch，Key 只保存在本机"
      width={560}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '导入', variant: 'primary', disabled: busy || !chosen.length, onClick: submit },
      ]}
    >
      {error ? <p className="dk-danger">{error}</p> : null}
      {!list && !error ? <Skeleton count={3} /> : null}
      {list?.length === 0 ? (
        <p className="dk-sub">CC Switch 里没有可直接使用的 {AGENTS[agent].name} 供应商</p>
      ) : null}
      {list?.length ? (
        <div className="dk-vendors">
          <GroupBox>
            {list.map((c) => (
              <div key={c.key} className="dk-row">
                <Checkbox
                  checked={chosen.includes(c.key)}
                  onChange={(on) => setChosen((x) => (on ? [...x, c.key] : x.filter((k) => k !== c.key)))}
                  label={
                    <span className="dk-row__main">
                      <span className="dk-row__title">
                        {c.name}
                        {c.current ? <Tag tone="blue">CC Switch 当前</Tag> : null}
                        {c.existing ? <Tag tone="gray">将更新已有项</Tag> : null}
                      </span>
                      <span className="dk-sub dk-ellipsis">
                        {[c.baseUrl, c.model, `Key ${c.apiKey}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  }
                />
              </div>
            ))}
          </GroupBox>
          {list.some((c) => c.current) ? (
            <Checkbox
              label="将 CC Switch 当前使用的设为本机默认"
              checked={setDefault}
              onChange={setSetDefault}
              disabled={!current}
            />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}

/** 粘贴链接导入: a `ccswitch://v1/import?…` provider link. */
export function LinkImport({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: (p: ProviderView, setDefault: boolean) => void
}) {
  const [link, setLink] = useState('')
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      onImported(await ipc.importProviderLink(link), setDefault)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title="粘贴链接导入"
      message="CC Switch 的供应商分享链接，Key 只保存在本机"
      width={520}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '导入', variant: 'primary', disabled: busy || !link.trim(), onClick: submit },
      ]}
    >
      <div className="dk-vendors">
        <TextField
          multiline
          aria-label="导入链接"
          rows={3}
          placeholder="ccswitch://v1/import?resource=provider&app=claude&…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={error ?? undefined}
        />
        <Checkbox label="设为本机默认" checked={setDefault} onChange={setSetDefault} />
      </div>
    </Dialog>
  )
}
