/** Test helpers: a scripted fetch and tiny PNG bytes. */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

export interface Call { url: string; init: RequestInit | undefined }

/** Fetch that answers each call from `handler` and records it. */
export function scriptedFetch(handler: (url: string, init: RequestInit | undefined, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return handler(url, init, calls.length - 1)
  }
  return { fetch: fn, calls }
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

export function png(): Response {
  return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
}

export function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>
}

export function headersOf(call: Call | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(call?.init?.headers).entries())
}
