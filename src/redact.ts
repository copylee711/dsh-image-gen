/**
 * Redact secret-shaped content from provider error messages.
 *
 * Error bodies from providers and relays surface in the conversation and in
 * the settings UI. A relay may echo request headers — including the API key —
 * inside its error body, so every adapter passes response text through here
 * before embedding it in a thrown error, and also passes the live key so its
 * exact value cannot survive even in non-standard formats.
 */
const REDACTED = '[REDACTED]'

const KEY_SHAPED_PATTERNS: readonly RegExp[] = [
  // OpenAI / DashScope style keys, e.g. sk-abc123...
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  // Google API keys, e.g. AIzaSy...
  /\bAIza[A-Za-z0-9_-]{10,}/g,
  // Authorization header values echoed by relays.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // echoed key/value pairs, e.g. "api_key": "..." or token=...
  /\b(?:api[_-]?key|apikey|token|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi,
  // secret keywords followed directly by a quoted value, e.g. invalid token "..."
  /\b(?:api[_-]?key|apikey|token|secret)\s*["'][A-Za-z0-9._~+/=-]{8,}["']/gi,
]

/** Replace every occurrence of a known secret plus key-shaped values. */
export function redactSecrets(text: string, ...secrets: Array<string | undefined>): string {
  let redacted = text
  for (const secret of secrets) {
    // Very short values would mangle ordinary words if substituted blindly.
    if (secret !== undefined && secret.length >= 8) redacted = redacted.split(secret).join(REDACTED)
  }
  for (const pattern of KEY_SHAPED_PATTERNS) redacted = redacted.replace(pattern, REDACTED)
  return redacted
}

const DETAIL_LIMIT = 600

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** `message (code)` from the common provider error shapes, or undefined. */
function jsonErrorSummary(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const body = value as Record<string, unknown>
  const nested = typeof body.error === 'object' && body.error !== null ? body.error as Record<string, unknown> : undefined
  const first = Array.isArray(body.errors) && typeof body.errors[0] === 'object' && body.errors[0] !== null ? body.errors[0] as Record<string, unknown> : undefined
  const source = nested ?? first ?? body
  const message = textOf(source.message) ?? textOf(body.error) ?? textOf(body.message) ?? textOf(body.msg) ?? textOf(body.detail)
  if (message === undefined) return undefined
  const code = textOf(source.code) ?? textOf(source.status) ?? textOf(source.type) ?? textOf(body.code)
  return code === undefined || message.includes(code) ? message : `${message} (${code})`
}

/**
 * Readable, redacted detail for a failed provider response: the message (and
 * code) of a JSON error body, otherwise the text with whitespace collapsed.
 * Kept short: it is shown to the user and fed back to the model.
 */
export function providerErrorDetail(text: string, ...secrets: Array<string | undefined>): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const detail = jsonErrorSummary(parsed) ?? text.replace(/\s+/g, ' ').trim()
  const redacted = redactSecrets(detail, ...secrets)
  return redacted.length > DETAIL_LIMIT ? `${redacted.slice(0, DETAIL_LIMIT)}…` : redacted
}
