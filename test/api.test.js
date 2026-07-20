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
    r = await req(deshawn.cookie, 'POST', '/api/contacts', { acc: ownAcc, name: 'Pat Tester', email: 'pat@t.com', cadence: 14 });
    check('sales adds contact to own account', r.status === 200 && r.json.contact.primary === true);
    check('contact carries its own cadence', r.json.contact.cadence === 14 && r.json.contact.lastContact === null);
    const patId = r.json.contact.id;

    r = await req(deshawn.cookie, 'PATCH', '/api/contacts/' + patId, { cadence: 7 });
    check('contact cadence editable', r.status === 200 && r.json.contact.cadence === 7);
    r = await req(deshawn.cookie, 'PATCH', '/api/contacts/' + patId, { cadence: 13 });
    check('invalid cadence rejected', r.status === 400);

    r = await req(deshawn.cookie, 'POST', '/api/contacts/' + patId + '/log-contact');
    check('log contact on a person', r.status === 200 && r.json.contact.lastContact !== null);

    // activity trail: emails and touches are documented with timestamps
    r = await req(deshawn.cookie, 'POST', '/api/accounts/' + ownAcc + '/email-rep');
    check('email-rep logs activity', r.status === 200);
    r = await req(deshawn.cookie, 'POST', '/api/contacts/' + patId + '/email-log');
    check('email-contact logs activity', r.status === 200);
    r = await req(carla.cookie, 'POST', '/api/accounts/' + ownAcc + '/email-rep');
    check('other rep cannot log email-rep activity', r.status === 403);
    r = await req(deshawn.cookie, 'GET', '/api/data');
    const acts = r.json.activity.filter(e => e.acc === ownAcc);
    check('activity entries recorded with ISO timestamps',
      acts.some(e => e.text.startsWith('Emailed reminder to rep')) &&
      acts.some(e => e.text.startsWith('Emailed Pat Tester')) &&
      acts.some(e => e.text.startsWith('Logged contact with')) &&
      acts.every(e => !isNaN(Date.parse(e.ts)) && e.user === 'Deshawn Reed'));
    r = await req(deshawn.cookie, 'POST', '/api/contacts/9999/log-contact');
    check('log contact on missing person 404', r.status === 404);
    r = await req(carla.cookie, 'POST', '/api/contacts/' + patId + '/log-contact');
    check('other rep cannot log contact on this person', r.status === 403);
    r = await req(deshawn.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job One', status: 'Completed', date: '2026-07-01', mfrs: ['Shaw'] });
    check('sales logs job on own account', r.status === 200);
    r = await req(deshawn.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job Two', status: 'In Progress', mfrs: ['NewBrandX'] });
    check('sales cannot introduce new manufacturer via job', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/projects', { acc: ownAcc, name: 'Job Two', status: 'In Progress', mfrs: ['NewBrandX'] });
    check('owner can introduce new manufacturer via job', r.status === 200);

    // ---- deletion ----
    r = await req(deshawn.cookie, 'POST', '/api/contacts', { acc: ownAcc, name: 'Temp Person', cadence: 30 });
    const tempCon = r.json.contact.id;
    r = await req(carla.cookie, 'DELETE', '/api/contacts/' + tempCon);
    check('other rep cannot delete this contact', r.status === 403);
    r = await req(deshawn.cookie, 'DELETE', '/api/contacts/' + tempCon);
    check('rep deletes contact on own account', r.status === 200);
    r = await req(deshawn.cookie, 'DELETE', '/api/contacts/9999');
    check('delete missing contact 404', r.status === 404);

    // deleting the primary contact promotes the next one, projects keep history
    r = await req(deshawn.cookie, 'DELETE', '/api/contacts/' + patId);
    check('primary contact deleted', r.status === 200);
    r = await req(deshawn.cookie, 'GET', '/api/data');
    check('projects lost the person reference but survive',
      r.json.projects.filter(p => p.acc === ownAcc).every(p => p.con !== patId));

    r = await req(deshawn.cookie, 'DELETE', '/api/accounts/' + ownAcc);
    check('sales cannot delete an account', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/accounts', { name: 'Doomed LLC', type: 'Builder', rep: 3 });
    const doomed = r.json.account.id;
    await req(owner.cookie, 'POST', '/api/contacts', { acc: doomed, name: 'Doomed Contact' });
    await req(owner.cookie, 'POST', '/api/projects', { acc: doomed, name: 'Doomed Job', status: 'In Progress' });
    r = await req(manager.cookie, 'DELETE', '/api/accounts/' + doomed);
    check('manager deletes an account', r.status === 200);
    r = await req(owner.cookie, 'GET', '/api/data');
    check('account cascade removes contacts/projects/activity',
      !r.json.accounts.some(a => a.id === doomed) &&
      !r.json.contacts.some(c => c.acc === doomed) &&
      !r.json.projects.some(p => p.acc === doomed) &&
      !r.json.activity.some(e => e.acc === doomed));
    r = await req(manager.cookie, 'DELETE', '/api/accounts/9999');
    check('delete missing account 404', r.status === 404);

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

    // ---- bulk import ----
    const impRows = [
      { company: 'Import Co A', type: 'General Contractor', name: 'Alice Imp', title: 'PM', email: 'alice@importa.com', phone: '111', cadence: 30 },
      { company: 'Import Co A', name: 'Bob Imp', email: 'bob@importa.com' },
      { company: 'Import Co B', type: 'Builder', name: 'Cara Imp', email: 'cara@importb.com', cadence: 14 },
      { company: '', name: 'No Company' },       // skipped
      { company: 'Import Co B', name: 'Dup Email', email: 'CARA@importb.com' }, // dup email, skipped
    ];
    r = await req(carla2.cookie, 'POST', '/api/import', { rows: impRows });
    check('sales cannot bulk import', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/import', { rows: impRows, rep: 3 });
    check('owner bulk import returns summary', r.status === 200 &&
      r.json.summary.newAccounts === 2 && r.json.summary.newContacts === 3 &&
      r.json.summary.skippedContacts === 1 && r.json.summary.skippedRows === 1);
    r = await req(owner.cookie, 'GET', '/api/data');
    const impA = r.json.accounts.find(a => a.name === 'Import Co A');
    check('imported account assigned to chosen rep, first contact primary',
      impA && impA.rep === 3 && r.json.contacts.some(c => c.acc === impA.id && c.name === 'Alice Imp' && c.primary));
    check('imported contact keeps cadence', r.json.contacts.some(c => c.name === 'Cara Imp' && c.cadence === 14));
    // re-importing the same rows is idempotent (all skipped)
    r = await req(owner.cookie, 'POST', '/api/import', { rows: impRows, rep: 3 });
    check('re-import skips existing businesses and contacts',
      r.status === 200 && r.json.summary.newAccounts === 0 && r.json.summary.newContacts === 0);

    // ---- website + contact notes ----
    r = await req(owner.cookie, 'PATCH', '/api/accounts/' + impA.id, { website: 'davis.k12.ut.us' });
    check('account website saved', r.status === 200 && r.json.account.website === 'davis.k12.ut.us');
    r = await req(owner.cookie, 'POST', '/api/contacts', { acc: impA.id, name: 'Noted Person', note: 'Rank 1 · prefers email', cadence: 30 });
    check('contact note saved', r.status === 200 && r.json.contact.note === 'Rank 1 · prefers email');

    // ---- contacts import carries website + contact_note ----
    r = await req(owner.cookie, 'POST', '/api/import', { rows: [
      { company: 'Nebo School District', type: 'Other', website: 'nebo.edu', name: 'Fac Director', title: 'Facilities Director', email: 'fd@nebo.edu', cadence: 30, contact_note: 'Rank 1' },
    ], rep: 2 });
    check('contacts import created district', r.status === 200 && r.json.summary.newAccounts === 1);
    r = await req(owner.cookie, 'GET', '/api/data');
    const nebo = r.json.accounts.find(a => a.name === 'Nebo School District');
    check('imported website + contact note landed',
      nebo && nebo.website === 'nebo.edu' && r.json.contacts.some(c => c.acc === nebo.id && c.note === 'Rank 1'));

    // ---- signals import ----
    const sigRows = [
      { company: 'Nebo School District', signal_type: 'capital', summary: 'Gym VCT replacement 2027', score: '88', date: '2027-05-01', source_url: 'https://nebo.edu/cap.pdf' },
      { company: 'Nebo School District', signal_type: 'spec', summary: 'Div 09 approved: Patcraft, Mohawk', score: '60', source_url: 'https://nebo.edu/spec.pdf' },
      { company: 'Ghost District', signal_type: 'bid', summary: 'no matching account', score: '50' },
      { company: 'Nebo School District', signal_type: 'nonsense', summary: 'clamps type + score', score: '999' },
    ];
    r = await req(carla2.cookie, 'POST', '/api/import-signals', { rows: sigRows });
    check('sales cannot import signals', r.status === 403);
    r = await req(owner.cookie, 'POST', '/api/import-signals', { rows: sigRows });
    check('signals import: 3 added, 1 unmatched', r.status === 200 &&
      r.json.summary.added === 3 && r.json.summary.unmatched === 1 &&
      r.json.summary.unmatchedCompanies.includes('Ghost District'));
    r = await req(owner.cookie, 'GET', '/api/data');
    const nebOps = r.json.opportunities.filter(o => o.acc === nebo.id);
    check('opportunities attached with clamped score + normalized type', nebOps.length === 3 &&
      nebOps.some(o => o.score === 88 && o.type === 'capital') &&
      nebOps.some(o => o.score === 100 && o.type === 'general'));
    // re-import is idempotent by source url
    r = await req(owner.cookie, 'POST', '/api/import-signals', { rows: sigRows });
    check('signals re-import skips duplicates', r.status === 200 && r.json.summary.added === 0 && r.json.summary.dupes >= 2);

    // sales rep can't see another rep's opportunities
    r = await req(carla2.cookie, 'GET', '/api/data');
    check('sales rep sees only own opportunities', r.json.opportunities.every(o => r.json.accounts.some(a => a.id === o.acc)));

    // delete opportunity
    r = await req(owner.cookie, 'DELETE', '/api/opportunities/' + nebOps[0].id);
    check('delete opportunity', r.status === 200);
    r = await req(owner.cookie, 'GET', '/api/data');
    check('opportunity removed', !r.json.opportunities.some(o => o.id === nebOps[0].id));

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
