/* ============================================================
   Giant Motor Cars — V2 "Sign in with Google" button

   Renders Google's own button and hands the ID token it produces
   to the PHP API, which verifies the signature and checks the
   address against the users table.

   No password is involved anywhere in this path, which is the
   whole point: there is nothing to guess, and Google handles the
   hard parts — unfamiliar-device checks, 2FA, account recovery.
   ============================================================ */
(function (global) {
'use strict';

/* The GIS script is loaded async, so it may not be there yet when the
   login screen renders. */
function whenReady(cb, onTimeout) {
  let waited = 0;
  (function poll() {
    if (global.google && google.accounts && google.accounts.id) return cb();
    waited += 100;
    if (waited > 8000) return onTimeout();
    setTimeout(poll, 100);
  })();
}

/*  el        container to draw the button into
    clientId  the OAuth client id from the page's config block
    onToken   async (credential) => errorMessage|null
    onStatus  (message, isError) => void                              */
function mount(el, clientId, onToken, onStatus) {
  if (!el) return;
  if (!clientId) {
    el.innerHTML = '<div style="font-size:12.5px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;' +
      'padding:9px 11px;border-radius:8px">Google sign-in isn\'t configured yet ' +
      '(<code>GOOGLE_CLIENT_ID</code> is empty in this page\'s config block).</div>';
    return;
  }

  el.innerHTML = '<div style="font-size:12.5px;color:#6B7280">Loading Google sign-in…</div>';

  whenReady(function () {
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async function (resp) {
          if (!resp || !resp.credential) { onStatus('Google did not return a sign-in token.', true); return; }
          onStatus('Checking with the server…', false);
          const err = await onToken(resp.credential);
          if (err) onStatus(err, true);
        }
      });
      el.innerHTML = '';
      const host = document.createElement('div');
      el.appendChild(host);
      google.accounts.id.renderButton(host, {
        theme: 'outline', size: 'large', text: 'signin_with',
        shape: 'rectangular', logo_alignment: 'left', width: 300
      });
      el.appendChild(originHelp());
    } catch (e) {
      el.innerHTML = '';
      onStatus('Google sign-in failed to start: ' + (e && e.message ? e.message : e), true);
    }
  }, function () {
    el.innerHTML = '<div style="font-size:12.5px;color:#991B1B;background:#FEF2F2;border:1px solid #FECACA;' +
      'padding:9px 11px;border-radius:8px">Google\'s sign-in script didn\'t load. Check the connection, ' +
      'and that this page is served over https.</div>';
  });
}

/* Google reports an origin mismatch on its own error page, which this code
   never sees — so the one string needed to fix it is printed here, exactly
   as Google wants it. Scheme and host only: no path, no trailing slash, and
   www counts as a different origin from the bare domain. */
function originHelp() {
  const wrap = document.createElement('details');
  wrap.style.cssText = 'margin-top:10px;font-size:12px;color:#6B7280;text-align:left';

  const sum = document.createElement('summary');
  sum.textContent = 'Google says "Access blocked"?';
  sum.style.cssText = 'cursor:pointer;color:#047857;font-weight:600';
  wrap.appendChild(sum);

  const body = document.createElement('div');
  body.style.cssText = 'margin-top:7px;line-height:1.5';
  body.appendChild(document.createTextNode(
    'Add this exact line to Google Cloud \u2192 APIs & Services \u2192 Credentials \u2192 ' +
    'your OAuth client \u2192 Authorized JavaScript origins:'));

  const code = document.createElement('div');
  code.textContent = global.location.origin;
  code.style.cssText = 'margin:7px 0;padding:7px 9px;background:#EDEFF3;border-radius:6px;' +
    'font-family:ui-monospace,monospace;font-size:12.5px;word-break:break-all;color:#0F1115';
  body.appendChild(code);

  const tail = document.createElement('div');
  tail.textContent = global.location.protocol !== 'https:'
    ? 'This page is not on https. Google only accepts https origins (localhost aside), so that has to be fixed first.'
    : 'Copy it as-is. No path, no trailing slash, and www is a different origin from the bare domain — if you use both, add both. Changes can take a few minutes to take effect.';
  tail.style.cssText = 'margin-top:4px';
  body.appendChild(tail);

  wrap.appendChild(body);
  return wrap;
}

global.GMCGoogle = { mount };

})(window);
