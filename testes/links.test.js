// WhatSave — testes/links.test.js
// Versão 1.4.0 (2026-11-13): extração de endereços das mensagens.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');
const { texto, imagem } = require('./fabrica');

const { interno } = carregarApp();
// O vm devolve vetores de outro contexto; a cópia permite comparar com deepEqual.
const links = (m) => [...interno.extractMessageLinks(m)];

test('encontra endereços no texto e completa o www', () => {
  assert.deepEqual(links(texto('Veja https://exemplo.com.br/a e www.exemplo.org')), ['https://exemplo.com.br/a', 'https://www.exemplo.org']);
});

test('remove a pontuação final do endereço', () => {
  assert.deepEqual(links(texto('Acesse https://exemplo.com/pagina.')), ['https://exemplo.com/pagina']);
});

test('mantém parênteses equilibrados e remove os que sobram', () => {
  assert.deepEqual(links(texto('(ver https://exemplo.com/item_(1))')), ['https://exemplo.com/item_(1)']);
});

test('lê endereços de prévias e de listas', () => {
  const m = texto('', { extras: { linkPreview: { canonicalUrl: 'https://a.exemplo.com' }, links: [{ url: 'https://b.exemplo.com' }] } });
  assert.deepEqual(links(m), ['https://a.exemplo.com', 'https://b.exemplo.com']);
});

test('não repete o mesmo endereço', () => {
  assert.deepEqual(links(texto('https://x.exemplo.com https://x.exemplo.com')), ['https://x.exemplo.com']);
});

test('mídia com endereço na legenda continua sendo mídia', () => {
  assert.equal(interno.isLinkMessage(imagem({ caption: 'https://exemplo.com' })), false);
});

test('mensagem de texto com endereço é item de link', () => {
  assert.equal(interno.isLinkMessage(texto('https://exemplo.com')), true);
});

test('mensagem de sistema não é item de link', () => {
  assert.equal(interno.isLinkMessage(texto('https://exemplo.com', { extras: { isNotification: true } })), false);
});
