import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterPriceKey, masterPriceErrors, masterPriceMap, refreshItemPrice, savedPriceItem, previewMasterImport, matchesMasterSearch, priceContext } from '../src/utils/masterPrices.js';
import { masterPricePrintHtml } from '../src/utils/masterPriceFiles.js';
const base = { type: 'CBD', shape: 'PR', height: '5', width: '', price: 5000, active: true };
const exact = { ...base, id: 'exact', width: '7', price: 7000 };
const prices = masterPriceMap([{ ...base, id: 'default' }, exact]);
test('Master money follows existing Challan cents while dimensions retain precision', () => {
  assert.ok(masterPriceErrors({ ...base, price: '7000.001' }).price);
  assert.deepEqual(masterPriceErrors({ ...base, height: '5.125', width: '7.12345', price: '7000.2500' }), {});
});
const item = (changes = {}) => ({ inventoryId: 'stock', sku: '5_PR_CBD', type: 'CBD', shape: 'PR', size: '5', width: '', amount: '', ...changes });
for (const [a,b] of [['5','5.0'],['5','5.00'],['5.0','5.000'],['5.3','5.30'],['5.30','5.300'],['5.25','5.2500'],['0.3','0.30'],[5,'5.00']]) test(`canonical master identity ${a} = ${b}`, () => {
  assert.equal(masterPriceKey({ ...base, height: a, width: a }), masterPriceKey({ ...base, height: b, width: b }));
});
test('precision, optional width, invalid values and distinct attributes', () => {
  for (const [a,b] of [['5.3','5.03'],['5.25','5.2'],['5','5.1'],['5.125','5.13']]) assert.notEqual(masterPriceKey({ ...base, height:a }),masterPriceKey({ ...base, height:b }));
  for(const width of ['0','-1','abc','5..3','--','NaN','Infinity',NaN,Infinity,[],{}]) assert.ok(masterPriceErrors({...base,width}).width);
  assert.equal(masterPriceErrors(base).width, undefined);
  for(const height of ['',0,-1,'abc']) assert.ok(masterPriceErrors({...base,height}).height);
  for(const price of ['',0,-1,NaN,Infinity,'abc']) assert.ok(masterPriceErrors({...base,price}).price);
  for(const changed of [{type:'CVD'},{shape:'Round'},{size:'5.5'},{width:'8'}]) assert.equal(refreshItemPrice(item(changed),prices).amount,'');
});
test('exact scenarios, normalization, width change and clear, no fallback', () => {
  let row=refreshItemPrice(item(),prices); assert.equal(row.amount,'5000');
  for(const [width, expected] of [['7','7000'],['8',''],['7.00','7000'],['','5000']]) {row=refreshItemPrice({...row,width,size:'5.00'},prices);assert.equal(row.amount,expected);}
});
test('live master edit/add/delete and manual context priority', () => {
  let row=refreshItemPrice(item({width:'7'}),prices);
  const next=masterPriceMap([base,{...exact,price:7500}]);
  row=refreshItemPrice(row,next); assert.equal(row.amount,'7500');
  row={...row,amount:'6800',priceSource:'manual'};
  assert.equal(refreshItemPrice(row,prices).amount,'6800');
  assert.equal(refreshItemPrice(row,new Map()).amount,'6800');
  row=refreshItemPrice({...row,width:'8'},prices);assert.equal(row.amount,'');
  row=refreshItemPrice(row,masterPriceMap([base,{...exact,width:'8',price:8000}]));assert.equal(row.amount,'8000');
  row=refreshItemPrice(row,masterPriceMap([base]));assert.equal(row.amount,'');
  assert.equal(refreshItemPrice({...row,width:''},prices).amount,'5000');
});
test('saved edit snapshots survive subscription and reset only on context change',()=>{
  let row=savedPriceItem(item({width:'7',amount:6800}));
  assert.equal(refreshItemPrice(row,prices).amount,6800);
  assert.equal(refreshItemPrice(row,new Map()).amount,6800);
  assert.equal(refreshItemPrice({...row,width:'7.00'},prices).amount,6800);
  assert.equal(refreshItemPrice({...row,width:''},prices).amount,'5000');
  assert.equal(refreshItemPrice({...row,inventoryId:'other'},prices).amount,'7000');
  assert.equal(priceContext(item({width:'7'})),priceContext(item({width:'7.00'})));
});
test('import canonical duplicate detection, validation and row numbers',()=>{
  const raw=(height,width,price=7000)=>({Type:'CBD',Shape:'PR',Height:height,Width:width,Price:price});
  const rows=previewMasterImport([raw('5.00','7.00'),raw(6,8),raw('6.00','8.00'),raw('abc',''),raw(8,9,0)], [exact]);
  assert.ok(rows[0].errors.combination);assert.deepEqual(rows[1].errors,{});assert.ok(rows[2].errors.combination);assert.ok(rows[3].errors.height);assert.ok(rows[4].errors.price);assert.equal(rows[4].rowNumber,6);
});
test('search canonical values, print clean dimensions, escape content, deactivate',()=>{
  assert.ok(matchesMasterSearch(exact,'5.00'));assert.ok(matchesMasterSearch(exact,'7.000'));assert.ok(matchesMasterSearch(base,'Default'));
  const html=masterPricePrintHtml([{...base,height:'5.00',shape:'<script>'}]);assert.ok(html.includes('<td>5</td>'));assert.ok(html.includes('Default'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
  assert.equal(masterPriceMap([{...exact,active:false}]).size,0);
});
test('Pear auto price matches Inventory casing and refuses ambiguous case variants', () => {
  const lower = { id: 'lower', type: 'cvd', shape: 'pear', height: '5.00', width: '7.00', price: 7200, active: true };
  const stock = { inventoryId: 'physical-pear', sku: '5_Pear_CVD', type: 'CVD', shape: 'Pear', size: '5', width: '7', amount: '' };
  assert.equal(refreshItemPrice(stock, masterPriceMap([lower])).amount, '7200');
  assert.equal(refreshItemPrice(stock, masterPriceMap([
    lower, { ...lower, id: 'upper', type: 'CVD', shape: 'Pear', price: 7300 },
  ])).amount, '');
});
