// WhatSave — testes/legendas.test.js
// Versão 1.4.0 (2026-11-13): regras de recuperação de legendas.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');
const { imagem, documento, texto, REMETENTE_B, BASE } = require('./fabrica');

const { interno } = carregarApp();
const ambas = { captureNextMessageCaption: true, captureReplyCaption: true };

function recuperar(midias, todas, opcoes = ambas) {
  interno.attachRecoveredCaptions(midias, todas, undefined, undefined, opcoes);
  return midias.map(m => ({ legenda: m.__wamdCaption, fonte: m.__wamdCaptionSource }));
}

test('usa a legenda da própria mídia', () => {
  const m = imagem({ caption: 'Foto da entrega' });
  assert.deepEqual(recuperar([m], [m]), [{ legenda: 'Foto da entrega', fonte: 'inline' }]);
});

test('ignora o nome do arquivo de documento usado como legenda', () => {
  const d = documento({ caption: 'Relatorio.pdf', filename: 'Relatorio.pdf', body: 'Relatorio.pdf' });
  assert.equal(interno.getOwnMediaCaption(d), '');
});

test('aceita uma legenda real em documento', () => {
  const d = documento({ caption: 'Documentos do mês', filename: 'Relatorio.pdf' });
  assert.equal(interno.getOwnMediaCaption(d), 'Documentos do mês');
});

test('usa resposta direta que cita exatamente a mídia', () => {
  const m = imagem({ id: 'MIDIA1', t: BASE });
  const r = texto('Comprovante do caixa', { t: BASE + 300, quotedStanzaID: 'MIDIA1' });
  assert.deepEqual(recuperar([m], [m, r]), [{ legenda: 'Comprovante do caixa', fonte: 'reply' }]);
});

test('não usa resposta que cita outra mensagem', () => {
  const m = imagem({ id: 'MIDIA1', t: BASE });
  const r = texto('Outro assunto', { t: BASE + 30, quotedStanzaID: 'OUTRA' });
  assert.equal(recuperar([m], [m, r])[0].legenda, undefined);
});

test('usa a mensagem imediatamente seguinte dentro de 15 segundos', () => {
  const m = imagem({ t: BASE });
  const n = texto('Pedido do cliente', { t: BASE + 5 });
  assert.deepEqual(recuperar([m], [m, n]), [{ legenda: 'Pedido do cliente', fonte: 'standalone-next' }]);
});

test('não usa a mensagem seguinte após mais de 15 segundos', () => {
  const m = imagem({ t: BASE });
  const n = texto('Muito depois', { t: BASE + 20 });
  assert.equal(recuperar([m], [m, n])[0].legenda, undefined);
});

test('não usa a mensagem seguinte de outro remetente', () => {
  const m = imagem({ t: BASE });
  const n = texto('Mensagem de outra pessoa', { t: BASE + 3, autor: REMETENTE_B });
  assert.equal(recuperar([m], [m, n])[0].legenda, undefined);
});

test('nunca procura além da mensagem imediatamente seguinte', () => {
  const m1 = imagem({ t: BASE });
  const m2 = imagem({ t: BASE + 2 });
  const n = texto('Legenda da segunda', { t: BASE + 4 });
  const [a, b] = recuperar([m1, m2], [m1, m2, n]);
  assert.equal(a.legenda, undefined);
  assert.equal(b.legenda, 'Legenda da segunda');
});

test('horário idêntico sem desempate confiável não gera legenda', () => {
  const m = imagem({ t: BASE });
  const n = texto('Mesmo segundo', { t: BASE });
  assert.equal(recuperar([m], [m, n])[0].legenda, undefined);
});

test('horário idêntico com sequence crescente gera legenda', () => {
  const m = imagem({ t: BASE, sequence: 10 });
  const n = texto('Mesmo segundo', { t: BASE, sequence: 11 });
  assert.equal(recuperar([m], [m, n])[0].legenda, 'Mesmo segundo');
});

test('com as opções desligadas, só a legenda própria é usada', () => {
  const m = imagem({ id: 'MIDIA1', t: BASE });
  const r = texto('Resposta', { t: BASE + 2, quotedStanzaID: 'MIDIA1' });
  const res = recuperar([m], [m, r], { captureNextMessageCaption: false, captureReplyCaption: false });
  assert.equal(res[0].legenda, undefined);
});

test('a mesma mensagem não vira legenda de duas mídias', () => {
  const m1 = imagem({ id: 'M1', t: BASE });
  const m2 = imagem({ id: 'M2', t: BASE + 1 });
  const r = texto('Resposta única', { t: BASE + 2, quotedStanzaID: 'M1' });
  const r2 = texto('Resposta única', { t: BASE + 3, quotedStanzaID: 'M1' });
  const res = recuperar([m1, m2], [m1, m2, r, r2]);
  assert.equal(res[0].legenda, 'Resposta única');
  assert.equal(res[1].legenda, undefined);
});
