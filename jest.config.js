export default {
  testEnvironment: 'node',
  transform: {},
  moduleFileExtensions: ['js', 'mjs', 'json'],
  testMatch: ['**/__tests__/**/*.mjs', '**/?(*.)+(spec|test).mjs'],
  testPathIgnorePatterns: ['/node_modules/', '/src/__tests__/index.test.mjs'],
};
