# Giant Motor Cars CRM

> **Two versions live here.** This page describes **V1**, which runs on
> Supabase and deploys to GitHub Pages. **[`v2/`](v2/) is the same CRM with
> Supabase replaced by PHP + MySQL**, to run on Namecheap shared hosting —
> see [v2/README.md](v2/README.md). V1 is unchanged and still works; nothing
> here has to be switched off to try V2.

Two static pages backed by Supabase, with Gmail sending built in. No build step, no server — the browser talks to Supabase and to the Gmail API directly.

| Page | Live address |
|---|---|
| Leads pipeline | https://goedgy.github.io/giantmotorcars/ |
| Sold customers | https://goedgy.github.io/giantmotorcars/sold.html |
| Email blast | https://goedgy.github.io/giantmotorcars/blast.html |

## What's in here

| File | |
|---|---|
| `index.html` | Leads board — kanban pipeline, Frazer import, per-lead detail |
| `sold.html` | Sold customers — table, filters, tag tracking, full record editor, Frazer import |
| `blast.html` | Email blast — audience builder, rich composer, live preview, batch send |
| `messaging.js` | Shared email engine: field registry, `{{token}}` merge, MIME assembly, Gmail OAuth + send, message logging |
| `email-editor.js` | Rich text editor — formatting, inline images, merge-token chips, email-safe HTML output |
| `messaging-ui.js` | Compose screen, template manager, per-record email history |
| `gmail-setup.md` | One-time setup: database scripts, Google Cloud, sending guide |
| `.github/workflows/pages.yml` | Deploys the repo root to GitHub Pages on every push to `main` |

## How an email is built

Worth knowing, because two of these steps are why the emails render properly:

1. You compose in `email-editor.js`. Images sit in the document as `data:` URIs so you can see them while you work.
2. On the way out, `toEmailHtml()` inlines every style. Gmail strips `<style>` blocks, so anything not inlined is lost.
3. `extractImages()` swaps each `data:` URI for a `cid:` reference and hands back the bytes. **No major mail client renders a `data:` image** — they have to travel as attached parts.
4. `wrapEmail()` puts the content in a 600px table-based card. Outlook still uses Word's rendering engine and ignores most modern layout CSS.
5. `buildMime()` assembles `multipart/related` → `multipart/alternative` → (`text/plain` + `text/html`) → image parts. The plain-text twin matters for spam scoring.

Images are downscaled to 1088px wide and re-encoded before they are ever attached. They are also extracted **once per batch**, not once per recipient, since they are identical for everyone.

## Deploying

Push to `main` and the site rebuilds in about a minute — watch it under **Actions**.

**One-time switch, required before the first successful deploy:** **Settings → Pages → Source → GitHub Actions**. Until it's selected the workflow fails at `configure-pages` with *"Resource not accessible by integration"* — Actions' own token isn't allowed to create the Pages site, only a repo admin can. Once it's on, re-run the latest workflow and every push deploys on its own.

## Running it locally

```bash
npx --yes http-server . -p 8080 -c-1
```

Then open http://localhost:8080/index.html. Opening the file directly (`file:///…`) breaks Google sign-in — it needs a real origin.

## Configuration

Both pages carry a config block at the top (`window.LEADS_CONFIG` / `window.SOLD_CONFIG`) holding the Supabase URL, the publishable key, dealer name, phone, address, and the Google OAuth client ID. All of these are client-side values, public by design.

Because they are public, **the security boundary is Supabase Row Level Security, not the key**. Anyone can read the key off the live page; RLS policies are what keep customer data behind a login. Worth confirming RLS is enabled on `leads`, `sold_customers`, `messages`, and `message_templates`.

## Database

`gmail-setup.md` Part 1 references two SQL scripts — `supabase-messaging-schema.sql` and `supabase-add-payment-amount.sql` — that aren't in this repo yet. Add them here so the schema lives alongside the code.
