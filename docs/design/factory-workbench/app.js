import {
  AGENT_FIGURINE_META,
  ALL_FIGURINE_META,
  ROLE_FIGURINE_META,
  critDamp,
  drawFigurine,
  drawLoungeEnvironment,
  drawWorkshopEnclosure,
  normalizeBotAction,
  resolveCampusFigurineKey,
} from './animations.js?v=c2'
import {
  EDGE_STATUS_META,
  LOUNGE_BOUNDS,
  LOUNGE_MAX_SEATS,
  LOUNGE_ORIGIN,
  appendNewGroupWorkshop,
  buildWorkbenchState,
  completeAndReturnToLounge,
  computeGroupDimensions,
  dispatchLoungeBotToGroup,
  isGroupPlacementValid,
  loadWorkbenchSnapshot,
  syncGroupLayout,
  tickChoreography,
} from './data.js?v=c2'
import {
  drawErgonomicDesk,
  drawFicusTree,
  drawMonsteraPlanter,
  drawOliveTree,
  drawPathBollard,
  drawPlanterTrough,
  drawPocketGardenIsland,
  drawWayfindingStele,
  drawWorkshopArchitecture,
} from './decor.js?v=c2'
import { daylightAt, presetDate } from './daylight.js?v=c2'
import { setVentilation } from './breeze.js?v=c2'
import { renderInspector } from './inspector.js?v=c2'
import { exportFigurineGLB } from './geometry.js?v=c2'
import {
  ensureGLBLoaded,
  getGLBDownloadInfo,
  getGLBLoadedCount,
  getGLBModel,
  onGLBLoaded,
  preloadAllGLBs,
} from './glb_loader.js?v=c2'
import {
  CleanroomRenderer,
  MAT,
  SpringCamera,
  TRS,
  projectWorldToScreen,
  renderInfiniteFloor,
  screenToGroundRay,
  snapGroupToGrid,
} from './renderer.js?v=c2'

// ── Application State ──
const state = {
  snapshotRaw: null,
  isRealData: false,
  teamFilter: 'all',
  ownerFilter: 'all',
  view: 'floor', // floor | studio | blueprints
  navMode: 'pan', // pan | orbit
  lighting: 'live', // live | morning | noon | dusk | night (previews on today's date)
  daylight: null,
  night: false,
  nightBlend: 0,
  goldenBlend: 0,
  selectedInstanceId: null,
  hoveredEntity: null, // { type: 'instance' | 'lounge', data, screenX, screenY }
  draggingGroupId: null,
  dragOffset: [0, 0],
  dragValid: true,

  studioMode: 'hero', // 'hero' | 'shelf'
  studioFigurineKey: 'claude',
  studioFinish: 'default', // 'default' | 'vinyl' | 'ceramic' | 'crystal' | 'metal'
  studioClip: 'idle',
  studioExplode: 0,
  studioTargetExplode: 0,
  studioHex: '',
  hoveredShelfKey: null,
  savedSidebarCollapsed: null,

  teams: [],
  ownersMap: {},
  ownersList: [],
  botCatalog: [],
  groups: [],
  instances: [],
  loungeBots: [],
  hiddenIdlePool: [],
  aggregates: null,
  instSeq: 1,
  extraGroupCursor: 0,
  loungeDoorOpen: 0,
  loungeDoorVel: 0,
  loungeDoorPulseUntil: 0,
  lastEventText: '',
}

// Level 45° bird's-eye: yaw 0 keeps the floor grid square to the screen, north (−Z) at the top.
const TOP_PITCH = Math.PI / 4

const cam = new SpringCamera({
  yaw: 0,
  pitch: TOP_PITCH,
  dist: 21.0,
  target: [1.5, 0.2, 0.5],
  smoothTime: 0.14,
  mode: 'pan',
  minDist: 4.8,
  maxDist: 68.0,
})

function computeCampusExtents() {
  let minX = LOUNGE_BOUNDS.minX - 1.5
  let maxX = LOUNGE_BOUNDS.maxX + 1.5
  let minZ = LOUNGE_BOUNDS.minZ - 1.5
  let maxZ = LOUNGE_BOUNDS.maxZ + 1.5
  for (const g of state.groups) {
    minX = Math.min(minX, g.cx - g.w * 0.5 - 1.5)
    maxX = Math.max(maxX, g.cx + g.w * 0.5 + 1.5)
    minZ = Math.min(minZ, g.cz - g.d * 0.5 - 1.5)
    maxZ = Math.max(maxZ, g.cz + g.d * 0.5 + 1.5)
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    span: Math.max(maxX - minX, maxZ - minZ),
  }
}

function setCameraPreset(preset) {
  if (preset === 'macro') {
    const ext = computeCampusExtents()
    cam.setLimits({ minDist: 4.8, maxDist: 86.0 })
    cam.flyTo([ext.cx, 0.2, ext.cz], {
      yaw: 0,
      pitch: TOP_PITCH,
      dist: Math.min(76, Math.max(35.0, ext.span * 1.32)),
    })
  } else if (preset === 'meso') {
    const ext = computeCampusExtents()
    cam.setLimits({ minDist: 4.8, maxDist: 76.0 })
    cam.flyTo([ext.cx * 0.72, 0.25, ext.cz * 0.72], {
      yaw: 0,
      pitch: TOP_PITCH,
      dist: 20.5,
    })
  } else if (preset === 'lounge') {
    cam.setLimits({ minDist: 4.8, maxDist: 76.0 })
    cam.flyTo([LOUNGE_BOUNDS.cx, 0.3, LOUNGE_BOUNDS.cz], {
      yaw: 0,
      pitch: TOP_PITCH,
      dist: 10.6,
    })
  } else if (preset === 'studio') {
    cam.setLimits({ minDist: 1.7, maxDist: 6.0, minPitch: 0.08, maxPitch: 1.22 })
    cam.flyTo([0.04, 0.56, 0], {
      yaw: 0.36,
      pitch: 0.24,
      dist: 3.28,
    })
  } else if (preset === 'shelf') {
    cam.setLimits({ minDist: 4.5, maxDist: 30.0, minPitch: 0.14, maxPitch: 1.25 })
    cam.flyTo([-0.42, 0.56, 0.05], {
      yaw: 0.0,
      pitch: 0.35,
      dist: 18.8,
    })
  }
}

function focusInstance(inst) {
  state.selectedInstanceId = inst.id
  if (state.view === 'floor') {
    cam.flyTo([inst.pos[0], 0.42, inst.pos[1]], {
      dist: Math.min(cam.goalDist, 10.5),
      yaw: 0,
      pitch: TOP_PITCH,
    })
  }
  renderUI()
}

function focusGroup(grp) {
  if (state.view !== 'floor') switchView('floor')
  cam.flyTo([grp.cx, 0.35, grp.cz], {
    dist: Math.max(11.0, Math.min(18.0, Math.max(grp.w, grp.d) * 2.05)),
    yaw: 0,
    pitch: TOP_PITCH,
  })
}

// ── Dynamic Courtyard Greenery Islands & Walkway Decor (Adapts cleanly to dragged/appended groups!) ──
function isCourtyardSpotClear(wx, wz, halfW, halfD, placed) {
  const loungePad = 0.65
  if (
    Math.abs(wx - LOUNGE_BOUNDS.cx) < LOUNGE_BOUNDS.w * 0.5 + halfW + loungePad &&
    Math.abs(wz - LOUNGE_BOUNDS.cz) < LOUNGE_BOUNDS.d * 0.5 + halfD + loungePad
  ) {
    return false
  }
  const grpPad = 0.62
  for (const g of state.groups) {
    if (
      Math.abs(wx - g.cx) < g.w * 0.5 + halfW + grpPad &&
      Math.abs(wz - g.cz) < g.d * 0.5 + halfD + grpPad
    ) {
      return false
    }
  }
  for (const p of placed) {
    if (Math.abs(wx - p.x) < p.hw + halfW + 0.55 && Math.abs(wz - p.z) < p.hd + halfD + 0.55) {
      return false
    }
  }
  return true
}

function drawCampusCourtyardDecor(renderer, time) {
  const placed = []
  const nb = state.nightBlend
  const gb = state.goldenBlend
  const paverCol = [
    (0.86 + gb * 0.04) * (1 - nb) + 0.21 * nb,
    (0.83 + gb * 0.02) * (1 - nb) + 0.22 * nb,
    (0.78 - gb * 0.03) * (1 - nb) + 0.25 * nb,
  ]
  const brassCol = [
    0.78 * (1 - nb) + 0.62 * nb,
    0.64 * (1 - nb) + 0.48 * nb,
    0.38 * (1 - nb) + 0.26 * nb,
  ]
  const trimCol = [
    0.76 * (1 - nb) + 0.28 * nb,
    0.77 * (1 - nb) + 0.30 * nb,
    0.80 * (1 - nb) + 0.34 * nb,
  ]

  // 0. Corridor-Aligned Pedestrian Promenade (strictly in open corridor between Lounge & Workshop Col 1 — zero planters on pavers!)
  const promX = LOUNGE_BOUNDS.maxX + 1.65
  const promLen = LOUNGE_BOUNDS.d + 2.4
  const promCz = LOUNGE_BOUNDS.cz + 0.35
  // Reserve walkway corridor so no courtyard prop ever lands on it
  placed.push({ x: promX, z: promCz, hw: 0.72, hd: promLen * 0.5 })
  renderer.add('slab', TRS(promX, 0.005, promCz, 0, 1.16, 0.008, promLen), paverCol, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(promX - 0.59, 0.007, promCz, 0, 0.026, 0.006, promLen), trimCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(promX + 0.59, 0.007, promCz, 0, 0.026, 0.006, promLen), trimCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)

  // Horizontal Avenue Spine connecting Lounge Promenade across to Right Workshop Column (strictly inside open corridor!)
  const ext = computeCampusExtents()
  const aveZ = LOUNGE_BOUNDS.maxZ + 0.25
  const aveStartX = promX + 0.60
  const aveEndX = Math.max(aveStartX + 4.0, ext.maxX - 1.2)
  const segLen = 2.0
  for (let sx = aveStartX + segLen * 0.5; sx < aveEndX; sx += segLen) {
    const clearOfGroups = state.groups.every(
      (g) => Math.abs(sx - g.cx) > g.w * 0.5 + segLen * 0.52 + 0.28 || Math.abs(aveZ - g.cz) > g.d * 0.5 + 0.86,
    )
    if (!clearOfGroups) continue
    placed.push({ x: sx, z: aveZ, hw: segLen * 0.5, hd: 0.56 })
    renderer.add('slab', TRS(sx, 0.005, aveZ, 0, segLen - 0.04, 0.008, 0.96), paverCol, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
    renderer.add('sharpBox', TRS(sx, 0.007, aveZ - 0.49, 0, segLen - 0.04, 0.006, 0.024), trimCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('sharpBox', TRS(sx, 0.007, aveZ + 0.49, 0, segLen - 0.04, 0.006, 0.024), trimCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }

  // Minimalist Apple-Park Campus Wayfinding Monolith at Lounge Promenade × Horizontal Avenue intersection
  const steleX = promX + 0.96
  const steleZ = aveZ - 0.82
  const steleClearLounge =
    Math.abs(steleX - LOUNGE_BOUNDS.cx) > LOUNGE_BOUNDS.w * 0.5 + 0.40 ||
    Math.abs(steleZ - LOUNGE_BOUNDS.cz) > LOUNGE_BOUNDS.d * 0.5 + 0.40
  const steleClearGroups = state.groups.every(
    (g) => Math.abs(steleX - g.cx) > g.w * 0.5 + 0.48 || Math.abs(steleZ - g.cz) > g.d * 0.5 + 0.48,
  )
  if (steleClearLounge && steleClearGroups) {
    placed.push({ x: steleX, z: steleZ, hw: 0.36, hd: 0.36 })
    drawWayfindingStele(renderer, steleX, steleZ, nb, gb, -0.35)
  }

  // Brushed-brass entrance threshold strips + clean travertine welcome pads at every Workshop's open front (+Z) entry
  for (const grp of state.groups) {
    const isDrag = state.draggingGroupId === grp.id
    if (isDrag) continue
    const entryW = Math.min(2.1, grp.w * 0.44)
    const entryZ = grp.cz + grp.d * 0.5
    // Reserve entry pad area so courtyard troughs never block workshop doorways
    placed.push({ x: grp.cx, z: entryZ + 0.52, hw: entryW * 0.55, hd: 0.42 })
    renderer.add('sharpBox', TRS(grp.cx, 0.012, entryZ + 0.07, 0, entryW, 0.012, 0.075), brassCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('slab', TRS(grp.cx, 0.005, entryZ + 0.48, 0, entryW, 0.008, 0.68), paverCol, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  }

  // Signature Apple-Park Pocket Garden Island in the open Central Courtyard Plaza (dynamically yields if workshops move!)
  const pocketCandidates = [
    [7.6, aveZ + 2.35],
    [9.2, aveZ + 2.45],
    [ext.cx + 1.8, aveZ + 2.45],
    [LOUNGE_BOUNDS.cx, LOUNGE_BOUNDS.minZ - 2.35],
  ]
  for (const [px, pz] of pocketCandidates) {
    if (isCourtyardSpotClear(px, pz, 1.48, 1.28, placed)) {
      placed.push({ x: px, z: pz, hw: 1.52, hd: 1.32 })
      drawPocketGardenIsland(renderer, px, pz, time, nb, gb)
      break
    }
  }

  // Minimalist Architectural Path Bollards along Lounge Promenade & Central Avenue edges (2700K Night glow!)
  const bollardSpots = [
    [promX + 0.72, LOUNGE_BOUNDS.cz - 2.6],
    [promX + 0.72, LOUNGE_BOUNDS.cz + 0.4],
    [promX + 0.72, LOUNGE_BOUNDS.cz + 3.2],
    [promX - 0.72, LOUNGE_BOUNDS.cz + 3.2],
    [1.2, aveZ - 0.66],
    [5.6, aveZ - 0.66],
    [10.2, aveZ - 0.66],
  ]
  for (const [bx, bz] of bollardSpots) {
    // Check strictly against Lounge & Workshops (bollards intentionally line the walkway edge!)
    const clearLounge =
      Math.abs(bx - LOUNGE_BOUNDS.cx) > LOUNGE_BOUNDS.w * 0.5 + 0.32 ||
      Math.abs(bz - LOUNGE_BOUNDS.cz) > LOUNGE_BOUNDS.d * 0.5 + 0.32
    const clearGroups = state.groups.every(
      (g) => Math.abs(bx - g.cx) > g.w * 0.5 + 0.34 || Math.abs(bz - g.cz) > g.d * 0.5 + 0.34,
    )
    if (clearLounge && clearGroups) {
      placed.push({ x: bx, z: bz, hw: 0.20, hd: 0.20 })
      drawPathBollard(renderer, bx, bz, nb, gb)
    }
  }

  const tryPlacePlant = (species, x, z, scale, seed) => {
    const r = 0.54 * scale
    if (!isCourtyardSpotClear(x, z, r, r, placed)) return
    placed.push({ x, z, hw: r, hd: r })
    if (species === 'olive') drawOliveTree(renderer, x, z, scale, time, seed, 0, nb)
    else if (species === 'monstera') drawMonsteraPlanter(renderer, x, z, scale, time, seed, 0, nb)
    else drawFicusTree(renderer, x, z, scale, time, seed, 0, nb)
  }
  const tryPlaceTrough = (x, z, len, rotY) => {
    const isVert = Math.abs(Math.sin(rotY)) > 0.5
    const hw = isVert ? 0.30 : len * 0.52
    const hd = isVert ? len * 0.52 : 0.30
    if (!isCourtyardSpotClear(x, z, hw, hd, placed)) return
    placed.push({ x, z, hw, hd })
    drawPlanterTrough(renderer, x, z, len, rotY, time, 0)
  }

  // 1. Lounge Promenade Botanicals (troughs tucked cleanly beside Lounge curb, NEVER on walkway!)
  tryPlacePlant('olive', LOUNGE_BOUNDS.maxX + 0.72, LOUNGE_BOUNDS.minZ - 0.95, 1.15, 11.2)
  tryPlacePlant('monstera', LOUNGE_BOUNDS.maxX + 0.72, LOUNGE_BOUNDS.maxZ + 0.95, 1.10, 15.7)
  // Soft botanical accents outside Lounge West/North/South corners
  tryPlacePlant('olive', LOUNGE_BOUNDS.minX - 1.10, LOUNGE_BOUNDS.minZ - 0.85, 1.08, 19.4)
  tryPlacePlant('monstera', LOUNGE_BOUNDS.minX - 1.10, LOUNGE_BOUNDS.maxZ + 0.85, 1.06, 23.1)

  // 2. Dynamic Multi-Species Courtyard Trees & Walkway Planter Troughs around Workshop Rows
  const speciesCycle = ['olive', 'monstera', 'ficus']
  state.groups.forEach((grp, idx) => {
    const seed = 31.0 + idx * 7.3
    const sp = speciesCycle[idx % speciesCycle.length]
    // North-East walkway accent botanical (alternating Olive / Monstera / Ficus!)
    tryPlacePlant(sp, grp.cx + grp.w * 0.5 + 1.25, grp.cz - grp.d * 0.5 - 0.42, 1.02 + (idx % 3) * 0.06, seed)
    // Walkway divider planter trough tucked safely in corridor away from front entrance pad
    tryPlaceTrough(grp.cx + grp.w * 0.22, grp.cz + grp.d * 0.5 + 1.48, Math.min(2.2, grp.w * 0.40), 0)
    // Occasional north corridor planter trough
    if (idx % 2 === 0) {
      tryPlaceTrough(grp.cx - grp.w * 0.22, grp.cz - grp.d * 0.5 - 1.25, 2.0, 0)
    }
  })
}

// ── Scene Rendering (Infinite Floor + Living Lounge + Draggable Group Workshops + Courtyard Greenery!) ──
function drawCampusScene(renderer, time) {
  const botLod = cam.dist > 22.0 ? 'low' : 'high'
  const filterOwner = state.ownerFilter
  const hoveredId = state.hoveredEntity?.data?.id || null

  // 1. Seamless Infinite Cleanroom Terrazzo Floor (supports Morning / Studio Day / Deep Nocturnal)
  renderInfiniteFloor(renderer, cam, state.nightBlend, { goldenBlend: state.goldenBlend })

  // 2. Dynamic Courtyard Greenery Islands & Walkway Planter Troughs
  drawCampusCourtyardDecor(renderer, time)


  // 3. Living Cleanroom Lounge Environment (Woven Rug, Bouclé Sofas, Espresso Bar, Ficus Trees & Sliding Door)
  drawLoungeEnvironment(renderer, {
    origin: LOUNGE_ORIGIN,
    time,
    nightBlend: state.nightBlend,
    doorOpen: state.loungeDoorOpen,
    hiddenPoolCount: state.hiddenIdlePool.length,
    activeSteam: true,
  })

  // Visible Lounge Bots (up to 12 seats + bots entering/leaving through sliding door)
  state.loungeBots.forEach((lb, i) => {
    const dimmed = filterOwner !== 'all' && lb.ownerId !== filterOwner
    const owner = state.ownersMap[lb.ownerId]
    const isWalking = Boolean(lb.walk)
    let drawX = lb.pos[0]
    let drawZ = lb.pos[1]
    let drawRy = lb.facing
    if (!isWalking && lb.activity === 'stroll_lounge') {
      drawX += Math.sin(time * 0.72 + i) * 0.28
      drawZ += Math.cos(time * 0.72 + i) * 0.20
      drawRy = Math.atan2(Math.cos(time * 0.72 + i), -Math.sin(time * 0.72 + i))
    }
    // Exact natural vertical grounding so bots never clip into bouclé sofa cushions, rug, or recharge mats!
    const botBaseY = isWalking
      ? 0.044
      : lb.seatType === 'bench'
        ? 0.145
        : lb.seatType === 'recharge'
          ? 0.072
          : lb.seatType === 'chat'
            ? 0.058
            : 0.044

    const figKey = resolveCampusFigurineKey(lb, i, true)
    drawFigurine(renderer, figKey, {
      x: drawX,
      baseY: botBaseY,
      z: drawZ,
      ry: drawRy,
      scale: 0.60,
      tintHex: figKey === 'claude' ? lb.tint : undefined,
      ownerRingColor: owner ? owner.ring : null,
      isMe: Boolean(owner?.isMe),
      action: isWalking ? 'walk_to_work' : lb.activity,
      time,
      phase: i * 1.15,
      dimmed,
      hovered: hoveredId === lb.id,
      lod: botLod,
    })
  })

  // 4. Active Group Workshops -> Ergonomic Desks (w/ live MAT.CODE_SCREEN) & Solid Bot Instances
  const drawnDesks = new Set()

  state.instances.forEach((inst, idx) => {
    const dimmed = filterOwner !== 'all' && inst.ownerId !== filterOwner
    const owner = state.ownersMap[inst.ownerId]
    const isSelected = inst.id === state.selectedInstanceId
    const isHovered = hoveredId === inst.id
    const grp = state.groups.find((g) => g.id === inst.groupId)
    const liftY = grp && state.draggingGroupId === grp.id ? 0.08 : 0.0

    if (!drawnDesks.has(inst.taskId)) {
      drawnDesks.add(inst.taskId)
      const [tx, tz] = inst.deskPos
      const statusColor =
        inst.status === 'approval'
          ? [1.85, 1.05, 0.12]
          : inst.status === 'question'
            ? [1.25, 0.58, 2.35]
            : ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(inst.status)
              ? [2.35, 0.25, 0.2]
              : [0.14, 1.22, 2.25]
      drawErgonomicDesk(renderer, tx, tz, 0, {
        statusColor,
        ctxPercent: inst.ctx,
        time,
        nightBlend: state.nightBlend,
        liftY,
        roundTable: Boolean(inst.roundTable),
        seed: idx * 1.37 + 0.5,
      })
    }

    const meta = EDGE_STATUS_META[inst.status] || EDGE_STATUS_META.typing
    const action = inst.walk
      ? 'walk_to_work'
      : inst.celebrateUntil > time
        ? 'celebrate_done'
        : inst.ctx >= 85 && meta.action === 'typing'
          ? 'context_compact'
          : meta.action

    const figKey = resolveCampusFigurineKey(inst, idx, false)
    drawFigurine(renderer, figKey, {
      x: inst.pos[0],
      baseY: 0.04 + liftY,
      z: inst.pos[1],
      ry: inst.facing,
      scale: 0.66,
      tintHex: figKey === 'claude' ? inst.tint : undefined,
      ownerRingColor: owner ? owner.ring : null,
      isMe: Boolean(owner?.isMe),
      action,
      effort: inst.ctx > 60 ? 'high' : 'medium',
      subagents: inst.walk ? 0 : (inst.subagents?.length || 0),
      ctxPercent: inst.ctx,
      time,
      phase: idx * 0.72,
      dimmed,
      selected: isSelected,
      hovered: isHovered,
      lod: botLod,
    })
  })

  // 5. Group Workshop Enclosures, Repo Cores & Architectural Finishes (Wood-Slat Wall + Kanban + Mullions + Corner Ficus)
  for (const grp of state.groups) {
    const isDragging = state.draggingGroupId === grp.id
    const liftY = isDragging ? 0.08 : 0.0
    const gInsts = state.instances.filter((s) => s.groupId === grp.id)
    const hasError = gInsts.some((s) => ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(s.status))
    const hasApproval = gInsts.some((s) => s.status === 'approval')
    const hasQuestion = gInsts.some((s) => s.status === 'question')

    const statusColor = hasError
      ? [2.6, 0.28, 0.22]
      : hasApproval
        ? [2.5, 1.25, 0.12]
        : hasQuestion
          ? [1.35, 0.58, 2.6]
          : grp.syncMode === 'force'
            ? [0.15, 1.75, 1.25]
            : [0.14, 1.35, 2.5]

    drawWorkshopEnclosure(renderer, grp, {
      time,
      nightBlend: state.nightBlend,
      isDragging,
      dragValid: state.dragValid,
      hasError,
      hasApproval,
      hasQuestion,
      activeCount: gInsts.length,
    })

    drawWorkshopArchitecture(renderer, grp, {
      statusColor,
      time,
      nightBlend: state.nightBlend,
      liftY,
      isDragging,
    })
  }
}

function getMuseumShelfLayout() {
  const items = []
  // Top Tier (Tier 3): 12 Official Agent Figurines
  const topN = AGENT_FIGURINE_META.length
  const topSpacing = 0.94
  AGENT_FIGURINE_META.forEach((meta, i) => {
    const x = (i - (topN - 1) * 0.5) * topSpacing
    items.push({ meta, key: meta.key, x, y: 0.64, z: -1.65, tier: 3 })
  })
  // Middle Tier (Tier 2): First 6 Built-in Role Persona Figurines (flagship role-gong front-left!)
  const midRoles = ROLE_FIGURINE_META.slice(0, 6)
  const midSpacing = 1.48
  midRoles.forEach((meta, i) => {
    const x = (i - (midRoles.length - 1) * 0.5) * midSpacing
    items.push({ meta, key: meta.key, x, y: 0.36, z: 0.05, tier: 2 })
  })
  // Front Tier (Tier 1): Remaining 7 Built-in Role Persona Figurines
  const frontRoles = ROLE_FIGURINE_META.slice(6)
  const frontSpacing = 1.38
  frontRoles.forEach((meta, i) => {
    const x = (i - (frontRoles.length - 1) * 0.5) * frontSpacing
    items.push({ meta, key: meta.key, x, y: 0.10, z: 1.65, tier: 1 })
  })
  return items
}

const MUSEUM_SHELF_ITEMS = getMuseumShelfLayout()

const FINISH_LABELS = {
  default: '原厂精选材质',
  vinyl: '哑光潮玩 Vinyl (MAT 18)',
  ceramic: '釉面陶瓷 Ceramic (MAT 19)',
  crystal: '晶透水晶 Crystal (MAT 20)',
  metal: '阳极钛金 Metal (MAT 21)',
}

function drawStudioScene(renderer, time) {
  const nb = state.nightBlend
  const gb = state.goldenBlend
  const finishOverride = state.studioFinish === 'default' ? null : state.studioFinish

  // High-key architectural studio floor (responsive to Morning / Studio Day / Night)
  renderInfiniteFloor(renderer, cam, nb, {
    goldenBlend: gb,
    dayColor: [0.80, 0.795, 0.78],
    nightColor: [0.095, 0.108, 0.142],
  })

  if (state.studioMode === 'shelf') {
    // ── All-25 Museum Display Shelf (3 Illuminated Tiered Architectural Plinths) ──
    const plinthStone = [
      (0.91 - nb * 0.68),
      (0.895 - nb * 0.66),
      (0.865 - nb * 0.62),
    ]
    const brassCol = [0.86, 0.72, 0.44]
    const tiCol = [0.18, 0.19, 0.23]
    const coveEm = [1.45 + nb * 0.8, 1.15 + nb * 0.65, 0.78 + nb * 0.45]

    const tiers = [
      { w: 12.2, h: 0.62, d: 1.24, z: -1.65, topY: 0.62 },
      { w: 10.6, h: 0.34, d: 1.24, z: 0.05, topY: 0.34 },
      { w: 11.2, h: 0.08, d: 1.24, z: 1.65, topY: 0.08 },
    ]
    for (const tr of tiers) {
      // Main stepped travertine museum plinth
      renderer.add('bevelBox', TRS(0, tr.h * 0.5, tr.z, 0, tr.w, tr.h, tr.d), plinthStone, MAT.TRAVERTINE, [0, 0, 0], 1, 0, true)
      // Brushed-brass front architectural edge trim
      renderer.add('sharpBox', TRS(0, tr.h - 0.015, tr.z + tr.d * 0.5 + 0.012, 0, tr.w + 0.02, 0.028, 0.024), brassCol, MAT.BRUSHED_BRASS, [0, 0, 0], 1, 0, false)
      // Warm museum cove LED under-glow strip
      renderer.add('sharpBox', TRS(0, Math.max(0.018, tr.h - 0.048), tr.z + tr.d * 0.5 + 0.01, 0, tr.w - 0.18, 0.016, 0.018), [1, 0.96, 0.88], MAT.EMISSIVE, coveEm, 0.95, 0, false)
      renderer.add('plane', TRS(0, 0.008, tr.z + tr.d * 0.5 + 0.32, 0, tr.w * 0.94, 1, 0.85), [1, 1, 1], MAT.GLOW_POOL, coveEm, 0.24 + nb * 0.26, 0, false)
    }

    // Minimalist architectural oak-slat museum gallery backdrop wall behind Top Tier
    renderer.add('bevelBox', TRS(0, 1.45, -2.52, 0, 13.0, 2.9, 0.14), [0.74, 0.58, 0.40], MAT.WOOD_SLAT, [0, 0, 0], 1, 0, false)
    renderer.add('sharpBox', TRS(0, 2.86, -2.42, 0, 12.6, 0.028, 0.03), [1, 0.95, 0.85], MAT.EMISSIVE, [1.65, 1.32, 0.92], 0.95, 0, false)

    // Render ALL 25 Collectible Figurines on illuminated individual micro-pedestals
    MUSEUM_SHELF_ITEMS.forEach((item, idx) => {
      const isSel = item.key === state.studioFigurineKey
      const isHov = item.key === state.hoveredShelfKey
      const discY = item.y - 0.01
      renderer.add('cyl', TRS(item.x, discY, item.z, 0, 0.64, 0.02, 0.64), isSel ? brassCol : tiCol, isSel ? MAT.BRUSHED_BRASS : MAT.TITANIUM, [0, 0, 0], 1, 0, false)
      if (isSel || isHov) {
        renderer.add('thinTorus', TRS(item.x, item.y + 0.008, item.z, 0, 0.72, 0.35, 0.72), [1, 1, 1], MAT.EMISSIVE, isSel ? [0.35, 1.85, 3.2] : [1.85, 1.45, 0.65], 0.92, 0, false)
      }
      drawFigurine(renderer, item.key, {
        x: item.x,
        baseY: item.y,
        z: item.z,
        ry: Math.sin(time * 0.55 + idx * 0.42) * 0.18,
        scale: 0.76,
        action: normalizeBotAction(state.studioClip),
        time,
        phase: idx * 0.55,
        explode: state.studioExplode * 0.45,
        selected: isSel,
        hovered: isHov,
        finishOverride,
        lod: 'high',
      })
    })
    return
  }

  // ── Mode A: Single Hero 360° Turntable Plinth + Seamless Infinite Museum Cyclorama Backdrop ──
  const brassCol = [0.88, 0.74, 0.46]
  const aluCol = [0.80 - nb * 0.42, 0.82 - nb * 0.42, 0.85 - nb * 0.40]
  const tiCol = [0.16, 0.17, 0.21]
  // Seamless wide warm-slate museum cyclorama (extends far past camera frustum with zero vertical seam gaps!)
  const cycWall = [0.35 - nb * 0.21, 0.37 - nb * 0.22, 0.42 - nb * 0.23]
  const stageMat = [0.46 - nb * 0.28, 0.47 - nb * 0.29, 0.50 - nb * 0.30]
  renderer.add('cyl', TRS(0, 0.004, 0, 0, 12.0, 0.008, 12.0), stageMat, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  // Wide seamless wrap-around cyclorama wall (back + overlapping angled wings far outside Hero frustum)
  renderer.add('sharpBox', TRS(0, 2.4, -2.6, 0, 18.0, 5.2, 0.14), cycWall, MAT.VINYL_MATTE, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(-8.2, 2.4, 2.0, Math.PI * 0.5, 10.0, 5.2, 0.14), cycWall, MAT.VINYL_MATTE, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(8.2, 2.4, 2.0, -Math.PI * 0.5, 10.0, 5.2, 0.14), cycWall, MAT.VINYL_MATTE, [0, 0, 0], 1, 0, false)
  // Overhead gallery softbox linear accent strip & subtle brushed-brass wainscot baseboard
  renderer.add('sharpBox', TRS(0, 3.15, -2.48, 0, 14.0, 0.04, 0.04), [1, 0.97, 0.92], MAT.EMISSIVE, [1.85, 1.72, 1.50], 0.96, 0, false)
  renderer.add('sharpBox', TRS(0, 0.06, -2.50, 0, 17.8, 0.026, 0.03), brassCol, MAT.BRUSHED_BRASS, [0, 0, 0], 1, 0, false)

  // Soft warm spotlight pool beneath turntable
  renderer.add('plane', TRS(0, 0.011, 0, 0, 3.0, 1, 3.0), [1, 1, 1], MAT.GLOW_POOL, [1.25, 1.08, 0.84], 0.28 + nb * 0.28, 0, false)
  // Brushed aluminum base + champagne brass collar + matte titanium top plate
  renderer.add('cyl', TRS(0, 0.030, 0, 0, 1.62, 0.052, 1.62), aluCol, MAT.ALUMINUM)
  renderer.add('thinTorus', TRS(0, 0.058, 0, 0, 1.56, 0.55, 1.56), brassCol, MAT.BRUSHED_BRASS, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', TRS(0, 0.062, 0, 0, 1.38, 0.014, 1.38), tiCol, MAT.TITANIUM)

  drawFigurine(renderer, state.studioFigurineKey, {
    x: 0,
    baseY: 0.070,
    z: 0,
    ry: Math.sin(time * 0.38) * 0.22,
    scale: 1.0,
    tintHex: state.studioHex || undefined,
    ownerRingColor: null,
    action: normalizeBotAction(state.studioClip),
    subagents: state.studioClip === 'subagent_swarm' ? 3 : 0,
    time,
    explode: state.studioExplode,
    finishOverride,
    lod: 'high',
  })
}

// ── DOM & WebGL2 Bootstrap ──
const canvas = document.getElementById('gl-canvas')
const labelsLayer = document.getElementById('labels-layer')
const hoverTooltip = document.getElementById('hover-tooltip')
const dragToast = document.getElementById('drag-toast')
const dragToastText = document.getElementById('drag-toast-text')
const minimapCard = document.getElementById('minimap-card')
const minimapCanvas = document.getElementById('minimap-canvas')
const minimapCtx = minimapCanvas.getContext('2d')
const renderer = new CleanroomRenderer(canvas)

// ── Pointer Interactions: SpringCamera Pan/Orbit + Group Workshop Raycast Dragging + Hover Tooltip ──
let pointerMode = null // 'pan' | 'orbit' | 'drag-group'
let startX = 0, startY = 0, lastX = 0, lastY = 0
let lastPanGroundHit = null

function startGroupDrag(grp, clientX, clientY) {
  const rect = canvas.getBoundingClientRect()
  const hit = screenToGroundRay(clientX, clientY, rect, cam, 0)
  if (!hit) return
  state.draggingGroupId = grp.id
  state.dragOffset = [grp.cx - hit.x, grp.cz - hit.z]
  state.dragValid = isGroupPlacementValid(grp, state.groups)
  pointerMode = 'drag-group'
  canvas.classList.add('dragging-group')
  dragToast.hidden = false
  dragToastText.textContent = `移动 ${grp.name} (${grp.cx.toFixed(1)}m, ${grp.cz.toFixed(1)}m)`
}

function endGroupDrag() {
  if (state.draggingGroupId) {
    state.draggingGroupId = null
    canvas.classList.remove('dragging-group')
    dragToast.hidden = true
  }
}

function hitTestGroupFloor(wx, wz) {
  for (let i = state.groups.length - 1; i >= 0; i--) {
    const g = state.groups[i]
    if (Math.abs(wx - g.cx) <= g.w * 0.5 && Math.abs(wz - g.cz) <= g.d * 0.5) {
      return g
    }
  }
  return null
}

function hitTestBotAtScreen(mx, my, rect) {
  let best = null
  let bestD = 36
  for (const inst of state.instances) {
    const p = projectWorldToScreen([inst.pos[0], 0.58, inst.pos[1]], cam.vp, rect.width, rect.height)
    if (!p) continue
    const d = Math.hypot(p.x - mx, p.y - my)
    if (d < bestD) {
      bestD = d
      best = { type: 'instance', data: inst, screenX: p.x, screenY: p.y }
    }
  }
  if (!best) {
    for (const lb of state.loungeBots) {
      const p = projectWorldToScreen([lb.pos[0], 0.54, lb.pos[1]], cam.vp, rect.width, rect.height)
      if (!p) continue
      const d = Math.hypot(p.x - mx, p.y - my)
      if (d < bestD) {
        bestD = d
        best = { type: 'lounge', data: lb, screenX: p.x, screenY: p.y }
      }
    }
  }
  return best
}

function hitTestShelfAtScreen(mx, my, rect) {
  let best = null
  let bestD = 42
  for (const item of MUSEUM_SHELF_ITEMS) {
    const p = projectWorldToScreen([item.x, item.y + 0.42, item.z], cam.vp, rect.width, rect.height)
    if (!p) continue
    const d = Math.hypot(p.x - mx, p.y - my)
    if (d < bestD) {
      bestD = d
      best = item
    }
  }
  return best
}

function selectStudioFigurine(key, switchToHero = false) {
  if (!key) return
  state.studioFigurineKey = key
  state.studioHex = ''
  ensureGLBLoaded(renderer, key)
  if (switchToHero && state.studioMode !== 'hero') {
    state.studioMode = 'hero'
    setCameraPreset('studio')
  }
  renderUI()
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault())

canvas.addEventListener('pointerdown', (e) => {
  startX = lastX = e.clientX
  startY = lastY = e.clientY
  canvas.setPointerCapture(e.pointerId)

  if (state.view === 'studio') {
    const isSecondary = e.button === 2 || e.altKey || e.shiftKey
    pointerMode = state.studioMode === 'shelf' && isSecondary ? 'pan' : 'orbit'
    if (pointerMode === 'pan') {
      lastPanGroundHit = screenToGroundRay(e.clientX, e.clientY, canvas.getBoundingClientRect(), cam, 0)
    }
    return
  }

  const rect = canvas.getBoundingClientRect()
  const isSecondary = e.button === 2 || e.altKey || e.shiftKey

  if (e.button === 0 && !isSecondary && state.view === 'floor') {
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const botHit = hitTestBotAtScreen(mx, my, rect)
    if (!botHit) {
      const ground = screenToGroundRay(e.clientX, e.clientY, rect, cam, 0)
      if (ground) {
        const grp = hitTestGroupFloor(ground.x, ground.z)
        if (grp) {
          const distRepo = Math.hypot(ground.x - grp.repoPos[0], ground.z - grp.repoPos[1])
          const nearEdge =
            Math.abs(Math.abs(ground.x - grp.cx) - grp.w * 0.5) < 0.65 ||
            Math.abs(Math.abs(ground.z - grp.cz) - grp.d * 0.5) < 0.65
          if (distRepo < 0.88 || nearEdge) {
            startGroupDrag(grp, e.clientX, e.clientY)
            return
          }
        }
      }
    }
  }

  if (state.navMode === 'pan') {
    pointerMode = isSecondary ? 'orbit' : 'pan'
  } else {
    pointerMode = isSecondary ? 'pan' : 'orbit'
  }
  if (pointerMode === 'pan') {
    lastPanGroundHit = screenToGroundRay(e.clientX, e.clientY, rect, cam, 0)
  }
})

window.addEventListener('pointermove', (e) => {
  if (pointerMode === 'drag-group' && state.draggingGroupId) {
    const grp = state.groups.find((g) => g.id === state.draggingGroupId)
    if (grp) {
      const rect = canvas.getBoundingClientRect()
      const hit = screenToGroundRay(e.clientX, e.clientY, rect, cam, 0)
      if (hit) {
        const snapped = snapGroupToGrid(hit.x + state.dragOffset[0], hit.z + state.dragOffset[1], grp.w, grp.d, 0.5)
        grp.cx = snapped.cx
        grp.cz = snapped.cz
        syncGroupLayout(grp, state.instances)
        state.dragValid = isGroupPlacementValid(grp, state.groups)
        dragToastText.textContent = `移动 ${grp.name} (${grp.cx.toFixed(1)}m, ${grp.cz.toFixed(1)}m)${state.dragValid ? '' : ' · 重叠提示'}`
      }
    }
    return
  }

  if (pointerMode === 'pan') {
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    const rect = canvas.getBoundingClientRect()
    const curHit = screenToGroundRay(e.clientX, e.clientY, rect, cam, 0)
    if (lastPanGroundHit && curHit) {
      cam.panToGroundDelta(lastPanGroundHit, curHit)
      lastPanGroundHit = screenToGroundRay(e.clientX, e.clientY, rect, cam, 0)
    } else {
      cam.panScreen(dx, dy)
    }
    return
  }

  if (pointerMode === 'orbit') {
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    cam.orbit(dx, dy)
    return
  }

  // Idle hover inspection tooltip
  if (state.view === 'studio' && state.studioMode === 'shelf' && e.target === canvas) {
    const rect = canvas.getBoundingClientRect()
    const hit = hitTestShelfAtScreen(e.clientX - rect.left, e.clientY - rect.top, rect)
    state.hoveredShelfKey = hit ? hit.key : null
    canvas.classList.toggle('hover-interactive', Boolean(hit))
    hoverTooltip.hidden = true
  } else if (state.view === 'floor' && e.target === canvas) {
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const hit = hitTestBotAtScreen(mx, my, rect)
    state.hoveredEntity = hit
    if (hit) {
      canvas.classList.add('hover-interactive')
      renderHoverTooltip(hit, mx, my)
    } else {
      canvas.classList.remove('hover-interactive')
      hoverTooltip.hidden = true
    }
  } else {
    state.hoveredEntity = null
    state.hoveredShelfKey = null
    hoverTooltip.hidden = true
  }
})

window.addEventListener('pointerup', (e) => {
  if (!pointerMode) return
  const wasMode = pointerMode
  pointerMode = null
  lastPanGroundHit = null
  if (wasMode === 'drag-group') {
    endGroupDrag()
    return
  }
  if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5 && e.target === canvas) {
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    if (state.view === 'floor') {
      const hit = hitTestBotAtScreen(mx, my, rect)
      if (hit?.type === 'instance') {
        focusInstance(hit.data)
      }
    } else if (state.view === 'studio' && state.studioMode === 'shelf') {
      const hit = hitTestShelfAtScreen(mx, my, rect)
      if (hit) {
        selectStudioFigurine(hit.key, true)
      }
    }
  }
})

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    if (state.view === 'studio') {
      const minD = state.studioMode === 'shelf' ? 4.2 : 1.45
      const maxD = state.studioMode === 'shelf' ? 26.0 : 5.4
      cam.goalDist = Math.max(minD, Math.min(maxD, cam.goalDist * (1 + e.deltaY * 0.001)))
    } else {
      cam.zoomToCursor(e.deltaY, e.clientX, e.clientY, rect, { minDist: 4.8, maxDist: 72.0 })
    }
  },
  { passive: false },
)

function renderHoverTooltip(hit, mx, my) {
  hoverTooltip.hidden = false
  hoverTooltip.style.left = `${Math.min(canvas.clientWidth - 260, Math.max(12, mx))}px`
  hoverTooltip.style.top = `${Math.max(70, my - 10)}px`

  if (hit.type === 'instance') {
    const inst = hit.data
    const owner = state.ownersMap[inst.ownerId]
    const meta = EDGE_STATUS_META[inst.status] || EDGE_STATUS_META.typing
    const doneN = inst.todos.filter((t) => t.st === 2).length
    hoverTooltip.innerHTML = `
      <div class="ht-head">
        <span>${inst.botName}</span>
        <span class="pill pill--${meta.tone}">${meta.label}</span>
      </div>
      <div class="ht-step">${inst.step}</div>
      <div class="ht-meta">${owner ? owner.short : ''} · ${inst.groupName} · Todo ${doneN}/${inst.todos.length} · Ctx ${inst.ctx}%</div>
    `
  } else {
    const lb = hit.data
    const owner = state.ownersMap[lb.ownerId]
    const actLabels = {
      sip_coffee: '☕ 端杯喝咖啡',
      chat_wave: '👋 挥手交流中',
      bench_swing: '🛋️ 沙发休闲晃腿',
      recharge_nap: '⚡ 充能垫小憩',
      stroll_lounge: '🌿 盆景漫步中',
    }
    hoverTooltip.innerHTML = `
      <div class="ht-head">
        <span>${lb.name}</span>
        <span class="pill pill--lounge">休闲区</span>
      </div>
      <div class="ht-step">${lb.walk ? '🚶 正在移动换岗…' : actLabels[lb.activity] || '休闲待命'}</div>
      <div class="ht-meta">${owner ? owner.short : ''} · ${lb.cli} · 随时可调度出工</div>
    `
  }
}

// ── Interactive Global Minimap Radar ──
let minimapTransform = { minX: -16, maxX: 20, minZ: -12, maxZ: 14, scale: 4, ox: 0, oz: 0 }
let minimapDragging = false

function jumpCameraFromMinimap(clientX, clientY) {
  const rect = minimapCanvas.getBoundingClientRect()
  const px = clientX - rect.left
  const py = clientY - rect.top
  const wx = minimapTransform.minX + (px - minimapTransform.ox) / minimapTransform.scale
  const wz = minimapTransform.minZ + (py - minimapTransform.oz) / minimapTransform.scale
  cam.goalTarget[0] = wx
  cam.goalTarget[2] = wz
}

minimapCanvas.addEventListener('pointerdown', (e) => {
  minimapDragging = true
  minimapCanvas.setPointerCapture(e.pointerId)
  jumpCameraFromMinimap(e.clientX, e.clientY)
})
minimapCanvas.addEventListener('pointermove', (e) => {
  if (!minimapDragging) return
  jumpCameraFromMinimap(e.clientX, e.clientY)
})
minimapCanvas.addEventListener('pointerup', () => {
  minimapDragging = false
})

function drawMinimap() {
  if (state.view !== 'floor') return
  const ctx = minimapCtx
  const W = minimapCanvas.width
  const H = minimapCanvas.height
  ctx.clearRect(0, 0, W, H)

  const ext = computeCampusExtents()
  const minX = Math.min(ext.minX, cam.target[0] - 8) - 2
  const maxX = Math.max(ext.maxX, cam.target[0] + 8) + 2
  const minZ = Math.min(ext.minZ, cam.target[2] - 8) - 2
  const maxZ = Math.max(ext.maxZ, cam.target[2] + 8) + 2

  const spanX = Math.max(16, maxX - minX)
  const spanZ = Math.max(12, maxZ - minZ)
  const pad = 10
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanZ)
  const ox = (W - spanX * scale) * 0.5
  const oz = (H - spanZ * scale) * 0.5
  minimapTransform = { minX, maxX, minZ, maxZ, scale, ox, oz }

  const toX = (wx) => ox + (wx - minX) * scale
  const toY = (wz) => oz + (wz - minZ) * scale

  // Radar grid
  ctx.strokeStyle = state.night ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.055)'
  ctx.lineWidth = 1
  for (let gx = Math.ceil(minX / 8) * 8; gx <= maxX; gx += 8) {
    ctx.beginPath()
    ctx.moveTo(toX(gx), 0)
    ctx.lineTo(toX(gx), H)
    ctx.stroke()
  }
  for (let gz = Math.ceil(minZ / 8) * 8; gz <= maxZ; gz += 8) {
    ctx.beginPath()
    ctx.moveTo(0, toY(gz))
    ctx.lineTo(W, toY(gz))
    ctx.stroke()
  }

  // Living Lounge footprint
  const lx = toX(LOUNGE_BOUNDS.minX)
  const ly = toY(LOUNGE_BOUNDS.minZ)
  const lw = LOUNGE_BOUNDS.w * scale
  const lh = LOUNGE_BOUNDS.d * scale
  ctx.fillStyle = state.night ? 'rgba(74, 222, 128, 0.22)' : 'rgba(47, 133, 90, 0.18)'
  ctx.strokeStyle = state.night ? '#4ade80' : '#2f855a'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.roundRect(lx, ly, lw, lh, 4)
  ctx.fill()
  ctx.stroke()

  // Group Workshops
  for (const grp of state.groups) {
    const gInsts = state.instances.filter((s) => s.groupId === grp.id)
    const hasErr = gInsts.some((s) => ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(s.status))
    const hasWarn = gInsts.some((s) => ['approval', 'question', 'workspace_confirm'].includes(s.status))
    const isDrag = state.draggingGroupId === grp.id

    const gx = toX(grp.cx - grp.w * 0.5)
    const gy = toY(grp.cz - grp.d * 0.5)
    const gw = grp.w * scale
    const gh = grp.d * scale

    ctx.fillStyle = hasErr
      ? 'rgba(239, 68, 68, 0.28)'
      : hasWarn
        ? 'rgba(245, 158, 11, 0.28)'
        : state.night
          ? 'rgba(10, 132, 255, 0.24)'
          : 'rgba(0, 113, 227, 0.18)'
    ctx.strokeStyle = isDrag
      ? '#ffffff'
      : hasErr
        ? '#ef4444'
        : hasWarn
          ? '#f59e0b'
          : state.night
            ? '#38bdf8'
            : '#0071e3'
    ctx.lineWidth = isDrag ? 2 : 1.15
    ctx.beginPath()
    ctx.roundRect(gx, gy, Math.max(6, gw), Math.max(5, gh), 3)
    ctx.fill()
    ctx.stroke()
  }

  // Active Bot dots
  for (const inst of state.instances) {
    ctx.fillStyle = inst.id === state.selectedInstanceId ? '#ffffff' : inst.tint
    ctx.beginPath()
    ctx.arc(toX(inst.pos[0]), toY(inst.pos[1]), inst.id === state.selectedInstanceId ? 3.0 : 1.9, 0, Math.PI * 2)
    ctx.fill()
  }

  // Camera Target Ring
  const cx = toX(cam.target[0])
  const cy = toY(cam.target[2])
  const viewR = Math.max(7, Math.min(34, cam.dist * 0.34 * scale))
  ctx.strokeStyle = state.night ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)'
  ctx.lineWidth = 1.25
  ctx.beginPath()
  ctx.arc(cx, cy, viewR, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = state.night ? '#ffffff' : '#111827'
  ctx.beginPath()
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
  ctx.fill()

  document.getElementById('minimap-stats').textContent = `${state.groups.length} 群 · ${Math.round(ext.span)}m`
}

// ── UI Rendering ──
function getAlertInstances() {
  return state.instances.filter((x) => EDGE_STATUS_META[x.status]?.isAlert)
}

function renderOwnerFilters() {
  const row = document.getElementById('owner-filters')
  row.innerHTML = `
    <button type="button" class="filter-chip" data-owner="all" aria-pressed="${state.ownerFilter === 'all'}">全团队</button>
    ${state.ownersList
      .slice(0, 6)
      .map(
        (o) => `
      <button type="button" class="filter-chip" data-owner="${o.id}" aria-pressed="${state.ownerFilter === o.id}">
        <span class="owner-swatch" style="background:${o.hex}"></span>${o.short}
      </button>`,
      )
      .join('')}
  `
  row.querySelectorAll('[data-owner]').forEach((b) => {
    b.addEventListener('click', () => {
      state.ownerFilter = b.dataset.owner
      renderUI()
    })
  })
}

function renderTeamSelect() {
  const sel = document.getElementById('team-select')
  sel.innerHTML = `
    <option value="all">全部团队 (${state.teams.length})</option>
    ${state.teams.map((t) => `<option value="${t.id}" ${t.id === state.teamFilter ? 'selected' : ''}>${t.name}</option>`).join('')}
  `
}

let sunChipText = ''
function syncDaylightTheme() {
  const d = state.daylight
  const nb = d ? d.nightBlend : 0
  const gb = d ? d.goldenBlend : 0
  state.night = nb > 0.5
  const theme = state.night ? 'dark' : gb > 0.5 ? 'morning' : 'light'
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme
  if (!d) return
  const at = presetDate(state.lighting)
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sun = d.elevation > 0 ? ` · 太阳高度 ${Math.round(d.elevation)}°` : ''
  const text = `${hm} · ${d.phase}${sun}`
  if (text !== sunChipText) {
    sunChipText = text
    document.getElementById('sun-chip').textContent = text
  }
}

function renderUI() {
  syncDaylightTheme()

  document.querySelectorAll('[data-view-btn]').forEach((b) => {
    const on = b.dataset.viewBtn === state.view
    if (b.classList.contains('rail-btn')) b.setAttribute('aria-selected', String(on))
    else b.setAttribute('aria-pressed', String(on))
  })
  document.querySelectorAll('[data-nav-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.navMode === state.navMode))
  })
  document.querySelectorAll('[data-light]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.light === state.lighting))
  })

  document.getElementById('blueprints-view').hidden = state.view !== 'blueprints'
  const inStudio = state.view === 'studio'
  const inHeroStudio = inStudio && state.studioMode === 'hero'
  const inShelfStudio = inStudio && state.studioMode === 'shelf'
  document.getElementById('studio-submode-bar').hidden = !inStudio
  document.getElementById('hud-telemetry').style.display = state.view === 'floor' ? 'flex' : 'none'
  document.getElementById('studio-catalog').hidden = !inHeroStudio
  document.getElementById('studio-panel').hidden = !inHeroStudio
  document.getElementById('studio-shelf-bar').hidden = !inShelfStudio
  document.getElementById('hud-bottom').style.display = state.view === 'floor' ? 'flex' : 'none'
  document.getElementById('nav-mode-bar').style.display = state.view === 'floor' ? 'flex' : 'none'
  minimapCard.hidden = state.view !== 'floor'
  labelsLayer.style.display = state.view === 'floor' || inShelfStudio ? 'block' : 'none'

  document.querySelectorAll('[data-studio-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.studioMode === state.studioMode))
  })

  // Counts (ZERO Standby Plaza — strictly Active + Living Lounge + Hidden Idle Pool!)
  const activeCount = state.instances.length
  const loungeVisible = state.loungeBots.filter((lb) => !lb.leavingToPool).length
  const hiddenCount = state.hiddenIdlePool.length
  const totalBots = activeCount + loungeVisible + hiddenCount
  const alerts = getAlertInstances()

  document.getElementById('m-total').textContent = String(totalBots)
  document.getElementById('m-active').textContent = String(activeCount)
  document.getElementById('m-idle').textContent = `${loungeVisible}休 · +${hiddenCount}候场`
  document.getElementById('m-groups').textContent = String(state.groups.length)

  document.getElementById('sb-lounge-pill').textContent = `休闲中 ${loungeVisible} · 候场隐藏 +${hiddenCount}`
  document.getElementById('sb-lounge-sub').textContent = state.lastEventText || `满员 ${LOUNGE_MAX_SEATS} 席动态轮换 · 出工自动从候场池补位`

  // Atomic sync with the 3D Lounge banner so sidebar and 3D badge never disagree even for 1 frame
  const loungeBannerEl = domPool.get('zone-lounge')
  if (loungeBannerEl) {
    loungeBannerEl.innerHTML = `
      <div class="zb-row">
        <span class="dot dot--lounge"></span>
        <span>休闲茶歇区 · 休闲中 ${loungeVisible} · 候场隐藏 +${hiddenCount}</span>
      </div>
    `
  }

  const badge = document.getElementById('rail-alert-badge')
  badge.textContent = String(alerts.length)
  badge.hidden = alerts.length === 0

  const alertJump = document.getElementById('alert-jump')
  alertJump.hidden = alerts.length === 0
  document.getElementById('alert-jump-text').textContent = `待处理 ${alerts.length} 项 · 定位`

  renderOwnerFilters()

  const botInstanceCounts = {}
  for (const inst of state.instances) {
    botInstanceCounts[inst.botId] = (botInstanceCounts[inst.botId] || 0) + 1
  }

  // Sidebar Active Groups -> Threads
  const sb = document.getElementById('sb-tree')
  sb.innerHTML = `
    <div class="sec-hdr">
      <span>群聊工坊 (${state.groups.length})</span>
      <span>${state.isRealData ? '真实生产快照' : '本地演示'}</span>
    </div>
    ${state.groups
      .map((grp) => {
        const gInsts = state.instances.filter(
          (s) => s.groupId === grp.id && (state.ownerFilter === 'all' || s.ownerId === state.ownerFilter),
        )
        if (state.ownerFilter !== 'all' && gInsts.length === 0) return ''
        const hasErr = gInsts.some((s) => ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(s.status))
        const hasWarn = gInsts.some((s) => ['approval', 'question', 'workspace_confirm'].includes(s.status))
        return `
        <div class="grp-card ${hasErr ? 'grp-card--error' : hasWarn ? 'grp-card--alert' : ''}">
          <div class="grp-head" data-grp-id="${grp.id}">
            <span class="grp-name">${grp.name}</span>
            <span class="grp-meta">${grp.section} · ${grp.tasks.length}话题</span>
          </div>
          ${gInsts
            .map((inst) => {
              const dupN = botInstanceCounts[inst.botId]
              const doneN = inst.todos.filter((t) => t.st === 2).length
              const meta = EDGE_STATUS_META[inst.status] || EDGE_STATUS_META.typing
              const owner = state.ownersMap[inst.ownerId]
              return `
              <button type="button" class="thread-row" data-inst-id="${inst.id}" aria-current="${inst.id === state.selectedInstanceId}">
                <span class="dot dot--${inst.status}"></span>
                <span>
                  <div class="th-title">${inst.taskTitle}</div>
                  <div class="th-sub">${owner ? owner.short : ''} · ${inst.botName}${dupN > 1 ? ` ×${dupN}` : ''}</div>
                </span>
                <span class="pill pill--${meta.tone}">${meta.isAlert ? meta.short : `${doneN}/${inst.todos.length}`}</span>
              </button>`
            })
            .join('')}
        </div>`
      })
      .join('')}
  `

  sb.querySelectorAll('[data-grp-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const grp = state.groups.find((g) => g.id === el.dataset.grpId)
      if (grp) focusGroup(grp)
    })
  })
  sb.querySelectorAll('[data-inst-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const inst = state.instances.find((x) => x.id === el.dataset.instId)
      if (inst) {
        if (state.view !== 'floor') switchView('floor')
        focusInstance(inst)
      }
    })
  })

  // Right Inspector Drawer = the system's run tab (inspector.js)
  const sel = state.instances.find((x) => x.id === state.selectedInstanceId)
  const inspector = document.getElementById('inspector')
  const showInspector = state.view === 'floor' && Boolean(sel)
  inspector.hidden = !showInspector
  minimapCard.classList.toggle('shifted-left', showInspector)

  if (showInspector && sel) {
    renderInspector(inspector, sel, {
      owner: state.ownersMap[sel.ownerId] || { name: '团队成员', machine: 'Build Node' },
      siblings: state.instances.filter((x) => x.botId === sel.botId),
      onChange: renderUI,
      onClose: () => {
        state.selectedInstanceId = null
        renderUI()
      },
      onFocusSibling: (id) => {
        const target = state.instances.find((x) => x.id === id)
        if (target) focusInstance(target)
      },
    })
  }

  // Studio controls & 25-Figurine Catalog
  renderStudioUI()
}

function renderStudioUI() {
  const curMeta = ALL_FIGURINE_META.find((m) => m.key === state.studioFigurineKey) || ALL_FIGURINE_META[0]
  if (curMeta) {
    document.getElementById('studio-fig-title').textContent = curMeta.name
    const badge = document.getElementById('studio-fig-badge')
    badge.textContent = curMeta.category === 'role' ? '角色人格' : curMeta.vendor || 'Agent'
    badge.className = `pill ${curMeta.category === 'role' ? 'pill--thinking' : 'pill--running'}`
    const subParts = [curMeta.mix || curMeta.vendor, curMeta.finishLabel, curMeta.subtitle].filter(Boolean)
    document.getElementById('studio-fig-meta').textContent = subParts.join(' · ')
  }

  const glbModel = getGLBModel(state.studioFigurineKey)
  const glbBadge = document.getElementById('studio-glb-badge')
  const glbTris = document.getElementById('studio-glb-tris')
  if (glbBadge && glbTris) {
    if (glbModel) {
      glbBadge.textContent = 'Blender 5.2 精修 GLB'
      glbBadge.className = 'pill pill--glb'
      const slotN = glbModel.slotNames?.length || 1
      glbTris.textContent = `${glbModel.triangles.toLocaleString()} tris · ${slotN} 骨骼槽`
    } else {
      glbBadge.textContent = '程序化预览 (GLB 加载中)'
      glbBadge.className = 'pill pill--glb-fallback'
      glbTris.textContent = 'models/' + state.studioFigurineKey + '.glb'
    }
  }
  const catMeta = document.getElementById('studio-cat-meta')
  if (catMeta) {
    const loadedN = getGLBLoadedCount()
    catMeta.textContent = `12 官方 Agent · 13 角色人格 · ${loadedN}/${ALL_FIGURINE_META.length} GLB`
  }

  document.getElementById('studio-finish-hint').textContent = FINISH_LABELS[state.studioFinish] || '原厂精选'
  document.querySelectorAll('[data-finish]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.finish === state.studioFinish)))
  document.querySelectorAll('[data-clip]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.clip === state.studioClip)))
  document.getElementById('btn-explode').setAttribute('aria-pressed', String(state.studioTargetExplode > 0.5))
  document.querySelectorAll('[data-swatch]').forEach((s) => s.setAttribute('aria-checked', String(s.dataset.swatch === state.studioHex)))

  const catList = document.getElementById('studio-cat-list')
  if (catList && state.view === 'studio') {
    const renderItem = (m) => `
      <button type="button" class="fig-item" data-fig-key="${m.key}" aria-selected="${m.key === state.studioFigurineKey}">
        <span class="fig-swatch" style="background:${m.primaryHex || '#d97757'}"></span>
        <span>
          <div class="fig-name">${m.name}</div>
          <div class="fig-sub">${m.vendor || m.mix || m.subtitle || ''}</div>
        </span>
        <span class="fig-finish">${m.finishLabel || 'Vinyl'}</span>
      </button>
    `
    catList.innerHTML = `
      <div>
        <div class="studio-group-hdr"><span>12 款 Agent 手办</span><span>${AGENT_FIGURINE_META.length}</span></div>
        <div class="studio-cat-grid">${AGENT_FIGURINE_META.map(renderItem).join('')}</div>
      </div>
      <div>
        <div class="studio-group-hdr"><span>13 款角色人格手办</span><span>${ROLE_FIGURINE_META.length}</span></div>
        <div class="studio-cat-grid">${ROLE_FIGURINE_META.map(renderItem).join('')}</div>
      </div>
    `
    catList.querySelectorAll('[data-fig-key]').forEach((b) => {
      b.addEventListener('click', () => selectStudioFigurine(b.dataset.figKey, false))
    })
  }
}

function switchView(v) {
  const prev = state.view
  state.view = v
  const shellEl = document.getElementById('app-shell')
  if (v === 'studio' && prev !== 'studio') {
    state.savedSidebarCollapsed = shellEl.classList.contains('sidebar-collapsed')
    shellEl.classList.add('sidebar-collapsed')
  } else if (v !== 'studio' && prev === 'studio') {
    if (state.savedSidebarCollapsed === false) {
      shellEl.classList.remove('sidebar-collapsed')
    }
    state.savedSidebarCollapsed = null
  }
  if (v === 'studio') {
    setCameraPreset(state.studioMode === 'shelf' ? 'shelf' : 'studio')
  } else if (v === 'floor') {
    setCameraPreset('meso')
  }
  renderUI()
}

// ── Top-Level Event Bindings ──
document.querySelectorAll('[data-view-btn]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.viewBtn)))
document.getElementById('btn-collapse-sb').addEventListener('click', () => document.getElementById('app-shell').classList.toggle('sidebar-collapsed'))
document.querySelectorAll('[data-light]').forEach((b) => {
  b.addEventListener('click', () => {
    state.lighting = b.dataset.light
    renderUI()
  })
})

document.querySelectorAll('[data-nav-mode]').forEach((b) => {
  b.addEventListener('click', () => {
    state.navMode = b.dataset.navMode
    cam.mode = state.navMode
    renderUI()
  })
})

document.querySelectorAll('[data-cam]').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.view !== 'floor') switchView('floor')
    setCameraPreset(b.dataset.cam)
  })
})

document.getElementById('team-select').addEventListener('change', (e) => {
  state.teamFilter = e.target.value
  rebuildFromSnapshot()
})

document.getElementById('btn-focus-lounge').addEventListener('click', () => {
  if (state.view !== 'floor') switchView('floor')
  setCameraPreset('lounge')
})

function handleAddGroup() {
  if (state.view !== 'floor') switchView('floor')
  const { group } = appendNewGroupWorkshop(state, performance.now() / 1000)
  // Keep Inspector closed/unchanged so user stays focused on the newly appended 3D workshop
  focusGroup(group)
  renderUI()
}

function handleDispatchFromLounge() {
  if (state.view !== 'floor') switchView('floor')
  const targetGrp = state.groups[state.groups.length - 1]
  if (!targetGrp) return
  dispatchLoungeBotToGroup(state, targetGrp, null, performance.now() / 1000)
  cam.flyTo([(LOUNGE_BOUNDS.cx + targetGrp.cx) * 0.5, 0.3, (LOUNGE_BOUNDS.cz + targetGrp.cz) * 0.5], {
    dist: Math.max(16, Math.min(25, Math.hypot(targetGrp.cx - LOUNGE_BOUNDS.cx, targetGrp.cz - LOUNGE_BOUNDS.cz) * 1.15)),
  })
  renderUI()
}

document.getElementById('act-add-group').addEventListener('click', handleAddGroup)
document.getElementById('act-dispatch-lounge').addEventListener('click', handleDispatchFromLounge)
document.getElementById('btn-sb-dispatch').addEventListener('click', handleDispatchFromLounge)

document.getElementById('act-complete-return').addEventListener('click', () => {
  const sel = state.instances.find((x) => x.id === state.selectedInstanceId) || state.instances[state.instances.length - 1]
  if (!sel) return
  completeAndReturnToLounge(state, sel.id, performance.now() / 1000)
  state.selectedInstanceId = state.instances[0]?.id || null
  setCameraPreset('lounge')
  renderUI()
})

document.getElementById('act-dup-bot').addEventListener('click', () => {
  const hero = state.botCatalog[0]
  const targetGrp = state.groups[state.groups.length - 1]
  if (!hero || !targetGrp) return
  const tIdx = targetGrp.tasks.length
  const taskId = `dup-task-${Date.now()}`
  targetGrp.tasks.push({ id: taskId, title: `话题 #${50 + tIdx} · 跨群并行需求`, roundTable: false, pos: [0, 0] })
  const newInst = {
    id: `inst-${++state.instSeq}`,
    botId: hero.id,
    botName: hero.name,
    ownerId: hero.ownerId,
    agentKind: hero.agentKind,
    model: hero.model,
    tint: hero.tint,
    concurrency: Math.max(hero.concurrency, state.instances.filter((x) => x.botId === hero.id).length + 1),
    tier: hero.tier,
    cli: hero.cli,
    cliOutdated: hero.cliOutdated,
    groupId: targetGrp.id,
    groupName: targetGrp.name,
    repo: targetGrp.repo,
    syncMode: targetGrp.syncMode,
    taskId,
    taskTitle: `话题 #${50 + tIdx} · 跨群并行需求`,
    roundTable: false,
    seatIndex: 0,
    deskPos: [0, 0],
    pos: [0, 0],
    facing: Math.PI,
    status: 'typing',
    originUser: state.ownersMap[hero.ownerId]?.name || '陈工',
    filesChanged: 2,
    durationSec: 12,
    ctx: 19,
    ctxUsed: 190000,
    ctxSize: 1000000,
    step: 'edit · 跨群复制实体直接就位施工',
    subagents: [{ name: 'diff-check', task: 'Subagent · 并行执行中' }],
    todos: [
      { text: '解析跨群需求上下文', st: 2 },
      { text: '生成实现与回归测试', st: 1 },
      { text: '运行 pnpm check 自检', st: 0 },
    ],
    celebrateUntil: performance.now() / 1000 + 1.2,
    walk: null,
  }
  state.instances.push(newInst)
  computeGroupDimensions(targetGrp)
  syncGroupLayout(targetGrp, state.instances)
  focusInstance(newInst)
})

const EDGE_CYCLE = ['approval', 'question', 'auth_expired', 'workspace_confirm', 'force_conflict', 'thinking']
let edgeCycleIdx = 0
document.getElementById('act-cycle-edge').addEventListener('click', () => {
  const sel = state.instances.find((x) => x.id === state.selectedInstanceId) || state.instances[0]
  if (!sel) return
  const nextStatus = EDGE_CYCLE[edgeCycleIdx % EDGE_CYCLE.length]
  edgeCycleIdx++
  sel.status = nextStatus
  if (nextStatus === 'approval') {
    sel.approvalCmd = 'pnpm --filter @gonggong/server db:generate && git push gitlab main'
    sel.step = '等待审批：数据库迁移与推送'
  } else if (nextStatus === 'question') {
    sel.questionText = '是否同步更新英文词典 en.ts 并开启自动化回归？'
    sel.questionOptions = ['同步更新并回归（推荐）', '仅修复中文主分支']
    sel.step = '等待主人回答问题'
  } else if (nextStatus === 'auth_expired') {
    sel.authDetail = 'Authentication required ({"category":"auth"})'
    sel.step = '运行出错：登录凭据过期，等待重新授权'
  } else if (nextStatus === 'workspace_confirm') {
    sel.workspacePath = '~/workspace/gonggong-space (branch: feat/3d-factory)'
    sel.step = '等待确认本地仓库工作区'
  } else if (nextStatus === 'force_conflict') {
    sel.conflictFiles = ['apps/server/src/db/schema.ts', 'packages/protocol/src/run.ts']
    sel.step = '强制同步检测到 2 个文件冲突'
  } else {
    sel.step = 'think · 深度推理并发架构方案'
  }
  focusInstance(sel)
})

document.getElementById('alert-jump').addEventListener('click', () => {
  const alerts = getAlertInstances()
  if (!alerts.length) return
  const curIdx = alerts.findIndex((x) => x.id === state.selectedInstanceId)
  const next = alerts[(curIdx + 1) % alerts.length]
  if (state.view !== 'floor') switchView('floor')
  focusInstance(next)
})

// Studio controls, sub-mode switcher, PBR finish switcher & 25-Figurine GLB export
document.querySelectorAll('[data-studio-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    state.studioMode = b.dataset.studioMode
    setCameraPreset(state.studioMode === 'shelf' ? 'shelf' : 'studio')
    renderUI()
  }),
)
document.querySelectorAll('[data-finish]').forEach((b) =>
  b.addEventListener('click', () => {
    state.studioFinish = b.dataset.finish
    renderUI()
  }),
)
document.querySelectorAll('[data-clip]').forEach((b) =>
  b.addEventListener('click', () => {
    state.studioClip = b.dataset.clip
    renderUI()
  }),
)
document.getElementById('btn-explode').addEventListener('click', () => {
  state.studioTargetExplode = state.studioTargetExplode > 0.5 ? 0 : 1
  renderUI()
})
document.getElementById('btn-reset-tint').addEventListener('click', () => {
  state.studioHex = ''
  renderUI()
})
document.querySelectorAll('[data-swatch]').forEach((s) =>
  s.addEventListener('click', () => {
    state.studioHex = s.dataset.swatch
    renderUI()
  }),
)
document.getElementById('btn-export-glb').addEventListener('click', () => {
  const dl = getGLBDownloadInfo(state.studioFigurineKey)
  if (dl && dl.bytes && dl.bytes.byteLength > 0) {
    const blob = new Blob([dl.bytes], { type: 'model/gltf-binary' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = dl.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
    return
  }

  const collector = {
    calls: [],
    add(meshName, model, color, matType, emissive = [0, 0, 0], alpha = 1.0) {
      this.calls.push({ meshName, model, color, matType, emissive, alpha })
    },
  }
  drawFigurine(collector, state.studioFigurineKey, {
    x: 0,
    baseY: 0,
    z: 0,
    ry: 0,
    scale: 1.0,
    tintHex: state.studioHex || undefined,
    action: 'idle',
    time: 0,
    explode: 0,
    finishOverride: state.studioFinish === 'default' ? null : state.studioFinish,
    forceProcedural: true,
    lod: 'high',
  })
  const glbBytes = exportFigurineGLB(state.studioFigurineKey, collector.calls)
  const blob = new Blob([glbBytes], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.studioFigurineKey}_figurine.glb`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
})

// Lightbox & MCP copy
const lightbox = document.getElementById('lightbox')
const lightboxImg = document.getElementById('lightbox-img')
document.querySelectorAll('[data-zoom-src]').forEach((img) =>
  img.addEventListener('click', () => {
    lightboxImg.src = img.dataset.zoomSrc
    lightbox.hidden = false
  }),
)
lightbox.addEventListener('click', () => {
  lightbox.hidden = true
})
document.getElementById('btn-copy-mcp').addEventListener('click', (e) => {
  navigator.clipboard?.writeText(document.getElementById('mcp-json').textContent)
  const btn = e.currentTarget
  const prev = btn.textContent
  btn.textContent = '已复制'
  setTimeout(() => {
    btn.textContent = prev
  }, 1500)
})

// ── Semantic Zoom 3D Overlay Badges ──
const domPool = new Map()
function getBadge(key, cls) {
  let el = domPool.get(key)
  if (!el) {
    el = document.createElement('div')
    el.className = cls
    labelsLayer.appendChild(el)
    domPool.set(key, el)
  }
  return el
}

function syncSemanticZoomLabels(cssW, cssH) {
  if (state.view !== 'floor') return
  const lod = cam.dist > 25.0 ? 'macro' : cam.dist > 14.5 ? 'meso' : 'micro'
  const lodEl = document.getElementById('lod-indicator')
  const modeHint = state.navMode === 'pan' ? '左键平移 · 右键旋转' : '左键旋转 · 右键平移'
  lodEl.textContent = `${modeHint} · 拖拽工坊顶栏 ⋮⋮ 可重排 · ${lod === 'macro' ? '远景全局' : lod === 'meso' ? '中景街区' : '近景微距'}`

  // Clip labelsLayer strictly outside top HUD, bottom HUD, and open right Inspector so ZERO fragments bleed!
  const inspOpen = Boolean(state.selectedInstanceId)
  const rightSafeMargin = inspOpen ? 368 : 12
  labelsLayer.style.clipPath = `inset(52px ${rightSafeMargin}px 56px 0px)`

  // Minimap exclusion box so 3D pills never overlap the radar border
  const mmRight = inspOpen ? 374 : 14
  const mmLeft = cssW - mmRight - 226
  const mmTop = cssH - 62 - 208
  const hitsMinimap = (x, y, halfW = 60) => x + halfW > mmLeft && x - halfW < cssW - mmRight && y > mmTop

  for (const el of domPool.values()) el.style.display = 'none'

  // Lightweight 2D collision nudging registry
  const placedRects = []
  function placeWithoutOverlap(x, y, halfW, height, maxNudge = 2) {
    let curY = y
    for (let attempt = 0; attempt <= maxNudge; attempt++) {
      const hit = placedRects.some(
        (r) => Math.abs(x - r.x) < halfW + r.hw + 6 && Math.abs(curY - r.y) < (height + r.h) * 0.5 + 4,
      )
      if (!hit) {
        placedRects.push({ x, y: curY, hw: halfW, h: height })
        return curY
      }
      curY -= height + 6
    }
    return null
  }

  const maxVisibleX = cssW - rightSafeMargin - 16
  // Smooth edge-fade helper so labels crossing near the left sidebar seam or right edge fade cleanly instead of chopping mid-word
  const edgeOpacity = (x, halfW) => {
    const leftClear = x - halfW
    const rightClear = maxVisibleX - (x + halfW)
    const minClear = Math.min(leftClear, rightClear)
    if (minClear <= -12) return 0
    if (minClear >= 24) return 1
    return (minClear + 12) / 36
  }

  // 1. Living Lounge Banner (NO Standby Plaza!)
  const loungeVisible = state.loungeBots.filter((lb) => !lb.leavingToPool).length
  const hiddenN = state.hiddenIdlePool.length
  const lp = projectWorldToScreen([LOUNGE_BOUNDS.cx, 1.56, LOUNGE_BOUNDS.minZ], cam.vp, cssW, cssH)
  const lpOp = lp ? edgeOpacity(lp.x, 115) : 0
  if (lp && lpOp > 0.05 && lp.y > 58 && lp.y < cssH - 62 && !hitsMinimap(lp.x, lp.y, 115)) {
    const ny = placeWithoutOverlap(lp.x, lp.y, 115, 28, 1)
    if (ny !== null) {
      const el = getBadge('zone-lounge', 'zone-banner zone-banner--lounge')
      el.style.display = 'inline-flex'
      el.style.opacity = lpOp.toFixed(2)
      el.style.left = `${lp.x}px`
      el.style.top = `${ny}px`
      el.onclick = () => setCameraPreset('lounge')
      el.innerHTML = `
        <div class="zb-row">
          <span class="dot dot--lounge"></span>
          <span>休闲茶歇区 · 休闲中 ${loungeVisible} · 候场隐藏 +${hiddenN}</span>
        </div>
      `
    }
  }

  // 2. Draggable Group Workshop Banners with Crystal-Clear Work Summary
  for (const grp of state.groups) {
    const gInsts = state.instances.filter((s) => s.groupId === grp.id)
    const errN = gInsts.filter((s) => ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(s.status)).length
    const warnN = gInsts.filter((s) => ['approval', 'question', 'workspace_confirm'].includes(s.status)).length
    const isDragging = state.draggingGroupId === grp.id

    const p = projectWorldToScreen([grp.cx, 1.42, grp.cz - grp.d * 0.5], cam.vp, cssW, cssH)
    const pOp = p ? (isDragging ? 1 : edgeOpacity(p.x, 108)) : 0
    if (!p || pOp <= 0.05 || p.y < 58 || p.y > cssH - 62) continue
    if (!isDragging && hitsMinimap(p.x, p.y, 105)) continue

    const ny = isDragging ? p.y : placeWithoutOverlap(p.x, p.y, 108, 42, 2)
    if (ny === null) continue

    const el = getBadge(`grp-${grp.id}`, 'zone-banner')
    el.className = `zone-banner ${isDragging ? 'zone-banner--dragging' : errN > 0 ? 'zone-banner--error' : warnN > 0 ? 'zone-banner--alert' : ''}`
    el.style.display = 'inline-flex'
    el.style.opacity = pOp.toFixed(2)
    el.style.left = `${p.x}px`
    el.style.top = `${ny}px`

    const totalTodos = gInsts.reduce((acc, s) => acc + s.todos.length, 0)
    const doneTodos = gInsts.reduce((acc, s) => acc + s.todos.filter((t) => t.st === 2).length, 0)
    const dotCls = errN > 0 ? 'error' : warnN > 0 ? 'approval' : 'running'

    el.innerHTML = `
      <div class="zb-row">
        <span class="zb-drag-grip" title="按住拖拽移动工坊">⋮⋮</span>
        <span class="dot dot--${dotCls}"></span>
        <span>${grp.name}</span>
        <span class="pill pill--${errN > 0 ? 'error' : warnN > 0 ? 'approval' : 'running'}">${gInsts.length}施工${errN ? ` · ${errN}异常` : warnN ? ` · ${warnN}待处理` : ''}</span>
      </div>
      <div class="zb-progress"><i style="width:${totalTodos ? Math.round((doneTodos / totalTodos) * 100) : 0}%"></i></div>
    `

    el.onpointerdown = (e) => {
      e.stopPropagation()
      const sx = e.clientX
      const sy = e.clientY
      let moved = false
      const onMove = (me) => {
        if (!moved && Math.hypot(me.clientX - sx, me.clientY - sy) > 4) {
          moved = true
          startGroupDrag(grp, me.clientX, me.clientY)
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        if (!moved) focusGroup(grp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
  }

  // 3. Individual Station / Bot Tags (Alerts prioritized, collision-checked so overview stays crisp!)
  const orderedInsts = [...state.instances].sort((a, b) => {
    const aAlert = EDGE_STATUS_META[a.status]?.isAlert ? 1 : 0
    const bAlert = EDGE_STATUS_META[b.status]?.isAlert ? 1 : 0
    return bAlert - aAlert
  })

  for (const inst of orderedInsts) {
    if (state.ownerFilter !== 'all' && inst.ownerId !== state.ownerFilter) continue
    const meta = EDGE_STATUS_META[inst.status] || EDGE_STATUS_META.typing
    const isSel = inst.id === state.selectedInstanceId
    if (lod === 'macro' && !meta.isAlert && !isSel) continue

    const p = projectWorldToScreen([inst.pos[0], 1.06, inst.pos[1]], cam.vp, cssW, cssH)
    const estHW = lod === 'micro' ? 48 : 22
    const pOp = p ? edgeOpacity(p.x, estHW) : 0
    if (!p || pOp <= 0.05 || p.y < 60 || p.y > cssH - 60) continue
    if (hitsMinimap(p.x, p.y, 72)) continue

    const estH = 30
    const ny = isSel ? p.y : placeWithoutOverlap(p.x, p.y, estHW, estH, meta.isAlert ? 2 : 1)
    if (ny === null) continue

    const el = getBadge(`st-${inst.id}`, 'station-tag')
    const toneCls = meta.isAlert ? `station-tag--${meta.tone}` : ''
    el.className = `station-tag ${toneCls} ${isSel ? 'station-tag--selected' : ''}`
    el.style.display = 'inline-flex'
    el.style.opacity = pOp.toFixed(2)
    el.style.left = `${p.x}px`
    el.style.top = `${ny}px`
    el.onclick = () => focusInstance(inst)

    const doneN = inst.todos.filter((t) => t.st === 2).length
    const word = meta.isAlert ? meta.short : lod === 'micro' ? shortBotName(inst.botName) : ''
    const sig = `${activityGlyph(inst)}|${doneN}/${inst.todos.length}|${word}`
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig
      el.title = `${inst.botName} · ${meta.label} · ${doneN}/${inst.todos.length}`
      el.innerHTML = `${glyphRing(activityGlyph(inst), doneN, inst.todos.length)}${word ? `<span class="chip-word">${word}</span>` : ''}`
    }
  }
}

// One animated glyph says what a bot is doing; the ring around it is its plan progress.
function activityGlyph(inst) {
  const byStatus = {
    approval: 'shield',
    question: 'ask',
    workspace_confirm: 'folder',
    auth_expired: 'alert',
    rate_limit: 'alert',
    force_conflict: 'alert',
    forbidden: 'alert',
    error: 'alert',
    done: 'check',
    thinking: 'think',
    reading: 'read',
    subagent_swarm: 'swarm',
  }
  if (byStatus[inst.status]) return byStatus[inst.status]
  const verb = String(inst.step || '').split(/[ ·]/)[0].toLowerCase()
  if (/^(run|bash|run_command|exec|shell)/.test(verb)) return 'term'
  if (/^(read|read_file|search|grep|glob|fetch|list)/.test(verb)) return 'read'
  if (/^think/.test(verb)) return 'think'
  return 'type'
}

const GLYPHS = {
  type: '<span class="g g-type"><i></i><i></i><i></i></span>',
  term: '<span class="g g-term">›<i></i></span>',
  read: '<span class="g g-read"></span>',
  think: '<span class="g g-think"><i></i><i></i><i></i></span>',
  swarm: '<span class="g g-swarm"><i></i><i></i></span>',
  shield: '<span class="g g-pulse">!</span>',
  ask: '<span class="g g-ask">?</span>',
  folder: '<span class="g g-pulse">⌂</span>',
  alert: '<span class="g g-alert">!</span>',
  check: '<span class="g g-check">✓</span>',
}

function glyphRing(kind, done, total) {
  const c = 2 * Math.PI * 11
  const p = total ? done / total : 0
  return `<span class="chip-ring"><svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11" class="ring-track"/><circle cx="13" cy="13" r="11" class="ring-fill" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>${GLYPHS[kind]}</span>`
}

function shortBotName(name) {
  const tail = String(name).split('-').pop()
  return tail.length > 6 ? `${tail.slice(0, 6)}…` : tail
}

const SHELF_SHORT_NAMES = {
  claude: 'Clawd',
  codex: 'Codex',
  gemini: 'Gemini',
  codebuddy: 'CodeBuddy',
  pi: 'Pi',
  deepseek: 'DeepSeek',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  qwen: 'Qwen',
  kimi: 'Kimi',
  goose: 'Goose',
  copilot: 'Copilot',
}

function syncShelfLabels(cssW, cssH) {
  labelsLayer.style.clipPath = 'inset(52px 12px 58px 12px)'
  for (const el of domPool.values()) el.style.display = 'none'

  for (const item of MUSEUM_SHELF_ITEMS) {
    // Anchor each row's pill tightly to its own front puck edge so Row 2/3 faces stay 100% unobstructed
    const labelY = item.tier === 3 ? item.y + 0.03 : item.tier === 2 ? item.y + 0.01 : item.y - 0.03
    const labelZ = item.tier === 3 ? item.z + 0.40 : item.tier === 2 ? item.z + 0.44 : item.z + 0.52
    const p = projectWorldToScreen([item.x, labelY, labelZ], cam.vp, cssW, cssH)
    if (!p || p.x < 28 || p.x > cssW - 28 || p.y < 58 || p.y > cssH - 64) continue
    const el = getBadge(`shelf-${item.key}`, 'shelf-tag')
    const isSel = item.key === state.studioFigurineKey
    el.className = `shelf-tag ${isSel ? 'shelf-tag--selected' : ''}`
    el.style.display = 'inline-flex'
    el.style.opacity = '1'
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    el.onclick = () => selectStudioFigurine(item.key, true)
    const shortName = SHELF_SHORT_NAMES[item.key] || String(item.meta.name || item.key).split(' ')[0]
    el.innerHTML = `<span class="shelf-tag-dot" style="background:${item.meta.primaryHex || '#d97757'}"></span><span>${shortName}</span>`
  }
}

// ── Data Initialization ──
function rebuildFromSnapshot() {
  labelsLayer.innerHTML = ''
  domPool.clear()
  const built = buildWorkbenchState(state.snapshotRaw, state.teamFilter)
  Object.assign(state, built)

  // Start with Inspector closed by default and framed on full overview (all 5 groups + Living Lounge)
  state.selectedInstanceId = null
  renderTeamSelect()
  setCameraPreset('macro')
  renderUI()
}

async function init() {
  onGLBLoaded(() => {
    if (state.view === 'studio') renderStudioUI()
  })

  // Prioritize active studio figurine & preload all 25 Blender-refined .glb models in parallel
  const allKeys = ALL_FIGURINE_META.map((m) => m.key)
  const orderedKeys = [state.studioFigurineKey, ...allKeys.filter((k) => k !== state.studioFigurineKey)]
  preloadAllGLBs(renderer, orderedKeys, 6)

  const { data, isReal } = await loadWorkbenchSnapshot()
  state.snapshotRaw = data
  state.isRealData = isReal
  rebuildFromSnapshot()
}

// ── Main 60fps Loop ──
let prevTime = performance.now() / 1000
function frame(nowMs) {
  const now = nowMs / 1000
  const dt = Math.min(0.05, Math.max(0.001, now - prevTime))
  prevTime = now

  const sky = daylightAt(presetDate(state.lighting))
  const ease = 1 - Math.exp(-dt * 4.0)
  const prev = state.daylight || sky
  state.daylight = {
    ...sky,
    dir: prev.dir.map((v, i) => v + (sky.dir[i] - v) * ease),
    radiance: prev.radiance.map((v, i) => v + (sky.radiance[i] - v) * ease),
    shadowSoft: prev.shadowSoft + (sky.shadowSoft - prev.shadowSoft) * ease,
    vent: prev.vent + (sky.vent - prev.vent) * ease,
  }
  state.nightBlend += (sky.nightBlend - state.nightBlend) * ease
  state.goldenBlend += (sky.goldenBlend - state.goldenBlend) * ease
  setVentilation(state.daylight.vent)
  syncDaylightTheme()
  state.studioExplode += (state.studioTargetExplode - state.studioExplode) * (1 - Math.exp(-dt * 7.0))

  // Smoothly spring-animate Lounge sliding door
  const doorTarget = now < (state.loungeDoorPulseUntil || 0) ? 1 : 0
  const doorStep = critDamp(state.loungeDoorOpen, state.loungeDoorVel, doorTarget, 0.22, dt)
  state.loungeDoorOpen = doorStep.value
  state.loungeDoorVel = doorStep.vel

  // Advance Living Lounge & Dispatch choreography
  if (tickChoreography(state, dt, now)) {
    renderUI()
  }

  if (state.view !== 'blueprints') {
    const cssW = Math.max(1, canvas.clientWidth)
    const cssH = Math.max(1, canvas.clientHeight)
    cam.update(dt, cssW, cssH)

    renderer.beginFrame()
    renderer.daylight = state.view === 'floor' ? state.daylight : null
    if (state.view === 'floor') {
      drawCampusScene(renderer, now)
      renderer.render(cam, state.nightBlend, now, Math.min(34, Math.max(15, cam.dist * 0.9)), state.goldenBlend)
      syncSemanticZoomLabels(cssW, cssH)
      drawMinimap()
    } else if (state.view === 'studio') {
      drawStudioScene(renderer, now)
      renderer.render(cam, state.nightBlend, now, state.studioMode === 'shelf' ? 9.5 : 2.8, state.goldenBlend)
      if (state.studioMode === 'shelf') {
        syncShelfLabels(cssW, cssH)
      }
    }
  }

  requestAnimationFrame(frame)
}

init()
requestAnimationFrame(frame)
