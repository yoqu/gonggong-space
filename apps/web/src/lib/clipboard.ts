/** Copies text; plain-http LAN access has no `navigator.clipboard`, so it falls back to a selected textarea. */
export async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy refused')
  } finally {
    area.remove()
  }
}
