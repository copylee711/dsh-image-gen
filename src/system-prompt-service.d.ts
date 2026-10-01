/**
 * Ambient typing for the `systemPrompt` service on the cordis Context.
 *
 * The service lives in the host's `@deepseek-ai/dsh-system-prompt` plugin,
 * which this bundle does not depend on directly (it arrives transitively and
 * must not become a hard requirement: older hosts boot fine without it, and
 * the canvas context registration is strictly additive). This local
 * declaration restores the `ctx.systemPrompt` face for exactly the surface
 * this plugin consumes — dynamic context registration — mirroring the
 * runtime-probe pattern used for the settings service. The rest of the
 * registry (sections, variables, tools, assemble) is host-internal and
 * intentionally not mirrored.
 *
 * The `export {}` keeps this file a module so the `declare module` below is
 * an augmentation of cordis's Context rather than a replacement of it.
 */
export {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Prompt assembly registry provided by @deepseek-ai/dsh-system-prompt (host-side). */
    systemPrompt: {
      /** Register ordered dynamic context; evaluated for each prompt assembly. */
      context(contribution: {
        /** Unique name — a duplicate registration throws. */
        readonly name: string
        /** Contexts are joined in ascending order. */
        readonly order: number
        /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
        readonly text: string | ((context: unknown) => string)
      }): () => void
    }
  }
}
