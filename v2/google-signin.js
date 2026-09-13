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
      google.accounts.id.renderButton(el, {
        theme: 'outline', size: 'large', text: 'signin_with',
        shape: 'rectangular', logo_alignment: 'left', width: 300
      });
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

global.GMCGoogle = { mount };

})(window);
