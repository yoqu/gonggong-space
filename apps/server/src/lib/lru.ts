/** Sets `key` as the newest entry of `map`, dropping the oldest once it holds more than `max`. */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
  map.delete(key)
  map.set(key, value)
  if (map.size > max) map.delete(map.keys().next().value as K)
}
