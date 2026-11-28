import { MAT, mat4Identity, mat4Mul } from './renderer.js?v=b5r'

/**
 * Zero-Dependency Binary glTF 2.0 (.glb) Parser, PBR Material Mapper & WebGL2 Asset Manager
 * Parses standard glTF 2.0 .glb files exported by Blender 5.2.1 LTS, uploads indexed
 * (UNSIGNED_SHORT / UNSIGNED_INT) VEC3 POSITION + NORMAL meshes into CleanroomRenderer,
 * and exposes rigged sub-node slots (Body, Arm_L, Arm_R, Leg_L, Leg_R, Accessory) for
 * real-time procedural animation and exploded-view rendering.
 */

export const GLB_VERSION = 'b4b'

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

const COMP_BYTES = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
}

function linearToSrgb(c) {
  const v = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0))
  return Math.pow(v, 1 / 2.2)
}

function hexToRGB(hex) {
  if (!hex || typeof hex !== 'string') return null
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  if (clean.length !== 6) return null
  const n = parseInt(clean, 16)
  if (Number.isNaN(n)) return null
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function composeNodeMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new Float32Array(node.matrix)
  }
  const t = node.translation || [0, 0, 0]
  const r = node.rotation || [0, 0, 0, 1]
  const s = node.scale || [1, 1, 1]

  const x = r[0], y = r[1], z = r[2], w = r[3]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  const sx = s[0], sy = s[1], sz = s[2]

  const out = new Float32Array(16)
  out[0] = (1 - (yy + zz)) * sx
  out[1] = (xy + wz) * sx
  out[2] = (xz - wy) * sx
  out[3] = 0
  out[4] = (xy - wz) * sy
  out[5] = (1 - (xx + zz)) * sy
  out[6] = (yz + wx) * sy
  out[7] = 0
  out[8] = (xz + wy) * sz
  out[9] = (yz - wx) * sz
  out[10] = (1 - (xx + yy)) * sz
  out[11] = 0
  out[12] = t[0]
  out[13] = t[1]
  out[14] = t[2]
  out[15] = 1
  return out
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

function readComponent(dv, offset, componentType, normalized) {
  let v = 0
  switch (componentType) {
    case 5120: // BYTE
      v = dv.getInt8(offset)
      return normalized ? Math.max(-1, v / 127) : v
    case 5121: // UNSIGNED_BYTE
      v = dv.getUint8(offset)
      return normalized ? v / 255 : v
    case 5122: // SHORT
      v = dv.getInt16(offset, true)
      return normalized ? Math.max(-1, v / 32767) : v
    case 5123: // UNSIGNED_SHORT
      v = dv.getUint16(offset, true)
      return normalized ? v / 65535 : v
    case 5125: // UNSIGNED_INT
      return dv.getUint32(offset, true)
    case 5126: // FLOAT
      return dv.getFloat32(offset, true)
    default:
      return 0
  }
}

function readAccessorFloat32(gltf, bin, accessorIndex) {
  const acc = gltf.accessors?.[accessorIndex]
  if (!acc || acc.bufferView === undefined) return null
  const bv = gltf.bufferViews?.[acc.bufferView]
  if (!bv) return null

  const numComp = TYPE_COMPONENTS[acc.type] || 1
  const compSize = COMP_BYTES[acc.componentType] || 4
  const count = acc.count || 0
  const baseOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || numComp * compSize

  // Fast path for tightly packed Float32
  if (
    acc.componentType === 5126 &&
    stride === numComp * 4 &&
    (bin.byteOffset + baseOffset) % 4 === 0
  ) {
    const view = new Float32Array(bin.buffer, bin.byteOffset + baseOffset, count * numComp)
    return new Float32Array(view)
  }

  const out = new Float32Array(count * numComp)
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const normalized = Boolean(acc.normalized)
  for (let i = 0; i < count; i++) {
    const elemOff = baseOffset + i * stride
    for (let c = 0; c < numComp; c++) {
      out[i * numComp + c] = readComponent(dv, elemOff + c * compSize, acc.componentType, normalized)
    }
  }
  return out
}

function readAccessorIndices(gltf, bin, accessorIndex, vertexCount) {
  if (accessorIndex === undefined) {
    const useU32 = vertexCount > 65535
    const out = useU32 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount)
    for (let i = 0; i < vertexCount; i++) out[i] = i
    return out
  }

  const acc = gltf.accessors?.[accessorIndex]
  if (!acc || acc.bufferView === undefined) return new Uint16Array(0)
  const bv = gltf.bufferViews?.[acc.bufferView]
  if (!bv) return new Uint16Array(0)

  const count = acc.count || 0
  const compSize = COMP_BYTES[acc.componentType] || 2
  const baseOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
  const stride = bv.byteStride || compSize
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)

  if (acc.componentType === 5125) {
    // UNSIGNED_INT -> Uint32Array
    if (stride === 4 && (bin.byteOffset + baseOffset) % 4 === 0) {
      return new Uint32Array(new Uint32Array(bin.buffer, bin.byteOffset + baseOffset, count))
    }
    const out = new Uint32Array(count)
    for (let i = 0; i < count; i++) out[i] = dv.getUint32(baseOffset + i * stride, true)
    return out
  }

  if (acc.componentType === 5123) {
    // UNSIGNED_SHORT -> Uint16Array
    if (stride === 2 && (bin.byteOffset + baseOffset) % 2 === 0) {
      return new Uint16Array(new Uint16Array(bin.buffer, bin.byteOffset + baseOffset, count))
    }
    const out = new Uint16Array(count)
    for (let i = 0; i < count; i++) out[i] = dv.getUint16(baseOffset + i * stride, true)
    return out
  }

  // UNSIGNED_BYTE -> widen to Uint16Array for WebGL2 drawElements
  const out = new Uint16Array(count)
  for (let i = 0; i < count; i++) out[i] = dv.getUint8(baseOffset + i * stride)
  return out
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3
    const i1 = indices[i + 1] * 3
    const i2 = indices[i + 2] * 3
    const ax = positions[i1] - positions[i0]
    const ay = positions[i1 + 1] - positions[i0 + 1]
    const az = positions[i1 + 2] - positions[i0 + 2]
    const bx = positions[i2] - positions[i0]
    const by = positions[i2 + 1] - positions[i0 + 1]
    const bz = positions[i2 + 2] - positions[i0 + 2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz
    normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz
    normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= len
    normals[i + 1] /= len
    normals[i + 2] /= len
  }
  return normals
}

function classifySlot(nameChain) {
  for (let i = nameChain.length - 1; i >= 0; i--) {
    const n = String(nameChain[i] || '').toLowerCase()
    if (!n) continue
    if (/^arm_l|arm\.l|left_arm|_arm_l/.test(n)) return 'Arm_L'
    if (/^arm_r|arm\.r|right_arm|_arm_r/.test(n)) return 'Arm_R'
    if (/^leg_l|leg\.l|left_leg|leg_fl|leg_bl|_leg_l/.test(n)) return 'Leg_L'
    if (/^leg_r|leg\.r|right_leg|leg_fr|leg_br|_leg_r/.test(n)) return 'Leg_R'
    if (/^accessory|prop|halo|crown|hat|badge|wing|tail/.test(n)) return 'Accessory'
    if (/^body|torso|head|shell/.test(n)) return 'Body'
  }
  return 'Body'
}

export function mapBlenderMaterial(matDef) {
  const name = String(matDef?.name || '')
  const pbr = matDef?.pbrMetallicRoughness || {}
  const bcf = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : [0.85, 0.85, 0.85, 1.0]
  const color = [linearToSrgb(bcf[0]), linearToSrgb(bcf[1]), linearToSrgb(bcf[2])]
  const rawAlpha = bcf.length >= 4 ? bcf[3] : 1.0
  const alphaMode = matDef?.alphaMode || 'OPAQUE'
  const alpha = alphaMode === 'BLEND' ? Math.min(0.96, rawAlpha) : rawAlpha < 0.99 ? rawAlpha : 1.0

  const metallic = pbr.metallicFactor !== undefined ? pbr.metallicFactor : 0.0
  const roughness = pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 0.5

  const emRaw = Array.isArray(matDef?.emissiveFactor) ? matDef.emissiveFactor : [0, 0, 0]
  const emStrength = matDef?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1.0
  const emissive = [emRaw[0] * emStrength, emRaw[1] * emStrength, emRaw[2] * emStrength]
  const emMag = Math.hypot(emissive[0], emissive[1], emissive[2])

  let matType = MAT.VINYL_MATTE
  if (/mat_vinyl|vinyl/i.test(name)) matType = MAT.VINYL_MATTE
  else if (/mat_ceramic|ceramic|porcelain|glaze/i.test(name)) matType = MAT.CERAMIC_GLAZE
  else if (/mat_crystal|crystal|glass/i.test(name)) matType = MAT.CRYSTAL_GLASS
  else if (/mat_brass|brass|gold|copper|bronze/i.test(name)) matType = MAT.BRUSHED_BRASS
  else if (/mat_aluminum|aluminum|alum|silver|chrome/i.test(name)) matType = MAT.ALUMINUM
  else if (/mat_titanium|titanium|gunmetal|steel/i.test(name)) matType = MAT.TITANIUM
  else if (/mat_obsidian|obsidian|eye|visor|screen/i.test(name)) matType = MAT.OBSIDIAN
  else if (/mat_emissive|emissive|glow|led|neon/i.test(name)) matType = MAT.EMISSIVE
  else if (emMag > 0.15) matType = MAT.EMISSIVE
  else if (alphaMode === 'BLEND' || alpha < 0.98) matType = MAT.CRYSTAL_GLASS
  else if (metallic >= 0.7) {
    const luma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
    const warm = color[0] > color[2] + 0.12
    matType = warm ? MAT.BRUSHED_BRASS : luma < 0.36 ? MAT.TITANIUM : MAT.ALUMINUM
  } else if (roughness <= 0.18) {
    const luma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
    matType = luma < 0.12 ? MAT.OBSIDIAN : MAT.CERAMIC_GLAZE
  }

  // Boost emissive slightly for Mat_Emissive if Blender exported unit emissiveFactor
  if (matType === MAT.EMISSIVE && emMag < 0.05) {
    emissive[0] = Math.pow(color[0], 2.2) * 1.85
    emissive[1] = Math.pow(color[1], 2.2) * 1.85
    emissive[2] = Math.pow(color[2], 2.2) * 1.85
  }

  const isEyeOrGlow = matType === MAT.OBSIDIAN || matType === MAT.EMISSIVE
  const isHardware = matType === MAT.TITANIUM || matType === MAT.ALUMINUM
  const isDetailAccent = /blush|face|belly|sole|pin/i.test(name)
  const isPrimaryShell = !isEyeOrGlow && !isHardware && !isDetailAccent

  return {
    name,
    matType,
    color,
    emissive,
    alpha: matType === MAT.CRYSTAL_GLASS && alpha >= 0.99 ? 0.86 : alpha,
    alphaMode,
    metallic,
    roughness,
    isEyeOrGlow,
    isPrimaryShell,
  }
}

/**
 * Parses a binary glTF 2.0 (.glb) ArrayBuffer into structured geometry primitives,
 * rigged animation slots, per-slot joint pivots, and mapped CleanroomRenderer materials.
 */
export function parseGLB(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 20) {
    throw new Error('Invalid GLB: buffer too small')
  }
  const dv = new DataView(arrayBuffer)
  const magic = dv.getUint32(0, true)
  const version = dv.getUint32(4, true)
  const totalLen = dv.getUint32(8, true)
  if (magic !== GLB_MAGIC || version !== 2) {
    throw new Error(`Invalid GLB header: magic=0x${magic.toString(16)} version=${version}`)
  }

  let offset = 12
  let gltf = null
  let bin = new Uint8Array(0)
  const limit = Math.min(totalLen, arrayBuffer.byteLength)

  while (offset + 8 <= limit) {
    const chunkLen = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    const chunkEnd = Math.min(limit, chunkStart + chunkLen)
    if (chunkType === CHUNK_JSON) {
      const jsonText = new TextDecoder('utf-8').decode(new Uint8Array(arrayBuffer, chunkStart, chunkEnd - chunkStart))
      gltf = JSON.parse(jsonText)
    } else if (chunkType === CHUNK_BIN) {
      bin = new Uint8Array(arrayBuffer, chunkStart, chunkEnd - chunkStart)
    }
    offset = chunkStart + chunkLen
  }

  if (!gltf) throw new Error('Invalid GLB: missing JSON chunk')

  const nodes = gltf.nodes || []
  const meshes = gltf.meshes || []
  const materials = gltf.materials || []
  const sceneIdx = gltf.scene ?? 0
  const rootNodes = gltf.scenes?.[sceneIdx]?.nodes || (nodes.length ? [0] : [])

  const parts = []
  let totalTriangles = 0
  let totalVertices = 0
  const modelBounds = {
    minX: Infinity, minY: Infinity, minZ: Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
  }
  const slotBounds = {}
  const slotNodeTrans = {}

  function expandBounds(b, x, y, z) {
    if (x < b.minX) b.minX = x
    if (y < b.minY) b.minY = y
    if (z < b.minZ) b.minZ = z
    if (x > b.maxX) b.maxX = x
    if (y > b.maxY) b.maxY = y
    if (z > b.maxZ) b.maxZ = z
  }

  function visitNode(nodeIdx, parentWorld, nameChain) {
    const node = nodes[nodeIdx]
    if (!node) return
    const localM = composeNodeMatrix(node)
    const worldM = mat4Mul(parentWorld, localM)
    const nextChain = node.name ? [...nameChain, node.name] : nameChain
    const slot = classifySlot(nextChain)

    // Record explicit node origin translation for named animation slots
    if (!slotNodeTrans[slot] && node.name && classifySlot([node.name]) === slot) {
      const tx = worldM[12], ty = worldM[13], tz = worldM[14]
      if (Math.hypot(tx, ty, tz) > 0.04) {
        slotNodeTrans[slot] = [tx, ty, tz]
      }
    }

    if (node.mesh !== undefined && meshes[node.mesh]) {
      const meshDef = meshes[node.mesh]
      const primitives = meshDef.primitives || []
      for (let pIdx = 0; pIdx < primitives.length; pIdx++) {
        const prim = primitives[pIdx]
        // Only TRIANGLES mode (default 4)
        if (prim.mode !== undefined && prim.mode !== 4) continue
        const posAcc = prim.attributes?.POSITION
        if (posAcc === undefined) continue

        const positions = readAccessorFloat32(gltf, bin, posAcc)
        if (!positions || positions.length < 9) continue
        const vertCount = positions.length / 3
        const indices = readAccessorIndices(gltf, bin, prim.indices, vertCount)
        if (!indices || indices.length < 3) continue

        let normals = prim.attributes?.NORMAL !== undefined
          ? readAccessorFloat32(gltf, bin, prim.attributes.NORMAL)
          : null
        if (!normals || normals.length !== positions.length) {
          normals = computeNormals(positions, indices)
        }

        const matDef = prim.material !== undefined ? materials[prim.material] : null
        const matInfo = mapBlenderMaterial(matDef)

        if (!slotBounds[slot]) {
          slotBounds[slot] = {
            minX: Infinity, minY: Infinity, minZ: Infinity,
            maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
          }
        }
        const sb = slotBounds[slot]
        const pb = {
          minX: Infinity, minY: Infinity, minZ: Infinity,
          maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        }
        for (let i = 0; i < positions.length; i += 3) {
          const [wx, wy, wz] = transformPoint(worldM, positions[i], positions[i + 1], positions[i + 2])
          expandBounds(modelBounds, wx, wy, wz)
          expandBounds(sb, wx, wy, wz)
          expandBounds(pb, wx, wy, wz)
        }

        const triCount = Math.floor(indices.length / 3)
        totalTriangles += triCount
        totalVertices += vertCount

        parts.push({
          slot,
          nodeName: node.name || meshDef.name || `mesh_${node.mesh}_${pIdx}`,
          worldMatrix: worldM,
          positions,
          normals,
          indices,
          triangles: triCount,
          vertices: vertCount,
          bounds: pb,
          mat: matInfo,
        })
      }
    }

    if (Array.isArray(node.children)) {
      for (const childIdx of node.children) {
        visitNode(childIdx, worldM, nextChain)
      }
    }
  }

  const identity = mat4Identity()
  for (const rIdx of rootNodes) {
    visitNode(rIdx, identity, [])
  }

  // Compute anatomical joint pivot for every slot (supports both joint-origin & world-origin exports)
  const slotPivots = {}
  for (const [slot, sb] of Object.entries(slotBounds)) {
    const cx = (sb.minX + sb.maxX) * 0.5
    const cy = (sb.minY + sb.maxY) * 0.5
    const cz = (sb.minZ + sb.maxZ) * 0.5
    const h = Math.max(0.01, sb.maxY - sb.minY)
    if (slotNodeTrans[slot]) {
      slotPivots[slot] = slotNodeTrans[slot]
    } else if (slot === 'Arm_L') {
      slotPivots[slot] = [sb.maxX, sb.maxY - h * 0.16, cz]
    } else if (slot === 'Arm_R') {
      slotPivots[slot] = [sb.minX, sb.maxY - h * 0.16, cz]
    } else if (slot === 'Leg_L' || slot === 'Leg_R') {
      slotPivots[slot] = [cx, sb.maxY - h * 0.10, cz]
    } else if (slot === 'Body') {
      slotPivots[slot] = [cx, sb.minY + h * 0.35, cz]
    } else {
      slotPivots[slot] = [cx, cy, cz]
    }
  }

  return {
    generator: gltf.asset?.generator || 'Blender glTF 2.0',
    triangles: totalTriangles,
    vertices: totalVertices,
    bounds: Number.isFinite(modelBounds.minY)
      ? modelBounds
      : { minX: -0.4, minY: 0, minZ: -0.4, maxX: 0.4, maxY: 1.0, maxZ: 0.4 },
    slotPivots,
    slotNames: Object.keys(slotBounds),
    parts,
  }
}

// ── Runtime Model Registry & Lazy/Parallel Preloader ──
const modelCache = new Map() // key -> { status: 'loading'|'ready'|'error', ... }
const listeners = new Set()
let manifestCache = null
let manifestPromise = null

export function onGLBLoaded(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notifyLoaded(key, model) {
  for (const fn of listeners) {
    try {
      fn(key, model)
    } catch {
      // ignore subscriber errors
    }
  }
}

export function getGLBManifest() {
  return manifestCache
}

export function getGLBModel(key) {
  const entry = modelCache.get(key)
  return entry && entry.status === 'ready' ? entry : null
}

export function getGLBLoadedCount() {
  let n = 0
  for (const entry of modelCache.values()) {
    if (entry.status === 'ready') n++
  }
  return n
}

export function getGLBDownloadInfo(key) {
  const entry = modelCache.get(key)
  if (!entry || entry.status !== 'ready') return null
  return {
    bytes: entry.rawBytes,
    url: entry.rawUrl,
    filename: `${key}.glb`,
  }
}

export async function preloadGLBManifest() {
  if (manifestCache) return manifestCache
  if (manifestPromise) return manifestPromise
  manifestPromise = (async () => {
    try {
      const res = await fetch(`./models/manifest.json?v=${GLB_VERSION}`, { cache: 'no-store' })
      if (!res.ok) return null
      manifestCache = await res.json()
      return manifestCache
    } catch {
      return null
    }
  })()
  return manifestPromise
}

export function ensureGLBLoaded(renderer, key) {
  if (!renderer || !key) return Promise.resolve(null)
  const existing = modelCache.get(key)
  if (existing) {
    return existing.status === 'ready' ? Promise.resolve(existing) : existing.promise || Promise.resolve(null)
  }

  const rawUrl = `./models/${encodeURIComponent(key)}.glb?v=${GLB_VERSION}`
  const promise = (async () => {
    try {
      const res = await fetch(rawUrl, { cache: 'no-store' })
      if (!res.ok) {
        modelCache.set(key, { status: 'error', key })
        return null
      }
      const buf = await res.arrayBuffer()
      const parsed = parseGLB(buf)

      const uploadedParts = parsed.parts.map((part, idx) => {
        const meshName = `glb:${key}:${idx}`
        renderer.uploadMesh(meshName, {
          positions: part.positions,
          normals: part.normals,
          indices: part.indices,
        })
        return {
          meshName,
          slot: part.slot,
          nodeName: part.nodeName,
          worldMatrix: part.worldMatrix,
          bounds: part.bounds,
          mat: part.mat,
          triangles: part.triangles,
        }
      })

      const entry = {
        status: 'ready',
        key,
        generator: parsed.generator,
        triangles: parsed.triangles,
        vertices: parsed.vertices,
        bounds: parsed.bounds,
        slotPivots: parsed.slotPivots,
        slotNames: parsed.slotNames,
        parts: uploadedParts,
        rawUrl,
        rawBytes: new Uint8Array(buf),
      }
      modelCache.set(key, entry)
      notifyLoaded(key, entry)
      return entry
    } catch (err) {
      console.warn(`[glb_loader] Failed to load ${key}.glb:`, err)
      modelCache.set(key, { status: 'error', key })
      return null
    }
  })()

  modelCache.set(key, { status: 'loading', key, promise })
  return promise
}

export async function preloadAllGLBs(renderer, keys, concurrency = 6) {
  await preloadGLBManifest()
  const queue = [...keys]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const k = queue.shift()
      if (k) await ensureGLBLoaded(renderer, k)
    }
  })
  await Promise.all(workers)
}

/**
 * Resolves the final CleanroomRenderer material & color for a GLB primitive,
 * applying optional Studio finishOverride ('vinyl'|'ceramic'|'crystal'|'metal'),
 * custom swatch tintHex, and owner-filter dimming.
 */
export function resolveGLBMaterial(part, { finishOverride = null, tintHex = null, dimmed = false } = {}) {
  const m = part.mat
  let matType = m.matType
  let color = m.color
  let emissive = m.emissive
  let alpha = m.alpha

  if (dimmed) {
    return {
      color: [0.68, 0.69, 0.71],
      matType: m.isEyeOrGlow ? MAT.OBSIDIAN : MAT.VINYL_MATTE,
      emissive: [0, 0, 0],
      alpha: 0.26,
      castShadow: false,
    }
  }

  if (tintHex && m.isPrimaryShell) {
    const tint = hexToRGB(tintHex)
    if (tint) {
      // Preserve subtle luminance variation across multi-tone shell parts while shifting hue cleanly
      const luma = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
      const lumScale = Math.max(0.72, Math.min(1.18, luma / 0.58))
      color = [
        Math.min(0.98, tint[0] * lumScale),
        Math.min(0.98, tint[1] * lumScale),
        Math.min(0.98, tint[2] * lumScale),
      ]
    }
  }

  if (finishOverride && !m.isEyeOrGlow) {
    if (finishOverride === 'vinyl') {
      matType = MAT.VINYL_MATTE
      alpha = 1.0
    } else if (finishOverride === 'ceramic') {
      matType = MAT.CERAMIC_GLAZE
      alpha = 1.0
    } else if (finishOverride === 'crystal') {
      matType = MAT.CRYSTAL_GLASS
      alpha = 0.84
    } else if (finishOverride === 'metal') {
      matType = m.isPrimaryShell ? MAT.BRUSHED_BRASS : MAT.ALUMINUM
      alpha = 1.0
    }
  }

  const castShadow = alpha >= 0.98 && matType !== MAT.EMISSIVE
  return { color, matType, emissive, alpha, castShadow }
}
