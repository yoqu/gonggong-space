import type { Permission } from '@gonggong/protocol'
import type { IconName } from '@web/ui'
import { create } from 'zustand'
import { t } from './i18n'
import { ipc, type PermissionState } from './ipc'

/** macOS permissions of this app, and whether the 系统权限 guide is open (it takes the window while it is). */
export const usePermissions = create<{ list: PermissionState[]; guide: boolean }>()(() => ({
  list: [],
  guide: false,
}))

export const PERMISSIONS: Record<Permission, { label: string; icon: IconName; why: string }> = {
  screen_recording: {
    label: t('屏幕录制'),
    icon: 'record',
    why: t('推送桌面应用和小程序的实时画面；未授权时成员看不到画面'),
  },
  accessibility: {
    label: t('辅助功能'),
    icon: 'hand',
    why: t('远程操作桌面应用和小程序、自动信任小程序项目；未授权时远程点击和输入不生效'),
  },
}

export async function refreshPermissions() {
  const list = await ipc.permissions()
  usePermissions.setState({ list })
  return list
}

export const openGuide = () => usePermissions.setState({ guide: true })
export const closeGuide = () => usePermissions.setState({ guide: false })

export function useMissing() {
  return usePermissions((s) => s.list).filter((p) => !p.granted)
}
