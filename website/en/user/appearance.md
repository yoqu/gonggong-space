# Appearance and themes

This page covers how to switch the interface language, switch between light and dark themes, adjust the glass effect, and which other layout preferences the interface remembers.

## Where to find it

Click 「设置…」 (Settings…) in the avatar menu; the 「外观」 (Appearance) page opens by default. The left side of the settings dialog also has 「通知」 (Notifications), 「Git 与仓库」 (Git & repos), 「我的密钥」 (My secrets), 「我的 Skill」 (My Skills), and 「账户」 (Account).

![Settings · Appearance](/screenshots/web/settings-appearance.webp)

The 「外观」 (Appearance) page has three items: language, theme, and glass effect.

## Language

Choose 「中文」 (Chinese) or 「English」. The page reloads after switching. If you've never set it, it follows your browser's language. The login page also has a button for switching the language.

## Theme

| Option | Effect |
| --- | --- |
| 浅色 (Light) | Default |
| 深色 (Dark) | Dark background, good for nighttime |
| 跟随系统 (System) | Follows the OS light / dark setting and changes automatically when the system switches |

![A group in the dark theme](/screenshots/web/theme-dark.webp)

- On mobile browsers, the address bar color also follows the selected theme.
- The login page also has a button in the top-right corner to switch directly between light and dark.

## Glass effect

The look of translucent "glass" layers such as toolbars, menus, popovers, and toasts:

| Option | Effect |
| --- | --- |
| 清透 (Clear) | More transparent, showing more of what's behind |
| 标准 (Standard) | Default |
| 着色 (Tinted) | Opaque, no blur, clearest text |

::: tip
- If "Reduce transparency" is turned on in your operating system, glass layers are shown as opaque no matter which option you choose.
- If "Reduce motion" is turned on in your operating system, theme switching and interface animations are simplified.
:::

## Where preferences are stored

Language, theme, and glass effect are stored in the **current browser** and don't sync with your account: you need to set them again on another machine or browser, and in a private/incognito window they reset to defaults once you close it.

The following layout and habits are also remembered in the current browser:

- The widths of the conversation list, the chat column, and the right sidebar (adjusted by dragging the dividers), and the collapsed sections in the conversation list;
- The workbench layout (Split / Focus / Fullscreen) and open tabs; whether the floating composer is collapsed in fullscreen workbench (toggle with ⌘J / Ctrl+J);
- The last conversation and current team you opened, which you return to automatically next time;
- The video player's volume and mute;
- Display options for file viewing and code diffs (word wrap, side-by-side / unified, etc.);
- The directory picker's show-hidden-folders setting, sorting, and recently used directories;
- The account remembered on the login page.

Unsent drafts in the composer are saved only in the current browser tab: they survive a refresh but are gone once you close the tab.

For layout operations, see [Interface tour](/en/user/interface).

## Related pages

- [Interface tour](/en/user/interface)
- [Login and account](/en/user/login)
- [Notifications](/en/user/notifications)
