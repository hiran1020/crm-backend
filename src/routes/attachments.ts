import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { extname } from 'path'
import type { RelatedType } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { handlePrismaError } from '../lib/errors.js'
import { authenticate } from '../middleware/authenticate.js'
import { uploadFile, getDownloadUrl, deleteFile, localFilePath } from '../lib/storage.js'
import { createReadStream } from 'fs'
import { existsSync } from 'fs'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  // POST /api/v1/attachments/upload
  // Accepts multipart/form-data with fields: file, relatedTo, relatedType, relatedName
  app.post('/upload', { preHandler: authenticate }, async (request, reply) => {
    const parts = request.parts()
    let fileStream: AsyncIterable<Buffer> | null = null
    let filename = ''
    let mimeType = ''
    let relatedTo = ''
    let relatedType = ''

    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename
        mimeType = part.mimetype
        fileStream = part.file as AsyncIterable<Buffer>
      } else {
        const value = await part.value as string
        if (part.fieldname === 'relatedTo') relatedTo = value
        if (part.fieldname === 'relatedType') relatedType = value
      }
    }

    const validate = z.object({
      relatedTo: z.string().uuid(),
      relatedType: z.enum(['customer', 'lead', 'deal']),
      filename: z.string().min(1),
      mimeType: z.string().min(1),
    }).safeParse({ relatedTo, relatedType, filename, mimeType })

    if (!validate.success || !fileStream) {
      return reply.status(400).send({ error: 'Missing or invalid fields: file, relatedTo, relatedType required' })
    }

    const ext = extname(filename)
    const key = `${relatedType}/${relatedTo}/${randomUUID()}${ext}`

    try {
      const chunks: Buffer[] = []
      for await (const chunk of fileStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const buf = Buffer.concat(chunks)
      const sizeBytes = buf.byteLength

      const { Readable } = await import('stream')
      await uploadFile(key, Readable.from(buf), mimeType)

      const attachment = await prisma.attachment.create({
        data: {
          filename,
          mimeType,
          sizeBytes,
          storageKey: key,
          relatedTo,
          relatedType: relatedType as RelatedType,
          uploadedBy: request.user.id,
        },
      })
      return reply.status(201).send(attachment)
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })

  // GET /api/v1/attachments?relatedTo=:id&relatedType=customer
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const where: { relatedTo?: string; relatedType?: RelatedType } = {}
    if (q.relatedTo) where.relatedTo = q.relatedTo
    if (q.relatedType) where.relatedType = q.relatedType as RelatedType

    const attachments = await prisma.attachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
    return reply.send({ data: attachments })
  })

  // GET /api/v1/attachments/:id  — returns a pre-signed download URL
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const attachment = await prisma.attachment.findUnique({ where: { id } })
    if (!attachment) return reply.status(404).send({ error: 'Attachment not found' })

    const url = await getDownloadUrl(attachment.storageKey)
    return reply.send({ ...attachment, downloadUrl: url })
  })

  // GET /api/v1/attachments/local/:key  — serves files from local disk (dev only)
  app.get('/local/:key', async (request, reply) => {
    const { key } = request.params as { key: string }
    const decoded = decodeURIComponent(key)
    const filePath = localFilePath(decoded)

    if (!existsSync(filePath)) return reply.status(404).send({ error: 'File not found' })

    const attachment = await prisma.attachment.findFirst({ where: { storageKey: decoded } })
    const mimeType = attachment?.mimeType ?? 'application/octet-stream'

    return reply
      .header('Content-Type', mimeType)
      .header('Content-Disposition', `inline; filename="${attachment?.filename ?? decoded}"`)
      .send(createReadStream(filePath))
  })

  // DELETE /api/v1/attachments/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const attachment = await prisma.attachment.findUnique({ where: { id } })
    if (!attachment) return reply.status(404).send({ error: 'Attachment not found' })

    await deleteFile(attachment.storageKey)
    try {
      await prisma.attachment.delete({ where: { id } })
      return reply.status(204).send()
    } catch (err) {
      return handlePrismaError(err, reply) ?? reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
