# Presenter Mode Guide · 演讲者模式指南

这份文档说明如何在 html-ppt skill 里做出**带逐字稿的演讲者模式 PPT**。

## 何时使用演讲者模式

当用户的需求涉及以下任何一项时，**优先使用演讲者模式**：

- 提到"**演讲**"、"**分享**"、"**讲稿**"、"**逐字稿**"、"**speaker notes**"
- 提到"**presenter view**"、"**演讲者视图**"、"**演讲者模式**"
- 需要"**30 分钟 / 45 分钟 / 1 小时**的分享"
- 说"我要去给团队讲 xxx"、"要做一场技术分享"、"要做路演"
- 强调"**不想忘词**"、"**怕讲不流畅**"、"**需要提词器**"

如果用户只要做一份"静态好看的 PPT"（例如小红书图文、产品图册、汇报 slides 自己不讲），**不需要**演讲者模式。

## 两种做法

### ✅ 推荐做法：直接用 `presenter-mode-reveal` 模板

```bash
cp -r templates/full-decks/presenter-mode-reveal design/my-talk   # then copy linked assets into design/my-talk/assets/
```

这个模板已经预设好所有必需元素：
- 支持 S 键切换演讲者视图
- 5 个主题可用 T 键循环（tokyo-night / dracula / catppuccin-mocha / nord / corporate-clean）
- 左右键翻页
- 每一页都有 150–300 字的示例逐字稿
- 底部有键位提示

直接改内容即可。

### 🔧 进阶做法：给任意已有模板加演讲者模式

html-ppt 的 **S 键演讲者视图是 `runtime.js` 内置的，所有 full-deck 模板都自动支持**。你只需要做两件事：

1. **每张 slide 末尾加 `<aside class="notes">`**（或 `<div class="notes">`），里面写逐字稿
2. **确认 HTML 引入了 `assets/runtime.js`**

```html
<section class="slide">
  <h2>你的标题</h2>
  <p>内容...</p>
  <aside class="notes">
    <p>这里是演讲时要说的话，150-300 字...</p>
  </aside>
</section>
```

## 逐字稿写作三铁律

这是整个方法论的核心。AI 在帮用户写逐字稿时必须遵守：

### 铁律 1：不是讲稿，是"提示信号"

❌ **错误写法**（像在念稿）：
```
大家好，欢迎来到今天的分享。今天我将要给大家介绍一下我们团队在过去三个月做的工作。
首先，我们来看一下背景情况。在过去的三个月中，我们遇到了以下几个问题……
```

✅ **正确写法**（提示信号 + 加粗核心）：
```
<p>欢迎！今天分享我们团队<strong>过去 3 个月</strong>的工作。</p>
<p>先说<em>背景</em>——三个月前我们遇到了<strong>三个核心问题</strong>：
延迟高、成本炸、稳定性差。</p>
<p>接下来逐个讲解怎么解的。</p>
```

**差别**：正确版本把关键词加粗，过渡句独立成段，看一眼就能接上。

### 铁律 2：每页 150–300 字

- **少于 150 字**：提示不够，讲到一半会卡
- **多于 300 字**：你根本来不及扫完
- **2–3 分钟/页** 是最舒服的节奏

### 铁律 3：用口语，不用书面语

| ❌ 书面语 | ✅ 口语 |
|---|---|
| 因此 | 所以 |
| 该方案 | 这个方案 |
| 然而 | 但是 / 不过 |
| 进行优化 | 优化一下 |
| 我们将会 | 我们会 / 接下来 |
| 综上所述 | 所以简单来说 |

**检查方法**：写完读一遍，听起来像说话才对。

## 必备 HTML 结构

```html
<!DOCTYPE html>
<html lang="zh-CN" data-themes="tokyo-night,dracula,corporate-clean">
<head>
  <meta charset="utf-8">
  <title>...</title>
  <link rel="stylesheet" href="../../../assets/fonts.css">
  <link rel="stylesheet" href="../../../assets/base.css">
  <link rel="stylesheet" id="theme-link" href="../../../assets/themes/tokyo-night.css">
  <link rel="stylesheet" href="../../../assets/animations/animations.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
<div class="deck">

  <section class="slide" data-title="Cover">
    <h1>你的标题</h1>
    <p>副标题</p>
    <aside class="notes">
      <p>讲稿段落 1（加<strong>加粗关键词</strong>）。</p>
      <p>讲稿段落 2（过渡句独立成段）。</p>
      <p>讲稿段落 3（自然收尾，引出下一页）。</p>
    </aside>
  </section>

  <!-- 更多 slide ... -->

</div>
<script src="../../../assets/runtime.js"></script>
</body>
</html>
```

## 演讲者视图显示的内容

按 `S` 键后由放映工具包（`deck-toolkit.js`）**弹出一个独立的演讲者窗口**，原页面保持观众视图：左侧当前页，右侧下一页与逐字稿，底部页码、计时器（可重置）和翻页按钮。预览是同一个 deck 文件的 iframe（`?gg-slide=N`），与观众视图像素一致；翻页时 iframe 常驻、只切换页，不闪烁。逐字稿支持 `<strong>`、`<em>`、`<code>` 等 inline 样式。

## 键盘快捷键（演讲者模式）

| 键 | 动作 |
|---|---|
| `S` | 打开演讲者窗口 |
| `←` `→` / Space / PgDn | 翻页（演讲者窗口里也可以） |
| `T` | 切换主题 |
| `F` | 全屏 |
| `O` | 总览 |
| `?` | 全部放映快捷键 |
| `Esc` | 关闭浮层 |

## 双屏演讲的标准流程

1. 打开 `index.html`，按 `S` → 弹出演讲者窗口
2. 把**观众窗口**（原页面）拖到投影 / 外接屏，按 `F` 全屏
3. 把**演讲者窗口**（弹窗）留在你面前的屏幕
4. 在任一窗口按 ← → 翻页，两边自动同步
5. 演讲者窗口里看逐字稿 + 下一页 + 计时器

## 常见错误

### ❌ 把逐字稿写在 slide 可见位置

```html
<!-- 错误：这段文字观众会看到 -->
<p style="font-size:12px;color:gray">
  这里讲 xxx，然后讲 yyy...
</p>
```

✅ 正确：
```html
<aside class="notes">
  <p>这里讲 xxx，然后讲 yyy...</p>
</aside>
```

`.notes` 类默认 `display:none`，只在演讲者视图可见。

### ❌ 忘记引入 runtime.js

没有 `runtime.js` = 没有翻页；没有 `deck-toolkit.js`（SKILL.md Step 3）= 没有 S 键演讲者视图。

### ❌ 逐字稿用书面语

念出来像 AI 机器人。**写完一定读一遍**。

### ❌ 每页 50 字

提示不够，照样忘词。

### ❌ 每页 500 字

眼睛根本扫不过来，等于没写。

## 用 AI 生成逐字稿的标准 prompt

> "请为每一张 slide 写一段 **150-300 字**的逐字稿，放在 `<aside class="notes">` 里。
> 要求：
> 1. 用**口语**，不要书面语（所以/但是/接下来，不是因此/然而/综上所述）
> 2. 把**核心关键词**用 `<strong>` 加粗
> 3. 过渡句独立成段（每段 1-3 句）
> 4. 读起来像说话，不像念稿
> 5. 结尾要有自然的过渡，引出下一页"

## 推荐搭配

- **主题**：`tokyo-night`（深色，技术分享首选）、`corporate-clean`（浅色，商务汇报）、`dracula`（深色备选）
- **字体**：默认 Noto Sans SC + JetBrains Mono，无需更改
- **动效**：克制使用，`fade-up` / `rise-in` 最自然，不要用 `glitch-in` / `confetti-burst` 之类花哨的
- **页数**：30 分钟分享 = 8–12 页；45 分钟 = 12–16 页；1 小时 = 16–22 页
