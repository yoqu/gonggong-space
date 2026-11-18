import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

type LayerState = { layers?: string[] } | null

/**
 * A layer over the chat on phones (thread, workbench) as a history entry of the same URL: the system back closes
 * the top layer instead of leaving the group, and closing it from the page takes its entry back.
 */
export function useBackLayer(layer: string, open: boolean, close: () => void, enabled: boolean) {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as LayerState
  const inHistory = !!state?.layers?.includes(layer)
  const was = useRef({ open: false, inHistory: false })
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const prev = was.current
    was.current = { open, inHistory }
    if (!enabled) return
    if (open && !inHistory) {
      if (prev.open && prev.inHistory) closeRef.current()
      else
        navigate(
          { pathname: location.pathname, search: location.search, hash: location.hash },
          { state: { ...state, layers: [...(state?.layers ?? []), layer] } },
        )
    } else if (!open && inHistory && prev.open) navigate(-1)
  })
}
