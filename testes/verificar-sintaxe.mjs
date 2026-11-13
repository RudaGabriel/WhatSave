// WhatSave — testes/verificar-sintaxe.mjs
// Versão 1.4.0 (2026-11-13): verificação de sintaxe dos scripts da extensão.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Executa "node --check" em cada script da extensão (a biblioteca de terceiros
// em inpage/vendor não é verificada, pois é distribuída já compilada).
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = ['background.js', 'content.js', 'popup.js', 'inpage/app.js'];
let falhas = 0;
for (const s of scripts) {
  const r = spawnSync(process.execPath, ['--check', join(raiz, s)], { stdio: 'inherit' });
  if (r.status !== 0) falhas++;
  else console.log(`Sintaxe correta: ${s}`);
}
process.exit(falhas ? 1 : 0);
