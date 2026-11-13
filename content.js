// WhatSave — content.js
// Versão 1.4.0 (2026-11-13): textos e comentários em português do Brasil.
// Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Ponte leve entre a página do WhatsApp Web (script no MAIN world,
// inpage/app.js) e a extensão (popup.js e background.js).
(function () {
  // O manifesto registra este script e o popup.js também o injeta quando um
  // ping fica sem resposta; assim, o mesmo contexto isolado pode recebê-lo mais
  // de uma vez. Sem esta proteção, cada injeção acrescentaria outro par de
  // ouvintes, e cada comando do popup chegaria à página repetido, executando
  // exportações inteiras duas ou três vezes ao mesmo tempo.
  if (window.__WAMD_CONTENT_LOADED__) return;
  window.__WAMD_CONTENT_LOADED__ = true;

  // Página -> extensão (background ou popup).
  window.addEventListener('message', (ev) => {
    // Só aceita mensagens da própria janela (nunca de iframes de terceiros).
    if (ev.source !== window) return;
    const { data } = ev;
    if (!data || data.__from !== 'wamd:inpage') return;

    // Downloads precisam de uma confirmação de volta para a página, para que o
    // app.js saiba se chrome.downloads.download() funcionou.
    if (data.type === 'wa:download') {
      try {
        chrome.runtime.sendMessage(
          { type: 'wa:download', payload: data.payload },
          (res) => {
            try {
              window.postMessage({
                __from: 'wamd:content',
                type: 'wa:download:ack',
                id: data.id,
                res: res || { ok: false, error: chrome.runtime.lastError?.message || 'sem resposta da extensão' }
              }, '*');
            } catch {}
          }
        );
      } catch (e) {
        window.postMessage({
          __from: 'wamd:content',
          type: 'wa:download:ack',
          id: data.id,
          res: { ok: false, error: String(e) }
        }, '*');
      }
      return; // Não encaminha também como mensagem genérica.
    }

    // Encaminhamento genérico (registros, progresso, respostas de comandos etc.).
    try {
      chrome.runtime.sendMessage({ __from: 'wamd:content', payload: data });
    } catch {}
  });

  // Popup -> página.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.__to !== 'wamd:content') return;

    // Ping leve usado pelo popup para verificar se este script está ativo
    // antes de enviar os comandos reais.
    if (msg.payload && msg.payload.type === 'ping') {
      sendResponse({ ok: true, pong: true });
      return;
    }

    try {
      window.postMessage(msg.payload, '*');
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  });
})();
