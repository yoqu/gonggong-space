import { drawLoungeFurniture } from './decor.js?v=e5'
import { AGENT_FIGURINE_META, drawAgentFigurine } from './figurines_agents.js?v=b4b'
import { ROLE_FIGURINE_META, drawRoleFigurine } from './figurines_roles.js?v=b4b'
import { ensureGLBLoaded, getGLBModel, resolveGLBMaterial } from './glb_loader.js?v=b4b'
import {
  MAT,
  TRS,
  mat4Identity,
  mat4Mul,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Scale,
  mat4Translate,
} from './renderer.js?v=b4b'

export { AGENT_FIGURINE_META, ROLE_FIGURINE_META }
export const ALL_FIGURINE_META = [...AGENT_FIGURINE_META, ...ROLE_FIGURINE_META]

const AGENT_KEY_SET = new Set(AGENT_FIGURINE_META.map((m) => m.key))
const ROLE_KEY_SET = new Set(ROLE_FIGURINE_META.map((m) => m.key))

function hashStr(s) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * Resolves the real collectible figurine key for a Campus / Lounge bot.
 * Respects explicit `agentKind` (all 12 official agents) and `role-*` personas,
 * while enriching duplicate Lounge/fallback bots with authentic Role Personas.
 */
export function resolveCampusFigurineKey(bot, idx = 0, isLounge = false) {
  if (!bot) return 'claude'
  const explicit = String(bot.figurineKey || bot.roleKey || bot.persona || '').toLowerCase()
  if (ROLE_KEY_SET.has(explicit) || AGENT_KEY_SET.has(explicit)) return explicit

  const nameLow = String(bot.botName || bot.name || '').toLowerCase()
  for (const k of AGENT_KEY_SET) {
    if (k !== 'pi' && nameLow.includes(k)) return k
  }
  if (/\bpi\b/.test(nameLow)) return 'pi'

  let kind = String(bot.agentKind || '').toLowerCase()
  if (kind === 'claude-code' || kind === 'clawd') kind = 'claude'

  // In the Living Lounge, blend our 13 Role Personas & diverse agents alongside real Claude/Codex bots
  if (isLounge && (kind === 'claude' || !AGENT_KEY_SET.has(kind))) {
    const h = hashStr(bot.id || bot.name || idx)
    const loungeMix = [
      'role-gong',
      'deepseek',
      'role-hammock',
      'gemini',
      'role-compass',
      'goose',
      'role-abacus',
      'copilot',
      'role-braces',
      'kimi',
      'role-spring',
      'qwen',
      'role-sentry',
      'antigravity',
      'role-loop',
      'claude',
    ]
    return loungeMix[(h + idx) % loungeMix.length]
  }

  if (AGENT_KEY_SET.has(kind)) return kind
  if (ROLE_KEY_SET.has(kind)) return kind
  return 'claude'
}

function pivotRotMatrix(pivot, rx, ry, rz, tx = 0, ty = 0, tz = 0) {
  let m = mat4Translate(pivot[0] + tx, pivot[1] + ty, pivot[2] + tz)
  if (ry) m = mat4Mul(m, mat4RotateY(ry))
  if (rz) m = mat4Mul(m, mat4RotateZ(rz))
  if (rx) m = mat4Mul(m, mat4RotateX(rx))
  return mat4Mul(m, mat4Translate(-pivot[0], -pivot[1], -pivot[2]))
}

/**
 * Renders a real Blender 5.2.1 LTS exported .glb figurine with full real-time
 * sub-node animation (Body, Arm_L, Arm_R, Leg_L, Leg_R, Accessory), exploded view,
 * Studio PBR finish overrides, tinting, and Gonggong status holograms.
 */
export function drawGLBFigurine(renderer, model, opts = {}) {
  const {
    x = 0,
    baseY = 0,
    z = 0,
    ry = 0,
    scale = 0.66,
    tintHex = null,
    ownerRingColor = null,
    isMe = false,
    action: rawAction = 'idle',
    effort = 'medium',
    subagents = 0,
    ctxPercent = 50,
    time = 0,
    phase = 0,
    explode = 0,
    dimmed = false,
    selected = false,
    hovered = false,
    finishOverride = null,
    lod = 'high',
  } = opts

  const action = normalizeBotAction(rawAction)
  const t = time + phase
  const alpha = dimmed ? 0.26 : 1.0
  const ex = Math.max(0, Math.min(1, explode || 0))
  const ceramicCol = [0.94, 0.93, 0.90]

  // Grounded contact shadow / soft AO disc beneath feet
  if (ex < 0.05) {
    const shScale = 1.12 * scale
    renderer.add(
      'plane',
      TRS(x, baseY + 0.011, z, 0, shScale, 1, shScale * 0.92),
      [0, 0, 0],
      MAT.SHADOW_BLOB,
      [0, 0, 0],
      dimmed ? 0.14 : 0.34,
      0,
      false,
    )
  }

  // Owner identity floor halo ring + selection/hover highlight
  if (ownerRingColor && ex < 0.05) {
    const ringEm = dimmed ? [0, 0, 0] : ownerRingColor
    const ringR = (isMe ? 0.84 : 0.74) * scale
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 0.018, z, 0, ringR, 0.55 * scale, ringR),
      dimmed ? [0.6, 0.6, 0.6] : [0.95, 0.95, 0.95],
      dimmed ? MAT.ALUMINUM : MAT.EMISSIVE,
      ringEm,
      alpha,
      0,
      false,
    )
  }
  if ((selected || hovered) && !dimmed && ex < 0.05) {
    const pulse = 1.0 + Math.sin(time * 4.6) * 0.055
    const selR = (selected ? 1.06 : 0.96) * scale * pulse
    const selEm = selected ? [0.35, 1.85, 3.2] : [0.9, 1.35, 1.9]
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 0.028, z, 0, selR, 0.50 * scale, selR),
      [1, 1, 1],
      MAT.EMISSIVE,
      selEm,
      selected ? 0.96 : 0.65,
      0,
      false,
    )
    if (selected) {
      const wave = (time * 0.72) % 1.0
      const outerR = (1.16 + wave * 0.42) * scale
      const outerAlpha = (1.0 - wave) * 0.82
      renderer.add(
        'thinTorus',
        TRS(x, baseY + 0.024, z, 0, outerR, 0.42 * scale, outerR),
        [0.85, 0.96, 1.0],
        MAT.EMISSIVE,
        [0.45, 2.05, 3.4],
        outerAlpha,
        0,
        false,
      )
      renderer.add(
        'plane',
        TRS(x, baseY + 0.015, z, 0, 1.75 * scale, 1, 1.75 * scale),
        [1, 1, 1],
        MAT.GLOW_POOL,
        [0.25, 1.35, 2.65],
        0.46,
        0,
        false,
      )
    }
  }

  // Compute procedural pose for all rigged Blender slots
  let bobY = 0
  let jitterX = 0
  let jitterZ = 0
  let torsoPitch = 0
  let torsoRoll = 0
  let torsoYaw = 0
  let armLX = 0
  let armLZ = 0
  let armRX = 0
  let armRZ = 0
  let legLX = 0
  let legRX = 0
  let accBob = 0
  let accSpin = 0
  let sittingOffset = 0

  switch (action) {
    case 'typing': {
      bobY = Math.sin(t * 7.5) * 0.012
      torsoPitch = 0.08
      armLX = -0.72 + Math.sin(t * 18.0) * 0.22
      armRX = -0.72 + Math.cos(t * 18.0) * 0.22
      break
    }
    case 'thinking': {
      bobY = Math.sin(t * 2.1) * 0.018
      torsoRoll = Math.sin(t * 1.1) * 0.07
      torsoYaw = Math.sin(t * 0.85) * 0.14
      armRX = -1.25 + Math.sin(t * 1.8) * 0.06
      armRZ = -0.22
      armLX = -0.32 + Math.sin(t * 1.3) * 0.05
      accBob = Math.sin(t * 2.5) * 0.025
      break
    }
    case 'reading': {
      bobY = Math.sin(t * 2.4) * 0.01
      torsoPitch = 0.06
      torsoYaw = Math.sin(t * 2.2) * 0.12
      armLX = -0.88
      armLZ = 0.16
      armRX = -0.88
      armRZ = -0.16
      break
    }
    case 'subagent_swarm': {
      bobY = Math.sin(t * 5.2) * 0.015
      torsoPitch = 0.04
      armLX = -0.82 + Math.sin(t * 14.0) * 0.18
      armRX = -1.05 + Math.cos(t * 9.0) * 0.20
      accSpin = t * 1.2
      break
    }
    case 'approval_raise': {
      bobY = Math.sin(t * 3.8) * 0.022
      torsoRoll = -0.05
      armRX = -2.25 + Math.sin(t * 5.5) * 0.14
      armRZ = 0.14
      armLX = -0.18
      break
    }
    case 'question_ask': {
      bobY = Math.sin(t * 3.0) * 0.018
      torsoRoll = 0.14 + Math.sin(t * 2.0) * 0.04
      armRX = -1.42 + Math.sin(t * 3.5) * 0.16
      armRZ = 0.24
      armLX = -0.28
      break
    }
    case 'auth_expired': {
      bobY = -0.03 + Math.sin(t * 1.8) * 0.008
      torsoPitch = 0.20
      armLX = 0.15
      armRX = 0.15
      break
    }
    case 'context_compact': {
      const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
      bobY = -0.02 * comp
      armLX = -0.95
      armLZ = 0.24 + comp * 0.16
      armRX = -0.95
      armRZ = -(0.24 + comp * 0.16)
      break
    }
    case 'workspace_confirm': {
      bobY = Math.sin(t * 2.6) * 0.012
      torsoPitch = 0.04
      armLX = -0.92
      armLZ = 0.18
      armRX = -0.92
      armRZ = -0.18
      break
    }
    case 'error_spark': {
      jitterX = Math.sin(t * 48.0) * 0.020
      jitterZ = Math.cos(t * 53.0) * 0.020
      torsoRoll = Math.sin(t * 24.0) * 0.08
      armLX = -1.25 + Math.sin(t * 16.0) * 0.24
      armLZ = -0.38
      armRX = -1.25 + Math.cos(t * 16.0) * 0.24
      armRZ = 0.38
      break
    }
    case 'celebrate_done': {
      bobY = Math.abs(Math.sin(t * 6.8)) * 0.14
      torsoRoll = Math.sin(t * 6.8) * 0.08
      armLX = -2.35 + Math.sin(t * 10.0) * 0.18
      armLZ = -0.20
      armRX = -2.35 - Math.sin(t * 10.0) * 0.18
      armRZ = 0.20
      accBob = Math.abs(Math.sin(t * 6.8)) * 0.04
      break
    }
    case 'walk_to_work': {
      const s = Math.sin(t * 10.5)
      bobY = Math.abs(s) * 0.042
      torsoPitch = 0.12
      legLX = s * 0.46
      legRX = -s * 0.46
      armLX = -s * 0.42
      armRX = s * 0.42
      break
    }
    case 'sip_coffee': {
      const sipCycle = Math.max(0, Math.sin(t * 1.35))
      bobY = Math.sin(t * 2.0) * 0.012
      torsoPitch = -sipCycle * 0.08
      armRX = -0.62 - sipCycle * 0.56
      armRZ = -0.16
      armLX = -0.12 + Math.sin(t * 1.6) * 0.05
      break
    }
    case 'chat_wave': {
      bobY = Math.sin(t * 3.2) * 0.016
      torsoPitch = Math.sin(t * 2.8) * 0.07
      armRX = -2.05 + Math.sin(t * 6.2) * 0.24
      armRZ = 0.22 + Math.sin(t * 6.2) * 0.14
      armLX = -0.22 + Math.sin(t * 2.5) * 0.08
      break
    }
    case 'bench_swing': {
      sittingOffset = -0.05
      bobY = Math.sin(t * 2.4) * 0.008
      const sw = Math.sin(t * 4.2) * 0.34
      legLX = -0.82 + sw
      legRX = -0.82 - sw
      armLX = -0.26 + Math.sin(t * 2.1) * 0.06
      armRX = -0.26 - Math.sin(t * 2.1) * 0.06
      break
    }
    case 'recharge_nap': {
      bobY = -0.018 + Math.sin(t * 1.4) * 0.014
      torsoPitch = 0.10 + Math.sin(t * 1.4) * 0.03
      armLX = 0.08
      armRX = 0.08
      break
    }
    case 'stroll_lounge': {
      const s = Math.sin(t * 4.8)
      bobY = Math.abs(s) * 0.022
      torsoPitch = 0.04
      legLX = s * 0.28
      legRX = -s * 0.28
      armLX = -s * 0.24
      armRX = s * 0.24
      break
    }
    default: {
      bobY = Math.sin(t * 2.2) * 0.014
      armLX = Math.sin(t * 2.2) * 0.06
      armRX = -Math.sin(t * 2.2) * 0.06
      accBob = Math.sin(t * 2.2 + 0.6) * 0.010
      break
    }
  }

  // Ground model feet flush onto baseY using parsed model minY
  const groundLift = -(model.bounds?.minY || 0)
  const root = mat4Mul(
    mat4Translate(x + jitterX, baseY + sittingOffset + groundLift * scale, z + jitterZ),
    mat4Mul(mat4RotateY(ry), mat4Scale(scale, scale, scale)),
  )

  const pivots = model.slotPivots || {}
  const bodyPivot = pivots.Body || [0, 0.42, 0]
  const bodyAnim = pivotRotMatrix(bodyPivot, torsoPitch, torsoYaw, torsoRoll, 0, bobY + ex * 0.08, 0)

  const armLPivot = pivots.Arm_L || [-0.36, 0.56, 0]
  const armRPivot = pivots.Arm_R || [0.36, 0.56, 0]
  const legLPivot = pivots.Leg_L || [-0.14, 0.26, 0]
  const legRPivot = pivots.Leg_R || [0.14, 0.26, 0]
  const accPivot = pivots.Accessory || [0, 0.92, 0]

  const hasBothLegs = Boolean(pivots.Leg_L && pivots.Leg_R)
  const slotMatrices = {
    Body: mat4Mul(root, bodyAnim),
    Arm_L: mat4Mul(root, mat4Mul(bodyAnim, pivotRotMatrix(armLPivot, armLX, 0, armLZ, -ex * 0.34, ex * 0.04, 0))),
    Arm_R: mat4Mul(root, mat4Mul(bodyAnim, pivotRotMatrix(armRPivot, armRX, 0, armRZ, ex * 0.34, ex * 0.04, 0))),
    Leg_L: mat4Mul(root, pivotRotMatrix(legLPivot, hasBothLegs ? legLX : 0, 0, 0, hasBothLegs ? -ex * 0.16 : 0, hasBothLegs ? bobY * 0.25 - ex * 0.18 : -ex * 0.18, 0)),
    Leg_R: mat4Mul(root, pivotRotMatrix(legRPivot, legRX, 0, 0, ex * 0.16, bobY * 0.25 - ex * 0.18, 0)),
    Accessory: mat4Mul(root, mat4Mul(bodyAnim, pivotRotMatrix(accPivot, 0, accSpin, 0, 0, accBob + ex * 0.34, ex * 0.08))),
  }

  for (const part of model.parts) {
    const slotM = slotMatrices[part.slot] || slotMatrices.Body
    const m = mat4Mul(slotM, part.worldMatrix)
    const mat = resolveGLBMaterial(part, { finishOverride, tintHex, dimmed })
    renderer.add(part.meshName, m, mat.color, mat.matType, mat.emissive, mat.alpha, 0, mat.castShadow)
  }

  if (dimmed) return

  // Action-specific 3D holographic props anchored cleanly above the Blender model's height
  const topY = Math.max(0.88, (model.bounds?.maxY || 1.0) + groundLift)
  const upper = mat4Mul(slotMatrices.Body, mat4Translate(0, topY - 0.34, 0))

  if (lod === 'low') {
    if (action === 'approval_raise') {
      const bp = 0.72 + 0.28 * Math.sin(t * 6.0)
      renderer.add('sphere', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.66, 0), mat4Scale(0.24, 0.24, 0.24))), [1, 0.82, 0.25], MAT.EMISSIVE, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
    } else if (action === 'question_ask') {
      const qBob = Math.abs(Math.sin(t * 3.8)) * 0.12
      renderer.add('sphere', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.66 + qBob, 0), mat4Scale(0.26, 0.26, 0.26))), [0.82, 0.62, 1.0], MAT.EMISSIVE, [1.75, 0.65, 3.25], 0.96, 0, false)
    } else if (action === 'error_spark' || action === 'auth_expired') {
      renderer.add('octa', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.68, 0), mat4Scale(0.32, 0.32, 0.32))), [1, 0.25, 0.2], MAT.EMISSIVE, [3.5, 0.25, 0.2], 1, 0, false)
    }
    return
  }

  if (action === 'approval_raise') {
    const bp = 0.7 + 0.3 * Math.sin(t * 6.4)
    const orbY = 0.62 + Math.sin(t * 4.0) * 0.05
    renderer.add('sphere', mat4Mul(upper, mat4Mul(mat4Translate(0, orbY, 0), mat4Scale(0.22, 0.22, 0.22))), [1, 0.82, 0.22], MAT.EMISSIVE, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
    const haloR = 0.42 + ((t * 0.65) % 1.0) * 0.24
    renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, orbY, 0), mat4Scale(haloR, haloR, haloR))), [1, 0.85, 0.3], MAT.EMISSIVE, [3.0 * bp, 1.45 * bp, 0.1], (1.0 - ((t * 0.65) % 1.0)) * 0.82, 0, false)
  } else if (action === 'thinking') {
    const ringN = effortCount(effort)
    for (let r = 0; r < ringN; r++) {
      const rr = 0.26 + r * 0.15
      const yOff = 0.48 + r * 0.12 + Math.sin(t * 2.5 + r) * 0.03
      const tilt = r % 2 === 0 ? 0.22 : -0.22
      const spin = t * (1.4 + r * 0.55) * (r % 2 === 0 ? 1 : -1)
      const m = mat4Mul(upper, mat4Mul(mat4Translate(0, yOff, 0), mat4Mul(mat4RotateY(spin), mat4Mul(mat4RotateX(tilt), mat4Scale(rr, rr, rr)))))
      renderer.add('thinTorus', m, [0.75, 0.78, 1.0], MAT.EMISSIVE, [0.55, 0.72, 2.6], 0.85 - r * 0.12, 0, false)
    }
  } else if (action === 'question_ask') {
    const qY = 0.64 + Math.abs(Math.sin(t * 3.8)) * 0.14
    const qRoot = mat4Mul(upper, mat4Mul(mat4Translate(0, qY, 0), mat4RotateY(Math.sin(t * 1.8) * 0.35)))
    const qEm = [1.85, 0.68, 3.35]
    renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, qY + 0.08, 0), mat4Scale(0.46, 0.46, 0.46))), [0.85, 0.72, 1.0], MAT.EMISSIVE, qEm, 0.78, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0, 0.26, 0), mat4Scale(0.24, 0.07, 0.07))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0.09, 0.18, 0), mat4Scale(0.07, 0.14, 0.07))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0.02, 0.10, 0), mat4Scale(0.15, 0.065, 0.07))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('sphere', mat4Mul(qRoot, mat4Mul(mat4Translate(0, -0.05, 0), mat4Scale(0.095, 0.095, 0.095))), [0.92, 0.80, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
  } else if (action === 'error_spark') {
    for (let s = 0; s < 5; s++) {
      const life = (t * 2.8 + s * 0.2) % 1.0
      const ang = s * 1.256 + t * 3.2
      const rad = 0.25 + life * 0.36
      const sy = 0.38 + life * 0.42
      const sz = (1.0 - life) * 0.11
      renderer.add('octa', mat4Mul(upper, mat4Mul(mat4Translate(Math.cos(ang) * rad, sy, Math.sin(ang) * rad), mat4Scale(sz, sz, sz))), [1.0, 0.45, 0.15], MAT.EMISSIVE, [3.6, 1.15 - life * 0.8, 0.15], 1.0 - life * 0.6, 0, false)
    }
  } else if (action === 'celebrate_done') {
    for (let s = 0; s < 4; s++) {
      const life = (t * 1.6 + s * 0.25) % 1.0
      const ang = s * 1.57 + t * 2.0
      const rad = 0.32 + Math.sin(life * Math.PI) * 0.18
      const sy = 0.32 + life * 0.62
      const sz = (1.0 - life * 0.7) * 0.095
      renderer.add('octa', mat4Mul(upper, mat4Mul(mat4Translate(Math.cos(ang) * rad, sy, Math.sin(ang) * rad), mat4Mul(mat4RotateY(t * 4.0), mat4Scale(sz, sz, sz)))), [0.3, 1.0, 0.6], MAT.EMISSIVE, [0.2, 2.9, 1.1], 1.0 - life * 0.7, 0, false)
    }
  } else if (action === 'sip_coffee') {
    const mugAnchor = mat4Mul(slotMatrices.Arm_R, mat4Translate(armRPivot[0] + 0.08, armRPivot[1] - 0.18, armRPivot[2] + 0.24))
    renderer.add('cyl', mat4Mul(mugAnchor, mat4Scale(0.17, 0.18, 0.17)), ceramicCol, MAT.CERAMIC_GLAZE, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', mat4Mul(mugAnchor, mat4Mul(mat4Translate(0, 0.088, 0), mat4Scale(0.13, 0.015, 0.13))), [0.22, 0.11, 0.05], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
    for (let st = 0; st < 2; st++) {
      const sLife = (t * 0.75 + st * 0.5) % 1.0
      const sScale = 0.06 + sLife * 0.07
      renderer.add('sphere', mat4Mul(mugAnchor, mat4Mul(mat4Translate(Math.sin(t * 3.0 + st) * 0.025, 0.15 + sLife * 0.26, 0), mat4Scale(sScale, sScale, sScale))), [1.0, 0.99, 0.97], MAT.GLASS, [0.24, 0.22, 0.20], Math.sin(sLife * Math.PI) * 0.55, 0, false)
    }
  } else if (action === 'recharge_nap') {
    for (let zIdx = 0; zIdx < 2; zIdx++) {
      const life = (t * 0.55 + zIdx * 0.5) % 1.0
      const sz = 0.055 + life * 0.04
      renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(0.22 + life * 0.18, 0.36 + life * 0.40, 0.12), mat4Mul(mat4RotateZ(0.25), mat4Scale(sz * 1.4, sz * 0.65, sz * 0.4)))), [0.5, 1.0, 0.85], MAT.EMISSIVE, [0.25, 1.75, 1.15], (1.0 - life) * 0.78, 0, false)
    }
  } else if (action === 'context_compact') {
    const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
    const tubeH = 0.66 - comp * 0.32
    const fillRatio = Math.max(0.2, Math.min(1, ctxPercent / 100))
    const tubeEm = ctxPercent > 75 ? [2.2, 1.15, 0.18] : [0.18, 1.55, 2.55]
    renderer.add('cyl', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.05, 0.46), mat4Scale(0.30, tubeH, 0.30))), [0.75, 0.92, 1.0], MAT.GLASS, [0.12, 0.65, 1.1], 0.34, 0, false)
    renderer.add('cyl', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.05 - tubeH * (1 - fillRatio) * 0.5, 0.46), mat4Scale(0.22, tubeH * fillRatio, 0.22))), [1, 1, 1], MAT.EMISSIVE, tubeEm, 0.85, 0, false)
  }

  // Orbiting quad-drones for subagent_swarm
  const droneCount = action === 'subagent_swarm' ? Math.max(2, subagents) : subagents
  if (droneCount > 0) {
    const count = Math.min(4, droneCount)
    renderer.add('thinTorus', TRS(x, baseY + (topY + 0.24) * scale, z, 0, 1.52 * scale, 0.4 * scale, 1.34 * scale), [0.45, 0.92, 1.0], MAT.EMISSIVE, [0.14, 1.15, 2.05], 0.42, 0, false)
    for (let d = 0; d < count; d++) {
      const ang = time * 2.4 + (d * Math.PI * 2) / count
      const rx = 0.78 + (d % 2) * 0.14
      const rz = 0.66 + (d % 2) * 0.12
      const dy = topY + 0.24 + Math.sin(time * 3.5 + d * 1.7) * 0.09
      const dx = x + Math.cos(ang) * rx * scale
      const dz = z + Math.sin(ang) * rz * scale
      renderer.add('bevelBox', TRS(dx, baseY + dy * scale, dz, -ang, 0.24 * scale, 0.07 * scale, 0.24 * scale), [0.85, 0.92, 1.0], MAT.ALUMINUM, [0.18, 1.25, 2.15], 1, 0, false)
    }
  }
}

/**
 * Unified 25-Figurine Dispatcher:
 * Prefers real Blender 5.2.1 LTS exported `.glb` models (lazy/parallel fetched via glb_loader.js)
 * and falls back seamlessly to procedural JS figurines until each `.glb` finishes loading.
 */
export function drawFigurine(renderer, figurineKey, opts = {}) {
  let key = String(figurineKey || 'claude').toLowerCase()
  if (key === 'claude-code' || key === 'clawd') key = 'claude'
  const normalizedOpts = {
    ...opts,
    action: normalizeBotAction(opts.action || 'idle'),
  }

  // Prefer real Blender-refined .glb when running on CleanroomRenderer
  if (renderer && typeof renderer.uploadMesh === 'function' && !opts.forceProcedural) {
    const glb = getGLBModel(key)
    if (glb) {
      return drawGLBFigurine(renderer, glb, normalizedOpts)
    }
    ensureGLBLoaded(renderer, key)
  }

  if (key.startsWith('role-') || ROLE_KEY_SET.has(key)) {
    return drawRoleFigurine(renderer, key, normalizedOpts)
  }
  if (AGENT_KEY_SET.has(key)) {
    return drawAgentFigurine(renderer, key, normalizedOpts)
  }
  return drawAgentFigurine(renderer, 'claude', normalizedOpts)
}

/**
 * Rich Bot Work & Lounge Animation Rig + Living Cleanroom Lounge Environment
 * Provides expressive procedural animations for all Gonggong run states, edge cases,
 * lounge activities, and smooth spring utilities.
 */

export const WORK_ACTIONS = [
  'typing',
  'thinking',
  'reading',
  'subagent_swarm',
  'approval_raise',
  'question_ask',
  'auth_expired',
  'context_compact',
  'workspace_confirm',
  'error_spark',
  'celebrate_done',
  'walk_to_work',
]

export const LOUNGE_ACTIONS = [
  'sip_coffee',
  'chat_wave',
  'bench_swing',
  'recharge_nap',
  'stroll_lounge',
]

const ACTION_ALIASES = {
  running: 'typing',
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

export function normalizeBotAction(action) {
  if (!action) return 'idle'
  return ACTION_ALIASES[action] || action
}

export function hexToRGB(hex = '#d97757') {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const n = parseInt(clean, 16)
  if (Number.isNaN(n)) return [0.85, 0.47, 0.34]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Critically damped spring step for doors, group drag lift, bot transitions, etc.
 */
export function critDamp(cur, vel, target, smoothTime, dt) {
  const st = Math.max(0.001, smoothTime)
  const omega = 2.0 / st
  const x = omega * Math.min(0.05, Math.max(0.0001, dt))
  const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = cur - target
  const temp = (vel + omega * change) * Math.min(0.05, Math.max(0.0001, dt))
  return {
    value: target + (change + temp) * exp,
    vel: (vel - omega * temp) * exp,
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
 * Draws a fully articulated Clawd figurine with expressive work/lounge/edge-case animations
 * and 3D holographic indicators.
 */
export function drawClawdAnimated(renderer, opts) {
  const {
    x = 0,
    baseY = 0,
    z = 0,
    ry = 0,
    scale = 0.66,
    tintHex = '#d97757',
    ownerRingColor = null,
    isMe = false,
    action: rawAction = 'typing',
    effort = 'medium',
    subagents = 0,
    ctxPercent = 50,
    time = 0,
    phase = 0,
    explode = 0,
    dimmed = false,
    selected = false,
    hovered = false,
    lod = 'high',
  } = opts

  const action = normalizeBotAction(rawAction)
  const t = time + phase
  const rawShell = hexToRGB(tintHex)
  const shellCol = dimmed ? [0.68, 0.69, 0.71] : rawShell
  const alpha = dimmed ? 0.26 : 1.0
  const titaniumCol = [0.16, 0.17, 0.20]
  const obsidianCol = [0.03, 0.03, 0.04]
  const aluCol = [0.78, 0.80, 0.83]
  const ceramicCol = [0.94, 0.93, 0.90]

  // Grounded contact shadow / soft AO disc beneath feet
  if (explode < 0.05) {
    const shScale = (1.18 - Math.min(0.25, Math.max(0, 0))) * scale
    renderer.add(
      'plane',
      TRS(x, baseY + 0.011, z, 0, shScale, 1, shScale * 0.92),
      [0, 0, 0],
      MAT.SHADOW_BLOB,
      [0, 0, 0],
      dimmed ? 0.14 : 0.34,
      0,
      false,
    )
  }

  // Owner identity floor halo ring + selection/hover highlight
  if (ownerRingColor && explode < 0.05) {
    const ringEm = dimmed ? [0, 0, 0] : ownerRingColor
    const ringR = (isMe ? 0.84 : 0.74) * scale
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 0.018, z, 0, ringR, 0.55 * scale, ringR),
      dimmed ? [0.6, 0.6, 0.6] : [0.95, 0.95, 0.95],
      dimmed ? MAT.ALUMINUM : MAT.EMISSIVE,
      ringEm,
      alpha,
      0,
      false,
    )
  }
  if ((selected || hovered) && !dimmed && explode < 0.05) {
    const pulse = 1.0 + Math.sin(time * 4.6) * 0.055
    const selR = (selected ? 1.06 : 0.96) * scale * pulse
    const selEm = selected ? [0.35, 1.85, 3.2] : [0.9, 1.35, 1.9]
    // Primary crisp inner ring
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 0.028, z, 0, selR, 0.50 * scale, selR),
      [1, 1, 1],
      MAT.EMISSIVE,
      selEm,
      selected ? 0.96 : 0.65,
      0,
      false,
    )
    if (selected) {
      // Crisp dual-ring expanding outer pulse + soft floor spotlight pool
      const wave = (time * 0.72) % 1.0
      const outerR = (1.16 + wave * 0.42) * scale
      const outerAlpha = (1.0 - wave) * 0.82
      renderer.add(
        'thinTorus',
        TRS(x, baseY + 0.024, z, 0, outerR, 0.42 * scale, outerR),
        [0.85, 0.96, 1.0],
        MAT.EMISSIVE,
        [0.45, 2.05, 3.4],
        outerAlpha,
        0,
        false,
      )
      renderer.add(
        'plane',
        TRS(x, baseY + 0.015, z, 0, 1.75 * scale, 1, 1.75 * scale),
        [1, 1, 1],
        MAT.GLOW_POOL,
        [0.25, 1.35, 2.65],
        0.46,
        0,
        false,
      )
    }
  }

  // Compute procedural pose & props per action
  let bobY = 0
  let jitterX = 0
  let jitterZ = 0
  let torsoPitch = 0
  let torsoRoll = 0
  let torsoYawOffset = 0
  let armLX = 0
  let armLZ = 0
  let armRX = 0
  let armRZ = 0
  let legSwings = [0, 0, 0, 0]
  let sittingOffset = 0
  let eyeMode = 0
  let ledEmissive = [0.12, 0.85, 0.55]

  switch (action) {
    case 'typing': {
      bobY = Math.sin(t * 7.5) * 0.012
      torsoPitch = 0.08
      armLX = -0.82 + Math.sin(t * 18.0) * 0.24
      armRX = -0.82 + Math.cos(t * 18.0) * 0.24
      eyeMode = 1.0
      ledEmissive = [0.08, 1.45, 2.65]
      break
    }
    case 'thinking': {
      bobY = Math.sin(t * 2.1) * 0.018
      torsoRoll = Math.sin(t * 1.1) * 0.07
      torsoYawOffset = Math.sin(t * 0.85) * 0.14
      armRX = -1.45 + Math.sin(t * 1.8) * 0.06
      armRZ = -0.25
      armLX = -0.35 + Math.sin(t * 1.3) * 0.05
      eyeMode = 4.0
      const p = 0.65 + 0.35 * Math.sin(t * 3.0)
      ledEmissive = [0.75 * p, 0.55 * p, 2.8 * p]
      break
    }
    case 'reading': {
      bobY = Math.sin(t * 2.4) * 0.01
      torsoPitch = 0.06
      torsoYawOffset = Math.sin(t * 2.2) * 0.12
      armLX = -0.95
      armLZ = 0.18
      armRX = -0.95
      armRZ = -0.18
      eyeMode = 9.0
      ledEmissive = [0.12, 1.65, 2.35]
      break
    }
    case 'subagent_swarm': {
      bobY = Math.sin(t * 5.2) * 0.015
      torsoPitch = 0.04
      armLX = -0.92 + Math.sin(t * 14.0) * 0.18
      armRX = -1.15 + Math.cos(t * 9.0) * 0.22
      eyeMode = 1.0
      ledEmissive = [0.22, 1.95, 2.9]
      break
    }
    case 'approval_raise': {
      bobY = Math.sin(t * 3.8) * 0.022
      torsoRoll = -0.05
      armRX = -2.42 + Math.sin(t * 5.5) * 0.14
      armRZ = 0.14
      armLX = -0.18
      eyeMode = 2.0
      const p = 0.6 + 0.4 * Math.sin(t * 6.4)
      ledEmissive = [3.4 * p, 1.6 * p, 0.1]
      break
    }
    case 'question_ask': {
      bobY = Math.sin(t * 3.0) * 0.018
      torsoRoll = 0.15 + Math.sin(t * 2.0) * 0.04
      armRX = -1.55 + Math.sin(t * 3.5) * 0.16
      armRZ = 0.28
      armLX = -0.32
      eyeMode = 5.0
      const p = 0.65 + 0.35 * Math.sin(t * 4.5)
      ledEmissive = [2.6 * p, 1.85 * p, 0.25]
      break
    }
    case 'auth_expired': {
      bobY = -0.035 + Math.sin(t * 1.8) * 0.008
      torsoPitch = 0.22
      armLX = 0.15
      armLZ = -0.08
      armRX = 0.15
      armRZ = 0.08
      eyeMode = 8.0
      const p = 0.35 + 0.65 * Math.abs(Math.sin(t * 4.8))
      ledEmissive = [3.1 * p, 0.18 * p, 0.15 * p]
      break
    }
    case 'context_compact': {
      const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
      bobY = -0.02 * comp
      armLX = -1.05
      armLZ = 0.28 + comp * 0.18
      armRX = -1.05
      armRZ = -(0.28 + comp * 0.18)
      eyeMode = 1.0
      ledEmissive = [0.9 + comp * 1.4, 1.45 - comp * 0.4, 2.4 - comp * 1.2]
      break
    }
    case 'workspace_confirm': {
      bobY = Math.sin(t * 2.6) * 0.012
      torsoPitch = 0.04
      armLX = -1.02
      armLZ = 0.22
      armRX = -1.02
      armRZ = -0.22
      eyeMode = 9.0
      ledEmissive = [0.25, 1.8, 2.4]
      break
    }
    case 'error_spark': {
      jitterX = Math.sin(t * 48.0) * 0.022
      jitterZ = Math.cos(t * 53.0) * 0.022
      torsoRoll = Math.sin(t * 24.0) * 0.08
      armLX = -1.35 + Math.sin(t * 16.0) * 0.25
      armLZ = -0.45
      armRX = -1.35 + Math.cos(t * 16.0) * 0.25
      armRZ = 0.45
      eyeMode = 3.0
      ledEmissive = [3.6, 0.22, 0.18]
      break
    }
    case 'celebrate_done': {
      bobY = Math.abs(Math.sin(t * 6.8)) * 0.15
      torsoRoll = Math.sin(t * 6.8) * 0.08
      armLX = -2.55 + Math.sin(t * 10.0) * 0.18
      armLZ = -0.22
      armRX = -2.55 - Math.sin(t * 10.0) * 0.18
      armRZ = 0.22
      eyeMode = 7.0
      ledEmissive = [0.18, 2.9, 0.95]
      break
    }
    case 'walk_to_work': {
      const s = Math.sin(t * 10.5)
      bobY = Math.abs(s) * 0.045
      torsoPitch = 0.14
      const ls = s * 0.48
      legSwings = [ls, -ls, ls, -ls]
      armLX = -ls * 0.78
      armRX = ls * 0.78
      eyeMode = 1.0
      ledEmissive = [0.18, 1.55, 2.2]
      break
    }
    case 'sip_coffee': {
      const sipCycle = Math.max(0, Math.sin(t * 1.35))
      bobY = Math.sin(t * 2.0) * 0.012
      torsoPitch = -sipCycle * 0.08
      armRX = -0.68 - sipCycle * 0.62
      armRZ = -0.18
      armLX = -0.12 + Math.sin(t * 1.6) * 0.05
      ledEmissive = [0.35, 1.25, 0.75]
      break
    }
    case 'chat_wave': {
      bobY = Math.sin(t * 3.2) * 0.016
      torsoPitch = Math.sin(t * 2.8) * 0.07
      armRX = -2.15 + Math.sin(t * 6.2) * 0.25
      armRZ = 0.26 + Math.sin(t * 6.2) * 0.15
      armLX = -0.25 + Math.sin(t * 2.5) * 0.08
      ledEmissive = [0.22, 1.45, 1.05]
      break
    }
    case 'bench_swing': {
      sittingOffset = -0.06
      bobY = Math.sin(t * 2.4) * 0.008
      const sw = Math.sin(t * 4.2) * 0.34
      legSwings = [-0.95 + sw, -0.95 - sw, -0.95 + sw, -0.95 - sw]
      armLX = -0.28 + Math.sin(t * 2.1) * 0.06
      armRX = -0.28 - Math.sin(t * 2.1) * 0.06
      ledEmissive = [0.25, 1.2, 0.85]
      break
    }
    case 'recharge_nap': {
      bobY = -0.02 + Math.sin(t * 1.4) * 0.014
      torsoPitch = 0.10 + Math.sin(t * 1.4) * 0.03
      armLX = 0.08
      armRX = 0.08
      eyeMode = 6.0
      const p = 0.55 + 0.45 * Math.sin(t * 1.8)
      ledEmissive = [0.15 * p, 1.65 * p, 0.95 * p]
      break
    }
    case 'stroll_lounge': {
      const s = Math.sin(t * 4.8)
      bobY = Math.abs(s) * 0.022
      torsoPitch = 0.04
      const ls = s * 0.28
      legSwings = [ls, -ls, ls, -ls]
      armLX = -ls * 0.55
      armRX = ls * 0.55
      ledEmissive = [0.25, 1.3, 0.88]
      break
    }
    default: {
      // idle
      bobY = Math.sin(t * 2.2) * 0.014
      armLX = Math.sin(t * 2.2) * 0.06
      armRX = -Math.sin(t * 2.2) * 0.06
      break
    }
  }

  const boxMesh = lod === 'low' ? 'fastBox' : 'bevelBox'
  const root = mat4Mul(
    mat4Translate(x + jitterX, baseY + sittingOffset, z + jitterZ),
    mat4Mul(mat4RotateY(ry), mat4Scale(scale, scale, scale)),
  )
  const ex = explode
  const upperBase = mat4Mul(root, mat4Translate(0, 0.64 + bobY + ex * 0.12, 0))
  const upper = mat4Mul(
    upperBase,
    mat4Mul(mat4RotateY(torsoYawOffset), mat4Mul(mat4RotateZ(torsoRoll), mat4RotateX(torsoPitch))),
  )

  // Body + Stepped Crown
  renderer.add(boxMesh, mat4Mul(upper, mat4Scale(0.92, 0.56, 0.56)), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, !dimmed)
  renderer.add(boxMesh, mat4Mul(upper, mat4Mul(mat4Translate(0, 0.315 + ex * 0.24, 0), mat4Scale(0.72, 0.10, 0.46))), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, false)

  // Low-LOD fast path for far macro camera (keep edge-case beacons unmistakable!)
  if (lod === 'low') {
    for (const lx of [-0.29, -0.11, 0.11, 0.29]) {
      renderer.add('fastBox', mat4Mul(root, mat4Mul(mat4Translate(lx, 0.17, 0), mat4Scale(0.13, 0.32, 0.15))), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, false)
    }
    if (!dimmed) {
      if (action === 'approval_raise') {
        const bp = 0.72 + 0.28 * Math.sin(t * 6.0)
        renderer.add('fastBox', mat4Mul(upper, mat4Mul(mat4Translate(0.58, 0.42, 0), mat4Scale(0.44, 0.30, 0.045))), [1, 0.72, 0.18], MAT.EMISSIVE, [3.2 * bp, 1.55 * bp, 0.1], 1, 0, false)
        renderer.add('sphere', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.76, 0), mat4Scale(0.24, 0.24, 0.24))), [1, 0.82, 0.25], MAT.EMISSIVE, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
      } else if (action === 'question_ask') {
        const qBob = Math.abs(Math.sin(t * 3.8)) * 0.12
        renderer.add('sphere', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.76 + qBob, 0), mat4Scale(0.26, 0.26, 0.26))), [0.82, 0.62, 1.0], MAT.EMISSIVE, [1.75, 0.65, 3.25], 0.96, 0, false)
        renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.76 + qBob, 0), mat4Scale(0.46, 0.46, 0.46))), [0.85, 0.72, 1.0], MAT.EMISSIVE, [1.55, 0.58, 2.9], 0.85, 0, false)
      } else if (action === 'error_spark' || action === 'auth_expired') {
        renderer.add('octa', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.78, 0), mat4Scale(0.32, 0.32, 0.32))), [1, 0.25, 0.2], MAT.EMISSIVE, [3.5, 0.25, 0.2], 1, 0, false)
      }
      const droneN = action === 'subagent_swarm' ? Math.max(2, subagents) : subagents
      if (droneN > 0) {
        const count = Math.min(4, droneN)
        for (let d = 0; d < count; d++) {
          const ang = time * 2.4 + (d * Math.PI * 2) / count
          const dx = x + Math.cos(ang) * 0.82 * scale
          const dz = z + Math.sin(ang) * 0.72 * scale
          renderer.add('bevelBox', TRS(dx, baseY + 1.24 * scale, dz, -ang, 0.24 * scale, 0.07 * scale, 0.24 * scale), shellCol, MAT.EMISSIVE, [0.22, 1.55, 2.65], 1, 0, false)
        }
      }
    }
    return
  }

  // High-detail parts
  renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(0, -0.295 - ex * 0.05, 0), mat4Scale(0.84, 0.055, 0.50))), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, false)

  const eyeZ = 0.272 + ex * 0.22
  renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(-0.17, 0.03, eyeZ), mat4Scale(0.092, 0.19, 0.042))), obsidianCol, MAT.OBSIDIAN, [0, 0, 0], alpha, dimmed ? 0 : eyeMode, false)
  renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(0.17, 0.03, eyeZ), mat4Scale(0.092, 0.19, 0.042))), obsidianCol, MAT.OBSIDIAN, [0, 0, 0], alpha, dimmed ? 0 : eyeMode, false)

  if (!dimmed) {
    renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(-0.24, 0.362 + ex * 0.32, 0.15), mat4Scale(0.11, 0.03, 0.10))), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(-0.24, 0.375 + ex * 0.35, 0.17), mat4Scale(0.075, 0.022, 0.045))), [1, 1, 1], MAT.EMISSIVE, ledEmissive, 1, 0, false)
    const backZ = -0.278 - ex * 0.24
    renderer.add('bevelBox', mat4Mul(upper, mat4Mul(mat4Translate(0, -0.06, backZ), mat4Scale(0.44, 0.105, 0.022))), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }

  // Arms
  const drawArm = (dir, rotX, rotZ) => {
    renderer.add(
      'cyl',
      mat4Mul(upper, mat4Mul(mat4Translate(dir * (0.48 + ex * 0.26), -0.02, 0), mat4Mul(mat4RotateZ(Math.PI * 0.5), mat4Scale(0.155, 0.075, 0.155)))),
      titaniumCol,
      MAT.TITANIUM,
      [0, 0, 0],
      alpha,
      0,
      false,
    )
    const pivot = mat4Mul(
      upper,
      mat4Mul(mat4Translate(dir * (0.565 + ex * 0.42), -0.02, 0), mat4Mul(mat4RotateZ(rotZ), mat4RotateX(rotX))),
    )
    renderer.add('bevelBox', mat4Mul(pivot, mat4Mul(mat4Translate(0, -0.115, 0), mat4Scale(0.12, 0.35, 0.14))), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, false)
    return pivot
  }

  drawArm(-1, armLX, armLZ)
  const rightPivot = drawArm(1, armRX, armRZ)

  // 4 Articulated Legs
  const legXs = [-0.295, -0.115, 0.115, 0.295]
  legXs.forEach((lx, idx) => {
    const legPivot = mat4Mul(
      root,
      mat4Mul(mat4Translate(lx * (1 + ex * 0.38), 0.33 + bobY * 0.35 - ex * 0.20, 0), mat4RotateX(legSwings[idx])),
    )
    renderer.add('bevelBox', mat4Mul(legPivot, mat4Mul(mat4Translate(0, -0.15, 0), mat4Scale(0.132, 0.28, 0.152))), shellCol, MAT.FIGURINE, [0, 0, 0], alpha, 0, false)
    renderer.add('bevelBox', mat4Mul(legPivot, mat4Mul(mat4Translate(0, -0.305, 0), mat4Scale(0.12, 0.03, 0.14))), titaniumCol, MAT.TITANIUM, [0, 0, 0], alpha, 0, false)
  })

  if (dimmed) return

  // ── Action-Specific 3D Props & Holograms ────────────────────────────────────
  if (action === 'approval_raise') {
    // Prominent glowing amber approval sign held high + pulsing beacon orb & radar halo
    renderer.add(
      'bevelBox',
      mat4Mul(rightPivot, mat4Mul(mat4Translate(0.06, -0.38, 0.08), mat4Scale(0.46, 0.31, 0.032))),
      [1.0, 0.74, 0.18],
      MAT.GLASS,
      [2.85, 1.35, 0.10],
      0.86,
      0,
      false,
    )
    const bp = 0.7 + 0.3 * Math.sin(t * 6.4)
    const orbY = 0.72 + Math.sin(t * 4.0) * 0.05
    renderer.add(
      'sphere',
      mat4Mul(upper, mat4Mul(mat4Translate(0, orbY, 0), mat4Scale(0.22, 0.22, 0.22))),
      [1, 0.82, 0.22],
      MAT.EMISSIVE,
      [3.4 * bp, 1.65 * bp, 0.12],
      0.96,
      0,
      false,
    )
    const haloR = 0.42 + (t * 0.65 % 1.0) * 0.24
    renderer.add(
      'thinTorus',
      mat4Mul(upper, mat4Mul(mat4Translate(0, orbY, 0), mat4Scale(haloR, haloR, haloR))),
      [1, 0.85, 0.3],
      MAT.EMISSIVE,
      [3.0 * bp, 1.45 * bp, 0.1],
      (1.0 - (t * 0.65 % 1.0)) * 0.82,
      0,
      false,
    )
  } else if (action === 'thinking') {
    // Rotating concentric thought rings scaled by `effort`
    const ringN = effortCount(effort)
    for (let r = 0; r < ringN; r++) {
      const rr = 0.26 + r * 0.16
      const yOff = 0.56 + r * 0.13 + Math.sin(t * 2.5 + r) * 0.03
      const tilt = (r % 2 === 0 ? 0.22 : -0.22)
      const spin = t * (1.4 + r * 0.55) * (r % 2 === 0 ? 1 : -1)
      const m = mat4Mul(
        upper,
        mat4Mul(mat4Translate(0, yOff, 0), mat4Mul(mat4RotateY(spin), mat4Mul(mat4RotateX(tilt), mat4Scale(rr, rr, rr)))),
      )
      renderer.add('thinTorus', m, [0.75, 0.78, 1.0], MAT.EMISSIVE, [0.55, 0.72, 2.6], 0.85 - r * 0.12, 0, false)
    }
  } else if (action === 'reading') {
    // Glowing holographic document tablet held in front
    const docM = mat4Mul(upper, mat4Mul(mat4Translate(0, -0.02, 0.54), mat4Mul(mat4RotateX(-0.35), mat4Scale(0.46, 0.34, 0.02))))
    renderer.add('bevelBox', docM, [0.55, 0.88, 1.0], MAT.GLASS, [0.18, 1.35, 2.25], 0.76, 0, false)
    // Document text scan lines
    for (let l = -1; l <= 1; l++) {
      const lineM = mat4Mul(upper, mat4Mul(mat4Translate(0, -0.02 + l * 0.075, 0.56), mat4Mul(mat4RotateX(-0.35), mat4Scale(0.32, 0.018, 0.012))))
      renderer.add('sharpBox', lineM, [1, 1, 1], MAT.EMISSIVE, [0.35, 1.85, 2.8], 0.9, 0, false)
    }
  } else if (action === 'question_ask') {
    // Prominent lavender bobbing holographic '?' + glowing halo ring above crown
    const qY = 0.72 + Math.abs(Math.sin(t * 3.8)) * 0.14
    const qSpin = Math.sin(t * 1.8) * 0.35
    const qRoot = mat4Mul(upper, mat4Mul(mat4Translate(0, qY, 0), mat4RotateY(qSpin)))
    const qEm = [1.85, 0.68, 3.35]
    // Bobbing halo ring around '?'
    renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, qY + 0.08, 0), mat4Scale(0.46, 0.46, 0.46))), [0.85, 0.72, 1.0], MAT.EMISSIVE, qEm, 0.78, 0, false)
    // Top curve + stem + dot (scaled up for overview readability)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0, 0.30, 0), mat4Scale(0.26, 0.075, 0.075))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0.10, 0.21, 0), mat4Scale(0.075, 0.15, 0.075))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0.02, 0.12, 0), mat4Scale(0.16, 0.07, 0.075))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, mat4Mul(mat4Translate(0, 0.04, 0), mat4Scale(0.07, 0.11, 0.075))), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('sphere', mat4Mul(qRoot, mat4Mul(mat4Translate(0, -0.075, 0), mat4Scale(0.10, 0.10, 0.10))), [0.92, 0.80, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
  } else if (action === 'auth_expired') {
    // Flashing red key hologram above head
    const p = 0.45 + 0.55 * Math.abs(Math.sin(t * 5.2))
    const kRoot = mat4Mul(upper, mat4Mul(mat4Translate(0, 0.68 + Math.sin(t * 2.4) * 0.04, 0), mat4RotateY(t * 1.4)))
    const kEm = [3.2 * p, 0.22 * p, 0.18 * p]
    // Key bow (ring) + shaft + teeth
    renderer.add('torus', mat4Mul(kRoot, mat4Mul(mat4Translate(-0.14, 0, 0), mat4Mul(mat4RotateX(Math.PI * 0.5), mat4Scale(0.18, 0.18, 0.18)))), [1, 0.3, 0.25], MAT.EMISSIVE, kEm, 0.95, 0, false)
    renderer.add('bevelBox', mat4Mul(kRoot, mat4Mul(mat4Translate(0.06, 0, 0), mat4Scale(0.28, 0.045, 0.045))), [1, 0.3, 0.25], MAT.EMISSIVE, kEm, 0.95, 0, false)
    renderer.add('bevelBox', mat4Mul(kRoot, mat4Mul(mat4Translate(0.12, -0.05, 0), mat4Scale(0.04, 0.08, 0.04))), [1, 0.3, 0.25], MAT.EMISSIVE, kEm, 0.95, 0, false)
    renderer.add('bevelBox', mat4Mul(kRoot, mat4Mul(mat4Translate(0.18, -0.04, 0), mat4Scale(0.04, 0.06, 0.04))), [1, 0.3, 0.25], MAT.EMISSIVE, kEm, 0.95, 0, false)
  } else if (action === 'context_compact') {
    // Pulsing vertical context tube compressing smoothly
    const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
    const tubeH = 0.72 - comp * 0.36
    const fillRatio = Math.max(0.2, Math.min(1, ctxPercent / 100))
    const tubeEm = ctxPercent > 75 ? [2.2, 1.15, 0.18] : [0.18, 1.55, 2.55]
    renderer.add(
      'cyl',
      mat4Mul(upper, mat4Mul(mat4Translate(0, 0.12, 0.46), mat4Scale(0.32, tubeH, 0.32))),
      [0.75, 0.92, 1.0],
      MAT.GLASS,
      [0.12, 0.65, 1.1],
      0.34,
      0,
      false,
    )
    renderer.add(
      'cyl',
      mat4Mul(upper, mat4Mul(mat4Translate(0, 0.12 - tubeH * (1 - fillRatio) * 0.5, 0.46), mat4Scale(0.24, tubeH * fillRatio, 0.24))),
      [1, 1, 1],
      MAT.EMISSIVE,
      tubeEm,
      0.85,
      0,
      false,
    )
    // Compression rings top & bottom
    renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.12 + tubeH * 0.5, 0.46), mat4Scale(0.38, 0.38, 0.38))), [1, 1, 1], MAT.EMISSIVE, tubeEm, 0.9, 0, false)
    renderer.add('thinTorus', mat4Mul(upper, mat4Mul(mat4Translate(0, 0.12 - tubeH * 0.5, 0.46), mat4Scale(0.38, 0.38, 0.38))), [1, 1, 1], MAT.EMISSIVE, tubeEm, 0.9, 0, false)
  } else if (action === 'workspace_confirm') {
    // Holding glowing folder blueprint at doorway
    const bpM = mat4Mul(upper, mat4Mul(mat4Translate(0, -0.02, 0.52), mat4Mul(mat4RotateX(-0.22), mat4Scale(0.50, 0.36, 0.03))))
    renderer.add('bevelBox', bpM, [0.35, 0.72, 1.0], MAT.GLASS, [0.18, 1.15, 2.35], 0.78, 0, false)
    // Folder tab on top-left
    const tabM = mat4Mul(upper, mat4Mul(mat4Translate(-0.14, 0.18, 0.48), mat4Mul(mat4RotateX(-0.22), mat4Scale(0.18, 0.07, 0.03))))
    renderer.add('bevelBox', tabM, [0.45, 0.85, 1.0], MAT.EMISSIVE, [0.25, 1.55, 2.65], 0.88, 0, false)
  } else if (action === 'error_spark') {
    // Flickering red-orange spark particles around crown
    for (let s = 0; s < 5; s++) {
      const life = (t * 2.8 + s * 0.2) % 1.0
      const ang = s * 1.256 + t * 3.2
      const rad = 0.25 + life * 0.36
      const sy = 0.45 + life * 0.42
      const sz = (1.0 - life) * 0.11
      renderer.add(
        'octa',
        mat4Mul(upper, mat4Mul(mat4Translate(Math.cos(ang) * rad, sy, Math.sin(ang) * rad), mat4Scale(sz, sz, sz))),
        [1.0, 0.45, 0.15],
        MAT.EMISSIVE,
        [3.6, 1.15 - life * 0.8, 0.15],
        1.0 - life * 0.6,
        0,
        false,
      )
    }
  } else if (action === 'celebrate_done') {
    // Rising emerald sparkle motes
    for (let s = 0; s < 4; s++) {
      const life = (t * 1.6 + s * 0.25) % 1.0
      const ang = s * 1.57 + t * 2.0
      const rad = 0.32 + Math.sin(life * Math.PI) * 0.18
      const sy = 0.35 + life * 0.65
      const sz = (1.0 - life * 0.7) * 0.095
      renderer.add(
        'octa',
        mat4Mul(upper, mat4Mul(mat4Translate(Math.cos(ang) * rad, sy, Math.sin(ang) * rad), mat4Mul(mat4RotateY(t * 4.0), mat4Scale(sz, sz, sz)))),
        [0.3, 1.0, 0.6],
        MAT.EMISSIVE,
        [0.2, 2.9, 1.1],
        1.0 - life * 0.7,
        0,
        false,
      )
    }
  } else if (action === 'sip_coffee') {
    // Artisan ceramic coffee mug with handle in right hand + warm rising steam wisp
    const mugM = mat4Mul(rightPivot, mat4Mul(mat4Translate(0.03, -0.33, 0.13), mat4Scale(0.18, 0.19, 0.18)))
    renderer.add('cyl', mugM, ceramicCol, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    // Mug handle
    renderer.add(
      'thinTorus',
      mat4Mul(rightPivot, mat4Mul(mat4Translate(0.11, -0.33, 0.13), mat4Mul(mat4RotateX(Math.PI * 0.5), mat4Scale(0.10, 0.10, 0.10)))),
      ceramicCol,
      MAT.CERAMIC,
      [0, 0, 0],
      1,
      0,
      false,
    )
    // Dark espresso surface inside mug
    renderer.add('cyl', mat4Mul(rightPivot, mat4Mul(mat4Translate(0.03, -0.236, 0.13), mat4Scale(0.14, 0.015, 0.14))), [0.22, 0.11, 0.05], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
    // Warm rising steam wisps
    for (let st = 0; st < 2; st++) {
      const sLife = (t * 0.75 + st * 0.5) % 1.0
      const sScale = 0.065 + sLife * 0.075
      renderer.add(
        'sphere',
        mat4Mul(rightPivot, mat4Mul(mat4Translate(0.03 + Math.sin(t * 3.0 + st) * 0.025, -0.16 + sLife * 0.28, 0.13), mat4Scale(sScale, sScale, sScale))),
        [1.0, 0.99, 0.97],
        MAT.GLASS,
        [0.24, 0.22, 0.20],
        Math.sin(sLife * Math.PI) * 0.55,
        0,
        false,
      )
    }
  } else if (action === 'recharge_nap') {
    // Rising soft green/cyan Zzz sleep motes
    for (let zIdx = 0; zIdx < 2; zIdx++) {
      const life = (t * 0.55 + zIdx * 0.5) % 1.0
      const sz = 0.055 + life * 0.04
      renderer.add(
        'bevelBox',
        mat4Mul(upper, mat4Mul(mat4Translate(0.22 + life * 0.18, 0.42 + life * 0.42, 0.12), mat4Mul(mat4RotateZ(0.25), mat4Scale(sz * 1.4, sz * 0.65, sz * 0.4)))),
        [0.5, 1.0, 0.85],
        MAT.EMISSIVE,
        [0.25, 1.75, 1.15],
        (1.0 - life) * 0.78,
        0,
        false,
      )
    }
  } else if (action === 'chat_wave') {
    // Soft friendly chat pip floating beside head
    const p = 0.5 + 0.5 * Math.sin(t * 3.2)
    renderer.add(
      'bevelBox',
      mat4Mul(upper, mat4Mul(mat4Translate(0.42, 0.46 + p * 0.06, 0.14), mat4Scale(0.22, 0.13, 0.04))),
      [0.85, 0.96, 1.0],
      MAT.GLASS,
      [0.15, 0.95, 1.35],
      0.62,
      0,
      false,
    )
  }

  // Orbiting quad-drones (for `subagent_swarm` OR whenever `subagents > 0`)
  const droneCount = action === 'subagent_swarm' ? Math.max(2, subagents) : subagents
  if (droneCount > 0) {
    const count = Math.min(4, droneCount)
    // Subtle orbital path halo around parent bot
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 1.24 * scale, z, 0, 1.56 * scale, 0.4 * scale, 1.38 * scale),
      [0.45, 0.92, 1.0],
      MAT.EMISSIVE,
      [0.14, 1.15, 2.05],
      0.42,
      0,
      false,
    )
    for (let d = 0; d < count; d++) {
      const ang = time * 2.4 + (d * Math.PI * 2) / count
      const rx = 0.78 + (d % 2) * 0.14
      const rz = 0.66 + (d % 2) * 0.12
      const dy = 1.24 + Math.sin(time * 3.5 + d * 1.7) * 0.09
      const dx = x + Math.cos(ang) * rx * scale
      const dz = z + Math.sin(ang) * rz * scale
      renderer.add(
        'bevelBox',
        TRS(dx, baseY + dy * scale, dz, -ang, 0.24 * scale, 0.07 * scale, 0.24 * scale),
        shellCol,
        MAT.FIGURINE,
        [0.18, 1.25, 2.15],
        1,
        0,
        false,
      )
      // Glowing thruster ring under drone
      renderer.add(
        'thinTorus',
        TRS(dx, baseY + (dy - 0.055) * scale, dz, 0, 0.22 * scale, 0.22 * scale, 0.22 * scale),
        [0.45, 0.95, 1.0],
        MAT.EMISSIVE,
        [0.24, 2.05, 3.1],
        0.92,
        0,
        false,
      )
    }
  }
}

/**
 * Returns exact world-space coordinates for the Living Cleanroom Lounge
 * (12 curated seats, sliding glass door portal, hidden-pool spawn point, and bounds).
 */
export function getLoungeLayout(origin = [-8.6, 2.0]) {
  const [cx, cz] = origin
  const w = 8.4
  const d = 7.4

  // 4 oak benches (2 pairs) + espresso bar + 3 recharge mats + stroll zone = 12 seats
  const seats = [
    // Sofa 1 (North-West bouclé sofa, 2 bots centered cleanly inside cushions)
    { x: cx - 1.98, z: cz - 0.78, facing: 0.04, defaultAction: 'bench_swing', seatType: 'bench' },
    { x: cx - 1.22, z: cz - 0.78, facing: -0.04, defaultAction: 'bench_swing', seatType: 'bench' },
    // Sofa 2 (North-East bouclé sofa, 2 bots centered cleanly inside cushions)
    { x: cx + 1.02, z: cz - 0.78, facing: 0.12, defaultAction: 'chat_wave', seatType: 'bench' },
    { x: cx + 1.78, z: cz - 0.78, facing: -0.14, defaultAction: 'bench_swing', seatType: 'bench' },
    // Espresso bar (2 bots sipping coffee, generous spacing from bar stools)
    { x: cx - 1.48, z: cz - 2.12, facing: Math.PI, defaultAction: 'sip_coffee', seatType: 'coffee' },
    { x: cx + 0.08, z: cz - 2.12, facing: Math.PI - 0.14, defaultAction: 'sip_coffee', seatType: 'coffee' },
    // Recharge mats (3 bots napping/recharging on glowing mats)
    { x: cx - 2.25, z: cz + 1.45, facing: 0.25, defaultAction: 'recharge_nap', seatType: 'recharge' },
    { x: cx - 0.55, z: cz + 1.55, facing: 0.0, defaultAction: 'recharge_nap', seatType: 'recharge' },
    { x: cx + 1.15, z: cz + 1.45, facing: -0.25, defaultAction: 'recharge_nap', seatType: 'recharge' },
    // Social chat pair + stroll
    { x: cx - 0.15, z: cz + 0.15, facing: Math.PI * 0.42, defaultAction: 'chat_wave', seatType: 'chat' },
    { x: cx + 0.85, z: cz + 0.15, facing: -Math.PI * 0.42, defaultAction: 'chat_wave', seatType: 'chat' },
    { x: cx + 2.55, z: cz + 0.35, facing: -Math.PI * 0.5, defaultAction: 'stroll_lounge', seatType: 'stroll' },
  ]

  // Sliding glass entrance portal on the West wall of the Lounge
  const doorPos = [cx - w * 0.5 + 0.25, cz + 0.1]
  const hiddenSpawnPos = [cx - w * 0.5 - 1.35, cz + 0.1]

  return {
    origin: [cx, cz],
    w,
    d,
    seats,
    doorPos,
    hiddenSpawnPos,
    bounds: {
      minX: cx - w * 0.5,
      maxX: cx + w * 0.5,
      minZ: cz - d * 0.5,
      maxZ: cz + d * 0.5,
      cx,
      cz,
      w,
      d,
    },
  }
}

/**
 * Draws the Living Cleanroom Lounge Environment (NO Standby Plaza!).
 * Includes:
 * - Warm oak-trimmed cleanroom deck with perimeter LED accent
 * - Artisan espresso machine with animated rising steam puffs
 * - Warm light-oak benches
 * - Glowing wireless recharge mats
 * - Minimalist bonsai trees in ceramic planters
 * - Animated sliding glass entrance door portal for hidden-pool replacement bots!
 */
export function drawLoungeEnvironment(renderer, opts = {}) {
  const {
    origin = [-8.6, 2.0],
    time = 0,
    nightBlend = 0,
    doorOpen = 0,
    hiddenPoolCount = 0,
    activeSteam = true,
  } = opts

  const layout = getLoungeLayout(origin)
  const [cx, cz] = layout.origin
  const { w, d } = layout

  const aluCol = [0.82, 0.84, 0.87]
  const darkTi = [0.18, 0.20, 0.24]
  const oakCol = [0.76, 0.58, 0.39]
  const ceramicCol = [0.93, 0.92, 0.89]
  const deckCol = [0.91 - nightBlend * 0.68, 0.89 - nightBlend * 0.66, 0.84 - nightBlend * 0.60]

  // 1. Raised Warm Cleanroom Lounge Deck + Architectural Oak Trim Border
  renderer.add('slab', TRS(cx, 0.022, cz, 0, w, 0.044, d), deckCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  // Warm oak perimeter curb rails framing the Lounge sanctuary
  const curbY = 0.045
  renderer.add('bevelBox', TRS(cx, curbY, cz - d * 0.5 + 0.04, 0, w + 0.06, 0.055, 0.09), oakCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(cx, curbY, cz + d * 0.5 - 0.04, 0, w + 0.06, 0.055, 0.09), oakCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(cx + w * 0.5 - 0.04, curbY, cz, 0, 0.09, 0.055, d), oakCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  // Soft warm golden-emerald accent strip along front & east oak curb
  const trimEm = [0.35 + nightBlend * 0.55, 0.88 + nightBlend * 0.55, 0.58 + nightBlend * 0.35]
  renderer.add('sharpBox', TRS(cx, 0.028, cz + d * 0.5 + 0.02, 0, w - 0.2, 0.016, 0.03), [1, 1, 1], MAT.EMISSIVE, trimEm, 1, 0, false)
  renderer.add('sharpBox', TRS(cx + w * 0.5 + 0.02, 0.028, cz, 0, 0.03, 0.016, d - 0.2), [1, 1, 1], MAT.EMISSIVE, trimEm, 1, 0, false)

  // 2. Photorealistic Lounge Furniture, Woven Rug, Bouclé Sofas, Coffee Table, Espresso Bar & Ficus Greenery (decor.js)
  drawLoungeFurniture(renderer, origin, time, nightBlend, { activeSteam })

  // 3. Glowing Wireless Recharge Mats (aligned with recharge_nap seats)
  const mats = [
    [cx - 2.25, cz + 1.45],
    [cx - 0.55, cz + 1.55],
    [cx + 1.15, cz + 1.45],
  ]
  mats.forEach(([mx, mz], idx) => {
    const pulse = 0.65 + 0.35 * Math.sin(time * 2.2 + idx * 1.3)
    renderer.add('cyl', TRS(mx, 0.058, mz, 0, 0.98, 0.025, 0.98), ceramicCol, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    renderer.add(
      'thinTorus',
      TRS(mx, 0.078, mz, 0, 0.88, 0.45, 0.88),
      [0.4, 1.0, 0.78],
      MAT.EMISSIVE,
      [0.14 * pulse, 1.65 * pulse, 0.98 * pulse],
      0.95,
      0,
      false,
    )
  })

  // 4. Sliding Glass Entrance Portal on West Wall (for Hidden-Pool Replacement Bots!)
  const portalX = cx - w * 0.5 + 0.06
  const portalZ = cz + 0.1
  const frameH = 1.68
  const portalW = 2.05
  // Anodized aluminum portal frame
  renderer.add('bevelBox', TRS(portalX, frameH * 0.5, portalZ - portalW * 0.5, 0, 0.14, frameH, 0.12), aluCol, MAT.ALUMINUM)
  renderer.add('bevelBox', TRS(portalX, frameH * 0.5, portalZ + portalW * 0.5, 0, 0.14, frameH, 0.12), aluCol, MAT.ALUMINUM)
  renderer.add('bevelBox', TRS(portalX, frameH, portalZ, 0, 0.18, 0.14, portalW + 0.18), aluCol, MAT.ALUMINUM)
  // Header status light bar (brightens when door opens or hidden pool > 0)
  const clampedOpen = Math.max(0, Math.min(1, doorOpen))
  const portalGlow = clampedOpen > 0.05
    ? [0.2, 2.3, 1.65]
    : hiddenPoolCount > 0
      ? [0.14, 1.15, 1.75]
      : [0.15, 0.35, 0.45]
  renderer.add('sharpBox', TRS(portalX + 0.08, frameH - 0.02, portalZ, 0, 0.03, 0.045, portalW - 0.24), [1, 1, 1], MAT.EMISSIVE, portalGlow, 1, 0, false)

  // Two animated sliding glass panels
  const slideOffset = clampedOpen * 0.72
  const panelW = (portalW - 0.16) * 0.5
  const glassAlpha = 0.24 + nightBlend * 0.10
  // Left sliding leaf
  renderer.add(
    'sharpBox',
    TRS(portalX, frameH * 0.48, portalZ - panelW * 0.5 - slideOffset, 0, 0.04, frameH - 0.14, panelW - 0.04),
    [0.84, 0.94, 0.99],
    MAT.GLASS,
    [0.04, 0.14, 0.22],
    glassAlpha,
    0,
    false,
  )
  // Right sliding leaf
  renderer.add(
    'sharpBox',
    TRS(portalX, frameH * 0.48, portalZ + panelW * 0.5 + slideOffset, 0, 0.04, frameH - 0.14, panelW - 0.04),
    [0.84, 0.94, 0.99],
    MAT.GLASS,
    [0.04, 0.14, 0.22],
    glassAlpha,
    0,
    false,
  )
  // Floor threshold mat under portal
  renderer.add('slab', TRS(portalX - 0.15, 0.025, portalZ, 0, 0.95, 0.03, portalW - 0.1), darkTi, MAT.TITANIUM, [0, 0, 0], 1, 0, false)

  return layout
}

/**
 * Draws a crisp magnetic grid-snap footprint when the user drags a Group Workshop island.
 */
export function drawGroupDragPreview(renderer, grp, time = 0, valid = true) {
  if (!grp) return
  const { cx, cz, w, d } = grp
  const pulse = 0.7 + 0.3 * Math.sin(time * 6.0)
  const em = valid ? [0.15 * pulse, 1.45 * pulse, 2.6 * pulse] : [2.8 * pulse, 0.25 * pulse, 0.2 * pulse]
  const col = valid ? [0.35, 0.85, 1.0] : [1.0, 0.35, 0.3]

  renderer.add('sharpBox', TRS(cx, 0.022, cz, 0, w, 0.015, d), col, MAT.GLASS, em, 0.22, 0, false)
  // Perimeter highlight rails
  renderer.add('sharpBox', TRS(cx, 0.036, cz - d * 0.5, 0, w, 0.024, 0.05), [1, 1, 1], MAT.EMISSIVE, em, 0.92, 0, false)
  renderer.add('sharpBox', TRS(cx, 0.036, cz + d * 0.5, 0, w, 0.024, 0.05), [1, 1, 1], MAT.EMISSIVE, em, 0.92, 0, false)
  renderer.add('sharpBox', TRS(cx - w * 0.5, 0.036, cz, 0, 0.05, 0.024, d), [1, 1, 1], MAT.EMISSIVE, em, 0.92, 0, false)
  renderer.add('sharpBox', TRS(cx + w * 0.5, 0.036, cz, 0, 0.05, 0.024, d), [1, 1, 1], MAT.EMISSIVE, em, 0.92, 0, false)
}

/**
 * Draws an Apple-grade architectural Group Workshop island enclosure:
 * - Chamfered cleanroom floor pad + grounded perimeter shadow
 * - Front-curb status LED accent strip (blue=working, amber=approval/question, red=error, green=idle)
 * - Sleek anodized corner posts + low frosted glass skirt (unobstructed view of bots)
 * - Minimalist Studio Repo Core Beacon (replaces boxy T-lollipop)
 */
export function drawWorkshopEnclosure(renderer, grp, opts = {}) {
  const {
    time = 0,
    nightBlend = 0,
    isDragging = false,
    dragValid = true,
    hasError = false,
    hasApproval = false,
    hasQuestion = false,
    activeCount = 0,
  } = opts

  const { cx, cz, w, d } = grp
  const liftY = isDragging ? 0.08 : 0.0

  // 1. Cleanroom Floor Island Pad + Subtle Under-Slab Edge Shadow
  const padDay = isDragging ? [0.85, 0.92, 0.99] : [0.925, 0.93, 0.945]
  const padNight = isDragging ? [0.18, 0.26, 0.38] : [0.16, 0.18, 0.22]
  const padCol = [
    padDay[0] * (1 - nightBlend) + padNight[0] * nightBlend,
    padDay[1] * (1 - nightBlend) + padNight[1] * nightBlend,
    padDay[2] * (1 - nightBlend) + padNight[2] * nightBlend,
  ]
  renderer.add('slab', TRS(cx, 0.02 + liftY, cz, 0, w, 0.04, d), padCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)

  // Low beveled anodized architectural base curb around perimeter
  const curbCol = isDragging
    ? [0.22, 0.58, 0.96]
    : [0.76 * (1 - nightBlend) + 0.28 * nightBlend, 0.78 * (1 - nightBlend) + 0.30 * nightBlend, 0.82 * (1 - nightBlend) + 0.35 * nightBlend]
  renderer.add('bevelBox', TRS(cx, 0.048 + liftY, cz - d * 0.5 + 0.03, 0, w, 0.055, 0.06), curbCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(cx, 0.048 + liftY, cz + d * 0.5 - 0.03, 0, w, 0.055, 0.06), curbCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(cx - w * 0.5 + 0.03, 0.048 + liftY, cz, 0, 0.06, 0.055, d), curbCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(cx + w * 0.5 - 0.03, 0.048 + liftY, cz, 0, 0.06, 0.055, d), curbCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)

  // 2. Front-Curb Status LED Accent Strip (group health readable from 3D geometry alone!)
  const pulse = 0.72 + 0.28 * Math.sin(time * (hasError || hasApproval ? 5.2 : 2.4))
  let statusEm = [0.16, 1.45, 0.85] // idle/healthy emerald
  if (hasError) statusEm = [3.2 * pulse, 0.26 * pulse, 0.22 * pulse]
  else if (hasApproval) statusEm = [3.1 * pulse, 1.55 * pulse, 0.12 * pulse]
  else if (hasQuestion) statusEm = [1.55 * pulse, 0.65 * pulse, 2.95 * pulse]
  else if (activeCount > 0) statusEm = [0.15 * pulse, 1.25 * pulse, 2.55 * pulse]

  renderer.add('sharpBox', TRS(cx, 0.036 + liftY, cz + d * 0.5 + 0.015, 0, w - 0.28, 0.022, 0.032), [1, 1, 1], MAT.EMISSIVE, statusEm, 1, 0, false)
  renderer.add('sharpBox', TRS(cx, 0.036 + liftY, cz - d * 0.5 - 0.015, 0, w - 0.28, 0.018, 0.026), [1, 1, 1], MAT.EMISSIVE, statusEm, 0.85, 0, false)

  if (isDragging) {
    drawGroupDragPreview(renderer, grp, time, dragValid)
  }

  // 3. Sleek Anodized Corner Posts + Low Frosted Glass Partition Skirt (0.72m — clean, open, architectural!)
  const h = 0.72
  const postCol = isDragging
    ? [0.24, 0.60, 0.98]
    : [0.74 * (1 - nightBlend) + 0.32 * nightBlend, 0.77 * (1 - nightBlend) + 0.35 * nightBlend, 0.81 * (1 - nightBlend) + 0.42 * nightBlend]
  for (const [px, pz] of [
    [cx - w * 0.5 + 0.04, cz - d * 0.5 + 0.04],
    [cx + w * 0.5 - 0.04, cz - d * 0.5 + 0.04],
    [cx - w * 0.5 + 0.04, cz + d * 0.5 - 0.04],
    [cx + w * 0.5 - 0.04, cz + d * 0.5 - 0.04],
  ]) {
    renderer.add('cyl', TRS(px, h * 0.5 + liftY, pz, 0, 0.075, h, 0.075), postCol, MAT.ALUMINUM)
    // Tiny metallic cap on each corner post
    renderer.add('cyl', TRS(px, h + 0.015 + liftY, pz, 0, 0.095, 0.03, 0.095), [0.22, 0.24, 0.28], MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  }
  // Thin architectural top glass-cap rails (sides only; back wall owns the acoustic oak-slat accent wall!)
  renderer.add('bevelBox', TRS(cx - w * 0.5 + 0.04, h + liftY, cz, 0, 0.04, 0.032, d - 0.08), postCol, MAT.ALUMINUM)
  renderer.add('bevelBox', TRS(cx + w * 0.5 - 0.04, h + liftY, cz, 0, 0.04, 0.032, d - 0.08), postCol, MAT.ALUMINUM)

  const gAlpha = 0.14 + nightBlend * 0.06
  renderer.add('sharpBox', TRS(cx - w * 0.5 + 0.04, h * 0.5 + liftY, cz, 0, 0.018, h - 0.08, d - 0.12), [0.86, 0.93, 0.98], MAT.GLASS, [0, 0, 0], gAlpha * 0.88, 1.0, false)
  renderer.add('sharpBox', TRS(cx + w * 0.5 - 0.04, h * 0.5 + liftY, cz, 0, 0.018, h - 0.08, d - 0.12), [0.86, 0.93, 0.98], MAT.GLASS, [0, 0, 0], gAlpha * 0.88, 1.0, false)

  // 4. Minimalist Studio Repo Core Beacon (capped with brushed anodized dome + glowing health disc)
  if (grp.repoPos) {
    const [rx, rz] = grp.repoPos
    const repoEm = hasError || hasApproval || hasQuestion
      ? statusEm
      : grp.syncMode === 'force'
        ? [0.16, 1.95, 1.35]
        : [0.14, 1.35, 2.5]
    // Contact shadow + warm walnut-oak & brushed-titanium architectural plinth collar + sleek titanium pedestal + anodized dome cap
    const walnutCol = [0.46 * (1 - nightBlend * 0.35), 0.33 * (1 - nightBlend * 0.35), 0.22 * (1 - nightBlend * 0.35)]
    renderer.add('plane', TRS(rx, 0.044 + liftY, rz, 0, 0.96, 1, 0.96), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.30, 0, false)
    renderer.add('cyl', TRS(rx, 0.068 + liftY, rz, 0, 0.70, 0.056, 0.70), walnutCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', TRS(rx, 0.102 + liftY, rz, 0, 0.62, 0.022, 0.62), [0.34, 0.37, 0.42], MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', TRS(rx, 0.16 + liftY, rz, 0, 0.54, 0.22, 0.54), [0.22, 0.24, 0.28], MAT.TITANIUM)
    renderer.add('sphere', TRS(rx, 0.25 + liftY, rz, 0, 0.52, 0.14, 0.52), [0.82, 0.84, 0.88], MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', TRS(rx, 0.30 + liftY, rz, 0, 0.38, 0.025, 0.38), [1, 1, 1], MAT.EMISSIVE, repoEm, 0.96, 0, false)
    // Glowing holographic status halo with gentle breathing pulse + floating rotating crystal core
    const domeBreath = 0.78 + 0.22 * Math.sin(time * 2.4 + rx * 0.7)
    const breathEm = [repoEm[0] * domeBreath, repoEm[1] * domeBreath, repoEm[2] * domeBreath]
    const hoverY = 0.56 + Math.sin(time * 2.2 + rx) * 0.035 + liftY
    renderer.add('thinTorus', TRS(rx, 0.32 + liftY, rz, 0, 0.48 + 0.03 * domeBreath, 0.48, 0.48 + 0.03 * domeBreath), [1, 1, 1], MAT.EMISSIVE, breathEm, 0.92, 0, false)
    renderer.add('plane', TRS(rx, 0.048 + liftY, rz, 0, 1.15, 1, 1.15), [1, 1, 1], MAT.GLOW_POOL, breathEm, 0.32, 0, false)
    renderer.add(
      'thinTorus',
      mat4Mul(mat4Translate(rx, hoverY, rz), mat4Mul(mat4RotateY(time * 0.9), mat4Mul(mat4RotateX(0.35), mat4Scale(0.32, 0.32, 0.32)))),
      [0.85, 0.96, 1.0],
      MAT.EMISSIVE,
      repoEm,
      0.78,
      0,
      false,
    )
    renderer.add(
      'octa',
      mat4Mul(mat4Translate(rx, hoverY, rz), mat4Mul(mat4RotateY(-time * 1.1), mat4Scale(0.18, 0.24, 0.18))),
      [0.85, 0.96, 1.0],
      MAT.EMISSIVE,
      repoEm,
      0.94,
      0,
      false,
    )
  }

  // 5. Minimalist Corner Alert Halo Column (readable at Macro zoom without looking clunky)
  if (hasError || hasApproval || hasQuestion) {
    const bx = cx + w * 0.5 - 0.22
    const bz = cz - d * 0.5 + 0.22
    renderer.add('cyl', TRS(bx, h + 0.24 + liftY, bz, 0, 0.055, 0.42, 0.055), [0.24, 0.26, 0.30], MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('sphere', TRS(bx, h + 0.48 + liftY, bz, 0, 0.17, 0.17, 0.17), [1, 0.92, 0.8], MAT.EMISSIVE, statusEm, 0.95, 0, false)
    renderer.add('thinTorus', TRS(bx, h + 0.48 + liftY, bz, 0, 0.28 + 0.04 * pulse, 0.28, 0.28 + 0.04 * pulse), [1, 1, 1], MAT.EMISSIVE, statusEm, 0.72, 0, false)
  }
}

/**
 * Draws a sleek studio workstation desk or collaborative round table with grounded contact shadow.
 */
export function drawWorkstationDesk(renderer, inst, opts = {}) {
  const { liftY = 0, nightBlend = 0 } = opts
  const [tx, tz] = inst.deskPos
  const aluCol = [0.84 * (1 - nightBlend) + 0.34 * nightBlend, 0.86 * (1 - nightBlend) + 0.36 * nightBlend, 0.89 * (1 - nightBlend) + 0.42 * nightBlend]
  const legCol = [0.74 * (1 - nightBlend) + 0.24 * nightBlend, 0.76 * (1 - nightBlend) + 0.26 * nightBlend, 0.80 * (1 - nightBlend) + 0.31 * nightBlend]

  if (inst.roundTable) {
    renderer.add('plane', TRS(tx, 0.044 + liftY, tz, 0, 1.48, 1, 1.48), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.28, 0, false)
    renderer.add('cyl', TRS(tx, 0.46 + liftY, tz, 0, 1.18, 0.055, 1.18), aluCol, MAT.ALUMINUM)
    renderer.add('cyl', TRS(tx, 0.23 + liftY, tz, 0, 0.20, 0.46, 0.20), legCol, MAT.ALUMINUM)
    renderer.add('cyl', TRS(tx, 0.495 + liftY, tz, 0, 0.50, 0.018, 0.50), [0.2, 0.8, 1.0], MAT.EMISSIVE, [0.12, 1.35, 2.2], 1, 0, false)
    return
  }

  // Grounded contact shadow under desk
  renderer.add('plane', TRS(tx, 0.044 + liftY, tz, 0, 1.45, 1, 0.92), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.26, 0, false)
  renderer.add('bevelBox', TRS(tx, 0.46 + liftY, tz, 0, 1.16, 0.05, 0.58), aluCol, MAT.ALUMINUM)
  renderer.add('bevelBox', TRS(tx - 0.48, 0.23 + liftY, tz, 0, 0.065, 0.46, 0.50), legCol, MAT.ALUMINUM)
  renderer.add('bevelBox', TRS(tx + 0.48, 0.23 + liftY, tz, 0, 0.065, 0.46, 0.50), legCol, MAT.ALUMINUM)

  // Low-profile Studio Keyboard on desk + soft emissive monitor desk-glow spill
  renderer.add('bevelBox', TRS(tx - 0.06, 0.495 + liftY, tz + 0.08, 0, 0.38, 0.018, 0.14), [0.22, 0.24, 0.28], MAT.TITANIUM, [0, 0, 0], 1, 0, false)

  // Studio Display Monitor + Stand
  const screenEm =
    inst.status === 'approval'
      ? [1.85, 1.05, 0.12]
      : inst.status === 'question'
        ? [1.25, 0.58, 2.35]
        : ['auth_expired', 'rate_limit', 'force_conflict', 'error', 'forbidden'].includes(inst.status)
          ? [2.35, 0.25, 0.2]
          : [0.14, 1.22, 2.25]
  drawDeskGlowPool(renderer, tx - 0.08, 0.488 + liftY, tz + 0.04, screenEm, 0.42, 0.78, 0.46)
  renderer.add('sharpBox', TRS(tx - 0.08, 0.54 + liftY, tz - 0.17, 0, 0.12, 0.12, 0.03), legCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', TRS(tx - 0.08, 0.68 + liftY, tz - 0.16, 0, 0.60, 0.34, 0.028), [0.16, 0.18, 0.22], MAT.TITANIUM)
  renderer.add('sharpBox', TRS(tx - 0.08, 0.68 + liftY, tz - 0.142, 0, 0.54, 0.28, 0.012), [1, 1, 1], MAT.EMISSIVE, screenEm, 1, 0, false)

  // Context Usage Vertical Gauge Pillar
  const ctxRatio = Math.max(0.1, (inst.ctx || 10) / 100)
  const ctxEm = inst.ctx > 75 ? [2.3, 1.15, 0.1] : [0.1, 1.45, 2.35]
  renderer.add('cyl', TRS(tx + 0.46, 0.67 + liftY, tz - 0.16, 0, 0.075, 0.38, 0.075), [0.85, 0.92, 0.98], MAT.GLASS, [0, 0, 0], 0.25, 0, false)
  renderer.add('cyl', TRS(tx + 0.46, 0.49 + liftY + ctxRatio * 0.18, tz - 0.16, 0, 0.052, ctxRatio * 0.36, 0.052), [1, 1, 1], MAT.EMISSIVE, ctxEm, 1, 0, false)
}

/**
 * Renders a soft radial emissive light-spill pool (used for monitor desk glow & dome halos).
 */
export function drawDeskGlowPool(renderer, x, y, z, emissive, alpha = 0.42, sx = 0.78, sz = 0.46) {
  renderer.add('plane', TRS(x, y, z, 0, sx, 1, sz), [1, 1, 1], MAT.GLOW_POOL, emissive, alpha, 0, false)
}
