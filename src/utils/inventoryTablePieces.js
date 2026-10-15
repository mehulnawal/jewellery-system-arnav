import { wholePieces } from "./challanCalculations.js";

export const inventoryPiecesText = (value) => {
  if (value == null || String(value).trim() === "") return "--";
  try {
    return String(wholePieces(value));
  } catch {
    return "--";
  }
};

export const inventoryGroupPiecesText = (items) => {
  let total = null;
  for (const item of items) {
    const pieces = inventoryPiecesText(item.pieces);
    if (pieces !== "--") total = (total ?? 0n) + BigInt(pieces);
  }
  return total === null ? "--" : String(total);
};
