import {
  CHALLAN_IMPORT_HEADERS,
  CHALLAN_IMPORT_SHEET,
} from "./challanImport.js";

export function createChallanImportWorkbook(XLSX) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([CHALLAN_IMPORT_HEADERS]),
    CHALLAN_IMPORT_SHEET,
  );
  return book;
}
