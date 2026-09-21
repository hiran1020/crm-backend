import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { config } from '../config.js'

// Point the Admin SDK to local emulators BEFORE any Firebase getter is called.
// isEmulator (FIREBASE_EMULATOR=true)  → full emulator stack including Auth
// isLocalMode (FIREBASE_EMULATOR=local) → Firestore + Storage only; Auth stays real
if (config.needsDataEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST       = process.env.FIRESTORE_EMULATOR_HOST       ?? 'localhost:8080'
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? 'localhost:9199'
}
if (config.isEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
}

if (!getApps().length) {
  if (config.isEmulator) {
    // Full emulator: no credentials required
    initializeApp({ projectId: config.firebaseProjectId, storageBucket: config.firebaseStorageBucket })
  } else {
    // Real Firebase Auth (local or prod): service account required for Admin SDK
    initializeApp({
      credential: cert(JSON.parse(config.firebaseServiceAccount)),
      storageBucket: config.firebaseStorageBucket,
    })
  }
}

export const db      = getFirestore()
export const auth    = getAuth()
export const storage = getStorage()
export { FieldValue, Timestamp }

// ─── Firestore helpers ────────────────────────────────────────────────────────

export type DocData = FirebaseFirestore.DocumentData

export function toDoc<T extends DocData>(snap: FirebaseFirestore.DocumentSnapshot): T | null {
  if (!snap.exists) return null
  return { id: snap.id, ...snap.data() } as unknown as T
}

export function toDocs<T extends DocData>(snap: FirebaseFirestore.QuerySnapshot): T[] {
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as T))
}

export async function countQuery(query: FirebaseFirestore.Query): Promise<number> {
  const agg = await query.count().get()
  return agg.data().count
}

export const now = () => FieldValue.serverTimestamp()
