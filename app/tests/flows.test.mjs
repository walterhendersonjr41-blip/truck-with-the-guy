// End-to-end core flows using the SAME core.js the app uses, against Auth + Firestore emulators with real rules.
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import * as fb from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { makeApi, DEFAULT_CITIES, canClaim, freeDaysLeft, priceFor, milesBetween } from '../public/core.js';

const PID = 'demo-truckguy';
let env; const apps = [];
async function person(email) {
  const app = initializeApp({ apiKey: 'demo', projectId: PID, authDomain: 'x' }, email);
  apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = fb.getFirestore(app); fb.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const cred = await createUserWithEmailAndPassword(auth, email, 'test-pass-123');
  return { uid: cred.user.uid, db, api: makeApi(fb, db) };
}
const cities = { ...DEFAULT_CITIES, 'Atlanta, GA': { ...DEFAULT_CITIES['Atlanta, GA'], active: true } };

describe('Core flows (emulator, real rules)', function () {
  this.timeout(30000);
  before(async () => {
    env = await initializeTestEnvironment({ projectId: PID, firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await fb.setDoc(fb.doc(ctx.firestore(), 'config/app'), { launchDate: fb.Timestamp.fromMillis(Date.now() - 864e5), freeDays: 7, requireSubscription: true, cities });
    });
  });
  after(async () => { for (const a of apps) await deleteApp(a); await env.cleanup(); });

  it('pricing + distance helpers', () => {
    assert.equal(priceFor('Chattanooga, TN', cities, '1h', false, 'store'), 79);
    assert.equal(priceFor('Atlanta, GA', cities, '1h', false, 'store'), 95);
    assert.equal(priceFor('Chattanooga, TN', cities, '2h', true, 'store'), 199);
    assert.equal(priceFor('Chattanooga, TN', cities, '1h', false, 'junk'), 104);
    const d = milesBetween({ lat: 35.0456, lng: -85.3097 }, { lat: 35.1595, lng: -84.8766 }); // Cleveland TN
    assert.ok(d > 15, 'Cleveland is outside 15 mi');
  });

  it('full flow: signup → truck → post → claim → confirm → handles → chat → complete → rate', async () => {
    const cust = await person('cust@test.dev');
    const trk = await person('trk@test.dev');
    const nosy = await person('nosy@test.dev');
    await cust.api.createProfile(cust.uid, { role: 'customer', name: 'Dana', city: 'Chattanooga, TN', email: 'cust@test.dev', phone: '4235550000', notifyEmail: true });
    await trk.api.createProfile(trk.uid, { role: 'trucker', name: 'Marcus', city: 'Chattanooga, TN', email: 'trk@test.dev', notifyEmail: true });
    await nosy.api.createProfile(nosy.uid, { role: 'trucker', name: 'Nosy', city: 'Chattanooga, TN', email: 'nosy@test.dev' });
    await trk.api.saveTruck(trk.uid, { name: 'Marcus', city: 'Chattanooga, TN', makeModel: 'Ram 1500', bed: '6.5 ft', color: 'Red', insured: true, active: true });
    await nosy.api.saveTruck(nosy.uid, { name: 'Nosy', city: 'Chattanooga, TN', makeModel: 'Ford F-150', bed: '8 ft', color: 'Black', insured: false, active: false });
    await trk.api.saveHandles(trk.uid, { cashapp: '$MarcusHauls', zelle: '', venmo: '', payLink: '', cash: true, askDeposit: true, askFirst40: true });

    // customer sees the trucker in the list (no contact fields exist on it)
    const list = await cust.api.truckersIn('Chattanooga, TN');
    assert.equal(list.length, 1); assert.equal(list[0].name, 'Marcus'); assert.ok(!('email' in list[0]) && !('phone' in list[0]));

    // contact info never readable by others
    await assert.rejects(fb.getDoc(fb.doc(trk.db, 'private', cust.uid)));

    const cfg = await cust.api.getConfig();
    assert.ok(freeDaysLeft(cfg) > 0); assert.ok(canClaim(cfg, {}));
    await assert.rejects(cust.api.postJob(cust.uid, cities, { city: 'Chattanooga, TN', jobType: 'store', timeBlock: '1h', helper: false, pickupArea: 'Downtown', dropoffArea: 'East Ridge', pickupMi: 1, dropoffMi: 5, when: 'Sat 10 AM', notes: 'call 423 555 1212', pickupAddress: 'a', dropoffAddress: 'b' }));
    const jobId = await cust.api.postJob(cust.uid, cities, { city: 'Chattanooga, TN', jobType: 'store', timeBlock: '1h', helper: false, pickupArea: 'Downtown', dropoffArea: 'East Ridge', pickupMi: 1, dropoffMi: 5, when: 'Sat 10 AM', notes: 'One couch', pickupAddress: '100 Market St', dropoffAddress: '12 Elm Ave' });

    const board = await trk.api.openJobs('Chattanooga, TN');
    assert.equal(board.length, 1); assert.equal(board[0].suggestedPrice, 79); assert.ok(!('pickupAddress' in board[0]));
    await assert.rejects(trk.api.jobAddress(jobId)); // address hidden before match
    await assert.rejects(trk.api.getHandles(trk.uid === 'x' ? 'x' : 'none').then(() => cust.api.getHandles(trk.uid)));

    // nosy counter-offers, trucker claims
    await nosy.api.claim(nosy.uid, board[0], 120);
    const mid = await trk.api.claim(trk.uid, board[0], 79);
    let mine = await cust.api.myMatches(cust.uid, 'customer');
    assert.equal(mine.length, 2);
    const inbox = await fb.getDocs(fb.collection(cust.db, `notifications/${cust.uid}/items`));
    assert.ok(inbox.docs.some((d) => d.data().text === 'A trucker found your job'));

    const m = mine.find((x) => x.id === mid);
    assert.equal(await cust.api.accept(cust.uid, m), true);
    await cust.api.decline(cust.uid, mine.find((x) => x.id !== mid));

    // handles + address now visible to the matched customer/trucker only
    const h = await cust.api.getHandles(trk.uid); assert.equal(h.cashapp, '$MarcusHauls');
    await assert.rejects(nosy.api.getHandles(trk.uid));
    assert.equal((await trk.api.jobAddress(jobId)).pickupAddress, '100 Market St');
    await assert.rejects(nosy.api.jobAddress(jobId));
    assert.equal((await nosy.api.openJobs('Chattanooga, TN')).length, 0); // job no longer open

    const mc = { ...m, status: 'confirmed', customerOk: true };
    await cust.api.send(cust.uid, mc, 'Couch is in the garage');
    await assert.rejects(trk.api.send(trk.uid, mc, 'my number is 423-555-9999'));
    await trk.api.send(trk.uid, mc, 'On my way');
    const msgs = await fb.getDocs(fb.collection(trk.db, `matches/${mid}/messages`));
    assert.equal(msgs.size, 2);

    await cust.api.complete(cust.uid, mc);
    await cust.api.rate(cust.uid, mc, 5, 'Fast and careful');
    await trk.api.rate(trk.uid, mc, 5, 'Easy pickup');
    await assert.rejects(cust.api.rate(cust.uid, mc, 1, 'again'));
    assert.deepEqual(await cust.api.ratingOf(trk.uid), { avg: 5, n: 1 });
  });

  it('customer invites a trucker from the list; trucker accepts', async () => {
    const c = await person('c2@test.dev'); const t = await person('t2@test.dev');
    await c.api.createProfile(c.uid, { role: 'customer', name: 'Ann', city: 'Atlanta, GA', email: 'c2@test.dev' });
    await t.api.createProfile(t.uid, { role: 'trucker', name: 'Ty', city: 'Atlanta, GA', email: 't2@test.dev' });
    await t.api.saveTruck(t.uid, { name: 'Ty', city: 'Atlanta, GA', makeModel: 'Toyota Tundra', bed: '5.5 ft', color: 'Gray', insured: false, active: true });
    const jobId = await c.api.postJob(c.uid, cities, { city: 'Atlanta, GA', jobType: 'move', timeBlock: '2h', helper: false, pickupArea: 'Decatur', dropoffArea: 'Midtown', pickupMi: 6, dropoffMi: 3, when: 'Sun', notes: '', pickupAddress: 'x', dropoffAddress: 'y' });
    const job = (await c.api.myJobs(c.uid))[0];
    assert.equal(job.suggestedPrice, 167); // 139 × 1.2 = 166.8 → 167
    const mid = await c.api.invite(c.uid, job, t.uid);
    const m = (await t.api.myMatches(t.uid, 'trucker'))[0];
    assert.equal(await t.api.accept(t.uid, m), true);
    await c.api.markJobMatched({ ...m, id: mid, jobId });
    assert.equal((await c.api.myJobs(c.uid))[0].status, 'matched');
  });
});
