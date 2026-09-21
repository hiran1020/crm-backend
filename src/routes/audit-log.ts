import type { FastifyInstance } from 'fastify'
import type { AuditAction, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
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
      const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize ?? '50', 10)))
      const skip = (page - 1) * pageSize

      const where: Prisma.AuditLogWhereInput = {}
      if (q.entityType) where.entityType = q.entityType
      if (q.entityId)   where.entityId   = q.entityId
      if (q.actorId)    where.actorId    = q.actorId
      if (q.action)     where.action     = q.action as AuditAction
      if (q.from)       where.createdAt  = { ...((where.createdAt as object) ?? {}), gte: new Date(q.from) }
      if (q.to)         where.createdAt  = { ...((where.createdAt as object) ?? {}), lte: new Date(q.to) }

      const [data, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          include: { actor: { select: { id: true, name: true, avatarInitials: true } } },
          skip,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.auditLog.count({ where }),
      ])

      return reply.send({ data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
    },
  )
}
