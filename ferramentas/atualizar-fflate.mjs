// WhatSave — ferramentas/atualizar-fflate.mjs
// Versão 1.5.0 (2026-11-16): gera inpage/vendor/fflate.js a partir do pacote npm.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Copia a versão UMD oficial do fflate (instalada com npm install) para
// inpage/vendor, dentro de um invólucro que oculta "module", "exports" e
// "define". Assim, mesmo que a página do WhatsApp Web tenha um carregador AMD
// próprio, a biblioteca é registrada sempre como window.fflate. O conteúdo da
// biblioteca não é alterado.
//
// Uso: npm run atualizar:fflate
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let pastaPacote;
try {
  pastaPacote = dirname(require.resolve('fflate/package.json'));
} catch {
  console.error('O fflate não está instalado. Execute: npm install');
  process.exit(1);
}

const versao = JSON.parse(readFileSync(join(pastaPacote, 'package.json'), 'utf8')).version;
const umd = readFileSync(join(pastaPacote, 'umd', 'index.js'), 'utf8');

const conteudo = `/*! fflate v${versao} — MIT License — licença completa em inpage/vendor/LICENSE-fflate.txt */
/* Invólucro do WhatSave: oculta module/exports/define para registrar sempre window.fflate. */
(function (module, exports, define) {
${umd}
}).call(window, undefined, undefined, undefined);
`;

writeFileSync(join(raiz, 'inpage', 'vendor', 'fflate.js'), conteudo, 'utf8');
copyFileSync(join(pastaPacote, 'LICENSE'), join(raiz, 'inpage', 'vendor', 'LICENSE-fflate.txt'));
console.log(`fflate ${versao} copiado para inpage/vendor/fflate.js`);
