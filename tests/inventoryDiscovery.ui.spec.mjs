import { test, expect } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw Error('Loopback emulator required');
const app=initializeApp({projectId:'demo-jewellery-ui'},'discovery-tests'),db=getFirestore(app);
let env;
test.beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-jewellery-ui',firestore:{rules:await readFile('firestore.rules','utf8')}});});
test.afterAll(async()=>{await env.cleanup();await deleteApp(app);});
test.beforeEach(async({page})=>{
 await env.clearFirestore();
 await db.doc('employeeProfiles/admin').set({uid:'admin',role:'superadmin',active:true,permissions:[],accessId:'admin'});
 for(const path of ['inventoryIdentityMigrations/v1','numberingMigrations/manual-v1','numberingMigrations/letters-v1']) await db.doc(path).set({ready:true});
 await page.addInitScript(()=>localStorage.setItem('test-role','admin'));
 await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/,r=>r.abort());
});
async function openChallan(page) {
 await page.goto('/dashboard/challan');
 await page.getByRole('button',{name:'Create Challan',exact:true}).click();
}
for(const size of [1,2,3,5,10,0.3,4.5,5.25,7.35,6.75]) test('All views, multi-token search and physical selection: Size '+size,async({page})=>{
 test.setTimeout(90000);
 const rows=[];
 for(const raw of [size,String(size),Number(size).toFixed(2)]) for(const shape of ['Emerlad','Round','Princess']) for(const type of ['CVD','HP']) {
  const id='physical-'+rows.length;
  const row={id:'legacy-duplicate-field',size:raw,shape,type,sku:raw+'_'+shape+'_'+type,weight:'10',pieces:4};
  rows.push({...row,id});
  // Deliberately missing createdAt; persisted id differs from the physical path.
  await db.doc('inventory/'+id).set(row);
 }
 await page.goto('/dashboard/inventory');
 await page.getByPlaceholder('Search; use 5.3mm for Size only').fill(String(size)+'mm');
 await expect(page.locator('.inventory-chevron')).toHaveCount(6);
 for(const button of await page.locator('.inventory-chevron').all()) await button.click();
 await expect(page.locator('.inventory-item')).toHaveCount(18);
 await page.goto('/dashboard/check-inventory');
 await page.locator('.check-search input').fill(String(size)+'mm');
 await expect(page.locator('.check-cards > *')).toHaveCount(18);
 await openChallan(page);
 const picker=page.getByRole('combobox',{name:'Inventory picker'}),options=page.getByRole('option');
 for(const q of [String(size),Number(size).toFixed(2)]) {await picker.fill(q);await expect(options).toHaveCount(18);}
 await picker.fill(String(size)+' CVD');await expect(options).toHaveCount(9);
 await picker.fill(String(size)+' emerald');await expect(options).toHaveCount(6);
 await picker.fill(String(size)+' emerald CVD');await expect(options).toHaveCount(3);
 const selected=rows[12];
 await picker.fill(selected.sku);await expect(options).toHaveCount(3);
 await options.filter({hasText:'Record '+selected.id}).click();
 await page.getByPlaceholder('B35/1',{exact:true}).fill('B91/1');
 await page.locator('.party-picker input').fill('Discovery Test');
 await page.getByPlaceholder('Weight (ct)',{exact:true}).fill('1');
 await page.getByPlaceholder('pieces',{exact:true}).fill('1');
 await page.getByPlaceholder('Price',{exact:true}).fill('100');
 await page.getByPlaceholder('Discount %',{exact:true}).fill('0');
 await page.getByRole('button',{name:'Create Challan',exact:true}).click();
 await expect(page.locator('.challan-row')).toHaveCount(1);
 const saved=(await db.collection('challans').get()).docs[0].data();
 expect(saved.items[0].inventoryId).toBe(selected.id);
 expect(saved.items[0].sourceInventoryId).toBe(selected.id);
 expect((await db.doc('inventory/'+selected.id).get()).data().weight).toBe(9);
 expect((await db.collection('inventory').get()).size).toBe(18);
});
test('Purchase-created multiple Sizes reach an already-open picker; stock and new records update live',async({page,browser})=>{
 test.setTimeout(90000);
 await openChallan(page);
 const picker=page.getByRole('combobox',{name:'Inventory picker'});
 await picker.fill('5');await expect(page.getByRole('option')).toHaveCount(0);
 const context=await browser.newContext(),purchase=await context.newPage();
 await purchase.addInitScript(()=>localStorage.setItem('test-role','admin'));
 await purchase.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/,r=>r.abort());
 await purchase.goto('/dashboard/purchase');
 const sizes=['2.00','5.00','6.75'], book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(sizes.map((_,i)=>({'Import Ref':'p'+i,'Purchase Number':'PR-A80-'+(i+1),Date:'2026-10-02','Vendor Name':'Discovery Vendor','Total Purchase Weight (ct)':2,Amount:100,Discount:0,'Payment Due Days':0}))),'Purchases');
 XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(sizes.map((size,i)=>({'Import Ref':'p'+i,Type:'HP',Shape:'Round','Size (mm)':size,'Weight (ct)':2,Pieces:2,BOX:''}))),'Items');
 await purchase.locator('input[type=file]').setInputFiles({name:'purchases.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await purchase.getByRole('button',{name:'Import 3 valid Purchases',exact:true}).click();
 await expect(purchase.locator('.purchase-import-card')).toHaveCount(0);
 const stocks=(await db.collection('inventory').get()).docs;
 expect(stocks).toHaveLength(3);
 for(const stock of stocks) {
  expect(stock.data().sourcePurchaseId).toBeTruthy();
  await picker.fill(stock.data().size);await expect(page.getByRole('option').filter({hasText:'Record '+stock.id})).toBeVisible();
 }
 const five=stocks.find(d=>d.data().size==='5');
 const fiveOption=page.getByRole('option').filter({hasText:'Record '+five.id});
 await picker.fill('5');await expect(fiveOption).toBeVisible();
 await five.ref.update({weight:0,pieces:0});await expect(fiveOption).toHaveCount(0);
 await five.ref.update({weight:2});await expect(fiveOption).toBeVisible();
 await db.doc('inventory/new-7.35').set({size:'7.3500',shape:'Emerlad',type:'CVD',sku:'7.3500_Emerlad_CVD',weight:'0.001'});
 await picker.fill('7.35 emerald CVD');await expect(page.getByRole('option').filter({hasText:'Record new-7.35'})).toBeVisible();
 await context.close();
});
