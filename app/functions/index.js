// Email notifications for Truck With The Guy (requires the Firebase Blaze plan; usage stays within free quotas at pilot scale).
// Emails NEVER contain anyone's phone, email or address — only a short generic line and a link to open the app.
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');        // firebase functions:secrets:set BREVO_API_KEY
const SENDER_EMAIL = defineString('SENDER_EMAIL');           // e.g. notify@yourdomain.com (verified in Brevo)
const APP_URL = defineString('APP_URL', { default: 'https://YOUR_PROJECT.web.app' });

const SUBJECTS = { claim: 'A trucker found your job', counter: 'You got an offer on your job', invite: 'A customer invited you to a job',
  confirmed: "You're matched!", declined: 'An offer was declined', message: 'New message', completed: 'Job marked complete', new_job: 'New job posted near you' };

async function sendEmail(uid, type) {
  const p = (await db.doc(`private/${uid}`).get()).data();
  if (!p?.email || p.notifyEmail === false) return;
  const subject = SUBJECTS[type] || 'Update from Truck With The Guy';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': BREVO_API_KEY.value(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Truck With The Guy', email: SENDER_EMAIL.value() }, to: [{ email: p.email }], subject,
      htmlContent: `<p>${subject}.</p><p><a href="${APP_URL.value()}">Open Truck With The Guy</a> to see details and reply in chat.</p><p style="color:#888;font-size:12px">For everyone's privacy we never share phone numbers or emails. Turn off emails in the app anytime.</p>` }),
  });
  if (!res.ok) console.error('email failed', res.status, await res.text());
}

// Any in-app notification → email the recipient (generic text only).
export const emailOnNotification = onDocumentCreated({ document: 'notifications/{uid}/items/{nid}', secrets: [BREVO_API_KEY] }, async (e) => {
  await sendEmail(e.params.uid, e.data.data().type);
});

// New job → notify active truckers in that city (in-app + email via the trigger above).
export const fanOutNewJob = onDocumentCreated('jobs/{jobId}', async (e) => {
  const job = e.data.data();
  const ts = await db.collection('truckers').where('city', '==', job.city).where('active', '==', true).limit(200).get();
  const batch = db.batch();
  ts.forEach((t) => { if (t.id !== job.customerId) batch.set(db.collection(`notifications/${t.id}/items`).doc(),
    { type: 'new_job', from: 'system', matchId: '', text: `New job posted near you: $${job.suggestedPrice}`, read: false, createdAt: FieldValue.serverTimestamp() }); });
  await batch.commit();
});
