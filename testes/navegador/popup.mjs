// WhatSave — testes/navegador/popup.mjs
// Versão 1.4.2 (2026-11-13): verificação da nova mensagem de período inválido.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Abre o popup.html no Chromium com uma API "chrome" simulada e confere textos,
// pré-visualização do nome, validação do período, preferências salvas e
// ausência de rolagem horizontal no celular. Requer o Playwright instalado
// (npm install --no-save playwright && npx playwright install chromium).
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('O Playwright não está instalado. Execute: npm install --no-save playwright && npx playwright install chromium');
  process.exit(1);
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const urlPopup = pathToFileURL(join(raiz, 'popup.html')).href;

// API "chrome" mínima: nenhuma aba do WhatsApp Web aberta e nenhuma página real.
function simularChrome() {
  const ouvinte = { addListener() {}, removeListener() {} };
  window.__abasCriadas = [];
  window.close = () => {};
  window.chrome = {
    runtime: { onMessage: ouvinte, sendMessage: async () => ({}), lastError: null },
    tabs: {
      query: async () => [],
      create: async (opcoes) => { window.__abasCriadas.push(opcoes); return { id: 1 }; },
      get: async () => ({ status: 'complete' }),
      reload: async () => {},
      sendMessage: async () => ({ ok: true })
    },
    scripting: { executeScript: async () => [] }
  };
}

async function verificar(navegador, nome, contextoOpcoes) {
  const contexto = await navegador.newContext(contextoOpcoes);
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on('pageerror', e => erros.push(e.message));
  await pagina.addInitScript(simularChrome);
  await pagina.goto(urlPopup);
  await pagina.waitForTimeout(300);

  assert.equal(await pagina.getAttribute('html', 'lang'), 'pt-BR', `${nome}: idioma`);
  assert.equal((await pagina.textContent('#start')).trim(), 'Exportar itens selecionados', `${nome}: botão principal`);
  assert.match(await pagina.textContent('#log'), /nova aba/, `${nome}: aviso de nova aba`);
  assert.equal((await pagina.evaluate(() => window.__abasCriadas))[0]?.url, 'https://web.whatsapp.com/', `${nome}: aba criada`);

  // Pré-visualização do nome com o número sequencial primeiro.
  await pagina.check('#useDate');
  await pagina.selectOption('#dateFormat', 'DD-MM-YYYY');
  assert.equal(await pagina.textContent('#dateFormatPreview'), 'Exemplo: 0001_Chat_23-09-2026.jpg', `${nome}: pré-visualização`);

  // Preferência inválida salva volta ao padrão.
  await pagina.evaluate(() => localStorage.setItem('wamd_prefs', JSON.stringify({ dateFormat: 'INVALIDO', useDate: true })));
  await pagina.reload();
  await pagina.waitForTimeout(300);
  assert.equal(await pagina.inputValue('#dateFormat'), 'YYYY-MM-DD_HH-mm-ss', `${nome}: preferência inválida`);

  // Período invertido é recusado com mensagem clara.
  await pagina.evaluate(() => {
    const opt = document.createElement('option');
    opt.value = 'CONVERSA@g.us'; opt.textContent = 'Celular do Caixa 1'; opt.selected = true;
    const sel = document.querySelector('#chatSelect');
    sel.disabled = false; sel.appendChild(opt);
  });
  await pagina.fill('#dateFrom', '2026-02-10');
  await pagina.fill('#dateTo', '2026-02-01');
  await pagina.click('#start');
  assert.match(await pagina.textContent('#log'), /Período inválido/, `${nome}: validação do período`);

  // Sem rolagem horizontal.
  const medidas = await pagina.evaluate(() => {
    const limite = window.screen.width;
    let maior = 0;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) maior = Math.max(maior, r.right);
    }
    return { maior: Math.ceil(maior), limite, celular: document.documentElement.classList.contains('celular') };
  });
  if (contextoOpcoes.hasTouch) {
    assert.ok(medidas.celular, `${nome}: classe "celular" não aplicada`);
    assert.ok(medidas.maior <= medidas.limite, `${nome}: conteúdo ultrapassa a tela (${medidas.maior} > ${medidas.limite})`);
  } else {
    assert.ok(!medidas.celular, `${nome}: classe "celular" aplicada no computador`);
  }

  await pagina.screenshot({ path: join(raiz, 'testes', 'navegador', `captura-${nome}.png`), fullPage: true });
  assert.deepEqual(erros, [], `${nome}: erros de JavaScript`);
  await contexto.close();
  console.log(`Popup aprovado no ${nome}.`);
}

const navegador = await playwright.chromium.launch();
try {
  await verificar(navegador, 'computador', { viewport: { width: 420, height: 800 } });
  await verificar(navegador, 'celular', { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
} finally {
  await navegador.close();
}
