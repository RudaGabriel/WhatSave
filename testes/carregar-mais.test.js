// WhatSave — testes/carregar-mais.test.js
// Versão 1.4.3 (2026-11-16): reconhecimento do botão de mensagens antigas.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');

const { interno } = carregarApp();
const reconhece = (t) => interno.ehBotaoMensagensAntigas(t);

test('reconhece o botão de mensagens antigas em português', () => {
  assert.equal(reconhece('Clique aqui para obter mensagens mais antigas do seu celular.'), true);
  assert.equal(reconhece('Carregar mensagens anteriores'), true);
});

test('reconhece o botão de mensagens antigas em inglês e espanhol', () => {
  assert.equal(reconhece('Click here to get older messages from your phone.'), true);
  assert.equal(reconhece('Haz clic aquí para obtener mensajes anteriores de tu teléfono.'), true);
});

test('nunca reconhece o aviso de criptografia', () => {
  assert.equal(reconhece('As mensagens e as ligações são protegidas com a criptografia de ponta a ponta e ficam somente entre você e os participantes desta conversa.'), false);
  assert.equal(reconhece('Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.'), false);
});

test('recusa botões comuns e textos vazios', () => {
  for (const t of ['Pesquisar', 'Ligação de vídeo', 'Search', 'Menu', '', null, undefined, 'x'.repeat(300)]) {
    assert.equal(reconhece(t), false, String(t).slice(0, 20));
  }
});

test('a medição sem WhatsApp disponível retorna zeros', () => {
  const r = interno.medirMensagensCarregadas('CONVERSA@g.us');
  assert.equal(r.quantidade, 0);
  assert.equal(r.maisAntiga, 0);
});
