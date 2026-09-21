import { prisma } from './prisma.js'
import type { AuditAction } from '@prisma/client'

export async function writeAudit(opts: {
  entityType: string
  entityId: string
  action: AuditAction
  actorId?: string
  before?: unknown
  after?: unknown
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      entityType: opts.entityType,
      entityId: opts.entityId,
      action: opts.action,
      actorId: opts.actorId ?? null,
      before: opts.before != null ? (opts.before as object) : undefined,
      after: opts.after != null ? (opts.after as object) : undefined,
    },
  }).catch(() => {/* never fail a request over audit */})
}
