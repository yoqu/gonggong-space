import type { I18nParams, I18nText, ProtocolKey } from '@gonggong/protocol'
import { zh, zhText } from '../../i18n/index.js'

/** A run step the server writes: Chinese in `step` (agents, search), its source in `stepI18n` for clients. */
export const runStep = (key: ProtocolKey, params?: I18nParams) => ({
  step: zh(key, params),
  stepI18n: { key, params } as I18nText,
})

/** `stepI18n` only while it still renders `step`: writers of free text (agent steps) leave it stale. */
export const stepI18nOf = (r: { step: string; stepI18n: I18nText | null }) =>
  r.stepI18n && zhText(r.stepI18n) === r.step ? { stepI18n: r.stepI18n } : {}
