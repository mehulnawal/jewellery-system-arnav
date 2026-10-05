import { inventoryMatchesSearch, SHAPE_ORDER } from './inventoryRules.js';
import { pieceValue } from './pieces.js';
import { inventoryIdentityErrors, isValidSize, normalizeSize } from './dimensions.js';

// A document's path is authoritative. A legacy data.id must never replace it.
export function inventorySnapshotRows(snapshot) {
  return snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }));
}
export function inventoryEligibility(row) {
  const weight = Number(row.weight ?? 0);
  const pieces = pieceValue(row.pieces ?? row.quantity ?? row.qty);
  if (!Number.isFinite(weight) || weight < 0) return 'invalid-weight';
  return weight > 0 || pieces > 0 ? '' : 'no-available-stock';
}
const compareText = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), 'en', { sensitivity: 'base' })
  || String(left ?? '').localeCompare(String(right ?? ''), 'en');
const shapeAliases = { Emerald: 'Emerlad', Cuhsion: 'Cushion', Radient: 'Radiant' };
const shapeRank = (value) => {
  const shape = shapeAliases[String(value ?? '')] ?? String(value ?? '');
  if (shape.toLowerCase() === 'round') return SHAPE_ORDER.length + 1;
  const rank = SHAPE_ORDER.findIndex(entry => entry.toLowerCase() === shape.toLowerCase());
  return rank < 0 ? SHAPE_ORDER.length : rank;
};
const compareDecimal = (left, right) => {
  const [leftWhole, leftFraction = ''] = left.split('.');
  const [rightWhole, rightFraction = ''] = right.split('.');
  if (leftWhole.length !== rightWhole.length) return leftWhole.length - rightWhole.length;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  const length = Math.max(leftFraction.length, rightFraction.length);
  const a = leftFraction.padEnd(length, '0'), b = rightFraction.padEnd(length, '0');
  return a === b ? 0 : a < b ? -1 : 1;
};
export const compareInventorySizes = (left, right) => {
  const leftValid = isValidSize(left, true), rightValid = isValidSize(right, true);
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  const a = normalizeSize(left), b = normalizeSize(right);
  if (!leftValid) return compareText(a, b);
  const leftParts = a.split('X'), rightParts = b.split('X');
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index++) {
    const difference = compareDecimal(leftParts[index], rightParts[index]);
    if (difference) return difference;
  }
  return leftParts.length - rightParts.length;
};
export const compareInventoryPickerRows = (left, right) =>
  compareInventorySizes(left.size, right.size)
  || shapeRank(left.shape) - shapeRank(right.shape)
  || compareText(left.shape, right.shape)
  || compareText(left.type, right.type)
  || compareText(left.sku, right.sku)
  || compareText(left.id, right.id);
// No grouping, canonical-key Map, result cap, or size allowlist here.
export function discoverInventory(rows, search = '') {
  const excluded = [], eligible = [], bySize = Object.create(null);
  for (const row of rows) {
    const size = normalizeSize(row.size);
    const counts = bySize[size] ||= { source: 0, eligible: 0 };
    counts.source++;
    const reason = inventoryEligibility(row);
    if (!reason) counts.eligible++;
    if (reason) excluded.push({ physicalRecordId: row.id, sku: row.sku ?? '', rawSize: row.size ?? null, normalizedSize: size, rawWeight: row.weight ?? null, rawPieces: row.pieces ?? row.quantity ?? row.qty ?? null, eligible: false, reason });
    else eligible.push(row);
  }
  const matches = eligible.filter(row => inventoryMatchesSearch(row, search, { dimensionOnlyNumeric: true, exactSizeNumeric: true })).sort(compareInventoryPickerRows);
  return { matches, excluded, counts: { source: rows.length, eligible: eligible.length, filtered: matches.length }, bySize };
}

// Development reconciliation for any Size. Each physical document is reported
// independently, including legacy documents with the same canonical identity.
export function auditInventorySize(rows, requestedSize) {
  if (!isValidSize(requestedSize, true)) return null;
  const normalizedSize = normalizeSize(requestedSize);
  const pickerIds = new Set(discoverInventory(rows, normalizedSize).matches.map(row => row.id));
  const records = rows.filter(row => normalizeSize(row.size) === normalizedSize).map(row => {
    const stockReason = inventoryEligibility(row);
    const validityReasons = inventoryIdentityErrors(row);
    return {
      physicalRecordId: row.id,
      sku: row.sku ?? '',
      rawSize: row.size ?? null,
      normalizedSize,
      shape: row.shape ?? '',
      type: row.type ?? '',
      rawWeight: row.weight ?? null,
      rawPieces: row.pieces ?? row.quantity ?? row.qty ?? null,
      sourcePurchaseId: row.sourcePurchaseId ?? null,
      hasCreatedAt: row.createdAt != null,
      sourcePresent: true,
      valid: validityReasons.length === 0,
      validityReasons,
      eligible: !stockReason,
      exclusionReason: stockReason || null,
      inPickerDataset: pickerIds.has(row.id),
    };
  });
  return {
    normalizedSize,
    sourceInventoryCount: rows.length,
    sourceCount: records.length,
    validEligibleCount: records.filter(row => row.valid && row.eligible).length,
    eligibleCount: records.filter(row => row.eligible).length,
    excludedCount: records.filter(row => !row.eligible).length,
    pickerCount: records.filter(row => row.inPickerDataset).length,
    missingEligiblePhysicalIds: records.filter(row => row.valid && row.eligible && !row.inPickerDataset)
      .map(row => row.physicalRecordId),
    records,
  };
}