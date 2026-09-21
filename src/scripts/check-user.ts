import 'dotenv/config'
import { auth, db, now } from '../lib/firebase.js'

const EMAIL = 'hiran.basnet2@gmail.com'
const PASSWORD = 'passwordCRM'

async function run() {
  let user
  try {
    user = await auth.getUserByEmail(EMAIL)
    console.log('User EXISTS in Firebase Auth')
    console.log('  uid:', user.uid)
    const claims = (user.customClaims ?? {}) as Record<string, unknown>
    console.log('  current role:', claims.role ?? '(none — will set admin)')
  } catch {
    console.log('User NOT found — creating...')
    user = await auth.createUser({ email: EMAIL, password: PASSWORD, displayName: 'Hiran Basnet' })
    console.log('  Created uid:', user.uid)
  }
  await auth.setCustomUserClaims(user.uid, { role: 'admin' })
  await db.collection('users').doc(user.uid).set({
    id: user.uid, name: 'Hiran Basnet', email: EMAIL, role: 'admin',
    avatarInitials: 'HB', createdAt: now(), updatedAt: now(),
  }, { merge: true })
  console.log('  role: admin')
  console.log('  Firestore profile: saved')
  console.log()
  console.log('Login ready:')
  console.log('  Email:   ', EMAIL)
  console.log('  Password:', PASSWORD)
}
run().catch(e => { console.error('Error:', e.message); process.exit(1) })
