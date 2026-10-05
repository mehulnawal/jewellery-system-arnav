import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../auth/AuthContext';
import { inventorySnapshotRows, discoverInventory } from '../utils/inventoryDiscovery.js';
import { normalizeSize } from '../utils/dimensions.js';
import { logListenerFailure } from '../utils/businessStatus.js';

export function useInventoryDiscovery() {
  const { user } = useAuth();
  const uid = user?.uid, role = user?.role;
  const [state, setState] = useState({ uid: '', rows: [], loading: true, error: '' });
  useEffect(() => {
    if (!uid) return;
    let disposed = false, off = () => {}, timer;
    const listen = () => {
      if (disposed) return;
      off(); clearTimeout(timer);
      // orderBy(createdAt) excludes legacy documents without that field.
      off = onSnapshot(collection(db, 'inventory'), snapshot => {
        if (disposed) return;
        const rows = inventorySnapshotRows(snapshot);
        setState({ uid, rows, loading: false, error: '' });
        if (import.meta.env.DEV) {
          const { matches, counts, excluded, bySize } = discoverInventory(rows);
          const eligiblePhysicalIds = new Set(matches.map(row => row.id));
          console.info('[Inventory discovery]', {
            role,
            source: counts.source,
            eligible: counts.eligible,
            excluded: excluded.length,
            countsByNormalizedSize: bySize,
            size5Source: bySize['5']?.source ?? 0,
            size5Eligible: bySize['5']?.eligible ?? 0,
            size5Records: rows.filter(row => normalizeSize(row.size) === '5')
              .map(row => ({ physicalRecordId: row.id, sku: row.sku ?? '', rawSize: row.size,
                normalizedSize: '5', shape: row.shape ?? '', type: row.type ?? '',
                rawWeight: row.weight ?? null, rawPieces: row.pieces ?? row.quantity ?? row.qty ?? null,
                sourcePurchaseId: row.sourcePurchaseId ?? null, hasCreatedAt: row.createdAt != null,
                eligible: eligiblePhysicalIds.has(row.id) })),
            excludedRecords: excluded,
            storedIdConflicts: snapshot.docs.filter(entry => entry.data().id != null
              && entry.data().id !== entry.id).map(entry => ({
                physicalRecordId: entry.id, storedId: entry.data().id,
                sku: entry.data().sku ?? '', rawSize: entry.data().size ?? null,
              })),
          });
        }
      }, error => {
        if (disposed) return;
        logListenerFailure(db, 'inventory collection listen', { uid, role }, error);
        setState({ uid, rows: [], loading: false,
          error: 'Inventory could not be loaded. Retrying the connection.' });
        timer = setTimeout(listen, 5000);
      });
    };
    listen(); window.addEventListener('online', listen);
    return () => { disposed = true; off(); clearTimeout(timer); window.removeEventListener('online', listen); };
  }, [uid, role]);
  return state.uid === uid ? state : { rows: [], loading: Boolean(uid), error: '' };
}

