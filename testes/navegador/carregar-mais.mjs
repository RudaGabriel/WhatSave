// WhatSave — testes/navegador/carregar-mais.mjs
// Versão 1.4.3 (2026-11-16): valida "Carregar mais mensagens" em uma página simulada.
// Autor: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Monta no Chromium uma página que imita a estrutura do WhatsApp Web (lista
// lateral de conversas, painel #main com linhas [data-id], aviso de
// criptografia e botão de histórico do celular), injeta o inpage/app.js em modo
// de teste e confere as três estratégias de carregamento.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const CONVERSA = '5500000000000-1600000000@g.us';

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  body { margin: 0; display: flex; height: 600px; font: 14px sans-serif; }
  #pane-side { width: 300px; height: 600px; overflow-y: auto; }
  #pane-side div { height: 60px; }
  #main { flex: 1; height: 600px; display: flex; flex-direction: column; }
  #lista { flex: 1; overflow-y: auto; }
  #lista [data-id] { height: 40px; }
</style></head><body>
  <div id="pane-side"></div>
  <div id="main"><header>Celular do Caixa 1</header><div id="lista">
    <div role="button" id="aviso">As mensagens e as ligações são protegidas com a criptografia de ponta a ponta e ficam somente entre você e os participantes desta conversa.</div>
  </div></div>
</body></html>`;

// Prepara a página: lista lateral longa, mensagens iniciais e contadores.
function prepararPagina({ conversa, modo }) {
  const lateral = document.getElementById('pane-side');
  for (let i = 0; i < 200; i++) lateral.appendChild(Object.assign(document.createElement('div'), { textContent: `Conversa ${i}` }));
  lateral.scrollTop = 500;

  const lista = document.getElementById('lista');
  const aviso = document.getElementById('aviso');
  window.__cliquesAviso = 0;
  window.__cliquesCelular = 0;
  aviso.addEventListener('click', () => { window.__cliquesAviso++; });

  const modelos = [];
  let base = 1758652245;
  let seq = 0;
  const novaLinha = () => {
    const d = document.createElement('div');
    d.setAttribute('data-id', `false_${conversa}_ID${++seq}`);
    d.textContent = `Mensagem ${seq}`;
    return d;
  };
  const acrescentarAntigas = (n) => {
    for (let i = 0; i < n; i++) {
      base -= 60;
      modelos.unshift({ id: { _serialized: `false_${conversa}_A${modelos.length}` }, t: base });
      aviso.after(novaLinha());
    }
  };
  for (let i = 0; i < 20; i++) { modelos.push({ id: { _serialized: `false_${conversa}_I${i}` }, t: base + i * 60 }); lista.appendChild(novaLinha()); }
  lista.scrollTop = lista.scrollHeight;

  // Rolagem: ao chegar ao topo, o "WhatsApp" acrescenta 30 mensagens (até 3 vezes).
  let cargasRolagem = 0;
  if (modo === 'rolagem') {
    lista.addEventListener('scroll', () => {
      if (lista.scrollTop === 0 && cargasRolagem < 3) {
        cargasRolagem++;
        setTimeout(() => { acrescentarAntigas(30); lista.scrollTop = 200; }, 300);
      }
    });
  }

  // Botão de histórico do celular.
  if (modo === 'celular') {
    lista.style.overflowY = 'hidden';
    const botao = document.createElement('div');
    botao.setAttribute('role', 'button');
    botao.textContent = 'Clique aqui para obter mensagens mais antigas do seu celular.';
    botao.addEventListener('click', () => { window.__cliquesCelular++; setTimeout(() => acrescentarAntigas(25), 400); });
    aviso.after(botao);
  }

  const chat = { id: conversa, msgs: { get models() { return modelos; } } };
  window.WPP = {
    chat: { list: async () => [], getMessages: async () => [], openChatBottom: async () => {}, openChatAt: async () => {} },
    whatsapp: { ChatStore: { get: (id) => (id === conversa ? chat : undefined) } },
    webpack: {
      search: (predicado) => {
        if (modo !== 'api') return null;
        const modulo = { loadEarlierMsgs: async () => { if (modelos.length < 120) acrescentarAntigas(50); return []; } };
        return predicado(modulo) ? modulo : null;
      }
    }
  };
  window.__WAMD_MODO_TESTE__ = true;
}

async function cenario(navegador, modo) {
  const pagina = await navegador.newPage({ viewport: { width: 1000, height: 600 } });
  const erros = [];
  pagina.on('pageerror', e => erros.push(e.message));
  await pagina.setContent(PAGINA);
  await pagina.evaluate(prepararPagina, { conversa: CONVERSA, modo });
  await pagina.addScriptTag({ path: join(raiz, 'inpage', 'app.js') });

  const r = await pagina.evaluate((c) => window.__WAMD_INTERNO__.loadMoreMessages(c), CONVERSA);
  const estado = await pagina.evaluate(() => ({
    lateral: document.getElementById('pane-side').scrollTop,
    aviso: window.__cliquesAviso,
    celular: window.__cliquesCelular,
    lista: window.__WAMD_INTERNO__.localizarListaMensagens()?.id || null
  }));
  await pagina.close();

  assert.deepEqual(erros, [], `${modo}: erros de JavaScript`);
  assert.equal(r.ok, true, `${modo}: ${r.error}`);
  assert.equal(r.metodo, modo === 'celular' ? 'celular' : modo, `${modo}: método`);
  assert.ok(r.carregadas > 0, `${modo}: nenhuma mensagem carregada`);
  assert.ok(r.maisAntiga > 0, `${modo}: horário da mais antiga ausente`);
  assert.equal(estado.lateral, 500, `${modo}: a lista lateral foi rolada`);
  assert.equal(estado.aviso, 0, `${modo}: o aviso de criptografia foi clicado`);
  if (modo === 'rolagem') assert.equal(estado.lista, 'lista', 'painel errado escolhido');
  if (modo === 'celular') assert.equal(estado.celular, 1, 'botão do celular não clicado');
  console.log(`Carregar mais mensagens aprovado (${modo}): ${r.carregadas} mensagem(ns).`);
}

const navegador = await playwright.chromium.launch();
try {
  for (const modo of ['api', 'rolagem', 'celular']) await cenario(navegador, modo);
} finally {
  await navegador.close();
}
