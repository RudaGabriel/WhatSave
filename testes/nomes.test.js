// WhatSave — testes/nomes.test.js
// Versão 1.4.0 (2026-11-13): limpeza e montagem dos nomes de arquivo.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');

const { interno } = carregarApp();
const { sanitizeFilename, makeFilename, extFromMime } = interno;
const TS = Math.floor(new Date(2026, 8, 23, 15, 30, 45).getTime() / 1000);

test('troca os caracteres proibidos no Windows por sublinhado', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('remove pontos e espaços no final do nome', () => {
  assert.equal(sanitizeFilename('Relatório final. . '), 'Relatório final');
});

test('evita nomes reservados do Windows', () => {
  assert.equal(sanitizeFilename('CON'), '_CON');
  assert.equal(sanitizeFilename('lpt1.txt'), '_lpt1.txt');
});

test('remove caracteres de controle e preserva acentos', () => {
  assert.equal(sanitizeFilename('Ação\u0007\u0000 Ótima'), 'Ação Ótima');
});

test('o corte nunca parte um emoji ao meio', () => {
  const nome = sanitizeFilename('x'.repeat(119) + '😀😀');
  assert.ok(!/[\uD800-\uDBFF]$/.test(nome));
  assert.equal(Array.from(nome).length, 120);
});

test('valor vazio ou nulo resulta em texto vazio', () => {
  assert.equal(sanitizeFilename(null), '');
  assert.equal(sanitizeFilename(undefined), '');
});

test('o número sequencial vem antes do nome da conversa', () => {
  const nome = makeFilename({ chatName: 'Loja Centro', ts: TS, index: 7, mime: 'image/jpeg', naming: {}, kind: 'image' });
  assert.equal(nome, '0007_Loja Centro.jpg');
});

test('aplica cada formato de data', () => {
  const casos = {
    'YYYY-MM-DD_HH-mm-ss': '2026-09-23_15-30-45',
    'YYYY-MM-DD': '2026-09-23',
    'DD-MM-YYYY_HH-mm-ss': '23-09-2026_15-30-45',
    'DD-MM-YYYY': '23-09-2026',
    'YYYYMMDD_HHmmss': '20260923_153045',
    'YYYYMMDD': '20260923',
    'YYMMDD_HHmmss': '260923_153045'
  };
  for (const [formato, esperado] of Object.entries(casos)) {
    const nome = makeFilename({ chatName: 'Chat', ts: TS, index: 1, mime: 'image/png', naming: { useDate: true, dateFormat: formato }, kind: 'image' });
    assert.equal(nome, `0001_Chat_${esperado}.png`, formato);
  }
});

test('formato de data desconhecido usa o padrão', () => {
  const nome = makeFilename({ chatName: 'Chat', ts: TS, index: 1, mime: 'image/png', naming: { useDate: true, dateFormat: 'XYZ' }, kind: 'image' });
  assert.equal(nome, '0001_Chat_2026-09-23_15-30-45.png');
});

test('inclui remetente, legenda e nome original', () => {
  const nome = makeFilename({
    chatName: 'Chat', senderName: 'VENDEDOR A', ts: TS, index: 2, mime: 'application/pdf',
    caption: 'Pedido 12', naming: { includeSenderName: true, captionSuffix: true, appendOrigNameAll: true },
    message: { filename: 'pedido.pdf' }, kind: 'document'
  });
  assert.equal(nome, '0002_Chat_VENDEDOR A_Pedido 12_pedido.pdf');
});

test('deduz a extensão pelo tipo MIME', () => {
  assert.equal(extFromMime('image/jpeg'), 'jpg');
  assert.equal(extFromMime('video/mp4'), 'mp4');
  assert.equal(extFromMime('audio/ogg; codecs=opus'), 'ogg');
  assert.equal(extFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'xlsx');
  assert.equal(extFromMime(''), '');
});
