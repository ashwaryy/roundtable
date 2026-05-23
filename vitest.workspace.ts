export default [
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      environment: 'node',
    },
  },
  {
    test: {
      name: 'backend',
      root: './packages/backend',
      environment: 'node',
    },
  },
  {
    test: {
      name: 'frontend',
      root: './packages/frontend',
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  },
]
