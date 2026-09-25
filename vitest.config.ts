import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Renderer tests import .tsx components; esbuild needs the automatic JSX
  // runtime regardless of tsconfig's jsx: preserve (typecheck-only) setting.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
})
