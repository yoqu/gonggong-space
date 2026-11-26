import type { ApprovalGuideState, UserOnboarding } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'

const KEY_PREFIX = 'gg.approvalGuide.'
const FATIGUE_LIMIT = 3

interface StoredGuide {
  status: 'active' | ApprovalGuideState
  seen: number
}

const DEFAULT_STATE: StoredGuide = { status: 'active', seen: 0 }

const storageKey = (userId: string) => `${KEY_PREFIX}${userId}`

function readLocal(userId: string): StoredGuide {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<StoredGuide>
    const status =
      parsed.status === 'dismissed' || parsed.status === 'graduated' || parsed.status === 'fatigued'
        ? parsed.status
        : 'active'
    const seen = typeof parsed.seen === 'number' && parsed.seen >= 0 ? parsed.seen : 0
    return { status, seen }
  } catch {
    return DEFAULT_STATE
  }
}

function writeLocal(userId: string, next: StoredGuide) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next))
  } catch {
    // storage unavailable (private mode): in-memory and server state still hold
  }
}

function resolveGuide(userId: string, server?: UserOnboarding): StoredGuide {
  const local = readLocal(userId)
  const serverStatus = server?.approvalGuide
  const status: StoredGuide['status'] = local.status !== 'active' ? local.status : (serverStatus ?? 'active')
  const seen = Math.max(local.seen, server?.approvalGuideSeen ?? 0)
  return { status, seen }
}

function syncSession(patch: Partial<UserOnboarding>) {
  const s = useSession.getState()
  if (!s.tenancy) return
  useSession.setState({
    tenancy: {
      ...s.tenancy,
      onboarding: { ...s.tenancy.onboarding, ...patch },
    },
  })
}

const countedApprovals = new Set<string>()
const useGuideStore = create<{ rev: number; holders: string[] }>()(() => ({ rev: 0, holders: [] }))
const bump = () => useGuideStore.setState((s) => ({ rev: s.rev + 1 }))

function persistGuide(userId: string, next: StoredGuide, patch: Partial<UserOnboarding>) {
  writeLocal(userId, next)
  syncSession(patch)
  bump()
  void api.patch<UserOnboarding>('/me/onboarding', patch).catch(() => {})
}

/** Whether the bottom permission-settings tip should appear on a pending approval card for `userId`. */
export function useApprovalGuideActive(userId: string | undefined): boolean {
  useGuideStore((s) => s.rev)
  const onboarding = useSession((s) => s.tenancy?.onboarding)
  if (!userId) return false
  return resolveGuide(userId, onboarding).status === 'active'
}

/** With several pending cards on screen only the latest one carries the tip, so it is not repeated on each. */
export function useApprovalGuideHolder(approvalId: string, eligible: boolean): boolean {
  useEffect(() => {
    if (!eligible) return
    useGuideStore.setState((s) => ({ holders: [...s.holders.filter((h) => h !== approvalId), approvalId] }))
    return () => useGuideStore.setState((s) => ({ holders: s.holders.filter((h) => h !== approvalId) }))
  }, [approvalId, eligible])
  return useGuideStore((s) => eligible && s.holders.at(-1) === approvalId)
}

/** Exit 1: user clicked 「不再提醒」. */
export function dismissApprovalGuide(userId: string) {
  const current = resolveGuide(userId, useSession.getState().tenancy?.onboarding)
  if (current.status !== 'active') return
  persistGuide(userId, { ...current, status: 'dismissed' }, { approvalGuide: 'dismissed' })
}

/** Exit 2: user saved any Bot permission settings (or reset a group override). */
export function graduateApprovalGuide(userId: string | undefined) {
  if (!userId) return
  const current = resolveGuide(userId, useSession.getState().tenancy?.onboarding)
  if (current.status !== 'active') return
  persistGuide(userId, { ...current, status: 'graduated' }, { approvalGuide: 'graduated' })
}

/** Exit 3: after 3 ignored approval decisions without opening settings, collapse silently. */
export function recordApprovalDecision(userId: string | undefined, approvalId: string) {
  if (!userId || countedApprovals.has(approvalId)) return
  const current = resolveGuide(userId, useSession.getState().tenancy?.onboarding)
  if (current.status !== 'active') return
  countedApprovals.add(approvalId)
  const seen = current.seen + 1
  if (seen >= FATIGUE_LIMIT) {
    persistGuide(userId, { status: 'fatigued', seen }, { approvalGuide: 'fatigued', approvalGuideSeen: seen })
  } else {
    persistGuide(userId, { status: 'active', seen }, { approvalGuideSeen: seen })
  }
}

/** Tests: clears cached guide states and deduplicated approval IDs. */
export function resetApprovalGuide() {
  countedApprovals.clear()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY_PREFIX)) localStorage.removeItem(k)
    }
  } catch {
    // ignore
  }
  bump()
}
