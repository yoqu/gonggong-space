#!/usr/bin/env node
// Regenerates crates/gonggong/presets/providers.json from a CC Switch checkout (MIT, see THIRD_PARTY_NOTICES.md).
// Usage: node scripts/sync-provider-presets.mjs <path-to-cc-switch>
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'crates/gonggong/presets/providers.json')

// Keyed by the CC Switch preset name: [stable id, display name, group]. Order = display order.
const WHITELIST = {
  claude: {
    Kimi: ['kimi', 'Kimi', 'cn'],
    'Kimi Global': ['kimi-global', 'Kimi（国际版）', 'cn'],
    'Kimi For Coding': ['kimi-coding', 'Kimi For Coding', 'cn'],
    'Kimi For Coding Global': ['kimi-coding-global', 'Kimi For Coding（国际版）', 'cn'],
    DeepSeek: ['deepseek', 'DeepSeek', 'cn'],
    'Zhipu GLM': ['zhipu', '智谱 GLM', 'cn'],
    'Zhipu GLM en': ['zhipu-en', '智谱 GLM（国际版）', 'cn'],
    千问AI平台: ['qwen', '通义千问', 'cn'],
    '千问AI平台 Coding Plan': ['qwen-coding', '通义千问 Coding Plan', 'cn'],
    QwenCloud: ['qwen-intl', '通义千问（国际版）', 'cn'],
    'QwenCloud For Coding': ['qwen-coding-intl', '通义千问 Coding Plan（国际版）', 'cn'],
    '火山 Coding Plan': ['volcengine-coding', '火山方舟 Coding Plan', 'cn'],
    '火山 Agent Plan': ['volcengine-agent', '火山方舟 Agent Plan', 'cn'],
    'Volcengine Doubao': ['volcengine', '火山方舟（豆包）', 'cn'],
    BytePlus: ['byteplus', 'BytePlus（火山方舟国际版）', 'cn'],
    MiniMax: ['minimax', 'MiniMax', 'cn'],
    'MiniMax en': ['minimax-en', 'MiniMax（国际版）', 'cn'],
    StepFun: ['stepfun', '阶跃星辰 Step Plan', 'cn'],
    'StepFun en': ['stepfun-en', '阶跃星辰 Step Plan（国际版）', 'cn'],
    'Baidu Qianfan Coding Plan': ['qianfan-coding', '百度千帆 Coding Plan', 'cn'],
    'Tencent Token Plan': ['tencent-token-plan', '腾讯云 Token Plan', 'cn'],
    'Xiaomi MiMo': ['mimo', '小米 MiMo', 'cn'],
    Longcat: ['longcat', '美团 LongCat', 'cn'],
    BaiLing: ['bailing', '蚂蚁百灵', 'cn'],
    OpenRouter: ['openrouter', 'OpenRouter', 'aggregator'],
    SiliconFlow: ['siliconflow', '硅基流动', 'aggregator'],
    'SiliconFlow en': ['siliconflow-en', '硅基流动（国际版）', 'aggregator'],
    ModelScope: ['modelscope', '魔搭 ModelScope', 'aggregator'],
    AiHubMix: ['aihubmix', 'AiHubMix', 'aggregator'],
    PPIO: ['ppio', 'PPIO', 'aggregator'],
    'Novita AI': ['novita', 'Novita AI', 'aggregator'],
  },
  codex: {
    Kimi: ['kimi', 'Kimi', 'cn'],
    'Kimi Global': ['kimi-global', 'Kimi（国际版）', 'cn'],
    'Kimi For Coding': ['kimi-coding', 'Kimi For Coding', 'cn'],
    'Kimi For Coding Global': ['kimi-coding-global', 'Kimi For Coding（国际版）', 'cn'],
    DeepSeek: ['deepseek', 'DeepSeek', 'cn'],
    'Zhipu GLM': ['zhipu', '智谱 GLM', 'cn'],
    'Zhipu GLM en': ['zhipu-en', '智谱 GLM（国际版）', 'cn'],
    千问AI平台: ['qwen', '通义千问', 'cn'],
    QwenCloud: ['qwen-intl', '通义千问（国际版）', 'cn'],
    '火山 Coding Plan': ['volcengine-coding', '火山方舟 Coding Plan', 'cn'],
    '火山 Agent Plan': ['volcengine-agent', '火山方舟 Agent Plan', 'cn'],
    'Volcengine Doubao': ['volcengine', '火山方舟（豆包）', 'cn'],
    BytePlus: ['byteplus', 'BytePlus（火山方舟国际版）', 'cn'],
    MiniMax: ['minimax', 'MiniMax', 'cn'],
    'MiniMax en': ['minimax-en', 'MiniMax（国际版）', 'cn'],
    'StepFun API': ['stepfun-api', '阶跃星辰 API', 'cn'],
    'StepFun API en': ['stepfun-api-en', '阶跃星辰 API（国际版）', 'cn'],
    'Baidu Qianfan': ['qianfan', '百度千帆', 'cn'],
    'Tencent Hunyuan': ['hunyuan', '腾讯混元', 'cn'],
    'Xiaomi MiMo': ['mimo', '小米 MiMo', 'cn'],
    Longcat: ['longcat', '美团 LongCat', 'cn'],
    'Astron Coding Plan': ['astron-coding', '讯飞星辰 Coding Plan', 'cn'],
    OpenRouter: ['openrouter', 'OpenRouter', 'aggregator'],
    AiHubMix: ['aihubmix', 'AiHubMix', 'aggregator'],
    'xAI (Grok)': ['xai', 'xAI Grok', 'global'],
  },
}

// Claude env keys copied besides the connection keys (§4.2.1).
const EXTRA_ENV = [
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'ENABLE_TOOL_SEARCH',
  'ANTHROPIC_SMALL_FAST_MODEL',
]

// Referral / tracking query parameters: we do not promote on third parties' behalf.
const TRACKING = new Set([
  'aff',
  'ref',
  'ic',
  'invitecode',
  'ac',
  'rc',
  'ytag',
  'ch',
  'from',
  'source',
  'code',
])

// Invite codes carried in the path (`/i/<code>`, `/activity/ccswitch`) have no clean equivalent: drop the link.
const REFERRAL_PATH = /\/i\/\w+$|cc-?switch/i

function cleanUrl(raw) {
  if (!raw) return undefined
  const url = new URL(raw)
  if (REFERRAL_PATH.test(url.pathname)) return undefined
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.has(key.toLowerCase()) || key.startsWith('utm_')) url.searchParams.delete(key)
  }
  return url.toString()
}

function loadEsbuild() {
  const pnpm = join(root, 'node_modules/.pnpm')
  const versions = readdirSync(pnpm)
    .map((d) => /^esbuild@(\d+)\.(\d+)\.(\d+)$/.exec(d))
    .filter(Boolean)
    .sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3])
  if (!versions.length) throw new Error('esbuild not found under node_modules/.pnpm; run pnpm install')
  return createRequire(import.meta.url)(join(pnpm, versions[0][0], 'node_modules/esbuild'))
}

async function loadPresets(ccSwitch) {
  const result = loadEsbuild().buildSync({
    stdin: {
      contents:
        "export { providerPresets } from './src/config/claudeProviderPresets'\n" +
        "export { codexProviderPresets } from './src/config/codexProviderPresets'\n",
      resolveDir: ccSwitch,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'error',
  })
  const code = Buffer.from(result.outputFiles[0].text).toString('base64')
  return import(`data:text/javascript;base64,${code}`)
}

// Just enough TOML for CC Switch's generated Codex configs: top-level keys and [a.b] tables of scalars.
function parseToml(text) {
  const doc = {}
  let table = doc
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      table = header[1].split('.').reduce((t, k) => (t[k] ??= {}), doc)
      continue
    }
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line)
    if (!kv) throw new Error(`unsupported TOML line: ${line}`)
    table[kv[1]] = JSON.parse(kv[2])
  }
  return doc
}

const unique = (xs) => [...new Set(xs.filter(Boolean))]

function claudePreset(p, [id, name, group]) {
  if (!['anthropic', undefined].includes(p.apiFormat)) return null
  const env = p.settingsConfig.env ?? {}
  const baseUrl = env.ANTHROPIC_BASE_URL
  if (!baseUrl) return null
  const models = {
    haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  }
  const extra = Object.fromEntries(EXTRA_ENV.filter((k) => env[k]).map((k) => [k, env[k]]))
  return {
    id,
    agent: 'claude',
    name,
    group,
    websiteUrl: cleanUrl(p.websiteUrl),
    apiKeyUrl: cleanUrl(p.apiKeyUrl),
    baseUrl,
    apiKeyField: p.apiKeyField ?? 'ANTHROPIC_AUTH_TOKEN',
    model: env.ANTHROPIC_MODEL,
    models: Object.values(models).some(Boolean) ? models : undefined,
    modelOptions: unique([env.ANTHROPIC_MODEL, models.sonnet, models.opus, models.haiku]),
    env: Object.keys(extra).length ? extra : undefined,
  }
}

function codexPreset(p, [id, name, group]) {
  if (p.apiFormat === 'openai_chat') return null
  const config = parseToml(p.config)
  const provider = config.model_providers?.[config.model_provider] ?? {}
  const baseUrl = provider.base_url ?? config.base_url
  if (!baseUrl || (provider.wire_api ?? 'responses') !== 'responses') return null
  return {
    id,
    agent: 'codex',
    name,
    group,
    websiteUrl: cleanUrl(p.websiteUrl),
    apiKeyUrl: cleanUrl(p.apiKeyUrl),
    baseUrl,
    wireApi: 'responses',
    model: config.model,
    modelOptions: unique([config.model, ...(p.modelCatalog ?? []).map((m) => m.model)]),
    effort: config.model_reasoning_effort,
  }
}

const excluded = (p) =>
  p.category === 'official' || p.isOfficial || p.requiresOAuth || p.providerType || p.templateValues

async function main() {
  const ccSwitch = process.argv[2]
  if (!ccSwitch) throw new Error('usage: node scripts/sync-provider-presets.mjs <path-to-cc-switch>')
  const commit = execFileSync('git', ['-C', ccSwitch, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const { providerPresets, codexProviderPresets } = await loadPresets(resolve(ccSwitch))
  const sources = { claude: [providerPresets, claudePreset], codex: [codexProviderPresets, codexPreset] }
  const presets = []
  for (const [agent, [list, map]] of Object.entries(sources)) {
    for (const [ccName, entry] of Object.entries(WHITELIST[agent])) {
      const preset = list.find((p) => p.name === ccName)
      const mapped = preset && !excluded(preset) ? map(preset, entry) : null
      if (!mapped)
        throw new Error(`${agent} preset "${ccName}" is missing or no longer usable; update WHITELIST`)
      presets.push(mapped)
    }
  }
  writeFileSync(out, `${JSON.stringify({ source: `cc-switch@${commit}`, presets }, null, 2)}\n`)
  // Match the repo formatter so re-running the script yields a reviewable diff only.
  execFileSync(join(root, 'node_modules/.bin/biome'), ['format', '--write', out], { stdio: 'ignore' })
  console.log(`wrote ${presets.length} presets to ${out}`)
}

await main()
