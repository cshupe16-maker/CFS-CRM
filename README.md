# CFS Flooring — Sales CRM

A lightweight CRM for a flooring sales team: track **accounts** (builders, GCs, designers, property managers), the **contacts** at each one, the **jobs/projects** you do for them, which **manufacturers** each job used, and — the heart of it — **contact-cadence reminders** so nobody goes quiet on a client.

Built to match the approved design mock, as a real multi-user app: every save goes to a shared database on the server, so the whole team sees the same data.

---

## Launch it (2 minutes)

The only requirement is [Node.js](https://nodejs.org) 16 or newer. There are **no packages to install**.

```bash
node server.js
```

Then open **http://localhost:3000**.

To let the whole team use it from one machine on your office network, find that machine's IP address (e.g. `192.168.1.25`) and have everyone open `http://192.168.1.25:3000`. To use a different port: `PORT=8080 node server.js`.

### First run

The app starts pre-filled with **demo data** (the same sample accounts from the design) so you can explore every screen. Every seeded team member's password is **`welcome1`**. When you're ready for real data:

1. Sign in as the owner: **ray@cfsflooring.com** / `welcome1`.
2. Go to **Settings** and set up the real team — edit the placeholder names/emails, add your members (each gets their own email + password), and **reset every seeded password** (Edit → Reset password). Change your own via **Change password** in the sidebar.
3. Adjust the **Manufacturers** list to the brands you actually sell.
4. Click **Clear demo data** (Settings, owner only) — this wipes the sample accounts/contacts/projects but keeps your team and manufacturers.

All data lives in `data/db.json`. **Back it up** by copying that file; restore by putting it back. Passwords are stored only as salted scrypt hashes — never in plain text.

### Sign-in, roles & permissions

Everyone signs in with their **email + password**. Sessions last 30 days; repeated failed logins are throttled. What each role can do is enforced by the server, not just hidden in the UI:

| | Sales rep | Manager | Owner |
|---|:---:|:---:|:---:|
| See/edit accounts, contacts, projects | own only | all | all |
| Create accounts | for themselves | any rep | any rep |
| Add manufacturers | — | ✓ | ✓ |
| Manage team (add/edit/disable, reset passwords) | — | except owners | everyone |
| Grant the Owner role | — | — | ✓ |
| Clear demo data | — | — | ✓ |

Extra safeguards: you can't disable your own sign-in, the last active owner/manager can't be demoted, disabling someone or resetting their password signs them out everywhere, and passwords must be at least 8 characters.

### Hosting it online (optional)

Any Node host works ([Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io), or a $5 VPS):

- Start command: `node server.js` (the host's `PORT` env var is respected automatically).
- Make sure the host gives you a **persistent disk**, and set `DATA_DIR` to a folder on it (e.g. `DATA_DIR=/var/data`) — otherwise your database resets on every deploy.
- Sign-in is required for all data, but put it behind **HTTPS** (Render/Railway/Fly do this automatically) so passwords aren't sent in the clear over the public internet.

## Using the CRM

| Screen | What it does |
|---|---|
| **Dashboard** | KPIs, top 10 clients by jobs, manufacturer utilization, top contact reminders, and clients longest without a job — filterable by time range. |
| **Reminders** | The full versions of both reminder lists, sorted by most overdue. |
| **Accounts** | Search, add accounts, see cadence and next-contact status at a glance. |
| **Account detail** | Assigned rep, contact cadence, notes (auto-saved), contacts (add/edit), full project history, **Log contact today**, and email buttons. |
| **Projects** | All jobs, filterable by status and manufacturer. |
| **+ New Project** | Log a job — saving it also logs a contact touch on the account. |
| **Settings** | (Owners/Managers) Manage the team, the manufacturer tag list, and demo data. |

Notes on how it behaves:

- **Roles:** Sales reps see only their own accounts and projects (enforced server-side); Owners/Managers see everything and get the Settings screen.
- **Cadence:** each account has a contact rhythm (weekly → quarterly). The badge goes green → amber (due within 7 days) → red (overdue). Logging a contact or saving a job resets the clock.
- **Email buttons** open your regular mail app with a pre-filled message (to the account's primary contact, CC the rep — or to the rep for reminders).
- The app **auto-refreshes** every ~45 seconds so teammates' changes show up on their own.

## For developers

```
server.js          Zero-dependency Node HTTP server + JSON REST API
seed.js            Demo dataset (first-run seed)
public/            Single-page app (vanilla JS, no build step)
test/api.test.js   API smoke tests — run with: npm test
data/db.json       The database (created on first run; gitignored)
```

API: `POST /api/login`, `POST /api/logout`, `POST /api/me/password`; `GET /api/data` returns everything visible to the signed-in user; `POST/PATCH` under `/api/accounts`, `/api/contacts`, `/api/projects`, `/api/mfrs`, `/api/users`; `POST /api/accounts/:id/log-contact`; `POST /api/admin/clear-demo`. All endpoints except login/health require a session cookie and enforce the role rules above; writes are serialized and saved atomically to `data/db.json`.
