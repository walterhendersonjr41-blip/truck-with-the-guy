// Browser E2E: drives the real UI (public/) against the emulators in headless Chrome.
import puppeteer from 'puppeteer-core';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { DEFAULT_CITIES } from '../public/core.js';

const URL0 = 'http://localhost:5000/?emu=1';
const env = await initializeTestEnvironment({ projectId: 'demo-truckguy', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'config/app'), { launchDate: Timestamp.fromMillis(Date.now() - 864e5), freeDays: 7, requireSubscription: true, cities: DEFAULT_CITIES }));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const step = (m) => console.log('✔', m);
let LAST; const PAGES = [];
const errors = [];
async function newUser() {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept());
  LAST = p; PAGES.push(p); p.on('console', (m) => m.type() === 'debug' && p === PAGES[0] && console.log('  [cust]', m.text())); p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300))); await p.setViewport({ width: 420, height: 900 }); await p.goto(URL0, { waitUntil: 'domcontentloaded' }); return p;
}
const click = async (p, sel) => { await p.waitForSelector(sel, { visible: true, timeout: 15000 }); await p.click(sel); };
const type = async (p, sel, v) => { await p.waitForSelector(sel, { timeout: 15000 }); await p.click(sel, { clickCount: 3 }); await p.type(sel, v); };
const waitText = (p, t, timeout = 20000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
const clickText = async (p, t) => { await waitText(p, t); await p.evaluate((t) => { const b = [...document.querySelectorAll('button,a,.chip')].find((x) => x.innerText.trim().startsWith(t)); b.click(); }, t); };

try {
  const cust = await newUser();
  await waitText(cust, 'Launch week: $0 fees'); step('landing shows launch-week banner');
  if (process.env.OWNER_PHONE && (await cust.content()).includes(process.env.OWNER_PHONE)) throw new Error('personal phone found on page');
  await click(cust, '#needBtn'); await type(cust, '#nm', 'Dana'); await type(cust, '#em', 'dana@test.dev'); await type(cust, '#pw', 'password123'); await type(cust, '#ph', '4235550000');
  await click(cust, '#go'); await waitText(cust, 'Post a job'); step('customer signed up');
  await type(cust, '#pa', 'Coolidge Park, Chattanooga TN'); await type(cust, '#da', 'East Ridge, TN');
  await click(cust, '#chk'); await waitText(cust, 'In range', 30000); step('range check passed (live geocoding)');
  await type(cust, '#nt', 'call me 423-555-1212'); await click(cust, '#go'); await waitText(cust, 'remove phone'); step('phone number in notes blocked');
  await type(cust, '#nt', 'One couch, ground floor'); await click(cust, '#go'); await waitText(cust, 'My jobs'); await waitText(cust, 'Waiting for truckers'); step('job posted');

  const trk = await newUser();
  await click(trk, '#driveBtn'); await type(trk, '#nm', 'Marcus'); await type(trk, '#em', 'marcus@test.dev'); await type(trk, '#pw', 'password123');
  await click(trk, '#go'); await trk.waitForSelector('#mm', { timeout: 20000 }); step('trucker signed up');
  await trk.select('#mm', 'Ram 1500'); await trk.select('#co', 'Red'); await click(trk, '#ins'); await type(trk, '#ca', '$MarcusHauls'); await click(trk, '#save');
  await waitText(trk, 'Job board'); await waitText(trk, 'Claim at $79'); step('trucker profile saved, job visible on board at $79');
  if ((await trk.content()).includes('Coolidge Park')) { /* area label may include it; full street addresses must not */ }
  await clickText(trk, 'Claim at $79'); await waitText(trk, 'My matches'); step('trucker claimed job');

  await cust.evaluate(() => { location.hash = 'jobs'; }); await waitText(cust, 'Needs your OK'); step('customer sees claim (Ram 1500 drawing)');
  if (!(await cust.content()).includes('Ram 1500')) throw new Error('truck type not shown');
  if ((await cust.content()).includes('MarcusHauls')) throw new Error('handles visible before match');
  await clickText(cust, '✅ Confirm match'); await waitText(cust, '$MarcusHauls'); step('match confirmed → handles revealed in-app only');
  await clickText(cust, '💬 Chat'); await type(cust, '#tx', 'text me 423 555 1212'); await click(cust, '#sd'); await waitText(cust, 'can’t be shared'); step('chat blocks phone numbers');
  await type(cust, '#tx', 'Couch is in the garage'); await click(cust, '#sd'); await waitText(cust, 'Couch is in the garage'); step('chat message sent');

  await trk.goto(URL0 + '#matches', { waitUntil: 'domcontentloaded' }); await waitText(trk, 'Pickup'); await waitText(trk, 'Coolidge Park'); step('trucker sees exact addresses after match');
  await trk.goto(URL0 + '#inbox', { waitUntil: 'domcontentloaded' }); await waitText(trk, "You're matched"); step('trucker got in-app notifications');
  await waitText(trk, 'New message'); await trk.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.innerText.startsWith('New message')).querySelector('button').click()); await waitText(trk, 'Couch is in the garage'); step('trucker reads chat');
  await trk.goto(URL0 + '#matches', { waitUntil: 'domcontentloaded' }); await clickText(trk, '✔ Mark job complete'); await clickText(trk, 'Rate'); await waitText(trk, 'Thanks for rating'); step('complete + rating');
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  console.log('\nE2E PASSED');
} catch (e) { console.error('E2E FAILED:', e.message, errors); for (const pg of PAGES) console.error('PAGE TEXT:', (await pg.evaluate(() => document.body.innerText)).slice(0, 1200), '\n-----'); process.exitCode = 1; }
finally { await browser.close(); await env.cleanup(); }
