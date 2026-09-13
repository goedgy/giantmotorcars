# Giant Motor Cars CRM — V2 (PHP + MySQL)

The same CRM as the version in the folder above, with Supabase replaced by
PHP and MySQL so it runs entirely on your own Namecheap shared hosting.

Nothing in the parent folder changed. V1 still works against Supabase; run
both side by side until you're happy with this one.

---

## What's different from V1

| | V1 | V2 |
|---|---|---|
| Database | Supabase (hosted Postgres) | MySQL on your host |
| Data API | supabase-js → PostgREST | `gmc-db.js` → `api/index.php` |
| Login | Supabase Auth | Sign in with Google (passwords optional, and best turned off) |
| Security boundary | Row Level Security, public key in the page | Server-side session check; **no credential in the browser at all** |
| Monthly cost | Supabase plan | included in hosting you already pay for |

The pages, the email engine, the rich text editor and the blast page are
byte-identical apart from two lines each — the config block and the line
that creates the client. That was deliberate: `gmc-db.js` deliberately
mimics the slice of the supabase-js API the CRM used, so the working code
didn't have to be rewritten to swap the backend underneath it.

---

## Install (about 15 minutes)

### 1. Create the database in cPanel
**MySQL® Databases** →
- Create a database, e.g. `gmccrm`
- Create a user with a strong password
- **Add User To Database** → tick **ALL PRIVILEGES**

cPanel prefixes both with your account name, so you'll end up with something
like `giantmo_gmccrm` and `giantmo_gmc`. Write down all three values.

### 2. Upload
Put everything in this `v2` folder into `public_html` (or a subfolder like
`public_html/crm`). Keep the structure — `api/` must sit next to the pages.

### 3. Run setup
Visit `https://yourdomain.com/setup.php` and follow the three steps:
database credentials → create tables → create your sign-in.

Then **delete `setup.php`**. It refuses to run a second time, but there's no
reason to leave it up.

### 4. Point Google at the new address
Google Cloud → **Credentials** → your OAuth client → add your domain to
**Authorized JavaScript origins** (`https://yourdomain.com` — bare host, no
path). Everything else in `gmail-setup.md` still applies unchanged; Gmail
sending is client-side and didn't move.

---

## Bringing your data across

Open `import-supabase.php` while signed in. For each table: export it from
Supabase (**Table Editor → … → Export data as CSV**) and upload it here.

Import **`leads` and `sold_customers` first** — `messages` and
`lead_activities` reference their ids.

The importer maps Postgres types to MySQL as it goes: `true`/`false` become
1/0, ISO timestamps become `DATETIME`, empty strings become `NULL`, and
`"1,204.50"` becomes `1204.50`.

**Re-running the same file is harmless.** A row is skipped if its id is
already present, *or* if its natural key is — VIN + last name for a sold
customer, DealerCenter id (or name + phone) for a lead. The natural key is
what matters for a CSV with no `id` column, such as a Frazer export: without
it every row would arrive as a brand new record.

A large file can take a minute with no visible sign of progress. Don't
reload or submit twice — and if you already have, nothing is lost: see
below.

### If you ended up with duplicates

Open **`fix-duplicates.php`** (signed in). It scans every table, shows you
what it found, and changes nothing until you confirm.

It merges rather than deletes. For each set of copies it keeps the most
complete row — the oldest wins a tie, since that's the one everything else
already points at — then:

1. fills in any field only the copies have (so an imported lienholder
   survives, and so does a tag number that only ever existed in the CRM),
2. moves the copies' sent email and lead activity onto the kept row,
3. and only then removes the empty shells.

Run it as many times as you like; once clean it reports nothing to do.

Delete `import-supabase.php` when you're done.

> Sold customers can also simply be re-imported from a fresh Frazer export
> using the app's own **Import from Frazer**, which may be easier than a CSV
> round trip.

---

## Files

| | |
|---|---|
| `index.html`, `sold.html`, `blast.html` | the three pages, unchanged except the data layer |
| `gmc-db.js` | the client — chainable query builder + auth, speaking to `api/` |
| `messaging.js`, `messaging-ui.js`, `email-editor.js` | identical to V1; they only ever touch data through `sb.from(...)` |
| `api/index.php` | the whole API: login/logout/session + select/insert/update/delete |
| `api/schema.php` | table and column whitelist — the thing that makes identifiers safe |
| `api/bootstrap.php` | config, PDO, session, type coercion |
| `api/config.php` | **your database password.** Written by setup.php, git-ignored |
| `schema.sql` | the seven tables |
| `users.php` | who can sign in — add, deactivate, promote |
| `google-signin.js`, `api/google_auth.php` | Sign in with Google, and the ID token verification behind it |
| `upgrade.php` | applies schema changes and the Google client id to an existing install — delete after use |
| `setup.php` | install wizard — delete after use |
| `import-supabase.php` | CSV migration — delete after use |
| `fix-duplicates.php` | merges rows that are the same record under different ids — delete after use |
| `api/dupkeys.php` | what counts as "the same record" — shared by the importer and the cleanup |

---

## Signing in

**Sign in with Google is the way in.** There is no password to guess, and
Google does the hard parts — unfamiliar-device checks, 2FA, account recovery.

Being a valid Google account is not enough. The address must also be listed
on the **Users** page; anyone else is refused by name:

> There is no account here for someone@example.com.

### Adding someone

Open `users.php` (signed in as an admin) → **Add someone** → their name and
the Google address they actually sign in with. Leave the password blank.
Nothing is emailed to them; tell them to open the CRM and press **Sign in
with Google**.

The same page deactivates, reactivates, promotes to admin, removes a
password, or removes a person entirely. It won't let you deactivate or
delete your own account, or remove the last admin — the two ways a small
team locks itself out.

### Turning passwords off

Once everyone has signed in with Google at least once, open `upgrade.php`
and untick **Keep accepting email + password sign-in**. From then on the
API refuses password sign-in outright and there is nothing left to brute
force. Test the Google button in a private window *before* you do this.

### While passwords are still on

They're throttled two ways: 10 failures per IP and **5 per account** in 15
minutes. The per-account cap is the one that matters — throttling by IP
alone leaves a single address open to unlimited guessing from a rotating
set of addresses, which is how this would really be attacked.

A wrong address and a wrong password take the same time to answer and give
the same message, so the form can't be used to discover who has an account.
A locked-out account can still get in with Google, so a lockout can never
shut you out completely.

---

## How the security works

Worth understanding, because it's the part that changed most.

In V1 the browser held a publishable Supabase key and talked to the database
directly; Row Level Security was the only thing between a visitor and your
customer list. In V2 the browser holds nothing. Every request carries a
session cookie, `api/index.php` rejects anything without a signed-in session,
and the database credential never leaves the server.

- **Google ID tokens** are verified here, not taken on trust: RS256 signature
  against Google's published keys, issuer, expiry, and — easy to forget and
  fatal to skip — that the `aud` claim is *our* client id, so a token minted
  for some other site can't be replayed. `alg:none` and HS256 key-confusion
  forgeries are both rejected.
- **Passwords**, while enabled, are bcrypt via `password_hash()` and throttled
  per IP *and* per account. See "Signing in" above.
- **SQL injection** — values are always bound parameters. Table and column
  names can't be bound, so they're checked against the whitelist in
  `api/schema.php` and rejected if unknown; that covers `ORDER BY` and the
  column list too.
- **CSRF** — the session cookie is `SameSite=Strict`, and every request must
  carry an `X-GMC-Request` header. A cross-origin page can't set a custom
  header without a CORS preflight, and the API answers no preflights.
- **Mass updates** — an `UPDATE` or `DELETE` with no filter is refused rather
  than rewriting the whole table.
- `.htaccess` denies web access to `config.php`, and forces HTTPS.

Adding more people: the **Users** page. No database editing, and with Google
sign-in no password to invent or transmit.

---

## Things to know

**Back it up.** This is now your data. cPanel → **Backup** covers it, and a
nightly dump is worth adding under **Cron Jobs**:

```
0 3 * * * mysqldump -u DBUSER -p'DBPASS' DBNAME > ~/backups/gmccrm-$(date +\%F).sql
```

**Large templates.** A template with an image inlined can run to a megabyte or
more. If saving one fails, raise `post_max_size` and `upload_max_filesize` in
cPanel's **MultiPHP INI Editor** — the default is often 8 MB.

**Scheduled sends are now possible.** V1 couldn't do drip campaigns because
there was no server. There is one now — a cron job hitting a PHP script could
send on a schedule. Not built yet, but the database is already shaped for it.

**PHP 8.0 or newer.** Check under **Select PHP Version**; 8.1+ preferred.

---

## If something goes wrong

| What you see | Fix |
|---|---|
| "The API is not configured yet" | `api/config.php` missing — run `setup.php` |
| "Database error" on every action | Wrong credentials in `api/config.php`, or the user wasn't granted privileges on the database |
| Login says the password is wrong when it isn't | More than 10 failed attempts from your IP — wait 15 minutes |
| Signed out on every page load | Cookies blocked, or you're browsing over plain `http` on a host that also serves `https` — use the https address |
| "API not found" | The `api/` folder didn't upload, or uploaded to the wrong level |
| Blank white page | PHP error — check cPanel → **Errors**, and confirm the PHP version is 8.0+ |
| Template with an image won't save | `post_max_size` too small — see above |
| Import looks frozen | A few thousand rows takes a minute. Wait it out; don't submit twice |
| Records appear twice | Run `fix-duplicates.php` |
| "There is no account here for…" | That Google address isn't on the Users page yet |
| The Google button doesn't appear | `GOOGLE_CLIENT_ID` is empty in the page's config block, or the page isn't on https |
| Google button appears but sign-in fails | Your domain isn't in **Authorized JavaScript origins** in Google Cloud — bare host, no path |
| "Google sign-in is not configured" | `google_client_id` missing from `api/config.php` — run `upgrade.php` |
