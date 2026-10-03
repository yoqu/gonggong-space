# Generates index.html (hosts, HUD, captions, audio) from timeline.json.
import json, html
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tl = json.loads((root / 'timeline.json').read_text())
total = tl['total']
chs = tl['chapters']
WHO = {'G': ('共字君', '#8fd6ff'), 'T': ('铁码', '#ffb4a8'), 'F': ('反推', '#ffd36b')}
MAP = ['群聊即指挥台', 'Bot 同事', '机器与工作区', '过程透明', '权限审批', '改动可审', '一键预览', '接力多端']

hosts, caps, auds, cap_js = [], [], [], []
for i, c in enumerate(chs):
    end = chs[i + 1]['start'] if i + 1 < len(chs) else total
    hosts.append(
        f'<div id="h-{c["id"]}" data-composition-id="{c["id"]}" data-composition-src="compositions/{c["id"]}.html" '
        f'data-start="{c["start"]}" data-duration="{round(end - c["start"], 2)}" data-track-index="{2 + i % 2}" data-width="1920" data-height="1080"></div>'
    )
    for l in c['lines']:
        who = WHO.get(l['voice'])
        tag = f'<b style="color:{who[1]}">{who[0]}</b>' if who else ''
        caps.append(f'<div class="cap" id="k-{l["id"]}"><span>{tag}{html.escape(l["text"].replace('艾特', ' @ ').replace('斜杠 stop', ' /stop').replace('gg 命令行', 'gg 命令行'))}</span></div>')
        cap_js.append([l['id'], l['start'], round(l['start'] + l['dur'], 2)])
        auds.append(f'<audio id="a-{l["id"]}" src="audio/{l["id"]}.mp3" data-start="{l["start"]}" data-duration="{round(l["dur"], 3)}" data-track-index="12"></audio>')

body_chs = [c for c in chs if c['id'].startswith('c')]
hud_js = [[c['start'], i] for i, c in enumerate(body_chs)]
dots = ''.join(f'<i id="hd{i}"></i>' for i in range(8))

page = f'''<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/shared.css" />
    <script src="assets/shared.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #eef1f6; }}
      #root {{ width: 100%; height: 100%; position: relative; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; color: #1d1d1f; background: #eef1f6; }}
      #bg {{ position: absolute; inset: 0; background: linear-gradient(160deg, #f4f6fb 0%, #e8edf7 55%, #e6f1f1 100%); }}
      #bg .grid {{ position: absolute; inset: 0; opacity: 0.5; background-image: radial-gradient(#c7cede 1.2px, transparent 1.2px); background-size: 36px 36px; }}
      #bg .blob {{ position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.55; }}
      #hud {{ position: absolute; left: 56px; top: 40px; display: flex; align-items: center; gap: 14px; font-size: 20px; font-weight: 800; color: #3b4152; }}
      #hud img {{ width: 40px; height: 40px; }}
      #hud .dots {{ display: flex; gap: 10px; margin-left: 6px; }}
      #hud .dots i {{ width: 16px; height: 16px; border-radius: 50%; background: #d3d9e6; }}
      #hud #hudName {{ color: #0a7cff; min-width: 180px; }}
      #caps .cap {{ position: absolute; left: 0; right: 0; top: 972px; display: flex; justify-content: center; opacity: 0; }}
      #caps .cap span {{ max-width: 1560px; font-size: 31px; font-weight: 600; color: #fff; background: rgba(18, 22, 34, 0.8); padding: 10px 26px; border-radius: 14px; line-height: 1.4; text-align: center; }}
      #caps .cap b {{ margin-right: 8px; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
      <div id="bg" class="clip" data-start="0" data-duration="{total}" data-track-index="0">
        <div class="grid"></div>
        <div class="blob" style="width: 900px; height: 900px; left: -200px; top: -300px; background: #c9d8ff"></div>
        <div class="blob" style="width: 800px; height: 800px; right: -220px; bottom: -320px; background: #c4ece8"></div>
      </div>
      <div id="hud" class="clip" data-start="{body_chs[0]['start']}" data-duration="{round(chs[-1]['start'] - body_chs[0]['start'], 2)}" data-track-index="1">
        <img src="assets/logo.svg" alt="" /><span>入职通关</span><span id="hudName">{MAP[0]}</span><div class="dots">{dots}</div>
      </div>
      {chr(10).join('      ' + h for h in hosts).strip()}
      <div id="caps" class="clip" data-start="0" data-duration="{total}" data-track-index="6">
        {chr(10).join('        ' + c for c in caps).strip()}
      </div>
      <audio id="music" src="audio/music.wav" data-start="0" data-duration="{total}" data-track-index="10" data-volume="0.55"></audio>
      <audio id="sfx" src="audio/sfx.wav" data-start="0" data-duration="{total}" data-track-index="11" data-volume="0.5"></audio>
      {chr(10).join('      ' + a for a in auds).strip()}
    </div>
    <script>
      const MAP = {json.dumps(MAP, ensure_ascii=False)}
      const HUD = {json.dumps(hud_js)}
      const CAPS = {json.dumps(cap_js)}
      const tl = gsap.timeline({{ paused: true }})
      HUD.forEach(([t, i]) => {{
        tl.set('#hudName', {{ textContent: MAP[i] }}, t)
        if (i > 0) tl.set(`#hd${{i - 1}}`, {{ backgroundColor: '#34c759' }}, t)
        tl.fromTo(`#hd${{i}}`, {{ backgroundColor: '#d3d9e6', scale: 1 }}, {{ backgroundColor: '#0a7cff', scale: 1.35, duration: 0.3, immediateRender: false }}, t + 1.9)
      }})
      CAPS.forEach(([id, a, b]) => {{
        tl.fromTo(`#k-${{id}}`, {{ opacity: 0, y: 10 }}, {{ opacity: 1, y: 0, duration: 0.2 }}, a)
        tl.to(`#k-${{id}}`, {{ opacity: 0, duration: 0.2 }}, b)
      }})
      window.__timelines['main'] = tl
    </script>
  </body>
</html>
'''
(root / 'index.html').write_text(page)
print('index.html written', total)
