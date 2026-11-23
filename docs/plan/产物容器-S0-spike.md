# 产物容器 S0 · 幻灯片编辑器接入 spike

> 2026-11-22，A 线（vendor 引入 + spike）。上游 open-artifact `d70879afc94b37f9c1dd0a99c7c1d3e9af60f79e`（合约 `CONTRACT_VERSION 1.4.0`，`CAP_PROTOCOL 1`，`CHROME_PROTOCOL 1`）。计划见 `产物容器-开发计划.md`。下文 `vendor/` 指 `vendor/open-artifact/packages/`，行号对应该提交。

## 0. 结论

- **不打补丁就能跑**：Slides 编辑器原样构建，挂在一个只有约 150 行的宿主 broker（`e2e/oa-spike/host.html`）后面，能打开、显示两页、双击改字后 0.7 秒内发出一次 `artifact.publish`（带 `ifMatch`），别人改的文件经 `cap_ev artifact/files` 实时合并进来；插图走 `assets.upload`，五种导出（PNG、PPTX 可编辑、PPTX 图片、PDF、HTML）都经 `downloads.save` 交给宿主；演示模式可进入。验收脚本：`pnpm exec playwright test -c e2e/oa-spike`（先 `scripts/build-open-artifact.sh`），2 个用例全绿。
- **它自己按 URL 加载的只有三类**：编辑器自己的静态文件（相对路径）、预览域根下的 `/_blob/<32 位 hex>`、编辑器页面目录下的 `project/ds/…`（设计系统副本、字体）。每页幻灯片不是 iframe，是 React 直接渲染进编辑器 DOM 的，不需要按页 URL。WASM 以 base64 内嵌在 JS 里，没有 `.wasm` 请求；导出用一个同源 module worker。
- **对计划要改的地方**（细节见 §6）：编辑器构建产物放不进插件目录（插件 5 MB 上限）；`artifact.publish` 要按文件比哈希而不是要求父版本是 head；编辑器每 0.7 秒存一次，版本必须合并；`room` 在 S1 就要给（至少 presence）；`comments` 的线程字段比第 5 节多（`label/detail/location/resolvedBy`，anchor 是不透明字符串）；`assets` 的 id 必须是 32 位 hex 前缀，且要收视频；Shell 还要实现一套 chrome 协议（顶栏状态、导出、剪贴板），计划里没写。
- **最大的未解问题是界面语言**：编辑器全部英文硬编码，没有 i18n 层（§7）。

## 1. 引入方式与构建

- 引入：`scripts/vendor-open-artifact.sh <commit>` 拷贝固定提交，**没有用 `git subtree`**：我们只要 46 个包里的 22 个，subtree 每次 pull 都会在删掉的包上冲突。脚本同时拷贝上游 `package-lock.json` 再由 `npm install` 剪掉未保留的包（版本与上游一致，159 个解析条目）、根 `package.json`/`tsconfig.json` 改成只含保留的包（`scripts/vendor-open-artifact-manifest.mjs`），提交哈希写进 `vendor/open-artifact/UPSTREAM`。升级步骤在 `vendor/open-artifact/PATCHES.md`。
- 保留的包：计划第 7 节所列，**另加 `dc`**（`slides-core` 用 `@open-artifact/dc/html` 解析页 HTML：`vendor/slides-core/src/compile.ts:18`、`source.ts:36`、`serialize.ts:12`）。Rust 源码（`crates/`）不拷，`wasm-*/generated/` 用上游提交的构建。另拷了 `test-artifacts/slides/` 作 spike 的样例 deck。共 14 MB 源码。
- 独立 npm 工作区：不在 `pnpm-workspace.yaml` 里，我们的包解析不到它；`biome.json` 排除 `vendor`；`check-size.mjs` 的范围正则本就只匹配 `apps|packages|crates` 开头，不受影响；内部信息检查跳过 `vendor/open-artifact/packages` 与其 lockfile（上游代码），`PATCHES.md` 等照常扫描；`scripts/check.sh` 在 `vendor/open-artifact/*` 有改动时跑它自己的 `npm run typecheck` + `npm test`（上游 1796 个 `node --test` 用例全过）。**Jenkins 全量流水线还没加这一步**（任务配置在内部仓库）。
- 构建：`scripts/build-open-artifact.sh [slides|whiteboard|motion]` 用各编辑器自带的 `vite.config.ts`，只改 `--outDir` 到 `vendor/open-artifact/dist/editors/<type>/`（被 `dist/` 忽略，不入库：都是可重建的压缩包）。要求 Node ≥ 22.18（我们根 `package.json` 已要求 ≥ 24，CI 一致；本机默认 22.13 会被脚本拒绝）。三个编辑器都能构建（各约 3–6 秒）。

| 编辑器 | 文件数 | 体积 | JS/CSS gzip | 主要文件 |
|---|---|---|---|---|
| slides | 13 | 2.78 MB | 0.93 MB | `index-*.js` 1.58 MB、`src-*.js` 0.52 MB（导出）、`run-*.js` 0.19 MB 与 `worker-*.js` 0.19 MB（wasm-export，内嵌 base64）、Inter 7 个 woff2 |
| whiteboard | 13 | 3.23 MB | 1.16 MB | `index-*.js` 1.96 MB、`drawing-look-worker-*.js` 0.57 MB |
| motion | 48 | 3.52 MB | 1.11 MB | `index-*.js` 2.14 MB、导出 worker、33 个内置字体 woff2 及 OFL 文本 |

构建警告（不影响产物）：`ui/src/fonts.ts:84-85` 同一 JSON 动态导入带/不带 import attributes；白板 CSS 的 `::highlight()` 不被 lightningcss 识别。

## 2. 能力清单（实测 + 代码）

broker 消息定义在 `vendor/protocol/src/shell.ts:280-310`（`CapToPage`/`CapToShell`），页面端实现 `vendor/runtime/src/broker.ts`。页面先发 `cap_want {cap, protocol: 1, base}`（`base` 是编辑器页面所在目录的绝对 URL），1.5 秒（`broker.ts:146`）内收不到 `cap_grant` 就退回本地 type server（我们没有，会全部失败），所以 **Shell 必须对每个 `cap_want` 都回 `cap_grant`**，不给的回 `ok:false`。调用 `cap {id, cap, method, args, gen}` → `cap_r {id, result | error:{code,message,paths?,retryable?}}`；慢调用可回 `cap_ack {id}` 把超时延到 15 分钟。超时：默认 130 s，`downloads` 150 s，`assets` 272 s，`user` 20 s 且超时得 `null`（`broker.ts:93-98`）。Shell 只认 `BROKERED_METHODS`（`broker.ts:62`）里的方法名，事件名见 `BROKERED_EVENTS`（`broker.ts:82`）。

Slides 编辑器启动时要的能力：`connectHost(['artifact','assets','agent','room','downloads','comments'])`（`vendor/slides-editor/src/services/session.ts:35`）+ `user`（`vendor/editor-kit/src/session.ts:32`）+ `history`（`vendor/editor-kit/src/collab/history-wiring.ts:33`）。实测 `cap_want` 顺序：`user, artifact, assets, agent, room, downloads, comments, history`。没有要 `db / doc / sheet / mcp`。

类型定义都在 `vendor/runtime/src/capabilities.ts`（下称 caps）。

| 能力.方法 | 参数 → 返回 | 谁在用 / 何时 | spike 实测 |
|---|---|---|---|
| grant `artifact` | `config: {id}` | 编辑器用 id 作本地存储键（`services/location.ts:24`） | ✓ |
| `artifact.title()` | → `string` | 加载（`editor-kit/src/project-sync.ts:241`） | ✓ |
| `artifact.list()` | → `Record<path, {sha256, size}>`，`sha256` 小写 hex（caps:115-125） | 加载 | ✓ |
| `artifact.readText(path)` | → `string`；不存在 reject `not_found` | 加载读 `project/deck.json`、`project/deck.css`、每个 `project/slides/<id>.html`；远端变更后重读该路径；设计系统 `project/ds/<ns>/tokens.json`（`editor-kit/src/design-systems.ts:64`） | ✓ |
| `artifact.readBytes(path)` | → `Uint8Array` | Slides 未见调用 | — |
| `artifact.publish(batch)` | `Record<path, {content, encoding?:'utf8'\|'base64', ifMatch?: string\|null} \| null>`（caps:126-137），`null` 删除（删除不带 `ifMatch`），`ifMatch:null` 表示必须不存在 → `{hashes: Record<path, string\|null>}`。冲突 reject `{code:'conflict', paths:[{path,expected,actual}]}`，编辑器读回对方内容三方合并后重试；`not_writer` → 编辑器转只读并把未存内容留在 localStorage 3 天（`project-sync.ts:139-143`、`slides-editor/src/services/sync.ts:65`） | 最后一次修改后 700 ms 存一批（`sync.ts:27`） | ✓ 改字 1 秒内一批，只含改动页 |
| ev `artifact`/`files` | `{changes: Record<path, hash\|null>, author?}`；Shell 不回显本页自己的 publish | `project-sync.ts:192` → 重读并合并；正在输入的页等输入结束再合并 | ✓ 模拟 agent 改第 2 页，实时显示 |
| `assets.upload(blob, {name?})` | → `{id, url:'/_blob/<id>', sizeBytes, contentType}`，`id` = sha256 前 32 位 hex（caps:190-205）；页 HTML 只接受 `^/_blob/[0-9a-f]{32}$`（`slides-core/src/limits.ts:154`） | 插图片；插视频时上传视频和封面 jpg 两次（`slides-editor/src/services/assets.ts:73,173-174`） | ✓ |
| grant `user` | `config: {me: Viewer}`，有它就不发 `user.me` 调用（`broker.ts:297`） | `Viewer {id, name, role:'owner'\|'editor'\|'commenter'\|'viewer', kind?, email?, avatar?}`（caps:210-225）；`canEdit` = owner/editor（`editor-kit/src/roles.ts:40`） | ✓ |
| `agent.status()` / ev `agent`/`status` | → `{available, busy, name, wakesIdle?, waitingForPerson?}`（caps:264） | 顶栏 Ask、评论「发给 Agent」（`editor-kit/src/agent.ts:51-57`） | ✓（给 `available:false`） |
| `agent.send(req, {deliver?})` | `req {text, title?, context?}`，`deliver: 'send'\|'stage'` → `{status:'delivered'\|'queued'\|'staged'\|'failed', reason?}`；带用户手势 | Ask agent（`slides-editor/src/services/agent.ts:251`）、Ask agent to fix（`:276`），`context.view` 是当前视图上下文 | 未触发 |
| `room.self()` | → `string` | 在场（`editor-kit/src/collab/presence.ts:158`） | ✓ |
| `room.presence(patch)` | `patch` 合并，`null` 删键；`viewContext` 键给 agent | 加载、每次选区/编辑变化、进演示都发：`{viewContext:{mode:'edit'\|'present', slideId, slideIndex, slideCount, dirty, selected[], slideTitle, edits, selection?[{id,kind,label}]}}` | ✓ |
| `room.peers()` / ev `room`/`peers` | → `Peer[] {id, name, kind, state}` | 在场头像、跟随 | ✓（空） |
| `room.emit(topic, data)` / ev `room`/`message` | 光标（`slides-editor/src/services/cursors.ts:64`），单条 ≤16 KB | 未触发 |
| grant `downloads` | `config: {browser:true}` 时页面得到 `browser` 与 `check()`（`broker.ts:388`） | **不给 `browser:true` 时只有 owner 能导出**（`editor-kit/src/session.ts:52` `mayExportHere`） | ✓ |
| `downloads.save({name, data: Blob})` | → `{savedTo?}`；带用户手势 | 五种导出 | ✓ png 10 KB、pptx 12 KB/66 KB、pdf 102 KB、html 31 KB |
| `downloads.check()` | resolve 可导出 / reject `not_writer` | 导出前（`editor-kit/src/downloads.ts:38`） | ✓ |
| `comments.list()` / ev `comments`/`threads` | → `CommentThread[]`（caps:486）；事件带完整列表 | 加载 | ✓（空） |
| `comments.create/reply/edit/react/setResolved/move/remove/sendToAgent` | 见 caps:519-537；`sendToAgent` 带手势 | 评论模式（C 键或 Shell 的评论按钮）；只有连上 Shell 且非 viewer 才可评论（`slides-editor/src/services/comments.ts:39`） | 未触发 |
| `history.list()` / ev `history`/`change` | → `{versions: HistoryVersion[], notices, canRestore}`（caps:560-600） | 加载 | ✓（空） |
| `history.files(n)` / `read(n, path)` / `diff(n, path)` / `restore(n, paths?)` / `dismissNotice(id)` | `files` → `FileListing`；`restore` → `{version, changed}`，**可只恢复部分路径** | 打开版本历史、预览、恢复（`slides-editor/src/services/history.ts:13-31`） | 未触发 |

`CommentThread`：`{id, anchor: string, label, detail?, location: JsonRecord, status:'open'|'resolved', resolvedBy?, agent?:{status:'pending'|'delivered'|'replied'}, messages:[{id, author:{kind,name}, text, at, editedAt?, to?, reactions?, joined?}]}`。Slides 的 anchor 是 `JSON.stringify({slide?, el?, x?, y?, w?, h?})`（`comments.ts:27,45`），对宿主不透明，须原样存取。

## 3. chrome 协议（Shell 顶栏，计划未列）

页面端 `vendor/runtime/src/shell.ts`，消息 `vendor/protocol/src/shell.ts:230-356`。只在 URL 带 `open_artifact_shell=<Shell origin>` 且被嵌入时启用（`runtime/src/shell.ts:81-83`）；页面只向该 origin 发、只收 `source === parent` 且 origin 相同的消息。

- Shell → 页：`chrome_hello {draws: ['saved','actions','formats','shareNotice','peers'], clipboard: bool}`（页面据此隐藏自己画的保存徽标等，并立即回一次 `chrome_report`）；`chrome_cmd`：`goto_slide {hash}`、`comments_mode {on?, anchor?}`、`comments_list {open?}`、`history`、`action {id}`、`export_format {request(16–64 位), format, variant?}`、`exports {id}`（Slides 回空）；`files_changed {paths}`（Slides 总是回 `files_changed_ok`，`slides-editor/src/services/shell.ts:206`，真正的变更走 `artifact/files` 事件）；`clipboard_done {id, error?}`。
- 页 → Shell：`chrome_report {protocol:1, report}`，实测 report 含 `agent{available,listening,busy}`、`history`、`saved: saved|saving|unsaved|reconnecting|readonly`、`leaveLosesWork`、`actions`（`undo/redo/open_find/comment_selection/save_now/present`）、`formats`（`pdf` interactive、`pptx` 三个 variant `current/basic/pictures`、`html` interactive、`png`）、`comments{available,on,open,count,pageButton}`；`current_slide {hash:'#slide-~<id>'}`、`copy_slide_link {hash}`、`request_comment_mode {on, anchor?}`、`chrome_export {request, state: started|done|busy|unsupported|declined|failed, reason?}`、`clipboard_write {id, types}` + `clipboard_data {id, items: Record<mime, Blob>}`（框内拿不到剪贴板时由 Shell 代写）。
- interactive 的格式（pdf、html）收到 `export_format` 后先在编辑器里弹自己的选项对话框，用户点了才导出；对话框开着时别的导出回 `busy`。
- 只读内嵌视图：URL 片段 `#view-inline`（`INLINE_VIEW_FRAGMENT`）时编辑器只读、单页翻页、不连 presence/评论/历史/保存（`slides-editor/src/services/inline.ts`），可用于群卡片和分享页。

## 4. 编辑器自己按 URL 加载的内容，及对 origin / CSP / 沙箱的要求

实测请求（编辑器 iframe 内，宿主之外）：

| 请求 | 来源 | 说明 |
|---|---|---|
| `<editorBase>/index.html?open_artifact_shell=…&open_artifact_id=…` | Shell 设的 iframe src | Vite `base: './'`，任意目录都能放 |
| `<editorBase>/assets/index-*.js`、`index-*.css`、`assets/inter-*.woff2` | 编辑器静态文件 | 字体只在用到时加载 |
| `<editorBase>/assets/worker-*.js`（module worker） | `vendor/wasm-export/src/index.ts:95` | PNG/PDF/PPTX 导出时；WASM 从 base64 `initSync`（`wasm-export/src/run.ts:11,26`） |
| `<预览域>/_blob/<32 hex>`（`<img>` 与 `fetch`，同源、`credentials:'same-origin'`） | 插入的图片/视频/封面；导出时 `fetch` 取字节（`slides-editor/src/services/snapshot.ts:93-101`） | **根路径，与编辑器目录无关** |
| `blob:<预览域>/…` | 上传前的本地预览 | |

代码里还有、spike 样例没有触发的：

- `project/ds/<ns>/…`、deck `faces[].src` → `new URL(src, document.baseURI)`，即 **`<editorBase>/project/ds/…`**（`slides-editor/src/services/session.ts:45-48`、`render/fonts.ts:35-38`）。页 HTML 里图片只允许 `/_blob/<id>` 或 `project/ds/<folder>/…`（`slides-core/src/compile.ts:1036-1055`）。
- deck `faces[].href` 为 Google Fonts 时插 `<link href="https://fonts.googleapis.com/css2?…">`（`render/fonts.ts:27-31`，字体选择器 `ui/src/fonts.ts:172`、`slides-editor/src/lib/fonts.ts:85`），导出时 `fetch` 该样式表（`snapshot.ts:166`）；可编辑 PPTX 嵌字体时请求 `https://api.fontsource.org/v1/fonts/` 与 `https://cdn.jsdelivr.net/fontsource/fonts/`（`services/export/font-embedding.ts:115-116`）。
- 视频链接：外站嵌入 iframe（`render/SlideView.tsx:523`）、封面 `fetch(url,{mode:'cors'})`（`services/assets.ts:319`）。
- 嵌入网页节点：`<iframe sandbox="allow-scripts" srcdoc=…>`（`render/SlideView.tsx:686-692`）。
- 演讲者视图：`window.open('', name, 'popup,…')` 后由 opener 写入（`components/present/SpeakerWindow.tsx:42`）；演示全屏 `requestFullscreen`（`components/present/Presenter.tsx:321,490`）。
- 剪贴板：`navigator.clipboard.write/writeText`（`editor-kit/src/clipboard.ts:31,45`），Shell 声明 `clipboard:true` 时改走 `clipboard_write` 中继。
- 本地存储：`localStorage` 面板偏好；未保存内容恢复键 `open-artifact-slides:recovery:${location.pathname}`（`services/recovery.ts:28`）；当前页 `…:position:<artifact.id>`（`services/location.ts:24`）。`location.hash` 用 `history.replaceState` 改写成 `#slide-~<id>`。

由此得出的要求（均已用 spike 验证，除注明外）：

- **origin**：编辑器必须挂在**该产物自己的预览 origin** 上：`/_blob/` 是根路径、`project/ds/` 相对编辑器页面、恢复数据按 pathname 存 localStorage。我们的预览本来就是一个预览一个 origin（`apps/server/src/modules/previews/config.ts`：域名模式 `<slug>.<domain>`，端口模式一个预览一个端口），所以计划 §9「不同产物共享一个 origin」不成立，按产物隔离是现成的；端口模式下端口池（默认 41000–41099）要算上编辑器占用。
- **沙箱**：`sandbox` 必须含 `allow-scripts allow-same-origin`（去掉 `allow-same-origin` 编辑器直接起不来：origin 变 `null`，宿主校验与 localStorage 都失败，已验证）；实测通过的组合是 `allow-scripts allow-same-origin allow-downloads allow-popups allow-modals`（`allow-popups` 给演讲者视图，未实测）。隔离靠独立 origin，不靠 sandbox。`allow="fullscreen; clipboard-write"`：缺 `fullscreen` 时进演示报 `Permissions policy violation: fullscreen is not allowed`（已验证）。
- **CSP**（编辑器响应头，实测全部用例通过）：`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors <主站 origin>`。去掉 `'wasm-unsafe-eval'` 后 PNG/PDF/PPTX 导出全部失败（`WebAssembly.Module() … violates … script-src`，已验证）；`style-src 'unsafe-inline'` 是因为运行时插 `<style>`（字体）与 React 行内样式。Google Fonts/fontsource/视频站点要不要放进 `style-src/font-src/connect-src/frame-src` 是产品决定（§5 P2）。`index.html` 没有内联脚本。
- **postMessage**：Shell 只收 `event.origin === 预览 origin && event.source === 编辑器 iframe.contentWindow`（与现有 `bridge.ts` 同规则）；`open_artifact_shell` 填主站 origin。`cap_want.base` 只作核对。所有响应加 `nosniff`。

## 5. vendor 补丁

S0 未打任何补丁（`PATCHES.md` 为空）。S1 预计需要：

| # | 类别 | 内容 | 位置 |
|---|---|---|---|
| P1 | 主题令牌 | 把 `--color-chrome*` 等令牌映射到我们的主题变量与暗色模式 | `vendor/editor-kit/src/styles.css`、`vendor/ui/src/` 的主题定义 |
| P2 | 去本地/外网入口 | 字体选择器只列 web-safe 与随编辑器打包的字体（或改指我们服务端代理），可编辑 PPTX 不去 fontsource 取字体；否则国内网络下字体失效、导出卡在外网请求 | `vendor/ui/src/fonts.ts:172`、`vendor/slides-editor/src/lib/fonts.ts:85`、`services/export/font-embedding.ts:115-116` |
| P3 | 去本地入口 | 文案里「Open it again from your agent」「sharing computer」等本地 daemon 用语 | `slides-editor/src/services/session.ts:37` 等，随 P4 一起处理 |
| P4 | 待定 | 界面汉化（见 §7），量大，可能需要上游配合加 i18n 层 | 全部 editor 包 |

broker、URL、角色这些都不需要改 vendor。

## 6. 对计划的修正建议

**§4.1 类型注册 / 编辑器放哪**：编辑器构建产物**不能放进 `apps/server/plugins/official/slides/editor/`**。`syncBuiltinPlugins` 把插件目录整个读进数据库（`apps/server/src/modules/plugins/builtin.ts:9-36`），上限 `PLUGIN_MAX_BYTES` 5 MB、`PLUGIN_MAX_FILES` 600（`packages/protocol/src/plugins.ts:10-11`）；slides 插件现在已有 3.47 MB / 300 个文件，加编辑器 2.78 MB 后 6.25 MB，**服务端启动时同步内置插件就会失败**；白板 3.2 MB、动效 3.5 MB 单独放也逼近上限，而且每升一次编辑器就在库里多存一份。建议：编辑器作平台资源随服务端包发布（例如镜像构建时跑 `scripts/build-open-artifact.sh`，拷到 `apps/server/editors/<type>/`），按 `artifacts.editor_version`（B 线的字段）在预览 origin 的 `/__oa/<type>@<editorVersion>/` 下提供，插件清单只声明 `kind` 与要用的编辑器类型/最低版本。现在构建产物输出到 `vendor/open-artifact/dist/editors/<type>/`（不入库），`Dockerfile` 还要加一个构建阶段。

**§4.1 路径**：`/__oa/<type>@<ver>/project/*` 必须映射到本产物版本里的 `project/*` 文件（`project/ds/` 设计系统、字体），`/_blob/<32hex>` 映射到本产物的上传（见下）。产物目录里的文件路径建议保持与 open-artifact 相同的 `project/…` 前缀，`list/readText/publish` 不做路径换算，SKILL 也能直接沿用。

**§4.3 映射表**：

| 能力 | 修正 |
|---|---|
| `artifact.publish` | 不是「不是 head 上的修改返回 conflict」，而是**逐文件比对 head 上该路径的哈希**（我们的文件哈希也是 sha256 hex，可直接比）：`ifMatch` 都对上就合并成新 head，哪怕 head 已因别的文件前进；对不上才 `conflict` 并列出 `{path, expected, actual}`。删除项是 `null`、不带 `ifMatch`。 |
| `artifact.publish` 频率 | 编辑器每次修改后 700 ms 就存一次，打字会连续发很多批。不能每批一个 `artifact_versions` 行：同一成员连续的 `source=edit` 发布要并入同一版本（上游历史按「停 30 s 或满 5 min」分段，`HistoryVersion` 注释，caps:556-559），或在 Shell 侧合并。需要定。 |
| `artifact.onChange` | 事件名 `files`，数据 `{changes:{path: hash\|null}, author?}`。 |
| `assets` | id 必须是 **sha256 前 32 位 hex**，URL 固定 `/_blob/<id>`（页 HTML 校验正则写死 32 位）。除了图片还要收**视频（mp4/webm 等）和 jpg 封面**，现有「图片魔数校验」要扩到视频，否则插视频失败。上传的 blob 要被版本引用才会永久保留、Bot 检出时才拿得到：建议发布时把页里引用到的 `/_blob/<id>` 作为版本文件 `_blob/<id>` 一并记入（Bot 也能按同一相对路径打开），预览 origin 的 `/_blob/<id>` 读 head（或固定版本）里的这个文件。 |
| `user` | 放在 `cap_grant.config.me`，省一次往返。可编辑成员给 `editor`、访客 `viewer` 即可（Slides 只看 `canEdit`）；Ask/发给 Agent 是否可用取决于 `agent` 是否授予，不看角色。 |
| `downloads` | 必须 `config:{browser:true}` 并实现 `check()`，否则非 owner 的导出按钮不可用；`save` 直接在主站触发浏览器下载。 |
| `agent` | 另需 `status()` 与 `status` 事件（`available/busy/name/waitingForPerson`），映射到该产物 AI 对话的运行状态；`send` 的 `context.view` 是视图上下文，按 `fenceUntrusted` 处理。 |
| `room` | **S1 就要授予**：Slides 加载即调 `self/presence/peers`，`presence.viewContext` 正是 §4.5 要的选区上下文。S1 可以先只实现 `self`、`presence`（存最近一次给 @Bot 消息用）、`peers` 返回空，`emit` 空操作；转发与光标留给 S2。 |
| `comments` | 线程要存 `anchor`（**原样字符串**，或 jsonb 但必须能逐字还原）、`label`、`detail`、`location jsonb`、`status open/resolved`、`resolvedBy`；我们的 `open → sent → resolved` 对应 `status` + `agent.status pending/delivered/replied`；消息要有 `to`、`reactions`、`editedAt`、`joined`。事件 `threads` 推完整列表。第 5 节 `artifact_threads` 少了 `label/detail/location/resolved_by`，幻灯片 anchor 实际是 `{slide?, el?, x?, y?, w?, h?}` 而不是 `{slide, path?, point?}`。 |
| `history` | 另有 `files(n)`、`read(n,path)`、`readBytes`、`diff(n,path)`、`dismissNotice`；`restore(n, paths?)` 支持**只恢复部分路径**，此时不能只移动 head（`restoreVersion`），要生成新版本。`list` 的 `versions[].author {kind:'person'\|'agent'\|'system', id, name}`、`files[{path, op}]` 要从版本差异算出。 |
| `doc / sheet / mcp / db` | Slides 不请求；仍要回 `cap_grant ok:false`。 |

**§4.2 Shell**：除能力代理外，Shell 要实现 §3 的 chrome 协议：`chrome_hello`（声明自己画哪些）、按 `chrome_report` 画保存状态/撤销重做/演示/导出列表/评论数、发 `chrome_cmd`、处理 `chrome_export` 状态、`current_slide` 同步到 URL（`#slide-~<id>`，分享与按页批注用）、剪贴板中继。分享页/群卡片可用 `#view-inline` 只读视图，只授予 `artifact`（读）与 `user`。

**§9 安全**：见 §4「origin」——按产物隔离已由每个预览独立 origin 保证；要做的是编辑器响应的 CSP（含 `frame-ancestors`、`'wasm-unsafe-eval'`）与 iframe 的 `sandbox`/`allow`。

## 7. 未解决

- **界面语言**：三个编辑器的界面文案、toast、导出说明全是英文硬编码，没有 i18n 层；我们默认中文。要么接受英文编辑器界面，要么给上游提 i18n 或自己维护一层翻译补丁（量大，升级时冲突多）。需要姜维川定。
- 未覆盖的路径：嵌入网页、视频链接、Google 字体、设计系统 `project/ds/`、演讲者视图弹窗、评论增删改与发给 Agent、版本历史预览/恢复、多人在场与光标、剪贴板中继——代码已读，未跑。
- 版本合并策略（§6 发布频率）与上传 blob 入版本的方式要和 B 线一起定。
- Jenkins 尚未加 vendor 的 `npm ci && npm run typecheck && npm test` 步骤；Docker 镜像尚未包含编辑器构建。
- 白板、动效编辑器只验证了能构建，未接入。

## 8. 文件

- `scripts/vendor-open-artifact.sh`、`scripts/vendor-open-artifact-manifest.mjs`：引入；`scripts/build-open-artifact.sh`：构建。
- `vendor/open-artifact/`：`UPSTREAM`、`PATCHES.md`、`LICENSE`、`NOTICE`；根 `THIRD_PARTY_NOTICES.md` 已注明。
- `e2e/oa-spike/`：`host.html`（宿主 broker）、`serve.mjs`（主站与预览 origin 两个端口）、`slides.spike.ts`、`playwright.config.ts`。`OA_SPIKE_CSP`、`OA_SPIKE_SANDBOX`、`OA_SPIKE_ALLOW` 可试不同的头和 iframe 属性；`OA_SPIKE_REPORT=<file>` 输出能力调用与请求清单。文件名 `.spike.ts` 不会被 `pnpm e2e` 选中。
