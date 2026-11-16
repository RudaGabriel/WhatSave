// WhatSave — testes/ambiente.js
// Versão 1.5.0 (2026-11-16): opção de carregar o fflate antes do app.js.
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
const CAMINHO_APP = path.join(RAIZ, 'inpage', 'app.js');
const CAMINHO_FFLATE = path.join(RAIZ, 'inpage', 'vendor', 'fflate.js');
const CODIGO_APP = fs.readFileSync(CAMINHO_APP, 'utf8');

function carregarApp({ comFflate = false } = {}) {
  const mensagens = [];
  const janela = {
    __WAMD_MODO_TESTE__: true,
    postMessage: (dados) => { mensagens.push(dados); },
    addEventListener: () => {},
    location: { href: 'https://web.whatsapp.com/' }
  };
  const contexto = vm.createContext({
    window: janela,
    self: janela, // No navegador, self === window.
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
  if (comFflate) {
    vm.runInContext(fs.readFileSync(CAMINHO_FFLATE, 'utf8'), contexto, { filename: CAMINHO_FFLATE });
    if (!janela.fflate) throw new Error('O fflate não foi registrado em window.fflate.');
  }
  // Caminho absoluto: permite que a cobertura (c8) associe o código ao arquivo.
  vm.runInContext(CODIGO_APP, contexto, { filename: CAMINHO_APP });
  if (!janela.__WAMD_INTERNO__) throw new Error('As funções internas não foram expostas.');
  return { interno: janela.__WAMD_INTERNO__, mensagens };
}

module.exports = { carregarApp, RAIZ };
