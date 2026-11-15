import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, browserSessionPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth,
  signInAnonymously, type User,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

// Ces valeurs ne sont pas secrètes : l'accès est protégé par firebase/firestore.rules.
const firebaseConfig = {
  apiKey: "AIzaSyAbODqTf-41dvkju_flU9VRmKxOEhtiCvI",
  authDomain: "tokards-b174f.firebaseapp.com",
  projectId: "tokards-b174f",
  storageBucket: "tokards-b174f.firebasestorage.app",
  messagingSenderId: "192330628151",
  appId: "1:192330628151:web:d22e67684ad6058e8053b2",
};

/** `?joueur=2` dans l'URL : identité séparée pour cet onglet (tester à plusieurs sur un seul PC). */
export const TEST_SLOT = new URLSearchParams(location.search).get("joueur") ?? "";

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: TEST_SLOT ? browserSessionPersistence : [indexedDBLocalPersistence, browserLocalPersistence],
});
export const db = getFirestore(app);

// `npm run dev -- --mode emulator` pour jouer en local sans toucher à la vraie base.
if (import.meta.env.MODE === "emulator") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

/** Reprend la session anonyme existante, ou en crée une. */
export async function ensureSignedIn(): Promise<User> {
  await auth.authStateReady();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
}
