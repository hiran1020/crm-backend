import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { config } from '../config.js'

if (!getApps().length) {
  const serviceAccount = JSON.parse(config.firebaseServiceAccount)
  initializeApp({
    credential: cert(serviceAccount),
    storageBucket: config.firebaseStorageBucket,
  })
}

export const db = getFirestore()
export const auth = getAuth()
export const storage = getStorage()
export { FieldValue, Timestamp }

// ─── Firestore helpers ────────────────────────────────────────────────────────

export type DocData = FirebaseFirestore.DocumentData

/** Convert a Firestore document snapshot to a plain object with a stable `id`. */
export function toDoc<T extends DocData>(snap: FirebaseFirestore.DocumentSnapshot): T | null {
  if (!snap.exists) return null
  return { id: snap.id, ...snap.data() } as unknown as T
}

/** Convert a Firestore query snapshot to an array of plain objects. */
export function toDocs<T extends DocData>(snap: FirebaseFirestore.QuerySnapshot): T[] {
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as T))
}

/** Get count of a query without fetching documents. */
export async function countQuery(query: FirebaseFirestore.Query): Promise<number> {
  const agg = await query.count().get()
  return agg.data().count
}

/** Server timestamps for create/update operations. */
export const now = () => FieldValue.serverTimestamp()
