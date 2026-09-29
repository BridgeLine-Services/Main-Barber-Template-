// Flat ESLint config (required by Next 16 / eslint-config-next 16).
// Mirrors the previous .eslintrc.json rules.
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'pgbin/**',
      'scripts/sql/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      // Severity policy matches the pre-upgrade (.eslintrc) configuration:
      // the v16 typescript preset turns these on as errors, but they were
      // never enforced in this codebase before the upgrade. Downgraded to
      // warnings so the upgrade stays reviewable; clearing them is a
      // tracked follow-up, not something to hide inside a framework bump.
      '@typescript-eslint/no-explicit-any': 'warn',
      // '_'-prefixed params/catches are intentional placeholders.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // react-hooks v6 adds these next-generation rules; the flagged
      // patterns pre-date the upgrade. Warnings for now, review separately.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Test suites bootstrap the auth module with require() after setting
    // process.env.NEXTAUTH_SECRET — imports would hoist above the env set.
    files: ['tests/**/*.ts', 'scripts/**/*.{js,cjs,ts}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]
