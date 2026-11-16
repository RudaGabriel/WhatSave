// WhatSave — testes/zip.test.js
// Versão 1.5.0 (2026-11-16): ZIP com o fflate (compressão) e gerador próprio.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./ambiente');

const { interno } = carregarApp();
const bytes = (s) => new TextEncoder().encode(s);

test('CRC32 confere com o valor de referência', () => {
  assert.equal(interno.crc32(bytes('123456789')), 0xCBF43926);
});

test('o gerador próprio cria um ZIP válido com nomes em UTF-8', async () => {
  const entradas = [
    { name: '0001_Ação.txt', bytes: bytes('primeiro') },
    { name: '0002_Documento.txt', bytes: bytes('segundo arquivo') }
  ];
  const blob = interno.makeZipStore(entradas);
  const zip = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(zip.buffer);

  assert.equal(dv.getUint32(0, true), 0x04034b50, 'assinatura do cabeçalho local');
  assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, 'marca de nome em UTF-8');

  const fim = zip.length - 22;
  assert.equal(dv.getUint32(fim, true), 0x06054b50, 'assinatura do fim do diretório central');
  assert.equal(dv.getUint16(fim + 10, true), 2, 'quantidade de entradas');

  // Percorre o diretório central e confere nomes e CRCs.
  let pos = dv.getUint32(fim + 16, true);
  const nomes = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(dv.getUint32(pos, true), 0x02014b50);
    const crc = dv.getUint32(pos + 16, true);
    const tamNome = dv.getUint16(pos + 28, true);
    const deslocamento = dv.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + tamNome));
    nomes.push(nome);
    const tamDados = dv.getUint32(deslocamento + 18, true);
    const inicioDados = deslocamento + 30 + dv.getUint16(deslocamento + 26, true);
    assert.equal(crc, interno.crc32(zip.subarray(inicioDados, inicioDados + tamDados)));
    pos += 46 + tamNome;
  }
  assert.deepEqual(nomes, ['0001_Ação.txt', '0002_Documento.txt']);
});

test('os limites do ZIP ficam abaixo do máximo do formato', () => {
  assert.ok(interno.LIMITE_PARTE_ZIP_BYTES < 0xFFFFFFFF);
  assert.ok(interno.LIMITE_ITENS_ZIP < 0xFFFF);
  assert.ok(interno.LIMITE_PONTE_BYTES * 4 / 3 < 64 * 1024 * 1024);
});

test('formata tamanhos em português', () => {
  assert.equal(interno.formatarTamanho(512), '512 B');
  assert.equal(interno.formatarTamanho(2048), '2 KB');
  assert.equal(interno.formatarTamanho(5.5 * 1024 * 1024), '5,5 MB');
  assert.equal(interno.formatarTamanho(1.25 * 1024 * 1024 * 1024), '1,25 GB');
});

test('com o fflate, o ZIP comprime textos e apenas armazena mídias', async () => {
  const { interno: comFflate } = carregarApp({ comFflate: true });
  const { unzipSync } = require('fflate');
  const texto = bytes('linha de teste\n'.repeat(500));
  const imagem = new Uint8Array(2048).map((_, i) => (i * 37) % 251);
  const ts = Math.floor(new Date(2026, 0, 15, 10, 20, 30).getTime() / 1000);
  const blob = comFflate.makeZip([
    { name: '0001_Câmera do Caixa 1.jpg', bytes: imagem, ts },
    { name: '0002_Endereço.txt', bytes: texto, ts }
  ]);
  const zip = new Uint8Array(await blob.arrayBuffer());
  assert.ok(zip.length < texto.length, 'o texto deveria ter sido comprimido');

  const conteudo = unzipSync(zip);
  assert.deepEqual(Object.keys(conteudo), ['0001_Câmera do Caixa 1.jpg', '0002_Endereço.txt']);
  assert.deepEqual(conteudo['0001_Câmera do Caixa 1.jpg'], imagem);
  assert.deepEqual(conteudo['0002_Endereço.txt'], texto);

  // Método de compressão no cabeçalho local: 0 = armazenado, 8 = DEFLATE.
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint16(8, true), 0, 'a imagem deveria ser apenas armazenada');
  assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, 'marca de nome em UTF-8');
});

test('sem o fflate, o ZIP usa o gerador próprio automaticamente', async () => {
  const blob = interno.makeZip([{ name: 'a.txt', bytes: bytes('abc') }]);
  const zip = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new DataView(zip.buffer).getUint16(8, true), 0);
  assert.equal(zip.length, 30 + 5 + 3 + 46 + 5 + 22);
});
