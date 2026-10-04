import { test, expect } from "@playwright/test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as XLSX from "xlsx";
import { auditDimensions } from "../src/utils/dimensionAudit.js";
import { writeFile } from "node:fs/promises";
import { initializeInventoryIdentities, readIdentityPlan } from "../scripts/lib/initializeInventoryIdentities.mjs";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("UI tests require the local Firestore emulator.");
const app = initializeApp({ projectId: "demo-jewellery-ui" }, "ui-tests");
const db = getFirestore(app);
let env;
const permissions = ["inventory", "purchase", "challan-stage-1", "challan-stage-2", "challan-stage-3", "challan-stage-4"];
test.beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-jewellery-ui", firestore: { rules: await readFile("firestore.rules", "utf8") } });
});
test.afterAll(async () => { await env?.cleanup(); await deleteApp(app); });
test.beforeEach(async ({ page }) => {
  await env.clearFirestore();
  await Promise.all([
    ...["admin", "staff", "purchase-only", "no-purchase"].map((uid) => db.doc(`employeeProfiles/${uid}`).set({ uid, accessId: uid, role: uid === "admin" ? "superadmin" : "employee", active: true, permissions: uid === "admin" ? [] : uid === "purchase-only" ? ["purchase"] : uid === "no-purchase" ? ["inventory"] : permissions })),
    db.doc("inventoryIdentityMigrations/v1").set({ ready: true }),
    db.doc("inventoryIdentities/1_Round_CVD").set({ sku: "1_Round_CVD", recordId: "stock" }),
    db.doc("numberingMigrations/manual-v1").set({ ready: true }),
    db.doc("numberingMigrations/letters-v1").set({ ready: true }),
    db.doc("inventory/stock").set({ sku: "1_Round_CVD", shape: "Round", type: "CVD", size: "1", weight: 10, pieces: 10, createdAt: Timestamp.now(), createdBy: "admin" }),
  ]);
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  // No test browser request may reach a production Firebase service.
  await page.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/, (route) => route.abort());
});
async function asRole(page, role, path) {
  await page.addInitScript((value) => localStorage.setItem("test-role", value), role);
  await page.goto(path);
  await expect(page.locator('.business-availability')).toBeVisible();
  await expect(page.locator('.availability-banner')).toHaveCount(0);
}

async function addPrice(page, { height = '5.00', width = '', price = '5000', type = 'CBD', shape = 'PR' } = {}) {
  await page.getByRole('button', {name:'Add Price',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Add Master Price'});
  for(const [field,value] of Object.entries({Type:type,Shape:shape,Height:height,Width:width,Price:price})) await modal.getByLabel(field,{exact:true}).fill(value);
  await modal.getByRole('button',{name:'Save Price'}).click(); await expect(modal).toHaveCount(0);
}
async function openPricedChallan(page) {
  await asRole(page,'staff','/dashboard/challan');
  await page.getByRole('button',{name:'Create Challan',exact:true}).click();
  await page.getByPlaceholder('B35/1',{exact:true}).fill('B75/1');
  await page.locator('.party-picker input').fill('Price Test');
  await page.getByPlaceholder('Search SKU...').fill('5_PR_CBD');
  await page.locator('.sku-menu button').first().click();
  await page.getByPlaceholder('Weight (ct)',{exact:true}).fill('1');
  await page.getByPlaceholder('pieces',{exact:true}).fill('1');
}
async function seedStock() {
  await db.doc('inventory/stock').update({size:'5.00',sku:'5_PR_CBD',shape:'PR',type:'CBD'});
}
test('Offline lookup is explained; saved auto prices remain snapshots; import races are protected',async({page})=>{
  await seedStock();await asRole(page,'admin','/dashboard/master-prices');await addPrice(page,{width:'7',price:'7000'});
  const race=await page.evaluate(async()=>{
    const {saveMasterPrice,importMasterPrices}=await import('/src/utils/masterPriceStore.js');const {testUser}=await import('/tests/fixtures/auth.jsx');
    const row={type:'CBD',shape:'PR',height:'6',width:'8',price:8000};
    const outcomes=await Promise.allSettled([saveMasterPrice(row,testUser),importMasterPrices([{...row,height:'6.00',width:'8.00',rowNumber:2,errors:{}}],testUser)]);
    return outcomes.map((outcome,index)=>outcome.status==='fulfilled'?(index===0?1:Number(outcome.value[0].added)):0).reduce((a,b)=>a+b,0);
  });expect(race).toBe(1);
  await openPricedChallan(page);const width=page.getByPlaceholder('Width (optional)'),price=page.getByPlaceholder('Price',{exact:true});await width.fill('7');await expect(price).toHaveValue('7000');
  await page.evaluate(async()=>{const {disableNetwork,db}=await import('/tests/fixtures/firebase.js');await disableNetwork(db);});
  await expect(page.getByText(/Master Prices are offline or still connecting/)).toBeVisible();await price.fill('6800');await expect(price).toHaveValue('6800');
  await page.evaluate(async()=>{const {enableNetwork,db}=await import('/tests/fixtures/firebase.js');await enableNetwork(db);});await expect(page.getByText(/Master Prices are offline or still connecting/)).toHaveCount(0);await expect(price).toHaveValue('6800');
  await width.fill('8');await expect(price).toHaveValue('');await width.fill('7');await expect(price).toHaveValue('7000');
  await page.getByRole('button',{name:'Create Challan',exact:true}).click();await expect(page.locator('.challan-row')).toHaveCount(1);const saved=(await db.collection('challans').get()).docs[0];expect(saved.data().items[0].amount).toBe(7000);
  await db.doc('masterPrices/5_PR_CBD__7').update({price:7500});expect((await saved.ref.get()).data().items[0].amount).toBe(7000);
  await page.locator('.challan-row').getByRole('button',{name:'Edit',exact:true}).click();await expect(price).toHaveValue('7000');await db.doc('masterPrices/5_PR_CBD__7').update({active:false});await expect(price).toHaveValue('7000');expect((await saved.ref.get()).data().items[0].amount).toBe(7000);
});
test('Live default deletion, manual missing-price priority, Admin sync and responsive themes',async({page,browser})=>{
  await seedStock();await asRole(page,'admin','/dashboard/master-prices');await addPrice(page);
  const context=await browser.newContext(),other=await context.newPage();await other.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/,r=>r.abort());
  await asRole(other,'admin','/dashboard/master-prices');await expect(other.locator('.master-prices tbody tr')).toHaveCount(1);
  await addPrice(page,{width:'7',price:'7000'});await expect(other.locator('.master-prices tbody tr')).toHaveCount(2);
  for(const theme of ['light','dark']) {
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await page.screenshot({path:`test-results/master-${theme}.png`,fullPage:true});
    const colors=await page.locator('.master-prices table').evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));expect(colors.text).not.toBe(colors.background);
  }
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Add Price',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add Price',exact:true}).click();await expect(page.getByRole('dialog')).toBeInViewport();await page.getByRole('button',{name:'Cancel'}).click();await page.screenshot({path:'test-results/master-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await openPricedChallan(other);const price=other.getByPlaceholder('Price',{exact:true}),width=other.getByPlaceholder('Width (optional)');await expect(price).toHaveValue('5000');
  await page.getByLabel('Filter width').selectOption('default');await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm Delete'}).click();await expect(price).toHaveValue('');
  await width.fill('8');await price.fill('7600');await addPrice(page,{width:'8',price:'8000'});await expect(price).toHaveValue('7600');
  await page.getByLabel('Filter width').selectOption('8');await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm Delete'}).click();await expect(price).toHaveValue('7600');
  await width.fill('7');await expect(price).toHaveValue('7000');
  await other.getByPlaceholder('Search SKU...').fill('not selected');await expect(price).toHaveValue('');
  await context.close();
});
test('Width and transaction Price survive all Challan stages, print and export',async({page})=>{
  await seedStock();await asRole(page,'admin','/dashboard/master-prices');await addPrice(page,{width:'7',price:'7000'});
  await openPricedChallan(page);await page.getByPlaceholder('Width (optional)').fill('7.00');await expect(page.getByPlaceholder('Price',{exact:true})).toHaveValue('7000');
  await page.getByRole('button',{name:'Create Challan',exact:true}).click();await expect(page.locator('.challan-row')).toHaveCount(1);
  await asRole(page,'admin','/dashboard/challan');await page.locator('.challan-row .challan-workflow-button').click();
  let modal=page.getByRole('dialog',{name:'Process Return / Move to Stage 2'});await modal.locator('.stage-two-row input').nth(0).fill('0');await modal.locator('.stage-two-row input').nth(1).fill('0');await modal.getByRole('button',{name:/Move to Stage 2/}).click();await expect(modal).toHaveCount(0);
  let saved=(await db.collection('challans').get()).docs[0];expect(saved.data().stage2Return.items[0]).toMatchObject({width:'7',amount:7000,sourceInventoryId:'stock'});
  await page.locator('.challan-row .challan-workflow-button').click();await page.getByRole('button',{name:'Confirm Final Invoice / Move to Stage 3'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await saved.ref.get()).data().finalInvoice.items[0]).toMatchObject({width:'7',amount:7000});
  await page.locator('.challan-row .challan-workflow-button').click();modal=page.getByRole('dialog',{name:'Final Settlement'});await modal.getByLabel('Amount Paid by Customer').fill('7000');await modal.getByLabel(/Discount Amount/).fill('0');await modal.getByRole('button',{name:'Record Payment / Complete'}).click();await expect(modal).toHaveCount(0);expect((await saved.ref.get()).data().stage).toBe(4);
  await page.locator('.challan-row').getByRole('button',{name:'View',exact:true}).click();await expect(page.getByRole('columnheader',{name:'Width',exact:true}).first()).toBeVisible();
  await page.screenshot({path:'test-results/challan-width-stage4.png',fullPage:true});
  await page.evaluate(()=>{window.printContents='';window.open=()=>({document:{write(html){window.printContents=html;},close(){}},focus(){},print(){}});});
  await page.getByRole('button',{name:'Print',exact:true}).click();expect(await page.evaluate(()=>window.printContents)).toContain('<th>Width</th>');expect(await page.evaluate(()=>window.printContents)).toContain('<td>7</td>');
  await page.getByRole('button',{name:'Back to Challans'}).click();const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();const file=await downloaded;const book=XLSX.read(await readFile(await file.path()),{type:'buffer'});expect(XLSX.utils.sheet_to_json(book.Sheets.Items)[0]).toMatchObject({Width:'7','Original Price':7000});
});
test('Master management CRUD, normalized duplicates, filters, export/print, templates and reports',async({page})=>{
  await asRole(page,'admin','/dashboard/master-prices');
  await expect(page.getByRole('heading',{name:'Master Price List',exact:true})).toBeVisible();
  await addPrice(page); await addPrice(page,{width:'7.00',price:'7000'});
  await expect(page.locator('.master-prices > .master-table-wrap tbody tr')).toHaveCount(2);
  await page.getByRole('button',{name:'Add Price',exact:true}).click();
  let modal=page.getByRole('dialog',{name:'Add Master Price'});
  for(const [field,value] of Object.entries({Type:'CBD',Shape:'PR',Height:'5.000',Width:'7.000',Price:'10'})) await modal.getByLabel(field,{exact:true}).fill(value);
  await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toBeVisible();await expect(modal.getByText(/already exists/)).toBeVisible();
  await modal.getByLabel('Width',{exact:true}).fill('abc');await expect(modal.getByText('Enter a valid Width.')).toBeVisible();
  await modal.getByRole('button',{name:'Cancel'}).click();
  await page.getByLabel('Filter width').selectOption('7');await expect(page.locator('.master-prices > .master-table-wrap tbody tr')).toHaveCount(1);
  await page.getByLabel('Search Master Prices').fill('5.00');await expect(page.locator('.master-prices > .master-table-wrap tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Edit',exact:true}).click();modal=page.getByRole('dialog',{name:'Edit Master Price'});
  await modal.getByLabel('Price',{exact:true}).fill('7500');await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);
  await page.getByRole('button',{name:'Edit',exact:true}).click();modal=page.getByRole('dialog',{name:'Edit Master Price'});
  await modal.getByLabel('Width',{exact:true}).fill('');await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toBeVisible();
  await modal.getByLabel('Width',{exact:true}).fill('8');await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);
  await page.getByLabel('Filter width').selectOption('8');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel'}).click();const download=await downloadPromise;
  const book=XLSX.read(await readFile(await download.path()),{type:'buffer'});expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])[0]).toMatchObject({Height:'5',Width:'8',Price:7500});
  await page.evaluate(()=>{window.printContents='';window.open=()=>({document:{write(html){window.printContents=html;},close(){}},focus(){},print(){}});});
  await page.getByRole('button',{name:'Print',exact:true}).click();expect(await page.evaluate(()=>window.printContents)).toContain('<td>8</td>');
  await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm Delete'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await db.doc('masterPrices/5_PR_CBD__8').get()).data().active).toBe(false);
  expect((await db.collection('inventory').get()).size).toBe(1);expect((await db.doc('inventory/stock').get()).data().weight).toBe(10);
  await page.goto('/dashboard/weekly-report');await expect(page.getByRole('heading',{name:'Master Price List',exact:true})).toBeVisible();await expect(page.getByText(/7,000.*7,500/).first()).toBeVisible();
  await page.goto('/dashboard/activity-log');await page.locator('.activity-panel-head').filter({hasText:'Master Price List'}).click();await expect(page.getByRole('columnheader',{name:'Master Price / Changes'})).toBeVisible();
  await page.goto('/dashboard/admin-settings');await page.getByRole('button',{name:'Import Templates',exact:true}).click();
  const templatePromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download Master Price Template'}).click();const template=await templatePromise;
  const templateBook=XLSX.read(await readFile(await template.path()),{type:'buffer'});expect(templateBook.SheetNames).toContain('Instructions');
});
test('Master import preview blocks invalid/existing/normalized duplicates and records summary',async({page})=>{
  await asRole(page,'admin','/dashboard/master-prices');await addPrice(page);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Type','Shape','Height','Width','Price'],['CBD','PR','5.00','',6000],['CBD','PR','5','7.00',7000],['CBD','PR','5.00','7',7100],['CBD','PR','abc','8',10],['CBD','PR','6','8',0]]),'Prices');
  await page.locator('input[type=file]').setInputFiles({name:'prices.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
  const modal=page.getByRole('dialog',{name:'Import Master Prices'});await expect(modal.getByRole('heading',{name:'Ready to import (1)',exact:true})).toBeVisible();await expect(modal.getByRole('heading',{name:'Needs attention (4)',exact:true})).toBeVisible();
  await modal.getByRole('button',{name:'Import Ready Rows'}).click();await expect(modal.getByText('1 added; 4 rejected.')).toBeVisible();
  const logs=await db.collection('activityLog').where('action','==','imported').get();expect(logs.size).toBe(1);expect(logs.docs[0].data().snapshot.rejected).toBe(4);
});
test('Staff cannot open Master management; concurrent Add and Import cannot overwrite',async({page})=>{
  await asRole(page,'staff','/dashboard/master-prices');await expect(page.getByRole('heading',{name:'Master Price List',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Master Price List'})).toHaveCount(0);
  await asRole(page,'admin','/dashboard/master-prices');
  const result=await page.evaluate(async()=>{
    const {saveMasterPrice,importMasterPrices}=await import('/src/utils/masterPriceStore.js');const {testUser}=await import('/tests/fixtures/auth.jsx');
    const row={type:'CBD',shape:'PR',height:'5',width:'7',price:7000};
    const outcomes=await Promise.allSettled([saveMasterPrice(row,testUser),saveMasterPrice({...row,height:'5.00',width:'7.00'},testUser)]);
    const imported=await importMasterPrices([{...row,rowNumber:2,errors:{}}],testUser);
    return {success:outcomes.filter(r=>r.status==='fulfilled').length,imported};
  });expect(result.success).toBe(1);expect(result.imported[0].added).toBe(false);expect((await db.doc('masterPrices/5_PR_CBD__7').get()).data().price).toBe(7000);
});
test('Two-session live exact lookup, manual priority, add/delete no fallback and historical safety',async({page,browser})=>{
  await seedStock();await asRole(page,'admin','/dashboard/master-prices');await addPrice(page);await addPrice(page,{width:'7',price:'7000'});
  const staffContext=await browser.newContext();const staff=await staffContext.newPage();await staff.route(/https:\/\/.*(?:googleapis\.com|firebaseio\.com)/,r=>r.abort());
  await openPricedChallan(staff);const price=staff.getByPlaceholder('Price',{exact:true}),width=staff.getByPlaceholder('Width (optional)');
  await expect(price).toHaveValue('5000');await width.fill('7.00');await expect(price).toHaveValue('7000');await width.fill('8');await expect(price).toHaveValue('');await width.fill('');await expect(price).toHaveValue('5000');await width.fill('7');await expect(price).toHaveValue('7000');
  await page.getByLabel('Filter width').selectOption('7');await page.getByRole('button',{name:'Edit',exact:true}).click();let modal=page.getByRole('dialog',{name:'Edit Master Price'});await modal.getByLabel('Price',{exact:true}).fill('7500');await modal.getByRole('button',{name:'Save Price'}).click();await expect(price).toHaveValue('7500');
  await price.fill('6800');await page.getByRole('button',{name:'Edit',exact:true}).click();modal=page.getByRole('dialog',{name:'Edit Master Price'});await modal.getByLabel('Price',{exact:true}).fill('7800');await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);await expect(price).toHaveValue('6800');
  await width.fill('8');await expect(price).toHaveValue('');await addPrice(page,{width:'8',price:'8000'});await expect(price).toHaveValue('8000');
  await page.getByLabel('Filter width').selectOption('8');await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm Delete'}).click();await expect(price).toHaveValue('');
  await width.fill('bad');await expect(width).toHaveAttribute('aria-invalid','true');await expect(staff.getByText('Width must be a positive decimal number.')).toBeVisible();await width.fill('7');await expect(price).toHaveValue('7800');await expect(width).toHaveAttribute('aria-invalid','false');
  await price.fill('7200');const logsBefore=(await db.collection('activityLog').get()).size;
  await staff.getByRole('button',{name:'Create Challan',exact:true}).click();await expect(staff.locator('.challan-row')).toHaveCount(1);
  const saved=(await db.collection('challans').get()).docs[0];expect(saved.data().items[0]).toMatchObject({width:'7',amount:7200,inventoryId:'stock'});
  expect((await db.collection('activityLog').where('panel','==','master price list').get()).size).toBe(logsBefore);
  await page.getByLabel('Filter width').selectOption('7');await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm Delete'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await saved.ref.get()).data().items[0].amount).toBe(7200);
  await staff.locator('.challan-row').getByRole('button',{name:'Edit',exact:true}).click();await expect(price).toHaveValue('7200');await width.fill('');await expect(price).toHaveValue('5000');
  await staffContext.close();
});


test('Master page polish: empty, filtered, connection states, readable themes and responsive form',async({page})=>{
 await asRole(page,'admin','/dashboard/master-prices');
 await expect(page.getByText('No Master Prices added yet.',{exact:true})).toBeVisible();await expect(page.locator('.master-notice')).toHaveCount(0);
 for(const theme of ['dark','light']) {
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  for(const width of [1440,1024,768,390]) {
   await page.setViewportSize({width,height:900});
   await expect(page.getByRole('button',{name:'Add Price',exact:true})).toBeInViewport();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:'test-results/polish-'+theme+'-'+width+'.png',fullPage:true});
  }
  await page.getByRole('button',{name:'Add Price',exact:true}).click();
  const form=page.getByRole('dialog',{name:'Add Master Price'});await expect(form).toBeInViewport();
  await expect(form.locator('.master-error')).toHaveCount(0);await form.getByRole('button',{name:'Save Price'}).click();
  const contrast=await page.locator('.master-prices').evaluate(root=>{
   const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(v=>s.startsWith('color(srgb')?v*255:v);
   const lum=s=>rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   return [...root.querySelectorAll('button:not(:disabled),input,select,th,.master-dialog h3,.master-error')].filter(el=>el.getClientRects().length).map(el=>{const style=getComputedStyle(el);let bg=style.backgroundColor,parent=el;while(bg==='rgba(0, 0, 0, 0)'&&parent.parentElement){parent=parent.parentElement;bg=getComputedStyle(parent).backgroundColor;}const a=lum(style.color),b=lum(bg);return {text:el.textContent||el.getAttribute('aria-label'),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  });
  expect(contrast.filter(item=>item.ratio<4.5)).toEqual([]);
  await page.screenshot({path:'test-results/polish-form-'+theme+'.png',fullPage:true});
  await form.getByRole('button',{name:'Cancel'}).click();
 }
 await page.setViewportSize({width:1440,height:1000});await addPrice(page,{width:'7',price:'7000'});
 await page.getByLabel('Search Master Prices').fill('no-such-shape');await expect(page.getByText('No Master Prices match these filters.',{exact:true})).toBeVisible();
 await page.getByLabel('Search Master Prices').fill('');
 await page.evaluate(async()=>{const f=await import('/tests/fixtures/firebase.js');await f.disableNetwork(f.db);});
 await expect(page.locator('.availability-banner')).toContainText('Connection issue');await expect(page.locator('.master-notice')).toHaveCount(0);
 await page.screenshot({path:'test-results/polish-offline.png',fullPage:true});
 await page.evaluate(async()=>{const f=await import('/tests/fixtures/firebase.js');await f.enableNetwork(f.db);});await expect(page.locator('.master-notice')).toHaveCount(0);
 try {
  await db.doc('employeeProfiles/admin').update({role:'employee',permissions:[]});await page.reload();
  await expect(page.locator('.master-notice')).toContainText('Master Price access was denied');
  await expect(page.getByText('No Master Prices added yet.',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'test-results/polish-error.png',fullPage:true});
 } finally {
  await db.doc('employeeProfiles/admin').update({role:'superadmin',permissions:[]});
 }
});

test('Add and Edit clean open, required markers, touched errors, real-time fixes and keyboard order',async({page})=>{
 await asRole(page,'admin','/dashboard/master-prices');await page.setViewportSize({width:1366,height:768});
 await page.getByRole('button',{name:'Add Price',exact:true}).click();let modal=page.getByRole('dialog',{name:'Add Master Price'});
 await expect(modal.locator('.master-error')).toHaveCount(0);await expect(modal.locator('[aria-invalid=true]')).toHaveCount(0);await expect(modal.locator('.master-required')).toHaveCount(4);await expect(modal.getByText('Optional',{exact:true})).toBeVisible();
 expect(await modal.evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);await expect(modal.getByRole('button',{name:'Save Price'})).toBeInViewport();
 await expect(modal.getByLabel('Type',{exact:true})).toBeFocused();
 for(const label of ['Shape','Height','Width','Price']){await page.keyboard.press('Tab');await expect(modal.getByLabel(label,{exact:true})).toBeFocused();}
 await page.keyboard.press('Tab');await expect(modal.getByRole('button',{name:'Cancel'})).toBeFocused();await page.keyboard.press('Tab');await expect(modal.getByRole('button',{name:'Save Price'})).toBeFocused();await page.keyboard.press('Tab');await expect(modal.getByLabel('Type',{exact:true})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(modal.getByRole('button',{name:'Save Price'})).toBeFocused();
 await modal.getByRole('button',{name:'Save Price'}).click();for(const field of ['Type','Shape','Height','Price'])await expect(modal.getByText(`${field} is required.`,{exact:true})).toBeVisible();await expect(modal.getByLabel('Width',{exact:true})).toHaveAttribute('aria-invalid','false');await expect(modal.getByLabel('Type',{exact:true})).toBeFocused();
 for(const [field,value]of Object.entries({Type:'CBD',Shape:'PR',Height:'5',Price:'5000'})){await modal.getByLabel(field,{exact:true}).fill(value);await expect(modal.getByText(`${field} is required.`,{exact:true})).toHaveCount(0);await expect(modal.getByLabel(field,{exact:true})).toHaveAttribute('aria-invalid','false');}
 for(const field of ['Height','Width']){await modal.getByLabel(field,{exact:true}).fill('abc');await expect(modal.getByText(`Enter a valid ${field}.`,{exact:true})).toBeVisible();await modal.getByLabel(field,{exact:true}).fill(field==='Height'?'5.00':'7.00');await expect(modal.getByLabel(field,{exact:true})).toHaveAttribute('aria-invalid','false');}
 await modal.getByLabel('Price',{exact:true}).fill('-1');await expect(modal.getByText('Price must be greater than 0.')).toBeVisible();await modal.getByLabel('Price',{exact:true}).fill('5000');await expect(modal.locator('.master-error')).toHaveCount(0);
 await page.screenshot({path:'test-results/master-add-corrected.png',fullPage:true});await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);
 await page.getByRole('button',{name:'Add Price',exact:true}).click();modal=page.getByRole('dialog',{name:'Add Master Price'});await expect(modal.locator('.master-error')).toHaveCount(0);
 for(const [field,value]of Object.entries({Type:'CBD',Shape:'PR',Height:'5.00',Width:'7.00',Price:'6000'}))await modal.getByLabel(field,{exact:true}).fill(value);
 await expect(modal.getByText(/already exists/)).toBeVisible();await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toBeVisible();await modal.getByLabel('Width',{exact:true}).fill('8');await expect(modal.getByText(/already exists/)).toHaveCount(0);await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
 await page.getByRole('button',{name:'Edit',exact:true}).click();modal=page.getByRole('dialog',{name:'Edit Master Price'});await expect(modal.locator('.master-error')).toHaveCount(0);await expect(modal.locator('.master-required')).toHaveCount(4);expect(await modal.evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
 await modal.getByLabel('Height',{exact:true}).fill('');await expect(modal.getByText('Height is required.')).toBeVisible();await modal.getByLabel('Height',{exact:true}).fill('5.25');await expect(modal.locator('.master-error')).toHaveCount(0);await page.screenshot({path:'test-results/master-edit-corrected.png',fullPage:true});await modal.getByRole('button',{name:'Save Price'}).click();await expect(modal).toHaveCount(0);
 expect((await db.doc('masterPrices/5.25_PR_CBD__7').get()).data().height).toBe('5.25');
});

test('Desktop Add/Edit theme consistency, active navigation and save processing state',async({page})=>{
 await asRole(page,'admin','/dashboard/master-prices');
 await addPrice(page,{width:'7'});
 await page.setViewportSize({width:1366,height:768});
 await page.getByRole('button',{name:'Admin',exact:true}).click();
 for(const theme of ['dark','light']) {
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  const active=page.locator('.dashboard-sidebar a.active');await expect(active).toContainText('Master Price List');
  expect(await active.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  for(const mode of ['Add','Edit']) {
   await page.getByRole('button',{name:mode==='Add'?'Add Price':'Edit',exact:true}).click();
   const modal=page.getByRole('dialog',{name:`${mode} Master Price`});
   await expect(modal.locator('.master-error')).toHaveCount(0);
   expect(await modal.evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
   await modal.getByRole('button',{name:'Cancel'}).hover();
   if(theme==='dark')expect(await modal.getByRole('button',{name:'Cancel'}).evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
   await page.screenshot({path:`test-results/master-${mode.toLowerCase()}-${theme}-laptop.png`,fullPage:true});
   await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
  }
 }
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Edit Master Price'});
 await modal.getByLabel('Price',{exact:true}).fill('6500');
 let release;const pending=new Promise(resolve=>{release=resolve;});
 await page.route(/127\.0\.0\.1:8180\/.*:commit/,async route=>{await pending;await route.continue();});
 await modal.getByRole('button',{name:'Save Price'}).click();
 try {
  await expect(modal.getByRole('button',{name:'Saving...'})).toBeDisabled();
  await expect(modal.getByRole('button',{name:'Cancel'})).toBeDisabled();
  await expect(modal.getByLabel('Price',{exact:true})).toHaveValue('6500');
  await expect(modal.getByLabel('Price',{exact:true})).toBeDisabled();
 } finally {release();}
 await expect(modal).toHaveCount(0);
 expect((await db.doc('masterPrices/5_PR_CBD__7').get()).data().price).toBe(6500);
});
