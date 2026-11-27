import type { MachineDto, PluginTrustDto, PluginTrustStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Button, ConfirmActionDialog, GroupBox, Presence, Skeleton, Tag, toast } from '../../ui'
import { mcpTarget, permissionsText } from '../plugins/model'

const STATUS: Record<PluginTrustStatus, { label: string; tone: 'orange' | 'green' | 'gray' }> = {
  pending: { label: t('待授权'), tone: 'orange' },
  allowed: { label: t('已允许'), tone: 'green' },
  denied: { label: t('已拒绝'), tone: 'gray' },
}

/** 插件授权: plugin versions that asked to run code on this machine, for its owner to allow, deny or revoke. */
export function PluginTrustsPanel({ machine }: { machine: MachineDto }) {
  const base = `/machines/${machine.id}/plugin-trusts`
  const { data, error, loading, reload } = useGet<PluginTrustDto[]>(base)
  const [busy, setBusy] = useState<{ id: string; op: 'allow' | 'deny' } | null>(null)
  const [revoking, setRevoking] = useState<PluginTrustDto | null>(null)

  const decide = async (id: string, allow: boolean) => {
    if (busy) return
    setBusy({ id, op: allow ? 'allow' : 'deny' })
    try {
      await api.put(`${base}/${id}`, { allow })
      toast({ type: 'success', message: allow ? t('已允许插件授权') : t('已拒绝插件授权') })
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const pendingCount = data?.filter((r) => r.status === 'pending').length ?? 0

  return (
    <div className="mx">
      <section aria-label={t('插件运行授权')} className="mx-section">
        <div className="mx-section__head">
          <span className="mx-row__main">
            <span className="mx-row__title">
              <span className="mx-strong">{t('插件运行授权')}</span>
              {pendingCount > 0 ? <Tag tone="orange">{t('待授权 {n}', { n: pendingCount })}</Tag> : null}
            </span>
            <span className="mx-sub">
              {t('含本机程序的插件首次在这台电脑运行时需你确认，插件出新版本后会重新请你确认。')}
            </span>
          </span>
        </div>
        {error ? (
          <Alert variant="error" description={error} retrying={loading} onRetry={reload} />
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
                      loading={busy?.id === r.id && busy.op === 'allow'}
                      onClick={() => void decide(r.id, true)}
                    >
                      {t('允许')}
                    </Button>
                    <Button
                      size="small"
                      disabled={!!busy}
                      loading={busy?.id === r.id && busy.op === 'deny'}
                      onClick={() => void decide(r.id, false)}
                    >
                      {t('拒绝#reject')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    disabled={!!busy}
                    title={t('撤销后，下次用到时会重新请你确认')}
                    onClick={() => setRevoking(r)}
                  >
                    {t('撤销')}
                  </Button>
                )}
              </div>
            ))}
          </GroupBox>
        ) : (
          <p className="mx-sub">{t('还没有插件请求在这台电脑上运行代码')}</p>
        )}
      </section>
      <Presence>
        {revoking ? (
          <ConfirmActionDialog
            title={t('要撤销 {name} 的授权吗？', { name: revoking.pluginTitle })}
            message={t('撤销后，下次用到时会重新请你确认')}
            consequences={[t('该插件需要再次授权后才能在这台电脑上运行代码')]}
            label={t('撤销')}
            done={t('已撤销插件授权')}
            run={async () => {
              await api.del(`${base}/${revoking.id}`)
              reload()
            }}
            onClose={() => setRevoking(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
