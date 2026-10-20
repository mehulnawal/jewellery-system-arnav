import { normalizeSize } from "./dimensions.js";
import {
  moneyCents,
  normalizeWeight,
  priceWeightedItem,
  stageOneFinancials,
  WEIGHT_RATE_PRICING,
  wholePieces,
} from "./challanCalculations.js";

const optionalText = (value) => String(value ?? "").trim();
const money = (value) => moneyCents(value ?? 0).toString();
const percent = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : String(value);
};

// Compare only saved business inputs and their financial meaning. Calculated
// compatibility fields are reconstructed from the saved pricing convention.
export function stageOneEditSnapshot(record) {
  return {
    stage: Number(record.stage ?? 1),
    number: String(record.number ?? ""),
    party: optionalText(record.party),
    date: String(record.date ?? ""),
    notes: optionalText(record.notes),
    items: (record.items ?? []).map((item) => {
      const financials =
        item.pricingVersion === WEIGHT_RATE_PRICING
          ? priceWeightedItem(item.weight, item.amount, item.discount)
          : stageOneFinancials(item);
      return {
        inventoryId: String(item.inventoryId ?? ""),
        sourceInventoryId: String(item.sourceInventoryId ?? ""),
        sku: String(item.sku ?? ""),
        shape: optionalText(item.shape),
        size: normalizeSize(item.size),
        type: optionalText(item.type),
        width: normalizeSize(item.width),
        weight: normalizeWeight(item.weight),
        pieces: wholePieces(
          item.pieces === "" || item.pieces == null ? 0 : item.pieces,
        ),
        price: money(financials.amount),
        discount: percent(financials.discount),
        gross: money(financials.grossAmount),
        discountAmount: money(financials.discountAmount),
        net: money(financials.netAmount),
      };
    }),
  };
}

export function sameStageOneEditSnapshot(original, latest) {
  return (
    JSON.stringify(original) === JSON.stringify(stageOneEditSnapshot(latest))
  );
}
