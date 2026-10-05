import { test, expect } from '@playwright/test';

const sizes = [1, 2, 3, 5, 10, 0.3, 4.5, 5.25, 7.35, 6.75];
const rows = sizes.map((size, index) => ({
  id: 'size-' + index, size, shape: 'Round', type: 'CVD',
  sku: size + '_Round_CVD', weight: '2.000', pieces: 2,
}));
for (const shape of ['Round', 'Emerlad', 'Princess']) {
  for (const type of ['CVD', 'HP']) {
    for (const rawSize of [5, '5.0', '5.00']) {
      const id = 'legacy-' + rows.length;
      rows.push({ id, size: rawSize, shape, type, sku: rawSize + '_' + shape + '_' + type,
        weight: '2.000', pieces: 2, sourcePurchaseId: type === 'HP' ? 'purchase-1' : undefined });
    }
  }
}
const optionFor = (page, id) => page.getByRole('option')
  .filter({ has: page.getByText('Record ' + id, { exact: true }) });

test('every size and each physical Size 5 record remains searchable and selectable', async ({ page }) => {
  await page.addInitScript(data => { window.__inventoryRows = data; }, rows);
  await page.goto('/tests/inventoryPicker.browser.html');
  const picker = page.getByRole('combobox', { name: 'Inventory picker' });
  for (const row of rows) {
    const queries = row.size == 5
      ? [String(row.size), '5.00', row.shape, row.type, '5 ' + row.shape,
        '5 ' + row.type, row.sku, '5_Emerlad_CVD']
      : [String(row.size), row.sku];
    for (const query of queries) {
      if (query === '5_Emerlad_CVD' && !(row.shape === 'Emerlad' && row.type === 'CVD')) continue;
      await picker.fill(query);
      await expect(optionFor(page, row.id), query + ' should find ' + row.id).toHaveCount(1);
    }
  }
  const chosen = rows.find(row => row.size === '5.00' && row.shape === 'Emerlad' && row.type === 'HP');
  await picker.fill('5 emerald HP');
  await optionFor(page, chosen.id).click();
  await expect(page.getByTestId('selected-physical-id')).toHaveText(chosen.id);
  const future = { id: 'future-8.4', size: '8.400', shape: 'Princess',
    type: 'HP', sku: '8.400_Princess_HP', weight: '1.250', pieces: 1 };
  await page.evaluate(data => window.dispatchEvent(new CustomEvent('inventory-fixture-update', { detail: data })), [...rows, future]);
  await picker.fill('8.4 Princess HP');
  await expect(optionFor(page, future.id)).toHaveCount(1);
  await page.evaluate(data => window.dispatchEvent(new CustomEvent('inventory-fixture-update', { detail: data })),
    [...rows, { ...future, weight: 0, pieces: 0 }]);
  await expect(optionFor(page, future.id)).toHaveCount(0);
  await page.evaluate(data => window.dispatchEvent(new CustomEvent('inventory-fixture-update', { detail: data })), [...rows, future]);
  await expect(optionFor(page, future.id)).toHaveCount(1);
});
test('connected repro query uses numeric Size order and exact numeric tokens', async ({ page }) => {
  const pear = ['5.35','5.2','7.5','7.35','5'].map((size,index) => ({
    id:'pear-'+index,size,shape:'Pear',type:'HP',sku:size+'_Pear_HP',weight:1,pieces:1,
  }));
  await page.addInitScript(data => { window.__inventoryRows = data; }, pear);
  await page.goto('/tests/inventoryPicker.browser.html');
  const picker = page.getByRole('combobox', { name: 'Inventory picker' });
  await picker.fill('Pear HP');
  await expect(page.getByRole('option')).toHaveCount(5);
  const ids = await page.getByRole('option').locator('.inventory-picker-record').allTextContents();
  expect(ids).toEqual(['Record pear-4','Record pear-1','Record pear-0','Record pear-3','Record pear-2']);
  await picker.fill('5_pear_hp');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(optionFor(page,'pear-4')).toHaveCount(1);
});