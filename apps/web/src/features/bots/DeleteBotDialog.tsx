import type { BotDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { ConfirmActionDialog } from '../../ui'
import { botsApi } from './model'

export function DeleteBotDialog({ bot, onClose }: { bot: BotDto; onClose: () => void }) {
  return (
    <ConfirmActionDialog
      title={t('要删除 {name} 吗？', { name: bot.name })}
      message={t('删除后不可恢复，群消息与运行记录保留。')}
      consequences={[
        bot.groupCount ? t('从所在的 {n} 个群移除', { n: bot.groupCount }) : t('当前不在任何群'),
      ]}
      label={t('删除')}
      done={t('已删除 {name}', { name: bot.name })}
      run={() => botsApi.remove(bot.id)}
      onClose={onClose}
    />
  )
}
