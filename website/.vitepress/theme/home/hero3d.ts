import {
  AdditiveBlending,
  BackSide,
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { PERSONAS } from '../../../../apps/web/src/features/bots/personas'

/** Words the scene shows; the component supplies them in the page language. */
export interface StudioCopy {
  group: string
  /** Owner, 共字君, then the three Bots. */
  names: string[]
  badges: string[]
  /** One line per handoff: owner → 共字君 → front end → back end → tests → owner. */
  lines: string[]
  approved: string
  process: string
  typing: string
  columns: string[]
  task: string
  online: string
}
/** The hero copy the room itself carries: title tiles, slogan banner, a front label and three actions. */
export interface BrandCopy {
  title: string
  seal: [string, string]
  slogan: string
  kicker: string
  tagline: string
  /** Get started, what it is, GitHub. */
  actions: [string, string, string]
}
export type StudioSound = 'type' | 'ping' | 'stamp'
export interface HeroScene {
  /** The action under a point in canvas pixels, or -1. */
  pick: (x: number, y: number) => number
  /** Lifts and lights an action (hover or keyboard focus); -1 clears. */
  setHighlight: (i: number) => void
  /** Plays the press and resolves when it bottoms out. */
  press: (i: number) => Promise<void>
  resize: (w: number, h: number) => void
  setActive: (on: boolean) => void
  setDark: (dark: boolean) => void
  setScroll: (p: number) => void
  setPointer: (x: number, y: number) => void
  dispose: () => void
}
interface Options {
  canvas: HTMLCanvasElement
  bubbles: HTMLElement[]
  stamp: HTMLElement
  copy: StudioCopy
  brand: BrandCopy
  still: boolean
  dark: boolean
  onSound: (s: StudioSound) => void
  onFirstFrame: () => void
}

const LIGHT = {
  bg: '#f3efe6',
  hemiSky: '#fff6e8',
  hemiGround: '#b9a88f',
  hemi: 1.25,
  key: '#ffe2b8',
  keyI: 2.4,
  rim: '#bcd6ff',
  rimI: 1.6,
  screen: 0.5,
  lamp: 0.4,
  window: '#cfe4f5',
  moon: 0,
  env: 0.5,
}
const DARK: Theme = {
  bg: '#0f131c',
  hemiSky: '#2c3854',
  hemiGround: '#0a0d14',
  hemi: 0.35,
  key: '#8fa8d8',
  keyI: 0.3,
  rim: '#5f8fe0',
  rimI: 1.4,
  screen: 2.6,
  lamp: 7,
  window: '#1a2540',
  moon: 1,
  env: 0.18,
}
type Theme = typeof LIGHT
type ColorKey = { [K in keyof Theme]: Theme[K] extends string ? K : never }[keyof Theme]
type NumberKey = Exclude<keyof Theme, ColorKey>
const INK = '#1b2233'
const JADE = '#14b3ae'
const SEAL = '#c23b22'
const UI_FONT = '"PingFang SC", "Noto Sans SC", system-ui, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace'

const vgrad = (top: string, bottom: string, y0: number, y1: number) => {
  const a = new Color(bottom)
  const b = new Color(top)
  return (y: number) => a.clone().lerp(b, MathUtils.clamp((y - y0) / (y1 - y0), 0, 1))
}
const paint = (g: BufferGeometry, color: (y: number) => Color) => {
  const p = g.attributes.position
  const c = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) color(p.getY(i)).toArray(c, i * 3)
  g.setAttribute('color', new Float32BufferAttribute(c, 3))
  return g
}

/*
 * Plush: shell-textured fur. Each furry part is redrawn SHELLS times as instances, each instance pushed a little
 * further along the normal and sagging under gravity; a per-strand hash in object space decides which shells keep a
 * fragment, so strands taper from root to tip. Roots are darkened for depth; sheen gives the soft velvet rim.
 */
const SHELLS = 16
const furTime = { value: 0 }
const furCache = new Map<string, MeshPhysicalMaterial>()
const furMaterial = (len: number, density: number, color?: string) => {
  const id = `${len}|${density}|${color ?? 'v'}`
  let m = furCache.get(id)
  if (m) return m
  m = new MeshPhysicalMaterial({
    color: color ?? '#ffffff',
    vertexColors: !color,
    roughness: 1,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: '#9aa4b4',
    alphaTest: 0.5,
  })
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = furTime
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime; varying float vLayer; varying vec3 vFur;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLayer = (float(gl_InstanceID) + 1.0) / ${SHELLS}.0;
        vFur = position * ${density.toFixed(1)};
        transformed += normalize(objectNormal) * vLayer * ${len.toFixed(3)};
        transformed.y -= vLayer * vLayer * ${(len * 0.6).toFixed(3)};
        transformed.x += sin(uTime * 1.7 + position.y * 9.0) * vLayer * vLayer * ${(len * 0.25).toFixed(3)};`,
      )
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vLayer; varying vec3 vFur;
        float furHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 cell = floor(vFur);
        float h = 0.55 + 0.45 * furHash(cell);
        float r = 0.72 * (1.0 - vLayer / h) + 0.08;
        float strand = vLayer > h ? 0.0 : 1.0 - smoothstep(r - 0.14, r, length(fract(vFur) - 0.5));
        // A dense undercoat hides the base; only the outer shells break up into tufts.
        diffuseColor.a = vLayer < 0.3 ? 1.0 : strand;
        diffuseColor.rgb *= mix(0.6, 1.0, vLayer);`,
      )
  }
  m.customProgramCacheKey = () => `fur${id}`
  furCache.set(id, m)
  return m
}
const furry = (mesh: Mesh, len: number, density: number, color?: string) => {
  const shells = new InstancedMesh(mesh.geometry, furMaterial(len, density, color), SHELLS)
  mesh.add(shells)
  return mesh
}

/** Ink outline by the inverted hull, kept for the furniture so the diorama reads as drawn. */
const hullCache = new Map<number, MeshBasicMaterial>()
const outline = (mesh: Mesh, w = 0.012) => {
  let mat = hullCache.get(w)
  if (!mat) {
    mat = new MeshBasicMaterial({ color: INK, side: BackSide })
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed += normalize(normal) * ${w.toFixed(3)};`,
      )
    }
    mat.customProgramCacheKey = () => `ink${w}`
    hullCache.set(w, mat)
  }
  const g = mesh.geometry.clone()
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k)
  const smooth = mergeVertices(g)
  smooth.computeVertexNormals()
  g.dispose()
  mesh.add(new Mesh(smooth, mat))
  return mesh
}

const canvasTexture = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return { ctx: c.getContext('2d') as CanvasRenderingContext2D, tex }
}
const SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "Iowan Old Style", serif'
/** Text drawn on a canvas at a fixed density per world unit, so it stays crisp at 2× pixel ratios. */
const textCard = (
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D, W: number, H: number) => void,
  ppu = 512,
) => {
  const W = Math.min(4096, Math.round(w * ppu))
  const t = canvasTexture(W, Math.round((h * W) / w))
  draw(t.ctx, W, t.ctx.canvas.height)
  t.tex.anisotropy = 8
  return t.tex
}
/** Shrinks a font until the text fits the width. */
const fit = (
  c: CanvasRenderingContext2D,
  text: string,
  max: number,
  size: number,
  font: (px: number) => string,
) => {
  let px = size
  c.font = font(px)
  while (c.measureText(text).width > max && px > 8) c.font = font(--px)
  return px
}
const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** What each Bot's process panel shows while it works: code, a diff, then the test run. */
const WORK = [
  [
    'export function Filter({ value, onChange }) {',
    '  return (',
    '    <input',
    '      className="filter"',
    '      placeholder="筛选…"',
    '      value={value}',
    '      onChange={(e) => onChange(e.target.value)}',
    '    />',
    '  )',
    '}',
  ],
  [
    "- app.get('/todos', () => db.todos.all())",
    "+ app.get('/todos', async (req) => {",
    "+   const q = req.query.q ?? ''",
    "+   return db.todos.whereLike('title', q)",
    '+ })',
    '',
    '  todos.ts  +4 −1',
  ],
  [
    ' RUN  v3.2  todo-app',
    ' ✓ filter matches title',
    ' ✓ filter is case-insensitive',
    ' ✓ empty query returns all',
    ' ✓ api/todos?q= works',
    ' … 8 more',
    '',
    ' Tests  12 passed (12)',
  ],
]

export function createHeroScene(o: Options): HeroScene {
  const renderer = new WebGLRenderer({
    canvas: o.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  let pixelRatio = Math.min(devicePixelRatio, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.toneMapping = NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap

  const scene = new Scene()
  scene.background = new Color()
  scene.fog = new Fog(LIGHT.bg, 24, 70)
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const env = pmrem.fromScene(room, 0.04).texture
  room.dispose()
  pmrem.dispose()
  scene.environment = env

  const camera = new PerspectiveCamera(30, 1, 0.1, 200)
  const add = <T extends Object3D>(obj: T, parent: Object3D = scene) => {
    parent.add(obj)
    return obj
  }
  const mesh = (
    geo: BufferGeometry,
    mat: Material,
    at: [number, number, number],
    parent: Object3D = scene,
    shadow = true,
  ) => {
    const m = add(new Mesh(geo, mat), parent)
    m.position.set(...at)
    m.castShadow = shadow
    m.receiveShadow = true
    return m
  }
  const std = (color: string, roughness = 0.7, extra: object = {}) =>
    new MeshStandardMaterial({ color, roughness, ...extra })
  const box = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, r)
  // Felt: fully rough with sheen, the soft fabric glow at grazing angles.
  const felt = (color: string, sheenColor = '#ffffff', vertexColors = false) =>
    new MeshPhysicalMaterial({ color, roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor, vertexColors })

  // Lights: a warm key through the (off-frame) window, sky fill, a cool rim that makes fur edges glow.
  const hemi = add(new HemisphereLight())
  const key = add(new DirectionalLight())
  key.position.set(-7, 11, 7)
  key.target.position.set(0, 0, -0.5)
  add(key.target)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 45 })
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02
  key.shadow.radius = 5
  const rim = add(new DirectionalLight())
  rim.position.set(6, 5, -9)

  const WALL_H = 7.2
  const BACK = -3.2
  // The studio is a whole room the camera stands in: floor, back wall and ceiling run past every edge of the frame.
  const plank = canvasTexture(512, 512)
  {
    const c = plank.ctx
    c.fillStyle = '#d6b58b'
    c.fillRect(0, 0, 512, 512)
    for (let y = 0; y < 512; y += 64) {
      c.fillStyle = `rgba(120,80,40,${0.04 + ((y / 64) % 3) * 0.025})`
      c.fillRect(0, y, 512, 64)
      c.fillStyle = 'rgba(90,60,30,0.28)'
      c.fillRect(0, y, 512, 2)
      c.fillRect(((y * 7) % 512) + 40, y, 2, 64)
    }
    plank.tex.wrapS = RepeatWrapping
    plank.tex.wrapT = RepeatWrapping
    plank.tex.repeat.set(9, 6)
  }
  const floor = mesh(
    new PlaneGeometry(60, 40).rotateX(-Math.PI / 2),
    std('#ffffff', 0.8, { map: plank.tex }),
    [0, 0, 6],
    scene,
    false,
  )
  floor.receiveShadow = true
  // A felt rug under the team.
  mesh(box(6.4, 0.03, 3.4, 0.02), felt('#b9d9d3', '#e8fffb'), [0, 0.02, -0.4], scene, false)

  const wallMat = std('#f6f2ea', 0.95)
  mesh(box(48, WALL_H, 0.24, 0.05), wallMat, [0, WALL_H / 2, BACK])
  mesh(box(48, 0.16, 0.06, 0.02), std('#b88c5e', 0.6), [0, 0.08, BACK + 0.14], scene, false)
  mesh(new PlaneGeometry(60, 30).rotateX(Math.PI / 2), std('#efe8db', 1), [0, WALL_H, 10], scene, false)
  const beamMat = std('#c9a47a', 0.6)
  for (let x = -13.5; x <= 13.5; x += 3)
    mesh(box(0.28, 0.34, 26, 0.04), beamMat, [x, WALL_H - 0.17, 9.8], scene, false)
  const frameMat = std('#c9b08a', 0.6)
  outline(mesh(box(1.7, 1.6, 0.1), frameMat, [-3.7, 1.95, -3.05]))
  const windowMat = new MeshBasicMaterial({ toneMapped: false })
  mesh(new PlaneGeometry(1.48, 1.36), windowMat, [-3.7, 1.95, -2.99], scene, false)
  mesh(box(0.06, 1.36, 0.06, 0.02), frameMat, [-3.7, 1.95, -2.97], scene, false)
  const moonMat = new MeshBasicMaterial({ color: '#f1ead6', transparent: true, toneMapped: false })
  mesh(new CircleGeometry(0.16, 32), moonMat, [-3.35, 2.35, -2.98], scene, false)

  // Tall windows on the flanks look out on a hazy city, so the space keeps going beyond the wall.
  const outside = canvasTexture(1024, 768)
  const viewMat = new MeshBasicMaterial({ map: outside.tex, toneMapped: false })
  let viewDrawn = -1
  const drawView = (night: boolean) => {
    const v = night ? 1 : 0
    if (viewDrawn === v) return
    viewDrawn = v
    const c = outside.ctx
    const sky = c.createLinearGradient(0, 0, 0, 768)
    sky.addColorStop(0, night ? '#101a33' : '#bcd8f0')
    sky.addColorStop(1, night ? '#2a3550' : '#f3ecdf')
    c.fillStyle = sky
    c.fillRect(0, 0, 1024, 768)
    c.filter = 'blur(6px)'
    for (let k = 0; k < 2; k++) {
      c.fillStyle = night ? ['#1d2740', '#141c30'][k] : ['#c6cfd8', '#a9b5c2'][k]
      for (let x = -20; x < 1040; x += 70 + ((x * 13) % 50)) {
        const h = 180 + ((x * 31 + k * 97) % 260) + k * 80
        c.fillRect(x, 768 - h, 60 + ((x * 7) % 40), h)
        if (night)
          for (let wy = 768 - h + 20; wy < 740; wy += 34)
            for (let wx = x + 10; wx < x + 50; wx += 18) {
              c.fillStyle = (wx * wy) % 7 < 2 ? 'rgba(255,214,140,0.7)' : 'rgba(0,0,0,0)'
              c.fillRect(wx, wy, 7, 10)
              c.fillStyle = ['#1d2740', '#141c30'][k]
            }
      }
    }
    c.filter = 'none'
    outside.tex.needsUpdate = true
  }
  for (const x of [-7.8, 8.2]) {
    outline(mesh(box(3.3, 3.3, 0.12), frameMat, [x, 2.6, BACK + 0.06]))
    mesh(new PlaneGeometry(3.05, 3.05), viewMat, [x, 2.6, BACK + 0.13], scene, false)
    mesh(box(0.07, 3.05, 0.07, 0.02), frameMat, [x, 2.6, BACK + 0.16], scene, false)
    mesh(box(3.05, 0.07, 0.07, 0.02), frameMat, [x, 2.9, BACK + 0.16], scene, false)
  }
  // Bookshelves beyond the windows.
  const bookColors = ['#c23b22', '#2f6bff', '#14b3ae', '#ffd66b', '#6b83a3', '#e8c089']
  for (const x of [-11.4, 11.6]) {
    outline(mesh(box(2.4, 3.2, 0.5, 0.04), std('#b88c5e', 0.6), [x, 1.6, BACK + 0.3]))
    for (let r = 0; r < 4; r++)
      for (let b = 0; b < 9; b++) {
        const h = 0.42 + ((b * 7 + r * 3) % 4) * 0.06
        mesh(
          box(0.2, h, 0.36, 0.02),
          std(bookColors[(b + r * 2) % 6], 0.8),
          [x - 0.95 + b * 0.235, 0.2 + r * 0.76 + h / 2, BACK + 0.36],
          scene,
          false,
        )
      }
  }

  const wall = canvasTexture(1280, 720)
  const tvMat = new MeshBasicMaterial({ map: wall.tex, toneMapped: false })
  outline(mesh(box(4.7, 2.72, 0.1, 0.05), std(INK, 0.4), [0.1, 2.0, -3.03]))
  mesh(new PlaneGeometry(4.52, 2.54), tvMat, [0.1, 2.0, -2.97], scene, false)
  const tvLight = add(new PointLight('#9cc4ff', 1, 6, 1.5))
  tvLight.position.set(0.15, 2.0, -2.3)

  const board = canvasTexture(640, 480)
  const boardMat = new MeshStandardMaterial({ map: board.tex, roughness: 0.9 })
  outline(mesh(box(1.95, 1.6, 0.08), std('#d8c09a', 0.7), [3.85, 2.0, -3.04]))
  mesh(new PlaneGeometry(1.81, 1.46), boardMat, [3.85, 2.0, -2.99], scene, false)
  const NOTE_COLORS = ['#ffd66b', '#ff9fb6', '#9fd3ff', '#b6e39a']
  const noteGeo = box(0.32, 0.27, 0.02, 0.01)
  const colX = (c: number) => 3.85 - 0.68 + c * 0.453
  ;[
    [0, 0],
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 0],
    [3, 1],
  ].forEach(([c, r], i) => {
    const n = mesh(noteGeo, std(NOTE_COLORS[i % 4], 0.9), [colX(c), 2.3 - r * 0.38, -2.96], scene, false)
    n.rotation.z = (i % 3) * 0.05 - 0.05
  })
  const taskNote = mesh(box(0.36, 0.29, 0.03, 0.01), std(JADE, 0.6), [colX(0), 1.5, -2.94], scene, false)
  const taskTex = canvasTexture(160, 128)
  taskTex.ctx.fillStyle = '#ffffff'
  taskTex.ctx.font = `700 34px ${UI_FONT}`
  taskTex.ctx.textAlign = 'center'
  taskTex.ctx.fillText('#42', 80, 52)
  taskTex.ctx.font = `600 26px ${UI_FONT}`
  taskTex.ctx.fillText(o.copy.task, 80, 96)
  const taskFace = new MeshBasicMaterial({ map: taskTex.tex, transparent: true })
  mesh(new PlaneGeometry(0.34, 0.27), taskFace, [0, 0, 0.017], taskNote, false)

  // The shared table, stools, laptops, mugs, plants and a lamp.
  const wood = std('#c89f72', 0.55)
  const TABLE = { x: 2.3, z0: -0.55, z1: 0.85, y: 0.78 }
  outline(
    mesh(box(TABLE.x * 2, 0.08, TABLE.z1 - TABLE.z0, 0.03), wood, [0, TABLE.y, (TABLE.z0 + TABLE.z1) / 2]),
  )
  for (const [x, z] of [
    [-2.15, -0.42],
    [2.15, -0.42],
    [-2.15, 0.72],
    [2.15, 0.72],
  ])
    mesh(box(0.08, TABLE.y, 0.08, 0.02), wood, [x, TABLE.y / 2, z])
  const stoolMat = std('#7a8aa3', 0.6)
  const stool = (x: number, z: number) => {
    outline(mesh(new CylinderGeometry(0.28, 0.28, 0.08, 20), stoolMat, [x, 0.46, z]))
    mesh(new CylinderGeometry(0.04, 0.06, 0.44, 8), stoolMat, [x, 0.22, z])
  }
  const shell = std('#d9dde3', 0.35, { metalness: 0.3 })
  const sticker = new MeshBasicMaterial({ color: JADE })
  interface Laptop {
    glow: MeshBasicMaterial
  }
  const laptop = (x: number, z: number, yaw: number): Laptop => {
    const g = add(new Group())
    g.position.set(x, TABLE.y + 0.04, z)
    g.rotation.y = yaw
    outline(mesh(box(0.7, 0.03, 0.48, 0.015), shell, [0, 0.015, 0], g), 0.008)
    const lid = add(new Group(), g)
    lid.position.set(0, 0.03, -0.24)
    lid.rotation.x = -0.25
    outline(mesh(box(0.7, 0.46, 0.025, 0.015), shell, [0, 0.23, 0], lid), 0.008)
    const glow = new MeshBasicMaterial({ color: '#cfe3ff', toneMapped: false })
    mesh(new PlaneGeometry(0.64, 0.4), glow, [0, 0.23, 0.014], lid, false)
    const s = mesh(new CircleGeometry(0.05, 4), sticker, [0, 0.25, -0.014], lid, false)
    s.rotation.y = Math.PI
    return { glow }
  }
  const mugMat = std('#f6f1e7', 0.4)
  const mug = (x: number, z: number, c: string) => {
    const m = outline(
      mesh(new CylinderGeometry(0.07, 0.065, 0.16, 16), mugMat, [x, TABLE.y + 0.12, z]),
      0.006,
    )
    mesh(new TorusGeometry(0.045, 0.014, 6, 12), mugMat, [0.075, 0, 0], m).rotation.y = 0
    mesh(new CylinderGeometry(0.072, 0.072, 0.03, 16), std(c, 0.8), [0, 0.03, 0], m, false)
    return m
  }
  const leafMat = std('#5f9e6e', 0.8)
  const potMat = std('#d98c5f', 0.7)
  const plant = (x: number, y: number, z: number, s: number) => {
    const p = add(new Group())
    p.position.set(x, y, z)
    p.scale.setScalar(s)
    outline(mesh(new CylinderGeometry(0.16, 0.12, 0.26, 12), potMat, [0, 0.13, 0], p), 0.01)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const leaf = mesh(new SphereGeometry(0.12, 10, 8).scale(0.55, 1.4, 0.25), leafMat, [0, 0.42, 0], p)
      leaf.position.x = Math.cos(a) * 0.08
      leaf.position.z = Math.sin(a) * 0.08
      leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5)
    }
    return p
  }
  plant(-5.0, 0, -2.6, 2.2)
  plant(5.3, 0, -2.6, 2.0)
  plant(1.95, TABLE.y + 0.04, 0.6, 0.8)
  mug(0.35, 0.5, '#3b6fd8')
  mug(1.05, 0.62, '#7b4a2e')
  mug(-1.0, 0.62, '#7b4a2e')
  const lampMat = std(SEAL, 0.5)
  const lamp = add(new Group())
  lamp.position.set(-1.75, TABLE.y + 0.04, -0.35)
  mesh(new CylinderGeometry(0.12, 0.14, 0.04, 16), lampMat, [0, 0.02, 0], lamp)
  mesh(new CylinderGeometry(0.015, 0.015, 0.5, 6), lampMat, [0, 0.27, 0], lamp)
  const shade = outline(
    mesh(
      new CylinderGeometry(0.06, 0.17, 0.18, 16, 1, true),
      std(SEAL, 0.5, { side: DoubleSide }),
      [0.08, 0.52, 0],
      lamp,
    ),
    0.008,
  )
  shade.rotation.z = -0.4
  const bulbMat = new MeshBasicMaterial({ color: '#fff2c9', toneMapped: false })
  mesh(new SphereGeometry(0.045, 12, 8), bulbMat, [0.1, 0.47, 0], lamp, false)
  const lampLight = add(new PointLight('#ffc77a', 1, 5, 1.6), lamp)
  // Wall sconces flank the screen, low enough to stay clear of the site nav; they glow at night.
  const pendantMat = new MeshBasicMaterial({ color: '#f4ead2', toneMapped: false })
  for (const x of [-5.5, 5.5]) {
    mesh(box(0.08, 0.4, 0.3, 0.02), std('#b88c5e', 0.5), [x, 3.2, BACK + 0.25], scene, false)
    outline(
      mesh(new CylinderGeometry(0.2, 0.13, 0.26, 20, 1, true), std('#e8c089', 0.45, { side: DoubleSide }), [
        x,
        3.42,
        BACK + 0.42,
      ]),
      0.008,
    )
    mesh(new SphereGeometry(0.1, 14, 10), pendantMat, [x, 3.27, BACK + 0.42], scene, false)
  }
  const pendantLight = add(new PointLight('#ffd08a', 1, 9, 1.4))
  pendantLight.position.set(0, WALL_H - 2.6, 0.6)
  // One shared glow from the Bots' screens lights their faces; per-laptop lights cost too much per pixel.
  const screenLight = add(new PointLight('#a8c8ff', 1, 4, 1.5))
  screenLight.position.set(0, TABLE.y + 0.5, -0.6)
  lampLight.position.set(0.14, 0.4, 0)

  // Plush details: glossy buttons for eyes, thread for stitches and mouths.
  const button = new MeshPhysicalMaterial({
    color: '#111522',
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  })
  const thread = new MeshStandardMaterial({ color: '#2a2f3d', roughness: 1 })
  const faceFelt = felt('#fbf7ef')
  const cheekFelt = felt('#ff9db7')
  const stitchGeo = new CapsuleGeometry(0.006, 0.022, 2, 4).rotateZ(Math.PI / 2)
  /** Running stitches around a rounded rectangle, the seam of a felt patch. */
  const stitches = (parent: Object3D, w: number, h: number, z: number, color: string) => {
    const pts: [number, number, number][] = []
    const step = 0.05
    for (let x = -w / 2 + 0.04; x <= w / 2 - 0.04; x += step) pts.push([x, h / 2, 0], [x, -h / 2, 0])
    for (let y = -h / 2 + 0.04; y <= h / 2 - 0.04; y += step)
      pts.push([w / 2, y, Math.PI / 2], [-w / 2, y, Math.PI / 2])
    const im = new InstancedMesh(stitchGeo, new MeshStandardMaterial({ color, roughness: 1 }), pts.length)
    const tmpObj = new Group()
    pts.forEach(([x, y, r], i) => {
      tmpObj.position.set(x, y, z)
      tmpObj.rotation.set(0, 0, r)
      tmpObj.updateMatrix()
      im.setMatrixAt(i, tmpObj.matrix)
    })
    parent.add(im)
  }
  const faceOn = (parent: Object3D, y: number, z: number, gap: number, s = 1) => {
    const eye = new SphereGeometry(0.038 * s, 16, 10).scale(1, 1.1, 0.55)
    for (const x of [-gap, gap]) {
      mesh(eye, button, [x, y, z], parent, false)
      mesh(
        new SphereGeometry(0.009 * s, 6, 4),
        new MeshBasicMaterial({ color: '#ffffff' }),
        [x + 0.012 * s, y + 0.014 * s, z + 0.02 * s],
        parent,
        false,
      )
    }
    const mouth = new TorusGeometry(0.04 * s, 0.007 * s, 6, 14, Math.PI).rotateZ(Math.PI)
    mesh(mouth, thread, [0, y - 0.075 * s, z - 0.004], parent, false)
    for (const x of [-gap - 0.03 * s, gap + 0.03 * s])
      mesh(new CircleGeometry(0.026 * s, 16), cheekFelt, [x, y - 0.06 * s, z + 0.002], parent, false)
  }
  const badgeTex = (text: string, bg: string) => {
    const t = canvasTexture(192, 96)
    t.ctx.fillStyle = bg
    roundRect(t.ctx, 4, 4, 184, 88, 26)
    t.ctx.fill()
    t.ctx.setLineDash([10, 8])
    t.ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    t.ctx.lineWidth = 4
    roundRect(t.ctx, 14, 14, 164, 68, 18)
    t.ctx.stroke()
    t.ctx.fillStyle = '#ffffff'
    t.ctx.font = `700 40px ${UI_FONT}`
    t.ctx.textAlign = 'center'
    t.ctx.textBaseline = 'middle'
    t.ctx.fillText(text, 96, 50)
    return new MeshPhysicalMaterial({ map: t.tex, roughness: 1, sheen: 0.6, transparent: true })
  }

  // The brand lives in the room: felt letter tiles mounted high on the back wall, the seal as a stamp block, a slogan banner.
  const tileFelt = felt('#fbf7ef')
  const brand = add(new Group())
  const units = o.brand.title.includes(' ') ? o.brand.title.split(' ') : [...o.brand.title]
  const unitW = units.map((u) => (u.length === 1 ? 0.92 : 0.36 * u.length + 0.3))
  const gap = 0.1
  let tx = -(unitW.reduce((a, b) => a + b, 0) + gap * (units.length - 1)) / 2 - 0.45
  units.forEach((u, i) => {
    const w = unitW[i]
    const tile = outline(
      mesh(box(w, 0.92, 0.5, 0.12), tileFelt, [tx + w / 2, 4.85, BACK + 0.36], brand),
      0.014,
    )
    tile.rotation.z = [0.04, -0.03, 0.05, -0.04][i % 4]
    tx += w + gap
    const tex = textCard(w - 0.1, 0.8, (c, W, H) => {
      c.fillStyle = INK
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      fit(c, u, W * 0.92, H * 0.78, (px) => `900 ${px}px ${SERIF}`)
      c.fillText(u, W / 2, H * 0.55)
    })
    mesh(
      new PlaneGeometry(w - 0.1, 0.8),
      new MeshBasicMaterial({ map: tex, transparent: true }),
      [0, 0, 0.252],
      tile,
      false,
    )
    stitches(tile, w - 0.12, 0.8, 0.252, '#cdbfa8')
  })
  const seal = outline(
    mesh(box(0.62, 0.62, 0.62, 0.08), felt(SEAL, '#ff9a86'), [tx + 0.25, 5.02, BACK + 0.45], brand),
    0.014,
  )
  seal.rotation.set(0, -0.2, 0.12)
  const sealTex = textCard(0.52, 0.52, (c, W, H) => {
    c.fillStyle = '#fbf3ea'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `900 ${H * 0.42}px ${SERIF}`
    c.fillText(o.brand.seal[0], W / 2, H * 0.28)
    c.fillText(o.brand.seal[1], W / 2, H * 0.74)
  })
  mesh(
    new PlaneGeometry(0.52, 0.52),
    new MeshBasicMaterial({ map: sealTex, transparent: true }),
    [0, 0, 0.312],
    seal,
    false,
  )
  const bannerTex = textCard(
    5.6,
    0.5,
    (c, W, H) => {
      c.fillStyle = '#1b2233'
      roundRect(c, 0, 0, W, H, H * 0.22)
      c.fill()
      c.setLineDash([H * 0.12, H * 0.09])
      c.strokeStyle = 'rgba(243,239,230,0.55)'
      c.lineWidth = H * 0.035
      roundRect(c, H * 0.1, H * 0.1, W - H * 0.2, H * 0.8, H * 0.16)
      c.stroke()
      c.fillStyle = '#f3efe6'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      fit(c, o.brand.slogan, W * 0.9, H * 0.5, (px) => `700 ${px}px ${SERIF}`)
      c.fillText(o.brand.slogan, W / 2, H * 0.53)
    },
    400,
  )
  const bannerMat = new MeshPhysicalMaterial({ map: bannerTex, roughness: 1, sheen: 0.5, transparent: true })
  mesh(new PlaneGeometry(5.6, 0.5), bannerMat, [0.1, 3.78, -2.98], brand, false)

  interface Actor {
    root: Group
    body: Group
    /** Hands that bounce on the keys while typing. */
    hands: Object3D[]
    /** Rest heading and where the jade card is held. */
    yaw: number
    hold: Vector3
    head: number
    hop: number
    laptop?: Laptop
    led?: MeshBasicMaterial
    ledColor?: string
  }
  const actor = (x: number, z: number, yaw: number, head: number): Actor => {
    const root = add(new Group())
    root.position.set(x, 0, z)
    root.rotation.y = yaw
    const body = add(new Group(), root)
    return { root, body, hands: [], yaw, hold: new Vector3(), head, hop: -9 }
  }

  // 共字君: the 共 glyph as a standing plush, fur in the logo's blue-to-teal.
  const U = 1 / 70
  const gongzi = () => {
    const a = actor(3.35, -0.5, -0.5, 1.75)
    const grad = vgrad('#2f6bff', '#0fa3a0', 0.2, 1.5)
    const bar = (x: number, y: number, w: number, h: number, parent: Object3D = a.body) => {
      const g = new RoundedBoxGeometry(w * U, h * U, 0.2, 3, 4.4 * U)
      const oy = (106 - y) * U
      paint(g, (gy) => grad(gy + oy))
      return furry(mesh(g, felt('#ffffff', '#cfe6ff', true), [(x - 60) * U, oy, 0], parent), 0.045, 30)
    }
    const win = mesh(
      new RoundedBoxGeometry(24 * U, 23 * U, 0.14, 3, 4 * U),
      faceFelt,
      [0, (106 - 52.5) * U, -0.01],
      a.body,
    )
    stitches(win, 22 * U, 21 * U, 0.075, '#9fb2c8')
    bar(45.5, 44, 9, 44)
    bar(74.5, 44, 9, 44)
    bar(60, 38.5, 58, 9)
    bar(60, 66.5, 44, 9)
    for (const s of [-1, 1]) {
      const pivot = add(new Group(), a.body)
      pivot.position.set(s * 20 * U, (106 - 66.5) * U, 0)
      bar(60 + s * 7, 66.5, 22, 9, pivot).position.set(s * 7 * U, 0, 0)
      a.hands.push(pivot)
    }
    for (const s of [-1, 1]) {
      const leg = new CapsuleGeometry(4.4 * U, 22 * U, 4, 10)
      paint(leg, () => new Color('#0fa3a0'))
      const m = mesh(leg, felt('#ffffff', '#cfe6ff', true), [s * 14.5 * U, (106 - 90.5) * U, 0], a.body)
      m.rotation.z = s * 0.34
      furry(m, 0.035, 30)
    }
    faceOn(a.body, (106 - 50.5) * U, 0.085, 4.6 * U, 0.85)
    const gem = mesh(
      new LatheGeometry(
        [new Vector2(0, -1), new Vector2(0.8, 0), new Vector2(0.6, 0.2), new Vector2(0, 1)],
        8,
      ).scale(0.09, 0.09, 0.09),
      new MeshPhysicalMaterial({
        color: '#7ae8d6',
        roughness: 0.05,
        clearcoat: 1,
        emissive: JADE,
        emissiveIntensity: 0.4,
        flatShading: true,
      }),
      [0, (106 - 9) * U, 0],
      a.body,
    )
    gem.userData.spin = true
    a.hold.set(0.6, 1.0, 0.3)
    return a
  }

  // Persona Bots: a plush tile in the persona's colours, a felt face patch, button eyes, a stitched role badge.
  const bot = (key: string, x: number, badge: string): Actor => {
    const p = PERSONAS.find((q) => q.key === key) ?? PERSONAS[0]
    const a = actor(x, -1.15, 0, 1.5)
    stool(x, -1.15)
    const tile = new RoundedBoxGeometry(0.78, 0.74, 0.56, 4, 0.22)
    paint(tile, vgrad(p.from, p.to, -0.37, 0.37))
    furry(mesh(tile, felt('#ffffff', p.from, true), [0, 0.88, 0], a.body), 0.06, 24)
    const plate = mesh(new RoundedBoxGeometry(0.5, 0.32, 0.06, 3, 0.1), faceFelt, [0, 0.98, 0.315], a.body)
    stitches(plate, 0.44, 0.26, 0.034, '#b9bfcb')
    faceOn(plate, 0.02, 0.034, 0.1)
    if (badge)
      mesh(new PlaneGeometry(0.3, 0.15), badgeTex(badge, p.to), [0, 0.68, 0.33], a.body, false).rotation.x =
        -0.05
    const glove = new SphereGeometry(0.1, 16, 12)
    for (const s of [-1, 1]) {
      const h = furry(mesh(glove, felt('#fbf8f2'), [s * 0.28, 0.88, 0.5], a.body), 0.035, 34, '#f7f3ea')
      a.hands.push(h)
    }
    a.laptop = laptop(x, -0.12, Math.PI)
    // The Bot's own machine: it runs on its owner's computer, so the box sits right beside it, wired up.
    const tower = add(new Group())
    tower.position.set(x + 0.55, 0, -1.55)
    outline(mesh(box(0.3, 0.5, 0.44, 0.03), std('#3a4252', 0.5), [0, 0.25, 0], tower))
    const led = new MeshBasicMaterial({ color: p.to, toneMapped: false })
    mesh(new PlaneGeometry(0.04, 0.3), led, [0.08, 0.27, 0.225], tower, false)
    const cable = new CatmullRomCurve3([
      new Vector3(x + 0.55, 0.05, -1.32),
      new Vector3(x + 0.5, 0.02, -0.9),
      new Vector3(x + 0.45, 0.4, -0.5),
      new Vector3(x + 0.3, TABLE.y + 0.04, -0.3),
    ])
    mesh(new TubeGeometry(cable, 24, 0.012, 6), std('#2a2f3d', 0.6), [0, 0, 0], scene, false)
    a.led = led
    a.ledColor = p.from
    a.hold.set(0, 1.55, 0.55)
    return a
  }

  // The owner: a plush teammate in a seal-red knit, hair in fur.
  const human = () => {
    const a = actor(-3.0, 0.2, Math.PI / 2, 1.55)
    stool(-3.0, 0.2)
    const sweater = mesh(new CapsuleGeometry(0.26, 0.32, 6, 16), felt(SEAL, '#ffb8a8'), [0, 0.86, 0], a.body)
    furry(sweater, 0.028, 40, '#b8341d')
    const head = mesh(new SphereGeometry(0.25, 24, 18), felt('#f3d2b5', '#fff0e2'), [0, 1.36, 0.02], a.body)
    const hair = mesh(
      new SphereGeometry(0.265, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      felt('#2b2420'),
      [0, 0.02, -0.02],
      head,
    )
    hair.rotation.x = -0.35
    furry(hair, 0.045, 34, '#2b2420')
    faceOn(head, 0.0, 0.235, 0.085, 1.1)
    for (const s of [-1, 1]) {
      const pivot = add(new Group(), a.body)
      pivot.position.set(s * 0.27, 1.02, 0.02)
      const arm = mesh(new CapsuleGeometry(0.075, 0.3, 4, 10), felt(SEAL), [0, -0.12, 0.14], pivot)
      arm.rotation.x = 1.1
      furry(arm, 0.025, 40, '#b8341d')
      mesh(new SphereGeometry(0.07, 12, 10), felt('#f3d2b5'), [0, -0.05, 0.31], pivot)
      a.hands.push(pivot)
    }
    a.laptop = laptop(-2.0, 0.2, -Math.PI / 2)
    a.hold.set(0.1, 1.5, 0.5)
    return a
  }

  const owner = human()
  const coord = gongzi()
  const BOTS = ['abacus', 'no', 'steps']
  const bots = BOTS.map((k, i) => bot(k, -1.5 + i * 1.5, o.copy.badges[i]))
  const team = [owner, coord, ...bots]
  // Two quieter desks on the flanks: more of the team, idling between tasks.
  const idle = ['hammock', 'braces'].map((k, i) => {
    const x = i ? 6.9 : -6.6
    outline(mesh(box(2.0, 0.08, 1.2, 0.03), wood, [x, TABLE.y, -0.4]))
    for (const [dx, dz] of [
      [-0.9, -0.5],
      [0.9, -0.5],
      [-0.9, 0.5],
      [0.9, 0.5],
    ])
      mesh(box(0.07, TABLE.y, 0.07, 0.02), wood, [x + dx, TABLE.y / 2, -0.4 + dz])
    mug(x - 0.6, 0.0, '#7b4a2e')
    return bot(k, x, '')
  })

  // The counter nearest the camera: the actions sit on it, clear of the team behind.
  const COUNTER = { z: 3.6, y: 0.95 }
  const counterWood = std('#9c6b43', 0.5)
  const counter = add(new Group())
  outline(mesh(box(40, 0.1, 1.5, 0.04), counterWood, [0, COUNTER.y - 0.05, COUNTER.z], counter), 0.012)
  mesh(
    box(40, COUNTER.y - 0.1, 0.08, 0.02),
    std('#b88c5e', 0.6),
    [0, (COUNTER.y - 0.1) / 2, COUNTER.z + 0.7],
    counter,
  )
  mesh(
    box(40, 0.02, 1.0, 0.01),
    felt('#2f3a4e', '#8fa3c2'),
    [0, COUNTER.y + 0.01, COUNTER.z + 0.05],
    counter,
    false,
  )
  // Soft foreground at the frame edges sells the scale: a leafy plant on one side, a mug and a cable on the other.
  const fgPlant = plant(-3, COUNTER.y, COUNTER.z + 0.25, 1.1)
  const fgMug = mug(3, COUNTER.z + 0.3, '#3b6fd8')
  fgMug.position.y = COUNTER.y + 0.12
  fgMug.scale.setScalar(1.15)
  counter.add(fgPlant, fgMug)
  mesh(
    new TubeGeometry(
      new CatmullRomCurve3([
        new Vector3(-30, 0, 0),
        new Vector3(-1, 0, 0.2),
        new Vector3(1, 0, -0.1),
        new Vector3(30, 0, 0),
      ]),
      64,
      0.02,
      6,
    ),
    std('#2a2f3d', 0.6),
    [0, COUNTER.y + 0.02, COUNTER.z + 0.55],
    counter,
    false,
  )
  /*
   * The three actions are objects in the room: an Enter keycap to get started, a sticky note asking what this is,
   * and a felt GitHub badge. Each turns to face the camera, lifts and glows when pointed at or focused, and dips
   * when pressed.
   */
  const GITHUB = new Path2D(
    'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.38.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z',
  )
  interface Action {
    root: Group
    body: Group
    ring: Mesh
    ringMat: MeshBasicMaterial
    lift: number
    pressAt: number
  }
  const ringGeo = new RingGeometry(0.76, 0.9, 48).rotateX(-Math.PI / 2)
  const action = (x: number, z: number, build: (g: Group) => void): Action => {
    const root = add(new Group())
    root.position.set(x, COUNTER.y, COUNTER.z + z)
    root.userData.z = z
    const body = add(new Group(), root)
    build(body)
    const ringMat = new MeshBasicMaterial({
      color: JADE,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    })
    const ring = mesh(ringGeo, ringMat, [0, 0.02, 0], root, false)
    return { root, body, ring, ringMat, lift: 0, pressAt: -9 }
  }
  const labelMat = (
    w: number,
    h: number,
    draw: (c: CanvasRenderingContext2D, W: number, H: number) => void,
  ) => new MeshBasicMaterial({ map: textCard(w, h, draw), transparent: true })
  const centred = (c: CanvasRenderingContext2D) => {
    c.textAlign = 'center'
    c.textBaseline = 'middle'
  }
  const [startText, aboutText, githubText] = o.brand.actions
  const actions = [
    action(-2.45, 0, (g) => {
      const cap = add(new Group(), g)
      cap.position.y = 0.42
      cap.rotation.x = 0.62
      outline(mesh(box(1.7, 0.42, 1.0, 0.16), std(INK, 0.45), [0, 0, 0], cap), 0.014)
      const label = labelMat(1.5, 0.82, (c, W, H) => {
        centred(c)
        c.fillStyle = '#f3efe6'
        fit(c, startText, W * 0.86, H * 0.36, (px) => `700 ${px}px ${UI_FONT}`)
        c.fillText(startText, W / 2, H * 0.42)
        c.font = `700 ${H * 0.26}px ${UI_FONT}`
        c.fillStyle = '#5fe0cc'
        c.fillText('↵', W / 2, H * 0.8)
      })
      mesh(new PlaneGeometry(1.5, 0.82).rotateX(-Math.PI / 2), label, [0, 0.212, 0], cap, false)
      mesh(box(1.8, 0.16, 1.05, 0.05), std('#3a4252', 0.6), [0, -0.2, -0.05], cap)
    }),
    action(0.0, 0.1, (g) => {
      for (const s of [-1, 1])
        mesh(new CylinderGeometry(0.025, 0.03, 0.8, 8), wood, [s * 0.45, 0.38, -0.14], g).rotation.x = -0.4
      const note = add(new Group(), g)
      note.position.set(0, 0.6, 0)
      note.rotation.x = -0.38
      outline(mesh(box(1.4, 1.15, 0.04, 0.02), felt('#ffd66b', '#fff2c2'), [0, 0, 0], note), 0.012)
      mesh(
        box(0.42, 0.13, 0.01, 0.005),
        std('#fdf7e8', 0.4, { transparent: true, opacity: 0.8 }),
        [0, 0.56, 0.03],
        note,
        false,
      ).rotation.z = 0.06
      const label = labelMat(1.3, 1.05, (c, W, H) => {
        centred(c)
        c.fillStyle = INK
        // Two lines: CJK splits after the name, other scripts after the question word.
        const sp = aboutText.split(' ')
        const half = Math.min(1, sp.length - 2)
        const words = aboutText.includes(' ')
          ? [sp.slice(0, half + 1).join(' '), `${sp.slice(half + 1).join(' ')}?`]
          : aboutText.length > 5
            ? [aboutText.slice(0, 4), `${aboutText.slice(4)}？`]
            : [aboutText]
        const size = Math.min(
          ...words.map((w) =>
            fit(c, w, W * 0.86, H * (words.length > 1 ? 0.24 : 0.17), (px) => `800 ${px}px ${SERIF}`),
          ),
        )
        c.font = `800 ${size}px ${SERIF}`
        words.forEach((w, i) => {
          c.fillText(w, W / 2, H * (words.length > 1 ? 0.33 + i * 0.27 : 0.42))
        })
        c.strokeStyle = SEAL
        c.lineWidth = H * 0.02
        c.beginPath()
        c.moveTo(W * 0.3, H * 0.86)
        c.quadraticCurveTo(W * 0.5, H * 0.82, W * 0.7, H * 0.86)
        c.stroke()
      })
      mesh(new PlaneGeometry(1.3, 1.05), label, [0, 0, 0.022], note, false)
    }),
    action(2.35, 0, (g) => {
      mesh(new CylinderGeometry(0.035, 0.045, 0.4, 8), wood, [0, 0.2, -0.05], g)
      mesh(new CylinderGeometry(0.3, 0.34, 0.06, 20), wood, [0, 0.03, -0.05], g)
      const badge = add(new Group(), g)
      badge.position.set(0, 0.68, 0)
      badge.scale.setScalar(0.92)
      badge.rotation.x = -0.12
      furry(
        outline(
          mesh(
            new CylinderGeometry(0.6, 0.6, 0.1, 48).rotateX(Math.PI / 2),
            felt(INK, '#7f8aa6'),
            [0, 0, 0],
            badge,
          ),
          0.012,
        ),
        0.018,
        40,
        '#2a3142',
      )
      const label = labelMat(1.0, 1.0, (c, W, H) => {
        centred(c)
        c.save()
        c.translate(W * 0.31, H * 0.12)
        c.scale((W * 0.38) / 24, (W * 0.38) / 24)
        c.fillStyle = '#f3efe6'
        c.fill(GITHUB)
        c.restore()
        c.fillStyle = '#f3efe6'
        fit(c, githubText, W * 0.7, H * 0.17, (px) => `700 ${px}px ${UI_FONT}`)
        c.fillText(githubText, W / 2, H * 0.72)
      })
      mesh(new CircleGeometry(0.5, 48), label, [0, 0, 0.09], badge, false)
    }),
  ]
  actions.forEach((a, i) => {
    a.body.traverse((m) => {
      m.userData.action = i
    })
  })
  let highlight = -1
  const raycaster = new Raycaster()
  const ndc = new Vector2()

  // The jade task card handed from desk to desk.
  const card = add(new Group())
  outline(
    mesh(
      box(0.34, 0.24, 0.025, 0.015),
      std(JADE, 0.5, { emissive: JADE, emissiveIntensity: 0.35 }),
      [0, 0, 0],
      card,
    ),
    0.008,
  )
  mesh(new PlaneGeometry(0.32, 0.25), taskFace, [0, 0, 0.014], card, false)
  // An @ ring that lights up whoever is mentioned, and a red ping above their screen.
  const ring = mesh(
    new TorusGeometry(0.42, 0.016, 8, 48).rotateX(Math.PI / 2),
    new MeshBasicMaterial({ color: JADE, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    [0, 0, 0],
    scene,
    false,
  )
  const ping = mesh(
    new IcosahedronGeometry(0.06, 2),
    new MeshBasicMaterial({ color: '#ff4d3a', toneMapped: false }),
    [0, 0, 0],
    scene,
    false,
  )

  // Screens: the wall shows the group chat plus the live process of whoever is working; the board tracks the task.
  const AVATAR = [
    '#c23b22',
    '#2f6bff',
    ...BOTS.map((k) => (PERSONAS.find((p) => p.key === k) ?? PERSONAS[0]).to),
  ]
  interface ChatState {
    msgs: number
    approved: boolean
    worker: number
    progress: number
    typing: number
    dark: boolean
    column: number
    idle: boolean
  }
  let drawn = ''
  const drawWall = (s: ChatState) => {
    const keyStr = JSON.stringify(s)
    if (keyStr === drawn) return
    drawn = keyStr
    const c = wall.ctx
    const W = 1280
    const Hh = 720
    const night = s.dark
    c.fillStyle = night ? '#151a25' : '#fbf9f4'
    c.fillRect(0, 0, W, Hh)
    c.fillStyle = night ? '#1d2331' : '#efe9dd'
    c.fillRect(0, 0, W, 74)
    c.fillStyle = night ? '#e9e6de' : INK
    c.font = `700 36px ${UI_FONT}`
    c.textBaseline = 'middle'
    c.fillText(`# ${o.copy.group}`, 32, 38)
    // The group announcement carries the tagline, one crisp line (two if it must).
    c.fillStyle = night ? '#1a2a2c' : '#e3f4f1'
    c.fillRect(0, 74, W, 62)
    c.fillStyle = night ? '#9fe7da' : '#0b7d68'
    const pin = `📌 ${o.brand.tagline}`
    if (fit(c, pin, W - 56, 26, (p) => `600 ${p}px ${UI_FONT}`) < 19) {
      const mid = pin.indexOf(' ', pin.length / 2)
      fit(c, pin.slice(0, mid), W - 56, 22, (p) => `600 ${p}px ${UI_FONT}`)
      c.fillText(pin.slice(0, mid), 28, 92)
      c.fillText(pin.slice(mid + 1), 28, 119)
    } else c.fillText(pin, 28, 106)
    // Chat column.
    const lines = o.copy.lines.slice(0, s.msgs).map((text, i) => ({ who: i === 4 ? 4 : i, text }))
    if (s.approved) lines.push({ who: 0, text: o.copy.approved })
    const senders = [0, 1, 2, 3, 4]
    let y = 150
    for (const m of lines.slice(-3)) {
      const who = senders[m.who]
      c.fillStyle = AVATAR[who]
      c.beginPath()
      c.arc(64, y + 44, 34, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = night ? '#9aa0ad' : '#6b7080'
      c.font = `600 30px ${UI_FONT}`
      c.fillText(o.copy.names[who], 116, y + 14)
      c.fillStyle = night ? '#e9e6de' : INK
      c.font = `500 44px ${UI_FONT}`
      const text = m.text
      // Mentions read in brand blue, like the app.
      let x = 116
      for (const part of text.split(/(@\S+)/)) {
        if (!part) continue
        c.fillStyle = part.startsWith('@')
          ? '#2f80ff'
          : part.startsWith('✓')
            ? '#1f9d55'
            : night
              ? '#e9e6de'
              : INK
        c.fillText(part, x, y + 66)
        x += c.measureText(part).width
      }
      y += 160
    }
    if (s.typing >= 0) {
      c.fillStyle = night ? '#7c7f88' : '#8b8f9b'
      c.font = `500 26px ${UI_FONT}`
      c.fillText(`${o.copy.names[s.typing]} ${o.copy.typing}`, 108, Hh - 30)
    }
    // Process panel.
    const px = 880
    c.fillStyle = night ? '#0c1018' : '#1b2233'
    roundRect(c, px, 150, W - px - 24, Hh - 174, 18)
    c.fill()
    c.save()
    c.clip()
    c.fillStyle = '#7fe0d0'
    c.font = `600 26px ${UI_FONT}`
    if (s.idle) {
      // Before anyone works, the panel shows the Bots' machines standing by.
      c.fillText(o.copy.process, px + 24, 188)
      for (let i = 0; i < 3; i++) {
        const y0 = 250 + i * 110
        c.fillStyle = AVATAR[i + 2]
        c.beginPath()
        c.arc(px + 44, y0, 18, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#d6dbe6'
        c.font = `600 26px ${UI_FONT}`
        c.fillText(o.copy.names[i + 2], px + 76, y0 - 12)
        c.fillStyle = '#7ee2a8'
        c.font = `500 22px ${UI_FONT}`
        c.fillText(`● ${o.copy.online}`, px + 76, y0 + 22)
      }
      c.restore()
      wall.tex.needsUpdate = true
      return
    }
    c.fillText(`${o.copy.process} · ${o.copy.names[s.worker + 2]}`, px + 24, 188)
    c.font = `500 23px ${MONO}`
    const work = WORK[s.worker]
    let budget = Math.floor(work.join('').length * s.progress)
    work.forEach((line, i) => {
      if (budget <= 0) return
      const shown = line.slice(0, budget)
      budget -= line.length
      c.fillStyle = line.startsWith('+')
        ? '#7ee2a8'
        : line.startsWith('-')
          ? '#ff8f80'
          : line.includes('✓') || line.includes('passed')
            ? '#7ee2a8'
            : '#d6dbe6'
      c.fillText(shown, px + 22, 236 + i * 40)
    })
    c.restore()
    wall.tex.needsUpdate = true
  }
  let boardDrawn = -1
  const drawBoard = (dark: boolean) => {
    const v = dark ? 1 : 0
    if (boardDrawn === v) return
    boardDrawn = v
    const c = board.ctx
    c.fillStyle = '#f7f3ea'
    c.fillRect(0, 0, 640, 480)
    c.strokeStyle = 'rgba(27,34,51,0.18)'
    c.lineWidth = 3
    for (let i = 1; i < 4; i++) {
      c.beginPath()
      c.moveTo(i * 160, 20)
      c.lineTo(i * 160, 460)
      c.stroke()
    }
    c.fillStyle = INK
    c.font = `700 30px ${UI_FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    o.copy.columns.forEach((t, i) => {
      c.fillText(t, i * 160 + 80, 44)
    })
    board.tex.needsUpdate = true
  }

  /*
   * The relay, ~13 s: each leg the holder types, then throws the card with a chat line to the next teammate.
   * Owner → 共字君 → front end → back end → tests → owner, who stamps approval; the card lands in Done.
   */
  const ORDER = [0, 1, 2, 3, 4, 0]
  const TYPE = 1.3
  const THROW = 0.9
  const LEG = TYPE + THROW
  const LEGS = 5
  const FINALE = 2.4
  const CYCLE = LEGS * LEG + FINALE
  const STILL = 2 * LEG + TYPE * 0.7
  const from = new Vector3()
  const to = new Vector3()
  const tmp = new Vector3()
  const holdAt = (a: Actor, out: Vector3) => out.copy(a.hold).applyMatrix4(a.root.matrixWorld)
  let lastLanded = -1
  let lastTypeSound = 0
  let stamped = false

  // Camera: a wide three-quarter view that dollies in over the desks as the section scrolls.
  let aspect = 1
  let narrow = false
  let scroll = 0
  let scrollNow = 0
  const aim = [0, 0]
  const pointer = [0, 0]
  const look = new Vector3()
  const CLOSE = { pos: new Vector3(0.6, 2.6, 4.2), look: new Vector3(0.1, 1.5, -2.6) }
  // Resting views: the whole room, title tiles to action objects, centred on the screen.
  /*
   * Resting views stand inside the room. The FOV opens until the core (team and actions) fits the width, so wider
   * screens simply see more of the room and portrait screens a taller slice.
   */
  const WIDE = { pos: new Vector3(0.2, 4.6, 10.2), look: new Vector3(0, 1.95, -1.5), core: 4.4, minFov: 40 }
  const TALL = { pos: new Vector3(0.2, 3.9, 11.6), look: new Vector3(0, 2.35, -1.5), core: 3.45, minFov: 42 }
  const view = () => (narrow ? TALL : WIDE)
  const CORE_AT = new Vector3(0, 1.5, -0.5)
  const layout = () => {
    narrow = aspect < 0.85
    const v = view()
    const fromWidth = MathUtils.radToDeg(2 * Math.atan(v.core / (aspect * v.pos.distanceTo(CORE_AT))))
    camera.fov = Math.max(v.minFov, fromWidth)
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    // Spread the actions across the counter's visible width and keep the foreground props at the frame edges.
    // Portrait has height to spare: the sign rises and the counter comes forward, so neither band sits empty.
    brand.position.y = narrow ? 1.0 : 0
    counter.position.z = narrow ? 1.7 : 0
    const half =
      (v.pos.z - COUNTER.z - counter.position.z) * Math.tan(MathUtils.degToRad(camera.fov / 2)) * aspect
    const spread = Math.min(1.95, half * 0.55)
    actions.forEach((a, i) => {
      a.root.position.x = (i - 1) * spread
      a.root.position.z = COUNTER.z + counter.position.z + a.root.userData.z
      a.root.scale.setScalar(narrow ? 0.56 : 0.66)
      a.root.rotation.y = Math.atan2(v.pos.x - a.root.position.x, v.pos.z - a.root.position.z)
    })
    fgPlant.position.x = -half + 0.25
    fgPlant.visible = !narrow
    fgMug.position.x = half - 0.35
  }
  const place = () => {
    const e = scrollNow * scrollNow * (3 - 2 * scrollNow)
    const v = view()
    camera.position.copy(v.pos)
    camera.position.x += pointer[0] * (narrow ? 0.4 : 0.9)
    camera.position.y -= pointer[1] * (narrow ? 0.3 : 0.5)
    look.copy(v.look)
    camera.position.lerp(CLOSE.pos, e * 0.9)
    look.lerp(CLOSE.look, e)
    camera.lookAt(look)
    camera.updateMatrixWorld()
  }

  // Theme: day studio or late-night coding; colours ease so a toggle reads as the lights dimming.
  let dark = o.dark ? 1 : 0
  let darkNow = dark
  const nightColor = new Color()
  const mixC = (k: ColorKey, out: Color) => out.set(LIGHT[k]).lerp(nightColor.set(DARK[k]), darkNow)
  const mixN = (k: NumberKey) => MathUtils.lerp(LIGHT[k], DARK[k], darkNow)
  const applyTheme = () => {
    mixC('bg', scene.background as Color)
    ;(scene.fog as Fog).color.copy(scene.background as Color)
    mixC('hemiSky', hemi.color)
    mixC('hemiGround', hemi.groundColor)
    hemi.intensity = mixN('hemi')
    mixC('key', key.color)
    key.intensity = mixN('keyI')
    mixC('rim', rim.color)
    rim.intensity = mixN('rimI')
    mixC('window', windowMat.color)
    moonMat.opacity = mixN('moon')
    lampLight.intensity = mixN('lamp')
    bulbMat.color.set(darkNow > 0.5 ? '#ffe7a8' : '#efe6d0')
    tvLight.intensity = mixN('screen') * 1.5
    scene.environmentIntensity = mixN('env')
    drawView(darkNow > 0.5)
    pendantMat.color.set(darkNow > 0.5 ? '#ffe7a8' : '#f4ead2')
    pendantLight.intensity = mixN('lamp') * 0.8
  }
  applyTheme()

  const update = (t: number, dt: number) => {
    const k = 1 - Math.exp(-dt * 4)
    darkNow += (dark - darkNow) * (o.still ? 1 : k * 0.8)
    if (Math.abs(dark - darkNow) > 1e-3 || o.still) applyTheme()
    scrollNow += (scroll - scrollNow) * (o.still ? 1 : k * 1.6)
    pointer[0] += (aim[0] - pointer[0]) * k
    pointer[1] += (aim[1] - pointer[1]) * k
    place()
    furTime.value = t
    for (const a of team) a.root.updateMatrixWorld()

    const c = t % CYCLE
    const leg = Math.min(Math.floor(c / LEG), LEGS)
    const f = c - leg * LEG
    const finale = leg === LEGS
    const typing = !finale && f < TYPE ? ORDER[leg] : -1
    const u = finale ? 1 : MathUtils.clamp((f - TYPE) / THROW, 0, 1)
    const landed = leg
    const sender = finale ? 0 : ORDER[leg]
    const receiver = finale ? 0 : ORDER[leg + 1]
    const throwing = !finale && f >= TYPE

    // The card: held by the typist, thrown on an arc, and finally pinned to the board.
    if (finale) {
      const g = MathUtils.smoothstep(c - LEGS * LEG, 0.9, 1.7)
      holdAt(owner, from)
      to.set(colX(3), 1.2, -2.85)
      card.position.lerpVectors(from, to, g)
      card.position.y += Math.sin(g * Math.PI) * 1.2
      card.scale.setScalar(1 - g)
    } else {
      holdAt(team[sender], from)
      holdAt(team[receiver], to)
      const e = u * u * (3 - 2 * u)
      card.position.lerpVectors(from, to, e)
      card.position.y += Math.sin(e * Math.PI) * 0.9 + (u === 0 ? Math.sin(t * 3) * 0.03 : 0)
      card.scale.setScalar(1)
    }
    card.lookAt(camera.position)
    card.rotateZ(Math.sin(t * 2) * 0.12)

    if (landed !== lastLanded) {
      if (landed > lastLanded && landed > 0) {
        if (!o.still) o.onSound('ping')
        team[ORDER[landed]].hop = t
      }
      lastLanded = landed
    }
    const stampAt = LEGS * LEG + 0.55
    const isStamped = c >= stampAt
    if (isStamped && !stamped) {
      if (!o.still) o.onSound('stamp')
      for (const a of team) a.hop = t + (a === owner ? 0 : 0.15)
    }
    stamped = isStamped

    // Mention ring and ping on whoever just got @-ed.
    const ringF = leg > 0 ? MathUtils.clamp(f / 0.8, 0, 1) : 1
    if (ringF < 1) {
      const a = team[ORDER[leg]]
      ring.visible = true
      ring.position.set(a.root.position.x, a.head + 0.05, a.root.position.z)
      ring.scale.setScalar(0.6 + ringF * 1.2)
      ring.material.opacity = (1 - ringF) * 0.9
      ping.visible = true
      ping.position.set(
        a.root.position.x + 0.35,
        a.head + 0.25 + Math.sin(ringF * Math.PI) * 0.08,
        a.root.position.z,
      )
      ping.scale.setScalar(Math.min(1, ringF * 4))
    } else {
      ring.visible = false
      ping.visible = false
    }

    // Typing sounds: a little burst of clicks while someone works.
    if (typing >= 0 && !o.still && t - lastTypeSound > 0.07 + Math.random() * 0.08) {
      lastTypeSound = t
      o.onSound('type')
    }

    screenLight.intensity = mixN('screen') * (typing >= 2 ? 1.5 : 1)
    idle.forEach((a, i) => {
      a.body.position.y = Math.sin(t * 1.3 + i * 2) * 0.02
    })
    team.forEach((a, i) => {
      const hopT = t - a.hop
      const hop =
        hopT >= 0 && hopT < 0.45 ? Math.sin((hopT / 0.45) * Math.PI) * (a === coord ? 0.3 : 0.16) : 0
      const isTyping = typing === i
      a.body.position.y = hop + Math.sin(t * (isTyping ? 9 : 1.6) + i) * (isTyping ? 0.012 : 0.02)
      // Sender and receiver turn to each other during a throw; everyone glances at the card when it lands.
      const engaged = throwing && (i === sender || i === receiver)
      let yaw = a.yaw
      if (engaged) {
        const other = team[i === sender ? receiver : sender]
        tmp.copy(other.root.position).sub(a.root.position)
        const want = Math.atan2(tmp.x, tmp.z)
        let d = want - a.yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        const turn = a === coord ? 0.45 : 0.7
        yaw = a.yaw + MathUtils.clamp(d, -turn, turn)
      }
      if (a === coord && finale && isStamped) yaw += MathUtils.smoothstep(t - a.hop, 0, 0.7) * Math.PI * 2
      a.root.rotation.y += (yaw - a.root.rotation.y) * (o.still ? 1 : k * 1.4)
      a.hands.forEach((h, j) => {
        const beat = isTyping ? Math.max(0, Math.sin(t * 22 + j * Math.PI)) : 0
        if (a === coord) {
          // 共字君 waves the card on its way instead of typing.
          h.rotation.z =
            isTyping || (engaged && i === sender) ? (j ? 1 : 0) * (0.8 + Math.sin(t * 10) * 0.35) : 0
        } else if (a === owner) {
          const slam = finale ? Math.max(0, 1 - Math.abs(c - stampAt) * 3) : 0
          h.rotation.x = -beat * 0.25 - (j ? slam * 1.2 : 0)
        } else {
          h.position.y = 0.86 + beat * 0.05 + (isTyping ? 0 : Math.sin(t * 2 + j) * 0.015)
        }
      })
      if (a.laptop) {
        const glow = isTyping ? 0.85 + Math.random() * 0.15 : 0.55
        a.laptop.glow.color.setHSL(0.6, 0.6, 0.55 + glow * 0.3)
      }
      if (a.led && a.ledColor) a.led.color.set(isTyping && Math.sin(t * 30) > 0 ? '#ffffff' : a.ledColor)
      a.body.traverse((m) => {
        if (m.userData.spin) m.rotation.y = t * 1.4
      })
    })

    // Board: the task moves Todo → Doing → Review → Done.
    const column = finale && c - LEGS * LEG > 1.7 ? 3 : landed >= 5 ? 2 : landed >= 2 ? 1 : 0
    tmp.set(colX(column), 1.5, -2.94)
    taskNote.position.lerp(tmp, o.still ? 1 : k * 2)

    actions.forEach((a, i) => {
      a.lift += ((highlight === i ? 1 : 0) - a.lift) * (o.still ? 1 : 1 - Math.exp(-dt * 12))
      const since = t - a.pressAt
      const dip = since >= 0 && since < 0.3 ? Math.sin((since / 0.3) * Math.PI) : 0
      const grow = 1 + a.lift * 0.08
      a.body.position.y = a.lift * 0.24 - dip * 0.1
      a.body.scale.set(grow, grow - dip * 0.14, grow)
      a.ringMat.opacity = a.lift * (0.75 + Math.sin(t * 4) * 0.2)
      a.ring.scale.setScalar(1 + a.lift * 0.08)
    })

    // DOM bubbles fly from sender to receiver, then linger above the receiver.
    o.bubbles.forEach((el, i) => {
      const start = i * LEG + TYPE
      const age = c - start
      const on = age >= 0 && age < THROW + 1.0
      el.classList.toggle('on', on)
      if (!on) return
      holdAt(team[ORDER[i]], from)
      holdAt(team[ORDER[i + 1]], to)
      const e = MathUtils.smoothstep(age, 0, THROW)
      tmp.lerpVectors(from, to, e)
      tmp.y += 0.35 + Math.sin(e * Math.PI) * 0.7
      tmp.project(camera)
      const half = el.offsetWidth / 2 + 12
      el.style.translate = `${MathUtils.clamp(((tmp.x + 1) / 2) * width, half, width - half)}px ${((1 - tmp.y) / 2) * height}px`
    })
    const sOn = finale && c >= stampAt - 0.15
    o.stamp.classList.toggle('on', sOn)
    if (sOn) {
      // The seal lands on the group chat, next to the approval line.
      tmp.set(-0.75, 1.45, -2.9)
      tmp.project(camera)
      o.stamp.style.translate = `${((tmp.x + 1) / 2) * width}px ${((1 - tmp.y) / 2) * height}px`
    }

    const worker = leg >= 2 && leg <= 4 ? leg - 2 : leg > 4 ? 2 : 0
    drawWall({
      msgs: landed,
      approved: isStamped,
      worker,
      // Quantised so the wall texture re-uploads a few times a second, not every frame.
      progress: leg < 2 ? 0 : leg > 4 ? 1 : Math.min(1, Math.ceil((f / TYPE) * 12) / 12),
      typing,
      dark: darkNow > 0.5,
      column,
      idle: leg < 2,
    })
    drawBoard(darkNow > 0.5)
  }
  let width = 1
  let height = 1

  let time = o.still ? STILL : 0
  let last = 0
  let active = false
  let first = true
  const draw = () => {
    renderer.render(scene, camera)
    if (first) {
      first = false
      o.onFirstFrame()
    }
  }
  // Adaptive resolution: if most frames in a window run long, render fewer pixels (never below 1×).
  let sampled = 0
  let slow = 0
  const adapt = (dt: number) => {
    sampled++
    if (dt > 0.021) slow++
    if (sampled < 90) return
    if (slow > 45 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
    }
    sampled = 0
    slow = 0
  }
  const frame = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0
    last = now
    if (dt) adapt(dt)
    time += dt
    update(time, dt)
    draw()
  }
  const still = () => {
    update(time, 0)
    draw()
  }

  return {
    pick(x, y) {
      ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObjects(
        actions.map((a) => a.body),
        true,
      )[0]
      return hit ? (hit.object.userData.action ?? -1) : -1
    },
    setHighlight(i) {
      if (i === highlight) return
      highlight = i
      if (o.still || !active) still()
    },
    press(i) {
      actions[i].pressAt = time
      if (o.still || !active) still()
      return new Promise((r) => setTimeout(r, 220))
    },
    resize(w, h) {
      width = w
      height = h
      aspect = w / h
      layout()
      // A pixel budget keeps very large screens (2560 wide at 2×) from rendering 15M pixels a frame.
      pixelRatio = Math.min(pixelRatio, Math.sqrt(3e6 / (w * h)))
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(w, h, false)
      if (o.still || !active) still()
    },
    setActive(on) {
      if (on === active) return
      active = on
      last = 0
      renderer.setAnimationLoop(on && !o.still ? frame : null)
    },
    setDark(d) {
      dark = d ? 1 : 0
      if (o.still || !active) still()
    },
    setScroll(p) {
      if (!o.still) scroll = p
    },
    setPointer(x, y) {
      aim[0] = x
      aim[1] = y
    },
    dispose() {
      renderer.setAnimationLoop(null)
      const seen = new Set<{ dispose: () => void }>()
      scene.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        seen.add(obj.geometry)
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          seen.add(m)
          if (m.map) seen.add(m.map)
        }
      })
      for (const m of [...hullCache.values(), ...furCache.values()]) seen.add(m)
      hullCache.clear()
      furCache.clear()
      for (const r of seen) r.dispose()
      env.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
