import type { AgentKind, MachineAgentsDto, ToolKind } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { errorText } from '../../lib/api'
import type { AgentsSource, ToolOpKind } from './source'

/** The install / upgrade in progress or last run; the machine runs one at a time. */
export interface ToolOp {
  kind: ToolKind
  which: ToolOpKind
  lines: string[]
  running: boolean
  failed: boolean
}

/** 全部升级 under way: how many of how many are done. */
export interface UpgradeBatch {
  done: number
  total: number
}

/** The machine's runtime and agents, and the one install / upgrade at a time with its live log. */
export function useAgentTools(source: AgentsSource) {
  const [state, setState] = useState<MachineAgentsDto | null>(null)
  const [error, setError] = useState('')
  const [op, setOp] = useState<ToolOp | null>(null)
  const [batch, setBatch] = useState<UpgradeBatch | null>(null)

  useEffect(() => {
    let live = true
    source.loadAgents().then(
      (s) => live && setState(s),
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [source])

  const run = async (kind: ToolKind, which: ToolOpKind) => {
    setOp({ kind, which, lines: [], running: true, failed: false })
    const append = (line: string) =>
      setOp((o) => (o?.kind === kind ? { ...o, lines: [...o.lines, line] } : o))
    try {
      const next = await source.runTool(kind, which, append)
      if (next) setState(next)
      setOp((o) => o && { ...o, running: false })
      return true
    } catch (e) {
      setOp((o) => o && { ...o, running: false, failed: true, lines: [...o.lines, errorText(e)] })
      return false
    }
  }

  /** Upgrades `kinds` one after another; stops at the first that fails, leaving its log open. */
  const upgradeAll = async (kinds: AgentKind[]) => {
    for (const [i, kind] of kinds.entries()) {
      setBatch({ done: i, total: kinds.length })
      if (!(await run(kind, 'upgrade'))) break
    }
    setBatch(null)
  }

  return { state, error, op, batch, busy: !!op?.running || !!batch, run, upgradeAll }
}
