import { connKind, host, PILL } from '../lib/labels'
import { useDaemon } from '../store'

/** Window chrome: the native traffic lights overlay the left inset (titleBarStyle Overlay); the bar drags the window. */
export function TitleBar() {
  const info = useDaemon((s) => s.info)
  const pill = PILL[connKind(useDaemon((s) => s.snapshot))]
  const text = pill.text === '已连接' ? `已连接 ${host(info?.server)}` : pill.text
  return (
    <div className="dk-titlebar" data-tauri-drag-region>
      <span className="dk-titlebar__lights" />
      <span className="dk-titlebar__name" data-tauri-drag-region>
        AIWS Daemon
      </span>
      {info ? (
        <span className="dk-titlebar__ver" data-tauri-drag-region>
          v{info.version} · 协议 v{info.protocol}
        </span>
      ) : null}
      <span className="dk-flex" data-tauri-drag-region />
      <span className="dk-pill" data-testid="conn-pill" style={{ color: pill.color }}>
        <span className="dk-pill__dot" style={{ background: pill.color }} />
        {text}
      </span>
    </div>
  )
}
