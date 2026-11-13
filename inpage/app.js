// WhatSave — inpage/app.js
// Versão 1.4.1 (2026-11-13): APP_VERSION atualizada para 1.4.1.
// Autor original: Jstarzz. Edição, análise e manutenção: Ruda Gabriel.
// Histórico completo das versões: CHANGELOG.md no repositório.
//
// Executado no contexto principal (MAIN world) da página do WhatsApp Web, por
// meio do WPP (wa-js). Localiza mídias e links de uma conversa, baixa os
// arquivos e os entrega à extensão (background.js), que os salva com
// chrome.downloads.
(function () {
  // Atualizada sempre que o formato das mensagens popup <-> página muda. O popup
  // compara este valor com o seu; assim, uma aba aberta antes de uma atualização
  // da extensão não continua usando um app.js antigo com um popup novo.
  const APP_VERSION = '1.4.1';

  // Evita a injeção dupla do script.
  if (window.__WAMD_APP_LOADED__) {
    window.postMessage({ __from: 'wamd:inpage', type: 'wa:log', message: 'O app.js já estava carregado.' }, '*');
    return;
  }
  window.__WAMD_APP_LOADED__ = true;
  window.__WAMD_APP_VERSION__ = APP_VERSION;

  const busSend = (type, payload) => window.postMessage({ __from: 'wamd:inpage', type, ...payload }, '*');
  const log = (m) => busSend('wa:log', { message: String(m) });

  function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`Tempo limite de ${ms} ms excedido: ${label}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  function getTimeoutForMedia(m) {
    const kind = (m.type || m.mediaType || '').toLowerCase();
    // O WhatsApp descriptografa e busca cada arquivo novamente no servidor; um vídeo
    // longo em conexão lenta pode levar bem mais de 20 s. Interromper antes do
    // tempo perderia mídias que chegariam normalmente.
    if (kind === 'video') return 45000;
    if (kind === 'document') return 20000;
    return 10000; // imagens e áudios
  }

  function getMediaStage(m) {
    const md = m?.mediaData || m?._mediaData;
    return (
      md?.__x_mediaStage ??
      md?.mediaStage ??
      md?.stage ??
      m?.__x_mediaStage ??
      m?.mediaStage ??
      m?.stage ??
      null
    );
  }

  // Verificação rápida para ignorar mensagens que sabidamente não podem ser
  // baixadas, evitando uma tentativa fadada ao erro (e o seu tempo limite).
  function isProbablyUnavailableByMessage(m) {
    const kind = (m.type || m.mediaType || '').toLowerCase();
    const md = m?.mediaData || m?._mediaData || null;

    const stage = getMediaStage(m);
    const stageUp = stage ? String(stage).toUpperCase() : '';
    if (stageUp && ['REUPLOADING', 'ERROR', 'WAITING', 'PROCESSING'].includes(stageUp)) {
      return true;
    }

    const hasKey = !!(m.mediaKey || md?.mediaKey || md?.key || md?.__x_mediaKey || md?.__x_key);
    const hasPathOrUrl = !!(
      m.directPath || md?.directPath || md?.__x_directPath ||
      m.clientUrl || md?.clientUrl || md?.url || md?.__x_clientUrl || md?.__x_url ||
      m.deprecatedMms3Url || md?.deprecatedMms3Url || md?.__x_deprecatedMms3Url
    );

    if ((kind === 'image' || kind === 'video' || kind === 'document') && (!hasKey || !hasPathOrUrl)) {
      return true;
    }

    return false;
  }

  function sanitizeFilename(s) {
    // Mantém o Unicode (inclusive acentos) intacto. A normalização NFC evita que
    // caracteres visualmente idênticos sejam gravados como sequências diferentes.
    // Caracteres de controle são removidos porque o Windows não os aceita em nomes.
    const clean = String(s || '')
      .normalize('NFC')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/gu, ' ')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .trim();
    return finalizeFilenamePart(clean, 120);
  }

  // Corta por code point (nunca parte um emoji/par substituto ao meio), remove
  // pontos/espaços finais (proibidos no Windows) e evita nomes reservados.
  function safeSlice(str, max) {
    const chars = Array.from(String(str || ''));
    return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
  }

  function finalizeFilenamePart(str, max) {
    let out = safeSlice(str, max).replace(/[\s.]+$/u, '').trim();
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(out)) out = `_${out}`;
    return out;
  }

  const senderNameCache = new Map();

  function widToString(wid) {
    if (!wid) return '';
    if (typeof wid === 'string') return wid;
    return wid._serialized || wid.serialized || wid.user || wid.id || '';
  }

  function cleanSenderFallback(value) {
    const raw = widToString(value);
    if (!raw) return '';
    const user = raw.split('@')[0].split(':')[0];
    return sanitizeFilename(user);
  }

  async function resolveSenderName(message) {
    if (!message) return '';
    if (message.fromMe || message.id?.fromMe) return 'Eu';

    const embedded = [
      message.senderObj?.formattedName,
      message.senderObj?.pushname,
      message.senderObj?.name,
      message.authorObj?.formattedName,
      message.authorObj?.pushname,
      message.authorObj?.name,
      message.contact?.formattedName,
      message.contact?.pushname,
      message.contact?.name,
      message.notifyName,
      message.pushname,
      message.senderName
    ].find(v => typeof v === 'string' && v.trim());
    if (embedded) return sanitizeFilename(embedded);

    const senderWid = message.author || message.sender || message.from || message.id?.participant || message.id?.remote;
    const senderId = widToString(senderWid);
    if (!senderId) return '';
    if (senderNameCache.has(senderId)) return senderNameCache.get(senderId);

    let resolved = '';
    try {
      const contactApi = window.WPP?.contact;
      let contact = null;
      if (typeof contactApi?.get === 'function') contact = await contactApi.get(senderId);
      else if (typeof contactApi?.getContact === 'function') contact = await contactApi.getContact(senderId);

      resolved = sanitizeFilename(
        contact?.formattedName || contact?.pushname || contact?.name || contact?.shortName || ''
      );
    } catch (e) {
      log(`resolveSenderName(): falha ao consultar o contato ${senderId}: ${e?.message || e}`);
    }

    if (!resolved) resolved = cleanSenderFallback(senderId);
    senderNameCache.set(senderId, resolved);
    return resolved;
  }

  function baseNameNoExt(name) {
    if (!name) return '';
    const base = String(name).split(/[\\/]/).pop();
    return base.replace(/\.[a-z0-9]{1,10}$/i, '');
  }

  function extFromFilename(name) {
    if (!name) return '';
    const m = String(name).match(/\.([a-z0-9]{1,10})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function extFromMime(mime) {
    const m = (mime || '').toLowerCase();
    if (!m) return '';
    if (m.includes('jpeg')) return 'jpg';
    if (m.includes('png')) return 'png';
    if (m.includes('gif')) return 'gif';
    if (m.includes('webp')) return 'webp';
    if (m.includes('mp4')) return 'mp4';
    if (m.includes('ogg') || m.includes('opus')) return 'ogg';
    if (m.includes('mpeg') && m.includes('audio')) return 'mp3';
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('zip')) return 'zip';
    if (m.includes('rar')) return 'rar';
    if (m.includes('7z')) return '7z';
    if (m.includes('csv')) return 'csv';
    if (m.includes('plain')) return 'txt';
    if (m.includes('json')) return 'json';
    if (m.includes('msword')) return 'doc';
    if (m.includes('vnd.openxmlformats-officedocument.wordprocessingml')) return 'docx';
    if (m.includes('vnd.ms-excel')) return 'xls';
    if (m.includes('vnd.openxmlformats-officedocument.spreadsheetml')) return 'xlsx';
    if (m.includes('vnd.ms-powerpoint')) return 'ppt';
    if (m.includes('vnd.openxmlformats-officedocument.presentationml')) return 'pptx';
    return '';
  }

  /** Melhor extensão disponível: nome original > tipo MIME > tipo da mensagem. */
  function resolveExt({ message, mime, kind }) {
    const origName = message?.filename || message?.fileName || message?.title || message?.name || '';
    let ext = extFromFilename(origName);
    if (ext) return ext;

    ext = extFromMime(mime);
    if (ext) return ext;

    if ((kind === 'ptt' || kind === 'audio') && (!mime || /opus|ogg/.test(mime || ''))) return 'ogg';
    if (kind === 'document') return 'bin';

    return '';
  }

  function makeFilename({ chatName, senderName, ts, index, mime, caption, extHint, naming, message, kind }) {
    const pad = (n) => String(n).padStart(2, '0');
    let datePart = '';
    if (naming?.useDate) {
      const d = new Date((ts || Math.floor(Date.now() / 1000)) * 1000);
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
      datePart = `_${formats[naming?.dateFormat] || formats['YYYY-MM-DD_HH-mm-ss']}`;
    }

    let suffix = '';
    if (naming?.captionSuffix && caption) {
      const cap = sanitizeFilename(caption);
      if (cap) suffix += `_${cap}`;
    }

    if (naming?.appendOrigNameAll) {
      const orig = message?.filename || message?.fileName || message?.title || message?.name || '';
      const baseOrig = sanitizeFilename(baseNameNoExt(orig)).slice(0, 80);
      if (baseOrig && !suffix.includes(baseOrig)) suffix += `_${baseOrig}`;
    }

    let senderPart = '';
    if (naming?.includeSenderName && senderName) {
      const safeSender = sanitizeFilename(senderName).slice(0, 60);
      if (safeSender) senderPart = `_${safeSender}`;
    }

    const numberPart = String(index).padStart(4, '0');
    // O número sequencial vem primeiro para que o Explorador do Windows ordene os
    // arquivos exatamente na ordem do chat, sem classificação personalizada.
    const base = `${numberPart}_${sanitizeFilename(chatName || 'Chat')}${senderPart}${datePart}${suffix}`;
    const ext = extHint || resolveExt({ message, mime, kind });
    return base + (ext ? '.' + ext : '');
  }

  // --- Prontidão, baseada nas APIs efetivamente usadas ---
  // Em algumas versões do wa-js, WPP.webpack.isReady() continua falso mesmo com
  // WPP.chat totalmente utilizável, o que acrescentava 8 s a cada comando. Por
  // isso, a verificação consulta diretamente as APIs necessárias.
  let wppReadyConfirmed = false;

  async function ensureReady(timeoutMs = 2500) {
    const hasRequiredApis = () => {
      const W = window.WPP;
      return !!(W && W.chat && typeof W.chat.list === 'function' && typeof W.chat.getMessages === 'function');
    };

    if (wppReadyConfirmed && hasRequiredApis()) return true;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (hasRequiredApis()) {
        wppReadyConfirmed = true;
        return true;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    log('ensureReady(): as APIs do WPP.chat ainda não estão disponíveis; a operação continuará assim mesmo.');
    return false;
  }

  async function listChats() {
    await ensureReady();
    try {
      const list = await window.WPP.chat.list();
      return (list || []).map(c => ({
        id: c?.id?._serialized || c?.id || '',
        name: c?.formattedTitle || c?.contact?.pushname || c?.contact?.name || c?.name || c?.id?.user || 'Chat'
      }));
    } catch (e) {
      log('listChats(): erro: ' + (e?.message || e));
      return [];
    }
  }

  function msgChatSerialized(m) {
    const r = m?.id?.remote || m?.id?._remote;
    const rs = r?._serialized || (typeof r === 'string' ? r : '');
    return rs || m?.chatId || m?.chat?.id?._serialized || m?.chat?.id || '';
  }

  async function getChatStats(chatId) {
    await ensureReady();
    try {
      let msgs = null;
      try {
        msgs = await window.WPP.chat.getMessages(chatId, { count: 10000 });
      } catch (e1) {
        log('getChatStats(): getMessages(10000) falhou; nova tentativa com 3000: ' + (e1?.message || e1));
        try {
          msgs = await window.WPP.chat.getMessages(chatId, { count: 3000 });
        } catch (e2) {
          log('getChatStats(): getMessages(3000) falhou; nova tentativa com os valores padrão: ' + (e2?.message || e2));
          msgs = await window.WPP.chat.getMessages(chatId);
        }
      }

      if (msgs && msgs.length) {
        const mismatched = msgs.filter(m => {
          const c = msgChatSerialized(m);
          return c && c !== chatId;
        });

        // Se o wa-js ainda não inicializou esta conversa, pode devolver mensagens de
        // outra; a conversa é aberta uma vez e a leitura é repetida.
        if (mismatched.length && mismatched.length > Math.floor(msgs.length * 0.6)) {
          try {
            if (window.WPP?.chat?.openChatBottom) await window.WPP.chat.openChatBottom(chatId);
            else if (window.WPP?.chat?.openChatAt) await window.WPP.chat.openChatAt(chatId);
            await new Promise(r => setTimeout(r, 250));
            msgs = await window.WPP.chat.getMessages(chatId, { count: 5000 });
          } catch (e3) {
            log('getChatStats(): a nova tentativa após abrir a conversa falhou: ' + (e3?.message || e3));
          }
        }

        msgs = msgs.filter(m => {
          const c = msgChatSerialized(m);
          return !c || c === chatId;
        });
      }

      // A contagem de links usa o mesmo histórico da conversa selecionada usado na
      // exportação, sem depender da consulta media='url' do wa-js, que é
      // inconsistente entre versões do WhatsApp Web.

      if (!msgs || msgs.length === 0) {
        return { dateRange: 'Nenhuma mensagem carregada', totalMedia: 0, links: 0, totalItems: 0, images: 0, videos: 0, audio: 0, documents: 0 };
      }

      // Registra os links da conversa exibida antes de classificar as mensagens.
      collectDomLinkCache(true);

      const mediaMessages = msgs.filter(m => {
        const kind = (m.type || m.mediaType || '').toLowerCase();
        return m.isMedia || m.isMMS || !!m.mediaKey || !!m.mediaData ||
          ['image', 'video', 'ptt', 'audio', 'document', 'sticker'].includes(kind);
      });
      const linkMessages = msgs.filter(isLinkMessage);

      let images = 0, videos = 0, audio = 0, documents = 0;
      mediaMessages.forEach(m => {
        const kind = (m.type || m.mediaType || '').toLowerCase();
        if (kind === 'image') images++;
        else if (kind === 'video') videos++;
        else if (kind === 'ptt' || kind === 'audio') audio++;
        else if (kind === 'document') documents++;
      });

      let oldestDate = null, newestDate = null;
      msgs.forEach(m => {
        const ts = m.t || m.timestamp || 0;
        if (ts > 0) {
          if (!oldestDate || ts < oldestDate) oldestDate = ts;
          if (!newestDate || ts > newestDate) newestDate = ts;
        }
      });

      let dateRange = 'Desconhecido';
      if (oldestDate && newestDate) {
        const formatDate = (ts) => {
          const d = new Date(ts * 1000);
          return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        };
        dateRange = `${formatDate(oldestDate)} - ${formatDate(newestDate)}`;
      }

      return { dateRange, totalMedia: mediaMessages.length, links: linkMessages.length, totalItems: mediaMessages.length + linkMessages.length, images, videos, audio, documents };
    } catch (e) {
      log('getChatStats(): erro: ' + (e?.message || e));
      return { dateRange: 'Erro ao carregar as estatísticas', totalMedia: 0, links: 0, totalItems: 0, images: 0, videos: 0, audio: 0, documents: 0 };
    }
  }

  // Localiza o contêiner rolável da lista de mensagens. O wa-js (getMessages) só
  // lê o armazenamento local do WhatsApp; para alcançar mensagens mais antigas é
  // preciso fazer a própria lista virtualizada do WhatsApp buscá-las no servidor,
  // pois não há API pública do wa-js para isso. A busca é estrutural, e não por
  // nome de classe, porque as classes do WhatsApp Web mudam entre versões.
  function findScrollContainer() {
    const candidates = [
      document.querySelector('[role="application"]'),
      ...document.querySelectorAll('div')
    ].filter(Boolean);

    let best = null;
    for (const el of candidates) {
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    return best;
  }

  function findLoadEarlierButton() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      const text = (btn.textContent || '').trim();

      // O botão de carregar mensagens anteriores fica perto do topo do painel e tem
      // um rótulo longo, em forma de frase (traduzido conforme o idioma; por isso a
      // busca considera o formato e a posição, e não o texto exato).
      if (rect.top >= 0 && rect.top < 400 && text.length > 35 && text.length < 150) {
        const lower = text.toLowerCase();
        const excluded = ['call', 'video', 'menu', 'search', 'emoji', 'attach', 'send'];
        if (!excluded.some(kw => lower.includes(kw))) return btn;
      }
    }
    return null;
  }

  async function loadMoreMessages(chatId) {
    await ensureReady();
    try {
      try {
        await window.WPP.chat.openChatBottom(chatId);
      } catch (e) {
        await window.WPP.chat.openChatAt(chatId);
      }
      await new Promise(r => setTimeout(r, 500));

      const scrollContainer = findScrollContainer();
      if (!scrollContainer) {
        log('loadMoreMessages(): a lista rolável de mensagens não foi encontrada.');
        return { ok: false, error: 'Lista rolável de mensagens não encontrada' };
      }

      // Rola até o topo em etapas, dando tempo ao WhatsApp para carregar o histórico,
      // em vez de ir diretamente para scrollTop = 0.
      for (let i = 0; i < 10; i++) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - 500);
        await new Promise(r => setTimeout(r, 200));
      }
      scrollContainer.scrollTop = 0;

      // Mantém a lista presa ao topo por alguns instantes, enquanto o WhatsApp carrega.
      let scrollLocked = true;
      const lockScroll = () => { if (scrollLocked) scrollContainer.scrollTop = 0; };
      scrollContainer.addEventListener('scroll', lockScroll);
      let loadMoreBtn = null;
      try {
        await new Promise(r => setTimeout(r, 1500));
        scrollContainer.scrollTop = 0;
        await new Promise(r => setTimeout(r, 500));
        loadMoreBtn = findLoadEarlierButton();
      } finally {
        // A trava de rolagem é sempre liberada, mesmo se algo falhar acima.
        scrollLocked = false;
        scrollContainer.removeEventListener('scroll', lockScroll);
      }

      if (!loadMoreBtn) {
        return { ok: true, clicked: false, message: 'Botão de carregar mensagens anteriores não encontrado (todo o histórico pode já estar carregado).' };
      }

      if (!document.contains(loadMoreBtn)) {
        return { ok: false, error: 'O botão desapareceu antes de ser clicado' };
      }

      try {
        loadMoreBtn.click();
      } catch (e) {
        loadMoreBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      }

      await new Promise(r => setTimeout(r, 3000));
      return { ok: true, clicked: true };
    } catch (e) {
      log('loadMoreMessages(): erro: ' + (e?.message || e));
      return { ok: false, error: e.message };
    }
  }

  function withinRange(ts, from, to) {
    if (from != null && ts < from) return false;
    if (to != null && ts > to) return false;
    return true;
  }

  function dayRangeToEpochSeconds(dateStr) {
    if (!dateStr) return { start: undefined, end: undefined };
    const [y, m, d] = String(dateStr).split('-').map(Number);
    // Data malformada não pode virar NaN (o filtro deixaria tudo passar).
    if (![y, m, d].every(Number.isFinite) || m < 1 || m > 12 || d < 1 || d > 31) {
      return { start: undefined, end: undefined };
    }
    const start = Math.floor(new Date(y, m - 1, d, 0, 0, 0, 0).getTime() / 1000);
    const end = Math.floor(new Date(y, m - 1, d, 23, 59, 59, 999).getTime() / 1000);
    return { start, end };
  }

  // Converte o intervalo do popup em segundos. Datas invertidas são trocadas,
  // para que "De" posterior a "Até" não resulte em exportação vazia.
  function intervaloDatas(dateFrom, dateTo) {
    let from = dateFrom ? dayRangeToEpochSeconds(dateFrom).start : undefined;
    let to = dateTo ? dayRangeToEpochSeconds(dateTo).end : undefined;
    if (from != null && to != null && from > to) {
      const inicio = dayRangeToEpochSeconds(dateTo).start;
      const fim = dayRangeToEpochSeconds(dateFrom).end;
      from = inicio;
      to = fim;
    }
    return { from, to };
  }

  // --- Recuperação de legendas ------------------------------------------------
  // Fontes de legenda, em ordem de prioridade:
  //   1) legenda/corpo já presentes na própria mensagem de mídia;
  //   2) uma resposta de texto cuja referência de citação aponta exatamente para
  //      esta mídia;
  //   3) a única mensagem imediatamente seguinte na ordem do chat, apenas quando
  //      os metadados de ordem comprovam a adjacência.
  //
  // Importante: a regra da mensagem seguinte NÃO procura mensagens posteriores e
  // não se baseia apenas no horário, que pode ser idêntico ou impreciso demais
  // para comprovar adjacência. Sem um critério confiável de desempate (ordem na
  // tela, sequence ou rowId), nenhuma legenda é atribuída. A precisão tem
  // prioridade sobre suposições.
  const STANDALONE_CAPTION_MAX_GAP_SECONDS = 15;

  function safeRead(obj, key) {
    try { return obj?.[key]; } catch (_) { return undefined; }
  }

  function candidateString(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    const directKeys = ['_serialized', 'serialized', 'id', 'stanzaId', 'stanzaID', 'messageId', 'msgId'];
    for (const key of directKeys) {
      const v = safeRead(value, key);
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function extractReplyTargetIds(message) {
    const ids = new Set();
    if (!message) return [];

    // Lê apenas campos que identificam semanticamente a mensagem citada. Todo
    // acesso é protegido, porque algumas versões do WhatsApp lançam erro ao
    // inspecionar uma mensagem que não é resposta.
    const scalarKeys = [
      'quotedStanzaID', 'quotedStanzaId',
      '__x_quotedStanzaID', '__x_quotedStanzaId'
    ];
    for (const key of scalarKeys) {
      const value = candidateString(safeRead(message, key));
      if (value) ids.add(value);
    }

    for (const keyName of ['quotedMsgId', 'quotedMessageId', 'replyToMsgId', 'replyToMessageId', 'quotedMsgKey', 'quotedMessageKey']) {
      const raw = safeRead(message, keyName);
      const direct = candidateString(raw);
      if (direct) ids.add(direct);
      if (raw && typeof raw === 'object') {
        for (const k of ['id', '_serialized', 'serialized', 'stanzaId', 'stanzaID', 'messageId', 'msgId']) {
          const v = candidateString(safeRead(raw, k));
          if (v) ids.add(v);
        }
      }
    }

    // quotedMsg é lido com safeRead; nunca se chama um método como
    // getQuotedMsg(), que pode lançar o erro "does not have a reply".
    const quoted = safeRead(message, 'quotedMsg');
    if (quoted) {
      const direct = candidateString(quoted);
      if (direct) ids.add(direct);
      if (typeof quoted === 'object') {
        for (const k of ['id', '_serialized', 'serialized', 'stanzaId', 'stanzaID', 'messageId', 'msgId']) {
          const v = candidateString(safeRead(quoted, k));
          if (v) ids.add(v);
        }
      }
    }

    // Algumas versões expõem a chave citada bruta em quotedMsgPayload.
    const payload = safeRead(message, 'quotedMsgPayload');
    if (typeof payload === 'string' && payload.trim()) {
      try {
        const parsed = JSON.parse(payload);
        const stack = [parsed];
        const visited = new Set();
        let steps = 0;
        while (stack.length && steps++ < 100) {
          const node = stack.pop();
          if (!node || typeof node !== 'object' || visited.has(node)) continue;
          visited.add(node);
          for (const k of ['quotedStanzaID', 'quotedStanzaId', 'quotedMsgId', 'quotedMessageId']) {
            const v = candidateString(safeRead(node, k));
            if (v) ids.add(v);
          }
          for (const k of ['quotedMsgKey', 'quotedMessageKey']) {
            const child = safeRead(node, k);
            if (!child) continue;
            const v = candidateString(child);
            if (v) ids.add(v);
            if (typeof child === 'object') {
              for (const ck of ['id', '_serialized', 'serialized', 'stanzaId', 'stanzaID', 'messageId', 'msgId']) {
                const cv = candidateString(safeRead(child, ck));
                if (cv) ids.add(cv);
              }
            }
          }
          // Desce apenas por objetos que provavelmente fazem parte da chave citada.
          for (const k of ['quotedMsg', 'quotedMessage', 'messageKey', 'key']) {
            const child = safeRead(node, k);
            if (child && typeof child === 'object') stack.push(child);
          }
        }
      } catch (_) {}
    }

    return [...ids];
  }

  function messageStanzaId(message) {
    if (!message) return '';
    const id = safeRead(message, 'id');

    // O wa-js normalmente expõe o id puro da mensagem em id.id. Ele é preferido
    // porque o id serializado de grupo pode terminar com o id do participante,
    // que NÃO é o id da mensagem.
    const innerId = candidateString(id && typeof id === 'object' ? safeRead(id, 'id') : '');
    if (innerId) return innerId;

    const serialized = candidateString(id);
    if (!serialized) return '';

    // Formatos serializados comuns:
    //   false_<remoto>_<idDaMensagem>
    //   false_<remoto>_<idDaMensagem>_<participante>
    //   true_<remoto>_<idDaMensagem>
    // Em todos eles, o id da mensagem é o terceiro componente.
    const parts = serialized.split('_').filter(Boolean);
    if (parts.length >= 3) return parts[2];
    return serialized;
  }

  function exactKeyVariants(value) {
    // Nunca divide um id completo de mensagem em variantes pelo sublinhado: isso
    // poderia transformar o id de um participante em falsa correspondência com
    // uma resposta sem relação. Apenas o valor exato é mantido.
    const keys = new Set();
    const direct = candidateString(value);
    if (direct) keys.add(direct);
    return keys;
  }

  function mediaReplyTargetKeys(mediaMessage) {
    const keys = new Set();
    for (const v of [
      msgSerializedId(mediaMessage),
      safeRead(mediaMessage, 'id'),
      messageStanzaId(mediaMessage)
    ]) {
      for (const key of exactKeyVariants(v)) keys.add(key);
    }
    const idObj = safeRead(mediaMessage, 'id');
    if (idObj && typeof idObj === 'object') {
      for (const k of ['id', '_serialized', 'serialized', 'stanzaId', 'stanzaID', 'messageId', 'msgId']) {
        for (const key of exactKeyVariants(safeRead(idObj, k))) keys.add(key);
      }
    }
    return keys;
  }

  function replyTargetsMedia(replyMessage, mediaMessage) {
    const mediaKeys = mediaReplyTargetKeys(mediaMessage);
    if (!mediaKeys.size) return false;
    for (const target of extractReplyTargetIds(replyMessage)) {
      const variants = exactKeyVariants(target);
      for (const variant of variants) {
        if (mediaKeys.has(variant)) return true;
      }
    }
    return false;
  }

  function msgSerializedId(m) {
    if (!m) return '';
    const v = safeRead(m, 'id');
    if (typeof v === 'string') return v;
    return candidateString(v) || '';
  }

  function messageText(m) {
    const values = [safeRead(m, 'caption'), safeRead(m, 'body'), safeRead(m, 'text')];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function normalizedCompareText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function mediaFilenameCandidates(m) {
    if (!m) return [];
    const values = [];
    const push = (v) => {
      if (typeof v === 'string' && v.trim()) values.push(v.trim());
    };
    for (const key of ['filename', 'fileName', 'title', 'name', 'displayName', 'documentName']) {
      push(safeRead(m, key));
    }
    for (const carrierKey of ['mediaData', '_mediaData', 'document', 'documentInfo', '_data']) {
      const obj = safeRead(m, carrierKey);
      if (!obj || typeof obj !== 'object') continue;
      for (const key of ['filename', 'fileName', 'title', 'name', 'displayName', 'documentName']) {
        push(safeRead(obj, key));
      }
    }
    return [...new Set(values)];
  }

  function normalizeFilenameForCompare(value) {
    let s = String(value || '').normalize('NFKC').trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
    // Algumas versões do WhatsApp Web repetem a extensão do documento entre
    // `body`, `title` e `filename`. Extensões repetidas conhecidas são unificadas
    // para que o nome do arquivo continue sendo reconhecido.
    for (let i = 0; i < 3; i++) {
      const before = s;
      s = s.replace(/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv)(?:\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv))+$/i, '.$1');
      if (s === before) break;
    }
    return s;
  }

  function isDocumentFilenameMetadata(text, m, kind) {
    if (typeof text !== 'string' || !text.trim()) return false;
    const candidates = mediaFilenameCandidates(m);
    if (!candidates.length) return false;
    const bodyNorm = normalizeFilenameForCompare(text);
    return candidates.some(v => normalizeFilenameForCompare(v) === bodyNorm);
  }

  // IMPORTANTE: em documentos, o WhatsApp pode expor o nome do arquivo em
  // `caption` OU em `body`, mesmo sem legenda escrita pelo usuário. Esse nome
  // nunca pode virar sufixo de legenda. Só conta uma legenda explícita que
  // seja diferente de todos os metadados de nome de arquivo.
  function getOwnMediaCaption(m) {
    if (!m || !isMediaMessage(m)) return '';

    const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
    const filenameCandidates = mediaFilenameCandidates(m);

    // Campos explícitos de legenda têm prioridade, exceto quando o WhatsApp os
    // preencheu com o próprio nome do documento.
    for (const key of ['caption', '__x_caption', 'mediaCaption', '__x_mediaCaption']) {
      const value = safeRead(m, key);
      if (typeof value !== 'string' || !value.trim()) continue;
      const clean = value.trim();
      if (isDocumentFilenameMetadata(clean, m, kind)) continue;
      // Em documentos, também rejeita uma legenda com formato de nome de arquivo
      // idêntica ao título/nome conhecido, mesmo vinda de outro campo.
      if (kind === 'document' && filenameCandidates.length && filenameCandidates.some(v => normalizeFilenameForCompare(v) === normalizeFilenameForCompare(clean))) continue;
      return clean;
    }

    const body = safeRead(m, 'body');
    if (typeof body !== 'string' || !body.trim()) return '';
    const cleanBody = body.trim();

    // Se o corpo é o nome do documento, trata-se de metadado, e não de legenda.
    if (filenameCandidates.some(v => normalizedCompareText(v) === normalizedCompareText(cleanBody))) return '';
    if (isDocumentFilenameMetadata(cleanBody, m, kind)) return '';

    // Em documentos, não usa um corpo com formato de nome de arquivo quando o
    // WhatsApp não forneceu um campo de legenda confiável. Uma legenda como
    // "Documentos do mês" continua aceita; o nome do arquivo, não.
    if (kind === 'document' && /\.[a-z0-9]{1,8}$/i.test(cleanBody)) return '';

    // Em imagens, vídeos, áudios e figurinhas, algumas versões guardam a legenda real em body.
    return cleanBody;
  }

  function isMediaMessage(m) {
    if (!m) return false;
    const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
    return !!safeRead(m, 'isMedia') || !!safeRead(m, 'isMMS') || !!safeRead(m, 'mediaKey') || !!safeRead(m, 'mediaData') ||
      ['image', 'video', 'ptt', 'audio', 'document', 'sticker'].includes(kind);
  }

  function isPlainTextMessage(m) {
    if (!m || isMediaMessage(m)) return false;
    const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
    if (safeRead(m, 'isNotification') || safeRead(m, 'isEvent') || safeRead(m, 'isNotificationMessage')) return false;

    // O WhatsApp/wa-js usou vários nomes para mensagens de texto comuns (chat,
    // extendedTextMessage, conversation etc.). Em vez de limitar a recuperação a
    // alguns nomes históricos, são rejeitadas as classes de sistema conhecidas e
    // exige-se texto real.
    const systemType = /(notification|protocol|revoked|ciphertext|call[_-]?log|e2e|group[_-]?notification|reaction|status|live[_-]?location)/i;
    if (kind && systemType.test(kind)) return false;
    return !!messageText(m);
  }

  // --- Suporte a mensagens com links -------------------------------------------
  // Um item de link é uma mensagem sem mídia que contém um ou mais endereços.
  // É exportado como arquivo .txt em UTF-8; o primeiro endereço também entra no
  // nome do arquivo, em forma legível e compatível com o Windows.
  const URL_RE = /https?:\/\/[^\s<>\"'`]+|www\.[^\s<>\"'`]+/gi;

  function normalizeLinkCandidate(raw) {
    if (typeof raw !== 'string') return '';
    let value = raw.trim();
    if (!value) return '';
    // Remove a pontuação que costuma acompanhar um endereço em textos comuns.
    value = value.replace(/[.,!?;:]+$/g, '');
    while (/[)\]}]$/.test(value)) {
      const last = value[value.length - 1];
      const opens = last === ')' ? '(' : last === ']' ? '[' : '{';
      const body = value.slice(0, -1);
      const balance = (body.match(new RegExp('\\' + opens, 'g')) || []).length;
      const closes = (body.match(new RegExp('\\' + (last), 'g')) || []).length;
      if (closes >= balance) value = body; else break;
    }
    return value;
  }

  function addUrlsFromText(text, out) {
    if (typeof text !== 'string' || !text.trim()) return;
    const matches = text.match(URL_RE) || [];
    for (const raw of matches) {
      const normalized = normalizeLinkCandidate(raw);
      if (!normalized) continue;
      const url = /^www\./i.test(normalized) ? `https://${normalized}` : normalized;
      if (!out.includes(url)) out.push(url);
    }
  }

  function addUrlsFromObject(value, out, depth = 0, seen = new Set()) {
    if (!value || depth > 4 || seen.has(value)) return;
    if (typeof value === 'string') { addUrlsFromText(value, out); return; }
    if (typeof value !== 'object') return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 20)) addUrlsFromObject(item, out, depth + 1, seen);
      return;
    }
    const candidateKeys = [
      'url', 'canonicalUrl', 'matchedText', 'href', 'link', 'sourceUrl',
      'urlText', 'urlNumber', 'canonical_url', 'matched_text', 'externalAdReply',
      'linkPreview', 'linkPreviewObj', 'links', 'quotedAd',
      '__x_url', '__x_urlText', '__x_canonicalUrl', '__x_matchedText', '__x_linkPreview'
    ];
    for (const key of candidateKeys) {
      const child = safeRead(value, key);
      if (typeof child === 'string') addUrlsFromText(child, out);
      else if (child && typeof child === 'object') addUrlsFromObject(child, out, depth + 1, seen);
    }
  }

  // Cache de links do DOM: algumas versões do WhatsApp Web exibem um link
  // clicável no balão, mas não o expõem no objeto de mensagem do wa-js. Os
  // links encontrados no DOM são guardados pelo id serializado exato da
  // mensagem; como esse id inclui a conversa, não há mistura entre conversas.
  const DOM_LINK_CACHE = new Map();

  function domMessageIdsFromNode(node) {
    const ids = new Set();
    let cur = node;
    let hops = 0;
    while (cur && hops++ < 8) {
      try {
        const raw = cur.getAttribute?.('data-id');
        if (raw) ids.add(raw);
        const alt = cur.getAttribute?.('data-message-id');
        if (alt) ids.add(alt);
      } catch (_) {}
      cur = cur.parentElement;
    }
    return [...ids];
  }

  // Varrer o DOM inteiro é caro; sem `force`, no máximo uma varredura por
  // segundo (antes era uma por mensagem sem link → travava em chats grandes).
  let domLinkCacheAt = 0;
  function collectDomLinkCache(force = false) {
    if (typeof document === 'undefined') return 0;
    const now = Date.now();
    if (!force && now - domLinkCacheAt < 1000) return 0;
    domLinkCacheAt = now;
    let added = 0;
    try {
      const anchors = document.querySelectorAll('a[href], a[role="link"], [data-id] a');
      for (const a of anchors) {
        const hrefRaw = a?.getAttribute?.('href') || a?.href || '';
        const text = a?.textContent || '';
        const urls = [];
        addUrlsFromText(hrefRaw, urls);
        addUrlsFromText(text, urls);
        if (!urls.length) continue;

        for (const rawId of domMessageIdsFromNode(a)) {
          if (!rawId) continue;
          const keySet = new Set([rawId]);
          const stanza = messageStanzaId({ id: rawId });
          if (stanza) keySet.add(`stanza:${stanza}`);
          for (const key of keySet) {
            const bucket = DOM_LINK_CACHE.get(key) || new Set();
            const before = bucket.size;
            for (const u of urls) bucket.add(u);
            DOM_LINK_CACHE.set(key, bucket);
            added += bucket.size - before;
          }
        }
      }
    } catch (e) {
      log(`collectDomLinkCache(): ${e?.message || e}`);
    }
    return added;
  }

  function getCachedDomLinksForMessage(m, out) {
    if (!m || !out) return;
    const candidates = [
      msgSerializedId(m),
      messageStanzaId(m) ? `stanza:${messageStanzaId(m)}` : ''
    ].filter(Boolean);
    for (const key of candidates) {
      const bucket = DOM_LINK_CACHE.get(key);
      if (!bucket) continue;
      for (const url of bucket) if (!out.includes(url)) out.push(url);
    }
  }

  let domNodeIndex = null;
  let domNodeIndexAt = 0;
  function getDomNodeIndex() {
    const now = Date.now();
    if (domNodeIndex && now - domNodeIndexAt < 1000) return domNodeIndex;
    const bySerialized = new Map();
    const byStanza = new Map();
    for (const node of document.querySelectorAll('[data-id]')) {
      const raw = node?.getAttribute?.('data-id') || '';
      if (!raw) continue;
      if (!bySerialized.has(raw)) bySerialized.set(raw, node);
      const st = messageStanzaId({ id: raw });
      if (st && !byStanza.has(st)) byStanza.set(st, node);
    }
    domNodeIndex = { bySerialized, byStanza };
    domNodeIndexAt = now;
    return domNodeIndex;
  }

  function extractDomLinksForMessage(m, out) {
    if (!m || typeof document === 'undefined' || !out) return;
    try {
      const serialized = msgSerializedId(m);
      const stanza = messageStanzaId(m);
      if (!serialized && !stanza) return;

      const index = getDomNodeIndex();
      const found = (serialized && index.bySerialized.get(serialized)) || (stanza && index.byStanza.get(stanza)) || null;
      for (const node of found ? [found] : []) {

        // O WhatsApp pode exibir o endereço como link real mesmo quando o modelo da
        // mensagem não expõe os campos body/urlText/linkPreview.
        const anchors = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
        for (const a of anchors) {
          const href = a?.getAttribute?.('href') || a?.href || '';
          if (!/^https?:\/\//i.test(href)) continue;
          try {
            const parsed = new URL(href, location.href);
            if (/^https?:$/i.test(parsed.protocol) && !/^(?:web\.)?whatsapp\.com$/i.test(parsed.hostname)) {
              addUrlsFromText(parsed.href, out);
            }
          } catch (_) {
            addUrlsFromText(href, out);
          }
        }

        // Algumas prévias de link exibem o endereço como texto, sem elemento <a>.
        addUrlsFromText(node.textContent || '', out);
        break;
      }
    } catch (e) {
      log(`extractDomLinksForMessage(): ${e?.message || e}`);
    }
  }

  function extractMessageLinks(m) {
    const out = [];
    addUrlsFromText(messageText(m), out);
    // O cache do DOM é preenchido a partir dos balões exibidos e sobrevive à
    // rolagem da lista virtualizada, mantendo a associação dos links.
    getCachedDomLinksForMessage(m, out);
    const scalarKeys = [
      'urlText', 'url', 'canonicalUrl', 'matchedText', 'href', 'link', 'sourceUrl',
      '__x_urlText', '__x_url', '__x_canonicalUrl', '__x_matchedText'
    ];
    for (const key of scalarKeys) addUrlsFromText(safeRead(m, key), out);
    for (const key of [
      'linkPreview', 'linkPreviewObj', 'links', 'externalAdReply',
      '__x_linkPreview', '__x_linkPreviewObj'
    ]) {
      addUrlsFromObject(safeRead(m, key), out);
    }

    // Alternativa para versões do WhatsApp Web em que o link aparece (clicável)
    // na conversa, mas o objeto de mensagem do WPP não expõe nenhum campo de URL.
    if (!out.length) {
      collectDomLinkCache();
      getCachedDomLinksForMessage(m, out);
      if (!out.length) extractDomLinksForMessage(m, out);
    }
    return out;
  }

  function isLinkMessage(m) {
    if (!m) return false;
    if (safeRead(m, 'isNotification') || safeRead(m, 'isEvent') || safeRead(m, 'isNotificationMessage')) return false;
    const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
    // Uma mídia baixável continua sendo mídia mesmo que a legenda contenha um
    // endereço. Itens de link são mensagens de texto ou de prévia de link, e não
    // imagens, vídeos, áudios, documentos ou figurinhas.
    const mediaKinds = ['image', 'video', 'ptt', 'audio', 'document', 'sticker'];
    if (mediaKinds.includes(kind)) return false;
    const urls = extractMessageLinks(m);
    return urls.length > 0;
  }

  function linkFilenamePart(url) {
    if (!url) return 'link';
    // Preserva a ideia do endereço completo, trocando os caracteres proibidos no
    // Windows por sublinhados. Mantém caminho e parâmetros suficientes para
    // distinguir links diferentes, mas limita o tamanho no nome do arquivo.
    return sanitizeFilename(url).slice(0, 140) || 'link';
  }

  function hasDirectReplyTarget(m) {
    return extractReplyTargetIds(m).length > 0;
  }

  function messageSenderKey(m) {
    if (!m) return '';
    if (safeRead(m, 'fromMe') || safeRead(safeRead(m, 'id'), 'fromMe')) return 'me';
    return widToString(safeRead(m, 'author') || safeRead(m, 'sender') || safeRead(m, 'from') || safeRead(safeRead(m, 'id'), 'participant') || '');
  }

  function numericOrderValue(m, key) {
    const value = safeRead(m, key);
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function numericRowId(m) { return numericOrderValue(m, 'rowId'); }
  function numericSequence(m) { return numericOrderValue(m, 'sequence'); }

  function messageChatKey(m) {
    return msgChatSerialized(m) || '';
  }

  function normalizeEpochSeconds(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // O wa-js normalmente usa segundos, mas alguns objetos usam milissegundos.
    // Ambos são normalizados para que a ordenação e as datas nos nomes usem a
    // mesma linha do tempo.
    return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  function messageTimestamp(m) {
    const t = normalizeEpochSeconds(safeRead(m, 't'));
    const timestamp = normalizeEpochSeconds(safeRead(m, 'timestamp'));
    // Prefere o campo nativo `t` do WhatsApp quando ele é uma data plausível.
    if (t >= 946684800 && t <= 4102444800) return t;
    if (timestamp >= 946684800 && timestamp <= 4102444800) return timestamp;
    return t || timestamp || 0;
  }

  function assignDomOrder(messages) {
    if (!Array.isArray(messages) || !messages.length || typeof document === 'undefined') return;
    try {
      const nodes = document.querySelectorAll('[data-id]');
      const domMap = new Map();
      let pos = 0;
      for (const node of nodes) {
        const raw = node?.getAttribute?.('data-id');
        if (!raw || domMap.has(raw)) continue;
        domMap.set(raw, pos++);
      }
      if (!domMap.size) return;

      const suffixMap = new Map();
      for (const [id, p] of domMap.entries()) {
        const bare = messageStanzaId({ id });
        if (bare && !suffixMap.has(bare)) suffixMap.set(bare, p);
      }
      for (const m of messages) {
        const sid = msgSerializedId(m);
        const stanza = messageStanzaId(m);
        const p = (sid && domMap.has(sid)) ? domMap.get(sid) : (stanza && suffixMap.has(stanza) ? suffixMap.get(stanza) : null);
        if (p != null) {
          try { Object.defineProperty(m, '__wamdDomOrder', { value: p, configurable: true }); }
          catch (_) { try { m.__wamdDomOrder = p; } catch (_) {} }
        }
      }
    } catch (e) {
      log(`assignDomOrder(): ${e?.message || e}`);
    }
  }

  function compareMessages(a, b) {
    // A ordem cronológica usa primeiro o horário real da mensagem. rowId e
    // sequence podem refletir detalhes de armazenamento que não correspondem à
    // data exibida; por isso, nunca colocam uma mensagem de julho depois de uma
    // de agosto apenas por terem números maiores.
    const at = messageTimestamp(a), bt = messageTimestamp(b);
    if (at !== bt) return at - bt;

    // Quando duas mensagens têm o mesmo segundo, prefere a ordem exibida na
    // conversa, se ambas estiverem no DOM do WhatsApp. Isso resolve o caso comum
    // de uma mídia e o texto seguinte mostrarem o mesmo horário.
    const ad = Number(safeRead(a, '__wamdDomOrder'));
    const bd = Number(safeRead(b, '__wamdDomOrder'));
    if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return ad - bd;

    // Em seguida, usa os metadados de ordem do wa-js como desempate.
    const as = numericSequence(a), bs = numericSequence(b);
    if (as != null && bs != null && as !== bs) return as - bs;

    const ar = numericRowId(a), br = numericRowId(b);
    if (ar != null && br != null && ar !== br) return ar - br;

    // Último critério estável: a ordem em que as mensagens entraram na varredura.
    // Os ids de mensagem nunca são comparados como texto.
    const ao = Number(safeRead(a, '__wamdContextOrdinal'));
    const bo = Number(safeRead(b, '__wamdContextOrdinal'));
    if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
    return 0;
  }

  function isStrictlyNextMessage(media, next, ordered, mediaIndex) {
    if (!isPlainTextMessage(next)) return false;
    if (hasDirectReplyTarget(next)) return false;

    const mediaChat = messageChatKey(media);
    const nextChat = messageChatKey(next);
    if (!mediaChat || !nextChat || mediaChat !== nextChat) return false;

    const mediaSender = messageSenderKey(media);
    const nextSender = messageSenderKey(next);
    if (!mediaSender || mediaSender !== nextSender) return false;

    const mediaTs = messageTimestamp(media);
    const nextTs = messageTimestamp(next);
    if (!mediaTs || !nextTs || nextTs < mediaTs) return false;
    if (nextTs - mediaTs > STANDALONE_CAPTION_MAX_GAP_SECONDS) return false;

    // A candidata precisa ser literalmente o próximo item da sequência
    // cronológica montada com todo o contexto lido. Isso impede que uma mensagem
    // posterior seja anexada apenas porque nenhum horário mais próximo foi
    // encontrado em um lote anterior.
    if (!Array.isArray(ordered) || mediaIndex == null) return false;
    if (ordered[mediaIndex + 1] !== next) return false;

    // Com horários idênticos, exige um desempate confiável: primeiro a ordem na
    // tela do WhatsApp; depois sequence/rowId. Nunca há suposição.
    if (mediaTs === nextTs) {
      const mediaDom = Number(safeRead(media, '__wamdDomOrder'));
      const nextDom = Number(safeRead(next, '__wamdDomOrder'));
      const orderedByDom = Number.isFinite(mediaDom) && Number.isFinite(nextDom) && nextDom > mediaDom;
      const mediaSeq = numericSequence(media);
      const nextSeq = numericSequence(next);
      const mediaRow = numericRowId(media);
      const nextRow = numericRowId(next);
      const orderedBySeq = mediaSeq != null && nextSeq != null && nextSeq > mediaSeq;
      const orderedByRow = mediaRow != null && nextRow != null && nextRow > mediaRow;
      if (!orderedByDom && !orderedBySeq && !orderedByRow) return false;
    }

    return true;
  }

  function attachRecoveredCaptions(mediaMessages, allMessages, from, to, options = {}) {
    if (!mediaMessages?.length || !allMessages?.length) return;
    const captureNext = options.captureNextMessageCaption === true;
    const captureReplies = options.captureReplyCaption === true;

    const unique = new Map();
    let ordinal = 0;
    for (const m of allMessages) {
      const id = msgSerializedId(m);
      if (!id || unique.has(id)) continue;
      try {
        Object.defineProperty(m, '__wamdContextOrdinal', { value: ordinal++, configurable: true });
      } catch (_) {
        try { m.__wamdContextOrdinal = ordinal++; } catch (_) {}
      }
      unique.set(id, m);
    }

    const ordered = [...unique.values()]
      .filter(m => messageTimestamp(m) > 0)
      .sort(compareMessages);

    const indexById = new Map(ordered.map((m, i) => [msgSerializedId(m), i]));
    const usedCaptionMessageIds = new Set();

    // Começa do zero: uma legenda ausente continua ausente e nunca herda texto
    // de outra mídia ou de outro ponto da conversa.
    for (const media of mediaMessages) {
      const inline = getOwnMediaCaption(media);
      if (inline) {
        media.__wamdCaption = inline;
        media.__wamdCaptionSource = 'inline';
      } else {
        delete media.__wamdCaption;
        delete media.__wamdCaptionSource;
        delete media.__wamdCaptionMessageId;
      }
    }

    // Respostas explícitas são evidência mais forte que a proximidade. Só são
    // usadas quando o WhatsApp expõe uma referência exata a esta mídia.
    if (captureReplies) {
      // Índice construído uma única vez: id citado -> respostas de texto puro.
      // Antes, cada mídia percorria o histórico inteiro (O(mídias × mensagens)).
      const repliesByTarget = new Map();
      for (const reply of ordered) {
        if (!isPlainTextMessage(reply)) continue;
        const targets = extractReplyTargetIds(reply);
        if (!targets.length) continue;
        for (const target of targets) {
          const list = repliesByTarget.get(target) || [];
          if (!list.includes(reply)) list.push(reply);
          repliesByTarget.set(target, list);
        }
      }

      for (const media of mediaMessages) {
        if (media.__wamdCaption) continue;
        const mediaChat = messageChatKey(media);
        const mediaTs = messageTimestamp(media);
        const pool = new Set();
        for (const key of mediaReplyTargetKeys(media)) {
          for (const r of repliesByTarget.get(key) || []) pool.add(r);
        }
        if (!pool.size) continue;
        const candidates = [...pool].filter(reply => {
          const replyId = msgSerializedId(reply);
          if (!replyId || usedCaptionMessageIds.has(replyId)) return false;
          if (messageChatKey(reply) !== mediaChat) return false;
          const replyTs = messageTimestamp(reply);
          if (!replyTs || replyTs < mediaTs) return false;
          if (from != null && replyTs < from) return false;
          if (to != null && replyTs > to) return false;
          return replyTargetsMedia(reply, media);
        });

        if (!candidates.length) continue;
        candidates.sort(compareMessages);
        const reply = candidates[0];
        const text = messageText(reply);
        const replyId = msgSerializedId(reply);
        if (!text || !replyId) continue;

        media.__wamdCaption = text;
        media.__wamdCaptionSource = 'reply';
        media.__wamdCaptionMessageId = replyId;
        usedCaptionMessageIds.add(replyId);
        log(`Legenda associada por resposta direta exata -> ${msgSerializedId(media)}`);
      }
    }

    // Depois, considera a mensagem literalmente seguinte na ordem cronológica.
    // A candidata precisa estar no índice + 1; nunca se procura adiante.
    if (captureNext) {
      for (const media of mediaMessages) {
        if (media.__wamdCaption) continue;
        const mediaIndex = indexById.get(msgSerializedId(media));
        if (mediaIndex == null) continue;

        const next = ordered[mediaIndex + 1];
        if (!next) continue;
        const nextId = msgSerializedId(next);
        if (!nextId || usedCaptionMessageIds.has(nextId)) continue;
        const text = messageText(next);
        if (!text) continue;
        // Uma mensagem de texto avulsa só é aceita como texto livre. Se repetir o
        // nome do arquivo da mídia, não é anexada.
        if (isDocumentFilenameMetadata(text, media, String(safeRead(media, 'type') || safeRead(media, 'mediaType') || '').toLowerCase())) continue;

        if (!isStrictlyNextMessage(media, next, ordered, mediaIndex)) continue;
        if (!withinRange(messageTimestamp(next), from, to)) continue;

        media.__wamdCaption = text;
        media.__wamdCaptionSource = 'standalone-next';
        media.__wamdCaptionMessageId = nextId;
        usedCaptionMessageIds.add(nextId);
        log(`Legenda associada pela mensagem imediatamente seguinte -> ${msgSerializedId(media)}`);
      }
    }
  }


  // As mensagens com links vêm do mesmo histórico paginado das mídias, o que
  // mantém o mesmo recorte de conversa e de datas para todos os tipos e evita
  // versões do wa-js em que media:'url' retorna vazio ou inconsistente.

  // Percorre o histórico da conversa de trás para frente, reunindo as mensagens
  // que atendem aos tipos e ao intervalo de datas pedidos.
  async function fetchMediaMessages({ chatId, types, from, to, captureNextMessageCaption = false, captureReplyCaption = false, estimatedBatch = 200, maxBatches = 20 }) {
    const contextMessages = [];
    const seenIds = new Set();
    const wanted = new Set(types || []);
    let anchorId = '';
    let batchNo = 0;
    let noNewRepeats = 0;
    let sameAnchorRepeats = 0;
    let didOpenChat = false;

    log(`Analisando a conversa "${chatId}" (tipos: ${[...wanted].join(', ') || 'todos'})…`);

    const msgId = (m) => {
      if (typeof m === 'string') return m;
      const v = m?.id?._serialized ?? m?.id;
      return typeof v === 'string' ? v : '';
    };
    const msgTs = (m) => messageTimestamp(m);

    // IMPORTANTE: todo o contexto lido é mantido. As mensagens não são filtradas
    // durante a paginação, porque o texto logo após uma mídia pode ser a sua
    // legenda, inclusive quando cai no lote seguinte.
    while (batchNo < maxBatches) {
      batchNo++;

      const anchorSerPrev = typeof anchorId === 'string' ? anchorId : (anchorId?._serialized || '');
      const opts = {
        count: estimatedBatch,
        direction: anchorSerPrev ? 'before' : undefined,
        id: anchorSerPrev || undefined
      };

      let batch = [];
      try {
        batch = await window.WPP.chat.getMessages(chatId, opts);
      } catch (e) {
        log(`getMessages(): erro no lote nº ${batchNo}: ${e?.message || e}`);
        break;
      }

      const totalRaw = batch?.length || 0;
      if (!totalRaw) break;

      const mismatched = (batch || []).filter(m => {
        const c = msgChatSerialized(m);
        return c && c !== chatId;
      });

      if (mismatched.length) {
        batch = (batch || []).filter(m => {
          const c = msgChatSerialized(m);
          return !c || c === chatId;
        });

        if (batchNo === 1 && batch.length < Math.max(1, Math.floor(totalRaw * 0.2)) && !didOpenChat) {
          didOpenChat = true;
          try {
            if (window.WPP?.chat?.openChatBottom) await window.WPP.chat.openChatBottom(chatId);
            else if (window.WPP?.chat?.openChatAt) await window.WPP.chat.openChatAt(chatId);
            await new Promise(r => setTimeout(r, 250));

            anchorId = '';
            batchNo = 0;
            contextMessages.length = 0;
            seenIds.clear();
            noNewRepeats = 0;
            sameAnchorRepeats = 0;
            log('A conversa ainda não estava inicializada; ela foi aberta e a análise foi reiniciada.');
            continue;
          } catch (e) {
            log('Falha ao abrir a conversa durante a análise: ' + (e?.message || e));
          }
        }
      }

      if (anchorSerPrev) {
        batch = (batch || []).filter(m => msgId(m) !== anchorSerPrev);
        if (!batch.length) break;
      }

      contextMessages.push(...batch);
      // A lista virtualizada do WhatsApp troca as linhas do DOM enquanto carrega o
      // histórico. Os links visíveis são registrados a cada lote, para continuarem
      // associados à mensagem original depois que a linha sai da tela.
      collectDomLinkCache(true);

      let newIdsInBatch = 0;
      for (const m of batch) {
        const id = msgId(m);
        if (!id || seenIds.has(id)) continue;
        newIdsInBatch++;
        seenIds.add(id);
      }

      // A paginação usa sempre o horário mais antigo deste lote, pois a ordem do
      // vetor retornado não é confiável.
      let cursorMsg = batch[0];
      let cursorTs = msgTs(cursorMsg);
      for (const x of batch) {
        const t = msgTs(x);
        if (t && (!cursorTs || t < cursorTs)) { cursorMsg = x; cursorTs = t; }
      }
      if (!cursorTs) {
        cursorMsg = batch[batch.length - 1];
        cursorTs = msgTs(cursorMsg);
      }

      const cursorSer = msgId(cursorMsg);
      if (!cursorSer) break;
      anchorId = cursorSer;

      const maxTs = Math.max(...batch.map(x => msgTs(x) || 0));
      if (from && maxTs < from) break;

      if (!newIdsInBatch) {
        noNewRepeats++;
        if (noNewRepeats >= 2) break;
      } else {
        noNewRepeats = 0;
      }

      if (anchorSerPrev && anchorSerPrev === anchorId) {
        sameAnchorRepeats++;
        if (sameAnchorRepeats >= 2) break;
      } else {
        sameAnchorRepeats = 0;
      }
    }

    // Os links usam o mesmo histórico completo reunido acima e são identificados
    // depois da ordenação canônica, para que filtros e numeração sejam idênticos
    // aos das mídias.

    // Registra os links visíveis na última parte carregada antes de ordenar.
    collectDomLinkCache(true);

    // -------------------- Ordem canônica do chat --------------------
    // Monta UMA linha do tempo ordenada antes de filtrar mídias, associar legendas
    // ou numerar arquivos. Ela é a referência para todo o trabalho seguinte.
    const unique = new Map();
    let contextOrdinal = 0;
    for (const m of contextMessages) {
      const id = msgId(m);
      if (!id || unique.has(id)) continue;
      try {
        Object.defineProperty(m, '__wamdContextOrdinal', { value: contextOrdinal++, configurable: true });
      } catch (_) {
        try { m.__wamdContextOrdinal = contextOrdinal++; } catch (_) {}
      }
      unique.set(id, m);
    }

    const contextArray = [...unique.values()]
      .filter(m => messageTimestamp(m) > 0);
    // A ordem visível no DOM do WhatsApp é o desempate mais forte para mensagens
    // do mesmo segundo, especialmente mídia e legenda exibidas com o mesmo horário.
    assignDomOrder(contextArray);
    const orderedContext = contextArray.sort(compareMessages);

    orderedContext.forEach((m, i) => {
      try {
        Object.defineProperty(m, '__wamdChatOrder', { value: i, configurable: true });
      } catch (_) {
        try { m.__wamdChatOrder = i; } catch (_) {}
      }
    });

    // A lista de exportação é derivada da linha do tempo já ordenada. Nenhum item
    // recebe número antes deste ponto; assim, a numeração não depende dos lotes
    // nem da ordem de término dos downloads.
    const mediaMessages = orderedContext.filter(m => {
      if (!isMediaMessage(m)) return false;
      const ts = messageTimestamp(m);
      if (!withinRange(ts, from, to)) return false;
      const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
      const norm = kind === 'ptt' ? 'audio' : kind;
      return !(wanted.size && !wanted.has(norm) && !(wanted.has('ptt') && kind === 'ptt'));
    });

    log(`Ordem cronológica definida antes das legendas e dos downloads: ${mediaMessages.length} mídia(s).`);

    if (captureNextMessageCaption || captureReplyCaption) {
      attachRecoveredCaptions(mediaMessages, orderedContext, from, to, {
        captureNextMessageCaption,
        captureReplyCaption
      });
    }

    const captionSourceIds = new Set(mediaMessages.map(m => safeRead(m, '__wamdCaptionMessageId')).filter(Boolean));
    const wantLinks = wanted.has('link');
    const linkMessages = !wantLinks ? [] : orderedContext.filter(m => {
      if (!isLinkMessage(m)) return false;
      // Os links precisam pertencer à conversa selecionada. O contexto já veio
      // dela, e o id exato da conversa é conferido mesmo assim.
      if (messageChatKey(m) !== chatId) return false;
      if (captionSourceIds.has(msgSerializedId(m))) return false;
      const ts = messageTimestamp(m);
      if (!withinRange(ts, from, to)) return false;
      return wanted.has('link');
    });

    // Links e mídias compartilham UMA sequência cronológica de exportação; assim,
    // 0001, 0002, 0003... representam a ordem real dos itens na conversa.
    const linkSet = new Set(linkMessages);
    const exportItems = [...mediaMessages, ...linkMessages].sort(compareMessages);
    exportItems.forEach((m, i) => {
      const exportKind = linkSet.has(m) ? 'link' : 'media';
      try { Object.defineProperty(m, '__wamdExportKind', { value: exportKind, configurable: true, writable: true }); }
      catch (_) { try { m.__wamdExportKind = exportKind; } catch (_) {} }
      try { Object.defineProperty(m, '__wamdExportIndex', { value: i + 1, configurable: true, writable: true }); }
      catch (_) { try { m.__wamdExportIndex = i + 1; } catch (_) {} }
    });

    const recovered = mediaMessages.filter(m => !!m.__wamdCaption).length;
    if (recovered) log(`${recovered} legenda(s) recuperada(s) da própria mídia, de respostas diretas ou da mensagem seguinte.`);
    log(`Análise concluída: ${exportItems.length} item(ns) para exportar (${mediaMessages.length} mídia(s) e ${linkMessages.length} link(s)).`);
    return exportItems;
  }

  function patchWppDownloadMedia() {
    const W = window.WPP?.chat;
    if (!W || W.__wamdDownloadPatched) return;

    function getMediaData(msg) {
      return msg?.mediaData || msg?._mediaData || null;
    }

    // Algumas versões do WhatsApp Web têm um forceToBlob() defeituoso, que lança
    // erro em msgChunks em vez de retornar null. Ele é neutralizado para que um
    // único blob com problema não derrube o lote inteiro.
    function neutralizeBrokenBlob(msg) {
      const md = getMediaData(msg);
      if (!md) return;

      if (md.mediaBlob && !md.mediaBlob.__wamdSafePatched) {
        const origForce = typeof md.mediaBlob.forceToBlob === 'function'
          ? md.mediaBlob.forceToBlob.bind(md.mediaBlob)
          : null;

        md.mediaBlob.forceToBlob = function () {
          try {
            return origForce ? origForce() : null;
          } catch (e) {
            const emsg = String(e?.message || e || '');
            if (/msgChunks|forceToBlob|Cannot read properties of undefined/i.test(emsg)) return null;
            throw e;
          }
        };
        md.mediaBlob.__wamdSafePatched = true;
      }

      try { if (md.mediaBlob) md.mediaBlob = null; } catch {}
    }

    const origDownloadMediaMessage = typeof W.downloadMediaMessage === 'function'
      ? W.downloadMediaMessage.bind(W) : null;

    if (origDownloadMediaMessage) {
      W.downloadMediaMessage = async function (msg) {
        neutralizeBrokenBlob(msg);
        try {
          return await origDownloadMediaMessage(msg);
        } catch (e) {
          const emsg = String(e?.message || e || '');
          if (/msgChunks|forceToBlob|Cannot read properties of undefined/i.test(emsg)) {
            neutralizeBrokenBlob(msg);
            return await origDownloadMediaMessage(msg);
          }
          throw e;
        }
      };
    }

    const origDownloadMedia = typeof W.downloadMedia === 'function' ? W.downloadMedia.bind(W) : null;
    if (origDownloadMedia) {
      W.downloadMedia = async function (idOrMsg) {
        return await origDownloadMedia(idOrMsg);
      };
    }

    W.__wamdDownloadPatched = true;
  }

  async function getBlobFromMessageCaches(message, idForLog) {
    const md = message?.mediaData || message?._mediaData || null;
    if (!md) return null;

    const mimetype = md.mimetype || message?.mimetype || 'application/octet-stream';
    const filehash = md.filehash || message?.filehash || null;

    try {
      const LruMediaStore = window.LruMediaStore || window.Store?.LruMediaStore || window.WPP?.whatsapp?.LruMediaStore;
      if (filehash && LruMediaStore?.get) {
        const cachedBuffer = await LruMediaStore.get(filehash).catch(() => null);
        if (cachedBuffer) {
          const ab = cachedBuffer instanceof ArrayBuffer ? cachedBuffer
            : cachedBuffer?.buffer instanceof ArrayBuffer ? cachedBuffer.buffer : null;
          if (ab) return new Blob([ab], { type: mimetype });
        }
      }
    } catch {}

    try {
      const MediaBlobCache = window.MediaBlobCache || window.Store?.MediaBlobCache || window.WPP?.whatsapp?.MediaBlobCache;
      if (filehash && MediaBlobCache?.has?.(filehash)) {
        const blob = MediaBlobCache.get(filehash);
        if (blob) return blob;
      }
    } catch {}

    try {
      if (md.mediaBlob && typeof md.mediaBlob.forceToBlob === 'function') {
        try {
          const blob = md.mediaBlob.forceToBlob();
          if (blob) return blob;
        } catch (e) {
          const emsg = String(e?.message || e || '');
          if (/msgChunks|forceToBlob|Cannot read properties of undefined/i.test(emsg)) {
            try { md.mediaBlob = null; } catch {}
            return null;
          }
          throw e;
        }
      }
    } catch {}

    return null;
  }

  let dlFnName = null;

  async function downloadAnyMedia(message) {
    patchWppDownloadMedia();

    const W = window.WPP?.chat || {};
    const id = message?.id?._serialized || message?.id || message?._serialized || message;

    if (message && typeof message === 'object' && typeof message.downloadMedia === 'function') {
      const md = message.mediaData || message._mediaData || null;

      try {
        if (md?.mediaBlob && typeof md.mediaBlob.forceToBlob === 'function' && !md.mediaBlob.__wamdSafePatched) {
          const origForce = md.mediaBlob.forceToBlob.bind(md.mediaBlob);
          md.mediaBlob.forceToBlob = function () {
            try {
              return origForce();
            } catch (e) {
              const emsg = String(e?.message || e || '');
              if (/msgChunks|forceToBlob|Cannot read properties of undefined/i.test(emsg)) return null;
              throw e;
            }
          };
          md.mediaBlob.__wamdSafePatched = true;
        }
      } catch {}

      try { if (md?.mediaBlob) md.mediaBlob = null; } catch {}

      // Força uma busca real em vez de usar o que estiver em cache. O WhatsApp Web
      // pode manter na memória uma prévia em baixa resolução antes de obter o
      // original; usar esse blob salvaria imagens e vídeos com qualidade reduzida.
      // Chamar downloadMedia() novamente é barato quando o arquivo já está presente.
      await message.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
      await new Promise(r => setTimeout(r, 250));

      let blob = await getBlobFromMessageCaches(message, id);
      if (blob) return blob;

      await new Promise(r => setTimeout(r, 400));
      blob = await getBlobFromMessageCaches(message, id);
      if (blob) return blob;

      throw new Error(`message.downloadMedia() terminou, mas nenhum arquivo ficou em cache para ${id}`);
    }

    // Alternativa: a API de nível mais baixo, WPP.chat.
    if (!dlFnName) {
      if (typeof W.downloadMediaMessage === 'function') dlFnName = 'downloadMediaMessage(message)';
      else if (typeof W.downloadMedia === 'function') dlFnName = 'downloadMedia(id)';
      else if (typeof W.downloadMessage === 'function') dlFnName = 'downloadMessage(id)';
      else dlFnName = 'NONE';
    }

    if (dlFnName === 'downloadMediaMessage(message)') return await W.downloadMediaMessage(message);
    if (dlFnName === 'downloadMedia(id)') return await W.downloadMedia(id);
    if (dlFnName === 'downloadMessage(id)') return await W.downloadMessage(id);

    throw new Error('Nenhuma API de download de mídia está disponível nesta versão do WhatsApp Web');
  }

  async function safeDownloadBlob(m, { timeoutMs = 45000, retries = 1 } = {}) {
    const mid = m?.id?._serialized || m?.id || '';
    const kind = (m.type || m.mediaType || '').toLowerCase();

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const blob = await withTimeout(downloadAnyMedia(m), timeoutMs, `downloadAnyMedia kind=${kind} id=${mid} attempt=${attempt}`);

        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('o download retornou um arquivo inválido');
        if (typeof blob.size === 'number' && blob.size === 0) throw new Error('arquivo vazio (mídia indisponível)');

        return blob;
      } catch (e) {
        if (attempt > retries) {
          log(`Ignorado: id=${mid}, tipo=${kind} -> ${e?.message || e}`);
        }
        if (attempt <= retries) await new Promise(r => setTimeout(r, 400));
      }
    }

    return null;
  }

  // --- Ponte de download pela extensão ---------------------------------------
  // Envia o arquivo pronto para content.js -> background.js, que o salva com
  // chrome.downloads.download(). Salvar pela extensão (e não clicando em um
  // <a download> na página) evita o aviso do Chrome "este site está tentando
  // baixar vários arquivos", que só vale para downloads iniciados pela página.
  let downloadSeq = 0;
  let downloadInProgress = false;
  const pendingDownloads = new Map();

  window.addEventListener('message', (ev) => {
    // Aceita apenas mensagens da própria janela (nunca de iframes).
    if (ev.source && ev.source !== window) return;
    const { data } = ev;
    if (!data || data.__from !== 'wamd:content' || data.type !== 'wa:download:ack') return;
    const pending = pendingDownloads.get(data.id);
    if (!pending) return;
    pendingDownloads.delete(data.id);
    clearTimeout(pending.timer);
    pending.resolve(data.res);
  });

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function requestDownload({ arrayBuffer, filename, mime }, { timeoutMs = 60000 } = {}) {
    return new Promise((resolve) => {
      const id = `wamd_${Date.now()}_${++downloadSeq}`;
      const base64 = arrayBufferToBase64(arrayBuffer);

      const timer = setTimeout(() => {
        pendingDownloads.delete(id);
        resolve({ ok: false, error: 'a extensão não confirmou o salvamento a tempo' });
      }, timeoutMs);

      pendingDownloads.set(id, { resolve, timer });

      window.postMessage({
        __from: 'wamd:inpage',
        type: 'wa:download',
        id,
        payload: { base64, filename, mime }
      }, '*');
    });
  }

  // Um ZIP de conversa inteira chega facilmente a centenas de megabytes. O base64
  // da ponte da extensão aumenta o tamanho em um terço e exige uma única string,
  // o que ultrapassa o limite do motor JavaScript ("Invalid string length").
  // Por isso, o blob é entregue a um link na própria página. É um download
  // iniciado pela página, mas de um único arquivo, então o aviso de vários
  // downloads não se aplica. O Chrome ignora pastas no atributo download; por
  // isso, o arquivo é salvo na raiz da pasta Downloads.
  function saveBlobFromPage(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  async function postDownload({ arrayBuffer, filename, mime }) {
    try {
      const res = await requestDownload({ arrayBuffer, filename, mime });
      if (res?.ok) return { ok: true };
      log(`Falha ao salvar: ${filename}, ${res?.error || 'erro desconhecido'}`);
      return { ok: false, error: res?.error || 'erro desconhecido' };
    } catch (e) {
      log(`Falha ao salvar: ${filename}, ${e?.message || e}`);
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // --- Gerador de ZIP mínimo (STORE, sem compressão) ---
  const crcTable = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let crc = 0 ^ (-1);
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }

  function strToUtf8Bytes(str) { return new TextEncoder().encode(String(str).normalize('NFC')); }
  function u32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; }
  function u16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n & 0xFFFF, true); return a; }

  function concat(parts) {
    let len = 0;
    for (const p of parts) len += p.length || p.byteLength || 0;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      const u8 = p instanceof Uint8Array ? p : new Uint8Array(p);
      out.set(u8, off);
      off += u8.length;
    }
    return out;
  }

  function writeLocalHeader(nameBytes, crc, size) {
    return concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), nameBytes
    ]);
  }

  function writeCentralHeader(nameBytes, crc, size, offset) {
    return concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]);
  }

  function writeEOCD(count, cdSize, cdOffset) {
    return concat([u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(cdSize), u32(cdOffset), u16(0)]);
  }

  function makeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = strToUtf8Bytes(e.name);
      const data = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes);
      const crc = crc32(data);
      const header = writeLocalHeader(nameBytes, crc, data.length);
      // Cabeçalho e dados entram separados no Blob, sem cópia extra dos bytes.
      locals.push(header, data);
      centrals.push(writeCentralHeader(nameBytes, crc, data.length, offset));
      offset += header.length + data.length;
    }

    const cd = concat(centrals);
    const eocd = writeEOCD(entries.length, cd.length, offset);
    // Blob em partes: evita copiar todo o conteúdo para um único array.
    return new Blob([...locals, cd, eocd], { type: 'application/zip' });
  }

  // --- Fila com concorrência limitada ---
  // Executa `worker` sobre `items` com no máximo `limit` tarefas simultâneas,
  // baixando vários arquivos em paralelo sem criar trabalho ilimitado.
  async function runPool(items, worker, limit) {
    const size = Math.max(1, Math.min(Number(limit) || 4, 8));
    let cursor = 0;
    const results = new Array(items.length);

    async function runNext() {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }

    await Promise.all(Array.from({ length: Math.min(size, items.length) }, runNext));
    return results;
  }

  // --- Limites de salvamento ---
  // A troca de mensagens entre página e extensão aceita no máximo 64 MiB por
  // mensagem; em base64 o arquivo cresce cerca de 33%. Acima deste limite o
  // arquivo é salvo diretamente pela página.
  const LIMITE_PONTE_BYTES = 40 * 1024 * 1024;
  // Cada parte do ZIP fica abaixo de 1 GiB e de 65.000 itens (o formato ZIP
  // sem ZIP64 aceita no máximo 4 GiB e 65.535 entradas).
  const LIMITE_PARTE_ZIP_BYTES = 1024 * 1024 * 1024;
  const LIMITE_ITENS_ZIP = 65000;
  const PASTA_DOWNLOADS = 'WhatSave';

  function formatarTamanho(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  // --- Processamento em ordem com busca paralela ---
  // `preparar` roda em paralelo (até `limite` ao mesmo tempo), mas `consumir`
  // recebe os resultados estritamente na ordem dos itens. Os trabalhadores
  // nunca ficam mais que uma janela à frente do consumo, o que limita a
  // memória usada. Erros de um item não interrompem os demais.
  async function processarEmOrdem(itens, preparar, consumir, limite, registrar = () => {}) {
    const lista = Array.isArray(itens) ? itens : [];
    const concorrencia = Math.max(1, Math.min(Number(limite) || 4, 8));
    const janela = Math.max(concorrencia * 2, 4);
    const prontos = new Map();
    let proximoBuscar = 0;
    let proximoConsumir = 0;
    let esperando = [];
    const avisar = () => { const l = esperando; esperando = []; for (const w of l) w(); };
    const aguardar = () => new Promise(resolve => { esperando.push(resolve); });

    const trabalhador = async () => {
      for (;;) {
        while (proximoBuscar < lista.length && proximoBuscar - proximoConsumir >= janela) {
          await aguardar();
        }
        const i = proximoBuscar++;
        if (i >= lista.length) return;
        let resultado = null;
        try { resultado = await preparar(lista[i], i); }
        catch (e) { registrar(`Erro no item nº ${i + 1}: ${e?.message || e}`); }
        prontos.set(i, resultado);
        avisar();
      }
    };

    const consumidor = async () => {
      while (proximoConsumir < lista.length) {
        if (!prontos.has(proximoConsumir)) { await aguardar(); continue; }
        const resultado = prontos.get(proximoConsumir);
        prontos.delete(proximoConsumir);
        const i = proximoConsumir++;
        try { await consumir(resultado, i); }
        catch (e) { registrar(`Erro ao salvar o item nº ${i + 1}: ${e?.message || e}`); }
        avisar();
      }
    };

    await Promise.all([
      consumidor(),
      ...Array.from({ length: Math.min(concorrencia, lista.length) }, trabalhador)
    ]);
  }

  async function downloadMessages({ chatId, chatsFriendlyMap, types, from, to, naming, pack }) {
    await ensureReady();

    if (!chatId) {
      log('Nenhuma conversa selecionada.');
      return { count: 0 };
    }

    const concurrency = Math.max(1, Math.min(Number(pack?.concurrency) || 4, 8));

    const msgs = await fetchMediaMessages({
      chatId, types, from, to,
      captureNextMessageCaption: pack?.captureNextMessageCaption !== false,
      captureReplyCaption: pack?.captureReplyCaption !== false,
      estimatedBatch: pack?.deepScan ? 1000 : 700,
      maxBatches: pack?.deepScan ? 200 : 80
    });

    if (!msgs.length) {
      log('Nenhuma mídia ou link encontrado com os filtros selecionados.');
      return { count: 0 };
    }

    // msgs já chega ordenado. Essa ordem é mantida na numeração dos nomes e,
    // quando solicitado, também nos salvamentos.
    const preserveChatOrder = pack?.preserveChatOrder !== false;
    if (preserveChatOrder) {
      log('Ordem do chat preservada: os arquivos serão numerados do mais antigo para o mais recente e salvos nessa mesma ordem.');
    }

    log(`${msgs.length} item(ns) encontrado(s). Buscando até ${concurrency} por vez…`);

    const chatName = chatsFriendlyMap.get(chatId) || 'Chat';
    const chatFolder = sanitizeFilename(chatName) || 'Chat';
    const total = msgs.length;
    let processed = 0;
    let saved = 0;

    const reportProgress = () => busSend('wa:progress', { done: processed, total, saved });

    async function prepareEntry(m, i) {
      const index = i + 1;
      const mid = m?.id?._serialized || m?.id || '';
      const exportKind = safeRead(m, '__wamdExportKind') || (isLinkMessage(m) ? 'link' : 'media');
      const kind = (m.type || m.mediaType || '').toLowerCase();
      const ts = messageTimestamp(m) || Math.floor(Date.now() / 1000);

      let result = null;

      if (exportKind === 'link') {
        try {
          const links = extractMessageLinks(m);
          if (!links.length) throw new Error('o item de link não tem endereço aproveitável');
          const senderName = naming?.includeSenderName ? await resolveSenderName(m) : '';
          const primary = links[0];
          const linkPart = linkFilenamePart(primary);
          const base = `${String(index).padStart(4, '0')}_${sanitizeFilename(chatName || 'Chat')}`;
          const senderPart = naming?.includeSenderName && senderName ? `_${sanitizeFilename(senderName).slice(0, 60)}` : '';
          let datePart = '';
          if (naming?.useDate) {
            const d = new Date(ts * 1000);
            const pad = n => String(n).padStart(2, '0');
            const YYYY = String(d.getFullYear()), YY = YYYY.slice(-2), MM = pad(d.getMonth()+1), DD = pad(d.getDate()), HH = pad(d.getHours()), mm = pad(d.getMinutes()), ss = pad(d.getSeconds());
            const formats = {
              'YYYY-MM-DD_HH-mm-ss': `${YYYY}-${MM}-${DD}_${HH}-${mm}-${ss}`,
              'YYYY-MM-DD': `${YYYY}-${MM}-${DD}`,
              'DD-MM-YYYY_HH-mm-ss': `${DD}-${MM}-${YYYY}_${HH}-${mm}-${ss}`,
              'DD-MM-YYYY': `${DD}-${MM}-${YYYY}`,
              'YYYYMMDD_HHmmss': `${YYYY}${MM}${DD}_${HH}${mm}${ss}`,
              'YYYYMMDD': `${YYYY}${MM}${DD}`,
              'YYMMDD_HHmmss': `${YY}${MM}${DD}_${HH}${mm}${ss}`
            };
            datePart = `_${formats[naming?.dateFormat] || formats['YYYY-MM-DD_HH-mm-ss']}`;
          }
          const rawFilename = `${base}${senderPart}${datePart}_LINK_${linkPart}.txt`;
          // Mantém o nome final com folga abaixo do limite comum de 255 caracteres do
          // Windows, sem duplicar a extensão quando o corte não é necessário.
          const filename = Array.from(rawFilename).length <= 200 ? rawFilename : `${finalizeFilenamePart(rawFilename, 196)}.txt`;
          const text = [
            'WhatSave: exportação de link',
            '',
            ...links.map(url => `Endereço: ${url}`),
            ''
          ].join('\r\n');
          const bytes = strToUtf8Bytes(text);
          const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          result = { filename, mime: 'text/plain;charset=utf-8', arrayBuffer, bytes };
        } catch (e) {
          log(`Erro no item nº ${index}: link ${mid}, ${e?.message || e}`);
        }
      } else if (isProbablyUnavailableByMessage(m)) {
        log(`Item nº ${index} ignorado: ${mid} (${kind}), mídia não disponível por completo`);
      } else {
        try {
          const blob = await safeDownloadBlob(m, { timeoutMs: getTimeoutForMedia(m), retries: 1 });
          if (!blob) {
            // safeDownloadBlob() já registrou o motivo.
          } else {
            const arrayBuffer = await blob.arrayBuffer();
            const mime = blob.type || m.mimetype || 'application/octet-stream';
            const senderName = naming?.includeSenderName ? await resolveSenderName(m) : '';
            const filename = makeFilename({
              chatName, senderName, ts, index, mime,
              caption: m.__wamdCaption || getOwnMediaCaption(m) || '', extHint: '', naming, message: m, kind
            });
            result = { filename, mime, arrayBuffer, bytes: new Uint8Array(arrayBuffer) };
          }
        } catch (e) {
          log(`Erro no item nº ${index}: ${mid}, ${e?.message || e}`);
        }
      }

      processed++;
      reportProgress();
      return result;
    }

    const pastaBase = `${PASTA_DOWNLOADS}/${chatFolder}`;

    // Salva um arquivo individual. Acima do limite de mensagens da extensão, o
    // arquivo vai direto pela página (cai na raiz de Downloads, com o nome da
    // conversa no início para continuar identificável).
    const salvarIndividual = async (entry) => {
      const tamanho = entry.arrayBuffer?.byteLength || 0;
      if (tamanho > LIMITE_PONTE_BYTES) {
        log(`Arquivo grande (${formatarTamanho(tamanho)}): salvando diretamente pela página, na pasta Downloads. ${entry.filename}`);
        const res = saveBlobFromPage(new Blob([entry.arrayBuffer], { type: entry.mime || 'application/octet-stream' }), `${chatFolder}_${entry.filename}`);
        if (!res.ok) log(`Falha ao salvar: ${entry.filename}, ${res.error}`);
        return res.ok;
      }
      const ack = await postDownload({ arrayBuffer: entry.arrayBuffer, filename: `${pastaBase}/${entry.filename}`, mime: entry.mime });
      return !!ack?.ok;
    };

    if (pack?.saveAsZip) {
      // O ZIP é montado em partes, na ordem do chat. Cada parte respeita os
      // limites do formato ZIP sem ZIP64 e é salva assim que fica cheia, para
      // que a memória nunca precise guardar a conversa inteira de uma vez.
      let parte = [];
      let bytesParte = 0;
      let numeroParte = 0;
      let itensNoZip = 0;

      const fecharParte = async (ultima) => {
        if (!parte.length) return;
        numeroParte++;
        const sufixo = (ultima && numeroParte === 1) ? '' : `_parte${String(numeroParte).padStart(2, '0')}`;
        const zipName = `${chatFolder}_WhatSave${sufixo}.zip`;
        log(`Montando ${zipName} com ${parte.length} arquivo(s) (${formatarTamanho(bytesParte)})…`);
        const blob = makeZip(parte);
        const res = saveBlobFromPage(blob, zipName);
        if (res.ok) itensNoZip += parte.length;
        else log(`Falha ao salvar: ${zipName}, ${res.error}`);
        parte = [];
        bytesParte = 0;
      };

      await processarEmOrdem(msgs, prepareEntry, async (entry) => {
        if (!entry) return;
        const tamanho = entry.bytes?.length || 0;
        if (parte.length && (bytesParte + tamanho > LIMITE_PARTE_ZIP_BYTES || parte.length >= LIMITE_ITENS_ZIP)) {
          await fecharParte(false);
        }
        parte.push({ name: entry.filename, bytes: entry.bytes });
        bytesParte += tamanho;
      }, concurrency, log);
      await fecharParte(true);

      if (!numeroParte) {
        log('Nenhum arquivo para compactar: nenhum item pôde ser baixado.');
        return { count: 0, zip: true };
      }
      saved = itensNoZip;
      log(`Concluído: ${saved}/${total} item(ns) exportado(s) em ${numeroParte} arquivo(s) ZIP.`);
      return { count: saved, zip: true };
    }

    if (preserveChatOrder) {
      // A busca e a descriptografia continuam paralelas, mas os salvamentos
      // acontecem um a um, na ordem do chat (janela deslizante limitada).
      await processarEmOrdem(msgs, prepareEntry, async (entry) => {
        if (!entry) return;
        if (await salvarIndividual(entry)) saved++;
        reportProgress();
      }, concurrency, log);
    } else {
      await runPool(msgs, async (m, i) => {
        let entry = null;
        try { entry = await prepareEntry(m, i); }
        catch (e) { log(`Erro no item nº ${i + 1}: ${e?.message || e}`); }
        if (!entry) return;
        if (await salvarIndividual(entry)) saved++;
        reportProgress();
      }, concurrency);
    }

    log(`Concluído: ${saved}/${total} item(ns) baixado(s).`);
    return { count: saved };
  }

  // --- Tratamento de comandos (popup -> content.js -> aqui) ---
  window.addEventListener('message', async (ev) => {
    if (ev.source && ev.source !== window) return;
    const { data } = ev;
    if (!data || data.__from !== 'wamd:inpage' || data.type !== 'popup:cmd') return;

    const { cmd, payload } = data;

    try {
      if (cmd === 'listChats') {
        const list = await listChats();
        window.postMessage({ __from: 'wamd:inpage', type: 'inpage:resp', cmd, payload: list }, '*');
        return;
      }

      if (cmd === 'getStats') {
        const { selectedChatId } = payload || {};
        if (!selectedChatId) {
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Nenhuma conversa informada' }, '*');
          return;
        }
        const stats = await getChatStats(selectedChatId);
        window.postMessage({ __from: 'wamd:inpage', type: 'inpage:resp', cmd, payload: stats }, '*');
        return;
      }

      if (cmd === 'loadMore') {
        const { selectedChatId } = payload || {};
        if (!selectedChatId) {
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Nenhuma conversa informada' }, '*');
          return;
        }
        const result = await loadMoreMessages(selectedChatId);
        window.postMessage({ __from: 'wamd:inpage', type: 'inpage:resp', cmd, payload: result }, '*');
        return;
      }

      if (cmd === 'download') {
        const { chatIds, types, dateFrom, dateTo, naming, pack } = payload || {};
        const ids = Array.isArray(chatIds) ? chatIds.filter(Boolean) : [];

        if (!ids.length) {
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Nenhuma conversa selecionada' }, '*');
          return;
        }

        // Duas execuções sobre a mesma conversa disputariam as mesmas mídias e
        // dobrariam a carga nos servidores do WhatsApp, o suficiente para estourar o
        // tempo limite de vídeos grandes.
        if (downloadInProgress) {
          log('Já existe uma exportação em andamento. Aguarde a conclusão.');
          return;
        }
        downloadInProgress = true;

        try {
          const chats = await listChats();
          const map = new Map(chats.map(c => [c.id, c.name]));

          const { from, to } = intervaloDatas(dateFrom, dateTo);

          let totalCount = 0;
          for (let i = 0; i < ids.length; i++) {
            const chatId = ids[i];
            const chatName = map.get(chatId) || chatId;
            if (ids.length > 1) log(`Conversa ${i + 1}/${ids.length}: ${chatName}`);

            const res = await downloadMessages({ chatId, chatsFriendlyMap: map, types, from, to, naming, pack });
            totalCount += res?.count || 0;
          }

          window.postMessage({
            __from: 'wamd:inpage', type: 'inpage:resp', cmd,
            payload: { count: totalCount, chats: ids.length }
          }, '*');
        } finally {
          downloadInProgress = false;
        }
        return;
      }

      window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Comando desconhecido' }, '*');
    } catch (e) {
      window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: String(e?.message || e) }, '*');
    }
  });

  // Canal direto opcional, para uso pelo console de desenvolvedor da própria
  // página, sem passar pelo content.js.
  window.__WAMD_DIRECT_CMD = async (cmd, payload) => {
    try {
      if (cmd === 'listChats') {
        return { ok: true, data: await listChats() };
      }

      if (cmd === 'download') {
        const { chatIds, selectedChatId, types, dateFrom, dateTo, naming, pack } = payload || {};
        const ids = Array.isArray(chatIds) ? chatIds.filter(Boolean) : (selectedChatId ? [selectedChatId] : []);
        if (!ids.length) return { ok: false, error: 'Nenhuma conversa informada' };

        const chats = await listChats();
        const map = new Map(chats.map(c => [c.id, c.name]));
        const { from, to } = intervaloDatas(dateFrom, dateTo);

        let totalCount = 0;
        for (const chatId of ids) {
          const res = await downloadMessages({ chatId, chatsFriendlyMap: map, types, from, to, naming, pack });
          totalCount += res?.count || 0;
        }
        return { ok: true, data: { count: totalCount, chats: ids.length } };
      }

      return { ok: false, error: 'Comando desconhecido' };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  };

  // Exposição das funções internas apenas para os testes automatizados
  // (npm test). Na página real do WhatsApp Web esta marca nunca existe.
  if (window.__WAMD_MODO_TESTE__ === true) {
    window.__WAMD_INTERNO__ = Object.freeze({
      APP_VERSION,
      sanitizeFilename, makeFilename, resolveExt, extFromMime,
      normalizeLinkCandidate, addUrlsFromText, addUrlsFromObject, extractMessageLinks, isLinkMessage,
      getOwnMediaCaption, attachRecoveredCaptions, isPlainTextMessage, isMediaMessage,
      compareMessages, messageTimestamp, messageStanzaId, replyTargetsMedia,
      dayRangeToEpochSeconds, intervaloDatas, withinRange,
      processarEmOrdem, runPool, makeZip, crc32, formatarTamanho,
      LIMITE_PONTE_BYTES, LIMITE_PARTE_ZIP_BYTES, LIMITE_ITENS_ZIP, PASTA_DOWNLOADS
    });
  }
})();
