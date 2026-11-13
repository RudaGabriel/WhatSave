// WhatSave — testes/executar.mjs
// Versão 1.4.0 (2026-11-13): executor portátil dos testes (Windows, Linux e macOS).
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Lista os arquivos *.test.js da pasta testes e os executa com o executor
// nativo do Node (node --test), sem depender de expansão de curingas do shell.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = dirname(fileURLToPath(import.meta.url));
const arquivos = readdirSync(pasta).filter(n => n.endsWith('.test.js')).sort().map(n => join(pasta, n));

if (!arquivos.length) {
  console.error('Nenhum arquivo de teste encontrado.');
  process.exit(1);
}

const resultado = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(resultado.status ?? 1);
