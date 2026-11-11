import type { MachineDto, PluginTrustDto, PluginTrustStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Button, GroupBox, Skeleton, Tag } from '../../ui'
import { mcpTarget, permissionsText } from '../plugins/model'

const STATUS: Record<PluginTrustStatus, { label: string; tone: 'orange' | 'green' | 'gray' }> = {
  pending: { label: t('待授权'), tone: 'orange' },
  allowed: { label: t('已允许'), tone: 'green' },
  denied: { label: t('已拒绝'), tone: 'gray' },
}

/** 插件授权: plugin versions that asked to run code on this machine, for its owner to allow, deny or revoke. */
export function PluginTrustsPanel({ machine }: { machine: MachineDto }) {
  const base = `/machines/${machine.id}/plugin-trusts`
  const { data, error, reload } = useGet<PluginTrustDto[]>(base)
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await run()
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mx">
      <section aria-label={t('插件授权')} className="mx-section">
        <div className="mx-section__head">
          <span className="mx-row__main">
            <span className="mx-strong">{t('插件授权')}</span>
            <span className="mx-sub">
              {t('会运行代码的插件第一次在这台机器上使用时请你确认；插件出新版本要重新确认。')}
            </span>
          </span>
        </div>
        {error ? (
          <Alert variant="error" description={error} />
        ) : !data ? (
          <Skeleton />
        ) : data.length ? (
          <GroupBox>
            {data.map((r) => (
              <div key={r.id} className="mx-row">
                <span className="mx-row__main">
                  <span className="mx-row__title">
                    <span className="mx-strong">
                      {r.pluginTitle} {r.version}
                    </span>
                    <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>
                  </span>
                  <span className="mx-sub">{t('权限：{list}', { list: permissionsText(r) })}</span>
                  {r.mcp.map((c) => (
                    <span key={c.name} className="mx-sub mx-mono mx-ellipsis" title={mcpTarget(c)}>
                      {`${r.pluginName}-${c.name}：${mcpTarget(c)}`}
                    </span>
                  ))}
                </span>
                {r.status === 'pending' ? (
                  <>
                    <Button
                      size="small"
                      variant="primary"
                      disabled={!!busy}
                      loading={busy === r.id}
                      onClick={() => void act(r.id, () => api.put(`${base}/${r.id}`, { allow: true }))}
                    >
                      {t('允许')}
                    </Button>
                    <Button
                      size="small"
                      disabled={!!busy}
                      onClick={() => void act(r.id, () => api.put(`${base}/${r.id}`, { allow: false }))}
                    >
                      {t('拒绝#reject')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    disabled={!!busy}
                    loading={busy === r.id}
                    title={t('撤销后，下次用到时会重新请你确认')}
                    onClick={() => void act(r.id, () => api.del(`${base}/${r.id}`))}
                  >
                    {t('撤销')}
                  </Button>
                )}
              </div>
            ))}
          </GroupBox>
        ) : (
          <p className="mx-sub">{t('还没有插件请求在这台机器上运行代码')}</p>
        )}
      </section>
    </div>
  )
}
