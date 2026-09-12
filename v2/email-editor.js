/* ============================================================
   Giant Motor Cars — rich email editor

   A contenteditable composer that emits email-safe HTML: every
   style inlined (Gmail strips <style> blocks), images sized with
   width attributes (Outlook ignores much of modern CSS), merge
   tokens carried as atomic chips so formatting can't split
   {{first_name}} down the middle.

   Authoring format and sending format are deliberately different:
   inside the editor an image is a data: URI so it renders while you
   work; on the way out it becomes a cid: reference with the bytes
   attached separately, because no major mail client will display a
   data: image source.

   window.GMCEditor
     mount(el, opts) -> instance
     toEmailHtml(html)        normalize arbitrary HTML for sending
     extractImages(html)      data: URIs -> cid: refs + image parts
     textToEditable(text)     older plain-text templates -> HTML
   ============================================================ */
(function (global) {
'use strict';

/* Content width inside the 600px card: 600 - 28px padding each side. */
const CONTENT_W = 544;
const IMG_SIZES = [
  { k: 's', l: 'Small',  pct: .25 },
  { k: 'm', l: 'Medium', pct: .5  },
  { k: 'l', l: 'Large',  pct: .75 },
  { k: 'f', l: 'Full',   pct: 1   }
];

/* Applied on the way out. Anything the author set inline wins. */
const BLOCK_STYLE = {
  P:  'margin:0 0 14px',
  H1: 'margin:0 0 12px;font-size:26px;line-height:1.25;font-weight:bold',
  H2: 'margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:bold',
  H3: 'margin:0 0 10px;font-size:17px;line-height:1.35;font-weight:bold',
  UL: 'margin:0 0 14px;padding-left:22px',
  OL: 'margin:0 0 14px;padding-left:22px',
  LI: 'margin:0 0 6px',
  BLOCKQUOTE: 'margin:0 0 14px;padding:2px 0 2px 14px;border-left:3px solid #d7dbe0;color:#555555',
  HR: 'border:0;border-top:1px solid #e4e7ec;margin:22px 0',
  IMG: 'max-width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none'
};

const PASTE_OK   = new Set(['P','BR','DIV','SPAN','B','STRONG','I','EM','U','A','UL','OL','LI','H1','H2','H3','H4','BLOCKQUOTE','HR','IMG']);
const PASTE_CSS  = new Set(['color','background-color','font-weight','font-style','text-decoration','text-align','font-size']);

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* ---------- styles ---------- */
(function css() {
  if (document.getElementById('gmce-css')) return;
  const s = document.createElement('style');
  s.id = 'gmce-css';
  s.textContent = `
  .gmce{border:1px solid var(--line,#E4E7EC);border-radius:10px;background:#fff;display:flex;flex-direction:column;overflow:hidden}
  .gmce.focus{border-color:var(--primary,#2F6BFF);box-shadow:0 0 0 3px rgba(47,107,255,.12)}
  .gmce-tb{display:flex;flex-wrap:wrap;gap:2px;padding:6px;border-bottom:1px solid var(--line,#E4E7EC);background:#FAFBFC}
  .gmce-tb .sep{width:1px;background:var(--line,#E4E7EC);margin:3px 4px}
  .gmce-b{min-width:28px;height:28px;padding:0 6px;border-radius:6px;border:1px solid transparent;background:none;
    font-size:13px;font-weight:600;color:#414652;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .gmce-b:hover{background:#EDEFF3;border-color:var(--line,#E4E7EC)}
  .gmce-b.on{background:var(--primary-soft,#EAF0FF);color:var(--primary-ink,#1E4FCC)}
  .gmce-b select{border:none;background:none;font:inherit;color:inherit;cursor:pointer;outline:none}
  .gmce-doc{padding:16px 18px;min-height:var(--gmce-h,300px);max-height:60vh;overflow:auto;outline:none;
    font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a}
  .gmce-doc:empty:before{content:attr(data-ph);color:#9AA3AF}
  .gmce-doc p{margin:0 0 14px}
  .gmce-doc h1{font-size:26px;line-height:1.25;margin:0 0 12px}
  .gmce-doc h2{font-size:21px;line-height:1.3;margin:0 0 12px}
  .gmce-doc h3{font-size:17px;line-height:1.35;margin:0 0 10px}
  .gmce-doc ul,.gmce-doc ol{margin:0 0 14px;padding-left:22px}
  .gmce-doc blockquote{margin:0 0 14px;padding:2px 0 2px 14px;border-left:3px solid #d7dbe0;color:#555}
  .gmce-doc img{max-width:100%;height:auto}
  .gmce-doc img.sel{outline:2px solid var(--primary,#2F6BFF);outline-offset:2px}
  .gmce-doc hr{border:0;border-top:1px solid #e4e7ec;margin:22px 0}
  .gmce-doc a{color:#1E4FCC}
  .gmce-chip{display:inline-block;padding:1px 7px;border-radius:5px;background:var(--primary-soft,#EAF0FF);
    color:var(--primary-ink,#1E4FCC);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.85em;
    font-weight:600;cursor:pointer;white-space:nowrap;-webkit-user-select:all;user-select:all}
  .gmce-chip:hover{box-shadow:inset 0 0 0 1px var(--primary,#2F6BFF)}
  .gmce-src{width:100%;min-height:var(--gmce-h,300px);max-height:60vh;border:none;outline:none;padding:14px 16px;
    font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12.5px;line-height:1.5;resize:vertical}
  .gmce-pop{position:absolute;z-index:80;background:#fff;border:1px solid var(--line,#E4E7EC);border-radius:9px;
    box-shadow:0 8px 28px rgba(16,17,21,.16);padding:6px;display:flex;gap:3px;align-items:center}
  .gmce-pop button{height:26px;padding:0 9px;border-radius:6px;border:1px solid transparent;background:none;
    font-size:12px;font-weight:600;color:#414652;cursor:pointer}
  .gmce-pop button:hover{background:#EDEFF3}
  .gmce-pop button.danger{color:#B91C1C}
  .gmce-pop .lbl{font-size:11px;color:#6B7280;font-weight:600;padding:0 4px;text-transform:uppercase;letter-spacing:.03em}
  `;
  document.head.appendChild(s);
})();

/* =====================================================
   Normalizing to email-safe HTML
   ===================================================== */
function mergeStyle(el, defaults) {
  if (!defaults) return;
  const own = el.getAttribute('style') || '';
  el.setAttribute('style', own ? defaults + ';' + own : defaults);
}

/* execCommand leaves divs behind; email bodies want paragraphs. */
function divsToParas(root) {
  root.querySelectorAll('div').forEach(d => {
    const p = document.createElement('p');
    while (d.firstChild) p.appendChild(d.firstChild);
    for (const a of Array.from(d.attributes)) p.setAttribute(a.name, a.value);
    d.replaceWith(p);
  });
}

function toEmailHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = String(html || '');

  // Chips carry the token in data-token; formatting can't have corrupted it.
  root.querySelectorAll('[data-token]').forEach(c => {
    c.replaceWith(document.createTextNode('{{' + c.getAttribute('data-token') + '}}'));
  });

  divsToParas(root);

  root.querySelectorAll('*').forEach(el => {
    const tag = el.tagName;
    if (tag === 'A') {
      if (!el.hasAttribute('data-btn')) mergeStyle(el, 'color:#1E4FCC;text-decoration:underline');
      const href = el.getAttribute('href') || '';
      // A bare "www.…" href resolves against the mail client, not the web.
      if (href && !/^(https?:|mailto:|tel:|#|\{\{)/i.test(href)) el.setAttribute('href', 'https://' + href.replace(/^\/+/, ''));
      el.setAttribute('target', '_blank');
    } else if (tag === 'IMG') {
      mergeStyle(el, BLOCK_STYLE.IMG);
      if (!el.getAttribute('alt')) el.setAttribute('alt', '');
    } else {
      mergeStyle(el, BLOCK_STYLE[tag]);
    }
    el.removeAttribute('class');
    el.removeAttribute('id');
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-btn');
    el.removeAttribute('spellcheck');
  });

  // A visually blank paragraph must carry a non-breaking space or clients collapse it.
  root.querySelectorAll('p').forEach(p => {
    if (!p.textContent.trim() && !p.querySelector('img,hr')) p.innerHTML = '&nbsp;';
  });

  return root.innerHTML.trim();
}

function extractImages(html) {
  const images = [];
  let n = 0;
  const out = String(html || '').replace(/src="data:([a-z/+.-]+);base64,([^"]+)"/gi, (m, mime, b64) => {
    n++;
    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const cid = `gmc${n}.${Date.now().toString(36)}@giantmotorcars`;
    images.push({ cid, mime, b64, name: `image${n}.${ext}` });
    return `src="cid:${cid}"`;
  });
  return { html: out, images };
}

function textToEditable(text) {
  return String(text || '').split(/\n{2,}/).filter(p => p.trim() !== '')
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') || '<p><br></p>';
}

function chipHtml(token) {
  return `<span class="gmce-chip" data-token="${esc(token)}" contenteditable="false">{{${esc(token)}}}</span>`;
}

/* Turns {{token}} text back into chips when loading a saved template. */
function editableFromEmail(html) {
  if (!html) return '<p><br></p>';
  const s = GMC && GMC.looksLikeHtml && GMC.looksLikeHtml(html) ? String(html) : textToEditable(html);
  return s.replace(/\{\{\s*([a-z0-9_]+)\s*(\|[^}]*)?\}\}/gi, (m, t, fb) => chipHtml(t + (fb || '')));
}

/* =====================================================
   Paste cleanup — Word and web pages drag in a lot
   ===================================================== */
function sanitizePaste(html) {
  const root = document.createElement('div');
  root.innerHTML = String(html || '');
  root.querySelectorAll('style,script,meta,link,title,o\\:p').forEach(n => n.remove());

  root.querySelectorAll('*').forEach(el => {
    if (!PASTE_OK.has(el.tagName)) {
      const p = el.parentNode;
      if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      el.remove();
      return;
    }
    const keepStyle = [];
    (el.getAttribute('style') || '').split(';').forEach(d => {
      const i = d.indexOf(':');
      if (i < 0) return;
      const prop = d.slice(0, i).trim().toLowerCase();
      const val  = d.slice(i + 1).trim();
      if (PASTE_CSS.has(prop) && val && !/url\s*\(|expression/i.test(val)) keepStyle.push(prop + ':' + val);
    });
    const href = el.getAttribute('href'), src = el.getAttribute('src'), alt = el.getAttribute('alt');
    for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
    if (keepStyle.length) el.setAttribute('style', keepStyle.join(';'));
    if (el.tagName === 'A'   && href && /^(https?:|mailto:|tel:)/i.test(href)) el.setAttribute('href', href);
    if (el.tagName === 'IMG') {
      if (src && /^(https?:|data:image\/)/i.test(src)) el.setAttribute('src', src); else el.remove();
      if (alt) el.setAttribute('alt', alt);
    }
  });
  return root.innerHTML;
}

/* =====================================================
   Image intake — downscale before it ever hits an inbox
   ===================================================== */
function readImage(file, maxW) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('That file is not an image.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('That image is over 20 MB — too big to email.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.onload = () => {
      // SVG has no natural raster size and canvas would rasterize it badly.
      if (file.type === 'image/svg+xml') return resolve(fr.result);
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded.'));
      img.onload = () => {
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        // GIFs may animate and PNGs may be transparent; a white matte only
        // helps when we are about to throw the alpha channel away.
        const keepAlpha = file.type === 'image/png' || file.type === 'image/gif';
        if (!keepAlpha) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); }
        cx.drawImage(img, 0, 0, w, h);
        let out;
        try {
          out = keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.82);
          // Photographs saved as PNG balloon; prefer the smaller encoding.
          if (keepAlpha && out.length > 400000) {
            const jpg = cv.toDataURL('image/jpeg', 0.82);
            if (jpg.length < out.length * 0.7) out = jpg;
          }
        } catch (e) { return reject(new Error('That image could not be processed.')); }
        resolve(out);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* =====================================================
   The editor
   ===================================================== */
function mount(host, opts) {
  opts = opts || {};
  const fields = opts.fields || [];

  const wrap = document.createElement('div');
  wrap.className = 'gmce';
  if (opts.minHeight) wrap.style.setProperty('--gmce-h', opts.minHeight);

  const tb  = document.createElement('div'); tb.className = 'gmce-tb';
  const doc = document.createElement('div');
  doc.className = 'gmce-doc';
  doc.contentEditable = 'true';
  doc.spellcheck = true;
  doc.setAttribute('data-ph', opts.placeholder || 'Write your message…');

  const src = document.createElement('textarea');
  src.className = 'gmce-src';
  src.style.display = 'none';
  src.spellcheck = false;

  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';

  wrap.append(tb, doc, src, file);
  host.innerHTML = '';
  host.appendChild(wrap);

  doc.innerHTML = editableFromEmail(opts.html || '');

  let srcMode = false, popover = null, selImg = null;

  const fire = () => { if (opts.onChange) { try { opts.onChange(); } catch (e) {} } };
  const exec = (cmd, val) => {
    doc.focus();
    try { document.execCommand(cmd, false, val == null ? null : val); } catch (e) {}
    sync(); fire();
  };

  /* execCommand emits <font> unless told otherwise. */
  function prime() {
    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  }

  function btn(label, title, fn, opt) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gmce-b';
    b.title = title;
    b.innerHTML = label;
    if (opt && opt.style) b.setAttribute('style', opt.style);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', fn);
    if (opt && opt.cmd) b.dataset.cmd = opt.cmd;
    tb.appendChild(b);
    return b;
  }
  const sep = () => { const d = document.createElement('div'); d.className = 'sep'; tb.appendChild(d); };

  /* ---------- caret helpers ---------- */
  function insertNodeAtCaret(node) {
    doc.focus();
    const sel = global.getSelection();
    if (!sel || !sel.rangeCount || !doc.contains(sel.anchorNode)) {
      doc.appendChild(node);
    } else {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(node);
      r.setStartAfter(node); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
    sync(); fire();
  }
  function insertHtmlAtCaret(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    const frag = t.content;
    const last = frag.lastChild;
    doc.focus();
    const sel = global.getSelection();
    if (!sel || !sel.rangeCount || !doc.contains(sel.anchorNode)) { doc.appendChild(frag); }
    else {
      const r = sel.getRangeAt(0);
      r.deleteContents(); r.insertNode(frag);
      if (last) { r.setStartAfter(last); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    }
    sync(); fire();
  }

  /* ---------- toolbar ---------- */
  const blockSel = document.createElement('div');
  blockSel.className = 'gmce-b';
  blockSel.innerHTML = `<select title="Text style">
    <option value="p">Normal</option><option value="h1">Title</option>
    <option value="h2">Heading</option><option value="h3">Subheading</option>
    <option value="blockquote">Quote</option></select>`;
  blockSel.querySelector('select').addEventListener('change', e => exec('formatBlock', '<' + e.target.value + '>'));
  blockSel.addEventListener('mousedown', e => e.stopPropagation());
  tb.appendChild(blockSel);
  sep();

  btn('<b>B</b>', 'Bold  (Ctrl+B)', () => exec('bold'), { cmd: 'bold' });
  btn('<i>I</i>', 'Italic  (Ctrl+I)', () => exec('italic'), { cmd: 'italic' });
  btn('<u>U</u>', 'Underline  (Ctrl+U)', () => exec('underline'), { cmd: 'underline' });

  const color = document.createElement('input');
  color.type = 'color'; color.value = '#1a1a1a';
  color.title = 'Text colour';
  color.style.cssText = 'width:28px;height:28px;padding:0;border:1px solid var(--line,#E4E7EC);border-radius:6px;background:none;cursor:pointer';
  color.addEventListener('input', () => exec('foreColor', color.value));
  tb.appendChild(color);
  sep();

  btn('☰', 'Align left',   () => exec('justifyLeft'));
  btn('☱', 'Centre',       () => exec('justifyCenter'));
  btn('☲', 'Align right',  () => exec('justifyRight'));
  sep();
  btn('• —', 'Bulleted list', () => exec('insertUnorderedList'));
  btn('1. —', 'Numbered list', () => exec('insertOrderedList'));
  sep();
  btn('🔗', 'Insert link', addLink);
  btn('🖼', 'Insert image', () => file.click());
  btn('▭', 'Insert button', addButton);
  btn('―', 'Divider', () => insertHtmlAtCaret('<hr><p><br></p>'));
  sep();

  if (fields.length) {
    const fs = document.createElement('div');
    fs.className = 'gmce-b';
    fs.innerHTML = `<select title="Insert a customer field"><option value="">Insert field…</option>${
      fields.map(f => `<option value="${esc(f.t)}">${esc(f.l)}</option>`).join('')}</select>`;
    const sl = fs.querySelector('select');
    sl.addEventListener('change', () => { if (sl.value) { insertField(sl.value); sl.value = ''; } });
    tb.appendChild(fs);
  }

  btn('⌫', 'Clear formatting', () => exec('removeFormat'));
  const srcBtn = btn('&lt;/&gt;', 'Edit the HTML directly', toggleSource);

  /* ---------- actions ---------- */
  function insertField(token) {
    const el = document.createElement('span');
    el.className = 'gmce-chip';
    el.setAttribute('data-token', token);
    el.contentEditable = 'false';
    el.textContent = '{{' + token + '}}';
    insertNodeAtCaret(el);
    insertNodeAtCaret(document.createTextNode(' '));
  }

  function addLink() {
    const sel = global.getSelection();
    const chosen = sel && String(sel).trim();
    const url = prompt('Link address:', 'https://');
    if (!url) return;
    if (chosen) exec('createLink', url);
    else insertHtmlAtCaret(`<a href="${esc(url)}">${esc(prompt('Link text:', url) || url)}</a>&nbsp;`);
  }

  function addButton() {
    const text = prompt('Button text:', 'Schedule service');
    if (!text) return;
    const url = prompt('Button links to:', 'https://');
    if (!url) return;
    insertHtmlAtCaret(
      `<p style="margin:0 0 16px"><a data-btn="1" href="${esc(url)}" style="display:inline-block;` +
      `padding:12px 26px;background:${esc(opts.accent || '#047857')};color:#ffffff;text-decoration:none;` +
      `border-radius:6px;font-weight:bold;font-size:15px">${esc(text)}</a></p><p><br></p>`);
  }

  async function addImageFile(f) {
    try {
      const dataUrl = await readImage(f, CONTENT_W * 2);   // 2x for retina
      const img = document.createElement('img');
      img.src = dataUrl;
      img.setAttribute('width', String(CONTENT_W));
      img.setAttribute('alt', f.name ? f.name.replace(/\.[a-z0-9]+$/i, '') : '');
      insertNodeAtCaret(img);
      insertHtmlAtCaret('<p><br></p>');
    } catch (e) { alert(e.message); }
  }

  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (f) addImageFile(f);
    file.value = '';
  });

  /* ---------- image popover ---------- */
  function closePop() { if (popover) { popover.remove(); popover = null; } if (selImg) { selImg.classList.remove('sel'); selImg = null; } }

  function openPop(img) {
    closePop();
    selImg = img; img.classList.add('sel');
    const p = document.createElement('div');
    p.className = 'gmce-pop';
    const lab = document.createElement('span'); lab.className = 'lbl'; lab.textContent = 'Size';
    p.appendChild(lab);
    IMG_SIZES.forEach(s => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = s.l;
      b.onclick = () => { img.setAttribute('width', String(Math.round(CONTENT_W * s.pct))); img.style.removeProperty('width'); sync(); fire(); place(); };
      p.appendChild(b);
    });
    const l2 = document.createElement('span'); l2.className = 'lbl'; l2.textContent = 'Align';
    p.appendChild(l2);
    [['Left', '0'], ['Centre', '0 auto'], ['Right', '0 0 0 auto']].forEach(([l, m]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = l;
      b.onclick = () => { img.style.display = 'block'; img.style.margin = m; sync(); fire(); };
      p.appendChild(b);
    });
    const alt = document.createElement('button');
    alt.type = 'button'; alt.textContent = 'Alt text';
    alt.onclick = () => {
      const v = prompt('Describe the image (shown if images are blocked):', img.getAttribute('alt') || '');
      if (v != null) { img.setAttribute('alt', v); sync(); fire(); }
    };
    p.appendChild(alt);
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'danger'; del.textContent = 'Remove';
    del.onclick = () => { img.remove(); closePop(); sync(); fire(); };
    p.appendChild(del);

    document.body.appendChild(p);
    popover = p;
    place();
    function place() {
      const r = img.getBoundingClientRect();
      p.style.top  = (global.scrollY + Math.max(8, r.top - p.offsetHeight - 8)) + 'px';
      p.style.left = (global.scrollX + Math.max(8, Math.min(r.left, global.innerWidth - p.offsetWidth - 12))) + 'px';
    }
  }

  doc.addEventListener('click', e => {
    if (e.target.tagName === 'IMG') { openPop(e.target); return; }
    const chip = e.target.closest && e.target.closest('[data-token]');
    if (chip) {
      const raw = chip.getAttribute('data-token');
      const bar = raw.indexOf('|');
      const name = bar < 0 ? raw : raw.slice(0, bar);
      const cur  = bar < 0 ? '' : raw.slice(bar + 1);
      const fb = prompt(
        `Text to use when {{${name}}} is empty for a customer.\nLeave blank to print nothing.`, cur);
      if (fb == null) return;
      const next = fb ? name + '|' + fb : name;
      chip.setAttribute('data-token', next);
      chip.textContent = '{{' + next + '}}';
      sync(); fire();
      return;
    }
    closePop();
  });
  document.addEventListener('mousedown', e => {
    if (popover && !popover.contains(e.target) && e.target !== selImg) closePop();
  });

  /* ---------- paste & drop ---------- */
  doc.addEventListener('paste', e => {
    const dt = e.clipboardData;
    if (!dt) return;
    const imgFile = Array.from(dt.files || []).find(f => /^image\//.test(f.type));
    if (imgFile) { e.preventDefault(); addImageFile(imgFile); return; }
    const html = dt.getData('text/html');
    if (html) { e.preventDefault(); insertHtmlAtCaret(sanitizePaste(html)); return; }
    const text = dt.getData('text/plain');
    if (text && /\n/.test(text)) { e.preventDefault(); insertHtmlAtCaret(textToEditable(text)); }
  });

  doc.addEventListener('dragover', e => { if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  doc.addEventListener('drop', e => {
    const f = e.dataTransfer && Array.from(e.dataTransfer.files || []).find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); addImageFile(f); }
  });

  /* ---------- source view ---------- */
  function toggleSource() {
    srcMode = !srcMode;
    if (srcMode) {
      src.value = toEmailHtml(doc.innerHTML);
      doc.style.display = 'none'; src.style.display = 'block';
      srcBtn.classList.add('on');
    } else {
      doc.innerHTML = editableFromEmail(src.value);
      src.style.display = 'none'; doc.style.display = 'block';
      srcBtn.classList.remove('on');
      fire();
    }
  }
  src.addEventListener('input', fire);

  /* ---------- state sync ---------- */
  function sync() {
    tb.querySelectorAll('[data-cmd]').forEach(b => {
      let on = false;
      try { on = document.queryCommandState(b.dataset.cmd); } catch (e) {}
      b.classList.toggle('on', !!on);
    });
  }
  doc.addEventListener('focus', () => { prime(); wrap.classList.add('focus'); });
  doc.addEventListener('blur',  () => wrap.classList.remove('focus'));
  doc.addEventListener('keyup', () => { sync(); fire(); });
  doc.addEventListener('input', fire);
  document.addEventListener('selectionchange', () => { if (doc.contains(document.getSelection()?.anchorNode)) sync(); });
  prime();

  return {
    el: wrap,
    getHtml() { return srcMode ? src.value.trim() : toEmailHtml(doc.innerHTML); },
    setHtml(h) {
      if (srcMode) toggleSource();
      doc.innerHTML = editableFromEmail(h || '');
      fire();
    },
    isEmpty() {
      const h = this.getHtml();
      return !h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim() && !/<img|<hr/i.test(h);
    },
    insertField,
    focus() { doc.focus(); },
    destroy() { closePop(); host.innerHTML = ''; }
  };
}

global.GMCEditor = { mount, toEmailHtml, extractImages, textToEditable, editableFromEmail, sanitizePaste, readImage, CONTENT_W };

})(window);
