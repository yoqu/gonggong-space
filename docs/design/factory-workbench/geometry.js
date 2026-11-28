/**
 * Parametric Chamfered / Micro-Beveled Hard-Surface Geometry & Binary GLB Exporter
 * Gives Clawd and cleanroom equipment authentic studio rim speculars on micro-bevels.
 */

export function createChamferBox(wx = 1, wy = 1, wz = 1, bevel = 0.04) {
  const hx = wx * 0.5
  const hy = wy * 0.5
  const hz = wz * 0.5
  const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45)

  const positions = []
  const normals = []
  const indices = []

  const coords = (h) => (b > 0.001 ? [-h, -(h - b), h - b, h] : [-h, h])
  const xs = coords(hx)
  const ys = coords(hy)
  const zs = coords(hz)
  const nGrid = xs.length

  function evalVertex(x, y, z) {
    if (b <= 0.001) return { px: x, py: y, pz: z, nx: 0, ny: 1, nz: 0 }
    const cx = Math.max(-(hx - b), Math.min(hx - b, x))
    const cy = Math.max(-(hy - b), Math.min(hy - b, y))
    const cz = Math.max(-(hz - b), Math.min(hz - b, z))
    let dx = x - cx
    let dy = y - cy
    let dz = z - cz
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return { px: x, py: y, pz: z, nx: 0, ny: 1, nz: 0 }
    dx /= len
    dy /= len
    dz /= len
    return {
      px: cx + dx * b,
      py: cy + dy * b,
      pz: cz + dz * b,
      nx: dx,
      ny: dy,
      nz: dz,
    }
  }

  function buildFace(uArr, vArr, fixedVal, mapFn, flip) {
    const base = positions.length / 3
    for (let j = 0; j < vArr.length; j++) {
      for (let i = 0; i < uArr.length; i++) {
        const [rx, ry, rz, fnx, fny, fnz] = mapFn(uArr[i], vArr[j], fixedVal)
        const v = b > 0.001 ? evalVertex(rx, ry, rz) : { px: rx, py: ry, pz: rz, nx: fnx, ny: fny, nz: fnz }
        positions.push(v.px, v.py, v.pz)
        normals.push(v.nx, v.ny, v.nz)
      }
    }
    for (let j = 0; j < vArr.length - 1; j++) {
      for (let i = 0; i < uArr.length - 1; i++) {
        const a = base + j * nGrid + i
        const c = a + 1
        const d = a + nGrid
        const e = d + 1
        if (!flip) {
          indices.push(a, c, e, a, e, d)
        } else {
          indices.push(a, e, c, a, d, e)
        }
      }
    }
  }

  // +Z, -Z
  buildFace(xs, ys, hz, (u, v, w) => [u, v, w, 0, 0, 1], false)
  buildFace(xs, ys, -hz, (u, v, w) => [u, v, w, 0, 0, -1], true)
  // +X, -X
  buildFace(zs, ys, hx, (u, v, w) => [w, v, u, 1, 0, 0], true)
  buildFace(zs, ys, -hx, (u, v, w) => [w, v, u, -1, 0, 0], false)
  // +Y, -Y
  buildFace(xs, zs, hy, (u, v, w) => [u, w, v, 0, 1, 0], true)
  buildFace(xs, zs, -hy, (u, v, w) => [u, w, v, 0, -1, 0], false)

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

export function createCylinder(rTop = 0.5, rBot = 0.5, height = 1, segs = 28) {
  const positions = []
  const normals = []
  const indices = []
  const hy = height * 0.5
  const slope = (rBot - rTop) / height
  const ny = slope / Math.hypot(1, slope)
  const nr = 1 / Math.hypot(1, slope)

  // Side wall
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    positions.push(ca * rTop, hy, sa * rTop)
    normals.push(ca * nr, ny, sa * nr)
    positions.push(ca * rBot, -hy, sa * rBot)
    normals.push(ca * nr, ny, sa * nr)
  }
  for (let i = 0; i < segs; i++) {
    const k = i * 2
    indices.push(k, k + 1, k + 3, k, k + 3, k + 2)
  }

  // Top cap
  const topCenter = positions.length / 3
  positions.push(0, hy, 0)
  normals.push(0, 1, 0)
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    positions.push(Math.cos(a) * rTop, hy, Math.sin(a) * rTop)
    normals.push(0, 1, 0)
  }
  for (let i = 0; i < segs; i++) {
    indices.push(topCenter, topCenter + 1 + i + 1, topCenter + 1 + i)
  }

  // Bottom cap
  const botCenter = positions.length / 3
  positions.push(0, -hy, 0)
  normals.push(0, -1, 0)
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    positions.push(Math.cos(a) * rBot, -hy, Math.sin(a) * rBot)
    normals.push(0, -1, 0)
  }
  for (let i = 0; i < segs; i++) {
    indices.push(botCenter, botCenter + 1 + i, botCenter + 1 + i + 1)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Horizontal quad facing +Y, ideal for seamless infinite floor plane.
 */
export function createPlane(w = 1, d = 1) {
  const hw = w * 0.5
  const hd = d * 0.5
  return {
    positions: new Float32Array([
      -hw, 0, -hd,
      hw, 0, -hd,
      hw, 0, hd,
      -hw, 0, hd,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  }
}

/**
 * Horizontal torus lying in the XZ plane (around Y axis).
 * Used for owner halos, thinking rings, recharge mats, and mug handles.
 */
export function createTorus(majorR = 0.5, minorR = 0.06, segs = 28, tubeSegs = 10) {
  const positions = []
  const normals = []
  const indices = []

  for (let i = 0; i <= segs; i++) {
    const u = (i / segs) * Math.PI * 2
    const cu = Math.cos(u)
    const su = Math.sin(u)
    for (let j = 0; j <= tubeSegs; j++) {
      const v = (j / tubeSegs) * Math.PI * 2
      const cv = Math.cos(v)
      const sv = Math.sin(v)
      const r = majorR + minorR * cv
      positions.push(r * cu, minorR * sv, r * su)
      normals.push(cv * cu, sv, cv * su)
    }
  }

  const ring = tubeSegs + 1
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < tubeSegs; j++) {
      const a = i * ring + j
      const b = (i + 1) * ring + j
      const c = (i + 1) * ring + (j + 1)
      const d = i * ring + (j + 1)
      indices.push(a, b, c, a, c, d)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * UV sphere for steam puffs, bonsai foliage clusters, beacons, and motes.
 */
export function createSphere(radius = 0.5, latSegs = 10, lonSegs = 16) {
  const positions = []
  const normals = []
  const indices = []

  for (let lat = 0; lat <= latSegs; lat++) {
    const theta = (lat / latSegs) * Math.PI
    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    for (let lon = 0; lon <= lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2
      const nx = st * Math.cos(phi)
      const ny = ct
      const nz = st * Math.sin(phi)
      positions.push(nx * radius, ny * radius, nz * radius)
      normals.push(nx, ny, nz)
    }
  }

  const stride = lonSegs + 1
  for (let lat = 0; lat < latSegs; lat++) {
    for (let lon = 0; lon < lonSegs; lon++) {
      const a = lat * stride + lon
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Crisp faceted octahedron for spark particles, confetti, and holographic pips.
 */
export function createOctahedron(radius = 0.5) {
  const r = radius
  const verts = [
    [0, r, 0], [r, 0, 0], [0, 0, r],
    [-r, 0, 0], [0, 0, -r], [0, -r, 0],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4],
    [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1],
  ]
  const positions = []
  const normals = []
  const indices = []

  faces.forEach((f, idx) => {
    const [a, b, c] = f.map((i) => verts[i])
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    const base = idx * 3
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2])
      normals.push(nx, ny, nz)
    }
    indices.push(base, base + 1, base + 2)
  })

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Architectural fluted/ribbed tapered planter pot (unit height centered at Y=0).
 */
export function createTaperedPot(rTop = 0.5, rBot = 0.38, height = 1, segs = 36, ribs = 18, ribAmp = 0.022) {
  const positions = []
  const normals = []
  const indices = []
  const hy = height * 0.5
  const rings = 5

  for (let r = 0; r <= rings; r++) {
    const v = r / rings
    const y = -hy + v * height
    // Slight subtle lip flare near top rim
    const lip = v > 0.88 ? 0.018 * ((v - 0.88) / 0.12) : 0
    const baseR = rBot + (rTop - rBot) * v + lip
    const ribFade = Math.sin(v * Math.PI) // smooth out at very top/bottom rims
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const flute = Math.cos(a * ribs) * ribAmp * ribFade
      const rad = baseR + flute
      const dRadDa = -Math.sin(a * ribs) * ribs * ribAmp * ribFade
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      positions.push(ca * rad, y, sa * rad)
      // Approximate normal incorporating rib tangent & taper slope
      const tx = -sa * rad + ca * dRadDa
      const tz = ca * rad + sa * dRadDa
      const slopeY = (rBot - rTop) / height
      let nx = tz
      let ny = slopeY * Math.hypot(tx, tz)
      let nz = -tx
      const len = Math.hypot(nx, ny, nz) || 1
      normals.push(nx / len, ny / len, nz / len)
    }
  }

  const stride = segs + 1
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < segs; i++) {
      const a = r * stride + i
      const b = a + stride
      indices.push(a, a + 1, b + 1, a, b + 1, b)
    }
  }

  // Top cap
  const topCenter = positions.length / 3
  positions.push(0, hy, 0)
  normals.push(0, 1, 0)
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    positions.push(Math.cos(a) * (rTop + 0.018), hy, Math.sin(a) * (rTop + 0.018))
    normals.push(0, 1, 0)
  }
  for (let i = 0; i < segs; i++) {
    indices.push(topCenter, topCenter + 1 + i + 1, topCenter + 1 + i)
  }

  // Bottom cap
  const botCenter = positions.length / 3
  positions.push(0, -hy, 0)
  normals.push(0, -1, 0)
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    positions.push(Math.cos(a) * rBot, -hy, Math.sin(a) * rBot)
    normals.push(0, -1, 0)
  }
  for (let i = 0; i < segs; i++) {
    indices.push(botCenter, botCenter + 1 + i, botCenter + 1 + i + 1)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Gracefully arched botanical leaf blade / frond extending along +Z from origin (0,0,0),
 * with subtle central midrib V-fold and double-sided faces so it reads from every angle.
 */
export function createLeafBlade(width = 0.34, length = 0.78, arch = 0.22, segs = 6) {
  const positions = []
  const normals = []
  const indices = []

  const buildSide = (flip) => {
    const base = positions.length / 3
    const sign = flip ? -1 : 1
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const z = t * length
      // Botanical lanceolate width profile: narrow petiole -> full belly -> pointed tip
      const w = width * Math.sin(Math.pow(t, 0.72) * Math.PI)
      // Natural upward rise then gentle downward droop at tip
      const yMid = Math.sin(t * Math.PI * 0.85) * arch - t * t * arch * 0.35
      const yEdge = yMid + w * 0.14
      const dyDt = Math.cos(t * Math.PI * 0.85) * arch * Math.PI * 0.85 - 2 * t * arch * 0.35
      let ny = length
      let nz = -dyDt
      const nLen = Math.hypot(ny, nz) || 1
      ny /= nLen
      nz /= nLen

      // Left edge, midrib, right edge
      const row = [
        [-w * 0.5, yEdge, z, -0.22 * sign, ny * sign, nz * sign],
        [0, yMid, z, 0, ny * sign, nz * sign],
        [w * 0.5, yEdge, z, 0.22 * sign, ny * sign, nz * sign],
      ]
      for (const [px, py, pz, nx, nny, nnz] of row) {
        const nl = Math.hypot(nx, nny, nnz) || 1
        positions.push(px, py, pz)
        normals.push(nx / nl, nny / nl, nnz / nl)
      }
    }
    for (let i = 0; i < segs; i++) {
      const r0 = base + i * 3
      const r1 = base + (i + 1) * 3
      if (!flip) {
        indices.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1)
        indices.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2)
      } else {
        indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1)
        indices.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1)
      }
    }
  }

  buildSide(false)
  buildSide(true)

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Broad arching tropical Monstera-style fan leaf blade (wider heart/fan silhouette).
 */
export function createBroadLeaf(width = 0.56, length = 0.72, arch = 0.24, segs = 6) {
  const positions = []
  const normals = []
  const indices = []

  const buildSide = (flip) => {
    const base = positions.length / 3
    const sign = flip ? -1 : 1
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const z = t * length
      // Broad tropical heart-fan profile: flares quickly near base, slight fenestration ripple, rounded tip
      const baseFlare = Math.sin(Math.pow(t, 0.52) * Math.PI)
      const ripple = 1.0 - 0.14 * Math.pow(Math.sin(t * Math.PI * 3.0), 2.0) * (t > 0.2 && t < 0.85 ? 1 : 0)
      const w = width * baseFlare * ripple
      const yMid = Math.sin(t * Math.PI * 0.78) * arch - t * t * arch * 0.42
      const yEdge = yMid + w * 0.10
      const dyDt = Math.cos(t * Math.PI * 0.78) * arch * Math.PI * 0.78 - 2 * t * arch * 0.42
      let ny = length
      let nz = -dyDt
      const nLen = Math.hypot(ny, nz) || 1
      ny /= nLen
      nz /= nLen

      const row = [
        [-w * 0.5, yEdge, z, -0.18 * sign, ny * sign, nz * sign],
        [0, yMid, z, 0, ny * sign, nz * sign],
        [w * 0.5, yEdge, z, 0.18 * sign, ny * sign, nz * sign],
      ]
      for (const [px, py, pz, nx, nny, nnz] of row) {
        const nl = Math.hypot(nx, nny, nnz) || 1
        positions.push(px, py, pz)
        normals.push(nx / nl, nny / nl, nnz / nl)
      }
    }
    for (let i = 0; i < segs; i++) {
      const r0 = base + i * 3
      const r1 = base + (i + 1) * 3
      if (!flip) {
        indices.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1)
        indices.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2)
      } else {
        indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1)
        indices.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1)
      }
    }
  }

  buildSide(false)
  buildSide(true)

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Organic sculpted botanical foliage cluster (perturbed multi-lobe crown, never a bare sphere).
 */
export function createFoliageCanopy(radius = 0.5, latSegs = 9, lonSegs = 14) {
  const positions = []
  const normals = []
  const indices = []

  const evalPos = (theta, phi) => {
    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    const cp = Math.cos(phi)
    const sp = Math.sin(phi)
    const dx = st * cp
    const dy = ct
    const dz = st * sp
    // Organic multi-frequency leaf-crown undulation
    const lobe =
      1.0 +
      0.13 * Math.sin(phi * 3.0 + theta * 2.0) * st +
      0.09 * Math.cos(phi * 5.0 - theta * 3.0) * st +
      0.07 * Math.sin(theta * 4.0 + phi * 2.0)
    const r = radius * lobe
    return [dx * r, dy * r * 0.88, dz * r]
  }

  for (let lat = 0; lat <= latSegs; lat++) {
    const theta = (lat / latSegs) * Math.PI
    for (let lon = 0; lon <= lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2
      const p = evalPos(theta, phi)
      positions.push(p[0], p[1], p[2])
      // Finite-difference organic normal
      const eps = 0.04
      const pt = evalPos(Math.min(Math.PI - 0.001, theta + eps), phi)
      const pp = evalPos(theta, phi + eps)
      const ux = pt[0] - p[0], uy = pt[1] - p[1], uz = pt[2] - p[2]
      const vx = pp[0] - p[0], vy = pp[1] - p[1], vz = pp[2] - p[2]
      let nx = vy * uz - vz * uy
      let ny = vz * ux - vx * uz
      let nz = vx * uy - vy * ux
      // Guarantee outward-facing normals for proper top-down key-light & foliage shading
      if (nx * p[0] + ny * p[1] + nz * p[2] < 0) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      const len = Math.hypot(nx, ny, nz)
      if (len < 1e-5) {
        const fallbackLen = Math.hypot(p[0], p[1], p[2]) || 1
        normals.push(p[0] / fallbackLen, p[1] / fallbackLen, p[2] / fallbackLen)
      } else {
        normals.push(nx / len, ny / len, nz / len)
      }
    }
  }

  const stride = lonSegs + 1
  for (let lat = 0; lat < latSegs; lat++) {
    for (let lon = 0; lon < lonSegs; lon++) {
      const a = lat * stride + lon
      const b = a + stride
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

/**
 * Generates a standard binary glTF 2.0 (.glb) file of the articulated Clawd Miniature Figurine
 * ready to open directly in Blender 5.2.1 with clean named nodes and 4 PBR material slots!
 */
export function exportClawdGLB(shellHex = '#d97757') {
  const hexToLinear = (hex) => {
    const v = parseInt(hex.replace('#', ''), 16)
    const srgb = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
    return srgb.map((c) => Math.pow(c, 2.2))
  }
  const [sr, sg, sb] = hexToLinear(shellHex)

  const parts = [
    { name: 'Body_Main', geo: createChamferBox(0.92, 0.56, 0.56, 0.028), t: [0, 0.64, 0], mat: 0 },
    { name: 'Crown_Step', geo: createChamferBox(0.72, 0.10, 0.46, 0.020), t: [0, 0.955, 0], mat: 0 },
    { name: 'Lower_Skirt', geo: createChamferBox(0.84, 0.055, 0.50, 0.015), t: [0, 0.345, 0], mat: 0 },
    { name: 'Eye_Left', geo: createChamferBox(0.092, 0.19, 0.04, 0.010), t: [-0.17, 0.67, 0.272], mat: 2 },
    { name: 'Eye_Right', geo: createChamferBox(0.092, 0.19, 0.04, 0.010), t: [0.17, 0.67, 0.272], mat: 2 },
    { name: 'Joint_Shoulder_L', geo: createChamferBox(0.08, 0.14, 0.14, 0.028), t: [-0.48, 0.61, 0], mat: 1 },
    { name: 'Arm_L', geo: createChamferBox(0.118, 0.35, 0.138, 0.020), t: [-0.565, 0.50, 0], mat: 0 },
    { name: 'Joint_Shoulder_R', geo: createChamferBox(0.08, 0.14, 0.14, 0.028), t: [0.48, 0.61, 0], mat: 1 },
    { name: 'Arm_R', geo: createChamferBox(0.118, 0.35, 0.138, 0.020), t: [0.565, 0.50, 0], mat: 0 },
    { name: 'Leg_Outer_L', geo: createChamferBox(0.132, 0.29, 0.152, 0.018), t: [-0.295, 0.175, 0], mat: 0 },
    { name: 'Leg_Inner_L', geo: createChamferBox(0.132, 0.29, 0.152, 0.018), t: [-0.115, 0.175, 0], mat: 0 },
    { name: 'Leg_Inner_R', geo: createChamferBox(0.132, 0.29, 0.152, 0.018), t: [0.115, 0.175, 0], mat: 0 },
    { name: 'Leg_Outer_R', geo: createChamferBox(0.132, 0.29, 0.152, 0.018), t: [0.295, 0.175, 0], mat: 0 },
    { name: 'FootPad_OL', geo: createChamferBox(0.12, 0.03, 0.14, 0.008), t: [-0.295, 0.015, 0], mat: 1 },
    { name: 'FootPad_IL', geo: createChamferBox(0.12, 0.03, 0.14, 0.008), t: [-0.115, 0.015, 0], mat: 1 },
    { name: 'FootPad_IR', geo: createChamferBox(0.12, 0.03, 0.14, 0.008), t: [0.115, 0.015, 0], mat: 1 },
    { name: 'FootPad_OR', geo: createChamferBox(0.12, 0.03, 0.14, 0.008), t: [0.295, 0.015, 0], mat: 1 },
    { name: 'Back_Nameplate_Alu', geo: createChamferBox(0.42, 0.10, 0.02, 0.008), t: [0, 0.57, -0.278], mat: 3 },
    { name: 'Status_LED_Pip', geo: createChamferBox(0.08, 0.025, 0.05, 0.008), t: [-0.24, 1.01, 0.15], mat: 4 },
  ]

  const bufferViews = []
  const accessors = []
  const meshes = []
  const nodes = []
  const chunks = []
  let byteOffset = 0

  const pushChunk = (typedArr, target) => {
    const u8 = new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength)
    const pad = (4 - (u8.byteLength % 4)) % 4
    const viewIdx = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset, byteLength: u8.byteLength, target })
    chunks.push(u8)
    if (pad) chunks.push(new Uint8Array(pad))
    byteOffset += u8.byteLength + pad
    return viewIdx
  }

  parts.forEach((p, idx) => {
    const posView = pushChunk(p.geo.positions, 34962)
    const nrmView = pushChunk(p.geo.normals, 34962)
    const idxView = pushChunk(p.geo.indices, 34963)

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < p.geo.positions.length; i += 3) {
      const x = p.geo.positions[i], y = p.geo.positions[i + 1], z = p.geo.positions[i + 2]
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
    }

    const posAcc = accessors.length
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: p.geo.positions.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    })
    const nrmAcc = accessors.length
    accessors.push({
      bufferView: nrmView,
      componentType: 5126,
      count: p.geo.normals.length / 3,
      type: 'VEC3',
    })
    const idxAcc = accessors.length
    accessors.push({
      bufferView: idxView,
      componentType: 5123,
      count: p.geo.indices.length,
      type: 'SCALAR',
    })

    meshes.push({
      name: `${p.name}_Mesh`,
      primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: p.mat }],
    })
    nodes.push({ name: p.name, mesh: idx, translation: p.t })
  })

  const rootIdx = nodes.length
  nodes.push({
    name: 'Clawd_Figurine_Root',
    children: parts.map((_, i) => i),
  })

  const gltf = {
    asset: { version: '2.0', generator: 'Gonggong 3D Factory Workbench Pilot Exporter' },
    scene: 0,
    scenes: [{ name: 'Clawd_Pilot_Scene', nodes: [rootIdx] }],
    nodes,
    meshes,
    materials: [
      {
        name: 'Mat_Shell_Terracotta',
        pbrMetallicRoughness: { baseColorFactor: [sr, sg, sb, 1], metallicFactor: 0.04, roughnessFactor: 0.42 },
      },
      {
        name: 'Mat_Titanium_Joint',
        pbrMetallicRoughness: { baseColorFactor: [0.05, 0.055, 0.065, 1], metallicFactor: 0.86, roughnessFactor: 0.28 },
      },
      {
        name: 'Mat_Eye_Obsidian',
        pbrMetallicRoughness: { baseColorFactor: [0.01, 0.01, 0.012, 1], metallicFactor: 0.1, roughnessFactor: 0.06 },
      },
      {
        name: 'Mat_Nameplate_Aluminum',
        pbrMetallicRoughness: { baseColorFactor: [0.62, 0.64, 0.67, 1], metallicFactor: 0.9, roughnessFactor: 0.22 },
      },
      {
        name: 'Mat_Status_LED',
        pbrMetallicRoughness: { baseColorFactor: [1.0, 0.62, 0.1, 1], metallicFactor: 0.0, roughnessFactor: 0.2 },
        emissiveFactor: [1.0, 0.55, 0.05],
      },
    ],
    bufferViews,
    accessors,
    buffers: [{ byteLength: byteOffset }],
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
  const jsonTotal = jsonBytes.byteLength + jsonPad
  const totalLen = 12 + 8 + jsonTotal + 8 + byteOffset

  const out = new Uint8Array(totalLen)
  const dv = new DataView(out.buffer)
  // Header: 'glTF', version 2, total length
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, totalLen, true)
  // Chunk 0: JSON
  dv.setUint32(12, jsonTotal, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.byteLength + i] = 0x20
  // Chunk 1: BIN
  const binStart = 20 + jsonTotal
  dv.setUint32(binStart, byteOffset, true)
  dv.setUint32(binStart + 4, 0x004e4942, true)
  let ptr = binStart + 8
  for (const c of chunks) {
    out.set(c, ptr)
    ptr += c.byteLength
  }
  return out
}

/**
 * Generic binary glTF 2.0 (.glb) exporter for ANY of the 25 Gonggong Collectible Figurines.
 * Accepts recorded renderer draw calls `{ meshName, model, color, matType, emissive, alpha }`.
 */
export function exportFigurineGLB(figurineName = 'gonggong_figurine', drawCalls = []) {
  const meshFactory = {
    slab: () => createChamferBox(1, 1, 1, 0.012),
    bevelBox: () => createChamferBox(1, 1, 1, 0.042),
    fastBox: () => createChamferBox(1, 1, 1, 0.0),
    softBox: () => createChamferBox(1, 1, 1, 0.11),
    pillBox: () => createChamferBox(1, 1, 1, 0.22),
    sharpBox: () => createChamferBox(1, 1, 1, 0.0),
    cyl: () => createCylinder(0.5, 0.5, 1, 24),
    cone: () => createCylinder(0.18, 0.5, 1, 20),
    torus: () => createTorus(0.5, 0.075, 28, 10),
    thinTorus: () => createTorus(0.5, 0.032, 32, 8),
    sphere: () => createSphere(0.5, 10, 16),
    octa: () => createOctahedron(0.5),
    plane: () => createPlane(1, 1),
  }

  const validCalls = drawCalls.filter(
    (c) => c && c.matType !== 11 && c.matType !== 12 && meshFactory[c.meshName] && c.model && c.model.length === 16,
  )
  if (!validCalls.length) return exportClawdGLB('#d97757')

  const bufferViews = []
  const accessors = []
  const meshes = []
  const nodes = []
  const materials = []
  const chunks = []
  let byteOffset = 0

  const pushChunk = (typedArr, target) => {
    const u8 = new Uint8Array(typedArr.buffer, typedArr.byteOffset, typedArr.byteLength)
    const pad = (4 - (u8.byteLength % 4)) % 4
    const viewIdx = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset, byteLength: u8.byteLength, target })
    chunks.push(u8)
    if (pad) chunks.push(new Uint8Array(pad))
    byteOffset += u8.byteLength + pad
    return viewIdx
  }

  // Deduplicate base mesh geometry accessors
  const geoCache = new Map()
  const getGeoAccessors = (meshName) => {
    if (geoCache.has(meshName)) return geoCache.get(meshName)
    const geo = meshFactory[meshName]()
    const posView = pushChunk(geo.positions, 34962)
    const nrmView = pushChunk(geo.normals, 34962)
    const idxView = pushChunk(geo.indices, 34963)
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < geo.positions.length; i += 3) {
      const x = geo.positions[i], y = geo.positions[i + 1], z = geo.positions[i + 2]
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
    }
    const posAcc = accessors.length
    accessors.push({ bufferView: posView, componentType: 5126, count: geo.positions.length / 3, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] })
    const nrmAcc = accessors.length
    accessors.push({ bufferView: nrmView, componentType: 5126, count: geo.normals.length / 3, type: 'VEC3' })
    const idxAcc = accessors.length
    accessors.push({ bufferView: idxView, componentType: 5123, count: geo.indices.length, type: 'SCALAR' })
    const entry = { posAcc, nrmAcc, idxAcc }
    geoCache.set(meshName, entry)
    return entry
  }

  // Deduplicate PBR materials
  const matCache = new Map()
  const getMaterialIdx = (c) => {
    const col = c.color || [0.85, 0.47, 0.34]
    const em = c.emissive || [0, 0, 0]
    const alpha = c.alpha ?? 1.0
    const key = `${c.matType}_${col.map((v) => v.toFixed(2)).join(',')}_${em.map((v) => v.toFixed(2)).join(',')}_${alpha.toFixed(2)}`
    if (matCache.has(key)) return matCache.get(key)

    let metallic = 0.05
    let roughness = 0.36
    if (c.matType === 3) { metallic = 0.86; roughness = 0.24 } // ALUMINUM
    else if (c.matType === 4) { metallic = 0.80; roughness = 0.30 } // TITANIUM
    else if (c.matType === 5) { metallic = 0.12; roughness = 0.06 } // OBSIDIAN
    else if (c.matType === 6) { metallic = 0.0; roughness = 0.20 } // EMISSIVE
    else if (c.matType === 7) { metallic = 0.08; roughness = 0.14 } // GLASS
    else if (c.matType === 18) { metallic = 0.03; roughness = 0.36 } // VINYL_MATTE
    else if (c.matType === 19) { metallic = 0.02; roughness = 0.08 } // CERAMIC_GLAZE
    else if (c.matType === 20) { metallic = 0.06; roughness = 0.08 } // CRYSTAL_GLASS
    else if (c.matType === 21) { metallic = 0.92; roughness = 0.22 } // BRUSHED_BRASS

    const lin = col.map((v) => Math.pow(Math.max(0, Math.min(1, v)), 2.2))
    const matDef = {
      name: `Mat_${c.matType}_${materials.length}`,
      pbrMetallicRoughness: {
        baseColorFactor: [lin[0], lin[1], lin[2], Math.max(0.05, Math.min(1, alpha))],
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
    }
    if (em[0] > 0.01 || em[1] > 0.01 || em[2] > 0.01) {
      const mMax = Math.max(1, em[0], em[1], em[2])
      matDef.emissiveFactor = [em[0] / mMax, em[1] / mMax, em[2] / mMax]
    }
    if (alpha < 0.99) {
      matDef.alphaMode = 'BLEND'
    }
    const idx = materials.length
    materials.push(matDef)
    matCache.set(key, idx)
    return idx
  }

  validCalls.forEach((c, idx) => {
    const geo = getGeoAccessors(c.meshName)
    const matIdx = getMaterialIdx(c)
    const meshIdx = meshes.length
    meshes.push({
      name: `Part_${idx}_${c.meshName}`,
      primitives: [{ attributes: { POSITION: geo.posAcc, NORMAL: geo.nrmAcc }, indices: geo.idxAcc, material: matIdx }],
    })
    nodes.push({
      name: `Node_${idx}_${c.meshName}`,
      mesh: meshIdx,
      matrix: Array.from(c.model),
    })
  })

  const rootIdx = nodes.length
  nodes.push({
    name: `${figurineName}_Root`,
    children: validCalls.map((_, i) => i),
  })

  const gltf = {
    asset: { version: '2.0', generator: 'Gonggong 25-Figurine Studio PBR Exporter' },
    scene: 0,
    scenes: [{ name: `${figurineName}_Scene`, nodes: [rootIdx] }],
    nodes,
    meshes,
    materials,
    bufferViews,
    accessors,
    buffers: [{ byteLength: byteOffset }],
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
  const jsonTotal = jsonBytes.byteLength + jsonPad
  const totalLen = 12 + 8 + jsonTotal + 8 + byteOffset

  const out = new Uint8Array(totalLen)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, totalLen, true)
  dv.setUint32(12, jsonTotal, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.byteLength + i] = 0x20
  const binStart = 20 + jsonTotal
  dv.setUint32(binStart, byteOffset, true)
  dv.setUint32(binStart + 4, 0x004e4942, true)
  let ptr = binStart + 8
  for (const c of chunks) {
    out.set(c, ptr)
    ptr += c.byteLength
  }
  return out
}
