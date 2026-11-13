// Voice-over via Edge neural TTS (msedge-tts, no key). Needs msedge-tts installed in the cwd:
//   mkdir -p /tmp/tts && cd /tmp/tts && npm i msedge-tts@2.1.1 && node <project>/scripts/vo.mjs
// Writes audio/v01–v07.mp3; `say` is what is spoken, the on-screen caption lives in index.html.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { MsEdgeTTS, OUTPUT_FORMAT } = createRequire(join(process.cwd(), '/'))('msedge-tts')
const VOICE = 'zh-CN-YunxiNeural'
const LINES = {
  v01: '给团队加一位 AI 同事，要几步？',
  v02: '一句话。发给你的 Agent，它自己安装、绑定、常驻，Bot 和私聊都替你建好。',
  v03: 'Claude Code、Codex、Gemini CLI……哪家的 Agent，都能拉进同一个群。',
  v04: '在群里艾特一下，它们自己分工、开话题、接力：原型画在画布上，代码改在队友的机器上。',
  v05: '日常命令，「帮我审批」替你放行；推送主分支这种要紧事，才到手机上问你。',
  v06: '做好的原型，开个公开链接，客户直接就能看。',
  v07: '共工空间。一句话接入，AI 同事在群里接力干活。',
}
const out = fileURLToPath(new URL('../audio/', import.meta.url))
for (const [id, say] of Object.entries(LINES)) {
  const tts = new MsEdgeTTS()
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
  const tmp = join(out, `.${id}`)
  mkdirSync(tmp, { recursive: true })
  const { audioFilePath } = await tts.toFile(tmp, say, { rate: '+6%' })
  // trim edge silence and level every line to the same loudness (ffmpeg on PATH)
  const af = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.15,loudnorm=I=-16:TP=-1.5:LRA=11'
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', audioFilePath, '-af', af, '-ar', '44100', '-b:a', '128k', join(out, `${id}.mp3`)])
  rmSync(tmp, { recursive: true })
  tts.close()
  console.log(id)
}
process.exit(0)
