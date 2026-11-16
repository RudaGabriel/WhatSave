// WhatSave — ferramentas/gerar-firefox.mjs
// Versão 1.5.0 (2026-11-16): declara data_collection_permissions (nenhuma coleta), exigido pelo Firefox.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// O Chrome (Manifest V3) usa "background.service_worker" e mostra um aviso se
// encontrar "background.scripts". O Firefox, por sua vez, exige
// "background.scripts". Por isso, o manifest.json do repositório é o do Chrome,
// e este script copia a extensão para dist/firefox com o manifesto ajustado.
//
// Uso: npm run firefox            (gera em dist/firefox)
//      node ferramentas/gerar-firefox.mjs <pasta-de-saida>
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = resolve(process.argv[2] || join(raiz, 'dist', 'firefox'));

// Proteção: nunca apagar a raiz do projeto nem uma pasta acima dela.
if (destino === raiz || raiz.startsWith(destino + '/') || raiz.startsWith(destino + '\\')) {
  console.error(`Pasta de saída inválida: ${destino}`);
  process.exit(1);
}

const ITENS = ['background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', 'LICENSE', 'PRIVACY.md', 'assets', 'icons', 'inpage'];

const manifesto = JSON.parse(readFileSync(join(raiz, 'manifest.json'), 'utf8'));
const servico = manifesto.background?.service_worker;
if (!servico) {
  console.error('O manifest.json não define background.service_worker.');
  process.exit(1);
}
manifesto.background = { scripts: [servico] };
// O Firefox exige a declaração de coleta de dados: o WhatSave não coleta nenhum.
manifesto.browser_specific_settings = manifesto.browser_specific_settings || {};
manifesto.browser_specific_settings.gecko = {
  ...(manifesto.browser_specific_settings.gecko || {}),
  // data_collection_permissions é reconhecido a partir do Firefox 140 (Android: 142).
  strict_min_version: '140.0',
  data_collection_permissions: { required: ['none'] }
};
manifesto.browser_specific_settings.gecko_android = { strict_min_version: '142.0' };

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const item of ITENS) {
  const origem = join(raiz, item);
  if (!existsSync(origem)) {
    console.error(`Arquivo ausente: ${item}`);
    process.exit(1);
  }
  cpSync(origem, join(destino, item), { recursive: true });
}
writeFileSync(join(destino, 'manifest.json'), JSON.stringify(manifesto, null, 2) + '\n', 'utf8');
console.log(`Pacote do Firefox gerado em: ${destino}`);
