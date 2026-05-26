import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/storage/snapshotWorker.js'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: ['@roundtable/shared'],
})
