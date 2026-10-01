import { describe, expect, it } from 'vitest'
import { xaiToolParameters } from '../src/xai-params.js'

describe('xAI tool output parameters', () => {
  it('converts a requested pixel size and tier into xAI fields', () => {
    expect(xaiToolParameters({ size: '864x1536', imageSize: '2K' })).toEqual({ aspect_ratio: '9:16', resolution: '2k' })
  })

  it('preserves explicit ratio and omits unspecified defaults', () => {
    expect(xaiToolParameters({ aspectRatio: '16:9' })).toEqual({ aspect_ratio: '16:9' })
    expect(xaiToolParameters({})).toEqual({})
  })

  it('rejects ratios and tiers the xAI image endpoint does not accept', () => {
    expect(() => xaiToolParameters({ size: '1000x100' })).toThrow('不支持比例')
    expect(() => xaiToolParameters({ imageSize: '4K' })).toThrow('不支持清晰度')
    expect(() => xaiToolParameters({ size: '1536x864', aspectRatio: '9:16' })).toThrow('不一致')
  })
})
