import type { FastifyInstance } from 'fastify'
import { db, AggregateField } from '../lib/firebase.js'
import { authenticate } from '../middleware/authenticate.js'

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /api/v1/analytics/overview
  app.get('/overview', { preHandler: authenticate }, async (_request, reply) => {
    const [totalCustomers, activeLeads, openDeals, openTickets, wonDealsSnap] = await Promise.all([
      db.collection('customers').where('status', '==', 'Active').count().get(),
      db.collection('leads').where('status', 'not-in', ['Lost', 'Converted']).count().get(),
      db.collection('deals').where('stage', 'not-in', ['Won', 'Lost']).count().get(),
      db.collection('tickets').where('status', 'in', ['Open', 'In_Progress']).count().get(),
      db.collection('deals').where('stage', '==', 'Won').get(),
    ])

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const wonThisMonthDocs = wonDealsSnap.docs.filter(d => {
      const t = d.data().updatedAt?.toDate?.() ?? new Date(0)
      return t >= monthStart
    })
    const wonThisMonthValue = wonThisMonthDocs.reduce((s, d) => s + (d.data().amount ?? 0), 0)

    return reply.send({
      totalCustomers: totalCustomers.data().count,
      activeLeads: activeLeads.data().count,
      openDeals: openDeals.data().count,
      openTickets: openTickets.data().count,
      wonThisMonth: wonThisMonthDocs.length,
      wonThisMonthValue,
    })
  })

  // GET /api/v1/analytics/pipeline — deal count + value by stage
  // Uses aggregate queries (count + sum) — zero document data transferred.
  app.get('/pipeline', { preHandler: authenticate }, async (_request, reply) => {
    const stages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] as const
    const aggs = await Promise.all(
      stages.map(stage =>
        db.collection('deals').where('stage', '==', stage)
          .aggregate({ count: AggregateField.count(), value: AggregateField.sum('amount') })
          .get()
      )
    )
    const data = aggs
      .map((agg, i) => ({ stage: stages[i], count: agg.data().count, value: agg.data().value ?? 0 }))
      .filter(r => r.count > 0)
    return reply.send({ data })
  })

  // GET /api/v1/analytics/revenue — won revenue by month (last 12 months)
  app.get('/revenue', { preHandler: authenticate }, async (_request, reply) => {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 12)
    const snap = await db.collection('deals').where('stage', '==', 'Won').select('amount', 'updatedAt', 'createdAt').get()

    const byMonth: Record<string, number> = {}
    for (const doc of snap.docs) {
      const t: Date = doc.data().updatedAt?.toDate?.() ?? new Date((doc.data().createdAt?.seconds ?? 0) * 1000)
      if (t < cutoff) continue
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
      byMonth[key] = (byMonth[key] ?? 0) + (doc.data().amount ?? 0)
    }
    const data = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ month, revenue }))
    return reply.send({ data })
  })

  // GET /api/v1/analytics/activities — activity counts by type (last 30 days)
  app.get('/activities', { preHandler: authenticate }, async (_request, reply) => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const snap = await db.collection('activities').where('createdAt', '>=', cutoff).get()

    const byType: Record<string, number> = {}
    for (const doc of snap.docs) {
      const t = doc.data().type
      byType[t] = (byType[t] ?? 0) + 1
    }
    const data = Object.entries(byType).map(([type, count]) => ({ type, count }))
    return reply.send({ data })
  })

  // GET /api/v1/analytics/forecasting/trend — 12-month actuals + 3-month projection
  app.get('/forecasting/trend', { preHandler: authenticate }, async (_request, reply) => {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 12)
    const snap = await db.collection('deals').where('stage', '==', 'Won').select('amount', 'updatedAt').get()

    const byMonth: Record<string, number> = {}
    for (const doc of snap.docs) {
      const t: Date = doc.data().updatedAt?.toDate?.() ?? new Date(0)
      if (t < cutoff) continue
      const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
      byMonth[key] = (byMonth[key] ?? 0) + (doc.data().amount ?? 0)
    }
    const actuals = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, revenue]) => ({ month, revenue, projected: false }))
    const last3 = actuals.slice(-3).map(r => r.revenue)
    const avg = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0

    const projected = [1, 2, 3].map(offset => {
      const d = new Date()
      d.setMonth(d.getMonth() + offset, 1)
      return { month: d.toISOString().slice(0, 7), revenue: avg, projected: true }
    })
    return reply.send({ data: [...actuals, ...projected] })
  })

  // GET /api/v1/analytics/forecasting/weighted-pipeline
  app.get('/forecasting/weighted-pipeline', { preHandler: authenticate }, async (_request, reply) => {
    const DEFAULT_PROBABILITY: Record<string, number> = {
      New: 10, Qualified: 25, Proposal: 50, Negotiation: 75, Won: 100, Lost: 0,
    }
    const snap = await db.collection('deals').where('stage', 'not-in', ['Won', 'Lost']).get()

    const byStage: Record<string, { count: number; rawValue: number; weightedValue: number }> = {}
    for (const d of snap.docs) {
      const { stage, amount, probability } = d.data()
      const prob = ((probability ?? DEFAULT_PROBABILITY[stage] ?? 0)) / 100
      if (!byStage[stage]) byStage[stage] = { count: 0, rawValue: 0, weightedValue: 0 }
      byStage[stage].count++
      byStage[stage].rawValue += amount ?? 0
      byStage[stage].weightedValue += (amount ?? 0) * prob
    }
    const data = Object.entries(byStage).map(([stage, v]) => ({ stage, ...v }))
    const totalWeighted = data.reduce((s, r) => s + r.weightedValue, 0)
    return reply.send({ data, totalWeighted })
  })
}
