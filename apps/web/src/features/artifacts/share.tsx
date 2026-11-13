import type { ArtifactShareDto, ArtifactVisibility } from '@gonggong/protocol'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { Button, Dialog, Icon, SegmentedControl, Switch } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { setArtifactVisibility } from './store'

// Stitch's Share (capability list §9) on 共工's preview shares: one public link to the artifact's head, read-only.

const useShares = create<Record<string, ArtifactShareDto | undefined>>()(() => ({}))

export async function loadShare(artifactId: string) {
  try {
    const s = await api.get<ArtifactShareDto>(`/artifacts/${artifactId}/share`)
    useShares.setState({ [artifactId]: s })
  } catch {
    useShares.setState({
      [artifactId]: {
        enabled: false,
        url: null,
        expiresAt: null,
        version: null,
        latest: null,
        password: null,
      },
    })
  }
}

/**
 * The artifact's share link, loaded on first use; `set` turns it on or off (managers only, the server checks), with
 * `follow` makes it follow the latest version or locks it to the newest one, with `locked` gives it a fresh password
 * or drops it.
 */
export function useArtifactShare(artifactId: string) {
  const share = useShares((s) => s[artifactId])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!useShares.getState()[artifactId]) void loadShare(artifactId)
  }, [artifactId])
  const set = useCallback(
    async (enabled: boolean, opts: { follow?: boolean; locked?: boolean } = {}) => {
      setBusy(true)
      try {
        const s = await api.post<ArtifactShareDto>(`/artifacts/${artifactId}/share`, { enabled, ...opts })
        useShares.setState({ [artifactId]: s })
        return s
      } catch (e) {
        toastError(e)
        return null
      } finally {
        setBusy(false)
      }
    },
    [artifactId],
  )
  return { share: share ?? null, busy, set }
}

/** Tests: forget loaded shares. */
export const resetShares = () => useShares.setState({}, true)

/** Who may turn the link on or off: the owner of the artifact's bot or a group admin, never in demo mode. */
export function useShareAccess(groupId: string, botId: string | null | undefined): string | null {
  const me = useSession((s) => s.user?.id)
  const demo = useSession((s) => !!s.tenancy?.demoMode)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const owner = useWorkspace((s) => s.bots.find((b) => b.id === botId)?.ownerId)
  if (demo) return t('演示模式下不能开启分享')
  if (me && (owner === me || (group && isGroupAdmin(group, me)))) return null
  return t('只有 Bot 主人或群管理员能开关分享')
}

/** Who may set who sees it: its creator, the owner of its bot or a group admin. */
function useCanSetVisibility(groupId: string, botId: string | null | undefined, createdBy: string | null) {
  const me = useSession((s) => s.user?.id)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === groupId))
  const owner = useWorkspace((s) => s.bots.find((b) => b.id === botId)?.ownerId)
  return !!me && (createdBy === me || owner === me || (!!group && isGroupAdmin(group, me)))
}

const VISIBILITY_NOTE: Record<ArtifactVisibility, string> = {
  private: t('只有创建人、Bot 主人和群管理员能打开'),
  group: t('群成员都能查看和修改'),
  team: t('团队成员都能查看和演示，进群后才能修改'),
  all: t('所有登录用户都能查看和演示，只有群成员能修改'),
}

const expiry = (at: string | null) =>
  at ? t('链接 {date} 到期', { date: new Date(at).toLocaleDateString() }) : ''

/** The share link to a screen of the prototype (the shell plays `#play:<id>`). */
export const screenLink = (url: string, screen?: string) => (screen ? `${url}#play:${screen}` : url)

/** What to send someone: the link, and its password when it has one. */
export const shareText = (url: string, password: string | null) =>
  password ? `${url}\n${t('访问密码：{password}', { password })}` : url

export const copiedToast = (password: string | null) => (password ? t('链接和密码已复制') : t('链接已复制'))

/** A locked link's 4 digits, large enough to read out. */
function Password({ value }: { value: string }) {
  return (
    <span className="art-share__digits" role="img" aria-label={t('访问密码 {password}', { password: value })}>
      {value.split('').map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: digits repeat and never move
        <span key={i}>{d}</span>
      ))}
    </span>
  )
}

/** 分享: the switch, what it means, and the link. */
export function ShareDialog({
  artifactId,
  groupId,
  botId,
  visibility,
  createdBy,
  onClose,
}: {
  artifactId: string
  groupId: string
  botId: string | null | undefined
  visibility: ArtifactVisibility
  createdBy: string | null
  onClose: () => void
}) {
  const { share, busy, set } = useArtifactShare(artifactId)
  const denied = useShareAccess(groupId, botId)
  const canScope = useCanSetVisibility(groupId, botId, createdBy)
  const [scope, setScope] = useState(visibility)
  const [saving, setSaving] = useState(false)
  const changeScope = async (next: ArtifactVisibility) => {
    const was = scope
    setScope(next)
    setSaving(true)
    try {
      await setArtifactVisibility(artifactId, next)
    } catch (e) {
      setScope(was)
      toastError(e)
    } finally {
      setSaving(false)
    }
  }
  const on = !!share?.enabled
  const turnOn = async () => {
    const s = await set(true)
    if (s?.url) await copyWithToast(s.url, t('链接已复制'))
  }
  return (
    <Dialog open onClose={onClose} title={t('分享产物')} width={440}>
      <div className="art-share">
        <div className="art-share__scope">
          <strong>{t('可见范围')}</strong>
          <SegmentedControl<ArtifactVisibility>
            aria-label={t('可见范围')}
            size="small"
            value={scope}
            onChange={(v) => void changeScope(v)}
            items={[
              { value: 'private', label: t('仅自己'), disabled: !canScope || saving },
              { value: 'group', label: t('本群'), disabled: !canScope || saving },
              { value: 'team', label: t('团队'), disabled: !canScope || saving },
              { value: 'all', label: t('全员'), disabled: !canScope || saving },
            ]}
          />
          <small>
            {canScope ? VISIBILITY_NOTE[scope] : t('只有创建人、Bot 主人或群管理员能修改可见范围')}
          </small>
        </div>
        <div className="art-share__row">
          <div>
            <strong>{t('开启分享')}</strong>
            <small>{on ? t('任何拿到链接的人都能查看') : t('未开启，只有群成员能查看')}</small>
          </div>
          <Switch
            aria-label={t('开启分享')}
            checked={on}
            disabled={!share || busy || !!denied}
            onChange={(v) => void set(v)}
          />
        </div>
        {denied ? (
          <p className="art-share__denied" role="note">
            <Icon name="lock" size={13} />
            {denied}
          </p>
        ) : null}
        {on && share?.latest ? (
          <div className="art-share__scope">
            <strong>{t('链接内容')}</strong>
            <SegmentedControl<'pin' | 'follow'>
              aria-label={t('链接内容')}
              size="small"
              value={share.version ? 'pin' : 'follow'}
              onChange={(v) => void set(true, { follow: v === 'follow' })}
              items={[
                {
                  value: 'pin',
                  label: t('锁定 v{n}', { n: share.version ?? share.latest }),
                  disabled: busy || !!denied,
                },
                { value: 'follow', label: t('始终最新'), disabled: busy || !!denied },
              ]}
            />
            {share.version && share.version < share.latest ? (
              <div className="art-share__stale">
                <small>{t('已有更新的 v{n}，对方仍看到 v{m}', { n: share.latest, m: share.version })}</small>
                <Button
                  size="small"
                  disabled={busy || !!denied}
                  onClick={() => void set(true, { follow: false })}
                >
                  {t('更新到 v{n}', { n: share.latest })}
                </Button>
              </div>
            ) : (
              <small>
                {share.version
                  ? t('Bot 再修改，对方看到的内容也不变')
                  : t('Bot 修改后，对方看到的内容随之更新')}
              </small>
            )}
          </div>
        ) : null}
        {on ? (
          <div className="art-share__lock">
            <div className="art-share__row">
              <div>
                <strong>{t('密码访问')}</strong>
                <small>
                  {share?.password ? t('打开链接后需输入 4 位数字密码') : t('开启后自动生成 4 位数字密码')}
                </small>
              </div>
              <Switch
                aria-label={t('密码访问')}
                checked={!!share?.password}
                disabled={busy || !!denied}
                onChange={(v) => void set(true, { locked: v })}
              />
            </div>
            {share?.password ? (
              <div className="art-share__password">
                <Password value={share.password} />
                <Button
                  size="small"
                  variant="plain"
                  icon="arrow-clockwise"
                  disabled={busy || !!denied}
                  onClick={() => void set(true, { locked: true })}
                >
                  {t('换一个')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {on && share?.url ? (
          <div className="art-share__link">
            <code title={share.url}>{share.url}</code>
            <small>{expiry(share.expiresAt)}</small>
          </div>
        ) : null}
        {on ? (
          <Button
            variant="primary"
            icon="link"
            disabled={!share?.url}
            onClick={() =>
              share?.url &&
              void copyWithToast(shareText(share.url, share.password), copiedToast(share.password))
            }
          >
            {share?.password ? t('复制链接和密码') : t('复制链接')}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="link"
            disabled={!share || busy || !!denied}
            onClick={() => void turnOn()}
          >
            {t('开启并复制链接')}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

/** Show QR Code: the share link (to `screen` when given) for a phone to scan; turns sharing on in place. */
export function QrDialog({
  artifactId,
  groupId,
  botId,
  screen,
  onClose,
}: {
  artifactId: string
  groupId: string
  botId: string | null | undefined
  screen?: string
  onClose: () => void
}) {
  const { share, busy, set } = useArtifactShare(artifactId)
  const denied = useShareAccess(groupId, botId)
  const url = share?.enabled && share.url ? screenLink(share.url, screen) : null
  return (
    <Dialog open onClose={onClose} title={t('扫码查看')} width={340}>
      {url ? (
        <div className="art-qr">
          <div className="art-qr__code" data-testid="art-qr">
            <QRCodeSVG value={url} size={196} marginSize={2} />
          </div>
          <small>{t('用手机扫码打开原型')}</small>
          {share?.password ? (
            <div className="art-share__password">
              <small>{t('访问密码')}</small>
              <Password value={share.password} />
            </div>
          ) : null}
          <small>{expiry(share?.expiresAt ?? null)}</small>
          <Button
            size="small"
            icon="link"
            onClick={() =>
              void copyWithToast(
                shareText(url, share?.password ?? null),
                copiedToast(share?.password ?? null),
              )
            }
          >
            {share?.password ? t('复制链接和密码') : t('复制链接')}
          </Button>
        </div>
      ) : (
        <div className="art-qr art-qr--off">
          <Icon name="qrcode" size={36} />
          <small>{t('二维码打开分享链接，开启后任何拿到链接的人都能查看')}</small>
          {denied ? <small className="art-share__denied">{denied}</small> : null}
          <Button
            variant="primary"
            size="small"
            disabled={!share || busy || !!denied}
            onClick={() => void set(true)}
          >
            {t('开启分享并生成二维码')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
