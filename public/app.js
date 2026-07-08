'use strict';

/*
 * CFS Flooring Sales CRM — single-page app.
 * All data comes from /api; every save persists to the server so the whole
 * team shares one database.
 */

// ---------- state ----------

const state = {
  data: null,            // { users, accounts, contacts, projects, mfrs, meta }
  today: null,           // YYYY-MM-DD from server
  currentUserId: localStorage.getItem('cfs-user') || '',
  screen: 'dashboard',
  selId: null,           // selected account (detail screen)
  viewProjId: null,      // selected project (project screen)
  editId: null,          // project being edited in the form
  range: '12mo',
  search: '',
  pStatus: 'All',
  pMfr: 'All',
  accFormOpen: false,
  conFormOpen: false,
  editConId: null,
  userFormOpen: false,
  editUserId: null,
  fMfrs: [],             // manufacturer chips selected in the project form
};

let toastTimer = null;

// ---------- utilities ----------

const $ = id => document.getElementById(id);

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, ms) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 4500);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed (' + res.status + ')');
  return json;
}

async function refresh() {
  const json = await api('GET', '/api/data');
  state.data = json;
  state.today = json.today;
  if (!state.currentUserId || !json.users.some(u => String(u.id) === state.currentUserId)) {
    const firstSales = json.users.find(u => u.role === 'Sales') || json.users[0];
    state.currentUserId = firstSales ? String(firstSales.id) : '';
  }
}

// ---------- derived data (mirrors the approved design logic) ----------

function today() { return state.today || new Date().toISOString().slice(0, 10); }

function daysSince(d) {
  return Math.round((Date.parse(today()) - Date.parse(d)) / 86400000);
}

function dueInfo(a) {
  const diff = a.cadence - daysSince(a.lastContact); // days until next contact due
  if (diff < 0) return { diff, text: Math.abs(diff) + 'd overdue', cls: 'badge-red', color: '#b3382c' };
  if (diff === 0) return { diff, text: 'due today', cls: 'badge-amber', color: '#8a5a1d' };
  if (diff <= 7) return { diff, text: 'due in ' + diff + 'd', cls: 'badge-amber', color: '#8a5a1d' };
  return { diff, text: 'due in ' + diff + 'd', cls: 'badge-green', color: '#0d7a4f' };
}

function currentUser() {
  const d = state.data;
  return d.users.find(u => String(u.id) === state.currentUserId) || d.users[0];
}

const isOwner = () => currentUser() && currentUser().role !== 'Sales';

// Sales reps only see their own accounts/projects; managers/owners see everything
function visAccounts() {
  const d = state.data;
  return isOwner() ? d.accounts : d.accounts.filter(a => a.rep === currentUser().id);
}

function visProjects() {
  const ids = visAccounts().map(a => a.id);
  return state.data.projects.filter(p => ids.includes(p.acc));
}

const repName = id => (state.data.users.find(u => u.id === id) || {}).name || '—';
const repById = id => state.data.users.find(u => u.id === id);
const accById = id => state.data.accounts.find(a => a.id === id);
const accName = id => (accById(id) || {}).name || '';

const CAD_LABELS = { 7: 'Weekly', 14: 'Every 2 weeks', 30: 'Monthly', 60: 'Every 2 months', 90: 'Quarterly' };
const cadLabel = c => CAD_LABELS[c] || ('Every ' + c + 'd');

function primaryContactOf(accId) {
  const cs = state.data.contacts;
  return cs.find(c => c.acc === accId && c.primary) || cs.find(c => c.acc === accId) || null;
}

function lastJobOf(accId) {
  const dates = state.data.projects.filter(p => p.acc === accId && p.date).map(p => p.date).sort();
  return dates.pop() || '—';
}

function badgeCls(status) {
  return status === 'Completed' ? 'badge-green' : status === 'In Progress' ? 'badge-blue' : 'badge-gray';
}

function inRange(p) {
  if (p.status !== 'Completed' || !p.date) return false;
  const r = state.range;
  const y = today().slice(0, 4);
  if (r === 'all') return true;
  if (r === 'ytd') return p.date >= y + '-01-01';
  if (r === 'prev') {
    const py = String(+y - 1);
    return p.date >= py + '-01-01' && p.date <= py + '-12-31';
  }
  const cutoff = new Date(Date.parse(today()) - 365 * 86400000).toISOString().slice(0, 10);
  return p.date >= cutoff;
}

function rangeLabel() {
  const y = today().slice(0, 4);
  return { '12mo': 'last 12 months', ytd: 'this year', prev: String(+y - 1), all: 'all time' }[state.range];
}

function agoText(d) {
  if (d === '—') return 'no jobs yet';
  const days = daysSince(d);
  return days >= 365 ? (days / 365).toFixed(1) + ' yrs ago'
    : days >= 60 ? Math.round(days / 30) + ' mo ago' : days + 'd ago';
}

// Reminder lists: organized by person — the contact is the headline
function remindersAll() {
  return visAccounts()
    .map(a => ({ a, d: dueInfo(a) }))
    .sort((x, y) => x.d.diff - y.d.diff)
    .map(({ a, d }) => ({ a, d, person: (primaryContactOf(a.id) || {}).name || '—' }));
}

function staleAll() {
  return visAccounts()
    .map(a => ({ a, last: lastJobOf(a.id) }))
    .sort((x, y) => (x.last === '—' ? '0000' : x.last).localeCompare(y.last === '—' ? '0000' : y.last))
    .map(({ a, last }) => ({ a, last, person: (primaryContactOf(a.id) || {}).name || '—' }));
}

// ---------- email actions (opens the user's mail app, prefilled) ----------

function mailto(to, cc, subject, body) {
  let url = 'mailto:' + encodeURIComponent(to) +
    '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  if (cc) url += '&cc=' + encodeURIComponent(cc);
  window.location.href = url;
}

function emailContact(accId) {
  const a = accById(accId);
  if (!a) return;
  const c = primaryContactOf(a.id);
  const rep = repById(a.rep);
  if (!c || !c.email) return emailRep(accId);
  mailto(c.email, rep ? rep.email : '',
    'Checking in — ' + a.name,
    'Hi ' + c.name.split(' ')[0] + ',\n\nJust checking in from CFS Flooring. ' +
    'Anything coming up we can help with?\n\nThanks,\n' + (rep ? rep.name : 'CFS Flooring'));
  toast('Opening email to ' + c.name + ' (' + c.email + ')' + (rep ? ' — copied to ' + rep.name + '.' : '.'));
}

function emailRep(accId) {
  const a = accById(accId);
  if (!a) return;
  const rep = repById(a.rep);
  if (!rep || !rep.email) return toast('No rep email on file for ' + a.name + '. Add one in Settings.');
  const due = dueInfo(a);
  mailto(rep.email, '',
    'Reminder: contact ' + a.name + ' — ' + due.text,
    a.name + ' is ' + due.text + ' for a touch (cadence: ' + cadLabel(a.cadence) + ').\n\n' +
    'Notes: ' + (a.note || 'no notes'));
  toast('Opening reminder email to ' + rep.name + ' (' + rep.email + ') about ' + a.name + '.');
}

// ---------- navigation ----------

function go(screen, extra) {
  Object.assign(state, {
    screen,
    accFormOpen: false, conFormOpen: false, editConId: null,
    userFormOpen: false, editUserId: null,
  }, extra || {});
  render();
  $('main') && ($('main').scrollTop = 0);
}

const openAccount = id => go('detail', { selId: id });
const openProject = id => go('project', { viewProjId: id });

// ---------- rendering ----------

function render() {
  const d = state.data;
  if (!d) return;
  const user = currentUser();
  if (state.screen === 'settings' && !isOwner()) state.screen = 'dashboard';

  const navItems = [
    { label: 'Dashboard', key: 'dashboard' },
    { label: 'Reminders', key: 'reminders' },
    { label: 'Accounts', key: 'accounts' },
    { label: 'Projects', key: 'projects' },
  ];
  if (isOwner()) navItems.push({ label: 'Settings', key: 'settings' });

  const activeKey = state.screen === 'detail' ? 'accounts' : state.screen;

  $('app').innerHTML = `
  <div class="sidebar">
    <div class="brand">
      <div class="brand-name">CFS Flooring</div>
      <div class="brand-sub">Sales CRM</div>
    </div>
    <nav class="nav">
      ${navItems.map(n => `<button class="nav-item ${activeKey === n.key ? 'active' : ''}" data-action="nav" data-screen="${n.key}">${n.label}</button>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="signed-in">
        <div class="signed-in-label">Signed in as</div>
        <select id="user-select" class="user-select" data-action="set-user">
          ${d.users.map(u => `<option value="${u.id}" ${String(u.id) === state.currentUserId ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`).join('')}
        </select>
        <div class="signed-in-role">${user.role === 'Sales' ? 'Sales rep' : user.role + ' — full access'}</div>
      </div>
      <button class="btn-new-project" data-action="new-project">+ New Project</button>
    </div>
  </div>
  <div class="main" id="main">${renderScreen()}</div>`;
}

function renderScreen() {
  switch (state.screen) {
    case 'dashboard': return renderDashboard();
    case 'reminders': return renderReminders();
    case 'accounts': return renderAccounts();
    case 'detail': return renderDetail();
    case 'projects': return renderProjects();
    case 'project': return renderProject();
    case 'settings': return renderSettings();
    case 'new': return renderProjectForm();
    default: return renderDashboard();
  }
}

// ----- shared row templates -----

function reminderRowHtml(person, a, badgeTextCls, badgeText, subLine) {
  return `
  <div class="reminder-row">
    <div class="reminder-main">
      <div class="reminder-person" data-action="open-account" data-id="${a.id}">${esc(person)}</div>
      <div class="reminder-sub">${subLine}</div>
    </div>
    <span class="badge pill ${badgeTextCls}">${esc(badgeText)}</span>
    <button class="btn btn-outline" data-action="email-contact" data-id="${a.id}">Email contact</button>
  </div>`;
}

function contactReminderRow(r) {
  return reminderRowHtml(r.person, r.a, r.d.cls, r.d.text,
    `${esc(r.a.name)} &middot; ${esc(repName(r.a.rep))} &middot; ${esc(cadLabel(r.a.cadence))}`);
}

function staleRow(s) {
  return reminderRowHtml(s.person, s.a, 'badge-red', agoText(s.last),
    `${esc(s.a.name)} &middot; ${esc(repName(s.a.rep))} &middot; last job ${esc(s.last)}`);
}

const emptyNote = msg => `<div class="empty-note">${msg}</div>`;

// ----- dashboard -----

function renderDashboard() {
  const y = today().slice(0, 4);
  const visible = visProjects();
  const ranged = visible.filter(inRange);
  const accounts = visAccounts();
  const overdue = accounts.filter(a => dueInfo(a).diff < 0);

  const byAcc = {};
  ranged.forEach(p => { byAcc[p.acc] = (byAcc[p.acc] || 0) + 1; });
  const topClients = Object.entries(byAcc)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, jobs], i) => {
      const a = accById(+id);
      const pc = primaryContactOf(+id);
      return { rank: i + 1, id: +id, name: accName(+id), jobs, contact: pc ? pc.name : '—', lastJob: lastJobOf(+id), lastContact: a ? a.lastContact : '—' };
    });

  const mu = state.data.mfrs
    .map(m => ({ name: m, count: ranged.filter(p => p.mfrs.includes(m)).length }))
    .sort((a, b) => b.count - a.count);
  const muMax = Math.max(1, ...mu.map(x => x.count));

  const reminders = remindersAll().slice(0, 5);
  const stale = staleAll().slice(0, 5);

  const kpiColor = { jobs: '#22262b', prog: '#1d4f8f', acc: '#22262b', due: overdue.length ? '#b3382c' : '#0d7a4f' };

  return `
  <div class="page-head">
    <h1>Dashboard</h1>
    <select class="select" data-action="set-range">
      <option value="12mo" ${state.range === '12mo' ? 'selected' : ''}>Last 12 months</option>
      <option value="ytd" ${state.range === 'ytd' ? 'selected' : ''}>This year (${y})</option>
      <option value="prev" ${state.range === 'prev' ? 'selected' : ''}>${+y - 1}</option>
      <option value="all" ${state.range === 'all' ? 'selected' : ''}>All time</option>
    </select>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Tracked jobs</div><div class="kpi-value" style="color:${kpiColor.jobs}">${ranged.length}</div><div class="kpi-sub">completed &middot; ${rangeLabel()}</div></div>
    <div class="kpi"><div class="kpi-label">In progress</div><div class="kpi-value" style="color:${kpiColor.prog}">${visible.filter(p => p.status === 'In Progress').length}</div><div class="kpi-sub">active job sites</div></div>
    <div class="kpi"><div class="kpi-label">Accounts</div><div class="kpi-value" style="color:${kpiColor.acc}">${accounts.length}</div><div class="kpi-sub">${isOwner() ? 'across all reps' : 'assigned to you'}</div></div>
    <div class="kpi"><div class="kpi-label">Due for contact</div><div class="kpi-value" style="color:${kpiColor.due}">${overdue.length}</div><div class="kpi-sub">past their cadence</div></div>
  </div>

  <div class="dash-grid">
    <div class="col">
      <div class="card">
        <div class="card-title">Top 10 clients by jobs <span class="muted-inline">&middot; ${rangeLabel()}</span></div>
        ${topClients.length ? `
        <div class="gtable" style="grid-template-columns: 22px 1fr 0.8fr 44px 100px 100px; font-size: 13px;">
          <div class="th">#</div><div class="th">CLIENT</div><div class="th">CONTACT</div>
          <div class="th right">JOBS</div><div class="th right">LAST JOB</div><div class="th right">LAST CONTACT</div>
          ${topClients.map(tc => `
            <div class="td dim" style="padding:5px 0;">${tc.rank}</div>
            <div class="td strong link" style="padding:5px 0;" data-action="open-account" data-id="${tc.id}">${esc(tc.name)}</div>
            <div class="td" style="padding:5px 0;">${esc(tc.contact)}</div>
            <div class="td right" style="padding:5px 0;color:#22262b;">${tc.jobs}</div>
            <div class="td right" style="padding:5px 0;">${esc(tc.lastJob)}</div>
            <div class="td right" style="padding:5px 0;">${esc(tc.lastContact)}</div>`).join('')}
        </div>` : emptyNote('No completed jobs in this range yet. Log a job with the <b>+ New Project</b> button.')}
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:14px;">Manufacturer utilization <span class="muted-inline">&middot; ${rangeLabel()}</span></div>
        ${mu.length ? mu.map(x => `
          <div class="meter-row">
            <div class="meter-head"><span style="font-weight:600;">${esc(x.name)}</span><span style="color:#565d66;">${x.count} jobs</span></div>
            <div class="meter-track"><div class="meter-fill" style="width:${Math.round(x.count / muMax * 100)}%;"></div></div>
          </div>`).join('') : emptyNote('No manufacturers yet — add them in Settings.')}
      </div>
    </div>

    <div class="col">
      <div class="card">
        <div class="card-head">
          <div class="card-title">Contact reminders <span class="muted-inline">&middot; top 5</span></div>
          <span class="link-strong" data-action="nav" data-screen="reminders">View all &rarr;</span>
        </div>
        <div class="card-sub">Based on each account&rsquo;s contact cadence.</div>
        ${reminders.length ? reminders.map(contactReminderRow).join('') : emptyNote('No accounts yet.')}
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">Longest since last job <span class="muted-inline">&middot; top 5</span></div>
          <span class="link-strong" data-action="nav" data-screen="reminders">View all &rarr;</span>
        </div>
        <div class="card-sub">Clients we haven&rsquo;t done work for in the longest — worth a win-back call.</div>
        ${stale.length ? stale.map(staleRow).join('') : emptyNote('No accounts yet.')}
      </div>
    </div>
  </div>`;
}

// ----- reminders -----

function renderReminders() {
  const ra = remindersAll();
  const sa = staleAll();
  return `
  <h1 style="margin-bottom:20px;">Reminders</h1>
  <div class="dash-grid" style="grid-template-columns:1fr 1fr;">
    <div class="card">
      <div class="card-title" style="margin-bottom:2px;">Contact reminders</div>
      <div class="card-sub">Everyone, sorted by who&rsquo;s most overdue for a touch.</div>
      ${ra.length ? ra.map(contactReminderRow).join('') : emptyNote('No accounts yet.')}
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:2px;">Longest since last job</div>
      <div class="card-sub">Everyone, oldest last job first.</div>
      ${sa.length ? sa.map(staleRow).join('') : emptyNote('No accounts yet.')}
    </div>
  </div>`;
}

// ----- accounts list -----

function repOptionsHtml(selectedId) {
  return state.data.users.filter(u => u.role === 'Sales')
    .map(u => `<option value="${u.id}" ${String(u.id) === String(selectedId) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
}

function cadenceOptionsHtml(selected) {
  return [7, 14, 30, 60, 90].map(c =>
    `<option value="${c}" ${+selected === c ? 'selected' : ''}>${CAD_LABELS[c]}</option>`).join('');
}

function accountRowsHtml() {
  const q = state.search.toLowerCase();
  const rows = visAccounts()
    .filter(a => !q || a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q))
    .map(a => {
      const due = dueInfo(a);
      return `
      <div class="td strong link" data-action="open-account" data-id="${a.id}">${esc(a.name)}</div>
      <div class="td">${esc(a.type)}</div>
      <div class="td">${esc(repName(a.rep))}</div>
      <div class="td right" style="color:#22262b;">${state.data.projects.filter(p => p.acc === a.id).length}</div>
      <div class="td right dim">${esc(lastJobOf(a.id))}</div>
      <div class="td right dim">${esc(a.lastContact)}</div>
      <div class="td">${esc(cadLabel(a.cadence))}</div>
      <div class="td" style="padding:7px 0;"><span class="badge ${due.cls}">${esc(due.text)}</span></div>`;
    }).join('');

  return `
  <div class="gtable" style="grid-template-columns: 1.5fr 1fr 110px 44px 92px 92px 110px 110px;">
    <div class="th">ACCOUNT</div><div class="th">TYPE</div><div class="th">REP</div>
    <div class="th right">JOBS</div><div class="th right">LAST JOB</div><div class="th right">LAST CONTACT</div>
    <div class="th">CADENCE</div><div class="th">NEXT CONTACT</div>
    ${rows}
  </div>
  ${rows ? '' : emptyNote('No accounts match. Add one with <b>+ New Account</b>.')}`;
}

function renderAccounts() {
  const defaultRep = isOwner()
    ? ((state.data.users.find(u => u.role === 'Sales') || {}).id || '')
    : state.currentUserId;
  return `
  <div class="page-head">
    <h1>Accounts</h1>
    <div class="page-head-actions">
      <input id="search" class="input" data-action="search" placeholder="Search accounts&hellip;" style="width:240px;" value="${esc(state.search)}">
      <button class="btn btn-primary" data-action="toggle-acc-form">+ New Account</button>
    </div>
  </div>
  ${state.accFormOpen ? `
  <div class="panel-form">
    <div class="panel-form-title">New account</div>
    <div class="panel-grid">
      <div class="field"><label>Account name *</label><input id="na-name" class="input" placeholder="e.g. Crestway Builders"></div>
      <div class="field"><label>Type</label>
        <select id="na-type" class="select">
          ${['Builder', 'General Contractor', 'Designer', 'Property Manager', 'Other'].map(t => `<option>${t}</option>`).join('')}
        </select></div>
      <div class="field"><label>Assigned rep</label><select id="na-rep" class="select">${repOptionsHtml(defaultRep)}</select></div>
      <div class="field"><label>Contact cadence</label><select id="na-cadence" class="select">${cadenceOptionsHtml(30)}</select></div>
      <div class="actions">
        <button class="btn btn-cancel" data-action="toggle-acc-form">Cancel</button>
        <button class="btn btn-primary" data-action="save-account" style="padding:9px 18px;">Save account</button>
      </div>
    </div>
    <div id="acc-form-error" class="form-error" style="margin-top:10px;"></div>
  </div>` : ''}
  <div class="card" style="padding:6px 20px 14px;" id="accounts-table">${accountRowsHtml()}</div>`;
}

// ----- account detail -----

function renderDetail() {
  const a = accById(state.selId);
  if (!a) return '<div class="empty-note">Account not found.</div>';
  const ps = state.data.projects.filter(p => p.acc === a.id)
    .slice().sort((x, y) => (y.date || '9999').localeCompare(x.date || '9999'));
  const due = dueInfo(a);
  const contacts = state.data.contacts.filter(c => c.acc === a.id);

  const contactCard = c => state.editConId === c.id ? `
    <div class="contact-card">
      <div class="inline-form">
        <input id="ec-name" class="input" placeholder="Full name *" value="${esc(c.name)}">
        <input id="ec-title" class="input" placeholder="Title" value="${esc(c.title)}">
        <input id="ec-email" class="input" placeholder="Email" value="${esc(c.email)}">
        <input id="ec-phone" class="input" placeholder="Phone" value="${esc(c.phone)}">
        <div class="field span2"><label>Assigned sales rep</label>
          <select id="ec-rep" class="select">${repOptionsHtml(c.rep != null ? c.rep : a.rep)}</select></div>
        <div id="ec-error" class="form-error span2" style="display:none;"></div>
        <div class="actions">
          <button class="btn-sm-cancel" data-action="cancel-edit-contact">Cancel</button>
          <button class="btn-sm-save" data-action="save-edit-contact" data-id="${c.id}">Save</button>
        </div>
      </div>
    </div>` : `
    <div class="contact-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="min-width:0;">
          <div class="contact-name">${esc(c.name)} <span class="muted-inline">${c.primary ? '&middot; primary' : ''}</span></div>
          <div class="contact-line">${esc(c.title)}</div>
          <div class="contact-line dim">${esc(c.email)}${c.email && c.phone ? ' &middot; ' : ''}${esc(c.phone)}</div>
          <div class="contact-line dim" style="margin-top:2px;">Last contact <span style="font-weight:600;color:#565d66;">${esc(c.lastContact || '—')}</span></div>
          <div class="rep-chip"><span class="rep-chip-label">Sales rep</span><span class="rep-chip-name">${esc(repName(c.rep))}</span></div>
        </div>
        <span class="link-strong" style="font-size:12px;flex-shrink:0;" data-action="edit-contact" data-id="${c.id}">Edit</span>
      </div>
    </div>`;

  return `
  <span class="back-link" data-action="nav" data-screen="accounts">&larr; All accounts</span>
  <div class="detail-title">
    <h1>${esc(a.name)}</h1>
    <span class="type-tag">${esc(a.type)}</span>
  </div>

  <div class="kpis" style="margin-bottom:20px;">
    <div class="kpi dark"><div class="kpi-label">Tracked jobs</div><div class="kpi-detail-value">${ps.length}</div></div>
    <div class="kpi"><div class="kpi-label">Last job</div><div class="kpi-detail-value">${esc(lastJobOf(a.id))}</div></div>
    <div class="kpi"><div class="kpi-label">Last contact</div><div class="kpi-detail-value">${esc(a.lastContact)}</div></div>
    <div class="kpi"><div class="kpi-label">Next contact</div><div class="kpi-detail-value" style="color:${due.color};">${esc(due.text)}</div></div>
  </div>

  <div class="detail-grid">
    <div class="col">
      <div class="card rel-card">
        <div class="card-title-sm">Relationship</div>
        <div class="field"><label>Assigned rep</label>
          <select class="select" data-action="rel-rep">${repOptionsHtml(a.rep)}</select></div>
        <div class="field"><label>Contact cadence</label>
          <select class="select" data-action="rel-cadence">${cadenceOptionsHtml(a.cadence)}</select></div>
        <div class="field"><label>Contact notes</label>
          <textarea id="rel-note" class="input" rows="4" data-action="rel-note" placeholder="How and when to reach this account&hellip;">${esc(a.note)}</textarea></div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn btn-primary btn-block" data-action="log-contact" data-id="${a.id}">Log contact today</button>
          <button class="btn btn-outline btn-block" data-action="email-rep" data-id="${a.id}" style="font-weight:700;">Email reminder to rep</button>
        </div>
      </div>
    </div>
    <div class="col">
      <div class="card" style="padding:16px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="card-title-sm" style="font-size:14px;font-weight:700;">Contacts</div>
          <span class="link-strong" data-action="toggle-con-form">+ Add contact</span>
        </div>
        ${state.conFormOpen ? `
        <div class="inline-form" style="margin-bottom:12px;">
          <input id="nc-name" class="input" placeholder="Full name *">
          <input id="nc-title" class="input" placeholder="Title">
          <input id="nc-email" class="input" placeholder="Email">
          <input id="nc-phone" class="input" placeholder="Phone">
          <div id="con-form-error" class="form-error span2" style="display:none;"></div>
          <div class="actions">
            <button class="btn-sm-cancel" data-action="toggle-con-form">Cancel</button>
            <button class="btn-sm-save" data-action="save-contact">Save</button>
          </div>
        </div>` : ''}
        ${contacts.length ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">${contacts.map(contactCard).join('')}</div>`
          : emptyNote('No contacts yet — add the people you work with at this account.')}
      </div>

      <div class="card" style="padding:6px 20px 14px;">
        <div style="font-size:14px;font-weight:700;padding:12px 0 4px;">Project history</div>
        <div class="gtable" style="grid-template-columns:1.5fr 110px 100px 1fr;font-size:13px;">
          <div class="th" style="padding:8px 0 4px;">PROJECT</div>
          <div class="th" style="padding:8px 0 4px;">STATUS</div>
          <div class="th" style="padding:8px 0 4px;">COMPLETED</div>
          <div class="th" style="padding:8px 0 4px;">MANUFACTURERS</div>
          ${ps.map(p => `
            <div class="td strong link" style="padding:7px 0;" data-action="open-project" data-id="${p.id}">${esc(p.name)}</div>
            <div class="td" style="padding:7px 0;"><span class="badge ${badgeCls(p.status)}">${esc(p.status)}</span></div>
            <div class="td" style="padding:7px 0;">${esc(p.date || '—')}</div>
            <div class="td" style="padding:7px 0;">${esc(p.mfrs.join(', '))}</div>`).join('')}
        </div>
        ${ps.length ? '' : emptyNote('No projects logged for this account yet.')}
      </div>
    </div>
  </div>`;
}

// ----- projects list -----

function renderProjects() {
  const rows = visProjects()
    .filter(p => (state.pStatus === 'All' || p.status === state.pStatus) &&
                 (state.pMfr === 'All' || p.mfrs.includes(state.pMfr)))
    .slice().sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999'));

  return `
  <div class="page-head">
    <h1>Projects</h1>
    <div class="page-head-actions">
      <select class="select" data-action="set-pstatus">
        ${['All', 'In Progress', 'Completed', 'Archive'].map(s =>
          `<option value="${s}" ${state.pStatus === s ? 'selected' : ''}>${s === 'All' ? 'All statuses' : s}</option>`).join('')}
      </select>
      <select class="select" data-action="set-pmfr">
        <option value="All">All manufacturers</option>
        ${state.data.mfrs.map(m => `<option value="${esc(m)}" ${state.pMfr === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="card" style="padding:6px 20px 14px;">
    <div class="gtable" style="grid-template-columns:1.5fr 1.1fr 110px 100px 1fr 110px;font-size:13px;">
      <div class="th">PROJECT</div><div class="th">CLIENT</div><div class="th">STATUS</div>
      <div class="th">COMPLETED</div><div class="th">MANUFACTURERS</div><div class="th">REP</div>
      ${rows.map(p => {
        const a = accById(p.acc) || {};
        return `
        <div class="td strong link" style="padding:7px 0;" data-action="open-project" data-id="${p.id}">${esc(p.name)}</div>
        <div class="td link" style="padding:7px 0;" data-action="open-account" data-id="${p.acc}">${esc(accName(p.acc))}</div>
        <div class="td" style="padding:7px 0;"><span class="badge ${badgeCls(p.status)}">${esc(p.status)}</span></div>
        <div class="td" style="padding:7px 0;">${esc(p.date || '—')}</div>
        <div class="td" style="padding:7px 0;">${esc(p.mfrs.join(', '))}</div>
        <div class="td" style="padding:7px 0;">${esc(repName(a.rep))}</div>`;
      }).join('')}
    </div>
    ${rows.length ? '' : emptyNote('No projects match these filters. Log one with <b>+ New Project</b>.')}
  </div>`;
}

// ----- project detail -----

function renderProject() {
  const p = state.data.projects.find(x => x.id === state.viewProjId);
  if (!p) return '<div class="empty-note">Project not found.</div>';
  const a = accById(p.acc) || {};
  const con = state.data.contacts.find(c => c.id === p.con);
  return `
  <div style="max-width:860px;">
    <span class="back-link" data-action="nav" data-screen="projects">&larr; All projects</span>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <h1 style="font-size:24px;">${esc(p.name)}</h1>
        <span class="badge pill ${badgeCls(p.status)}" style="padding:3px 10px;font-size:12px;">${esc(p.status)}</span>
      </div>
      <button class="btn btn-primary" data-action="edit-project" data-id="${p.id}" style="padding:9px 18px;">Edit project</button>
    </div>
    <span class="link" style="font-size:14px;display:inline-block;margin-bottom:20px;" data-action="open-account" data-id="${p.acc}">${esc(accName(p.acc))}</span>

    <div class="card proj-info">
      <div><div class="info-label">Site address</div><div class="info-value">${esc(p.addr || '—')}</div></div>
      <div><div class="info-label">Completion date</div><div class="info-value">${esc(p.date || '—')}</div></div>
      <div><div class="info-label">Contact</div><div class="info-value">${con ? esc(con.name) + (con.title ? ' &middot; ' + esc(con.title) : '') : '—'}</div></div>
      <div><div class="info-label">Salesperson</div><div class="info-value">${esc(repName(a.rep))}</div></div>
      <div>
        <div class="info-label" style="margin-bottom:6px;">Manufacturers</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${p.mfrs.length ? p.mfrs.map(m => `<span class="mfr-tag">${esc(m)}</span>`).join('') : '—'}
        </div>
      </div>
    </div>
  </div>`;
}

// ----- new / edit project form -----

function mfrChipsHtml() {
  return state.data.mfrs.map(m => `
    <div class="chip ${state.fMfrs.includes(m) ? 'on' : ''}" data-action="chip-toggle" data-name="${esc(m)}">${esc(m)}</div>`).join('') +
    (isOwner() ? `<input id="f-newmfr" class="chip-input" data-action="mfr-key" placeholder="+ Add manufacturer">` : '');
}

function contactOptionsHtml(accId, selectedCon) {
  return '<option value="">&mdash;</option>' + state.data.contacts
    .filter(c => c.acc === +accId)
    .map(c => `<option value="${c.id}" ${+selectedCon === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

function renderProjectForm() {
  const editing = state.editId != null;
  const p = editing ? state.data.projects.find(x => x.id === state.editId) : null;
  const accId = p ? p.acc : '';
  const conId = p ? p.con : '';
  return `
  <div style="max-width:660px;">
    <h1 style="margin-bottom:4px;">${editing ? 'Edit project' : 'Log a job'}</h1>
    <p class="page-sub">Saving a job also logs a contact touch on the account.</p>
    <div class="form-card">
      <div class="field"><label>Account *</label>
        <select id="f-acc" class="select" data-action="f-acc">
          <option value="">Select account&hellip;</option>
          ${visAccounts().map(a => `<option value="${a.id}" ${+accId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label>Contact</label>
        <select id="f-con" class="select">${contactOptionsHtml(accId, conId)}</select></div>
      <div class="field"><label>Project name *</label>
        <input id="f-name" class="input" placeholder="e.g. Maple Ridge Lot 22" value="${esc(p ? p.name : '')}"></div>
      <div class="field"><label>Site address</label>
        <input id="f-addr" class="input" placeholder="Street, city" value="${esc(p ? p.addr : '')}"></div>
      <div class="field"><label>Status</label>
        <select id="f-status" class="select">
          ${['In Progress', 'Completed', 'Archive'].map(s =>
            `<option ${(p ? p.status : 'Completed') === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
      <div class="field"><label>Completion date</label>
        <input id="f-date" type="date" class="input" style="padding:8px 10px;" value="${esc(p && p.date ? p.date : today())}"></div>
      <div class="field span2" style="gap:7px;">
        <label>Manufacturers</label>
        <div class="chips" id="mfr-chips">${mfrChipsHtml()}</div>
        ${isOwner() ? '' : '<div class="chip-hint">Missing a manufacturer? Ask a manager/owner to add it in Settings.</div>'}
      </div>
      <div id="form-error" class="form-error span2" style="display:none;"></div>
      <div class="actions">
        <button class="btn btn-cancel" data-action="cancel-form" style="padding:10px 18px;">Cancel</button>
        <button class="btn btn-primary" data-action="save-project" style="padding:10px 20px;">${editing ? 'Save changes' : 'Save project'}</button>
      </div>
    </div>
  </div>`;
}

// ----- settings -----

function renderSettings() {
  const d = state.data;
  const avatarColors = ['#1d4f8f', '#0d7a4f', '#8a5a1d', '#5a3d8a'];

  const teamRow = (u, i) => state.editUserId === u.id ? `
    <div class="team-row">
      <div class="inline-form" style="flex:1;">
        <input id="eu-name" class="input" placeholder="Full name *" value="${esc(u.name)}">
        <input id="eu-email" class="input" placeholder="Email" value="${esc(u.email)}">
        <div class="field span2"><label>Role</label>
          <select id="eu-role" class="select">
            ${['Owner', 'Manager', 'Sales'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select></div>
        <div id="eu-error" class="form-error span2" style="display:none;"></div>
        <div class="actions">
          <button class="btn-sm-cancel" data-action="cancel-edit-user">Cancel</button>
          <button class="btn-sm-save" data-action="save-edit-user" data-id="${u.id}">Save</button>
        </div>
      </div>
    </div>` : `
    <div class="team-row">
      <div class="avatar" style="background:${avatarColors[i % 4]};">${esc(u.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</div>
      <div style="flex:1;">
        <div class="contact-name">${esc(u.name)} <span class="muted-inline">${String(u.id) === state.currentUserId ? '(you)' : ''}</span></div>
        <div class="reminder-sub">${esc(u.email)}</div>
      </div>
      <span class="role-tag" style="background:${u.role === 'Sales' ? '#e9edf2' : '#e7effc'};color:${u.role === 'Sales' ? '#565d66' : '#1d4f8f'};">${u.role}</span>
      <span class="link-strong" style="font-size:12px;" data-action="edit-user" data-id="${u.id}">Edit</span>
    </div>`;

  return `
  <div style="max-width:980px;">
    <h1 style="margin-bottom:20px;">Settings</h1>
    <div class="settings-grid">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div class="card-title" style="margin-bottom:4px;">Team profiles</div>
          <span class="link-strong" data-action="toggle-user-form">+ Add member</span>
        </div>
        <div class="card-sub" style="margin-bottom:12px;">Managers/owners can manage manufacturers and the team; sales reps log jobs and manage clients.</div>
        ${state.userFormOpen ? `
        <div class="inline-form" style="margin-bottom:12px;">
          <input id="nu-name" class="input" placeholder="Full name *">
          <input id="nu-email" class="input" placeholder="Email">
          <div class="field span2"><label>Role</label>
            <select id="nu-role" class="select"><option>Sales</option><option>Manager</option><option>Owner</option></select></div>
          <div id="nu-error" class="form-error span2" style="display:none;"></div>
          <div class="actions">
            <button class="btn-sm-cancel" data-action="toggle-user-form">Cancel</button>
            <button class="btn-sm-save" data-action="save-user">Save</button>
          </div>
        </div>` : ''}
        ${d.users.map(teamRow).join('')}
      </div>

      <div class="col">
        <div class="card">
          <div class="card-title" style="margin-bottom:4px;">Manufacturers</div>
          <div class="card-sub" style="margin-bottom:12px;">The tag list reps pick from when logging a job.</div>
          <div style="margin-bottom:12px;">
            ${d.mfrs.map(m => `
              <div class="mfr-row">
                <span style="font-size:13.5px;font-weight:600;">${esc(m)}</span>
                <span style="font-size:12.5px;color:#8a9099;">${d.projects.filter(p => p.mfrs.includes(m)).length} jobs tagged</span>
              </div>`).join('') || emptyNote('No manufacturers yet.')}
          </div>
          <div class="add-row">
            <input id="s-newmfr" class="input" data-action="mfr-settings-key" placeholder="Manufacturer name">
            <button class="btn btn-primary" data-action="add-mfr-settings" style="padding:9px 16px;">Add</button>
          </div>
        </div>

        ${d.meta && d.meta.demo ? `
        <div class="card">
          <div class="card-title" style="margin-bottom:4px;">Demo data</div>
          <div class="card-sub" style="margin-bottom:12px;">This CRM is currently filled with sample accounts, contacts, and projects so you can explore. When you&rsquo;re ready to start entering real data, clear it — team members and manufacturers are kept.</div>
          <button class="btn btn-danger" data-action="clear-demo">Clear demo data</button>
        </div>` : ''}
      </div>
    </div>
  </div>`;
}

// ---------- form save handlers ----------

function showFormError(id, msg) {
  const el = $(id);
  if (!el) return toast(msg);
  el.textContent = msg;
  el.style.display = 'block';
}

async function saveAccount() {
  try {
    const { account } = await api('POST', '/api/accounts', {
      name: $('na-name').value,
      type: $('na-type').value,
      rep: $('na-rep').value,
      cadence: $('na-cadence').value,
    });
    await refresh();
    go('detail', { selId: account.id });
    toast('Account created: ' + account.name);
  } catch (e) { showFormError('acc-form-error', e.message); }
}

async function saveContact() {
  try {
    await api('POST', '/api/contacts', {
      acc: state.selId,
      name: $('nc-name').value, title: $('nc-title').value,
      email: $('nc-email').value, phone: $('nc-phone').value,
    });
    await refresh();
    state.conFormOpen = false;
    render();
  } catch (e) { showFormError('con-form-error', e.message); }
}

async function saveEditContact(id) {
  try {
    await api('PATCH', '/api/contacts/' + id, {
      name: $('ec-name').value, title: $('ec-title').value,
      email: $('ec-email').value, phone: $('ec-phone').value,
      rep: $('ec-rep').value,
    });
    await refresh();
    state.editConId = null;
    render();
  } catch (e) { showFormError('ec-error', e.message); }
}

async function saveProject() {
  const body = {
    acc: $('f-acc').value, con: $('f-con').value,
    name: $('f-name').value, addr: $('f-addr').value,
    status: $('f-status').value, date: $('f-date').value,
    mfrs: state.fMfrs,
  };
  if (!body.acc) return showFormError('form-error', 'Select an account.');
  if (!body.name.trim()) return showFormError('form-error', 'Enter a project name.');
  if (body.status === 'Completed' && !body.date) return showFormError('form-error', 'Completed jobs need a completion date.');
  try {
    if (state.editId != null) {
      const { project } = await api('PATCH', '/api/projects/' + state.editId, body);
      await refresh();
      go('project', { viewProjId: project.id, editId: null });
      toast('Project updated.');
    } else {
      const { project } = await api('POST', '/api/projects', body);
      await refresh();
      go('projects', { pStatus: 'All', pMfr: 'All' });
      toast('Project saved — contact touch logged for ' + accName(project.acc) + '.');
    }
  } catch (e) { showFormError('form-error', e.message); }
}

async function saveUser() {
  try {
    await api('POST', '/api/users', {
      name: $('nu-name').value, email: $('nu-email').value, role: $('nu-role').value,
    });
    await refresh();
    state.userFormOpen = false;
    render();
  } catch (e) { showFormError('nu-error', e.message); }
}

async function saveEditUser(id) {
  try {
    await api('PATCH', '/api/users/' + id, {
      name: $('eu-name').value, email: $('eu-email').value, role: $('eu-role').value,
    });
    await refresh();
    state.editUserId = null;
    render();
  } catch (e) { showFormError('eu-error', e.message); }
}

async function addManufacturer(inputId, alsoSelect) {
  const input = $(inputId);
  const name = input.value.trim();
  if (!name) return;
  try {
    const { mfr } = await api('POST', '/api/mfrs', { name });
    await refresh();
    if (alsoSelect && !state.fMfrs.includes(mfr)) state.fMfrs.push(mfr);
    if (alsoSelect) {
      $('mfr-chips').innerHTML = mfrChipsHtml();
      const again = $('f-newmfr');
      if (again) again.focus();
    } else {
      render();
    }
  } catch (e) { toast(e.message); }
}

let noteTimer = null;
function scheduleNoteSave(accId, value) {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(async () => {
    try {
      await api('PATCH', '/api/accounts/' + accId, { note: value });
      const a = accById(accId);
      if (a) a.note = value;
    } catch (e) { toast(e.message); }
  }, 600);
}

// ---------- event delegation ----------

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id ? +el.dataset.id : null;

  switch (action) {
    case 'nav': return go(el.dataset.screen);
    case 'new-project': return go('new', { editId: null, fMfrs: [] });
    case 'open-account': return openAccount(id);
    case 'open-project': return openProject(id);
    case 'email-contact': return emailContact(id);
    case 'email-rep': return emailRep(id);

    case 'toggle-acc-form': state.accFormOpen = !state.accFormOpen; return render();
    case 'save-account': return saveAccount();

    case 'toggle-con-form': state.conFormOpen = !state.conFormOpen; return render();
    case 'save-contact': return saveContact();
    case 'edit-contact': state.editConId = id; state.conFormOpen = false; return render();
    case 'cancel-edit-contact': state.editConId = null; return render();
    case 'save-edit-contact': return saveEditContact(id);

    case 'log-contact':
      try {
        await api('POST', '/api/accounts/' + id + '/log-contact');
        await refresh();
        render();
        toast('Contact logged for ' + accName(id) + ' — next touch resets from today.');
      } catch (err) { toast(err.message); }
      return;

    case 'chip-toggle': {
      const name = el.dataset.name;
      state.fMfrs = state.fMfrs.includes(name)
        ? state.fMfrs.filter(x => x !== name) : [...state.fMfrs, name];
      $('mfr-chips').innerHTML = mfrChipsHtml();
      return;
    }
    case 'cancel-form':
      return state.editId != null ? go('project', { editId: null }) : go('projects');
    case 'save-project': return saveProject();
    case 'edit-project': {
      const p = state.data.projects.find(x => x.id === id);
      if (!p) return;
      return go('new', { editId: p.id, fMfrs: [...p.mfrs] });
    }

    case 'toggle-user-form': state.userFormOpen = !state.userFormOpen; state.editUserId = null; return render();
    case 'save-user': return saveUser();
    case 'edit-user': state.editUserId = id; state.userFormOpen = false; return render();
    case 'cancel-edit-user': state.editUserId = null; return render();
    case 'save-edit-user': return saveEditUser(id);

    case 'add-mfr-settings': return addManufacturer('s-newmfr', false);

    case 'clear-demo':
      if (!confirm('Clear ALL demo accounts, contacts, and projects? Team members and manufacturers are kept. This cannot be undone.')) return;
      try {
        await api('POST', '/api/admin/clear-demo');
        await refresh();
        render();
        toast('Demo data cleared — you’re ready to add real accounts.');
      } catch (err) { toast(err.message); }
      return;
  }
});

// Typing/changing a form field clears its form's validation error
function clearFormError(target) {
  const form = target.closest && target.closest('.form-card, .inline-form, .panel-form');
  if (!form) return;
  const err = form.querySelector('.form-error');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
}

document.addEventListener('change', async e => {
  clearFormError(e.target);
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'set-user': {
      state.currentUserId = el.value;
      localStorage.setItem('cfs-user', el.value);
      if (state.screen === 'settings' && !isOwner()) state.screen = 'dashboard';
      // A rep may not be allowed to see the account/project they were viewing
      if (state.screen === 'detail' && !visAccounts().some(a => a.id === state.selId)) state.screen = 'accounts';
      if (state.screen === 'project' && !visProjects().some(p => p.id === state.viewProjId)) state.screen = 'projects';
      return render();
    }
    case 'set-range': state.range = el.value; return render();
    case 'set-pstatus': state.pStatus = el.value; return render();
    case 'set-pmfr': state.pMfr = el.value; return render();
    case 'rel-rep':
      try {
        await api('PATCH', '/api/accounts/' + state.selId, { rep: el.value });
        await refresh(); render();
      } catch (err) { toast(err.message); }
      return;
    case 'rel-cadence':
      try {
        await api('PATCH', '/api/accounts/' + state.selId, { cadence: el.value });
        await refresh(); render();
      } catch (err) { toast(err.message); }
      return;
    case 'f-acc': {
      // Repopulate contact options; preselect the account's primary contact
      const accId = el.value;
      const prim = primaryContactOf(+accId);
      $('f-con').innerHTML = contactOptionsHtml(accId, prim ? prim.id : '');
      return;
    }
  }
});

document.addEventListener('input', e => {
  clearFormError(e.target);
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'search') {
    state.search = el.value;
    const table = $('accounts-table');
    if (table) table.innerHTML = accountRowsHtml();
  }
  if (el.dataset.action === 'rel-note') scheduleNoteSave(state.selId, el.value);
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'mfr-key') { e.preventDefault(); addManufacturer('f-newmfr', true); }
  if (el.dataset.action === 'mfr-settings-key') { e.preventDefault(); addManufacturer('s-newmfr', false); }
});

// ---------- background sync (multi-user freshness) ----------

let lastSnapshot = '';

async function backgroundSync() {
  // Don't clobber open forms mid-edit
  if (state.accFormOpen || state.conFormOpen || state.editConId != null ||
      state.userFormOpen || state.editUserId != null || state.screen === 'new') return;
  try {
    const json = await api('GET', '/api/data');
    const snap = JSON.stringify([json.users, json.accounts, json.contacts, json.projects, json.mfrs]);
    if (snap !== lastSnapshot) {
      lastSnapshot = snap;
      state.data = json;
      state.today = json.today;
      render();
    }
  } catch (e) { /* transient network issue; next tick will retry */ }
}

setInterval(backgroundSync, 45000);
window.addEventListener('focus', backgroundSync);

// ---------- boot ----------

(async function boot() {
  try {
    await refresh();
    lastSnapshot = JSON.stringify([state.data.users, state.data.accounts, state.data.contacts, state.data.projects, state.data.mfrs]);
    render();
  } catch (e) {
    $('app').innerHTML = '<div class="boot">Could not reach the CRM server. Is it running? (' + esc(e.message) + ')</div>';
  }
})();
