/**
 * Seeds the PRODUCTION Firebase project with fueling-industry demo data.
 * Reads credentials from .env (FIREBASE_SERVICE_ACCOUNT).
 *
 * Usage:  npm run seed:prod
 * Safe to re-run — ensureUser handles existing auth accounts; Firestore docs are appended.
 */
import 'dotenv/config'
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
  await db.collection('users').doc(uid).set(
    { id: uid, name: displayName, email, role, avatarInitials: ini(displayName), lastLoginAt: null, createdAt: now(), updatedAt: now() },
    { merge: true },
  )
  return uid
}

async function seed() {
  console.log('\n=== Seeding Production Firebase — Fueling Industry Demo ===\n')

  // ── Users ────────────────────────────────────────────────────────────────────
  console.log('Users:')
  const adminId   = await ensureUser('admin@fuelcrm.dev',   'Admin123!',   'Alex Carter',   'admin')
  const managerId = await ensureUser('manager@fuelcrm.dev', 'Manager123!', 'Sarah Mitchell', 'manager')
  const agentId   = await ensureUser('agent@fuelcrm.dev',   'Agent123!',   'Tom Rivera',     'sales_agent')
  const supportId = await ensureUser('support@fuelcrm.dev', 'Support123!', 'Lisa Nguyen',    'support')

  const U = {
    admin:   { id: adminId,   name: 'Alex Carter',    initials: 'AC' },
    manager: { id: managerId, name: 'Sarah Mitchell',  initials: 'SM' },
    agent:   { id: agentId,   name: 'Tom Rivera',      initials: 'TR' },
    support: { id: supportId, name: 'Lisa Nguyen',     initials: 'LN' },
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────
  console.log('\nTags:')
  const tagDefs = [
    { name: 'High Volume',     color: '#ef4444' },
    { name: 'Fleet Contract',  color: '#8b5cf6' },
    { name: 'Warm Lead',       color: '#f59e0b' },
    { name: 'Cold Lead',       color: '#6b7280' },
    { name: 'Municipal',       color: '#3b82f6' },
    { name: 'Agriculture',     color: '#10b981' },
    { name: 'At Risk',         color: '#f97316' },
    { name: 'Key Account',     color: '#ec4899' },
  ]
  const tagIds: string[] = []
  for (const t of tagDefs) {
    const ref = db.collection('tags').doc()
    await ref.set({ id: ref.id, ...t, createdAt: now() })
    tagIds.push(ref.id)
    console.log(`  ${t.name}`)
  }
  const [highVol, fleetContract, , , municipal, agriculture, atRisk, keyAccount] = tagIds

  // ── Customers ────────────────────────────────────────────────────────────────
  console.log('\nCustomers:')
  const customerDefs = [
    { firstName: 'David',    lastName: 'Hartley',    email: 'dhartley@apexhauling.com',     phone: '+1-602-555-0101', company: 'Apex Hauling & Logistics',       jobTitle: 'VP of Operations',         status: 'Active',   owner: U.manager, tags: [highVol, fleetContract] },
    { firstName: 'Monica',   lastName: 'Serrano',    email: 'mserrano@sunstatefleet.com',    phone: '+1-480-555-0102', company: 'Sun State Fleet Services',       jobTitle: 'Fleet Director',           status: 'Active',   owner: U.manager, tags: [fleetContract, keyAccount] },
    { firstName: 'Brett',    lastName: 'Calloway',   email: 'bcalloway@blueridgetruck.com',  phone: '+1-303-555-0103', company: 'Blue Ridge Trucking Co.',        jobTitle: 'Fuel & Maintenance Mgr',   status: 'Active',   owner: U.agent,   tags: [highVol] },
    { firstName: 'Anita',    lastName: 'Patel',      email: 'apatel@glendaletransit.gov',    phone: '+1-818-555-0104', company: 'Glendale City Transit',          jobTitle: 'Director of Transport',    status: 'Active',   owner: U.agent,   tags: [municipal, keyAccount] },
    { firstName: 'Roger',    lastName: 'Dunmore',    email: 'rdunmore@dunmorefarms.com',     phone: '+1-559-555-0105', company: 'Dunmore Family Farms',           jobTitle: 'Owner',                    status: 'Active',   owner: U.manager, tags: [agriculture] },
    { firstName: 'Cassandra', lastName: 'Webb',      email: 'cwebb@irongateconstruct.com',   phone: '+1-702-555-0106', company: 'Iron Gate Construction',         jobTitle: 'Equipment Manager',        status: 'Active',   owner: U.agent,   tags: [highVol, fleetContract] },
    { firstName: 'James',    lastName: 'Kowalski',   email: 'jkowalski@lakeshoretrans.com',  phone: '+1-312-555-0107', company: 'Lakeshore Transport Group',      jobTitle: 'COO',                      status: 'Inactive', owner: U.manager, tags: [atRisk] },
    { firstName: 'Priya',    lastName: 'Menon',      email: 'pmenon@tristatehaulers.com',    phone: '+1-201-555-0108', company: 'Tri-State Haulers LLC',          jobTitle: 'Fleet Operations Lead',    status: 'Active',   owner: U.agent,   tags: [fleetContract] },
    { firstName: 'Carlos',   lastName: 'Delgado',    email: 'cdelgado@phoenixmunicipality.gov', phone: '+1-602-555-0109', company: 'Phoenix Public Works',      jobTitle: 'Fuel Program Manager',     status: 'Active',   owner: U.admin,   tags: [municipal, highVol] },
    { firstName: 'Shannon',  lastName: 'Tran',       email: 'stran@alpineagriculture.com',   phone: '+1-208-555-0110', company: 'Alpine Agriculture Co-op',       jobTitle: 'Operations Director',      status: 'Active',   owner: U.manager, tags: [agriculture, keyAccount] },
    { firstName: 'Marcus',   lastName: 'Ford',       email: 'mford@raptorexpressfreight.com', phone: '+1-214-555-0111', company: 'Raptor Express Freight',       jobTitle: 'VP Logistics',             status: 'Active',   owner: U.manager, tags: [highVol, fleetContract] },
    { firstName: 'Linda',    lastName: 'Osei',       email: 'losei@coastalfuelsupply.com',   phone: '+1-561-555-0112', company: 'Coastal Fuel Supply Co.',        jobTitle: 'Procurement Manager',      status: 'Active',   owner: U.agent,   tags: [keyAccount] },
  ]

  const customerIds: Record<string, string> = {}
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
      tagIds: c.tags, notes: '',
      createdAt: now(), updatedAt: now(),
    })
    customerIds[fullName] = ref.id
    customerCompanies[ref.id] = c.company
    console.log(`  ${fullName} — ${c.company}`)
  }

  const cx = (name: string) => ({
    customerId: customerIds[name],
    customerName: name,
    customerCompany: customerCompanies[customerIds[name]] ?? '',
  })

  // ── Leads ────────────────────────────────────────────────────────────────────
  console.log('\nLeads:')
  const leadDefs = [
    { name: 'Tyler Hoffman',    email: 'thoffman@desertlinehaul.com',    company: 'Desert Line Haul Inc.',       source: 'Referral',       status: 'New',       value: 95000,  owner: U.agent },
    { name: 'Grace Yamamoto',   email: 'gyamamoto@pacificagriculture.com', company: 'Pacifica Agriculture LLC', source: 'Trade_Show',     status: 'Contacted', value: 48000,  owner: U.manager },
    { name: 'Brian Okonkwo',    email: 'bokonkwo@midwestelevator.com',   company: 'Midwest Grain Elevator',      source: 'Cold_Call',      status: 'Qualified', value: 120000, owner: U.manager },
    { name: 'Natalie Cruz',     email: 'ncruz@swiftcitytransit.gov',     company: 'Swift City Transit Authority', source: 'Website',       status: 'New',       value: 210000, owner: U.agent },
    { name: 'Kevin Steele',     email: 'ksteele@steeleexcavation.com',   company: 'Steele Excavation & Grading', source: 'Referral',      status: 'Contacted', value: 62000,  owner: U.agent },
    { name: 'Amanda Forsythe',  email: 'aforsythe@valleydairyfarm.com',  company: 'Valley Dairy Farm',           source: 'Email_Campaign', status: 'Qualified', value: 35000,  owner: U.manager },
    { name: 'Darius Knowles',   email: 'dknowles@ironhaulllc.com',       company: 'Iron Haul LLC',               source: 'Partner',        status: 'New',       value: 180000, owner: U.admin },
    { name: 'Renee Galloway',   email: 'rgalloway@sunrisepoultry.com',   company: 'Sunrise Poultry Group',       source: 'Trade_Show',     status: 'Contacted', value: 28000,  owner: U.agent },
    { name: 'Oscar Petersen',   email: 'opetersen@mountainstatehwy.gov', company: 'Mountain State Highway Dept', source: 'Website',        status: 'Qualified', value: 320000, owner: U.manager },
    { name: 'Tamara Elkins',    email: 'telkins@elkinsdrillingco.com',   company: 'Elkins Drilling Co.',         source: 'Cold_Call',      status: 'New',       value: 75000,  owner: U.agent },
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
    console.log(`  ${l.name} — ${l.company} (${l.status}, $${l.value.toLocaleString()})`)
  }

  // ── Deals ────────────────────────────────────────────────────────────────────
  console.log('\nDeals:')
  const futureClose = (months: number) => {
    const d = new Date(); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10)
  }

  const dealDefs = [
    { title: 'Annual Diesel Supply — Apex Hauling',       ...cx('David Hartley'),    amount: 480000, stage: 'Negotiation', probability: 75, owner: U.manager, closeDate: futureClose(1) },
    { title: 'Fleet Fueling Contract — Sun State',        ...cx('Monica Serrano'),   amount: 310000, stage: 'Proposal',    probability: 55, owner: U.manager, closeDate: futureClose(2) },
    { title: 'Bulk Diesel — Blue Ridge Trucking',         ...cx('Brett Calloway'),   amount: 220000, stage: 'Qualified',   probability: 35, owner: U.agent,   closeDate: futureClose(3) },
    { title: 'Municipal Fuel Program — Glendale Transit', ...cx('Anita Patel'),      amount: 650000, stage: 'Proposal',    probability: 60, owner: U.agent,   closeDate: futureClose(2) },
    { title: 'Farm Fuel Agreement — Dunmore Farms',       ...cx('Roger Dunmore'),    amount: 85000,  stage: 'Won',         probability: 100, owner: U.manager, closeDate: futureClose(0) },
    { title: 'On-site Fueling — Iron Gate Construction',  ...cx('Cassandra Webb'),   amount: 195000, stage: 'Negotiation', probability: 70, owner: U.agent,   closeDate: futureClose(1) },
    { title: 'Fleet Card Program — Lakeshore Transport',  ...cx('James Kowalski'),   amount: 270000, stage: 'Lost',        probability: 0,  owner: U.manager, closeDate: futureClose(0) },
    { title: 'Diesel Delivery — Tri-State Haulers',       ...cx('Priya Menon'),      amount: 140000, stage: 'New',         probability: 15, owner: U.agent,   closeDate: futureClose(4) },
    { title: 'City Fleet Fuel — Phoenix Public Works',    ...cx('Carlos Delgado'),   amount: 920000, stage: 'Qualified',   probability: 30, owner: U.admin,   closeDate: futureClose(3) },
    { title: 'Cooperative Fuel Supply — Alpine Ag',       ...cx('Shannon Tran'),     amount: 165000, stage: 'Proposal',    probability: 50, owner: U.manager, closeDate: futureClose(2) },
    { title: 'Long-Haul Diesel — Raptor Express',         ...cx('Marcus Ford'),      amount: 560000, stage: 'Negotiation', probability: 80, owner: U.manager, closeDate: futureClose(1) },
    { title: 'Bulk Fuel Resale — Coastal Fuel Supply',    ...cx('Linda Osei'),       amount: 390000, stage: 'Qualified',   probability: 40, owner: U.agent,   closeDate: futureClose(3) },
  ]

  const dealIds: string[] = []
  for (const d of dealDefs) {
    const ref = db.collection('deals').doc()
    await ref.set({
      id: ref.id,
      title: d.title, customerId: d.customerId, customerName: d.customerName,
      customerCompany: d.customerCompany, amount: d.amount, stage: d.stage,
      probability: d.probability, expectedCloseDate: d.closeDate,
      ownerId: d.owner.id, ownerName: d.owner.name, ownerInitials: d.owner.initials,
      createdAt: now(), updatedAt: now(),
    })
    dealIds.push(ref.id)
    console.log(`  ${d.title} — $${d.amount.toLocaleString()} (${d.stage})`)
  }

  // ── Activities ───────────────────────────────────────────────────────────────
  console.log('\nActivities:')
  const dueAt = new Date(); dueAt.setDate(dueAt.getDate() + 7)
  const dueStr = dueAt.toISOString()

  const activityDefs = [
    { type: 'call',    title: 'Pricing call — Apex Hauling diesel contract',          relatedTo: dealIds[0],                    relatedType: 'deal',     relatedName: 'Annual Diesel Supply — Apex Hauling',      owner: U.manager.id, completed: true,  priority: 'high' },
    { type: 'meeting', title: 'Contract review — Sun State Fleet',                    relatedTo: dealIds[1],                    relatedType: 'deal',     relatedName: 'Fleet Fueling Contract — Sun State',       owner: U.manager.id, completed: false, priority: 'high' },
    { type: 'email',   title: 'Sent fuel pricing sheet to Blue Ridge Trucking',       relatedTo: customerIds['Brett Calloway'], relatedType: 'customer', relatedName: 'Brett Calloway',                           owner: U.agent.id,   completed: true,  priority: 'medium' },
    { type: 'task',    title: 'Prepare municipal RFP response — Glendale Transit',    relatedTo: dealIds[3],                    relatedType: 'deal',     relatedName: 'Municipal Fuel Program — Glendale Transit',owner: U.agent.id,   completed: false, priority: 'high' },
    { type: 'call',    title: 'Confirmed harvest delivery schedule — Dunmore Farms',  relatedTo: customerIds['Roger Dunmore'],  relatedType: 'customer', relatedName: 'Roger Dunmore',                            owner: U.manager.id, completed: true,  priority: 'medium' },
    { type: 'meeting', title: 'On-site assessment — Iron Gate job site',              relatedTo: dealIds[5],                    relatedType: 'deal',     relatedName: 'On-site Fueling — Iron Gate Construction', owner: U.agent.id,   completed: true,  priority: 'high' },
    { type: 'note',    title: 'Lakeshore lost deal — chose competitor on price',      relatedTo: dealIds[6],                    relatedType: 'deal',     relatedName: 'Fleet Card Program — Lakeshore Transport', owner: U.manager.id, completed: true,  priority: 'low' },
    { type: 'task',    title: 'Send DEF product overview to Tri-State Haulers',       relatedTo: customerIds['Priya Menon'],    relatedType: 'customer', relatedName: 'Priya Menon',                              owner: U.agent.id,   completed: false, priority: 'medium' },
    { type: 'call',    title: 'Stakeholder intro — Phoenix Public Works RFP',         relatedTo: dealIds[8],                    relatedType: 'deal',     relatedName: 'City Fleet Fuel — Phoenix Public Works',   owner: U.admin.id,   completed: true,  priority: 'high' },
    { type: 'email',   title: 'Proposal follow-up — Alpine Agriculture Co-op',        relatedTo: dealIds[9],                    relatedType: 'deal',     relatedName: 'Cooperative Fuel Supply — Alpine Ag',      owner: U.manager.id, completed: true,  priority: 'medium' },
    { type: 'meeting', title: 'Quarterly fuel volume review — Raptor Express',        relatedTo: dealIds[10],                   relatedType: 'deal',     relatedName: 'Long-Haul Diesel — Raptor Express',        owner: U.manager.id, completed: false, priority: 'high' },
    { type: 'task',    title: 'Finalize bulk pricing tier — Coastal Fuel Supply',     relatedTo: dealIds[11],                   relatedType: 'deal',     relatedName: 'Bulk Fuel Resale — Coastal Fuel Supply',   owner: U.agent.id,   completed: false, priority: 'medium' },
    { type: 'call',    title: 'Intro call — Desert Line Haul (lead)',                 relatedTo: leadIds[0],                    relatedType: 'lead',     relatedName: 'Tyler Hoffman',                            owner: U.agent.id,   completed: true,  priority: 'medium' },
    { type: 'email',   title: 'Trade show follow-up — Pacifica Agriculture',          relatedTo: leadIds[1],                    relatedType: 'lead',     relatedName: 'Grace Yamamoto',                           owner: U.manager.id, completed: true,  priority: 'low' },
    { type: 'task',    title: 'Send DEF + diesel pricing to Midwest Grain Elevator',  relatedTo: leadIds[2],                    relatedType: 'lead',     relatedName: 'Brian Okonkwo',                            owner: U.manager.id, completed: false, priority: 'high' },
    { type: 'call',    title: 'Discovery call — Swift City Transit Authority',        relatedTo: leadIds[3],                    relatedType: 'lead',     relatedName: 'Natalie Cruz',                             owner: U.agent.id,   completed: false, priority: 'high' },
    { type: 'email',   title: 'Cold outreach — Elkins Drilling Co.',                  relatedTo: leadIds[9],                    relatedType: 'lead',     relatedName: 'Tamara Elkins',                            owner: U.agent.id,   completed: true,  priority: 'low' },
  ]

  for (const a of activityDefs) {
    const ref = db.collection('activities').doc()
    await ref.set({
      id: ref.id,
      type: a.type, title: a.title, description: '',
      owner: a.owner, completed: a.completed, priority: a.priority,
      dueDate: dueStr,
      relatedTo: a.relatedTo, relatedType: a.relatedType, relatedName: a.relatedName,
      createdAt: now(), updatedAt: now(),
    })
    console.log(`  [${a.type}] ${a.title}`)
  }

  // ── Tickets ──────────────────────────────────────────────────────────────────
  console.log('\nTickets:')
  const ticketDefs = [
    { subject: 'Delivery short by 200 gallons — Invoice #4821',      customerId: customerIds['David Hartley'],    customerName: 'David Hartley',    status: 'Open',        priority: 'High',     assignee: U.support, channel: 'email' },
    { subject: 'Pump meter calibration dispute at Sun State depot',   customerId: customerIds['Monica Serrano'],   customerName: 'Monica Serrano',   status: 'In_Progress', priority: 'Critical', assignee: U.support, channel: 'phone' },
    { subject: 'DEF delivery scheduled wrong date — Blue Ridge',      customerId: customerIds['Brett Calloway'],   customerName: 'Brett Calloway',   status: 'Resolved',    priority: 'Medium',   assignee: U.agent,   channel: 'email' },
    { subject: 'Fuel card portal access not working',                 customerId: customerIds['Anita Patel'],      customerName: 'Anita Patel',      status: 'Open',        priority: 'Medium',   assignee: U.support, channel: 'web' },
    { subject: 'Price lock terms missing from contract — Dunmore',    customerId: customerIds['Roger Dunmore'],    customerName: 'Roger Dunmore',    status: 'Resolved',    priority: 'Low',      assignee: U.manager, channel: 'email' },
    { subject: 'On-site tank sensor not reporting correctly',         customerId: customerIds['Cassandra Webb'],   customerName: 'Cassandra Webb',   status: 'In_Progress', priority: 'High',     assignee: U.support, channel: 'phone' },
    { subject: 'Invoice discrepancy — October diesel statement',      customerId: customerIds['Priya Menon'],      customerName: 'Priya Menon',      status: 'Open',        priority: 'Medium',   assignee: U.support, channel: 'email' },
    { subject: 'Request hazmat compliance docs for audit',            customerId: customerIds['Carlos Delgado'],   customerName: 'Carlos Delgado',   status: 'Open',        priority: 'High',     assignee: U.admin,   channel: 'web' },
    { subject: 'Raptor Express — bulk rate tier not applied on bill', customerId: customerIds['Marcus Ford'],      customerName: 'Marcus Ford',      status: 'In_Progress', priority: 'Critical', assignee: U.support, channel: 'phone' },
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
    const c1 = db.collection('tickets').doc(ref.id).collection('comments').doc()
    await c1.set({ id: c1.id, author: t.customerName, body: `Issue raised: ${t.subject}`, isInternal: false, createdAt: now(), updatedAt: now() })
    const c2 = db.collection('tickets').doc(ref.id).collection('comments').doc()
    await c2.set({ id: c2.id, author: t.assignee.name, body: 'Investigating — will update you within 24 hours.', isInternal: true, createdAt: now(), updatedAt: now() })
    console.log(`  [${t.priority}] ${t.subject}`)
  }

  // ── Quotes ───────────────────────────────────────────────────────────────────
  console.log('\nQuotes:')
  const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30)
  const validUntilStr = validUntil.toISOString()

  const quoteDefs = [
    {
      dealId: dealIds[0], dealTitle: 'Annual Diesel Supply — Apex Hauling',
      customerId: customerIds['David Hartley'], customerName: 'David Hartley',
      status: 'Sent', subtotal: 440000, tax: 40000, total: 480000,
      lineItems: [
        { description: 'Ultra-Low Sulfur Diesel (annual — 150k gal @ $2.85/gal)', quantity: 150000, unitPrice: 2.85, total: 427500 },
        { description: 'On-site tank monitoring service (annual)',                  quantity: 1,      unitPrice: 12500, total: 12500 },
      ],
    },
    {
      dealId: dealIds[1], dealTitle: 'Fleet Fueling Contract — Sun State',
      customerId: customerIds['Monica Serrano'], customerName: 'Monica Serrano',
      status: 'Draft', subtotal: 285000, tax: 25000, total: 310000,
      lineItems: [
        { description: 'Fleet Card Program — 80 vehicles (annual)',               quantity: 80, unitPrice: 3000, total: 240000 },
        { description: 'Fuel management software subscription',                   quantity: 1,  unitPrice: 45000, total: 45000 },
      ],
    },
    {
      dealId: dealIds[4], dealTitle: 'Farm Fuel Agreement — Dunmore Farms',
      customerId: customerIds['Roger Dunmore'], customerName: 'Roger Dunmore',
      status: 'Accepted', subtotal: 85000, tax: 0, total: 85000,
      lineItems: [
        { description: 'Off-road diesel — harvest season (30k gal @ $2.60/gal)', quantity: 30000, unitPrice: 2.60, total: 78000 },
        { description: 'Emergency delivery surcharge waiver (annual)',             quantity: 1,     unitPrice: 7000, total: 7000 },
      ],
    },
    {
      dealId: dealIds[5], dealTitle: 'On-site Fueling — Iron Gate Construction',
      customerId: customerIds['Cassandra Webb'], customerName: 'Cassandra Webb',
      status: 'Sent', subtotal: 180000, tax: 15000, total: 195000,
      lineItems: [
        { description: 'Diesel — job site delivery (60k gal @ $2.80/gal)',        quantity: 60000, unitPrice: 2.80, total: 168000 },
        { description: 'Mobile fueling truck standby (per month x 6)',             quantity: 6,     unitPrice: 2000, total: 12000 },
      ],
    },
    {
      dealId: dealIds[6], dealTitle: 'Fleet Card Program — Lakeshore Transport',
      customerId: customerIds['James Kowalski'], customerName: 'James Kowalski',
      status: 'Declined', subtotal: 270000, tax: 0, total: 270000,
      lineItems: [
        { description: 'Fleet card — 95 vehicles (annual)', quantity: 95, unitPrice: 2842, total: 270000 },
      ],
    },
    {
      dealId: dealIds[3], dealTitle: 'Municipal Fuel Program — Glendale Transit',
      customerId: customerIds['Anita Patel'], customerName: 'Anita Patel',
      status: 'Draft', subtotal: 600000, tax: 50000, total: 650000,
      lineItems: [
        { description: 'CNG (compressed natural gas) — 200k DGE @ $2.90',        quantity: 200000, unitPrice: 2.90, total: 580000 },
        { description: 'Fueling station maintenance contract (annual)',            quantity: 1,      unitPrice: 20000, total: 20000 },
      ],
    },
    {
      dealId: dealIds[10], dealTitle: 'Long-Haul Diesel — Raptor Express',
      customerId: customerIds['Marcus Ford'], customerName: 'Marcus Ford',
      status: 'Sent', subtotal: 515000, tax: 45000, total: 560000,
      lineItems: [
        { description: 'ULSD — long-haul program (180k gal @ $2.75/gal)',         quantity: 180000, unitPrice: 2.75, total: 495000 },
        { description: 'DEF — 5k gallons @ $4.00/gal',                           quantity: 5000,   unitPrice: 4.00, total: 20000 },
      ],
    },
    {
      dealId: dealIds[8], dealTitle: 'City Fleet Fuel — Phoenix Public Works',
      customerId: customerIds['Carlos Delgado'], customerName: 'Carlos Delgado',
      status: 'Draft', subtotal: 850000, tax: 70000, total: 920000,
      lineItems: [
        { description: 'Unleaded gasoline — city fleet (200k gal @ $2.95/gal)',   quantity: 200000, unitPrice: 2.95, total: 590000 },
        { description: 'ULSD — heavy equipment (90k gal @ $2.80/gal)',            quantity: 90000,  unitPrice: 2.80, total: 252000 },
        { description: 'Fuel site compliance & reporting (annual)',                quantity: 1,      unitPrice: 8000, total: 8000 },
      ],
    },
  ]

  for (const q of quoteDefs) {
    const ref = db.collection('quotes').doc()
    await ref.set({ id: ref.id, ...q, notes: '', validUntil: validUntilStr, createdAt: now(), updatedAt: now() })
    console.log(`  [${q.status}] $${q.total.toLocaleString()} — ${q.dealTitle}`)
  }

  // ── Goals ─────────────────────────────────────────────────────────────────────
  console.log('\nGoals:')
  const yr = new Date().getFullYear()
  const goalDefs = [
    { name: 'Q4 Fuel Sales Revenue',          metric: 'revenue',         target: 1200000, period: 'quarterly', year: yr, quarter: 4, owner: 'all' },
    { name: 'Q4 Contracts Closed',            metric: 'deals_won',       target: 8,       period: 'quarterly', year: yr, quarter: 4, owner: 'all' },
    { name: 'Annual Fuel Revenue',            metric: 'revenue',         target: 4500000, period: 'annual',    year: yr,              owner: 'all' },
    { name: 'Annual Deals Won',               metric: 'deals_won',       target: 30,      period: 'annual',    year: yr,              owner: 'all' },
    { name: 'Monthly Leads Converted',        metric: 'leads_converted', target: 8,       period: 'monthly',   year: yr, month: new Date().getMonth() + 1, owner: 'all' },
    { name: "Sarah Q4 Revenue Target",        metric: 'revenue',         target: 500000,  period: 'quarterly', year: yr, quarter: 4, owner: managerId },
    { name: "Tom Q4 Contracts Target",        metric: 'deals_won',       target: 3,       period: 'quarterly', year: yr, quarter: 4, owner: agentId },
    { name: 'Monthly Activity Goal',          metric: 'activities',      target: 80,      period: 'monthly',   year: yr, month: new Date().getMonth() + 1, owner: 'all' },
    { name: 'Annual Lead Conversions',        metric: 'leads_converted', target: 60,      period: 'annual',    year: yr,              owner: 'all' },
  ]
  for (const g of goalDefs) {
    const ref = db.collection('goals').doc()
    await ref.set({ id: ref.id, ...g, createdAt: now(), updatedAt: now() })
    console.log(`  [${g.period}] ${g.name} — target: ${g.target.toLocaleString()}`)
  }

  // ── Renewals ──────────────────────────────────────────────────────────────────
  console.log('\nRenewals:')
  const mo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10) }

  const renewalDefs = [
    { customerId: customerIds['David Hartley'],    customerName: 'David Hartley',    contractValue: 480000, renewalDate: mo(1),  status: 'in_negotiation', probability: 75, owner: U.manager.name, notes: 'Discussing 3-year price-lock deal',              lastContactDate: mo(0) },
    { customerId: customerIds['Monica Serrano'],   customerName: 'Monica Serrano',   contractValue: 310000, renewalDate: mo(2),  status: 'upcoming',       probability: 88, owner: U.manager.name, notes: 'Satisfied with fuel card savings',               lastContactDate: mo(0) },
    { customerId: customerIds['Brett Calloway'],   customerName: 'Brett Calloway',   contractValue: 220000, renewalDate: mo(2),  status: 'at_risk',        probability: 40, owner: U.agent.name,   notes: 'Competitor offered lower bulk pricing — follow up urgently', lastContactDate: mo(-1) },
    { customerId: customerIds['Roger Dunmore'],    customerName: 'Roger Dunmore',    contractValue: 85000,  renewalDate: mo(8),  status: 'upcoming',       probability: 92, owner: U.manager.name, notes: 'Harvest fuel program renewing on schedule',     lastContactDate: mo(0) },
    { customerId: customerIds['Cassandra Webb'],   customerName: 'Cassandra Webb',   contractValue: 195000, renewalDate: mo(3),  status: 'in_negotiation', probability: 60, owner: U.agent.name,   notes: 'Adding DEF product line to renewal',            lastContactDate: mo(0) },
    { customerId: customerIds['James Kowalski'],   customerName: 'James Kowalski',   contractValue: 270000, renewalDate: mo(-1), status: 'churned',        probability: 0,  owner: U.manager.name, notes: 'Switched to competitor on price — revisit in 6 months', lastContactDate: mo(-2) },
    { customerId: customerIds['Carlos Delgado'],   customerName: 'Carlos Delgado',   contractValue: 920000, renewalDate: mo(5),  status: 'upcoming',       probability: 82, owner: U.admin.name,   notes: 'Expanding to 2 additional city depots',         lastContactDate: mo(0) },
    { customerId: customerIds['Shannon Tran'],     customerName: 'Shannon Tran',     contractValue: 165000, renewalDate: mo(4),  status: 'upcoming',       probability: 78, owner: U.manager.name, notes: 'Interested in adding biodiesel to contract',    lastContactDate: mo(-1) },
    { customerId: customerIds['Marcus Ford'],      customerName: 'Marcus Ford',      contractValue: 560000, renewalDate: mo(1),  status: 'in_negotiation', probability: 80, owner: U.manager.name, notes: 'Volume increase request — pricing adjustment needed', lastContactDate: mo(0) },
    { customerId: customerIds['Linda Osei'],       customerName: 'Linda Osei',       contractValue: 390000, renewalDate: mo(3),  status: 'upcoming',       probability: 65, owner: U.agent.name,   notes: 'Evaluating reseller margin structure',          lastContactDate: mo(-1) },
  ]

  for (const r of renewalDefs) {
    const ref = db.collection('renewals').doc()
    await ref.set({ id: ref.id, ...r, createdAt: now(), updatedAt: now() })
    console.log(`  [${r.status}] ${r.customerName} — $${r.contractValue.toLocaleString()} due ${r.renewalDate}`)
  }

  // ── Custom Fields ─────────────────────────────────────────────────────────────
  console.log('\nCustom Fields:')
  const cfDefs = [
    { entity: 'customer', name: 'Annual Fuel Volume (gal)',  type: 'number', required: false },
    { entity: 'customer', name: 'Primary Fuel Type',         type: 'text',   required: false },
    { entity: 'customer', name: 'Tank Capacity (gal)',       type: 'number', required: false },
    { entity: 'deal',     name: 'Fuel Product',              type: 'text',   required: false },
    { entity: 'deal',     name: 'Price Lock Period',         type: 'text',   required: false },
    { entity: 'deal',     name: 'Competing Supplier',        type: 'text',   required: false },
    { entity: 'lead',     name: 'Fleet Size (vehicles)',     type: 'number', required: false },
    { entity: 'lead',     name: 'Current Supplier',          type: 'text',   required: false },
  ]
  for (const cf of cfDefs) {
    const ref = db.collection('custom_fields').doc()
    await ref.set({ id: ref.id, ...cf, createdAt: now(), updatedAt: now() })
    console.log(`  [${cf.entity}] ${cf.name}`)
  }

  // ── Segments ──────────────────────────────────────────────────────────────────
  console.log('\nSegments:')
  const segmentDefs = [
    { name: 'Active Fleet Customers',       entity: 'customer', filters: [{ field: 'status', op: '==', value: 'Active' }] },
    { name: 'Municipal Accounts',           entity: 'customer', filters: [{ field: 'status', op: '==', value: 'Active' }] },
    { name: 'New Inbound Leads',            entity: 'lead',     filters: [{ field: 'status', op: '==', value: 'New' }] },
    { name: 'Qualified High-Value Leads',   entity: 'lead',     filters: [{ field: 'status', op: '==', value: 'Qualified' }] },
    { name: 'Deals > $200k',               entity: 'deal',     filters: [{ field: 'amount', op: '>', value: 200000 }] },
    { name: 'Deals in Negotiation',        entity: 'deal',     filters: [{ field: 'stage',  op: '==', value: 'Negotiation' }] },
  ]
  for (const s of segmentDefs) {
    const ref = db.collection('segments').doc()
    await ref.set({ id: ref.id, ...s, createdAt: now(), updatedAt: now() })
    console.log(`  ${s.name}`)
  }

  // ── Saved Views ───────────────────────────────────────────────────────────────
  console.log('\nSaved Views:')
  const savedViewDefs = [
    { name: 'Active Customers',       entityType: 'customer', filters: { status: 'Active' },       isDefault: true,  createdBy: managerId },
    { name: 'My Accounts',            entityType: 'customer', filters: { owner: managerId },        isDefault: false, createdBy: managerId },
    { name: 'New Inbound Leads',      entityType: 'lead',     filters: { status: 'New' },           isDefault: true,  createdBy: managerId },
    { name: 'Qualified Leads',        entityType: 'lead',     filters: { status: 'Qualified' },     isDefault: false, createdBy: managerId },
    { name: 'My Leads',              entityType: 'lead',     filters: { owner: agentId },           isDefault: false, createdBy: agentId },
    { name: 'Deals in Proposal',      entityType: 'deal',     filters: { stage: 'Proposal' },       isDefault: false, createdBy: agentId },
    { name: 'Deals in Negotiation',   entityType: 'deal',     filters: { stage: 'Negotiation' },    isDefault: false, createdBy: managerId },
    { name: 'Won Deals',              entityType: 'deal',     filters: { stage: 'Won' },             isDefault: false, createdBy: managerId },
  ]
  for (const sv of savedViewDefs) {
    const ref = db.collection('saved_views').doc()
    await ref.set({ id: ref.id, ...sv, createdAt: now(), updatedAt: now() })
    console.log(`  [${sv.entityType}] ${sv.name}`)
  }

  // ── Notifications ─────────────────────────────────────────────────────────────
  console.log('\nNotifications:')
  const notifDefs = [
    { userId: managerId, type: 'deal_updated',   title: 'Deal advanced to Negotiation',  body: 'Long-Haul Diesel — Raptor Express moved to Negotiation.',   read: false },
    { userId: agentId,   type: 'task_due',       title: 'Task due today',                body: 'Prepare municipal RFP response — Glendale Transit is due.',  read: false },
    { userId: adminId,   type: 'lead_assigned',  title: 'High-value lead assigned',      body: 'Oscar Petersen — Mountain State Highway Dept ($320k)',        read: true  },
    { userId: supportId, type: 'ticket_created', title: 'Critical ticket opened',        body: 'Raptor Express — bulk rate tier not applied on bill.',        read: false },
    { userId: managerId, type: 'renewal_due',    title: 'Renewal due next month',        body: 'David Hartley (Apex Hauling) — $480k contract up for renewal.',read: false },
    { userId: agentId,   type: 'ticket_updated', title: 'Ticket escalated to you',       body: 'On-site tank sensor not reporting correctly — High.',         read: false },
  ]
  for (const n of notifDefs) {
    const ref = db.collection('notifications').doc(n.userId).collection('items').doc()
    await ref.set({ id: ref.id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: now() })
    console.log(`  [${n.type}] → ${n.title}`)
  }

  console.log('\n=== Seed complete ===')
  console.log('')
  console.log('Demo login credentials:')
  console.log('  Admin:   admin@fuelcrm.dev   / Admin123!')
  console.log('  Manager: manager@fuelcrm.dev / Manager123!')
  console.log('  Agent:   agent@fuelcrm.dev   / Agent123!')
  console.log('  Support: support@fuelcrm.dev / Support123!')
  console.log('')
  console.log('Firebase project: crm-v1-d8854')
}

seed().catch(err => { console.error(err); process.exit(1) })
