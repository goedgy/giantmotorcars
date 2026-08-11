/* ============================================================
   Giant Motor Cars — messaging UI
   Compose screen, template manager, and record email history.
   Depends on messaging.js (window.GMC) and the host page's
   modal() / closeModal() helpers.
   ============================================================ */
(function (global) {
'use strict';

const esc = s => GMC.escHtml(s);
let C = null;   // compose state

/* ---------- styles (injected so host pages need no CSS edits) ---------- */
(function injectCss() {
  if (document.getElementById('gmc-msg-css')) return;
  const s = document.createElement('style');
  s.id = 'gmc-msg-css';
  s.textContent = `
  /* The host pages cap .modal at 600px. Messaging screens are two-column,
     so they opt into a much wider shell and never scroll sideways. */
  .modal.gmc-wide{max-width:1320px!important;width:94vw!important;max-height:94vh!important;overflow-x:hidden!important}
  .gmc-wide .modal-b{padding:22px 26px}
  .gmc-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:26px;align-items:start}
  @media(max-width:1000px){.gmc-cols{grid-template-columns:minmax(0,1fr)}}
  .gmc-wide *{min-width:0}
  .gmc-wide .modal-h h2{font-size:18px}
  .gmc-lbl{font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:5px}
  .gmc-in{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;outline:none;font-size:14px;background:#fff}
  .gmc-in:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(47,107,255,.12)}
  textarea.gmc-in{min-height:clamp(240px,40vh,480px);resize:vertical;line-height:1.55;font-family:inherit}
  .gmc-bar{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;font-size:13px;margin-bottom:14px}
  .gmc-bar.ok{background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0}
  .gmc-bar.warn{background:#FFFBEB;color:#92400E;border:1px solid #FDE68A}
  .gmc-bar.err{background:#FEF2F2;color:#991B1B;border:1px solid #FECACA}
  .gmc-bar .sp{flex:1}
  .gmc-btn-sm{padding:6px 11px;border-radius:7px;font-weight:600;font-size:12px;border:1px solid var(--line);background:#fff;cursor:pointer}
  .gmc-btn-sm:hover{border-color:var(--primary);color:var(--primary)}
  .gmc-tok{display:inline-block;padding:3px 8px;margin:0 4px 5px 0;border-radius:6px;background:var(--primary-soft,#EAF0FF);
    color:var(--primary-ink,#1E4FCC);font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid transparent;font-family:'JetBrains Mono',monospace}
  .gmc-tok:hover{border-color:var(--primary)}
  .gmc-prev{border:1px solid var(--line);border-radius:10px;background:#FAFBFC;padding:16px;
    min-height:clamp(280px,46vh,540px);font-size:13.5px;line-height:1.55;overflow-wrap:anywhere}
  .gmc-prev .subj{font-weight:700;font-size:14.5px;padding-bottom:9px;margin-bottom:11px;border-bottom:1px solid var(--line)}
  /* The preview renders in an iframe so email styles can't leak into the app. */
  .gmc-pvf{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#f2f4f7}
  .gmc-pvf iframe{display:block;width:100%;height:clamp(300px,50vh,540px);border:0;background:#f2f4f7}
  .gmc-step{display:flex;align-items:center;gap:8px;margin-bottom:9px}
  .gmc-step button{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:#fff;font-weight:700;cursor:pointer}
  .gmc-step button:disabled{opacity:.35;cursor:default}
  .gmc-step .who{flex:1;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gmc-tlist{max-height:clamp(180px,26vh,320px);overflow:auto;border:1px solid var(--line);border-radius:9px}
  .gmc-titem{padding:9px 11px;border-bottom:1px solid var(--line-2,#EDEFF3);cursor:pointer;display:flex;gap:8px;align-items:center}
  .gmc-titem:last-child{border-bottom:none}
  .gmc-titem:hover{background:var(--primary-soft,#EAF0FF)}
  .gmc-titem.on{background:var(--primary-soft,#EAF0FF);box-shadow:inset 3px 0 0 var(--primary)}
  .gmc-titem .nm{font-weight:600;font-size:13px;flex:1}
  .gmc-titem .cat{font-size:11px;color:var(--muted);background:#fff;border:1px solid var(--line);padding:1px 7px;border-radius:20px}
  .gmc-skip{margin-top:12px;border:1px solid #FDE68A;background:#FFFBEB;border-radius:9px;padding:10px 12px;font-size:12.5px;color:#92400E}
  .gmc-skip ul{margin:7px 0 0;padding-left:17px}
  .gmc-skip li{margin-bottom:3px}
  .gmc-prog{height:9px;border-radius:20px;background:var(--line);overflow:hidden;margin:14px 0 8px}
  .gmc-prog i{display:block;height:100%;background:var(--primary);transition:width .2s}
  .gmc-res{max-height:300px;overflow:auto;font-size:13px}
  .gmc-res .row{display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--line-2,#EDEFF3)}
  .gmc-res .row .ic{width:18px;flex:none;text-align:center}
  .gmc-hist{margin-top:6px}
  .gmc-hist .h{display:flex;gap:9px;padding:8px 0;border-bottom:1px solid var(--line-2,#EDEFF3);font-size:13px}
  .gmc-hist .h .ic{width:20px;flex:none}
  .gmc-hist .h .t{font-size:11.5px;color:var(--muted);margin-top:2px}
  `;
  document.head.appendChild(s);
})();

/* ---------- small helpers ---------- */

/* The host pages' modal() hardcodes class="modal", so widen it afterwards. */
function wideModal(html) {
  global.modal(html);
  const m = document.querySelector('#scrim .modal');
  if (m) m.classList.add('gmc-wide');
}

function when(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 864e5);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return d + 'd ago';
  return GMC.prettyDate(iso);
}

function gmailBar() {
  if (!GMC.gmailConfigured()) {
    return `<div class="gmc-bar err"><span>⚠</span><span class="sp">Gmail isn't set up yet — add your Google client ID to the config block at the top of this page. See <b>gmail-setup.md</b>.</span></div>`;
  }
  if (GMC.gmailConnected()) {
    const n = GMC.sentToday();
    return `<div class="gmc-bar ok"><span>✓</span><span class="sp">Sending as <b>${esc(GMC.gmailAddress() || 'your Gmail account')}</b>${n ? ` · ${n} sent today` : ''}</span>
      <button class="gmc-btn-sm" onclick="GMCUI.disconnect()">Disconnect</button></div>`;
  }
  return `<div class="gmc-bar warn"><span>◷</span><span class="sp">Not connected to Gmail yet.</span>
    <button class="gmc-btn-sm" onclick="GMCUI.connect()">Connect Gmail</button></div>`;
}

async function connect() {
  try { await GMC.connectGmail(); redraw(); }
  catch (e) { alert('Could not connect to Gmail:\n\n' + e.message); }
}
function disconnect() { GMC.disconnectGmail(); redraw(); }

/* =====================================================
   COMPOSE
   ===================================================== */
async function openCompose(records) {
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) return alert('Select at least one record first.');

  const { send, skip } = GMC.triage(list);
  C = {
    all: list, send, skip,
    templateId: null, subject: '', body: '',
    idx: 0, sending: false, results: null, showSkip: false
  };

  if (!GMC.templates.length) await GMC.loadTemplates();
  redraw();
}

function redraw() {
  if (!C) return;
  wideModal(composeHtml());
  mountEditor();
  refreshPreview();   // the iframe is built empty; fill it before anyone types
}

/* Remounted on every redraw; typing only repaints the preview, so the
   caret survives everything except an explicit template switch. */
function mountEditor() {
  const host = document.getElementById('gmcEd');
  if (!host || !global.GMCEditor) return;
  C.editor = GMCEditor.mount(host, {
    html: C.body,
    fields: GMC.fieldsFor(GMC._state.recordType),
    accent: GMC._state.cfg.EMAIL_ACCENT,
    minHeight: '260px',
    placeholder: 'Write your message. Use the toolbar for formatting and images.',
    onChange: () => { C.body = C.editor.getHtml(); refreshPreview(); }
  });
}

function composeHtml() {
  const n = C.send.length;

  if (C.results) return resultsHtml();
  if (C.sending) return progressHtml();

  return `
  <div class="modal-h">
    <div><h2>${n === 1 ? 'Send email' : `Send email to ${n} customers`}</h2>
      <div style="font-size:12.5px;color:var(--muted);margin-top:3px">
        ${n} recipient${n === 1 ? '' : 's'}${C.skip.length ? ` · <span style="color:#B45309;font-weight:600">${C.skip.length} skipped</span>` : ''}
        · each email is sent individually and personalized
      </div></div>
    <button class="x" onclick="GMCUI.close()">×</button>
  </div>
  <div class="modal-b">
    ${gmailBar()}
    <div class="gmc-cols">
      <div>
        <div class="gmc-lbl">Template</div>
        <div class="gmc-tlist">
          <div class="gmc-titem ${C.templateId === null ? 'on' : ''}" onclick="GMCUI.pickTemplate(null)">
            <span class="nm">✎ Write from scratch</span></div>
          ${GMC.templates.map(t => `
            <div class="gmc-titem ${C.templateId === t.id ? 'on' : ''}" onclick="GMCUI.pickTemplate('${t.id}')">
              <span class="nm">${esc(t.name)}</span>
              ${t.category ? `<span class="cat">${esc(t.category)}</span>` : ''}
            </div>`).join('')}
        </div>
        <div style="text-align:right;margin:7px 0 14px">
          <button class="gmc-btn-sm" onclick="GMCUI.openTemplates()">Manage templates</button>
        </div>

        <div class="gmc-lbl">Subject</div>
        <input class="gmc-in" id="gmcSubj" value="${esc(C.subject)}"
          placeholder="Subject line — tokens work here too"
          oninput="GMCUI.onEdit('subject',this.value)" style="margin-bottom:13px">

        <div class="gmc-lbl">Message</div>
        <div id="gmcEd"></div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:9px;line-height:1.5">
          <b>Insert field…</b> in the toolbar drops in a merge token. Click a token to choose what it
          says when a customer is missing that value — <code style="background:var(--line-2,#EDEFF3);padding:1px 5px;border-radius:4px">{{first_name|there}}</code>
          prints “there” for anyone with no first name. Images are attached to the email itself, so
          nothing needs hosting.
        </div>
      </div>

      <div>
        <div class="gmc-lbl">Preview</div>
        ${previewHtml()}
        ${C.skip.length ? skipHtml() : ''}
      </div>
    </div>
  </div>
  <div class="modal-f">
    <button class="btn-ghost" onclick="GMCUI.close()">Cancel</button>
    <div style="flex:1"></div>
    <span id="gmcWarn" style="font-size:12px;color:#B45309;margin-right:10px">${blankWarning()}</span>
    <button class="btn-primary" onclick="GMCUI.send()" ${n ? '' : 'disabled style="opacity:.5"'}>
      ${n === 1 ? 'Send email' : `Send ${n} emails`}
    </button>
  </div>`;
}

function previewHtml() {
  if (!C.send.length) {
    return `<div class="gmc-prev" style="color:var(--muted);display:grid;place-items:center">
      Nobody in this selection can be emailed.</div>`;
  }
  const i = Math.min(C.idx, C.send.length - 1);
  const r = C.send[i];

  return `
  <div class="gmc-step">
    <button onclick="GMCUI.step(-1)" ${i === 0 ? 'disabled' : ''}>‹</button>
    <button onclick="GMCUI.step(1)" ${i >= C.send.length - 1 ? 'disabled' : ''}>›</button>
    <div class="who"><b>${esc(r.name)}</b> &lt;${esc(r.email)}&gt;
      <span style="color:var(--muted)"> · ${i + 1} of ${C.send.length}</span></div>
  </div>
  <div class="subj" id="gmcPvSubj" style="font-weight:700;font-size:14px;margin-bottom:8px"></div>
  <div class="gmc-pvf"><iframe id="gmcPv" sandbox="" title="Email preview"></iframe></div>`;
}

/* Rebuilds the whole right-hand column (recipient changed). */
function renderPreviewPane() {
  const p = document.querySelector('.gmc-cols > div:last-child');
  if (!p) return;
  p.innerHTML = `<div class="gmc-lbl">Preview</div>${previewHtml()}${C.skip.length ? skipHtml() : ''}`;
  refreshPreview();
}

/* Cheap path: only the rendered email and the warning line change. */
function refreshPreview() {
  if (!C || !C.send.length) return;
  const i = Math.min(C.idx, C.send.length - 1);
  const r = C.send[i];
  const type = GMC._state.recordType;
  const subj = GMC.renderTemplate(C.subject, r.rec, type);
  const body = GMC.renderTemplate(C.body, r.rec, type);

  const s = document.getElementById('gmcPvSubj');
  if (s) s.innerHTML = subj ? esc(subj) : '<span style="color:var(--muted);font-weight:400">(no subject)</span>';

  const f = document.getElementById('gmcPv');
  if (f) f.srcdoc = GMC.wrapEmail(
    body || '<p style="color:#9AA3AF">Your message will appear here, with this customer’s details filled in.</p>',
    { subject: subj });

  const w = document.getElementById('gmcWarn');
  if (w) w.textContent = blankWarning();
}

function blankWarning() {
  if (!C.send.length || (!C.subject && !C.body)) return '';
  const type = GMC._state.recordType;
  const blank = new Map(), fell = new Map(), unknown = new Set();
  const affected = new Set();
  C.send.forEach(r => {
    // A token can appear in both the subject and the body — count each
    // recipient once per token, not once per occurrence.
    const seen = new Set();
    GMC.missingTokens(C.subject + '\n' + C.body, r.rec, type).forEach(m => {
      if (m.reason === 'unknown') return unknown.add(m.token);
      if (seen.has(m.token)) return;
      seen.add(m.token);
      affected.add(r);
      const bucket = m.reason === 'defaulted' ? fell : blank;
      bucket.set(m.token, (bucket.get(m.token) || 0) + 1);
    });
  });

  const parts = [];
  if (unknown.size) parts.push(`{{${[...unknown][0]}}} isn't a real field${unknown.size > 1 ? ` (+${unknown.size - 1})` : ''}`);
  [...blank.entries()].slice(0, 2).forEach(([tok, ct]) =>
    parts.push(`{{${tok}}} empty for ${ct} of ${C.send.length}`));
  if (blank.size > 2) parts.push(`+${blank.size - 2} more`);
  if (fell.size) {
    const n = affected.size;
    parts.push(`${n} recipient${n === 1 ? '' : 's'} missing data — fallback text used`);
  }
  return parts.length ? '⚠ ' + parts.join(' · ') : '';
}

function skipHtml() {
  return `<div class="gmc-skip">
    <b>${C.skip.length} record${C.skip.length === 1 ? '' : 's'} will be skipped</b>
    <button class="gmc-btn-sm" style="float:right;margin-top:-2px" onclick="GMCUI.toggleSkip()">${C.showSkip ? 'Hide' : 'Show'}</button>
    ${C.showSkip ? `<ul>${C.skip.map(s => `<li>${esc(s.name)} — ${esc(s.why)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/* ---------- compose interactions ---------- */
function pickTemplate(id) {
  const t = id ? GMC.templates.find(x => String(x.id) === String(id)) : null;
  C.templateId = t ? t.id : null;
  if (t) {
    C.subject = t.subject || '';
    // Templates written before the rich editor are plain text.
    C.body = GMC.looksLikeHtml(t.body) ? t.body : GMCEditor.textToEditable(t.body || '');
  }
  redraw();
}

/* Update state and refresh only the preview, so the caret stays put. */
function onEdit(key, val) {
  C[key] = val;
  refreshPreview();
}

function insert(token) {
  if (C.editor) C.editor.insertField(token);
}

function step(d) {
  C.idx = Math.max(0, Math.min(C.send.length - 1, C.idx + d));
  renderPreviewPane();
}

function toggleSkip() { C.showSkip = !C.showSkip; redraw(); }
function close() {
  if (C && C.editor) { try { C.editor.destroy(); } catch (e) {} }
  C = null;
  global.closeModal();
}

/* ---------- sending ---------- */
function progressHtml() {
  const done = C.progress || 0, total = C.send.length;
  return `
  <div class="modal-h"><h2>Sending…</h2></div>
  <div class="modal-b">
    <div style="font-size:13.5px;color:var(--muted)">${done} of ${total} sent${C.current ? ` · ${esc(C.current)}` : ''}</div>
    <div class="gmc-prog"><i style="width:${total ? (done / total * 100) : 0}%"></i></div>
    <div style="font-size:12.5px;color:var(--muted)">Keep this window open until it finishes.</div>
  </div>`;
}

function resultsHtml() {
  const { sent, failed } = C.results;
  return `
  <div class="modal-h">
    <div><h2>${failed.length ? 'Finished with problems' : 'All sent'}</h2>
    <div style="font-size:12.5px;color:var(--muted);margin-top:3px">
      ${sent.length} sent${failed.length ? ` · ${failed.length} failed` : ''}${C.skip.length ? ` · ${C.skip.length} skipped` : ''}</div></div>
    <button class="x" onclick="GMCUI.close()">×</button>
  </div>
  <div class="modal-b">
    <div class="gmc-res">
      ${sent.map(s => `<div class="row"><span class="ic" style="color:#059669">✓</span>
        <span>${esc(s.name)} <span style="color:var(--muted)">&lt;${esc(s.email)}&gt;</span></span></div>`).join('')}
      ${failed.map(f => `<div class="row"><span class="ic" style="color:#DC2626">✕</span>
        <span>${esc(f.name)} <span style="color:var(--muted)">&lt;${esc(f.email)}&gt;</span>
        <div style="color:#B91C1C;font-size:12px">${esc(f.error)}</div></span></div>`).join('')}
    </div>
  </div>
  <div class="modal-f"><div style="flex:1"></div>
    <button class="btn-primary" onclick="GMCUI.close()">Done</button></div>`;
}

async function send() {
  if (!C || !C.send.length) return;
  if (C.editor) C.body = C.editor.getHtml();
  const bodyEmpty = C.editor ? C.editor.isEmpty() : !C.body.trim();
  if (!C.subject.trim() && bodyEmpty) return alert('Add a subject or a message first.');
  if (!C.subject.trim() && !confirm('This email has no subject line. Send anyway?')) return;

  if (!GMC.gmailConfigured()) {
    return alert('Gmail is not set up yet.\n\nAdd your Google OAuth client ID to the config block at the top of this page. Setup steps are in gmail-setup.md.');
  }

  try { await GMC.ensureToken(true); }
  catch (e) { return alert('Could not connect to Gmail:\n\n' + e.message); }

  const n = C.send.length;
  if (n >= GMC.BULK_WARN_AT && !confirm(
      `You're about to send ${n} individual emails as ${GMC.gmailAddress()}.\n\n` +
      `Gmail limits personal accounts to about 500 recipients per day (2,000 on Workspace). ` +
      `You've sent ${GMC.sentToday()} today from this app.\n\nContinue?`)) return;

  const type    = GMC._state.recordType;
  const batchId = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const sender  = GMC._state.getUserName();

  // Images are the same for everyone — pull them out of the body once and
  // attach the identical parts to each message.
  const { html: cidBody, images } = GMCEditor.extractImages(C.body);

  C.sending = true; C.progress = 0; C.current = '';
  redraw();

  const sent = [], failed = [];

  for (const r of C.send) {
    const subject = GMC.renderTemplate(C.subject, r.rec, type);
    const merged  = GMC.renderTemplate(cidBody, r.rec, type);
    const html    = GMC.wrapEmail(merged, { subject });
    const bodyTxt = GMC.htmlToText(html);

    C.current = r.name;
    const bar = document.querySelector('.gmc-prog i');
    const hd  = document.querySelector('.modal-b > div');
    if (bar) bar.style.width = (C.progress / C.send.length * 100) + '%';
    if (hd)  hd.textContent = `${C.progress} of ${C.send.length} sent · ${r.name}`;

    try {
      const res = await GMC.sendOne({
        to: r.email, toName: r.name, subject, html, text: bodyTxt, images,
        fromName: GMC._state.cfg.DEALER_NAME
      });
      sent.push(r);
      GMC.bumpSentCount(1);
      await GMC.logMessage({
        record_type: type, record_id: r.rec.id, template_id: C.templateId || null,
        channel: 'email', to_address: r.email, to_name: r.name,
        subject, body: bodyTxt, status: 'sent',
        provider_message_id: res.id || null, provider_thread_id: res.threadId || null,
        batch_id: batchId, sent_by: sender, from_address: GMC.gmailAddress(),
        sent_at: new Date().toISOString()
      });
      await GMC.logLeadActivity(r.rec.id, `Emailed: ${subject || '(no subject)'}`);
    } catch (e) {
      const msg = e.message === 'AUTH_EXPIRED'
        ? 'Gmail session expired — reconnect and send the rest.'
        : e.message;
      failed.push({ ...r, error: msg });
      await GMC.logMessage({
        record_type: type, record_id: r.rec.id, template_id: C.templateId || null,
        channel: 'email', to_address: r.email, to_name: r.name,
        subject, body: bodyTxt, status: 'failed', error: msg,
        batch_id: batchId, sent_by: sender
      });
      if (e.message === 'AUTH_EXPIRED') break;   // no point hammering a dead token
    }

    C.progress++;
    if (C.progress < C.send.length) await new Promise(z => setTimeout(z, GMC.GAP_MS));
  }

  // anything not attempted (auth died mid-run)
  C.send.slice(C.progress).forEach(r => {
    if (!sent.includes(r) && !failed.find(f => f.rec === r.rec))
      failed.push({ ...r, error: 'Not attempted — sending stopped early.' });
  });

  C.sending = false;
  C.results = { sent, failed };
  redraw();
  if (GMC._state.onSent) { try { GMC._state.onSent({ sent, failed }); } catch (e) {} }
}

/* =====================================================
   TEMPLATE MANAGER
   ===================================================== */
let T = null;

async function openTemplates() {
  await GMC.loadTemplates();
  T = { editing: null };
  drawTemplates();
}

function drawTemplates() {
  const type = GMC._state.recordType;
  const label = type === 'lead' ? 'lead' : 'sold customer';

  if (T.editing) return drawTemplateEditor();

  wideModal(`
  <div class="modal-h">
    <div><h2>Email templates</h2>
      <div style="font-size:12.5px;color:var(--muted);margin-top:3px">For ${label} records</div></div>
    <button class="x" onclick="GMCUI.closeTemplates()">×</button>
  </div>
  <div class="modal-b">
    ${GMC.templates.length ? `<div class="gmc-tlist" style="max-height:420px">
      ${GMC.templates.map(t => `<div class="gmc-titem">
        <span class="nm">${esc(t.name)}
          <div style="font-weight:400;font-size:12px;color:var(--muted);margin-top:2px">${esc(t.subject || '(no subject)')}</div>
        </span>
        ${t.category ? `<span class="cat">${esc(t.category)}</span>` : ''}
        <button class="gmc-btn-sm" onclick="GMCUI.editTemplate('${t.id}')">Edit</button>
        <button class="gmc-btn-sm" style="color:#B91C1C" onclick="GMCUI.removeTemplate('${t.id}')">Delete</button>
      </div>`).join('')}
    </div>` : `<div style="text-align:center;color:var(--muted);padding:40px 0">No templates yet.</div>`}
  </div>
  <div class="modal-f">
    <button class="btn-ghost" onclick="GMCUI.closeTemplates()">Back</button>
    <div style="flex:1"></div>
    <button class="btn-primary" onclick="GMCUI.editTemplate(null)">New template</button>
  </div>`);
}

function drawTemplateEditor() {
  const t = T.editing;
  const fields = GMC.fieldsFor(GMC._state.recordType);
  wideModal(`
  <div class="modal-h"><h2>${t.id ? 'Edit template' : 'New template'}</h2>
    <button class="x" onclick="GMCUI.closeTemplates()">×</button></div>
  <div class="modal-b">
    <div class="gmc-cols">
      <div>
        <div class="gmc-lbl">Template name</div>
        <input class="gmc-in" id="tpl_name" value="${esc(t.name || '')}" placeholder="e.g. First payment reminder" style="margin-bottom:12px">
        <div class="gmc-lbl">Category <span style="font-weight:400;text-transform:none">(optional)</span></div>
        <input class="gmc-in" id="tpl_cat" value="${esc(t.category || '')}" placeholder="e.g. Follow-up" style="margin-bottom:12px">
        <div class="gmc-lbl">Subject</div>
        <input class="gmc-in" id="tpl_subj" value="${esc(t.subject || '')}" style="margin-bottom:12px">
        <div class="gmc-lbl">Body</div>
        <div id="tpl_ed"></div>
      </div>
      <div>
        <div class="gmc-lbl">Available fields</div>
        <div style="border:1px solid var(--line);border-radius:9px;padding:11px;background:#FAFBFC">
          ${fields.map(f => `<span class="gmc-tok" title="${esc(f.l)}" onclick="GMCUI.insertTpl('${f.t}')">{{${f.t}}}</span>`).join('')}
        </div>
        <div style="font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.6">
          Click a field to drop it into the body. Every token is replaced per customer when the email goes out.
          <br><br>
          Use <code style="background:var(--line-2,#EDEFF3);padding:1px 5px;border-radius:4px">{{lien_holder|your lender}}</code>
          so the sentence still reads correctly when a record has that field blank.
        </div>
      </div>
    </div>
  </div>
  <div class="modal-f">
    <button class="btn-ghost" onclick="GMCUI.backToTemplates()">Cancel</button>
    <div style="flex:1"></div>
    <button class="btn-primary" onclick="GMCUI.saveTemplateForm()">Save template</button>
  </div>`);

  const host = document.getElementById('tpl_ed');
  if (host && global.GMCEditor) {
    T.editor = GMCEditor.mount(host, {
      html: GMC.looksLikeHtml(t.body) ? t.body : GMCEditor.textToEditable(t.body || ''),
      fields: GMC.fieldsFor(GMC._state.recordType),
      accent: GMC._state.cfg.EMAIL_ACCENT,
      minHeight: '300px',
      placeholder: 'Write the template. Tokens are filled in per customer when it is sent.'
    });
  }
}

function editTemplate(id) {
  T = T || {};
  T.editing = id ? { ...GMC.templates.find(x => String(x.id) === String(id)) } : { name: '', subject: '', body: '', category: '' };
  drawTemplateEditor();
}

function insertTpl(token) {
  if (T && T.editor) T.editor.insertField(token);
}

async function saveTemplateForm() {
  const name = document.getElementById('tpl_name').value.trim();
  if (!name) return alert('Give the template a name.');
  const t = {
    id: T.editing.id,
    name,
    category: document.getElementById('tpl_cat').value.trim(),
    subject: document.getElementById('tpl_subj').value,
    body: T.editor ? T.editor.getHtml() : ''
  };
  if (T.editor ? T.editor.isEmpty() : !t.body.trim()) return alert('The template body is empty.');
  try { await GMC.saveTemplate(t); }
  catch (e) { return alert('Could not save: ' + e.message); }
  T.editing = null;
  drawTemplates();
}

async function removeTemplate(id) {
  const t = GMC.templates.find(x => String(x.id) === String(id));
  if (!t || !confirm(`Delete the template “${t.name}”?`)) return;
  try { await GMC.deleteTemplate(id); } catch (e) { return alert('Could not delete: ' + e.message); }
  drawTemplates();
}

function backToTemplates() { T.editing = null; drawTemplates(); }

/* Closing the manager returns to compose if that's where we came from. */
function closeTemplates() {
  T = null;
  if (C) redraw(); else global.closeModal();
}

/* =====================================================
   RECORD EMAIL HISTORY (for detail views)
   ===================================================== */
async function historyHtml(recordId) {
  const rows = await GMC.historyFor(recordId);
  if (!rows.length) return '<div style="color:var(--muted);font-size:13px;padding:10px 0">No emails sent yet.</div>';
  return `<div class="gmc-hist">${rows.map(m => `
    <div class="h">
      <span class="ic">${m.status === 'sent' ? '📧' : m.status === 'failed' ? '⚠️' : '·'}</span>
      <div>
        <div style="font-weight:${m.status === 'failed' ? '600' : '500'};color:${m.status === 'failed' ? '#B91C1C' : 'inherit'}">
          ${esc(m.subject || '(no subject)')}</div>
        <div class="t">${esc(m.sent_by || '')} · ${when(m.created_at)} · to ${esc(m.to_address)}
          ${m.status === 'failed' ? ` · <span style="color:#B91C1C">${esc(m.error || 'failed')}</span>` : ''}</div>
      </div>
    </div>`).join('')}</div>`;
}

/* ---------- exports ---------- */
global.GMCUI = {
  openCompose, close, pickTemplate, onEdit, insert, step, toggleSkip, send,
  connect, disconnect,
  openTemplates, closeTemplates, editTemplate, insertTpl, saveTemplateForm,
  removeTemplate, backToTemplates,
  historyHtml,
  get composeState() { return C; }
};

})(window);
