# Truck With The Guy

Need a couch, dresser, appliance or junk moved? Get a full-size pickup plus a guy to lift: store pickups, Marketplace finds, small moves and junk runs. Customers post a job (city and range check, time blocks, market pricing); truckers claim it or counter-offer; both sides confirm the match, chat in the app, and payment handles are revealed only after a confirmed match. Ratings, notification inbox, launch-week banner and an admin page.

## Demo (GitHub Pages)
`index.html` at the top of this repo is a self-contained clickable demo (customer and trucker views, pricing, job board). Data stays in your browser.

## Real app source (`app/`)
An installable PWA on Firebase (Auth + Firestore + Hosting, free Spark plan):
- `app/public/` – the app (`app.js`, `core.js`, `config.js`, styles, manifest, service worker)
- `app/firestore.rules`, `app/firestore.indexes.json` – server-side privacy and money rules
- `app/functions/` – optional email notifications (Brevo; needs the Blaze plan)
- `app/tests/` – rules, flow and browser E2E tests (run on the Firebase emulators)
- `app/DEPLOY.md` – step-by-step deploy guide

`app/public/config.js` and `app/.firebaserc` hold placeholders. Paste your own Firebase project's web config to deploy. No keys are included. `app/` is not served by GitHub Pages as a working app because it needs Firebase.

Created by Walter Henderson Jr.
