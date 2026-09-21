import { storage } from './firebase.js'
import { config } from '../config.js'

export async function uploadFile(
  buffer: Buffer,
  key: string,
  mimeType: string,
): Promise<{ path: string; size: number }> {
  const bucket = storage.bucket()
  const file = bucket.file(key)
  await file.save(buffer, { metadata: { contentType: mimeType } })
  return { path: key, size: buffer.length }
}

export async function getSignedUrl(key: string): Promise<string> {
  const bucket = storage.bucket()
  const file = bucket.file(key)
  const expires = Date.now() + config.storagePresignExpiry * 1000
  const [url] = await file.getSignedUrl({ action: 'read', expires })
  return url
}

export async function deleteFile(key: string): Promise<void> {
  const bucket = storage.bucket()
  const file = bucket.file(key)
  await file.delete({ ignoreNotFound: true })
}
