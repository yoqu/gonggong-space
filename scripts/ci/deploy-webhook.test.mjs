import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const helper = readFileSync(new URL('./deploy-webhook.groovy', import.meta.url), 'utf8')
const script = helper.split("'''")[1].replaceAll('\\\\', '\\')

function notifications(t, body = '') {
  const workspace = mkdtempSync(join(tmpdir(), 'deploy-notify-test-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  const bin = join(workspace, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env bash
cat >/dev/null
while (($#)); do
  case "$1" in
    --data-binary) cp -- "${'$'}{2#@}" "$GG_TEST_PAYLOAD"; shift ;;
    --output) printf '%s' '{"messageId":"fixture","runId":"fixture-run"}' > "$2"; shift ;;
  esac
  shift
done
`,
    { mode: 0o700 },
  )
  mkdirSync(join(workspace, 'source'))
  const git = (...args) =>
    execFileSync('git', ['-C', join(workspace, 'source'), ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  const commit = (subject, message = '') => {
    execFileSync(
      'git',
      [
        '-C',
        join(workspace, 'source'),
        '-c',
        'user.name=CI Test',
        '-c',
        'user.email=ci@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-q',
        '--allow-empty',
        '-F',
        '-',
      ],
      { input: `${subject}\n\n${message}\n` },
    )
    return git('rev-parse', 'HEAD')
  }
  const base = commit('Already deployed')
  commit('Recovered after failed build')
  const head = commit('Current deployment', body)
  const payload = join(workspace, 'payload.json')
  return {
    head,
    archived: () => readFileSync(join(workspace, '.gg-deploy-notification/42/git-log.txt'), 'utf8'),
    invoke(overrides = {}) {
      execFileSync('bash', ['-c', script], {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GG_TEST_PAYLOAD: payload,
          GG_HOOK_TOKEN: 'test-only',
          GG_HOOK_ENDPOINT: 'https://gg.example.com/api/hooks',
          GG_DEPLOY_RESULT: 'SUCCESS',
          GG_DEPLOY_STARTED_MS: '1',
          GG_DEPLOY_BASE: base,
          GG_DEPLOY_HEAD: head,
          BUILD_URL: 'https://ci.example.com/job/deploy/42/',
          BUILD_NUMBER: '42',
          JOB_NAME: 'deploy',
          ...overrides,
        },
      })
      return JSON.parse(readFileSync(payload, 'utf8'))
    },
  }
}

test('lists the whole deployed range in the card, including commits after a failed build', (t) => {
  const data = notifications(t).invoke()
  assert.equal(data.card.tone, 'success')
  assert.equal(data.mention, false)
  assert.match(data.text, /Current deployment/)
  assert.match(data.text, /Recovered after failed build/)
  assert.doesNotMatch(data.text, /Already deployed/)
  assert.equal(data.attachment, undefined)
})

test('attaches the complete log when the card would be too long', (t) => {
  const body = 'Deployment details '.repeat(800)
  const data = notifications(t, body).invoke()
  assert.equal(data.attachment.name, 'git-log.txt')
  assert.ok(data.attachment.content.includes(body.trim()))
  assert.match(data.attachment.content, /Recovered after failed build/)
  assert.ok(!data.text.includes(body))
})

test('does not substitute a misleading history if the deployment baseline is missing', (t) => {
  const fixture = notifications(t)
  const data = fixture.invoke({ GG_DEPLOY_BASE: '' })
  assert.match(data.text, /上次成功部署/)
  assert.doesNotMatch(data.text, /Already deployed/)
})

test('keeps the full Jenkins artifact above the webhook attachment limit', (t) => {
  const body = 'Release details. '.repeat(17000)
  const fixture = notifications(t, body)
  const data = fixture.invoke()
  assert.match(data.text, /Jenkins 构建归档/)
  assert.equal(data.attachment, undefined)
  assert.ok(fixture.archived().includes(body.trim()))
})
