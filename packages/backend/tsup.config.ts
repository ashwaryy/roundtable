import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    snapshotWorker: 'src/storage/snapshotWorker.js',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: ['@roundtable/shared'],
})
