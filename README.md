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

The app starts pre-filled with **demo data** (the same sample accounts from the design) so you can explore every screen. When you're ready for real data:

1. Sign in as an Owner/Manager (dropdown, bottom-left).
2. Go to **Settings** and update the team — edit the four placeholder names/emails to your real team, and add more members.
3. Adjust the **Manufacturers** list to the brands you actually sell.
4. Click **Clear demo data** (Settings) — this wipes the sample accounts/contacts/projects but keeps your team and manufacturers.

All data lives in `data/db.json`. **Back it up** by copying that file; restore by putting it back.

### Hosting it online (optional)

Any Node host works ([Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io), or a $5 VPS):

- Start command: `node server.js` (the host's `PORT` env var is respected automatically).
- Make sure the host gives you a **persistent disk**, and set `DATA_DIR` to a folder on it (e.g. `DATA_DIR=/var/data`) — otherwise your database resets on every deploy.
- Anyone with the URL can use the app (there are no passwords in v1), so keep the URL private or put it behind your host's access controls.

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

- **Roles:** Sales reps see only their own accounts and projects; Owners/Managers see everything and get the Settings screen.
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

API: `GET /api/data` returns everything; `POST/PATCH` under `/api/accounts`, `/api/contacts`, `/api/projects`, `/api/mfrs`, `/api/users`; `POST /api/accounts/:id/log-contact`; `POST /api/admin/clear-demo`. All writes are serialized and saved atomically to `data/db.json`.
