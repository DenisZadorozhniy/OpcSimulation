import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out-tsc/**',
      'tmp/**',
      'test-results/**',
      'playwright-report/**',
      '.idea/**',
    ],
  },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-unused-vars': 'error' } },
);
