import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, getDoc, getDocs, query, where, updateDoc, deleteDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
import { masterPriceKey, canonicalMasterPrice } from '../src/utils/masterPrices.js';
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Loopback emulator required.');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-master-prices',firestore:{rules:await readFile('firestore.rules','utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{
  for(const [uid,permissions] of [['admin',[]],['staff',['challan-stage-1']],['other',['inventory']]]) await setDoc(doc(ctx.firestore(),'employeeProfiles',uid),{role:uid==='admin'?'superadmin':'employee',active:true,permissions,accessId:uid});
});});
const store=(uid='admin')=>env.authenticatedContext(uid).firestore();
const base={type:'CBD',shape:'PR',height:'5',width:'7',price:7000};
const data=(row=base)=>({...row,active:true,revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:'admin'});
test('Admin canonical creates, edits, deactivation; hard delete forbidden',async()=>{
 const db=store(),ref=doc(db,'masterPrices',masterPriceKey(base));
 await assertSucceeds(setDoc(ref,data()));
 await assertSucceeds(updateDoc(ref,{price:7500,revision:2,updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{active:false,revision:3,updatedAt:serverTimestamp()}));
 await assertFails(deleteDoc(ref));
 assert.equal((await getDoc(ref)).data().price,7500);
});
test('Only authorized Challan staff can query active prices; no Staff writes or inactive reads',async()=>{
 const admin=store(),key=masterPriceKey(base);await setDoc(doc(admin,'masterPrices',key),data());
 const staff=store('staff');await assertSucceeds(getDocs(query(collection(staff,'masterPrices'),where('active','==',true))));
 for(const db of [staff,store('other'),env.unauthenticatedContext().firestore()]) {
   await assertFails(setDoc(doc(db,'masterPrices','5_PR_CBD__default'),data({...base,width:''})));
   await assertFails(updateDoc(doc(db,'masterPrices',key),{price:1,revision:2,updatedAt:serverTimestamp()}));
   await assertFails(deleteDoc(doc(db,'masterPrices',key)));
 }
 await assertFails(getDocs(collection(staff,'masterPrices')));
 await assertFails(getDoc(doc(store('other'),'masterPrices',key)));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'masterPrices',key)));
 await updateDoc(doc(admin,'masterPrices',key),{active:false,revision:2,updatedAt:serverTimestamp()});
 await assertFails(getDoc(doc(staff,'masterPrices',key)));
});
test('Rules reject noncanonical/invalid dimensions, aliases, bad price and stale revisions',async()=>{
 const db=store();
 for(const patch of [{height:'5.00'},{width:'7.00'},{height:5},{width:0},{width:'0'},{width:'7X8'},{height:'NaN'},{price:0},{price:Infinity},{price:NaN},{shape:'P_R'},{type:'C/BD'}]) await assertFails(setDoc(doc(db,'masterPrices','5_PR_CBD__7'),data({...base,...patch})));
 await assertFails(setDoc(doc(db,'masterPrices','alias'),data()));
 await setDoc(doc(db,'masterPrices',masterPriceKey(base)),data());
 await assertFails(updateDoc(doc(db,'masterPrices',masterPriceKey(base)),{price:7500,updatedAt:serverTimestamp()}));
});
test('Concurrent canonical-equivalent transactions allow one creation; default distinct',async()=>{
 const db=store();
 const add=async(row)=>runTransaction(db,async tx=>{const ref=doc(db,'masterPrices',masterPriceKey(row)),snap=await tx.get(ref);if(snap.exists())throw new Error('duplicate');tx.set(ref,data(canonicalMasterPrice(row)));});
 const outcomes=await Promise.allSettled([add(base),add({...base,height:'5.00',width:'7.00'})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 await assertSucceeds(add({...base,width:''}));
 assert.equal((await getDocs(collection(db,'masterPrices'))).size,2);
});

test('system status: Admin and Staff read missing/existing marker; anonymous and all client writes denied',async()=>{
 for(const uid of ['admin','staff','other']) await assertSucceeds(getDoc(doc(store(uid),'systemState','business')));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'systemState','business')));
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'systemState','business'),{generation:1,locked:true,status:'running'}));
 for(const uid of ['admin','staff','other']) {
  await assertSucceeds(getDoc(doc(store(uid),'systemState','business')));
  await assertFails(setDoc(doc(store(uid),'systemState','business'),{generation:1,locked:false}));
 }
 await assertFails(setDoc(doc(store(),'masterPrices',masterPriceKey(base)),data()));
});
