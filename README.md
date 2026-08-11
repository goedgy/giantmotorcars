# Giant Motor Cars CRM

Two static pages backed by Supabase, with Gmail sending built in. No build step, no server — the browser talks to Supabase and to the Gmail API directly.

| Page | Live address |
|---|---|
| Leads pipeline | https://goedgy.github.io/giantmotorcars/ |
| Sold customers | https://goedgy.github.io/giantmotorcars/sold.html |

## What's in here

| File | |
|---|---|
| `index.html` | Leads board — kanban pipeline, Frazer import, per-lead detail |
| `sold.html` | Sold customers — table, filters, tag tracking, Frazer import |
| `messaging.js` | Shared email engine: field registry, `{{token}}` merge, Gmail OAuth + send, message logging |
| `messaging-ui.js` | Compose screen, template manager, per-record email history |
| `gmail-setup.md` | One-time setup: database scripts, Google Cloud, sending guide |
| `.github/workflows/pages.yml` | Deploys the repo root to GitHub Pages on every push to `main` |

## Deploying

Push to `main` and the site rebuilds in about a minute — watch it under **Actions**.

One-time switch: **Settings → Pages → Source → GitHub Actions**. Until that's selected the workflow will run and then fail at the deploy step.

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
