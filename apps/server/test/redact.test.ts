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
    ['password assignment', 'mysql -u root password=s3cr3t! --host db', `mysql -u root password=${MASK} --host db`],
    ['token assignment', 'GITHUB_TOKEN=abc123 npm publish', `GITHUB_TOKEN=${MASK} npm publish`],
    ['quoted secret assignment', 'client_secret="a b"', `client_secret="${MASK}"`],
    ['JSON secret', '{"api_key": "zzz-111", "name": "x"}', `{"api_key": "${MASK}", "name": "x"}`],
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
    const plain = 'git push origin main; tokens used 1500; see docs/token.md and sk-short'
    expect(redact(plain)).toBe(plain)
    const once = redact('password=abc ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(redact(once)).toBe(once)
  })

  it('ignores blank known values', () => {
    expect(redactor(['', ' '])('a b')).toBe('a b')
  })
})
