# Truck With The Guy: deploy guide

A real, installable web app (PWA): Firebase Auth (email + password), Firestore with strict security rules, and Firebase Hosting. Runs on the **free Spark plan**.

## What's done
- `public/`: the full app (customer + trucker sign-up, job posting with city/range check, time blocks and market pricing, trucker job board with claim and counter-offer, trucker list with invites, match confirmation by both sides, in-app chat, payment handles revealed only after a confirmed match, ratings, in-app notification inbox, free launch week banner, a subscription-lock flag and an admin page).
- `firestore.rules`: enforces every privacy and money rule server-side.
- `tests/`: 19 rules and flow tests plus a full browser E2E, all passing on the Firebase emulators.
- `functions/`: email notifications (Brevo). Optional, and needs the Blaze plan (see below).

## One-time setup (~10 minutes, needs a Google account)
1. Go to https://console.firebase.google.com → **Add project** → name it e.g. `truck-with-the-guy` (Google Analytics: off). Free Spark plan, no card.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** → Production mode → location `nam5 (us-central)`.
4. **Project settings (gear) → Your apps → Web (</>)** → register the app "web". Copy the `firebaseConfig` values (apiKey, authDomain, projectId, appId) into `public/config.js`, and put the project ID in `.firebaserc`.
   *(These 4 values are public by design and not secrets.)*
5. On a computer with Node 20+: `npm i -g firebase-tools` → `firebase login` (sign in with your Google account once) → in this folder: **`firebase deploy`**
   This deploys Hosting + Firestore rules + indexes. The app is live at `https://<project-id>.web.app`.
6. Open the app, sign up as yourself, then in the console **Firestore → Start collection `admins`** → Document ID = your user UID (Authentication tab) → any field (e.g. `role: "owner"`). Reload the app, open **⚙️ Admin** and click **Save config**. This creates the launch date, free days and cities (Chattanooga active).

## Email notifications (optional; the in-app inbox works without them)
Cloud Functions need the **Blaze plan** (a card on file; pilot usage stays within the free quota, so normally $0/month; set a $1 budget alert).
1. Create a free **Brevo** account (300 emails/day) and get an API key.
2. Use a sender on **your own domain** (Brevo can't authenticate gmail.com, so Gmail-sender emails land in spam). A domain is about $10–12/year.
3. `firebase functions:secrets:set BREVO_API_KEY` · then `firebase deploy --config firebase.blaze.json` and set `SENDER_EMAIL` and `APP_URL` when prompted.
Emails contain no contact info, only "A trucker found your job" etc. plus an "Open the app" link.

## Run the tests locally
`cd tests && npm install && npm test` (rules + flows) · `npm run test:e2e` (headless Chrome UI test). Needs Java 11+ for the emulators.

## Local preview with emulators
`cd tests && npx firebase emulators:start --only auth,firestore,hosting --project demo-truckguy --config ../firebase.json` → open http://localhost:5000/?emu=1
