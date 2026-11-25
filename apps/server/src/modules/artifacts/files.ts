import { type ArtifactFile, artifactDigestText } from '@gonggong/protocol'
import { sha256 } from '../../lib/crypto.js'

const SCREEN_FILE = /^screens\/([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/
/** The screen id of an L1 screen file (`screens/<id>.html`), else undefined. */
export const screenIdOf = (path: string) => SCREEN_FILE.exec(path)?.[1]

/** The content digest of a version's file list. */
export const digestOf = (files: ArtifactFile[]) => sha256(artifactDigestText(files))
