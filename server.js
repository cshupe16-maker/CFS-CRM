'use strict';

/*
 * CFS Flooring Sales CRM — server
 *
 * Zero-dependency Node.js HTTP server:
 *   - serves the single-page app from /public
 *   - JSON REST API under /api
 *   - password login with cookie sessions (salted scrypt hashes)
 *   - role-based permissions enforced server-side
 *   - persists everything to data/db.json (atomic writes)
 *
 * Run:  node server.js          (http://localhost:3000)
 * Env:  PORT=8080 node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 days
const DEFAULT_PASSWORD = 'welcome1';       // seeded users; change in Settings
const MIN_PASSWORD = 8;

// ---------- passwords & sessions ----------

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}

function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return test.length === orig.length && crypto.timingSafeEqual(test, orig);
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL;
  db.sessions = (db.sessions || []).filter(s => s.created > cutoff);
}

function userFromRequest(req) {
  const match = /(?:^|;\s*)session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!match) return null;
  const sess = (db.sessions || []).find(s => s.token === match[1]);
  if (!sess || Date.now() - sess.created > SESSION_TTL) return null;
  const user = db.users.find(u => u.id === sess.userId);
  return user && user.active !== false ? user : null;
}

// naive brute-force throttle: 10 failures per address locks login for 15 min
const loginFails = new Map();
function loginLocked(ip) {
  const f = loginFails.get(ip);
  return f && f.count >= 10 && Date.now() < f.until;
}
function recordLoginFail(ip) {
  const f = loginFails.get(ip) || { count: 0, until: 0 };
  f.count++;
  f.until = Date.now() + 15 * 60 * 1000;
  loginFails.set(ip, f);
}

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
    console.log('First run: seeded demo data into ' + DB_FILE);
  }
  // migrations: give pre-auth databases passwords, active flags, sessions
  db.sessions = db.sessions || [];
  db.users.forEach(u => {
    if (!u.passHash) u.passHash = hashPassword(DEFAULT_PASSWORD);
    if (u.active === undefined) u.active = true;
  });
  // cadence moved from accounts to contacts — inherit the account's setting
  db.contacts.forEach(c => {
    if (c.cadence === undefined) {
      const a = db.accounts.find(x => x.id === c.acc);
      c.cadence = (a && a.cadence) || 30;
    }
    if (c.lastContact === undefined) c.lastContact = null;
  });
  db.activity = db.activity || [];
  pruneSessions();
  saveDb();
}

function saveDb() {
  const json = JSON.stringify(db, null, 2);
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE); // atomic on normal filesystems
  } catch (e) {
    // Mounted object storage (e.g. Cloud Storage FUSE on Cloud Run) may not
    // support rename — write the file directly instead.
    fs.writeFileSync(DB_FILE, json);
    try { fs.unlinkSync(tmp); } catch (e2) { /* tmp may not exist */ }
  }
}

const nextId = list => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;

// ---------- helpers ----------

function sendJson(res, status, obj, headers) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(headers || {}),
  });
  res.end(JSON.stringify(obj));
}

const ok = (res, obj, headers) => sendJson(res, 200, obj || { ok: true }, headers);
const bad = (res, msg) => sendJson(res, 400, { error: msg });
const unauthorized = res => sendJson(res, 401, { error: 'Not signed in' });
const forbidden = (res, msg) => sendJson(res, 403, { error: msg || 'You don’t have permission to do that.' });
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

const isManager = user => user.role === 'Owner' || user.role === 'Manager';
const publicUser = u => ({ id: u.id, name: u.name, role: u.role, email: u.email, active: u.active !== false });

// Sales reps may only touch accounts assigned to them
const canAccessAccount = (user, acc) => isManager(user) || acc.rep === user.id;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD)
    return 'Password must be at least ' + MIN_PASSWORD + ' characters.';
  return null;
}

// ---------- auth handlers ----------

function handleLogin(body, ip) {
  if (loginLocked(ip)) return { error: 'Too many failed attempts. Try again in 15 minutes.' };
  const email = str(body.email).toLowerCase();
  const user = db.users.find(u => u.email.toLowerCase() === email);
  if (!user || user.active === false || !verifyPassword(body.password, user.passHash)) {
    recordLoginFail(ip);
    return { error: 'Wrong email or password.' };
  }
  loginFails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  pruneSessions();
  db.sessions.push({ token, userId: user.id, created: Date.now() });
  saveDb();
  return { user: publicUser(user), token };
}

function handleLogout(req) {
  const match = /(?:^|;\s*)session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (match) {
    db.sessions = db.sessions.filter(s => s.token !== match[1]);
    saveDb();
  }
  return { ok: true };
}

function changeOwnPassword(user, body) {
  if (!verifyPassword(body.current, user.passHash))
    return { error: 'Current password is incorrect.' };
  const weak = checkPassword(body.password);
  if (weak) return { error: weak };
  user.passHash = hashPassword(body.password);
  // keep this session, sign out everywhere else
  saveDb();
  return { ok: true };
}

// ---------- API handlers ----------

function getData(user) {
  const accounts = isManager(user) ? db.accounts : db.accounts.filter(a => a.rep === user.id);
  const accIds = new Set(accounts.map(a => a.id));
  return {
    me: publicUser(user),
    users: db.users.map(publicUser),
    accounts,
    contacts: db.contacts.filter(c => accIds.has(c.acc)),
    projects: db.projects.filter(p => accIds.has(p.acc)),
    activity: db.activity.filter(e => accIds.has(e.acc)),
    mfrs: db.mfrs,
    meta: { demo: !!(db.meta && db.meta.demo) },
    today: todayISO(),
  };
}

function createAccount(user, body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter an account name.' };
  if (db.accounts.some(a => a.name.toLowerCase() === name.toLowerCase()))
    return { error: 'An account with that name already exists.' };
  let rep = +body.rep;
  if (!isManager(user)) {
    if (rep && rep !== user.id) return { forbidden: 'Sales reps can only assign new accounts to themselves.' };
    rep = user.id;
  } else if (!db.users.some(u => u.id === rep)) {
    return { error: 'Pick an assigned rep.' };
  }
  const type = ACCOUNT_TYPES.includes(body.type) ? body.type : 'Other';
  const cadence = CADENCES.includes(+body.cadence) ? +body.cadence : 30;
  const account = {
    id: nextId(db.accounts), name, type, rep, cadence,
    lastContact: todayISO(), note: str(body.note),
  };
  db.accounts.push(account);
  saveDb();
  return { account };
}

function patchAccount(user, id, body) {
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  if (!canAccessAccount(user, a)) return { forbidden: true };
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
    a.rep = +body.rep; // a rep handing an account to a teammate is allowed
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

function logContact(user, id) {
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  if (!canAccessAccount(user, a)) return { forbidden: true };
  a.lastContact = todayISO();
  db.contacts.forEach(c => { if (c.acc === id && c.primary) c.lastContact = todayISO(); });
  saveDb();
  return { account: a };
}

// Per-account activity trail (emails sent, contacts logged, jobs added).
// Timestamps are stored in UTC (ISO); the client renders them in Mountain time.
function logActivity(accId, text, user) {
  db.activity.push({
    id: nextId(db.activity), acc: accId,
    ts: new Date().toISOString(), text, user: user ? user.name : '',
  });
  if (db.activity.length > 2000) db.activity = db.activity.slice(-2000);
}

function emailRepActivity(user, id) {
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  if (!canAccessAccount(user, a)) return { forbidden: true };
  const rep = db.users.find(u => u.id === a.rep);
  logActivity(a.id, 'Emailed reminder to rep ' + (rep ? rep.name : '(unassigned)'), user);
  saveDb();
  return { ok: true };
}

function emailContactActivity(user, id) {
  const c = db.contacts.find(x => x.id === id);
  if (!c) return { notFound: true };
  const acc = db.accounts.find(a => a.id === c.acc);
  if (!acc || !canAccessAccount(user, acc)) return { forbidden: true };
  logActivity(acc.id, 'Emailed ' + c.name + (c.email ? ' (' + c.email + ')' : ''), user);
  saveDb();
  return { ok: true };
}

function logContactPerson(user, id) {
  const c = db.contacts.find(x => x.id === id);
  if (!c) return { notFound: true };
  const acc = db.accounts.find(a => a.id === c.acc);
  if (!acc || !canAccessAccount(user, acc)) return { forbidden: true };
  c.lastContact = todayISO();
  acc.lastContact = todayISO();
  logActivity(acc.id, 'Logged contact with ' + c.name, user);
  saveDb();
  return { contact: c };
}

function createContact(user, body) {
  const name = str(body.name);
  if (!name) return { error: 'Enter a name.' };
  const acc = db.accounts.find(a => a.id === +body.acc);
  if (!acc) return { error: 'Unknown account.' };
  if (!canAccessAccount(user, acc)) return { forbidden: true };
  const contact = {
    id: nextId(db.contacts), acc: acc.id, name,
    title: str(body.title), email: str(body.email), phone: str(body.phone),
    rep: db.users.some(u => u.id === +body.rep) ? +body.rep : acc.rep,
    cadence: CADENCES.includes(+body.cadence) ? +body.cadence : 30,
    primary: !db.contacts.some(c => c.acc === acc.id),
    lastContact: null,
  };
  db.contacts.push(contact);
  saveDb();
  return { contact };
}

function patchContact(user, id, body) {
  const c = db.contacts.find(x => x.id === id);
  if (!c) return { notFound: true };
  const acc = db.accounts.find(a => a.id === c.acc);
  if (!acc || !canAccessAccount(user, acc)) return { forbidden: true };
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
  if (body.cadence !== undefined) {
    if (!CADENCES.includes(+body.cadence)) return { error: 'Invalid cadence.' };
    c.cadence = +body.cadence;
  }
  if (body.primary === true) {
    db.contacts.forEach(x => { if (x.acc === c.acc) x.primary = false; });
    c.primary = true;
  }
  saveDb();
  return { contact: c };
}

function deleteContact(user, id) {
  const c = db.contacts.find(x => x.id === id);
  if (!c) return { notFound: true };
  const acc = db.accounts.find(a => a.id === c.acc);
  if (!acc || !canAccessAccount(user, acc)) return { forbidden: true };
  db.contacts = db.contacts.filter(x => x.id !== id);
  // projects keep their history, just lose the person reference
  db.projects.forEach(p => { if (p.con === id) p.con = null; });
  // if the primary contact was removed, promote the next one
  if (c.primary) {
    const next = db.contacts.find(x => x.acc === acc.id);
    if (next) next.primary = true;
  }
  logActivity(acc.id, 'Deleted contact ' + c.name, user);
  saveDb();
  return { ok: true };
}

// Deleting a business wipes its contacts, projects, and activity — managers/owners only
function deleteAccount(user, id) {
  if (!isManager(user)) return { forbidden: 'Only managers/owners can delete an account.' };
  const a = db.accounts.find(x => x.id === id);
  if (!a) return { notFound: true };
  db.accounts = db.accounts.filter(x => x.id !== id);
  db.contacts = db.contacts.filter(c => c.acc !== id);
  db.projects = db.projects.filter(p => p.acc !== id);
  db.activity = db.activity.filter(e => e.acc !== id);
  saveDb();
  return { ok: true };
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

// Only managers/owners may introduce NEW manufacturer names via a project save
function registerMfrs(user, names) {
  const unknown = names.filter(n => !db.mfrs.some(m => m.toLowerCase() === n.toLowerCase()));
  if (unknown.length && !isManager(user))
    return 'Only managers/owners can add manufacturers: ' + unknown.join(', ');
  unknown.forEach(n => db.mfrs.push(n));
  return null;
}

function createProject(user, body) {
  const error = validateProject(body);
  if (error) return { error };
  const a = db.accounts.find(x => x.id === +body.acc);
  if (!canAccessAccount(user, a)) return { forbidden: true };
  const fields = projectFields(body);
  const mfrErr = registerMfrs(user, fields.mfrs);
  if (mfrErr) return { forbidden: mfrErr };
  const project = { id: nextId(db.projects), ...fields };
  db.projects.push(project);
  // Saving a job also counts as a contact touch — on the chosen contact,
  // or the account's primary contact if none was picked
  a.lastContact = todayISO();
  const touched = project.con
    ? db.contacts.find(c => c.id === project.con)
    : db.contacts.find(c => c.acc === a.id && c.primary);
  if (touched) touched.lastContact = todayISO();
  logActivity(a.id, 'Logged job “' + project.name + '”', user);
  saveDb();
  return { project };
}

function patchProject(user, id, body) {
  const p = db.projects.find(x => x.id === id);
  if (!p) return { notFound: true };
  const current = db.accounts.find(a => a.id === p.acc);
  if (!current || !canAccessAccount(user, current)) return { forbidden: true };
  const merged = { ...p, ...body };
  const error = validateProject(merged);
  if (error) return { error };
  const target = db.accounts.find(a => a.id === +merged.acc);
  if (!canAccessAccount(user, target)) return { forbidden: true };
  const fields = projectFields(merged);
  const mfrErr = registerMfrs(user, fields.mfrs);
  if (mfrErr) return { forbidden: mfrErr };
  Object.assign(p, fields);
  saveDb();
  return { project: p };
}

function createMfr(user, body) {
  if (!isManager(user)) return { forbidden: 'Only managers/owners can add manufacturers.' };
  const name = str(body.name);
  if (!name) return { error: 'Enter a manufacturer name.' };
  if (!db.mfrs.some(m => m.toLowerCase() === name.toLowerCase())) db.mfrs.push(name);
  saveDb();
  return { mfr: db.mfrs.find(m => m.toLowerCase() === name.toLowerCase()) };
}

// ----- team management -----
// Owners manage everyone. Managers manage the team but cannot touch Owner
// accounts or grant the Owner role.

function createUser(user, body) {
  if (!isManager(user)) return { forbidden: true };
  const name = str(body.name);
  if (!name) return { error: 'Enter a name.' };
  const email = str(body.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email — it’s the sign-in name.' };
  if (db.users.some(u => u.email.toLowerCase() === email)) return { error: 'A team member with that email already exists.' };
  const role = ROLES.includes(body.role) ? body.role : 'Sales';
  if (role === 'Owner' && user.role !== 'Owner') return { forbidden: 'Only an owner can add another owner.' };
  const weak = checkPassword(body.password);
  if (weak) return { error: weak };
  const nu = { id: nextId(db.users), name, role, email, active: true, passHash: hashPassword(body.password) };
  db.users.push(nu);
  saveDb();
  return { user: publicUser(nu) };
}

function patchUser(user, id, body) {
  if (!isManager(user)) return { forbidden: true };
  const u = db.users.find(x => x.id === id);
  if (!u) return { notFound: true };
  if (u.role === 'Owner' && user.role !== 'Owner')
    return { forbidden: 'Only an owner can edit an owner’s profile.' };

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) return { error: 'Enter a name.' };
    u.name = name;
  }
  if (body.email !== undefined) {
    const email = str(body.email).toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email — it’s the sign-in name.' };
    if (db.users.some(x => x.id !== id && x.email.toLowerCase() === email))
      return { error: 'A team member with that email already exists.' };
    u.email = email;
  }
  if (body.role !== undefined && body.role !== u.role) {
    if (!ROLES.includes(body.role)) return { error: 'Invalid role.' };
    if (body.role === 'Owner' && user.role !== 'Owner')
      return { forbidden: 'Only an owner can grant the Owner role.' };
    if (u.role !== 'Sales' && body.role === 'Sales' &&
        !db.users.some(x => x.id !== u.id && x.role !== 'Sales' && x.active !== false))
      return { error: 'At least one active owner or manager is required.' };
    u.role = body.role;
  }
  if (body.active !== undefined) {
    const active = !!body.active;
    if (!active && u.id === user.id) return { error: 'You can’t disable your own sign-in.' };
    if (!active && u.role !== 'Sales' &&
        !db.users.some(x => x.id !== u.id && x.role !== 'Sales' && x.active !== false))
      return { error: 'At least one active owner or manager is required.' };
    u.active = active;
    if (!active) db.sessions = db.sessions.filter(s => s.userId !== u.id); // sign them out
  }
  if (body.password !== undefined && body.password !== '') {
    const weak = checkPassword(body.password);
    if (weak) return { error: weak };
    u.passHash = hashPassword(body.password);
    db.sessions = db.sessions.filter(s => s.userId !== u.id || u.id === user.id);
  }
  saveDb();
  return { user: publicUser(u) };
}

function clearDemo(user) {
  if (user.role !== 'Owner') return { forbidden: 'Only an owner can clear demo data.' };
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
    if (!result || result.notFound) return notFound(res);
    if (result.forbidden) return forbidden(res, typeof result.forbidden === 'string' ? result.forbidden : undefined);
    if (result.error) return bad(res, result.error);
    return ok(res, result);
  };

  // --- public endpoints ---
  if (method === 'GET' && pathname === '/api/health') return ok(res, { ok: true });
  if (method === 'GET' && pathname === '/api/login-info') {
    return ok(res, { demo: !!(db.meta && db.meta.demo) });
  }
  // mark cookies Secure when behind an HTTPS proxy (Cloud Run, Render, etc.)
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';

  if (method === 'POST' && pathname === '/api/login') {
    const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : (req.socket.remoteAddress || '?');
    const result = handleLogin(body, ip);
    if (result.error) return bad(res, result.error);
    return ok(res, { user: result.user }, {
      'Set-Cookie': 'session=' + result.token +
        '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL / 1000) + secure,
    });
  }

  // --- everything else requires a signed-in user ---
  const user = userFromRequest(req);
  if (!user) return unauthorized(res);

  if (method === 'POST' && pathname === '/api/logout') {
    handleLogout(req);
    return ok(res, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' + secure });
  }
  if (method === 'POST' && pathname === '/api/me/password') return respond(changeOwnPassword(user, body));
  if (method === 'GET' && pathname === '/api/data') return ok(res, getData(user));

  if (seg[1] === 'accounts') {
    if (method === 'POST' && seg.length === 2) return respond(createAccount(user, body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchAccount(user, +seg[2], body));
    if (seg.length === 3 && method === 'DELETE') return respond(deleteAccount(user, +seg[2]));
    if (seg.length === 4 && seg[3] === 'log-contact' && method === 'POST') return respond(logContact(user, +seg[2]));
    if (seg.length === 4 && seg[3] === 'email-rep' && method === 'POST') return respond(emailRepActivity(user, +seg[2]));
  }
  if (seg[1] === 'contacts') {
    if (method === 'POST' && seg.length === 2) return respond(createContact(user, body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchContact(user, +seg[2], body));
    if (seg.length === 3 && method === 'DELETE') return respond(deleteContact(user, +seg[2]));
    if (seg.length === 4 && seg[3] === 'log-contact' && method === 'POST') return respond(logContactPerson(user, +seg[2]));
    if (seg.length === 4 && seg[3] === 'email-log' && method === 'POST') return respond(emailContactActivity(user, +seg[2]));
  }
  if (seg[1] === 'projects') {
    if (method === 'POST' && seg.length === 2) return respond(createProject(user, body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchProject(user, +seg[2], body));
  }
  if (seg[1] === 'mfrs' && method === 'POST' && seg.length === 2) return respond(createMfr(user, body));
  if (seg[1] === 'users') {
    if (method === 'POST' && seg.length === 2) return respond(createUser(user, body));
    if (seg.length === 3 && method === 'PATCH') return respond(patchUser(user, +seg[2], body));
  }
  if (pathname === '/api/admin/clear-demo' && method === 'POST') return respond(clearDemo(user));

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
  db.sessions = [];
  db.activity = [];
  db.users.forEach(u => { u.passHash = hashPassword(DEFAULT_PASSWORD); u.active = true; });
  saveDb();
  console.log('Re-seeded demo data.');
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log('CFS Flooring CRM running at http://localhost:' + PORT);
});
