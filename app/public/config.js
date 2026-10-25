// Paste your Firebase web app config here (Firebase console → Project settings → Your apps → Web app).
// These values are public by design; security comes from firestore.rules.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  appId: "PASTE_APP_ID",
};
// Local testing: http://localhost:5000/?emu=1 talks to the Firebase emulators instead.
export const USE_EMULATORS = new URLSearchParams(location.search).has('emu') || localStorage.getItem('emu') === '1';
