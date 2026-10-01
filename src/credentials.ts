/**
 * Per-provider API keys.
 *
 * Keys live in DSH's credential store as records `dsh-image-gen/<providerId>`
 * (any number of user-added providers, no schema declaration needed). Hosts
 * without the record API fall back to a 0600 `keys.json` beside the settings.
 * Keys are only ever read on the Host; the browser sees configured/not.
 */
import { join } from 'node:path'
import { credentialKey, isCredentialKeySegment, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { PLUGIN_NAME } from './shared.js'
import { Mutex, readJson, writeJson } from './storage.js'

export interface KeyStore {
  get(providerId: string): Promise<string | undefined>
  set(providerId: string, value: string): Promise<void>
  unset(providerId: string): Promise<void>
}

/** The subset of the DSH credentials service this plugin uses. */
export interface CredentialRecordsService {
  readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>
  modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>): Promise<CredentialRecord | undefined>
  deleteRecord(key: CredentialKey): Promise<void>
}

export function hasRecordApi(value: unknown): value is CredentialRecordsService {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CredentialRecordsService>
  return typeof candidate.readRecord === 'function' && typeof candidate.modifyRecord === 'function' && typeof candidate.deleteRecord === 'function'
}

function recordKey(providerId: string): CredentialKey {
  if (!isCredentialKeySegment(providerId)) throw new Error(`Provider id "${providerId}" cannot address a credential`)
  return credentialKey(PLUGIN_NAME, providerId)
}

/** Keys in the DSH credential store. */
export function credentialKeyStore(service: CredentialRecordsService): KeyStore {
  return {
    async get(providerId) {
      const record = await service.readRecord(recordKey(providerId))
      const key = record?.kind === 'api-key' ? record.key?.trim() : undefined
      return key === undefined || key.length === 0 ? undefined : key
    },
    async set(providerId, value) {
      const key = value.trim()
      if (key.length === 0) throw new Error('API key is empty')
      await service.modifyRecord(recordKey(providerId), async () => ({ kind: 'api-key', key }))
    },
    async unset(providerId) {
      await service.deleteRecord(recordKey(providerId))
    },
  }
}

/** Fallback: keys in a private file next to the settings. */
export function fileKeyStore(dir: string): KeyStore {
  const path = join(dir, 'keys.json')
  const mutex = new Mutex()
  const load = async (): Promise<Record<string, string>> => {
    const raw = await readJson(path)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
  }
  return {
    async get(providerId) {
      const value = (await load())[providerId]?.trim()
      return value === undefined || value.length === 0 ? undefined : value
    },
    set(providerId, value) {
      return mutex.run(async () => {
        const key = value.trim()
        if (key.length === 0) throw new Error('API key is empty')
        await writeJson(path, { ...(await load()), [providerId]: key }, 0o600)
      })
    },
    unset(providerId) {
      return mutex.run(async () => {
        const all = await load()
        delete all[providerId]
        await writeJson(path, all, 0o600)
      })
    },
  }
}

/**
 * Prefer the DSH credential store; fall back to the file store when a read or
 * write through it fails (older hosts reject unknown record scopes).
 */
export function layeredKeyStore(primary: KeyStore | undefined, fallback: KeyStore): KeyStore {
  if (primary === undefined) return fallback
  return {
    async get(providerId) {
      try {
        const value = await primary.get(providerId)
        if (value !== undefined) return value
      } catch {
        // fall through to the file store
      }
      return fallback.get(providerId)
    },
    async set(providerId, value) {
      try {
        await primary.set(providerId, value)
        await fallback.unset(providerId).catch(() => {})
      } catch {
        await fallback.set(providerId, value)
      }
    },
    async unset(providerId) {
      await primary.unset(providerId).catch(() => {})
      await fallback.unset(providerId)
    },
  }
}
