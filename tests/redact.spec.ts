import { describe, expect, it } from 'vitest'
import { providerErrorDetail, redactSecrets } from '../src/redact.js'

describe('redactSecrets', () => {
  it('removes the exact live API key wherever it appears', () => {
    const key = 'ZDM4YTYzOGYtYjM3Ny00YTNkLWJhZmItMGYwNTc0'
    const text = `relay error: invalid key ZDM4YTYzOGYtYjM3Ny00YTNkLWJhZmItMGYwNTc0 provided`
    expect(redactSecrets(text, key)).not.toContain(key)
    expect(redactSecrets(text, key)).toContain('[REDACTED]')
  })

  it('redacts sk- style keys even when the exact value is unknown', () => {
    const text = 'upstream said: sk-proj-abcdefgh1234567890 is not valid'
    expect(redactSecrets(text)).toBe('upstream said: [REDACTED] is not valid')
  })

  it('redacts Google-style keys', () => {
    // Assembled from fragments so secret scanners do not flag the fixture itself.
    const fakeGoogleKey = ['AIza', 'Sy', 'SampleKey1234', 'UsedOnlyInTests'].join('')
    const text = `request failed for key ${fakeGoogleKey}`
    expect(redactSecrets(text)).not.toContain('AIza')
  })

  it('redacts Bearer authorization values echoed in error bodies', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 expired'
    expect(redactSecrets(text)).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  })

  it('redacts echoed key/value pairs', () => {
    for (const text of [
      '{"error":"invalid api_key: abcdef1234567890"}',
      'config: api-key=abcdef1234567890 rejected',
      'invalid token "abcdef1234567890"',
    ]) {
      expect(redactSecrets(text)).not.toContain('abcdef1234567890')
    }
  })

  it('leaves ordinary error text untouched', () => {
    const text = 'Request failed with status 429: rate limit exceeded, retry after 30s'
    expect(redactSecrets(text)).toBe(text)
  })

  it('ignores secrets too short to be distinguishable', () => {
    expect(redactSecrets('the key abc was rejected', 'abc')).toBe('the key abc was rejected')
  })
})

describe('providerErrorDetail', () => {
  it('reduces JSON error bodies to message and code', () => {
    const openai = JSON.stringify({ error: { message: 'Your request was rejected by the safety system.', type: 'image_generation_user_error', param: null, code: 'moderation_blocked', moderation_details: { categories: ['sexual'] } } }, null, 2)
    expect(providerErrorDetail(openai)).toBe('Your request was rejected by the safety system. (moderation_blocked)')
    expect(providerErrorDetail(JSON.stringify({ code: 'InvalidParameter', message: 'size is invalid' }))).toBe('size is invalid (InvalidParameter)')
    expect(providerErrorDetail(JSON.stringify({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }))).toBe('API key not valid (INVALID_ARGUMENT)')
    expect(providerErrorDetail(JSON.stringify({ errors: [{ message: 'quota exceeded' }] }))).toBe('quota exceeded')
    expect(providerErrorDetail(JSON.stringify({ error: 'bad gateway' }))).toBe('bad gateway')
  })

  it('collapses and bounds plain text and still redacts secrets', () => {
    expect(providerErrorDetail('<html>\n  <body>502</body>\n</html>')).toBe('<html> <body>502</body> </html>')
    expect(providerErrorDetail('x'.repeat(2000))).toHaveLength(601)
    expect(providerErrorDetail(JSON.stringify({ error: { message: 'bad key sk-abcdefghijklmnop' } }), 'zzzzzzzzzz')).toBe('bad key [REDACTED]')
  })
})
