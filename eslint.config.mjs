// WhatSave — eslint.config.mjs
// Versão 1.5.0 (2026-11-16): configuração do ESLint (análise estática do código).
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Regras recomendadas do ESLint, com os ambientes de cada parte do projeto:
// página/popup (navegador + APIs de extensão), service worker e Node (testes e
// ferramentas). Bibliotecas de terceiros e pastas geradas são ignoradas.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['inpage/vendor/**', 'node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['popup.js', 'content.js', 'inpage/app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions }
    }
  },
  {
    files: ['background.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.webextensions }
    }
  },
  {
    files: ['testes/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    files: ['testes/**/*.mjs', 'ferramentas/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } }
  },
  {
    // A função prepararPagina é executada dentro do navegador pelo Playwright.
    files: ['testes/navegador/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    rules: {
      // Variáveis iniciadas por "_" são intencionalmente não usadas.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Blocos catch vazios são usados de propósito para ignorar falhas não críticas.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
