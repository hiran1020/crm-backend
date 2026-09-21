/**
 * Seeds the Firebase Emulator with an admin user and sample CRM data.
 * Run with: npm run emulator:seed
 */
import { auth, db, now } from '../lib/firebase.js'

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

async function seed() {
  console.log('Seeding Firebase Emulator...')

  // ── Admin user ──────────────────────────────────────────────────────────────
  let uid: string
  try {
    const u = await auth.createUser({
      email: 'admin@crm.dev',
      password: 'Admin123!',
      displayName: 'Admin User',
    })
    uid = u.uid
    console.log('Created admin user:', uid)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'auth/email-already-exists') {
      uid = (await auth.getUserByEmail('admin@crm.dev')).uid
      console.log('Admin user already exists:', uid)
    } else throw err
  }

  await auth.setCustomUserClaims(uid, { role: 'admin' })

  await db.collection('users').doc(uid).set({
    id: uid,
    name: 'Admin User',
    email: 'admin@crm.dev',
    role: 'admin',
    avatarInitials: 'AU',
    lastLoginAt: null,
    createdAt: now(),
    updatedAt: now(),
  }, { merge: true })

  // ── Sample manager ──────────────────────────────────────────────────────────
  let managerId: string
  try {
    const m = await auth.createUser({
      email: 'manager@crm.dev',
      password: 'Manager123!',
      displayName: 'Sales Manager',
    })
    managerId = m.uid
  } catch {
    managerId = (await auth.getUserByEmail('manager@crm.dev')).uid
  }
  await auth.setCustomUserClaims(managerId, { role: 'manager' })
  await db.collection('users').doc(managerId).set({
    id: managerId, name: 'Sales Manager', email: 'manager@crm.dev',
    role: 'manager', avatarInitials: 'SM', lastLoginAt: null,
    createdAt: now(), updatedAt: now(),
  }, { merge: true })

  // ── Tags ────────────────────────────────────────────────────────────────────
  const tags = [
    { name: 'VIP',       color: '#ef4444' },
    { name: 'Enterprise', color: '#8b5cf6' },
    { name: 'Warm Lead', color: '#f59e0b' },
  ]
  const tagIds: string[] = []
  for (const tag of tags) {
    const ref = db.collection('tags').doc()
    await ref.set({ id: ref.id, ...tag })
    tagIds.push(ref.id)
  }

  // ── Customers ───────────────────────────────────────────────────────────────
  const customers = [
    { name: 'Acme Corporation', email: 'contact@acme.com',   phone: '+1-555-0100', company: 'Acme Corporation',   industry: 'Technology',   status: 'Active' },
    { name: 'Globex Corp',      email: 'info@globex.com',    phone: '+1-555-0101', company: 'Globex Corp',        industry: 'Manufacturing', status: 'Active' },
    { name: 'Initech LLC',      email: 'hello@initech.com',  phone: '+1-555-0102', company: 'Initech LLC',        industry: 'Finance',      status: 'Inactive' },
  ]
  const customerIds: string[] = []
  for (const c of customers) {
    const ref = db.collection('customers').doc()
    await ref.set({
      id: ref.id, ...c,
      ownerId: uid, ownerName: 'Admin User', ownerInitials: 'AU',
      tagIds: [tagIds[0]],
      createdAt: now(), updatedAt: now(),
    })
    customerIds.push(ref.id)
  }

  // ── Leads ───────────────────────────────────────────────────────────────────
  const leads = [
    { name: 'Alice Johnson', email: 'alice@example.com', company: 'Startup Alpha', status: 'New',         source: 'Website' },
    { name: 'Bob Smith',     email: 'bob@example.com',   company: 'Beta Co',       status: 'Contacted',   source: 'Referral' },
    { name: 'Carol White',   email: 'carol@demo.com',    company: 'Gamma Ltd',     status: 'Qualified',   source: 'LinkedIn' },
  ]
  for (const l of leads) {
    const ref = db.collection('leads').doc()
    await ref.set({
      id: ref.id, ...l,
      ownerId: uid, ownerName: 'Admin User', ownerInitials: 'AU',
      createdAt: now(), updatedAt: now(),
    })
  }

  // ── Deals ───────────────────────────────────────────────────────────────────
  const deals = [
    { title: 'Enterprise License — Acme',    stage: 'Qualified',   amount: 75000, probability: 25, customerId: customerIds[0], customerName: 'Acme Corporation', customerCompany: 'Acme Corporation' },
    { title: 'Annual SaaS Plan — Globex',    stage: 'Proposal',    amount: 24000, probability: 50, customerId: customerIds[1], customerName: 'Globex Corp',      customerCompany: 'Globex Corp' },
    { title: 'Professional Services — Acme', stage: 'Negotiation', amount: 18000, probability: 75, customerId: customerIds[0], customerName: 'Acme Corporation', customerCompany: 'Acme Corporation' },
  ]
  for (const d of deals) {
    const ref = db.collection('deals').doc()
    await ref.set({
      id: ref.id, ...d,
      ownerId: uid, ownerName: 'Admin User', ownerInitials: 'AU',
      createdAt: now(), updatedAt: now(),
    })
  }

  // ── Ticket ──────────────────────────────────────────────────────────────────
  const ticketRef = db.collection('tickets').doc()
  await ticketRef.set({
    id: ticketRef.id,
    title: 'Cannot access dashboard after login',
    description: 'Getting a 403 error on the dashboard page.',
    status: 'Open', priority: 'High',
    customerId: customerIds[0], customerName: 'Acme Corporation',
    assigneeId: managerId, assigneeName: 'Sales Manager',
    createdAt: now(), updatedAt: now(),
  })

  console.log('')
  console.log('Seed complete. Log in with:')
  console.log('  Admin:   admin@crm.dev   / Admin123!')
  console.log('  Manager: manager@crm.dev / Manager123!')
  console.log('')
  console.log('Emulator UI: http://localhost:4000')
}

seed().catch(err => { console.error(err); process.exit(1) })
