function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

const isEmulator = process.env.FIREBASE_EMULATOR === 'true'

export const config = {
  nodeEnv:    optional('NODE_ENV', 'development'),
  port:       parseInt(optional('PORT', '3001'), 10),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  isEmulator,

  // Service account JSON — not required when running against local emulators
  firebaseServiceAccount: isEmulator ? '' : required('FIREBASE_SERVICE_ACCOUNT'),
  firebaseStorageBucket:  optional('FIREBASE_STORAGE_BUCKET', 'crm-v1-d8854.firebasestorage.app'),
  firebaseProjectId:      optional('FIREBASE_PROJECT_ID', 'crm-v1-d8854'),

  storagePresignExpiry: parseInt(optional('STORAGE_PRESIGN_EXPIRY', '900'), 10),

  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
