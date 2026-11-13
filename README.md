# WhatSave

A free, open-source Chrome extension (Manifest V3) that bulk downloads media
from WhatsApp Web, images, videos, voice notes/audio, and documents, from one
or more chats at once, either as loose files or a single ZIP.

Built by [Jstarzz](https://github.com/Jstarzz). A star on the
[repo](https://github.com/Jstarzz/whatsave) helps other people find it.

## Install

- [Google Chrome](https://chromewebstore.google.com/detail/whatsave/adfogoknhlpeimmpgpgmoifmbjeboghk)
- [Mozilla Firefox](https://addons.mozilla.org/firefox/addon/whatsave/)
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/obfgahgppjfldighpfohcpahmlioaelf)

## Features

- No limits and no license key. Everything is unlocked.
- Select multiple chats in the popup and it works through each one in turn.
- Files save through `chrome.downloads` (via the background service worker)
  rather than by clicking a hidden link inside the WhatsApp Web page. Chrome
  blocks a *page* from firing off a stream of automatic downloads but does
  not block an *extension* doing the same through its downloads API, which
  is what makes downloading many files back to back possible at all.
- Media is fetched fresh from WhatsApp instead of read out of whatever the
  page happens to have cached, so files save at their original quality.
- Media fetching can run 2, 4, 6, or 8 files at a time; **Preserve chat order** controls whether final individual saves are serialized to keep filesystem order.
- Individual files land in `Downloads/WA Media Downloads/<Chat Name>/...`
  instead of loose in your Downloads root.
- Progress reporting, a bounded log panel so a large batch does not bog down
  the popup, and "All types" / "Videos only" filter buttons.

## How it works

- `inpage/vendor/wppconnect-wa-wrapped.js` is the open-source
  [WPPConnect `wa-js`](https://github.com/wppconnect-team/wa-js) library,
  bundled as-is. It gives the extension a supported way to read chats and
  messages from WhatsApp Web's own in-memory store. That project has its own
  license (Apache-2.0 at the time of writing), keep its copyright notice
  intact and check its repo for the current terms before redistributing this
  extension.
- `inpage/app.js` runs in the page's main world, uses `wa-js` to list chats,
  scan chats for media messages, and download each one's underlying blob.
- `content.js` bridges page and extension messages.
- `background.js` is the MV3 service worker. It is the only place that
  actually calls `chrome.downloads.download()`.
- `popup.html` / `popup.js` / `popup.css` are the toolbar UI.


## Caption recovery

This build keeps caption recovery deliberately strict. A media file can get a caption from only one of these sources:

1. **Inline caption** — text stored directly on the media message.
2. **Direct reply** — a plain-text message whose WhatsApp reply reference points exactly to that media message.
3. **Immediate next message** — only the single text message immediately after the media in chronological chat order, from the same chat and sender, within the short proximity window. The extension never searches farther ahead for a convenient text message.

If none of those conditions are met, the media remains without a caption. In particular, an unrelated later message is never used as a fallback.

## Export order and date format

The extension builds one canonical chat timeline **before caption matching, media filtering, numbering, or saving**. Media are then numbered **oldest message -> newest message** from that fixed timeline. When **Preserve chat order** is enabled, individual files are saved sequentially in that same order; parallelism is used only while fetching/decrypting the media. The ZIP entries use the same order.

When **Add date/time to filename** is enabled, **Date format** controls only how that timestamp is written into the filename. The selected format does not change download order.

Available examples include `YYYY-MM-DD_HH-mm-ss`, `DD-MM-YYYY_HH-mm-ss`, `YYYY-MM-DD`, `DD-MM-YYYY`, `YYYYMMDD_HHmmss`, `YYYYMMDD`, and `YYMMDD_HHmmss`.

## Links

Select **Links** under Media type to export chat messages that contain web addresses or WhatsApp link-preview URLs. Each link message becomes one UTF-8 `.txt` file; the first URL is included in the filename and all extracted URLs are written inside the file.

- Links are exported only when the message belongs to a selected chat and falls inside the configured date range. No global URL search is used.
- WhatSave first reads URL fields from the message model and link preview. If WhatsApp Web exposes the link only in the visible chat DOM, it falls back to the message bubble's clickable anchors/text.
- A media item whose caption contains a URL stays a media item; it is not duplicated as a link.

## Document captions

For documents/PDFs, a `caption`/`body` value identical to the file name is treated as file metadata, not as a caption. If no valid caption exists, the media remains without one. Same-second media/text pairs use the visible WhatsApp message order (or `sequence`/`rowId`) when available; otherwise they are not guessed.

## Installing it unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open [web.whatsapp.com](https://web.whatsapp.com), log in, then click the
   extension icon.

## Using it

1. Select one or more chats from the list (click **Update chat list** if
   nothing shows up yet).
2. Optionally set a date range, pick media types, and adjust naming options.
3. Optionally use **Load More Messages** first, for a single chat, if you
   need media further back than WhatsApp Web has already loaded locally.
4. Click **Download all**. Files save individually, or as one ZIP per chat
   if **Save as single ZIP** is checked.

## Notes and limits

- This only ever touches chats you already have open in your own WhatsApp
  Web session. It cannot access anything you do not already have access to.
- WhatsApp Web generally only keeps roughly a year of history loaded
  locally. **Load More Messages** nudges it to fetch further back, but very
  old media may already be gone from WhatsApp's servers.
- Media quality is whatever the sender's own device uploaded to WhatsApp.
  There is no separate hidden "HD" copy on the server for this extension to
  fetch instead, it downloads the same original file WhatsApp Web itself
  would show you.
- Very large batches will still take a while. Media has to be decrypted and
  fetched one file at a time from WhatsApp's side, the parallel-download
  setting only controls how many of those requests are in flight together.
- This project is not affiliated with, endorsed by, or associated with
  WhatsApp or Meta.

## Privacy

Nothing is collected, stored, or transmitted anywhere. See `PRIVACY.md`.

## License

MIT for the code in this repository (see `LICENSE`). The bundled `wa-js`
vendor file remains under its own upstream license, see the note above.
