import { addDoc, collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'

const dateKey = (value = new Date()) => {
  const offset = value.getTimezoneOffset()
  return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10)
}

// This snapshot is written into every event so renamed/deleted Access IDs cannot alter history.
export const auditActor = user => ({
  uid: user?.uid || user?.id || 'unidentified',
  accessId: user?.accessId || user?.accessID || user?.email || user?.uid || user?.name || 'Unknown Access ID',
})

export async function captureFirstLogin(user) {
  const actor = auditActor(user)
  const day = dateKey()
  const ref = doc(db, 'activityLogFirstLogins', `${encodeURIComponent(actor.uid)}_${day}`)
  const now = Date.now()
  const firstLoginAtMs = await runTransaction(db, async transaction => {
    const existing = await transaction.get(ref)
    if (existing.exists()) return existing.data().firstLoginAtMs
    transaction.set(ref, { actor, day, firstLoginAtMs: now, createdAt: serverTimestamp() })
    return now
  })
  return { actor, firstLoginAtMs }
}

const inventorySnapshot = (item, origin) => ({
  shape: item.shape ?? '', type: item.type ?? '', weight: Number(item.weight ?? 0),
  sku: item.sku ?? '', size: item.size ?? '', box: item.box ?? '', origin: origin || item.origin || 'Manual',
})
const changedFields = (before, after) => Object.keys(after).reduce((result, field) => {
  if (JSON.stringify(before?.[field] ?? '') !== JSON.stringify(after[field] ?? '')) result.push({ field, oldValue: before?.[field] ?? '', newValue: after[field] ?? '' })
  return result
}, [])

export async function writeInventoryActivity(action, item, { before, origin, user } = {}) {
  const login = await captureFirstLogin(user)
  const snapshot = inventorySnapshot(item, origin)
  const event = { panel: 'inventory', action, recordId: item.id || '', snapshot, ...snapshot, actor: login.actor, accessIdSnapshot: login.actor.accessId, firstLoginAtMs: login.firstLoginAtMs, eventAtMs: Date.now(), eventDate: dateKey(), createdAt: serverTimestamp() }
  if (action === 'edited') event.changes = changedFields(inventorySnapshot(before), snapshot)
  await addDoc(collection(db, 'activityLog'), event)
}

// Reusable append-only audit API for the existing backend's Challan and Purchase actions.
export async function writeActivity({ panel, stage, action = 'created', recordId, snapshot = {}, before, user }) {
  const login = await captureFirstLogin(user)
  const event = { panel, stage: stage || '', action, recordId: recordId || '', snapshot, ...snapshot, actor: login.actor, accessIdSnapshot: login.actor.accessId, firstLoginAtMs: login.firstLoginAtMs, eventAtMs: Date.now(), eventDate: dateKey(), createdAt: serverTimestamp() }
  if (action === 'edited') event.changes = changedFields(before, snapshot)
  await addDoc(collection(db, 'activityLog'), event)
}