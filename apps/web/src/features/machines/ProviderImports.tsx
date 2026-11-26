import {
  AGENT_META,
  type AgentKind,
  type CcSwitchCandidate,
  type CcSwitchImportedDto,
  type ProviderSavedDto,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Checkbox, Dialog, GroupBox, Skeleton, Tag, TextField } from '../../ui'
import { PROTOCOL_LABEL } from '../agents/model'
import type { AgentsSource } from '../agents/source'

/** 从 CC Switch 导入: the machine's own CC Switch providers, keys masked; all chosen by default. */
export function CcSwitchImport({
  source,
  onClose,
  onImported,
}: {
  source: AgentsSource
  onClose: () => void
  /** `defaults`: agent → local id of CC Switch's current provider, when those should become the defaults. */
  onImported: (res: CcSwitchImportedDto, defaults: [AgentKind, string][]) => void
}) {
  const [list, setList] = useState<CcSwitchCandidate[] | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [setDefault, setSetDefault] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` triggers a reload
  useEffect(() => {
    let live = true
    setLoading(true)
    source.ccSwitch?.preview().then(
      (candidates) => {
        if (!live) return
        setList(candidates)
        setChosen(candidates.map((c) => c.key))
        setLoadError(null)
        setLoading(false)
      },
      (e) => {
        if (!live) return
        setLoadError(errorText(e))
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
  }, [source, tick])

  const close = () => {
    if (!busy) onClose()
  }

  const current = list?.filter((c) => c.current && chosen.includes(c.key)) ?? []
  const submit = async () => {
    if (!source.ccSwitch || busy) return
    setBusy(true)
    setSubmitError(null)
    try {
      const res = await source.ccSwitch.apply(chosen)
      const defaults = setDefault
        ? current.flatMap((c): [AgentKind, string][] => {
            const id = res.imported[chosen.indexOf(c.key)]
            return id ? [[c.agent, id]] : []
          })
        : []
      onImported(res, defaults)
    } catch (e) {
      setSubmitError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      closeOnBackdrop={false}
      title={t('从 CC Switch 导入供应商')}
      message={t('只读取这台电脑上的 CC Switch，Key 只保存在这台电脑上')}
      width={560}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('导入'),
          variant: 'primary',
          disabled: busy || !chosen.length,
          loading: busy,
          onClick: () => void submit(),
        },
      ]}
    >
      {loadError ? (
        <Alert variant="error" description={loadError} retrying={loading} onRetry={reload} />
      ) : null}
      {submitError ? <Alert variant="error" description={submitError} /> : null}
      {!list && !loadError ? <Skeleton count={3} /> : null}
      {list?.length === 0 ? <p className="mx-sub">{t('CC Switch 里没有可直接使用的供应商')}</p> : null}
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
                        <Tag tone="gray">{AGENT_META[c.agent].name}</Tag>
                        <Tag tone="purple">{PROTOCOL_LABEL[c.protocol]}</Tag>
                        {c.current ? <Tag tone="blue">{t('CC Switch 当前')}</Tag> : null}
                        {c.existing ? <Tag tone="gray">{t('将更新已有项')}</Tag> : null}
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
              label={t('将 CC Switch 当前使用的设为这台电脑默认')}
              checked={setDefault}
              onChange={setSetDefault}
              disabled={!current.length}
            />
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}

/** 粘贴链接导入: a `ccswitch://v1/import?…` provider link, parsed by the machine itself. */
export function LinkImport({
  source,
  onClose,
  onImported,
}: {
  source: AgentsSource
  onClose: () => void
  onImported: (res: ProviderSavedDto, setDefault: boolean) => void
}) {
  const [link, setLink] = useState('')
  const [setDefault, setSetDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (!busy) onClose()
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onImported(await source.importLink(link.trim()), setDefault)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      closeOnBackdrop={false}
      title={t('粘贴链接导入')}
      message={t('CC Switch 的供应商分享链接，Key 只保存在这台电脑上')}
      width={520}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('导入'),
          variant: 'primary',
          disabled: busy || !link.trim(),
          loading: busy,
          onClick: () => void submit(),
        },
      ]}
    >
      <div className="mx-vendors">
        <TextField
          multiline
          aria-label={t('导入链接')}
          rows={3}
          placeholder="ccswitch://v1/import?resource=provider&app=claude&…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          error={error ?? undefined}
        />
        <Checkbox label={t('设为这台电脑默认')} checked={setDefault} onChange={setSetDefault} />
      </div>
    </Dialog>
  )
}
