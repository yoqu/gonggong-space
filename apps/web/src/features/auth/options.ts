import type { AuthOptionsDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

/** GET /api/auth/options (public); null while loading. A failure reads as "closed": sign-up is opt-in. */
export function useAuthOptions() {
  const [options, setOptions] = useState<AuthOptionsDto | null>(null)
  useEffect(() => {
    api.get<AuthOptionsDto>('/auth/options').then(setOptions, () => setOptions({ registrationOpen: false }))
  }, [])
  return options
}
