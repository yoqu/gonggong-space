import { t } from '../../i18n'
import { useRecalled } from './recalled'

const EXAMPLES = [
  t('看看这台电脑上有哪些项目，挑一个讲讲它是做什么的'),
  t('帮我写个脚本，把下载文件夹里的图片按月份归档'),
  t('检查一下当前目录的代码，列出最该先修的 3 个问题'),
]

/** A private chat nobody has written in yet: what the Bot is for, and examples handed to the composer, not sent. */
export function FirstDmIntro({ groupId, owner }: { groupId: string; owner?: string }) {
  return (
    <section className="first-dm" aria-label={t('开始和 Bot 对话')}>
      <p className="first-dm__lead">
        {owner
          ? t('它在 {owner} 的电脑上干活，直接说要做什么', { owner })
          : t('它在你的电脑上干活，直接说要做什么')}
      </p>
      <div className="first-dm__examples">
        {EXAMPLES.map((text) => (
          <button
            key={text}
            type="button"
            className="first-dm__example"
            onClick={() => useRecalled.setState({ pending: { groupId, body: text, quote: null, files: [] } })}
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  )
}
