// WhatSave — testes/fabrica.js
// Versão 1.4.0 (2026-11-13): fábrica de mensagens simuladas para os testes.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const CONVERSA = '5500000000000-1600000000@g.us';
const REMETENTE_A = '5500000000001@c.us';
const REMETENTE_B = '5500000000002@c.us';
const BASE = 1758652245; // 23/09/2025, horário fixo para os testes.

let contador = 0;

// Cria uma mensagem no formato aproximado do wa-js.
function mensagem({
  id, conversa = CONVERSA, t = BASE, type = 'chat', body, caption,
  autor = REMETENTE_A, fromMe = false, quotedStanzaID, filename, sequence, rowId, extras = {}
} = {}) {
  const bruto = id || `ID${String(++contador).padStart(6, '0')}`;
  return {
    id: { _serialized: `${fromMe}_${conversa}_${bruto}_${autor}`, id: bruto, remote: { _serialized: conversa }, fromMe },
    t, type, body, caption, author: autor, fromMe, quotedStanzaID, filename, sequence, rowId,
    ...extras
  };
}

const imagem = (opcoes = {}) => mensagem({ type: 'image', mediaKey: 'k', ...opcoes, extras: { mediaKey: 'k', ...(opcoes.extras || {}) } });
const documento = (opcoes = {}) => mensagem({ type: 'document', ...opcoes, extras: { mediaKey: 'k', ...(opcoes.extras || {}) } });
const texto = (body, opcoes = {}) => mensagem({ type: 'chat', body, ...opcoes });

module.exports = { mensagem, imagem, documento, texto, CONVERSA, REMETENTE_A, REMETENTE_B, BASE };
