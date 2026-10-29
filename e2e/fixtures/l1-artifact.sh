# Run by the mock agent (`mock:sh sh <this> <home heading>`) in a bot's workspace: prints the home heading the hosted
# artifact folder holds as the turn starts, then writes a two-screen L1 artifact whose home says <home heading>
# ("-" only prints). The folder is the first design/<slug> on stdin (the creation prompt, fed as a heredoc), else the
# one already checked out.
set -e
plugin="$(cd "$(dirname "$0")/../.." && pwd)/apps/server/plugins/official/web-prototype/skills/web-prototype"
dir=$(grep -o 'design/[a-z0-9-]*' | head -n1 || true)
[ -n "$dir" ] || dir=$(ls -d design/*/ | head -n1)
dir=${dir%/}
before=$(sed -n 's/.*<h1>\(.*\)<\/h1>.*/\1/p' "$dir/screens/home.html" 2>/dev/null || true)
echo "before: ${before:-none}"
[ "$1" = "-" ] && exit 0

mkdir -p "$dir/screens" "$dir/_gg"
cp "$plugin/design-systems/luke-plus/tokens.css" "$dir/tokens.css"
cp "$plugin/kit/index.html" "$dir/index.html"
cp "$plugin/kit/gg-kit.css" "$plugin/kit/gg-kit.js" "$dir/_gg/"
cat > "$dir/gg-artifact.json" <<'JSON'
{
  "title": "e2e 原型",
  "device": "miniprogram",
  "entry": "home",
  "screens": [
    { "id": "home", "title": "首页", "file": "screens/home.html", "statusBar": "dark" },
    { "id": "detail", "title": "详情", "file": "screens/detail.html", "statusBar": "dark" }
  ]
}
JSON
screen() {
  cat > "$dir/screens/$1.html" <<HTML
<!doctype html>
<html lang="zh-CN" data-gg-device="miniprogram">
<head>
<meta charset="utf-8">
<title>$1</title>
<link rel="stylesheet" href="../_gg/gg-kit.css">
<link rel="stylesheet" href="../tokens.css">
<script src="../_gg/gg-kit.js" defer></script>
</head>
<body>
<h1>$2</h1>
$3
</body>
</html>
HTML
}
screen home "$1" '<a data-gg-link="detail">看详情</a>'
screen detail "活动详情" '<button data-gg-back>返回</button>'
echo "wrote $dir"
