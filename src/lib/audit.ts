import { db, now } from './firebase.js'

type AuditAction = 'created' | 'updated' | 'deleted'

export async function writeAudit(opts: {
  entityType: string
  entityId: string
  action: AuditAction
  actorId?: string
  before?: unknown
  after?: unknown
}): Promise<void> {
  db.collection('audit_log').add({
    entityType: opts.entityType,
    entityId: opts.entityId,
    action: opts.action,
    actorId: opts.actorId ?? null,
    before: opts.before ?? null,
    after: opts.after ?? null,
    createdAt: now(),
  }).catch(() => {/* never fail a request over audit */})
}
