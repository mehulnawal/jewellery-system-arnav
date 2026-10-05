import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverInventory, inventorySnapshotRows } from '../src/utils/inventoryDiscovery.js';
import { inventoryMatchesSearch } from '../src/utils/inventoryRules.js';
const sizes = [1,2,3,5,10,0.3,4.5,5.25,7.35,6.75];
for (const size of sizes) test('physical discovery matrix Size '+size, () => {
  const docs = [];
  for (const raw of [size,String(size),String(size).includes(".") ? String(size)+"0" : String(size)+".0",Number(size).toFixed(2)])
    for (const shape of ['Round','Emerlad','Princess'])
      for (const type of ['CVD','HP'])
        for (const source of ['manual','purchase']) {
          const data = {id:'untrusted-shared-id',size:raw,shape,type,sku:raw+'_'+shape+'_'+type,weight:'0.001',...(source==='purchase'?{sourcePurchaseId:'p'}:{})};
          docs.push({id:'physical-'+docs.length,data:()=>data});
        }
  const rows = inventorySnapshotRows({docs});
  assert.equal(rows.length,48);
  assert.equal(new Set(rows.map(r=>r.id)).size,48);
  for(const row of rows) {
    assert(inventoryMatchesSearch(row,String(size))); // Inventory / Check Inventory shared search
    for(const query of [String(size),String(size)+' '+row.type,String(size)+' '+row.shape+' '+row.type,row.sku])
      assert(discoverInventory(rows,query).matches.some(r=>r.id===row.id),row.id+' '+query);
  }
  assert.equal(discoverInventory(rows).counts.eligible,48);
});
test('complete result set, quantity aliases and explicit exclusion diagnostics',()=>{
 const rows=Array.from({length:250},(_,i)=>({id:String(i),size:i+1,sku:(i+1)+'_Round_HP',shape:'Round',type:'HP',weight:'1'}));
 assert.equal(discoverInventory(rows,'250').matches[0].id,'249');
 for(const field of ['pieces','quantity','qty']) assert.equal(discoverInventory([{id:field,[field]:'2'}]).matches.length,1);
 assert.deepEqual(discoverInventory([{id:'zero',sku:'5_Round_HP',size:'5.00',weight:0},{id:'bad',size:5,weight:'broken'}]).excluded,[
  {physicalRecordId:'zero',sku:'5_Round_HP',rawSize:'5.00',normalizedSize:'5',rawWeight:0,rawPieces:null,eligible:false,reason:'no-available-stock'},
  {physicalRecordId:'bad',sku:'',rawSize:5,normalizedSize:'5',rawWeight:'broken',rawPieces:null,eligible:false,reason:'invalid-weight'},
 ]);
});

test('Challan numeric tokens match exact normalized Size and results sort numerically', () => {
 const rows = ['5.35','5.2','7.5','7.35','5','5.00'].map((size,index) => ({
  id:'pear-'+index,size,shape:'Pear',type:'HP',sku:size+'_Pear_HP',weight:'1.000',
 }));
 assert.deepEqual(discoverInventory(rows,'Pear HP').matches.map(row=>row.id),
  ['pear-4','pear-5','pear-1','pear-0','pear-3','pear-2']);
 for (const query of ['5','5.0','5.00','5 Pear HP','5_pear_hp','5.00_Pear_HP']) {
  assert.deepEqual(discoverInventory(rows,query).matches.map(row=>row.id),['pear-4','pear-5'],query);
 }
 assert.deepEqual(discoverInventory(rows,'7.5 Pear HP').matches.map(row=>row.id),['pear-2']);
 assert.deepEqual(discoverInventory(rows,'5.2').matches.map(row=>row.id),['pear-1']);
 const sixRows=[{id:'six',size:6,shape:'Pear',type:'HP',sku:'6_Pear_HP',weight:1},
  {id:'six-decimal',size:'6.2',shape:'Pear',type:'HP',sku:'6.2_Pear_HP',weight:1}];
 assert.deepEqual(discoverInventory(sixRows,'6').matches.map(row=>row.id),['six']);
});
test('same-Size Shape order, Type and physical ID ties are deterministic', () => {
 const shapes=['Round','Pear','Trillion','Radient','Cuhsion','Princess','Emerlad','Oval','Marquise','Pan','Choki','Taper (Choki)','Buget (Choki)'];
 const rows=shapes.map((shape,index)=>({id:'shape-'+index,size:'5.00',shape,type:'HP',sku:'5_'+shape+'_HP',weight:1}));
 assert.deepEqual(discoverInventory(rows).matches.map(row=>row.shape),
  ['Pan','Marquise','Oval','Emerlad','Princess','Cuhsion','Radient','Choki','Taper (Choki)','Buget (Choki)','Trillion','Pear','Round']);
 const same=[{id:'b',size:5,shape:'Pear',type:'HP',sku:'5_Pear_HP',weight:1},
  {id:'c',size:'5.0',shape:'Pear',type:'CVD',sku:'5_Pear_CVD',weight:1},
  {id:'a',size:'5.00',shape:'Pear',type:'HP',sku:'5_Pear_HP',weight:1}];
 assert.deepEqual(discoverInventory(same).matches.map(row=>row.id),['c','a','b']);
});