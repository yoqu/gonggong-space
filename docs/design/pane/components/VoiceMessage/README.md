# VoiceMessage

语音消息：放在 `Message` 的气泡里。播放按钮 + 波形 + 时长，未听过的带红点，可附转写文字。

**你需要提供**：`duration`（秒）、可选 `played`（是否听过，默认 false 显示红点）、`playing`、`progress`（0–1，已播放部分的波形着 `bubble-link`）、`transcript`（语音转文字，显示在分隔线下）、`onPlay(playing)`、`seed`（让同一条语音每次渲染出相同的波形）。

- 波形宽度随时长增长（12–36 根），未播放部分 `label-secondary`，在两种气泡上都 ≥ 4.5:1。
- 组件只负责外观和播放态切换，音频播放由你接 `onPlay` 实现。
