/**
 * Ventilation: fresh air comes in through the open north windows (−Z) and drifts south (+Z).
 * Gust fronts travel down the room, so neighbouring plants lean together a beat apart instead of
 * each wobbling on its own clock.
 */

let vent = 1

/** 0 = windows shut (a faint HVAC trickle), 1 = office-hours airflow. */
export function setVentilation(v) {
  vent = v
}

export function ventilation() {
  return vent
}

/**
 * Air at a floor point: `x`,`z` lean offset in metres for a ~1.5 m plant, `flutter` a small fast
 * leaf tremble in radians.
 */
export function airAt(x, z, t) {
  const front = z * 0.42 - t * 1.05 + Math.sin(x * 0.27 + t * 0.13) * 1.4
  const gust = (0.5 + 0.5 * Math.sin(front)) ** 3
  const s = vent * (0.3 + 0.7 * gust)
  return {
    x: Math.sin(t * 0.41 + z * 0.23 + x * 0.11) * 0.008 * s,
    z: 0.042 * s,
    flutter: (Math.sin(t * 6.1 + x * 3.7 + z * 2.3) * 0.6 + Math.sin(t * 9.3 + x * 1.3) * 0.4) * 0.075 * s,
    gust: gust * vent,
  }
}
