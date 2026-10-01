import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME, PLUGIN_SLUG, IMAGE_ROUTE } from '../src/shared.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; publishConfig?: { access?: string } }
const clientBundle = new URL('../lib/client.js', import.meta.url)

describe('packaging identity', () => {
  it('publishes under the scoped name, publicly', () => {
    expect(pkg.name).toBe(PACKAGE_NAME)
    expect(pkg.publishConfig?.access).toBe('public')
  })
  it('keeps every internal id distinct from shanliuling/dsh-image-gen', () => {
    expect(PLUGIN_SLUG).not.toBe('dsh-image-gen')
    expect(IMAGE_ROUTE.startsWith(`/plugins/${PLUGIN_SLUG}/`)).toBe(true)
    expect(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')).toContain(PACKAGE_NAME)
  })
  it.skipIf(!existsSync(clientBundle))('registers the client bundle under the package name', () => {
    expect(readFileSync(clientBundle, 'utf8').slice(0, 200)).toContain(`id: "${PACKAGE_NAME}"`)
  })
})
