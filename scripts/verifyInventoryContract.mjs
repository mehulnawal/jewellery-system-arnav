import { readFile } from 'node:fs/promises'
import { formatDecimal, inventoryMatchesSearch, isValidBox, isValidSize, numericMatches, orderShapes } from '../src/utils/inventoryRules.js'

const inventory = await readFile(new URL('../src/modules/inventory/Inventory.jsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/modules/inventory/inventory.css', import.meta.url), 'utf8')
const indexStyles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
const failures = []
const requireText = (source, text, label) => { if (!source.includes(text)) failures.push(label) }
const requireTrue = (condition, label) => { if (!condition) failures.push(label) }

// Inventory UI contracts: do not remove or replace these without explicitly updating this guard.
requireText(inventory, 'DeleteModal', 'custom delete confirmation modal')
requireText(inventory, 'requestDelete', 'delete request flow')
requireText(inventory, 'n="trash"', 'individual trash delete icon')
requireText(inventory, "setPrintMode('selected')", 'selected-items print action')
requireText(inventory, "setPrintMode('all')", 'full Inventory print action')
requireText(inventory, "event.key === '/'", 'search keyboard shortcut')
requireText(inventory, "event.key === 'Escape'", 'Escape keyboard shortcut')
requireText(inventory, "event.key === 'Enter'", 'save keyboard shortcut')
requireText(inventory, 'inventory-field-error', 'inline form validation errors')
requireText(inventory, 'numericInput', 'input character filtering')
requireText(styles, '.inventory-row-actions .inventory-row-delete', 'delete action styling')
requireText(styles, '.inventory-field.has-error', 'invalid form-field styling')
requireText(indexStyles, 'html[data-theme="dark"] .inventory-field select', 'dark-theme Inventory select styling')

// Data contracts.
requireTrue(formatDecimal(5) === '5.000', 'three-decimal display format')
for (const query of ['21', '21.', '21.4', '21.45', '21.450']) requireTrue(numericMatches('21.450', query), `numeric search for ${query}`)
requireTrue(inventoryMatchesSearch({ size: '21.450', weight: 99 }, '21.4mm'), 'mm Size-only search')
requireTrue(!inventoryMatchesSearch({ size: '9.000', weight: 21.45 }, '21.4mm'), 'mm must not match weight')
requireTrue(!inventoryMatchesSearch({ size: '9.000', weight: 21.45 }, '21.4mm'), 'mm must not match weight')
requireTrue(isValidSize('4.3X2.0', true) && !isValidSize('4.3x2.0', true), 'uppercase X size validation')
requireTrue(isValidBox('AB29') && !isValidBox('29AB'), 'Box validation')
const ordered = orderShapes(['Round', 'Future Shape', 'Oval', 'Pan'])
requireTrue(ordered.join('|') === 'Pan|Oval|Future Shape|Round', 'shape order with Round last')

if (failures.length) {
  console.error('Inventory contract failed:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('Inventory contract passed')


