import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
export async function writeInventoryActivity(action, item) { await addDoc(collection(db, 'activityLog'), { panel: 'inventory', action, shape: item.shape ?? '', type: item.type ?? '', weight: Number(item.weight ?? 0), sku: item.sku ?? '', createdAt: serverTimestamp(), createdAtMs: Date.now() }) }
