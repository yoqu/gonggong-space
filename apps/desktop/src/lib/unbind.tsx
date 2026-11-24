import { AlertDialog } from '@web/ui'
import { useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { fail } from './ui'

/**
 * 解除绑定 behind a confirmation: it clears the team key and the managed workspaces. `rebind` words it as the first
 * step of binding again (概览 · 重新绑定).
 */
export function useUnbind(purpose: 'unbind' | 'rebind' = 'unbind') {
  const [confirming, setConfirming] = useState(false)
  const [unbinding, setUnbinding] = useState(false)

  const close = () => {
    if (!unbinding) setConfirming(false)
  }

  const confirm = async () => {
    if (unbinding) return
    setUnbinding(true)
    try {
      await ipc.unbind()
      setConfirming(false)
    } catch (e) {
      fail(e)
    } finally {
      setUnbinding(false)
    }
  }

  const dialog = (
    <AlertDialog
      open={confirming}
      onClose={close}
      icon={<img src={logo} alt="" width={48} height={48} />}
      title={
        purpose === 'rebind' ? t('要清除本机数据并重新绑定吗？') : t('要解除这台电脑与团队服务器的绑定吗？')
      }
      message={t(
        '这台电脑将断开连接，团队密钥和托管工作区会被清理，你手动选择的本机目录和本地备份会保留。此操作不可撤销。',
      )}
      actions={[
        { label: t('取消'), disabled: unbinding, onClick: close },
        {
          label: purpose === 'rebind' ? t('清除并重新绑定') : t('解除绑定'),
          variant: 'destructive',
          disabled: unbinding,
          loading: unbinding,
          onClick: () => void confirm(),
        },
      ]}
    />
  )
  return { request: () => setConfirming(true), dialog }
}
