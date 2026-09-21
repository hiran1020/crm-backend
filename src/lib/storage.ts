import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createWriteStream, createReadStream, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { config } from '../config.js'

const USE_S3 = Boolean(config.s3Bucket)

// ─── S3 client (also works for R2/MinIO via s3Endpoint) ──────────────────────

let s3: S3Client | null = null
if (USE_S3) {
  s3 = new S3Client({
    region: config.s3Region,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
  })
}

// ─── Local fallback ───────────────────────────────────────────────────────────

const LOCAL_DIR = join(process.cwd(), 'uploads')
if (!USE_S3 && !existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true })

// ─── Public API ───────────────────────────────────────────────────────────────

export async function uploadFile(
  key: string,
  stream: NodeJS.ReadableStream,
  mimeType: string,
): Promise<void> {
  if (USE_S3 && s3) {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    await s3.send(new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }))
  } else {
    await pipeline(stream, createWriteStream(join(LOCAL_DIR, key)))
  }
}

export async function getDownloadUrl(key: string): Promise<string> {
  if (USE_S3 && s3) {
    return getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
      { expiresIn: config.s3PresignExpiry },
    )
  }
  // For local dev, point to a static serve route
  return `/api/v1/attachments/local/${encodeURIComponent(key)}`
}

export async function deleteFile(key: string): Promise<void> {
  if (USE_S3 && s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }))
  } else {
    const { unlink } = await import('fs/promises')
    await unlink(join(LOCAL_DIR, key)).catch(() => {/* already gone */})
  }
}

export function localFilePath(key: string) {
  return join(LOCAL_DIR, key)
}
