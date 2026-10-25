import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import * as fb from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, USE_EMULATORS } from './config.js';
import { makeApi, priceFor, milesBetween, freeDaysLeft, canClaim, hasContact, NAME_RE, JOB_TYPES, BLOCK_LABEL, TRUCKS, BEDS, COLORS, DEFAULT_CITIES } from './core.js';

const $ = (s) => document.querySelector(s);
const root = $('#root'), nav = $('#nav');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); };
const fail = (e) => { (e?.code ? console.error : console.warn)(e); toast(e?.code === 'permission-denied' ? 'Not allowed. (Phone numbers/emails are blocked, and some actions need a confirmed match.)' : (e.message || String(e))); };

if (!USE_EMULATORS && firebaseConfig.apiKey.startsWith('PASTE')) {
  root.innerHTML = `<h1>🛻 Truck With The Guy</h1><div class="card"><b>Setup needed</b><p class="muted">This app isn't connected to a Firebase project yet. Paste the web config into <code>public/config.js</code> and run <code>firebase deploy</code> (see DEPLOY.md).</p></div>`;
  throw new Error('not configured');
}
const app = initializeApp(USE_EMULATORS ? { apiKey: 'demo', projectId: 'demo-truckguy', authDomain: 'localhost' } : firebaseConfig);
const auth = getAuth(app); const db = fb.getFirestore(app);
if (USE_EMULATORS) { connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true }); fb.connectFirestoreEmulator(db, location.hostname, 8080); localStorage.setItem('emu', '1'); }
const api = makeApi(fb, db);
if ('serviceWorker' in navigator && !USE_EMULATORS) navigator.serviceWorker.register('/sw.js');

let S = { user: null, me: null, cfg: null, tab: null, unsub: [] };
const cities = () => S.cfg?.cities || DEFAULT_CITIES;
const activeCities = () => Object.entries(cities()).filter(([, c]) => c.active).map(([k]) => k);
const clearSubs = () => { clearTimeout(S.rt); S.unsub.forEach((u) => u()); S.unsub = []; };

// ---------- truck illustration (platform stock drawing; no driver photos) ----------
const CL = { White: '#e8e8e8', Black: '#2b2b2b', Silver: '#a8adb3', Red: '#c0392b', Blue: '#2f5fa8', Gray: '#6b6f75' };
function truckSvg(t) {
  const bed = { '5.5 ft': 70, '6.5 ft': 90, '8 ft': 115 }[t.bed] || 90, c = CL[t.color] || '#e8e8e8', w = 150 + bed;
  return `<svg viewBox="0 0 ${w + 20} 110" width="100%" height="110" role="img" aria-label="${esc(t.makeModel)}"><rect x="10" y="45" width="${bed}" height="30" fill="${c}" stroke="#000"/><path d="M${10 + bed} 75 V40 L${40 + bed} 15 H${95 + bed} L${110 + bed} 45 H${w} V75 Z" fill="${c}" stroke="#000"/><path d="M${48 + bed} 22 H${90 + bed} L${100 + bed} 42 H${48 + bed} Z" fill="#9fd3ff"/><circle cx="35" cy="80" r="16" fill="#111" stroke="#888" stroke-width="4"/><circle cx="${w - 25}" cy="80" r="16" fill="#111" stroke="#888" stroke-width="4"/><text x="${(w + 20) / 2}" y="105" fill="#ff7a00" font-size="11" text-anchor="middle">${esc(t.makeModel)} · ${esc(t.bed)} bed</text></svg>`;
}
const stars = (r) => (r ? `⭐ ${r.avg} (${r.n})` : 'New');

function banner() {
  const d = freeDaysLeft(S.cfg);
  if (d > 0) return `<div class="banner">🎉 <b>Launch week: $0 fees, ${d} day${d > 1 ? 's' : ''} left</b><br><small>Truckers claim jobs free and keep 100%. Customers never pay the app.</small></div>`;
  return S.cfg?.requireSubscription ? `<div class="banner" style="background:#333"><small>Truckers: a weekly plan is required to claim jobs. Customers still pay the app nothing.</small></div>` : '';
}

// ---------- signed-out ----------
function landing() {
  nav.hidden = true;
  root.innerHTML = `${banner()}<h1>🛻 Truck With The Guy</h1>
  <p>Full-size pickup + a guy to lift it. Store pickups, Marketplace finds, small moves, junk runs. <b>You pay the driver directly.</b> The app never handles job money or shares your phone or email.</p>
  <button class="btn" id="needBtn">🙋 I need a truck + guy</button>
  <button class="btn g" id="driveBtn">🚚 I have a full-size truck — drive</button>
  <div class="card"><h2>Sign in</h2><input id="em" type="email" placeholder="Email" autocomplete="email"><input id="pw" type="password" placeholder="Password" autocomplete="current-password">
  <button class="btn g" id="inBtn">Sign in</button><a href="#" id="forgot"><small>Forgot password?</small></a></div>
  <p class="muted" style="text-align:center"><small>Proprietary product design · Connection-only marketplace</small></p>`;
  $('#needBtn').onclick = () => signup('customer'); $('#driveBtn').onclick = () => signup('trucker');
  $('#inBtn').onclick = () => signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value).catch(fail);
  $('#forgot').onclick = (e) => { e.preventDefault(); const m = $('#em').value.trim(); if (!m) return toast('Enter your email first'); sendPasswordResetEmail(auth, m).then(() => toast('Reset email sent')).catch(fail); };
}
function signup(role) {
  root.innerHTML = `<h1>${role === 'trucker' ? '🚚 Trucker sign-up' : '🙋 Customer sign-up'}</h1>
  <div class="card"><label>First name (shown to others)<input id="nm" maxlength="40" placeholder="e.g. Marcus"></label>
  <label>City<select id="ct">${activeCities().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
  <label>Email (private, for sign-in and notifications)<input id="em" type="email" autocomplete="email"></label>
  <label>Password<input id="pw" type="password" minlength="8" autocomplete="new-password"></label>
  <label>Mobile (optional, private, for future text alerts)<input id="ph" type="tel" autocomplete="tel"></label>
  <label><input type="checkbox" id="ne" checked>Email me when something happens (no contact info is ever shared)</label>
  <button class="btn" id="go">Create account</button><button class="btn g" id="back">Back</button></div>
  <p class="muted"><small>🔒 Your phone and email are never shown to anyone. You talk through in-app chat. Payment handles appear only after both sides confirm a match.</small></p>`;
  $('#back').onclick = landing;
  $('#go').onclick = async () => {
    const name = $('#nm').value.trim();
    if (!NAME_RE.test(name)) return toast('First name: letters only (no numbers or emails).');
    S.signingUp = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value);
      await api.createProfile(cred.user.uid, { role, name, city: $('#ct').value, email: cred.user.email, phone: $('#ph').value.trim(), notifyEmail: $('#ne').checked });
      sendEmailVerification(cred.user).catch(() => {});
      S.user = cred.user; await loadMe(); S.signingUp = false; route(role === 'trucker' ? 'profile' : 'post');
    } catch (e) { S.signingUp = false; fail(e); }
  };
}

// ---------- shell ----------
async function loadMe() {
  const s = await fb.getDoc(fb.doc(db, 'users', S.user.uid)); S.me = s.exists() ? { id: s.id, ...s.data() } : null;
  S.admin = (await fb.getDoc(fb.doc(db, 'admins', S.user.uid)).catch(() => null))?.exists() || false;
}
function drawNav() {
  const tabs = S.me.role === 'trucker'
    ? [['board', '📋 Jobs'], ['matches', '🤝 Matches'], ['profile', '🛻 My truck'], ['inbox', '🔔 Inbox']]
    : [['post', '➕ Post job'], ['jobs', '📦 My jobs'], ['truckers', '🚚 Truckers'], ['inbox', '🔔 Inbox']];
  if (S.admin) tabs.push(['admin', '⚙️ Admin']);
  nav.hidden = false;
  nav.innerHTML = tabs.map(([k, l]) => `<a href="#${k}" class="${S.tab === k ? 'on' : ''}" data-t="${k}">${l}${k === 'inbox' ? '<span id="nb"></span>' : ''}</a>`).join('');
}
function route(t) { if (t && location.hash !== '#' + t) { location.hash = t; return; } render(); }
let rendering = null;
window.addEventListener('hashchange', () => render());
function head(title) {
  return `${banner()}<div class="row" style="align-items:center"><h1 style="flex:3">${title}</h1><button class="btn g" style="flex:1;margin:0;padding:8px" id="out">Sign out</button></div>`;
}
let busy = null, again = false;
async function render() { // serialized: the latest hash always wins, no half-finished view overwrites another
  if (busy) { again = true; return; }
  busy = renderNow(); await busy; busy = null;
  if (again) { again = false; if (!(S.painted.startsWith('chat:') && location.hash.slice(1) === S.painted)) render(); }
}
async function renderNow() {
  if (!S.user || !S.me) return;
  if (USE_EMULATORS) console.debug('render', location.hash);
  clearSubs(); S.tab = location.hash.slice(1) || (S.me.role === 'trucker' ? 'board' : 'post'); S.painted = S.tab; drawNav();
  const views = { post: vPost, jobs: vJobs, truckers: vTruckers, board: vBoard, matches: vMatches, profile: vProfile, inbox: vInbox, admin: vAdmin };
  const v = S.tab.startsWith('chat:') ? () => vChat(S.tab.slice(5)) : views[S.tab] || views[S.me.role === 'trucker' ? 'board' : 'post'];
  try { await v(); } catch (e) { fail(e); }
  const o = $('#out'); if (o) o.onclick = () => signOut(auth);
  if (['jobs', 'matches', 'board'].includes(S.tab)) { // live updates: re-render when my matches / open jobs change
    let first = true; const again = () => { if (first) { first = false; return; } clearTimeout(S.rt); S.rt = setTimeout(render, 300); };
    const q = S.tab === 'board' ? fb.query(fb.collection(db, 'jobs'), fb.where('city', '==', S.me.city), fb.where('status', '==', 'open'))
      : fb.query(fb.collection(db, 'matches'), fb.where(S.me.role === 'trucker' ? 'truckerId' : 'customerId', '==', S.user.uid));
    S.unsub.push(fb.onSnapshot(q, again, () => {}));
  }
  S.unsub.push(fb.onSnapshot(fb.query(fb.collection(db, `notifications/${S.user.uid}/items`), fb.where('read', '==', false)), (q) => { const b = $('#nb'); if (b) b.innerHTML = q.size ? `<span class="badge">${q.size}</span>` : ''; }));
}

// ---------- customer: post job ----------
// Free, keyless geocoding: Photon (OpenStreetMap data, CORS-enabled). Swap for Google/Mapbox later via this one function.
async function geocode(q, city) {
  const c = cities()[city];
  if (!q || q.trim().length < 3) throw new Error('Enter an address.');
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${c.lat}&lon=${c.lng}&limit=1&lang=en`);
  if (!r.ok) throw new Error('Address lookup is busy. Try again in a moment.');
  const f = (await r.json()).features?.[0];
  if (!f) throw new Error(`Couldn't find "${q}". Try adding the city and state.`);
  const pr = f.properties || {}; const [lng, lat] = f.geometry.coordinates;
  const area = pr.district || pr.locality || pr.city || pr.county || 'Nearby';
  return { mi: milesBetween(c, { lat, lng }), area: String(area).replace(/[0-9@]/g, '').slice(0, 40) };
}
async function vPost() {
  const ac = activeCities(); let jt = 'store', tb = '1h', checked = null;
  root.innerHTML = `${head('Post a job')}<div class="card">
  <label>City<select id="ct">${ac.map((c) => `<option ${c === S.me.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
  <b>Job</b><div class="chips" id="jt">${Object.entries(JOB_TYPES).map(([k, l]) => `<div class="chip ${k === jt ? 'on' : ''}" data-k="${k}">${l}</div>`).join('')}</div>
  <label>Pickup address (private until matched)<input id="pa" placeholder="e.g. Lowe's, Fort Oglethorpe GA"></label>
  <label>Drop-off address (private until matched)<input id="da" placeholder="Street, city"></label>
  <button class="btn g" id="chk">Check service range</button><div id="rng"></div>
  <label>When<input id="wh" type="datetime-local"></label>
  <b>Time block</b><div class="chips" id="tb"></div>
  <label><input type="checkbox" id="hp">2nd helper (+$30/hr)</label>
  <label>Notes for truckers (no phone/email)<textarea id="nt" maxlength="300" placeholder="What's being moved? Stairs?"></textarea></label>
  <div class="card" style="background:#1b1b1f">Suggested price <span class="price" id="pr"></span><br><small>You pay the trucker directly (cash, Cash App, Zelle…). Truckers may claim at this price or send an offer.</small></div>
  <small class="muted">Max 250 lb per item with one helper. No hazmat, people or animals in the bed.</small>
  <button class="btn" id="go" disabled>Post job</button></div>`;
  const ct = $('#ct');
  const upd = () => { const c = ct.value; $('#tb').innerHTML = Object.keys(BLOCK_LABEL).map((k) => `<div class="chip ${k === tb ? 'on' : ''}" data-k="${k}">${BLOCK_LABEL[k]} · $${priceFor(c, cities(), k, false, 'store')}</div>`).join('');
    $('#pr').textContent = '$' + priceFor(c, cities(), tb, $('#hp').checked, jt); };
  $('#jt').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; jt = k; [...$('#jt').children].forEach((x) => x.classList.toggle('on', x.dataset.k === k)); upd(); };
  $('#tb').onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return; tb = k; upd(); };
  $('#hp').onchange = upd; ct.onchange = () => { checked = null; $('#go').disabled = true; $('#rng').innerHTML = ''; upd(); }; upd();
  const invalidate = () => { checked = null; $('#go').disabled = true; }; $('#pa').oninput = invalidate; $('#da').oninput = invalidate;
  $('#chk').onclick = async () => {
    $('#rng').innerHTML = '<small>Checking…</small>';
    try {
      const [p, d] = [await geocode($('#pa').value, ct.value), await geocode($('#da').value, ct.value)];
      const R = cities()[ct.value].radiusMi;
      if (p.mi > R || d.mi > R) { $('#rng').innerHTML = `<p class="no">⛔ Outside the ${R}-mile range of ${esc(ct.value)} (pickup ${p.mi} mi, drop-off ${d.mi} mi). Not available yet.</p>`; return; }
      checked = { p, d }; $('#rng').innerHTML = `<p class="ok">✅ In range: ${esc(p.area)} (${p.mi} mi) → ${esc(d.area)} (${d.mi} mi)</p>`; $('#go').disabled = false;
    } catch (e) { $('#rng').innerHTML = `<p class="no">${esc(e.message)}</p>`; }
  };
  $('#go').onclick = async () => {
    if (!checked) return toast('Check the service range first');
    if (hasContact($('#nt').value)) return toast('Please remove phone numbers/emails from notes.');
    $('#go').disabled = true;
    try {
      await api.postJob(S.user.uid, cities(), { city: ct.value, jobType: jt, timeBlock: tb, helper: $('#hp').checked, pickupArea: checked.p.area, dropoffArea: checked.d.area,
        pickupMi: checked.p.mi, dropoffMi: checked.d.mi, when: $('#wh').value ? new Date($('#wh').value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'ASAP',
        notes: $('#nt').value.trim(), pickupAddress: $('#pa').value.trim(), dropoffAddress: $('#da').value.trim() });
      toast('Job posted! Truckers nearby can see it.'); route('jobs');
    } catch (e) { $('#go').disabled = false; fail(e); }
  };
}

// ---------- match card (shared) ----------
async function matchCard(m, job) {
  const iAmT = S.me.role === 'trucker'; const otherId = iAmT ? m.customerId : m.truckerId;
  const other = (await fb.getDoc(fb.doc(db, 'users', otherId))).data() || {};
  const truck = (await fb.getDoc(fb.doc(db, 'truckers', m.truckerId))).data();
  const r = await api.ratingOf(otherId);
  const myOk = iAmT ? m.truckerOk : m.customerOk;
  let h = `<div class="card"><b>${esc(other.name || 'User')}</b> · ${stars(r)} ${truck && !iAmT ? (truck.insured ? '· ✅ Insured' : '· ⚠️ No insurance on file') : ''}<br>
  <small>${job ? esc(JOB_TYPES[job.jobType]) + ' · ' + esc(BLOCK_LABEL[job.timeBlock]) + ' · ' + esc(job.pickupArea) + ' → ' + esc(job.dropoffArea) + ' · ' + esc(job.when) : ''}</small><br>
  ${!iAmT && truck ? truckSvg(truck) + `<small>${esc(truck.color)} ${esc(truck.makeModel)} · ${esc(truck.bed)} bed. Check that this is the truck that shows up.</small><br>` : ''}
  ${m.kind === 'counter' ? 'Offer' : 'Price'}: <span class="price">$${m.price}</span> <small>${m.kind === 'invite' ? '(customer invite)' : m.kind === 'counter' ? '(trucker offer)' : '(claimed at suggested price)'}</small><br>
  Status: <b>${m.status === 'pending' ? (myOk ? 'Waiting for the other side' : 'Needs your OK') : m.status}</b>`;
  if (m.status === 'pending') h += `${!myOk ? `<button class="btn" data-a="accept" data-id="${m.id}">✅ Confirm match</button>` : ''}<button class="btn g" data-a="decline" data-id="${m.id}">Decline</button>`;
  if (m.status === 'pending' || m.status === 'confirmed') h += `<button class="btn g" data-a="chat" data-id="${m.id}">💬 Chat</button>`;
  if (m.status === 'confirmed') {
    if (!iAmT) {
      const hd = await api.getHandles(m.truckerId).catch(() => null);
      h += `<div class="card" style="background:#1d2b3a"><b>💵 Pay your driver directly</b><br><small>The app never takes or holds your money. Only use these, and only after the driver is assigned.</small>
      ${hd ? ['cashapp:Cash App', 'zelle:Zelle', 'venmo:Venmo', 'payLink:Pay link'].map((x) => { const [k, l] = x.split(':'); return hd[k] ? `<div class="kv"><span>${l}</span><b>${esc(hd[k])}</b></div>` : ''; }).join('') + (hd.cash ? '<div class="kv"><span>Cash</span><b>OK</b></div>' : '')
        + (hd.askDeposit ? `<small>• Driver asks for a deposit (about $${Math.round(m.price * 0.25)}) before the job.</small><br>` : '') + (hd.askFirst40 ? '<small>• Then the first-40-minutes share once on-site.</small><br>' : '') + '<small>• The rest is due at completion.</small>'
        : '<small>Driver has not added payment handles yet. Ask in chat.</small>'}</div>`;
    } else {
      const ad = await api.jobAddress(m.jobId).catch(() => null);
      if (ad) h += `<div class="card" style="background:#1d2b3a"><b>📍 Addresses</b><div class="kv"><span>Pickup</span><b>${esc(ad.pickupAddress)}</b></div><div class="kv"><span>Drop-off</span><b>${esc(ad.dropoffAddress)}</b></div>
      <a class="btn g" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(ad.pickupAddress)}&destination=${encodeURIComponent(ad.dropoffAddress)}">Open directions</a></div>`;
    }
    h += `<button class="btn g" data-a="complete" data-id="${m.id}">✔ Mark job complete</button>`;
  }
  if (m.status === 'confirmed' || m.status === 'completed') {
    const rated = (await fb.getDoc(fb.doc(db, 'ratings', `${m.id}_${S.user.uid}`)).catch(() => null))?.exists();
    h += rated ? '<p class="ok">Thanks for rating!</p>' : `<div class="row"><select id="st_${m.id}">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'⭐'.repeat(n)}</option>`).join('')}</select><button class="btn g" style="margin:5px 0" data-a="rate" data-id="${m.id}">Rate</button></div>`;
  }
  return h + '</div>';
}
function bindMatchActions(list) {
  root.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; const m = list.find((x) => x.id === b.dataset.id); if (!m) return;
    const a = b.dataset.a; b.disabled = true;
    try {
      if (a === 'accept') { const done = await api.accept(S.user.uid, m); toast(done ? "Matched! Payment handles and addresses are now unlocked in the app." : 'Confirmed. Waiting for the other side.'); }
      if (a === 'decline') await api.decline(S.user.uid, m);
      if (a === 'chat') return route('chat:' + m.id);
      if (a === 'complete') await api.complete(S.user.uid, m);
      if (a === 'rate') { await api.rate(S.user.uid, m, +$('#st_' + m.id).value, ''); toast('Rated'); }
      render();
    } catch (er) { b.disabled = false; fail(er); }
  };
}

// ---------- customer: my jobs ----------
async function vJobs() {
  const [jobs, ms] = [await api.myJobs(S.user.uid), await api.myMatches(S.user.uid, 'customer')];
  // trucker accepted my invite → mark job matched (only customers may update their job)
  for (const m of ms) { const j = jobs.find((x) => x.id === m.jobId); if (m.status === 'confirmed' && j?.status === 'open') { await api.markJobMatched(m).catch(() => {}); j.status = 'matched'; } }
  jobs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  let h = head('My jobs');
  if (!jobs.length) h += '<div class="card">No jobs yet. <a href="#post">Post one</a>.</div>';
  for (const j of jobs) {
    h += `<div class="card"><b>${esc(JOB_TYPES[j.jobType])}</b> · ${esc(BLOCK_LABEL[j.timeBlock])} · $${j.suggestedPrice}<br><small>${esc(j.city)} · ${esc(j.pickupArea)} → ${esc(j.dropoffArea)} · ${esc(j.when)} · <b>${j.status}</b></small>`;
    const mine = ms.filter((m) => m.jobId === j.id && m.status !== 'declined');
    if (!mine.length && j.status === 'open') h += '<p class="muted"><small>Waiting for truckers… You can also invite one from the Truckers tab.</small></p>';
    for (const m of mine) h += await matchCard(m, j);
    if (j.status === 'open') h += `<button class="btn r" data-cancel="${j.id}">Cancel job</button>`;
    h += '</div>';
  }
  root.innerHTML = h; bindMatchActions(ms);
  const matchClick = root.onclick;
  root.onclick = async (e) => { const id = e.target.dataset?.cancel; if (!id) return matchClick(e); if (!confirm('Cancel this job?')) return; try { await fb.updateDoc(fb.doc(db, 'jobs', id), { status: 'canceled' }); render(); } catch (er) { fail(er); } };
}

// ---------- customer: browse truckers ----------
async function vTruckers() {
  const city = S.me.city; const ts = await api.truckersIn(city);
  const open = (await api.myJobs(S.user.uid)).filter((j) => j.status === 'open');
  let h = head('Truckers near you') + `<p class="muted"><small>${esc(city)} · first names and truck types only. Contact stays private. Use chat after you match.</small></p>`;
  if (!ts.length) h += '<div class="card">No truckers have signed up in your city yet. Post a job and we\'ll notify truckers as they join.</div>';
  for (const t of ts) {
    const r = await api.ratingOf(t.id);
    h += `<div class="card"><b>${esc(t.name)}</b> · ${stars(r)} · ${t.insured ? '✅ Insured' : '⚠️ No insurance on file'}${truckSvg(t)}
    ${open.length ? `<div class="row"><select id="ij_${t.id}">${open.map((j) => `<option value="${j.id}">${esc(JOB_TYPES[j.jobType])} · ${esc(j.when)} · $${j.suggestedPrice}</option>`).join('')}</select><button class="btn" style="margin:5px 0" data-inv="${t.id}">Invite</button></div>` : '<small class="muted">Post a job to invite this trucker.</small>'}</div>`;
  }
  root.innerHTML = h;
  root.onclick = async (e) => { const tid = e.target.dataset?.inv; if (!tid) return; const j = open.find((x) => x.id === $('#ij_' + tid).value);
    try { await api.invite(S.user.uid, j, tid); toast('Invite sent. You\'ll be notified when they confirm.'); route('jobs'); } catch (er) { fail(er); } };
}

// ---------- trucker: job board ----------
async function vBoard() {
  const truck = (await fb.getDoc(fb.doc(db, 'truckers', S.user.uid))).data();
  let h = head('Job board');
  if (!truck) { root.innerHTML = h + '<div class="card">Add your truck first to see and claim jobs. <a href="#profile">Set up my truck</a></div>'; return; }
  const ok = canClaim(S.cfg, S.me);
  if (!ok) h += `<div class="card"><b>🔒 Weekly plan required to claim jobs</b><br><small>Launch week is over. Plans aren't open in the app yet. Contact the admin through the Help page.</small></div>`;
  const jobs = (await api.openJobs(S.me.city)).filter((j) => j.customerId !== S.user.uid).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const mine = new Set((await api.myMatches(S.user.uid, 'trucker')).map((m) => m.jobId));
  h += `<p class="muted"><small>${esc(S.me.city)} · ${jobs.length} open job${jobs.length === 1 ? '' : 's'} · You keep 100%, customers pay you directly</small></p>`;
  for (const j of jobs) {
    h += `<div class="card"><b>${esc(JOB_TYPES[j.jobType])}</b> · ${esc(BLOCK_LABEL[j.timeBlock])}${j.helper ? ' · +helper' : ''}<br><small>${esc(j.pickupArea)} (${j.pickupMi} mi) → ${esc(j.dropoffArea)} (${j.dropoffMi} mi) · ${esc(j.when)}</small>
    ${j.notes ? `<br><small>“${esc(j.notes)}”</small>` : ''}<br>Suggested <span class="price">$${j.suggestedPrice}</span>
    ${mine.has(j.id) ? '<p class="ok">You already responded. See Matches.</p>' : ok ? `<button class="btn" data-claim="${j.id}">Claim at $${j.suggestedPrice}</button><div class="row"><input type="number" id="co_${j.id}" placeholder="Your price" min="20" max="5000"><button class="btn g" style="margin:5px 0" data-counter="${j.id}">Send offer</button></div>` : ''}</div>`;
  }
  if (!jobs.length) h += '<div class="card">No open jobs right now. You\'ll get a notification when one is posted.</div>';
  root.innerHTML = h;
  root.onclick = async (e) => {
    const id = e.target.dataset?.claim || e.target.dataset?.counter; if (!id) return; const j = jobs.find((x) => x.id === id);
    let price = j.suggestedPrice; if (e.target.dataset.counter) { price = parseInt($('#co_' + id).value, 10); if (!(price >= 20 && price <= 5000)) return toast('Enter a price between $20 and $5000'); }
    e.target.disabled = true;
    try { await api.claim(S.user.uid, j, price); toast(price === j.suggestedPrice ? 'Claimed! The customer has been notified to confirm.' : 'Offer sent!'); route('matches'); } catch (er) { e.target.disabled = false; fail(er); }
  };
}
async function vMatches() {
  const ms = (await api.myMatches(S.user.uid, 'trucker')).filter((m) => m.status !== 'declined').sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  let h = head('My matches');
  if (!ms.length) h += '<div class="card">No matches yet. Claim a job from the board, or wait for a customer invite.</div>';
  for (const m of ms) { const j = (await fb.getDoc(fb.doc(db, 'jobs', m.jobId))).data(); h += await matchCard(m, j); }
  root.innerHTML = h; bindMatchActions(ms);
}
async function vProfile() {
  const t = (await fb.getDoc(fb.doc(db, 'truckers', S.user.uid))).data() || { makeModel: TRUCKS[0], bed: '6.5 ft', color: 'White', insured: false, active: true };
  const hd = (await api.getHandles(S.user.uid).catch(() => null)) || { cashapp: '', zelle: '', venmo: '', payLink: '', cash: true, askDeposit: true, askFirst40: true };
  const sel = (id, arr, v) => `<select id="${id}">${arr.map((x) => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  root.innerHTML = `${head('My truck')}<div class="card"><div id="svg">${truckSvg(t)}</div><small>Customers see this standard drawing of your truck type, not a photo.</small>
  <label>Make / model${sel('mm', TRUCKS, t.makeModel)}</label><label>Bed length${sel('bd', BEDS, t.bed)}</label><label>Color${sel('co', COLORS, t.color)}</label>
  <label><input type="checkbox" id="ins" ${t.insured ? 'checked' : ''}>I carry commercial/business-use auto + cargo insurance</label>
  <label><input type="checkbox" id="act" ${t.active ? 'checked' : ''}>Show me in the trucker list (available)</label></div>
  <div class="card"><b>How customers pay you</b><br><small>Shown in-app only to a customer after you both confirm a match.</small>
  <input id="ca" placeholder="Cash App ($cashtag)" value="${esc(hd.cashapp)}"><input id="ze" placeholder="Zelle (name or tag)" value="${esc(hd.zelle)}"><input id="ve" placeholder="Venmo (@handle)" value="${esc(hd.venmo)}"><input id="pl" placeholder="Square/Stripe pay link" value="${esc(hd.payLink)}">
  <label><input type="checkbox" id="cs" ${hd.cash ? 'checked' : ''}>Cash OK</label><label><input type="checkbox" id="dp" ${hd.askDeposit ? 'checked' : ''}>Ask for a deposit (~25%) when confirmed</label><label><input type="checkbox" id="f40" ${hd.askFirst40 ? 'checked' : ''}>Ask for the first-40-minutes share on-site</label></div>
  <button class="btn" id="save">Save</button>`;
  const cur = () => ({ name: S.me.name, city: S.me.city, makeModel: $('#mm').value, bed: $('#bd').value, color: $('#co').value, insured: $('#ins').checked, active: $('#act').checked });
  ['mm', 'bd', 'co'].forEach((i) => ($('#' + i).onchange = () => ($('#svg').innerHTML = truckSvg(cur()))));
  $('#save').onclick = async () => {
    try { await api.saveTruck(S.user.uid, cur());
      await api.saveHandles(S.user.uid, { cashapp: $('#ca').value.trim(), zelle: $('#ze').value.trim(), venmo: $('#ve').value.trim(), payLink: $('#pl').value.trim(), cash: $('#cs').checked, askDeposit: $('#dp').checked, askFirst40: $('#f40').checked });
      toast('Saved'); route('board'); } catch (e) { fail(e); }
  };
}

// ---------- chat ----------
async function vChat(mid) {
  const m = { id: mid, ...(await fb.getDoc(fb.doc(db, 'matches', mid))).data() };
  const other = (await fb.getDoc(fb.doc(db, 'users', S.user.uid === m.truckerId ? m.customerId : m.truckerId))).data() || {};
  root.innerHTML = `${head('Chat with ' + esc(other.name || ''))}<small class="muted">🔒 Phone numbers and emails are blocked to protect everyone. Keep it in the app.</small>
  <div id="msgs" class="card" style="min-height:240px"></div><div class="row"><input id="tx" maxlength="1000" placeholder="Message"><button class="btn" style="margin:5px 0;flex:0 0 90px" id="sd">Send</button></div>
  <button class="btn g" id="bk">Back</button>`;
  $('#bk').onclick = () => history.back();
  S.unsub.push(fb.onSnapshot(fb.query(fb.collection(db, `matches/${mid}/messages`), fb.orderBy('createdAt')), (q) => {
    $('#msgs').innerHTML = q.docs.map((d) => { const x = d.data(); return `<div class="msg ${x.senderId === S.user.uid ? 'me' : 'them'}">${esc(x.text)}</div>`; }).join('') || '<small class="muted">Say hi 👋</small>';
    $('#msgs').scrollTop = 1e9;
  }, fail));
  const send = async () => { const t = $('#tx').value.trim(); if (!t) return; try { await api.send(S.user.uid, m, t); $('#tx').value = ''; } catch (e) { fail(e); } };
  $('#sd').onclick = send; $('#tx').onkeydown = (e) => { if (e.key === 'Enter') send(); };
}

// ---------- inbox ----------
async function vInbox() {
  const q = await fb.getDocs(fb.collection(db, `notifications/${S.user.uid}/items`));
  const items = q.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  root.innerHTML = head('Inbox') + (items.map((n) => `<div class="card" style="${n.read ? 'opacity:.6' : ''}">${esc(n.text)}<br><small>${n.createdAt ? n.createdAt.toDate().toLocaleString() : ''}</small>
    <button class="btn g" data-go="${n.type === 'message' ? 'chat:' + n.matchId : n.type === 'new_job' ? 'board' : S.me.role === 'trucker' ? 'matches' : 'jobs'}">Open</button></div>`).join('') || '<div class="card">No notifications yet.</div>');
  for (const n of items.filter((x) => !x.read)) fb.updateDoc(fb.doc(db, `notifications/${S.user.uid}/items/${n.id}`), { read: true }).catch(() => {});
  root.onclick = (e) => { const g = e.target.dataset?.go; if (g) route(g); };
}

// ---------- admin ----------
async function vAdmin() {
  if (!S.admin) { root.innerHTML = head('Admin') + '<div class="card">Not an admin.</div>'; return; }
  const c = S.cfg || { launchDate: fb.Timestamp.now(), freeDays: 7, requireSubscription: true, cities: DEFAULT_CITIES };
  const ld = c.launchDate.toDate(); const iso = new Date(ld.getTime() - ld.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const users = (await fb.getDocs(fb.collection(db, 'users'))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const jobs = (await fb.getDocs(fb.collection(db, 'jobs'))).docs.map((d) => d.data());
  root.innerHTML = `${head('Admin')}<div class="card"><b>Launch & plan</b>${S.cfg ? '' : '<p class="no">No config yet. Save to create it.</p>'}
  <label>Launch date<input type="date" id="ld" value="${iso}"></label><label>Free days<input type="number" id="fd" value="${c.freeDays}"></label>
  <label><input type="checkbox" id="rs" ${c.requireSubscription ? 'checked' : ''}>Require a trucker plan after the free period (billing comes later; toggle a trucker's plan below)</label>
  <label>Cities (JSON: center lat/lng, radiusMi, mult, active)<textarea id="cj" rows="10">${esc(JSON.stringify(c.cities, null, 1))}</textarea></label><button class="btn" id="sv">Save config</button></div>
  <div class="card"><b>Stats</b><div class="kv"><span>Customers</span><b>${users.filter((u) => u.role === 'customer').length}</b></div><div class="kv"><span>Truckers</span><b>${users.filter((u) => u.role === 'trucker').length}</b></div>
  <div class="kv"><span>Open jobs</span><b>${jobs.filter((j) => j.status === 'open').length}</b></div><div class="kv"><span>Matched/completed</span><b>${jobs.filter((j) => j.status !== 'open' && j.status !== 'canceled').length}</b></div></div>
  <div class="card"><b>Users</b> <small>(no contact info shown, by design)</small>${users.map((u) => `<div class="kv"><span>${esc(u.name)} · ${u.role} · ${esc(u.city)}${u.banned ? ' · 🚫' : ''}</span><span>
  ${u.role === 'trucker' ? `<button data-sub="${u.id}" data-v="${!u.subscriptionActive}">${u.subscriptionActive ? 'Plan ✅' : 'Plan ✖'}</button>` : ''} <button data-ban="${u.id}" data-v="${!u.banned}">${u.banned ? 'Unban' : 'Ban'}</button></span></div>`).join('')}</div>`;
  $('#sv').onclick = async () => {
    try { const cj = JSON.parse($('#cj').value);
      await fb.setDoc(fb.doc(db, 'config/app'), { launchDate: fb.Timestamp.fromDate(new Date($('#ld').value + 'T00:00:00')), freeDays: +$('#fd').value, requireSubscription: $('#rs').checked, cities: cj });
      S.cfg = (await api.getConfig()); toast('Config saved'); render(); } catch (e) { fail(e); }
  };
  root.onclick = async (e) => { const s = e.target.dataset; try {
    if (s.sub) { await fb.updateDoc(fb.doc(db, 'users', s.sub), { subscriptionActive: s.v === 'true' }); render(); }
    if (s.ban) { await fb.updateDoc(fb.doc(db, 'users', s.ban), { banned: s.v === 'true' }); render(); } } catch (er) { fail(er); } };
}

// ---------- boot ----------
onAuthStateChanged(auth, async (u) => {
  if (S.signingUp) return;
  S.user = u; S.cfg = await api.getConfig().catch(() => null);
  if (!u) { S.me = null; const h = location.hash.slice(1); if (h === 'signup-customer') return signup('customer'); if (h === 'signup-trucker') return signup('trucker'); return landing(); }
  await loadMe();
  if (!S.me) { // signed in but no profile (e.g., interrupted signup)
    root.innerHTML = `<h1>Finish sign-up</h1><button class="btn" id="c">I need a truck + guy</button><button class="btn g" id="t">I have a truck — drive</button><button class="btn g" id="o">Sign out</button>`;
    const fin = (role) => async () => { const name = prompt('First name (letters only)'); if (!name || !NAME_RE.test(name)) return toast('Letters only');
      try { await api.createProfile(u.uid, { role, name, city: activeCities()[0], email: u.email, phone: '', notifyEmail: true }); await loadMe(); render(); } catch (e) { fail(e); } };
    $('#c').onclick = fin('customer'); $('#t').onclick = fin('trucker'); $('#o').onclick = () => signOut(auth); return;
  }
  render();
});
