import type { GitAccessTest, GitAccessView, MachineDto, RepoAccessReason } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  GroupBox,
  Icon,
  IconButton,
  SecureField,
  Skeleton,
  Tag,
  TextField,
  toast,
} from '../../ui'

const REASON: Record<RepoAccessReason, string> = {
  denied: t('无权限或仓库不存在'),
  branch_missing: t('分支不存在'),
  network: t('网络或证书问题'),
  timeout: t('连接超时'),
}

const isHttps = (url: string) => /^https?:\/\//i.test(url.trim())
const hostOf = (url: string) => {
  try {
    return new URL(url.trim()).host
  } catch {
    return ''
  }
}

/** Git 访问: how this machine's git reaches repos without a prompt — ssh keys, HTTPS tokens, a test and host keys. */
export function GitAccessPanel({ machine, repo }: { machine: MachineDto; repo?: string }) {
  const base = `/machines/${machine.id}/git-access`
  const loaded = useGet<GitAccessView>(base)
  const [changed, setChanged] = useState<GitAccessView | null>(null)
  const data = changed ?? loaded.data
  const [url, setUrl] = useState(repo ?? '')
  const [test, setTest] = useState<GitAccessTest | null>(null)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState({
    host: repo && isHttps(repo) ? hostOf(repo) : '',
    username: '',
    secret: '',
  })

  const runTest = async (target = url) => {
    if (!target.trim()) return
    setTesting(true)
    try {
      setTest(await api.post<GitAccessTest>(`${base}/test`, { url: target.trim() }))
    } catch (e) {
      toastError(e)
    } finally {
      setTesting(false)
    }
  }
  // Arriving from a paused bot: test its repo at once.
  const tested = useRef(false)
  useEffect(() => {
    if (repo && !tested.current) {
      tested.current = true
      void runTest(repo)
    }
  })

  const change = async (run: () => Promise<GitAccessView>, done: string) => {
    setBusy(true)
    try {
      setChanged(await run())
      toast({ type: 'success', message: done })
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const genKey = () => change(() => api.post<GitAccessView>(`${base}/ssh-key`, {}), t('已生成 SSH 密钥'))
  const saveToken = async () => {
    const ok = await change(() => api.put<GitAccessView>(`${base}/tokens`, token), t('令牌已保存'))
    if (ok) setToken({ host: '', username: '', secret: '' })
  }
  const removeToken = (host: string) =>
    change(
      () => api.del<GitAccessView>(`${base}/tokens/${encodeURIComponent(host)}`),
      t('已删除 {host} 的令牌', { host }),
    )
  const trust = async (host: string) => {
    if (
      await change(
        () => api.post<GitAccessView>(`${base}/known-hosts`, { host }),
        t('已信任 {host}', { host }),
      )
    )
      await runTest()
  }

  if (loaded.error) return <Alert variant="error" title={loaded.error} />
  if (!data) return <Skeleton count={5} />
  return (
    <div className="mx">
      <section aria-label={t('测试连接')} className="mx-section">
        <div className="mx-section__head">
          <span className="mx-row__main">
            <span className="mx-strong">{t('测试连接')}</span>
            <span className="mx-sub">
              {t('Bot 在这台机器上拉取、推送代码时不会弹出账号密码，需要先配置 SSH 密钥或 HTTPS 令牌')}
            </span>
          </span>
        </div>
        <div className="mx-inline mx-field-row">
          <TextField
            aria-label={t('仓库地址')}
            placeholder="git@github.com:org/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runTest()
            }}
          />
          <Button onClick={() => void runTest()} disabled={!url.trim() || testing} loading={testing}>
            {t('测试')}
          </Button>
        </div>
        {test ? <TestResult test={test} busy={busy} onTrust={trust} /> : null}
      </section>

      <section aria-label={t('SSH 密钥')} className="mx-section">
        <div className="mx-section__head">
          <span className="mx-row__main">
            <span className="mx-strong">{t('SSH 密钥')}</span>
            <span className="mx-sub">
              {t(
                '用于 git@ 开头的地址。把公钥添加到 GitHub（Settings → SSH and GPG keys）或 GitLab（Preferences → SSH Keys）；只给一个仓库用时添加为该仓库的 Deploy Key。私钥只保存在这台机器上。',
              )}
            </span>
          </span>
          {data.sshKeys.length ? null : (
            <Button size="small" variant="primary" onClick={() => void genKey()} disabled={busy}>
              {t('生成密钥')}
            </Button>
          )}
        </div>
        {data.sshKeys.length ? (
          <GroupBox>
            {data.sshKeys.map((k) => (
              <div key={k.path} className="mx-row">
                <span className="mx-row__main">
                  <span className="mx-row__title">
                    <span className="mx-strong">{k.comment ?? k.path}</span>
                    <Tag tone="gray">{k.type}</Tag>
                  </span>
                  <span className="mx-sub mx-mono mx-ellipsis" title={k.publicKey}>
                    {k.fingerprint || k.path}
                  </span>
                </span>
                <Button
                  size="small"
                  icon="copy"
                  onClick={() => void copyWithToast(k.publicKey, t('已复制公钥'))}
                >
                  {t('复制公钥')}
                </Button>
              </div>
            ))}
          </GroupBox>
        ) : (
          <p className="mx-sub">{t('这台机器还没有 SSH 密钥')}</p>
        )}
        {data.knownHosts.length ? (
          <span className="mx-sub">
            {t('已信任的主机：{hosts}', { hosts: data.knownHosts.join(t('、')) })}
          </span>
        ) : null}
      </section>

      <section aria-label={t('HTTPS 令牌')} className="mx-section">
        <div className="mx-section__head">
          <span className="mx-row__main">
            <span className="mx-strong">{t('HTTPS 令牌')}</span>
            <span className="mx-sub">
              {t(
                '用于 https:// 和 http:// 开头的地址，按主机生效。GitHub 填 Personal access token；GitLab 填 Personal 或 Project access token，需要 read_repository 与 write_repository 权限。令牌只保存在这台机器上。',
              )}
            </span>
          </span>
        </div>
        {data.helper ? (
          <Alert
            variant="info"
            description={t('该机器已有凭据助手 {helper}，git 会先使用它保存的账号，再使用这里的令牌', {
              helper: data.helper,
            })}
          />
        ) : null}
        {data.tokens.length ? (
          <GroupBox>
            {data.tokens.map((tk) => (
              <div key={tk.host} className="mx-row">
                <span className="mx-row__main">
                  <span className="mx-strong">{tk.host}</span>
                  <span className="mx-sub mx-mono">
                    {tk.username} · {tk.masked}
                  </span>
                </span>
                <IconButton
                  title={t('删除 {host} 的令牌', { host: tk.host })}
                  disabled={busy}
                  onClick={() => void removeToken(tk.host)}
                >
                  <Icon name="trash" />
                </IconButton>
              </div>
            ))}
          </GroupBox>
        ) : null}
        <GroupBox>
          <div className="mx-row mx-row--end">
            <TextField
              aria-label={t('主机')}
              placeholder="gitlab.example.com"
              value={token.host}
              onChange={(e) => setToken({ ...token, host: e.target.value })}
            />
            <TextField
              aria-label={t('用户名')}
              placeholder={t('用户名')}
              value={token.username}
              onChange={(e) => setToken({ ...token, username: e.target.value })}
            />
            <SecureField
              aria-label={t('令牌')}
              placeholder={t('令牌')}
              autoComplete="off"
              value={token.secret}
              onChange={(e) => setToken({ ...token, secret: e.target.value })}
            />
            <Button
              variant="primary"
              disabled={busy || !token.host.trim() || !token.username.trim() || !token.secret.trim()}
              onClick={() => void saveToken()}
            >
              {t('保存令牌')}
            </Button>
          </div>
        </GroupBox>
      </section>
    </div>
  )
}

function TestResult({
  test,
  busy,
  onTrust,
}: {
  test: GitAccessTest
  busy: boolean
  onTrust: (host: string) => void
}) {
  if (test.ok) return <Alert variant="success" title={t('可以访问 {url}', { url: test.url })} />
  const hint = test.hostKey
    ? t('这台机器还不认识该主机的密钥。核对下面的指纹与托管平台公布的一致后再信任。')
    : test.reason === 'denied'
      ? isHttps(test.url)
        ? t('在下方为 {host} 添加 HTTPS 令牌后再测试', { host: hostOf(test.url) })
        : t('把下方的 SSH 公钥添加到托管平台后再测试')
      : ''
  const hostKey = test.hostKey
  return (
    <Alert
      variant="error"
      title={test.reason ? REASON[test.reason] : t('无法访问')}
      description={
        <span className="mx-section">
          {test.detail ? <span className="mx-mono">{test.detail}</span> : null}
          {hint ? <span>{hint}</span> : null}
          {hostKey?.fingerprints.map((f) => (
            <span key={f} className="mx-mono">
              {f}
            </span>
          ))}
          {hostKey ? (
            <span>
              <Button size="small" disabled={busy} onClick={() => onTrust(hostKey.host)}>
                {t('信任 {host}', { host: hostKey.host })}
              </Button>
            </span>
          ) : null}
        </span>
      }
    />
  )
}
