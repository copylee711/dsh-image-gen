import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { credentialKeyStore, fileKeyStore, hasRecordApi, layeredKeyStore, type CredentialRecordsService } from '../src/credentials.js'

let dir: string | undefined
afterEach(async () => { if (dir !== undefined) await rm(dir, { recursive: true, force: true }) })

function memoryRecords(fail = false): CredentialRecordsService & { records: Map<string, unknown> } {
  const records = new Map<string, unknown>()
  return {
    records,
    async readRecord(key) { if (fail) throw new Error('no'); return records.get(String(key)) as never },
    async modifyRecord(key, mutate) { if (fail) throw new Error('no'); const next = await mutate(records.get(String(key)) as never); if (next !== undefined) records.set(String(key), next); return next },
    async deleteRecord(key) { records.delete(String(key)) },
  }
}

describe('key stores', () => {
  it('stores keys as copylee-image-gen/<provider> credential records', async () => {
    const service = memoryRecords()
    expect(hasRecordApi(service)).toBe(true)
    const store = credentialKeyStore(service)
    await store.set('custom-1', '  sk-abc  ')
    expect(service.records.get('copylee-image-gen/custom-1')).toEqual({ kind: 'api-key', key: 'sk-abc' })
    expect(await store.get('custom-1')).toBe('sk-abc')
    await store.unset('custom-1')
    expect(await store.get('custom-1')).toBeUndefined()
    await expect(store.set('x', ' ')).rejects.toThrow()
  })
  it('falls back to a private file when the credential store refuses', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dig-keys-'))
    const store = layeredKeyStore(credentialKeyStore(memoryRecords(true)), fileKeyStore(dir))
    await store.set('modelscope', 'ms-1')
    expect(await store.get('modelscope')).toBe('ms-1')
    if (process.platform !== 'win32') expect((await stat(join(dir, 'keys.json'))).mode & 0o777).toBe(0o600)
    await store.unset('modelscope')
    expect(await store.get('modelscope')).toBeUndefined()
  })
  it('works without any credential service', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dig-keys-'))
    expect(hasRecordApi({ resolve() {} })).toBe(false)
    const store = layeredKeyStore(undefined, fileKeyStore(dir))
    await store.set('google', 'g')
    expect(await store.get('google')).toBe('g')
  })
})
