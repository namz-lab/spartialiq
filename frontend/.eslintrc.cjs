/* eslint-env node */
//
// ESLint 8 legacy config — matches the installed toolchain (eslint 8.54,
// eslint-plugin-vue 9.18, @vue/eslint-config-typescript 12). `npm run lint`
// previously failed outright because no config existed at all.
//
// Rule selection is deliberate. This codebase carries ~1,000 `: any` and
// several 4k–7k line SFCs; switching on a maximal ruleset would produce
// thousands of findings, and a gate nobody can pass is the same as no gate.
// So the ERROR set is limited to things that are bugs or security problems,
// and stylistic/tech-debt signals are WARN so they show up in review without
// blocking the pipeline. Tighten as the debt comes down.
//
// No @rushstack/eslint-patch here: it is not installed, and adding a dependency
// only to reshape plugin resolution is not worth it for a flat single-package
// repo where the plugins resolve from the root node_modules anyway.

module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'plugin:vue/vue3-essential',
    '@vue/eslint-config-typescript',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  ignorePatterns: [
    'dist/', 'node_modules/', 'dev-dist/', 'src-tauri/', 'public/',
    'coverage/', 'test-results/', 'playwright-report/', '*.d.ts',
  ],
  rules: {
    // ── Correctness / security (errors) ──────────────────────────────────
    'no-debugger': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-class-members': 'error',
    'no-duplicate-case': 'error',
    'no-unsafe-negation': 'error',
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'valid-typeof': 'error',
    'use-isnan': 'error',
    'vue/no-mutating-props': 'error',
    'vue/require-v-for-key': 'error',
    'vue/no-use-v-if-with-v-for': 'error',
    'vue/no-parsing-error': 'error',

    // v-html is the one sink Vue itself cannot escape. Every existing use goes
    // through a helper that escapes first (see utils/escapeHtml.ts); a warning
    // keeps new ones visible in review.
    'vue/no-v-html': 'warn',

    // ── Tech debt (warnings) ─────────────────────────────────────────────
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', {
      argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none',
    }],
    'no-unused-vars': 'off',                 // superseded by the TS rule above
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'vue/multi-word-component-names': 'off', // route views are single-word by convention
  },
  overrides: [
    {
      files: ['**/__tests__/**', '**/*.spec.ts', 'e2e/**'],
      env: { node: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
      files: ['*.config.*', 'scripts/**', '.eslintrc.cjs'],
      env: { node: true },
      rules: { '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
}
