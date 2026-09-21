function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

// FIREBASE_EMULATOR=true   → full local emulators (Auth + Firestore + Storage)
// FIREBASE_EMULATOR=local  → Firestore/Storage emulator only; Auth uses real Firebase
//                            (use when frontend authenticates via real Firebase)
const emulatorMode = process.env.FIREBASE_EMULATOR ?? ''
const isEmulator        = emulatorMode === 'true'
const isLocalMode       = emulatorMode === 'local'
const needsDataEmulator = isEmulator || isLocalMode

export const config = {
  nodeEnv:    optional('NODE_ENV', 'development'),
  port:       parseInt(optional('PORT', '3001'), 10),
  corsOrigin: optional('CORS_ORIGIN', ''),   // empty = handled dynamically in cors.ts

  isEmulator,
  isLocalMode,
  needsDataEmulator,

  // Service account JSON — not required when Firestore/Auth are both emulated
  firebaseServiceAccount: isEmulator ? '' : required('FIREBASE_SERVICE_ACCOUNT'),
  firebaseStorageBucket:  optional('FIREBASE_STORAGE_BUCKET', 'crm-v1-d8854.firebasestorage.app'),
  firebaseProjectId:      optional('FIREBASE_PROJECT_ID', 'crm-v1-d8854'),

  storagePresignExpiry: parseInt(optional('STORAGE_PRESIGN_EXPIRY', '900'), 10),

  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
