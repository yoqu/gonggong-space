# Run by the mock agent (`mock:sh sh <this> <<'EOF'` in a creation prompt) in the designer bot's workspace: writes the
# todo-app mini-program prototype (three screens) into the creation's design/<slug> folder, the way the web-prototype
# plugin lays an artifact out, so the canvas and the works library have a real artifact to show.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
plugin="$ROOT/apps/server/plugins/official/web-prototype/skills/web-prototype"
dir=$(grep -o 'design/[a-z0-9-]*' | head -n1 || true)
[ -n "$dir" ] || dir=$(ls -d design/*/ | head -n1)
dir=${dir%/}
mkdir -p "$dir/screens" "$dir/_gg"
cp "$plugin/design-systems/glacier/tokens.css" "$dir/tokens.css"
cp "$plugin/kit/index.html" "$dir/index.html"
cp "$plugin/kit/gg-kit.css" "$plugin/kit/gg-kit.js" "$dir/_gg/"
cat >"$dir/gg-artifact.json" <<'JSON'
{
  "title": "待办清单小程序",
  "device": "miniprogram",
  "entry": "home",
  "screens": [
    { "id": "home", "title": "待办列表", "file": "screens/home.html", "statusBar": "dark" },
    { "id": "new", "title": "新建待办", "file": "screens/new.html", "statusBar": "dark" },
    { "id": "stats", "title": "完成统计", "file": "screens/stats.html", "statusBar": "dark" }
  ]
}
JSON
screen() { # id title body
  cat >"$dir/screens/$1.html" <<HTML
<!doctype html>
<html lang="zh-CN" data-gg-device="miniprogram">
<head>
<meta charset="utf-8">
<title>$2</title>
<link rel="stylesheet" href="../_gg/gg-kit.css">
<link rel="stylesheet" href="../tokens.css">
<script src="../_gg/gg-kit.js" defer></script>
<style>
body { margin: 0; background: var(--color-background); color: var(--color-on-surface-strong, #151515);
  font: 15px/1.5 -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif; }
header { padding: 18px 20px 8px; }
h1 { font-size: 24px; margin: 0; }
.sub { color: var(--color-on-surface-variant, #737374); font-size: 13px; margin-top: 4px; }
.seg { display: flex; gap: 8px; padding: 8px 20px; }
.seg span { padding: 5px 14px; border-radius: 999px; background: var(--color-surface); font-size: 13px; }
.seg .on { background: var(--color-primary); color: #fff; }
.card { background: var(--color-surface); border-radius: 14px; margin: 10px 16px; padding: 4px 0; }
.row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #eef0f3; }
.row:last-child { border-bottom: 0; }
.box { width: 20px; height: 20px; border-radius: 6px; border: 2px solid var(--color-primary); flex: none; }
.done .box { background: var(--color-primary); }
.done .t { color: #aaa; text-decoration: line-through; }
.meta { margin-left: auto; font-size: 12px; color: #999; }
.fab { position: fixed; right: 22px; bottom: 34px; width: 54px; height: 54px; border-radius: 50%; border: 0;
  background: var(--color-primary); color: #fff; font-size: 28px; box-shadow: 0 6px 16px rgb(47 111 237 / .35); }
label { display: block; font-size: 13px; color: #737374; margin: 16px 20px 6px; }
.field { background: var(--color-surface); margin: 0 16px; border-radius: 12px; padding: 13px 14px; }
.chips { display: flex; gap: 8px; margin: 0 16px; }
.chips span { background: var(--color-surface); border-radius: 10px; padding: 8px 14px; font-size: 13px; }
.chips .on { outline: 2px solid var(--color-primary); }
.primary { display: block; margin: 28px 16px; width: calc(100% - 32px); padding: 14px; border: 0; border-radius: 12px;
  background: var(--color-primary); color: #fff; font-size: 16px; }
.big { font-size: 44px; font-weight: 700; color: var(--color-primary); }
.bars { display: flex; align-items: end; gap: 12px; height: 120px; padding: 12px 20px; }
.bars i { flex: 1; background: var(--color-primary); border-radius: 6px 6px 0 0; opacity: .85; }
.days { display: flex; gap: 12px; padding: 0 20px 12px; font-size: 12px; color: #999; }
.days span { flex: 1; text-align: center; }
</style>
</head>
<body>
$3
</body>
</html>
HTML
}
screen home 待办列表 '<header><h1>今天的待办</h1><div class="sub">还剩 3 项未完成</div></header>
<div class="seg"><span class="on">只看未完成</span><span>显示全部</span><a data-gg-link="stats" style="margin-left:auto;font-size:13px;color:var(--color-primary)">统计</a></div>
<div class="card">
<div class="row"><span class="box"></span><span class="t">整理 todo-app 发版清单</span><span class="meta">10:00</span></div>
<div class="row"><span class="box"></span><span class="t">回复设计稿评论</span><span class="meta">14:30</span></div>
<div class="row"><span class="box"></span><span class="t">补一轮 Safari 回归测试</span><span class="meta">17:00</span></div>
<div class="row done"><span class="box"></span><span class="t">周会纪要发到群里</span></div>
</div>
<button class="fab" data-gg-link="new">+</button>'
screen new 新建待办 '<header><a data-gg-back style="color:var(--color-primary);font-size:14px">取消</a><h1 style="margin-top:10px">新建待办</h1></header>
<label>要做什么？</label><div class="field">补一轮 Safari 回归测试</div>
<label>截止时间</label><div class="field">今天 17:00</div>
<label>优先级</label><div class="chips"><span>低</span><span class="on">中</span><span>高</span></div>
<button class="primary" data-gg-back>添加</button>'
screen stats 完成统计 '<header><a data-gg-back style="color:var(--color-primary);font-size:14px">返回</a><h1 style="margin-top:10px">本周完成</h1></header>
<div class="card" style="padding:16px 20px"><div class="big">18</div><div class="sub">比上周多 5 项 · 完成率 82%</div></div>
<div class="card"><div class="bars"><i style="height:40%"></i><i style="height:65%"></i><i style="height:50%"></i><i style="height:90%"></i><i style="height:70%"></i><i style="height:30%"></i><i style="height:20%"></i></div>
<div class="days"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div></div>'
echo "已完成「待办清单小程序」原型：待办列表、新建待办、完成统计 3 屏，可在画布上查看和批注。"
