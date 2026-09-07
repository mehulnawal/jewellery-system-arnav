import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db, secondaryApp } from '../firebase/config'
export const PERMISSIONS = [
  ['inventory', 'Inventory'], ['purchase', 'Purchase'], ['challan-stage-1', 'Challan Stage 1'], ['challan-stage-2', 'Challan Stage 2'], ['challan-stage-3', 'Challan Stage 3'], ['challan-stage-4', 'Challan Stage 4'],
]
export const accountEmail = accessId => `${String(accessId).trim().toLowerCase()}@access-id.local`
export const generateAccessId = () => `EMP${Math.random().toString(36).slice(2, 8).toUpperCase()}`
export const generatePassword = () => `${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}!A9`
export async function createEmployee({ accessId, password, permissions }) {
  const normalized = String(accessId || '').trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,32}$/.test(normalized)) throw new Error('Access ID must be 3–32 letters, numbers, hyphens, or underscores.')
  if (String(password).length < 8) throw new Error('Password must contain at least 8 characters.')
  const employeeAuth = getAuth(secondaryApp())
  const credential = await createUserWithEmailAndPassword(employeeAuth, accountEmail(normalized), password)
  const profile = { uid: credential.user.uid, accessId: normalized, role: 'employee', permissions, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  try { await setDoc(doc(db, 'employeeProfiles', credential.user.uid), profile) } catch (error) { await signOut(employeeAuth); throw error }
  await signOut(employeeAuth)
  return profile
}
export const employeeProfile = uid => getDoc(doc(db, 'employeeProfiles', uid))