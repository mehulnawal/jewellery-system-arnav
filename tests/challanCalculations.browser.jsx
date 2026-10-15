import { createRoot } from "react-dom/client";
import {
  StageTwoModal,
  FinalInvoiceModal,
  FinalSettlementModal,
  ChallanDeleteModal,
  StageThreeView,
  StageFourView,
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
const modal =
  mode === "delete" ? (
    <ChallanDeleteModal
      record={deleteRecord}
      onClose={() => {}}
      onConfirm={async () => {
        window.__deleteCount = (window.__deleteCount || 0) + 1;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }}
    />
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
createRoot(document.getElementById("root")).render(modal);
