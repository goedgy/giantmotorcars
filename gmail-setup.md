# Setting up email sending

Two things to do once: run the database script, then connect Gmail. Budget about 20 minutes.

---

## Part 1 — Database (5 minutes)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `supabase-messaging-schema.sql` and click **Run**.
3. New query again → paste `supabase-add-payment-amount.sql` → **Run**.

The first script creates the `message_templates` and `messages` tables, adds opt-out columns to `leads` and `sold_customers`, and loads 11 starter templates. The second adds the four Frazer note fields (`Payment Amt`, `Pay Schedule`, `Number of Payments`, `Current Date Due`) and updates the payment templates to use them.

Both are safe to re-run — nothing duplicates, and the template updates skip any template you've edited yourself.

---

## Part 2 — Serve the pages from a web address

Google will not allow sign-in from a page opened directly as a file (a `file:///C:/...` address). The pages need a real origin.

**This is already set up.** The repo publishes itself to GitHub Pages on every push to `main`:

| | |
|---|---|
| Leads | https://goedgy.github.io/giantmotorcars/ |
| Sold customers | https://goedgy.github.io/giantmotorcars/sold.html |

One switch has to be flipped by hand the first time: **repo → Settings → Pages → Source → GitHub Actions**. After that every push deploys in about a minute (watch it under the **Actions** tab).

**For testing on your own machine**, open a terminal in this folder and run:

```bash
npx --yes http-server . -p 8080 -c-1
```

Then use `http://localhost:8080/index.html`. Google accepts `localhost` as a valid origin.

---

## Part 3 — Google Cloud (15 minutes)

### 3.1 Create a project
Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in as **giantmotorcars@gmail.com** — the account the emails should come from.

Top bar → project dropdown → **New Project**. Name it `Giant Motor Cars CRM`. Create, then make sure it's the selected project.

### 3.2 Turn on the Gmail API
**APIs & Services → Library** → search `Gmail API` → **Enable**.

### 3.3 Set up the consent screen
**APIs & Services → OAuth consent screen**.

- User type: **External** → Create
- App name: `Giant Motor Cars CRM`
- User support email: your Gmail
- Developer contact email: your Gmail
- Save and continue through the remaining steps.

### 3.4 Add the scope
On the **Scopes** step → **Add or remove scopes** → filter for `gmail.send` and tick:

```
https://www.googleapis.com/auth/gmail.send
```

This is send-only. It cannot read your inbox. Save and continue.

### 3.5 Publish the app — don't skip this
Back on the **OAuth consent screen** page, find **Publishing status**. If it says *Testing*, click **Publish app** and confirm.

**Why this matters:** while an app sits in Testing, Google expires its access every 7 days, and you'd have to reconnect Gmail every week. Publishing removes that.

You do **not** need Google's formal verification review. Because the app is unverified, the first time you connect you'll see a screen saying *"Google hasn't verified this app."* Click **Advanced** → **Go to Giant Motor Cars CRM (unsafe)**. That warning is expected — you wrote the app, and it's your own account. Verification is only needed to remove the warning or go past 100 users.

### 3.6 Create the client ID
**APIs & Services → Credentials → Create credentials → OAuth client ID**.

- Application type: **Web application**
- Name: `CRM browser`
- Under **Authorized JavaScript origins**, click **Add URI** and add every address you'll open the app from:
  - `https://goedgy.github.io` — the live site
  - `http://localhost:8080` — local testing

An origin is scheme + host + port only. Enter `https://goedgy.github.io`, **not** `https://goedgy.github.io/giantmotorcars/` — Google rejects origins with a path.

Leave *Authorized redirect URIs* empty — this flow doesn't use them.

Click **Create** and copy the **Client ID**. It looks like:

```
123456789012-abc123def456.apps.googleusercontent.com
```

> Origins must match exactly, including `http` vs `https` and the port. `http://localhost:8080` and `http://localhost:3000` are different origins.

### 3.7 Paste it into both pages
**Already done** — both pages carry client ID `227059275402-…apps.googleusercontent.com` and the dealer address. Only revisit this if you create a new client ID. It lives in the config block at the top of `index.html` and `sold.html`:

```js
GOOGLE_CLIENT_ID:  "123456789012-abc123def456.apps.googleusercontent.com",
DEALER_ADDRESS:    "1234 N Dale Mabry Hwy, Tampa, FL 33607",
```

`DEALER_ADDRESS` appears in the footer of every email. **CAN-SPAM requires a valid physical postal address** in commercial email, so fill this in before sending marketing messages.

---

## Using it

**One customer** — open any record, click **✉ Email** at the bottom.

**Several at once** — tick the checkboxes in the list, then **✉ Email N customers** in the blue bar. Ticking the header checkbox selects everything currently filtered, so you can filter to "Tag pending" or a given lienholder and email exactly that group.

The first send each session pops a Google window to connect. After that it's silent until you close the browser.

Every email is sent **individually**. Recipients never see each other, and each message has that customer's own details merged in.

### Templates
**✉ Templates** in the toolbar. Leads and Sold have separate template sets, since the useful fields differ.

Click any field name to insert it. Add a fallback with a pipe so sentences still read correctly when a record is missing that field:

```
{{first_name|there}}              → "Hi there," when no name
{{lien_holder|your lender}}       → works for BHPH and cash deals
```

The compose screen warns you before sending if a field is empty for some recipients, and lets you step through every recipient to see exactly what they'll receive. It flags two different situations: a token that renders **blank**, and a token that fell back to substitute text because that customer has no real value.

### Payment fields
From your Frazer export:

| Token | Frazer column |
|---|---|
| `{{payment_amount}}` | Payment Amt — formatted as `$1,204.50` |
| `{{pay_schedule}}` | Pay Schedule — lowercased to read in a sentence (`bi-weekly`) |
| `{{number_of_payments}}` | Number of Payments |
| `{{next_due_date}}` | Current Date Due — the **next** payment, not the first |
| `{{first_payment_date}}` | 1st Payment Date |

`{{next_due_date}}` is the right token for recurring reminders; `{{first_payment_date}}` is for the one-time welcome message.

### Backfilling older records

Sales imported before the payment fields existed can be topped up by re-importing. **Import from Frazer** with a current export and the review screen splits into three:

| | |
|---|---|
| **New sales** | Inserted as usual |
| **To fill in** | Existing records with empty fields the file can populate |
| **Unchanged** | Already have everything the file offers |

The rule is strict: **a value you already have is never replaced.** Only blanks get filled. If you corrected a customer's email by hand, a stale address in the export won't undo it. Tag number, tag cost, and tag-in status aren't in the Frazer export at all, so the import can't touch them.

Before committing, expand **See which customers** to read exactly which field on which record gets which value. Re-running the same file twice is a no-op — the second pass reports "Nothing to do".

One exception, off by default: **Current Date Due** moves forward as payments are made, so filling it once and never again leaves it stale. Tick *"Also refresh Current date due"* to let the file update it. It's the only field allowed to overwrite, and only when you ask.

> **Filter cash sales out of payment templates.** A cash or outside-finance buyer has no payment amount, so a payment reminder falls back to "see your contract" and reads oddly. Use the **All sale types** dropdown to pick BHPH before selecting recipients. The compose warning tells you when someone in your selection is missing payment data.

### What gets skipped automatically
- No email address on file
- Malformed email addresses
- Anyone marked unsubscribed (`email_opt_out`)
- Duplicate addresses within the same selection

You'll see the list of who was skipped and why before you send.

---

## Things worth knowing

**Daily limits.** A free Gmail account allows roughly **500 recipients per day**; Google Workspace allows 2,000. The app tracks how many you've sent today and warns before large batches. Exceeding it locks sending for about 24 hours, so split large campaigns across days.

**Unsubscribes are manual right now.** The footer asks people to reply "unsubscribe". When someone does, set `email_opt_out = true` on their row in Supabase and they'll be excluded from every future send. Automating this needs inbox read access, which is a heavier Google review — worth doing only if the volume justifies it.

**Password changes revoke access.** Changing your Gmail password invalidates the connection. The app will show **Connect Gmail** again — click it and you're back.

**Sending happens in the browser.** Close the tab mid-batch and the rest won't go out. The results screen tells you exactly who was and wasn't sent. Scheduled or drip campaigns would need a small server component; the database is already structured for it.

**Replies go to your normal Gmail inbox.** They don't appear on the CRM record automatically — that would need read access to your mailbox.

---

## If something goes wrong

| What you see | Fix |
|---|---|
| "Gmail isn't set up yet" | `GOOGLE_CLIENT_ID` is still empty in that page's config block |
| Popup closes instantly, nothing happens | The address you're on isn't in **Authorized JavaScript origins**. Check `http` vs `https` and the port |
| "Google sign-in library did not load" | You opened the file directly. Serve it over http — see Part 2 |
| Reconnecting every week | Publishing status is still *Testing*. See step 3.5 |
| "Google hasn't verified this app" | Expected. **Advanced** → **Go to … (unsafe)** |
| Sends fail after ~500 | Daily Gmail cap. Resume tomorrow |
| Templates list is empty | The SQL script hasn't been run against this Supabase project |
