/**
 * Seeds the Firebase Emulator with realistic demo data for all CRM collections.
 * Run with: npm run emulator:seed
 */
import { auth, db, now } from '../lib/firebase.js'

function ini(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

async function ensureUser(email: string, password: string, displayName: string, role: string) {
  let uid: string
  try {
    const u = await auth.createUser({ email, password, displayName })
    uid = u.uid
    console.log(`  Created ${role}: ${email} (${uid})`)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'auth/email-already-exists') {
      uid = (await auth.getUserByEmail(email)).uid
      console.log(`  Exists  ${role}: ${email} (${uid})`)
    } else throw err
  }
  await auth.setCustomUserClaims(uid, { role })
  await db.collection('users').doc(uid).set({
    id: uid, name: displayName, email, role,
    avatarInitials: ini(displayName), lastLoginAt: null,
    createdAt: now(), updatedAt: now(),
  }, { merge: true })
  return uid
}

async function seed() {
  console.log('\n=== Seeding Firebase Emulator ===\n')

  // ── Users ────────────────────────────────────────────────────────────────────
  console.log('Users:')
  const adminId   = await ensureUser('admin@crm.dev',   'Admin123!',   'Admin User',    'admin')
  const managerId = await ensureUser('manager@crm.dev', 'Manager123!', 'Sarah Manager', 'manager')
  const agentId   = await ensureUser('agent@crm.dev',   'Agent123!',   'Tom Agent',     'sales_agent')
  const supportId = await ensureUser('support@crm.dev', 'Support123!', 'Lily Support',  'support')

  const users = {
    admin:   { id: adminId,   name: 'Admin User',    initials: 'AU' },
    manager: { id: managerId, name: 'Sarah Manager', initials: 'SM' },
    agent:   { id: agentId,   name: 'Tom Agent',     initials: 'TA' },
    support: { id: supportId, name: 'Lily Support',  initials: 'LS' },
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────
  console.log('\nTags:')
  const tagDefs = [
    { name: 'VIP',        color: '#ef4444' },
    { name: 'Enterprise', color: '#8b5cf6' },
    { name: 'Warm Lead',  color: '#f59e0b' },
    { name: 'Cold Lead',  color: '#6b7280' },
    { name: 'Strategic',  color: '#3b82f6' },
    { name: 'Startup',    color: '#10b981' },
  ]
  const tagIds: string[] = []
  for (const tag of tagDefs) {
    const ref = db.collection('tags').doc()
    await ref.set({ id: ref.id, ...tag, createdAt: now() })
    tagIds.push(ref.id)
    console.log(`  ${tag.name}`)
  }
  const [vip, enterprise, , coldLead, strategic, startup] = tagIds

  // ── Customers ────────────────────────────────────────────────────────────────
  console.log('\nCustomers:')
  const customerDefs = [
    { firstName: 'James',   lastName: 'Wilson',    email: 'jwilson@acme.com',      phone: '+1-555-0100', company: 'Acme Corporation',   jobTitle: 'CEO',             status: 'Active',   owner: users.manager, tags: [vip, enterprise] },
    { firstName: 'Priya',   lastName: 'Patel',     email: 'ppatel@globex.com',     phone: '+1-555-0101', company: 'Globex Corp',         jobTitle: 'CTO',             status: 'Active',   owner: users.manager, tags: [enterprise] },
    { firstName: 'Marcus',  lastName: 'Chen',      email: 'mchen@initech.com',     phone: '+1-555-0102', company: 'Initech LLC',         jobTitle: 'Procurement Mgr', status: 'Active',   owner: users.agent,   tags: [strategic] },
    { firstName: 'Diana',   lastName: 'Romano',    email: 'dromano@hooli.com',     phone: '+1-555-0103', company: 'Hooli Inc',           jobTitle: 'VP Engineering',  status: 'Active',   owner: users.agent,   tags: [vip, strategic] },
    { firstName: 'Carlos',  lastName: 'Rivera',    email: 'crivera@piedpiper.io',  phone: '+1-555-0104', company: 'Pied Piper',          jobTitle: 'Founder',         status: 'Active',   owner: users.manager, tags: [startup] },
    { firstName: 'Emily',   lastName: 'Thornton',  email: 'ethorn@umbrella.corp',  phone: '+1-555-0105', company: 'Umbrella Corp',       jobTitle: 'Director of IT',  status: 'Active',   owner: users.agent,   tags: [enterprise] },
    { firstName: 'Kwame',   lastName: 'Asante',    email: 'kasante@waystar.com',   phone: '+1-555-0106', company: 'Waystar Royco',       jobTitle: 'COO',             status: 'Inactive', owner: users.manager, tags: [vip] },
    { firstName: 'Yuki',    lastName: 'Tanaka',    email: 'ytanaka@dunder.co',     phone: '+1-555-0107', company: 'Dunder Mifflin',      jobTitle: 'Office Manager',  status: 'Active',   owner: users.agent,   tags: [] },
    { firstName: 'Fatima',  lastName: 'Al-Hassan', email: 'falhassan@saber.ae',    phone: '+971-555-0108', company: 'Saber International', jobTitle: 'GM',           status: 'Active',   owner: users.admin,   tags: [strategic, enterprise] },
    { firstName: 'Liam',    lastName: 'O\'Brien',  email: 'lobrien@celtic-tech.ie', phone: '+353-555-0109', company: 'Celtic Tech',      jobTitle: 'Sales Director',  status: 'Inactive', owner: users.agent,   tags: [coldLead] },
  ]

  const customerIds: Record<string, string> = {}
  const customerNames: Record<string, string> = {}
  const customerCompanies: Record<string, string> = {}
  for (const c of customerDefs) {
    const ref = db.collection('customers').doc()
    const fullName = `${c.firstName} ${c.lastName}`
    await ref.set({
      id: ref.id,
      firstName: c.firstName, lastName: c.lastName,
      email: c.email, phone: c.phone,
      company: c.company, jobTitle: c.jobTitle, status: c.status,
      ownerId: c.owner.id, ownerName: c.owner.name, ownerInitials: c.owner.initials,
      tagIds: c.tags,
      createdAt: now(), updatedAt: now(),
    })
    customerIds[fullName] = ref.id
    customerNames[ref.id] = fullName
    customerCompanies[ref.id] = c.company
    console.log(`  ${fullName} — ${c.company}`)
  }

  const c = (name: string) => ({
    customerId: customerIds[name],
    customerName: customerNames[customerIds[name]],
    customerCompany: customerCompanies[customerIds[name]],
  })

  // ── Leads ────────────────────────────────────────────────────────────────────
  console.log('\nLeads:')
  const leadDefs = [
    { name: 'Alice Johnson',  email: 'alice@startup-alpha.com',  company: 'Startup Alpha',    source: 'Website',        status: 'New',       value: 12000, owner: users.agent },
    { name: 'Bob Nguyen',     email: 'bnguyen@betacorp.com',     company: 'Beta Corp',        source: 'Referral',       status: 'Contacted', value: 35000, owner: users.manager },
    { name: 'Carol Schmidt',  email: 'carol@gamma.de',           company: 'Gamma GmbH',       source: 'LinkedIn',       status: 'Qualified', value: 80000, owner: users.manager },
    { name: 'David Kim',      email: 'dkim@deltasoft.kr',        company: 'Delta Software',   source: 'Trade_Show',     status: 'New',       value: 25000, owner: users.agent },
    { name: 'Eva Costa',      email: 'eva@epsilon.br',           company: 'Epsilon SA',       source: 'Email_Campaign', status: 'Contacted', value: 18000, owner: users.agent },
    { name: 'Frank Mueller',  email: 'frank@zeta.de',            company: 'Zeta AG',          source: 'Cold_Call',      status: 'Lost',      value: 5000,  owner: users.agent },
    { name: 'Grace Lin',      email: 'grace@eta-ventures.com',   company: 'Eta Ventures',     source: 'Social_Media',   status: 'Qualified', value: 60000, owner: users.manager },
    { name: 'Henry Park',     email: 'henry@theta.io',           company: 'Theta Labs',       source: 'Partner',        status: 'New',       value: 42000, owner: users.admin },
  ]

  const leadIds: string[] = []
  for (const l of leadDefs) {
    const ref = db.collection('leads').doc()
    await ref.set({
      id: ref.id,
      name: l.name, email: l.email, company: l.company,
      source: l.source, status: l.status, value: l.value,
      ownerId: l.owner.id, ownerName: l.owner.name, ownerInitials: l.owner.initials,
      tagIds: [], notes: '',
      createdAt: now(), updatedAt: now(),
    })
    leadIds.push(ref.id)
    console.log(`  ${l.name} — ${l.company} (${l.status})`)
  }

  // ── Deals ────────────────────────────────────────────────────────────────────
  console.log('\nDeals:')
  const closeDate = new Date()
  closeDate.setMonth(closeDate.getMonth() + 3)
  const closeDateStr = closeDate.toISOString().slice(0, 10)

  const dealDefs = [
    { title: 'Enterprise License — Acme',      ...c('James Wilson'),   amount: 120000, stage: 'Negotiation', probability: 70, owner: users.manager },
    { title: 'Annual SaaS — Globex',           ...c('Priya Patel'),    amount: 48000,  stage: 'Proposal',    probability: 50, owner: users.manager },
    { title: 'Professional Services — Initech', ...c('Marcus Chen'),   amount: 28000,  stage: 'Qualified',   probability: 30, owner: users.agent },
    { title: 'Platform Expansion — Hooli',     ...c('Diana Romano'),   amount: 200000, stage: 'Proposal',    probability: 60, owner: users.agent },
    { title: 'Starter Plan — Pied Piper',      ...c('Carlos Rivera'),  amount: 6000,   stage: 'Won',         probability: 100, owner: users.manager },
    { title: 'Security Suite — Umbrella',      ...c('Emily Thornton'), amount: 85000,  stage: 'Negotiation', probability: 75, owner: users.agent },
    { title: 'CRM Rollout — Waystar',          ...c('Kwame Asante'),   amount: 150000, stage: 'Lost',        probability: 0,  owner: users.manager },
    { title: 'Paper License — Dunder',         ...c('Yuki Tanaka'),    amount: 3600,   stage: 'New',         probability: 10, owner: users.agent },
    { title: 'Global Expansion — Saber',       ...c('Fatima Al-Hassan'), amount: 300000, stage: 'Qualified', probability: 25, owner: users.admin },
    { title: 'Mid-Market Plan — Celtic Tech',  ...c('Liam O\'Brien'), amount: 22000,  stage: 'New',         probability: 15, owner: users.agent },
  ]

  const dealIds: string[] = []
  for (const d of dealDefs) {
    const ref = db.collection('deals').doc()
    await ref.set({
      id: ref.id,
      title: d.title, customerId: d.customerId, customerName: d.customerName,
      customerCompany: d.customerCompany, amount: d.amount, stage: d.stage,
      probability: d.probability, expectedCloseDate: closeDateStr,
      ownerId: d.owner.id, ownerName: d.owner.name, ownerInitials: d.owner.initials,
      createdAt: now(), updatedAt: now(),
    })
    dealIds.push(ref.id)
    console.log(`  ${d.title} — $${d.amount.toLocaleString()} (${d.stage})`)
  }

  // ── Activities ───────────────────────────────────────────────────────────────
  console.log('\nActivities:')
  const activityDefs = [
    { type: 'call',    title: 'Discovery call with James Wilson',     relatedTo: customerIds['James Wilson'],   relatedType: 'customer', relatedName: 'James Wilson',   owner: users.manager.id, completed: true,  priority: 'high' },
    { type: 'email',   title: 'Sent pricing deck to Globex',          relatedTo: customerIds['Priya Patel'],    relatedType: 'customer', relatedName: 'Priya Patel',    owner: users.manager.id, completed: true,  priority: 'medium' },
    { type: 'meeting', title: 'Quarterly review — Acme negotiation',  relatedTo: dealIds[0],                   relatedType: 'deal',     relatedName: 'Enterprise License — Acme', owner: users.manager.id, completed: false, priority: 'high' },
    { type: 'note',    title: 'Acme wants 2-year contract terms',     relatedTo: dealIds[0],                   relatedType: 'deal',     relatedName: 'Enterprise License — Acme', owner: users.manager.id, completed: true,  priority: 'low' },
    { type: 'task',    title: 'Prepare custom demo for Hooli',        relatedTo: dealIds[3],                   relatedType: 'deal',     relatedName: 'Platform Expansion — Hooli', owner: users.agent.id, completed: false, priority: 'high' },
    { type: 'call',    title: 'Follow-up call with Carol Schmidt',    relatedTo: leadIds[2],                   relatedType: 'lead',     relatedName: 'Carol Schmidt',  owner: users.manager.id, completed: true,  priority: 'medium' },
    { type: 'email',   title: 'Welcome email to Alice Johnson',       relatedTo: leadIds[0],                   relatedType: 'lead',     relatedName: 'Alice Johnson',  owner: users.agent.id,   completed: true,  priority: 'low' },
    { type: 'meeting', title: 'Onboarding call — Pied Piper',        relatedTo: dealIds[4],                   relatedType: 'deal',     relatedName: 'Starter Plan — Pied Piper', owner: users.manager.id, completed: false, priority: 'medium' },
    { type: 'task',    title: 'Send NDA to Marcus Chen',              relatedTo: customerIds['Marcus Chen'],   relatedType: 'customer', relatedName: 'Marcus Chen',    owner: users.agent.id,   completed: false, priority: 'high' },
    { type: 'call',    title: 'Check-in with Diana Romano',           relatedTo: customerIds['Diana Romano'],  relatedType: 'customer', relatedName: 'Diana Romano',   owner: users.agent.id,   completed: false, priority: 'medium' },
    { type: 'email',   title: 'Proposal revision sent — Globex',      relatedTo: dealIds[1],                   relatedType: 'deal',     relatedName: 'Annual SaaS — Globex', owner: users.manager.id, completed: true, priority: 'medium' },
    { type: 'note',    title: 'Waystar deal lost — budget cut',       relatedTo: dealIds[6],                   relatedType: 'deal',     relatedName: 'CRM Rollout — Waystar', owner: users.manager.id, completed: true, priority: 'low' },
    { type: 'task',    title: 'Schedule Saber demo call',             relatedTo: dealIds[8],                   relatedType: 'deal',     relatedName: 'Global Expansion — Saber', owner: users.admin.id, completed: false, priority: 'high' },
    { type: 'meeting', title: 'Proof of concept review — Umbrella',  relatedTo: dealIds[5],                   relatedType: 'deal',     relatedName: 'Security Suite — Umbrella', owner: users.agent.id, completed: false, priority: 'high' },
    { type: 'email',   title: 'Cold outreach to Henry Park',          relatedTo: leadIds[7],                   relatedType: 'lead',     relatedName: 'Henry Park',     owner: users.admin.id,   completed: true,  priority: 'low' },
  ]

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)
  const dueDateStr = dueDate.toISOString()

  for (const a of activityDefs) {
    const ref = db.collection('activities').doc()
    await ref.set({
      id: ref.id,
      type: a.type, title: a.title, description: '',
      owner: a.owner, completed: a.completed, priority: a.priority,
      dueDate: dueDateStr,
      relatedTo: a.relatedTo, relatedType: a.relatedType, relatedName: a.relatedName,
      createdAt: now(), updatedAt: now(),
    })
    console.log(`  [${a.type}] ${a.title}`)
  }

  // ── Tickets ──────────────────────────────────────────────────────────────────
  console.log('\nTickets:')
  const ticketDefs = [
    { subject: 'Cannot export reports to CSV',        customerId: customerIds['James Wilson'],   customerName: 'James Wilson',   status: 'Open',        priority: 'High',     assignee: users.support, channel: 'email' },
    { subject: 'API rate limit too low for our volume', customerId: customerIds['Priya Patel'], customerName: 'Priya Patel',    status: 'In_Progress', priority: 'Critical', assignee: users.support, channel: 'phone' },
    { subject: 'Need SSO integration with Okta',     customerId: customerIds['Diana Romano'],   customerName: 'Diana Romano',   status: 'Open',        priority: 'Medium',   assignee: users.support, channel: 'web' },
    { subject: 'Billing discrepancy on last invoice', customerId: customerIds['Yuki Tanaka'],   customerName: 'Yuki Tanaka',    status: 'Resolved',    priority: 'Low',      assignee: users.manager, channel: 'email' },
    { subject: 'Mobile app crashes on iOS 17',       customerId: customerIds['Carlos Rivera'],  customerName: 'Carlos Rivera',  status: 'In_Progress', priority: 'High',     assignee: users.support, channel: 'chat' },
  ]

  for (const t of ticketDefs) {
    const ref = db.collection('tickets').doc()
    await ref.set({
      id: ref.id,
      subject: t.subject,
      customerId: t.customerId, customerName: t.customerName,
      status: t.status, priority: t.priority, channel: t.channel,
      assigneeId: t.assignee.id, assigneeName: t.assignee.name,
      tags: [],
      createdAt: now(), updatedAt: now(),
    })

    // Add 2 comments per ticket
    const c1 = db.collection('tickets').doc(ref.id).collection('comments').doc()
    await c1.set({ id: c1.id, author: t.customerName, body: `Issue confirmed — ${t.subject}`, isInternal: false, createdAt: now(), updatedAt: now() })
    const c2 = db.collection('tickets').doc(ref.id).collection('comments').doc()
    await c2.set({ id: c2.id, author: t.assignee.name, body: 'Looking into this now, will update shortly.', isInternal: true, createdAt: now(), updatedAt: now() })

    console.log(`  [${t.priority}] ${t.subject}`)
  }

  // ── Quotes ───────────────────────────────────────────────────────────────────
  console.log('\nQuotes:')
  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + 30)
  const validUntilStr = validUntil.toISOString()

  const quoteDefs = [
    {
      dealId: dealIds[0], dealTitle: 'Enterprise License — Acme',
      customerId: customerIds['James Wilson'], customerName: 'James Wilson',
      status: 'Sent', subtotal: 110000, tax: 10000, total: 120000,
      lineItems: [
        { description: 'Enterprise License (annual)', quantity: 1, unitPrice: 100000, total: 100000 },
        { description: 'Implementation services',      quantity: 1, unitPrice: 10000,  total: 10000 },
      ],
    },
    {
      dealId: dealIds[1], dealTitle: 'Annual SaaS — Globex',
      customerId: customerIds['Priya Patel'], customerName: 'Priya Patel',
      status: 'Draft', subtotal: 44000, tax: 4000, total: 48000,
      lineItems: [
        { description: 'SaaS Platform (annual)',       quantity: 1, unitPrice: 36000, total: 36000 },
        { description: 'Priority support',            quantity: 1, unitPrice: 8000,  total: 8000 },
      ],
    },
    {
      dealId: dealIds[4], dealTitle: 'Starter Plan — Pied Piper',
      customerId: customerIds['Carlos Rivera'], customerName: 'Carlos Rivera',
      status: 'Accepted', subtotal: 6000, tax: 0, total: 6000,
      lineItems: [
        { description: 'Starter Plan (annual)', quantity: 1, unitPrice: 6000, total: 6000 },
      ],
    },
    {
      dealId: dealIds[5], dealTitle: 'Security Suite — Umbrella',
      customerId: customerIds['Emily Thornton'], customerName: 'Emily Thornton',
      status: 'Sent', subtotal: 78000, tax: 7000, total: 85000,
      lineItems: [
        { description: 'Security Suite license',       quantity: 1, unitPrice: 60000, total: 60000 },
        { description: 'Threat monitoring (annual)',   quantity: 1, unitPrice: 18000, total: 18000 },
      ],
    },
    {
      dealId: dealIds[6], dealTitle: 'CRM Rollout — Waystar',
      customerId: customerIds['Kwame Asante'], customerName: 'Kwame Asante',
      status: 'Rejected', subtotal: 150000, tax: 0, total: 150000,
      lineItems: [
        { description: 'Enterprise CRM rollout', quantity: 1, unitPrice: 150000, total: 150000 },
      ],
    },
  ]

  for (const q of quoteDefs) {
    const ref = db.collection('quotes').doc()
    await ref.set({
      id: ref.id, ...q, notes: '', validUntil: validUntilStr,
      createdAt: now(), updatedAt: now(),
    })
    console.log(`  [${q.status}] $${q.total.toLocaleString()} — ${q.dealTitle}`)
  }

  // ── Custom fields ─────────────────────────────────────────────────────────────
  console.log('\nCustom Fields:')
  const cfDefs = [
    { entity: 'customer', name: 'LinkedIn URL',  type: 'url',      required: false },
    { entity: 'customer', name: 'NPS Score',     type: 'number',   required: false },
    { entity: 'deal',     name: 'Competitor',    type: 'text',     required: false },
    { entity: 'deal',     name: 'Decision Date', type: 'date',     required: false },
    { entity: 'lead',     name: 'Campaign ID',   type: 'text',     required: false },
  ]
  for (const cf of cfDefs) {
    const ref = db.collection('custom_fields').doc()
    await ref.set({ id: ref.id, ...cf, createdAt: now(), updatedAt: now() })
    console.log(`  [${cf.entity}] ${cf.name}`)
  }

  // ── Segments ──────────────────────────────────────────────────────────────────
  console.log('\nSegments:')
  const segmentDefs = [
    { name: 'High-Value Customers',  entity: 'customer', filters: [{ field: 'status', op: '==', value: 'Active' }] },
    { name: 'New Leads This Month',  entity: 'lead',     filters: [{ field: 'status', op: '==', value: 'New' }] },
    { name: 'Open Deals > $50k',     entity: 'deal',     filters: [{ field: 'amount', op: '>', value: 50000 }] },
  ]
  for (const s of segmentDefs) {
    const ref = db.collection('segments').doc()
    await ref.set({ id: ref.id, ...s, createdAt: now(), updatedAt: now() })
    console.log(`  ${s.name}`)
  }

  // ── Notifications ─────────────────────────────────────────────────────────────
  console.log('\nNotifications:')
  const notifDefs = [
    { userId: managerId, type: 'deal_updated',    title: 'Deal moved to Negotiation', body: 'Enterprise License — Acme advanced to Negotiation.',  read: false },
    { userId: agentId,   type: 'task_due',        title: 'Task due today',            body: 'Prepare custom demo for Hooli is due today.',          read: false },
    { userId: adminId,   type: 'lead_assigned',   title: 'New lead assigned to you',  body: 'Henry Park from Theta Labs has been assigned to you.', read: true  },
    { userId: supportId, type: 'ticket_created',  title: 'New ticket opened',         body: 'Cannot export reports to CSV — Priority: High.',       read: false },
  ]
  for (const n of notifDefs) {
    const ref = db.collection('notifications').doc(n.userId).collection('items').doc()
    await ref.set({ id: ref.id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: now() })
    console.log(`  [${n.type}] → ${n.title}`)
  }

  console.log('\n=== Seed complete ===')
  console.log('')
  console.log('Login credentials:')
  console.log('  Admin:   admin@crm.dev   / Admin123!')
  console.log('  Manager: manager@crm.dev / Manager123!')
  console.log('  Agent:   agent@crm.dev   / Agent123!')
  console.log('  Support: support@crm.dev / Support123!')
  console.log('')
  console.log('Emulator UI: http://localhost:4000')
  console.log('API base:    http://localhost:3001/api/v1')
}

seed().catch(err => { console.error(err); process.exit(1) })
