// WhatSave — testes/ordem.test.js
// Versão 1.4.0 (2026-11-13): ordenação cronológica e processamento em ordem.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');
const { texto, BASE } = require('./fabrica');

const { interno } = carregarApp();
const espera = (ms) => new Promise(r => setTimeout(r, ms));

test('ordena pelo horário e normaliza milissegundos', () => {
  const a = texto('a', { t: BASE + 10 });
  const b = texto('b', { t: (BASE + 5) * 1000 });
  const c = texto('c', { t: BASE });
  assert.deepEqual([a, b, c].sort(interno.compareMessages).map(m => m.body), ['c', 'b', 'a']);
});

test('desempata pelo sequence quando o horário é igual', () => {
  const a = texto('a', { t: BASE, sequence: 3 });
  const b = texto('b', { t: BASE, sequence: 1 });
  assert.deepEqual([a, b].sort(interno.compareMessages).map(m => m.body), ['b', 'a']);
});

test('processarEmOrdem entrega na ordem com qualquer concorrência', async () => {
  for (const concorrencia of [1, 3, 8, 50]) {
    const itens = Array.from({ length: 40 }, (_, i) => i);
    const consumidos = [];
    const erros = [];
    let simultaneos = 0;
    let maximo = 0;
    await interno.processarEmOrdem(itens, async (item) => {
      simultaneos++; maximo = Math.max(maximo, simultaneos);
      await espera(Math.random() * 8);
      simultaneos--;
      if (item === 5) throw new Error('falha simulada');
      return item === 7 ? null : item;
    }, async (resultado, i) => {
      await espera(Math.random() * 3);
      consumidos.push([i, resultado]);
    }, concorrencia, (m) => erros.push(m));
    assert.deepEqual(consumidos.map(([i]) => i), itens, `concorrência ${concorrencia}`);
    assert.equal(consumidos[5][1], null);
    assert.equal(consumidos[7][1], null);
    assert.equal(erros.length, 1);
    assert.ok(maximo <= Math.min(concorrencia, 8), `máximo simultâneo: ${maximo}`);
  }
});

test('processarEmOrdem limita quantos resultados ficam na memória', async () => {
  let prontosSemConsumo = 0;
  let maximo = 0;
  await interno.processarEmOrdem(Array.from({ length: 30 }, (_, i) => i), async (i) => {
    prontosSemConsumo++; maximo = Math.max(maximo, prontosSemConsumo);
    return i;
  }, async () => {
    await espera(5);
    prontosSemConsumo--;
  }, 4);
  assert.ok(maximo <= 8 + 1, `itens aguardando: ${maximo}`);
});

test('processarEmOrdem aceita lista vazia ou inválida', async () => {
  await interno.processarEmOrdem([], async () => 1, async () => { throw new Error('não deveria consumir'); }, 4);
  await interno.processarEmOrdem(null, async () => 1, async () => { throw new Error('não deveria consumir'); }, 4);
});

test('falha ao consumir um item não interrompe os demais', async () => {
  const consumidos = [];
  const erros = [];
  await interno.processarEmOrdem([1, 2, 3], async (x) => x, async (x) => {
    if (x === 2) throw new Error('disco cheio');
    consumidos.push(x);
  }, 2, (m) => erros.push(m));
  assert.deepEqual(consumidos, [1, 3]);
  assert.equal(erros.length, 1);
});
