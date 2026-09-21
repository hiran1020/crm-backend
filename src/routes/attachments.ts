import type { FastifyInstance, FastifyRequest } from 'fastify'
import '@fastify/multipart'
import { z } from 'zod'
import { db, toDocs, toDoc, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { uploadFile, getSignedUrl, deleteFile } from '../lib/storage.js'
import { writeAudit } from '../lib/audit.js'

const uploadBody = z.object({
  entityType: z.enum(['customer', 'lead', 'deal', 'ticket', 'quote']),
  entityId: z.string().min(1),
})

export async function attachmentsRoutes(app: FastifyInstance) {
  // POST /api/v1/attachments — multipart file upload
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const entityType = request.body ? (request.body as Record<string, { value: string }>).entityType?.value : undefined
    const entityId = request.body ? (request.body as Record<string, { value: string }>).entityId?.value : undefined

    const parsed = uploadBody.safeParse({ entityType, entityId })
    if (!parsed.success) {
      return reply.status(400).send({ error: 'entityType and entityId are required', issues: parsed.error.issues })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)

    const storagePath = `attachments/${parsed.data.entityType}/${parsed.data.entityId}/${Date.now()}_${data.filename}`
    const { path: uploadedPath, size } = await uploadFile(buffer, storagePath, data.mimetype)
    const url = await getSignedUrl(uploadedPath)

    const docRef = db.collection('attachments').doc()
    const attachment = {
      id: docRef.id,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      filename: data.filename,
      mimetype: data.mimetype,
      size,
      storagePath: uploadedPath,
      url,
      uploadedBy: request.user.id,
      createdAt: now(),
    }
    await docRef.set(attachment)
    writeAudit({ entityType: 'attachment', entityId: docRef.id, action: 'created', actorId: request.user.id, after: { filename: data.filename, size } })
    return reply.status(201).send(attachment)
  })

  // GET /api/v1/attachments?entityType=deal&entityId=xxx
  app.get('/', { preHandler: authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string>
    if (!q.entityId) return reply.status(400).send({ error: 'entityId is required' })

    let query = db.collection('attachments').where('entityId', '==', q.entityId) as FirebaseFirestore.Query
    if (q.entityType) query = query.where('entityType', '==', q.entityType)
    const snap = await query.orderBy('createdAt', 'desc').get()

    const docs = await Promise.all(
      snap.docs.map(async d => {
        const data = d.data()
        const freshUrl = await getSignedUrl(data.storagePath).catch(() => null)
        return { id: d.id, ...data, url: freshUrl ?? data.url }
      }),
    )
    return reply.send({ data: docs })
  })

  // GET /api/v1/attachments/:id — get signed URL (refresh)
  app.get('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('attachments').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Attachment not found' })
    const data = snap.data()!
    const url = await getSignedUrl(data.storagePath)
    return reply.send({ id: snap.id, ...data, url })
  })

  // DELETE /api/v1/attachments/:id
  app.delete('/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const snap = await db.collection('attachments').doc(id).get()
    if (!snap.exists) return reply.status(404).send({ error: 'Attachment not found' })
    const data = snap.data()!
    await Promise.all([
      deleteFile(data.storagePath).catch(() => {}),
      db.collection('attachments').doc(id).delete(),
    ])
    writeAudit({ entityType: 'attachment', entityId: id, action: 'deleted', actorId: request.user.id, before: { filename: data.filename } })
    return reply.status(204).send()
  })
}
