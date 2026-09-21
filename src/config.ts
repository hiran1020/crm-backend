function required(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3001'), 10),
  corsOrigin: optional('CORS_ORIGIN', 'http://localhost:5173'),

  // Firebase Admin SDK — service account JSON as a string
  firebaseServiceAccount: required('FIREBASE_SERVICE_ACCOUNT'),
  firebaseStorageBucket: optional('FIREBASE_STORAGE_BUCKET', 'crm-v1-d8854.firebasestorage.app'),
  firebaseProjectId: optional('FIREBASE_PROJECT_ID', 'crm-v1-d8854'),

  // Pre-signed URL expiry in seconds (Firebase Storage signed URLs)
  storagePresignExpiry: parseInt(optional('STORAGE_PRESIGN_EXPIRY', '900'), 10),

  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
