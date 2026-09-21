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

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
  jwtRefreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),

  // Storage (S3 / R2) — optional; falls back to local disk when unset
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3Region: optional('S3_REGION', 'us-east-1'),
  s3Endpoint: process.env.S3_ENDPOINT ?? '',          // set for R2 / MinIO
  s3PresignExpiry: parseInt(optional('S3_PRESIGN_EXPIRY', '900'), 10), // seconds

  // Redis — required only for the BullMQ worker process
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
