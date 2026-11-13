// inpage/app.js: runs in the WhatsApp Web page's MAIN world (via WPP / wa-js).
// Finds media messages in a chat, downloads their blobs, and hands them off
// to the extension (background.js) to save via chrome.downloads.
(function () {
  // Bumped whenever the popup <-> page message format changes. The popup
  // compares this against its own copy so a tab left open across an extension
  // update does not keep serving an older app.js to a newer popup.
  const APP_VERSION = '1.3.9';

  // Guard against double injection.
  if (window.__WAMD_APP_LOADED__) {
    window.postMessage({ __from: 'wamd:inpage', type: 'wa:log', message: 'app.js already loaded' }, '*');
    return;
  }
  window.__WAMD_APP_LOADED__ = true;
  window.__WAMD_APP_VERSION__ = APP_VERSION;

  const busSend = (type, payload) => window.postMessage({ __from: 'wamd:inpage', type, ...payload }, '*');
  const log = (m) => busSend('wa:log', { message: String(m) });

  function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  function getTimeoutForMedia(m) {
    const kind = (m.type || m.mediaType || '').toLowerCase();
    // WhatsApp decrypts and re-fetches each file server-side, so a long video
    // over a slow link can legitimately sit well past 20s before the blob
    // lands. Cutting it off early loses media that would have arrived.
    if (kind === 'video') return 45000;
    if (kind === 'document') return 20000;
    return 10000; // images/audio
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

  // Cheap pre-check to skip messages we already know can't be downloaded,
  // instead of paying for a doomed download attempt (and its timeout).
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
    // Keep Unicode (including Portuguese accents) intact. NFC prevents
    // visually identical characters from being stored as different
    // combining-codepoint sequences. Control characters are removed because
    // they are not valid in Windows filenames.
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
    if (message.fromMe || message.id?.fromMe) return 'Me';

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
      log(`resolveSenderName(): contact lookup failed for ${senderId}: ${e?.message || e}`);
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

  /** Best available extension: original filename > mimetype > kind-based fallback. */
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
    // Keep the sequence number first so Windows Explorer naturally sorts files
    // in the exact download/chat order without requiring a custom sort.
    const base = `${numberPart}_${sanitizeFilename(chatName || 'Chat')}${senderPart}${datePart}${suffix}`;
    const ext = extHint || resolveExt({ message, mime, kind });
    return base + (ext ? '.' + ext : '');
  }

  // --- readiness, based on the APIs we actually call ---
  // On some recent wa-js builds WPP.webpack.isReady() can stay false even
  // once WPP.chat is fully usable, which used to add an 8s stall to every
  // command. Poll for the concrete APIs instead.
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

    log('ensureReady(): WPP.chat APIs not available yet, continuing best-effort');
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
      log('listChats() ERROR: ' + (e?.message || e));
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
        log('getChatStats(): getMessages(10000) failed, retrying with 3000: ' + (e1?.message || e1));
        try {
          msgs = await window.WPP.chat.getMessages(chatId, { count: 3000 });
        } catch (e2) {
          log('getChatStats(): getMessages(3000) failed, retrying with defaults: ' + (e2?.message || e2));
          msgs = await window.WPP.chat.getMessages(chatId);
        }
      }

      if (msgs && msgs.length) {
        const mismatched = msgs.filter(m => {
          const c = msgChatSerialized(m);
          return c && c !== chatId;
        });

        // If wa-js hasn't initialized this chat yet it can return another
        // chat's messages; open it once and retry.
        if (mismatched.length && mismatched.length > Math.floor(msgs.length * 0.6)) {
          try {
            if (window.WPP?.chat?.openChatBottom) await window.WPP.chat.openChatBottom(chatId);
            else if (window.WPP?.chat?.openChatAt) await window.WPP.chat.openChatAt(chatId);
            await new Promise(r => setTimeout(r, 250));
            msgs = await window.WPP.chat.getMessages(chatId, { count: 5000 });
          } catch (e3) {
            log('getChatStats(): retry after openChat* failed: ' + (e3?.message || e3));
          }
        }

        msgs = msgs.filter(m => {
          const c = msgChatSerialized(m);
          return !c || c === chatId;
        });
      }

      // Link counts come from the same selected-chat message history used by export.
      // This avoids depending on WA-JS media='url', which is inconsistent across
      // WhatsApp Web builds.

      if (!msgs || msgs.length === 0) {
        return { dateRange: 'No messages loaded', totalMedia: 0, links: 0, totalItems: 0, images: 0, videos: 0, audio: 0, documents: 0 };
      }

      // Capture links from the rendered chat before classifying messages.
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

      let dateRange = 'Unknown';
      if (oldestDate && newestDate) {
        const formatDate = (ts) => {
          const d = new Date(ts * 1000);
          return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        };
        dateRange = `${formatDate(oldestDate)} - ${formatDate(newestDate)}`;
      }

      return { dateRange, totalMedia: mediaMessages.length, links: linkMessages.length, totalItems: mediaMessages.length + linkMessages.length, images, videos, audio, documents };
    } catch (e) {
      log('getChatStats() ERROR: ' + (e?.message || e));
      return { dateRange: 'Error loading stats', totalMedia: 0, images: 0, videos: 0, audio: 0, documents: 0 };
    }
  }

  // Find the scrollable message-list container. wa-js/getMessages only reads
  // from WhatsApp's local store, so to reach further back in history we still
  // need to nudge WhatsApp's own virtualized list into fetching older
  // messages from the server; there's no public wa-js API for that.
  // Matched structurally rather than by classname, since WhatsApp Web's
  // classnames change between builds.
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

      // The "load earlier messages" button sits near the top of the pane and
      // has a fairly long, sentence-like label (localized, so we don't match
      // on exact text, just its shape and position).
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
        log('loadMoreMessages(): could not find the scrollable message list');
        return { ok: false, error: 'Cannot find scroll container' };
      }

      // Scroll to the top in steps, giving WhatsApp time to load history as
      // it goes rather than jumping straight to scrollTop = 0.
      for (let i = 0; i < 10; i++) {
        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - 500);
        await new Promise(r => setTimeout(r, 200));
      }
      scrollContainer.scrollTop = 0;

      // Keep it pinned to the top briefly while WhatsApp settles content in.
      let scrollLocked = true;
      const lockScroll = () => { if (scrollLocked) scrollContainer.scrollTop = 0; };
      scrollContainer.addEventListener('scroll', lockScroll);
      await new Promise(r => setTimeout(r, 1500));
      scrollContainer.scrollTop = 0;
      await new Promise(r => setTimeout(r, 500));

      const loadMoreBtn = findLoadEarlierButton();
      scrollLocked = false;
      scrollContainer.removeEventListener('scroll', lockScroll);

      if (!loadMoreBtn) {
        return { ok: true, clicked: false, message: 'No load-more button found (all history may already be loaded)' };
      }

      if (!document.contains(loadMoreBtn)) {
        return { ok: false, error: 'Button disappeared before it could be clicked' };
      }

      try {
        loadMoreBtn.click();
      } catch (e) {
        loadMoreBtn.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      }

      await new Promise(r => setTimeout(r, 3000));
      return { ok: true, clicked: true };
    } catch (e) {
      log('loadMoreMessages() ERROR: ' + (e?.message || e));
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
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = Math.floor(new Date(y, m - 1, d, 0, 0, 0, 0).getTime() / 1000);
    const end = Math.floor(new Date(y, m - 1, d, 23, 59, 59, 999).getTime() / 1000);
    return { start, end };
  }

  // --- Caption recovery ----------------------------------------------------
  // Caption sources, in priority order:
  //   1) caption/body already attached to the media message;
  //   2) the one literal next message in chat order, only when consecutive
  //      message-order metadata proves adjacency;
  //   3) a plain-text reply whose explicit quoted-message ID points to this media.
  //
  // Important: the next-message rule does NOT search later messages. It does
  // not fall back to timestamps alone, because timestamps can be identical or
  // too coarse to establish adjacency. If WhatsApp/wa-js does not expose a
  // reliable consecutive order value (rowId or sequence), no next-message
  // caption is assigned. This deliberately favors precision over guesses.
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

    // Read only fields that semantically identify the quoted/replied-to
    // message. Every property access is protected because some WhatsApp builds
    // throw when a non-reply message is inspected.
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

    // quotedMsg is safe to inspect through safeRead; we never invoke a method
    // such as getQuotedMsg(), which can throw "does not have a reply".
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

    // Some builds expose the raw quoted key in quotedMsgPayload.
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
          // Only descend through objects that are plausibly part of a quote key.
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

    // wa-js normally exposes the bare message/stanza id as id.id. Prefer that
    // because the serialized group id may also contain a participant id at the
    // end, which is NOT the message id.
    const innerId = candidateString(id && typeof id === 'object' ? safeRead(id, 'id') : '');
    if (innerId) return innerId;

    const serialized = candidateString(id);
    if (!serialized) return '';

    // Common serialized message shapes:
    //   false_<remote>_<messageId>
    //   false_<remote>_<messageId>_<participant>
    //   true_<remote>_<messageId>
    // In all of these, the message/stanza id is the third component.
    const parts = serialized.split('_').filter(Boolean);
    if (parts.length >= 3) return parts[2];
    return serialized;
  }

  function exactKeyVariants(value) {
    // Never split a full WhatsApp message id into arbitrary underscore-tail
    // variants. Doing that can turn a participant/user id into a false match
    // for an unrelated reply. Keep only the exact value.
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
    // A few WhatsApp/Web builds expose the same document extension twice
    // between `body`, `title`, and `filename`. Collapse repeated known
    // document extensions so the filename metadata is still recognized.
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

  // IMPORTANT: for documents, WhatsApp may expose the document filename in
  // `caption` OR `body` even though the user did not write a caption. That
  // filename must never be promoted into the caption suffix. Only an explicit
  // caption that differs from all filename metadata counts.
  function getOwnMediaCaption(m) {
    if (!m || !isMediaMessage(m)) return '';

    const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
    const filenameCandidates = mediaFilenameCandidates(m);

    // Explicit caption fields are authoritative, except when WhatsApp has
    // populated them with the document's own filename metadata.
    for (const key of ['caption', '__x_caption', 'mediaCaption', '__x_mediaCaption']) {
      const value = safeRead(m, key);
      if (typeof value !== 'string' || !value.trim()) continue;
      const clean = value.trim();
      if (isDocumentFilenameMetadata(clean, m, kind)) continue;
      // For document-like media, also reject a filename-shaped caption that
      // exactly matches the known title/name even if the carrier differs.
      if (kind === 'document' && filenameCandidates.length && filenameCandidates.some(v => normalizeFilenameForCompare(v) === normalizeFilenameForCompare(clean))) continue;
      return clean;
    }

    const body = safeRead(m, 'body');
    if (typeof body !== 'string' || !body.trim()) return '';
    const cleanBody = body.trim();

    // If body is the document's filename, it is metadata, not a user caption.
    if (filenameCandidates.some(v => normalizedCompareText(v) === normalizedCompareText(cleanBody))) return '';
    if (isDocumentFilenameMetadata(cleanBody, m, kind)) return '';

    // For documents, do not fall back to arbitrary filename-looking body text
    // when WhatsApp has supplied no reliable caption field. A caption such as
    // "Pessoal Maria" is still accepted; the document filename is not.
    if (kind === 'document' && /\.[a-z0-9]{1,8}$/i.test(cleanBody)) return '';

    // For images/video/audio/stickers, some builds put the real caption in body.
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

    // WhatsApp/wa-js has used several names for ordinary text messages across
    // Web builds (chat, extendedTextMessage, conversation, etc.). Do not limit
    // caption recovery to three historical type strings. Instead reject known
    // system/non-user message classes and require actual text.
    const systemType = /(notification|protocol|revoked|ciphertext|call[_-]?log|e2e|group[_-]?notification|reaction|status|live[_-]?location)/i;
    if (kind && systemType.test(kind)) return false;
    return !!messageText(m);
  }

  // --- Link message support -------------------------------------------------
  // A link item is a non-media chat message containing one or more URLs.
  // It is exported as a UTF-8 .txt file; the first URL is also included in
  // the filename in a Windows-safe, human-readable form.
  const URL_RE = /https?:\/\/[^\s<>\"'`]+|www\.[^\s<>\"'`]+/gi;

  function normalizeLinkCandidate(raw) {
    if (typeof raw !== 'string') return '';
    let value = raw.trim();
    if (!value) return '';
    // Remove punctuation that commonly wraps a URL in ordinary prose.
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

  // DOM link cache: some WhatsApp Web builds render a clickable URL in the
  // message bubble but do not expose the URL in the wa-js message object. We
  // cache DOM-discovered links by the exact serialized message id. Because the
  // serialized id includes the chat/session context, this avoids leaking links
  // between chats.
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

        // The URL can be rendered by WhatsApp as an actual anchor even when
        // the message model does not expose body/urlText/linkPreview fields.
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

        // Some link previews render selectable URL text without an <a> node.
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
    // The DOM cache is populated from currently rendered message bubbles and
    // survives virtualized-list movement so links can still be associated later.
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

    // Fallback for WhatsApp Web builds where the link is visible in the chat
    // (and clickable) but the WPP message object does not expose any URL field.
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
    // A real downloadable media item stays a media item even when its caption
    // itself contains a URL. Link-only exports are ordinary text/link-preview
    // messages, not image/video/audio/document/sticker items.
    const mediaKinds = ['image', 'video', 'ptt', 'audio', 'document', 'sticker'];
    if (mediaKinds.includes(kind)) return false;
    const urls = extractMessageLinks(m);
    return urls.length > 0;
  }

  function linkFilenamePart(url) {
    if (!url) return 'link';
    // Preserve the complete URL concept while converting Windows-forbidden
    // characters into underscores. Keep enough path/query to distinguish
    // different viewing links, but cap the filename contribution.
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
    // wa-js normally exposes seconds, but some builds/objects can surface
    // milliseconds. Normalize both so ordering and filename dates use the
    // same timeline.
    return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
  }

  function messageTimestamp(m) {
    const t = normalizeEpochSeconds(safeRead(m, 't'));
    const timestamp = normalizeEpochSeconds(safeRead(m, 'timestamp'));
    // Prefer the native WhatsApp `t` field when it is a plausible epoch.
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
    // Chronological order is based on the actual message timestamp first.
    // rowId/sequence can reflect storage/insertion details that do not match
    // the date shown in the chat, so they must never move a July message after
    // an August message simply because their store ids are larger.
    const at = messageTimestamp(a), bt = messageTimestamp(b);
    if (at !== bt) return at - bt;

    // When two messages share the same second, prefer the actual displayed chat
    // order when those messages are currently present in WhatsApp's DOM. This
    // handles the common case where a media and its next text message both show
    // the same minute/second in the UI.
    const ad = Number(safeRead(a, '__wamdDomOrder'));
    const bd = Number(safeRead(b, '__wamdDomOrder'));
    if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return ad - bd;

    // Then use wa-js ordering metadata as a tie-breaker.
    const as = numericSequence(a), bs = numericSequence(b);
    if (as != null && bs != null && as !== bs) return as - bs;

    const ar = numericRowId(a), br = numericRowId(b);
    if (ar != null && br != null && ar !== br) return ar - br;

    // Final stable fallback: preserve the order in which the messages entered
    // the scanner context. Never use message IDs lexicographically.
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

    // The candidate must literally be the next item in the chronological chat
    // sequence assembled from the complete scanned context. This prevents a
    // later message from being attached merely because no closer timestamp was
    // found in a previous batch.
    if (!Array.isArray(ordered) || mediaIndex == null) return false;
    if (ordered[mediaIndex + 1] !== next) return false;

    // If both messages have the same timestamp, require a reliable tie breaker.
    // Prefer WhatsApp's displayed DOM order, then sequence/rowId. Never guess.
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

    // Start clean. An absent caption must stay absent; never inherit text from
    // another media or another point in the conversation.
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

    // Explicit replies are stronger evidence than proximity. Only use a reply
    // when WhatsApp exposes an exact quoted-message reference to this media.
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
        log(`Caption matched: exact direct reply -> ${msgSerializedId(media)}`);
      }
    }

    // Then consider the literal next message in chronological chat order. The
    // candidate must be at index + 1; we never search farther ahead.
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
        // A standalone text message is allowed only as literal prose. If it is
        // actually a duplicate of the media's filename metadata, do not attach it.
        if (isDocumentFilenameMetadata(text, media, String(safeRead(media, 'type') || safeRead(media, 'mediaType') || '').toLowerCase())) continue;

        if (!isStrictlyNextMessage(media, next, ordered, mediaIndex)) continue;
        if (!withinRange(messageTimestamp(next), from, to)) continue;

        media.__wamdCaption = text;
        media.__wamdCaptionSource = 'standalone-next';
        media.__wamdCaptionMessageId = nextId;
        usedCaptionMessageIds.add(nextId);
        log(`Caption matched: literal immediate next message -> ${msgSerializedId(media)}`);
      }
    }
  }


  // Link messages are discovered from the same paginated chat history as media.
  // This keeps chat/date scoping identical for all export types and avoids
  // WA-JS builds where media:'url' returns empty or inconsistent results.

  // Page backwards through chat history collecting media messages that match
  // the requested types/date range.
  async function fetchMediaMessages({ chatId, types, from, to, captureNextMessageCaption = false, captureReplyCaption = false, estimatedBatch = 200, maxBatches = 20 }) {
    const contextMessages = [];
    const seenIds = new Set();
    const wanted = new Set(types || []);
    let anchorId = '';
    let batchNo = 0;
    let noNewRepeats = 0;
    let sameAnchorRepeats = 0;
    let didOpenChat = false;

    log(`Scanning "${chatId}" for media (types=[${[...wanted].join(',')}])...`);

    const msgId = (m) => {
      if (typeof m === 'string') return m;
      const v = m?.id?._serialized ?? m?.id;
      return typeof v === 'string' ? v : '';
    };
    const msgTs = (m) => messageTimestamp(m);

    // IMPORTANT: Keep the complete scanned message context. We intentionally do
    // not filter to media during pagination because the text immediately after
    // a media may be needed as a caption, including when it lands in the next
    // pagination batch.
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
        log(`getMessages() error on batch #${batchNo}: ${e?.message || e}`);
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
            log('Chat was not initialized yet, opened it and restarted the scan');
            continue;
          } catch (e) {
            log('openChat* failed while scanning: ' + (e?.message || e));
          }
        }
      }

      if (anchorSerPrev) {
        batch = (batch || []).filter(m => msgId(m) !== anchorSerPrev);
        if (!batch.length) break;
      }

      contextMessages.push(...batch);
      // Virtualized WhatsApp lists replace DOM rows while history is loaded.
      // Cache visible link anchors on every batch so links remain associated
      // with their original message even after the row scrolls away.
      collectDomLinkCache(true);

      let newIdsInBatch = 0;
      for (const m of batch) {
        const id = msgId(m);
        if (!id || seenIds.has(id)) continue;
        newIdsInBatch++;
        seenIds.add(id);
      }

      // Always page by the oldest timestamp seen in this batch. The returned
      // array itself is not trusted to be chronologically sorted.
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

    // Links use the same complete selected-chat history already collected above.
    // They are identified after canonical ordering so chat/date filters and
    // numbering remain identical to media.

    // Capture any links visible in the final loaded portion before ordering.
    collectDomLinkCache(true);

    // -------------------- Canonical chat order --------------------
    // Build ONE ordered timeline before filtering media, matching captions, or
    // assigning file numbers. This is the source of truth for all later work.
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
    // Use visible WhatsApp DOM order as the strongest tie-breaker for messages
    // that share the same second. This is especially useful for media + caption
    // text that render with the same timestamp.
    assignDomOrder(contextArray);
    const orderedContext = contextArray.sort(compareMessages);

    orderedContext.forEach((m, i) => {
      try {
        Object.defineProperty(m, '__wamdChatOrder', { value: i, configurable: true });
      } catch (_) {
        try { m.__wamdChatOrder = i; } catch (_) {}
      }
    });

    // Derive the export list FROM the already-sorted timeline. Nothing gets a
    // file number before this point, so numbering cannot be split by batches or
    // download completion timing.
    const mediaMessages = orderedContext.filter(m => {
      if (!isMediaMessage(m)) return false;
      const ts = messageTimestamp(m);
      if (!withinRange(ts, from, to)) return false;
      const kind = String(safeRead(m, 'type') || safeRead(m, 'mediaType') || '').toLowerCase();
      const norm = kind === 'ptt' ? 'audio' : kind;
      return !(wanted.size && !wanted.has(norm) && !(wanted.has('ptt') && kind === 'ptt'));
    });

    log(`Chronological order fixed before caption matching/download: ${mediaMessages.length} media file(s).`);

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
      // Links must belong to the explicitly selected chat. The context was
      // collected from this chat, and we still enforce the exact chat id here.
      if (messageChatKey(m) !== chatId) return false;
      if (captionSourceIds.has(msgSerializedId(m))) return false;
      const ts = messageTimestamp(m);
      if (!withinRange(ts, from, to)) return false;
      return wanted.has('link');
    });

    // Links and media share ONE chronological export sequence. This makes
    // 0001, 0002, 0003... represent the actual order of selected items in the chat.
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
    if (recovered) log(`Recovered ${recovered} caption(s) from media, next messages, or direct replies.`);
    log(`Scan complete, ${exportItems.length} export item(s): ${mediaMessages.length} media + ${linkMessages.length} link(s)`);
    return exportItems;
  }

  function patchWppDownloadMedia() {
    const W = window.WPP?.chat;
    if (!W || W.__wamdDownloadPatched) return;

    function getMediaData(msg) {
      return msg?.mediaData || msg?._mediaData || null;
    }

    // Some WhatsApp Web builds ship a broken forceToBlob() that throws on
    // msgChunks instead of returning null; neutralize it so a single bad
    // cached blob can't take down the whole batch.
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

      // Force a real fetch rather than reading whatever is cached. WhatsApp
      // Web can hold a low resolution preview blob in memory before the full
      // quality original has been fetched, so taking the cached blob saves
      // images and videos at reduced quality. Calling downloadMedia() again
      // is cheap when the full file is already present.
      await message.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
      await new Promise(r => setTimeout(r, 250));

      let blob = await getBlobFromMessageCaches(message, id);
      if (blob) return blob;

      await new Promise(r => setTimeout(r, 400));
      blob = await getBlobFromMessageCaches(message, id);
      if (blob) return blob;

      throw new Error(`message.downloadMedia() completed but no blob was cached for ${id}`);
    }

    // Fallback: the lower-level WPP.chat API.
    if (!dlFnName) {
      if (typeof W.downloadMediaMessage === 'function') dlFnName = 'downloadMediaMessage(message)';
      else if (typeof W.downloadMedia === 'function') dlFnName = 'downloadMedia(id)';
      else if (typeof W.downloadMessage === 'function') dlFnName = 'downloadMessage(id)';
      else dlFnName = 'NONE';
    }

    if (dlFnName === 'downloadMediaMessage(message)') return await W.downloadMediaMessage(message);
    if (dlFnName === 'downloadMedia(id)') return await W.downloadMedia(id);
    if (dlFnName === 'downloadMessage(id)') return await W.downloadMessage(id);

    throw new Error('No downloadMedia* API available in this WhatsApp Web build');
  }

  async function safeDownloadBlob(m, { timeoutMs = 45000, retries = 1 } = {}) {
    const mid = m?.id?._serialized || m?.id || '';
    const kind = (m.type || m.mediaType || '').toLowerCase();

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const blob = await withTimeout(downloadAnyMedia(m), timeoutMs, `downloadAnyMedia kind=${kind} id=${mid} attempt=${attempt}`);

        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('download returned an invalid blob');
        if (typeof blob.size === 'number' && blob.size === 0) throw new Error('blob size = 0 (media not available)');

        return blob;
      } catch (e) {
        if (attempt > retries) {
          log(`SKIP: id=${mid}, kind=${kind} -> ${e?.message || e}`);
        }
        if (attempt <= retries) await new Promise(r => setTimeout(r, 400));
      }
    }

    return null;
  }

  // --- Extension-driven download bridge -----------------------------------
  // Sends the finished file to content.js -> background.js, which saves it
  // via chrome.downloads.download(). Routing saves through the extension
  // (instead of clicking an <a download> here in the page) avoids Chrome's
  // "this site is trying to download multiple files" prompt, which only
  // applies to page-initiated downloads, the real blocker to downloading
  // many files in one go.
  let downloadSeq = 0;
  let downloadInProgress = false;
  const pendingDownloads = new Map();

  window.addEventListener('message', (ev) => {
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
        resolve({ ok: false, error: 'download ack timeout' });
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

  // A whole-chat ZIP routinely runs to hundreds of megabytes. Base64 for the
  // extension bridge inflates that by a third and has to hold it as one
  // string, which passes the engine's maximum string length and throws
  // "Invalid string length", losing the entire batch at the last step. Hand
  // the blob to an anchor instead. This is a page-initiated download, but it
  // is a single file, so Chrome's multiple-download prompt does not apply.
  // Chrome strips directories from the download attribute, so the ZIP lands
  // in the Downloads root rather than a subfolder.
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
      log(`Save failed: ${filename}, ${res?.error || 'unknown error'}`);
      return { ok: false, error: res?.error || 'unknown error' };
    } catch (e) {
      log(`Save failed: ${filename}, ${e?.message || e}`);
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // --- Minimal ZIP (STORE, uncompressed) writer ---
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

  async function makeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = strToUtf8Bytes(e.name);
      const data = e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes);
      const crc = crc32(data);
      const localRec = concat([writeLocalHeader(nameBytes, crc, data.length), data]);
      locals.push(localRec);
      centrals.push(writeCentralHeader(nameBytes, crc, data.length, offset));
      offset += localRec.length;
    }

    const cd = concat(centrals);
    const eocd = writeEOCD(entries.length, cd.length, offset);
    return concat([...locals, cd, eocd]);
  }

  // --- Bounded-concurrency pool ---
  // Runs `worker` over `items` with at most `limit` in flight at once, so a
  // "download everything" batch downloads several files in parallel instead
  // of strictly one at a time, without spawning unbounded concurrent work.
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

  async function downloadMessages({ chatId, chatsFriendlyMap, types, from, to, naming, pack }) {
    await ensureReady();

    if (!chatId) {
      log('No chat selected');
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
      log('No matching media or links found for the selected filters.');
      return { count: 0 };
    }

    // msgs is already sorted before we get here. Keep that order all the way
    // into filename numbering and, when requested, into the actual save calls.
    const preserveChatOrder = pack?.preserveChatOrder !== false;
    if (preserveChatOrder) {
      log('Preserving chat order: files will be numbered oldest → newest and saved in that same order.');
    }

    log(`Found ${msgs.length} export item(s). Fetching up to ${concurrency} at a time…`);

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
          if (!links.length) throw new Error('link item had no extractable URL');
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
          // Keep the final name safely below Windows' common 255-character limit
          // without duplicating the extension when truncation is unnecessary.
          const filename = Array.from(rawFilename).length <= 200 ? rawFilename : `${finalizeFilenamePart(rawFilename, 196)}.txt`;
          const text = [
            'WhatSave link export',
            '',
            ...links.map(url => `Link: ${url}`),
            ''
          ].join('\r\n');
          const bytes = strToUtf8Bytes(text);
          const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          result = { filename, mime: 'text/plain;charset=utf-8', arrayBuffer, bytes };
        } catch (e) {
          log(`error #${index}: link ${mid}, ${e?.message || e}`);
        }
      } else if (isProbablyUnavailableByMessage(m)) {
        log(`skip #${index}: ${mid} (${kind}), media not fully available`);
      } else {
        try {
          const blob = await safeDownloadBlob(m, { timeoutMs: getTimeoutForMedia(m), retries: 1 });
          if (!blob) {
            // safeDownloadBlob() already logged the reason.
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
          log(`error #${index}: ${mid}, ${e?.message || e}`);
        }
      }

      processed++;
      reportProgress();
      return result;
    }

    if (pack?.saveAsZip) {
      const collected = await runPool(msgs, prepareEntry, concurrency);
      const entries = collected.filter(Boolean).map(e => ({ name: e.filename, bytes: e.bytes }));

      if (!entries.length) {
        log('Nothing to zip. No media could be downloaded.');
        return { count: 0, zip: true };
      }

      log(`Building ZIP with ${entries.length} file(s)…`);
      const zipBytes = await makeZip(entries);
      const zipName = `${chatFolder}_media.zip`;
      const res = saveBlobFromPage(new Blob([zipBytes], { type: 'application/zip' }), zipName);
      if (!res.ok) log(`Save failed: ${zipName}, ${res.error}`);
      saved = res.ok ? entries.length : 0;
      log(`Done. ${saved}/${total} item(s) exported to ZIP.`);
      return { count: saved, zip: true };
    }

    if (preserveChatOrder) {
      // Fetch/decrypt can stay parallel, but the final chrome.downloads calls
      // are serialized. This makes the filesystem's creation/modified order
      // follow the chat order instead of the race between parallel downloads.
      // Janela deslizante: os workers buscam em paralelo, mas nunca ficam mais
      // de `window` itens à frente do próximo arquivo a salvar. Assim a ordem é
      // preservada sem manter todos os vídeos/arquivos na memória ao mesmo tempo.
      const ready = new Map();
      const windowSize = Math.max(concurrency * 2, 4);
      let nextToFetch = 0;
      let nextToSave = 0;
      // Lista de quem está esperando: notify() acorda todos (workers e saver),
      // então nenhum sinal se perde quando vários aguardam ao mesmo tempo.
      let waiters = [];
      const notify = () => { const list = waiters; waiters = []; for (const w of list) w(); };
      const waitChange = () => new Promise(resolve => { waiters.push(resolve); });

      const fetchWorker = async () => {
        for (;;) {
          while (nextToFetch < msgs.length && nextToFetch - nextToSave >= windowSize) {
            await waitChange();
          }
          const i = nextToFetch++;
          if (i >= msgs.length) return;
          let entry = null;
          try { entry = await prepareEntry(msgs[i], i); }
          catch (e) { log(`error #${i + 1}: ${e?.message || e}`); }
          ready.set(i, entry);
          notify();
        }
      };

      const saver = async () => {
        while (nextToSave < msgs.length) {
          if (!ready.has(nextToSave)) { await waitChange(); continue; }
          const entry = ready.get(nextToSave);
          ready.delete(nextToSave);
          nextToSave++;
          if (entry) {
            const relPath = `WA Media Downloads/${chatFolder}/${entry.filename}`;
            let ack = null;
            try { ack = await postDownload({ arrayBuffer: entry.arrayBuffer, filename: relPath, mime: entry.mime }); }
            catch (e) { ack = { ok: false, error: e?.message || String(e) }; }
            if (ack?.ok) saved++;
            else log(`Save failed: ${entry.filename}${ack?.error ? `, ${ack.error}` : ''}`);
            reportProgress();
          }
          notify();
        }
      };

      await Promise.all([
        saver(),
        ...Array.from({ length: Math.min(concurrency, msgs.length) }, fetchWorker)
      ]);
    } else {
      await runPool(msgs, async (m, i) => {
        const entry = await prepareEntry(m, i);
        if (!entry) return;

        const relPath = `WA Media Downloads/${chatFolder}/${entry.filename}`;
        const ack = await postDownload({ arrayBuffer: entry.arrayBuffer, filename: relPath, mime: entry.mime });
        if (ack?.ok) saved++;
        reportProgress();
      }, concurrency);
    }

    log(`Done. ${saved}/${total} item(s) downloaded.`);
    return { count: saved };
  }

  // --- Command handler (popup -> content.js -> here) ---
  window.addEventListener('message', async (ev) => {
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
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Missing selectedChatId' }, '*');
          return;
        }
        const stats = await getChatStats(selectedChatId);
        window.postMessage({ __from: 'wamd:inpage', type: 'inpage:resp', cmd, payload: stats }, '*');
        return;
      }

      if (cmd === 'loadMore') {
        const { selectedChatId } = payload || {};
        if (!selectedChatId) {
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Missing selectedChatId' }, '*');
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
          window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'No chat selected' }, '*');
          return;
        }

        // Two runs over the same chat would fight over the same media and
        // double the load on WhatsApp's servers, which is enough to push
        // large videos past their download timeout.
        if (downloadInProgress) {
          log('A download is already running. Wait for it to finish.');
          return;
        }
        downloadInProgress = true;

        try {
          const chats = await listChats();
          const map = new Map(chats.map(c => [c.id, c.name]));

          const from = dateFrom ? dayRangeToEpochSeconds(dateFrom).start : undefined;
          const to = dateTo ? dayRangeToEpochSeconds(dateTo).end : undefined;

          let totalCount = 0;
          for (let i = 0; i < ids.length; i++) {
            const chatId = ids[i];
            const chatName = map.get(chatId) || chatId;
            if (ids.length > 1) log(`Chat ${i + 1}/${ids.length}: ${chatName}`);

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

      window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: 'Unknown cmd' }, '*');
    } catch (e) {
      window.postMessage({ __from: 'wamd:inpage', type: 'inpage:error', cmd, error: String(e?.message || e) }, '*');
    }
  });

  // Optional direct channel for use from the page's own devtools console,
  // without going through content.js at all.
  window.__WAMD_DIRECT_CMD = async (cmd, payload) => {
    try {
      if (cmd === 'listChats') {
        return { ok: true, data: await listChats() };
      }

      if (cmd === 'download') {
        const { chatIds, selectedChatId, types, dateFrom, dateTo, naming, pack } = payload || {};
        const ids = Array.isArray(chatIds) ? chatIds.filter(Boolean) : (selectedChatId ? [selectedChatId] : []);
        if (!ids.length) return { ok: false, error: 'Missing chatIds' };

        const chats = await listChats();
        const map = new Map(chats.map(c => [c.id, c.name]));
        const from = dateFrom ? dayRangeToEpochSeconds(dateFrom).start : undefined;
        const to = dateTo ? dayRangeToEpochSeconds(dateTo).end : undefined;

        let totalCount = 0;
        for (const chatId of ids) {
          const res = await downloadMessages({ chatId, chatsFriendlyMap: map, types, from, to, naming, pack });
          totalCount += res?.count || 0;
        }
        return { ok: true, data: { count: totalCount, chats: ids.length } };
      }

      return { ok: false, error: 'Unknown cmd' };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  };
})();
