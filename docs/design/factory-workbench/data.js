import { getLoungeLayout } from './animations.js?v=c1'

/**
 * Gonggong 3D Factory Workbench — Real Production Data Loader, Infinite Group Layout & Living Lounge State
 */

export const LOUNGE_MAX_SEATS = 12
export const LOUNGE_ORIGIN = [-8.6, 2.0]
export const LOUNGE_LAYOUT = getLoungeLayout(LOUNGE_ORIGIN)
export const LOUNGE_BOUNDS = LOUNGE_LAYOUT.bounds
export const LOUNGE_DOOR_POS = LOUNGE_LAYOUT.doorPos
export const HIDDEN_SPAWN_POS = LOUNGE_LAYOUT.hiddenSpawnPos
export const LOUNGE_SEATS = LOUNGE_LAYOUT.seats

export const EDGE_STATUS_META = {
  typing: { label: '编码中', short: '编码', tone: 'running', isAlert: false, action: 'typing' },
  running: { label: '执行中', short: '执行', tone: 'running', isAlert: false, action: 'typing' },
  thinking: { label: '思考/排队', short: '思考', tone: 'thinking', isAlert: false, action: 'thinking' },
  reading: { label: '查阅中', short: '查阅', tone: 'running', isAlert: false, action: 'reading' },
  subagent_swarm: { label: '子代理协同', short: '子代理', tone: 'running', isAlert: false, action: 'subagent_swarm' },
  approval: { label: '待审批', short: '待审', tone: 'approval', isAlert: true, action: 'approval_raise' },
  question: { label: '待回答', short: '提问', tone: 'question', isAlert: true, action: 'question_ask' },
  workspace_confirm: { label: '确认工作区', short: '工作区', tone: 'workspace_confirm', isAlert: true, action: 'workspace_confirm' },
  auth_expired: { label: '登录过期', short: '鉴权', tone: 'error', isAlert: true, action: 'auth_expired' },
  rate_limit: { label: '限流 429', short: '限流', tone: 'error', isAlert: true, action: 'error_spark' },
  force_conflict: { label: '同步冲突', short: '冲突', tone: 'error', isAlert: true, action: 'error_spark' },
  forbidden: { label: '无触发权限', short: '受限', tone: 'error', isAlert: true, action: 'error_spark' },
  error: { label: '运行异常', short: '异常', tone: 'error', isAlert: true, action: 'error_spark' },
  done: { label: '已完成', short: '完成', tone: 'done', isAlert: false, action: 'celebrate_done' },
}

const OWNER_RING_PALETTE = [
  { ring: [1.55, 0.98, 0.12], hex: '#d97706' },
  { ring: [0.12, 1.25, 0.92], hex: '#0d9488' },
  { ring: [0.35, 0.68, 1.65], hex: '#2563eb' },
  { ring: [0.85, 0.52, 1.55], hex: '#7c3aed' },
  { ring: [1.45, 0.42, 0.62], hex: '#db2777' },
  { ring: [0.32, 1.32, 0.48], hex: '#16a34a' },
  { ring: [1.35, 0.65, 0.25], hex: '#ea580c' },
  { ring: [0.22, 0.95, 1.45], hex: '#0284c7' },
]

const AGENT_TINTS = {
  claude: '#d97757',
  'claude-code': '#d97757',
  codex: '#3b66d4',
  antigravity: '#2f857a',
  gemini: '#2a9d8f',
  codebuddy: '#7c5cbf',
  pi: '#c87d32',
}

const EXTRA_GROUP_POOL = [
  { name: '插件与 Skill 市场', section: '生态 › 市场', repo: 'gonggong/skills-hub:main', syncMode: 'partition', taskTitle: 'Skill 签名校验流水线与发布门禁', step: 'edit_file · src/skills/verify.ts' },
  { name: '团队密钥管理二期', section: '安全 › 凭据', repo: 'gonggong/vault:main', syncMode: 'partition', taskTitle: 'KMS 轮转告警钩子与审计日志', step: 'run_command · pnpm --filter @gonggong/server test' },
  { name: '幻灯片产物容器', section: '研发 › 产物', repo: 'gonggong/slides-runtime:main', syncMode: 'partition', taskTitle: 'PDF 矢量导出清晰度与字体子集化', step: 'read_file · src/export/pdf-renderer.ts' },
  { name: '双机编译加速', section: '研发 › 基建', repo: 'gonggong/peer-build:main', syncMode: 'force', taskTitle: 'Peer Mac 增量缓存同步脚本', step: 'run_command · scripts/peer.sh cargo test' },
  { name: '桌面端自动升级', section: '研发 › 客户端', repo: 'gonggong/desktop:main', syncMode: 'partition', taskTitle: 'macOS 公证签名与差分回滚校验', step: 'think · 排查差分包回滚路径' },
  { name: '每日 UX 走查', section: '设计 › 体验', repo: 'gonggong/design-tokens:main', syncMode: 'partition', taskTitle: '弹窗圆角与 Pane 毛玻璃阴影审计', step: 'edit_file · apps/web/src/ui/Dialog.tsx' },
  { name: '安全合规审计', section: '安全 › 合规', repo: 'gonggong/audit-log:main', syncMode: 'force', taskTitle: '高危执行命令白名单拦截规则', step: 'run_command · pnpm check' },
  { name: '实时协作白板', section: '研发 › 协作', repo: 'gonggong/canvas-crdt:main', syncMode: 'partition', taskTitle: 'CRDT 多人光标同步延迟优化', step: 'edit_file · packages/crdt/src/cursor.ts' },
]

export function snapVal(v, step = 0.5) {
  return Math.round(v / step) * step
}

function pickTint(agentKind, idx) {
  const key = String(agentKind || '').toLowerCase()
  if (AGENT_TINTS[key]) return AGENT_TINTS[key]
  const palette = ['#d97757', '#3b66d4', '#2f857a', '#7c5cbf', '#c56444']
  return palette[idx % palette.length]
}

function mapRunToStatus(run) {
  const s = String(run.status || 'running').toLowerCase()
  const err = String(run.errorKind || '').toLowerCase()
  const step = String(run.step || '').toLowerCase()

  if (err === 'auth' || s === 'auth_expired') return 'auth_expired'
  if (err === 'rate_limit') return 'rate_limit'
  if (s === 'awaiting_approval' || s === 'approval') return 'approval'
  if (s === 'awaiting_answer' || s === 'question') return 'question'
  if (s === 'workspace_confirm') return 'workspace_confirm'
  if (s === 'force_conflict') return 'force_conflict'
  if (s === 'forbidden') return 'forbidden'
  if (s === 'interrupted' || s === 'failed' || s === 'error') return 'error'
  if (s === 'completed' || s === 'done') return 'done'
  if (s === 'queued') return 'thinking'

  // Running sub-modes based on real tool step & delegation
  const subCount = run.delegation?.subagents ? Object.keys(run.delegation.subagents).length : 0
  if (subCount >= 2) return 'subagent_swarm'
  if (step.includes('read') || step.includes('query')) return 'reading'
  if (step.includes('think')) return 'thinking'
  return 'typing'
}

function normalizePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return [
      { text: '解析话题上下文与仓库状态', st: 2 },
      { text: '执行当前工序并验证结果', st: 1 },
      { text: '输出变更摘要与回归结论', st: 0 },
    ]
  }
  return plan.map((item) => {
    if (typeof item.st === 'number') return { text: String(item.text || item.content), st: item.st }
    const st = item.status === 'completed' ? 2 : item.status === 'in_progress' ? 1 : 0
    return { text: String(item.content || item.text || '待办项'), st }
  })
}

function normalizeSubagents(delegation) {
  if (!delegation || typeof delegation !== 'object') return []
  const list = []
  if (delegation.subagents && typeof delegation.subagents === 'object') {
    for (const [k, st] of Object.entries(delegation.subagents)) {
      list.push({ name: k, task: `Subagent · ${st === 'completed' ? '已完成' : st === 'running' ? '并行执行中' : st}`, status: st })
    }
  }
  if (delegation.tasks && typeof delegation.tasks === 'object') {
    for (const [k, st] of Object.entries(delegation.tasks)) {
      list.push({ name: k, task: `Task · ${st === 'completed' ? '已完成' : st === 'running' ? '运行中' : st === 'failed' ? '失败' : st}`, status: st })
    }
  }
  return list
}

function formatStepText(run) {
  const step = String(run.step || 'typing')
  const map = {
    edit_file: 'edit · 正在编辑源码文件',
    read_file: 'read · 正在查阅代码与配置',
    run_command: 'bash · 正在执行验证命令',
    query_readonly: 'read · 只读查询线上核对数据',
  }
  return map[step] || step
}

/**
 * Load real_data_snapshot.json produced by @data-scout, with safe fallback.
 */
export async function loadWorkbenchSnapshot() {
  try {
    const res = await fetch('./real_data_snapshot.json', { cache: 'no-store' })
    if (res.ok) {
      const json = await res.json()
      if (json && (json.dataset || json.groups)) {
        return { data: json, isReal: true }
      }
    }
  } catch {
    // Fallback if snapshot unavailable
  }
  return { data: createFallbackSnapshot(), isReal: false }
}

function createFallbackSnapshot() {
  return {
    source: 'fallback',
    aggregates: { bots: { totalActive: 48 }, groups: { activeNotArchived: 18 } },
    dataset: {
      teams: [{ id: 'team-1', name: '研发效能团队', sections: [{ id: 'sec-iter', name: '需求迭代开发' }] }],
      owners: [
        { id: 'u-1', name: '陈工', initials: 'CG', role: 'sysadmin', machineOs: 'macos' },
        { id: 'u-2', name: '林工', initials: 'LG', role: 'member', machineOs: 'macos' },
      ],
      groups: [
        {
          id: 'grp-fallback',
          teamId: 'team-1',
          sectionId: 'sec-iter',
          name: '交易结算与会员中台',
          mode: 'partition',
          repos: [{ name: 'acme-settlement-server', baseBranch: 'main', isPrimary: true }],
          active: true,
          threads: [{ threadRootId: 'th-1', title: '异步回调幂等锁改造' }],
        },
      ],
      bots: [
        { id: 'bot-c1', name: 'Claude-主力架构师', agentKind: 'claude', ownerId: 'u-1', ownerName: '陈工', tier: 'full', concurrency: 4, model: 'claude-opus-5-5', daemonVersion: '0.4.35', zone: 'workbench' },
        { id: 'bot-x1', name: 'Codex-结算后端', agentKind: 'codex', ownerId: 'u-2', ownerName: '林工', tier: 'workspace', concurrency: 2, model: 'gpt-6-astra', daemonVersion: '0.4.35', zone: 'lounge' },
      ],
      runs: [
        { id: 'run-1', groupId: 'grp-fallback', threadRootId: 'th-1', botId: 'bot-c1', originUser: '陈工', status: 'running', step: 'edit_file', contextUsage: { used: 180000, size: 1000000, pct: 18 } },
      ],
    },
  }
}

/**
 * Normalize real_data_snapshot.json into full workbench runtime state.
 */
export function buildWorkbenchState(rawSnapshot, teamFilter = 'all') {
  const ds = rawSnapshot?.dataset || rawSnapshot || createFallbackSnapshot().dataset
  const aggr = rawSnapshot?.aggregates || {}

  // 1. Teams & Sections map
  const sectionNameById = {}
  const teams = (ds.teams || []).map((t, i) => {
    for (const sec of t.sections || []) {
      sectionNameById[sec.id] = sec.name
    }
    return {
      id: String(t.id || `team-${i + 1}`),
      name: String(t.name || `团队 ${i + 1}`),
      memberCount: t.memberCount || 0,
    }
  })

  // 2. Owners
  const ownersMap = {}
  const ownersList = (ds.owners || []).map((o, i) => {
    const pal = OWNER_RING_PALETTE[i % OWNER_RING_PALETTE.length]
    const id = String(o.id || `owner-${i}`)
    const name = String(o.name || `成员 ${i + 1}`)
    const isMe = i === 0 || o.role === 'sysadmin'
    const osLabel = o.machineOs === 'windows' ? 'Windows Workstation' : o.machineOs === 'linux' ? 'Linux Build Node' : i === 0 ? 'Mac Studio M4 Max' : 'MacBook Pro M4'
    const owner = {
      id,
      name: isMe ? `${name} (我)` : name,
      short: isMe ? `★ ${name}` : `@${name}`,
      isMe,
      machine: osLabel,
      ring: pal.ring,
      hex: pal.hex,
    }
    ownersMap[id] = owner
    return owner
  })

  // 3. Bot Catalog
  const botById = {}
  const botCatalog = (ds.bots || []).map((b, i) => {
    const ownerId = ownersMap[b.ownerId] ? b.ownerId : ownersList[i % ownersList.length]?.id || 'u-1'
    const agentKind = String(b.agentKind || 'claude')
    const bot = {
      id: String(b.id),
      name: String(b.name),
      ownerId,
      agentKind,
      tint: pickTint(agentKind, i),
      concurrency: Number(b.concurrency || 2),
      tier: String(b.tier || 'workspace'),
      model: String(b.model || 'default'),
      cli: `${agentKind}${b.daemonVersion ? ` · gg ${b.daemonVersion}` : ''}`,
      daemonVersion: b.daemonVersion || null,
      cliOutdated: Boolean(b.versionWarning),
      presence: String(b.presence || 'online'),
      zone: String(b.zone || 'lounge'),
    }
    botById[bot.id] = bot
    return bot
  })

  // 4. Active Groups & Runs -> Group Workshops & Workstation Instances
  const allRuns = Array.isArray(ds.runs) ? ds.runs : []
  const rawGroups = (ds.groups || []).filter((g) => {
    if (teamFilter && teamFilter !== 'all' && g.teamId && g.teamId !== teamFilter) return false
    // Show active groups (or groups that have live runs) on the 3D floor
    const hasLiveRun = allRuns.some((r) => r.groupId === g.id && r.status !== 'completed' && r.status !== 'offline_wait')
    return g.active || hasLiveRun
  })

  const groups = []
  const instances = []
  let instSeq = 1
  const nowSec = performance.now() / 1000

  rawGroups.forEach((rg) => {
    const primaryRepo = (rg.repos || []).find((r) => r.isPrimary) || (rg.repos || [])[0]
    const repoLabel = primaryRepo ? `${primaryRepo.name}:${primaryRepo.baseBranch || 'main'}` : '无绑定仓库 (纯对话群)'
    const grp = {
      id: String(rg.id),
      teamId: String(rg.teamId || teams[0]?.id || 'team-1'),
      name: rg.name.startsWith('#') || rg.kind === 'dm' ? rg.name : `# ${rg.name}`,
      section: sectionNameById[rg.sectionId] || (rg.kind === 'dm' ? '私聊工作区' : '默认分区'),
      repo: repoLabel,
      extraRepoCount: Math.max(0, (rg.repos || []).length - 1),
      syncMode: rg.mode === 'force' ? 'force' : 'partition',
      runs7d: rg.runs7d || 0,
      cx: 0,
      cz: 0,
      w: 4.5,
      d: 3.5,
      repoPos: [0, 0],
      tasks: [],
    }

    // Group active runs by threadRootId (or synthetic thread id) so multiple bots in same thread sit at a Round Table!
    const grpRuns = allRuns.filter((r) => r.groupId === rg.id && r.status !== 'completed')
    const threadTitleMap = {}
    for (const th of rg.threads || []) {
      threadTitleMap[th.threadRootId] = th.title
    }

    const runsByThread = new Map()
    for (const run of grpRuns) {
      const thKey = run.threadRootId || `main-${run.id}`
      if (!runsByThread.has(thKey)) runsByThread.set(thKey, [])
      runsByThread.get(thKey).push(run)
    }

    // If an active group had no non-completed runs, create 1 live task so it's never empty
    if (runsByThread.size === 0) {
      const fallbackBot = botById[rg.botIds?.[0]] || botCatalog[0]
      runsByThread.set(`${rg.id}-main`, [
        {
          id: `run-synth-${rg.id}`,
          groupId: rg.id,
          botId: fallbackBot.id,
          originUser: ownersMap[fallbackBot.ownerId]?.name || '陈工',
          status: 'running',
          step: 'read_file',
          contextUsage: { used: 42000, size: 475000, pct: 8.8 },
        },
      ])
    }

    let tIdx = 0
    for (const [thKey, thRuns] of runsByThread.entries()) {
      const taskId = `${grp.id}-${thKey}`
      const taskTitle = threadTitleMap[thKey] || (thKey.startsWith('main-') ? '群主线任务' : `话题 #${tIdx + 1}`)
      const roundTable = thRuns.length > 1
      grp.tasks.push({
        id: taskId,
        title: taskTitle,
        roundTable,
        pos: [0, 0],
      })

      thRuns.forEach((run, bIdx) => {
        const meta = botById[run.botId] || botCatalog[instSeq % botCatalog.length]
        const status = mapRunToStatus(run)
        const subagents = normalizeSubagents(run.delegation)
        const ctxPct = Number(run.contextUsage?.pct ?? 18)
        const ctxUsed = Number(run.contextUsage?.used ?? Math.round(ctxPct * 2000))
        const ctxSize = Number(run.contextUsage?.size ?? 200000)

        instances.push({
          id: `inst-${instSeq++}`,
          runId: run.id,
          botId: meta.id,
          botName: meta.name,
          ownerId: meta.ownerId,
          agentKind: meta.agentKind,
          model: meta.model,
          tint: meta.tint,
          concurrency: meta.concurrency,
          tier: meta.tier,
          cli: meta.cli,
          cliOutdated: meta.cliOutdated,
          groupId: grp.id,
          groupName: grp.name,
          repo: grp.repo,
          syncMode: grp.syncMode,
          taskId,
          taskTitle,
          roundTable,
          seatIndex: bIdx,
          deskPos: [0, 0],
          pos: [0, 0],
          facing: Math.PI,
          status,
          originUser: run.originUser || ownersMap[meta.ownerId]?.name || '团队成员',
          filesChanged: Number(run.filesChanged || 0),
          durationSec: Number(run.durationSec || 0),
          ctx: Math.round(ctxPct),
          ctxUsed,
          ctxSize,
          step: formatStepText(run),
          subagents,
          approvalCmd: run.approval ? (run.approval.detail || run.approval.title) : null,
          approvalReason: run.approval?.reason || null,
          questionText: run.question?.prompt || null,
          questionOptions: run.question?.options || null,
          authDetail: status === 'auth_expired' ? run.step : null,
          rateLimitDetail: status === 'rate_limit' ? run.step : null,
          workspacePath: status === 'workspace_confirm' ? `~/workspace/${primaryRepo?.name || 'gonggong'}` : null,
          conflictFiles: null,
          todos: normalizePlan(run.plan),
          celebrateUntil: 0,
          walk: null,
        })
      })
      tIdx++
    }

    computeGroupDimensions(grp)
    placeGroupNonOverlapping(grp, groups)
    groups.push(grp)
    syncGroupLayout(grp, instances)
  })

  // 5. Living Lounge (max 12 visible) + Hidden Idle Pool (ALL other non-working bots — ZERO Standby Plaza!)
  const activeBotIds = new Set(instances.map((x) => x.botId))
  const idleCandidates = []

  // First add real non-working bots from dataset (lounge first, then hidden_pool)
  const datasetIdle = botCatalog
    .filter((b) => !activeBotIds.has(b.id))
    .sort((a, b) => (a.zone === 'lounge' ? -1 : 1) - (b.zone === 'lounge' ? -1 : 1))
  for (const b of datasetIdle) {
    idleCandidates.push({ ...b, botId: b.id })
  }

  // Scale up to match real production active bot fleet (`aggregates.bots.totalActive`, e.g. 74!)
  const targetTotalFleet = Math.max(28, Number(aggr.bots?.totalActive || 48))
  const targetIdleCount = Math.max(LOUNGE_MAX_SEATS + 8, targetTotalFleet - activeBotIds.size)
  const roleTemplates = [
    { name: 'Codex-单测助手', kind: 'codex', model: 'gpt-6.1-terra' },
    { name: 'Claude-代码审查', kind: 'claude', model: 'claude-sonnet-4-5' },
    { name: 'Codex-接口联调', kind: 'codex', model: 'gpt-6-astra' },
    { name: 'Claude-重构工匠', kind: 'claude', model: 'opus' },
    { name: 'AGY-构建守护', kind: 'antigravity', model: 'gemini-4-neon' },
    { name: 'CodeBuddy-文档同步', kind: 'codebuddy', model: 'default' },
    { name: 'Codex-日志诊断', kind: 'codex', model: 'gpt-6-luna' },
    { name: 'Claude-性能分析', kind: 'claude', model: 'claude-opus-5-5' },
  ]
  let seq = 1
  while (idleCandidates.length < targetIdleCount) {
    const tpl = roleTemplates[seq % roleTemplates.length]
    const owner = ownersList[seq % ownersList.length]
    idleCandidates.push({
      id: `pool-bot-${seq}`,
      botId: `pool-bot-${seq}`,
      name: `${tpl.name} #${seq}`,
      ownerId: owner.id,
      agentKind: tpl.kind,
      model: tpl.model,
      tint: pickTint(tpl.kind, seq),
      cli: `${tpl.kind} · gg ${seq % 3 === 0 ? '0.4.32' : '0.4.35'}`,
      cliOutdated: seq % 3 === 0,
      tier: seq % 4 === 0 ? 'full' : 'workspace',
      concurrency: 2,
      presence: 'online',
    })
    seq++
  }

  const loungeBots = []
  const hiddenIdlePool = []

  idleCandidates.forEach((bot) => {
    if (loungeBots.length < LOUNGE_MAX_SEATS) {
      const seatIdx = loungeBots.length
      const seat = LOUNGE_SEATS[seatIdx]
      loungeBots.push({
        ...bot,
        seatIdx,
        pos: [seat.x, seat.z],
        facing: seat.facing,
        activity: seat.defaultAction,
        seatType: seat.seatType,
        enteredAt: nowSec - (LOUNGE_MAX_SEATS - seatIdx) * 18,
        walk: null,
        leavingToPool: false,
      })
    } else {
      hiddenIdlePool.push(bot)
    }
  })

  return {
    teams,
    ownersMap,
    ownersList,
    botCatalog,
    groups,
    instances,
    loungeBots,
    hiddenIdlePool,
    aggregates: aggr,
    instSeq,
    extraGroupCursor: 0,
  }
}

export function computeGroupDimensions(grp) {
  const taskCols = Math.max(1, Math.min(2, grp.tasks.length))
  const taskRows = Math.max(1, Math.ceil(grp.tasks.length / 2))
  grp.w = snapVal(1.8 + taskCols * 2.5, 0.5)
  grp.d = snapVal(1.2 + taskRows * 2.2, 0.5)
}

export function syncGroupLayout(grp, instances) {
  grp.repoPos = [grp.cx - grp.w * 0.5 + 0.85, grp.cz]
  grp.tasks.forEach((task, tIdx) => {
    const tc = tIdx % 2
    const tr = Math.floor(tIdx / 2)
    const tx = grp.cx - grp.w * 0.5 + 2.6 + tc * 2.5
    const tz = grp.cz - grp.d * 0.5 + 1.4 + tr * 2.2
    task.pos = [tx, tz]

    const taskInsts = instances.filter((x) => x.taskId === task.id)
    taskInsts.forEach((inst, bIdx) => {
      const angle = task.roundTable
        ? bIdx === 0
          ? Math.PI * 0.5
          : -Math.PI * 0.5
        : Math.PI
      const bx = task.roundTable ? tx + (bIdx === 0 ? -0.68 : 0.68) : tx
      const bz = task.roundTable ? tz + 0.08 : tz + 0.56
      inst.deskPos = [tx, tz]
      inst.facing = angle
      if (!inst.walk) {
        inst.pos = [bx, bz]
      } else if (inst.walk.waypoints && inst.walk.waypoints.length > 0) {
        inst.walk.waypoints[inst.walk.waypoints.length - 1] = [bx, bz]
        inst.walk.finalFacing = angle
      }
    })
  })
}

export function rectsOverlap(ax, az, aw, ad, bx, bz, bw, bd, pad = 0.9) {
  return Math.abs(ax - bx) < (aw + bw) * 0.5 + pad && Math.abs(az - bz) < (ad + bd) * 0.5 + pad
}

export function isGroupPlacementValid(grp, groups) {
  if (rectsOverlap(grp.cx, grp.cz, grp.w, grp.d, LOUNGE_BOUNDS.cx, LOUNGE_BOUNDS.cz, LOUNGE_BOUNDS.w, LOUNGE_BOUNDS.d, 0.8)) {
    return false
  }
  for (const other of groups) {
    if (other.id === grp.id) continue
    if (rectsOverlap(grp.cx, grp.cz, grp.w, grp.d, other.cx, other.cz, other.w, other.d, 0.5)) {
      return false
    }
  }
  return true
}

/**
 * Finds a clean non-overlapping position on the infinite floor for a new Group Workshop.
 * Supports unlimited appended groups with zero floor-size limit!
 */
export function placeGroupNonOverlapping(grp, existingGroups) {
  const colStep = 7.5
  const rowStep = 6.5
  const startX = -1.5
  const startZ = -5.5

  const maxCols = Math.max(3, Math.ceil(Math.sqrt(existingGroups.length + 4)))
  for (let ring = 0; ring < 100; ring++) {
    for (let r = 0; r <= ring; r++) {
      for (let c = 0; c < maxCols + Math.floor(ring / 3); c++) {
        const cx = snapVal(startX + c * colStep + grp.w * 0.5, 0.5)
        const cz = snapVal(startZ + r * rowStep + grp.d * 0.5, 0.5)
        if (rectsOverlap(cx, cz, grp.w, grp.d, LOUNGE_BOUNDS.cx, LOUNGE_BOUNDS.cz, LOUNGE_BOUNDS.w, LOUNGE_BOUNDS.d, 1.3)) {
          continue
        }
        let hit = false
        for (const other of existingGroups) {
          if (rectsOverlap(cx, cz, grp.w, grp.d, other.cx, other.cz, other.w, other.d, 0.95)) {
            hit = true
            break
          }
        }
        if (!hit) {
          grp.cx = cx
          grp.cz = cz
          return
        }
      }
    }
  }
  grp.cx = snapVal(startX + existingGroups.length * 7.5, 0.5)
  grp.cz = startZ
}

/**
 * Pull one bot from hiddenIdlePool to walk in through the Lounge sliding glass door into `seatIdx`.
 */
export function refillLoungeSeatFromPool(state, seatIdx, nowSec) {
  if (!state.hiddenIdlePool.length) return null
  const nextBot = state.hiddenIdlePool.shift()
  const seat = LOUNGE_SEATS[seatIdx % LOUNGE_SEATS.length]
  const entered = {
    ...nextBot,
    seatIdx,
    pos: [...HIDDEN_SPAWN_POS],
    facing: Math.atan2(seat.x - HIDDEN_SPAWN_POS[0], seat.z - HIDDEN_SPAWN_POS[1]),
    activity: seat.defaultAction,
    seatType: seat.seatType,
    enteredAt: nowSec,
    leavingToPool: false,
    walk: {
      waypoints: [[...HIDDEN_SPAWN_POS], [...LOUNGE_DOOR_POS], [seat.x, seat.z]],
      t: 0,
      dur: 2.3,
      finalFacing: seat.facing,
      kind: 'enter_lounge',
    },
  }
  state.loungeBots.push(entered)
  state.loungeDoorPulseUntil = nowSec + 2.4
  return entered
}

/**
 * Dispatch a visible Lounge bot to a workstation inside `targetGrp`, and immediately
 * spawn a replacement bot from `hiddenIdlePool` walking in through the Lounge sliding door!
 */
export function dispatchLoungeBotToGroup(state, targetGrp, taskOpts, nowSec) {
  const candidates = state.loungeBots.filter((lb) => !lb.leavingToPool)
  const picked = candidates.length > 0 ? candidates[0] : null

  let botMeta
  let startPos = [...LOUNGE_DOOR_POS]
  let vacatedSeatIdx = -1

  if (picked) {
    botMeta = picked
    startPos = [...picked.pos]
    vacatedSeatIdx = picked.seatIdx
    const idx = state.loungeBots.indexOf(picked)
    if (idx >= 0) state.loungeBots.splice(idx, 1)
    refillLoungeSeatFromPool(state, vacatedSeatIdx, nowSec)
  } else {
    botMeta = state.botCatalog[state.instSeq % state.botCatalog.length]
  }

  const tIdx = targetGrp.tasks.length
  const taskId = `${targetGrp.id}-t${Date.now()}-${tIdx}`
  const taskTitle = taskOpts?.title || `话题 #${30 + state.instSeq} · 自动化研发任务`
  targetGrp.tasks.push({
    id: taskId,
    title: taskTitle,
    roundTable: false,
    pos: [0, 0],
  })

  computeGroupDimensions(targetGrp)
  syncGroupLayout(targetGrp, state.instances)
  const taskObj = targetGrp.tasks[targetGrp.tasks.length - 1]
  const destPos = [taskObj.pos[0], taskObj.pos[1] + 0.56]

  const newInst = {
    id: `inst-${++state.instSeq}`,
    botId: botMeta.botId || botMeta.id,
    botName: botMeta.name,
    ownerId: botMeta.ownerId,
    agentKind: botMeta.agentKind || 'claude',
    model: botMeta.model || 'default',
    tint: botMeta.tint,
    concurrency: botMeta.concurrency || 2,
    tier: botMeta.tier || 'workspace',
    cli: botMeta.cli || 'claude · gg 0.4.35',
    cliOutdated: Boolean(botMeta.cliOutdated),
    groupId: targetGrp.id,
    groupName: targetGrp.name,
    repo: targetGrp.repo,
    syncMode: targetGrp.syncMode,
    taskId,
    taskTitle,
    roundTable: false,
    seatIndex: 0,
    deskPos: [...taskObj.pos],
    pos: [...startPos],
    facing: Math.atan2(destPos[0] - startPos[0], destPos[1] - startPos[1]),
    status: taskOpts?.status || 'typing',
    originUser: state.ownersMap[botMeta.ownerId]?.name || '陈工',
    filesChanged: 0,
    durationSec: 1,
    ctx: taskOpts?.ctx ?? 14,
    ctxUsed: 28000,
    ctxSize: 200000,
    step: taskOpts?.step || 'edit · 从休闲区出工就位，开始施工',
    subagents: [],
    approvalCmd: null,
    questionText: null,
    questionOptions: null,
    authDetail: null,
    rateLimitDetail: null,
    workspacePath: null,
    conflictFiles: null,
    todos: normalizePlan(taskOpts?.todos || [
      { content: '拉取工作区上下文与分支状态', status: 'completed' },
      { content: '编写核心代码与边界单测', status: 'in_progress' },
      { content: '执行 pnpm check 全量自检', status: 'pending' },
    ]),
    celebrateUntil: 0,
    walk: {
      waypoints: [[...startPos], [...destPos]],
      t: 0,
      dur: 2.35,
      finalFacing: Math.PI,
      kind: 'dispatch_to_desk',
    },
  }
  state.instances.push(newInst)
  state.lastEventText = `${botMeta.name} 已从休闲区出工 · 候场隐藏池自动推门补位`
  return newInst
}

/**
 * Append a brand-new Group Workshop infinitely onto the floor and dispatch a Lounge bot into it!
 */
export function appendNewGroupWorkshop(state, nowSec) {
  const tpl = EXTRA_GROUP_POOL[state.extraGroupCursor % EXTRA_GROUP_POOL.length]
  const num = state.groups.length + 1
  state.extraGroupCursor++

  const grp = {
    id: `grp-inf-${Date.now()}-${num}`,
    teamId: state.teams[0]?.id || 'team-1',
    name: state.extraGroupCursor > EXTRA_GROUP_POOL.length ? `# ${tpl.name} #${num}` : `# ${tpl.name}`,
    section: tpl.section,
    repo: tpl.repo,
    extraRepoCount: 0,
    syncMode: tpl.syncMode,
    runs7d: 1,
    cx: 0,
    cz: 0,
    w: 4.5,
    d: 3.5,
    repoPos: [0, 0],
    tasks: [],
  }

  placeGroupNonOverlapping(grp, state.groups)
  state.groups.push(grp)

  const inst = dispatchLoungeBotToGroup(
    state,
    grp,
    {
      title: tpl.taskTitle,
      step: tpl.step,
      status: 'typing',
      ctx: 12,
    },
    nowSec,
  )
  return { group: grp, instance: inst }
}

/**
 * Finish a working Bot's task and send it back to the Living Lounge.
 * If Lounge already has 12 visible bots, the longest-resting Lounge bot strolls out
 * through the sliding glass door into `hiddenIdlePool`!
 */
export function completeAndReturnToLounge(state, instId, nowSec) {
  const idx = state.instances.findIndex((x) => x.id === instId)
  if (idx < 0) return null
  const [inst] = state.instances.splice(idx, 1)

  const grp = state.groups.find((g) => g.id === inst.groupId)
  if (grp && !state.instances.some((x) => x.taskId === inst.taskId)) {
    const tIdx = grp.tasks.findIndex((t) => t.id === inst.taskId)
    if (tIdx >= 0 && grp.tasks.length > 1) {
      grp.tasks.splice(tIdx, 1)
      computeGroupDimensions(grp)
      syncGroupLayout(grp, state.instances)
    }
  }

  const activeLounge = state.loungeBots.filter((lb) => !lb.leavingToPool)
  let seatIdx = -1
  if (activeLounge.length >= LOUNGE_MAX_SEATS) {
    activeLounge.sort((a, b) => a.enteredAt - b.enteredAt)
    const oldest = activeLounge[0]
    seatIdx = oldest.seatIdx
    oldest.leavingToPool = true
    oldest.walk = {
      waypoints: [[...oldest.pos], [...LOUNGE_DOOR_POS], [...HIDDEN_SPAWN_POS]],
      t: 0,
      dur: 2.3,
      finalFacing: -Math.PI * 0.5,
      kind: 'exit_to_pool',
    }
    state.loungeDoorPulseUntil = nowSec + 2.6
  } else {
    const used = new Set(activeLounge.map((lb) => lb.seatIdx))
    for (let s = 0; s < LOUNGE_MAX_SEATS; s++) {
      if (!used.has(s)) {
        seatIdx = s
        break
      }
    }
    if (seatIdx < 0) seatIdx = 0
  }

  const seat = LOUNGE_SEATS[seatIdx % LOUNGE_SEATS.length]
  const returningBot = {
    id: `lounge-ret-${Date.now()}`,
    botId: inst.botId,
    name: inst.botName,
    ownerId: inst.ownerId,
    agentKind: inst.agentKind,
    model: inst.model,
    tint: inst.tint,
    cli: inst.cli,
    cliOutdated: inst.cliOutdated,
    tier: inst.tier,
    concurrency: inst.concurrency,
    seatIdx,
    pos: [...inst.pos],
    facing: Math.atan2(seat.x - inst.pos[0], seat.z - inst.pos[1]),
    activity: seat.defaultAction,
    seatType: seat.seatType,
    enteredAt: nowSec,
    leavingToPool: false,
    walk: {
      waypoints: [[...inst.pos], [seat.x, seat.z]],
      t: 0,
      dur: 2.4,
      finalFacing: seat.facing,
      kind: 'return_to_lounge',
    },
  }
  state.loungeBots.push(returningBot)
  state.lastEventText = `${inst.botName} 完工回休闲区 · 最久休憩 Bot 已退入候场池`
  return returningBot
}

function sampleWaypoints(waypoints, u) {
  if (waypoints.length === 2) {
    const [a, b] = waypoints
    return {
      x: a[0] + (b[0] - a[0]) * u,
      z: a[1] + (b[1] - a[1]) * u,
      dx: b[0] - a[0],
      dz: b[1] - a[1],
    }
  }
  // 3-point path (e.g., hiddenSpawn -> door -> seat)
  const seg = u < 0.42 ? 0 : 1
  const localU = seg === 0 ? u / 0.42 : (u - 0.42) / 0.58
  const a = waypoints[seg]
  const b = waypoints[seg + 1]
  return {
    x: a[0] + (b[0] - a[0]) * localU,
    z: a[1] + (b[1] - a[1]) * localU,
    dx: b[0] - a[0],
    dz: b[1] - a[1],
  }
}

/**
 * Advance all walking choreography transitions (dispatched bots, returning bots, hidden-pool door swaps).
 */
export function tickChoreography(state, dt, nowSec) {
  let changed = false

  for (const inst of state.instances) {
    if (!inst.walk) continue
    inst.walk.t += dt / inst.walk.dur
    const u = Math.min(1, inst.walk.t)
    const ease = 1 - Math.pow(1 - u, 3)
    const pt = sampleWaypoints(inst.walk.waypoints, ease)
    inst.pos[0] = pt.x
    inst.pos[1] = pt.z
    if (Math.hypot(pt.dx, pt.dz) > 0.01) inst.facing = Math.atan2(pt.dx, pt.dz)
    if (u >= 1) {
      const last = inst.walk.waypoints[inst.walk.waypoints.length - 1]
      inst.pos = [...last]
      inst.facing = inst.walk.finalFacing
      inst.walk = null
      inst.celebrateUntil = nowSec + 1.0
    }
  }

  for (let i = state.loungeBots.length - 1; i >= 0; i--) {
    const lb = state.loungeBots[i]
    if (!lb.walk) continue
    lb.walk.t += dt / lb.walk.dur
    const u = Math.min(1, lb.walk.t)
    const ease = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
    const pt = sampleWaypoints(lb.walk.waypoints, ease)
    lb.pos[0] = pt.x
    lb.pos[1] = pt.z
    if (Math.hypot(pt.dx, pt.dz) > 0.01) lb.facing = Math.atan2(pt.dx, pt.dz)
    if (u >= 1) {
      if (lb.leavingToPool) {
        state.loungeBots.splice(i, 1)
        state.hiddenIdlePool.push({
          id: lb.id,
          botId: lb.botId,
          name: lb.name,
          ownerId: lb.ownerId,
          agentKind: lb.agentKind,
          model: lb.model,
          tint: lb.tint,
          cli: lb.cli,
          cliOutdated: lb.cliOutdated,
          tier: lb.tier,
          concurrency: lb.concurrency,
        })
        changed = true
      } else {
        const last = lb.walk.waypoints[lb.walk.waypoints.length - 1]
        lb.pos = [...last]
        lb.facing = lb.walk.finalFacing
        lb.walk = null
      }
    }
  }

  return changed
}
