import { type CSSProperties, type ReactNode, useState } from 'react'
import {
  AlertDialog,
  AlertPanel,
  Button,
  Icon,
  Input,
  Menu,
  MenuButton,
  type MenuItem,
  Sidebar,
  Switch,
  TabView,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  toast,
} from '../../ui'

/** Pane `pn-desktop` wallpaper, so glass samples show what they blur. */
const WALLPAPER: CSSProperties = {
  padding: 24,
  borderRadius: 'var(--radius-menu)',
  background:
    'radial-gradient(120% 90% at 85% 10%, var(--wallpaper-1) 0%, transparent 55%), radial-gradient(90% 80% at 10% 100%, var(--wallpaper-2) 0%, transparent 60%), var(--wallpaper-3)',
}

const MENU: MenuItem[] = [
  { label: '打开', value: 'open', shortcut: '⌘O' },
  { label: '在新标签页中打开', value: 'tab' },
  { separator: true },
  { label: '显示简介', value: 'info', shortcut: '⌘I' },
  { label: '重新命名', value: 'rename' },
  { label: '复制', value: 'dup', shortcut: '⌘D' },
  { separator: true },
  { header: '显示方式' },
  { label: '图标', value: 'icons', checked: true },
  { label: '列表', value: 'list', checked: false },
  { separator: true },
  { label: '移到废纸篓', value: 'trash', shortcut: '⌘⌫', destructive: true },
]

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gallery__section" data-testid={`gallery-${id}`}>
      <h2 className="eyebrow">{title}</h2>
      {children}
    </section>
  )
}

/** W1b overlays and shell primitives, laid out like their Pane preview cards. */
export function OverlayGallery() {
  const [alert, setAlert] = useState(false)
  const [launch, setLaunch] = useState(true)
  return (
    <>
      <Block id="menu" title="MENU · MENUBUTTON">
        <div style={{ ...WALLPAPER, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <Menu aria-label="文件" style={{ width: 240 }} activeValue="dup" items={MENU} />
          <ToolbarGroup>
            <MenuButton
              className="ui-toolbar__btn"
              aria-label="更多"
              title="更多"
              items={MENU}
              onSelect={(v) => toast({ message: `已选择 ${v}` })}
            >
              <Icon name="more" />
            </MenuButton>
          </ToolbarGroup>
        </div>
      </Block>

      <Block id="alert" title="ALERT">
        <div
          style={{
            ...WALLPAPER,
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            alignItems: 'flex-start',
          }}
        >
          <AlertPanel
            icon={<Icon name="warning" size={48} color="var(--system-orange)" />}
            title="要将「季度报告」移到废纸篓吗？"
            message="此项目将被立即删除，此操作无法撤销。"
            suppression="不再询问"
            actions={[{ label: '取消' }, { label: '删除', variant: 'destructive' }]}
          />
          <AlertPanel
            title="要存储对文稿的更改吗？"
            message="如果不存储，你的更改将丢失。"
            actions={[{ label: '存储', variant: 'primary' }, { label: '不存储' }, { label: '取消' }]}
          />
        </div>
        <div className="gallery__row">
          <Button onClick={() => setAlert(true)}>打开 AlertDialog</Button>
        </div>
        <AlertDialog
          open={alert}
          onClose={() => setAlert(false)}
          title="要移除「前端」群中的 Bot 吗？"
          message="Bot 将停止接收该群的消息，可以随时重新添加。"
          actions={[
            { label: '取消', onClick: () => setAlert(false) },
            { label: '移除', variant: 'destructive', onClick: () => setAlert(false) },
          ]}
        />
      </Block>

      <Block id="toolbar" title="TOOLBAR">
        <div
          style={{
            borderRadius: 'var(--radius-menu)',
            overflow: 'hidden',
            background: 'var(--content-bg)',
            boxShadow: '0 0 0 1px var(--separator)',
          }}
        >
          <Toolbar title="文稿" subtitle="24 项" scrolled={false}>
            <ToolbarGroup>
              <ToolbarButton icon="chevron-left" label="后退" />
              <ToolbarButton icon="chevron-right" label="前进" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton icon="grid" label="图标" active />
              <ToolbarButton icon="list" label="列表" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton icon="share" label="共享" />
              <ToolbarButton icon="tag" label="标签" />
            </ToolbarGroup>
            <div style={{ minWidth: 160 }}>
              <Input size="sm" placeholder="搜索" aria-label="搜索" />
            </div>
          </Toolbar>
        </div>
      </Block>

      <Block id="sidebar" title="SIDEBAR · TABVIEW">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <Sidebar
            style={{ height: 290 }}
            defaultSelected="recents"
            sections={[
              {
                title: '个人收藏',
                items: [
                  { id: 'recents', label: '最近使用', icon: 'clock', color: 'var(--system-blue)' },
                  { id: 'desktop', label: '桌面', icon: 'desktop', color: 'var(--system-indigo)' },
                  { id: 'docs', label: '文稿', icon: 'doc', color: 'var(--system-orange)' },
                  { id: 'dl', label: '下载', icon: 'download', color: 'var(--system-green)', badge: 3 },
                ],
              },
              {
                title: '位置',
                items: [{ id: 'icloud', label: 'iCloud 云盘', icon: 'cloud', color: 'var(--system-cyan)' }],
              },
              {
                title: '标签',
                items: [
                  { id: 'fav', label: '重要', icon: 'star', color: 'var(--system-yellow)' },
                  { id: 'tag', label: '工作', icon: 'tag', color: 'var(--system-purple)' },
                ],
              },
            ]}
          />
          <div style={{ width: 420 }}>
            <TabView
              tabs={[
                {
                  value: 'g',
                  label: '通用',
                  content: (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      启动时打开
                      <Switch checked={launch} onChange={setLaunch} ariaLabel="启动时打开" />
                    </div>
                  ),
                },
                { value: 'a', label: '账户', content: '账户设置' },
                { value: 'x', label: '高级', content: '高级设置' },
              ]}
            />
          </div>
        </div>
      </Block>
    </>
  )
}
