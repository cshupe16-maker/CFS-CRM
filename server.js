'use strict';

/*
 * CFS Flooring Sales CRM — server
 *
 * Zero-dependency Node.js HTTP server:
 *   - serves the single-page app from /public
 *   - JSON REST API under /api
 *   - persists everything to data/db.json (atomic writes)
 *
 * Run:  node server.js          (http://localhost:3000)
 * Env:  PORT=8080 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { demoData } = require('./seed');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ACCOUNT_TYPES = ['Builder', 'General Contractor', 'Designer', 'Property Manager', 'Other'];
const PROJECT_STATUSES = ['In Progress', 'Completed', 'Archive'];
const ROLES = ['Owner', 'Manager', 'Sales'];
const CADENCES = [7, 14, 30, 60, 90];

// ---------- storage ----------

let db;

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = JSON.parse(JSON.stringify(demoData));
    db.meta = { demo: true, createdAt: new Date().toISOString() };
    saveDb();
    console.log('First run: seeded demo data into ' + DB_FILE);
  }
}

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

const nextId = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;

// ---------- helpers ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const ok = (res, obj) => sendJson(res, 200, obj || { ok: true });
const bad = (res, msg) => sendJson(res, 400, { error: msg });
const notFound = res => sendJson(res, 404, { error: 'Not found' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const str = v => (typeof v === 'string' ? v.trim() : '');
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- API handlers ----------

function createAccount(body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter an account name.' };
  if (db.accounts.some(a => a.name.toLowerCase() === name.toLowerCase()))
    return { error: 'An account with that name already exists.' };
  const type = ACCOUNT_TYPES.includes(body.type) ? body.type : 'Other';
  const rep = db.users.some(u => u.id === +body.rep) ? +body.rep : null;
  const cadence = CADENCES.includes(+body.cadence) ? +body.cadence : 30;
  const account = {
    id: nextId(db.accounts), name, type, rep, cadence,
    lastContact: todayISO(), note: str(body.note),
  };
  db.accounts.push(account);
  saveDb();
  return { account };
}

function patchAccount(id, body) {
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: 'Enter an account name.' };
    if (db.accounts.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase()))
      return { error: 'An account with that name already exists.' };
    a.name = name;
  }
  if (body.type !== undefined && ACCOUNT_TYPES.includes(body.type)) a.type = body.type;
  if (body.rep !== undefined) {
    if (!db.users.some(u => u.id === +body.rep)) return { error: 'Unknown rep.' };
    a.rep = +body.rep;
  }
  if (body.cadence !== undefined) {
    if (!CADENCES.includes(+body.cadence)) return { error: 'Invalid cadence.' };
    a.cadence = +body.cadence;
  }
  if (body.note !== undefined) a.note = str(body.note);
  if (body.lastContact !== undefined) {
    if (!isDate(body.lastContact)) return { error: 'Invalid date.' };
    a.lastContact = body.lastContact;
  }
  saveDb();
  return { account: a };
}

function logContact(id) {
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  a.lastContact = todayISO();
  db.contacts.forEach(c => { if (c.acc === id && c.primary) c.lastContact = todayISO(); });
  saveDb();
  return { account: a };
}

function createContact(body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter a name.' };
  const acc = db.accounts.find(a => a.id === +body.acc);
  if (!acc) return { error: 'Unknown account.' };
  const contact = {
    id: nextId(db.contacts), acc: acc.id, name,
    title: str(body.title), email: str(body.email), phone: str(body.phone),
    rep: db.users.some(u => u.id === +body.rep) ? +body.rep : acc.rep,
    primary: !db.contacts.some(c => c.acc === acc.id),
    lastContact: null,
  };
  db.contacts.push(contact);
  saveDb();
  return { contact };
}

function patchContact(id, body) {
  const c = db.contacts.find(x => x.id === id);
  if (!c) return { notFound: true };
  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: 'Enter a name.' };
    c.name = name;
  }
  if (body.title !== undefined) c.title = str(body.title);
  if (body.email !== undefined) c.email = str(body.email);
  if (body.phone !== undefined) c.phone = str(body.phone);
  if (body.rep !== undefined) {
    if (!db.users.some(u => u.id === +body.rep)) return { error: 'Unknown rep.' };
    c.rep = +body.rep;
  }
  if (body.primary === true) {
    db.contacts.forEach(x => { if (x.acc === c.acc) x.primary = false; });
    c.primary = true;
  }
  saveDb();
  return { contact: c };
}

function validateProject(body) {
  if (!db.accounts.some(a => a.id === +body.acc)) return 'Select an account.';
  if (!str(body.name)) return 'Enter a project name.';
  if (!PROJECT_STATUSES.includes(body.status)) return 'Invalid status.';
  if (body.status === 'Completed' && !isDate(body.date)) return 'Completed jobs need a completion date.';
  if (body.date && !isDate(body.date)) return 'Invalid date.';
  if (body.mfrs !== undefined && !Array.isArray(body.mfrs)) return 'Invalid manufacturers.';
  return null;
}

function projectFields(body) {
  const con = +body.con || null;
  return {
    acc: +body.acc,
    con: con && db.contacts.some(c => c.id === con && c.acc === +body.acc) ? con : null,
    name: str(body.name),
    addr: str(body.addr),
    status: body.status,
    date: body.status === 'Completed' ? body.date : (isDate(body.date) ? body.date : ''),
    mfrs: (body.mfrs || []).map(str).filter(Boolean),
  };
}

function registerMfrs(names) {
  names.forEach(name => {
    if (!db.mfrs.some(m => m.toLowerCase() === name.toLowerCase())) db.mfrs.push(name);
  });
}

function createProject(body) {
  const error = validateProject(body);
  if (error) return { error };
  const fields = projectFields(body);
  registerMfrs(fields.mfrs);
  const project = { id: nextId(db.projects), ...fields };
  db.projects.push(project);
  // Saving a job also counts as a contact touch on the account
  const a = db.accounts.find(x => x.id === project.acc);
  a.lastContact = todayISO();
  db.contacts.forEach(c => { if (c.acc === a.id && c.primary) c.lastContact = todayISO(); });
  saveDb();
  return { project };
}

function patchProject(id, body) {
  const p = db.projects.find(x => x.id === id);
  if (!p) return { notFound: true };
  const merged = { ...p, ...body };
  const error = validateProject(merged);
  if (error) return { error };
  Object.assign(p, projectFields(merged));
  registerMfrs(p.mfrs);
  saveDb();
  return { project: p };
}

function createMfr(body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter a manufacturer name.' };
  registerMfrs([name]);
  saveDb();
  const canonical = db.mfrs.find(m => m.toLowerCase() === name.toLowerCase());
  return { mfr: canonical };
}

function createUser(body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter a name.' };
  const role = ROLES.includes(body.role) ? body.role : 'Sales';
  const user = { id: nextId(db.users), name, role, email: str(body.email) };
  db.users.push(user);
  saveDb();
  return { user };
}

function patchUser(id, body) {
  const u = db.users.find(x => x.id === id);
  if (!u) return { notFound: true };
  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: 'Enter a name.' };
    u.name = name;
  }
  if (body.email !== undefined) u.email = str(body.email);
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return { error: 'Invalid role.' };
    if (u.role !== 'Sales' && body.role === 'Sales' &&
        !db.users.some(x => x.id !== u.id && x.role !== 'Sales'))
      return { error: 'At least one owner or manager is required.' };
    u.role = body.role;
  }
  saveDb();
  return { user: u };
}

function clearDemo() {
  db.accounts = [];
  db.contacts = [];
  db.projects = [];
  if (db.meta) db.meta.demo = false;
  saveDb();
  return { ok: true };
}

// ---------- routing ----------

async function handleApi(req, res, pathname) {
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  let body = {};
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    try { body = await readBody(req); } catch (e) { return bad(res, e.message); }
  }

  const respond = result => {
    if (!result) return notFound(res);
    if (result.notFound) return notFound(res);
    if (result.error) return bad(res, result.error);
    return ok(res, result);
  };

  if (method === 'GET' && pathname === '/api/data') {
    return ok(res, {
      users: db.users, accounts: db.accounts, contacts: db.contacts,
      projects: db.projects, mfrs: db.mfrs, meta: db.meta || {},
      today: todayISO(),
    });
  }
  if (method === 'GET' && pathname === '/api/health') return ok(res, { ok: true });

  if (seg[1] === 'accounts') {
    if (method === 'POST' && seg.length === 2) return respond(createAccount(body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchAccount(+seg[2], body));
    if (seg.length === 4 && seg[3] === 'log-contact' && method === 'POST') return respond(logContact(+seg[2]));
  }
  if (seg[1] === 'contacts') {
    if (method === 'POST' && seg.length === 2) return respond(createContact(body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchContact(+seg[2], body));
  }
  if (seg[1] === 'projects') {
    if (method === 'POST' && seg.length === 2) return respond(createProject(body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchProject(+seg[2], body));
  }
  if (seg[1] === 'mfrs' && method === 'POST' && seg.length === 2) return respond(createMfr(body));
  if (seg[1] === 'users') {
    if (method === 'POST' && seg.length === 2) return respond(createUser(body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchUser(+seg[2], body));
  }
  if (pathname === '/api/admin/clear-demo' && method === 'POST') return respond(clearDemo());

  return notFound(res);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback: unknown paths get the app shell
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return notFound(res);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// serialize mutations so concurrent writes can't interleave
let queue = Promise.resolve();

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname.startsWith('/api/')) {
    queue = queue.then(() => handleApi(req, res, pathname)).catch(err => {
      console.error(err);
      try { sendJson(res, 500, { error: 'Server error' }); } catch (e) { /* headers sent */ }
    });
    return;
  }
  serveStatic(res, pathname);
});

loadDb();

if (process.argv.includes('--seed-demo')) {
  db = JSON.parse(JSON.stringify(demoData));
  db.meta = { demo: true, createdAt: new Date().toISOString() };
  saveDb();
  console.log('Re-seeded demo data.');
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log('CFS Flooring CRM running at http://localhost:' + PORT);
});
