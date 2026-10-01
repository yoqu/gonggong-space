const KEY = 'gg.team'

/** The team picked in the switcher (sent as X-GG-Team); null before one is known. */
export function storedTeam() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function storeTeam(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable (private mode): the server falls back to the earliest-joined team
  }
}
