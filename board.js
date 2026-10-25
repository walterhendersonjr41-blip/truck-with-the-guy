// Free shared job board on public Nostr relays (no account, no server, no fees).
// Public: first name, town/area, job type, time, price and claim status. Phone numbers and payment
// handles are end-to-end encrypted (NIP-44) so only the customer and the driver they accept can read them.
// Add ?ns=test to the URL to use a separate test board that never shows on the real one.
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool, bytesToHex, hexToBytes, nip44 } from './nostr.bundle.js';
const KIND = 30078, NS = /[?&]ns=test/.test(location.search) ? '-test' : '';
const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://offchain.pub', 'wss://relay.snort.social'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let hex = localStorage.getItem('twtg-sk');
if (!/^[0-9a-f]{64}$/.test(hex || '')) { hex = bytesToHex(generateSecretKey()); localStorage.setItem('twtg-sk', hex); }
const SK = hexToBytes(hex), PK = getPublicKey(SK), pool = new SimplePool();
function parse(e) { let c = {}; try { c = JSON.parse(e.content); } catch (x) {} if (!c || typeof c !== 'object') c = {}; const d = ((e.tags.find(t => t[0] === 'd') || [])[1] || '').split(':').slice(1).join(':') || e.id; return Object.assign({}, c, { _id: d, _by: e.pubkey, _mine: e.pubkey === PK, _at: e.created_at * 1000 }); }
window.Board = {
  me: PK, test: !!NS,
  async put(kind, d, content) {
    const tag = 'twtg-' + kind + NS;
    const ev = finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', tag + ':' + d], ['t', tag]], content: JSON.stringify(content) }, SK);
    const rs = await Promise.allSettled(pool.publish(RELAYS, ev).map(p => Promise.race([p, sleep(9000).then(() => { throw new Error('timeout'); })])));
    if (!rs.some(r => r.status === 'fulfilled')) throw new Error('offline');
    return parse(ev);
  },
  async query(kind, limit) {
    const evs = await pool.querySync(RELAYS, { kinds: [KIND], '#t': ['twtg-' + kind + NS], limit: limit || 300 }, { maxWait: 4500 });
    const latest = new Map();
    evs.forEach(e => { const p = parse(e), k = e.pubkey + '|' + p._id; const o = latest.get(k); if (!o || p._at > o._at) latest.set(k, p); });
    return [...latest.values()].sort((a, b) => b._at - a._at);
  },
  seal(toPk, obj) { try { return nip44.v2.encrypt(JSON.stringify(obj), nip44.v2.utils.getConversationKey(SK, toPk)); } catch (e) { return ''; } },
  open(fromPk, c) { try { return JSON.parse(nip44.v2.decrypt(c, nip44.v2.utils.getConversationKey(SK, fromPk))); } catch (e) { return null; } }
};
window.dispatchEvent(new Event('board-ready'));
