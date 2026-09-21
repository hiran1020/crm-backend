import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp, AggregateField } from 'firebase-admin/firestore'
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
db.settings({ ignoreUndefinedProperties: true })
export const auth    = getAuth()
export const storage = getStorage()
export { FieldValue, Timestamp, AggregateField }

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

// Convert a Firestore Timestamp (or anything timestamp-shaped) to ms for sorting.
function tsMs(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function')
    return (v as { toMillis(): number }).toMillis()
  if (typeof v === 'object' && typeof (v as { seconds?: unknown }).seconds === 'number')
    return (v as { seconds: number }).seconds * 1000
  if (typeof v === 'number') return v
  return 0
}

/**
 * Paginated list that avoids composite-index requirements.
 *
 * - No filters → orderBy in Firestore (uses single-field auto-index, fast).
 * - Any filter  → apply all where clauses without orderBy, sort in memory.
 *   Multiple equality filters work via Firestore's index merging without a
 *   composite index, as long as there's no orderBy on a different field.
 */
export async function pagedList<T extends DocData>(opts: {
  query: FirebaseFirestore.Query
  hasFilters: boolean
  orderField: string
  orderDir?: 'asc' | 'desc'
  page: number
  pageSize: number
  /** Applied in-memory after sorting, before pagination — enables cross-page search without composite indexes */
  inMemoryFilter?: (item: T) => boolean
}): Promise<{ data: T[]; total: number }> {
  const { query, hasFilters, orderField, orderDir = 'desc', page, pageSize, inMemoryFilter } = opts

  if (hasFilters || inMemoryFilter) {
    const snap = await query.get()
    let all = (snap.docs.map(d => ({ id: d.id, ...d.data() })) as unknown as T[]).sort((a, b) => {
      const av = tsMs((a as Record<string, unknown>)[orderField])
      const bv = tsMs((b as Record<string, unknown>)[orderField])
      return orderDir === 'desc' ? bv - av : av - bv
    })
    if (inMemoryFilter) all = all.filter(inMemoryFilter)
    const start = (page - 1) * pageSize
    return { data: all.slice(start, start + pageSize), total: all.length }
  }

  const dataQ = query.orderBy(orderField, orderDir).offset((page - 1) * pageSize).limit(pageSize)
  const [total, snap] = await Promise.all([countQuery(query), dataQ.get()])
  return { data: snap.docs.map(d => ({ id: d.id, ...d.data() })) as unknown as T[], total }
}

export const now = () => FieldValue.serverTimestamp()
