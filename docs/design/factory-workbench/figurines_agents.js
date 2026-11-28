import {
  MAT,
  TRS,
  mat4Mul,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Scale,
  mat4Translate,
} from './renderer.js?v=b5r'

/**
 * 12 Official Gonggong AgentKind Collectible 3D Figurines
 * Museum-grade designer toy proportions (height ~0.96–1.08m, grounded flush on y = baseY).
 * Supports full action rig, LOD ('high' | 'low'), exploded view (0..1), PBR finish overrides,
 * and exact descriptor collection for binary GLB export.
 */

export const AGENT_FIGURINE_META = [
  {
    key: 'claude',
    category: 'agent',
    name: 'Claude Code',
    vendor: 'Anthropic',
    subtitle: '陶土四足 Clawd · 12 射线星芒背徽',
    primaryHex: '#d97757',
    secondaryHex: '#c15f3c',
    finishLabel: '哑光潮玩 Vinyl',
  },
  {
    key: 'codex',
    category: 'agent',
    name: 'Codex',
    vendor: 'OpenAI',
    subtitle: '靛蓝云结团子 · 闪烁终端光标嘴',
    primaryHex: '#6864f7',
    secondaryHex: '#3941ff',
    finishLabel: '哑光潮玩 Vinyl',
  },
  {
    key: 'gemini',
    category: 'agent',
    name: 'Gemini CLI',
    vendor: 'Google',
    subtitle: '晶透四角星棱体 · 伴星环绕',
    primaryHex: '#5c8eff',
    secondaryHex: '#3d5fe0',
    finishLabel: '晶透水晶 Crystal',
  },
  {
    key: 'codebuddy',
    category: 'agent',
    name: 'CodeBuddy',
    vendor: '腾讯',
    subtitle: '青紫兜帽赛博伙伴 · 斜角发光条眼',
    primaryHex: '#2ea99d',
    secondaryHex: '#6c4dff',
    finishLabel: '哑光潮玩 Vinyl',
  },
  {
    key: 'pi',
    category: 'agent',
    name: 'pi',
    vendor: 'Earendil',
    subtitle: '石板灰阶梯 L 体 · 弹跳黄铜像素点',
    primaryHex: '#525b6e',
    secondaryHex: '#262b36',
    finishLabel: '哑光潮玩 + 拉丝黄铜',
  },
  {
    key: 'deepseek',
    category: 'agent',
    name: 'DeepSeek Harness',
    vendor: '深度求索',
    subtitle: '釉面青瓷深海鲸 · 晶透上升水泡',
    primaryHex: '#5a7cff',
    secondaryHex: '#3552e8',
    finishLabel: '釉面陶瓷 Ceramic',
  },
  {
    key: 'antigravity',
    category: 'agent',
    name: 'Antigravity CLI',
    vendor: 'Google',
    subtitle: '悬浮 A 形翼拱 · 磁浮推进光环',
    primaryHex: '#5390ff',
    secondaryHex: '#3186ff',
    finishLabel: '釉面陶瓷 + 晶透核心',
  },
  {
    key: 'opencode',
    category: 'agent',
    name: 'OpenCode',
    vendor: 'Anomaly',
    subtitle: '迪特·拉姆斯黑曜套框 · 发光铝芯',
    primaryHex: '#2a2c32',
    secondaryHex: '#0a0a0a',
    finishLabel: '黑曜哑光 + 阳极铝',
  },
  {
    key: 'qwen',
    category: 'agent',
    name: 'Qwen Code',
    vendor: '阿里巴巴',
    subtitle: '折纸切面蓝宝石六棱体 · 银边嵌饰',
    primaryHex: '#4768ff',
    secondaryHex: '#082dff',
    finishLabel: '釉面陶瓷 Ceramic',
  },
  {
    key: 'kimi',
    category: 'agent',
    name: 'Kimi Code',
    vendor: '月之暗面',
    subtitle: '午夜瓷韵 K 纹护盾 · 轨道珍珠月轮',
    primaryHex: '#303242',
    secondaryHex: '#0b0b12',
    finishLabel: '釉面陶瓷 Ceramic',
  },
  {
    key: 'goose',
    category: 'agent',
    name: 'Goose',
    vendor: 'Block',
    subtitle: '暖白极简大白鹅 · 炭黑羽翼橘红蹼',
    primaryHex: '#e8e4dc',
    secondaryHex: '#2b2a28',
    finishLabel: '哑光潮玩 Vinyl',
  },
  {
    key: 'copilot',
    category: 'agent',
    name: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    subtitle: '石墨飞行员头盔 · 青光护目镜耳罩',
    primaryHex: '#454d58',
    secondaryHex: '#1b2028',
    finishLabel: '哑光潮玩 + 熏黑镜片',
  },
]

const META_BY_KEY = Object.fromEntries(AGENT_FIGURINE_META.map((m) => [m.key, m]))

const ACTION_ALIASES = {
  running: 'typing',
  work: 'typing',
  approval: 'approval_raise',
  awaiting_approval: 'approval_raise',
  awaiting_answer: 'question_ask',
  question: 'question_ask',
  auth: 'auth_expired',
  forbidden: 'auth_expired',
  rate_limit: 'context_compact',
  force_conflict: 'error_spark',
  done: 'celebrate_done',
  completed: 'celebrate_done',
  error: 'error_spark',
  failed: 'error_spark',
  walk: 'walk_to_work',
  lounge: 'sip_coffee',
  offline: 'recharge_nap',
  offline_wait: 'recharge_nap',
  queued: 'thinking',
}

function normalizeAction(action) {
  if (!action) return 'idle'
  return ACTION_ALIASES[action] || action
}

function hexToRGB(hex = '#d97757') {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const n = parseInt(clean, 16)
  if (Number.isNaN(n)) return [0.85, 0.47, 0.34]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function getMats() {
  return {
    VINYL: MAT.VINYL_MATTE ?? MAT.FIGURINE,
    CERAMIC: MAT.CERAMIC_GLAZE ?? MAT.CERAMIC ?? MAT.FIGURINE,
    CRYSTAL: MAT.CRYSTAL_GLASS ?? MAT.GLASS,
    BRASS: MAT.BRUSHED_BRASS ?? MAT.ALUMINUM,
    ALU: MAT.ALUMINUM,
    TI: MAT.TITANIUM,
    OBS: MAT.OBSIDIAN,
    EM: MAT.EMISSIVE,
    GLASS: MAT.GLASS,
  }
}

function resolveShellFinish(defaultMat, finishOverride, defaultAlpha = 1.0) {
  const M = getMats()
  if (!finishOverride || finishOverride === 'default') {
    return { mat: defaultMat, alpha: defaultAlpha }
  }
  switch (finishOverride) {
    case 'vinyl':
    case 'matte':
      return { mat: M.VINYL, alpha: 1.0 }
    case 'ceramic':
    case 'glaze':
      return { mat: M.CERAMIC, alpha: 1.0 }
    case 'crystal':
    case 'glass':
      return { mat: M.CRYSTAL, alpha: 0.78 }
    case 'metal':
    case 'titanium':
    case 'aluminum':
      return { mat: M.ALU, alpha: 1.0 }
    case 'brass':
      return { mat: M.BRASS, alpha: 1.0 }
    default:
      return { mat: defaultMat, alpha: defaultAlpha }
  }
}

function effortCount(effort) {
  if (typeof effort === 'number') return Math.max(1, Math.min(4, Math.round(effort)))
  if (effort === 'max') return 4
  if (effort === 'high') return 3
  if (effort === 'low') return 1
  return 2
}

/**
 * Shared procedural pose solver for all 12 Agent figurines.
 */
function computePose(action, t) {
  const pose = {
    bobY: 0,
    jitterX: 0,
    jitterZ: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    armLX: 0,
    armLZ: 0,
    armRX: 0,
    armRZ: 0,
    legL: 0,
    legR: 0,
    legSwings: [0, 0, 0, 0],
    sittingOffset: 0,
    eyeMode: 0,
    ledEmissive: [0.15, 0.95, 0.62],
  }

  switch (action) {
    case 'typing': {
      pose.bobY = Math.sin(t * 7.5) * 0.012
      pose.pitch = 0.08
      pose.armLX = -0.82 + Math.sin(t * 18.0) * 0.24
      pose.armRX = -0.82 + Math.cos(t * 18.0) * 0.24
      pose.eyeMode = 1.0
      pose.ledEmissive = [0.08, 1.45, 2.65]
      break
    }
    case 'thinking': {
      pose.bobY = Math.sin(t * 2.1) * 0.018
      pose.roll = Math.sin(t * 1.1) * 0.07
      pose.yaw = Math.sin(t * 0.85) * 0.14
      pose.armRX = -1.45 + Math.sin(t * 1.8) * 0.06
      pose.armRZ = -0.25
      pose.armLX = -0.35 + Math.sin(t * 1.3) * 0.05
      pose.eyeMode = 4.0
      const p = 0.65 + 0.35 * Math.sin(t * 3.0)
      pose.ledEmissive = [0.75 * p, 0.55 * p, 2.8 * p]
      break
    }
    case 'reading': {
      pose.bobY = Math.sin(t * 2.4) * 0.01
      pose.pitch = 0.06
      pose.yaw = Math.sin(t * 2.2) * 0.12
      pose.armLX = -0.95
      pose.armLZ = 0.18
      pose.armRX = -0.95
      pose.armRZ = -0.18
      pose.eyeMode = 9.0
      pose.ledEmissive = [0.12, 1.65, 2.35]
      break
    }
    case 'subagent_swarm': {
      pose.bobY = Math.sin(t * 5.2) * 0.015
      pose.pitch = 0.04
      pose.armLX = -0.92 + Math.sin(t * 14.0) * 0.18
      pose.armRX = -1.15 + Math.cos(t * 9.0) * 0.22
      pose.eyeMode = 1.0
      pose.ledEmissive = [0.22, 1.95, 2.9]
      break
    }
    case 'approval_raise': {
      pose.bobY = Math.sin(t * 3.8) * 0.022
      pose.roll = -0.05
      pose.armRX = -2.42 + Math.sin(t * 5.5) * 0.14
      pose.armRZ = 0.14
      pose.armLX = -0.18
      pose.eyeMode = 2.0
      const p = 0.6 + 0.4 * Math.sin(t * 6.4)
      pose.ledEmissive = [3.4 * p, 1.6 * p, 0.1]
      break
    }
    case 'question_ask': {
      pose.bobY = Math.sin(t * 3.0) * 0.018
      pose.roll = 0.14 + Math.sin(t * 2.0) * 0.04
      pose.armRX = -1.55 + Math.sin(t * 3.5) * 0.16
      pose.armRZ = 0.28
      pose.armLX = -0.32
      pose.eyeMode = 5.0
      const p = 0.65 + 0.35 * Math.sin(t * 4.5)
      pose.ledEmissive = [2.6 * p, 1.85 * p, 0.25]
      break
    }
    case 'auth_expired': {
      pose.bobY = -0.032 + Math.sin(t * 1.8) * 0.008
      pose.pitch = 0.20
      pose.armLX = 0.15
      pose.armLZ = -0.08
      pose.armRX = 0.15
      pose.armRZ = 0.08
      pose.eyeMode = 8.0
      const p = 0.35 + 0.65 * Math.abs(Math.sin(t * 4.8))
      pose.ledEmissive = [3.1 * p, 0.18 * p, 0.15 * p]
      break
    }
    case 'context_compact': {
      const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
      pose.bobY = -0.02 * comp
      pose.armLX = -1.05
      pose.armLZ = 0.28 + comp * 0.18
      pose.armRX = -1.05
      pose.armRZ = -(0.28 + comp * 0.18)
      pose.eyeMode = 1.0
      pose.ledEmissive = [0.9 + comp * 1.4, 1.45 - comp * 0.4, 2.4 - comp * 1.2]
      break
    }
    case 'workspace_confirm': {
      pose.bobY = Math.sin(t * 2.6) * 0.012
      pose.pitch = 0.04
      pose.armLX = -1.02
      pose.armLZ = 0.22
      pose.armRX = -1.02
      pose.armRZ = -0.22
      pose.eyeMode = 9.0
      pose.ledEmissive = [0.25, 1.8, 2.4]
      break
    }
    case 'error_spark': {
      pose.jitterX = Math.sin(t * 48.0) * 0.022
      pose.jitterZ = Math.cos(t * 53.0) * 0.022
      pose.roll = Math.sin(t * 24.0) * 0.08
      pose.armLX = -1.35 + Math.sin(t * 16.0) * 0.25
      pose.armLZ = -0.45
      pose.armRX = -1.35 + Math.cos(t * 16.0) * 0.25
      pose.armRZ = 0.45
      pose.eyeMode = 3.0
      pose.ledEmissive = [3.6, 0.22, 0.18]
      break
    }
    case 'celebrate_done': {
      pose.bobY = Math.abs(Math.sin(t * 6.8)) * 0.14
      pose.roll = Math.sin(t * 6.8) * 0.08
      pose.armLX = -2.55 + Math.sin(t * 10.0) * 0.18
      pose.armLZ = -0.22
      pose.armRX = -2.55 - Math.sin(t * 10.0) * 0.18
      pose.armRZ = 0.22
      pose.eyeMode = 7.0
      pose.ledEmissive = [0.18, 2.9, 0.95]
      break
    }
    case 'walk_to_work': {
      const s = Math.sin(t * 10.5)
      pose.bobY = Math.abs(s) * 0.042
      pose.pitch = 0.12
      const ls = s * 0.46
      pose.legL = ls
      pose.legR = -ls
      pose.legSwings = [ls, -ls, ls, -ls]
      pose.armLX = -ls * 0.78
      pose.armRX = ls * 0.78
      pose.eyeMode = 1.0
      pose.ledEmissive = [0.18, 1.55, 2.2]
      break
    }
    case 'sip_coffee': {
      const sip = Math.max(0, Math.sin(t * 1.35))
      pose.bobY = Math.sin(t * 2.0) * 0.012
      pose.pitch = -sip * 0.08
      pose.armRX = -0.68 - sip * 0.62
      pose.armRZ = -0.18
      pose.armLX = -0.12 + Math.sin(t * 1.6) * 0.05
      pose.ledEmissive = [0.35, 1.25, 0.75]
      break
    }
    case 'chat_wave': {
      pose.bobY = Math.sin(t * 3.2) * 0.016
      pose.pitch = Math.sin(t * 2.8) * 0.07
      pose.armRX = -2.15 + Math.sin(t * 6.2) * 0.25
      pose.armRZ = 0.26 + Math.sin(t * 6.2) * 0.15
      pose.armLX = -0.25 + Math.sin(t * 2.5) * 0.08
      pose.ledEmissive = [0.22, 1.45, 1.05]
      break
    }
    case 'bench_swing': {
      pose.sittingOffset = -0.06
      pose.bobY = Math.sin(t * 2.4) * 0.008
      const sw = Math.sin(t * 4.2) * 0.34
      pose.legL = -0.92 + sw
      pose.legR = -0.92 - sw
      pose.legSwings = [-0.95 + sw, -0.95 - sw, -0.95 + sw, -0.95 - sw]
      pose.armLX = -0.28 + Math.sin(t * 2.1) * 0.06
      pose.armRX = -0.28 - Math.sin(t * 2.1) * 0.06
      pose.ledEmissive = [0.25, 1.2, 0.85]
      break
    }
    case 'recharge_nap': {
      pose.bobY = -0.02 + Math.sin(t * 1.4) * 0.014
      pose.pitch = 0.10 + Math.sin(t * 1.4) * 0.03
      pose.armLX = 0.08
      pose.armRX = 0.08
      pose.eyeMode = 6.0
      const p = 0.55 + 0.45 * Math.sin(t * 1.8)
      pose.ledEmissive = [0.15 * p, 1.65 * p, 0.95 * p]
      break
    }
    case 'stroll_lounge': {
      const s = Math.sin(t * 4.8)
      pose.bobY = Math.abs(s) * 0.022
      pose.pitch = 0.04
      const ls = s * 0.28
      pose.legL = ls
      pose.legR = -ls
      pose.legSwings = [ls, -ls, ls, -ls]
      pose.armLX = -ls * 0.55
      pose.armRX = ls * 0.55
      pose.ledEmissive = [0.25, 1.3, 0.88]
      break
    }
    default: {
      pose.bobY = Math.sin(t * 2.2) * 0.014
      pose.armLX = Math.sin(t * 2.2) * 0.06
      pose.armRX = -Math.sin(t * 2.2) * 0.06
      break
    }
  }
  return pose
}

// Matrix convenience builders
const xform = (parent, tx, ty, tz, sx, sy, sz) =>
  mat4Mul(parent, mat4Mul(mat4Translate(tx, ty, tz), mat4Scale(sx, sy, sz)))

const xformRot = (parent, tx, ty, tz, rx, ry, rz, sx, sy, sz) => {
  let m = mat4Mul(parent, mat4Translate(tx, ty, tz))
  if (ry) m = mat4Mul(m, mat4RotateY(ry))
  if (rz) m = mat4Mul(m, mat4RotateZ(rz))
  if (rx) m = mat4Mul(m, mat4RotateX(rx))
  return mat4Mul(m, mat4Scale(sx, sy, sz))
}

/**
 * Shared twin collectible boots/legs grounded cleanly on y = 0.
 */
function drawTwinBoots(ctx, legX = 0.16, legTopY = 0.30, legW = 0.135, legD = 0.16, legCol = null) {
  const { add, root, pose, ex, shellCol, shellMat, shellAlpha, tiCol, M, dimmed } = ctx
  const col = legCol || shellCol
  const h = legTopY - 0.045
  const xs = [-legX, legX]
  const swings = [pose.legL, pose.legR]
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1
    const pivot = mat4Mul(
      root,
      mat4Mul(mat4Translate(xs[i] + dir * ex * 0.11, legTopY + pose.bobY * 0.35 - ex * 0.14, 0), mat4RotateX(swings[i])),
    )
    add('pillBox', xform(pivot, 0, -h * 0.5, 0, legW, h, legD), col, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
    // Chunky grounded boot sole flush at y = 0
    add('bevelBox', xform(pivot, 0, -(legTopY - 0.025), 0.015, legW * 1.08, 0.05, legD * 1.18), tiCol, M.TI, [0, 0, 0], ctx.alpha, 0, false)
  }
}

/**
 * Adds a crisp glossy white eye catchlight dot for soulful designer-toy expression.
 */
function addCatchlight(ctx, parent, x, y, z, r = 0.022) {
  if (ctx.dimmed || ctx.pose.eyeMode !== 0) return
  ctx.add('sphere', xform(parent, x, y, z, r, r, r * 0.6), [1, 1, 1], ctx.M.EM, [1.55, 1.60, 1.70], 1, 0, false)
}

/**
 * Shared articulated arms with snug precision-molded shoulder sockets (zero air gap).
 */
function drawStandardArms(ctx, shoulderX, shoulderY, armW, armH, armD, armCol = null, mesh = 'pillBox', cuffCol = null, leftXOverride = null, rightXOverride = null) {
  const { add, upper, pose, ex, shellCol, shellMat, shellAlpha, tiCol, M, alpha } = ctx
  const col = armCol || shellCol
  const makeArm = (dir, rx, rz) => {
    const sx = dir < 0 ? (leftXOverride ?? shoulderX) : (rightXOverride ?? shoulderX)
    // Snug titanium shoulder pin bridging deep into torso so zero gap is visible
    add(
      'cyl',
      xformRot(upper, dir * (sx - 0.045 + ex * 0.20), shoulderY, 0, 0, 0, Math.PI * 0.5, armD * 0.88, 0.125, armD * 0.88),
      tiCol,
      M.TI,
      [0, 0, 0],
      alpha,
      0,
      false,
    )
    const pivot = mat4Mul(
      upper,
      mat4Mul(mat4Translate(dir * (sx + ex * 0.30), shoulderY, 0), mat4Mul(mat4RotateZ(rz), mat4RotateX(rx))),
    )
    // Rounded shoulder ball cap for cohesive vinyl look
    add('sphere', xform(pivot, 0, 0.015, 0, armW * 1.04, armW * 1.04, armD * 1.02), col, shellMat, [0, 0, 0], shellAlpha, 0, false)
    add(mesh, xform(pivot, 0, -armH * 0.36, 0, armW, armH, armD), col, shellMat, [0, 0, 0], shellAlpha, 0, false)
    if (cuffCol) {
      add('cyl', xform(pivot, 0, -armH * 0.72, 0, armW * 1.06, 0.032, armD * 1.06), cuffCol, M.ALU, [0, 0, 0], alpha, 0, false)
    }
    return pivot
  }
  makeArm(-1, pose.armLX, pose.armLZ)
  return makeArm(1, pose.armRX, pose.armRZ)
}

/**
 * Shared action-specific 3D props & holograms (works for all 12 figurines).
 */
function drawActionProps(ctx, rightPivot, headTopY = 0.52) {
  const { add, upper, action, t, time, x, z, baseY, scale, effort, subagents, shellCol, M, dimmed, forExport } = ctx
  if (dimmed || forExport) return

  if (action === 'approval_raise') {
    if (rightPivot) {
      add('bevelBox', xform(rightPivot, 0.06, -0.34, 0.08, 0.44, 0.29, 0.032), [1.0, 0.74, 0.18], M.GLASS, [2.85, 1.35, 0.10], 0.86, 0, false)
    }
    const bp = 0.7 + 0.3 * Math.sin(t * 6.4)
    const orbY = headTopY + 0.22 + Math.sin(t * 4.0) * 0.04
    add('sphere', xform(upper, 0, orbY, 0, 0.20, 0.20, 0.20), [1, 0.82, 0.22], M.EM, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
    const wave = (t * 0.65) % 1.0
    const haloR = 0.38 + wave * 0.24
    add('thinTorus', xform(upper, 0, orbY, 0, haloR, haloR, haloR), [1, 0.85, 0.3], M.EM, [3.0 * bp, 1.45 * bp, 0.1], (1.0 - wave) * 0.82, 0, false)
  } else if (action === 'question_ask') {
    const qBob = Math.abs(Math.sin(t * 3.8)) * 0.10
    const qY = headTopY + 0.22 + qBob
    add('sphere', xform(upper, 0, qY, 0, 0.22, 0.22, 0.22), [0.85, 0.64, 1.0], M.EM, [1.75, 0.65, 3.25], 0.96, 0, false)
    add('thinTorus', xformRot(upper, 0, qY, 0, 0.4, t * 1.8, 0, 0.42, 0.42, 0.42), [0.88, 0.74, 1.0], M.EM, [1.55, 0.58, 2.9], 0.84, 0, false)
  } else if (action === 'thinking') {
    const ringN = effortCount(effort)
    for (let r = 0; r < ringN; r++) {
      const rr = 0.24 + r * 0.14
      const yOff = headTopY + 0.08 + r * 0.11 + Math.sin(t * 2.5 + r) * 0.025
      const tilt = r % 2 === 0 ? 0.22 : -0.22
      const spin = t * (1.4 + r * 0.55) * (r % 2 === 0 ? 1 : -1)
      add('thinTorus', xformRot(upper, 0, yOff, 0, tilt, spin, 0, rr, rr, rr), [0.65, 0.62, 1.0], M.EM, [0.55, 0.48, 2.25], 0.78, 0, false)
    }
  } else if (action === 'error_spark' || action === 'auth_expired') {
    const p = 0.65 + 0.35 * Math.sin(t * 9.0)
    add('octa', xformRot(upper, 0, headTopY + 0.24, 0, 0, t * 3.2, 0, 0.24, 0.28, 0.24), [1, 0.24, 0.18], M.EM, [3.5 * p, 0.24 * p, 0.18 * p], 0.96, 0, false)
    if (action === 'error_spark') {
      for (let s = 0; s < 3; s++) {
        const a = t * 5.0 + s * 2.09
        add('bevelBox', xformRot(upper, Math.cos(a) * 0.38, headTopY + 0.14 + Math.sin(t * 10 + s) * 0.06, Math.sin(a) * 0.32, a, a, 0, 0.05, 0.14, 0.05), [1, 0.55, 0.18], M.EM, [3.2, 1.1, 0.15], 0.92, 0, false)
      }
    }
  } else if (action === 'celebrate_done') {
    for (let s = 0; s < 4; s++) {
      const a = t * 2.8 + s * (Math.PI * 0.5)
      const r = 0.32 + Math.sin(t * 5.0 + s) * 0.06
      add('octa', xformRot(upper, Math.cos(a) * r, headTopY + 0.18 + Math.abs(Math.sin(t * 4.5 + s)) * 0.12, Math.sin(a) * r, 0, a, 0, 0.09, 0.09, 0.09), [0.22, 1.0, 0.62], M.EM, [0.22, 2.8, 0.95], 0.95, 0, false)
    }
  } else if (action === 'sip_coffee' && rightPivot) {
    // Ceramic espresso cup held cleanly in front of paw tip (zero arm intersection) + rising warm steam
    add('cyl', xform(rightPivot, 0.0, -0.35, 0.145, 0.125, 0.135, 0.125), [0.96, 0.95, 0.92], M.CERAMIC, [0, 0, 0], 1, 0, false)
    add('torus', xformRot(rightPivot, 0.0, -0.35, 0.08, 0, Math.PI * 0.5, 0, 0.075, 0.075, 0.075), [0.94, 0.92, 0.88], M.CERAMIC, [0, 0, 0], 1, 0, false)
    add('cyl', xform(rightPivot, 0.0, -0.285, 0.145, 0.10, 0.014, 0.10), [0.22, 0.12, 0.07], M.OBS, [0, 0, 0], 1, 0, false)
    const st = (t * 0.8) % 1.0
    add('sphere', xform(rightPivot, Math.sin(t * 3.0) * 0.018, -0.19 + st * 0.18, 0.145, 0.048 * (1 - st * 0.4), 0.068, 0.048), [0.95, 0.96, 0.98], M.GLASS, [0.55, 0.55, 0.58], (1 - st) * 0.55, 0, false)
  } else if (action === 'reading' || action === 'workspace_confirm') {
    add('bevelBox', xformRot(upper, 0, -0.02, 0.44, -0.42, 0, 0, 0.42, 0.28, 0.024), [0.15, 0.85, 1.0], M.GLASS, [0.18, 1.35, 2.25], 0.72, 0, false)
  }

  const droneN = action === 'subagent_swarm' ? Math.max(2, subagents || 0) : subagents || 0
  if (droneN > 0) {
    const count = Math.min(4, droneN)
    for (let d = 0; d < count; d++) {
      const ang = time * 2.4 + (d * Math.PI * 2) / count
      const dx = x + Math.cos(ang) * 0.82 * scale
      const dz = z + Math.sin(ang) * 0.72 * scale
      add('bevelBox', TRS(dx, baseY + 1.24 * scale, dz, -ang, 0.22 * scale, 0.065 * scale, 0.22 * scale), shellCol, M.EM, [0.22, 1.55, 2.65], 1, 0, false)
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 12 OFFICIAL AGENT SCULPTORS (all grounded on y = 0, height ~0.96–1.08m)
// ═════════════════════════════════════════════════════════════════════════════

/** 1. CLAUDE CODE — Iconic 4-legged blocky terracotta Clawd + 12-ray spark back badge */
function sculptClaude(ctx) {
  const { add, root, upper, pose, ex, shellCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, brassCol, M, alpha, dimmed, lod } = ctx
  const box = lod === 'low' ? 'fastBox' : 'bevelBox'

  // Main blocky torso + stepped crown + lower skirt
  add(box, xform(upper, 0, 0, 0, 0.92, 0.56, 0.56), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add(box, xform(upper, 0, 0.315 + ex * 0.24, 0, 0.72, 0.10, 0.46), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, false)

  if (lod === 'low') {
    for (const lx of [-0.295, -0.115, 0.115, 0.295]) {
      add('fastBox', xform(root, lx, 0.165, 0, 0.132, 0.31, 0.152), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, false)
    }
    return { rightPivot: null, headTopY: 0.44 }
  }

  add('bevelBox', xform(upper, 0, -0.295 - ex * 0.05, 0, 0.84, 0.055, 0.50), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, false)

  // Recessed obsidian eyes + titanium micro-bezel frames + glossy catchlights (clean >=0.017m Z clearance from torso front 0.280)
  const eyeZ = 0.288 + ex * 0.22
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.17, 0.03, eyeZ - 0.006, 0.114, 0.212, 0.030), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
    add('bevelBox', xform(upper, dir * 0.17, 0.03, eyeZ + 0.004, 0.092, 0.19, 0.040), obsCol, M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.17 - 0.022, 0.088, eyeZ + 0.028, 0.022)
  }

  // Flush-recessed top-left status LED bezel + glowing pip (cleanly integrated into crown)
  if (!dimmed) {
    add('bevelBox', xform(upper, -0.22, 0.356 + ex * 0.26, 0.13, 0.088, 0.022, 0.072), aluCol, M.ALU, [0, 0, 0], 1, 0, false)
    add('bevelBox', xform(upper, -0.22, 0.369 + ex * 0.28, 0.145, 0.062, 0.018, 0.038), [1, 1, 1], M.EM, pose.ledEmissive, 1, 0, false)

    // Back 12-ray Anthropic spark emblem + brushed aluminum nameplate (cleanly behind torso back -0.280)
    const backZ = -0.296 - ex * 0.20
    for (let r = 0; r < 6; r++) {
      const ang = (r * Math.PI) / 6
      add('bevelBox', xformRot(upper, 0, 0.07, backZ, 0, 0, ang, 0.022, 0.23, 0.016), brassCol, M.BRASS, [0, 0, 0], 1, 0, false)
    }
    add('cyl', xformRot(upper, 0, 0.07, backZ, Math.PI * 0.5, 0, 0, 0.064, 0.020, 0.064), brassCol, M.BRASS, [0, 0, 0], 1, 0, false)
    add('bevelBox', xform(upper, 0, -0.14, backZ, 0.44, 0.095, 0.020), aluCol, M.ALU, [0, 0, 0], 1, 0, false)
  }

  // Snug articulated arms (zero shoulder gap)
  const rightPivot = drawStandardArms(ctx, 0.52, -0.02, 0.12, 0.34, 0.14, shellCol, 'bevelBox')

  // Iconic 4 articulated Clawd legs with titanium foot pads flush on y = 0
  const legXs = [-0.295, -0.115, 0.115, 0.295]
  legXs.forEach((lx, idx) => {
    const legPivot = mat4Mul(
      root,
      mat4Mul(mat4Translate(lx * (1 + ex * 0.36), 0.33 + pose.bobY * 0.35 - ex * 0.18, 0), mat4RotateX(pose.legSwings[idx])),
    )
    add('bevelBox', xform(legPivot, 0, -0.15, 0, 0.132, 0.28, 0.152), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
    add('bevelBox', xform(legPivot, 0, -0.312, 0, 0.122, 0.036, 0.144), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
  })

  return { rightPivot, headTopY: 0.44 }
}

/** 2. CODEX — Sculpted rounded-cloud / interlocking-knot indigo collectible + blinking cursor mouth */
function sculptCodex(ctx) {
  const { add, root, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, M, alpha, dimmed, lod } = ctx
  const puff = 1.0 + Math.sin(t * 2.6) * 0.022

  // Central plump cloud core
  add('pillBox', xform(upper, 0, 0.02, 0, 0.66 * puff, 0.56 / puff, 0.48), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // 6 sculpted cloud-knot lobes around perimeter (OpenAI Codex rosette silhouette)
  const lobeCount = lod === 'low' ? 4 : 6
  for (let i = 0; i < lobeCount; i++) {
    const a = (i * Math.PI * 2) / lobeCount + Math.PI / 6
    const r = 0.23 + ex * 0.18
    const lx = Math.cos(a) * r
    const ly = 0.03 + Math.sin(a) * r * 0.92
    const lobeCol = i % 2 === 0 ? shellCol : mixRGB(shellCol, secCol, 0.28)
    add('sphere', xform(upper, lx, ly, -0.02, 0.35 * puff, 0.35, 0.38), lobeCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  }

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.17, 0.28, 0.14, 0.17, secCol)
    return { rightPivot: null, headTopY: 0.44 }
  }

  // Thick sculpted ceramic face plate deeply embedded into cloud core (zero side-view air gap, ~0.03m proud front!)
  const faceZ = 0.228 + ex * 0.22
  add('pillBox', xform(upper, 0, 0.02, faceZ - 0.068, 0.48, 0.34, 0.160), [0.95, 0.96, 0.99], M.CERAMIC, [0, 0, 0], alpha, 0, false)

  // Glossy ink-obsidian eyes + embedded catchlights + rosy blush cheeks seated into face plate
  for (const dir of [-1, 1]) {
    add('sphere', xform(upper, dir * 0.115, 0.065, faceZ + 0.004, 0.082, 0.105, 0.052), [0.012, 0.014, 0.026], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.115 - 0.015, 0.088, faceZ + 0.022, 0.020)
    add('sphere', xform(upper, dir * 0.185, -0.015, faceZ - 0.012, 0.055, 0.035, 0.040), [1.0, 0.68, 0.76], M.VINYL, [0, 0, 0], alpha, 0, false)
  }

  // Smooth non-flickering terminal-cursor mouth `_` deeply embedded into face plate
  add('bevelBox', xform(upper, 0, -0.055, faceZ - 0.004, 0.148, 0.042, 0.034), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
  if (!dimmed) {
    const pulse = 0.30 + 0.70 * (0.5 + 0.5 * Math.sin(t * 4.2))
    add('bevelBox', xform(upper, 0, -0.055, faceZ + 0.006, 0.132, 0.030, 0.030), [0.22, 0.92, 1.0], M.EM, [0.45 * pulse, 1.85 * pulse, 2.65 * pulse], 1, 0, false)
  }

  // Molded brushed-silver back ring badge seated flush into cloud back (zero side-view air gap!)
  if (!dimmed) {
    const bz = -0.225 - ex * 0.20
    add('torus', xformRot(upper, 0, 0.02, bz, Math.PI * 0.5, 0, 0, 0.26, 0.26, 0.22), aluCol, M.ALU, [0, 0, 0], 1, 0, false)
    add('sphere', xform(upper, 0, 0.02, bz - 0.006, 0.092, 0.092, 0.080), [1, 1, 1], M.EM, pose.ledEmissive, 1, 0, false)
  }

  const rightPivot = drawStandardArms(ctx, 0.39, -0.04, 0.13, 0.28, 0.13, shellCol, 'pillBox')
  drawTwinBoots(ctx, 0.17, 0.28, 0.145, 0.175, secCol)
  return { rightPivot, headTopY: 0.44 }
}

/** 3. GEMINI CLI — Rich sapphire-violet faceted 4-point crystal star + glossy obsidian eyes + orbiting twin-star */
function sculptGemini(ctx) {
  const { add, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, aluCol, M, alpha, dimmed, lod } = ctx
  const starMat = ctx.finishOverride ? shellMat : M.CRYSTAL
  const starAlpha = ctx.finishOverride ? shellAlpha : dimmed ? 0.24 : 0.90
  const deepBlue = mixRGB(shellCol, [0.16, 0.34, 0.96], 0.55)
  const periwinkle = mixRGB(secCol, [0.42, 0.30, 0.96], 0.50)

  // Richer sapphire-to-periwinkle faceted 4-point Gemini star
  add('octa', xform(upper, 0, 0.04, 0, 0.38, 0.84, 0.34), deepBlue, starMat, [0.10, 0.24, 0.78], starAlpha, 0, !dimmed)
  add('octa', xform(upper, 0, 0.04, 0, 0.84, 0.38, 0.34), periwinkle, starMat, [0.16, 0.20, 0.75], starAlpha, 0, !dimmed)
  // Sculpted inner crystal shoulder core so arms anchor solidly with zero gap
  add('octa', xformRot(upper, 0, 0.04, 0, 0, 0, Math.PI * 0.25, 0.48, 0.48, 0.36), mixRGB(deepBlue, periwinkle, 0.45), starMat, [0.16, 0.34, 0.88], starAlpha, 0, false)

  if (!dimmed) {
    add('sphere', xform(upper, 0, 0.04, 0, 0.22, 0.22, 0.22), [0.72, 0.86, 1.0], M.EM, [0.35, 0.75, 1.85], 0.92, 0, false)
  }

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.13, 0.28, 0.10, 0.12, deepBlue)
    return { rightPivot: null, headTopY: 0.48 }
  }

  // Glossy porcelain-ceramic face medallion with crisp dark sapphire-obsidian eyes + catchlights
  const fz = 0.175 + ex * 0.22
  add('cyl', xformRot(upper, 0, 0.04, fz - 0.015, Math.PI * 0.5, 0, 0, 0.34, 0.055, 0.34), deepBlue, M.CERAMIC, [0, 0, 0], alpha, 0, false)
  add('cyl', xformRot(upper, 0, 0.04, fz, Math.PI * 0.5, 0, 0, 0.30, 0.052, 0.30), [0.97, 0.98, 1.0], M.CERAMIC, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.068, 0.068, fz + 0.028, 0.048, 0.072, 0.026), [0.010, 0.014, 0.032], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.068 - 0.011, 0.090, fz + 0.044, 0.016)
    add('sphere', xform(upper, dir * 0.108, 0.022, fz + 0.022, 0.038, 0.024, 0.014), [0.78, 0.82, 1.0], M.CERAMIC, [0, 0, 0], alpha, 0, false)
  }
  add('bevelBox', xform(upper, 0, -0.014, fz + 0.026, 0.072, 0.022, 0.018), [0.015, 0.020, 0.045], M.OBS, [0, 0, 0], alpha, 0, false)

  // Orbiting glowing mini twin-star satellite at upper-right
  const twinScale = 0.72 + 0.28 * Math.sin(t * 2.8)
  const tx = 0.34 + Math.cos(t * 1.4) * 0.04 + ex * 0.22
  const ty = 0.36 + Math.sin(t * 2.4) * 0.045 + ex * 0.24
  const tz = 0.06 + Math.sin(t * 1.4) * 0.06
  add('octa', xform(upper, tx, ty, tz, 0.08 * twinScale, 0.20 * twinScale, 0.08 * twinScale), [0.82, 0.93, 1.0], M.EM, [0.65, 1.35, 2.85], 0.95, 0, false)
  add('octa', xform(upper, tx, ty, tz, 0.20 * twinScale, 0.08 * twinScale, 0.08 * twinScale), [0.82, 0.93, 1.0], M.EM, [0.65, 1.35, 2.85], 0.95, 0, false)

  // Snug articulated arms tucked cleanly into the star body (zero air gap!)
  const rightPivot = drawStandardArms(ctx, 0.29, -0.05, 0.098, 0.26, 0.10, deepBlue, 'pillBox', aluCol)
  drawTwinBoots(ctx, 0.14, 0.28, 0.105, 0.135, deepBlue)
  return { rightPivot, headTopY: 0.48 }
}

/** 4. CODEBUDDY — Sleek teal-to-violet hooded cyber-buddy + deep recessed smoked visor + twin angled bar-eyes */
function sculptCodeBuddy(ctx) {
  const { add, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, M, alpha, dimmed, lod } = ctx
  const hoodCol = shellCol // #2ea99d teal
  const cloakCol = secCol // #6c4dff violet

  // Tapered violet cyber-body core
  add('pillBox', xform(upper, 0, -0.08, -0.02, 0.56, 0.44, 0.42), cloakCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Sculpted overarching matte-teal vinyl hood cowl (sweeping top + side cheeks + back taper)
  add('pillBox', xform(upper, 0, 0.14 + ex * 0.18, -0.02, 0.70, 0.46, 0.52), hoodCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('cone', xformRot(upper, 0, 0.34 + ex * 0.26, -0.14, -0.58, 0, 0, 0.42, 0.34, 0.42), hoodCol, shellMat, [0, 0, 0], shellAlpha, 0, false)

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.15, 0.29, 0.13, 0.15, tiCol)
    return { rightPivot: null, headTopY: 0.46 }
  }

  // Violet inner hood rim collar
  add('torus', xformRot(upper, 0, 0.10, 0.17 + ex * 0.14, Math.PI * 0.5, 0, 0, 0.44, 0.34, 0.26), cloakCol, shellMat, [0, 0, 0], shellAlpha, 0, false)

  // Deep recessed smoked-glass cyber visor
  const vz = 0.205 + ex * 0.20
  add('pillBox', xform(upper, 0, 0.10, vz, 0.44, 0.27, 0.12), obsCol, M.OBS, [0, 0, 0], alpha, 0, false)

  // Twin angled glowing cyan-white bar-eyes (official CodeBuddy tilted bars) with periodic blink
  const blinkPhase = (t * 0.34) % 1.0
  const eyeScaleY = blinkPhase > 0.93 ? 0.22 : 1.0
  if (!dimmed) {
    add('pillBox', xformRot(upper, -0.09, 0.085, vz + 0.062, 0, 0, 0.46, 0.048, 0.125 * eyeScaleY, 0.024), [0.85, 1.0, 0.98], M.EM, [0.45, 2.35, 2.15], 1, 0, false)
    add('pillBox', xformRot(upper, 0.095, 0.125, vz + 0.062, 0, 0, 0.46, 0.048, 0.125 * eyeScaleY, 0.024), [0.85, 1.0, 0.98], M.EM, [0.45, 2.35, 2.15], 1, 0, false)
    // Subtle angled smile bar
    add('bevelBox', xformRot(upper, 0.02, 0.015, vz + 0.058, 0, 0, 0.28, 0.09, 0.018, 0.016), [0.75, 0.95, 1.0], M.EM, [0.35, 1.5, 1.85], 0.9, 0, false)
  }

  // Brushed titanium cyber-belt + back badge
  add('bevelBox', xform(upper, 0, -0.25, 0, 0.58, 0.055, 0.44), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
  if (!dimmed) {
    add('bevelBox', xform(upper, 0, -0.06, -0.24 - ex * 0.18, 0.28, 0.08, 0.022), aluCol, M.ALU, [0, 0, 0], 1, 0, false)
  }

  const rightPivot = drawStandardArms(ctx, 0.33, -0.06, 0.115, 0.30, 0.125, hoodCol, 'pillBox', cloakCol)
  drawTwinBoots(ctx, 0.15, 0.29, 0.135, 0.16, cloakCol)
  return { rightPivot, headTopY: 0.46 }
}

/** 5. PI — Sharp architectural slate-graphite stepped L-block + hopping brushed-brass pixel-cube companion dot */
function sculptPi(ctx) {
  const { add, root, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, brassCol, M, alpha, dimmed, lod } = ctx
  const box = lod === 'low' ? 'fastBox' : 'bevelBox'

  // Architectural stepped L-block silhouette (exact pi glyph geometry)
  // Top horizontal lintel bar
  add(box, xform(upper, -0.04, 0.18 + ex * 0.18, 0, 0.72, 0.34, 0.38), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Mid-left architectural step
  add(box, xform(upper, -0.15, -0.10, 0, 0.48, 0.24, 0.38), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // Left solid pillar leg + right recessed titanium stabilizer foot (grounded flush on y = 0)
  const leftPivot = mat4Mul(root, mat4Mul(mat4Translate(-0.26 - ex * 0.14, 0.40 + pose.bobY * 0.35 - ex * 0.14, 0), mat4RotateX(pose.legL)))
  add(box, xform(leftPivot, 0, -0.18, 0, 0.24, 0.36, 0.36), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('bevelBox', xform(leftPivot, 0, -0.38, 0, 0.25, 0.04, 0.37), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  const rightLegPivot = mat4Mul(root, mat4Mul(mat4Translate(0.02, 0.30 + pose.bobY * 0.35 - ex * 0.14, 0), mat4RotateX(pose.legR)))
  add(box, xform(rightLegPivot, 0, -0.13, 0, 0.13, 0.26, 0.20), secCol, shellMat, [0, 0, 0], shellAlpha, 0, false)
  add('bevelBox', xform(rightLegPivot, 0, -0.28, 0, 0.15, 0.04, 0.22), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  // Hopping brushed-brass detached pixel-cube companion dot on the right!
  const hopCycle = (t * 1.15) % 1.0
  const hopY = hopCycle < 0.45 ? Math.sin((hopCycle / 0.45) * Math.PI) * 0.13 : 0
  const dotMat = ctx.finishOverride ? shellMat : M.BRASS
  const dotCol = ctx.finishOverride ? mixRGB(shellCol, [0.92, 0.80, 0.45], 0.5) : brassCol
  add(box, xform(root, 0.28 + ex * 0.30, 0.17 + hopY, 0, 0.21, 0.34, 0.26), dotCol, dotMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Tiny grounded pad under companion dot
  add('bevelBox', xform(root, 0.28 + ex * 0.30, 0.014, 0, 0.18, 0.028, 0.22), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  if (lod === 'low') return { rightPivot: null, headTopY: 0.42 }

  // Crisp rectangular obsidian pixel eyes + catchlights + machined aluminum mouth bar
  const ez = 0.194 + ex * 0.20
  add('bevelBox', xform(upper, -0.19, 0.20, ez, 0.075, 0.125, 0.028), obsCol, M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
  add('bevelBox', xform(upper, -0.01, 0.20, ez, 0.075, 0.125, 0.028), obsCol, M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
  addCatchlight(ctx, upper, -0.208, 0.236, ez + 0.018, 0.018)
  addCatchlight(ctx, upper, -0.028, 0.236, ez + 0.018, 0.018)
  add('bevelBox', xform(upper, -0.10, 0.095, ez, 0.11, 0.024, 0.02), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)

  // Top brass architectural trim strip + LED
  add('bevelBox', xform(upper, -0.04, 0.362 + ex * 0.24, 0, 0.68, 0.024, 0.34), brassCol, M.BRASS, [0, 0, 0], alpha, 0, false)
  if (!dimmed) {
    add('bevelBox', xform(upper, 0.22, 0.382 + ex * 0.28, 0.08, 0.065, 0.022, 0.065), [1, 1, 1], M.EM, pose.ledEmissive, 1, 0, false)
  }

  // Asymmetric exact shoulders matching offset lintel (-0.40 .. +0.32)
  const rightPivot = drawStandardArms(ctx, 0.38, 0.14, 0.095, 0.28, 0.105, tiCol, 'bevelBox', aluCol, 0.425, 0.345)
  return { rightPivot, headTopY: 0.42 }
}

/** 6. DEEPSEEK HARNESS — Kawaii glazed porcelain-ceramic deep-sea whale + sweeping tail fluke + crystal bubbles */
function sculptDeepSeek(ctx) {
  const { add, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, M, alpha, dimmed, lod } = ctx
  const swimTilt = Math.sin(t * 2.4) * 0.045
  const whaleBody = mat4Mul(upper, mat4RotateZ(swimTilt))

  // Plump, rounded kawaii glazed-porcelain whale body + cute rounded forehead melon
  add('sphere', xform(whaleBody, 0, -0.01, 0.01, 0.72, 0.56, 0.68), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('sphere', xform(whaleBody, 0, 0.05 + ex * 0.10, 0.14, 0.58, 0.44, 0.48), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Soft ivory-white glazed porcelain whale belly
  add('sphere', xform(whaleBody, 0, -0.15 - ex * 0.08, 0.09, 0.55, 0.28, 0.54), [0.95, 0.97, 1.0], M.CERAMIC, [0, 0, 0], alpha, 0, false)

  // Sweeping sculpted whale tail peduncle + prominent twin tail fluke lobes curving upward
  const tailWag = Math.sin(t * 3.6) * 0.14
  const tailBase = mat4Mul(whaleBody, mat4Mul(mat4Translate(0.05, 0.0, -0.30 - ex * 0.20), mat4RotateY(tailWag - 0.18)))
  add('cone', xformRot(tailBase, 0, 0.11, -0.08, -0.78, 0, 0, 0.28, 0.38, 0.26), secCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('pillBox', xformRot(tailBase, -0.15, 0.29, -0.18, -0.28, -0.22, 0.46, 0.30, 0.07, 0.17), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('pillBox', xformRot(tailBase, 0.15, 0.29, -0.18, -0.28, 0.22, -0.46, 0.30, 0.07, 0.17), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.13, 0.22, 0.12, 0.15, secCol)
    return { rightPivot: null, headTopY: 0.46 }
  }

  // Crisp glossy ink-obsidian eyes + neatly centered upper-left catchlights + clean rosy cheeks
  const ez = 0.35 + ex * 0.18
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(whaleBody, dir * 0.128, 0.055, ez, 0.068, 0.088, 0.036), [0.008, 0.010, 0.022], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, whaleBody, dir * 0.128 - 0.008, 0.072, ez + 0.020, 0.015)
    add('sphere', xform(whaleBody, dir * 0.178, -0.020, ez - 0.012, 0.054, 0.032, 0.028), [1.0, 0.68, 0.78], M.CERAMIC, [0, 0, 0], alpha, 0, false)
  }
  add('bevelBox', xform(whaleBody, 0, -0.048, ez + 0.012, 0.095, 0.022, 0.02), [0.012, 0.016, 0.035], M.OBS, [0, 0, 0], alpha, 0, false)

  // 2 rising translucent crystal water-droplet bubbles above blowhole!
  if (!dimmed) {
    for (let b = 0; b < 2; b++) {
      const cyc = (t * 0.55 + b * 0.5) % 1.0
      const by = 0.32 + cyc * 0.26 + ex * (0.20 + b * 0.10)
      const bx = (b === 0 ? -0.06 : 0.07) + Math.sin(t * 2.5 + b * 2.0) * 0.025
      const br = (b === 0 ? 0.085 : 0.115) * (0.75 + 0.25 * Math.sin(cyc * Math.PI))
      add('sphere', xform(whaleBody, bx, by, 0.06, br, br * 1.06, br), [0.68, 0.86, 1.0], M.CRYSTAL, [0.35, 0.85, 1.95], 0.82, 0, false)
    }
  }

  // Snug precision-molded pectoral whale flippers tucked cleanly into the whale torso!
  const makeFlipper = (dir, rx, rz) => {
    const pivot = mat4Mul(
      whaleBody,
      mat4Mul(mat4Translate(dir * (0.295 + ex * 0.22), -0.06, 0.07), mat4Mul(mat4RotateZ(rz + dir * 0.42), mat4RotateX(rx))),
    )
    add('sphere', xform(pivot, -dir * 0.02, 0.01, 0, 0.13, 0.13, 0.14), secCol, shellMat, [0, 0, 0], shellAlpha, 0, false)
    add('pillBox', xform(pivot, dir * 0.03, -0.09, 0, 0.11, 0.24, 0.14), secCol, shellMat, [0, 0, 0], shellAlpha, 0, false)
    return pivot
  }
  makeFlipper(-1, pose.armLX, pose.armLZ)
  const rightPivot = makeFlipper(1, pose.armRX, pose.armRZ)

  // Short cute rounded porcelain whale feet tucked cleanly beneath the belly
  drawTwinBoots(ctx, 0.135, 0.23, 0.12, 0.15, secCol)
  return { rightPivot, headTopY: 0.52 }
}

/** 7. ANTIGRAVITY CLI — Sleek levitating aerodynamic A-arch hull + floating face orb + anti-grav thruster ring */
function sculptAntigravity(ctx) {
  const { add, root, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, M, alpha, dimmed, lod } = ctx
  const hoverY = Math.sin(t * 2.4) * 0.032

  // Grounded magnetic levitation base disc (flush on y = 0, so zero unintended floating)
  add('cyl', xform(root, 0, 0.025, 0, 0.52, 0.05, 0.52), aluCol, M.ALU, [0, 0, 0], alpha, 0, !dimmed)
  add('cyl', xform(root, 0, 0.052, 0, 0.36, 0.016, 0.36), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  // Hovering glowing anti-grav thruster ring underneath arch
  if (!dimmed) {
    const thrPulse = 0.85 + 0.15 * Math.sin(t * 5.0)
    add('torus', xform(root, 0, 0.14 + hoverY * 0.5 - ex * 0.06, 0, 0.44 * thrPulse, 0.35, 0.44 * thrPulse), [0.55, 0.85, 1.0], M.EM, [0.35, 1.45, 2.95], 0.92, 0, false)
    add('thinTorus', xform(root, 0, 0.10 + hoverY * 0.3, 0, 0.32, 0.30, 0.32), [0.75, 0.92, 1.0], M.CRYSTAL, [0.25, 1.15, 2.45], 0.72, 0, false)
  }

  // Sweeping aerodynamic A-arch hull levitating cleanly above thruster ring
  const arch = mat4Mul(upper, mat4Translate(0, hoverY + 0.04, 0))
  // Left & right swept aero-arch legs meeting at apex
  add('pillBox', xformRot(arch, -0.18 - ex * 0.16, 0.02, 0, 0, 0, -0.34, 0.165, 0.76, 0.24), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('pillBox', xformRot(arch, 0.18 + ex * 0.16, 0.02, 0, 0, 0, 0.34, 0.165, 0.76, 0.24), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Rounded aerodynamic apex crown bridge
  add('sphere', xform(arch, 0, 0.34 + ex * 0.24, 0, 0.26, 0.22, 0.26), secCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // Floating porcelain center face orb nestled inside the A-arch cavity
  const orbY = -0.05 + Math.sin(t * 3.0) * 0.02
  add('sphere', xform(arch, 0, orbY, 0.03 + ex * 0.18, 0.36, 0.36, 0.36), [0.96, 0.98, 1.0], M.CERAMIC, [0, 0, 0], alpha, 0, !dimmed)

  if (lod === 'low') return { rightPivot: null, headTopY: 0.48 }

  // Lower brushed-silver collar halo framing beneath the face orb (never crosses the eyes)
  add('thinTorus', xformRot(arch, 0, orbY - 0.145, 0.03 + ex * 0.18, 0.10, t * 1.1, 0, 0.36, 0.36, 0.36), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)
  // Expressive obsidian eyes + catchlights & gentle smile on floating orb
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(arch, dir * 0.072, orbY + 0.03, 0.198 + ex * 0.22, 0.046, 0.064, 0.026), [0.010, 0.014, 0.028], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, arch, dir * 0.072 - 0.008, orbY + 0.046, 0.214 + ex * 0.22, 0.013)
  }
  add('bevelBox', xform(arch, 0, orbY - 0.04, 0.195 + ex * 0.22, 0.072, 0.02, 0.018), obsCol, M.OBS, [0, 0, 0], alpha, 0, false)

  // Tucked magnetic aero-fin hands bridged cleanly to the A-arch flanks via cyan energy struts
  const makeAeroHand = (dir, rx, rz) => {
    if (!dimmed) {
      add('cyl', xformRot(arch, dir * (0.295 + ex * 0.14), -0.02, 0.03, 0, 0, Math.PI * 0.5, 0.026, 0.13, 0.026), [0.55, 0.88, 1.0], M.EM, [0.35, 1.45, 2.9], 0.78, 0, false)
    }
    const pivot = mat4Mul(
      arch,
      mat4Mul(mat4Translate(dir * (0.365 + ex * 0.24), -0.02, 0.03), mat4Mul(mat4RotateZ(rz), mat4RotateX(rx))),
    )
    add('pillBox', xform(pivot, 0, -0.09, 0, 0.095, 0.22, 0.11), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)
    if (!dimmed) {
      add('sphere', xform(pivot, 0, 0.03, 0, 0.055, 0.055, 0.055), [0.65, 0.88, 1.0], M.EM, [0.35, 1.35, 2.8], 0.9, 0, false)
    }
    return pivot
  }
  makeAeroHand(-1, pose.armLX, pose.armLZ)
  const rightPivot = makeAeroHand(1, pose.armRX, pose.armRZ)
  return { rightPivot, headTopY: 0.50 }
}

/** 8. OPENCODE — Dieter-Rams matte-obsidian architectural nested-frame monolith + recessed glowing aluminum core */
function sculptOpenCode(ctx) {
  const { add, upper, pose, ex, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, M, alpha, dimmed, lod } = ctx
  const box = lod === 'low' ? 'fastBox' : 'bevelBox'

  // True 3D architectural nested outer frame (4 crisp members + rear wall)
  add(box, xform(upper, 0, 0.28 + ex * 0.18, 0, 0.72, 0.13, 0.42), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed) // Top lintel
  add(box, xform(upper, 0, -0.28 - ex * 0.10, 0, 0.72, 0.13, 0.42), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed) // Bottom sill
  add(box, xform(upper, -0.295 - ex * 0.14, 0, 0, 0.13, 0.56, 0.42), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed) // Left jamb
  add(box, xform(upper, 0.295 + ex * 0.14, 0, 0, 0.13, 0.56, 0.42), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed) // Right jamb
  add(box, xform(upper, 0, 0, -0.14 - ex * 0.14, 0.56, 0.52, 0.14), secCol, shellMat, [0, 0, 0], shellAlpha, 0, false) // Rear backing

  // Recessed brushed-aluminum inner monolith core
  add('bevelBox', xform(upper, 0, 0, 0.02 + ex * 0.14, 0.36, 0.40, 0.24), aluCol, M.ALU, [0, 0, 0], alpha, 0, !dimmed)

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.17, 0.29, 0.15, 0.18, tiCol)
    return { rightPivot: null, headTopY: 0.42 }
  }

  // Subtle recessed LED halo frame between outer obsidian bezel and inner aluminum core
  if (!dimmed) {
    add('bevelBox', xform(upper, 0, 0, -0.02, 0.42, 0.45, 0.04), [0.85, 0.94, 1.0], M.EM, [0.45, 0.78, 1.25], 0.85, 0, false)
    // Dieter-Rams Braun-inspired signal orange micro-dot on top-left corner of frame
    add('cyl', xformRot(upper, -0.285, 0.28 + ex * 0.18, 0.215, Math.PI * 0.5, 0, 0, 0.046, 0.018, 0.046), [1.0, 0.42, 0.12], M.EM, [2.2, 0.75, 0.12], 1, 0, false)
  }

  // Crisp minimalist recessed obsidian eyes + catchlights on the brushed-aluminum core
  const ez = 0.145 + ex * 0.22
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.082, 0.045, ez, 0.056, 0.105, 0.024), obsCol, M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.082 - 0.013, 0.075, ez + 0.016, 0.016)
  }
  add('bevelBox', xform(upper, 0, -0.065, ez, 0.095, 0.018, 0.016), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  const rightPivot = drawStandardArms(ctx, 0.395, -0.02, 0.105, 0.30, 0.12, tiCol, 'bevelBox', aluCol)
  drawTwinBoots(ctx, 0.17, 0.29, 0.15, 0.18, shellCol)
  return { rightPivot, headTopY: 0.42 }
}

/** 9. QWEN CODE — Sculptural origami-faceted sapphire prism-hexagon + brushed silver trim */
function sculptQwen(ctx) {
  const { add, upper, pose, ex, shellCol, secCol, shellMat, shellAlpha, obsCol, aluCol, M, alpha, dimmed, lod } = ctx

  // Central sapphire hexagonal prism body
  add('cyl', xformRot(upper, 0, 0.02, 0, Math.PI * 0.5, 0, 0, 0.62, 0.36, 0.62), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // 3 interlocking sculptural origami ribbon-facets at 120° intervals (official Qwen triad geometry)
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6
    const rx = Math.cos(a) * (0.20 + ex * 0.18)
    const ry = 0.02 + Math.sin(a) * (0.20 + ex * 0.18)
    const col = i === 0 ? shellCol : i === 1 ? mixRGB(shellCol, secCol, 0.45) : secCol
    add('bevelBox', xformRot(upper, rx, ry, 0.02, 0, 0, a + Math.PI * 0.5, 0.46, 0.15, 0.38), col, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
    if (lod !== 'low') {
      // Brushed silver origami edge trim
      add('bevelBox', xformRot(upper, rx * 1.16, ry * 1.16, 0.03, 0, 0, a + Math.PI * 0.5, 0.42, 0.028, 0.40), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)
    }
  }

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.16, 0.29, 0.13, 0.15, secCol)
    return { rightPivot: null, headTopY: 0.46 }
  }

  // Crown crystal facet jewel
  add('octa', xform(upper, 0, 0.36 + ex * 0.24, 0, 0.16, 0.14, 0.16), [0.55, 0.78, 1.0], M.CRYSTAL, [0.22, 0.55, 1.45], 0.86, 0, false)

  // Porcelain face medallion centered in the hexagonal prism (clean Z clearance past origami trim 0.230)
  const fz = 0.224 + ex * 0.20
  add('cyl', xformRot(upper, 0, 0.02, fz - 0.012, Math.PI * 0.5, 0, 0, 0.34, 0.045, 0.34), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)
  add('cyl', xformRot(upper, 0, 0.02, fz, Math.PI * 0.5, 0, 0, 0.30, 0.042, 0.30), [0.96, 0.97, 1.0], M.CERAMIC, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.068, 0.045, fz + 0.026, 0.048, 0.072, 0.024), [0.010, 0.014, 0.032], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.068 - 0.011, 0.068, fz + 0.042, 0.015)
  }
  add('bevelBox', xform(upper, 0, -0.032, fz + 0.022, 0.08, 0.02, 0.016), obsCol, M.OBS, [0, 0, 0], alpha, 0, false)

  const rightPivot = drawStandardArms(ctx, 0.38, -0.04, 0.115, 0.30, 0.12, shellCol, 'bevelBox', aluCol)
  drawTwinBoots(ctx, 0.16, 0.29, 0.135, 0.155, secCol)
  return { rightPivot, headTopY: 0.46 }
}

/** 10. KIMI CODE — Sleek midnight-ceramic silhouette + angular 'K' visor chest + orbiting pearl moon-orb */
function sculptKimi(ctx) {
  const { add, upper, pose, ex, t, shellCol, secCol, shellMat, shellAlpha, obsCol, aluCol, M, alpha, dimmed, lod } = ctx

  // Sleek midnight-ceramic monolith body + domed midnight helmet crown
  add('pillBox', xform(upper, 0, -0.02, 0, 0.64, 0.60, 0.44), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('sphere', xform(upper, 0, 0.25 + ex * 0.16, 0, 0.58, 0.32, 0.42), secCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // Floating luminous pearl moon-orb orbiting upper-right (signature Kimi dot!)
  const mx = 0.36 + Math.cos(t * 1.6) * 0.045 + ex * 0.24
  const my = 0.35 + Math.sin(t * 2.2) * 0.04 + ex * 0.24
  const mz = 0.06 + Math.sin(t * 1.6) * 0.06
  add('sphere', xform(upper, mx, my, mz, 0.19, 0.19, 0.19), [0.98, 0.96, 0.92], M.CERAMIC, dimmed ? [0, 0, 0] : [0.95, 0.92, 0.85], alpha, 0, false)
  if (!dimmed && lod !== 'low') {
    add('thinTorus', xformRot(upper, mx, my, mz, 0.65, t * 1.2, 0.3, 0.27, 0.27, 0.27), [0.95, 0.94, 1.0], M.EM, [0.75, 0.82, 1.25], 0.72, 0, false)
  }

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.16, 0.29, 0.135, 0.155, secCol)
    return { rightPivot: null, headTopY: 0.48 }
  }

  // Sleek dark brow visor housing expressive eyes
  const vz = 0.215 + ex * 0.18
  add('pillBox', xform(upper, 0, 0.14, vz, 0.42, 0.15, 0.06), obsCol, M.OBS, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.095, 0.14, vz + 0.032, 0.062, 0.088, 0.022), obsCol, M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    if (!dimmed && pose.eyeMode === 0) {
      add('sphere', xform(upper, dir * 0.095, 0.14, vz + 0.044, 0.034, 0.048, 0.016), [0.92, 0.96, 1.0], M.EM, [0.85, 1.05, 1.45], 0.95, 0, false)
    }
  }

  // Sculpted angular 'K' visor emblem embossed on chest (vertical stem + upper/lower diagonal strokes)
  const kz = 0.228 + ex * 0.22
  const kEm = dimmed ? [0, 0, 0] : [0.45, 0.52, 0.78]
  add('bevelBox', xform(upper, -0.075, -0.08, kz, 0.048, 0.26, 0.024), aluCol, M.ALU, kEm, alpha, 0, false)
  add('bevelBox', xformRot(upper, 0.025, -0.02, kz, 0, 0, -0.78, 0.046, 0.19, 0.024), aluCol, M.ALU, kEm, alpha, 0, false)
  add('bevelBox', xformRot(upper, 0.035, -0.14, kz, 0, 0, 0.76, 0.046, 0.19, 0.024), aluCol, M.ALU, kEm, alpha, 0, false)

  const rightPivot = drawStandardArms(ctx, 0.355, -0.04, 0.11, 0.30, 0.12, shellCol, 'pillBox', aluCol)
  drawTwinBoots(ctx, 0.16, 0.29, 0.135, 0.155, secCol)
  return { rightPivot, headTopY: 0.48 }
}

/** 11. GOOSE — Minimalist designer-vinyl warm-white studio goose + charcoal wings + matte-orange beak & webbed feet */
function sculptGoose(ctx) {
  const { add, root, upper, pose, ex, shellCol, secCol, shellMat, shellAlpha, obsCol, M, alpha, dimmed, lod } = ctx
  const whiteCol = shellCol // #e8e4dc warm ceramic white
  const charcoalCol = secCol // #2b2a28 charcoal wing accents
  const orangeCol = [0.95, 0.46, 0.17] // matte-orange beak & webbed feet

  // Plump sculptural pear-shaped studio-vinyl goose body
  add('sphere', xform(upper, 0, -0.12, -0.02, 0.56, 0.46, 0.58), whiteCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  // Charming upright curved goose neck + rounded studio-vinyl head
  add('cyl', xform(upper, 0, 0.12 + ex * 0.12, 0.05, 0.21, 0.28, 0.21), whiteCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('sphere', xform(upper, 0, 0.29 + ex * 0.22, 0.07, 0.31, 0.28, 0.32), whiteCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // Matte-orange sculptural goose beak protruding forward (+z)
  add('pillBox', xform(upper, 0, 0.265 + ex * 0.22, 0.245 + ex * 0.16, 0.145, 0.078, 0.175), orangeCol, M.VINYL, [0, 0, 0], alpha, 0, false)
  // Cute charcoal tail tuft at -z
  add('cone', xformRot(upper, 0, -0.06, -0.32 - ex * 0.16, -0.95, 0, 0, 0.18, 0.22, 0.16), charcoalCol, shellMat, [0, 0, 0], shellAlpha, 0, false)

  // Articulated charcoal folded wings positioned cleanly on flanks (zero chest poke-through!)
  const makeWing = (dir, rx, rz) => {
    const pivot = mat4Mul(
      upper,
      mat4Mul(mat4Translate(dir * (0.285 + ex * 0.22), -0.06, -0.07), mat4Mul(mat4RotateZ(rz + dir * 0.14), mat4RotateX(rx))),
    )
    add('pillBox', xform(pivot, dir * 0.015, -0.08, -0.02, 0.10, 0.30, 0.27), charcoalCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
    return pivot
  }
  makeWing(-1, pose.armLX, pose.armLZ)
  const rightPivot = makeWing(1, pose.armRX, pose.armRZ)

  // Matte-orange goose legs + splayed webbed feet flush on y = 0
  const xs = [-0.14, 0.14]
  const swings = [pose.legL, pose.legR]
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1
    const pivot = mat4Mul(
      root,
      mat4Mul(mat4Translate(xs[i] + dir * ex * 0.10, 0.27 + pose.bobY * 0.35 - ex * 0.12, 0), mat4RotateX(swings[i])),
    )
    add('cyl', xform(pivot, 0, -0.12, 0, 0.075, 0.22, 0.075), orangeCol, M.VINYL, [0, 0, 0], alpha, 0, false)
    // Sculptural flat-bottomed webbed foot pad flush at y = 0
    add('bevelBox', xform(pivot, 0, -0.25, 0.045, 0.17, 0.04, 0.21), orangeCol, M.VINYL, [0, 0, 0], alpha, 0, false)
  }

  if (lod === 'low') return { rightPivot, headTopY: 0.48 }

  // Charming centered coral-orange & brushed-brass studio bowtie on snow-white neck/chest
  add('bevelBox', xformRot(upper, -0.048, 0.07, 0.195 + ex * 0.12, 0, 0, 0.22, 0.085, 0.052, 0.028), orangeCol, M.VINYL, [0, 0, 0], alpha, 0, false)
  add('bevelBox', xformRot(upper, 0.048, 0.07, 0.195 + ex * 0.12, 0, 0, -0.22, 0.085, 0.052, 0.028), orangeCol, M.VINYL, [0, 0, 0], alpha, 0, false)
  add('sphere', xform(upper, 0, 0.07, 0.205 + ex * 0.12, 0.044, 0.044, 0.036), ctx.brassCol, M.BRASS, [0, 0, 0], alpha, 0, false)

  // Glossy jet-black obsidian bead eyes + crisp white catchlights (high-contrast on white head)
  for (const dir of [-1, 1]) {
    add('bevelBox', xform(upper, dir * 0.092, 0.322 + ex * 0.22, 0.205 + ex * 0.12, 0.054, 0.064, 0.032), [0.006, 0.006, 0.008], M.OBS, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
    addCatchlight(ctx, upper, dir * 0.092 - 0.009, 0.338 + ex * 0.22, 0.224 + ex * 0.12, 0.015)
  }

  return { rightPivot, headTopY: 0.48 }
}

/** 12. GITHUB COPILOT CLI — Rounded matte-graphite aviator-helmet + oversized glossy goggles + cyan visor LEDs + headphones */
function sculptCopilot(ctx) {
  const { add, upper, pose, ex, shellCol, secCol, shellMat, shellAlpha, tiCol, obsCol, aluCol, M, alpha, dimmed, lod } = ctx

  // Rounded matte-graphite aviator helmet dome + compact lower body
  add('pillBox', xform(upper, 0, 0.04, 0, 0.74, 0.60, 0.56), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)
  add('sphere', xform(upper, 0, 0.22 + ex * 0.14, 0, 0.68, 0.36, 0.52), shellCol, shellMat, [0, 0, 0], shellAlpha, 0, !dimmed)

  // Oversized glossy tinted pilot goggles mounted prominently on upper brow!
  const gz = 0.275 + ex * 0.24
  for (const dir of [-1, 1]) {
    // Gunmetal titanium goggle bezel
    add('pillBox', xform(upper, dir * 0.165, 0.195 + ex * 0.12, gz - 0.015, 0.27, 0.22, 0.10), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
    // Glossy smoked-tint aviator lens
    add('pillBox', xform(upper, dir * 0.165, 0.195 + ex * 0.12, gz + 0.025, 0.215, 0.165, 0.065), [0.06, 0.10, 0.16], M.CERAMIC, dimmed ? [0, 0, 0] : [0.04, 0.14, 0.22], alpha, 0, false)
  }
  // Goggle nose bridge strap
  add('bevelBox', xform(upper, 0, 0.20 + ex * 0.12, gz, 0.11, 0.06, 0.08), tiCol, M.TI, [0, 0, 0], alpha, 0, false)

  // Deep recessed lower visor faceplate + twin glowing cyan pill LED eyes
  add('pillBox', xform(upper, 0, -0.05, 0.24 + ex * 0.18, 0.52, 0.24, 0.11), obsCol, M.OBS, [0, 0, 0], alpha, 0, false)
  if (!dimmed) {
    const cyanEm = pose.eyeMode === 3 ? [3.4, 0.25, 0.2] : pose.eyeMode === 7 ? [0.22, 2.8, 0.95] : [0.28, 2.25, 3.05]
    for (const dir of [-1, 1]) {
      add('pillBox', xform(upper, dir * 0.105, -0.045, 0.296 + ex * 0.20, 0.058, 0.115, 0.025), [0.85, 0.98, 1.0], M.EM, cyanEm, 1, 0, false)
    }
  }

  if (lod === 'low') {
    drawTwinBoots(ctx, 0.17, 0.29, 0.14, 0.16, secCol)
    return { rightPivot: null, headTopY: 0.46 }
  }

  // Sculpted aviator headphones / ear cups on both sides
  for (const dir of [-1, 1]) {
    const hx = dir * (0.405 + ex * 0.24)
    add('cyl', xformRot(upper, hx, 0.06, 0, 0, 0, Math.PI * 0.5, 0.26, 0.10, 0.26), tiCol, M.TI, [0, 0, 0], alpha, 0, false)
    add('cyl', xformRot(upper, hx + dir * 0.045, 0.06, 0, 0, 0, Math.PI * 0.5, 0.17, 0.04, 0.17), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)
  }
  // Brushed aluminum aviator helmet top crest band
  add('bevelBox', xform(upper, 0, 0.39 + ex * 0.22, 0, 0.10, 0.036, 0.44), aluCol, M.ALU, [0, 0, 0], alpha, 0, false)

  const rightPivot = drawStandardArms(ctx, 0.405, -0.10, 0.115, 0.28, 0.125, shellCol, 'pillBox', tiCol)
  drawTwinBoots(ctx, 0.17, 0.29, 0.145, 0.165, secCol)
  return { rightPivot, headTopY: 0.46 }
}

const SCULPTORS = {
  claude: { fn: sculptClaude, matKey: 'VINYL' },
  codex: { fn: sculptCodex, matKey: 'VINYL' },
  gemini: { fn: sculptGemini, matKey: 'CRYSTAL' },
  codebuddy: { fn: sculptCodeBuddy, matKey: 'VINYL' },
  pi: { fn: sculptPi, matKey: 'VINYL' },
  deepseek: { fn: sculptDeepSeek, matKey: 'CERAMIC' },
  antigravity: { fn: sculptAntigravity, matKey: 'CERAMIC' },
  opencode: { fn: sculptOpenCode, matKey: 'VINYL' },
  qwen: { fn: sculptQwen, matKey: 'CERAMIC' },
  kimi: { fn: sculptKimi, matKey: 'CERAMIC' },
  goose: { fn: sculptGoose, matKey: 'VINYL' },
  copilot: { fn: sculptCopilot, matKey: 'VINYL' },
}

/**
 * Draws any of the 12 Official AgentKind Collectible 3D Figurines.
 */
export function drawAgentFigurine(renderer, kind, opts = {}) {
  const safeKind = SCULPTORS[kind] ? kind : 'claude'
  const meta = META_BY_KEY[safeKind] || AGENT_FIGURINE_META[0]
  const entry = SCULPTORS[safeKind]
  const M = getMats()

  const {
    x = 0,
    z = 0,
    baseY = 0,
    ry = 0,
    scale = 1,
    tintHex = null,
    ownerRingColor = null,
    isMe = false,
    action: rawAction = 'idle',
    effort = 'medium',
    subagents = 0,
    time = 0,
    phase = 0,
    explode = 0,
    dimmed = false,
    selected = false,
    hovered = false,
    lod = 'high',
    finishOverride = null,
    _forExport = false,
  } = opts

  const action = normalizeAction(rawAction)
  const t = time + phase
  const pose = computePose(action, t)

  const primaryRGB = hexToRGB(tintHex || meta.primaryHex)
  const secondaryRGB = hexToRGB(meta.secondaryHex)
  const shellCol = dimmed ? [0.68, 0.69, 0.71] : primaryRGB
  const secCol = dimmed ? [0.56, 0.58, 0.61] : secondaryRGB
  const alpha = dimmed ? 0.26 : 1.0

  const defaultMat = M[entry.matKey] ?? M.VINYL
  const { mat: shellMat, alpha: finishAlpha } = resolveShellFinish(defaultMat, finishOverride, 1.0)
  const shellAlpha = dimmed ? 0.26 : finishAlpha

  const add = (meshName, model, color, matType, emissive = [0, 0, 0], a = 1.0, extra = 0.0, castShadow = true) => {
    renderer.add(meshName, model, color, matType, emissive, a, extra, castShadow)
  }

  // Grounded soft contact shadow & floor selection rings (skipped during GLB export)
  if (!_forExport && explode < 0.05) {
    const shScale = 1.16 * scale
    add('plane', TRS(x, baseY + 0.011, z, 0, shScale, 1, shScale * 0.92), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], dimmed ? 0.14 : 0.34, 0, false)

    if (ownerRingColor) {
      const ringR = (isMe ? 0.84 : 0.74) * scale
      add(
        'thinTorus',
        TRS(x, baseY + 0.018, z, 0, ringR, 0.55 * scale, ringR),
        dimmed ? [0.6, 0.6, 0.6] : [0.95, 0.95, 0.95],
        dimmed ? M.ALU : M.EM,
        dimmed ? [0, 0, 0] : ownerRingColor,
        alpha,
        0,
        false,
      )
    }

    if ((selected || hovered) && !dimmed) {
      const pulse = 1.0 + Math.sin(time * 4.6) * 0.055
      const selR = (selected ? 1.06 : 0.96) * scale * pulse
      const selEm = selected ? [0.35, 1.85, 3.2] : [0.9, 1.35, 1.9]
      add('thinTorus', TRS(x, baseY + 0.028, z, 0, selR, 0.50 * scale, selR), [1, 1, 1], M.EM, selEm, selected ? 0.96 : 0.65, 0, false)
      if (selected) {
        const wave = (time * 0.72) % 1.0
        const outerR = (1.16 + wave * 0.42) * scale
        add('thinTorus', TRS(x, baseY + 0.024, z, 0, outerR, 0.42 * scale, outerR), [0.85, 0.96, 1.0], M.EM, [0.45, 2.05, 3.4], (1.0 - wave) * 0.82, 0, false)
        add('plane', TRS(x, baseY + 0.015, z, 0, 1.75 * scale, 1, 1.75 * scale), [1, 1, 1], MAT.GLOW_POOL, [0.25, 1.35, 2.65], 0.46, 0, false)
      }
    }
  }

  const root = mat4Mul(
    mat4Translate(x + pose.jitterX, baseY + pose.sittingOffset, z + pose.jitterZ),
    mat4Mul(mat4RotateY(ry), mat4Scale(scale, scale, scale)),
  )
  const upperBase = mat4Mul(root, mat4Translate(0, 0.60 + pose.bobY + explode * 0.12, 0))
  const upper = mat4Mul(
    upperBase,
    mat4Mul(mat4RotateY(pose.yaw), mat4Mul(mat4RotateZ(pose.roll), mat4RotateX(pose.pitch))),
  )

  const ctx = {
    add,
    root,
    upper,
    pose,
    action,
    t,
    time,
    x,
    z,
    baseY,
    scale,
    effort,
    subagents,
    ex: explode,
    shellCol,
    secCol,
    shellMat,
    shellAlpha,
    alpha,
    tiCol: [0.16, 0.17, 0.20],
    obsCol: [0.03, 0.03, 0.04],
    aluCol: [0.78, 0.80, 0.84],
    brassCol: [0.84, 0.71, 0.42],
    M,
    dimmed,
    lod,
    finishOverride,
    forExport: _forExport,
  }

  const { rightPivot, headTopY } = entry.fn(ctx)
  drawActionProps(ctx, rightPivot, headTopY)
}

/**
 * Collects exact 3D mesh/transform/material descriptors for any of the 12 Agent figurines
 * so `geometry.js` can export any figurine as a clean binary `.glb` file.
 */
export function collectAgentParts(kind, finishOverride = null) {
  const parts = []
  const recorder = {
    add(meshName, model, color, matType, emissive = [0, 0, 0], alpha = 1.0) {
      parts.push({
        name: `${kind}_${meshName}_${parts.length}`,
        meshName,
        model: Array.from(model),
        color: [...color],
        matType,
        emissive: [...emissive],
        alpha,
      })
    },
  }
  drawAgentFigurine(recorder, kind, {
    x: 0,
    z: 0,
    baseY: 0,
    ry: 0,
    scale: 1,
    action: 'idle',
    time: 0,
    phase: 0,
    explode: 0,
    dimmed: false,
    selected: false,
    hovered: false,
    lod: 'high',
    finishOverride,
    _forExport: true,
  })
  return parts
}
