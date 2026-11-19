/** Downloads `url` as `name`. */
export function saveUrl(name: string, url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

/** Downloads `text` as the HTML file `name`. */
export function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
  saveUrl(name, url)
  URL.revokeObjectURL(url)
}
