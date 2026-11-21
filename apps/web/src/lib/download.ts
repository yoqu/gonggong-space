/** Downloads `url` as `name` ('' keeps the server's file name). */
export function downloadUrl(url: string, name = '') {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
}

/** Downloads `blob` as `name`. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  downloadUrl(url, name)
  // Revoked at once, some browsers drop the download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
