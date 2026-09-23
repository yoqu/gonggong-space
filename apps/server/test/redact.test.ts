import { describe, expect, it } from 'vitest'
import { MASK, redactor } from '../src/modules/runs/redact.js'

const redact = redactor(['hunter2-prod', 'db-pass-9'])

describe('redaction', () => {
  it.each([
    ['GitHub classic', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 end', `token ${MASK} end`],
    ['GitHub OAuth', 'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', MASK],
    ['GitHub server', 'x=ghs_0123456789abcdefghijklmnopqrstuvwxyzAB;', `x=${MASK};`],
    ['GitHub fine-grained', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', MASK],
    ['OpenAI', 'OPENAI sk-proj-abcdefghijklmnopqrstuvwxyz012345', `OPENAI ${MASK}`],
    ['Anthropic', 'key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz-0123456789', `key: ${MASK}`],
    ['AWS access key id', 'aws AKIAIOSFODNN7EXAMPLE ok', `aws ${MASK} ok`],
    ['Slack', 'xoxb-1234567890-abcdefghijkl', MASK],
    [
      'JWT',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      `Bearer ${MASK}`,
    ],
    [
      'password assignment',
      'mysql -u root password=s3cr3t! --host db',
      `mysql -u root password=${MASK} --host db`,
    ],
    ['token assignment', 'GITHUB_TOKEN=abc123 npm publish', `GITHUB_TOKEN=${MASK} npm publish`],
    ['quoted secret assignment', 'client_secret="a b"', `client_secret="${MASK}"`],
    ['JSON secret', '{"api_key": "zzz-111", "name": "x"}', `{"api_key": "${MASK}", "name": "x"}`],
    [
      'Bearer token',
      'curl -H "Authorization: Bearer abcDEF0123456789xyz"',
      `curl -H "Authorization: Bearer ${MASK}"`,
    ],
    [
      'Basic auth header',
      "-H 'authorization: Basic dXNlcjpwYXNzd29yZA=='",
      `-H 'authorization: Basic ${MASK}'`,
    ],
    ['token auth header', 'Authorization: token 0123456789abcdef', `Authorization: token ${MASK}`],
    ['API key header', 'X-Api-Key: live-7f3a9c', `X-Api-Key: ${MASK}`],
    ['Google API key', 'key=AIzaSyA1234567890abcdefghijklmnopqrstuv&q=1', `key=${MASK}&q=1`],
    ['Stripe live key', 'stripe sk_live_51H8abcdefghijklmnopqrstu', `stripe ${MASK}`],
    ['Stripe restricted key', 'rk_test_51H8abcdefghijklmnopqrstu', MASK],
    ['GitLab token', 'glpat-abcdefghij0123456789', MASK],
    ['npm token', 'npm_abcdefghijklmnopqrstuvwxyz0123456789', MASK],
    [
      'long hex after a keyword',
      'deploy key: 3f9a0c1e2d4b5a69788796a5b4c3d2e1f0a9b8c7',
      `deploy key: ${MASK}`,
    ],
    ['known values', 'connect hunter2-prod then db-pass-9', `connect ${MASK} then ${MASK}`],
  ])('masks %s', (_name, input, output) => {
    expect(redact(input)).toBe(output)
  })

  it('masks whole private key blocks', () => {
    const key = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n')
    expect(redact(`before\n${key}\nafter`)).toBe(`before\n${MASK}\nafter`)
  })

  it('leaves ordinary text alone and is idempotent', () => {
    const plain =
      'git push origin main; tokens used 1500; see docs/token.md and sk-short; commit 3f9a0c1e2d4b5a69788796a5b4c3d2e1f0a9b8c7'
    expect(redact(plain)).toBe(plain)
    const once = redact(
      'password=abc ghp_abcdefghijklmnopqrstuvwxyz0123456789 Authorization: Bearer abcDEF0123456789xyz X-Api-Key: k',
    )
    expect(redact(once)).toBe(once)
  })

  it('ignores blank known values', () => {
    expect(redactor(['', ' '])('a b')).toBe('a b')
  })
})
