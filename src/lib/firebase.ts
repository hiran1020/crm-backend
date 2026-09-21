import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { config } from '../config.js'

// Point the Admin SDK to local emulators BEFORE any Firebase getter is called
if (config.isEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     ?? 'localhost:8080'
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? 'localhost:9099'
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? 'localhost:9199'
}

if (!getApps().length) {
  if (config.isEmulator) {
    // Emulator mode: no credentials required
    initializeApp({ projectId: config.firebaseProjectId, storageBucket: config.firebaseStorageBucket })
  } else {
    // Production: use service account JSON from env
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
