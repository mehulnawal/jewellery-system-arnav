import { MASTER_PRICE_HEADERS } from "./masterPrices.js";
import { normalizeSize } from "./dimensions.js";
export async function exportMasterPrices(rows, template = false) {
  const XLSX = await import("xlsx"),
    book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    MASTER_PRICE_HEADERS,
    ...(template
      ? []
      : rows.map((row) => [
          row.type,
          row.shape,
          normalizeSize(row.height),
          normalizeSize(row.width),
          row.price,
        ])),
  ]);
  sheet["!cols"] = [18, 22, 18, 18, 18].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, sheet, "Master Prices");
  if (template)
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Instructions"],
        [
          "Width is optional. Blank means a Height-only/default price; blank is not zero.",
        ],
        [
          "Type, Shape, Height and Price are required. Dimensions and Price must be positive.",
        ],
        ["Existing or duplicate combinations are rejected, never overwritten."],
      ]),
      "Instructions",
    );
  XLSX.writeFile(
    book,
    template ? "master-price-import-template.xlsx" : "master-prices.xlsx",
  );
}
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function masterPricePrintHtml(rows) {
  return `<!doctype html><html><head><title>Master Price List</title><style>body{font:14px Arial;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:10px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>Master Price List</h1><table><thead><tr>${MASTER_PRICE_HEADERS.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${[row.type, row.shape, normalizeSize(row.height), normalizeSize(row.width) || "Default", Number(row.price).toLocaleString("en-IN", { style: "currency", currency: "INR" })].map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}
