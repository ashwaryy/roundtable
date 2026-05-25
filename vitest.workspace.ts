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
]
