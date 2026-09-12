/* ============================================================
   Giant Motor Cars — shared messaging module
   Used by both index.html (leads) and sold.html (sold customers).

   Sends through the Gmail API directly from the browser using a
   short-lived Google access token. There is no server and no API
   secret: a Google OAuth client ID is public by design.

   Host page must provide, before loading this file:
     - window.supabase (supabase-js UMD)
     - a script tag for https://accounts.google.com/gsi/client
   and then call GMC.init({...}).
   ============================================================ */
(function (global) {
'use strict';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'email',
  'profile'
].join(' ');

const SEND_ENDPOINT    = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const USERINFO_ENDPOINT= 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_KEY        = 'gmc_gmail_token';
const SENT_COUNT_KEY   = 'gmc_gmail_sent';
const GAP_MS           = 350;    // pause between sends, keeps us well under Gmail's rate limit
const BULK_WARN_AT     = 50;     // ask for confirmation above this many recipients
const MAX_RAW_BYTES    = 25 * 1024 * 1024;   // Gmail's per-message ceiling
const DAILY_CAP        = 500;    // free Gmail; Workspace is 2,000

/* ---------- module state ---------- */
const M = {
  sb: null, LIVE: false, recordType: 'lead', cfg: {},
  getUserName: () => 'You',
  onSent: null,             // host callback after a batch finishes
  templates: [],
  token: null,              // {access_token, expires_at, email}
  tokenClient: null,
  compose: null             // live compose-screen state
};

/* =====================================================
   1. FIELD REGISTRY — what {{tokens}} resolve to
   ===================================================== */
const clean = v => (v == null ? '' : String(v).trim());

function splitName(full) {
  const parts = clean(full).split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

function prettyDate(d) {
  if (!d) return '';
  const t = Date.parse(d);
  if (isNaN(t)) return clean(d);
  const x = new Date(t);
  return ['January','February','March','April','May','June','July',
          'August','September','October','November','December'][x.getUTCMonth()]
         + ' ' + x.getUTCDate() + ', ' + x.getUTCFullYear();
}

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/* Renders as $389.42. Returns '' for blanks so {{payment_amount|…}} fallbacks fire. */
function prettyMoney(v) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  if (isNaN(n)) return '';
  return MONEY.format(n);
}

/* "Bi-Weekly" -> "bi-weekly", so it reads inside a sentence. */
function schedWord(s) {
  const v = clean(s).toLowerCase();
  if (!v) return '';
  if (/bi.?week|every other week/.test(v)) return 'bi-weekly';
  if (/semi.?month|twice/.test(v)) return 'semi-monthly';
  if (/week/.test(v)) return 'weekly';
  if (/month/.test(v)) return 'monthly';
  return v;
}

function prettyPhone(p) {
  const d = clean(p).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return clean(p);
}

const FIELDS = {
  lead: [
    { t: 'first_name',   l: 'First name',    g: r => splitName(r.name).first },
    { t: 'last_name',    l: 'Last name',     g: r => splitName(r.name).last  },
    { t: 'full_name',    l: 'Full name',     g: r => clean(r.name) },
    { t: 'email',        l: 'Email',         g: r => clean(r.email) },
    { t: 'phone',        l: 'Phone',         g: r => prettyPhone(r.phone) },
    { t: 'vehicle',      l: 'Vehicle',       g: r => clean(r.vehicle) },
    { t: 'stock_number', l: 'Stock #',       g: r => clean(r.stock_number) },
    { t: 'source',       l: 'Lead source',   g: r => clean(r.source) },
    { t: 'deal_type',    l: 'Deal type',     g: r => r.deal_type === 'cash' ? 'Cash' : 'Finance' },
    { t: 'assigned_to',  l: 'Salesperson',   g: r => clean(r.assigned_to) },
    { t: 'credit_score', l: 'Credit score',  g: r => clean(r.credit_score) }
  ],
  sold: [
    { t: 'first_name',   l: 'First name',    g: r => clean(r.first_name) },
    { t: 'last_name',    l: 'Last name',     g: r => clean(r.last_name) },
    { t: 'full_name',    l: 'Full name',     g: r => [r.first_name, r.last_name].filter(Boolean).join(' ') },
    { t: 'email',        l: 'Email',         g: r => clean(r.email) },
    { t: 'phone',        l: 'Best phone',    g: r => prettyPhone(r.cell_phone || r.home_phone) },
    { t: 'vehicle',      l: 'Vehicle',       g: r => [r.veh_year, r.veh_make, r.veh_model].filter(Boolean).join(' ') },
    { t: 'veh_year',     l: 'Year',          g: r => clean(r.veh_year) },
    { t: 'veh_make',     l: 'Make',          g: r => clean(r.veh_make) },
    { t: 'veh_model',    l: 'Model',         g: r => clean(r.veh_model) },
    { t: 'vin',          l: 'VIN',           g: r => clean(r.vin) },
    { t: 'vin_last6',    l: 'VIN last 6',    g: r => clean(r.vin_last6) },
    { t: 'sale_date',    l: 'Sale date',     g: r => prettyDate(r.sale_date) },
    { t: 'sale_type',    l: 'Sale type',     g: r => clean(r.sale_type) },
    { t: 'first_payment_date',      l: 'First payment due', g: r => prettyDate(r.first_payment_date) },
    { t: 'payment_amount',          l: 'Payment amount',    g: r => prettyMoney(r.note_payment_amount) },
    { t: 'pay_schedule',            l: 'Pay schedule',      g: r => schedWord(r.pay_schedule) },
    { t: 'number_of_payments',      l: 'Number of payments',g: r => clean(r.num_payments) },
    { t: 'next_due_date',           l: 'Next payment due',  g: r => prettyDate(r.current_due_date) },
    { t: 'lien_holder',             l: 'Lienholder',        g: r => clean(r.lien_holder) },
    { t: 'service_contract_company',l: 'Service contract',  g: r => clean(r.service_contract_company) },
    { t: 'tag_number',   l: 'Tag / plate #', g: r => clean(r.tag_number) },
    { t: 'cobuyer_first',l: 'Co-buyer first',g: r => clean(r.cobuyer_first) },
    { t: 'cobuyer_name', l: 'Co-buyer name', g: r => [r.cobuyer_first, r.cobuyer_last].filter(Boolean).join(' ') }
  ]
};

/* Tokens that don't come from the record itself. */
function globalFields() {
  return [
    { t: 'dealer_name',  l: 'Dealer name',  g: () => clean(M.cfg.DEALER_NAME) },
    { t: 'dealer_phone', l: 'Dealer phone', g: () => clean(M.cfg.DEALER_PHONE) },
    { t: 'my_name',      l: 'Your name',    g: () => M.getUserName() },
    { t: 'today',        l: "Today's date", g: () => prettyDate(new Date().toISOString()) }
  ];
}

function fieldsFor(type) {
  return (FIELDS[type] || []).concat(globalFields());
}

function emailOf(rec, type) {
  return clean(type === 'sold' ? rec.email : rec.email);
}

function nameOf(rec, type) {
  return type === 'sold'
    ? [rec.first_name, rec.last_name].filter(Boolean).join(' ')
    : clean(rec.name);
}

/* =====================================================
   2. MERGE ENGINE
   {{token}}            -> value, or '' if blank
   {{token|fallback}}   -> value, or the fallback text if blank
   ===================================================== */
function renderTemplate(str, rec, type) {
  if (!str) return '';
  const map = {};
  fieldsFor(type).forEach(f => { map[f.t] = f; });

  return String(str).replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|([^}]*))?\}\}/gi, (whole, token, fallback) => {
    const f = map[token.toLowerCase()];
    if (!f) return whole;                       // unknown token: leave visible so it gets noticed
    let v = '';
    try { v = clean(f.g(rec)); } catch (e) { v = ''; }
    if (v) return v;
    return fallback == null ? '' : fallback;
  });
}

/* Which tokens in a template will come out empty for this record? */
function missingTokens(str, rec, type) {
  const map = {};
  fieldsFor(type).forEach(f => { map[f.t] = f; });
  const out = [];
  String(str || '').replace(/\{\{\s*([a-z0-9_]+)\s*(?:\|([^}]*))?\}\}/gi, (w, token, fallback) => {
    const f = map[token.toLowerCase()];
    if (!f) { out.push({ token, reason: 'unknown' }); return w; }
    let v = ''; try { v = clean(f.g(rec)); } catch (e) {}
    if (v) return w;
    // A fallback keeps the sentence readable but still means this customer
    // has no real value — worth surfacing, not hiding.
    out.push({ token, reason: (fallback == null || fallback === '') ? 'blank' : 'defaulted' });
    return w;
  });
  return out;
}

/* =====================================================
   3. GMAIL AUTH (Google Identity Services)
   ===================================================== */
function loadToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return (t && t.expires_at > Date.now() + 60000) ? t : null;
  } catch (e) { return null; }
}

function storeToken(t) {
  M.token = t;
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) {}
}

function clearToken() {
  M.token = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

function gmailConfigured() { return !!clean(M.cfg.GOOGLE_CLIENT_ID); }
function gmailConnected()  { return !!(M.token && M.token.expires_at > Date.now() + 60000); }
function gmailAddress()    { return M.token ? M.token.email : ''; }

function ensureTokenClient() {
  if (M.tokenClient) return M.tokenClient;
  if (!global.google || !google.accounts || !google.accounts.oauth2) {
    throw new Error('Google sign-in library did not load. Check your internet connection and that the page is served over http(s), not opened as a file.');
  }
  M.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clean(M.cfg.GOOGLE_CLIENT_ID),
    scope: GMAIL_SCOPES,
    callback: () => {}      // replaced per-request below
  });
  return M.tokenClient;
}

/* prompt:'' asks Google to reissue silently if the user already consented. */
function requestToken(interactive) {
  return new Promise((resolve, reject) => {
    let client;
    try { client = ensureTokenClient(); } catch (e) { return reject(e); }

    client.callback = async (resp) => {
      if (resp.error) {
        return reject(new Error(
          resp.error === 'access_denied'
            ? 'Google access was declined.'
            : (resp.error_description || resp.error)
        ));
      }
      const tok = {
        access_token: resp.access_token,
        expires_at: Date.now() + ((resp.expires_in || 3600) * 1000),
        email: ''
      };
      try {
        const r = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: 'Bearer ' + tok.access_token } });
        if (r.ok) { const j = await r.json(); tok.email = j.email || ''; }
      } catch (e) { /* address is cosmetic; sending still works */ }
      storeToken(tok);
      resolve(tok);
    };

    try {
      client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (e) { reject(e); }
  });
}

async function ensureToken(interactive) {
  if (gmailConnected()) return M.token;
  const cached = loadToken();
  if (cached) { M.token = cached; return cached; }
  return requestToken(!!interactive);
}

async function connectGmail() {
  if (!gmailConfigured()) throw new Error('No Google client ID configured yet. See gmail-setup.md.');
  const t = await requestToken(true);
  return t;
}

function disconnectGmail() {
  const t = M.token;
  clearToken();
  if (t && global.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(t.access_token, () => {}); } catch (e) {}
  }
}

/* =====================================================
   4. SENDING
   ===================================================== */
function toBinary(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return bin;
}

function b64url(str) {
  return btoa(toBinary(str)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* RFC 2045 caps an encoded line at 76 chars. */
function wrap76(b64) {
  return (String(b64).match(/.{1,76}/g) || []).join('\r\n');
}

function b64body(str) {
  return wrap76(btoa(toBinary(str)));
}

function boundary(tag) {
  return '--=_gmc_' + tag + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function encodeHeader(s) {
  // RFC 2047 for any non-ASCII in the subject line
  return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

/* Plain-text body -> simple, mail-client-safe HTML. */
function textToHtml(text) {
  const paras = String(text || '').split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, '<br>')}</p>`
  ).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">${paras}</div>`;
}

/* Does this template body carry markup, or is it one of the older plain-text ones? */
function looksLikeHtml(s) {
  return /<(p|div|br|span|table|h[1-6]|ul|ol|li|img|a|strong|em|b|i|hr|blockquote)\b[^>]*>/i.test(String(s || ''));
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decodeEntities(s) {
  const str = String(s);
  if (str.indexOf('&') < 0) return str;
  // The browser knows every named entity by heart. A textarea's content is
  // parsed as raw text, so nothing in here can execute.
  try {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
  } catch (e) {}
  return str.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(n) ? m : String.fromCodePoint(n);
    }
    const v = ENT[e.toLowerCase()];
    return v == null ? m : v;
  });
}

/* Every HTML email needs a text/plain twin. Spam filters weigh its absence,
   and some clients (and watches) show nothing else. */
function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const t = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    if (!href || /^(mailto:|tel:|#)/i.test(href)) return t || href;
    return t && t.replace(/\/$/, '') !== href.replace(/\/$/, '') ? `${t} (${href})` : (t || href);
  });
  s = s.replace(/<img\b[^>]*\balt\s*=\s*"([^"]+)"[^>]*>/gi, '[$1]');
  s = s.replace(/<img\b[^>]*>/gi, '');
  s = s.replace(/<li\b[^>]*>/gi, '\n• ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n');
  s = s.replace(/<hr\b[^>]*>/gi, '\n————————\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/\u00a0/g, ' ');
  // Source indentation is meaningless once the tags are gone.
  s = s.split('\n').map(l => l.trim()).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/* Wraps composed content in a centred 600px card. Table-based on purpose —
   Outlook still ignores most modern layout CSS, and every style is inline
   because Gmail strips <style> blocks. */
function wrapEmail(inner, opts) {
  opts = opts || {};
  const brand  = clean(M.cfg.DEALER_NAME);
  const accent = clean(M.cfg.EMAIL_ACCENT) || '#047857';
  const header = opts.header !== false && !!brand;
  const foot   = opts.footer === false ? '' : footerFor();
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(opts.subject || brand)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f7;-webkit-text-size-adjust:100%">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f2f4f7">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e4e7ec;border-radius:12px">
${header ? `<tr><td style="background:${accent};padding:17px 28px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;border-radius:11px 11px 0 0">${escHtml(brand)}</td></tr>` : ''}
<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">${inner}</td></tr>
${foot ? `<tr><td style="padding:0 28px 22px">${foot}</td></tr>` : ''}
</table>
</td></tr></table></body></html>`;
}

function footerFor() {
  const bits = [];
  if (clean(M.cfg.DEALER_NAME))    bits.push(escHtml(M.cfg.DEALER_NAME));
  if (clean(M.cfg.DEALER_ADDRESS)) bits.push(escHtml(M.cfg.DEALER_ADDRESS));
  if (clean(M.cfg.DEALER_PHONE))   bits.push(escHtml(M.cfg.DEALER_PHONE));
  if (!bits.length) return '';
  return `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e0e0e0;
    font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#888">
    ${bits.join(' &middot; ')}<br>
    Don't want these emails? Reply with "unsubscribe" and we'll take you off the list.
  </div>`;
}

/* text/plain + text/html side by side; the client picks. */
function partAlternative(text, html) {
  const b = boundary('alt');
  return {
    headers: [`Content-Type: multipart/alternative; boundary="${b}"`],
    body: [
      `--${b}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64', '',
      b64body(text), '',
      `--${b}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64', '',
      b64body(html), '',
      `--${b}--`
    ].join('\r\n')
  };
}

/* Inline images ride along as related parts the HTML references by cid:.
   Embedding them as data: URIs instead would be simpler and would not work —
   Gmail, Outlook and Apple Mail all refuse to render data: image sources. */
function partRelated(alt, images) {
  const b = boundary('rel');
  const out = [`--${b}`, ...alt.headers, '', alt.body, ''];
  images.forEach(im => {
    out.push(
      `--${b}`,
      `Content-Type: ${im.mime}; name="${im.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${im.cid}>`,
      `Content-Disposition: inline; filename="${im.name}"`, '',
      wrap76(im.b64), ''
    );
  });
  out.push(`--${b}--`);
  return {
    headers: [`Content-Type: multipart/related; type="multipart/alternative"; boundary="${b}"`],
    body: out.join('\r\n')
  };
}

function buildMime({ to, toName, subject, html, text, images, fromName, replyTo }) {
  const headers = [`To: ${toName ? `${encodeHeader(toName)} <${to}>` : to}`];
  if (fromName && M.token && M.token.email) {
    headers.push(`From: ${encodeHeader(fromName)} <${M.token.email}>`);
  }
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeader(subject || '')}`, 'MIME-Version: 1.0');

  const body = text != null && text !== '' ? text : htmlToText(html);
  let part = partAlternative(body, html);
  if (images && images.length) part = partRelated(part, images);

  // The blank line between headers and body is required — do not filter it out.
  return headers.concat(part.headers).join('\r\n') + '\r\n\r\n' + part.body;
}

async function sendOne({ to, toName, subject, html, text, images, fromName, replyTo }) {
  const raw = b64url(buildMime({ to, toName, subject, html, text, images, fromName, replyTo }));
  if (raw.length > MAX_RAW_BYTES) {
    throw new Error(`Email is ${(raw.length / 1048576).toFixed(1)} MB — over Gmail's 25 MB limit. Remove or shrink an image.`);
  }
  const res = await fetch(SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + M.token.access_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) {}
    if (res.status === 401) { clearToken(); throw new Error('AUTH_EXPIRED'); }
    if (res.status === 403 && /rate|quota|limit/i.test(detail)) throw new Error('Gmail rate limit reached. Wait a minute and send the rest.');
    if (res.status === 429) throw new Error('Gmail rate limit reached. Wait a minute and send the rest.');
    throw new Error(detail || `Gmail returned ${res.status}`);
  }
  return res.json();     // {id, threadId, labelIds}
}

/* rough daily counter so a bulk send doesn't silently hit Gmail's cap */
function bumpSentCount(n) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(localStorage.getItem(SENT_COUNT_KEY) || '{}');
    const cur = raw.date === today ? raw.n : 0;
    localStorage.setItem(SENT_COUNT_KEY, JSON.stringify({ date: today, n: cur + n }));
  } catch (e) {}
}
function sentToday() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(localStorage.getItem(SENT_COUNT_KEY) || '{}');
    return raw.date === today ? raw.n : 0;
  } catch (e) { return 0; }
}

/* =====================================================
   5. LOGGING
   ===================================================== */
async function logMessage(row) {
  if (!M.LIVE || !M.sb) return;
  try { await M.sb.from('messages').insert(row); }
  catch (e) { console.warn('message log failed', e); }
}

async function logLeadActivity(leadId, body) {
  if (!M.LIVE || !M.sb || M.recordType !== 'lead') return;
  try {
    await M.sb.from('lead_activities').insert({
      lead_id: leadId, author: M.getUserName(), type: 'email', body
    });
  } catch (e) { console.warn('activity log failed', e); }
}

async function historyFor(recordId) {
  if (!M.LIVE || !M.sb) return [];
  const { data } = await M.sb.from('messages')
    .select('*')
    .eq('record_type', M.recordType).eq('record_id', recordId)
    .order('created_at', { ascending: false }).limit(25);
  return data || [];
}

/* =====================================================
   6. TEMPLATE STORE
   ===================================================== */
async function loadTemplates() {
  if (!M.LIVE || !M.sb) { M.templates = demoTemplates(); return M.templates; }
  const { data, error } = await M.sb.from('message_templates')
    .select('*')
    .eq('record_type', M.recordType).eq('channel', 'email').eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) { console.warn('template load failed', error); M.templates = []; }
  else M.templates = data || [];
  return M.templates;
}

async function saveTemplate(t) {
  if (!M.LIVE || !M.sb) {
    if (t.id) Object.assign(M.templates.find(x => x.id === t.id) || {}, t);
    else M.templates.push({ ...t, id: 'demo' + Date.now() });
    return;
  }
  const payload = {
    name: t.name, subject: t.subject, body: t.body, category: t.category || null,
    record_type: M.recordType, channel: 'email', is_active: true,
    sort_order: t.sort_order || 0, created_by: M.getUserName()
  };
  const q = t.id
    ? M.sb.from('message_templates').update(payload).eq('id', t.id)
    : M.sb.from('message_templates').insert(payload);
  const { error } = await q;
  if (error) throw new Error(error.message);
  await loadTemplates();
}

async function deleteTemplate(id) {
  if (!M.LIVE || !M.sb) { M.templates = M.templates.filter(t => t.id !== id); return; }
  const { error } = await M.sb.from('message_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await loadTemplates();
}

function demoTemplates() {
  return M.recordType === 'lead' ? [
    { id: 'dt1', name: 'Thanks for stopping by', category: 'Follow-up',
      subject: 'Great meeting you at {{dealer_name}}',
      body: "Hi {{first_name|there}},\n\nThanks for coming by today and taking a look at the {{vehicle}}.\n\nAny questions at all, just reply here or call {{dealer_phone}}.\n\nBest,\n{{my_name}}" },
    { id: 'dt2', name: 'Still interested?', category: 'Follow-up',
      subject: 'Still thinking about the {{vehicle}}?',
      body: "Hi {{first_name|there}},\n\nChecking in on the {{vehicle}} (stock #{{stock_number}}). It's still available if you'd like another look.\n\n{{my_name}}\n{{dealer_name}} · {{dealer_phone}}" }
  ] : [
    { id: 'dt3', name: 'First payment reminder', category: 'Payments',
      subject: 'Reminder: first payment due {{first_payment_date}}',
      body: "Hi {{first_name|there}},\n\nA quick friendly reminder about your first payment on the {{vehicle}}:\n\n  • Amount: {{payment_amount|see your contract}}\n  • Due: {{first_payment_date|see your contract}}\n  • Pay to: {{lien_holder|your lender}}\n\n{{my_name}}\n{{dealer_name}} · {{dealer_phone}}" },
    { id: 'dt4', name: 'Congratulations', category: 'Post-sale',
      subject: 'Congratulations on your {{vehicle}}!',
      body: "Hi {{first_name|there}},\n\nCongratulations on your {{veh_year}} {{veh_make}} {{veh_model}} — thank you for your business.\n\nYour first payment of {{payment_amount|the amount on your contract}} is due {{first_payment_date|on the date shown there}} to {{lien_holder|your lender}}.\n\n{{my_name}}\n{{dealer_name}}" },
    { id: 'dt5', name: 'Payment coming up', category: 'Payments',
      subject: 'Your {{payment_amount}} payment is due {{next_due_date}}',
      body: "Hi {{first_name|there}},\n\nJust a heads up that your {{pay_schedule|regular}} payment on the {{vehicle}} is coming due.\n\n  • Amount: {{payment_amount|see your contract}}\n  • Due: {{next_due_date|see your contract}}\n\n{{my_name}}\n{{dealer_name}} · {{dealer_phone}}" }
  ];
}

/* =====================================================
   7. RECIPIENT TRIAGE
   ===================================================== */
function triage(records) {
  const send = [], skip = [];
  const seen = new Set();
  records.forEach(r => {
    const email = emailOf(r, M.recordType);
    const name  = nameOf(r, M.recordType) || '(no name)';
    if (!email)                       return skip.push({ rec: r, name, why: 'No email address on file' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
                                      return skip.push({ rec: r, name, why: 'Email looks invalid: ' + email });
    if (r.email_opt_out)              return skip.push({ rec: r, name, why: 'Unsubscribed' });
    const key = email.toLowerCase();
    if (seen.has(key))                return skip.push({ rec: r, name, why: 'Duplicate of another selected record' });
    seen.add(key);
    send.push({ rec: r, name, email });
  });
  return { send, skip };
}

/* =====================================================
   8. PUBLIC API
   ===================================================== */
function init(opts) {
  M.sb          = opts.sb || null;
  M.LIVE        = !!opts.LIVE;
  M.recordType  = opts.recordType;
  M.cfg         = opts.config || {};
  M.getUserName = opts.getUserName || (() => 'You');
  M.onSent      = opts.onSent || null;
  M.token       = loadToken();
  loadTemplates();
  return M;
}

global.GMC = {
  init,
  fieldsFor, renderTemplate, missingTokens,
  emailOf, nameOf, triage,
  loadTemplates, saveTemplate, deleteTemplate,
  get templates() { return M.templates; },
  connectGmail, disconnectGmail, gmailConnected, gmailConfigured, gmailAddress,
  ensureToken, sendOne, buildMime, textToHtml, htmlToText, looksLikeHtml,
  wrapEmail, footerFor, escHtml,
  logMessage, logLeadActivity, historyFor,
  bumpSentCount, sentToday,
  prettyDate, prettyPhone, prettyMoney,
  _state: M,
  GAP_MS, BULK_WARN_AT, MAX_RAW_BYTES, DAILY_CAP
};

})(window);
