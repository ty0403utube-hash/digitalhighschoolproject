import {
  Auth,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from "firebase/auth";
import { getFirebaseApp } from "./firebaseApp";

let cachedAuth: Auth | null = null;

export function getFirebaseAuth() {
  if (cachedAuth) {
    return cachedAuth;
  }

  const app = getFirebaseApp();
  cachedAuth = getAuth(app);
  return cachedAuth;
}

export function subscribeToAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}

export async function loginWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return credential.user;
}

export async function signupWithEmail(email: string, password: string, name: string) {
  const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  if (name.trim()) {
    await updateProfile(credential.user, { displayName: name.trim() });
  }
  return credential.user;
}

export async function logoutFirebase() {
  await signOut(getFirebaseAuth());
}
