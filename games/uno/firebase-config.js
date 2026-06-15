// ============================================================================
// Firebase konfiguráció
// ============================================================================
// 1) Hozz létre egy ingyenes Firebase projektet: https://console.firebase.google.com
// 2) A projektben adj hozzá egy "Web" alkalmazást (</> ikon).
// 3) Másold ki az ott megjelenő `firebaseConfig` objektumot, és illeszd be ide,
//    felülírva az alábbi placeholder értékeket.
// 4) A Firebase konzolban hozz létre egy Firestore adatbázist
//    (Build → Firestore Database → Create database → Start in test mode,
//    vagy lásd a README-ben javasolt szabályokat).
//
// FONTOS: ezek az értékek NEM titkos kulcsok – a kliens oldali Firebase
// configot bárki látja, aki megnyitja az oldal forráskódját. A védelmet a
// Firestore Security Rules adja (lásd README), nem ez a fájl.
// ============================================================================

export const firebaseConfig = {
  apiKey: 'IDE_MASOLD_AZ_API_KEY-T',
  authDomain: 'PROJEKT_ID.firebaseapp.com',
  projectId: 'PROJEKT_ID',
  storageBucket: 'PROJEKT_ID.appspot.com',
  messagingSenderId: 'IDE_A_SENDER_ID',
  appId: 'IDE_AZ_APP_ID',
};

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
