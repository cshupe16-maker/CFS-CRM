'use strict';

/*
 * API smoke tests. Starts the server on a scratch port with a scratch data
 * dir, exercises every endpoint including auth and role permissions.
 *
 * Run: npm test
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3999;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cfs-crm-test-'));
const DEFAULT_PW = 'welcome1';

let passed = 0, failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}

// per-user session: req(cookie, ...)
async function req(cookie, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
}

async function login(email, password) {
  const r = await req(null, 'POST', '/api/login', { email, password });
  if (r.status !== 200) return { r, cookie: null };
  const setCookie = r.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0]; // session=...
  return { r, cookie };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: 'inherit',
  });

  try {
    await waitForServer();

    // ---- auth ----
    let r = await req(null, 'GET', '/api/data');
    check('data requires login (401)', r.status === 401);

    r = (await login('ray@cfsflooring.com', 'wrong-password')).r;
    check('wrong password rejected', r.status === 400);

    r = await req(null, 'GET', '/api/login-info');
    check('login-info public, demo=true', r.status === 200 && r.json.demo === true);

    const owner = await login('ray@cfsflooring.com', DEFAULT_PW);
    check('owner login works', owner.r.status === 200 && owner.cookie && owner.r.json.user.role === 'Owner');
    const manager = await login('monica@cfsflooring.com', DEFAULT_PW);
    check('manager login works', manager.r.status === 200 && manager.r.json.user.role === 'Manager');
    const deshawn = await login('deshawn@cfsflooring.com', DEFAULT_PW);
    check('sales login works', deshawn.r.status === 200 && deshawn.r.json.user.role === 'Sales');
    const carla = await login('carla@cfsflooring.com', DEFAULT_PW);
    check('second sales login works', carla.r.status === 200);

    // ---- visibility ----
    r = await req(owner.cookie, 'GET', '/api/data');
    check('owner sees all 10 accounts', r.json.accounts.length === 10 && r.json.projects.length === 28);
    check('data includes me, no password hashes', r.json.me.role === 'Owner' &&
      r.json.users.every(u => u.passHash === undefined));

    r = await req(deshawn.cookie, 'GET', '/api/data');
    check('sales rep sees only own accounts (5)', r.json.accounts.length === 5 &&
      r.json.accounts.every(a => a.rep === 3));
    check('sales rep sees only own projects/contacts',
      r.json.projects.every(p => r.json.accounts.some(a => a.id === p.acc)) &&
      r.json.contacts.every(c => r.json.accounts.some(a => a.id === c.acc)));

    // ---- account permissions ----
    // account 2 belongs to Carla (rep 4); Deshawn (rep 3) must not touch it
    r = await req(deshawn.cookie, 'PATCH', '/api/accounts/2', { note: 'hax' });
    check('sales cannot edit another rep’s account (403)', r.status === 403);
    r = await req(deshawn.cookie, 'POST', '/api/accounts/2/log-contact');
    check('sales cannot log contact on another rep’s account', r.status === 403);
    r = await req(deshawn.cookie, 'POST', '/api/contacts', { acc: 2, name: 'Sneaky' });
    check('sales cannot add contact to another rep’s account', r.status === 403);
    r = await req(deshawn.cookie, 'POST', '/api/projects', { acc: 2, name: 'Sneaky Job', status: 'In Progress' });
    check('sales cannot add project to another rep’s account', r.status === 403);

    r = await req(deshawn.cookie, 'POST', '/api/accounts', { name: 'Deshawn Prospect', type: 'Builder', rep: 4, cadence: 30 });
    check('sales cannot create account for someone else', r.status === 403);
    r = await req(deshawn.cookie, 'POST', '/api/accounts', { name: 'Deshawn Prospect', type: 'Builder', rep: 3, cadence: 30 });
    check('sales creates own account', r.status === 200 && r.json.account.rep === 3);
    const ownAcc = r.json.account.id;

    r = await req(deshawn.cookie, 'PATCH', '/api/accounts/' + ownAcc, { note: 'mine', cadence: 14 });
    check('sales edits own account', r.status === 200 && r.json.account.note === 'mine');

    r = await req(manager.cookie, 'PATCH', '/api/accounts/2', { note: 'manager can' });
    check('manager edits any account', r.status === 200);

    // owners/managers can themselves be the assigned rep on an account
    r = await req(owner.cookie, 'POST', '/api/accounts', { name: 'Owner-Led Account', type: 'Builder', rep: 1, cadence: 30 });
    check('owner can be the assigned rep', r.status === 200 && r.json.account.rep === 1);
    r = await req(owner.cookie, 'PATCH', '/api/accounts/' + r.json.account.id, { rep: 2 });
    check('account reassignable to a manager', r.status === 200 && r.json.account.rep === 2);

    // ---- contacts & projects on own account ----
    r = await req(deshawn.cookie, 'POST', '/api/contacts', { acc: ownAcc, name: 'Pat Tester', email: 'pat@t.com' });
    check('sales adds contact to own account', r.status === 200 && r.json.contact.primary === true);
    r = await req(deshawn.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job One', status: 'Completed', date: '2026-07-01', mfrs: ['Shaw'] });
    check('sales logs job on own account', r.status === 200);
    r = await req(deshawn.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job Two', status: 'In Progress', mfrs: ['NewBrandX'] });
    check('sales cannot introduce new manufacturer via job', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job Two', status: 'In Progress', mfrs: ['NewBrandX'] });
    check('owner can introduce new manufacturer via job', r.status === 200);

    // ---- manufacturers ----
    r = await req(deshawn.cookie, 'POST', '/api/mfrs', { name: 'SalesBrand' });
    check('sales cannot add manufacturer', r.status === 403);
    r = await req(manager.cookie, 'POST', '/api/mfrs', { name: 'Karndean' });
    check('manager adds manufacturer', r.status === 200 && r.json.mfr === 'Karndean');

    // ---- team management ----
    r = await req(deshawn.cookie, 'POST', '/api/users', { name: 'X', email: 'x@x.com', role: 'Sales', password: 'longenough1' });
    check('sales cannot manage team', r.status === 403);

    r = await req(manager.cookie, 'POST', '/api/users', { name: 'New Rep', email: 'new@cfsflooring.com', role: 'Sales', password: 'short' });
    check('weak password rejected', r.status === 400);
    r = await req(manager.cookie, 'POST', '/api/users', { name: 'New Rep', email: 'new@cfsflooring.com', role: 'Sales', password: 'longenough1' });
    check('manager creates sales user', r.status === 200);
    const newUserId = r.json.user.id;
    const newRep = await login('new@cfsflooring.com', 'longenough1');
    check('new user can log in', newRep.r.status === 200);

    r = await req(manager.cookie, 'POST', '/api/users', { name: 'Boss 2', email: 'b2@cfsflooring.com', role: 'Owner', password: 'longenough1' });
    check('manager cannot create an owner', r.status === 403);
    r = await req(manager.cookie, 'PATCH', '/api/users/1', { name: 'Renamed Owner' });
    check('manager cannot edit an owner', r.status === 403);
    r = await req(manager.cookie, 'PATCH', '/api/users/' + newUserId, { role: 'Owner' });
    check('manager cannot grant owner role', r.status === 403);
    r = await req(owner.cookie, 'PATCH', '/api/users/' + newUserId, { role: 'Manager' });
    check('owner changes role', r.status === 200 && r.json.user.role === 'Manager');

    r = await req(owner.cookie, 'PATCH', '/api/users/1', { active: false });
    check('cannot disable self', r.status === 400);
    r = await req(owner.cookie, 'PATCH', '/api/users/' + newUserId, { active: false });
    check('owner disables a user', r.status === 200 && r.json.user.active === false);
    r = await req(newRep.cookie, 'GET', '/api/data');
    check('disabled user session is dead', r.status === 401);
    r = (await login('new@cfsflooring.com', 'longenough1')).r;
    check('disabled user cannot log in', r.status === 400);
    await req(owner.cookie, 'PATCH', '/api/users/' + newUserId, { active: true });

    // ---- password reset / change ----
    r = await req(owner.cookie, 'PATCH', '/api/users/4', { password: 'resetbyboss1' });
    check('owner resets a password', r.status === 200);
    r = await req(carla.cookie, 'GET', '/api/data');
    check('password reset kills old sessions', r.status === 401);
    const carla2 = await login('carla@cfsflooring.com', 'resetbyboss1');
    check('login with reset password', carla2.r.status === 200);

    r = await req(carla2.cookie, 'POST', '/api/me/password', { current: 'wrong', password: 'mynewpass1' });
    check('self change needs correct current password', r.status === 400);
    r = await req(carla2.cookie, 'POST', '/api/me/password', { current: 'resetbyboss1', password: 'mynewpass1' });
    check('self password change works', r.status === 200);
    check('new password logs in', (await login('carla@cfsflooring.com', 'mynewpass1')).r.status === 200);

    // ---- logout ----
    r = await req(deshawn.cookie, 'POST', '/api/logout');
    check('logout ok', r.status === 200);
    r = await req(deshawn.cookie, 'GET', '/api/data');
    check('session invalid after logout', r.status === 401);

    // ---- core validation still enforced ----
    r = await req(owner.cookie, 'POST', '/api/accounts', { name: 'Deshawn Prospect' });
    check('duplicate account rejected', r.status === 400);
    r = await req(owner.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'No Date', status: 'Completed', date: '' });
    check('completed without date rejected', r.status === 400);

    // ---- persistence: no plaintext passwords on disk ----
    const raw = fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8');
    check('db.json has hashes, not plaintext passwords',
      !raw.includes('mynewpass1') && !raw.includes(DEFAULT_PW) && raw.includes('passHash'));

    // ---- clear demo (owner only) ----
    r = await req(manager.cookie, 'POST', '/api/admin/clear-demo');
    check('manager cannot clear demo', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/admin/clear-demo');
    check('owner clears demo', r.status === 200);
    r = await req(owner.cookie, 'GET', '/api/data');
    check('demo cleared, users kept', r.json.accounts.length === 0 && r.json.users.length === 5 && r.json.meta.demo === false);

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
  } finally {
    server.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
