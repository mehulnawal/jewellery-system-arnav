import "../src/index.css";
import { createRoot } from "react-dom/client";
import {
  StageTwoModal,
  FinalInvoiceModal,
  FinalSettlementModal,
  ChallanDeleteModal,
  StageOneView,
  StageTwoView,
  StageThreeView,
  StageFourView,
  ChallanImportReviewModal,
} from "../src/modules/challan/Challan.jsx";
const record = {
  number: "B1/1",
  date: "2026-10-15",
  party: "Test",
  items: [
    {
      id: "a",
      sku: "A",
      shape: "Round",
      pieces: 10,
      weight: 5,
      amount: 1000,
      discount: 6,
    },
    {
      id: "b",
      sku: "B",
      shape: "Oval",
      pieces: 4,
      weight: 2,
      amount: 500,
      discount: 8,
    },
  ],
};
const mode = new URLSearchParams(location.search).get("mode");
const returnRecord =
  mode === "weight-only"
    ? {
        ...record,
        items: [
          {
            id: "manual",
            sku: "MANUAL",
            pieces: 0,
            weight: 5,
            amount: 1000,
            discount: 6,
          },
        ],
      }
    : record;
const invoiceRecord = {
  ...record,
  stage: 2,
  stage2Return: {
    items: [
      {
        sku: "A",
        issuedPieces: 10,
        issuedWeight: 5,
        returnPieces:
          mode === "invoice-full" ? 10 : mode === "invoice-none" ? 0 : 5,
        returnWeight:
          mode === "invoice-full" ? 5 : mode === "invoice-none" ? 0 : 2.5,
        soldPieces:
          mode === "invoice-full" ? 0 : mode === "invoice-none" ? 10 : 5,
        soldWeight:
          mode === "invoice-full" ? 0 : mode === "invoice-none" ? 5 : 2.5,
        amount: 1000,
        discount: 6,
      },
    ],
  },
};
const settlementRecord = {
  ...record,
  stage: 3,
  finalInvoice: { finalInvoiceAmount: 1000 },
};
const savedInvoice = {
  items: [
    {
      id: "a",
      sku: "A",
      shape: "Round",
      size: "5",
      issuedPieces: 10,
      issuedWeight: 5,
      returnPieces: 5,
      returnWeight: 2.5,
      soldPieces: 5,
      soldWeight: 2.5,
      amount: 1000,
      discount: 6,
      grossAmount: 500,
      stage1DiscountPercent: 6,
      stage1DiscountAmount: 30,
      finalAmount: 470,
    },
  ],
  grossAmount: 500,
  stage1DiscountAmount: 30,
  finalInvoiceAmount: 470,
};
const savedManualInvoice = {
  ...savedInvoice,
  calculationVersion: "manual-partial-v1",
  items: [
    {
      ...savedInvoice.items[0],
      grossAmount: 1000,
      stage1DiscountAmount: 60,
      stage1NetAmount: 940,
      finalAmount: 400.5,
    },
  ],
  grossAmount: 1000,
  stage1DiscountAmount: 60,
  stage1NetAmount: 940,
  finalInvoiceAmount: 400.5,
};
const weightedItem = {
  id: "weighted",
  sku: "WEIGHTED",
  shape: "Round",
  pieces: 0,
  weight: 0.01,
  amount: 1000,
  grossAmount: 10,
  discount: 7,
  discountAmount: 0.7,
  netAmount: 9.3,
  pricingVersion: "weight-rate-v1",
};
const weightedInvoice = {
  items: [
    {
      ...weightedItem,
      issuedPieces: 0,
      issuedWeight: 0.01,
      returnPieces: 0,
      returnWeight: 0,
      soldPieces: 0,
      soldWeight: 0.01,
      stage1DiscountPercent: 7,
      stage1DiscountAmount: 0.7,
      stage1NetAmount: 9.3,
      finalAmount: 9.3,
    },
  ],
  grossAmount: 10,
  stage1DiscountAmount: 0.7,
  stage1NetAmount: 9.3,
  finalInvoiceAmount: 9.3,
};
const deleteRecord = {
  ...record,
  id: "delete-one",
  stage: 2,
  items: [
    { ...record.items[0], inventoryId: "stock", sourceInventoryId: "stock" },
  ],
  stage2Return: {
    items: [
      {
        ...record.items[0],
        inventoryId: "stock",
        sourceInventoryId: "stock",
        issuedPieces: 10,
        issuedWeight: 5,
        returnPieces: 4,
        returnWeight: 2,
        soldPieces: 6,
        soldWeight: 3,
      },
    ],
  },
};
const bulkValidCount =
  mode === "bulk-review-50"
    ? 50
    : mode === "bulk-review-20-10"
      ? 20
      : mode === "bulk-review-10"
        ? 10
        : mode === "bulk-review-5-2"
          ? 5
          : mode === "bulk-review-0-5" || mode === "bulk-review-5-errors"
            ? 0
            : mode === "bulk-review-1" || mode === "bulk-review-10-items"
              ? 1
              : 2;
const bulkInvalidCount =
  mode === "bulk-review-20-10"
    ? 10
    : mode === "bulk-review-0-5"
      ? 5
      : mode === "bulk-review-5-2"
        ? 2
        : mode === "bulk-review" || mode === "bulk-review-5-errors"
          ? 1
          : 0;
const modal = mode?.startsWith("bulk-review") ? (
  <>
    <button
      id="background-action"
      onClick={() => {
        window.__backgroundClicked = true;
      }}
    >
      Background action
    </button>
    <ChallanImportReviewModal
      review={{ filename: "many-challans.xlsx" }}
      preview={{
        groups: [
          ...Array.from({ length: bulkValidCount }, (_, index) => ({
            ref: "C" + String(index + 1).padStart(3, "0"),
            party: "Sonam",
            date: "2026-10-17",
            items: Array.from(
              { length: mode === "bulk-review-10-items" ? 10 : 1 },
              (_, itemIndex) => ({
                importRowNumber: index * 10 + itemIndex + 2,
                sku: "SKU-" + (index + 1) + "-" + (itemIndex + 1),
                width: "1",
                shape: "Oval",
                size: "3",
                type: "HP",
                weight: "1.000",
                pieces: "1",
                amount: "1000",
                discount: "7",
              }),
            ),
            status: "VALID",
            reasons: [],
            totals: {
              weight: mode === "bulk-review-10-items" ? 10 : 1,
              pieces: mode === "bulk-review-10-items" ? 10 : 1,
              netAmount: mode === "bulk-review-10-items" ? 9300 : 930,
            },
          })),
          ...Array.from({ length: bulkInvalidCount }, (_, index) => ({
            ref: "C" + String(bulkValidCount + index + 1).padStart(3, "0"),
            party: "Rohan",
            date: "2026-10-17",
            items: [{ importRowNumber: index + 4, sku: "BAD" }],
            status: "INVALID",
            reasons:
              mode === "bulk-review-5-errors"
                ? Array.from({ length: 5 }, (_, reasonIndex) => ({
                    rowNumber: reasonIndex + 4,
                    message: "Issue " + (reasonIndex + 1) + " for SKU BAD.",
                  }))
                : [
                    {
                      rowNumber: index + 4,
                      message: "SKU BAD does not exist.",
                    },
                    {
                      rowNumber: index + 4,
                      message: "Pieces must be a whole number.",
                    },
                  ],
          })),
        ],
        validCount: bulkValidCount,
        invalidCount: bulkInvalidCount,
      }}
      result={null}
      saving={false}
      onImport={() => {
        window.__bulkImportClicked = true;
      }}
      onClose={() => {
        window.__bulkReviewClosed = true;
        window.__bulkRoot.render(
          <button id="background-action">Background action</button>,
        );
      }}
    />
  </>
) : mode === "delete" ? (
  <ChallanDeleteModal
    record={deleteRecord}
    onClose={() => {}}
    onConfirm={async () => {
      window.__deleteCount = (window.__deleteCount || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }}
  />
) : mode === "views-weighted" ? (
  <>
    <StageOneView items={[weightedItem]} />
    <StageTwoView items={weightedInvoice.items} />
    <StageThreeView invoice={weightedInvoice} />
    <StageFourView
      items={weightedInvoice.items}
      invoice={weightedInvoice}
      settlement={{
        amountPaid: 9.3,
        settlementDiscountAmount: 0,
        actualReceivedAmount: 9.3,
      }}
    />
  </>
) : mode === "views-new" ? (
  <>
    <StageThreeView invoice={savedManualInvoice} />
    <StageFourView
      items={savedManualInvoice.items}
      invoice={savedManualInvoice}
      settlement={{
        amountPaid: 400.5,
        settlementDiscountAmount: 0,
        actualReceivedAmount: 400.5,
      }}
    />
  </>
) : mode === "views" ? (
  <>
    <StageThreeView invoice={savedInvoice} />
    <StageFourView
      items={savedInvoice.items}
      invoice={savedInvoice}
      settlement={{
        amountPaid: 470,
        settlementDiscountAmount: 0,
        actualReceivedAmount: 470,
      }}
    />
  </>
) : mode?.startsWith("invoice") ? (
  <FinalInvoiceModal
    record={invoiceRecord}
    onClose={() => {}}
    canEnterPartial={mode !== "invoice-staff"}
    onConfirm={async (amounts) => {
      window.__invoiceConfirmed = amounts;
    }}
  />
) : mode === "settlement" ? (
  <FinalSettlementModal
    record={settlementRecord}
    onClose={() => {}}
    onConfirm={async (paid, discount) => {
      window.__settlement = { paid, discount };
    }}
  />
) : (
  <StageTwoModal
    record={returnRecord}
    onClose={() => {}}
    onConfirm={async (rows) => {
      window.__savedReturnRows = structuredClone(rows);
    }}
  />
);
const browserRoot = createRoot(document.getElementById("root"));
window.__bulkRoot = browserRoot;
browserRoot.render(modal);
