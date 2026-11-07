import type {
  CreateSecretReq,
  FillSecretReq,
  MySecretDto,
  SecretDto,
  SecretMode,
  SecretRequestDto,
  SecretScope,
  SecretSource,
  SecretValueState,
  SetMySecretReq,
  UpdateSecretReq,
} from '@gonggong/protocol'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { ago } from '../../lib/time'

export const secretsApi = {
  create: (base: string, body: CreateSecretReq) => api.post<SecretDto>(base, body),
  update: (id: string, body: UpdateSecretReq) => api.patch<SecretDto>(`/secrets/${id}`, body),
  remove: (id: string) => api.del(`/secrets/${id}`),
  mine: () => api.get<MySecretDto[]>('/me/secrets'),
  setMine: (id: string, body: Partial<SetMySecretReq>) => api.put(`/me/secrets/${id}`, body),
  clearMine: (id: string) => api.del(`/me/secrets/${id}`),
  request: (requestId: string) => api.get<SecretRequestDto>(`/secret-requests/${requestId}`),
  fill: (requestId: string, body: FillSecretReq) => api.post(`/secret-requests/${requestId}`, body),
}

export const MODE_LABEL: Record<SecretMode, string> = {
  shared: t('统一值'),
  shared_overridable: t('统一值可个人覆盖'),
  personal: t('每人自填'),
}

export const MODE_HINT: Record<SecretMode, string> = {
  shared: t('所有人用同一个值，个人不能覆盖，适合团队共用的服务 token'),
  shared_overridable: t('有统一值；成员填了自己的值就用自己的'),
  personal: t('没有统一值，每人填自己的（列表里「填写我的值」或「我的密钥」），适合个人账号的 token'),
}

export const SCOPE_LABEL: Record<SecretScope, string> = {
  platform: t('平台层'),
  team: t('团队层'),
  group: t('群层'),
}

export const SOURCE_LABEL: Record<SecretSource, string> = {
  personal: t('个人'),
  group: t('群'),
  team: t('团队'),
  platform: t('平台'),
}

/** 「已填写 · 末 4 位 x9z1 · 王磊 · 3 分钟前」: what anyone may see of a stored value. */
export const valueState = (v: SecretValueState) =>
  [t('已填写'), t('末 4 位 {last4}', { last4: v.last4 }), v.updatedBy, ago(v.updatedAt)]
    .filter(Boolean)
    .join(' · ')

export const expired = (expiresAt: string | null) => !!expiresAt && Date.parse(expiresAt) <= Date.now()
