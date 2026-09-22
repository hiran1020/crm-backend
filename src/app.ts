import { readFileSync } from 'fs'
import Fastify from 'fastify'
import { config } from './config.js'
import corsPlugin from './plugins/cors.js'

const docsHtml = readFileSync(new URL('./public/api-docs.html', import.meta.url))
import { authRoutes } from './routes/auth.js'
import { usersRoutes } from './routes/users.js'
import { customersRoutes } from './routes/customers.js'
import { leadsRoutes } from './routes/leads.js'
import { dealsRoutes } from './routes/deals.js'
import { activitiesRoutes } from './routes/activities.js'
import { ticketsRoutes } from './routes/tickets.js'
import { tagsRoutes } from './routes/tags.js'
import { notificationsRoutes } from './routes/notifications.js'
import { analyticsRoutes } from './routes/analytics.js'
import { quotesRoutes } from './routes/quotes.js'
import { customFieldsRoutes } from './routes/custom-fields.js'
import { segmentsRoutes } from './routes/segments.js'
import { workflowsRoutes } from './routes/workflows.js'
import { auditLogRoutes } from './routes/audit-log.js'
import { webhooksRoutes } from './routes/webhooks.js'
import { attachmentsRoutes } from './routes/attachments.js'
import { bulkImportRoutes } from './routes/bulk-import.js'

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
      transport: config.isDev
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // Allow DELETE/PUT/PATCH requests that send Content-Type: application/json with no body.
  // Fastify 5 throws FST_ERR_CTP_EMPTY_JSON_BODY for these by default.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) { done(null, {}); return }
    try { done(null, JSON.parse(body as string)) }
    catch (err) { done(err as Error, undefined) }
  })

  // Core plugins
  await app.register(corsPlugin)

  // API docs — interactive reference served at /docs
  app.get('/docs', async (_req, reply) => {
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(docsHtml)
  })

  // Health check — probes Firestore and Firebase Auth
  app.get('/health', async (_req, reply) => {
    const { db, auth } = await import('./lib/firebase.js')
    const checks: Record<string, 'ok' | string> = {}

    await db.collection('_health').limit(1).get()
      .then(() => { checks.firestore = 'ok' })
      .catch((e: Error) => { checks.firestore = e.message })

    await auth.listUsers(1)
      .then(() => { checks.firebaseAuth = 'ok' })
      .catch((e: Error) => { checks.firebaseAuth = e.message })

    const healthy = Object.values(checks).every(v => v === 'ok')
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    })
  })

  // API routes
  await app.register(async (api) => {
    await api.register(async (v1) => {
      await v1.register(authRoutes,          { prefix: '/auth' })
      await v1.register(usersRoutes,         { prefix: '/users' })
      await v1.register(customersRoutes,     { prefix: '/customers' })
      await v1.register(leadsRoutes,         { prefix: '/leads' })
      await v1.register(dealsRoutes,         { prefix: '/deals' })
      await v1.register(activitiesRoutes,    { prefix: '/activities' })
      await v1.register(ticketsRoutes,       { prefix: '/tickets' })
      await v1.register(tagsRoutes,          { prefix: '/tags' })
      await v1.register(quotesRoutes,        { prefix: '/quotes' })
      await v1.register(customFieldsRoutes,  { prefix: '/custom-fields' })
      await v1.register(segmentsRoutes,      { prefix: '/segments' })
      await v1.register(workflowsRoutes,     { prefix: '/workflows' })
      await v1.register(auditLogRoutes,      { prefix: '/audit-log' })
      await v1.register(webhooksRoutes,      { prefix: '/webhooks' })
      await v1.register(attachmentsRoutes,   { prefix: '/attachments' })
      await v1.register(notificationsRoutes, { prefix: '/notifications' })
      await v1.register(analyticsRoutes,     { prefix: '/analytics' })
      await v1.register(bulkImportRoutes,   { prefix: '/bulk-import' })
    }, { prefix: '/v1' })
  }, { prefix: '/api' })

  return app
}
