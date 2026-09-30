import type { BotDto } from '@gonggong/protocol'
import { ConfirmActionDialog } from '../../ui'
import { botsApi } from './model'

export function DeleteBotDialog({ bot, onClose }: { bot: BotDto; onClose: () => void }) {
  return (
    <ConfirmActionDialog
      title={`要删除 ${bot.name} 吗？`}
      message="删除后不可恢复，群消息与运行记录保留。"
      consequences={[bot.groupCount ? `从所在的 ${bot.groupCount} 个群移除` : '当前不在任何群']}
      label="删除"
      done={`已删除 ${bot.name}`}
      run={() => botsApi.remove(bot.id)}
      onClose={onClose}
    />
  )
}
