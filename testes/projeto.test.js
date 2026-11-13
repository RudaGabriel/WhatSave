// WhatSave — testes/projeto.test.js
// Versão 1.4.0 (2026-11-13): consistência de versões, cabeçalhos, CHANGELOG e README.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Garante que nenhuma informação fique desatualizada: versões iguais em todos
// os lugares, cabeçalhos no padrão, CHANGELOG com uma seção por arquivo e
// README com a versão e a quantidade de testes corretas.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RAIZ } = require('./ambiente');

const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const manifesto = JSON.parse(ler('manifest.json'));
const pacote = JSON.parse(ler('package.json'));
const VERSAO = manifesto.version;
const LINHA_HISTORICO = 'Histórico completo das versões: CHANGELOG.md no repositório.';

// Arquivos com cabeçalho de versão próprio.
const VERSIONADOS = [
  'background.js', 'content.js', 'popup.js', 'popup.html', 'popup.css', 'inpage/app.js',
  ...fs.readdirSync(path.join(RAIZ, 'testes')).filter(n => /\.(js|mjs)$/.test(n)).map(n => `testes/${n}`),
  ...fs.readdirSync(path.join(RAIZ, 'testes', 'navegador')).filter(n => /\.(js|mjs)$/.test(n)).map(n => `testes/navegador/${n}`)
];

function versaoDoCabecalho(rel) {
  const inicio = ler(rel).split('\n').slice(0, 12).join('\n');
  const m = inicio.match(/Versão (\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)/);
  return m ? m[1] : null;
}

test('manifest, package.json e APP_VERSION têm a mesma versão', () => {
  assert.equal(pacote.version, VERSAO);
  assert.match(ler('inpage/app.js'), new RegExp(`const APP_VERSION = '${VERSAO.replace(/\./g, '\\.')}'`));
  assert.match(ler('popup.js'), new RegExp(`const APP_VERSION = '${VERSAO.replace(/\./g, '\\.')}'`));
});

test('a descrição do manifesto respeita o limite de 132 caracteres', () => {
  assert.ok(manifesto.description.length <= 132);
});

test('todos os arquivos citados no manifesto existem', () => {
  const citados = [
    manifesto.background.service_worker,
    manifesto.action.default_popup,
    ...Object.values(manifesto.icons),
    ...manifesto.content_scripts.flatMap(c => c.js),
    ...manifesto.web_accessible_resources.flatMap(w => w.resources)
  ];
  for (const rel of citados) assert.ok(fs.existsSync(path.join(RAIZ, rel)), rel);
});

test('cada arquivo versionado tem cabeçalho com versão e linha do histórico', () => {
  for (const rel of VERSIONADOS) {
    assert.ok(versaoDoCabecalho(rel), `${rel}: cabeçalho de versão ausente`);
    assert.ok(ler(rel).includes(LINHA_HISTORICO), `${rel}: linha do histórico ausente`);
  }
});

test('o CHANGELOG tem linha na tabela e seção para cada arquivo versionado', () => {
  const changelog = ler('CHANGELOG.md');
  for (const rel of VERSIONADOS) {
    const versao = versaoDoCabecalho(rel);
    assert.ok(changelog.includes(`| \`${rel}\` | ${versao} |`), `${rel}: linha da tabela ausente ou com versão diferente`);
    assert.ok(changelog.includes(`### \`${rel}\``), `${rel}: seção ausente`);
    const secao = changelog.split(`### \`${rel}\``)[1].split('\n### ')[0];
    assert.ok(secao.includes(`**${versao}**`), `${rel}: a entrada mais recente da seção não é a ${versao}`);
  }
  assert.ok(changelog.includes(`## Extensão ${VERSAO}`), 'CHANGELOG sem a versão atual da extensão');
});

test('o README mostra a versão e a quantidade de testes atuais', () => {
  const readme = ler('README.md');
  assert.ok(readme.includes(`vers%C3%A3o-${VERSAO}`), 'badge de versão desatualizado');
  const total = fs.readdirSync(path.join(RAIZ, 'testes'))
    .filter(n => n.endsWith('.test.js'))
    .reduce((soma, n) => soma + (ler(`testes/${n}`).match(/^test\(/gm) || []).length, 0);
  assert.ok(readme.includes(`testes-${total}%20aprovados`), `badge de testes deveria indicar ${total}`);
});

test('os créditos e o endereço do repositório estão corretos', () => {
  assert.equal(pacote.author, 'Ruda Gabriel');
  assert.match(ler('LICENSE'), /Jstarzz/);
  assert.match(ler('LICENSE'), /Ruda Gabriel/);
  assert.match(ler('popup.html'), /github\.com\/RudaGabriel\/WhatSave/);
  assert.equal(manifesto.homepage_url, 'https://github.com/RudaGabriel/WhatSave');
});
