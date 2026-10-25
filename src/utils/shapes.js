// Display names do not rewrite stored Inventory IDs or legacy SKU identities.
export const SHAPE_ORDER = [
  "Pear",
  "Marquise",
  "Oval",
  "Emerald",
  "Princess",
  "Cushion",
  "Radiant",
  "Choki",
  "Tapper",
  "Bugget",
  "Trillion",
];
const aliases = {
  pan: "Pear",
  pear: "Pear",
  emerlad: "Emerald",
  emerald: "Emerald",
  cuhsion: "Cushion",
  radient: "Radiant",
  "taper (choki)": "Tapper",
  taper: "Tapper",
  tapper: "Tapper",
  "buget (choki)": "Bugget",
  buget: "Bugget",
  baguette: "Bugget",
  bugget: "Bugget",
};
export function shapeName(value) {
  const text = String(value ?? "").trim();
  return (
    aliases[text.toLowerCase()] ||
    [...SHAPE_ORDER, "Round"].find(
      (name) => name.toLowerCase() === text.toLowerCase(),
    ) ||
    text
  );
}
export const shapeRank = (value) => {
  const shape = shapeName(value);
  if (shape === "Round") return SHAPE_ORDER.length + 1;
  const index = SHAPE_ORDER.indexOf(shape);
  return index < 0 ? SHAPE_ORDER.length : index;
};
export const orderShapes = (values) => {
  const unique = new Map();
  for (const name of values.map(shapeName)) {
    const key = name.toLowerCase();
    if (key && key !== "heart" && !unique.has(key)) unique.set(key, name);
  }
  return [...unique.values()].sort(
    (a, b) => shapeRank(a) - shapeRank(b) || a.localeCompare(b, "en"),
  );
};
export const DEFAULT_SHAPES = [...SHAPE_ORDER, "Round"];
