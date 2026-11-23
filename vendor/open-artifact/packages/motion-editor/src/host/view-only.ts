/**
 * The read-only host an inline page (`#view-inline`, see `display-mode.ts`) runs on: the film's store, read live, and
 * the viewer, as one who only watches. A write is refused (`not_granted`), and nothing else is offered (comments, the
 * agent, the room, assets, downloads, history…), so an embedded film cannot change the document or reach the agent.
 * Installed as `window.openartifact` before the page connects (`session.ts`).
 */

import { ArtifactError, type CapabilityMap, type CapabilityName, type CapabilityProvider, type DbCapability, type UserCapability } from '@open-artifact/runtime';
import { EDITING_UNAVAILABLE, EMBEDDED_VIEW_ONLY, READ_ONLY_VIEWER } from './words.ts';

function readOnlyDb(db: DbCapability): DbCapability {
  return {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    write: async () => {
      throw new ArtifactError('not_granted', EMBEDDED_VIEW_ONLY);
    },
    onChange: (listener) => db.onChange(listener),
  };
}

/** The same viewer, as a `viewer`: the page then offers no edits, comments or requests. */
function watchingUser(user: UserCapability): UserCapability {
  return { me: async () => ({ ...(await user.me()), role: 'viewer' }) };
}

/** `inner` reduced to what an inline page may use. */
export function viewOnlyProvider(inner: CapabilityProvider): CapabilityProvider {
  return {
    async get<K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null> {
      if (name === 'db') {
        const db = await inner.get('db');
        return db === null ? null : (readOnlyDb(db) as CapabilityMap[K]);
      }
      if (name === 'user') {
        const user = await inner.get('user');
        return user === null ? null : (watchingUser(user) as CapabilityMap[K]);
      }
      return null;
    },
  };
}

/** Why the page cannot write once it reached the store, or `null` when it can. */
export function readOnlyReasonFor(inline: boolean, canEdit: boolean): string | null {
  if (inline) return EDITING_UNAVAILABLE;
  return canEdit ? null : READ_ONLY_VIEWER;
}
