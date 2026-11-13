// WhatSave — testes/ambiente.js
// Versão 1.4.0 (2026-11-13): carregador do inpage/app.js em ambiente isolado.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Executa o inpage/app.js dentro de um contexto `vm` do Node com uma janela
// simulada e devolve as funções internas expostas para teste.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.resolve(__dirname, '..');
const CODIGO_APP = fs.readFileSync(path.join(RAIZ, 'inpage', 'app.js'), 'utf8');

function carregarApp() {
  const mensagens = [];
  const janela = {
    __WAMD_MODO_TESTE__: true,
    postMessage: (dados) => { mensagens.push(dados); },
    addEventListener: () => {},
    location: { href: 'https://web.whatsapp.com/' }
  };
  const contexto = vm.createContext({
    window: janela,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    Blob,
    URL,
    btoa,
    Uint8Array,
    Uint32Array,
    DataView,
    ArrayBuffer
  });
  vm.runInContext(CODIGO_APP, contexto, { filename: 'inpage/app.js' });
  if (!janela.__WAMD_INTERNO__) throw new Error('As funções internas não foram expostas.');
  return { interno: janela.__WAMD_INTERNO__, mensagens };
}

module.exports = { carregarApp, RAIZ };
