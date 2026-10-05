import { test, expect } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180' || process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9298') throw Error('Local emulators required');
const projectId='demo-jewellery-local',app=initializeApp({projectId},'real-auth-tests'),db=getFirestore(app);
const identities={};
let env;
test.beforeAll(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile('firestore.rules','utf8')}});
 await env.clearFirestore();
 await fetch('http://127.0.0.1:9298/emulator/v1/projects/demo-jewellery-local/accounts',{method:'DELETE'});
 for(const uid of ['real-admin','real-staff']) {
  const response=await fetch('http://127.0.0.1:9298/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-local-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:uid+'@access-id.local',password:'LocalOnly123!',returnSecureToken:true})});
  const body=await response.json();if(!response.ok)throw Error(JSON.stringify(body));identities[uid]=body.localId;
  // Missing/stale uid fields must not replace authenticated physical identity.
  await db.doc('employeeProfiles/'+identities[uid]).set({...(uid==='real-staff'?{uid:'stale-profile-id'}:{}),role:uid==='real-admin'?'superadmin':'employee',active:true,accessId:uid,permissions:uid==='real-admin'?[]:['challan-stage-1']});
 }
});
test.afterAll(async()=>{await env.cleanup();await deleteApp(app);});
async function login(page,uid){
 await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/,r=>r.abort());
 await page.goto('/login');await page.getByPlaceholder('e.g. EMP123 or admin@email.com').fill(uid);
 await page.getByPlaceholder('Enter your password').fill('LocalOnly123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/dashboard/);
}
test('real Auth + resolved profiles: Admin management and Staff lookup without mocked sessions',async({page,browser})=>{
 await login(page,'real-admin');await page.goto('/dashboard/master-prices');
 await expect(page.getByText('No Master Prices added yet.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add Price',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Add Master Price'});
 for(const [field,value] of Object.entries({Type:'CVD',Shape:'Emerlad',Height:'5.00',Price:'5000'}))await modal.getByLabel(field,{exact:true}).fill(value);
 await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);
 await expect(page.locator('.master-records tbody tr')).toHaveCount(1);
 expect((await db.doc('masterPrices/5_Emerlad_CVD__default').get()).data().updatedBy).toBe(identities['real-admin']);
 await page.reload();await expect(page.locator('.master-records tbody tr')).toHaveCount(1);await expect(page.locator('.master-notice')).toHaveCount(0);
 await db.doc('inventory/physical-five').set({size:'5.00',shape:'Emerlad',type:'CVD',sku:'5.00_Emerlad_CVD',weight:2,pieces:2});
 const context=await browser.newContext(),staff=await context.newPage();await login(staff,'real-staff');
 await staff.goto('/dashboard/master-prices');await expect(staff.getByRole('heading',{name:'Master Price List',exact:true})).toHaveCount(0);
 await staff.goto('/dashboard/challan');
 await staff.getByRole('button',{name:'Create Challan',exact:true}).click();
 await staff.getByRole('combobox',{name:'Inventory picker'}).fill('5 emerald CVD');
 await staff.getByRole('option').filter({hasText:'Record physical-five'}).click();
 await expect(staff.getByPlaceholder('Price',{exact:true})).toHaveValue('5000');
 await context.close();
});

