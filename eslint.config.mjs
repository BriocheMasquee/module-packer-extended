import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['core/src/markdownRenderer.ts'],
    rules: {
      // These markdown-it plugins have no usable published types, so they're
      // loaded via require() (typed `any`) rather than `import`.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['extension/resources/preview/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        document: 'readonly',
        window: 'readonly',
        getComputedStyle: 'readonly',
        MutationObserver: 'readonly',
      },
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
)
