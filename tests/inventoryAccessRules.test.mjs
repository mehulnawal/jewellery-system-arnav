import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { saveInventoryIdentity } from '../src/utils/inventoryIdentity.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
  throw new Error('Loopback Firestore emulator required.');
const projectId = 'demo-inventory-access-rules';
const app = initializeApp({ projectId }, 'inventory-access-rules');
const server = getFirestore(app);
let env;
const client = (uid) => env.authenticatedContext(uid).firestore();
const payload = (uid, size) => ({ type: 'CVD', shape: 'Pear', size, weight: 1, box: '', createdBy: uid, createdAt: serverTimestamp() });

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile('firestore.master-price-inventory.review.rules', 'utf8') } });
});
after(async () => { await env?.cleanup(); await deleteApp(app); });
beforeEach(async () => {
  await env.clearFirestore();
  for (const [uid, role, permissions, active] of [
    ['admin', 'superadmin', [], true],
    ['stock-staff', 'employee', ['inventory'], true],
    ['zero-staff', 'employee', [], true],
    ['inactive-staff', 'employee', ['inventory'], false],
  ]) await server.doc(`employeeProfiles/${uid}`).set({ role, permissions, active, accessId: uid });
  await server.doc('inventoryIdentityMigrations/v1').set({ ready: true });
  await server.doc('inventory/legacy-five').set({ type: 'CVD', shape: 'Pear', size: '5.00', sku: '5.00_Pear_CVD', weight: 1 });
  await server.doc('inventoryIdentities/5_Pear_CVD').set({ sku: '5_Pear_CVD', recordId: 'legacy-five' });
});

test('pasted production rules: zero-permission active Staff reads Inventory but cannot create or claim', async () => {
  const zero = client('zero-staff');
  assert.equal((await assertSucceeds(getDocs(collection(zero, 'inventory')))).size, 1);
  await assertSucceeds(getDoc(doc(zero, 'inventory', 'legacy-five')));
  await assertFails(saveInventoryIdentity(zero, doc(zero, 'inventory', 'zero-new'), payload('zero-staff', '6')));
  await assertFails(setDoc(doc(zero, 'inventoryIdentities', '6_Pear_CVD'), { sku: '6_Pear_CVD', recordId: 'zero-new' }));
  assert.equal((await server.doc('inventory/zero-new').get()).exists, false);
  const inactive = client('inactive-staff');
  await assertFails(getDocs(collection(inactive, 'inventory')));
  await assertFails(saveInventoryIdentity(inactive, doc(inactive, 'inventory', 'inactive-new'), payload('inactive-staff', '7')));
});

test('pasted production rules: Admin and Inventory Staff create safely, duplicate blocked, Activity Log retained', async () => {
  for (const [uid, id, size] of [['admin', 'admin-new', '7'], ['stock-staff', 'staff-new', '8']]) {
    const db = client(uid);
    await assertSucceeds(saveInventoryIdentity(db, doc(db, 'inventory', id), payload(uid, size)));
    assert.equal((await server.doc(`inventoryIdentities/${size}_Pear_CVD`).get()).data().recordId, id);
    await assertSucceeds(setDoc(doc(db, 'activityLog', `${id}-log`), {
      panel: 'inventory', action: 'created', recordId: id,
      actor: { uid, accessId: uid, role: uid === 'admin' ? 'superadmin' : 'employee' },
      createdAt: serverTimestamp(),
    }));
  }
  const staff = client('stock-staff');
  await assert.rejects(saveInventoryIdentity(staff, doc(staff, 'inventory', 'duplicate-five'), payload('stock-staff', '5.0')), /already exists/);
  assert.equal((await server.collection('inventory').get()).size, 3);
  assert.equal((await server.collection('activityLog').get()).size, 2);
});


test('missing READY marker stops Admin Add before any Inventory or reservation write', async () => {
  await server.doc('inventoryIdentityMigrations/v1').delete();
  const admin = client('admin');
  await assert.rejects(saveInventoryIdentity(admin, doc(admin, 'inventory', 'blocked-admin'), payload('admin', '9')), /identity index is not ready/);
  await assertFails(setDoc(doc(admin, 'inventory', 'legacy-direct-create'), { ...payload('admin', '9'), sku: '9_Pear_CVD' }));
  assert.equal((await server.doc('inventory/blocked-admin').get()).exists, false);
  assert.equal((await server.doc('inventoryIdentities/9_Pear_CVD').get()).exists, false);
});
