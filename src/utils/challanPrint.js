import {
  moneyCents,
  stageOneFinancials,
  settlementForRecord,
  stageTwoPricedItems,
  WEIGHT_RATE_PRICING,
  weightMillis,
  fromMillis,
  wholePieces,
} from "./challanCalculations.js";
import { shapeName } from "./shapes.js";
import { stageOneIssueDate } from "./goodsWithCustomers.js";

const escape = (value) =>
  String(value ?? "-").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
// Only printed monetary amounts are rounded up; rates and weights stay exact.
export const printRupees = (value) => Number((moneyCents(value) + 99n) / 100n);
const rupees = (value) =>
  `&#8377;${printRupees(value).toLocaleString("en-IN")}`;
const rate = (value) => `&#8377;${Number(value).toFixed(2)}`;
const weight = (value) => fromMillis(weightMillis(value)).toFixed(3) + " ct";
const pieces = (value) => wholePieces(value ?? 0);
const amountOrUnknown = (value) => {
  try {
    return rupees(value);
  } catch {
    return "Unavailable";
  }
};
const total = (items, read, unit = "number") => {
  try {
    if (unit === "weight")
      return (
        fromMillis(
          items.reduce((sum, item) => sum + weightMillis(read(item)), 0n),
        ).toFixed(3) + " ct"
      );
    return items
      .reduce(
        (sum, item) =>
          sum +
          (unit === "money" ? printRupees(read(item)) : pieces(read(item))),
        0,
      )
      .toLocaleString("en-IN");
  } catch {
    return "Unavailable";
  }
};
const pricing = (item) => stageOneFinancials(item);
export function buildChallanPrint(record) {
  const stage = Number(record.stage || 1);
  const settlement = settlementForRecord(record);
  const items =
    stage >= 3 && Array.isArray(record.finalInvoice?.items)
      ? record.finalInvoice.items
      : stage >= 2
        ? stageTwoPricedItems(record)
        : record.items || [];
  const columns = [
    { name: "Sr. No.", cell: (_, index) => index + 1 },
    { name: "SKU / Item", cell: (item) => escape(item.sku), footer: () => "TOTAL" },
    { name: "Shape", cell: (item) => escape(shapeName(item.shape)) },
    { name: "Size", cell: (item) => escape(item.size || "--") },
    { name: "Width", cell: (item) => escape(item.width || "--") },
  ];
  const quantity = (name, key, isWeight = false) =>
    columns.push({
      name,
      cell: (item) =>
        item[key] == null
          ? "--"
          : isWeight
            ? weight(item[key])
            : pieces(item[key]),
      footer: () =>
        total(items, (item) => item[key], isWeight ? "weight" : "number"),
    });
  if (stage === 1) {
    quantity("Pieces", "pieces");
    quantity("Weight", "weight", true);
  } else {
    quantity("Issued Pieces", "issuedPieces");
    quantity("Issued Weight", "issuedWeight", true);
    quantity("Return Pieces", "returnPieces");
    quantity("Return Weight", "returnWeight", true);
    quantity("Sold / Kept Pieces", "soldPieces");
    quantity("Sold / Kept Weight", "soldWeight", true);
  }
  columns.push(
    {
      name: items.some((item) => item.pricingVersion === WEIGHT_RATE_PRICING)
        ? "Price / Carat"
        : "Price",
      cell: (item) => rate(item.amount),
    },
    {
      name: "Total Amount",
      cell: (item) => amountOrUnknown(pricing(item).grossAmount),
    },
    {
      name: "Discount %",
      cell: (item) =>
        escape(item.stage1DiscountPercent ?? item.discount ?? 0) + "%",
    },
    {
      name: "Net Amount",
      cell: (item) =>
        amountOrUnknown(
          stage >= 3 ? item.finalAmount : pricing(item).netAmount,
        ),
      footer: () =>
        "&#8377;" +
        total(
          items,
          (item) => (stage >= 3 ? item.finalAmount : pricing(item).netAmount),
          "money",
        ),
    },
  );
  const businessDate = stageOneIssueDate(record);
  const columnWeight = (name) =>
    name === "Sr. No."
      ? 0.7
      : name === "SKU / Item"
        ? 2.3
        : ["Size", "Width"].includes(name)
          ? 0.8
          : name.includes("Weight")
            ? 1.3
            : name.includes("Pieces")
              ? 1.1
              : name.includes("Amount") || name.includes("Price")
                ? 1.5
                : 1.2;
  const widthSum = columns.reduce(
    (sum, column) => sum + columnWeight(column.name),
    0,
  );
  const colgroup = columns
    .map(
      (column) =>
        `<col style="width:${(columnWeight(column.name) / widthSum) * 100}%">`,
    )
    .join("");
  const date = businessDate
    ? businessDate.split("-").reverse().join(" ")
    : "Date unavailable";
  const row = (item, index) =>
    "<tr>" +
    columns
      .map((column) => {
        try {
          return `<td>${column.cell(item, index)}</td>`;
        } catch {
          return "<td>Unavailable</td>";
        }
      })
      .join("") +
    "</tr>";
  const copy = (
    label,
  ) => `<section class="copy"><header><b>${label}</b><h1>CHALLAN DETAILS</h1></header>
    <div class="details"><p><strong>Challan No:</strong> ${escape(record.number)}</p><p><strong>Party:</strong> ${escape(record.party)}</p><p><strong>Date:</strong> ${date}</p><p><strong>Current Stage:</strong> Stage ${stage}</p></div>
    <table><colgroup>${colgroup}</colgroup><thead><tr>${columns.map((column) => `<th>${column.name}</th>`).join("")}</tr></thead><tbody>${items.map(row).join("")}</tbody></table><div class="copy-ending"><table class="ending-totals"><colgroup>${colgroup}</colgroup><tfoot><tr>${columns.map((column) => `<td>${column.footer?.() || ""}</td>`).join("")}</tr></tfoot></table>
    ${record.paymentSummary && stage === 3 ? `<p class="settlement">Paid to Date: ${amountOrUnknown(record.paymentSummary.amountPaid)} · Discount to Date: ${amountOrUnknown(record.paymentSummary.settlementDiscountAmount)} · Outstanding Amount: ${amountOrUnknown(record.paymentSummary.remaining)}</p>` : ""}
    ${settlement ? `<p class="settlement">Paid: ${amountOrUnknown(settlement.amountPaid)} · Settlement Discount: ${amountOrUnknown(settlement.settlementDiscountAmount)} · Actual Received: ${amountOrUnknown(settlement.actualReceivedAmount)} · <strong>Outstanding Amount: ${amountOrUnknown(settlement.remaining)}</strong></p>` : ""}
    <p class="notes"><strong>Notes:</strong> ${escape(record.notes || "-")}</p><div class="signature"><span>Customer Signature</span></div></div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(record.number)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;background:#fff;margin:16px}.copy{border:1.5px solid #334155;margin-bottom:20px;padding:16px}.copy header{break-after:avoid;page-break-after:avoid;border-bottom:2px solid #334155;display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:12px}.copy header b{border:1px solid #334155;font-size:11px;letter-spacing:.1em;padding:5px 8px}h1{font-size:18px;margin:0}.details{break-inside:avoid;break-after:avoid;page-break-after:avoid;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 16px}.details p,.notes,.settlement{font-size:11px;margin:4px 0}table{table-layout:fixed;border-collapse:collapse;width:100%;margin:12px 0 0;font-size:9px}th,td{border:1px solid #94a3b8;padding:6px 4px;text-align:center;overflow-wrap:anywhere}th{background:#eef2f7;font-size:8px;text-transform:uppercase}td:nth-child(2){text-align:left}tr{break-inside:avoid}tfoot{font-weight:bold;background:#f1f5f9}.copy-ending{break-inside:avoid;page-break-inside:avoid}.ending-totals{margin-top:0}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.signature{display:flex;justify-content:flex-end;margin-top:5mm;padding-top:22mm;break-inside:avoid;page-break-inside:avoid}.signature span{border-top:1px solid #334155;text-align:center;width:70mm;padding-top:3mm;font-size:12px;font-weight:bold}@page{size:A4;margin:10mm}@media print{body{margin:0}.copy{break-inside:auto}thead{display:table-header-group}tfoot{display:table-row-group}}
    </style></head><body>${copy("ORIGINAL")}${copy("DUPLICATE")}</body></html>`;
}
