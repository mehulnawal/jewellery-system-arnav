import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventoryFieldError, inventorySaveErrorMessage } from '../src/utils/inventoryForm.js';

test('Inventory Add/Edit fields distinguish required, invalid and corrected input', () => {
  for (const [field, emptyMessage] of [
    ['type','Type is required.'],['shape','Shape is required.'],
    ['size','Size is required.'],['weight','Weight is required.'],
  ]) assert.equal(inventoryFieldError(field,''),emptyMessage);
  assert.equal(inventoryFieldError('box',''),'');
  assert.equal(inventoryFieldError('box','B29'),'');
  assert.equal(inventoryFieldError('box','B-29'),'Enter a valid Box, for example B29.');
  assert.equal(inventoryFieldError('size','5.00'),'');
  assert.equal(inventoryFieldError('size','0'),'Enter a valid positive Size.');
  assert.equal(inventoryFieldError('size','5.3X2.0',true),'');
  assert.equal(inventoryFieldError('weight','100.000'),'');
  assert.equal(inventoryFieldError('weight','0'),'Enter a valid Weight greater than 0.');
  assert.equal(inventoryFieldError('weight','abc'),'Enter a valid Weight greater than 0.');
  assert.equal(inventoryFieldError('type','CVD'),'');
  assert.equal(inventoryFieldError('shape','Marquise'),'');
});
test('Inventory save messages distinguish permission, network and duplicate failures', () => {
  assert.match(inventorySaveErrorMessage(null,false),/do not have permission/);
  assert.match(inventorySaveErrorMessage({code:'permission-denied',message:'Missing or insufficient permissions.'},true),/access was denied/);
  assert.match(inventorySaveErrorMessage({code:'unavailable'},true),/connection was interrupted/);
  assert.match(inventorySaveErrorMessage({message:'SKU 5_Marquise_CVD already exists in Inventory.'},true),/already exists/);
});