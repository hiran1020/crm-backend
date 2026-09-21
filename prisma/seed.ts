import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  const passwordHash = await bcrypt.hash('password', 12)

  // Admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@crm.dev' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@crm.dev',
      passwordHash,
      role: 'admin',
      status: 'active',
      avatarInitials: 'AU',
      jobTitle: 'Administrator',
      department: 'Operations',
    },
  })

  // Manager
  const manager = await prisma.user.upsert({
    where: { email: 'sarah@crm.dev' },
    update: {},
    create: {
      name: 'Sarah Wilson',
      email: 'sarah@crm.dev',
      passwordHash,
      role: 'manager',
      status: 'active',
      avatarInitials: 'SW',
      jobTitle: 'Sales Manager',
      department: 'Sales',
    },
  })

  // Sales agents
  const david = await prisma.user.upsert({
    where: { email: 'david@crm.dev' },
    update: {},
    create: {
      name: 'David Chen',
      email: 'david@crm.dev',
      passwordHash,
      role: 'sales_agent',
      status: 'active',
      avatarInitials: 'DC',
      jobTitle: 'Account Executive',
      department: 'Sales',
    },
  })

  await prisma.user.upsert({
    where: { email: 'emily@crm.dev' },
    update: {},
    create: {
      name: 'Emily Rodriguez',
      email: 'emily@crm.dev',
      passwordHash,
      role: 'sales_agent',
      status: 'active',
      avatarInitials: 'ER',
      jobTitle: 'Account Executive',
      department: 'Sales',
    },
  })

  // Support agent
  await prisma.user.upsert({
    where: { email: 'support@crm.dev' },
    update: {},
    create: {
      name: 'Support Agent',
      email: 'support@crm.dev',
      passwordHash,
      role: 'support',
      status: 'active',
      avatarInitials: 'SA',
      jobTitle: 'Support Specialist',
      department: 'Customer Success',
    },
  })

  // Sample tags
  const tags = await Promise.all([
    prisma.tag.upsert({ where: { name: 'VIP' },      update: {}, create: { name: 'VIP',      color: '#f59e0b' } }),
    prisma.tag.upsert({ where: { name: 'At Risk' },  update: {}, create: { name: 'At Risk',  color: '#ef4444' } }),
    prisma.tag.upsert({ where: { name: 'New' },      update: {}, create: { name: 'New',      color: '#10b981' } }),
    prisma.tag.upsert({ where: { name: 'Partner' },  update: {}, create: { name: 'Partner',  color: '#3b82f6' } }),
  ])

  // Sample customers
  const acme = await prisma.customer.upsert({
    where: { id: 'seed-customer-1' },
    update: {},
    create: {
      id: 'seed-customer-1',
      firstName: 'James',
      lastName: 'Carter',
      email: 'james.carter@acmecorp.com',
      phone: '+1-555-010-1000',
      company: 'Acme Corp',
      jobTitle: 'CTO',
      status: 'Active',
      ownerId: manager.id,
    },
  })

  await prisma.customerTag.upsert({
    where: { customerId_tagId: { customerId: acme.id, tagId: tags[0].id } },
    update: {},
    create: { customerId: acme.id, tagId: tags[0].id },
  })

  const globex = await prisma.customer.upsert({
    where: { id: 'seed-customer-2' },
    update: {},
    create: {
      id: 'seed-customer-2',
      firstName: 'Linda',
      lastName: 'Park',
      email: 'linda.park@globex.io',
      phone: '+1-555-020-2000',
      company: 'Globex Industries',
      jobTitle: 'VP Engineering',
      status: 'Active',
      ownerId: david.id,
    },
  })

  // Sample deal
  await prisma.deal.upsert({
    where: { id: 'seed-deal-1' },
    update: {},
    create: {
      id: 'seed-deal-1',
      title: 'Acme Enterprise License',
      customerId: acme.id,
      amount: 48000,
      stage: 'Proposal',
      ownerId: manager.id,
      expectedCloseDate: '2026-12-31',
      description: 'Annual enterprise license renewal with expanded seats.',
      probability: 50,
    },
  })

  // Sample lead
  await prisma.lead.upsert({
    where: { id: 'seed-lead-1' },
    update: {},
    create: {
      id: 'seed-lead-1',
      name: 'Tom Bradley',
      company: 'Initech Solutions',
      email: 'tom@initech.com',
      phone: '+1-555-030-3000',
      source: 'Website',
      status: 'New',
      value: 12000,
      ownerId: david.id,
      notes: 'Inbound from contact form. Interested in the starter plan.',
    },
  })

  // Sample ticket
  await prisma.ticket.upsert({
    where: { id: 'seed-ticket-1' },
    update: {},
    create: {
      id: 'seed-ticket-1',
      subject: 'Cannot export customer list to CSV',
      customerId: globex.id,
      status: 'Open',
      priority: 'High',
      assigneeId: admin.id,
      channel: 'email',
      tags: ['export', 'bug'],
    },
  })

  console.log('✅ Seed complete.')
  console.log('')
  console.log('Test accounts (password: password)')
  console.log('  admin@crm.dev   — admin')
  console.log('  sarah@crm.dev   — manager')
  console.log('  david@crm.dev   — sales_agent')
  console.log('  emily@crm.dev   — sales_agent')
  console.log('  support@crm.dev — support')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
