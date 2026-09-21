import type { FastifyInstance } from 'fastify'
import { db, toDocs, countQuery } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

export async function auditLogRoutes(app: FastifyInstance) {
  // GET /api/v1/audit-log
  app.get(
    '/',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const q = request.query as Record<string, string>
      const page = Math.max(1, parseInt(q.page ?? '1', 10))
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '20', 10)))

      let query = db.collection('audit_log') as FirebaseFirestore.Query
      if (q.entityType) query = query.where('entityType', '==', q.entityType)
      if (q.entityId)   query = query.where('entityId', '==', q.entityId)
      if (q.actorId)    query = query.where('actorId', '==', q.actorId)
      if (q.action)     query = query.where('action', '==', q.action)

      const total = await countQuery(query)
      const snap = await query.orderBy('createdAt', 'desc').offset((page - 1) * pageSize).limit(pageSize).get()

      return reply.send({
        data: toDocs(snap),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      })
    },
  )

  // GET /api/v1/audit-log/:id
  app.get(
    '/:id',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const snap = await db.collection('audit_log').doc(id).get()
      if (!snap.exists) return reply.status(404).send({ error: 'Audit log entry not found' })
      return reply.send({ id: snap.id, ...snap.data() })
    },
  )
}
