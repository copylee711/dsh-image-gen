import { describe, expect, it } from 'vitest'
import { explicitSize, presetsFor } from '../src/client/resolution.js'
import { PROTOCOL_CAPABILITIES } from '../src/shared.js'

describe('resolution choices', () => {
  const ms = PROTOCOL_CAPABILITIES.modelscope
  it('keeps the standard size by default and fits presets to the range', () => {
    expect(explicitSize(ms, '1:1', { res: 'std', w: 1, h: 1, lock: true })).toBeUndefined()
    expect(explicitSize(ms, '16:9', { res: '2k', w: 1, h: 1, lock: true })).toBe('2048x1152')
    expect(presetsFor(PROTOCOL_CAPABILITIES.seedream.customSize!, '16:9').map(preset => preset.id)).toEqual(['2k'])
    expect(explicitSize(PROTOCOL_CAPABILITIES.gemini, '1:1', { res: '2k', w: 1, h: 1, lock: true })).toBeUndefined()
  })
  it('clamps custom sizes onto the provider grid', () => {
    expect(explicitSize(ms, '1:1', { res: 'custom', w: 5000, h: 1001, lock: false })).toBe('2048x1008')
  })
})
