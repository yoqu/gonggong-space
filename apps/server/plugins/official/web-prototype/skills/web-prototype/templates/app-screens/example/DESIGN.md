---
version: alpha
name: 麓客+ 小程序（探索生活）
description: 麓湖生活方式小程序的视觉规范，基于首页「探索生活」Tab 当前实现提取。尺寸以 375 宽设计稿 px 表示（1px = 2rpx）。
colors:
  primary: "#155332"
  on-primary: "#FFFFFF"
  accent-green: "#23AC4C"
  accent-green-legacy: "#20B454"
  background: "#F5F5F7"
  background-legacy: "#F1F1F1"
  surface: "#FFFFFF"
  surface-placeholder: "#F6F6F6"
  on-surface: "#000000"
  on-surface-strong: "#151515"
  on-surface-card: "#282828"
  on-surface-variant: "#737374"
  on-surface-muted: "#7A7A7A"
  on-surface-hint: "#999999"
  tab-label: "#212121"
  outline: "#D8D8D8"
  tag-highlight: "#FEE70F"
  on-tag-highlight: "#000000"
  error: "#FF4D4F"
  badge-new: "#FF5E1F"
  scrim: "rgba(0, 0, 0, 0.55)"
  top-bar-frost: "rgba(255, 255, 255, 0.82)"
typography:
  headline-sm:
    fontFamily: PingFang SC
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
  title-md:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 400
    lineHeight: 21px
  title-md-active:
    fontFamily: PingFang SC
    fontSize: 15px
    fontWeight: 600
    lineHeight: 21px
  title-sm:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 600
    lineHeight: 18px
  body-md:
    fontFamily: PingFang SC
    fontSize: 14px
    fontWeight: 400
    lineHeight: 16px
  card-title:
    fontFamily: PingFang SC
    fontSize: 13px
    fontWeight: 600
    lineHeight: 16px
  label-lg:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 500
    lineHeight: 13px
  label-md:
    fontFamily: PingFang SC
    fontSize: 12px
    fontWeight: 400
    lineHeight: 17px
  label-sm:
    fontFamily: PingFang SC
    fontSize: 11px
    fontWeight: 400
    lineHeight: 11px
  caption:
    fontFamily: PingFang SC
    fontSize: 10px
    fontWeight: 400
    lineHeight: 16px
  button-sm:
    fontFamily: PingFang SC
    fontSize: 10px
    fontWeight: 600
    lineHeight: 22px
  tag:
    fontFamily: PingFang SC
    fontSize: 9px
    fontWeight: 500
    lineHeight: 14px
rounded:
  none: 0px
  xs: 1px
  sm: 8px
  md: 16px
  lg: 18px
  full: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 11px
  lg: 16px
  xl: 20px
  xxl: 40px
  gutter: 13px
  gutter-inner: 6px
  top-bar-padding: 17px
components:
  top-tab:
    textColor: "{colors.on-surface-strong}"
    typography: "{typography.title-md}"
    padding: 17px
  top-tab-active:
    textColor: "{colors.on-surface-strong}"
    typography: "{typography.title-md-active}"
  top-tab-indicator:
    backgroundColor: "{colors.on-surface-strong}"
    width: 24px
    height: 3px
    rounded: 1.5px
  top-bar-scrolled:
    backgroundColor: "{colors.top-bar-frost}"
  location-switcher:
    textColor: "{colors.on-surface-strong}"
    typography: "{typography.label-lg}"
    size: 13px
  hero-banner:
    height: 282px
  king-kong-item:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
    size: 30px
  section-header:
    textColor: "{colors.on-surface}"
    typography: "{typography.headline-sm}"
    padding: 6px
  section-more-link:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
  event-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    width: 105px
  event-card-cover:
    backgroundColor: "{colors.surface-placeholder}"
    width: 105px
    height: 140px
  event-card-title:
    textColor: "{colors.on-surface-card}"
    typography: "{typography.card-title}"
  event-card-date:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
  promo-tag:
    backgroundColor: "{colors.tag-highlight}"
    textColor: "{colors.on-tag-highlight}"
    typography: "{typography.tag}"
    rounded: "{rounded.xs}"
    height: 14px
  courtesy-card-large:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    width: 166px
    height: 174px
    padding: 14px 12px 12px
  courtesy-card-small:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    width: 173px
    height: 82px
    padding: 8px 10px 6px
  courtesy-card-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title-sm}"
  courtesy-card-highlight:
    textColor: "{colors.primary}"
  button-pill-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-sm}"
    rounded: "{rounded.full}"
    width: 54px
    height: 22px
  button-dialog-primary:
    backgroundColor: "{colors.accent-green}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    height: 42px
  button-dialog-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#666666"
    rounded: "{rounded.full}"
    height: 42px
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    width: 300px
    padding: 21px 22px 28px
  experience-hero-card:
    rounded: "{rounded.none}"
    height: 172px
  bottom-tab-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.tab-label}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.lg}"
  bottom-tab-bar-icon:
    size: 24px
  bottom-tab-bar-center-action:
    backgroundColor: "{colors.primary}"
    width: 78px
    height: 58px
---

## Overview

**湖畔栖居 · 安静的生活杂志感。** 麓客+ 是麓湖社区的生活方式入口，视觉上追求「高端社区生活手册」的气质：大面积冷灰白底、纯白直角卡片、黑色粗体标题，配以深湖绿（Lake Green）作为唯一的品牌行动色。内容以真实摄影与活动海报为主角，UI 本身克制、留白充足，不与内容争抢注意力。

页面骨架（「探索生活」Tab）自上而下：

1. **沉浸式顶部 Banner**（全宽摄影，延伸至状态栏下方）+ 悬浮的「住在这里 / 探索生活」双 Tab 与城市·站点切换。
2. **金刚位**：4 列线性图标宫格（用餐、购物、活动、买票、停车、艺术、置业、全部）。
3. **内容模块流**：「麓湖本周重磅事件」横滑海报卡片、「麓湖生活礼遇」一大两小权益卡、「只在麓湖的独特体验」大图卡片等，均由后台配置下发、按模块渲染。
4. **自定义底部 TabBar**：首页 / 目的地 / 中间凸起的扫码六边形 / 福利 / 我的。

关键词：克制、直角、留白、内容优先、湖绿点睛。

## Colors

整体是高明度中性色 + 单一深绿强调色的体系。

- **Primary · 湖绿 (#155332)：** 品牌行动色。仅用于主操作胶囊按钮（「去使用」「快速赚豆」「兑换商城」）、权益数值高亮（「39.9w」「287」「1」）以及底部中间扫码入口。按钮背景使用 90% 不透明度，文字为 90% 白。
- **Accent Green (#23AC4C) / Legacy (#20B454)：** 较亮的功能绿，用于系统弹窗主按钮（定位授权、站点选择）和旧版主题变量 `--wh-color-primary`。新界面优先使用 Primary，不要在同一屏混用两种绿作为主按钮。
- **Background (#F5F5F7)：** 页面底色，冷调浅灰，用来托出白色卡片。旧页面使用 #F1F1F1。
- **Surface (#FFFFFF)：** 卡片、底部 TabBar、弹窗表面。图片加载占位使用 #F6F6F6。
- **On-surface (#000000 / #151515 / #282828)：** 模块标题用纯黑；顶部 Tab 与站点切换在滚动吸顶后用 #151515；卡片标题用 #282828。
- **On-surface-variant (#737374)：** 次级信息——金刚位图标文字、「更多」链接、模块副标题。
- **On-surface-muted (#7A7A7A)：** 日期区间、卡片辅助说明。
- **Tag Highlight (#FEE70F)：** 海报卡片左上角的营销角标，亮黄底黑字，极少量使用。
- **Error (#FF4D4F) / Badge New (#FF5E1F)：** 红点、角标提示。
- **Scrim：** 弹窗遮罩 rgba(0,0,0,0.55)；图片底部渐变 `transparent 50–75% → rgba(0,0,0,0.8)`，用于在图片上承载白色文字。

顶部区域在 Banner 之上时，Tab 文字、指示条、站点切换均为 **白色**；页面滚动超过阈值后切换为毛玻璃白底 + #151515 深色文字。

## Typography

字体统一使用系统中文字体 **PingFang SC**（fallback：-apple-system、Helvetica Neue、Hiragino Sans GB、Microsoft Yahei）。日期数字允许使用系统 UI 字体以获得等宽数字效果。基础字号 14px（28rpx）。

| Token | 尺寸 / 字重 / 行高 | 用途 |
|---|---|---|
| headline-sm | 16 / 600 / 22 | 模块标题：「麓湖本周重磅事件」「麓湖生活礼遇」 |
| title-md(-active) | 15 / 400(600) / 21 | 顶部「住在这里 / 探索生活」Tab |
| title-sm | 14 / 600 / 18 | 礼遇卡片标题：「有券，去体验」 |
| body-md | 14 / 400 / 16 | 正文、体验卡片名称 |
| card-title | 13 / 600 / 16 | 海报卡片标题，单行省略 |
| label-lg | 12 / 500 / 13 | 站点切换「成都·麓湖」 |
| label-md | 12 / 400 / 17 | 金刚位文字、礼遇副标题、「更多」 |
| label-sm | 11 / 400 / 11 | 底部 TabBar 文字 |
| caption | 10 / 400 / 16 | 日期区间「10.30–11.29」 |
| button-sm | 10 / 600 / 22 | 胶囊按钮文字 |
| tag | 9 / 500 / 14 | 营销角标 |

层级主要依靠 **字重（600 vs 400）和颜色（黑 vs 灰）** 区分，字号跨度较小（9–16px），不使用超大展示字号；Banner 上的大字标题由运营图片自带。

## Layout

- **基准：** 375px 宽设计稿，代码中以 rpx 实现（1px = 2rpx）。
- **页面边距：** 模块容器左右 13px（26rpx），模块标题再内缩 6px（12rpx），因此标题与卡片视觉左边距约 19px。顶部 Tab 栏左右 17px（34rpx）。
- **顶部 Banner：** 高 282px（564rpx），绝对定位铺底，内容区以同高占位开始；顶部 Tab 栏与胶囊按钮垂直居中对齐（使用 `--menu-button-top` / `--menu-button-height`）。
- **模块间距：** 模块之间 40px（80rpx）；模块标题到内容 16–19px。
- **金刚位：** 4 列等分网格，行间距 16px，图标 30px，图标与文字间距 7px，最多 2 行 8 个，最后一个为「全部」。
- **横滑列表：** 一屏露出约 3 张卡片并让第 4 张露边以提示可滑动，卡片间距 15px（海报）/ 11px（体验）。
- **礼遇模块：** 左大右二小的不对称布局，左卡 166×174，右侧两张 173×82，间距 11px / 10px。
- **底部安全区：** 内容底部预留 `75px + env(safe-area-inset-bottom)`，避免被 TabBar 遮挡。

## Elevation & Depth

整体是 **扁平** 风格，几乎不使用卡片投影，层次靠「白卡 + 灰底」的明度差实现。

- **Level 0：** 页面背景 #F5F5F7。
- **Level 1：** 白色内容卡片，无阴影、无描边。
- **Level 2 · 吸顶栏：** 滚动后出现 `rgba(255,255,255,0.82)` + `backdrop-filter: blur(12px)` 毛玻璃，阴影 `0 4px 12px rgba(0,0,0,0.08)`，0.2s 淡入。
- **Level 3 · 底部 TabBar：** 白底，`0 0 6px rgba(0,0,0,0.1)` 环绕阴影，中间扫码按钮以六边形向上凸出。
- **Level 4 · 弹窗：** 55% 黑色遮罩 + 白色圆角面板，关闭按钮位于面板下方的白色描边圆形。

图片上的文字依赖底部黑色渐变（而非阴影）保证可读性。

## Shapes

- **内容卡片与图片：直角（0px）。** 这是本设计最显著的特征——海报、礼遇卡片、体验大图全部无圆角，呈现印刷品 / 杂志质感。
- **行动按钮：全圆角胶囊（9999px）。** 胶囊与直角卡片形成对比，让按钮在卡片内一眼可识别。
- **营销角标：** 1px 微圆角。
- **弹窗：** 16px 圆角。
- **底部 TabBar：** 顶部两角 18px 圆角。
- **扫码入口：** 六边形，品牌湖绿填充，白色二维码图标。
- **图标：** 1.5px 左右线宽的线性描边图标，深灰色，圆角端点，不填充。

## Components

**顶部 Tab 栏（top-tab）**：「住在这里 / 探索生活」两个文字 Tab，选中项字重 600，下方 24×3px 圆角指示条。位于 Banner 之上时为白色，滚动吸顶后为 #151515。下方为站点切换：定位图标 + 「成都·麓湖」 + 右箭头，12px/500。

**金刚位（king-kong-item）**：30px 线性图标 + 12px 灰色文字，垂直居中；支持红点 / NEW 角标。图标缺失时显示带 8px 圆角描边的文字占位块。

**模块标题（section-header）**：16px/600 纯黑，右侧可选「更多 >」12px #737374。

**海报卡片（event-card）**：105×140 竖版 3:4 封面，直角；下方白色信息区 6px 内边距，标题 13px/600 单行省略，日期 10px #7A7A7A。左上角可叠加黄色营销角标或状态图片。

**礼遇卡片（courtesy-card）**：白底直角卡片，背景图（券叠放插画、麓豆 IP 形象、礼盒）位于右下或底部，文字在左上：标题 14px/600 → 副标题 12px（数值用湖绿 600 高亮）→ 胶囊按钮。

**胶囊按钮（button-pill-primary）**：54×22，湖绿 90% 底，10px/600 90% 白字，全圆角。是页面中唯一的实心按钮形态。

**体验大图卡（experience-hero-card）**：通栏直角大图，运营文案直接排版在图片中；若需系统文字，使用白色 15px/500 叠加在底部黑色渐变上。

**底部 TabBar（bottom-tab-bar）**：五等分，24px 线性图标 + 11px 文字；选中态切换为实心 / 品牌色图标。中间为凸起的湖绿六边形扫码入口，无文字。

**系统弹窗（dialog）**：300px 宽，16px 圆角，标题 16px/500 #222；主按钮 Accent Green 实心胶囊、次按钮白底 #D8D8D8 描边胶囊，高 42px。

## Do's and Don'ts

**Do**

- 让图片和海报做主角，UI 用白卡、灰底、黑字保持中性。
- 内容卡片、图片保持直角；只有按钮、弹窗、TabBar 使用圆角。
- 主行动按钮统一使用湖绿 #155332 胶囊；关键数字用湖绿 600 字重高亮。
- 用字重和灰阶（#000 → #737374 → #7A7A7A）建立层级，而不是放大字号。
- 横滑列表露出第 4 张卡片的边缘，暗示可滑动。
- 图片上叠加文字时使用底部黑色渐变遮罩。
- 新增尺寸以 2 的倍数 rpx 编写，并对齐本文件的 spacing 刻度。

**Don't**

- 不要给内容卡片加圆角或明显投影，这会破坏杂志式的平面质感。
- 不要在同一屏混用 #155332 与 #20B454/#23AC4C 作为主按钮颜色。
- 不要使用彩色或填充风格的金刚位图标，保持线性单色。
- 不要在模块标题上使用超过 16px 的字号或除黑色外的颜色。
- 不要大面积使用黄色角标或红色提示，它们只用于点状强调。
- 不要在顶部 Banner 区域使用深色文字（吸顶前必须为白色）。
