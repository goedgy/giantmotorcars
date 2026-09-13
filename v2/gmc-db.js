/* ============================================================
   Giant Motor Cars — V2 data client

   Stands in for supabase-js, exposing only the slice of its API
   the CRM actually used: a chainable query builder resolving to
   {data, error}, plus email/password auth.

   Keeping the same shape is deliberate. index.html, sold.html,
   blast.html and messaging.js all speak `sb.from('leads')…`, and
   matching that means the V2 pages differ from V1 by two lines
   each instead of a hundred — far less room to break behaviour
   that already works.

   Talks to api/index.php over same-origin fetch with the session
   cookie. There is no key or credential in this file, by design.
   ============================================================ */
(function (global) {
'use strict';

function apiCall(base, action, payload) {
  return fetch(base + '?action=' + encodeURIComponent(action), {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      // Proves same-origin: a cross-site page can't set this without a
      // CORS preflight, and the API answers no preflights.
      'X-GMC-Request': '1'
    },
    body: JSON.stringify(payload || {})
  }).then(async res => {
    let body = null;
    const text = await res.text();
    if (text) { try { body = JSON.parse(text); } catch (e) { body = null; } }

    if (!res.ok) {
      let msg = (body && body.error) || '';
      if (!msg) {
        // A shared host that 500s often returns an HTML error page.
        msg = res.status === 401 ? 'Your session has expired — sign in again.'
            : res.status === 404 ? 'API not found. Check that the api/ folder uploaded correctly.'
            : `Server returned ${res.status}.`;
      }
      return { data: null, error: { message: msg, status: res.status } };
    }
    return { data: body ? body.data : null, error: null };
  }).catch(e => ({
    data: null,
    error: { message: 'Could not reach the server. ' + (e && e.message ? e.message : ''), status: 0 }
  }));
}

/* ---------- query builder ----------
   Thenable rather than a promise: the call only fires when the
   caller awaits it, exactly like supabase-js. */
function Query(base, table) {
  this._base = base;
  this._table = table;
  this._op = 'select';
  this._columns = '*';
  this._filters = [];
  this._order = null;
  this._range = null;
  this._limit = null;
  this._rows = null;
  this._patch = null;
}

Query.prototype = {
  select(cols) {
    // .select() after .insert()/.update() asks for the rows back; the CRM
    // never uses that return value, so it only narrows a plain read.
    if (this._op === 'select') this._columns = cols || '*';
    return this;
  },
  insert(rows) { this._op = 'insert'; this._rows = rows; return this; },
  update(patch) { this._op = 'update'; this._patch = patch; return this; },
  delete() { this._op = 'delete'; return this; },
  upsert(rows) { this._op = 'insert'; this._rows = rows; return this; },

  eq(c, v)  { this._filters.push([c, 'eq', v]);  return this; },
  neq(c, v) { this._filters.push([c, 'neq', v]); return this; },
  gt(c, v)  { this._filters.push([c, 'gt', v]);  return this; },
  gte(c, v) { this._filters.push([c, 'gte', v]); return this; },
  lt(c, v)  { this._filters.push([c, 'lt', v]);  return this; },
  lte(c, v) { this._filters.push([c, 'lte', v]); return this; },
  like(c, v){ this._filters.push([c, 'like', v]);return this; },
  in(c, v)  { this._filters.push([c, 'in', v]);  return this; },
  is(c, v)  { this._filters.push([c, 'is', v]);  return this; },

  order(column, opts) {
    this._order = { column, ascending: !opts || opts.ascending !== false };
    return this;
  },
  range(from, to) { this._range = [from, to]; return this; },
  limit(n) { this._limit = n; return this; },

  _payload() {
    const p = { table: this._table, filters: this._filters };
    if (this._op === 'select') {
      p.columns = this._columns;
      if (this._order) p.order = this._order;
      if (this._range) p.range = this._range;
      if (this._limit != null) p.limit = this._limit;
    }
    if (this._op === 'insert') p.rows  = this._rows;
    if (this._op === 'update') p.patch = this._patch;
    return p;
  },

  then(resolve, reject) {
    return apiCall(this._base, this._op, this._payload()).then(resolve, reject);
  },
  catch(fn) { return this.then(r => r, fn); }
};

/* ---------- auth ---------- */
function Auth(base) { this._base = base; }

Auth.prototype = {
  async signInWithPassword({ email, password }) {
    const r = await apiCall(this._base, 'login', { email, password });
    if (r.error) return { data: { user: null, session: null }, error: r.error };
    const user = r.data && r.data.user;
    return { data: { user, session: user ? { user } : null }, error: null };
  },
  /* The browser has already been handed a signed token by Google; the
     server verifies it and decides whether that address is allowed in. */
  async signInWithGoogle(credential) {
    const r = await apiCall(this._base, 'google_login', { credential });
    if (r.error) return { data: { user: null, session: null }, error: r.error };
    const user = r.data && r.data.user;
    return { data: { user, session: user ? { user } : null }, error: null };
  },
  async signOut() {
    const r = await apiCall(this._base, 'logout', {});
    return { error: r.error };
  },
  async getSession() {
    const r = await apiCall(this._base, 'session', {});
    const user = r.data && r.data.user;
    // A 401 here just means "not signed in" — not an error worth surfacing.
    return { data: { session: user ? { user } : null }, error: null };
  }
};

function createClient(apiUrl) {
  const base = (apiUrl || 'api/').replace(/\/?$/, '/');
  const auth = new Auth(base);
  return {
    from: table => new Query(base, table),
    auth
  };
}

global.GMCDB = { createClient };

})(window);
