// ============================================================================
// Firebase konfiguráció – Holland kocsma
// ============================================================================
// Ugyanazt a Firebase projektet használja, mint a Colorcards (lásd
// games/uno/firebase-config.js) – csak más Firestore kollekcióba írunk
// (lásd main.js: collection(db, 'hkRooms')), így a két játék szobái nem
// keverednek össze.
//
// Ha saját, külön Firebase projektet szeretnél ennek a játéknak, írd át az
// alábbi értékeket a Firebase konzolban kapott sajátodra, és ne felejtsd el
// a firestore.rules-ban is ehhez a projekthez publikálni a szabályokat.
// ============================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDjxWmXmbTX4UMbgYkq1IXZY41vMPoSqRg",
  authDomain: "gamecorner-3e716.firebaseapp.com",
  projectId: "gamecorner-3e716",
  storageBucket: "gamecorner-3e716.firebasestorage.app",
  messagingSenderId: "169802293526",
  appId: "1:169802293526:web:2a30997c7e6a002105f037"
};

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// getApps()/getApp() védelem: ha a felhasználó egy nap egyetlen közös
// firebase-config.js-t hozna létre több játékhoz, ne dobjon hibát a kétszeri
// initializeApp hívás.
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
