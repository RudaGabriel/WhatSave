// WhatSave — testes/datas.test.js
// Versão 1.4.0 (2026-11-13): filtro de período.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');

const { interno } = carregarApp();

test('converte o dia em início e fim locais', () => {
  const { start, end } = interno.dayRangeToEpochSeconds('2026-09-23');
  assert.equal(start, Math.floor(new Date(2026, 8, 23, 0, 0, 0).getTime() / 1000));
  assert.equal(end - start, 86399);
});

test('data malformada não gera NaN', () => {
  for (const valor of ['abc', '2026-13-01', '2026-02-00', '']) {
    const { start, end } = interno.dayRangeToEpochSeconds(valor);
    assert.equal(start, undefined, valor);
    assert.equal(end, undefined, valor);
  }
});

test('período invertido é corrigido automaticamente', () => {
  const normal = interno.intervaloDatas('2026-01-01', '2026-01-31');
  const invertido = interno.intervaloDatas('2026-01-31', '2026-01-01');
  assert.equal(invertido.from, normal.from);
  assert.equal(invertido.to, normal.to);
});

test('campos vazios incluem todas as datas', () => {
  const { from, to } = interno.intervaloDatas('', '');
  assert.equal(from, undefined);
  assert.equal(to, undefined);
  assert.equal(interno.withinRange(123, from, to), true);
});
