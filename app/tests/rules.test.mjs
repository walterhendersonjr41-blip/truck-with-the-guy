import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, getDoc, updateDoc, getDocs, collection, Timestamp, serverTimestamp } from 'firebase/firestore';

let env;
const NOW = Date.now();
const cities = {
  'Chattanooga, TN': { lat: 35.0456, lng: -85.3097, radiusMi: 15, mult: 1, active: true },
  'Atlanta, GA': { lat: 33.749, lng: -84.388, radiusMi: 15, mult: 1.2, active: true },
};
async function seedConfig(over = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config/app'), {
      launchDate: Timestamp.fromMillis(NOW - 2 * 864e5), freeDays: 7, requireSubscription: true, cities, ...over });
  });
}
const db = (u) => env.authenticatedContext(u).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const job = (o = {}) => ({ customerId: 'cust', city: 'Chattanooga, TN', jobType: 'store', timeBlock: '1h', helper: false,
  pickupArea: 'Downtown', dropoffArea: 'East Ridge', pickupMi: 1.2, dropoffMi: 5.1, when: 'Today 2 PM',
  notes: 'One couch', suggestedPrice: 79, status: 'open', createdAt: serverTimestamp(), ...o });
const truck = { name: 'Marcus', city: 'Chattanooga, TN', makeModel: 'Ford F-150', bed: '6.5 ft', color: 'White', insured: true, active: true };

async function setupPeople() {
  await assertSucceeds(setDoc(doc(db('cust'), 'users/cust'), { role: 'customer', name: 'Dana', city: 'Chattanooga, TN', createdAt: 1 }));
  await assertSucceeds(setDoc(doc(db('trk'), 'users/trk'), { role: 'trucker', name: 'Marcus', city: 'Chattanooga, TN', createdAt: 1 }));
  await assertSucceeds(setDoc(doc(db('trk2'), 'users/trk2'), { role: 'trucker', name: 'Leo', city: 'Chattanooga, TN', createdAt: 1 }));
  await assertSucceeds(setDoc(doc(db('trk'), 'truckers/trk'), truck));
  await assertSucceeds(setDoc(doc(db('trk2'), 'truckers/trk2'), { ...truck, name: 'Leo' }));
  await assertSucceeds(setDoc(doc(db('cust'), 'jobs/j1'), job()));
}
async function confirmMatch() {
  await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
  await assertSucceeds(updateDoc(doc(db('cust'), 'matches/j1_trk'), { customerOk: true, status: 'confirmed' }));
}

describe('Truck With The Guy security rules', function () {
  this.timeout(20000);
  before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-truckguy',
      firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 } });
  });
  after(async () => env && env.cleanup());
  beforeEach(async () => { await env.clearFirestore(); await seedConfig(); });

  it('config is public-read but not writable by users', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'config/app')));
    await assertFails(setDoc(doc(db('cust'), 'config/app'), { freeDays: 99 }));
  });

  it('signup: public profile cannot contain contact info or extra fields', async () => {
    await assertFails(setDoc(doc(db('a'), 'users/a'), { role: 'customer', name: 'Dana 4235551212', city: 'x', createdAt: 1 }));
    await assertFails(setDoc(doc(db('a'), 'users/a'), { role: 'customer', name: 'dana@mail.com', city: 'x', createdAt: 1 }));
    await assertFails(setDoc(doc(db('a'), 'users/a'), { role: 'customer', name: 'Dana', city: 'x', phone: '4235551212', createdAt: 1 }));
    await assertFails(setDoc(doc(db('a'), 'users/a'), { role: 'admin', name: 'Dana', city: 'x', createdAt: 1 }));
    await assertFails(setDoc(doc(db('b'), 'users/a'), { role: 'customer', name: 'Dana', city: 'x', createdAt: 1 }));
    await assertSucceeds(setDoc(doc(db('a'), 'users/a'), { role: 'customer', name: 'Dana', city: 'x', createdAt: 1 }));
    await assertFails(getDoc(doc(anon(), 'users/a')));
  });

  it('private contact info is readable only by its owner', async () => {
    await assertSucceeds(setDoc(doc(db('a'), 'private/a'), { email: 'a@x.com', phone: '4235551212', notifyEmail: true }));
    await assertSucceeds(getDoc(doc(db('a'), 'private/a')));
    await assertFails(getDoc(doc(db('b'), 'private/a')));
    await assertFails(getDoc(doc(anon(), 'private/a')));
    await assertFails(setDoc(doc(db('b'), 'private/a'), { email: 'evil@x.com' }));
  });

  it('users cannot grant themselves a subscription or unban', async () => {
    await setupPeople();
    await assertFails(updateDoc(doc(db('trk'), 'users/trk'), { subscriptionActive: true }));
  });

  it('job post: range check, price check, no contact info in text', async () => {
    await setupPeople();
    await assertFails(setDoc(doc(db('cust'), 'jobs/j2'), job({ dropoffMi: 30 })));               // out of range
    await assertFails(setDoc(doc(db('cust'), 'jobs/j2'), job({ suggestedPrice: 10 })));           // wrong price
    await assertFails(setDoc(doc(db('cust'), 'jobs/j2'), job({ notes: 'call me 423-555-1212' }))); // phone
    await assertFails(setDoc(doc(db('cust'), 'jobs/j2'), job({ notes: 'me@gmail.com' })));        // email
    await assertFails(setDoc(doc(db('trk'), 'jobs/j2'), job({ customerId: 'trk' })));             // truckers can't post
    await assertFails(setDoc(doc(db('cust'), 'jobs/j2'), job({ city: 'Nowhere' })));
    await assertSucceeds(setDoc(doc(db('cust'), 'jobs/j3'), job({ city: 'Atlanta, GA', suggestedPrice: 95 })));
    await assertSucceeds(setDoc(doc(db('cust'), 'jobs/j4'), job({ timeBlock: '2h', helper: true, suggestedPrice: 199 })));
    await assertSucceeds(setDoc(doc(db('cust'), 'jobs/j5'), job({ jobType: 'junk', suggestedPrice: 104 })));
  });

  it('exact addresses are private to the customer until a confirmed match', async () => {
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('cust'), 'jobs/j1/private/addr'), { pickupAddress: '1 Main St', dropoffAddress: '2 Elm St' }));
    await assertFails(getDoc(doc(db('trk'), 'jobs/j1/private/addr')));
    await confirmMatch();
    await assertSucceeds(updateDoc(doc(db('cust'), 'jobs/j1'), { status: 'matched', matchId: 'j1_trk' }));
    await assertSucceeds(getDoc(doc(db('trk'), 'jobs/j1/private/addr')));
    await assertFails(getDoc(doc(db('trk2'), 'jobs/j1/private/addr')));
  });

  it('claim at suggested price; counter-offer; no fake claims for others', async () => {
    await setupPeople();
    await assertFails(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 50, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await assertFails(setDoc(doc(db('trk'), 'matches/j1_trk2'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk2', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await assertFails(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: true, status: 'confirmed', createdAt: 1 }));
    await assertSucceeds(setDoc(doc(db('trk2'), 'matches/j1_trk2'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk2', price: 99, kind: 'counter', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
  });

  it('only the customer can confirm; then the match is confirmed and the job matched', async () => {
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await assertFails(updateDoc(doc(db('trk'), 'matches/j1_trk'), { customerOk: true, status: 'confirmed' }));
    await assertFails(updateDoc(doc(db('trk2'), 'matches/j1_trk'), { status: 'declined' }));
    await assertFails(updateDoc(doc(db('cust'), 'matches/j1_trk'), { customerOk: true, status: 'pending' })); // must flip to confirmed
    await assertSucceeds(updateDoc(doc(db('cust'), 'matches/j1_trk'), { customerOk: true, status: 'confirmed' }));
    await assertFails(updateDoc(doc(db('cust'), 'jobs/j1'), { status: 'matched', matchId: 'nope' }));
    await assertSucceeds(updateDoc(doc(db('cust'), 'jobs/j1'), { status: 'matched', matchId: 'j1_trk' }));
    // second trucker can no longer claim a matched job
    await assertFails(setDoc(doc(db('trk2'), 'matches/j1_trk2'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk2', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
  });

  it('customer invite from trucker list, trucker accepts', async () => {
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('cust'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'invite', truckerOk: false, customerOk: true, status: 'pending', createdAt: 1 }));
    await assertSucceeds(updateDoc(doc(db('trk'), 'matches/j1_trk'), { truckerOk: true, status: 'confirmed' }));
  });

  it('payment handles are hidden until a confirmed pair exists', async () => {
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('trk'), 'handles/trk'), { cashapp: '$Marcus', zelle: '', venmo: '', payLink: '', cash: true, askDeposit: true, askFirst40: true }));
    await assertFails(getDoc(doc(db('cust'), 'handles/trk')));
    await assertFails(setDoc(doc(db('cust'), 'pairs/trk_cust'), { truckerId: 'trk', customerId: 'cust', matchId: 'j1_trk' })); // no match yet
    await confirmMatch();
    await assertSucceeds(setDoc(doc(db('cust'), 'pairs/trk_cust'), { truckerId: 'trk', customerId: 'cust', matchId: 'j1_trk' }));
    await assertSucceeds(getDoc(doc(db('cust'), 'handles/trk')));
    await assertFails(getDoc(doc(db('trk2'), 'handles/trk')));
    await assertFails(setDoc(doc(db('trk2'), 'pairs/trk_trk2'), { truckerId: 'trk', customerId: 'trk2', matchId: 'j1_trk' }));
  });

  it('chat: parties only, no phone numbers or emails', async () => {
    await setupPeople();
    await confirmMatch();
    const m = (u) => doc(collection(db(u), 'matches/j1_trk/messages'));
    await assertSucceeds(setDoc(m('cust'), { senderId: 'cust', text: 'Gate code is at the front office', createdAt: 1 }));
    await assertFails(setDoc(m('cust'), { senderId: 'cust', text: 'text me at (423) 555-1212', createdAt: 1 }));
    await assertFails(setDoc(m('cust'), { senderId: 'cust', text: 'email dana@example.com', createdAt: 1 }));
    await assertFails(setDoc(m('trk2'), { senderId: 'trk2', text: 'hi', createdAt: 1 }));
    await assertFails(setDoc(m('trk'), { senderId: 'cust', text: 'spoof', createdAt: 1 }));
    await assertFails(getDocs(collection(db('trk2'), 'matches/j1_trk/messages')));
    await assertSucceeds(getDocs(collection(db('trk'), 'matches/j1_trk/messages')));
  });

  it('ratings: one per party, only after confirmation, rate the other party', async () => {
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await assertFails(setDoc(doc(db('cust'), 'ratings/j1_trk_cust'), { matchId: 'j1_trk', raterId: 'cust', rateeId: 'trk', stars: 5, comment: '', createdAt: 1 }));
    await assertSucceeds(updateDoc(doc(db('cust'), 'matches/j1_trk'), { customerOk: true, status: 'confirmed' }));
    await assertFails(setDoc(doc(db('cust'), 'ratings/j1_trk_cust'), { matchId: 'j1_trk', raterId: 'cust', rateeId: 'cust', stars: 5, comment: '', createdAt: 1 }));
    await assertFails(setDoc(doc(db('cust'), 'ratings/j1_trk_cust'), { matchId: 'j1_trk', raterId: 'cust', rateeId: 'trk', stars: 9, comment: '', createdAt: 1 }));
    await assertSucceeds(setDoc(doc(db('cust'), 'ratings/j1_trk_cust'), { matchId: 'j1_trk', raterId: 'cust', rateeId: 'trk', stars: 5, comment: 'Great', createdAt: 1 }));
    await assertFails(setDoc(doc(db('cust'), 'ratings/j1_trk_cust'), { matchId: 'j1_trk', raterId: 'cust', rateeId: 'trk', stars: 1, comment: 'changed', createdAt: 1 }));
  });

  it('subscription lock: after the free week, unsubscribed truckers cannot claim', async () => {
    await seedConfig({ launchDate: Timestamp.fromMillis(NOW - 30 * 864e5) });
    await setupPeople();
    await assertFails(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
    await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'users/trk'), { subscriptionActive: true }); });
    await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
  });

  it('subscription flag off: claims allowed after free week', async () => {
    await seedConfig({ launchDate: Timestamp.fromMillis(NOW - 30 * 864e5), requireSubscription: false });
    await setupPeople();
    await assertSucceeds(setDoc(doc(db('trk'), 'matches/j1_trk'), { jobId: 'j1', customerId: 'cust', truckerId: 'trk', price: 79, kind: 'claim', truckerOk: true, customerOk: false, status: 'pending', createdAt: 1 }));
  });

  it('notifications: only the other party of a match, own inbox private', async () => {
    await setupPeople();
    await confirmMatch();
    const n = (from, to, o = {}) => setDoc(doc(collection(db(from), `notifications/${to}/items`)), { type: 'message', from, matchId: 'j1_trk', text: 'New message', read: false, createdAt: 1, ...o });
    await assertSucceeds(n('trk', 'cust'));
    await assertFails(n('trk2', 'cust'));
    await assertFails(n('trk', 'trk2'));
    await assertFails(n('trk', 'cust', { text: 'call 4235551212' }));
    await assertFails(getDocs(collection(db('trk'), 'notifications/cust/items')));
    await assertSucceeds(getDocs(collection(db('cust'), 'notifications/cust/items')));
  });

  it('admin can edit config and set subscription; non-admin cannot', async () => {
    await setupPeople();
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'admins/boss'), { at: 1 }); });
    await assertSucceeds(updateDoc(doc(db('boss'), 'config/app'), { freeDays: 10 }));
    await assertSucceeds(updateDoc(doc(db('boss'), 'users/trk'), { subscriptionActive: true }));
    await assertFails(getDoc(doc(db('boss'), 'private/cust'))); // even admins can't read contact info from the client
    await assertFails(updateDoc(doc(db('cust'), 'config/app'), { freeDays: 10 }));
  });
});
