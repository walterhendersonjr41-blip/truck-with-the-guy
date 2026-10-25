// Core marketplace logic shared by the browser app and the Node tests.
// `fb` = the Firestore modular API (from the CDN in the browser, from 'firebase/firestore' in tests).
export const BASE = { '1h': 79, '2h': 139, half: 249, full: 449 };
export const HOURS = { '1h': 1, '2h': 2, half: 4, full: 8 };
export const BLOCK_LABEL = { '1h': '1 hour', '2h': '2 hours', half: 'Half day (4h)', full: 'Full day (8h)' };
export const JOB_TYPES = { store: '🏬 Store pickup', move: '📦 Small move', marketplace: '🛒 Marketplace', junk: '🗑️ Junk run', hauling: '🪵 Hauling' };
export const TRUCKS = ['Ford F-150', 'Chevy Silverado 1500', 'Ram 1500', 'Toyota Tundra', 'GMC Sierra 1500', 'Other full-size'];
export const BEDS = ['5.5 ft', '6.5 ft', '8 ft'];
export const COLORS = ['White', 'Black', 'Silver', 'Red', 'Blue', 'Gray'];
export const DEFAULT_CITIES = {
  'Chattanooga, TN': { lat: 35.0456, lng: -85.3097, radiusMi: 15, mult: 1, active: true },
  'Atlanta, GA': { lat: 33.749, lng: -84.388, radiusMi: 15, mult: 1.2, active: false },
  'Nashville, TN': { lat: 36.1627, lng: -86.7816, radiusMi: 15, mult: 1.15, active: false },
  'Knoxville, TN': { lat: 35.9606, lng: -83.9207, radiusMi: 15, mult: 1, active: false },
  'Birmingham, AL': { lat: 33.5186, lng: -86.8104, radiusMi: 15, mult: 0.95, active: false },
};
const PHONE_RE = /[0-9][0-9 ().+-]{5,}[0-9]/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}/;
export const hasContact = (s) => PHONE_RE.test(s || '') || EMAIL_RE.test(s || '');
export const NAME_RE = /^[A-Za-z][A-Za-z .'-]{0,39}$/;

export function priceFor(city, cities, timeBlock, helper, jobType) {
  return Math.round(BASE[timeBlock] * cities[city].mult) + (helper ? 30 * HOURS[timeBlock] : 0) + (jobType === 'junk' ? 25 : 0);
}
export function milesBetween(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
export function freeDaysLeft(cfg, now = Date.now()) {
  if (!cfg || !cfg.launchDate) return 0;
  const end = cfg.launchDate.toMillis() + cfg.freeDays * 864e5;
  return Math.max(0, Math.ceil((end - now) / 864e5));
}
export function canClaim(cfg, user, now = Date.now()) {
  return !cfg.requireSubscription || freeDaysLeft(cfg, now) > 0 || user?.subscriptionActive === true;
}

export function makeApi(fb, db) {
  const { doc, setDoc, getDoc, updateDoc, addDoc, collection, query, where, getDocs, serverTimestamp, writeBatch } = fb;
  const notify = (to, type, from, matchId, text) =>
    addDoc(collection(db, `notifications/${to}/items`), { type, from, matchId, text, read: false, createdAt: serverTimestamp() });
  return {
    async getConfig() { const s = await getDoc(doc(db, 'config/app')); return s.exists() ? s.data() : null; },
    async createProfile(uid, { role, name, city, email, phone, notifyEmail }) {
      if (!NAME_RE.test(name)) throw new Error('First name: letters only (no numbers or emails).');
      await setDoc(doc(db, 'users', uid), { role, name, city, createdAt: serverTimestamp() });
      await setDoc(doc(db, 'private', uid), { email: email || '', phone: phone || '', notifyEmail: !!notifyEmail });
    },
    async saveTruck(uid, t) { await setDoc(doc(db, 'truckers', uid), { ...t, updatedAt: serverTimestamp() }); },
    async saveHandles(uid, h) { await setDoc(doc(db, 'handles', uid), h); },
    async getHandles(truckerId) { const s = await getDoc(doc(db, 'handles', truckerId)); return s.exists() ? s.data() : null; },
    async postJob(uid, cities, j) {
      if (hasContact(j.notes) || hasContact(j.pickupArea) || hasContact(j.dropoffArea)) throw new Error('Please remove phone numbers or emails. Contact stays private in the app.');
      const suggestedPrice = priceFor(j.city, cities, j.timeBlock, j.helper, j.jobType);
      const ref = doc(collection(db, 'jobs'));
      await setDoc(ref, { customerId: uid, city: j.city, jobType: j.jobType, timeBlock: j.timeBlock, helper: j.helper,
        pickupArea: j.pickupArea, dropoffArea: j.dropoffArea, pickupMi: j.pickupMi, dropoffMi: j.dropoffMi, when: j.when,
        notes: j.notes || '', suggestedPrice, status: 'open', createdAt: serverTimestamp() });
      await setDoc(doc(db, `jobs/${ref.id}/private/addr`), { pickupAddress: j.pickupAddress, dropoffAddress: j.dropoffAddress });
      return ref.id;
    },
    async claim(uid, job, price) {
      const kind = price === job.suggestedPrice ? 'claim' : 'counter';
      const id = `${job.id}_${uid}`;
      await setDoc(doc(db, 'matches', id), { jobId: job.id, customerId: job.customerId, truckerId: uid, price, kind,
        truckerOk: true, customerOk: false, status: 'pending', createdAt: serverTimestamp() });
      await notify(job.customerId, kind, uid, id, kind === 'claim' ? 'A trucker found your job' : `A trucker sent an offer: $${price}`);
      return id;
    },
    async invite(uid, job, truckerId) {
      const id = `${job.id}_${truckerId}`;
      await setDoc(doc(db, 'matches', id), { jobId: job.id, customerId: uid, truckerId, price: job.suggestedPrice, kind: 'invite',
        truckerOk: false, customerOk: true, status: 'pending', createdAt: serverTimestamp() });
      await notify(truckerId, 'invite', uid, id, 'A customer invited you to a job');
      return id;
    },
    async accept(uid, m) {
      const iAmTrucker = uid === m.truckerId;
      const other = iAmTrucker ? m.customerId : m.truckerId;
      const both = iAmTrucker ? m.customerOk : m.truckerOk;
      await updateDoc(doc(db, 'matches', m.id), { [iAmTrucker ? 'truckerOk' : 'customerOk']: true, status: both ? 'confirmed' : 'pending' });
      if (both) {
        // job → matched (customer only) and pair doc (unlocks handles in-app)
        if (!iAmTrucker) await updateDoc(doc(db, 'jobs', m.jobId), { status: 'matched', matchId: m.id });
        await setDoc(doc(db, 'pairs', `${m.truckerId}_${m.customerId}`), { truckerId: m.truckerId, customerId: m.customerId, matchId: m.id });
        await notify(other, 'confirmed', uid, m.id, "You're matched! Open the app to chat");
      }
      return both;
    },
    async markJobMatched(m) { await updateDoc(doc(db, 'jobs', m.jobId), { status: 'matched', matchId: m.id }); },
    async decline(uid, m) {
      await updateDoc(doc(db, 'matches', m.id), { status: 'declined' });
      await notify(uid === m.truckerId ? m.customerId : m.truckerId, 'declined', uid, m.id, 'An offer was declined');
    },
    async complete(uid, m) {
      await updateDoc(doc(db, 'matches', m.id), { status: 'completed' });
      if (uid === m.customerId) await updateDoc(doc(db, 'jobs', m.jobId), { status: 'completed' });
      await notify(uid === m.truckerId ? m.customerId : m.truckerId, 'completed', uid, m.id, 'Job marked complete. Please rate.');
    },
    async send(uid, m, text) {
      if (hasContact(text)) throw new Error('For everyone’s privacy, phone numbers and emails can’t be shared in chat.');
      await addDoc(collection(db, `matches/${m.id}/messages`), { senderId: uid, text, createdAt: serverTimestamp() });
      await notify(uid === m.truckerId ? m.customerId : m.truckerId, 'message', uid, m.id, 'New message');
    },
    async rate(uid, m, stars, comment) {
      const ratee = uid === m.truckerId ? m.customerId : m.truckerId;
      await setDoc(doc(db, 'ratings', `${m.id}_${uid}`), { matchId: m.id, raterId: uid, rateeId: ratee, stars, comment: comment || '', createdAt: serverTimestamp() });
    },
    async ratingOf(u) {
      const s = await getDocs(query(collection(db, 'ratings'), where('rateeId', '==', u)));
      if (s.empty) return null; let t = 0; s.forEach((d) => (t += d.data().stars)); return { avg: Math.round((t / s.size) * 10) / 10, n: s.size };
    },
    async openJobs(city) {
      const s = await getDocs(query(collection(db, 'jobs'), where('city', '==', city), where('status', '==', 'open')));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async truckersIn(city) {
      const s = await getDocs(query(collection(db, 'truckers'), where('city', '==', city), where('active', '==', true)));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async myMatches(uid, role) {
      const s = await getDocs(query(collection(db, 'matches'), where(role === 'trucker' ? 'truckerId' : 'customerId', '==', uid)));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async myJobs(uid) {
      const s = await getDocs(query(collection(db, 'jobs'), where('customerId', '==', uid)));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async jobAddress(jobId) { const s = await getDoc(doc(db, `jobs/${jobId}/private/addr`)); return s.exists() ? s.data() : null; },
    notify,
  };
}
