// WhatSave — background.js
// Versão 1.4.0 (2026-11-13): textos e comentários em português do Brasil;
// validação do nome de arquivo e do conteúdo antes de salvar; registro com o
// prefixo [WhatSave].
// Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Service worker da extensão (Manifest V3).
//
// Service workers não têm DOM permanente, então URL.createObjectURL() para um
// Blob não é confiável aqui. Por isso, a página envia o conteúdo em base64 e
// este script entrega ao Chrome uma URL data:, que chrome.downloads.download()
// sempre consegue salvar.
//
// Encaminhar todos os salvamentos por esta única API (em vez de clicar em um
// <a download> dentro do WhatsApp Web) permite salvar muitos arquivos em
// sequência sem o aviso "este site está tentando baixar vários arquivos", que
// só se aplica a downloads iniciados pela página.

const downloads = chrome.downloads;

// Alternativa: converte um ArrayBuffer em base64 (usada apenas se algum
// chamador enviar o buffer em vez da string já codificada).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Nome relativo seguro: sem barras invertidas, sem "..", sem barra inicial e
// sem segmentos vazios (o Chrome recusa caminhos absolutos ou com "..").
function normalizarCaminho(nome) {
  return String(nome || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(parte => parte.trim())
    .filter(parte => parte && parte !== '.' && parte !== '..')
    .join('/');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'wa:download') {
        const { base64, arrayBuffer, filename, mime } = msg.payload || {};
        const caminho = normalizarCaminho(filename);
        if (!caminho) {
          sendResponse({ ok: false, error: 'nome de arquivo ausente' });
          return;
        }

        const b64 = base64 || (arrayBuffer ? arrayBufferToBase64(arrayBuffer) : null);
        if (!b64) {
          sendResponse({ ok: false, error: 'conteúdo do arquivo ausente (base64/arrayBuffer)' });
          return;
        }

        const dataUrl = `data:${mime || 'application/octet-stream'};base64,${b64}`;

        await downloads.download({
          url: dataUrl,
          filename: caminho,
          saveAs: false,
          conflictAction: 'uniquify'
        });

        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === 'wa:log') {
        console.log('[WhatSave]', msg.message);
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'tipo de mensagem desconhecido' });
    } catch (e) {
      console.error('[WhatSave] Erro no service worker:', e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // Mantém o canal aberto para a resposta assíncrona.
});
