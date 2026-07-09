'use strict';

// Demo dataset matching the approved design mock. Used to seed data/db.json on
// first run so the app is populated for the launch demo; Settings > "Clear
// demo data" wipes accounts/contacts/projects when you're ready for real data.

const A = (id, name, type, rep, cadence, lastContact, note) =>
  ({ id, name, type, rep, cadence, lastContact, note });

const accounts = [
  A(1, 'Meridian Homes', 'Builder', 3, 14, '2026-07-01', 'Dana prefers Tuesday morning calls. Check in on the Phase 4 install schedule.'),
  A(2, 'Castellan Construction', 'General Contractor', 4, 30, '2026-05-28', 'Tom is slow on email — call his cell. Bid season starts in August.'),
  A(3, 'Harper & Lane Interiors', 'Designer', 3, 30, '2026-06-24', 'Elise sends remodel specs by email; a monthly touch keeps projects flowing.'),
  A(4, 'Bluestone Property Group', 'Property Manager', 4, 60, '2026-06-10', 'Priya schedules unit turns quarterly — confirm Q3 volumes early.'),
  A(5, 'Vantage Commercial Builders', 'General Contractor', 4, 14, '2026-07-06', 'Greg wants frequent updates while Gateway floors 10–14 are in progress.'),
  A(6, 'Oakhurst Custom Homes', 'Builder', 3, 30, '2026-05-15', 'Sam builds 3–4 customs a year. Ask about fall starts.'),
  A(7, 'Studio Merle', 'Designer', 3, 90, '2026-04-20', 'Small-batch designer work; a quarterly hello keeps us top of mind.'),
  A(8, 'Redpoint Development', 'Builder', 4, 14, '2026-06-30', 'Lena expects an update every two weeks while Block B is active.'),
  A(9, 'Cormac Facilities', 'Property Manager', 3, 90, '2026-03-02', 'Facilities budget resets in October — reach out well before then.'),
  A(10, 'Atlas Retail Group', 'General Contractor', 4, 30, '2026-06-18', 'Aisha rotates tenant turns monthly; ask for the upcoming turn calendar.'),
];

const daysBack = (d, n) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);

const C = (id, acc, name, title, primary) => {
  const a = accounts.find(x => x.id === acc);
  return {
    id, acc, name, title, primary,
    rep: a.rep,
    cadence: a.cadence, // contact cadence lives with the person
    lastContact: primary ? a.lastContact : daysBack(a.lastContact, 30 + id * 5),
    email: name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.') + '@' +
      a.name.toLowerCase().replace(/[^a-z]/g, '') + '.com',
    phone: '(555) ' + String(200 + id * 7).padStart(3, '0') + '-' + String(1000 + id * 613).slice(-4),
  };
};

const contacts = [
  C(1, 1, 'Dana Whitfield', 'Purchasing Manager', true),
  C(2, 1, 'Marcus Bell', 'Site Superintendent', false),
  C(3, 2, 'Tom Castellan', 'Owner', true),
  C(4, 3, 'Elise Harper', 'Principal Designer', true),
  C(5, 3, 'Jordan Lane', 'Project Coordinator', false),
  C(6, 4, 'Priya Raman', 'Director of Facilities', true),
  C(7, 5, 'Greg Okafor', 'VP Construction', true),
  C(8, 6, 'Sam Oakhurst', 'Owner', true),
  C(9, 7, 'Merle Danvers', 'Founder', true),
  C(10, 8, 'Lena Ruiz', 'Development Manager', true),
  C(11, 9, 'Bill Cormac', 'Operations Lead', true),
  C(12, 10, 'Aisha Grant', 'Regional PM', true),
];

const mfrs = ['Shaw', 'Mohawk', 'Daltile', 'Interface', 'Mannington', 'COREtec'];

let pid = 0;
const P = (acc, con, name, addr, status, date, m) =>
  ({ id: ++pid, acc, con, name, addr, status, date, mfrs: m });

const projects = [
  P(1, 1, 'Willow Creek Phase 2 — 14 units', '400 Willow Creek Dr', 'Completed', '2025-09-12', ['Shaw', 'COREtec']),
  P(1, 1, 'Willow Creek Phase 3 — 11 units', '480 Willow Creek Dr', 'Completed', '2026-03-30', ['Shaw', 'Mohawk']),
  P(1, 2, 'Hollis Farm model homes', '12 Hollis Farm Rd', 'Completed', '2024-06-21', ['Mohawk']),
  P(1, 1, 'Willow Creek Phase 4', '520 Willow Creek Dr', 'In Progress', '', ['Shaw', 'COREtec']),
  P(2, 3, 'Lakeview Medical Offices', '2200 Lakeview Pkwy', 'Completed', '2025-11-05', ['Interface', 'Daltile']),
  P(2, 3, 'Brightside Dental buildout', '77 Main St, Suite 4', 'Completed', '2026-01-18', ['Interface']),
  P(2, 3, 'Ridgeline office lobby refresh', '900 Ridgeline Blvd', 'Completed', '2024-10-02', ['Daltile', 'Interface']),
  P(3, 4, 'Kensington penthouse', '1 Kensington Pl, PH-2', 'Completed', '2026-02-14', ['Mannington', 'Daltile']),
  P(3, 4, 'Marsh residence — full remodel', '38 Saltmarsh Ln', 'Completed', '2025-05-27', ['Shaw', 'Daltile']),
  P(3, 5, 'Beacon Hill brownstone', '19 Beacon Hill Ct', 'In Progress', '', ['Mannington']),
  P(4, 6, 'Bluestone Lofts — corridor carpet', '600 Bluestone Ave', 'Completed', '2025-08-09', ['Mohawk', 'Interface']),
  P(4, 6, 'Bluestone Lofts — unit turns Q1', '600 Bluestone Ave', 'Completed', '2026-04-03', ['COREtec']),
  P(4, 6, 'Parkside Apartments repaint & floor', '210 Parkside Way', 'Completed', '2024-03-15', ['Mohawk', 'COREtec']),
  P(5, 7, 'Gateway Tower floors 4–9', '1 Gateway Plaza', 'Completed', '2025-12-19', ['Interface', 'Shaw']),
  P(5, 7, 'Gateway Tower floors 10–14', '1 Gateway Plaza', 'In Progress', '', ['Interface']),
  P(5, 7, 'Northgate call center', '4500 Northgate Dr', 'Completed', '2024-08-28', ['Interface', 'Mohawk']),
  P(6, 8, 'Fairbanks custom build', '7 Fairbanks Holw', 'Completed', '2026-05-22', ['Shaw', 'Mannington']),
  P(6, 8, 'Tanager Lane spec home', '15 Tanager Ln', 'Completed', '2025-04-11', ['COREtec', 'Daltile']),
  P(7, 9, 'Gallery Row loft', '5 Gallery Row #300', 'Completed', '2025-10-16', ['Mannington']),
  P(7, 9, 'Cliffside guest house', '2 Cliffside Ter', 'Completed', '2024-12-05', ['Daltile']),
  P(8, 10, 'Redpoint Rowhomes — Block A', '100–128 Fenwick St', 'Completed', '2025-07-31', ['Mohawk', 'COREtec']),
  P(8, 10, 'Redpoint Rowhomes — Block B', '130–158 Fenwick St', 'In Progress', '', ['Mohawk', 'COREtec']),
  P(8, 10, 'Sales center fit-out', '99 Fenwick St', 'Completed', '2024-11-20', ['Shaw']),
  P(9, 11, 'Cormac HQ break rooms', '800 Industrial Ave', 'Completed', '2025-02-06', ['Daltile']),
  P(9, 11, 'Warehouse office mezzanine', '812 Industrial Ave', 'Archive', '2023-09-14', ['Mohawk']),
  P(10, 12, 'Atlas Plaza food court', '2000 Atlas Plaza', 'Completed', '2026-06-10', ['Daltile', 'Interface']),
  P(10, 12, 'Storefront turns — 6 tenants', '2000 Atlas Plaza', 'Completed', '2025-03-22', ['Daltile', 'COREtec']),
  P(10, 12, 'Atlas North parking office', '2100 Atlas Plaza', 'Archive', '2023-11-30', ['Shaw']),
];

const users = [
  { id: 1, name: 'Ray Sutton', role: 'Owner', email: 'ray@cfsflooring.com' },
  { id: 2, name: 'Monica Vega', role: 'Manager', email: 'monica@cfsflooring.com' },
  { id: 3, name: 'Deshawn Reed', role: 'Sales', email: 'deshawn@cfsflooring.com' },
  { id: 4, name: 'Carla Jenkins', role: 'Sales', email: 'carla@cfsflooring.com' },
];

module.exports = { demoData: { users, accounts, contacts, projects, mfrs } };
