import type {
  AgentKind,
  CcSwitchCandidate,
  CcSwitchImportedDto,
  CcSwitchPreviewDto,
  ProviderSavedDto,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api, errorText } from '../../lib/api'
import { Checkbox, Dialog, GroupBox, Skeleton, Tag, TextField } from '../../ui'
import { AGENT_LABEL } from '../bots/model'

/** 从 CC Switch 导入: the machine's own CC Switch providers of `agent`, keys masked; all chosen by default. */
export function CcSwitchImport({
  machineId,
  agent,
  onClose,
  onImported,
}: {
  machineId: string
  agent: AgentKind
  onClose: () => void
  /** `current`: the local id of CC Switch's current provider when it should become the default. */
  onImported: (res: CcSwitchImportedDto, current: string | null) => void
}) {
  const [list, setList] = useState<CcSwitchCandidate[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [setDefault, setSetDefault] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<CcSwitchPreviewDto>(`/machines/${machineId}/ccswitch`).then(
      ({ candidates }) => {
        const mine = candidates.filter((c) => c.agent === agent)
        setList(mine)
        setChosen(mine.map((c) => c.key))
      },
      (e) => setError(errorText(e)),
    )
  }, [machineId, agent])

  const current = list?.find((c) => c.current && chosen.includes(c.key))
  const submit = async () => {
    setBusy(true)
    try {
      // The default is switched afterwards, through the same confirmation as any other switch.
      const res = await api.post<CcSwitchImportedDto>(`/machines/${machineId}/ccswitch/apply`, {
        keys: chosen,
        setDefault: false,
      })
      const at = current ? chosen.indexOf(current.key) : -1
      onImported(res, setDefault && at >= 0 ? (res.imported[at] ?? null) : null)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={`从 CC Switch 导入 ${AGENT_LABEL[agent]} 供应商`}
      message="只读取这台机器上的 CC Switch，Key 只保存在这台机器上"
      width={560}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '导入', variant: 'primary', disabled: busy || !chosen.length, onClick: () => void submit() },
      ]}
    >
      {error ? <p className="mx-danger">{error}</p> : null}
      {!list && !error ? <Skeleton count={3} /> : null}
      {list?.length === 0 ? (
        <p className="mx-sub">CC Switch 里没有可直接使用的 {AGENT_LABEL[agent]} 供应商</p>
      ) : null}
      {list?.length ? (
        <div className="mx-vendors">
          <GroupBox>
            {list.map((c) => (
              <div key={c.key} className="mx-row">
                <Checkbox
                  checked={chosen.includes(c.key)}
                  onChange={(on) => setChosen((x) => (on ? [...x, c.key] : x.filter((k) => k !== c.key)))}
                  label={
                    <span className="mx-row__main">
                      <span className="mx-row__title">
                        {c.name}
                        {c.current ? <Tag tone="blue">CC Switch 当前</Tag> : null}
                        {c.existing ? <Tag tone="gray">将更新已有项</Tag> : null}
                      </span>
                      <span className="mx-sub mx-ellipsis">
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

/** 粘贴链接导入: a `ccswitch://v1/import?…` provider link, parsed by the machine itself. */
export function LinkImport({
  machineId,
  onClose,
  onImported,
}: {
  machineId: string
  onClose: () => void
  onImported: (res: ProviderSavedDto, setDefault: boolean) => void
}) {
  const [link, setLink] = useState('')
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await api.post<ProviderSavedDto>(`/machines/${machineId}/providers/import-link`, {
        link: link.trim(),
        setDefault: false,
      })
      onImported(res, setDefault)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title="粘贴链接导入"
      message="CC Switch 的供应商分享链接，Key 只保存在这台机器上"
      width={520}
      actions={[
        { label: '取消', onClick: onClose },
        { label: '导入', variant: 'primary', disabled: busy || !link.trim(), onClick: () => void submit() },
      ]}
    >
      <div className="mx-vendors">
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
