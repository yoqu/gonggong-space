/**
 * Real daylight for the office: sun position from the clock, the building faces north (坐南朝北).
 * World axes: north = −Z (top of the screen), east = +X. Windows run along the north wall, so most of
 * the day the room is lit by soft north skylight; low summer sun north of the east–west line slips in
 * as warm direct light at dawn and dusk.
 */

// Luxelakes, Chengdu
const LAT = 30.57
const LON = 104.07
const RAD = Math.PI / 180

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** NOAA approximation; elevation and azimuth (from north, clockwise) in degrees. */
export function solarPosition(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const doy = Math.floor((date.getTime() - start) / 864e5)
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hours - 12) / 24)
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const trueSolarMin = hours * 60 + eqTime + 4 * LON
  const ha = (trueSolarMin / 4 - 180) * RAD
  const lat = LAT * RAD
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen)))
  const fromSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat))
  return { elevation: 90 - zen / RAD, azimuth: (fromSouth / RAD + 540) % 360 }
}

const SKY_NOON = [2.28, 2.36, 2.5]
const SKY_LOW = [2.6, 2.18, 1.66]
const SUN_DIRECT = [3.3, 2.62, 1.86]

/** Everything the renderer and UI need for one moment. */
export function daylightAt(date) {
  const { elevation: el, azimuth: az } = solarPosition(date)
  const cosEl = Math.cos(el * RAD)
  const toSun = [cosEl * Math.sin(az * RAD), Math.sin(el * RAD), -cosEl * Math.cos(az * RAD)]

  const day = smooth(-6, 5, el)
  const sky = smooth(-4, 32, el)
  const golden = day * (1 - smooth(5, 24, el))
  // Direct sun only reaches through north glass while it stands north of the east–west line and low.
  const enters = smooth(0.03, 0.3, Math.cos(az * RAD)) * smooth(0, 4, el) * (1 - smooth(32, 50, el))

  // North skylight: from the window side, leaning a little toward the sun's half of the sky.
  const skyDir = norm([Math.sign(toSun[0]) * 0.22 * (1 - sky * 0.6), 0.84, -0.62])
  const dir = norm(lerp3(skyDir, toSun, enters))
  const skyRad = lerp3(SKY_NOON, SKY_LOW, golden).map((c) => c * (0.74 + 0.26 * sky))
  const radiance = lerp3(skyRad, SUN_DIRECT, enters)

  let phase = '夜间照明'
  if (day > 0.5) phase = enters > 0.35 ? '阳光斜射入室' : golden > 0.5 ? (az < 180 ? '晨光 · 北窗天光' : '暮色 · 北窗天光') : '北窗天光'
  return {
    elevation: el,
    azimuth: az,
    nightBlend: 1 - day,
    goldenBlend: golden,
    dir,
    radiance,
    // North skylight is a large soft source: wide penumbrae; direct sun is crisp.
    shadowSoft: 4.2 - 2.6 * enters,
    // Windows open for fresh air in office hours; a gentle trickle otherwise.
    vent: officeVent(date),
    phase,
  }
}

function officeVent(date) {
  const h = date.getHours() + date.getMinutes() / 60
  return 0.25 + 0.75 * smooth(8, 9.5, h) * (1 - smooth(18.5, 20, h))
}

/** Preview presets on today's date; `live` follows the clock. */
export const LIGHT_PRESETS = { morning: 8.3, noon: 13, dusk: 17.6, night: 21.5 }

export function presetDate(preset, now = new Date()) {
  const h = LIGHT_PRESETS[preset]
  if (h === undefined) return now
  const d = new Date(now)
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
  return d
}
