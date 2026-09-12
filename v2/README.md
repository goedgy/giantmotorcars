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
| Login | Supabase Auth | PHP sessions, bcrypt passwords |
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
`"1,204.50"` becomes `1204.50`. Rows whose id already exists are skipped, so
re-running the same file is harmless if an import is interrupted.

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
| `setup.php` | install wizard — delete after use |
| `import-supabase.php` | CSV migration — delete after use |

---

## How the security works

Worth understanding, because it's the part that changed most.

In V1 the browser held a publishable Supabase key and talked to the database
directly; Row Level Security was the only thing between a visitor and your
customer list. In V2 the browser holds nothing. Every request carries a
session cookie, `api/index.php` rejects anything without a signed-in session,
and the database credential never leaves the server.

- **Passwords** are bcrypt via `password_hash()`, re-hashed automatically if
  PHP's default cost changes. Login failures are throttled to 10 per IP per
  15 minutes, and a wrong address and a wrong password give the same message
  so the form can't be used to discover who has an account.
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

Adding more people: insert into the `users` table with a hash from
`php -r 'echo password_hash("their-password", PASSWORD_DEFAULT);'`.

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
