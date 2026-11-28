import {
  createBroadLeaf,
  createChamferBox,
  createCylinder,
  createFoliageCanopy,
  createLeafBlade,
  createOctahedron,
  createPlane,
  createSphere,
  createTaperedPot,
  createTorus,
} from './geometry.js?v=b5r'

/**
 * High-Scale WebGL2 Two-Pass Shadow-Mapped GGX PBR Cleanroom Campus Renderer
 * Features:
 * - Seamless infinite procedural cleanroom terrazzo floor with horizon fog blend
 * - Critically damped SpringCamera with Pan/Orbit modes, zoom-to-cursor & fly-to
 * - Exact screenToGroundRay raycasting & magnetic grid snapping for draggable Group Workshops
 * - Expressive obsidian eye shader modes & rich architectural PBR materials
 */

export const MAT = {
  TERRAZZO: 1,
  FIGURINE: 2,
  ALUMINUM: 3,
  TITANIUM: 4,
  OBSIDIAN: 5,
  EMISSIVE: 6,
  GLASS: 7,
  OAK_WOOD: 8,
  FOLIAGE: 9,
  CERAMIC: 10,
  SHADOW_BLOB: 11,
  GLOW_POOL: 12,
  WOOD_SLAT: 13,
  FABRIC_RUG: 14,
  CODE_SCREEN: 15,
  TRAVERTINE: 16,
  LEAF_RICH: 17,
  VINYL_MATTE: 18,
  CERAMIC_GLAZE: 19,
  CRYSTAL_GLASS: 20,
  BRUSHED_BRASS: 21,
}

export function mat4Identity() {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function mat4Mul(a, b) {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3]
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
  }
  return out
}

export function mat4Translate(x, y, z) {
  const m = mat4Identity()
  m[12] = x; m[13] = y; m[14] = z
  return m
}

export function mat4Scale(x, y, z) {
  const m = mat4Identity()
  m[0] = x; m[5] = y; m[10] = z
  return m
}

export function mat4RotateY(rad) {
  const m = mat4Identity()
  const c = Math.cos(rad), s = Math.sin(rad)
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c
  return m
}

export function mat4RotateX(rad) {
  const m = mat4Identity()
  const c = Math.cos(rad), s = Math.sin(rad)
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c
  return m
}

export function mat4RotateZ(rad) {
  const m = mat4Identity()
  const c = Math.cos(rad), s = Math.sin(rad)
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c
  return m
}

export function TRS(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
  return mat4Mul(mat4Translate(x, y, z), mat4Mul(mat4RotateY(ry), mat4Scale(sx, sy, sz)))
}

export function mat4LookAt(eye, target, up = [0, 1, 0]) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2]
  let len = Math.hypot(zx, zy, zz) || 1
  zx /= len; zy /= len; zz /= len
  let xx = up[1] * zz - up[2] * zy
  let xy = up[2] * zx - up[0] * zz
  let xz = up[0] * zy - up[1] * zx
  len = Math.hypot(xx, xy, xz) || 1
  xx /= len; xy /= len; xz /= len
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx
  const m = new Float32Array(16)
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  m[15] = 1
  return m
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY * 0.5)
  const nf = 1.0 / (near - far)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) * nf
  m[11] = -1
  m[14] = 2 * far * near * nf
  return m
}

export function mat4Ortho(left, right, bottom, top, near, far) {
  const lr = 1 / (left - right), bt = 1 / (bottom - top), nf = 1 / (near - far)
  const m = new Float32Array(16)
  m[0] = -2 * lr; m[5] = -2 * bt; m[10] = 2 * nf
  m[12] = (left + right) * lr
  m[13] = (top + bottom) * bt
  m[14] = (far + near) * nf
  m[15] = 1
  return m
}

export function mat4Invert(a) {
  const out = new Float32Array(16)
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return null
  det = 1.0 / det

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return out
}

export function projectWorldToScreen(worldPos, vp, width, height) {
  const [x, y, z] = worldPos
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12]
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13]
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
  if (cw <= 0.05) return null
  const ndcX = cx / cw
  const ndcY = cy / cw
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
    ndcX,
    ndcY,
  }
}

function unprojectNDC(ndcX, ndcY, ndcZ, invVP) {
  const x = invVP[0] * ndcX + invVP[4] * ndcY + invVP[8] * ndcZ + invVP[12]
  const y = invVP[1] * ndcX + invVP[5] * ndcY + invVP[9] * ndcZ + invVP[13]
  const z = invVP[2] * ndcX + invVP[6] * ndcY + invVP[10] * ndcZ + invVP[14]
  const w = invVP[3] * ndcX + invVP[7] * ndcY + invVP[11] * ndcZ + invVP[15]
  if (Math.abs(w) < 1e-7) return null
  return [x / w, y / w, z / w]
}

/**
 * Raycasts a pointer coordinate onto the horizontal plane y = groundY.
 * Returns { x, y, z, t, origin, dir } or null if ray does not hit forward plane.
 */
export function screenToGroundRay(clientX, clientY, rect, camera, groundY = 0) {
  if (!rect || rect.width <= 0 || rect.height <= 0 || !camera) return null
  const invVP = camera.invVP || (camera.vp ? mat4Invert(camera.vp) : null)
  if (!invVP) return null

  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2

  const nearPt = unprojectNDC(ndcX, ndcY, -1, invVP)
  const farPt = unprojectNDC(ndcX, ndcY, 1, invVP)
  if (!nearPt || !farPt) return null

  const dx = farPt[0] - nearPt[0]
  const dy = farPt[1] - nearPt[1]
  const dz = farPt[2] - nearPt[2]
  if (Math.abs(dy) < 1e-6) return null

  const t = (groundY - nearPt[1]) / dy
  if (t <= 0) return null

  return {
    x: nearPt[0] + dx * t,
    y: groundY,
    z: nearPt[2] + dz * t,
    t,
    origin: nearPt,
    dir: [dx, dy, dz],
  }
}

export function snapToGrid(x, z, gridSize = 0.5) {
  return {
    x: Math.round(x / gridSize) * gridSize,
    z: Math.round(z / gridSize) * gridSize,
  }
}

export function snapGroupToGrid(cx, cz, w = 4, d = 3, gridSize = 0.5) {
  // Snap top-left corner to grid for architectural alignment
  const left = Math.round((cx - w * 0.5) / gridSize) * gridSize
  const top = Math.round((cz - d * 0.5) / gridSize) * gridSize
  return {
    cx: left + w * 0.5,
    cz: top + d * 0.5,
  }
}

/**
 * Critically damped spring step (analytical solution — unconditionally stable, zero overshoot).
 */
function dampSpring(cur, vel, goal, smoothTime, dt) {
  const st = Math.max(0.001, smoothTime)
  const omega = 2.0 / st
  const x = omega * dt
  const exp = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = cur - goal
  const temp = (vel + omega * change) * dt
  const nextVel = (vel - omega * temp) * exp
  const nextVal = goal + (change + temp) * exp
  return [nextVal, nextVel]
}

/**
 * Apple-Grade Critically Damped Spring Camera
 * Supports:
 * - Left-drag Pan (default) or Orbit mode toggle (`camera.mode = 'pan' | 'orbit'`)
 * - Right-drag / Alt+drag / two-finger Orbit
 * - Scroll zoom toward cursor ground point
 * - Smooth fly-to focus & preset transitions
 */
export class SpringCamera {
  constructor(opts = {}) {
    this.yaw = opts.yaw ?? 0.42
    this.pitch = opts.pitch ?? 0.72
    this.dist = opts.dist ?? 26.5
    this.target = [...(opts.target || [2.2, 0.2, 0.2])]

    this.goalYaw = this.yaw
    this.goalPitch = this.pitch
    this.goalDist = this.dist
    this.goalTarget = [...this.target]

    this._velYaw = 0
    this._velPitch = 0
    this._velDist = 0
    this._velTarget = [0, 0, 0]

    this.smoothTime = opts.smoothTime ?? 0.14
    this.fovDeg = opts.fovDeg ?? 35
    this.near = opts.near ?? 0.3
    this.far = opts.far ?? 260.0
    this.minDist = opts.minDist ?? 4.2
    this.maxDist = opts.maxDist ?? 58.0
    this.minPitch = opts.minPitch ?? 0.16
    this.maxPitch = opts.maxPitch ?? 1.48

    this.mode = opts.mode || 'pan' // 'pan' | 'orbit'

    this.eye = [10, 14, 10]
    this.view = mat4Identity()
    this.proj = mat4Identity()
    this.vp = mat4Identity()
    this.invVP = mat4Identity()
  }

  setLimits({ minDist, maxDist, minPitch, maxPitch } = {}) {
    if (minDist !== undefined) this.minDist = minDist
    if (maxDist !== undefined) this.maxDist = maxDist
    if (minPitch !== undefined) this.minPitch = minPitch
    if (maxPitch !== undefined) this.maxPitch = maxPitch
    this.goalDist = Math.max(this.minDist, Math.min(this.maxDist, this.goalDist))
    this.goalPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.goalPitch))
  }

  orbit(dx, dy, sensitivity = 0.0058) {
    this.goalYaw -= dx * sensitivity
    this.goalPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.goalPitch + dy * sensitivity))
  }

  panScreen(dx, dy) {
    const panScale = this.goalDist * 0.00145
    const cy = Math.cos(this.goalYaw)
    const sy = Math.sin(this.goalYaw)
    // Screen right = (cy, 0, -sy); Screen forward on ground = (-sy, 0, -cy)
    this.goalTarget[0] -= (cy * dx + sy * dy) * panScale
    this.goalTarget[2] -= (-sy * dx + cy * dy) * panScale
  }

  panToGroundDelta(prevGround, curGround) {
    if (!prevGround || !curGround) return
    const dx = prevGround.x - curGround.x
    const dz = prevGround.z - curGround.z
    // Clamp extreme horizon jumps when pitching very low
    const maxStep = Math.max(2.0, this.dist * 0.35)
    this.goalTarget[0] += Math.max(-maxStep, Math.min(maxStep, dx))
    this.goalTarget[2] += Math.max(-maxStep, Math.min(maxStep, dz))
  }

  zoomToCursor(deltaY, clientX, clientY, rect, { minDist, maxDist } = {}) {
    const lo = minDist ?? this.minDist
    const hi = maxDist ?? this.maxDist
    const prevDist = this.goalDist
    const factor = Math.exp(deltaY * 0.0011)
    const nextDist = Math.max(lo, Math.min(hi, prevDist * factor))
    const ratio = nextDist / prevDist
    this.goalDist = nextDist

    if (rect && Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const hit = screenToGroundRay(clientX, clientY, rect, this, 0)
      if (hit) {
        const pull = 1 - ratio
        const dx = hit.x - this.goalTarget[0]
        const dz = hit.z - this.goalTarget[2]
        // Keep zoom pull gentle and bounded near horizon
        const distFromTarget = Math.hypot(dx, dz)
        const clampK = distFromTarget > prevDist * 2.5 ? (prevDist * 2.5) / distFromTarget : 1
        this.goalTarget[0] += dx * pull * clampK
        this.goalTarget[2] += dz * pull * clampK
      }
    }
  }

  flyTo(target, { dist, yaw, pitch, instant = false } = {}) {
    if (target) {
      this.goalTarget[0] = target[0]
      this.goalTarget[1] = target[1] ?? this.goalTarget[1]
      this.goalTarget[2] = target[2]
    }
    if (dist !== undefined) this.goalDist = Math.max(this.minDist, Math.min(this.maxDist, dist))
    if (yaw !== undefined) this.goalYaw = yaw
    if (pitch !== undefined) this.goalPitch = Math.max(this.minPitch, Math.min(this.maxPitch, pitch))

    if (instant) {
      this.target = [...this.goalTarget]
      this.dist = this.goalDist
      this.yaw = this.goalYaw
      this.pitch = this.goalPitch
      this._velYaw = this._velPitch = this._velDist = 0
      this._velTarget = [0, 0, 0]
    }
  }

  /**
   * Fits the camera smoothly around a world XZ bounding box { minX, maxX, minZ, maxZ }.
   */
  fitBounds(bounds, { aspect = 1.6, yaw = 0.40, pitch = 0.74, padding = 1.18, instant = false } = {}) {
    if (!bounds) return
    const cx = (bounds.minX + bounds.maxX) * 0.5
    const cz = (bounds.minZ + bounds.maxZ) * 0.5
    const spanX = Math.max(8, bounds.maxX - bounds.minX)
    const spanZ = Math.max(8, bounds.maxZ - bounds.minZ)
    const fovRad = (this.fovDeg * Math.PI) / 180
    const halfTanV = Math.tan(fovRad * 0.5)
    const halfTanH = halfTanV * Math.max(0.8, aspect)
    // Project XZ span onto camera screen axes approximately
    const radius = Math.hypot(spanX * 0.5, spanZ * 0.5)
    const distH = (spanX * 0.52 * padding) / halfTanH
    const distV = (spanZ * 0.55 * padding) / (halfTanV * Math.max(0.45, Math.sin(pitch)))
    const dist = Math.max(12, Math.min(this.maxDist, Math.max(distH, distV, radius * 1.45)))
    this.flyTo([cx, 0.2, cz], { dist, yaw, pitch, instant })
  }

  update(dt, cssW, cssH) {
    const safeDt = Math.min(0.05, Math.max(0.0001, dt || 0.016))
    const st = this.smoothTime

    ;[this.yaw, this._velYaw] = dampSpring(this.yaw, this._velYaw, this.goalYaw, st, safeDt)
    ;[this.pitch, this._velPitch] = dampSpring(this.pitch, this._velPitch, this.goalPitch, st, safeDt)
    ;[this.dist, this._velDist] = dampSpring(this.dist, this._velDist, this.goalDist, st, safeDt)
    for (let i = 0; i < 3; i++) {
      ;[this.target[i], this._velTarget[i]] = dampSpring(this.target[i], this._velTarget[i], this.goalTarget[i], st, safeDt)
    }

    const w = Math.max(1, cssW || 1)
    const h = Math.max(1, cssH || 1)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch)
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw)

    this.eye = [
      this.target[0] + this.dist * cp * sy,
      this.target[1] + this.dist * sp,
      this.target[2] + this.dist * cp * cy,
    ]
    this.view = mat4LookAt(this.eye, this.target, [0, 1, 0])
    this.proj = mat4Perspective((this.fovDeg * Math.PI) / 180, w / h, this.near, this.far)
    this.vp = mat4Mul(this.proj, this.view)
    this.invVP = mat4Invert(this.vp) || mat4Identity()
    return this
  }
}

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}
`

const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}
`

const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;

uniform mat4 uVP;
uniform mat4 uLightVP;
uniform mat4 uModel;

out vec3 vWorldPos;
out vec3 vNormal;
out vec3 vLocalPos;
out vec4 vShadowCoord;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vLocalPos = aPos;
  vNormal = normalize(mat3(uModel) * aNormal);
  vShadowCoord = uLightVP * wp;
  gl_Position = uVP * wp;
}
`

const MAIN_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vLocalPos;
in vec4 vShadowCoord;

uniform vec3 uCamPos;
uniform vec3 uCamTarget;
uniform vec3 uLightDir;
uniform vec3 uBgColor;
uniform float uNight;
uniform float uGolden;
uniform float uTime;
uniform float uFogRange;
uniform float uExposure;

uniform vec3 uBaseColor;
uniform vec3 uEmissive;
uniform int uMatType;
uniform float uAlpha;
uniform float uExtra;

uniform highp sampler2DShadow uShadowMap;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

const vec2 POISSON[16] = vec2[](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725),
  vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464),
  vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420),
  vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590),
  vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
);

float calcShadow(vec4 sc, vec3 N, vec3 L) {
  vec3 proj = sc.xyz / sc.w;
  proj = proj * 0.5 + 0.5;
  if (proj.z > 0.998 || proj.x < 0.002 || proj.x > 0.998 || proj.y < 0.002 || proj.y > 0.998) return 1.0;
  float bias = max(0.0014 * (1.0 - dot(N, L)), 0.00045);
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float sum = 0.0;
  for (int i = 0; i < 16; i++) {
    sum += texture(uShadowMap, vec3(proj.xy + POISSON[i] * texel * 2.0, proj.z - bias));
  }
  return sum / 16.0;
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += vnoise(p) * amp;
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return v;
}

// Inverse of acesFilm: lets fog/background land exactly on the CSS-matched backdrop after post tonemapping.
vec3 invAces(vec3 y) {
  y = clamp(y, 0.0, 0.985);
  vec3 A = 2.51 - 2.43 * y;
  vec3 B = 0.03 - 0.59 * y;
  vec3 C = -0.14 * y;
  return (-B + sqrt(B * B - 4.0 * A * C)) / (2.0 * A);
}

vec3 acesFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  if (uMatType == 11) {
    // Soft radial Gaussian contact shadow / ambient occlusion disc
    float r2 = dot(vLocalPos.xz, vLocalPos.xz) * 4.0;
    float falloff = exp(-r2 * 3.8) * smoothstep(1.0, 0.45, r2);
    vec3 shCol = mix(vec3(0.004, 0.005, 0.008), vec3(0.0005, 0.0007, 0.001), uNight);
    fragColor = vec4(shCol, falloff * uAlpha * 0.85);
    return;
  }
  if (uMatType == 12) {
    // Soft radial emissive light-spill pool (monitor desk glow, 3000K task lamps & cove bounce)
    float r2 = dot(vLocalPos.xz, vLocalPos.xz) * 4.0;
    float falloff = exp(-r2 * 3.6) * smoothstep(1.0, 0.16, r2);
    fragColor = vec4(uEmissive * 0.7, falloff * uAlpha * mix(0.58, 1.0, uNight));
    return;
  }

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(V + L);

  vec3 albedo = pow(uBaseColor, vec3(2.2));
  float metallic = 0.05;
  float roughness = 0.45;
  float clearcoat = 0.0;
  float wrapDiffuse = 0.0;
  vec3 emissive = uEmissive;

  if (uMatType == 1) {
    // Seamless Infinite Cleanroom Anti-Static Terrazzo + Multi-Scale Architectural Grid
    vec2 uv = vWorldPos.xz;
    float distCam = length(vWorldPos.xz - uCamTarget.xz);
    float fleckFade = 1.0 - smoothstep(12.0, 36.0, distCam);

    // Polished micro-topping concrete: large trowel clouds + fine aggregate, darker at night
    float cloud = fbm(uv * 0.21) * 0.62 + fbm(uv * 1.7 + 3.1) * 0.28 + fbm(uv * 9.0) * 0.10;
    float c1 = hash21(floor(uv * 64.0));
    float fleck = (step(0.93, c1) * 0.05 - step(0.965, hash21(floor(uv * 41.0 + 7.3))) * 0.06) * fleckFade;
    albedo = clamp(albedo * (mix(0.84, 1.07, cloud) + fleck * mix(1.0, 0.3, uNight)), 0.008, 0.9);

    // Saw-cut joints every 2m (hairline) and 10m expansion joints (wider, darker)
    vec2 g2 = abs(fract(uv / 2.0 - 0.5) - 0.5) / max(fwidth(uv / 2.0), vec2(0.0005));
    float line2 = 1.0 - clamp(min(g2.x, g2.y) * 1.6, 0.0, 1.0);
    vec2 g10 = abs(fract(uv / 10.0 - 0.5) - 0.5) / max(fwidth(uv / 10.0), vec2(0.0005));
    float line10 = 1.0 - clamp(min(g10.x, g10.y) * 0.8, 0.0, 1.0);
    float gridFade = 1.0 - smoothstep(uFogRange * 0.30, uFogRange * 0.80, distCam);
    float joint = max(line2 * 0.38, line10 * 0.62) * gridFade;
    albedo *= 1.0 - joint * 0.55;
    metallic = 0.0;
    roughness = clamp(mix(0.30, 0.46, cloud) + joint * 0.4, 0.22, 0.9);

    // Golden Hour (晨光) dreamy wide soft-feathered diagonal morning sunbeams (strictly 0 in Night Mode)
    float goldMask = uGolden * smoothstep(0.35, 0.0, uNight);
    if (goldMask > 0.005) {
      float beam1 = 0.5 + 0.5 * sin(uv.x * 0.24 - uv.y * 0.17 + 0.6);
      float beam2 = 0.5 + 0.5 * sin(uv.x * 0.11 - uv.y * 0.08 - 0.9);
      float softSun = smoothstep(0.28, 0.88, beam1 * 0.65 + beam2 * 0.35);
      float sunFade = 1.0 - smoothstep(14.0, 44.0, distCam);
      emissive += vec3(0.11, 0.072, 0.026) * softSun * sunFade * goldMask;
    }
  } else if (uMatType == 2) {
    // Satin Collectible Figurine Shell (Clawd) with subtle studio rim polish
    metallic = 0.05;
    roughness = 0.42 + (vnoise(vLocalPos.xy * 90.0 + vLocalPos.z * 60.0) - 0.5) * 0.06;
    wrapDiffuse = 0.12;
  } else if (uMatType == 3) {
    // Brushed Anodized Aluminum
    metallic = 0.9;
    roughness = 0.28 + (vnoise(vec2(vLocalPos.x * 400.0, vLocalPos.y * 6.0)) - 0.5) * 0.08;
  } else if (uMatType == 4) {
    // Dark Gunmetal Titanium
    metallic = 0.85;
    roughness = 0.36 + (vnoise(vLocalPos.xz * 30.0) - 0.5) * 0.08;
  } else if (uMatType == 5) {
    // Smoked Obsidian Eye Screen with Expressive States
    metallic = 0.12;
    roughness = 0.06;
    if (vLocalPos.z > 0.0) {
      if (uExtra > 8.5) {
        // 9: Reading / workspace_confirm — horizontal cyan scan bar
        float sweep = sin(uTime * 3.8) * 0.32;
        float bar = smoothstep(0.18, 0.02, abs(vLocalPos.y - sweep));
        emissive += vec3(0.15, 1.75, 2.55) * (0.25 + 0.85 * bar);
      } else if (uExtra > 7.5) {
        // 8: Auth expired — dim pulsing red lock bar
        float p = 0.45 + 0.55 * sin(uTime * 5.2);
        if (abs(vLocalPos.y) < 0.14) emissive += vec3(2.8, 0.22, 0.18) * p;
      } else if (uExtra > 6.5) {
        // 7: Celebrate done — emerald happy chevron ^
        float v = abs(vLocalPos.y - (0.14 - abs(vLocalPos.x) * 0.9));
        if (v < 0.09) emissive += vec3(0.20, 2.85, 1.05);
      } else if (uExtra > 5.5) {
        // 6: Recharge nap — calm sleepy horizontal slit
        if (abs(vLocalPos.y + 0.06) < 0.055) emissive += vec3(0.25, 1.45, 0.95) * 0.7;
      } else if (uExtra > 4.5) {
        // 5: Question ask — warm amber-gold curious pip
        float p = 0.7 + 0.3 * sin(uTime * 4.5);
        if (abs(vLocalPos.y - 0.05) < 0.15 && abs(vLocalPos.x) < 0.22) emissive += vec3(2.5, 1.75, 0.25) * p;
      } else if (uExtra > 3.5) {
        // 4: Thinking — pulsing indigo-violet neural dot
        float p = 0.5 + 0.5 * sin(uTime * 3.6 + vLocalPos.y * 6.0);
        emissive += vec3(0.55, 0.48, 2.65) * (0.35 + 0.65 * p);
      } else if (uExtra > 2.5) {
        // 3: Error spark — red X eyes
        float cross1 = abs(vLocalPos.x * 1.9 - vLocalPos.y);
        float cross2 = abs(vLocalPos.x * 1.9 + vLocalPos.y);
        if (min(cross1, cross2) < 0.065) emissive += vec3(3.4, 0.25, 0.20);
      } else if (uExtra > 1.5) {
        // 2: Approval raise — amber alert pip
        float p = 0.65 + 0.35 * sin(uTime * 6.0);
        if (abs(vLocalPos.y) < 0.12 && abs(vLocalPos.x) < 0.14) emissive += vec3(3.0, 1.45, 0.15) * p;
      } else if (uExtra > 0.5) {
        // 1: Typing / running — cyan terminal scanlines
        float scan = step(0.3, sin(vLocalPos.y * 45.0 - uTime * 8.0));
        emissive += vec3(0.15, 1.35, 2.2) * (0.35 + 0.45 * scan);
      }
    }
  } else if (uMatType == 6) {
    roughness = 0.20;
    metallic = 0.0;
  } else if (uMatType == 7) {
    metallic = 0.08;
    roughness = 0.14;
  } else if (uMatType == 8) {
    // Warm Light Oak Lounge Furniture
    metallic = 0.02;
    roughness = 0.50;
    float grain = sin(vLocalPos.x * 40.0 + sin(vLocalPos.z * 12.0) * 2.0) * 0.025;
    albedo = clamp(albedo + vec3(grain, grain * 0.7, 0.0), 0.02, 0.95);
  } else if (uMatType == 9) {
    // Minimalist Matte Botanical Foliage
    metallic = 0.0;
    roughness = 0.68;
  } else if (uMatType == 10) {
    // Matte Cleanroom Ceramic (Mugs, Planters, Recharge Pods)
    metallic = 0.02;
    roughness = 0.28;
  } else if (uMatType == 13) {
    // Vertical Warm Oak Acoustic Slat Paneling with Deep Felt Groove Shading
    float uAxis = abs(N.z) > 0.5 ? vWorldPos.x : vWorldPos.z;
    float slatCoord = uAxis * 11.5;
    float slatIdx = floor(slatCoord);
    float slatF = fract(slatCoord);
    float fw = max(fwidth(slatCoord), 0.02);
    // 68% oak slat, 32% recessed dark charcoal acoustic felt groove
    float slatMask = smoothstep(0.16 - fw, 0.16 + fw, slatF) * (1.0 - smoothstep(0.84 - fw, 0.84 + fw, slatF));
    float edgeBevel = smoothstep(0.16, 0.24, slatF) * (1.0 - smoothstep(0.76, 0.84, slatF));
    float slatTone = 0.90 + hash21(vec2(slatIdx, 3.7)) * 0.20;
    float grain = sin(vWorldPos.y * 22.0 + sin(uAxis * 42.0 + slatIdx) * 1.5) * 0.032;
    vec3 oakFace = clamp(albedo * slatTone * mix(0.76, 1.04, edgeBevel) + vec3(grain, grain * 0.68, 0.0), 0.02, 0.95);
    vec3 feltGroove = vec3(0.022, 0.024, 0.028);
    albedo = mix(feltGroove, oakFace, slatMask);
    metallic = 0.02;
    roughness = mix(0.92, 0.46, slatMask);
  } else if (uMatType == 14) {
    // Woven Wool Area Rug & Boucle Upholstery Fabric
    vec2 uv = vWorldPos.xz;
    float fw = max(fwidth(uv.x), fwidth(uv.y));
    float weaveFade = 1.0 - smoothstep(0.004, 0.02, fw);
    float weave = sin(uv.x * 86.0) * sin(uv.y * 86.0) * 0.042 * weaveFade;
    float crossThread = sin((uv.x + uv.y) * 52.0) * 0.020 * weaveFade;
    float tuft = (vnoise(uv * 22.0) - 0.5) * 0.06;
    float border = smoothstep(0.41, 0.44, max(abs(vLocalPos.x), abs(vLocalPos.z)));
    albedo = clamp(albedo * (1.0 + weave + crossThread + tuft) * mix(1.0, 0.88, border), 0.015, 0.95);
    metallic = 0.0;
    roughness = 0.90;
    // Soft wool/velvet grazing sheen
    float sheen = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    emissive += albedo * sheen * 0.03;
    // Subtle Golden Hour soft diagonal morning sunlight sheen across woven rugs (strictly 0 in Night Mode)
    float rugGold = uGolden * smoothstep(0.35, 0.0, uNight);
    if (rugGold > 0.005) {
      float beam = smoothstep(0.25, 0.85, 0.5 + 0.5 * sin(uv.x * 0.28 - uv.y * 0.20 + 0.4));
      emissive += vec3(0.09, 0.058, 0.020) * beam * rugGold;
    }
  } else if (uMatType == 15) {
    // Realistic Dark IDE Monitor Screen with Scrolling Syntax-Colored Code Lines
    vec3 statusTint = uEmissive;
    emissive = vec3(0.0);
    albedo = vec3(0.012, 0.016, 0.024);
    metallic = 0.08;
    roughness = 0.08;
    if (vLocalPos.z > -0.15) {
      vec2 sp = vLocalPos.xy; // [-0.5, 0.5]
      // Base IDE dark chrome panel glow
      vec3 screenGlow = vec3(0.028, 0.036, 0.054);
      // Top macOS title / tab bar
      if (sp.y > 0.37) {
        screenGlow = vec3(0.055, 0.068, 0.095);
        // 3 window dots on top-left
        float d1 = length((sp - vec2(-0.43, 0.435)) * vec2(1.0, 1.8));
        float d2 = length((sp - vec2(-0.38, 0.435)) * vec2(1.0, 1.8));
        float d3 = length((sp - vec2(-0.33, 0.435)) * vec2(1.0, 1.8));
        if (d1 < 0.024) screenGlow = vec3(1.5, 0.35, 0.30);
        else if (d2 < 0.024) screenGlow = vec3(1.5, 1.05, 0.22);
        else if (d3 < 0.024) screenGlow = vec3(0.28, 1.35, 0.55);
        // Active editor tab highlight
        if (sp.x > -0.22 && sp.x < 0.08 && sp.y < 0.46) {
          screenGlow = vec3(0.11, 0.14, 0.20);
        }
      } else if (sp.y < -0.39) {
        // Bottom IDE status bar subtly tinted by agent status color
        vec3 barCol = length(statusTint) > 0.05 ? normalize(statusTint) * 0.65 : vec3(0.10, 0.48, 0.85);
        screenGlow = barCol * mix(0.85, 1.15, uNight);
      } else if (sp.x < -0.28) {
        // Left file-tree sidebar
        screenGlow = vec3(0.022, 0.028, 0.042);
        float rowIdx = floor((0.36 - sp.y) * 16.0);
        float rowF = fract((0.36 - sp.y) * 16.0);
        float fLen = 0.07 + hash21(vec2(rowIdx, 5.1 + uExtra)) * 0.09;
        if (rowF > 0.30 && rowF < 0.68 && sp.x > -0.44 && sp.x < -0.44 + fLen) {
          screenGlow = vec3(0.26, 0.34, 0.46);
        }
      } else {
        // Main scrolling code editor pane
        float scroll = uTime * 0.55 + uExtra * 3.7;
        float lineCoord = (0.35 - sp.y) * 18.0 + scroll;
        float lineIdx = floor(lineCoord);
        float lineF = fract(lineCoord);
        if (lineF > 0.26 && lineF < 0.72) {
          float h1 = hash21(vec2(lineIdx, 1.3));
          float h2 = hash21(vec2(lineIdx, 7.9));
          float h3 = hash21(vec2(lineIdx, 13.7));
          float indent = floor(h1 * 3.5) * 0.055;
          float xStart = -0.23 + indent;
          float seg1End = xStart + 0.07 + h2 * 0.09;
          float seg2End = seg1End + 0.025 + 0.08 + h3 * 0.16;
          float seg3End = seg2End + 0.025 + (h1 > 0.35 ? 0.06 + h2 * 0.14 : 0.0);
          if (sp.x > xStart && sp.x < min(0.45, seg1End)) {
            // Keyword: violet or coral
            screenGlow = h3 > 0.45 ? vec3(0.85, 0.48, 1.35) : vec3(1.25, 0.52, 0.42);
          } else if (sp.x > seg1End + 0.02 && sp.x < min(0.45, seg2End)) {
            // Identifier / function: bright cyan-blue
            screenGlow = vec3(0.28, 1.15, 1.55);
          } else if (sp.x > seg2End + 0.02 && sp.x < min(0.45, seg3End)) {
            // String / constant: emerald or warm amber
            screenGlow = h2 > 0.42 ? vec3(0.32, 1.28, 0.72) : vec3(1.45, 0.96, 0.32);
          }
          // Subtle blinking cursor near middle line
          if (abs(sp.y - 0.04) < 0.032 && abs(sp.x - (xStart + 0.22)) < 0.014) {
            float blink = step(0.45, fract(uTime * 1.4));
            screenGlow = mix(screenGlow, vec3(1.4, 1.6, 1.8), blink);
          }
        }
      }
      emissive = screenGlow * mix(1.05, 1.35, uNight);
    }
  } else if (uMatType == 16) {
    // Warm Porous Architectural Travertine Stone
    float vein = sin(vWorldPos.y * 26.0 + sin(vWorldPos.x * 5.5 + vWorldPos.z * 5.5) * 1.35) * 0.042;
    float band = sin(vWorldPos.y * 9.0 + vWorldPos.x * 2.2) * 0.025;
    float pore = step(0.86, hash21(floor(vWorldPos.xy * 34.0 + vWorldPos.z * 17.0))) * 0.075;
    albedo = clamp(albedo * (1.0 + vein + band - pore), 0.03, 0.96);
    metallic = 0.02;
    roughness = clamp(0.64 + pore * 1.8, 0.55, 0.88);
  } else if (uMatType == 17) {
    // Rich Deep-Green Botanical Foliage: forest-emerald core -> sunlit olive -> fresh shoot tips
    float upMask = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    float dapple = sin(vWorldPos.x * 16.0 + vWorldPos.z * 15.0 + uExtra * 4.0) * cos(vWorldPos.y * 18.0);
    vec3 coreGreen = albedo * vec3(0.48, 0.66, 0.44);
    vec3 midOlive = albedo * vec3(0.95, 1.15, 0.78);
    vec3 shootTip = albedo * vec3(1.28, 1.48, 0.88);
    float hMix = clamp(upMask * 0.78 + dapple * 0.16 + 0.10, 0.0, 1.0);
    albedo = hMix < 0.65
      ? mix(coreGreen, midOlive, hMix / 0.65)
      : mix(midOlive, shootTip, (hMix - 0.65) / 0.35);
    albedo = clamp(albedo, vec3(0.012, 0.028, 0.010), vec3(0.55, 0.72, 0.38));
    // Subtle AC breeze shimmer
    float shimmer = sin(uTime * 2.1 + vWorldPos.x * 2.8 + vWorldPos.z * 2.4 + uExtra) * 0.032;
    albedo = clamp(albedo * (1.0 + shimmer), 0.01, 0.85);
    // Warm sunlit chlorophyll subsurface translucency (no washed-out silver reflection)
    float backLit = pow(clamp(dot(-L, V), 0.0, 1.0), 2.2) * 0.30 + max(dot(N, L), 0.0) * 0.14;
    emissive += vec3(0.10, 0.24, 0.04) * backLit * (1.0 - uNight * 0.72);
    metallic = 0.0;
    roughness = 0.70;
  } else if (uMatType == 18) {
    // Pop Mart / Teenage Engineering Soft-Touch Satin Vinyl
    float stipple = hash21(floor(vLocalPos.xy * 180.0 + vLocalPos.z * 115.0)) - 0.5;
    metallic = 0.03;
    // Soft-touch PVC: satin micro-texture, faint mold-line low-freq variation, slight subsurface wrap
    float pvc = vnoise(vLocalPos.xy * 14.0 + vLocalPos.z * 9.0);
    roughness = clamp(0.48 + stipple * 0.06 + (pvc - 0.5) * 0.08, 0.38, 0.6);
    albedo *= 0.97 + pvc * 0.05;
    wrapDiffuse = 0.18;
  } else if (uMatType == 19) {
    // High-Gloss Clearcoat Porcelain Glaze (Dual-Lobe Specular + Crisp Studio Softbox Reflection)
    metallic = 0.02;
    roughness = 0.14;
    clearcoat = 1.0;
    wrapDiffuse = 0.08;
    roughness = 0.14 + (vnoise(vLocalPos.xy * 40.0) - 0.5) * 0.04;
  } else if (uMatType == 20) {
    // Translucent Colored Frosted / Faceted Crystal Glass with Rich Prism Dispersion & Specular Sparkle
    metallic = 0.10;
    roughness = 0.042;
    clearcoat = 1.0;
    float fres = pow(1.0 - abs(dot(N, V)), 1.9);
    float backScatter = pow(clamp(dot(-L, V), 0.0, 1.0), 1.8);
    float glint = pow(max(dot(N, H), 0.0), 96.0);
    vec3 prismDisp = vec3(1.24, 1.08, 1.48) * fres;
    albedo = clamp(albedo * 1.18, vec3(0.03), vec3(0.96));
    emissive += albedo * (0.14 + 0.22 * backScatter)
      + mix(albedo, vec3(0.88, 0.98, 1.0), 0.52) * prismDisp * 0.35
      + vec3(1.45, 1.52, 1.65) * glint * 0.6;
  } else if (uMatType == 21) {
    // Warm Champagne Brushed Brass with Crisp Anisotropic Micro-Brush Sheen & Studio Specular Pop
    float brush = sin(vLocalPos.x * 160.0 + vLocalPos.y * 24.0 + vLocalPos.z * 80.0) * 0.5 + 0.5;
    float micro = (hash21(floor(vec2(vLocalPos.x * 120.0, vLocalPos.y * 32.0))) - 0.5) * 0.05;
    metallic = 0.95;
    roughness = clamp(0.18 + (brush - 0.5) * 0.06 + micro, 0.12, 0.27);
    clearcoat = 0.35;
    float sheen = pow(1.0 - max(dot(N, V), 0.0), 2.8) * (0.68 + 0.32 * brush);
    float brassGlint = pow(max(dot(N, H), 0.0), 42.0) * (0.7 + 0.3 * brush);
    emissive += albedo * vec3(1.18, 0.96, 0.62) * (sheen * 0.04 + brassGlint * 0.12);
  }

  float NdotL = max(dot(N, L), 0.0);
  float NdotL_diff = wrapDiffuse > 0.001
    ? max((dot(N, L) + wrapDiffuse) / (1.0 + wrapDiffuse), 0.0)
    : NdotL;
  float NdotV = max(dot(N, V), 0.001);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);

  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / max(3.14159265 * denom * denom, 0.0001);

  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float G = (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));

  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
  if (clearcoat > 0.01) {
    float ccR = 0.042;
    float ccA = ccR * ccR;
    float ccA2 = ccA * ccA;
    float ccDen = NdotH * NdotH * (ccA2 - 1.0) + 1.0;
    float ccD = ccA2 / max(3.14159265 * ccDen * ccDen, 0.0001);
    float ccF = 0.05 + (1.0 - 0.05) * pow(1.0 - VdotH, 5.0);
    float ccK = (ccR + 1.0) * (ccR + 1.0) / 8.0;
    float ccG = (NdotV / (NdotV * (1.0 - ccK) + ccK)) * (NdotL / (NdotL * (1.0 - ccK) + ccK));
    specular += vec3((ccD * ccG * ccF) / max(4.0 * NdotV * NdotL, 0.001)) * clearcoat * 1.42;
  }
  vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);

  float shadow = calcShadow(vShadowCoord, N, L);
  float shadowFactor = shadow;

  vec3 dayRadiance = mix(vec3(2.55, 2.50, 2.42), vec3(3.15, 2.25, 1.52), uGolden);
  vec3 keyRadiance = mix(dayRadiance, vec3(0.46, 0.56, 0.78), uNight);
  vec3 Lo = (kD * albedo * NdotL_diff / 3.14159265 + specular * NdotL) * keyRadiance * shadowFactor;

  vec3 L2 = normalize(vec3(-0.65, 0.55, -0.52));
  vec3 H2 = normalize(V + L2);
  float NdotL2 = max(dot(N, L2), 0.0);
  float NdotH2 = max(dot(N, H2), 0.0);
  float denom2 = NdotH2 * NdotH2 * (a2 - 1.0) + 1.0;
  float D2 = a2 / max(3.14159265 * denom2 * denom2, 0.0001);
  vec3 dayRim = mix(vec3(0.85, 0.92, 1.05), vec3(0.95, 0.80, 0.68), uGolden);
  vec3 rimRad = mix(dayRim, vec3(0.30, 0.42, 0.66), uNight);
  Lo += (kD * albedo * 0.10 + F * D2 * 0.10) * rimRad * NdotL2;

  float skyUp = N.y * 0.5 + 0.5;
  vec3 daySky = mix(vec3(0.95, 0.96, 0.99), vec3(1.04, 0.88, 0.74), uGolden);
  vec3 skyCol = mix(daySky, vec3(0.08, 0.10, 0.15), uNight);
  vec3 dayGround = mix(vec3(0.52, 0.50, 0.48), vec3(0.62, 0.49, 0.37), uGolden);
  vec3 groundCol = mix(dayGround, vec3(0.038, 0.045, 0.064), uNight);
  vec3 irradiance = mix(groundCol, skyCol, skyUp);

  vec3 R = reflect(-V, N);
  float softbox1 = smoothstep(0.55, 0.92, R.y) * smoothstep(0.65, 0.15, abs(R.x * 0.5)) * smoothstep(0.65, 0.15, abs(R.z * 0.5));
  vec3 envSpec = mix(groundCol, skyCol * 1.25, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  envSpec += vec3(1.75, 1.78, 1.85) * softbox1 * (1.0 - roughness * 0.82) * mix(1.0, 0.35, uNight);

  vec3 F_ibl = F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - NdotV, 5.0);
  vec3 ccIbl = vec3(0.0);
  if (clearcoat > 0.01) {
    float softboxCC = smoothstep(0.68, 0.94, R.y) * smoothstep(0.46, 0.10, abs(R.x * 0.58)) * smoothstep(0.46, 0.10, abs(R.z * 0.58));
    float sideBoxCC = smoothstep(0.60, 0.92, R.x) * smoothstep(0.48, 0.10, abs(R.y - 0.36));
    float ccFres = 0.05 + (1.0 - 0.05) * pow(1.0 - NdotV, 5.0);
    ccIbl = (vec3(2.95, 2.98, 3.05) * softboxCC + vec3(1.65, 1.72, 1.85) * sideBoxCC * 0.65) * (0.30 + 0.70 * ccFres) * clearcoat * mix(1.0, 0.45, uNight);
  }
  vec3 ambient = ((1.0 - F_ibl) * (1.0 - metallic) * albedo * irradiance + F_ibl * envSpec * (1.0 - roughness * 0.45)) * 0.55 + ccIbl;

  float groundAO = mix(0.72, 1.0, clamp(vWorldPos.y * 2.4, 0.0, 1.0));
  if (uMatType == 1) groundAO = 1.0;

  vec3 mapped = (Lo + ambient) * groundAO + emissive;
  vec3 bgLin = invAces(pow(uBgColor, vec3(2.2))) / uExposure;

  // Seamless studio horizon fog for the infinite cleanroom floor & distant objects
  float horzDist = length(vWorldPos.xz - uCamTarget.xz);
  float fogStart = uFogRange * 0.45;
  float fogEnd = uFogRange * 0.96;
  float fogAmt = smoothstep(fogStart, fogEnd, horzDist);
  if (uMatType == 1) {
    mapped = mix(mapped, bgLin, fogAmt);
  } else {
    mapped = mix(mapped, bgLin, fogAmt * 0.65);
  }

  float outAlpha = uAlpha;
  if (uMatType == 7) {
    float fres = pow(1.0 - abs(dot(N, V)), 3.0);
    outAlpha = clamp(uAlpha + fres * 0.36, 0.0, 0.88);
    mapped = mix(mapped, vec3(0.95, 0.98, 1.0) * 0.8, fres * 0.30);
    // Apple-Park delicate frosted privacy manifestation band when uExtra > 0.5
    if (uExtra > 0.5) {
      float band = 1.0 - smoothstep(0.075, 0.095, abs(vLocalPos.y - 0.04));
      float dotPattern = 0.78 + 0.22 * sin(vWorldPos.x * 58.0 + vWorldPos.z * 58.0);
      outAlpha = clamp(outAlpha + band * 0.24 * dotPattern, 0.0, 0.88);
      mapped = mix(mapped, mix(vec3(0.85, 0.87, 0.9), vec3(0.18, 0.23, 0.3), uNight), band * 0.52 * dotPattern);
    }
  } else if (uMatType == 20) {
    float fres = pow(1.0 - abs(dot(N, V)), 2.5);
    if (uAlpha < 0.99) {
      outAlpha = clamp(uAlpha * 0.78 + fres * 0.42, 0.32, 0.96);
    }
    mapped = mix(mapped, vec3(0.92, 0.97, 1.0) * 0.8, fres * 0.30);
  }
  fragColor = vec4(mapped, outAlpha);
}
`


const FS_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

// Scalable Ambient Obscurance (McGuire 2012) on the resolved depth buffer. Output: R = AO, G = view depth.
const SSAO_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform vec2 uRes;
uniform float uProjScale;
uniform float uRadius;
uniform float uIntensity;
uniform float uBias;
out vec4 outAO;

vec3 viewPos(vec2 uv) {
  float d = texture(uDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

void main() {
  float d0 = texture(uDepth, vUv).r;
  if (d0 >= 0.99999) { outAO = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 C = viewPos(vUv);
  vec2 px = 1.0 / uRes;
  vec3 r = viewPos(vUv + vec2(px.x, 0.0)) - C, l = C - viewPos(vUv - vec2(px.x, 0.0));
  vec3 t = viewPos(vUv + vec2(0.0, px.y)) - C, b = C - viewPos(vUv - vec2(0.0, px.y));
  vec3 n = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(t.z) < abs(b.z) ? t : b));

  const int N = 16;
  float R = uRadius;
  float R2 = R * R;
  float ssR = R * uProjScale / -C.z;
  float rnd = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float a = (float(i) + 0.5) / float(N);
    float ang = a * 43.98 + rnd;
    vec2 off = vec2(cos(ang), sin(ang)) * ssR * a;
    vec3 v = viewPos(vUv + off * px) - C;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - uBias) / (0.01 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - sum * uIntensity * 5.0 / (float(N) * R2 * R2 * R2));
  outAO = vec4(ao, -C.z, 0.0, 1.0);
}
`

const AO_BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 outAO;
void main() {
  vec2 c = texture(uSrc, vUv).rg;
  float sum = c.r * 0.2;
  float wsum = 0.2;
  for (int i = -4; i <= 4; i++) {
    if (i == 0) continue;
    vec2 s = texture(uSrc, vUv + uDir * float(i) * 1.5).rg;
    float w = exp(-float(i * i) * 0.08) * max(0.0, 1.0 - abs(s.g - c.g) / (c.g * 0.04 + 0.02));
    sum += s.r * w;
    wsum += w;
  }
  outAO = vec4(sum / wsum, c.g, 0.0, 1.0);
}
`

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0);
  soft = soft * soft * 0.5;
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  outColor = vec4(min(c * contrib, vec3(24.0)), 1.0);
}
`

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270;
  c += (texture(uSrc, vUv + uDir * 1.3846154).rgb + texture(uSrc, vUv - uDir * 1.3846154).rgb) * 0.3162162;
  c += (texture(uSrc, vUv + uDir * 3.2307692).rgb + texture(uSrc, vUv - uDir * 3.2307692).rgb) * 0.0702703;
  outColor = vec4(c, 1.0);
}
`

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uAO;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform float uAOStrength;
uniform float uBloom;
uniform float uTime;
uniform float uNight;
uniform float uExposure;
out vec4 fragColor;

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float ao = texture(uAO, vUv).r;
  c *= mix(1.0, ao, uAOStrength);
  c += (texture(uBloomA, vUv).rgb * 0.6 + texture(uBloomB, vUv).rgb * 0.4) * uBloom;
  vec3 m = acesFilm(c * uExposure);
  // Gentle photographic grade: a touch less saturation, lifted toe kept neutral
  float lum = dot(m, vec3(0.2126, 0.7152, 0.0722));
  m = mix(vec3(lum), m, mix(0.9, 0.96, uNight));
  m = pow(m, vec3(1.0 / 2.2));
  vec2 q = vUv - 0.5;
  m *= 1.0 - dot(q, q) * mix(0.22, 0.38, uNight);
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  m += (g - 0.5) * (1.6 / 255.0);
  fragColor = vec4(m, 1.0);
}
`

function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type)
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'Shader compile failed')
    }
    return sh
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || 'Program link failed')
  }
  return prog
}

/**
 * Renders the seamless infinite procedural cleanroom terrazzo floor centered dynamically
 * on the camera target so it never runs out regardless of pan or appended groups.
 */
export function renderInfiniteFloor(renderer, camera, nightBlend = 0, options = {}) {
  const target = camera?.target || [0, 0, 0]
  const dist = camera?.dist ?? 20
  const floorSize = Math.max(180, dist * 9.5)
  const goldenBlend = options.goldenBlend ?? 0
  const studioDay = options.dayColor || [0.80, 0.79, 0.765]
  const goldenDay = options.goldenColor || [0.84, 0.79, 0.72]
  const dayCol = [
    studioDay[0] * (1 - goldenBlend) + goldenDay[0] * goldenBlend,
    studioDay[1] * (1 - goldenBlend) + goldenDay[1] * goldenBlend,
    studioDay[2] * (1 - goldenBlend) + goldenDay[2] * goldenBlend,
  ]
  // Deep nocturnal charcoal-slate (#222732 feel after ACES + gamma) for jewel-box pavilion contrast
  const nightCol = options.nightColor || [0.105, 0.122, 0.158]
  const col = [
    dayCol[0] * (1 - nightBlend) + nightCol[0] * nightBlend,
    dayCol[1] * (1 - nightBlend) + nightCol[1] * nightBlend,
    dayCol[2] * (1 - nightBlend) + nightCol[2] * nightBlend,
  ]

  renderer.add(
    'plane',
    TRS(target[0], -0.002, target[2], 0, floorSize, 1, floorSize),
    col,
    MAT.TERRAZZO,
    [0, 0, 0],
    1.0,
    0.0,
    false,
  )
}

export class CleanroomRenderer {
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('WebGL2 not supported')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not supported')
    this.gl = gl
    this._initPost()

    this.shadowProg = compileProgram(gl, SHADOW_VS, SHADOW_FS)
    this.mainProg = compileProgram(gl, MAIN_VS, MAIN_FS)

    this.sLoc = {
      uLightVP: gl.getUniformLocation(this.shadowProg, 'uLightVP'),
      uModel: gl.getUniformLocation(this.shadowProg, 'uModel'),
    }

    this.mLoc = {
      uVP: gl.getUniformLocation(this.mainProg, 'uVP'),
      uLightVP: gl.getUniformLocation(this.mainProg, 'uLightVP'),
      uModel: gl.getUniformLocation(this.mainProg, 'uModel'),
      uCamPos: gl.getUniformLocation(this.mainProg, 'uCamPos'),
      uCamTarget: gl.getUniformLocation(this.mainProg, 'uCamTarget'),
      uLightDir: gl.getUniformLocation(this.mainProg, 'uLightDir'),
      uBgColor: gl.getUniformLocation(this.mainProg, 'uBgColor'),
      uNight: gl.getUniformLocation(this.mainProg, 'uNight'),
      uGolden: gl.getUniformLocation(this.mainProg, 'uGolden'),
      uTime: gl.getUniformLocation(this.mainProg, 'uTime'),
      uFogRange: gl.getUniformLocation(this.mainProg, 'uFogRange'),
      uExposure: gl.getUniformLocation(this.mainProg, 'uExposure'),
      uBaseColor: gl.getUniformLocation(this.mainProg, 'uBaseColor'),
      uEmissive: gl.getUniformLocation(this.mainProg, 'uEmissive'),
      uMatType: gl.getUniformLocation(this.mainProg, 'uMatType'),
      uAlpha: gl.getUniformLocation(this.mainProg, 'uAlpha'),
      uExtra: gl.getUniformLocation(this.mainProg, 'uExtra'),
      uShadowMap: gl.getUniformLocation(this.mainProg, 'uShadowMap'),
    }

    this.meshes = {}
    this._initMeshes()
    this._initShadowFBO(4096)

    this.opaqueQueue = []
    this.transQueue = []
  }

  _uploadMesh(name, geo) {
    const { gl } = this
    const prev = this.meshes[name]
    if (prev) {
      if (prev.vao) gl.deleteVertexArray(prev.vao)
      if (prev.posBuf) gl.deleteBuffer(prev.posBuf)
      if (prev.nrmBuf) gl.deleteBuffer(prev.nrmBuf)
      if (prev.idxBuf) gl.deleteBuffer(prev.idxBuf)
    }

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    const posBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)

    const nrmBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf)
    gl.bufferData(gl.ARRAY_BUFFER, geo.normals, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)

    const idxBuf = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW)

    gl.bindVertexArray(null)
    const indexType = geo.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    this.meshes[name] = { vao, posBuf, nrmBuf, idxBuf, count: geo.indices.length, indexType }
    return this.meshes[name]
  }

  uploadMesh(name, geo) {
    return this._uploadMesh(name, geo)
  }

  hasMesh(name) {
    return Boolean(this.meshes[name])
  }

  _initMeshes() {
    this._uploadMesh('plane', createPlane(1, 1))
    this._uploadMesh('slab', createChamferBox(1, 1, 1, 0.012))
    this._uploadMesh('bevelBox', createChamferBox(1, 1, 1, 0.042))
    this._uploadMesh('fastBox', createChamferBox(1, 1, 1, 0.0))
    this._uploadMesh('softBox', createChamferBox(1, 1, 1, 0.11))
    this._uploadMesh('pillBox', createChamferBox(1, 1, 1, 0.22))
    this._uploadMesh('sharpBox', createChamferBox(1, 1, 1, 0.0))
    this._uploadMesh('cyl', createCylinder(0.5, 0.5, 1, 24))
    this._uploadMesh('cone', createCylinder(0.18, 0.5, 1, 20))
    this._uploadMesh('ribbedPot', createTaperedPot(0.5, 0.38, 1, 32, 16, 0.022))
    this._uploadMesh('leafBlade', createLeafBlade(0.34, 0.78, 0.22, 6))
    this._uploadMesh('broadLeaf', createBroadLeaf(0.56, 0.72, 0.24, 6))
    this._uploadMesh('foliageCluster', createFoliageCanopy(0.5, 9, 14))
    this._uploadMesh('torus', createTorus(0.5, 0.075, 28, 10))
    this._uploadMesh('thinTorus', createTorus(0.5, 0.032, 32, 8))
    this._uploadMesh('sphere', createSphere(0.5, 10, 16))
    this._uploadMesh('octa', createOctahedron(0.5))
  }

  _initShadowFBO(size) {
    const { gl } = this
    this.shadowSize = size
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    this.shadowTex = tex
    this.shadowFBO = fbo
  }

  _initPost() {
    const { gl } = this
    const mk = (fs, names) => {
      const prog = compileProgram(gl, FS_VS, fs)
      const loc = {}
      for (const n of names) loc[n] = gl.getUniformLocation(prog, n)
      return { prog, loc }
    }
    this.post = {
      ssao: mk(SSAO_FS, ['uDepth', 'uInvProj', 'uRes', 'uProjScale', 'uRadius', 'uIntensity', 'uBias']),
      aoBlur: mk(AO_BLUR_FS, ['uSrc', 'uDir']),
      bright: mk(BRIGHT_FS, ['uSrc', 'uTexel', 'uThreshold']),
      blur: mk(BLUR_FS, ['uSrc', 'uDir']),
      composite: mk(COMPOSITE_FS, ['uScene', 'uAO', 'uBloomA', 'uBloomB', 'uAOStrength', 'uBloom', 'uTime', 'uNight', 'uExposure']),
    }
    this.emptyVao = gl.createVertexArray()
    this.targets = null
  }

  _makeTarget(w, h, internal, format, type, filter = this.gl.LINEAR) {
    const { gl } = this
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    const attach = format === gl.DEPTH_COMPONENT ? gl.DEPTH_ATTACHMENT : gl.COLOR_ATTACHMENT0
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, tex, 0)
    return { tex, fbo, w, h }
  }

  _ensureTargets(w, h) {
    const { gl } = this
    const t = this.targets
    if (t && t.w === w && t.h === h) return t
    if (t) {
      for (const k of ['scene', 'depth', 'ao', 'aoTmp', 'bA', 'bAt', 'bB', 'bBt']) {
        gl.deleteTexture(t[k].tex)
        gl.deleteFramebuffer(t[k].fbo)
      }
      gl.deleteFramebuffer(t.msFbo)
      gl.deleteRenderbuffer(t.msColor)
      gl.deleteRenderbuffer(t.msDepth)
    }
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES))
    const msFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo)
    const msColor = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor)
    const msDepth = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth)

    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1)
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2)
    const ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3)
    this.targets = {
      w, h, msFbo, msColor, msDepth,
      scene: this._makeTarget(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      depth: this._makeTarget(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST),
      ao: this._makeTarget(hw, hh, gl.RG16F, gl.RG, gl.HALF_FLOAT),
      aoTmp: this._makeTarget(hw, hh, gl.RG16F, gl.RG, gl.HALF_FLOAT),
      bA: this._makeTarget(qw, qh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      bAt: this._makeTarget(qw, qh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      bB: this._makeTarget(ew, eh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
      bBt: this._makeTarget(ew, eh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT),
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.targets
  }

  _pass(pass, target, w, h, setup) {
    const { gl } = this
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, w, h)
    gl.useProgram(pass.prog)
    setup(pass.loc)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  _bindTex(unit, tex, loc) {
    const { gl } = this
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(loc, unit)
  }

  _postProcess(camera, width, height, time, nightBlend) {
    const { gl } = this
    const t = this.targets
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msFbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.scene.fbo)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.depth.fbo)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    gl.bindVertexArray(this.emptyVao)
    const P = this.post

    const invProj = mat4Invert(camera.proj) || mat4Identity()
    const projScale = t.ao.h / (2 * Math.tan((camera.fovDeg * Math.PI) / 360))
    const dist = camera.dist ?? 20
    this._pass(P.ssao, t.ao, t.ao.w, t.ao.h, (l) => {
      this._bindTex(0, t.depth.tex, l.uDepth)
      gl.uniformMatrix4fv(l.uInvProj, false, invProj)
      gl.uniform2f(l.uRes, t.ao.w, t.ao.h)
      gl.uniform1f(l.uProjScale, projScale)
      const radius = Math.min(1.2, Math.max(0.22, dist * 0.022))
      gl.uniform1f(l.uRadius, radius)
      gl.uniform1f(l.uIntensity, 0.55)
      gl.uniform1f(l.uBias, radius * 0.12)
    })
    this._pass(P.aoBlur, t.aoTmp, t.ao.w, t.ao.h, (l) => {
      this._bindTex(0, t.ao.tex, l.uSrc)
      gl.uniform2f(l.uDir, 1 / t.ao.w, 0)
    })
    this._pass(P.aoBlur, t.ao, t.ao.w, t.ao.h, (l) => {
      this._bindTex(0, t.aoTmp.tex, l.uSrc)
      gl.uniform2f(l.uDir, 0, 1 / t.ao.h)
    })

    this._pass(P.bright, t.bA, t.bA.w, t.bA.h, (l) => {
      this._bindTex(0, t.scene.tex, l.uSrc)
      gl.uniform2f(l.uTexel, 1 / width, 1 / height)
      gl.uniform1f(l.uThreshold, 1.15)
    })
    const blur2 = (src, tmp) => {
      this._pass(P.blur, tmp, src.w, src.h, (l) => {
        this._bindTex(0, src.tex, l.uSrc)
        gl.uniform2f(l.uDir, 1 / src.w, 0)
      })
      this._pass(P.blur, src, src.w, src.h, (l) => {
        this._bindTex(0, tmp.tex, l.uSrc)
        gl.uniform2f(l.uDir, 0, 1 / src.h)
      })
    }
    blur2(t.bA, t.bAt)
    this._pass(P.blur, t.bB, t.bB.w, t.bB.h, (l) => {
      this._bindTex(0, t.bA.tex, l.uSrc)
      gl.uniform2f(l.uDir, 0.5 / t.bA.w, 0.5 / t.bA.h)
    })
    blur2(t.bB, t.bBt)
    blur2(t.bB, t.bBt)

    this._pass(P.composite, null, width, height, (l) => {
      this._bindTex(0, t.scene.tex, l.uScene)
      this._bindTex(1, t.ao.tex, l.uAO)
      this._bindTex(2, t.bA.tex, l.uBloomA)
      this._bindTex(3, t.bB.tex, l.uBloomB)
      gl.uniform1f(l.uAOStrength, 0.75)
      gl.uniform1f(l.uBloom, 0.32 + nightBlend * 0.25)
      gl.uniform1f(l.uTime, time)
      gl.uniform1f(l.uNight, nightBlend)
      gl.uniform1f(l.uExposure, EXPOSURE)
    })
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    return { width: w, height: h, cssWidth: this.canvas.clientWidth, cssHeight: this.canvas.clientHeight }
  }

  beginFrame() {
    this.opaqueQueue.length = 0
    this.transQueue.length = 0
  }

  add(meshName, model, color, matType, emissive = [0, 0, 0], alpha = 1.0, extra = 0.0, castShadow = true) {
    const item = { meshName, model, color, matType, emissive, alpha, extra, castShadow }
    if (alpha < 0.99) {
      this.transQueue.push(item)
    } else {
      this.opaqueQueue.push(item)
    }
  }

  render(camera, nightBlend, time, shadowExtent = 18.0, goldenBlend = 0.0) {
    const { gl } = this
    const { width, height } = this.resize()

    // Raking warm Golden Hour sun angle vs crisp Studio Day overhead key (strictly zeroed in Night Mode!)
    const g = Math.max(0, Math.min(1, goldenBlend || 0)) * Math.max(0, 1.0 - (nightBlend || 0) * 2.5)
    const lightDir = [
      0.52 * (1 - g) + 0.86 * g,
      0.86 * (1 - g) + 0.40 * g,
      0.44 * (1 - g) + 0.32 * g,
    ]
    const lLen = Math.hypot(...lightDir)
    const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen

    const center = camera.target
    const lightDist = Math.max(30, shadowExtent * 1.4)
    const lightEye = [center[0] + lx * lightDist, center[1] + ly * lightDist, center[2] + lz * lightDist]
    const lightView = mat4LookAt(lightEye, center, [0, 1, 0])
    const lightProj = mat4Ortho(-shadowExtent, shadowExtent, -shadowExtent, shadowExtent, 2.0, lightDist * 2.4)
    const lightVP = mat4Mul(lightProj, lightView)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO)
    gl.viewport(0, 0, this.shadowSize, this.shadowSize)
    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.clear(gl.DEPTH_BUFFER_BIT)

    gl.useProgram(this.shadowProg)
    gl.uniformMatrix4fv(this.sLoc.uLightVP, false, lightVP)

    let lastVao = null
    for (const item of this.opaqueQueue) {
      if (!item.castShadow) continue
      const mesh = this.meshes[item.meshName]
      if (!mesh) continue
      if (mesh.vao !== lastVao) {
        gl.bindVertexArray(mesh.vao)
        lastVao = mesh.vao
      }
      gl.uniformMatrix4fv(this.sLoc.uModel, false, item.model)
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType || gl.UNSIGNED_SHORT, 0)
    }

    const targets = this._ensureTargets(width, height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.msFbo)
    gl.viewport(0, 0, width, height)
    const dayBgR = 0.885 * (1 - g) + 0.915 * g
    const dayBgG = 0.887 * (1 - g) + 0.875 * g
    const dayBgB = 0.893 * (1 - g) + 0.825 * g
    const bgR = dayBgR * (1 - nightBlend) + 0.068 * nightBlend
    const bgG = dayBgG * (1 - nightBlend) + 0.078 * nightBlend
    const bgB = dayBgB * (1 - nightBlend) + 0.102 * nightBlend
    const bgLin = [bgR, bgG, bgB].map((v) => invAcesScalar(v ** 2.2) / EXPOSURE)
    gl.clearColor(bgLin[0], bgLin[1], bgLin[2], 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    const fogRange = Math.max(68, (camera.dist ?? 20) * 3.8)

    gl.useProgram(this.mainProg)
    gl.uniformMatrix4fv(this.mLoc.uVP, false, camera.vp)
    gl.uniformMatrix4fv(this.mLoc.uLightVP, false, lightVP)
    gl.uniform3fv(this.mLoc.uCamPos, camera.eye)
    gl.uniform3fv(this.mLoc.uCamTarget, center)
    gl.uniform3f(this.mLoc.uLightDir, lx, ly, lz)
    gl.uniform3f(this.mLoc.uBgColor, bgR, bgG, bgB)
    gl.uniform1f(this.mLoc.uNight, nightBlend)
    gl.uniform1f(this.mLoc.uGolden, g)
    gl.uniform1f(this.mLoc.uTime, time)
    gl.uniform1f(this.mLoc.uFogRange, fogRange)
    gl.uniform1f(this.mLoc.uExposure, EXPOSURE)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex)
    gl.uniform1i(this.mLoc.uShadowMap, 0)

    gl.disable(gl.BLEND)
    gl.depthMask(true)
    lastVao = null

    const drawItem = (item) => {
      const mesh = this.meshes[item.meshName]
      if (!mesh) return
      if (mesh.vao !== lastVao) {
        gl.bindVertexArray(mesh.vao)
        lastVao = mesh.vao
      }
      gl.uniformMatrix4fv(this.mLoc.uModel, false, item.model)
      gl.uniform3fv(this.mLoc.uBaseColor, item.color)
      gl.uniform3fv(this.mLoc.uEmissive, item.emissive)
      gl.uniform1i(this.mLoc.uMatType, item.matType)
      gl.uniform1f(this.mLoc.uAlpha, item.alpha)
      gl.uniform1f(this.mLoc.uExtra, item.extra)
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType || gl.UNSIGNED_SHORT, 0)
    }

    for (const item of this.opaqueQueue) {
      drawItem(item)
    }

    if (this.transQueue.length > 0) {
      const [ex, ey, ez] = camera.eye
      this.transQueue.sort((a, b) => {
        const dax = a.model[12] - ex, day = a.model[13] - ey, daz = a.model[14] - ez
        const dbx = b.model[12] - ex, dby = b.model[13] - ey, dbz = b.model[14] - ez
        return dbx * dbx + dby * dby + dbz * dbz - (dax * dax + day * day + daz * daz)
      })
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      gl.disable(gl.CULL_FACE)
      lastVao = null
      for (const item of this.transQueue) {
        drawItem(item)
      }
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      gl.enable(gl.CULL_FACE)
    }

    this._postProcess(camera, width, height, time, nightBlend)
  }
}

const EXPOSURE = 0.82

function invAcesScalar(y) {
  const v = Math.min(Math.max(y, 0), 0.985)
  const A = 2.51 - 2.43 * v
  const B = 0.03 - 0.59 * v
  const C = -0.14 * v
  return (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A)
}
