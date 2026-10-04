import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, runTransaction, serverTimestamp, writeBatch } from "firebase/firestore";
import { saveInventoryIdentity } from "../src/utils/inventoryIdentity.js";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Local emulator required.");
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:"demo-dimensions",firestore:{rules:await readFile("firestore.rules","utf8")}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),"employeeProfiles","admin"),{role:"superadmin",active:true});
    await setDoc(doc(ctx.firestore(),"inventoryIdentityMigrations","v1"),{ready:true});
  });
});
const db=()=>env.authenticatedContext("admin").firestore();
const payload=size=>({size,shape:"PR",type:"CBD",weight:2,createdBy:"admin",createdAt:serverTimestamp()});
test("concurrent equivalent creations allow exactly one physical record",async()=>{
  const store=db();
  const result=await Promise.allSettled(["5","5.00","5.000"].map((size,i)=>saveInventoryIdentity(store,doc(store,"inventory",`item${i}`),payload(size))));
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  const claim=await getDoc(doc(store,"inventoryIdentities","5_PR_CBD"));
  const saved=await getDoc(doc(store,"inventory",claim.data().recordId));
  assert.equal(saved.data().size,"5");assert.equal(saved.data().sku,"5_PR_CBD");
});
test("server rejects unclaimed and noncanonical writes, including administrator bypass",async()=>{
  const store=db();
  for(const size of ["5.00",5,"0","-1","NaN","Infinity","5..3","5.","05","0X5"]) {
    const batch=writeBatch(store), sku=`${size}_PR_CBD`;
    batch.set(doc(store,"inventory","bypass"),{...payload(size),sku});
    batch.set(doc(store,"inventoryIdentities",sku),{sku,recordId:"bypass"});
    await assertFails(batch.commit());
  }
  await assertFails(setDoc(doc(store,"inventory","unclaimed"),{...payload("5"),sku:"5_PR_CBD"}));
});
test("legacy collision is reserved, remains visible and stock edits do not merge",async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{
    for(const [id,size] of [["a","5"],["b","5.00"]]) await setDoc(doc(ctx.firestore(),"inventory",id),{...payload(size),sku:`${size}_PR_CBD`});
    await setDoc(doc(ctx.firestore(),"inventoryIdentities","5_PR_CBD"),{sku:"5_PR_CBD",recordId:null,legacyRecordIds:["a","b"]});
  });
  const store=db();
  await assert.rejects(saveInventoryIdentity(store,doc(store,"inventory","new"),payload("5.0")),/collision/);
  await assertSucceeds(saveInventoryIdentity(store,doc(store,"inventory","b"),{...payload("5"),weight:4},true));
  assert.equal((await getDoc(doc(store,"inventory","a"))).data().weight,2);
  assert.equal((await getDoc(doc(store,"inventory","b"))).data().size,"5.00");
});
test("missing audit index blocks new identities but leaves stock updates working",async()=>{
  const store=db();
  await saveInventoryIdentity(store,doc(store,"inventory","a"),payload("5"));
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),"inventoryIdentityMigrations","v1"),{ready:false}));
  await assert.rejects(saveInventoryIdentity(store,doc(store,"inventory","b"),payload("6")),/not ready/);
  await assertSucceeds(updateDoc(doc(store,"inventory","a"),{weight:1}));
});
test("edit into occupied identity is rejected; meaningful precision remains distinct",async()=>{
  const store=db();
  await saveInventoryIdentity(store,doc(store,"inventory","a"),payload("5.3"));
  await saveInventoryIdentity(store,doc(store,"inventory","b"),payload("5.03"));
  await assert.rejects(saveInventoryIdentity(store,doc(store,"inventory","b"),payload("5.300"),true),/already exists/);
  await saveInventoryIdentity(store,doc(store,"inventory","b"),payload("5.125000"),true);
  assert.equal((await getDoc(doc(store,"inventory","b"))).data().size,"5.125");
});
