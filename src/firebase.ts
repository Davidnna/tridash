import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  type ActionCodeSettings,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyDXO7DEBPT_L868asqyae639sabQobQoAo',
  authDomain: 'tridash-e2a63.firebaseapp.com',
  projectId: 'tridash-e2a63',
  storageBucket: 'tridash-e2a63.firebasestorage.app',
  messagingSenderId: '764181163795',
  appId: '1:764181163795:web:43f83bf454e8dd5ed6b4e6',
  measurementId: 'G-DHH44PCWCN'
};

const app = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);

export async function signInWithFirebase(email: string, password: string) {
  return (await signInWithEmailAndPassword(firebaseAuth, email, password)).user;
}

const emailActionSettings: ActionCodeSettings = {
  url: window.location.origin + '/?verified=1',
  handleCodeInApp: false
};

export async function signUpWithFirebase(name: string, email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
  await sendEmailVerification(credential.user, emailActionSettings);
  return credential.user;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return (await signInWithPopup(firebaseAuth, provider)).user;
}

export async function sendResetEmail(email: string) {
  await sendPasswordResetEmail(firebaseAuth, email, emailActionSettings);
}

export async function resendVerification(user: User) {
  await sendEmailVerification(user, emailActionSettings);
}

export async function refreshFirebaseUser(user: User) {
  await user.reload();
  await user.getIdToken(true);
  return firebaseAuth.currentUser;
}

export { onAuthStateChanged, signOut };
