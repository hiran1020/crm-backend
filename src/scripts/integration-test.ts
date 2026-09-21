/**
 * Integration test — exercises every CRUD route against the Firebase Emulator.
 *
 * Prerequisites:
 *   1. npm run emulator        (start emulators)
 *   2. npm run emulator:seed   (seed demo data)
 *   3. npm run dev:emu         (start the API server)
 *   4. FIREBASE_EMULATOR=true tsx src/scripts/integration-test.ts
 */

const BASE    = 'http://localhost:3001/api/v1'
const AUTH_EMU = 'http://localhost:9099'
const API_KEY  = 'fake-key'

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0
let failed = 0
const failures: string[] = []

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
    passed++
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`      ${msg}`)
    failures.push(`${name} → ${msg}`)
    failed++
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg)
}

function assertStatus(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`expected HTTP ${expected}, got ${actual}`)
}

function assertField<T>(obj: Record<string, unknown>, key: string, value?: T) {
  if (!(key in obj)) throw new Error(`missing field "${key}"`)
  if (value !== undefined && obj[key] !== value) throw new Error(`"${key}" expected ${JSON.stringify(value)}, got ${JSON.stringify(obj[key])}`)
}

type ApiBody = Record<string, unknown> & { data?: unknown[]; total?: number }

async function api(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: ApiBody }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json: ApiBody
  try { json = JSON.parse(text) as ApiBody } catch { json = { raw: text } as ApiBody }
  return { status: res.status, body: json }
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  const data = await res.json() as { idToken?: string; error?: { message: string } }
  if (!data.idToken) throw new Error(`Sign-in failed: ${data.error?.message ?? 'unknown'}`)
  return data.idToken
}

function section(name: string) {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n\x1b[1mCRM Backend — Integration Tests\x1b[0m')
  console.log(`  API: ${BASE}`)
  console.log(`  Auth Emulator: ${AUTH_EMU}\n`)

  // ── Auth ────────────────────────────────────────────────────────────────────
  section('Sign-in')
  let adminToken = ''
  let agentToken = ''

  await test('admin signs in via emulator', async () => {
    adminToken = await signIn('admin@crm.dev', 'Admin123!')
    assert(adminToken.length > 10, 'token too short')
  })
  await test('agent signs in via emulator', async () => {
    agentToken = await signIn('agent@crm.dev', 'Agent123!')
    assert(agentToken.length > 10, 'token too short')
  })

  // ── Health ──────────────────────────────────────────────────────────────────
  section('Health')
  await test('GET /health → 200', async () => {
    const r = await fetch('http://localhost:3001/health')
    assert(r.status === 200, `status ${r.status}`)
    const b = await r.json() as { status: string }
    assert(b.status === 'ok', `status="${b.status}"`)
  })

  // ── Auth routes ─────────────────────────────────────────────────────────────
  section('Auth')
  let adminUserId = ''

  await test('GET /auth/me → my profile', async () => {
    const r = await api('GET', '/auth/me', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id')
    assertField(r.body, 'role', 'admin')
    adminUserId = r.body['id'] as string
  })

  await test('GET /auth/me → 401 without token', async () => {
    const r = await api('GET', '/auth/me', null)
    assertStatus(r.status, 401)
  })

  // ── Tags ────────────────────────────────────────────────────────────────────
  section('Tags')
  let tagId = ''

  await test('GET /tags → list', async () => {
    const r = await api('GET', '/tags', adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
    assert((r.body['data'] as unknown[]).length >= 1, 'no tags')
  })

  await test('POST /tags → create', async () => {
    const r = await api('POST', '/tags', adminToken, { name: 'Test Tag', color: '#000000' })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'name', 'Test Tag')
    tagId = r.body['id'] as string
  })

  await test('GET /tags/:id → read', async () => {
    const r = await api('GET', `/tags/${tagId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', tagId)
  })

  await test('PATCH /tags/:id → update', async () => {
    const r = await api('PATCH', `/tags/${tagId}`, adminToken, { name: 'Test Tag Updated' })
    assertStatus(r.status, 200)
    assertField(r.body, 'name', 'Test Tag Updated')
  })

  await test('DELETE /tags/:id → 204', async () => {
    const r = await api('DELETE', `/tags/${tagId}`, adminToken)
    assertStatus(r.status, 204)
  })

  await test('GET /tags/:id → 404 after delete', async () => {
    const r = await api('GET', `/tags/${tagId}`, adminToken)
    assertStatus(r.status, 404)
  })

  // ── Customers ───────────────────────────────────────────────────────────────
  section('Customers')
  let customerId = ''

  await test('GET /customers → paginated list', async () => {
    const r = await api('GET', '/customers?pageSize=5', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
    assertField(r.body, 'total')
    assertField(r.body, 'totalPages')
  })

  await test('POST /customers → create', async () => {
    const r = await api('POST', '/customers', adminToken, {
      firstName: 'Test', lastName: 'Customer',
      email: 'test.customer@example.com',
      phone: '+1-555-9999',
      company: 'Test Corp', jobTitle: 'QA Engineer',
      status: 'Active',
      ownerId: adminUserId, ownerName: 'Admin User', ownerInitials: 'AU',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'firstName', 'Test')
    customerId = r.body['id'] as string
  })

  await test('GET /customers/:id → read', async () => {
    const r = await api('GET', `/customers/${customerId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', customerId)
  })

  await test('PATCH /customers/:id → update', async () => {
    const r = await api('PATCH', `/customers/${customerId}`, adminToken, { jobTitle: 'Lead QA' })
    assertStatus(r.status, 200)
    assertField(r.body, 'jobTitle', 'Lead QA')
  })

  await test('GET /customers?status=Active → filter', async () => {
    const r = await api('GET', '/customers?status=Active', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(c => c['status'] === 'Active'), 'non-Active item in results')
  })

  await test('GET /customers?email= → lookup by email', async () => {
    const r = await api('GET', `/customers?email=test.customer@example.com`, adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.length >= 1, 'expected at least 1 result for known email')
    assert(data[0]['email'] === 'test.customer@example.com', 'wrong email in result')
  })

  await test('GET /customers?email=missing@example.com → empty result', async () => {
    const r = await api('GET', '/customers?email=missing@nobody.com', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as unknown[]
    assert(data.length === 0, 'expected empty result for unknown email')
  })

  await test('GET /customers?search=test → search', async () => {
    const r = await api('GET', '/customers?search=test', adminToken)
    assertStatus(r.status, 200)
  })

  await test('GET /customers/:id/deals → sub-list', async () => {
    const r = await api('GET', `/customers/${customerId}/deals`, adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
  })

  await test('GET /customers/:id/activities → sub-list', async () => {
    const r = await api('GET', `/customers/${customerId}/activities`, adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
  })

  await test('POST /customers → 400 on invalid body', async () => {
    const r = await api('POST', '/customers', adminToken, { firstName: 'Bad' })
    assertStatus(r.status, 400)
    assertField(r.body, 'issues')
  })

  await test('DELETE /customers/:id → 204', async () => {
    const r = await api('DELETE', `/customers/${customerId}`, adminToken)
    assertStatus(r.status, 204)
  })

  await test('GET /customers/:id → 404 after delete', async () => {
    const r = await api('GET', `/customers/${customerId}`, adminToken)
    assertStatus(r.status, 404)
  })

  // ── Leads ───────────────────────────────────────────────────────────────────
  section('Leads')
  let leadId = ''

  await test('GET /leads → paginated list', async () => {
    const r = await api('GET', '/leads', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
    assertField(r.body, 'total')
  })

  await test('POST /leads → create', async () => {
    const r = await api('POST', '/leads', adminToken, {
      name: 'Test Lead', company: 'Test Startup',
      email: 'test.lead@example.com', phone: '+1-555-8888',
      source: 'Website', status: 'New', value: 5000,
      ownerId: adminUserId, ownerName: 'Admin User', ownerInitials: 'AU',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'status', 'New')
    leadId = r.body['id'] as string
  })

  await test('GET /leads/:id → read', async () => {
    const r = await api('GET', `/leads/${leadId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', leadId)
  })

  await test('PATCH /leads/:id → update status', async () => {
    const r = await api('PATCH', `/leads/${leadId}`, adminToken, { status: 'Contacted' })
    assertStatus(r.status, 200)
    assertField(r.body, 'status', 'Contacted')
  })

  await test('GET /leads?source=Website → filter by source', async () => {
    const r = await api('GET', '/leads?source=Website', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(l => l['source'] === 'Website'), 'non-Website item in results')
  })

  await test('POST /leads/:id/convert → creates customer', async () => {
    const r = await api('POST', `/leads/${leadId}/convert`, adminToken, {
      firstName: 'Test', lastName: 'Converted',
      jobTitle: 'Founder',
      ownerId: adminUserId, ownerName: 'Admin User', ownerInitials: 'AU',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'status', 'Active')
    const customerId2 = r.body['id'] as string
    // clean up
    await api('DELETE', `/customers/${customerId2}`, adminToken)
  })

  await test('POST /leads/:id/convert → 409 on already-converted', async () => {
    const r = await api('POST', `/leads/${leadId}/convert`, adminToken, {
      firstName: 'X', lastName: 'Y',
    })
    assertStatus(r.status, 409)
  })

  await test('DELETE /leads/:id → 204', async () => {
    const r = await api('DELETE', `/leads/${leadId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Deals ───────────────────────────────────────────────────────────────────
  section('Deals')
  let dealId = ''
  const closeDate = new Date()
  closeDate.setMonth(closeDate.getMonth() + 3)

  // first create a fresh customer to attach the deal to
  const custR = await api('POST', '/customers', adminToken, {
    firstName: 'Deal', lastName: 'Customer', email: 'deal@example.com',
    phone: '+1-555-7777', company: 'Deal Corp', jobTitle: 'CEO',
    status: 'Active', ownerId: adminUserId, ownerName: 'Admin User', ownerInitials: 'AU',
  })
  const dealCustId = custR.body['id'] as string

  await test('GET /deals → paginated list', async () => {
    const r = await api('GET', '/deals', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
    assertField(r.body, 'total')
  })

  await test('POST /deals → create', async () => {
    const r = await api('POST', '/deals', adminToken, {
      title: 'Test Deal', customerId: dealCustId,
      customerName: 'Deal Customer', customerCompany: 'Deal Corp',
      amount: 9999, stage: 'New',
      ownerId: adminUserId, ownerName: 'Admin User', ownerInitials: 'AU',
      expectedCloseDate: closeDate.toISOString().slice(0, 10),
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'stage', 'New')
    dealId = r.body['id'] as string
  })

  await test('GET /deals/:id → read', async () => {
    const r = await api('GET', `/deals/${dealId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', dealId)
  })

  await test('PATCH /deals/:id → update amount', async () => {
    const r = await api('PATCH', `/deals/${dealId}`, adminToken, { amount: 15000 })
    assertStatus(r.status, 200)
    assertField(r.body, 'amount', 15000)
  })

  await test('PATCH /deals/:id/stage → advance stage', async () => {
    const r = await api('PATCH', `/deals/${dealId}/stage`, adminToken, { stage: 'Qualified' })
    assertStatus(r.status, 200)
    assertField(r.body, 'stage', 'Qualified')
  })

  await test('GET /deals?stage=Qualified → filter by stage', async () => {
    const r = await api('GET', '/deals?stage=Qualified', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(d => d['stage'] === 'Qualified'), 'non-Qualified item in results')
  })

  await test('GET /deals/:id/activities → sub-list', async () => {
    const r = await api('GET', `/deals/${dealId}/activities`, adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
  })

  await test('DELETE /deals/:id → 204', async () => {
    const r = await api('DELETE', `/deals/${dealId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // clean up customer used for deal tests
  await api('DELETE', `/customers/${dealCustId}`, adminToken)

  // ── Activities ───────────────────────────────────────────────────────────────
  section('Activities')
  let activityId = ''

  await test('GET /activities → paginated list', async () => {
    const r = await api('GET', '/activities', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
  })

  await test('POST /activities → create', async () => {
    const r = await api('POST', '/activities', adminToken, {
      type: 'note', title: 'Test Note',
      description: 'Integration test note',
      owner: adminUserId, completed: false, priority: 'low',
      dueDate: closeDate.toISOString(),
      relatedTo: 'test-ref', relatedType: 'customer', relatedName: 'Test',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'type', 'note')
    activityId = r.body['id'] as string
  })

  await test('GET /activities/:id → read', async () => {
    const r = await api('GET', `/activities/${activityId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', activityId)
  })

  await test('PATCH /activities/:id → mark completed', async () => {
    const r = await api('PATCH', `/activities/${activityId}`, adminToken, { completed: true })
    assertStatus(r.status, 200)
    assertField(r.body, 'completed', true)
  })

  await test('GET /activities?type=note → filter by type', async () => {
    const r = await api('GET', '/activities?type=note', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(a => a['type'] === 'note'), 'non-note item in results')
  })

  await test('GET /activities?completed=true → filter by completed', async () => {
    const r = await api('GET', '/activities?completed=true', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(a => a['completed'] === true), 'non-completed item in results')
  })

  await test('GET /activities?type=note&completed=true → combined filter (needs composite index)', async () => {
    const r = await api('GET', '/activities?type=note&completed=true', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(a => a['type'] === 'note' && a['completed'] === true), 'wrong item in filtered results')
  })

  await test('DELETE /activities/:id → 204', async () => {
    const r = await api('DELETE', `/activities/${activityId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Tickets ─────────────────────────────────────────────────────────────────
  section('Tickets')
  let ticketId = ''

  await test('GET /tickets → paginated list', async () => {
    const r = await api('GET', '/tickets', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
    assertField(r.body, 'total')
  })

  await test('POST /tickets → create', async () => {
    const r = await api('POST', '/tickets', adminToken, {
      subject: 'Test ticket from integration test',
      status: 'Open', priority: 'Medium', channel: 'web',
      assigneeId: adminUserId, assigneeName: 'Admin User',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'status', 'Open')
    ticketId = r.body['id'] as string
  })

  await test('GET /tickets/:id → read (includes comments)', async () => {
    const r = await api('GET', `/tickets/${ticketId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', ticketId)
    assert('comments' in r.body, 'missing comments field')
  })

  await test('PATCH /tickets/:id → update priority', async () => {
    const r = await api('PATCH', `/tickets/${ticketId}`, adminToken, { priority: 'High' })
    assertStatus(r.status, 200)
    assertField(r.body, 'priority', 'High')
  })

  await test('PATCH /tickets/:id/status → change status', async () => {
    const r = await api('PATCH', `/tickets/${ticketId}/status`, adminToken, { status: 'In_Progress' })
    assertStatus(r.status, 200)
    assertField(r.body, 'status', 'In_Progress')
  })

  await test('POST /tickets/:id/comments → add comment', async () => {
    const r = await api('POST', `/tickets/${ticketId}/comments`, adminToken, {
      author: 'Admin User', body: 'Working on it now.', isInternal: false,
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'body', 'Working on it now.')
  })

  await test('POST /tickets/:id/comments → internal comment', async () => {
    const r = await api('POST', `/tickets/${ticketId}/comments`, adminToken, {
      author: 'Admin User', body: 'Internal note.', isInternal: true,
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'isInternal', true)
  })

  await test('GET /tickets/:id/comments → list', async () => {
    const r = await api('GET', `/tickets/${ticketId}/comments`, adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as unknown[]
    assert(data.length === 2, `expected 2 comments, got ${data.length}`)
  })

  await test('GET /tickets?priority=High → filter', async () => {
    const r = await api('GET', '/tickets?priority=High', adminToken)
    assertStatus(r.status, 200)
    const data = r.body['data'] as ApiBody[]
    assert(data.every(t => t['priority'] === 'High'), 'non-High item in results')
  })

  await test('DELETE /tickets/:id → 204', async () => {
    const r = await api('DELETE', `/tickets/${ticketId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Quotes ───────────────────────────────────────────────────────────────────
  section('Quotes')
  let quoteId = ''

  await test('GET /quotes → paginated list', async () => {
    const r = await api('GET', '/quotes', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
  })

  await test('POST /quotes → create draft', async () => {
    const r = await api('POST', '/quotes', adminToken, {
      status: 'Draft', subtotal: 1000, tax: 100, total: 1100,
      validUntil: closeDate.toISOString(),
      lineItems: [{ description: 'Test item', quantity: 1, unitPrice: 1000, total: 1000 }],
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    assertField(r.body, 'status', 'Draft')
    quoteId = r.body['id'] as string
  })

  await test('GET /quotes/:id → read', async () => {
    const r = await api('GET', `/quotes/${quoteId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', quoteId)
  })

  await test('PATCH /quotes/:id → update total', async () => {
    const r = await api('PATCH', `/quotes/${quoteId}`, adminToken, { total: 1200 })
    assertStatus(r.status, 200)
    assertField(r.body, 'total', 1200)
  })

  await test('POST /quotes/:id/send → status = Sent', async () => {
    const r = await api('POST', `/quotes/${quoteId}/send`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'status', 'Sent')
  })

  await test('POST /quotes/:id/accept → status = Accepted', async () => {
    const r = await api('POST', `/quotes/${quoteId}/accept`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'status', 'Accepted')
  })

  // create another quote to reject
  await test('POST /quotes/:id/reject → status = Rejected', async () => {
    const r2 = await api('POST', '/quotes', adminToken, {
      status: 'Sent', subtotal: 500, tax: 0, total: 500,
      lineItems: [{ description: 'Reject me', quantity: 1, unitPrice: 500, total: 500 }],
    })
    const rejectId = r2.body['id'] as string
    const r = await api('POST', `/quotes/${rejectId}/reject`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'status', 'Rejected')
    await api('DELETE', `/quotes/${rejectId}`, adminToken)
  })

  await test('DELETE /quotes/:id → 204', async () => {
    const r = await api('DELETE', `/quotes/${quoteId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Users ────────────────────────────────────────────────────────────────────
  section('Users')

  await test('GET /users → list all users', async () => {
    const r = await api('GET', '/users', adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
    assert((r.body['data'] as unknown[]).length >= 4, 'expected at least 4 seeded users')
  })

  await test('GET /users → 401 without token', async () => {
    const r = await api('GET', '/users', null)
    assertStatus(r.status, 401)
  })

  // ── Analytics ───────────────────────────────────────────────────────────────
  section('Analytics')

  await test('GET /analytics/overview → 200', async () => {
    const r = await api('GET', '/analytics/overview', adminToken)
    assertStatus(r.status, 200)
  })

  await test('GET /analytics/pipeline → 200', async () => {
    const r = await api('GET', '/analytics/pipeline', adminToken)
    assertStatus(r.status, 200)
  })

  await test('GET /analytics/revenue → 200', async () => {
    const r = await api('GET', '/analytics/revenue', adminToken)
    assertStatus(r.status, 200)
  })

  await test('GET /analytics/forecasting/weighted-pipeline → 200', async () => {
    const r = await api('GET', '/analytics/forecasting/weighted-pipeline', adminToken)
    assertStatus(r.status, 200)
  })

  // ── Audit Log ────────────────────────────────────────────────────────────────
  section('Audit Log')

  await test('GET /audit-log → 200 with entries', async () => {
    const r = await api('GET', '/audit-log', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
  })

  // ── Custom Fields ─────────────────────────────────────────────────────────────
  section('Custom Fields')
  let cfId = ''

  await test('GET /custom-fields → list', async () => {
    const r = await api('GET', '/custom-fields', adminToken)
    assertStatus(r.status, 200)
    assert(Array.isArray(r.body['data']), 'data not array')
  })

  await test('POST /custom-fields → create', async () => {
    const r = await api('POST', '/custom-fields', adminToken, {
      entity: 'customer', name: 'Test Field', type: 'text', required: false,
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    cfId = r.body['id'] as string
  })

  await test('PATCH /custom-fields/:id → update', async () => {
    const r = await api('PATCH', `/custom-fields/${cfId}`, adminToken, { name: 'Test Field Renamed' })
    assertStatus(r.status, 200)
    assertField(r.body, 'name', 'Test Field Renamed')
  })

  await test('DELETE /custom-fields/:id → 204', async () => {
    const r = await api('DELETE', `/custom-fields/${cfId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Segments ─────────────────────────────────────────────────────────────────
  section('Segments')
  let segId = ''

  await test('GET /segments → list', async () => {
    const r = await api('GET', '/segments', adminToken)
    assertStatus(r.status, 200)
  })

  await test('POST /segments → create', async () => {
    const r = await api('POST', '/segments', adminToken, {
      name: 'Test Segment', entity: 'customer',
      filters: [{ field: 'status', op: '==', value: 'Active' }],
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    segId = r.body['id'] as string
  })

  await test('GET /segments/:id → read', async () => {
    const r = await api('GET', `/segments/${segId}`, adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'id', segId)
  })

  await test('DELETE /segments/:id → 204', async () => {
    const r = await api('DELETE', `/segments/${segId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Webhooks ─────────────────────────────────────────────────────────────────
  section('Webhooks')
  let webhookId = ''

  await test('GET /webhooks → list', async () => {
    const r = await api('GET', '/webhooks', adminToken)
    assertStatus(r.status, 200)
  })

  await test('POST /webhooks → create', async () => {
    const r = await api('POST', '/webhooks', adminToken, {
      url: 'https://example.com/hook',
      events: ['deal.created', 'deal.updated'],
      secret: 'test-secret',
    })
    assertStatus(r.status, 201)
    assertField(r.body, 'id')
    webhookId = r.body['id'] as string
  })

  await test('DELETE /webhooks/:id → 204', async () => {
    const r = await api('DELETE', `/webhooks/${webhookId}`, adminToken)
    assertStatus(r.status, 204)
  })

  // ── Notifications ─────────────────────────────────────────────────────────────
  section('Notifications')

  await test('GET /notifications → my notifications', async () => {
    const r = await api('GET', '/notifications', adminToken)
    assertStatus(r.status, 200)
    assertField(r.body, 'data')
  })

  await test('PATCH /notifications/read-all → mark all read', async () => {
    const r = await api('PATCH', '/notifications/read-all', adminToken)
    assertStatus(r.status, 200)
  })

  // ── Role-based access ─────────────────────────────────────────────────────────
  section('Role-based access (403 checks)')

  await test('agent cannot set-role (admin only)', async () => {
    const r = await api('POST', '/auth/set-role', agentToken, { uid: adminUserId, role: 'manager' })
    assertStatus(r.status, 403)
  })

  // ── Summary ───────────────────────────────────────────────────────────────────
  const total = passed + failed
  console.log(`\n\x1b[1mResults: ${passed}/${total} passed\x1b[0m`)

  if (failures.length > 0) {
    console.log('\n\x1b[31mFailed tests:\x1b[0m')
    for (const f of failures) console.log(`  • ${f}`)
  } else {
    console.log('\x1b[32mAll tests passed!\x1b[0m')
  }

  process.exit(failed > 0 ? 1 : 0)
}

run().catch(err => { console.error(err); process.exit(1) })
