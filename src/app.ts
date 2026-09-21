import Fastify from 'fastify'
import { config } from './config.js'
import corsPlugin from './plugins/cors.js'
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

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
      transport: config.isDev
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // Core plugins
  await app.register(corsPlugin)

  // Health check (unauthenticated)
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

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
    }, { prefix: '/v1' })
  }, { prefix: '/api' })

  return app
}
