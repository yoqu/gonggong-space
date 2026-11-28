import {
  MAT,
  TRS,
  mat4Mul,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Scale,
  mat4Translate,
} from './renderer.js?v=c1'

/**
 * 13 Official Gonggong Built-in Bot Role / Persona Collectible Figurines
 * - role-gong (共字君) + 12 blended work personalities from apps/web/src/features/bots/personas.ts
 * Museum-grade designer toy proportions (height ~0.98-1.08m standing cleanly on y = baseY).
 */

export const ROLE_FIGURINE_META = [
  {
    key: 'role-gong',
    category: 'role',
    name: '共字君',
    mix: '协作 × 架构 × 玉珏',
    subtitle: '共工旗舰吉祥物 · 瓷白与钴蓝玉青「共」字建筑体',
    primaryHex: '#2f6bff',
    secondaryHex: '#0fa3a0',
    finishLabel: '釉面瓷白 · 钴蓝哑光',
  },
  {
    key: 'role-hammock',
    category: 'role',
    name: '慢想',
    mix: '深思 × 逆向 × 守边界',
    subtitle: '看着在发呆，其实在想第二层；吊床与晶体思考环',
    primaryHex: '#a3b5ff',
    secondaryHex: '#4b5fd6',
    finishLabel: '釉面蓝瓷 · 水晶光环',
  },
  {
    key: 'role-braces',
    category: 'role',
    name: '铁码',
    mix: '毒舌 × 洁癖 × 实干',
    subtitle: '精雕拉丝精钢 { } 花括号侧甲 · 严肃像素核',
    primaryHex: '#a0a9b5',
    secondaryHex: '#39424f',
    finishLabel: '拉丝钛钢 · 哑光白核',
  },
  {
    key: 'role-focus',
    category: 'role',
    name: '闭关',
    mix: '沉默 × 狂热 × 精算',
    subtitle: '降噪监听耳机心流舱 · 胸前动态火焰图底座',
    primaryHex: '#7a6dff',
    secondaryHex: '#23198a',
    finishLabel: '靛紫潮玩 · 黄铜转轴',
  },
  {
    key: 'role-steps',
    category: 'role',
    name: '小步',
    mix: '乐天 × 务实 × 敢割舍',
    subtitle: '红灯修绿灯走 · 三阶跃动台阶与 CI 状态珠',
    primaryHex: '#8be07a',
    secondaryHex: '#239a3c',
    finishLabel: '薄荷哑光 · 釉面笑颜',
  },
  {
    key: 'role-blank',
    category: 'role',
    name: '留白',
    mix: '温柔 × 偏执 × 克制',
    subtitle: '画廊级极简瓷白圆核 · 悬浮精雕四角裁切参考线',
    primaryHex: '#ffc3d6',
    secondaryHex: '#d8578a',
    finishLabel: '高光瓷白 · 玫瑰金框',
  },
  {
    key: 'role-no',
    category: 'role',
    name: '说不',
    mix: '果断 × 本分 × 聚焦',
    subtitle: '当场叫停多余需求 · 立体清单盾牌与红叉绿勾',
    primaryHex: '#ffcf40',
    secondaryHex: '#ec7300',
    finishLabel: '琥珀潮玩 · 釉面清单',
  },
  {
    key: 'role-abacus',
    category: 'role',
    name: '算盘',
    mix: '冷静 × 理性 × 算账',
    subtitle: '只看账本不听故事 · 精雕黄铜顶冠算盘与圆框眼镜',
    primaryHex: '#5fdcf0',
    secondaryHex: '#0a82a8',
    finishLabel: '天青瓷釉 · 拉丝黄铜',
  },
  {
    key: 'role-invert',
    category: 'role',
    name: '反推',
    mix: '悲观 × 缜密 × 守护',
    subtitle: '总在问它会怎么坏 · 随身翻转水晶金沙漏',
    primaryHex: '#57d6b8',
    secondaryHex: '#0b7d68',
    finishLabel: '翡翠潮玩 · 水晶沙漏',
  },
  {
    key: 'role-sentry',
    category: 'role',
    name: '哨兵',
    mix: '警觉 × 冷静 × 讲流程',
    subtitle: '默认已被攻破的冷静守卫 · 弧形雷达护目镜与天线灯',
    primaryHex: '#56688a',
    secondaryHex: '#121a2a',
    finishLabel: '战术瓷盔 · 暗钛护甲',
  },
  {
    key: 'role-spring',
    category: 'role',
    name: '抗摔',
    mix: '冷幽默 × 反脆弱 × 少即是多',
    subtitle: '贴创可贴的反脆弱方块 · 螺旋精钢弹簧躯干',
    primaryHex: '#c08eff',
    secondaryHex: '#6a2bd6',
    finishLabel: '紫罗兰潮玩 · 金属弹簧',
  },
  {
    key: 'role-compass',
    category: 'role',
    name: '灰度',
    mix: '外柔内刚 × 果断 × 放权',
    subtitle: '路径可绕方向不让 · 恒定指北黄铜罗盘冠',
    primaryHex: '#e8c089',
    secondaryHex: '#a26a2e',
    finishLabel: '暖砂潮玩 · 古铜罗盘',
  },
  {
    key: 'role-loop',
    category: 'role',
    name: '复盘',
    mix: '直率 × 暖心 × 透明',
    subtitle: '里程碑必复盘 · 环绕循环箭头光环与跃动爱心',
    primaryHex: '#ff9270',
    secondaryHex: '#d8342c',
    finishLabel: '珊瑚瓷釉 · 晶透回环',
  },
]

const ROLE_META_MAP = new Map(ROLE_FIGURINE_META.map((m) => [m.key, m]))

const ACTION_ALIASES = {
  running: 'typing',
  work: 'typing',
  approval: 'approval_raise',
  awaiting_approval: 'approval_raise',
  raise: 'approval_raise',
  awaiting_answer: 'question_ask',
  question: 'question_ask',
  ask: 'question_ask',
  auth: 'auth_expired',
  forbidden: 'auth_expired',
  rate_limit: 'context_compact',
  force_conflict: 'error_spark',
  done: 'celebrate_done',
  completed: 'celebrate_done',
  error: 'error_spark',
  failed: 'error_spark',
  walk: 'walk_to_work',
  run: 'walk_to_work',
  lounge: 'sip_coffee',
  offline: 'recharge_nap',
  offline_wait: 'recharge_nap',
  sleep: 'recharge_nap',
  queued: 'thinking',
  think: 'thinking',
  wave: 'chat_wave',
}

function normalizeAction(action) {
  if (!action) return 'idle'
  return ACTION_ALIASES[action] || action
}

function normalizeRoleKey(roleKey) {
  if (!roleKey) return 'role-gong'
  const k = String(roleKey)
  if (ROLE_META_MAP.has(k)) return k
  if (ROLE_META_MAP.has(`role-${k}`)) return `role-${k}`
  return 'role-gong'
}

function hexToRGB(hex = '#2f6bff') {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  const n = parseInt(clean, 16)
  if (Number.isNaN(n)) return [0.18, 0.42, 1.0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mixRGB(a, b, f) {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function resolveFinish(defaultKind, finishOverride) {
  const M_VINYL = MAT.VINYL_MATTE ?? MAT.FIGURINE
  const M_CERAMIC = MAT.CERAMIC_GLAZE ?? MAT.FIGURINE
  const M_CRYSTAL = MAT.CRYSTAL_GLASS ?? MAT.GLASS
  const M_BRASS = MAT.BRUSHED_BRASS ?? MAT.ALUMINUM

  const pick = (k) => {
    if (k === 'vinyl') return M_VINYL
    if (k === 'ceramic') return M_CERAMIC
    if (k === 'crystal') return M_CRYSTAL
    if (k === 'brass' || k === 'metal') return M_BRASS
    if (k === 'aluminum') return MAT.ALUMINUM
    if (k === 'titanium') return MAT.TITANIUM
    return M_VINYL
  }
  if (finishOverride && finishOverride !== 'default') {
    return pick(finishOverride)
  }
  return pick(defaultKind)
}

function localTRS(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  let m = mat4Translate(x, y, z)
  if (ry) m = mat4Mul(m, mat4RotateY(ry))
  if (rz) m = mat4Mul(m, mat4RotateZ(rz))
  if (rx) m = mat4Mul(m, mat4RotateX(rx))
  if (sx !== 1 || sy !== 1 || sz !== 1) m = mat4Mul(m, mat4Scale(sx, sy, sz))
  return m
}

function computePose(action, t) {
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
  let legL = 0
  let legR = 0
  let sitY = 0
  let eyeMode = 0

  switch (action) {
    case 'typing':
      bobY = Math.sin(t * 7.5) * 0.012
      torsoPitch = 0.08
      armLX = -0.82 + Math.sin(t * 18.0) * 0.24
      armRX = -0.82 + Math.cos(t * 18.0) * 0.24
      eyeMode = 1.0
      break
    case 'thinking':
      bobY = Math.sin(t * 2.1) * 0.016
      torsoRoll = Math.sin(t * 1.1) * 0.07
      torsoYaw = Math.sin(t * 0.85) * 0.14
      armRX = -1.42 + Math.sin(t * 1.8) * 0.06
      armRZ = -0.22
      armLX = -0.30 + Math.sin(t * 1.3) * 0.05
      eyeMode = 4.0
      break
    case 'reading':
    case 'workspace_confirm':
      bobY = Math.sin(t * 2.4) * 0.01
      torsoPitch = 0.05
      torsoYaw = Math.sin(t * 2.2) * 0.10
      armLX = -0.95
      armLZ = 0.18
      armRX = -0.95
      armRZ = -0.18
      eyeMode = 9.0
      break
    case 'subagent_swarm':
      bobY = Math.sin(t * 5.2) * 0.015
      torsoPitch = 0.04
      armLX = -0.92 + Math.sin(t * 14.0) * 0.18
      armRX = -1.12 + Math.cos(t * 9.0) * 0.22
      eyeMode = 1.0
      break
    case 'approval_raise':
      bobY = Math.sin(t * 3.8) * 0.02
      torsoRoll = -0.05
      armRX = -2.38 + Math.sin(t * 5.5) * 0.14
      armRZ = 0.14
      armLX = -0.18
      eyeMode = 2.0
      break
    case 'question_ask':
      bobY = Math.sin(t * 3.0) * 0.018
      torsoRoll = 0.14 + Math.sin(t * 2.0) * 0.04
      armRX = -1.52 + Math.sin(t * 3.5) * 0.16
      armRZ = 0.26
      armLX = -0.28
      eyeMode = 5.0
      break
    case 'auth_expired':
      bobY = -0.03 + Math.sin(t * 1.8) * 0.008
      torsoPitch = 0.20
      armLX = 0.15
      armRX = 0.15
      eyeMode = 8.0
      break
    case 'context_compact': {
      const comp = 0.5 + 0.5 * Math.sin(t * 3.4)
      bobY = -0.02 * comp
      armLX = -1.02
      armLZ = 0.26 + comp * 0.16
      armRX = -1.02
      armRZ = -(0.26 + comp * 0.16)
      eyeMode = 1.0
      break
    }
    case 'error_spark':
      jitterX = Math.sin(t * 48.0) * 0.02
      jitterZ = Math.cos(t * 53.0) * 0.02
      torsoRoll = Math.sin(t * 24.0) * 0.08
      armLX = -1.35 + Math.sin(t * 16.0) * 0.25
      armLZ = -0.42
      armRX = -1.35 + Math.cos(t * 16.0) * 0.25
      armRZ = 0.42
      eyeMode = 3.0
      break
    case 'celebrate_done':
      bobY = Math.abs(Math.sin(t * 6.8)) * 0.14
      torsoRoll = Math.sin(t * 6.8) * 0.08
      armLX = -2.50 + Math.sin(t * 10.0) * 0.18
      armLZ = -0.22
      armRX = -2.50 - Math.sin(t * 10.0) * 0.18
      armRZ = 0.22
      eyeMode = 7.0
      break
    case 'walk_to_work': {
      const s = Math.sin(t * 10.2)
      bobY = Math.abs(s) * 0.042
      torsoPitch = 0.12
      legL = s * 0.50
      legR = -s * 0.50
      armLX = -s * 0.46
      armRX = s * 0.46
      eyeMode = 1.0
      break
    }
    case 'sip_coffee': {
      const sip = Math.max(0, Math.sin(t * 1.35))
      bobY = Math.sin(t * 2.0) * 0.012
      torsoPitch = -sip * 0.07
      armRX = -0.68 - sip * 0.60
      armRZ = -0.18
      armLX = -0.12 + Math.sin(t * 1.6) * 0.05
      break
    }
    case 'chat_wave':
      bobY = Math.sin(t * 3.2) * 0.016
      torsoPitch = Math.sin(t * 2.8) * 0.06
      armRX = -2.12 + Math.sin(t * 6.2) * 0.25
      armRZ = 0.26 + Math.sin(t * 6.2) * 0.14
      armLX = -0.22 + Math.sin(t * 2.5) * 0.08
      break
    case 'bench_swing': {
      sitY = -0.055
      bobY = Math.sin(t * 2.4) * 0.008
      const sw = Math.sin(t * 4.2) * 0.34
      legL = -0.88 + sw
      legR = -0.88 - sw
      armLX = -0.26 + Math.sin(t * 2.1) * 0.06
      armRX = -0.26 - Math.sin(t * 2.1) * 0.06
      break
    }
    case 'recharge_nap':
      bobY = -0.02 + Math.sin(t * 1.4) * 0.014
      torsoPitch = 0.10 + Math.sin(t * 1.4) * 0.03
      armLX = 0.08
      armRX = 0.08
      eyeMode = 6.0
      break
    case 'stroll_lounge': {
      const s = Math.sin(t * 4.8)
      bobY = Math.abs(s) * 0.022
      torsoPitch = 0.04
      legL = s * 0.28
      legR = -s * 0.28
      armLX = -s * 0.22
      armRX = s * 0.22
      break
    }
    default:
      bobY = Math.sin(t * 2.2) * 0.014
      armLX = Math.sin(t * 2.2) * 0.06
      armRX = -Math.sin(t * 2.2) * 0.06
      break
  }

  return {
    bobY,
    jitterX,
    jitterZ,
    torsoPitch,
    torsoRoll,
    torsoYaw,
    armLX,
    armLZ,
    armRX,
    armRZ,
    legL,
    legR,
    sitY,
    eyeMode,
  }
}

/**
 * Cohesive Pop Mart articulated arm + gloved hand (shoulder ball -> tapered sleeve -> wrist cuff -> mitten + thumb).
 * Connects snugly into the torso flank with zero air gap at explode = 0.
 */
function drawGlovedHand(ctx, parent, dir, xOff, yOff, rotX, rotZ, gloveCol, cuffCol, cuffMat) {
  const { renderer, ex, alpha, dimmed, bodyMat } = ctx
  const shoulderX = xOff - 0.08
  // Rounded shoulder ball tucked cleanly into torso side
  renderer.add(
    'sphere',
    mat4Mul(parent, localTRS(dir * (shoulderX + ex * 0.16), yOff + 0.02, 0, 0, 0, 0, 0.115, 0.115, 0.115)),
    cuffCol,
    cuffMat,
    [0, 0, 0],
    alpha,
    0,
    !dimmed,
  )
  const pivot = mat4Mul(
    parent,
    mat4Mul(
      mat4Translate(dir * (shoulderX + ex * 0.30), yOff + 0.02, 0),
      mat4Mul(mat4RotateZ(rotZ), mat4RotateX(rotX)),
    ),
  )
  // Upper sleeve bridging snugly from shoulder ball to wrist cuff
  renderer.add(
    'pillBox',
    mat4Mul(pivot, localTRS(dir * 0.048, -0.042, 0.005, 0, 0, dir * 0.32, 0.088, 0.125, 0.092)),
    cuffCol,
    cuffMat,
    [0, 0, 0],
    alpha,
    0,
    !dimmed,
  )
  // Wrist cuff ring
  renderer.add(
    'cyl',
    mat4Mul(pivot, localTRS(dir * 0.075, -0.095, 0.012, 0, 0, dir * 0.18, 0.098, 0.044, 0.098)),
    cuffCol,
    cuffMat,
    [0, 0, 0],
    alpha,
    0,
    false,
  )
  // Sculpted rounded glove mitten
  renderer.add(
    'pillBox',
    mat4Mul(pivot, localTRS(dir * 0.082, -0.162, 0.018, 0, 0, 0, 0.118, 0.132, 0.110)),
    gloveCol,
    bodyMat,
    [0, 0, 0],
    alpha,
    0,
    !dimmed,
  )
  // Thumb nub
  renderer.add(
    'sphere',
    mat4Mul(pivot, localTRS(dir * 0.024, -0.152, 0.042, 0, 0, 0, 0.052, 0.058, 0.052)),
    gloveCol,
    bodyMat,
    [0, 0, 0],
    alpha,
    0,
    false,
  )
  return pivot
}

function drawGroundedBoots(ctx, root, bootCol, soleCol, legCol, spread = 0.165, legH = 0.16) {
  const { renderer, pose, ex, alpha, dimmed, bootMat, soleMat } = ctx
  const drawSide = (dir, swing) => {
    const hipY = 0.25 + pose.bobY * 0.32 - ex * 0.16
    const pivot = mat4Mul(
      root,
      mat4Mul(mat4Translate(dir * (spread + ex * 0.18), hipY, 0), mat4RotateX(swing)),
    )
    if (legH > 0.02) {
      renderer.add(
        'cyl',
        mat4Mul(pivot, localTRS(0, -legH * 0.5, 0, 0, 0, 0, 0.095, legH, 0.095)),
        legCol,
        bootMat,
        [0, 0, 0],
        alpha,
        0,
        !dimmed,
      )
    }
    // Rounded designer toy boot upper (bottom sits at y = 0.025)
    renderer.add(
      'pillBox',
      mat4Mul(pivot, localTRS(0, -0.178, 0.028, 0, 0, 0, 0.155, 0.108, 0.215)),
      bootCol,
      bootMat,
      [0, 0, 0],
      alpha,
      0,
      !dimmed,
    )
    // Precision rubber/titanium sole sitting cleanly at y = 0.0
    renderer.add(
      'bevelBox',
      mat4Mul(pivot, localTRS(0, -0.236, 0.028, 0, 0, 0, 0.162, 0.028, 0.222)),
      soleCol,
      soleMat,
      [0, 0, 0],
      alpha,
      0,
      false,
    )
  }
  drawSide(-1, pose.legL)
  drawSide(1, pose.legR)
}

function drawEyes(ctx, parent, eyeX, eyeY, eyeZ, w = 0.072, h = 0.105, depth = 0.038, mesh = 'pillBox') {
  const { renderer, pose, dimmed, alpha, ex } = ctx
  const z = eyeZ + ex * 0.16
  const em = dimmed ? 0 : pose.eyeMode
  const obs = [0.025, 0.03, 0.045]
  renderer.add(mesh, mat4Mul(parent, localTRS(-eyeX, eyeY, z, 0, 0, 0, w, h, depth)), obs, MAT.OBSIDIAN, [0, 0, 0], alpha, em, false)
  renderer.add(mesh, mat4Mul(parent, localTRS(eyeX, eyeY, z, 0, 0, 0, w, h, depth)), obs, MAT.OBSIDIAN, [0, 0, 0], alpha, em, false)
  // Crisp glossy white Pop Mart catchlight highlights (shown on open/normal eyes)
  if (!dimmed && em < 0.5) {
    const cr = Math.max(0.014, Math.min(w, h) * 0.27)
    const cz = z + depth * 0.46
    const cxOff = w * 0.18
    const cyOff = h * 0.20
    renderer.add('sphere', mat4Mul(parent, localTRS(-eyeX + cxOff, eyeY + cyOff, cz, 0, 0, 0, cr, cr, cr * 0.7)), [1, 1, 1], MAT.EMISSIVE, [0.85, 0.90, 1.0], alpha, 0, false)
    renderer.add('sphere', mat4Mul(parent, localTRS(eyeX + cxOff, eyeY + cyOff, cz, 0, 0, 0, cr, cr, cr * 0.7)), [1, 1, 1], MAT.EMISSIVE, [0.85, 0.90, 1.0], alpha, 0, false)
  }
}

function drawActionProps(ctx, upper, rightPivot, topY) {
  const { renderer, action, t, time, scale, x, z, baseY, primary, dimmed } = ctx
  if (dimmed) return

  if (action === 'approval_raise') {
    renderer.add(
      'bevelBox',
      mat4Mul(rightPivot, localTRS(0.05, -0.24, 0.06, 0, 0, 0, 0.42, 0.28, 0.03)),
      [1.0, 0.74, 0.18],
      MAT.GLASS,
      [2.85, 1.35, 0.10],
      0.86,
      0,
      false,
    )
    const bp = 0.7 + 0.3 * Math.sin(t * 6.4)
    const orbY = topY + 0.22 + Math.sin(t * 4.0) * 0.045
    renderer.add('sphere', mat4Mul(upper, localTRS(0, orbY, 0, 0, 0, 0, 0.20, 0.20, 0.20)), [1, 0.82, 0.22], MAT.EMISSIVE, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
    const wave = (t * 0.65) % 1.0
    const haloR = 0.38 + wave * 0.24
    renderer.add('thinTorus', mat4Mul(upper, localTRS(0, orbY, 0, 0, 0, 0, haloR, haloR, haloR)), [1, 0.85, 0.3], MAT.EMISSIVE, [3.0 * bp, 1.45 * bp, 0.1], (1.0 - wave) * 0.82, 0, false)
  } else if (action === 'thinking') {
    for (let r = 0; r < 2; r++) {
      const rr = 0.26 + r * 0.16
      const yOff = topY + 0.14 + r * 0.12 + Math.sin(t * 2.5 + r) * 0.03
      const tilt = r % 2 === 0 ? 0.22 : -0.22
      const spin = t * (1.4 + r * 0.55) * (r % 2 === 0 ? 1 : -1)
      renderer.add('thinTorus', mat4Mul(upper, localTRS(0, yOff, 0, tilt, spin, 0, rr, rr, rr)), [0.75, 0.78, 1.0], MAT.EMISSIVE, [0.55, 0.72, 2.6], 0.85 - r * 0.14, 0, false)
    }
  } else if (action === 'reading' || action === 'workspace_confirm') {
    const docM = mat4Mul(upper, localTRS(0, -0.02, 0.48, -0.35, 0, 0, 0.42, 0.30, 0.02))
    renderer.add('bevelBox', docM, [0.55, 0.88, 1.0], MAT.GLASS, [0.18, 1.35, 2.25], 0.76, 0, false)
    for (let l = -1; l <= 1; l++) {
      renderer.add('sharpBox', mat4Mul(upper, localTRS(0, -0.02 + l * 0.068, 0.50, -0.35, 0, 0, 0.28, 0.016, 0.012)), [1, 1, 1], MAT.EMISSIVE, [0.35, 1.85, 2.8], 0.9, 0, false)
    }
  } else if (action === 'question_ask') {
    const qY = topY + 0.18 + Math.abs(Math.sin(t * 3.8)) * 0.12
    const qRoot = mat4Mul(upper, localTRS(0, qY, 0, 0, Math.sin(t * 1.8) * 0.35, 0, 1, 1, 1))
    const qEm = [1.85, 0.68, 3.35]
    renderer.add('thinTorus', mat4Mul(upper, localTRS(0, qY + 0.08, 0, 0, 0, 0, 0.44, 0.44, 0.44)), [0.85, 0.72, 1.0], MAT.EMISSIVE, qEm, 0.78, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, localTRS(0, 0.26, 0, 0, 0, 0, 0.24, 0.068, 0.068)), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, localTRS(0.09, 0.18, 0, 0, 0, 0, 0.068, 0.13, 0.068)), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, localTRS(0.02, 0.10, 0, 0, 0, 0, 0.14, 0.065, 0.068)), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('bevelBox', mat4Mul(qRoot, localTRS(0, 0.03, 0, 0, 0, 0, 0.065, 0.09, 0.068)), [0.88, 0.74, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
    renderer.add('sphere', mat4Mul(qRoot, localTRS(0, -0.07, 0, 0, 0, 0, 0.095, 0.095, 0.095)), [0.92, 0.80, 1.0], MAT.EMISSIVE, qEm, 0.98, 0, false)
  } else if (action === 'error_spark' || action === 'auth_expired') {
    const p = 0.55 + 0.45 * Math.abs(Math.sin(t * 7.5))
    for (let i = 0; i < 4; i++) {
      const a = t * 5.2 + (i * Math.PI) / 2
      const r = 0.36 + Math.sin(t * 9 + i) * 0.06
      renderer.add(
        'octa',
        mat4Mul(upper, localTRS(Math.cos(a) * r, topY + 0.14 + Math.sin(t * 8 + i) * 0.06, Math.sin(a) * r, a, a, 0, 0.11, 0.11, 0.11)),
        [1.0, 0.28, 0.22],
        MAT.EMISSIVE,
        [3.6 * p, 0.35 * p, 0.22 * p],
        0.96,
        0,
        false,
      )
    }
  } else if (action === 'celebrate_done') {
    const confettiCols = [
      [0.18, 2.8, 0.95],
      [0.25, 1.45, 3.0],
      [3.0, 1.85, 0.25],
      [2.8, 0.65, 1.55],
    ]
    for (let i = 0; i < 6; i++) {
      const a = t * 2.8 + (i * Math.PI * 2) / 6
      const lift = ((t * 0.9 + i * 0.17) % 1.0)
      const r = 0.26 + lift * 0.36
      const cy = topY + 0.08 + lift * 0.42
      renderer.add(
        'octa',
        mat4Mul(upper, localTRS(Math.cos(a) * r, cy, Math.sin(a) * r, t * 4 + i, t * 3, 0, 0.085, 0.085, 0.085)),
        [1, 1, 1],
        MAT.EMISSIVE,
        confettiCols[i % confettiCols.length],
        1.0 - lift * 0.65,
        0,
        false,
      )
    }
  } else if (action === 'sip_coffee') {
    // Sculpted ceramic espresso cup positioned cleanly in front of the right glove tip + rising steam
    const cupM = mat4Mul(rightPivot, localTRS(0.08, -0.22, 0.145, 0.15, 0, 0, 1, 1, 1))
    renderer.add('cyl', mat4Mul(cupM, localTRS(0, 0, 0, 0, 0, 0, 0.13, 0.14, 0.13)), [0.95, 0.93, 0.89], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', mat4Mul(cupM, localTRS(0, 0.062, 0, 0, 0, 0, 0.105, 0.02, 0.105)), [0.22, 0.11, 0.05], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    renderer.add('torus', mat4Mul(cupM, localTRS(0.075, 0, 0, Math.PI * 0.5, 0, 0, 0.07, 0.07, 0.07)), [0.95, 0.93, 0.89], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    for (let s = 0; s < 2; s++) {
      const f = (t * 0.65 + s * 0.5) % 1.0
      renderer.add(
        'sphere',
        mat4Mul(cupM, localTRS(Math.sin(t * 2.5 + s) * 0.02, 0.11 + f * 0.22, 0, 0, 0, 0, 0.045 * (1 + f * 0.6), 0.045 * (1 + f * 0.6), 0.045 * (1 + f * 0.6))),
        [0.72, 0.70, 0.68],
        MAT.FIGURINE,
        [0, 0, 0],
        (1 - f) * 0.42,
        0,
        false,
      )
    }
  } else if (action === 'subagent_swarm') {
    for (let d = 0; d < 3; d++) {
      const ang = time * 2.4 + (d * Math.PI * 2) / 3
      const dx = x + Math.cos(ang) * 0.78 * scale
      const dz = z + Math.sin(ang) * 0.68 * scale
      renderer.add('bevelBox', TRS(dx, baseY + 1.16 * scale, dz, -ang, 0.20 * scale, 0.065 * scale, 0.20 * scale), primary, MAT.EMISSIVE, [0.22, 1.55, 2.65], 1, 0, false)
    }
  }
}

/* ========================================================================== *
 * 13 INDIVIDUAL SCULPTORS (Museum-grade Designer Collectible Craftsmanship)  *
 * ========================================================================== */

/** 1. role-gong — 共字君 (Signature Gonggong Flagship Mascot) */
function sculptGong(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const porcelain = [0.96, 0.97, 0.99]
  const blush = [1.0, 0.56, 0.69]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const crystalM = resolveFinish('crystal', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  // Splayed "八" character legs + porcelain/cobalt designer boots grounded at y=0
  const drawGongLeg = (dir, swing) => {
    const hip = mat4Mul(
      root,
      mat4Mul(mat4Translate(dir * (0.145 + ex * 0.16), 0.29 + pose.bobY * 0.35 - ex * 0.16, 0), mat4RotateX(swing)),
    )
    // Outward splayed stroke pillar ("八")
    renderer.add(
      'pillBox',
      mat4Mul(hip, localTRS(dir * 0.045, -0.105, 0, 0, 0, -dir * 0.28, 0.125, 0.24, 0.145)),
      secondary,
      vinylM,
      [0, 0, 0],
      bodyAlpha,
      0,
      !dimmed,
    )
    // Porcelain-white sculpted boot + cobalt trim sole at y=0
    renderer.add(
      'pillBox',
      mat4Mul(hip, localTRS(dir * 0.082, -0.222, 0.03, 0, 0, 0, 0.158, 0.105, 0.215)),
      porcelain,
      ceramicM,
      [0, 0, 0],
      bodyAlpha,
      0,
      !dimmed,
    )
    renderer.add(
      'bevelBox',
      mat4Mul(hip, localTRS(dir * 0.082, -0.276, 0.03, 0, 0, 0, 0.164, 0.028, 0.222)),
      primary,
      vinylM,
      [0, 0, 0],
      alpha,
      0,
      false,
    )
  }
  drawGongLeg(-1, pose.legL)
  drawGongLeg(1, pose.legR)

  // Architectural "共" frame:
  // Recessed warm-porcelain inner face core between the two vertical pillars
  renderer.add(
    'softBox',
    mat4Mul(upper, localTRS(0, 0.01, 0, 0, 0, 0, 0.44, 0.42, 0.34)),
    porcelain,
    ceramicM,
    [0, 0, 0],
    bodyAlpha,
    0,
    !dimmed,
  )
  // Twin vertical "共" structural pillars (left & right) rising above the top crossbar
  for (const dir of [-1, 1]) {
    renderer.add(
      'pillBox',
      mat4Mul(upper, localTRS(dir * (0.215 + ex * 0.14), 0.10 + ex * 0.08, 0, 0, 0, 0, 0.135, 0.56, 0.26)),
      mixRGB(primary, secondary, 0.32),
      vinylM,
      [0, 0, 0],
      bodyAlpha,
      0,
      !dimmed,
    )
    // Brushed brass cap finial on each pillar top
    renderer.add(
      'cyl',
      mat4Mul(upper, localTRS(dir * (0.215 + ex * 0.14), 0.388 + ex * 0.18, 0, 0, 0, 0, 0.095, 0.028, 0.095)),
      [0.88, 0.74, 0.42],
      brassM,
      [0, 0, 0],
      alpha,
      0,
      false,
    )
  }
  // Upper horizontal "共" crossbar (wide architectural beam)
  renderer.add(
    'pillBox',
    mat4Mul(upper, localTRS(0, 0.21 + ex * 0.15, 0.01, 0, 0, 0, 0.74, 0.125, 0.27)),
    primary,
    vinylM,
    [0, 0, 0],
    bodyAlpha,
    0,
    !dimmed,
  )
  // Lower horizontal "共" crossbar (waist beam) + brushed-brass collar & waist buckle trim
  renderer.add(
    'pillBox',
    mat4Mul(upper, localTRS(0, -0.185 - ex * 0.08, 0.01, 0, 0, 0, 0.66, 0.125, 0.28)),
    secondary,
    vinylM,
    [0, 0, 0],
    bodyAlpha,
    0,
    !dimmed,
  )
  // Brushed-brass architectural collar inlay beneath porcelain face window + center waist clasp
  renderer.add(
    'bevelBox',
    mat4Mul(upper, localTRS(0, -0.118 - ex * 0.04, 0.165, 0, 0, 0, 0.38, 0.026, 0.032)),
    [0.90, 0.72, 0.34],
    brassM,
    [0, 0, 0],
    alpha,
    0,
    false,
  )
  renderer.add(
    'bevelBox',
    mat4Mul(upper, localTRS(0, -0.185 - ex * 0.08, 0.152, 0, 0, 0, 0.115, 0.072, 0.032)),
    [0.90, 0.72, 0.34],
    brassM,
    [0, 0, 0],
    alpha,
    0,
    false,
  )

  // Floating Jade Diamond (玉珏) Crest hovering gently above center
  const jadeY = 0.47 + Math.sin(t * 2.8) * 0.025 + ex * 0.28
  renderer.add(
    'octa',
    mat4Mul(upper, localTRS(0, jadeY, 0, 0, t * 1.1, 0, 0.14, 0.19, 0.14)),
    [0.32, 0.90, 0.88],
    crystalM,
    [0.08, 0.48, 0.62],
    dimmed ? alpha : 0.88,
    0,
    false,
  )

  // Expressive obsidian eyes + rosy blush cheeks + gentle smile in the porcelain window (>=0.018m Z clearance)
  drawEyes(ctx, upper, 0.092, 0.02, 0.178, 0.068, 0.096, 0.036)
  renderer.add('sphere', mat4Mul(upper, localTRS(-0.148, -0.042, 0.180 + ex * 0.14, 0, 0, 0, 0.052, 0.036, 0.022)), blush, ceramicM, [0, 0, 0], alpha, 0, false)
  renderer.add('sphere', mat4Mul(upper, localTRS(0.148, -0.042, 0.180 + ex * 0.14, 0, 0, 0, 0.052, 0.036, 0.022)), blush, ceramicM, [0, 0, 0], alpha, 0, false)
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, -0.068, 0.180 + ex * 0.14, 0, 0, 0, 0.082, 0.022, 0.022)), [0.10, 0.14, 0.24], MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Cohesive white gloved hands with architectural cobalt sleeves attached snugly to "共" beam
  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.365, -0.10, pose.armLX, pose.armLZ, porcelain, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.365, -0.10, pose.armRX, pose.armRZ, porcelain, primary, vinylM)
  return { rightPivot, topY: 0.56 }
}

/** 2. role-hammock — 慢想 (Dreamy Blue Glazed Head in Warm Linen-Indigo Hammock Cradle + Orbiting Thinking Halo) */
function sculptHammock(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.97, 0.98, 1.0]
  const linen = [0.91, 0.85, 0.75]
  const warmWood = [0.64, 0.45, 0.28]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const crystalM = resolveFinish('crystal', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.16, 0.18, 0.24], primary, 0.145, 0.11)

  // Gentle hammock rock rotation
  const swingAng = Math.sin(t * 1.45) * 0.095
  const cradle = mat4Mul(upper, mat4RotateZ(swingAng))

  // Sculpted curved warm-linen hammock sling hugging lower torso (high contrast vs pale floor!)
  const slingSegs = [
    [-0.25, -0.02, 0.56],
    [-0.13, -0.125, 0.24],
    [0.0, -0.17, 0.0],
    [0.13, -0.125, -0.24],
    [0.25, -0.02, -0.56],
  ]
  for (const [sx, sy, rz] of slingSegs) {
    renderer.add(
      'pillBox',
      mat4Mul(cradle, localTRS(sx * (1 + ex * 0.2), sy - ex * 0.08, 0, 0, 0, rz, 0.175, 0.078, 0.34)),
      linen,
      vinylM,
      [0, 0, 0],
      bodyAlpha,
      0,
      !dimmed,
    )
  }
  // Soft-indigo woven blanket stripes along front & back lip of hammock + cozy wooden spreader bars & tassels
  renderer.add('pillBox', mat4Mul(cradle, localTRS(0, -0.162 - ex * 0.08, 0.168, 0, 0, 0, 0.42, 0.044, 0.042)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('pillBox', mat4Mul(cradle, localTRS(0, -0.115 - ex * 0.07, 0.166, 0, 0, 0, 0.36, 0.024, 0.036)), primary, vinylM, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    // Warm oak horizontal spreader bar tucked neatly at hammock wingtip (horizontal Z-axis, zero antenna look!)
    renderer.add('cyl', mat4Mul(cradle, localTRS(dir * (0.29 + ex * 0.14), 0.025, 0, Math.PI * 0.5, 0, 0, 0.042, 0.34, 0.042)), warmWood, MAT.OAK_WOOD, [0, 0, 0], alpha, 0, !dimmed)
    // Brass end-ring + short cozy hanging indigo tassel tucked neatly below the spreader bar
    renderer.add('torus', mat4Mul(cradle, localTRS(dir * (0.315 + ex * 0.16), 0.025, 0, 0, Math.PI * 0.5, 0, 0.075, 0.075, 0.075)), [0.88, 0.72, 0.36], brassM, [0, 0, 0], alpha, 0, false)
    renderer.add('cone', mat4Mul(cradle, localTRS(dir * (0.315 + ex * 0.16), -0.055, 0, 0, 0, 0, 0.055, 0.095, 0.055)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  }

  // Plump glazed-blue spherical head cradled inside the hammock
  renderer.add(
    'sphere',
    mat4Mul(cradle, localTRS(0, 0.11 + ex * 0.12, 0, 0, 0, 0, 0.46, 0.44, 0.44)),
    primary,
    ceramicM,
    [0, 0, 0],
    bodyAlpha,
    0,
    !dimmed,
  )
  // Soft porcelain face medallion inlay
  renderer.add(
    'sphere',
    mat4Mul(cradle, localTRS(0, 0.10 + ex * 0.14, 0.075, 0, 0, 0, 0.37, 0.35, 0.34)),
    white,
    ceramicM,
    [0, 0, 0],
    bodyAlpha,
    0,
    false,
  )
  // Dreamy half-lidded eyes + peaceful brow eyelids (protruding cleanly in front of medallion)
  drawEyes(ctx, cradle, 0.082, 0.112, 0.244, 0.068, 0.064, 0.036)
  for (const dir of [-1, 1]) {
    renderer.add('bevelBox', mat4Mul(cradle, localTRS(dir * 0.082, 0.144, 0.252 + ex * 0.16, 0, 0, 0, 0.084, 0.026, 0.03)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  }
  renderer.add('pillBox', mat4Mul(cradle, localTRS(0, 0.042, 0.244 + ex * 0.16, 0, 0, 0, 0.078, 0.020, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Orbiting translucent crystal thinking halo ring + 2 thought pearls upper-right
  const pulse = 1.0 + Math.sin(t * 2.2) * 0.12
  const hx = 0.25 + ex * 0.24
  const hy = 0.39 + Math.sin(t * 1.9) * 0.025 + ex * 0.22
  renderer.add(
    'thinTorus',
    mat4Mul(upper, localTRS(hx, hy, 0.02, 0.55, t * 1.2, 0.25, 0.22 * pulse, 0.22 * pulse, 0.22 * pulse)),
    [0.58, 0.72, 1.0],
    crystalM,
    [0.28, 0.42, 0.95],
    dimmed ? alpha : 0.82,
    0,
    false,
  )
  renderer.add('sphere', mat4Mul(upper, localTRS(hx, hy, 0.02, 0, 0, 0, 0.075, 0.075, 0.075)), primary, crystalM, [0.35, 0.48, 0.95], dimmed ? alpha : 0.88, 0, false)
  renderer.add('sphere', mat4Mul(upper, localTRS(hx - 0.11, hy - 0.10, 0.04, 0, 0, 0, 0.042, 0.042, 0.042)), primary, crystalM, [0.25, 0.38, 0.85], dimmed ? alpha : 0.85, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, cradle, -1, 0.285, -0.05, pose.armLX, pose.armLZ, white, secondary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, cradle, 1, 0.285, -0.05, pose.armRX, pose.armRZ, white, secondary, vinylM)
  return { rightPivot, topY: 0.46 }
}

/** 3. role-braces — 铁码 (Machined Brushed-Steel { } Side Armor Flanking Pixel-Eyed Core) */
function sculptBraces(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.93, 0.95, 0.97]
  const steelM = resolveFinish('aluminum', finishOverride)
  const darkM = resolveFinish('titanium', finishOverride)
  const coreM = resolveFinish('vinyl', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: darkM, soleMat: MAT.TITANIUM }, root, secondary, [0.12, 0.14, 0.18], primary, 0.155, 0.12)

  // Squared chamfered matte-white pixel core
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, 0.07 + ex * 0.08, 0, 0, 0, 0, 0.42, 0.44, 0.34)), white, coreM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Twin machined code-bar ribs below core (matching personas.ts c1/c2)
  const c1Scale = 0.75 + 0.25 * Math.sin(t * 2.4)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.185 - ex * 0.06, 0.04, 0, 0, 0, 0.38 * c1Scale, 0.042, 0.22)), primary, steelM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.04, -0.245 - ex * 0.09, 0.04, 0, 0, 0, 0.26, 0.042, 0.22)), secondary, darkM, [0, 0, 0], alpha, 0, false)

  // Sculpted 3D machined brushed-steel { and } curly-brace side armor plates
  const squeeze = Math.sin(t * 2.6) * 0.018
  for (const dir of [-1, 1]) {
    const bx = dir * (0.295 - squeeze + ex * 0.24)
    // Upper vertical spine
    renderer.add('bevelBox', mat4Mul(upper, localTRS(bx, 0.17, 0.01, 0, 0, 0, 0.055, 0.19, 0.18)), primary, steelM, [0, 0, 0], bodyAlpha, 0, !dimmed)
    // Lower vertical spine
    renderer.add('bevelBox', mat4Mul(upper, localTRS(bx, -0.04, 0.01, 0, 0, 0, 0.055, 0.19, 0.18)), primary, steelM, [0, 0, 0], bodyAlpha, 0, !dimmed)
    // Top inward hook
    renderer.add('bevelBox', mat4Mul(upper, localTRS(bx - dir * 0.045, 0.275, 0.01, 0, 0, 0, 0.11, 0.052, 0.18)), primary, steelM, [0, 0, 0], bodyAlpha, 0, false)
    // Bottom inward hook
    renderer.add('bevelBox', mat4Mul(upper, localTRS(bx - dir * 0.045, -0.145, 0.01, 0, 0, 0, 0.11, 0.052, 0.18)), primary, steelM, [0, 0, 0], bodyAlpha, 0, false)
    // Outward center beak point of { / }
    renderer.add('bevelBox', mat4Mul(upper, localTRS(bx + dir * 0.048, 0.065, 0.01, 0, 0, dir * 0.78, 0.085, 0.085, 0.18)), secondary, darkM, [0, 0, 0], bodyAlpha, 0, false)
  }

  // Serious furrowed eyebrows + square pixel eyes + flat deadpan mouth
  drawEyes(ctx, upper, 0.095, 0.075, 0.172, 0.074, 0.074, 0.036, 'bevelBox')
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.098, 0.152, 0.178 + ex * 0.16, 0, 0, -0.24, 0.105, 0.030, 0.03)), secondary, darkM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0.098, 0.152, 0.178 + ex * 0.16, 0, 0, 0.24, 0.105, 0.030, 0.03)), secondary, darkM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.025, 0.175 + ex * 0.16, 0, 0, 0, 0.125, 0.026, 0.025)), secondary, darkM, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: steelM }
  drawGlovedHand(gCtx, upper, -1, 0.34, -0.02, pose.armLX, pose.armLZ, primary, secondary, darkM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.34, -0.02, pose.armRX, pose.armRZ, primary, secondary, darkM)
  return { rightPivot, topY: 0.36 }
}

/** 4. role-focus — 闭关 (Audiophile Headphones + 3-Tier Illuminated Flamegraph Pedestal) */
function sculptFocus(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.96, 0.96, 0.99]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.12, 0.10, 0.24], primary, 0.15, 0.11)

  // Sleek white studio pill head
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, 0.12 + ex * 0.10, 0, 0, 0, 0, 0.44, 0.42, 0.38)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Deep indigo torso base
  renderer.add('softBox', mat4Mul(upper, localTRS(0, -0.17 - ex * 0.04, 0, 0, 0, 0, 0.46, 0.21, 0.30)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)

  // 3-Tier Illuminated Flamegraph bars on chest (gold -> orange -> coral)
  const f1 = 0.72 + 0.28 * Math.sin(t * 2.6)
  const f2 = 0.72 + 0.28 * Math.sin(t * 2.6 + 0.7)
  const f3 = 0.75 + 0.25 * Math.sin(t * 2.6 + 1.4)
  const fgZ = 0.158 + ex * 0.12
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.115, fgZ, 0, 0, 0, 0.20 * f1, 0.040, 0.032)), [1.0, 0.85, 0.29], MAT.EMISSIVE, [1.4, 1.05, 0.18], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.165, fgZ, 0, 0, 0, 0.30 * f2, 0.040, 0.032)), [1.0, 0.64, 0.29], MAT.EMISSIVE, [1.5, 0.68, 0.15], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.215, fgZ, 0, 0, 0, 0.40 * f3, 0.040, 0.032)), [1.0, 0.42, 0.35], MAT.EMISSIVE, [1.6, 0.38, 0.28], alpha, 0, false)

  // Oversized Audiophile Headphones (arching headband + brass swivels + dual ear-cups)
  const hbY = 0.35 + ex * 0.24
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, hbY, 0, 0, 0, 0, 0.48, 0.068, 0.13)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  for (const dir of [-1, 1]) {
    // Side arch arms
    renderer.add('pillBox', mat4Mul(upper, localTRS(dir * (0.245 + ex * 0.18), 0.24 + ex * 0.14, 0, 0, 0, -dir * 0.16, 0.062, 0.22, 0.11)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)
    // Brass swivel joint
    renderer.add('cyl', mat4Mul(upper, localTRS(dir * (0.258 + ex * 0.20), 0.14, 0, 0, 0, Math.PI * 0.5, 0.072, 0.055, 0.072)), [0.88, 0.74, 0.42], brassM, [0, 0, 0], alpha, 0, false)
    // Ear-cup shell + cushion + glowing violet studio ring
    renderer.add('cyl', mat4Mul(upper, localTRS(dir * (0.268 + ex * 0.22), 0.11, 0, 0, 0, Math.PI * 0.5, 0.21, 0.095, 0.21)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
    renderer.add('torus', mat4Mul(upper, localTRS(dir * (0.315 + ex * 0.24), 0.11, 0, 0, 0, Math.PI * 0.5, 0.15, 0.15, 0.15)), primary, MAT.EMISSIVE, [0.65, 0.52, 2.2], alpha, 0, false)
  }

  // Focused horizontal brows + narrowed eyes
  drawEyes(ctx, upper, 0.095, 0.115, 0.192, 0.076, 0.055, 0.036)
  for (const dir of [-1, 1]) {
    renderer.add('bevelBox', mat4Mul(upper, localTRS(dir * 0.095, 0.172, 0.196 + ex * 0.16, 0, 0, 0, 0.092, 0.026, 0.025)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  }
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, 0.022, 0.194 + ex * 0.16, 0, 0, 0, 0.075, 0.022, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.30, -0.08, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.30, -0.08, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.44 }
}

/** 5. role-steps — 小步 (Bouncy Emerald Figurine + 3-Step Terrace Blocks with Red->Green CI Dots) */
function sculptSteps(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.97, 0.99, 0.97]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.12, 0.22, 0.14], primary, 0.155, 0.10)

  // Signature energetic little hop on the head/body
  const hop = Math.abs(Math.sin(t * 5.2)) * 0.032
  const hopped = mat4Mul(upper, mat4Translate(0, hop, 0))

  // 3-step sculpted architectural terrace belt around lower torso
  const steps = [
    [-0.175, -0.22, 0.16, 0.09],
    [0.0, -0.17, 0.17, 0.14],
    [0.175, -0.12, 0.16, 0.19],
  ]
  const cycle = (t * 0.85) % 3.0
  steps.forEach(([sx, sy, sw, sh], idx) => {
    renderer.add(
      'bevelBox',
      mat4Mul(upper, localTRS(sx * (1 + ex * 0.22), sy - ex * 0.06, 0.03, 0, 0, 0, sw, sh, 0.24)),
      idx === 1 ? primary : secondary,
      vinylM,
      [0, 0, 0],
      bodyAlpha,
      0,
      !dimmed,
    )
    // Glowing CI test-status LED orb on each step (sequentially flipping red -> green!)
    const isGreen = cycle > idx * 0.72 + 0.35
    const dotCol = isGreen ? [0.19, 0.78, 0.37] : [1.0, 0.37, 0.34]
    const dotEm = isGreen ? [0.22, 2.2, 0.65] : [2.4, 0.32, 0.28]
    renderer.add(
      'sphere',
      mat4Mul(upper, localTRS(sx * (1 + ex * 0.22), sy + sh * 0.5 + 0.032 - ex * 0.04, 0.12, 0, 0, 0, 0.064, 0.064, 0.064)),
      dotCol,
      MAT.EMISSIVE,
      dotEm,
      alpha,
      0,
      false,
    )
  })

  // Cheerful bouncy rounded-square white head
  renderer.add('softBox', mat4Mul(hopped, localTRS(0, 0.14 + ex * 0.12, 0, 0, 0, 0, 0.44, 0.39, 0.36)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Fresh green sprout/cap accent on top
  renderer.add('pillBox', mat4Mul(hopped, localTRS(0, 0.355 + ex * 0.22, 0, 0, 0, 0, 0.26, 0.058, 0.20)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)

  // Happy eyes + cheerful grin
  drawEyes(ctx, hopped, 0.095, 0.165, 0.182, 0.072, 0.072, 0.034)
  renderer.add('pillBox', mat4Mul(hopped, localTRS(0, 0.065, 0.182 + ex * 0.16, 0, 0, 0, 0.13, 0.052, 0.025)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, hopped, -1, 0.285, 0.02, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, hopped, 1, 0.285, 0.02, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.44 }
}

/** 6. role-blank — 留白 (Minimalist Gallery Porcelain Sphere + Floating Corner Crop-Mark Frame) */
function sculptBlank(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const porcelain = [0.985, 0.975, 0.98]
  const roseGold = [0.92, 0.72, 0.74]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: ceramicM, soleMat: vinylM }, root, primary, secondary, porcelain, 0.135, 0.13)

  // Gentle breathing scale on the Zen porcelain sphere
  const br = 1.0 + Math.sin(t * 1.75) * 0.028
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.08 + ex * 0.08, 0, 0, 0, 0, 0.48 * br, 0.48 * br, 0.46 * br)), porcelain, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Soft sakura-rose collar base beneath sphere
  renderer.add('cyl', mat4Mul(upper, localTRS(0, -0.155 - ex * 0.05, 0, 0, 0, 0, 0.24, 0.065, 0.24)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)

  // 4 Sculpted Architectural Corner Crop-Mark Brackets (⌜ ⌝ ⌞ ⌟) in brushed rose-gold
  const frameSpread = 0.305 + Math.sin(t * 1.75) * 0.015 + ex * 0.22
  const corners = [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ]
  for (const [cx, cy] of corners) {
    const px = cx * frameSpread
    const py = 0.08 + cy * frameSpread
    renderer.add('bevelBox', mat4Mul(upper, localTRS(px - cx * 0.048, py, 0.04, 0, 0, 0, 0.115, 0.026, 0.028)), roseGold, brassM, [0, 0, 0], alpha, 0, false)
    renderer.add('bevelBox', mat4Mul(upper, localTRS(px, py - cy * 0.048, 0.04, 0, 0, 0, 0.026, 0.115, 0.028)), roseGold, brassM, [0, 0, 0], alpha, 0, false)
  }

  // Minimalist delicate dot eyes, subtle smile, and single signature sakura cheek dot
  drawEyes(ctx, upper, 0.088, 0.10, 0.228, 0.050, 0.050, 0.028, 'sphere')
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, 0.022, 0.230 + ex * 0.16, 0, 0, 0, 0.072, 0.018, 0.018)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)
  renderer.add('sphere', mat4Mul(upper, localTRS(0.125, 0.036, 0.222 + ex * 0.15, 0, 0, 0, 0.038, 0.038, 0.020)), [1.0, 0.62, 0.75], ceramicM, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.28, -0.02, pose.armLX, pose.armLZ, porcelain, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.28, -0.02, pose.armRX, pose.armRZ, porcelain, primary, vinylM)
  return { rightPivot, topY: 0.44 }
}

/** 7. role-no — 说不 (Decisive Amber Head atop Checklist Clipboard Torso with Red Strikes & Green Check) */
function sculptNo(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.98, 0.97, 0.95]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.22, 0.14, 0.08], primary, 0.15, 0.10)

  // Determined spherical head perched atop the checklist shield
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.24 + ex * 0.16, 0, 0, 0, 0, 0.36, 0.35, 0.34)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.24 + ex * 0.17, 0.06, 0, 0, 0, 0.29, 0.28, 0.27)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, false)

  // Firm level eyebrows + resolute eyes + straight mouth
  drawEyes(ctx, upper, 0.068, 0.245, 0.195, 0.052, 0.062, 0.028)
  for (const dir of [-1, 1]) {
    renderer.add('bevelBox', mat4Mul(upper, localTRS(dir * 0.068, 0.298, 0.198 + ex * 0.17, 0, 0, 0, 0.072, 0.022, 0.022)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  }
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, 0.175, 0.196 + ex * 0.17, 0, 0, 0, 0.082, 0.020, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Sculpted Checklist Clipboard Torso Shield
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.07 - ex * 0.04, 0.02, 0, 0, 0, 0.44, 0.37, 0.24)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.07 - ex * 0.04, 0.135, 0, 0, 0, 0.38, 0.32, 0.045)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, false)
  // Brass clipboard clip at top of board
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, 0.105 - ex * 0.02, 0.155, 0, 0, 0, 0.14, 0.042, 0.036)), [0.88, 0.74, 0.42], brassM, [0, 0, 0], alpha, 0, false)

  // 3 checklist lines + 2 bold crimson strikethrough bars + 1 glowing emerald checkmark!
  const lz = 0.168 + ex * 0.08
  const pulseOk = 1.0 + Math.sin(t * 3.0) * 0.12
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.02, 0.015, lz, 0, 0, 0, 0.26, 0.026, 0.018)), [1.0, 0.34, 0.32], MAT.EMISSIVE, [2.2, 0.30, 0.26], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.04, -0.068, lz, 0, 0, 0, 0.18, 0.026, 0.016)), [0.68, 0.70, 0.74], vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.02, -0.15, lz, 0, 0, 0, 0.25, 0.026, 0.018)), [1.0, 0.34, 0.32], MAT.EMISSIVE, [2.2, 0.30, 0.26], alpha, 0, false)
  // 3D Green Checkmark on middle kept item
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0.085, -0.074, lz + 0.006, 0, 0, -0.72, 0.055 * pulseOk, 0.022, 0.022)), [0.19, 0.80, 0.38], MAT.EMISSIVE, [0.22, 2.3, 0.65], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0.128, -0.054, lz + 0.006, 0, 0, 0.78, 0.092 * pulseOk, 0.022, 0.022)), [0.19, 0.80, 0.38], MAT.EMISSIVE, [0.22, 2.3, 0.65], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.285, -0.04, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.285, -0.04, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.46 }
}

/** 8. role-abacus — 算盘 (Cerulean Scholar + Crisp Eyes Behind Brass Spectacles + Coral/Jade/Walnut Brass Abacus Crown) */
function sculptAbacus(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.96, 0.985, 0.995]
  const brassCol = [0.90, 0.70, 0.28]
  const coralBead = [0.78, 0.12, 0.08]
  const jadeBead = [0.04, 0.42, 0.28]
  const walnutBead = [0.24, 0.11, 0.05]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.10, 0.22, 0.28], primary, 0.145, 0.11)

  // Tailored cerulean vest torso + composed porcelain spherical head
  renderer.add('softBox', mat4Mul(upper, localTRS(0, -0.155 - ex * 0.05, 0, 0, 0, 0, 0.38, 0.21, 0.28)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.08 + ex * 0.08, 0, 0, 0, 0, 0.45, 0.44, 0.43)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)

  // Crisp protruding obsidian eyes with catchlights + Round Brushed-Brass Scholar Spectacles in front!
  drawEyes(ctx, upper, 0.095, 0.095, 0.226, 0.058, 0.068, 0.036, 'pillBox')
  const gZ = 0.246 + ex * 0.17
  for (const dir of [-1, 1]) {
    renderer.add('thinTorus', mat4Mul(upper, localTRS(dir * 0.095, 0.095, gZ, Math.PI * 0.5, 0, 0, 0.152, 0.152, 0.152)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  }
  renderer.add('cyl', mat4Mul(upper, localTRS(0, 0.095, gZ, 0, 0, Math.PI * 0.5, 0.020, 0.058, 0.020)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.018, 0.224 + ex * 0.16, 0, 0, 0, 0.075, 0.020, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Museum-Grade 3D Brushed-Brass Abacus Crown with horizontal divider beam (梁) & coral/jade/walnut ceramic beads!
  const abY = 0.395 + ex * 0.26
  // Outer brass frame (top, bottom, left, right) + classic horizontal divider beam
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, abY + 0.098, 0, 0, 0, 0, 0.58, 0.030, 0.068)), brassCol, brassM, [0, 0, 0], alpha, 0, !dimmed)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, abY - 0.098, 0, 0, 0, 0, 0.58, 0.030, 0.068)), brassCol, brassM, [0, 0, 0], alpha, 0, !dimmed)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, abY + 0.012, 0, 0, 0, 0, 0.54, 0.024, 0.056)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    renderer.add('bevelBox', mat4Mul(upper, localTRS(dir * 0.275, abY, 0, 0, 0, 0, 0.036, 0.22, 0.068)), brassCol, brassM, [0, 0, 0], alpha, 0, !dimmed)
  }
  // Upper & lower brass rods + rich alternating coral-red, jade-emerald & walnut beads sliding smoothly
  renderer.add('cyl', mat4Mul(upper, localTRS(0, abY + 0.055, 0, 0, 0, Math.PI * 0.5, 0.018, 0.52, 0.018)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  renderer.add('cyl', mat4Mul(upper, localTRS(0, abY - 0.044, 0, 0, 0, Math.PI * 0.5, 0.018, 0.52, 0.018)), brassCol, brassM, [0, 0, 0], alpha, 0, false)

  const slideA = (0.5 + 0.5 * Math.sin(t * 2.4)) * 0.075
  const slideB = (0.5 + 0.5 * Math.sin(t * 2.4 + 1.8)) * 0.075
  const upperBeads = [
    [-0.17 + slideA, coralBead],
    [0.02 - slideB * 0.5, jadeBead],
    [0.18, walnutBead],
  ]
  for (const [bx, col] of upperBeads) {
    renderer.add('sphere', mat4Mul(upper, localTRS(bx, abY + 0.055, 0, 0, 0, 0, 0.072, 0.072, 0.072)), col, vinylM, [0, 0, 0], alpha, 0, false)
  }
  const lowerBeads = [
    [-0.19 + slideA, walnutBead],
    [-0.10 + slideA, coralBead],
    [0.09 - slideB, jadeBead],
    [0.19, coralBead],
  ]
  for (const [bx, col] of lowerBeads) {
    renderer.add('sphere', mat4Mul(upper, localTRS(bx, abY - 0.044, 0, 0, 0, 0, 0.072, 0.080, 0.072)), col, vinylM, [0, 0, 0], alpha, 0, false)
  }

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.275, -0.06, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.275, -0.06, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.52 }
}

/** 9. role-invert — 反推 (Guardian Jade-Teal Head + Flipping Crystal & Gold-Sand Hourglass) */
function sculptInvert(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.96, 0.99, 0.98]
  const brassCol = [0.88, 0.74, 0.42]
  const sandCol = [1.0, 0.85, 0.29]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const crystalM = resolveFinish('crystal', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.06, 0.22, 0.18], primary, 0.15, 0.11)

  // Protective jade coat torso + rounded-square contemplative head
  renderer.add('softBox', mat4Mul(upper, localTRS(-0.02, -0.155 - ex * 0.05, 0, 0, 0, 0, 0.40, 0.21, 0.30)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('softBox', mat4Mul(upper, localTRS(-0.03, 0.10 + ex * 0.09, 0, 0, 0, 0, 0.44, 0.41, 0.36)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Jade hood rim accent
  renderer.add('pillBox', mat4Mul(upper, localTRS(-0.03, 0.10 + ex * 0.09, -0.03, 0, 0, 0, 0.48, 0.45, 0.32)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)

  // Worried thoughtful angled brows + vigilant eyes + wavy mouth
  drawEyes(ctx, upper, 0.088, 0.105, 0.182, 0.064, 0.078, 0.034)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(-0.125, 0.178, 0.186 + ex * 0.16, 0, 0, 0.32, 0.095, 0.024, 0.024)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0.065, 0.178, 0.186 + ex * 0.16, 0, 0, -0.32, 0.095, 0.024, 0.024)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('pillBox', mat4Mul(upper, localTRS(-0.03, 0.002, 0.185 + ex * 0.16, 0, 0, 0.10, 0.105, 0.022, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Sculpted 3D Crystal Hourglass mounted on side brass gimbal (periodically flips 180 deg!)
  const flipPhase = (t * 0.55) % 2.0
  const flipAngle = flipPhase < 0.7 ? 0 : flipPhase < 1.1 ? ((flipPhase - 0.7) / 0.4) * Math.PI : Math.PI
  const hgRoot = mat4Mul(upper, localTRS(0.32 + ex * 0.24, 0.03, 0.06, 0, 0, flipAngle, 1, 1, 1))
  // Brass top/bottom plates + twin crystal bulbs + glowing golden sand cones
  renderer.add('cyl', mat4Mul(hgRoot, localTRS(0, 0.155, 0, 0, 0, 0, 0.165, 0.026, 0.165)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  renderer.add('cyl', mat4Mul(hgRoot, localTRS(0, -0.155, 0, 0, 0, 0, 0.165, 0.026, 0.165)), brassCol, brassM, [0, 0, 0], alpha, 0, false)
  renderer.add('cone', mat4Mul(hgRoot, localTRS(0, 0.072, 0, Math.PI, 0, 0, 0.135, 0.145, 0.135)), [0.85, 0.98, 0.96], crystalM, [0.10, 0.45, 0.42], dimmed ? alpha : 0.74, 0, false)
  renderer.add('cone', mat4Mul(hgRoot, localTRS(0, -0.072, 0, 0, 0, 0, 0.135, 0.145, 0.135)), [0.85, 0.98, 0.96], crystalM, [0.10, 0.45, 0.42], dimmed ? alpha : 0.74, 0, false)
  renderer.add('cone', mat4Mul(hgRoot, localTRS(0, 0.055, 0, Math.PI, 0, 0, 0.088, 0.085, 0.088)), sandCol, MAT.EMISSIVE, [1.2, 0.92, 0.18], alpha, 0, false)
  renderer.add('cone', mat4Mul(hgRoot, localTRS(0, -0.095, 0, 0, 0, 0, 0.098, 0.075, 0.098)), sandCol, MAT.EMISSIVE, [1.2, 0.92, 0.18], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.285, -0.06, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.295, -0.08, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.42 }
}

/** 10. role-sentry — 哨兵 (Domed Tactical Helmet + Glowing Sweeping Mint Radar Visor + Antenna Beacon) */
function sculptSentry(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const helmetWhite = [0.94, 0.96, 0.99]
  const mintGlow = [0.49, 0.94, 0.77]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const darkM = resolveFinish('titanium', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: darkM, soleMat: MAT.TITANIUM }, root, secondary, [0.08, 0.11, 0.18], primary, 0.155, 0.12)

  // Armored dark-navy torso chassis
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.15 - ex * 0.05, 0, 0, 0, 0, 0.42, 0.22, 0.30)), secondary, darkM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('bevelBox', mat4Mul(upper, localTRS(0, -0.14 - ex * 0.05, 0.155, 0, 0, 0, 0.24, 0.11, 0.03)), primary, vinylM, [0, 0, 0], alpha, 0, false)

  // Iconic Domed Tactical Sentry Helmet
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.13 + ex * 0.10, 0, 0, 0, 0, 0.48, 0.44, 0.44)), helmetWhite, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('cyl', mat4Mul(upper, localTRS(0, 0.03 + ex * 0.07, 0, 0, 0, 0, 0.46, 0.20, 0.42)), helmetWhite, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)

  // Deep Recessed Obsidian Wrap-Around Radar Visor
  const vz = 0.188 + ex * 0.15
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, 0.085 + ex * 0.09, vz, 0, 0, 0, 0.36, 0.145, 0.10)), [0.04, 0.06, 0.10], MAT.OBSIDIAN, [0, 0, 0], alpha, dimmed ? 0 : pose.eyeMode, false)
  // Animated Sweeping Mint-Emerald Radar Scanner Bar + Target Blip!
  if (!dimmed) {
    const sweepX = Math.sin(t * 2.8) * 0.115
    renderer.add('bevelBox', mat4Mul(upper, localTRS(sweepX, 0.085 + ex * 0.09, vz + 0.052, 0, 0, 0, 0.034, 0.105, 0.018)), mintGlow, MAT.EMISSIVE, [0.45, 2.35, 1.55], 0.95, 0, false)
    const blipOn = Math.sin(t * 5.6) > 0.2 ? 1.0 : 0.25
    renderer.add('sphere', mat4Mul(upper, localTRS(0.085, 0.10 + ex * 0.09, vz + 0.055, 0, 0, 0, 0.032, 0.032, 0.02)), mintGlow, MAT.EMISSIVE, [0.55 * blipOn, 2.5 * blipOn, 1.7 * blipOn], 0.95, 0, false)
  }

  // Slender Metallic Antenna Mast + Blinking Crimson Alert Beacon Tip
  const antY = 0.42 + ex * 0.26
  renderer.add('cyl', mat4Mul(upper, localTRS(0, antY - 0.03, 0, 0, 0, 0, 0.026, 0.14, 0.026)), primary, MAT.ALUMINUM, [0, 0, 0], alpha, 0, false)
  const tipPulse = 0.45 + 0.55 * Math.abs(Math.sin(t * 4.2))
  renderer.add('sphere', mat4Mul(upper, localTRS(0, antY + 0.055, 0, 0, 0, 0, 0.072, 0.072, 0.072)), [1.0, 0.35, 0.32], MAT.EMISSIVE, [2.8 * tipPulse, 0.32 * tipPulse, 0.26 * tipPulse], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: darkM }
  drawGlovedHand(gCtx, upper, -1, 0.285, -0.07, pose.armLX, pose.armLZ, helmetWhite, secondary, darkM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.285, -0.07, pose.armRX, pose.armRZ, helmetWhite, secondary, darkM)
  return { rightPivot, topY: 0.52 }
}

/** 11. role-spring — 抗摔 (Anti-Fragile Cube Head with Band-Aid + Helical Metallic Spring Torso) */
function sculptSpring(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const white = [0.97, 0.96, 0.995]
  const bandAid = [1.0, 0.85, 0.69]
  const bandPad = [0.95, 0.72, 0.54]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const metalM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  // Weighted amethyst spring saucer connected seamlessly via sturdy purple ankle struts to boots at y = 0
  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.16, 0.09, 0.28], secondary, 0.145, 0.16)
  renderer.add('cyl', mat4Mul(root, localTRS(0, 0.235 + pose.bobY * 0.25, 0, 0, 0, 0, 0.40, 0.055, 0.36)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)

  // Squash & stretch spring bounce!
  const sq = Math.sin(t * 4.4)
  const springStretch = 1.0 + sq * 0.14
  const headY = 0.20 + sq * 0.032 + ex * 0.14
  const headM = mat4Mul(upper, localTRS(0, headY, 0, 0, 0, 0, 1 - sq * 0.035, 1 + sq * 0.035, 1 - sq * 0.035))

  // 5-coil 3D Helical Metallic Spring connecting baseplate to cube head
  const coilCount = 5
  for (let i = 0; i < coilCount; i++) {
    const f = i / (coilCount - 1)
    const cy = -0.23 + f * 0.26 * springStretch - ex * (1 - f) * 0.08
    renderer.add(
      'torus',
      mat4Mul(upper, localTRS(0, cy, 0, 0.16, i * 0.6, 0.08, 0.22, 0.22, 0.22)),
      [0.86, 0.84, 0.90],
      metalM,
      [0, 0, 0],
      alpha,
      0,
      !dimmed,
    )
  }

  // Deadpan-humorous chamfered cube head
  renderer.add('bevelBox', mat4Mul(headM, localTRS(0, 0.02, 0, 0, 0, 0, 0.42, 0.40, 0.38)), white, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  // Amethyst rear cap trim
  renderer.add('bevelBox', mat4Mul(headM, localTRS(0, 0.02, -0.05, 0, 0, 0, 0.44, 0.42, 0.32)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)

  // Iconic Diagonal Band-Aid on upper-right forehead corner (>=0.018m proud of cube head front 0.190)
  const baM = mat4Mul(headM, localTRS(0.115, 0.155, 0.200 + ex * 0.14, 0, 0, -0.58, 1, 1, 1))
  renderer.add('pillBox', mat4Mul(baM, localTRS(0, 0, 0, 0, 0, 0, 0.16, 0.062, 0.018)), bandAid, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(baM, localTRS(0, 0, 0.006, 0, 0, 0, 0.048, 0.058, 0.018)), bandPad, vinylM, [0, 0, 0], alpha, 0, false)

  // Quizzical raised eyebrow + crisp glossy obsidian eyes with catchlights + dry-humor smirk
  drawEyes(ctx, headM, 0.092, 0.028, 0.200, 0.066, 0.072, 0.042, 'pillBox')
  renderer.add('bevelBox', mat4Mul(headM, localTRS(-0.095, 0.110, 0.202 + ex * 0.15, 0, 0, 0.24, 0.090, 0.024, 0.024)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('bevelBox', mat4Mul(headM, localTRS(0.095, 0.102, 0.202 + ex * 0.15, 0, 0, 0, 0.084, 0.024, 0.024)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  renderer.add('pillBox', mat4Mul(headM, localTRS(0.01, -0.068, 0.200 + ex * 0.15, 0, 0, 0.16, 0.105, 0.024, 0.022)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, headM, -1, 0.28, -0.05, pose.armLX, pose.armLZ, white, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, headM, 1, 0.28, -0.05, pose.armRX, pose.armRZ, white, primary, vinylM)
  return { rightPivot, topY: 0.48 }
}

/** 12. role-compass — 灰度 (Warm Bronze Explorer + Counter-Rotating True-North Brass Compass Crown) */
function sculptCompass(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const cream = [0.98, 0.965, 0.935]
  const brassCol = [0.90, 0.72, 0.38]
  const coralNorth = [1.0, 0.42, 0.35]
  const vinylM = resolveFinish('vinyl', finishOverride)
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const brassM = resolveFinish('brass', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.24, 0.16, 0.08], primary, 0.15, 0.11)

  // Gentle body sway while compass needle stays locked True North!
  const sway = Math.sin(t * 2.1) * 0.11
  const swayed = mat4Mul(upper, mat4RotateZ(sway))

  // Warm sandstone-bronze explorer coat torso + cream pill head
  renderer.add('softBox', mat4Mul(swayed, localTRS(0, -0.155 - ex * 0.05, 0, 0, 0, 0, 0.40, 0.22, 0.30)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('pillBox', mat4Mul(swayed, localTRS(0, 0.09 + ex * 0.08, 0, 0, 0, 0, 0.44, 0.40, 0.36)), cream, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('pillBox', mat4Mul(swayed, localTRS(0, 0.09 + ex * 0.08, -0.04, 0, 0, 0, 0.47, 0.43, 0.32)), primary, vinylM, [0, 0, 0], bodyAlpha, 0, false)

  // Calm confident brows + warm smile
  drawEyes(ctx, swayed, 0.092, 0.105, 0.184, 0.062, 0.072, 0.032)
  for (const dir of [-1, 1]) {
    renderer.add('bevelBox', mat4Mul(swayed, localTRS(dir * 0.092, 0.170, 0.188 + ex * 0.15, 0, 0, 0, 0.084, 0.024, 0.022)), secondary, vinylM, [0, 0, 0], alpha, 0, false)
  }
  renderer.add('pillBox', mat4Mul(swayed, localTRS(0, 0.015, 0.186 + ex * 0.15, 0, 0, 0, 0.105, 0.022, 0.02)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)

  // Sculpted 3D Brushed-Brass Compass Crown with N/E/S/W Cardinal Ticks & Two-Tone Needle Inside Bezel!
  const cpY = 0.405 + ex * 0.26
  const richBrass = [0.88, 0.65, 0.24]
  const crimsonNorth = [0.90, 0.22, 0.20]
  const slateSouth = [0.33, 0.43, 0.49]
  const dialNavy = [0.10, 0.14, 0.22]
  // Brass gimbal stem + rich brushed-brass bezel ring + deep navy compass dial backing
  renderer.add('cyl', mat4Mul(swayed, localTRS(0, cpY - 0.115, 0, 0, 0, 0, 0.048, 0.075, 0.048)), richBrass, brassM, [0, 0, 0], alpha, 0, false)
  renderer.add('cyl', mat4Mul(swayed, localTRS(0, cpY, -0.010, Math.PI * 0.5, 0, 0, 0.255, 0.026, 0.255)), dialNavy, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)
  renderer.add('torus', mat4Mul(swayed, localTRS(0, cpY, 0, Math.PI * 0.5, 0, 0, 0.285, 0.285, 0.285)), richBrass, brassM, [0, 0, 0], alpha, 0, !dimmed)
  // 4 N/E/S/W Cardinal brass ticks along the bezel rim
  const ticks = [
    [0, 0.132, 0.024, 0.044],
    [0, -0.132, 0.024, 0.044],
    [0.132, 0, 0.044, 0.024],
    [-0.132, 0, 0.044, 0.024],
  ]
  for (const [tx, ty, tw, th] of ticks) {
    renderer.add('bevelBox', mat4Mul(swayed, localTRS(tx, cpY + ty, 0.018, 0, 0, 0, tw, th, 0.024)), richBrass, brassM, [0, 0, 0], alpha, 0, false)
  }
  // Counter-rotating magnetic needle assembly cleanly INSIDE the brass bezel (-sway keeps North upright!)
  const needleM = mat4Mul(swayed, localTRS(0, cpY, 0.016, 0, 0, -sway, 1, 1, 1))
  renderer.add('cone', mat4Mul(needleM, localTRS(0, 0.056, 0, 0, 0, 0, 0.050, 0.108, 0.032)), crimsonNorth, ceramicM, [0.35, 0.06, 0.05], alpha, 0, false)
  renderer.add('cone', mat4Mul(needleM, localTRS(0, -0.056, 0, Math.PI, 0, 0, 0.050, 0.108, 0.032)), slateSouth, MAT.ALUMINUM, [0, 0, 0], alpha, 0, false)
  renderer.add('sphere', mat4Mul(needleM, localTRS(0, 0, 0.008, 0, 0, 0, 0.046, 0.046, 0.046)), richBrass, brassM, [0, 0, 0], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, swayed, -1, 0.29, -0.06, pose.armLX, pose.armLZ, cream, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, swayed, 1, 0.29, -0.06, pose.armRX, pose.armRZ, cream, primary, vinylM)
  return { rightPivot, topY: 0.56 }
}

/** 13. role-loop — 复盘 (Radiant Coral-Ivory Sphere + Orbiting Retro-Loop Arrow Halo + Beating Heart) */
function sculptLoop(ctx, root, upper) {
  const { renderer, pose, t, ex, alpha, dimmed, primary, secondary, finishOverride } = ctx
  const ivory = [1.0, 0.975, 0.96]
  const blush = [1.0, 0.76, 0.69]
  const heartRed = [1.0, 0.36, 0.34]
  const ceramicM = resolveFinish('ceramic', finishOverride)
  const vinylM = resolveFinish('vinyl', finishOverride)
  const crystalM = resolveFinish('crystal', finishOverride)
  const bodyAlpha = finishOverride === 'crystal' && !dimmed ? 0.84 : alpha

  drawGroundedBoots({ ...ctx, bootMat: vinylM, soleMat: MAT.TITANIUM }, root, secondary, [0.32, 0.10, 0.09], primary, 0.145, 0.11)

  // Warm vermilion collar torso + radiant ivory-coral spherical head
  renderer.add('softBox', mat4Mul(upper, localTRS(0, -0.155 - ex * 0.05, 0, 0, 0, 0, 0.38, 0.20, 0.28)), secondary, vinylM, [0, 0, 0], bodyAlpha, 0, !dimmed)
  renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.08 + ex * 0.08, 0, 0, 0, 0, 0.45, 0.45, 0.44)), ivory, ceramicM, [0, 0, 0], bodyAlpha, 0, !dimmed)

  // Bright friendly eyes + big warm smile + peach blush cheeks
  drawEyes(ctx, upper, 0.086, 0.10, 0.218, 0.060, 0.072, 0.032, 'sphere')
  renderer.add('pillBox', mat4Mul(upper, localTRS(0, 0.012, 0.218 + ex * 0.15, 0, 0, 0, 0.118, 0.048, 0.022)), secondary, MAT.OBSIDIAN, [0, 0, 0], alpha, 0, false)
  for (const dir of [-1, 1]) {
    renderer.add('sphere', mat4Mul(upper, localTRS(dir * 0.135, 0.038, 0.202 + ex * 0.14, 0, 0, 0, 0.048, 0.036, 0.022)), blush, ceramicM, [0, 0, 0], alpha, 0, false)
  }

  // Tilted, smoothly rotating 3D Retro-Loop Halo Ring + Directional Arrowhead!
  const loopM = mat4Mul(upper, localTRS(0, 0.09 + ex * 0.10, 0, 0.34, t * 1.8, -0.26, 1, 1, 1))
  const rLoop = 0.64 + ex * 0.18
  renderer.add('thinTorus', mat4Mul(loopM, localTRS(0, 0, 0, 0, 0, 0, rLoop, rLoop, rLoop)), primary, crystalM, [1.05, 0.44, 0.30], dimmed ? alpha : 0.86, 0, false)
  // Directional cone arrowhead riding on the halo ring
  renderer.add('cone', mat4Mul(loopM, localTRS(rLoop * 0.5, 0, 0, Math.PI * 0.5, 0, 0, 0.085, 0.14, 0.085)), ivory, ceramicM, [0.45, 0.22, 0.18], alpha, 0, false)

  // Beating 3D Sculpted Heart Emblem floating upper-left
  const beat = 1.0 + Math.pow(Math.max(0, Math.sin(t * 2.6)), 6) * 0.28
  const hRoot = mat4Mul(upper, localTRS(-0.27 - ex * 0.22, 0.35 + ex * 0.22, 0.06, 0, 0.22, 0.14, beat, beat, beat))
  renderer.add('sphere', mat4Mul(hRoot, localTRS(-0.034, 0.024, 0, 0, 0, 0, 0.072, 0.072, 0.064)), heartRed, MAT.EMISSIVE, [1.8, 0.35, 0.32], alpha, 0, false)
  renderer.add('sphere', mat4Mul(hRoot, localTRS(0.034, 0.024, 0, 0, 0, 0, 0.072, 0.072, 0.064)), heartRed, MAT.EMISSIVE, [1.8, 0.35, 0.32], alpha, 0, false)
  renderer.add('cone', mat4Mul(hRoot, localTRS(0, -0.028, 0, Math.PI, 0, 0, 0.115, 0.095, 0.068)), heartRed, MAT.EMISSIVE, [1.8, 0.35, 0.32], alpha, 0, false)

  const gCtx = { ...ctx, bodyMat: ceramicM }
  drawGlovedHand(gCtx, upper, -1, 0.275, -0.06, pose.armLX, pose.armLZ, ivory, primary, vinylM)
  const rightPivot = drawGlovedHand(gCtx, upper, 1, 0.275, -0.06, pose.armRX, pose.armRZ, ivory, primary, vinylM)
  return { rightPivot, topY: 0.45 }
}

const SCULPTORS = {
  'role-gong': sculptGong,
  'role-hammock': sculptHammock,
  'role-braces': sculptBraces,
  'role-focus': sculptFocus,
  'role-steps': sculptSteps,
  'role-blank': sculptBlank,
  'role-no': sculptNo,
  'role-abacus': sculptAbacus,
  'role-invert': sculptInvert,
  'role-sentry': sculptSentry,
  'role-spring': sculptSpring,
  'role-compass': sculptCompass,
  'role-loop': sculptLoop,
}

/**
 * Unified entry point to render any of the 13 built-in Gonggong Role / Persona figurines.
 */
export function drawRoleFigurine(renderer, roleKey, opts = {}) {
  const key = normalizeRoleKey(roleKey)
  const meta = ROLE_META_MAP.get(key) || ROLE_FIGURINE_META[0]

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
    time = 0,
    phase = 0,
    explode = 0,
    dimmed = false,
    selected = false,
    hovered = false,
    lod = 'high',
    finishOverride = null,
  } = opts

  const action = normalizeAction(rawAction)
  const t = time + phase
  const primary = dimmed ? [0.68, 0.69, 0.71] : hexToRGB(tintHex || meta.primaryHex)
  const secondary = dimmed ? [0.46, 0.48, 0.52] : hexToRGB(meta.secondaryHex)
  const alpha = dimmed ? 0.26 : 1.0
  const ex = Math.max(0, Math.min(1, explode || 0))

  // Grounded contact shadow disc beneath boots
  if (ex < 0.05) {
    const shScale = 1.08 * scale
    renderer.add('plane', TRS(x, baseY + 0.011, z, 0, shScale, 1, shScale * 0.92), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], dimmed ? 0.14 : 0.34, 0, false)
  }

  // Owner floor halo ring + selection/hover highlight
  if (ownerRingColor && ex < 0.05) {
    const ringR = (isMe ? 0.84 : 0.74) * scale
    renderer.add(
      'thinTorus',
      TRS(x, baseY + 0.018, z, 0, ringR, 0.55 * scale, ringR),
      dimmed ? [0.6, 0.6, 0.6] : [0.95, 0.95, 0.95],
      dimmed ? MAT.ALUMINUM : MAT.EMISSIVE,
      dimmed ? [0, 0, 0] : ownerRingColor,
      alpha,
      0,
      false,
    )
  }
  if ((selected || hovered) && !dimmed && ex < 0.05) {
    const pulse = 1.0 + Math.sin(time * 4.6) * 0.055
    const selR = (selected ? 1.04 : 0.94) * scale * pulse
    const selEm = selected ? [0.35, 1.85, 3.2] : [0.9, 1.35, 1.9]
    renderer.add('thinTorus', TRS(x, baseY + 0.028, z, 0, selR, 0.50 * scale, selR), [1, 1, 1], MAT.EMISSIVE, selEm, selected ? 0.96 : 0.65, 0, false)
    if (selected) {
      const wave = (time * 0.72) % 1.0
      const outerR = (1.14 + wave * 0.40) * scale
      renderer.add('thinTorus', TRS(x, baseY + 0.024, z, 0, outerR, 0.42 * scale, outerR), [0.85, 0.96, 1.0], MAT.EMISSIVE, [0.45, 2.05, 3.4], (1.0 - wave) * 0.82, 0, false)
      renderer.add('plane', TRS(x, baseY + 0.015, z, 0, 1.70 * scale, 1, 1.70 * scale), [1, 1, 1], MAT.GLOW_POOL, [0.25, 1.35, 2.65], 0.46, 0, false)
    }
  }

  const pose = computePose(action, t)
  const root = mat4Mul(
    mat4Translate(x + pose.jitterX, baseY + pose.sitY, z + pose.jitterZ),
    mat4Mul(mat4RotateY(ry), mat4Scale(scale, scale, scale)),
  )
  const upperBase = mat4Mul(root, mat4Translate(0, 0.50 + pose.bobY + ex * 0.10, 0))
  const upper = mat4Mul(
    upperBase,
    mat4Mul(mat4RotateY(pose.torsoYaw), mat4Mul(mat4RotateZ(pose.torsoRoll), mat4RotateX(pose.torsoPitch))),
  )

  // Fast low-LOD silhouette for distant macro campus view
  if (lod === 'low') {
    const lowMat = resolveFinish('vinyl', finishOverride)
    renderer.add('fastBox', mat4Mul(upper, localTRS(0, 0.05, 0, 0, 0, 0, 0.46, 0.48, 0.36)), primary, lowMat, [0, 0, 0], alpha, 0, !dimmed)
    renderer.add('fastBox', mat4Mul(root, localTRS(-0.14, 0.12, 0, 0, 0, 0, 0.14, 0.24, 0.16)), secondary, lowMat, [0, 0, 0], alpha, 0, false)
    renderer.add('fastBox', mat4Mul(root, localTRS(0.14, 0.12, 0, 0, 0, 0, 0.14, 0.24, 0.16)), secondary, lowMat, [0, 0, 0], alpha, 0, false)
    if (!dimmed) {
      if (action === 'approval_raise') {
        const bp = 0.72 + 0.28 * Math.sin(t * 6.0)
        renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.62, 0, 0, 0, 0, 0.22, 0.22, 0.22)), [1, 0.82, 0.25], MAT.EMISSIVE, [3.4 * bp, 1.65 * bp, 0.12], 0.96, 0, false)
      } else if (action === 'question_ask') {
        const qBob = Math.abs(Math.sin(t * 3.8)) * 0.12
        renderer.add('sphere', mat4Mul(upper, localTRS(0, 0.62 + qBob, 0, 0, 0, 0, 0.24, 0.24, 0.24)), [0.82, 0.62, 1.0], MAT.EMISSIVE, [1.75, 0.65, 3.25], 0.96, 0, false)
      } else if (action === 'error_spark' || action === 'auth_expired') {
        renderer.add('octa', mat4Mul(upper, localTRS(0, 0.64, 0, 0, 0, 0, 0.28, 0.28, 0.28)), [1, 0.25, 0.2], MAT.EMISSIVE, [3.5, 0.25, 0.2], 1, 0, false)
      }
    }
    return
  }

  const ctx = {
    renderer,
    pose,
    action,
    t,
    time,
    scale,
    x,
    z,
    baseY,
    ex,
    alpha,
    dimmed,
    primary,
    secondary,
    finishOverride,
  }

  const sculpt = SCULPTORS[key] || sculptGong
  const { rightPivot, topY } = sculpt(ctx, root, upper)
  drawActionProps(ctx, upper, rightPivot, topY)
}

/**
 * Collects static high-detail mesh parts for GLB export of any of the 13 Role figurines.
 */
export function collectRoleParts(roleKey, finishOverride = null) {
  const parts = []
  const recorder = {
    add(meshName, model, color, matType, emissive = [0, 0, 0], alpha = 1.0, extra = 0.0) {
      if (matType === MAT.SHADOW_BLOB || matType === MAT.GLOW_POOL) return
      parts.push({ meshName, model, color, matType, emissive, alpha, extra })
    },
  }
  drawRoleFigurine(recorder, roleKey, {
    x: 0,
    z: 0,
    baseY: 0,
    ry: 0,
    scale: 1,
    action: 'idle',
    time: 0,
    phase: 0,
    explode: 0,
    lod: 'high',
    finishOverride,
  })
  return parts
}
