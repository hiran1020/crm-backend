import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/authenticate.js'

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /api/v1/analytics/pipeline
  // Returns deal counts and total value grouped by stage
  app.get('/pipeline', { preHandler: authenticate }, async (_request, reply) => {
    const rows = await prisma.deal.groupBy({
      by: ['stage'],
      _count: { id: true },
      _sum: { amount: true },
    })

    const data = rows.map(r => ({
      stage: r.stage,
      count: r._count.id,
      value: r._sum.amount ?? 0,
    }))

    return reply.send({ data })
  })

  // GET /api/v1/analytics/revenue
  // Won deal revenue grouped by month (last 12 months)
  app.get('/revenue', { preHandler: authenticate }, async (_request, reply) => {
    const rows = await prisma.$queryRaw<{ month: string; revenue: number }[]>`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        COALESCE(SUM(amount), 0)::float                      AS revenue
      FROM deals
      WHERE stage = 'Won'
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `

    return reply.send({ data: rows })
  })

  // GET /api/v1/analytics/activities
  // Activity counts grouped by type (last 30 days)
  app.get('/activities', { preHandler: authenticate }, async (_request, reply) => {
    const rows = await prisma.activity.groupBy({
      by: ['type'],
      where: {
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      _count: { id: true },
    })

    const data = rows.map(r => ({ type: r.type, count: r._count.id }))
    return reply.send({ data })
  })

  // GET /api/v1/analytics/overview
  // High-level KPIs for the dashboard header
  app.get('/overview', { preHandler: authenticate }, async (_request, reply) => {
    const [
      totalCustomers,
      activeLeads,
      openDeals,
      openDealsValue,
      wonThisMonth,
      wonThisMonthValue,
      openTickets,
    ] = await prisma.$transaction([
      prisma.customer.count({ where: { status: 'Active' } }),
      prisma.lead.count({ where: { status: { notIn: ['Lost', 'Converted'] } } }),
      prisma.deal.count({ where: { stage: { notIn: ['Won', 'Lost'] } } }),
      prisma.deal.aggregate({
        where: { stage: { notIn: ['Won', 'Lost'] } },
        _sum: { amount: true },
      }),
      prisma.deal.count({
        where: {
          stage: 'Won',
          updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.deal.aggregate({
        where: {
          stage: 'Won',
          updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
        _sum: { amount: true },
      }),
      prisma.ticket.count({ where: { status: { in: ['Open', 'In_Progress'] } } }),
    ])

    return reply.send({
      totalCustomers,
      activeLeads,
      openDeals,
      openDealsValue: openDealsValue._sum.amount ?? 0,
      wonThisMonth,
      wonThisMonthValue: wonThisMonthValue._sum.amount ?? 0,
      openTickets,
    })
  })
}
