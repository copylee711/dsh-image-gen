/** Small helpers shared by the plugin's same-origin JSON routes. */
import type { IncomingMessage, ServerResponse } from 'node:http'

export class RouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Reject cross-origin browser requests; same-origin and non-browser callers pass. */
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  const host = req.headers.host
  if (origin !== undefined && host !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) {
    throw new RouteError(403, 'origin-rejected')
  }
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new RouteError(415, 'json-required')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new RouteError(413, 'body-too-large')
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RouteError(400, 'invalid-json')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RouteError(400, 'invalid-request')
  return value as Record<string, unknown>
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(body)
}

/**
 * Wrap a JSON handler: method gate, origin check, error mapping. Handler
 * errors become `{ error }` with their status (RouteError) or 500.
 */
export function jsonRoute(
  methods: readonly string[],
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method ?? 'GET')) throw new RouteError(405, 'method-not-allowed')
      assertSameOrigin(req)
      const value = await handler(req, res)
      if (!res.writableEnded) sendJson(res, 200, value ?? { ok: true })
    } catch (error) {
      const status = error instanceof RouteError ? error.status : 500
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** Abort signal that fires when the browser disconnects before the answer. */
export function requestSignal(req: IncomingMessage, res: ServerResponse): AbortSignal {
  const controller = new AbortController()
  const abort = (): void => {
    if (!res.writableEnded) controller.abort(new Error('client disconnected'))
  }
  req.once('aborted', abort)
  res.once('close', abort)
  return controller.signal
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
