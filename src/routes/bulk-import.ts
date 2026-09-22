import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { db, now } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'
import { writeAudit } from '../lib/audit.js'

// ─── Job store (in-memory, per-process) ──────────────────────────────────────

interface ImportError { index: number; identifier: string; message: string }

interface JobState {
  resource: string
  total: number
  processed: number
  succeeded: number
  errors: ImportError[]
  status: 'running' | 'done'
  startedAt: number
}

const jobs = new Map<string, JobState>()

// Purge jobs older than 2 hours to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1_000
  for (const [id, job] of jobs) if (job.startedAt < cutoff) jobs.delete(id)
}, 30 * 60 * 1_000)

// ─── Record schemas (lenient — owner info filled from the authed user) ────────

const customerRecord = z.object({
  firstName:  z.string().trim().min(1),
  lastName:   z.string().trim().min(1),
  email:      z.string().email(),
  phone:      z.string().default(''),
  company:    z.string().trim().default(''),
  jobTitle:   z.string().trim().default(''),
  status:     z.enum(['Active', 'Inactive']).default('Active'),
})

const leadRecord = z.object({
  name:    z.string().trim().min(1),
  company: z.string().trim().min(1),
  email:   z.string().email(),
  phone:   z.string().default(''),
  source:  z.enum(['Website', 'Referral', 'Trade_Show', 'Cold_Call', 'Email_Campaign', 'Social_Media', 'Partner']).default('Website'),
  status:  z.enum(['New', 'Contacted', 'Qualified', 'Lost', 'Converted']).default('New'),
  value:   z.number().min(0).default(0),
})

const dealRecord = z.object({
  title:           z.string().trim().min(1),
  customerId:      z.string().default(''),
  customerName:    z.string().default(''),
  customerCompany: z.string().default(''),
  amount:          z.number().min(0).default(0),
  stage:           z.enum(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']).default('New'),
  expectedCloseDate: z.string().default(''),
  description:     z.string().optional(),
  probability:     z.number().int().min(0).max(100).optional(),
})

const activityRecord = z.object({
  type:        z.enum(['call', 'email', 'meeting', 'note', 'task']),
  title:       z.string().trim().min(1),
  description: z.string().optional(),
  completed:   z.boolean().default(false),
  priority:    z.enum(['low', 'medium', 'high']).optional(),
  relatedTo:   z.string().optional(),
  relatedType: z.enum(['customer', 'lead', 'deal']).optional(),
  relatedName: z.string().optional(),
  dueDate:     z.preprocess(
    v => (v == null || v === '' ? undefined : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v),
    z.string().datetime({ offset: true }).optional(),
  ),
})

const ticketRecord = z.object({
  subject:      z.string().trim().min(1),
  customerId:   z.string().optional(),
  customerName: z.string().optional(),
  status:       z.enum(['Open', 'In_Progress', 'Resolved', 'Closed']).default('Open'),
  priority:     z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
  channel:      z.enum(['email', 'phone', 'chat', 'web']).optional(),
})

const importBody = z.object({
  resource: z.enum(['customers', 'leads', 'deals', 'activities', 'tickets']),
  records:  z.array(z.record(z.unknown())).min(1).max(1000),
})

// ─── Background processor ─────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)
}

type Resource = 'customers' | 'leads' | 'deals' | 'activities' | 'tickets'

async function processJob(
  jobId: string,
  resource: Resource,
  records: Record<string, unknown>[],
  user: { id: string; name: string },
) {
  const job = jobs.get(jobId)!
  const ownerInitials = initials(user.name)

  for (let i = 0; i < records.length; i++) {
    const raw = records[i]
    try {
      const docRef = db.collection(resource).doc()

      if (resource === 'customers') {
        const data = customerRecord.parse(raw)
        await docRef.set({
          id: docRef.id, ...data,
          ownerId: user.id, ownerName: user.name,
          ownerInitials: `${data.firstName[0]}${data.lastName[0]}`.toUpperCase(),
          tagIds: [], createdAt: now(), updatedAt: now(),
        })
        writeAudit({ entityType: 'customer', entityId: docRef.id, action: 'created', actorId: user.id, after: data })

      } else if (resource === 'leads') {
        const data = leadRecord.parse(raw)
        await docRef.set({
          id: docRef.id, ...data,
          ownerId: user.id, ownerName: user.name, ownerInitials,
          tagIds: [], createdAt: now(), updatedAt: now(),
        })
        writeAudit({ entityType: 'lead', entityId: docRef.id, action: 'created', actorId: user.id, after: data })

      } else if (resource === 'deals') {
        const data = dealRecord.parse(raw)
        await docRef.set({
          id: docRef.id, ...data,
          ownerId: user.id, ownerName: user.name, ownerInitials,
          createdAt: now(), updatedAt: now(),
        })
        writeAudit({ entityType: 'deal', entityId: docRef.id, action: 'created', actorId: user.id, after: data })

      } else if (resource === 'activities') {
        const data = activityRecord.parse(raw)
        await docRef.set({
          id: docRef.id, ...data,
          owner: raw['owner'] ?? user.name,
          createdAt: now(), updatedAt: now(),
        })

      } else if (resource === 'tickets') {
        const data = ticketRecord.parse(raw)
        await docRef.set({
          id: docRef.id, ...data,
          assigneeId: user.id, assigneeName: user.name,
          tags: [], createdAt: now(), updatedAt: now(),
        })
      }

      job.succeeded++
    } catch (err) {
      const identifier = String(raw['email'] ?? raw['name'] ?? raw['title'] ?? raw['subject'] ?? `row ${i + 1}`)
      const message = err instanceof Error
        ? (err.message.length > 120 ? err.message.slice(0, 120) + '…' : err.message)
        : String(err)
      job.errors.push({ index: i, identifier, message })
    }

    job.processed++
  }

  job.status = 'done'
}

// ─── Route snapshot helper ────────────────────────────────────────────────────

function snapshot(jobId: string, job: JobState) {
  return {
    jobId,
    resource:  job.resource,
    total:     job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed:    job.errors.length,
    errors:    job.errors,
    status:    job.status,
    pct:       job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0,
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function bulkImportRoutes(app: FastifyInstance) {
  // POST /api/v1/bulk-import
  // Kicks off a background import job, returns { jobId } immediately (202).
  app.post('/', { preHandler: authenticate }, async (request, reply) => {
    const result = importBody.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: result.error.issues })
    }

    const { resource, records } = result.data
    const jobId = randomUUID()

    jobs.set(jobId, {
      resource,
      total:     records.length,
      processed: 0,
      succeeded: 0,
      errors:    [],
      status:    'running',
      startedAt: Date.now(),
    })

    // Fire-and-forget — client tracks progress via SSE or polling
    processJob(jobId, resource, records as Record<string, unknown>[], request.user)
      .catch(err => {
        const job = jobs.get(jobId)
        if (job) { job.status = 'done'; job.errors.push({ index: -1, identifier: 'job', message: String(err) }) }
      })

    return reply.status(202).send({ jobId, total: records.length })
  })

  // GET /api/v1/bulk-import/:jobId/progress  — SSE stream
  // Sends a "progress" event every 300 ms, then a "done" event and closes.
  app.get('/:jobId/progress', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const job = jobs.get(jobId)
    if (!job) return reply.status(404).send({ error: 'Import job not found' })

    const raw = reply.raw
    raw.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const send = (evt: string, data: object) => {
      raw.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    // Send initial state immediately
    send('progress', snapshot(jobId, job))

    if (job.status === 'done') {
      send('done', snapshot(jobId, job))
      raw.end()
      return
    }

    const timer = setInterval(() => {
      const current = jobs.get(jobId)
      if (!current) { clearInterval(timer); raw.end(); return }

      send('progress', snapshot(jobId, current))

      if (current.status === 'done') {
        send('done', snapshot(jobId, current))
        clearInterval(timer)
        raw.end()
      }
    }, 300)

    request.raw.once('close', () => clearInterval(timer))

    // Hold the handler open until the client disconnects
    await new Promise<void>(resolve => request.raw.once('close', resolve))
  })

  // GET /api/v1/bulk-import/:jobId  — polling fallback (plain JSON)
  app.get('/:jobId', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const job = jobs.get(jobId)
    if (!job) return reply.status(404).send({ error: 'Import job not found' })
    return reply.send(snapshot(jobId, job))
  })

  // GET /api/v1/bulk-import/:jobId/errors.csv  — download error log as CSV
  app.get('/:jobId/errors.csv', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const job = jobs.get(jobId)
    if (!job) return reply.status(404).send({ error: 'Import job not found' })

    const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`

    const lines = [
      ['row', 'identifier', 'error'].join(','),
      ...job.errors.map(e =>
        [e.index + 1, csvEscape(e.identifier), csvEscape(e.message)].join(',')
      ),
    ]

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="import-errors-${jobId}.csv"`)
      .send(lines.join('\r\n'))
  })
}
