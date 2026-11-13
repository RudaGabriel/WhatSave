// WhatSave — popup.js
// Versão 1.4.2 (2026-11-13): mensagens do registro de atividade resumidas.
// Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Liga a interface do popup ao script da página, por meio do content.js.
const D = (sel) => document.querySelector(sel);
const logEl = D('#log');
const progWrap = D('#progressWrap');
const bar = D('#bar');
const chatSel = D('#chatSelect');
const statsSection = D('#statsSection');
const statDateRange = D('#statDateRange');
const statMediaCount = D('#statMediaCount');
const statImages = D('#statImages');
const statVideos = D('#statVideos');
const statAudio = D('#statAudio');
const statDocuments = D('#statDocuments');
const statLinks = D('#statLinks');
const loadMoreBtn = D('#loadMoreBtn');
const closeStatsBtn = D('#closeStatsBtn');

// Em celulares e tablets o popup abre em tela cheia; a classe ajusta a largura.
// A tela física de um computador nunca tem o menor lado abaixo de 600 px.
try {
  const menorLado = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  if (menorLado > 0 && menorLado < 600 && (navigator.maxTouchPoints || 0) > 0) {
    document.documentElement.classList.add('celular');
  }
} catch (_) {}

const WHATSAPP_URL = 'https://web.whatsapp.com/';
const FORMATO_DATA_PADRAO = 'YYYY-MM-DD_HH-mm-ss';

// --- Preferências da interface mantidas entre aberturas do popup ---
const PREFS_KEY = 'wamd_prefs';
const prefSelectors = {
  useDate: '#useDate',
  dateFormat: '#dateFormat',
  includeSenderName: '#includeSenderName',
  captionSuffix: '#useCaptionSuffix',
  captureNextMessageCaption: '#captureNextMessageCaption',
  captureReplyCaption: '#captureReplyCaption',
  appendOrigNameAll: '#appendOrigNameAll',
  saveAsZip: '#saveAsZip',
  preserveChatOrder: '#preserveChatOrder',
  deepScan: '#deepScan',
  concurrency: '#concurrency'
};

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (!saved || typeof saved !== 'object') return;
    for (const [key, selector] of Object.entries(prefSelectors)) {
      const el = D(selector);
      if (!el || !(key in saved)) continue;
      if (el.type === 'checkbox') el.checked = !!saved[key];
      else {
        const fallback = el.value;
        el.value = String(saved[key]);
        // Um valor salvo que não existe mais na lista deixaria o campo vazio.
        if (el.tagName === 'SELECT' && el.selectedIndex === -1) el.value = fallback;
      }
    }
  } catch (_) {
    // Preferências corrompidas ou armazenamento indisponível: mantém os padrões.
  }
}

function savePrefs() {
  try {
    const values = {};
    for (const [key, selector] of Object.entries(prefSelectors)) {
      const el = D(selector);
      if (!el) continue;
      values[key] = el.type === 'checkbox' ? !!el.checked : el.value;
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify(values));
  } catch (_) {
    // Armazenamento indisponível (por exemplo, janela anônima restrita).
  }
}

function bindPrefPersistence() {
  loadPrefs();
  for (const selector of Object.values(prefSelectors)) {
    D(selector)?.addEventListener('change', savePrefs);
  }
}

bindPrefPersistence();

function formatDateExample(pattern, d = new Date(2026, 8, 23, 15, 30, 45)) {
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = String(d.getFullYear());
  const YY = YYYY.slice(-2);
  const MM = pad(d.getMonth() + 1);
  const DD = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const formats = {
    'YYYY-MM-DD_HH-mm-ss': `${YYYY}-${MM}-${DD}_${HH}-${mm}-${ss}`,
    'YYYY-MM-DD': `${YYYY}-${MM}-${DD}`,
    'DD-MM-YYYY_HH-mm-ss': `${DD}-${MM}-${YYYY}_${HH}-${mm}-${ss}`,
    'DD-MM-YYYY': `${DD}-${MM}-${YYYY}`,
    'YYYYMMDD_HHmmss': `${YYYY}${MM}${DD}_${HH}${mm}${ss}`,
    'YYYYMMDD': `${YYYY}${MM}${DD}`,
    'YYMMDD_HHmmss': `${YY}${MM}${DD}_${HH}${mm}${ss}`
  };
  return formats[pattern] || formats[FORMATO_DATA_PADRAO];
}

function syncDateFormatVisibility() {
  const enabled = D('#useDate')?.checked === true;
  const group = D('#dateFormatGroup');
  const select = D('#dateFormat');
  const preview = D('#dateFormatPreview');
  if (group) group.style.display = enabled ? 'block' : 'none';
  if (select) select.disabled = !enabled;
  if (preview) preview.textContent = `Exemplo: 0001_Chat_${formatDateExample(select?.value || FORMATO_DATA_PADRAO)}.jpg`;
}

D('#useDate')?.addEventListener('change', syncDateFormatVisibility);
D('#dateFormat')?.addEventListener('change', syncDateFormatVisibility);
syncDateFormatVisibility();

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  logEl.textContent = (logEl.textContent + '\n' + line).trim();

  // Limita o registro para que um lote muito grande (centenas de arquivos)
  // não transforme o <pre> em um nó com milhares de linhas, deixando o popup lento.
  const lines = logEl.textContent.split('\n');
  const MAX_LINES = 500;
  if (lines.length > MAX_LINES) {
    logEl.textContent = lines.slice(lines.length - MAX_LINES).join('\n');
  }

  logEl.scrollTop = logEl.scrollHeight;
}

function getSelectedChatIds() {
  return Array.from(chatSel.selectedOptions).map(o => o.value).filter(Boolean);
}

async function getActiveTab() {
  // Prefere uma aba do WhatsApp Web já aberta e totalmente carregada.
  const waTabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (waTabs && waTabs.length > 0) {
    return waTabs.find(t => t.status === 'complete') || waTabs[0];
  }

  // Nenhuma aba do WhatsApp Web aberta: abre uma nova aba, sem substituir a
  // página que o usuário estava usando.
  await chrome.tabs.create({ url: WHATSAPP_URL, active: true });

  // Fecha o popup enquanto a página carrega; o usuário o reabre em seguida.
  setTimeout(() => {
    try { window.close(); } catch (_) {}
  }, 50);

  throw new Error('WhatsApp Web aberto em nova aba. Reabra a extensão após o carregamento.');
}

async function runInMain(tabId, func, ...args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world: 'MAIN'
  });
  // executeScript pode devolver lista vazia se a aba fechar ou navegar no meio.
  return Array.isArray(results) && results.length ? results[0]?.result : undefined;
}

async function injectFile(tabId, file) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [file],
    world: 'MAIN'
  });
}

// Precisa ser igual a APP_VERSION em inpage/app.js.
const APP_VERSION = '1.4.2';

function waitForTabComplete(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return resolve(true);
      } catch (_) {
        return resolve(false);
      }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(poll, 250);
    };
    setTimeout(poll, 300);
  });
}

async function ensureInjected(tabId) {
  // Uma aba aberta antes de uma atualização da extensão ainda contém o app.js
  // anterior, e a proteção de carregamento do app.js torna uma nova injeção
  // inócua. O popup enviaria então o formato atual de comandos a um código
  // antigo, com falhas difíceis de entender. Por isso, a aba é recarregada para
  // receber a versão atual de forma limpa.
  const injected = await runInMain(tabId, () => ({
    loaded: !!window.__WAMD_APP_LOADED__,
    version: window.__WAMD_APP_VERSION__ || null
  }));

  if (injected?.loaded && injected.version !== APP_VERSION) {
    log('Versão anterior na aba. Recarregando o WhatsApp Web…');
    await chrome.tabs.reload(tabId);
    await waitForTabComplete(tabId);
  }

  const hasWpp = await runInMain(tabId, () => !!window.WPP);
  if (!hasWpp) {
    await injectFile(tabId, 'inpage/vendor/wppconnect-wa-wrapped.js').catch(e => log('Erro ao carregar o wa-js: ' + e.message));
  }

  const appLoaded = await runInMain(tabId, () => !!window.__WAMD_APP_LOADED__);
  if (!appLoaded) {
    log('Carregando…');
    await injectFile(tabId, 'inpage/app.js').catch(e => log('Erro ao carregar o app.js: ' + e.message));
  }
}

// Garante que o content.js está presente antes de tabs.sendMessage, evitando o
// erro "Could not establish connection. Receiving end does not exist.".
async function ensureContentScript(tabId) {
  const ping = async () => chrome.tabs.sendMessage(tabId, { __to: 'wamd:content', payload: { type: 'ping' } });

  try {
    await ping();
    return true;
  } catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch (_) {}

    await new Promise(r => setTimeout(r, 150));

    try {
      await ping();
      return true;
    } catch (_) {
      return false;
    }
  }
}

async function sendToPage(message) {
  const tab = await getActiveTab();
  await ensureInjected(tab.id);

  const ok = await ensureContentScript(tab.id);
  if (!ok) {
    log('Sem comunicação com a página. Recarregue o WhatsApp Web.');
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { __to: 'wamd:content', payload: message });
    return true;
  } catch (err) {
    const ok2 = await ensureContentScript(tab.id);
    if (ok2) {
      await chrome.tabs.sendMessage(tab.id, { __to: 'wamd:content', payload: message });
      return true;
    }
    log('Erro ao enviar o comando: ' + (err?.message || String(err)));
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.__from !== 'wamd:content') return;
  const data = msg.payload || {};

  if (data.type === 'wa:log') {
    log(data.message);
  } else if (data.type === 'wa:progress') {
    const { done, total } = data;
    if (total > 0) {
      const pct = Math.min(100, Math.round((done / total) * 100));
      bar.style.width = pct + '%';
    }
  } else if (data.type === 'inpage:resp' && data.cmd === 'listChats') {
    const chats = Array.isArray(data.payload) ? data.payload : [];
    chatSel.innerHTML = '';

    for (const c of chats) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.id})`;
      chatSel.appendChild(opt);
    }
    chatSel.disabled = false;
    log(`${chats.length} conversa(s) encontrada(s).`);
  } else if (data.type === 'inpage:resp' && data.cmd === 'getStats') {
    displayStats(data.payload || {});
  } else if (data.type === 'inpage:error') {
    log('Erro: ' + data.error);
  } else if (data.type === 'inpage:resp' && data.cmd === 'download') {
    const { count, chats } = data.payload || { count: 0, chats: 0 };
    log(`Concluído: ${count} item(ns) de ${chats || 1} conversa(s).`);
    bar.style.width = '100%';
    setTimeout(() => { progWrap.style.display = 'none'; bar.style.width = '0%'; }, 700);
  }

  sendResponse?.({ ok: true });
});

function getTypes() {
  return Array.from(document.querySelectorAll('.t:checked')).map(x => x.value);
}

D('#filterAll')?.addEventListener('click', () => {
  document.querySelectorAll('.t').forEach(cb => { cb.checked = true; });
});
D('#filterVideosOnly')?.addEventListener('click', () => {
  document.querySelectorAll('.t').forEach(cb => { cb.checked = (cb.value === 'video'); });
});

function displayStats(stats) {
  if (!stats || !stats.dateRange) {
    statsSection.style.display = 'none';
    return;
  }

  statsSection.style.display = 'block';
  statDateRange.textContent = stats.dateRange;
  statMediaCount.textContent = stats.totalMedia || 0;
  statImages.textContent = stats.images || 0;
  statVideos.textContent = stats.videos || 0;
  statAudio.textContent = stats.audio || 0;
  statDocuments.textContent = stats.documents || 0;
  if (statLinks) statLinks.textContent = stats.links || 0;

  log(`${stats.totalMedia || 0} mídia(s) e ${stats.links || 0} link(s).`);
}

async function loadChatStats() {
  const ids = getSelectedChatIds();
  if (ids.length !== 1) {
    // As estatísticas detalhadas só fazem sentido para uma conversa por vez.
    statsSection.style.display = 'none';
    return;
  }

  log('Carregando estatísticas…');
  await sendToPage({
    __from: 'wamd:inpage',
    type: 'popup:cmd',
    cmd: 'getStats',
    payload: { selectedChatId: ids[0] }
  });
}

chatSel.addEventListener('change', () => { loadChatStats().catch(e => log('Erro: ' + e.message)); });

closeStatsBtn?.addEventListener('click', () => {
  statsSection.style.display = 'none';
  log('Estatísticas ocultadas.');
});

// "Carregar mais mensagens": pede ao WhatsApp Web que busque o histórico mais
// antigo, em 5 rodadas seguidas. Funciona com uma conversa por vez.
loadMoreBtn?.addEventListener('click', async () => {
  const ids = getSelectedChatIds();
  if (ids.length !== 1) {
    log('Selecione apenas uma conversa.');
    return;
  }
  const selectedChatId = ids[0];

  const totalLoads = 5;
  log(`Carregando histórico (${totalLoads} rodadas)…`);
  loadMoreBtn.disabled = true;

  try {
    for (let i = 1; i <= totalLoads; i++) {
      loadMoreBtn.textContent = `Carregando ${i}/${totalLoads}…`;

      const enviado = await sendToPage({
        __from: 'wamd:inpage',
        type: 'popup:cmd',
        cmd: 'loadMore',
        payload: { selectedChatId }
      });
      if (!enviado) break;

      await new Promise(r => setTimeout(r, 6000));
      await loadChatStats();
    }
    log('Histórico carregado.');
  } catch (e) {
    log('Erro ao carregar o histórico: ' + (e?.message || e));
  } finally {
    // O botão sempre volta ao estado normal, mesmo se algo falhar.
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Carregar mais mensagens';
  }
});

async function refreshChats() {
  chatSel.disabled = true;
  chatSel.innerHTML = '<option value="">Carregando conversas…</option>';
  await sendToPage({ __from: 'wamd:inpage', type: 'popup:ready?' });
  await sendToPage({ __from: 'wamd:inpage', type: 'popup:cmd', cmd: 'listChats', payload: {} });
}

D('#refresh').addEventListener('click', () => { refreshChats().catch(e => log('Erro: ' + e.message)); });

D('#start').addEventListener('click', async () => {
  const chatIds = getSelectedChatIds();

  if (!chatIds.length) {
    log('Selecione uma conversa.');
    chatSel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    chatSel.focus({ preventScroll: true });
    chatSel.classList.add('attn');
    setTimeout(() => chatSel.classList.remove('attn'), 1200);
    return;
  }

  const types = getTypes();
  if (!types.length) {
    log('Selecione um tipo de item.');
    return;
  }

  const dateFrom = D('#dateFrom').value || '';
  const dateTo = D('#dateTo').value || '';
  // Datas no formato AAAA-MM-DD podem ser comparadas como texto.
  if (dateFrom && dateTo && dateFrom > dateTo) {
    log('Período inválido: "De" é posterior a "Até".');
    D('#dateFrom').focus();
    return;
  }

  const naming = {
    useDate: D('#useDate').checked,
    dateFormat: D('#dateFormat')?.value || FORMATO_DATA_PADRAO,
    includeSenderName: D('#includeSenderName')?.checked ?? false,
    captionSuffix: D('#useCaptionSuffix').checked,
    appendOrigNameAll: D('#appendOrigNameAll')?.checked ?? true
  };

  const pack = {
    saveAsZip: D('#saveAsZip').checked,
    preserveChatOrder: D('#preserveChatOrder')?.checked !== false,
    deepScan: !!D('#deepScan')?.checked,
    concurrency: Number(D('#concurrency')?.value) || 4,
    captureNextMessageCaption: D('#captureNextMessageCaption')?.checked !== false,
    captureReplyCaption: D('#captureReplyCaption')?.checked !== false
  };

  log(`Exportando ${chatIds.length} conversa(s)…`);
  progWrap.style.display = 'block';
  bar.style.width = '4%';

  try {
    await sendToPage({
      __from: 'wamd:inpage',
      type: 'popup:cmd',
      cmd: 'download',
      payload: { chatIds, types, dateFrom, dateTo, naming, pack }
    });
  } catch (e) {
    log('Erro ao exportar: ' + (e?.message || e));
    progWrap.style.display = 'none';
  }
});

(async () => {
  try {
    const tab = await getActiveTab();
    await ensureInjected(tab.id);
    await refreshChats();
  } catch (e) {
    log(e?.message || String(e));
  }
})();
