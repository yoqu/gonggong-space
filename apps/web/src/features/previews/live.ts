import {
  CAST_INPUT_TOPIC,
  CAST_KEYS,
  type CastInput,
  LIVE_WATCH_SECONDS,
  type LiveTokenDto,
} from '@gonggong/protocol'
import {
  ConnectionQuality,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { errorText } from '../auth/AuthCard'
import {
  type Grade,
  grade,
  type LiveStats,
  measure,
  type QualityPick,
  qualityPicks,
  type Settled,
  sample,
  settle,
} from './stats'

/** Renews the watch lease well within its lifetime. */
const RENEW_MS = (LIVE_WATCH_SECONDS * 1000) / 3

/** The server's own LiveKit, proxied at `/livekit` on this origin. */
const serverLiveKit = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`

/**
 * Watches a live preview (plan B4): keeps the machine publishing while mounted, joins the preview's room and hands
 * back its video track; `send` delivers input to the machine (LiveKit drops it unless this member has control).
 */
export function useLiveRoom(previewId: string) {
  const [track, setTrack] = useState<RemoteTrack | null>(null)
  const [publication, setPublication] = useState<RemoteTrackPublication | null>(null)
  const [weak, setWeak] = useState<Weak>({ machine: false, me: false })
  const [error, setError] = useState<string | null>(null)
  const room = useRef<Room | null>(null)

  useEffect(() => {
    let left = false
    // No adaptive stream: it would pick the quality layer by the box's size, and a small box blurs the text.
    const r = new Room({ adaptiveStream: false })
    room.current = r
    r.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, pub: RemoteTrackPublication) => {
      if (t.kind !== Track.Kind.Video) return
      setTrack(t)
      setPublication(pub)
    })
    r.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => setTrack((cur) => (cur === t ? null : cur)))
    r.on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, who: Participant) => {
      const bad = q === ConnectionQuality.Poor || q === ConnectionQuality.Lost
      if (who.identity === CAST) setWeak((w) => ({ ...w, machine: bad }))
      else if (who.identity === r.localParticipant.identity) setWeak((w) => ({ ...w, me: bad }))
    })
    const watch = () => api.post(`/previews/${previewId}/watch`).catch(() => {})
    void watch()
    const timer = setInterval(watch, RENEW_MS)
    api
      .post<LiveTokenDto>(`/previews/${previewId}/live`)
      .then(({ url, token }) => (left ? undefined : r.connect(url ?? serverLiveKit(), token)))
      .catch((e) => {
        if (!left) setError(errorText(e))
      })
    return () => {
      left = true
      clearInterval(timer)
      setTrack(null)
      setPublication(null)
      void r.disconnect()
    }
  }, [previewId])

  const send = useCallback((input: CastInput) => {
    void room.current?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(input)), {
      reliable: true,
      destinationIdentities: [CAST],
      topic: CAST_INPUT_TOPIC,
    })
  }, [])

  return { track, publication, weak, error, send }
}

/** gg-cast's identity in the room. */
const CAST = 'cast'

/** Whose connection LiveKit rates poor: the machine's upload, or this viewer's own. */
export type Weak = { machine: boolean; me: boolean }

const STATS_MS = 1000

/** The picture's figures, once a second, with a grade that only changes once it holds (see `settle`). */
export function useLiveStats(track: RemoteTrack | null) {
  const [state, setState] = useState<{ stats: LiveStats; grade: Grade } | null>(null)

  useEffect(() => {
    if (!track) return
    let prev: ReturnType<typeof sample> | undefined
    let settled: Settled | undefined
    const timer = setInterval(async () => {
      const report = await track.getRTCStatsReport()
      if (!report) return
      const cur = sample(report, Date.now())
      if (prev) {
        const stats = measure(cur, prev)
        settled = settle(settled, grade(stats))
        setState({ stats, grade: settled.grade })
      }
      prev = cur
    }, STATS_MS)
    return () => {
      clearInterval(timer)
      setState(null)
    }
  }, [track])

  return state
}

const QUALITY_KEY = 'gonggong.live.quality'

function savedPick(): QualityPick {
  try {
    const v = localStorage.getItem(QUALITY_KEY)
    return v === 'high' || v === 'medium' || v === 'low' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * This viewer's quality layer: automatic by default (LiveKit lowers it to fit their bandwidth), or a layer they pick,
 * remembered in this browser. Picks are caps; LiveKit still steps down when the network cannot carry them.
 */
export function useQuality(publication: RemoteTrackPublication | null) {
  const [pick, setPick] = useState(savedPick)
  const info = publication?.trackInfo
  const picks = useMemo(() => qualityPicks(info?.codecs[0]?.layers ?? info?.layers ?? []), [info])
  const chosen = picks.find((p) => p.value === pick) ?? picks[0]

  useEffect(() => {
    if (publication && chosen) publication.setVideoQuality(chosen.quality)
  }, [publication, chosen])

  const choose = useCallback((v: QualityPick) => {
    setPick(v)
    try {
      localStorage.setItem(QUALITY_KEY, v)
    } catch {}
  }, [])

  return { picks, pick: chosen?.value ?? 'auto', choose }
}

/**
 * Where a pointer is on the picture, as fractions of the frame; null over the letterbox bars (object-fit: contain),
 * or with `clamp` the nearest edge (a drag released outside must still release on the machine).
 */
export function framePoint(video: HTMLVideoElement, clientX: number, clientY: number, clamp = false) {
  const { videoWidth: vw, videoHeight: vh } = video
  if (!vw || !vh) return null
  const r = video.getBoundingClientRect()
  const scale = Math.min(r.width / vw, r.height / vh)
  const [w, h] = [vw * scale, vh * scale]
  const x = (clientX - r.left - (r.width - w) / 2) / w
  const y = (clientY - r.top - (r.height - h) / 2) / h
  const inside = (v: number) => v >= 0 && v <= 1
  if (clamp) return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
  return inside(x) && inside(y) ? { x, y } : null
}

type Mods = Extract<CastInput, { t: 'key' }>['mods']

/** A key press as input: named keys and shortcuts; null for characters, which arrive as typed text. */
export function keyInput(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): CastInput | null {
  const mods: Mods = []
  if (e.metaKey) mods.push('meta')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if ((CAST_KEYS as readonly string[]).includes(e.key))
    return { t: 'key', key: e.key as (typeof CAST_KEYS)[number], mods }
  const shortcut = (e.metaKey || e.ctrlKey) && /^[a-z0-9]$/i.test(e.key)
  return shortcut ? { t: 'key', key: e.key.toLowerCase(), mods } : null
}
