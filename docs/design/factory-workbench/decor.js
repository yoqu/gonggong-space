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
import { airAt } from './breeze.js?v=c1'

/**
 * Modular Photorealistic Office Decor, Multi-Species Botanicals & Architectural Finishes Library
 * Apple Park / Foster + Partners / Teenage Engineering Studio Diorama Aesthetic (Env Round 5 Final)
 */

const PAL = {
  oakWarm: [0.76, 0.58, 0.39],
  oakLight: [0.81, 0.65, 0.47],
  barkDark: [0.32, 0.22, 0.15],
  barkOlive: [0.54, 0.46, 0.37],
  soilDark: [0.13, 0.10, 0.07],
  travertine: [0.88, 0.84, 0.76],
  travertineWarm: [0.85, 0.80, 0.71],
  ceramicIvory: [0.94, 0.93, 0.89],
  ceramicTerra: [0.78, 0.48, 0.35],
  ceramicSage: [0.64, 0.72, 0.65],
  aluBright: [0.84, 0.86, 0.89],
  aluMid: [0.74, 0.76, 0.80],
  brassWarm: [0.78, 0.62, 0.36],
  titaniumDark: [0.18, 0.20, 0.24],
  charcoalSeat: [0.23, 0.25, 0.29],
  rugOat: [0.83, 0.79, 0.73],
  rugWorkshop: [0.84, 0.83, 0.80],
  sofaBoucle: [0.86, 0.84, 0.79],
  pillowSage: [0.46, 0.59, 0.49],
  pillowTerra: [0.79, 0.44, 0.32],
  pillowOchre: [0.84, 0.67, 0.30],
  // Rich deep-green Ficus & waxy tropical jade-emerald Monstera palette
  leafDeep: [0.14, 0.34, 0.18],
  leafForest: [0.18, 0.41, 0.22],
  leafOlive: [0.30, 0.55, 0.28],
  leafShoot: [0.46, 0.71, 0.36],
  leafMonsteraDark: [0.10, 0.30, 0.17],
  leafMonsteraMid: [0.14, 0.37, 0.21],
  leafMonsteraBright: [0.24, 0.52, 0.29],
  leafGrass: [0.28, 0.46, 0.25],
  leafGrassTip: [0.54, 0.58, 0.32],
  // Silvery-sage Mediterranean Olive palette
  oliveDeep: [0.26, 0.39, 0.26],
  oliveMid: [0.38, 0.50, 0.36],
  oliveSilver: [0.49, 0.59, 0.45],
  leafSnakeDark: [0.16, 0.38, 0.21],
  leafSnakeEdge: [0.42, 0.65, 0.31],
  leafIvy: [0.22, 0.49, 0.24],
}

function mix3(a, b, t) {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ]
}

function localTRS(root, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  let m = mat4Mul(root, mat4Translate(x, y, z))
  if (ry) m = mat4Mul(m, mat4RotateY(ry))
  if (rx) m = mat4Mul(m, mat4RotateX(rx))
  if (rz) m = mat4Mul(m, mat4RotateZ(rz))
  return mat4Mul(m, mat4Scale(sx, sy, sz))
}

function seededNoise(seed, idx) {
  const v = Math.sin(seed * 127.1 + idx * 311.7) * 43758.5453
  return v - Math.floor(v)
}

function drawPlanterUplights(renderer, root, soilY, nightBlend) {
  if (nightBlend <= 0.05) return
  const upEm = [2.4 * nightBlend, 1.55 * nightBlend, 0.60 * nightBlend]
  renderer.add('cyl', localTRS(root, 0.16, soilY + 0.015, 0.10, 0, 0.045, 0.016, 0.045), [1, 0.92, 0.72], MAT.EMISSIVE, upEm, 0.95, 0, false)
  renderer.add('cyl', localTRS(root, -0.15, soilY + 0.015, -0.11, 0, 0.045, 0.016, 0.045), [1, 0.92, 0.72], MAT.EMISSIVE, upEm, 0.95, 0, false)
  renderer.add('plane', localTRS(root, 0, soilY + 0.024, 0, 0, 0.56, 1, 0.56), [1, 1, 1], MAT.GLOW_POOL, upEm, 0.42 * nightBlend, 0, false)
}

/**
 * Draws a lush indoor architectural Ficus tree with 3-way forked trunk, 9 layered clusters,
 * 12 protruding fanned leaf blades, dark mulch soil bed & optional warm Night uplights.
 */
export function drawFicusTree(renderer, x, z, scale = 1.0, time = 0, seed = 0, baseY = 0, nightBlend = 0) {
  const s = scale
  const root = mat4Mul(mat4Translate(x, baseY, z), mat4Scale(s, s, s))

  // Grounded contact shadow (planter base + wider soft dappled canopy shade)
  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 1.18, 1, 1.18), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
  renderer.add('plane', localTRS(root, 0.14, 0.006, 0.10, 0, 2.05, 1, 1.92), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.21, 0, false)
  renderer.add('plane', localTRS(root, -0.18, 0.006, -0.12, 0, 1.45, 1, 1.38), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.14, 0, false)

  // Ribbed architectural planter pot + dark shadow plinth + rich dark mulch soil disc
  const useCeramic = Math.floor(Math.abs(seed)) % 3 === 2
  const potCol = useCeramic ? PAL.ceramicIvory : PAL.travertine
  const potMat = useCeramic ? MAT.CERAMIC : MAT.TRAVERTINE
  renderer.add('cyl', localTRS(root, 0, 0.025, 0, 0, 0.46, 0.05, 0.46), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('ribbedPot', localTRS(root, 0, 0.26, 0, seed * 0.7, 0.62, 0.46, 0.62), potCol, potMat)
  renderer.add('cyl', localTRS(root, 0, 0.47, 0, 0, 0.55, 0.045, 0.55), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  drawPlanterUplights(renderer, root, 0.49, nightBlend)

  // Main trunk + 3-way forked upper limbs + secondary twigs
  const air = airAt(x, z, time)
  const swayX = air.x + Math.sin(time * 0.9 + seed * 1.9) * 0.004
  const swayZ = air.z
  renderer.add('cyl', localTRS(root, 0, 0.78, 0, seed * 0.5, 0.095, 0.66, 0.095, 0.04, -0.05), PAL.barkDark, MAT.OAK_WOOD)
  const limbs = [
    { dx: -0.12, dy: 1.12, dz: 0.07, rx: 0.26, rz: 0.42, len: 0.50, r: 0.054 },
    { dx: 0.13, dy: 1.16, dz: -0.06, rx: -0.24, rz: -0.38, len: 0.54, r: 0.054 },
    { dx: 0.02, dy: 1.24, dz: -0.10, rx: -0.36, rz: 0.12, len: 0.46, r: 0.048 },
    { dx: -0.22, dy: 1.32, dz: 0.16, rx: 0.34, rz: 0.55, len: 0.30, r: 0.032 },
    { dx: 0.24, dy: 1.38, dz: -0.14, rx: -0.30, rz: -0.50, len: 0.32, r: 0.032 },
    { dx: 0.05, dy: 1.44, dz: 0.14, rx: 0.40, rz: -0.18, len: 0.28, r: 0.030 },
  ]
  for (const b of limbs) {
    renderer.add('cyl', localTRS(root, b.dx, b.dy, b.dz, 0, b.r, b.len, b.r, b.rx, b.rz), PAL.barkDark, MAT.OAK_WOOD)
  }

  // 9 rich layered foliage clusters
  const clusters = [
    { x: 0.00, y: 1.46, z: 0.00, sx: 0.64, sy: 0.46, sz: 0.60, col: PAL.leafForest },
    { x: -0.29, y: 1.28, z: 0.17, sx: 0.50, sy: 0.36, sz: 0.48, col: PAL.leafDeep },
    { x: 0.31, y: 1.32, z: -0.15, sx: 0.52, sy: 0.38, sz: 0.46, col: PAL.leafForest },
    { x: 0.17, y: 1.56, z: 0.22, sx: 0.44, sy: 0.34, sz: 0.42, col: PAL.leafOlive },
    { x: -0.23, y: 1.58, z: -0.18, sx: 0.46, sy: 0.36, sz: 0.44, col: PAL.leafOlive },
    { x: 0.04, y: 1.75, z: -0.04, sx: 0.42, sy: 0.32, sz: 0.40, col: PAL.leafShoot },
    { x: -0.10, y: 1.18, z: -0.26, sx: 0.40, sy: 0.30, sz: 0.38, col: PAL.leafDeep },
    { x: 0.26, y: 1.18, z: 0.20, sx: 0.38, sy: 0.28, sz: 0.36, col: PAL.leafDeep },
    { x: -0.34, y: 1.43, z: -0.02, sx: 0.36, sy: 0.28, sz: 0.34, col: PAL.leafOlive },
  ]
  clusters.forEach((c, idx) => {
    const jx = (seededNoise(seed, idx * 3) - 0.5) * 0.08
    const jz = (seededNoise(seed, idx * 3 + 1) - 0.5) * 0.08
    const lift = (c.y - 1.1) * 1.6
    const cx = c.x + jx + swayX * lift + air.flutter * 0.05 * Math.sin(idx * 1.7)
    const cz = c.z + jz + swayZ * lift
    renderer.add(
      'foliageCluster',
      localTRS(root, cx, c.y, cz, seed + idx * 0.9, c.sx, c.sy, c.sz),
      c.col,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + idx * 0.37,
      idx < 4,
    )
  })

  // 12 protruding fanned botanical leafBlade sprigs
  for (let i = 0; i < 12; i++) {
    const tier = i < 7 ? 0 : 1
    const ang = seed * 1.3 + (i / (tier === 0 ? 7 : 5)) * Math.PI * 2 + tier * 0.48
    const rad = tier === 0 ? 0.30 : 0.18
    const ly = tier === 0 ? 1.30 + (i % 3) * 0.12 : 1.66 + (i % 2) * 0.10
    const lSway = air.flutter * Math.sin(seed + i * 1.3) + air.gust * 0.05
    const lScale = tier === 0 ? 0.54 + (i % 2) * 0.10 : 0.46
    const col = tier === 1 ? PAL.leafShoot : i % 2 === 0 ? PAL.leafOlive : PAL.leafForest
    renderer.add(
      'leafBlade',
      localTRS(
        root,
        Math.cos(ang) * rad + swayX,
        ly,
        Math.sin(ang) * rad + swayZ,
        ang,
        lScale,
        lScale,
        lScale,
        (tier === 1 ? -0.45 : -0.18) + lSway,
        0,
      ),
      col,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + i * 0.41,
      false,
    )
  }
}

/**
 * Draws a lush tropical Monstera Deliciosa planter (Env R3 species diversity):
 * - Ribbed terracotta or travertine planter + dark mulch soil + warm Night uplights
 * - 10 sweeping arched petioles with broad tropical fan leaves (`broadLeaf`)
 */
export function drawMonsteraPlanter(renderer, x, z, scale = 1.0, time = 0, seed = 0, baseY = 0, nightBlend = 0) {
  const s = scale
  const root = mat4Mul(mat4Translate(x, baseY, z), mat4Scale(s, s, s))
  const air = airAt(x, z, time)

  // Grounded shadow
  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 1.32, 1, 1.32), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
  renderer.add('plane', localTRS(root, 0.08, 0.006, 0.06, 0, 1.78, 1, 1.72), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.18, 0, false)

  // Ribbed terracotta or warm stone pot + sculpted lip rim + dark mulch soil + Night uplights
  const useTerra = Math.floor(Math.abs(seed * 3)) % 2 === 0
  const potCol = useTerra ? PAL.ceramicTerra : PAL.travertineWarm
  const potMat = useTerra ? MAT.CERAMIC : MAT.TRAVERTINE
  renderer.add('cyl', localTRS(root, 0, 0.025, 0, 0, 0.50, 0.05, 0.50), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('ribbedPot', localTRS(root, 0, 0.24, 0, seed * 0.5, 0.68, 0.42, 0.68), potCol, potMat)
  renderer.add('torus', localTRS(root, 0, 0.445, 0, 0, 0.68, 0.42, 0.68), potCol, potMat, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0, 0.435, 0, 0, 0.60, 0.045, 0.60), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  drawPlanterUplights(renderer, root, 0.46, nightBlend)

  // 10 sweeping tropical Monstera stems + waxy jade-emerald fan leaves in 2 lush tiers
  const fronds = 10
  for (let i = 0; i < fronds; i++) {
    const upper = i >= 6
    const idxInTier = upper ? i - 6 : i
    const countInTier = upper ? 4 : 6
    const ang = seed * 1.7 + (idxInTier / countInTier) * Math.PI * 2 + (upper ? 0.52 : 0.1)
    const breeze = air.flutter * Math.cos(i * 1.4) + air.gust * 0.06 * Math.cos(ang)
    const stemLen = upper ? 0.62 + (i % 2) * 0.10 : 0.44 + (i % 3) * 0.08
    const stemTilt = upper ? 0.30 : 0.58
    const cx = Math.sin(ang) * stemLen * Math.sin(stemTilt)
    const cz = Math.cos(ang) * stemLen * Math.sin(stemTilt)
    const topY = 0.44 + stemLen * Math.cos(stemTilt)

    // Visible curved dark-green petiole stem
    renderer.add(
      'cyl',
      localTRS(root, cx * 0.48, 0.44 + (topY - 0.44) * 0.5, cz * 0.48, ang, 0.036, stemLen, 0.036, stemTilt, 0),
      PAL.leafMonsteraDark,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + i,
      false,
    )
    // Waxy tropical jade-emerald broad fan leaf
    const lScale = upper ? 0.70 + (i % 2) * 0.14 : 0.84 + (i % 3) * 0.10
    const col = upper ? PAL.leafMonsteraBright : i % 2 === 0 ? PAL.leafMonsteraMid : PAL.leafMonsteraDark
    renderer.add(
      'broadLeaf',
      localTRS(root, cx * 0.94, topY, cz * 0.94, ang, lScale, lScale, lScale, (upper ? -0.22 : 0.22) + breeze, 0),
      col,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + i * 0.55,
      i < 4,
    )
  }
}

/**
 * Draws a sleek matte-black architectural path bollard light (0.42m tall)
 * with warm 2700K recessed cap glow + soft downward terrazzo light pool in Night Mode.
 */
export function drawPathBollard(renderer, x, z, nightBlend = 0, goldenBlend = 0) {
  const root = mat4Translate(x, 0, z)
  const glowStr = 0.25 + goldenBlend * 0.45 + nightBlend * 1.95
  const warmEm = [2.85 * glowStr, 1.76 * glowStr, 0.64 * glowStr]

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 0.36, 1, 0.36), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.32, 0, false)
  // Matte-black cylindrical post + flanged base
  renderer.add('cyl', localTRS(root, 0, 0.014, 0, 0, 0.14, 0.024, 0.14), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0, 0.18, 0, 0, 0.092, 0.32, 0.092), PAL.titaniumDark, MAT.TITANIUM)
  // Warm 2700K recessed emitter louver band
  renderer.add('cyl', localTRS(root, 0, 0.365, 0, 0, 0.082, 0.065, 0.082), [1.0, 0.92, 0.72], MAT.EMISSIVE, warmEm, 0.96, 0, false)
  // Brushed brass accent ring + overhanging matte-black cap
  renderer.add('cyl', localTRS(root, 0, 0.332, 0, 0, 0.098, 0.014, 0.098), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0, 0.412, 0, 0, 0.118, 0.032, 0.118), PAL.titaniumDark, MAT.TITANIUM)

  // Soft downward warm 2700K terrazzo light-spill pool (boosted 1.5x so Night walkways shimmer!)
  if (nightBlend > 0.04 || goldenBlend > 0.2) {
    const poolEm = [3.2 * glowStr, 1.95 * glowStr, 0.72 * glowStr]
    const poolAlpha = Math.max(nightBlend * 0.78, goldenBlend * 0.14)
    renderer.add('plane', localTRS(root, 0, 0.012, 0, 0, 1.58, 1, 1.58), [1, 1, 1], MAT.GLOW_POOL, poolEm, poolAlpha, 0, false)
  }
}

/**
 * Draws a sleek minimalist Apple-Park Campus Wayfinding Stele / Monolith (0.95m tall):
 * - Brushed anodized aluminum chassis + warm vertical oak-slat side accent
 * - Matte dark-slate directory panel w/ clean engraved horizontal lines & zone color dots
 * - Warm 2700K Night base accent strip & soft terrazzo glow pool
 */
export function drawWayfindingStele(renderer, x, z, nightBlend = 0, goldenBlend = 0, rotY = 0) {
  const root = mat4Mul(mat4Translate(x, 0, z), mat4RotateY(rotY))
  const aluCol = mix3(PAL.aluBright, [0.42, 0.45, 0.52], nightBlend)
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.4)

  // Grounded contact shadow
  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 0.72, 1, 0.48), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)

  // Matte-black titanium anchor shoe
  renderer.add('bevelBox', localTRS(root, 0, 0.03, 0, 0, 0.48, 0.06, 0.18), PAL.titaniumDark, MAT.TITANIUM)
  // Brushed aluminum monolith chassis (0.95m tall) + warm oak-slat vertical accent bar on left edge
  renderer.add('bevelBox', localTRS(root, 0, 0.50, 0, 0, 0.44, 0.90, 0.09), aluCol, MAT.ALUMINUM)
  renderer.add('bevelBox', localTRS(root, -0.175, 0.50, 0, 0, 0.08, 0.84, 0.098), oakCol, MAT.WOOD_SLAT)
  // Matte dark-slate directory inset faces (front & back)
  renderer.add('sharpBox', localTRS(root, 0.035, 0.54, 0.046, 0, 0.30, 0.68, 0.008), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 0.035, 0.54, -0.046, 0, 0.30, 0.68, 0.008), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)

  // Clean engraved horizontal directory lines & zone indicator dots (Lounge emerald, Workshops sky, Courtyard amber)
  const rows = [
    { y: 0.74, dot: [0.22, 1.55, 0.85], w: 0.17 },
    { y: 0.60, dot: [0.18, 1.25, 2.35], w: 0.19 },
    { y: 0.46, dot: [2.25, 1.45, 0.32], w: 0.15 },
    { y: 0.34, dot: [0.75, 0.82, 0.92], w: 0.13 },
  ]
  for (const side of [1, -1]) {
    const fz = side * 0.052
    for (const r of rows) {
      renderer.add('sphere', localTRS(root, -0.075, r.y, fz, 0, 0.024, 0.024, 0.012), [1, 1, 1], MAT.EMISSIVE, r.dot, 0.95, 0, false)
      renderer.add('sharpBox', localTRS(root, 0.045, r.y, fz, 0, r.w, 0.014, 0.006), [0.88, 0.90, 0.94], MAT.CERAMIC, [0.10, 0.12, 0.15], 1, 0, false)
    }
  }

  // Warm 2700K recessed Night base accent strip + soft terrazzo glow pool
  const glowStr = 0.25 + goldenBlend * 0.35 + nightBlend * 1.85
  const baseEm = [2.65 * glowStr, 1.70 * glowStr, 0.62 * glowStr]
  renderer.add('sharpBox', localTRS(root, 0, 0.068, 0.055, 0, 0.40, 0.014, 0.012), [1, 0.92, 0.74], MAT.EMISSIVE, baseEm, 0.96, 0, false)
  renderer.add('sharpBox', localTRS(root, 0, 0.068, -0.055, 0, 0.40, 0.014, 0.012), [1, 0.92, 0.74], MAT.EMISSIVE, baseEm, 0.96, 0, false)
  if (nightBlend > 0.04) {
    renderer.add('plane', localTRS(root, 0, 0.012, 0, 0, 1.25, 1, 0.95), [1, 1, 1], MAT.GLOW_POOL, baseEm, 0.56 * nightBlend, 0, false)
  }
}

/**
 * Draws an Apple-Park Courtyard Pocket Garden Island (~2.7m x 2.3m):
 * - Harmonized pale warm architectural travertine plinth (#dcd4c6) with slim brass perimeter trim
 * - Multi-stem Mediterranean Olive tree in recessed dark mulch bed w/ Night uplights & dappled shade
 * - Integrated warm slatted-oak courtyard bench + ornamental sedge grass + Night step-light glow
 */
export function drawPocketGardenIsland(renderer, x, z, time = 0, nightBlend = 0, goldenBlend = 0) {
  const root = mat4Translate(x, 0, z)
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.4)
  // Refined pale warm architectural travertine matching espresso bar & troughs!
  const travCol = mix3([0.87, 0.84, 0.78], [0.44, 0.43, 0.41], nightBlend * 0.62)

  // Soft widened ambient ground contact shadow
  renderer.add('plane', localTRS(root, 0, 0.006, 0, 0, 3.45, 1, 2.95), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)

  // Recessed titanium reveal base + pale warm travertine plinth + 4 SLIM brushed-brass perimeter trim strips
  renderer.add('sharpBox', localTRS(root, 0, 0.024, 0, 0, 2.52, 0.048, 2.12), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, 0, 0.095, 0, 0, 2.70, 0.11, 2.30), travCol, MAT.TRAVERTINE)
  // Slim perimeter brass edge inlay (leaves pale warm travertine top fully visible!)
  renderer.add('sharpBox', localTRS(root, 0, 0.151, -1.12, 0, 2.66, 0.006, 0.032), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 0, 0.151, 1.12, 0, 2.66, 0.006, 0.032), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, -1.32, 0.151, 0, 0, 0.032, 0.006, 2.26), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 1.32, 0.151, 0, 0, 0.032, 0.006, 2.26), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)

  // Recessed dark organic mulch garden bed (north-left portion of plinth)
  renderer.add('bevelBox', localTRS(root, -0.35, 0.158, -0.22, 0, 1.56, 0.036, 1.44), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)

  // Sculptural multi-stem Mediterranean Olive tree rising from garden bed
  drawOliveTree(renderer, x - 0.38, z - 0.24, 1.06, time, 5.4, 0.14, nightBlend)

  // Low ornamental grass / sedge border tufts & smooth architectural river stones
  const grassSpots = [
    [-0.95, -0.75], [-0.95, -0.22], [-0.95, 0.32],
    [-0.35, -0.78], [0.24, -0.75], [0.28, -0.20],
  ]
  grassSpots.forEach(([gx, gz], idx) => {
    const a = airAt(x + gx, z + gz, time)
    const breeze = a.flutter * Math.sin(idx * 2.3) + a.gust * 0.07
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2 + idx * 0.7
      renderer.add(
        'leafBlade',
        localTRS(root, gx, 0.17, gz, a, 0.18, 0.42, 0.42, -0.88 + breeze, 0),
        b % 2 === 0 ? PAL.leafGrass : PAL.leafGrassTip,
        MAT.LEAF_RICH,
        [0, 0, 0],
        1,
        idx + b * 0.3,
        false,
      )
    }
  })
  renderer.add('sphere', localTRS(root, 0.14, 0.19, 0.24, 0.4, 0.26, 0.12, 0.20), [0.64, 0.62, 0.59], MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  renderer.add('sphere', localTRS(root, -0.78, 0.185, 0.26, -0.3, 0.20, 0.10, 0.16), [0.74, 0.72, 0.68], MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)

  // Integrated Warm Slatted-Oak Courtyard Bench along South-East edge of plinth
  const bRoot = mat4Mul(root, mat4Translate(0.28, 0.15, 0.76))
  renderer.add('bevelBox', localTRS(bRoot, -0.58, 0.10, 0, 0, 0.05, 0.20, 0.38), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', localTRS(bRoot, 0.58, 0.10, 0, 0, 0.05, 0.20, 0.38), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', localTRS(bRoot, 0, 0.21, 0, 0, 1.56, 0.065, 0.46), oakCol, MAT.WOOD_SLAT)

  // Boosted 1.5x recessed warm 2700K step-light glow around plinth in Night Mode
  if (nightBlend > 0.05) {
    const stepEm = [2.95 * nightBlend, 1.85 * nightBlend, 0.68 * nightBlend]
    renderer.add('sharpBox', localTRS(root, 0, 0.048, 1.11, 0, 2.38, 0.018, 0.018), [1, 0.92, 0.72], MAT.EMISSIVE, stepEm, 0.96, 0, false)
    renderer.add('plane', localTRS(root, 0, 0.014, 1.32, 0, 3.15, 1, 1.15), [1, 1, 1], MAT.GLOW_POOL, stepEm, 0.54 * nightBlend, 0, false)
  } else if (goldenBlend > 0.15) {
    renderer.add('plane', localTRS(root, 0.22, 0.156, 0.18, 0, 1.6, 1, 1.2), [1, 1, 1], MAT.GLOW_POOL, [1.8, 1.2, 0.5], 0.12 * goldenBlend, 0, false)
  }
}

/**
 * Draws a sculptural Mediterranean Olive Tree (Env R3 species diversity):
 * - Clean matte ceramic/travertine planter + dark mulch soil + warm Night uplights
 * - Twisting 3-stem pale-warm olive bark trunk + airy forked branches
 * - Feathery silvery-olive canopy clusters + 14 delicate narrow leafBlade sprigs
 */
export function drawOliveTree(renderer, x, z, scale = 1.0, time = 0, seed = 0, baseY = 0, nightBlend = 0) {
  const s = scale
  const root = mat4Mul(mat4Translate(x, baseY, z), mat4Scale(s, s, s))

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 1.15, 1, 1.15), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.32, 0, false)
  renderer.add('plane', localTRS(root, 0.16, 0.006, 0.10, 0, 2.15, 1, 2.02), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.19, 0, false)
  renderer.add('plane', localTRS(root, -0.20, 0.006, -0.14, 0, 1.50, 1, 1.42), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.13, 0, false)

  // Architectural matte-ivory ceramic cylinder planter + dark mulch soil + Night uplights
  renderer.add('cyl', localTRS(root, 0, 0.025, 0, 0, 0.44, 0.05, 0.44), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('ribbedPot', localTRS(root, 0, 0.27, 0, seed * 0.4, 0.58, 0.48, 0.58), PAL.ceramicIvory, MAT.CERAMIC)
  renderer.add('cyl', localTRS(root, 0, 0.495, 0, 0, 0.50, 0.04, 0.50), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  drawPlanterUplights(renderer, root, 0.515, nightBlend)

  const air = airAt(x, z, time)
  const swayX = air.x * 1.2
  const swayZ = air.z * 1.2

  // Twisting 3-stem Mediterranean pale-warm trunk + airy reaching limbs
  const stems = [
    { x: -0.04, y: 0.86, z: 0.02, rx: 0.12, rz: 0.18, len: 0.76, r: 0.062 },
    { x: 0.05, y: 0.90, z: -0.03, rx: -0.14, rz: -0.16, len: 0.82, r: 0.058 },
    { x: 0.00, y: 0.82, z: -0.05, rx: -0.18, rz: 0.08, len: 0.68, r: 0.048 },
    // Airy forked upper branches
    { x: -0.24, y: 1.38, z: 0.14, rx: 0.30, rz: 0.48, len: 0.56, r: 0.034 },
    { x: 0.25, y: 1.44, z: -0.14, rx: -0.28, rz: -0.44, len: 0.60, r: 0.034 },
    { x: 0.04, y: 1.54, z: 0.16, rx: 0.34, rz: -0.12, len: 0.48, r: 0.030 },
    { x: -0.12, y: 1.52, z: -0.22, rx: -0.36, rz: 0.22, len: 0.50, r: 0.030 },
  ]
  for (const b of stems) {
    renderer.add('cyl', localTRS(root, b.x, b.y, b.z, seed * 0.3, b.r, b.len, b.r, b.rx, b.rz), PAL.barkOlive, MAT.OAK_WOOD)
  }

  // Airy, open silvery-olive canopy puffs (smaller & more spaced out than dense Ficus!)
  const puffs = [
    { x: -0.36, y: 1.58, z: 0.22, sx: 0.44, sy: 0.26, sz: 0.40, col: PAL.oliveMid },
    { x: 0.38, y: 1.66, z: -0.22, sx: 0.46, sy: 0.26, sz: 0.42, col: PAL.oliveSilver },
    { x: 0.10, y: 1.82, z: 0.24, sx: 0.40, sy: 0.24, sz: 0.38, col: PAL.oliveSilver },
    { x: -0.18, y: 1.78, z: -0.30, sx: 0.42, sy: 0.25, sz: 0.40, col: PAL.oliveDeep },
    { x: 0.02, y: 1.98, z: -0.02, sx: 0.44, sy: 0.26, sz: 0.42, col: PAL.oliveSilver },
    { x: -0.24, y: 1.44, z: -0.16, sx: 0.34, sy: 0.22, sz: 0.34, col: PAL.oliveDeep },
    { x: 0.26, y: 1.46, z: 0.18, sx: 0.36, sy: 0.22, sz: 0.34, col: PAL.oliveMid },
  ]
  puffs.forEach((c, idx) => {
    const lift = (c.y - 1.2) * 1.5
    renderer.add(
      'foliageCluster',
      localTRS(root, c.x + swayX * lift + air.flutter * 0.04 * Math.sin(idx * 2.1), c.y, c.z + swayZ * lift, seed + idx * 1.1, c.sx, c.sy, c.sz),
      c.col,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + idx * 0.5,
      idx < 3,
    )
  })

  // 14 feathery narrow silvery-olive sprigs
  for (let i = 0; i < 14; i++) {
    const ang = seed * 1.1 + (i / 14) * Math.PI * 2
    const rad = 0.22 + (i % 3) * 0.14
    const ly = 1.48 + (i % 4) * 0.14
    const lSway = air.flutter * 1.3 * Math.sin(seed + i * 0.9) + air.gust * 0.06
    const col = i % 3 === 0 ? PAL.oliveSilver : i % 3 === 1 ? PAL.oliveMid : PAL.oliveDeep
    renderer.add(
      'leafBlade',
      localTRS(root, Math.cos(ang) * rad + swayX, ly, Math.sin(ang) * rad + swayZ, ang, 0.30, 0.46, 0.46, -0.28 + lSway, 0),
      col,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      seed + i * 0.3,
      false,
    )
  }
}

/**
 * Draws an architectural stone planter trough with Snake Plant blades, fern fronds & cascading ivy.
 */
export function drawPlanterTrough(renderer, x, z, len = 2.4, rotY = 0, time = 0, baseY = 0) {
  const root = mat4Mul(mat4Translate(x, baseY, z), mat4RotateY(rotY))
  const w = Math.max(1.0, len)
  const d = 0.52
  const h = 0.42

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, w + 0.58, 1, d + 0.54), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
  renderer.add('sharpBox', localTRS(root, 0, 0.03, 0, 0, w - 0.08, 0.06, d - 0.08), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, 0, h * 0.5 + 0.04, 0, 0, w, h, d), PAL.travertineWarm, MAT.TRAVERTINE)
  renderer.add('bevelBox', localTRS(root, 0, h + 0.045, 0, 0, w + 0.03, 0.028, d + 0.03), PAL.aluMid, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 0, h + 0.04, 0, 0, w - 0.09, 0.03, d - 0.09), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)

  const pebbleN = Math.max(5, Math.floor(w * 2.8))
  for (let p = 0; p < pebbleN; p++) {
    const px = -w * 0.43 + (p / Math.max(1, pebbleN - 1)) * w * 0.86
    const pz = (seededNoise(x + z, p) - 0.5) * 0.24
    const pCol = p % 2 === 0 ? [0.76, 0.74, 0.70] : [0.54, 0.53, 0.50]
    renderer.add('sphere', localTRS(root, px, h + 0.062, pz, 0, 0.11, 0.045, 0.085), pCol, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  }

  const clumpN = Math.max(3, Math.round(w * 1.7))
  for (let c = 0; c < clumpN; c++) {
    const cx = -w * 0.40 + (c / Math.max(1, clumpN - 1)) * w * 0.80
    const a = airAt(x + cx, z, time)
    const breeze = a.flutter * Math.sin(c * 1.9) + a.gust * 0.05

    renderer.add(
      'foliageCluster',
      localTRS(root, cx, h + 0.17, 0, c * 1.2, 0.40, 0.25, 0.36),
      c % 2 === 0 ? PAL.leafDeep : PAL.leafForest,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      c * 0.7,
      false,
    )

    for (let s = 0; s < 3; s++) {
      const syaw = (s / 3) * Math.PI * 2 + c * 0.85
      const sxOff = (s - 1) * 0.055
      const szOff = ((s + c) % 2 === 0 ? 0.04 : -0.04)
      const sH = 0.62 + (s % 2) * 0.18 + (c % 2) * 0.08
      const sCol = s === 1 ? PAL.leafSnakeEdge : PAL.leafSnakeDark
      renderer.add(
        'leafBlade',
        localTRS(root, cx + sxOff, h + 0.08, szOff, syaw, 0.34, sH, sH, -1.24 + breeze * 0.6, 0),
        sCol,
        MAT.LEAF_RICH,
        [0, 0, 0],
        1,
        c + s * 0.5,
        false,
      )
    }

    for (let f = 0; f < 4; f++) {
      const yaw = (f / 4) * Math.PI * 2 + c * 0.55 + 0.3
      const pitch = -0.28 - (f % 2) * 0.22 + breeze
      const fScale = 0.54 + (f % 2) * 0.14
      const col = f % 3 === 0 ? PAL.leafShoot : f % 3 === 1 ? PAL.leafOlive : PAL.leafForest
      renderer.add(
        'leafBlade',
        localTRS(root, cx, h + 0.12, 0, yaw, fScale, fScale, fScale, pitch, 0),
        col,
        MAT.LEAF_RICH,
        [0, 0, 0],
        1,
        c + f * 0.4,
        false,
      )
    }

    const ivySide = c % 2 === 0 ? 1 : -1
    const ivyYaw = ivySide > 0 ? 0 : Math.PI
    renderer.add(
      'leafBlade',
      localTRS(root, cx + 0.06, h + 0.05, ivySide * (d * 0.46), ivyYaw + 0.18, 0.38, 0.38, 0.44, 0.72 + breeze * 0.5, 0),
      PAL.leafIvy,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      c * 1.3,
      false,
    )
    renderer.add(
      'leafBlade',
      localTRS(root, cx - 0.08, h + 0.03, ivySide * (d * 0.48), ivyYaw - 0.22, 0.32, 0.32, 0.38, 0.92 + breeze * 0.4, 0),
      PAL.leafOlive,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      c * 1.7,
      false,
    )
  }
}

/**
 * Draws a cute tiny ceramic pot + succulent / fern rosette for desks and tables.
 */
export function drawDeskPlant(renderer, x, y, z, scale = 1.0, time = 0) {
  const s = scale
  const root = mat4Mul(mat4Translate(x, y, z), mat4Scale(s, s, s))
  renderer.add('ribbedPot', localTRS(root, 0, 0.055, 0, 0.4, 0.115, 0.11, 0.115), PAL.ceramicTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0, 0.108, 0, 0, 0.095, 0.014, 0.095), PAL.soilDark, MAT.TRAVERTINE, [0, 0, 0], 1, 0, false)
  const air = airAt(x, z, time)
  const sway = air.flutter * 0.5 + air.gust * 0.025
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.2
    renderer.add(
      'leafBlade',
      localTRS(root, 0, 0.112, 0, ang, 0.16, 0.16, 0.16, -0.32 + sway, 0),
      i % 2 === 0 ? PAL.leafForest : PAL.leafOlive,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      i * 0.5,
      false,
    )
  }
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + 0.55
    renderer.add(
      'leafBlade',
      localTRS(root, 0, 0.122, 0, ang, 0.11, 0.12, 0.11, -0.68 + sway, 0),
      PAL.leafShoot,
      MAT.LEAF_RICH,
      [0, 0, 0],
      1,
      i * 0.9,
      false,
    )
  }
}

/**
 * Draws an upgraded ergonomic studio workstation desk (Env R3 upgrade):
 * - Warm oak desktop + brushed aluminum frame + 3-drawer rolling pedestal
 * - Ultrawide live `MAT.CODE_SCREEN` monitor + articulated matte-aluminum/brass task lamp w/ 3000K warm pool
 * - Seeded desk micro-life: either sculpted studio headphones OR angled portrait secondary code monitor!
 * - Ergonomic task chair at `chairZ = 0.84` (zero bot clipping)
 */
export function drawErgonomicDesk(renderer, x, z, rotY = 0, opts = {}) {
  const {
    statusColor = [0.14, 1.22, 2.25],
    ctxPercent = 25,
    time = 0,
    nightBlend = 0,
    liftY = 0,
    roundTable = false,
    seed = 0,
  } = opts

  const root = mat4Mul(mat4Translate(x, liftY, z), mat4RotateY(rotY))
  const aluCol = mix3(PAL.aluBright, [0.36, 0.38, 0.44], nightBlend)
  const legCol = mix3(PAL.aluMid, [0.26, 0.28, 0.34], nightBlend)
  const oakCol = mix3(PAL.oakLight, [0.54, 0.41, 0.28], nightBlend * 0.42)

  if (roundTable) {
    renderer.add('plane', localTRS(root, 0, 0.044, 0, 0, 1.72, 1, 1.72), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
    renderer.add('cyl', localTRS(root, 0, 0.07, 0, 0, 0.62, 0.035, 0.62), legCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0, 0.25, 0, 0, 0.14, 0.40, 0.14), PAL.titaniumDark, MAT.TITANIUM)
    renderer.add('cyl', localTRS(root, 0, 0.46, 0, 0, 1.22, 0.052, 1.22), oakCol, MAT.OAK_WOOD)
    renderer.add('cyl', localTRS(root, 0, 0.488, 0, 0, 0.44, 0.016, 0.44), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0, 0.498, 0, 0, 0.36, 0.012, 0.36), [1, 1, 1], MAT.EMISSIVE, statusColor, 0.95, 0, false)
    renderer.add('plane', localTRS(root, 0, 0.490, 0, 0, 0.92, 1, 0.92), [1, 1, 1], MAT.GLOW_POOL, statusColor, 0.32 + nightBlend * 0.22, 0, false)
    renderer.add('cyl', localTRS(root, -0.34, 0.525, 0.24, 0, 0.075, 0.08, 0.075), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0.36, 0.525, -0.22, 0, 0.075, 0.08, 0.075), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    drawDeskPlant(renderer, x + Math.cos(rotY) * 0.02, liftY + 0.486, z - Math.sin(rotY) * 0.02 - 0.38, 0.82, time)
    return
  }

  // Widened grounded contact shadow under desk, pedestal & chair
  renderer.add('plane', localTRS(root, 0, 0.044, 0.04, 0, 1.78, 1, 1.15), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
  renderer.add('plane', localTRS(root, 0, 0.044, 0.82, 0, 0.82, 1, 0.82), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.26, 0, false)

  // Warm oak beveled desktop + brushed aluminum T-legs + crossbar
  renderer.add('bevelBox', localTRS(root, 0, 0.46, 0, 0, 1.24, 0.048, 0.62), oakCol, MAT.OAK_WOOD)
  for (const sx of [-0.52, 0.52]) {
    renderer.add('bevelBox', localTRS(root, sx, 0.24, -0.02, 0, 0.055, 0.43, 0.055), legCol, MAT.ALUMINUM)
    renderer.add('bevelBox', localTRS(root, sx, 0.055, 0.0, 0, 0.06, 0.032, 0.50), legCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }
  renderer.add('sharpBox', localTRS(root, 0, 0.38, -0.18, 0, 1.02, 0.055, 0.04), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)

  // Matte Under-Desk Rolling 3-Drawer File Pedestal
  const pedCol = mix3([0.30, 0.32, 0.36], [0.18, 0.20, 0.24], nightBlend)
  renderer.add('bevelBox', localTRS(root, 0.33, 0.23, -0.03, 0, 0.28, 0.34, 0.40), pedCol, MAT.TITANIUM)
  for (const dy of [0.14, 0.235, 0.33]) {
    renderer.add('sharpBox', localTRS(root, 0.33, dy, 0.174, 0, 0.12, 0.014, 0.012), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }

  // Dark wool desk mat + mechanical keyboard + wireless mouse
  renderer.add('slab', localTRS(root, -0.05, 0.486, 0.08, 0, 0.68, 0.008, 0.28), [0.20, 0.22, 0.25], MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, -0.11, 0.498, 0.09, 0, 0.38, 0.018, 0.135), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, -0.11, 0.509, 0.09, 0, 0.35, 0.008, 0.105), [0.82, 0.84, 0.87], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('pillBox', localTRS(root, 0.18, 0.500, 0.10, -0.08, 0.065, 0.024, 0.105), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)

  // Slim ultrawide aluminum-backed Studio Display + live scrolling MAT.CODE_SCREEN
  renderer.add('bevelBox', localTRS(root, -0.04, 0.492, -0.19, 0, 0.22, 0.016, 0.14), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, -0.04, 0.57, -0.20, 0, 0.08, 0.16, 0.024), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, -0.04, 0.70, -0.175, 0, 0.66, 0.31, 0.024), aluCol, MAT.ALUMINUM)
  renderer.add('sharpBox', localTRS(root, -0.04, 0.70, -0.164, 0, 0.635, 0.285, 0.010), [0.06, 0.07, 0.09], MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, -0.04, 0.70, -0.156, 0, 0.60, 0.255, 0.008), [1, 1, 1], MAT.CODE_SCREEN, statusColor, 1, seed + x * 0.37, false)

  // Compact horizontal context-usage LED bar on monitor base
  const ctxRatio = Math.max(0.12, Math.min(1.0, (ctxPercent || 10) / 100))
  const ctxEm = ctxPercent > 75 ? [2.3, 1.15, 0.1] : [0.12, 1.45, 2.35]
  renderer.add('sharpBox', localTRS(root, -0.04, 0.502, -0.125, 0, 0.18 * ctxRatio, 0.010, 0.014), [1, 1, 1], MAT.EMISSIVE, ctxEm, 1, 0, false)

  // Soft monitor light-spill glow pool on desk
  renderer.add('plane', localTRS(root, -0.04, 0.491, 0.04, 0, 0.86, 1, 0.48), [1, 1, 1], MAT.GLOW_POOL, statusColor, 0.34 + nightBlend * 0.32, 0, false)

  // Seeded Desk Micro-Life Variation: Portrait Secondary Monitor vs Studio Over-Ear Headphones!
  const deskVar = Math.abs(Math.round(seed * 7 + x * 3 + z * 5)) % 2
  if (deskVar === 0) {
    // Angled slim portrait secondary code/docs monitor on left side of desk
    const smRoot = mat4Mul(root, mat4Mul(mat4Translate(-0.46, 0, -0.14), mat4RotateY(0.32)))
    renderer.add('cyl', localTRS(smRoot, 0, 0.56, -0.02, 0, 0.026, 0.15, 0.026), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('bevelBox', localTRS(smRoot, 0, 0.72, 0, 0, 0.20, 0.32, 0.020), aluCol, MAT.ALUMINUM)
    renderer.add('sharpBox', localTRS(smRoot, 0, 0.72, 0.012, 0, 0.175, 0.29, 0.008), [1, 1, 1], MAT.CODE_SCREEN, statusColor, 1, seed + 4.2, false)
  } else {
    // Sculpted over-ear studio headphones resting on left oak surface + cute desk succulent behind
    const hpRoot = mat4Mul(root, mat4Mul(mat4Translate(-0.47, 0.498, 0.11), mat4RotateY(0.45)))
    renderer.add('thinTorus', localTRS(hpRoot, 0, 0.018, 0, 0, 0.15, 0.15, 0.15), aluCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('pillBox', localTRS(hpRoot, -0.06, 0.024, 0.04, 0.2, 0.055, 0.045, 0.072), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('pillBox', localTRS(hpRoot, 0.06, 0.024, 0.04, -0.2, 0.055, 0.045, 0.072), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)

    const plantOffX = -0.49
    const plantOffZ = -0.16
    const cR = Math.cos(rotY)
    const sR = Math.sin(rotY)
    drawDeskPlant(renderer, x + plantOffX * cR + plantOffZ * sR, liftY + 0.484, z - plantOffX * sR + plantOffZ * cR, 0.88, time)
  }

  // Articulated Matte-Aluminum Architectural Task Lamp on back-right corner
  const lampBaseX = 0.48
  const lampBaseZ = -0.18
  const lampBoost = 0.82 + nightBlend * 1.35
  const warmLampEm = [2.75 * lampBoost, 1.76 * lampBoost, 0.66 * lampBoost]
  renderer.add('cyl', localTRS(root, lampBaseX, 0.494, lampBaseZ, 0, 0.13, 0.022, 0.13), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, lampBaseX + 0.02, 0.61, lampBaseZ - 0.02, 0, 0.018, 0.24, 0.018, -0.18, -0.16), aluCol, MAT.ALUMINUM)
  renderer.add('sphere', localTRS(root, lampBaseX + 0.04, 0.72, lampBaseZ - 0.04, 0, 0.036, 0.036, 0.036), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, lampBaseX - 0.04, 0.78, lampBaseZ + 0.04, 0, 0.016, 0.22, 0.016, 0.68, 0.56), aluCol, MAT.ALUMINUM)
  const shadeX = lampBaseX - 0.12
  const shadeY = 0.81
  const shadeZ = lampBaseZ + 0.12
  renderer.add('cone', localTRS(root, shadeX, shadeY, shadeZ, 0, 0.145, 0.095, 0.145, 0.24, 0.22), aluCol, MAT.ALUMINUM)
  renderer.add('sphere', localTRS(root, shadeX - 0.01, shadeY - 0.038, shadeZ + 0.01, 0, 0.072, 0.048, 0.072), [1.0, 0.92, 0.72], MAT.EMISSIVE, warmLampEm, 0.98, 0, false)
  renderer.add('plane', localTRS(root, shadeX - 0.02, 0.492, shadeZ + 0.04, 0, 0.74, 1, 0.60), [1, 1, 1], MAT.GLOW_POOL, warmLampEm, 0.24 + nightBlend * 0.56, 0, false)

  // Coffee cup + notebook
  renderer.add('cyl', localTRS(root, 0.37, 0.525, 0.14, 0, 0.075, 0.082, 0.075), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0.37, 0.562, 0.14, 0, 0.058, 0.012, 0.058), [0.22, 0.12, 0.06], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, 0.40, 0.494, -0.01, 0.16, 0.15, 0.016, 0.19), [0.92, 0.90, 0.85], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 0.40, 0.503, -0.01, 0.16, 0.018, 0.004, 0.195), PAL.pillowTerra, MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)

  // Ergonomic Task Chair (`chairZ = 0.84` — zero clipping!)
  const chairZ = 0.84
  const chairYaw = 0.07 * Math.sin(seed * 3.1 + 1.0)
  const chairRoot = mat4Mul(root, mat4Mul(mat4Translate(0, 0, chairZ), mat4RotateY(chairYaw)))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    renderer.add('bevelBox', localTRS(chairRoot, Math.cos(a) * 0.12, 0.055, Math.sin(a) * 0.12, -a, 0.24, 0.022, 0.028), legCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }
  renderer.add('cyl', localTRS(chairRoot, 0, 0.13, 0, 0, 0.045, 0.15, 0.045), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('pillBox', localTRS(chairRoot, 0, 0.21, -0.04, 0, 0.44, 0.065, 0.40), PAL.charcoalSeat, MAT.FABRIC_RUG)
  renderer.add('bevelBox', localTRS(chairRoot, 0, 0.34, 0.18, 0, 0.055, 0.28, 0.032, -0.14, 0), legCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('pillBox', localTRS(chairRoot, 0, 0.46, 0.20, 0, 0.42, 0.32, 0.055, -0.10, 0), PAL.charcoalSeat, MAT.FABRIC_RUG)
}

/**
 * Draws a low warm-oak architectural studio credenza / bookshelf stocked with
 * vertical hardcover books, matte ceramic vase w/ foliage sprig, and a brushed-aluminum studio speaker.
 */
function drawLoungeCredenza(renderer, x, z, rotY, nightBlend, time) {
  const root = mat4Mul(mat4Translate(x, 0.044, z), mat4RotateY(rotY))
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.42)
  const aluCol = mix3(PAL.aluBright, [0.42, 0.45, 0.52], nightBlend)

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 1.78, 1, 0.68), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.32, 0, false)
  for (const lx of [-0.66, 0.66]) {
    for (const lz of [-0.14, 0.14]) {
      renderer.add('cyl', localTRS(root, lx, 0.06, lz, 0, 0.035, 0.12, 0.035), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    }
  }
  renderer.add('bevelBox', localTRS(root, 0, 0.13, 0, 0, 1.52, 0.04, 0.40), oakCol, MAT.OAK_WOOD)
  renderer.add('bevelBox', localTRS(root, 0, 0.54, 0, 0, 1.54, 0.042, 0.42), oakCol, MAT.OAK_WOOD)
  renderer.add('bevelBox', localTRS(root, -0.74, 0.335, 0, 0, 0.04, 0.38, 0.40), oakCol, MAT.OAK_WOOD)
  renderer.add('bevelBox', localTRS(root, 0.74, 0.335, 0, 0, 0.04, 0.38, 0.40), oakCol, MAT.OAK_WOOD)
  renderer.add('bevelBox', localTRS(root, 0.02, 0.335, 0, 0, 0.035, 0.38, 0.38), oakCol, MAT.OAK_WOOD)
  renderer.add('sharpBox', localTRS(root, 0, 0.335, -0.185, 0, 1.44, 0.38, 0.02), oakCol, MAT.WOOD_SLAT, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(root, -0.36, 0.335, 0.18, 0, 0.68, 0.34, 0.022), oakCol, MAT.WOOD_SLAT)

  const bookCols = [
    [0.78, 0.36, 0.28], [0.24, 0.42, 0.58], [0.86, 0.72, 0.34],
    [0.26, 0.50, 0.38], [0.90, 0.88, 0.83], [0.45, 0.36, 0.62],
  ]
  bookCols.forEach((col, i) => {
    const bx = 0.15 + i * 0.088
    const bh = 0.22 + (i % 3) * 0.035
    const tilt = i === bookCols.length - 1 ? -0.16 : 0
    renderer.add('bevelBox', localTRS(root, bx, 0.15 + bh * 0.5, 0.02, 0, 0.055, bh, 0.22, 0, tilt), col, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  })

  // Studio speaker + sage ceramic vase w/ foliage + warm sculptural lamp
  renderer.add('bevelBox', localTRS(root, -0.48, 0.68, 0.0, 0.12, 0.28, 0.24, 0.16), aluCol, MAT.ALUMINUM)
  renderer.add('cyl', localTRS(root, -0.48, 0.67, 0.082, 0.12, 0.13, 0.012, 0.13, Math.PI * 0.5, 0), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, -0.38, 0.74, 0.082, 0.12, 0.045, 0.014, 0.045, Math.PI * 0.5, 0), PAL.pillowTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)

  renderer.add('ribbedPot', localTRS(root, 0.34, 0.66, -0.02, 0.3, 0.14, 0.21, 0.14), PAL.ceramicSage, MAT.CERAMIC)
  const sway = Math.sin(time * 1.4 + x) * 0.04
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.5
    renderer.add('leafBlade', localTRS(root, 0.34, 0.76, -0.02, a, 0.24, 0.26, 0.24, -0.65 + sway, 0), i === 0 ? PAL.leafShoot : PAL.leafOlive, MAT.LEAF_RICH, [0, 0, 0], 1, i * 0.6, false)
  }

  const lampEm = [2.5 * (0.75 + nightBlend * 1.1), 1.60 * (0.75 + nightBlend * 1.1), 0.62 * (0.75 + nightBlend * 1.1)]
  renderer.add('cyl', localTRS(root, 0.58, 0.59, 0.02, 0, 0.09, 0.06, 0.09), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sphere', localTRS(root, 0.58, 0.68, 0.02, 0, 0.15, 0.14, 0.15), [1.0, 0.94, 0.80], MAT.EMISSIVE, lampEm, 0.95, 0, false)
  renderer.add('plane', localTRS(root, 0.52, 0.564, 0.02, 0, 0.68, 1, 0.44), [1, 1, 1], MAT.GLOW_POOL, lampEm, 0.20 + nightBlend * 0.48, 0, false)
}

/**
 * Draws a sculptural brushed-brass Arc Floor Lamp beside the left Lounge sofa
 * casting a warm 3000K light pool at Night.
 */
function drawLoungeArcLamp(renderer, x, z, nightBlend) {
  const root = mat4Translate(x, 0.044, z)
  const boost = 0.85 + nightBlend * 1.35
  const warmEm = [2.75 * boost, 1.78 * boost, 0.68 * boost]

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 0.62, 1, 0.62), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.30, 0, false)
  // Heavy travertine cylinder base
  renderer.add('cyl', localTRS(root, 0, 0.16, 0, 0, 0.28, 0.32, 0.28), PAL.travertine, MAT.TRAVERTINE)
  // Slender brushed-brass vertical pole + 2-segment graceful cantilever arc toward +X/+Z
  renderer.add('cyl', localTRS(root, 0, 0.82, 0, 0, 0.028, 1.05, 0.028), PAL.brassWarm, MAT.ALUMINUM)
  renderer.add('cyl', localTRS(root, 0.16, 1.46, 0.06, -0.35, 0.024, 0.46, 0.024, 0, -0.68), PAL.brassWarm, MAT.ALUMINUM)
  renderer.add('cyl', localTRS(root, 0.44, 1.56, 0.16, -0.35, 0.022, 0.34, 0.022, 0, -1.28), PAL.brassWarm, MAT.ALUMINUM)
  // Warm brushed-brass dome shade + 3000K Edison core + warm cone & floor spill pool
  const sx = 0.62, sy = 1.48, sz = 0.22
  renderer.add('cone', localTRS(root, sx, sy, sz, 0, 0.32, 0.15, 0.32), PAL.brassWarm, MAT.ALUMINUM)
  renderer.add('sphere', localTRS(root, sx, sy - 0.06, sz, 0, 0.11, 0.09, 0.11), [1.0, 0.93, 0.76], MAT.EMISSIVE, warmEm, 0.98, 0, false)
  renderer.add('cone', localTRS(root, sx, sy - 0.34, sz, 0, 0.68, 0.52, 0.68), [1.0, 0.88, 0.62], MAT.GLASS, [warmEm[0] * 0.45, warmEm[1] * 0.45, warmEm[2] * 0.45], 0.05 + nightBlend * 0.15, 0, false)
  renderer.add('plane', localTRS(root, sx, 0.016, sz, 0, 1.45, 1, 1.45), [1, 1, 1], MAT.GLOW_POOL, warmEm, 0.16 + nightBlend * 0.48, 0, false)
}

/**
 * Draws a minimalist framed Bauhaus / Foster+Partners architectural art print on an easel panel near the sliding door.
 */
function drawLoungeFramedPrint(renderer, x, z, rotY, nightBlend) {
  const root = mat4Mul(mat4Translate(x, 0.044, z), mat4RotateY(rotY))
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.4)

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 0.92, 1, 0.44), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.24, 0, false)
  // Slim matte-black studio easel stand
  renderer.add('bevelBox', localTRS(root, -0.34, 0.56, 0, 0, 0.032, 1.12, 0.032, -0.06, 0), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', localTRS(root, 0.34, 0.56, 0, 0, 0.032, 1.12, 0.032, -0.06, 0), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', localTRS(root, 0, 0.32, 0.02, 0, 0.78, 0.032, 0.05), PAL.titaniumDark, MAT.TITANIUM)
  // Warm oak gallery frame + crisp ivory mat board
  renderer.add('bevelBox', localTRS(root, 0, 0.78, 0.01, 0, 0.80, 0.88, 0.035, -0.06, 0), oakCol, MAT.OAK_WOOD)
  renderer.add('sharpBox', localTRS(root, 0, 0.78, 0.030, 0, 0.72, 0.80, 0.008, -0.06, 0), [0.95, 0.94, 0.90], MAT.CERAMIC, [0.04, 0.04, 0.04], 1, 0, false)
  // Minimalist geometric architectural composition (terracotta arch, slate circle, sage block)
  renderer.add('bevelBox', localTRS(root, -0.10, 0.72, 0.036, 0, 0.26, 0.42, 0.006, -0.06, 0), PAL.pillowTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(root, 0.14, 0.90, 0.036, 0, 0.22, 0.008, 0.22, Math.PI * 0.5 - 0.06, 0), [0.22, 0.28, 0.36], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', localTRS(root, 0.12, 0.58, 0.036, 0, 0.26, 0.14, 0.006, -0.06, 0), PAL.pillowSage, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
}

/**
 * Draws the upgraded photorealistic Living Lounge furniture & botanicals (Env R3 upgrade):
 * - Woven wool rug, 2 bouclé sofas, oak coffee table, oak credenza
 * - Sculptural brushed-brass Arc Floor Lamp + Framed Architectural Print
 * - Upgraded travertine/oak-slat espresso bar w/ overhead pendant gantry & warm Edison cones
 * - Multi-species botanical showcase: Ficus (NW), Olive Tree (NE), Monstera (SE) + Snake-Plant/ivy troughs
 */
export function drawLoungeFurniture(renderer, origin = [-8.6, 2.0], time = 0, nightBlend = 0, opts = {}) {
  const [cx, cz] = origin
  const activeSteam = opts.activeSteam !== false
  const aluCol = mix3(PAL.aluBright, [0.42, 0.45, 0.52], nightBlend)
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.4)
  const rugCol = mix3(PAL.rugOat, [0.34, 0.33, 0.31], nightBlend * 0.7)
  const sofaCol = mix3(PAL.sofaBoucle, [0.38, 0.38, 0.41], nightBlend * 0.65)
  const travCol = mix3(PAL.travertine, [0.46, 0.44, 0.41], nightBlend * 0.6)

  // 1. Woven Wool Area Rug + Warm Night Pavilion Ambient Floor Pool
  renderer.add('slab', TRS(cx - 0.15, 0.050, cz + 0.18, 0, 5.55, 0.014, 3.35), rugCol, MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)
  if (nightBlend > 0.05) {
    renderer.add('plane', TRS(cx - 0.15, 0.060, cz - 0.15, 0, 6.2, 1, 4.4), [1, 1, 1], MAT.GLOW_POOL, [1.85, 1.25, 0.56], 0.22 * nightBlend, 0, false)
  }

  // 2. Two Modular Cushioned Bouclé Sofas
  const sofas = [
    { x: cx - 1.60, z: cz - 0.94, p1: PAL.pillowTerra, p2: PAL.pillowSage },
    { x: cx + 1.40, z: cz - 0.94, p1: PAL.pillowOchre, p2: PAL.pillowSage },
  ]
  for (const s of sofas) {
    const sRoot = mat4Translate(s.x, 0.044, s.z)
    renderer.add('plane', localTRS(sRoot, 0, 0.008, 0.05, 0, 2.55, 1, 1.24), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.34, 0, false)
    for (const lx of [-0.90, 0.90]) {
      for (const lz of [-0.26, 0.24]) {
        renderer.add('cyl', localTRS(sRoot, lx, 0.05, lz, 0, 0.04, 0.10, 0.04), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
      }
    }
    renderer.add('bevelBox', localTRS(sRoot, 0, 0.11, -0.02, 0, 2.04, 0.06, 0.66), oakCol, MAT.OAK_WOOD)
    renderer.add('pillBox', localTRS(sRoot, -0.47, 0.19, 0.04, 0, 0.92, 0.13, 0.54), sofaCol, MAT.FABRIC_RUG)
    renderer.add('pillBox', localTRS(sRoot, 0.47, 0.19, 0.04, 0, 0.92, 0.13, 0.54), sofaCol, MAT.FABRIC_RUG)
    renderer.add('pillBox', localTRS(sRoot, 0, 0.38, -0.27, 0, 1.98, 0.34, 0.16, -0.10, 0), sofaCol, MAT.FABRIC_RUG)
    renderer.add('pillBox', localTRS(sRoot, -0.99, 0.28, -0.02, 0, 0.14, 0.24, 0.64), sofaCol, MAT.FABRIC_RUG)
    renderer.add('pillBox', localTRS(sRoot, 0.99, 0.28, -0.02, 0, 0.14, 0.24, 0.64), sofaCol, MAT.FABRIC_RUG)
    renderer.add('pillBox', localTRS(sRoot, -0.82, 0.34, -0.15, 0.35, 0.22, 0.22, 0.10, -0.18, 0.14), s.p1, MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)
    renderer.add('pillBox', localTRS(sRoot, 0.82, 0.34, -0.15, -0.32, 0.22, 0.22, 0.10, -0.16, -0.12), s.p2, MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)
  }

  // 3. Sculptural Brushed-Brass Arc Floor Lamp beside left sofa + Framed Architectural Print near sliding door
  drawLoungeArcLamp(renderer, cx - 2.86, cz - 1.15, nightBlend)
  drawLoungeFramedPrint(renderer, cx - 3.84, cz - 1.72, Math.PI * 0.5, nightBlend)

  // 4. Low Warm-Oak Coffee Table with Stacked Design Magazines, Ceramic Tray, 2 Demitasse Cups & Tiny Succulent
  const ctRoot = mat4Translate(cx - 1.55, 0.044, cz + 0.24)
  renderer.add('plane', localTRS(ctRoot, 0, 0.010, 0, 0, 1.58, 1, 0.98), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.30, 0, false)
  renderer.add('bevelBox', localTRS(ctRoot, 0, 0.24, 0, 0, 1.16, 0.045, 0.56), oakCol, MAT.OAK_WOOD)
  for (const lx of [-0.46, 0.46]) {
    for (const lz of [-0.20, 0.20]) {
      renderer.add('cyl', localTRS(ctRoot, lx, 0.115, lz, 0, 0.038, 0.22, 0.038), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    }
  }
  // Stacked architectural design magazines with crisp colored covers
  renderer.add('bevelBox', localTRS(ctRoot, -0.32, 0.274, 0.05, 0.12, 0.30, 0.022, 0.23), [0.22, 0.34, 0.48], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(ctRoot, -0.30, 0.296, 0.03, -0.08, 0.26, 0.020, 0.20), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('bevelBox', localTRS(ctRoot, -0.31, 0.315, 0.04, 0.04, 0.22, 0.016, 0.17), PAL.pillowTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  // Matte ivory ceramic serving tray with 2 demitasse espresso cups
  renderer.add('bevelBox', localTRS(ctRoot, 0.26, 0.272, 0.02, -0.05, 0.38, 0.016, 0.28), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(ctRoot, 0.18, 0.312, 0.05, 0, 0.068, 0.062, 0.068), PAL.ceramicTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(ctRoot, 0.18, 0.340, 0.05, 0, 0.052, 0.010, 0.052), [0.18, 0.09, 0.04], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(ctRoot, 0.34, 0.312, -0.03, 0, 0.068, 0.062, 0.068), PAL.ceramicSage, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', localTRS(ctRoot, 0.34, 0.340, -0.03, 0, 0.052, 0.010, 0.052), [0.18, 0.09, 0.04], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
  // Tiny tabletop ceramic succulent beside tray
  drawDeskPlant(renderer, cx - 1.55 - 0.02, 0.306, cz + 0.24 - 0.14, 0.62, time)

  // 5. Low Oak Media Credenza / Bookshelf along South-West Wall
  drawLoungeCredenza(renderer, cx - 3.68, cz + 2.25, Math.PI * 0.5, nightBlend, time)

  // 6. Upgraded Artisan Espresso Bar + Overhead Pendant Gantry & Warm Edison Cones
  const barX = cx - 0.55
  const barZ = cz - 2.85
  renderer.add('plane', TRS(barX, 0.048, barZ, 0, 4.75, 1, 1.48), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.36, 0, false)
  renderer.add('bevelBox', TRS(barX, 0.38, barZ, 0, 3.85, 0.68, 0.64), travCol, MAT.TRAVERTINE)
  renderer.add('sharpBox', TRS(barX, 0.38, barZ + 0.326, 0, 3.56, 0.56, 0.018), oakCol, MAT.WOOD_SLAT, [0, 0, 0], 1, 0, false)

  const barWarm = 0.85 + nightBlend * 1.35
  const barLed = [2.35 * barWarm, 1.44 * barWarm, 0.52 * barWarm]
  renderer.add('sharpBox', TRS(barX, 0.69, barZ + 0.338, 0, 3.52, 0.024, 0.020), [1, 0.90, 0.68], MAT.EMISSIVE, barLed, 1, 0, false)
  renderer.add('plane', TRS(barX, 0.052, barZ + 0.68, 0, 4.1, 1, 1.15), [1, 1, 1], MAT.GLOW_POOL, barLed, 0.16 + nightBlend * 0.44, 0, false)
  renderer.add('bevelBox', TRS(barX, 0.75, barZ, 0, 3.96, 0.065, 0.74), oakCol, MAT.OAK_WOOD)

  const espX = barX - 0.95
  renderer.add('bevelBox', TRS(espX, 0.97, barZ - 0.04, 0, 0.72, 0.38, 0.42), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', TRS(espX, 1.06, barZ + 0.14, 0, 0.58, 0.13, 0.14), aluCol, MAT.ALUMINUM)
  renderer.add('sharpBox', TRS(espX - 0.21, 1.11, barZ + 0.215, 0, 0.10, 0.024, 0.018), [1, 0.8, 0.3], MAT.EMISSIVE, [2.6, 1.35, 0.2], 1, 0, false)
  renderer.add('cyl', TRS(espX - 0.56, 0.92, barZ - 0.04, 0, 0.16, 0.28, 0.16), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('cone', TRS(espX - 0.56, 1.13, barZ - 0.04, 0, 0.18, 0.16, 0.18), [0.22, 0.16, 0.12], MAT.GLASS, [0, 0, 0], 0.45, 0, false)

  renderer.add('cyl', TRS(barX + 0.15, 0.845, barZ + 0.06, 0, 0.12, 0.12, 0.12), PAL.ceramicIvory, MAT.CERAMIC)
  renderer.add('cyl', TRS(barX + 0.31, 0.845, barZ - 0.02, 0, 0.12, 0.12, 0.12), PAL.ceramicIvory, MAT.CERAMIC)
  renderer.add('cyl', TRS(barX + 0.23, 0.96, barZ + 0.02, 0, 0.11, 0.11, 0.11), PAL.ceramicTerra, MAT.CERAMIC)

  // Glass pour-over coffee carafe + wooden collar on espresso bar counter
  const carX = barX + 0.58
  renderer.add('cyl', TRS(carX, 0.865, barZ + 0.04, 0, 0.145, 0.16, 0.145), [0.88, 0.94, 0.98], MAT.GLASS, [0.02, 0.03, 0.04], 0.38, 0, false)
  renderer.add('cyl', TRS(carX, 0.822, barZ + 0.04, 0, 0.115, 0.065, 0.115), [0.18, 0.09, 0.04], MAT.OBSIDIAN, [0, 0, 0], 1, 0, false)
  renderer.add('cyl', TRS(carX, 0.905, barZ + 0.04, 0, 0.092, 0.038, 0.092), oakCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)

  const domeX = barX + 1.10
  renderer.add('cyl', TRS(domeX, 0.80, barZ + 0.02, 0, 0.46, 0.032, 0.46), oakCol, MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  renderer.add('pillBox', TRS(domeX - 0.07, 0.85, barZ + 0.04, 0.4, 0.14, 0.065, 0.09), [0.80, 0.54, 0.24], MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  renderer.add('pillBox', TRS(domeX + 0.08, 0.85, barZ - 0.02, -0.3, 0.13, 0.06, 0.09), [0.76, 0.48, 0.22], MAT.OAK_WOOD, [0, 0, 0], 1, 0, false)
  renderer.add('sphere', TRS(domeX, 0.89, barZ + 0.02, 0, 0.42, 0.34, 0.42), [0.92, 0.96, 0.99], MAT.GLASS, [0.06, 0.06, 0.06], 0.32, 0, false)
  renderer.add('sphere', TRS(domeX, 1.07, barZ + 0.02, 0, 0.055, 0.055, 0.055), [0.92, 0.96, 0.99], MAT.GLASS, [0.06, 0.06, 0.06], 0.50, 0, false)

  // Overhead Pendant Gantry + 3 Visibly Suspended Brass Pendants
  const gantryY = 2.02
  renderer.add('cyl', TRS(barX - 1.82, gantryY * 0.5 + 0.38, barZ - 0.26, 0, 0.042, gantryY - 0.72, 0.042), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('cyl', TRS(barX + 1.82, gantryY * 0.5 + 0.38, barZ - 0.26, 0, 0.042, gantryY - 0.72, 0.042), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', TRS(barX, gantryY, barZ - 0.26, 0, 3.72, 0.045, 0.045), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', TRS(barX, gantryY, barZ + 0.04, 0, 3.68, 0.032, 0.032), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', TRS(barX - 1.82, gantryY, barZ - 0.11, 0, 0.036, 0.036, 0.34), PAL.titaniumDark, MAT.TITANIUM)
  renderer.add('bevelBox', TRS(barX + 1.82, gantryY, barZ - 0.11, 0, 0.036, 0.036, 0.34), PAL.titaniumDark, MAT.TITANIUM)

  const pendBoost = 0.85 + nightBlend * 1.25
  const pendEm = [2.75 * pendBoost, 1.76 * pendBoost, 0.68 * pendBoost]
  for (const px of [barX - 1.05, barX + 0.05, barX + 1.10]) {
    renderer.add('cyl', TRS(px, 1.84, barZ + 0.04, 0, 0.014, 0.34, 0.014), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cone', TRS(px, 1.62, barZ + 0.04, 0, 0.32, 0.15, 0.32), PAL.brassWarm, MAT.ALUMINUM)
    renderer.add('sphere', TRS(px, 1.54, barZ + 0.04, 0, 0.10, 0.09, 0.10), [1.0, 0.93, 0.76], MAT.EMISSIVE, pendEm, 0.98, 0, false)
    renderer.add('cone', TRS(px, 1.24, barZ + 0.04, 0, 0.68, 0.56, 0.68), [1.0, 0.88, 0.62], MAT.GLASS, [pendEm[0] * 0.45, pendEm[1] * 0.45, pendEm[2] * 0.45], 0.06 + nightBlend * 0.16, 0, false)
    renderer.add('plane', TRS(px, 0.788, barZ + 0.04, 0, 1.22, 1, 0.74), [1, 1, 1], MAT.GLOW_POOL, pendEm, 0.24 + nightBlend * 0.48, 0, false)
  }

  // Two sleek oak-and-titanium bar stools
  for (const sx of [barX - 0.12, barX + 1.48]) {
    const sz = barZ + 0.70
    renderer.add('plane', TRS(sx, 0.048, sz, 0, 0.48, 1, 0.48), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.24, 0, false)
    renderer.add('cyl', TRS(sx, 0.06, sz, 0, 0.28, 0.02, 0.28), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', TRS(sx, 0.25, sz, 0, 0.04, 0.36, 0.04), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', TRS(sx, 0.44, sz, 0, 0.32, 0.055, 0.32), oakCol, MAT.OAK_WOOD)
  }

  if (activeSteam) {
    const steamCol = mix3([0.62, 0.59, 0.56], [0.92, 0.90, 0.88], nightBlend)
    const steamEm = mix3([0.04, 0.04, 0.03], [0.42, 0.38, 0.34], nightBlend)
    for (let s = 0; s < 6; s++) {
      const life = (time * 0.48 + s * (1 / 6)) % 1.0
      const sy = 1.24 + life * 0.92
      const sx = espX + 0.06 + Math.sin(time * 2.0 + s * 1.4) * (0.06 + life * 0.14)
      const sz = barZ + 0.08 + Math.cos(time * 1.6 + s * 1.1) * 0.06
      const sc = 0.13 + life * 0.20
      const fade = Math.sin(life * Math.PI) * (0.58 * (1 - nightBlend) + 0.52 * nightBlend)
      renderer.add('sphere', TRS(sx, sy, sz, 0, sc, sc * 0.80, sc), steamCol, MAT.GLASS, steamEm, fade, 0, false)
    }
  }

  // 7. Multi-Species Botanical Showcase: Ficus (NW), Mediterranean Olive Tree (NE), Tropical Monstera (SE)!
  drawFicusTree(renderer, cx - 3.45, cz - 2.85, 1.08, time, 1.1, 0.044, nightBlend)
  drawOliveTree(renderer, cx + 3.35, cz - 2.75, 1.04, time, 2.7, 0.044, nightBlend)
  drawMonsteraPlanter(renderer, cx + 3.35, cz + 2.75, 1.12, time, 4.3, 0.044, nightBlend)

  drawPlanterTrough(renderer, cx + 3.82, cz + 0.15, 2.3, Math.PI * 0.5, time, 0.044)
  drawPlanterTrough(renderer, cx - 1.95, cz + 3.28, 2.5, 0, time, 0.044)
}

/**
 * Draws a distinct corner studio prop per workshop (coat/bag stand, water cooler cart, or studio speaker tower).
 */
function drawWorkshopCornerProp(renderer, x, z, liftY, variant, nightBlend) {
  const root = mat4Translate(x, 0.044 + liftY, z)
  const oakCol = mix3(PAL.oakWarm, [0.54, 0.40, 0.27], nightBlend * 0.4)
  const aluCol = mix3(PAL.aluBright, [0.42, 0.45, 0.52], nightBlend)

  renderer.add('plane', localTRS(root, 0, 0.008, 0, 0, 0.58, 1, 0.58), [0, 0, 0], MAT.SHADOW_BLOB, [0, 0, 0], 0.28, 0, false)

  if (variant === 0) {
    // Matte-black architectural coat & canvas tote-bag stand
    renderer.add('cyl', localTRS(root, 0, 0.02, 0, 0, 0.34, 0.03, 0.34), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0, 0.58, 0, 0, 0.032, 1.12, 0.032), PAL.titaniumDark, MAT.TITANIUM)
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4
      renderer.add('cyl', localTRS(root, Math.cos(a) * 0.08, 1.04, Math.sin(a) * 0.08, -a, 0.018, 0.18, 0.018, 0, -0.75), PAL.brassWarm, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    }
    // Minimal canvas tote bag draped on one hook
    renderer.add('bevelBox', localTRS(root, -0.10, 0.78, 0.06, 0.3, 0.16, 0.24, 0.07), PAL.sofaBoucle, MAT.FABRIC_RUG)
  } else if (variant === 1) {
    // Cleanroom filtered water dispenser / mini hydration pedestal
    renderer.add('bevelBox', localTRS(root, 0, 0.34, 0, 0, 0.34, 0.68, 0.34), PAL.ceramicIvory, MAT.CERAMIC)
    renderer.add('bevelBox', localTRS(root, 0, 0.69, 0, 0, 0.36, 0.032, 0.36), oakCol, MAT.OAK_WOOD)
    renderer.add('cyl', localTRS(root, 0, 0.84, -0.02, 0, 0.20, 0.26, 0.20), [0.80, 0.93, 0.99], MAT.GLASS, [0.05, 0.14, 0.20], 0.36, 0, false)
    renderer.add('sharpBox', localTRS(root, 0, 0.56, 0.175, 0, 0.16, 0.12, 0.02), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0.10, 0.75, 0.10, 0, 0.06, 0.08, 0.06), PAL.ceramicTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  } else {
    // Teenage-Engineering-style studio acoustic speaker tower on oak plinth
    renderer.add('bevelBox', localTRS(root, 0, 0.06, 0, 0, 0.34, 0.08, 0.30), oakCol, MAT.OAK_WOOD)
    renderer.add('bevelBox', localTRS(root, 0, 0.44, 0, -0.22, 0.26, 0.68, 0.22), aluCol, MAT.ALUMINUM)
    renderer.add('cyl', localTRS(root, -0.02, 0.54, 0.112, -0.22, 0.15, 0.014, 0.15, Math.PI * 0.5, 0), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, -0.02, 0.32, 0.112, -0.22, 0.11, 0.014, 0.11, Math.PI * 0.5, 0), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('cyl', localTRS(root, 0.06, 0.69, 0.112, -0.22, 0.036, 0.014, 0.036, Math.PI * 0.5, 0), PAL.pillowTerra, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  }
}

/**
 * Draws flagship studio architectural finishes for a Group Workshop (Env R3 upgrade):
 * - Low-pile woven acoustic floor rug + warm 3000K Night jewel-box pavilion bounce
 * - Acoustic vertical oak-slat back wall + warm cove LED
 * - Warm oak floating wall shelf (books + trailing pothos) beside Kanban whiteboard
 * - Distinct corner studio prop per workshop + varied botanical corner species (Ficus / Monstera / Olive)
 * - Apple-Park frosted manifestation privacy band on side glass partitions
 */
export function drawWorkshopArchitecture(renderer, grp, opts = {}) {
  if (!grp) return
  const {
    statusColor = [0.14, 1.35, 2.5],
    time = 0,
    nightBlend = 0,
    liftY = 0,
    isDragging = false,
  } = opts

  const { cx, cz, w, d } = grp
  const backZ = cz - d * 0.5 + 0.065
  const wallH = 1.16
  const slatW = Math.max(1.8, w - 0.42)
  const oakCol = mix3(PAL.oakWarm, [0.58, 0.43, 0.29], nightBlend * 0.42)
  const frameCol = isDragging
    ? [0.24, 0.60, 0.98]
    : mix3(PAL.aluMid, [0.34, 0.37, 0.44], nightBlend)
  const variant = Math.abs(Math.round(cx * 3 + cz * 7)) % 3

  // 1. Subtle Woven Low-Pile Acoustic Floor Rug + Warm 3000K Jewel-Box Interior Bounce at Night
  const rugW = Math.max(1.8, w - 1.65)
  const rugD = Math.max(1.5, d - 0.92)
  const rugCol = mix3(PAL.rugWorkshop, [0.24, 0.25, 0.29], nightBlend * 0.80)
  renderer.add('slab', TRS(cx + 0.42, 0.043 + liftY, cz + 0.10, 0, rugW, 0.010, rugD), rugCol, MAT.FABRIC_RUG, [0, 0, 0], 1, 0, false)
  if (nightBlend > 0.05) {
    renderer.add('plane', TRS(cx + 0.35, 0.052 + liftY, cz + 0.05, 0, rugW * 1.15, 1, rugD * 1.12), [1, 1, 1], MAT.GLOW_POOL, [2.05, 1.32, 0.56], 0.26 * nightBlend, 0, false)
  }

  // 2. Acoustic Vertical Wood-Slat Accent Back Wall + Brushed Aluminum Cap Trim + 3000K Cove Glow
  renderer.add('bevelBox', TRS(cx, wallH * 0.5 + 0.04 + liftY, backZ, 0, slatW, wallH, 0.055), oakCol, MAT.WOOD_SLAT)
  renderer.add('bevelBox', TRS(cx, wallH + 0.055 + liftY, backZ, 0, slatW + 0.04, 0.032, 0.075), frameCol, MAT.ALUMINUM)

  const coveInt = 0.85 + nightBlend * 1.45
  const coveEm = [2.25 * coveInt, 1.42 * coveInt, 0.56 * coveInt]
  renderer.add('sharpBox', TRS(cx, wallH + 0.025 + liftY, backZ + 0.036, 0, slatW - 0.14, 0.020, 0.018), [1, 0.92, 0.76], MAT.EMISSIVE, coveEm, 1, 0, false)
  // Slim floating brushed-aluminum linear architectural wash-bar casting warm 3000K wash down oak slats
  const barW = slatW * 0.84
  const washY = wallH + 0.052 + liftY
  const washZ = backZ + 0.145
  renderer.add('bevelBox', TRS(cx, washY, washZ, 0, barW, 0.022, 0.036), frameCol, MAT.ALUMINUM)
  renderer.add('sharpBox', TRS(cx - barW * 0.36, washY, backZ + 0.075, 0, 0.018, 0.016, 0.12), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(cx + barW * 0.36, washY, backZ + 0.075, 0, 0.018, 0.016, 0.12), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(cx, washY - 0.013, washZ, 0, barW - 0.08, 0.008, 0.018), [1, 0.94, 0.78], MAT.EMISSIVE, coveEm, 0.96, 0, false)
  renderer.add('plane', TRS(cx, 0.050 + liftY, backZ + 0.54, 0, slatW * 0.95, 1, 1.24), [1, 1, 1], MAT.GLOW_POOL, coveEm, 0.12 + nightBlend * 0.48, 0, false)
  renderer.add('sharpBox', TRS(cx, 0.062 + liftY, backZ + 0.035, 0, slatW - 0.24, 0.014, 0.012), [1, 1, 1], MAT.EMISSIVE, [statusColor[0] * 0.65, statusColor[1] * 0.65, statusColor[2] * 0.65], 0.88, 0, false)

  // 3. Glass-Backed Kanban Whiteboard with Colorful Sticky Notes
  const kbW = Math.min(1.42, Math.max(0.95, slatW * 0.32))
  const kbH = 0.56
  const kbX = cx + Math.min(0.68, w * 0.14)
  const kbY = 0.72 + liftY
  const kbZ = backZ + 0.045
  renderer.add('bevelBox', TRS(kbX, kbY, kbZ - 0.006, 0, kbW + 0.045, kbH + 0.045, 0.016), frameCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  renderer.add('sharpBox', TRS(kbX, kbY, kbZ + 0.004, 0, kbW, kbH, 0.012), [0.95, 0.96, 0.98], MAT.CERAMIC, [0.05, 0.06, 0.08], 1, 0, false)
  renderer.add('bevelBox', TRS(kbX, kbY - kbH * 0.5 - 0.02, kbZ + 0.022, 0, kbW * 0.72, 0.018, 0.042), frameCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  // 3 colored dry-erase markers + matte-black felt whiteboard eraser resting on marker tray
  const trayY = kbY - kbH * 0.5 - 0.004
  const trayZ = kbZ + 0.026
  const markers = [
    [-0.20, [0.14, 0.15, 0.18]], // black
    [-0.04, [0.18, 0.48, 0.88]], // blue
    [0.12, [0.88, 0.28, 0.24]],  // coral-red
  ]
  for (const [mxOff, mCol] of markers) {
    renderer.add('cyl', localTRS(mat4Translate(kbX + kbW * mxOff, trayY, trayZ), 0, 0, 0, 0, 0.016, 0.11, 0.016, 0, Math.PI * 0.5), mCol, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  }
  renderer.add('bevelBox', TRS(kbX + kbW * 0.28, trayY + 0.008, trayZ, 0, 0.085, 0.026, 0.034), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)

  // Minimalist Braun-Style Circular Matte-White Wall Clock (dark 10:10 hands + sweeping orange second hand)
  const clkX = kbX - kbW * 0.5 - 0.26
  const clkY = 0.94 + liftY
  const clkZ = backZ + 0.042
  if (clkX > cx - slatW * 0.44) {
    const clkRoot = mat4Translate(clkX, clkY, clkZ)
    renderer.add('cyl', localTRS(clkRoot, 0, 0, 0, 0, 0.24, 0.024, 0.24, Math.PI * 0.5, 0), [0.96, 0.95, 0.92], MAT.CERAMIC, [0.03, 0.03, 0.03], 1, 0, false)
    renderer.add('thinTorus', localTRS(clkRoot, 0, 0, 0.008, 0, 0.245, 0.245, 0.245, Math.PI * 0.5, 0), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    // Hour hand (10 o'clock) + Minute hand (2 o'clock) + sweeping Braun orange second hand
    renderer.add('sharpBox', localTRS(clkRoot, -0.026, 0.018, 0.016, 0, 0.062, 0.010, 0.005, 0, -0.58), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    renderer.add('sharpBox', localTRS(clkRoot, 0.034, 0.024, 0.017, 0, 0.084, 0.008, 0.005, 0, 0.52), PAL.titaniumDark, MAT.TITANIUM, [0, 0, 0], 1, 0, false)
    const secAng = -(time * 0.35) % (Math.PI * 2)
    renderer.add('sharpBox', localTRS(clkRoot, Math.sin(-secAng) * 0.035, Math.cos(-secAng) * 0.035, 0.019, 0, 0.005, 0.088, 0.004, 0, secAng), [0.92, 0.36, 0.14], MAT.CERAMIC, [0.15, 0.05, 0.02], 1, 0, false)
  }
  for (const colFrac of [-0.16, 0.16]) {
    renderer.add('sharpBox', TRS(kbX + kbW * colFrac, kbY, kbZ + 0.012, 0, 0.008, kbH - 0.08, 0.004), [0.76, 0.79, 0.83], MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }
  const stickyColors = [[0.99, 0.86, 0.32], [0.98, 0.55, 0.48], [0.45, 0.86, 0.65], [0.46, 0.76, 0.98]]
  const notes = [
    [-0.34, 0.15, 0], [-0.34, 0.01, 1], [-0.34, -0.13, 0],
    [0.00, 0.15, 3], [0.00, 0.01, 0], [0.00, -0.13, 1],
    [0.34, 0.15, 2], [0.34, 0.01, 2], [0.34, -0.13, 3],
  ]
  for (const [nx, ny, cIdx] of notes) {
    renderer.add('sharpBox', TRS(kbX + kbW * nx, kbY + ny, kbZ + 0.014, 0, kbW * 0.18, 0.085, 0.006), stickyColors[cIdx], MAT.CERAMIC, [0, 0, 0], 1, 0, false)
  }

  // 4. Warm Oak Floating Wall Shelf beside Kanban Board (books + trailing pothos!)
  if (w >= 4.2) {
    const shX = cx - w * 0.19
    const shY = 0.84 + liftY
    const shZ = backZ + 0.095
    const shW = Math.min(0.95, w * 0.20)
    renderer.add('bevelBox', TRS(shX, shY, shZ, 0, shW, 0.028, 0.14), oakCol, MAT.OAK_WOOD)
    // 4 tiny vertical hardcover books on left of shelf
    const sBooks = [[0.78, 0.38, 0.28], [0.24, 0.46, 0.62], [0.88, 0.74, 0.34], [0.32, 0.54, 0.42]]
    sBooks.forEach((col, i) => {
      renderer.add('bevelBox', TRS(shX - shW * 0.32 + i * 0.055, shY + 0.095, shZ, 0, 0.036, 0.16 + (i % 2) * 0.025, 0.11), col, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    })
    // Small ceramic pot + trailing pothos leaves cascading over front edge of shelf!
    const potX = shX + shW * 0.26
    renderer.add('ribbedPot', TRS(potX, shY + 0.065, shZ, 0.2, 0.10, 0.10, 0.10), PAL.ceramicIvory, MAT.CERAMIC, [0, 0, 0], 1, 0, false)
    const pSway = Math.sin(time * 1.5 + cx) * 0.04
    renderer.add('leafBlade', localTRS(mat4Translate(potX, shY + 0.10, shZ + 0.03), 0, 0, 0, 0.25, 0.24, 0.24, 0.30, 0.82 + pSway, 0), PAL.leafIvy, MAT.LEAF_RICH, [0, 0, 0], 1, 0.4, false)
    renderer.add('leafBlade', localTRS(mat4Translate(potX + 0.03, shY + 0.09, shZ + 0.04), 0, 0, 0, -0.35, 0.22, 0.22, 0.28, 0.96 + pSway, 0), PAL.leafOlive, MAT.LEAF_RICH, [0, 0, 0], 1, 0.9, false)
    renderer.add('leafBlade', localTRS(mat4Translate(potX - 0.02, shY + 0.11, shZ), 0, 0, 0, 0.8, 0.18, 0.18, 0.20, -0.35 + pSway, 0), PAL.leafShoot, MAT.LEAF_RICH, [0, 0, 0], 1, 1.3, false)
  }

  // 5. Brushed Aluminum Glass Mullions + Apple-Park Frosted Privacy Manifestation Band
  const hGlass = 0.72
  const mulCount = Math.max(1, Math.floor(d / 1.8) - 1)
  for (let m = 1; m <= mulCount; m++) {
    const mz = cz - d * 0.5 + (d * m) / (mulCount + 1)
    renderer.add('bevelBox', TRS(cx - w * 0.5 + 0.04, hGlass * 0.5 + liftY, mz, 0, 0.032, hGlass, 0.032), frameCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    renderer.add('bevelBox', TRS(cx + w * 0.5 - 0.04, hGlass * 0.5 + liftY, mz, 0, 0.032, hGlass, 0.032), frameCol, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
  }
  // Delicate mid-height frosted manifestation stripe on left & right glass partitions (`uExtra = 1.0`)
  const bandAlpha = 0.18 + nightBlend * 0.06
  renderer.add('sharpBox', TRS(cx - w * 0.5 + 0.04, 0.42 + liftY, cz, 0, 0.022, 0.13, d - 0.14), [0.94, 0.96, 0.99], MAT.GLASS, [0, 0, 0], bandAlpha, 1.0, false)
  renderer.add('sharpBox', TRS(cx + w * 0.5 - 0.04, 0.42 + liftY, cz, 0, 0.022, 0.13, d - 0.14), [0.94, 0.96, 0.99], MAT.GLASS, [0, 0, 0], bandAlpha, 1.0, false)

  // 6. Varied Botanical Corner Planter (Back-Left) + Distinct Corner Studio Prop (Back-Right)
  const plantX = cx - w * 0.5 + 0.48
  const plantZ = cz - d * 0.5 + 0.48
  const seed = Math.abs(cx * 1.7 + cz * 0.9)
  if (variant === 1) {
    drawMonsteraPlanter(renderer, plantX, plantZ, 0.72, time, seed, 0.04 + liftY, nightBlend)
  } else if (variant === 2) {
    drawOliveTree(renderer, plantX, plantZ, 0.68, time, seed, 0.04 + liftY, nightBlend)
  } else {
    drawFicusTree(renderer, plantX, plantZ, 0.66, time, seed, 0.04 + liftY, nightBlend)
  }

  // Distinct studio prop in back-right corner (safely tucked inside back-right behind desk row)
  if (w >= 4.5) {
    drawWorkshopCornerProp(renderer, cx + w * 0.5 - 0.46, cz - d * 0.5 + 0.48, liftY, variant, nightBlend)
  }
}

/**
 * North curtain wall (the office faces north): floor-to-ceiling glass between slim mullions, top-hung
 * vents that open for fresh air in office hours and nudge with each gust, and cool skylight spilling
 * onto the floor in front during the day.
 */
export function drawNorthWindowWall(renderer, minX, maxX, z, opts = {}) {
  const { time = 0, nightBlend: nb = 0, vent = 1, gust = 0 } = opts
  const H = 3.1
  const sill = 0.14
  const head = 2.36
  const bay = 1.6
  const n = Math.max(2, Math.ceil((maxX - minX) / bay))
  const x0 = (minX + maxX) * 0.5 - (n * bay) * 0.5
  const frame = mix3([0.33, 0.35, 0.39], [0.16, 0.17, 0.2], nb)
  const glass = mix3([0.8, 0.88, 0.95], [0.1, 0.13, 0.2], nb)
  const kerb = mix3(PAL.travertineWarm, [0.24, 0.24, 0.26], nb)
  const width = n * bay
  const cxAll = x0 + width * 0.5

  renderer.add('sharpBox', TRS(cxAll, sill * 0.5, z, 0, width + 0.1, sill, 0.26), kerb, MAT.TRAVERTINE)
  for (const y of [sill, head, H]) {
    renderer.add('sharpBox', TRS(cxAll, y, z, 0, width + 0.1, 0.06, 0.12), frame, MAT.ALUMINUM)
  }
  for (let i = 0; i <= n; i++) {
    renderer.add('sharpBox', TRS(x0 + i * bay, H * 0.5, z, 0, 0.065, H, 0.14), frame, MAT.ALUMINUM)
  }
  for (let i = 0; i < n; i++) {
    const cx = x0 + (i + 0.5) * bay
    renderer.add('sharpBox', TRS(cx, (sill + head) * 0.5, z, 0, bay - 0.07, head - sill - 0.06, 0.014), glass, MAT.GLASS, [0, 0, 0], 0.2, 0, false)
    // Every other bay has a top-hung vent; they don't all open the same amount.
    const ventH = H - head - 0.07
    const open = i % 2 === 0 ? vent * (0.26 + 0.1 * Math.sin(i * 2.3)) + gust * 0.035 * Math.sin(time * 3.1 + i) : 0
    const hinge = mat4Mul(mat4Translate(cx, H - 0.035, z), mat4RotateX(open))
    renderer.add('sharpBox', localTRS(hinge, 0, -ventH * 0.5, 0, 0, bay - 0.09, ventH, 0.016), glass, MAT.GLASS, [0, 0, 0], 0.24, 0, false)
    renderer.add('sharpBox', localTRS(hinge, 0, -ventH + 0.02, -0.01, 0, bay - 0.09, 0.035, 0.04), frame, MAT.ALUMINUM, [0, 0, 0], 1, 0, false)
    // Daylight spilling in from each bay; gone at night.
    if (nb < 0.95) {
      renderer.add('plane', TRS(cx, 0.004, z + 1.5, 0, bay * 1.35, 1, 3.2), [1, 1, 1], MAT.GLOW_POOL, [0.5, 0.56, 0.64], 0.32 * (1 - nb), 0, false)
    }
  }
}
