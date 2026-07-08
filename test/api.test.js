'use strict';

/*
 * API smoke tests. Starts the server on a scratch port with a scratch data
 * dir, exercises every endpoint, and reports pass/fail.
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

let passed = 0, failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.error('FAIL  ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
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

    // seed data present
    let r = await req('GET', '/api/data');
    check('GET /api/data returns seed', r.status === 200 && r.json.accounts.length === 10 &&
      r.json.contacts.length === 12 && r.json.projects.length === 28 && r.json.users.length === 4, r.json);
    check('today is a date', /^\d{4}-\d{2}-\d{2}$/.test(r.json.today));

    // static app shell
    const home = await fetch(BASE + '/');
    check('serves index.html', home.status === 200 && (await home.text()).includes('CFS Flooring'));

    // accounts
    r = await req('POST', '/api/accounts', { name: 'Test Builders', type: 'Builder', rep: 3, cadence: 14 });
    check('create account', r.status === 200 && r.json.account.id === 11 && r.json.account.lastContact === (await req('GET', '/api/data')).json.today);
    const accId = r.json.account.id;

    r = await req('POST', '/api/accounts', { name: 'test builders', type: 'Builder', rep: 3, cadence: 14 });
    check('duplicate account rejected', r.status === 400);

    r = await req('POST', '/api/accounts', { name: '', type: 'Builder' });
    check('empty account name rejected', r.status === 400);

    r = await req('PATCH', '/api/accounts/' + accId, { rep: 4, cadence: 30, note: 'call fridays' });
    check('patch account', r.status === 200 && r.json.account.rep === 4 && r.json.account.cadence === 30 && r.json.account.note === 'call fridays');

    r = await req('PATCH', '/api/accounts/9999', { note: 'x' });
    check('patch missing account 404', r.status === 404);

    // contacts
    r = await req('POST', '/api/contacts', { acc: accId, name: 'Pat Tester', title: 'PM', email: 'pat@test.com', phone: '555' });
    check('create contact (first is primary, inherits rep)', r.status === 200 && r.json.contact.primary === true && r.json.contact.rep === 4);
    const conId = r.json.contact.id;

    r = await req('POST', '/api/contacts', { acc: accId, name: 'Sam Second' });
    check('second contact not primary', r.status === 200 && r.json.contact.primary === false);

    r = await req('POST', '/api/contacts', { acc: accId, name: '' });
    check('empty contact name rejected', r.status === 400);

    r = await req('PATCH', '/api/contacts/' + conId, { name: 'Pat Retested', rep: 3 });
    check('patch contact', r.status === 200 && r.json.contact.name === 'Pat Retested' && r.json.contact.rep === 3);

    // projects
    r = await req('POST', '/api/projects', { acc: accId, con: conId, name: 'Test Job', addr: '1 Test St', status: 'Completed', date: '2026-07-01', mfrs: ['Shaw'] });
    check('create project', r.status === 200 && r.json.project.mfrs.length === 1);
    const projId = r.json.project.id;

    r = await req('GET', '/api/data');
    const acc = r.json.accounts.find(a => a.id === accId);
    check('saving job touches account lastContact', acc.lastContact === r.json.today);
    const pc = r.json.contacts.find(c => c.id === conId);
    check('saving job touches primary contact lastContact', pc.lastContact === r.json.today);

    r = await req('POST', '/api/projects', { acc: accId, name: 'No Date', status: 'Completed', date: '' });
    check('completed without date rejected', r.status === 400);

    r = await req('POST', '/api/projects', { acc: accId, name: 'WIP Job', status: 'In Progress', mfrs: ['BrandNewMfr'] });
    check('in-progress without date ok, new mfr registered', r.status === 200 &&
      (await req('GET', '/api/data')).json.mfrs.includes('BrandNewMfr'));

    r = await req('PATCH', '/api/projects/' + projId, { status: 'Archive' });
    check('patch project status', r.status === 200 && r.json.project.status === 'Archive');

    // manufacturers
    r = await req('POST', '/api/mfrs', { name: 'shaw' });
    check('mfr dedupe (case-insensitive)', r.status === 200 && r.json.mfr === 'Shaw');
    r = await req('POST', '/api/mfrs', { name: 'Karndean' });
    check('mfr added', r.status === 200 && r.json.mfr === 'Karndean');

    // users
    r = await req('POST', '/api/users', { name: 'New Rep', email: 'new@cfs.com', role: 'Sales' });
    check('create user', r.status === 200 && r.json.user.role === 'Sales');
    const uid = r.json.user.id;
    r = await req('PATCH', '/api/users/' + uid, { role: 'Manager' });
    check('patch user role', r.status === 200 && r.json.user.role === 'Manager');

    // persistence: data survives in db.json
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'db.json'), 'utf8'));
    check('db.json persisted', raw.accounts.some(a => a.name === 'Test Builders') && raw.mfrs.includes('Karndean'));

    // clear demo
    r = await req('POST', '/api/admin/clear-demo');
    check('clear demo', r.status === 200);
    r = await req('GET', '/api/data');
    check('clear demo wipes accounts/contacts/projects, keeps users+mfrs',
      r.json.accounts.length === 0 && r.json.contacts.length === 0 && r.json.projects.length === 0 &&
      r.json.users.length === 5 && r.json.mfrs.includes('Karndean') && r.json.meta.demo === false);

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
  } finally {
    server.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
