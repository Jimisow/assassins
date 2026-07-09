// Configuration Firebase partagee par tous les ecrans (SDK modulaire v9+, charge depuis le CDN).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBiGDCR2wndHaImxazBaWX76IuU9AN-wMM",
  authDomain: "loup-garou-e5fd5.firebaseapp.com",
  projectId: "loup-garou-e5fd5",
  storageBucket: "loup-garou-e5fd5.firebasestorage.app",
  messagingSenderId: "219967614045",
  appId: "1:219967614045:web:d66f29210e72a1833871b4",
};

const app = initializeApp(firebaseConfig);
// Auto-detection du long-polling : certains reseaux (proxys, wifi restrictif,
// certains reseaux mobiles) bloquent le streaming WebChannel de Firestore et
// provoquent des ecritures/lectures temps reel silencieusement incoherentes.
// Ce mode detecte automatiquement ce cas et bascule sur du long-polling fiable.
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
const auth = getAuth(app);

// Authentification anonyme Firebase : chaque appareil obtient un identifiant
// (`uid`) stable et infalsifiable cote serveur, au lieu d'un UUID genere par
// le client et stocke dans localStorage (que n'importe qui pouvait modifier
// depuis la console du navigateur pour usurper un autre joueur/l'hote). Les
// regles Firestore (`firestore.rules`) s'appuient sur ce `uid` pour verifier
// qui a le droit d'ecrire quoi. `ensureSignedIn()` est appele avant toute
// operation Firestore sensible (creation/connexion a un salon).
let signInPromise = null;
export function ensureSignedIn() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  if (!signInPromise) {
    signInPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          resolve(user.uid);
        }
      }, reject);
      signInAnonymously(auth).catch((err) => {
        unsub();
        reject(err);
      });
    });
  }
  return signInPromise;
}

export {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  runTransaction,
  serverTimestamp,
  writeBatch,
};
