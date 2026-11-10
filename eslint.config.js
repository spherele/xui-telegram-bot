// ESLint (flat config): правила с проверкой типов от typescript-eslint.
// Форматирование — целиком на Prettier (eslint-config-prettier выключает конфликтующие правила).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'data/', 'node/'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // импорт типов — только через `import type` (совпадает с verbatimModuleSyntax)
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // числа в шаблонных строках — норма для текстов бота
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // неиспользуемое — ошибка, кроме намеренно пропущенных (_x)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // промисы обработчиков grammY возвращаем — это нормально
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // `x || null` для строк — намеренно: пустая строка из API = «нет значения»
      '@typescript-eslint/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  // тесты: допускаем non-null assertion и вольности с типами фейков
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // test()/describe() из node:test возвращают промис, который ждёт сам раннер
      '@typescript-eslint/no-floating-promises': [
        'error',
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it'] }] },
      ],
    },
  },

  // сам конфиг — обычный JS без проверки типов
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },

  prettier,
);
