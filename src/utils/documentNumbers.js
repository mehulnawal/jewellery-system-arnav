export const CHALLAN_NUMBER_PATTERN = "[A-Z][0-9]+/([1-9]|[1-9][0-9]|100)";
export const PURCHASE_SUFFIX_PATTERN = "[A-Z][0-9]+-([1-9]|[1-9][0-9]|100)";
export const CHALLAN_NUMBER_HELP = "Format: B35/1. Use one letter from A to Z, a numeric series, and a final number from 1 to 100.";
export const PURCHASE_NUMBER_HELP = "Format: PR-B35-1. Enter B35-1 after the fixed PR- prefix. Use one letter from A to Z and a final number from 1 to 100.";

const patterns = {
  challan: new RegExp(`^${CHALLAN_NUMBER_PATTERN}$`),
  purchase: new RegExp(`^PR-${PURCHASE_SUFFIX_PATTERN}$`),
};
export const numberLabel = (kind) => kind === "challan" ? "Challan Number" : "Purchase Number";
export const isValidDocumentNumber = (kind, value) =>
  typeof value === "string" && !/\s/.test(value) && patterns[kind].test(value);

export function documentNumberError(kind, value, records = [], excludingId = null) {
  const label = numberLabel(kind);
  if (!value || (kind === "purchase" && value === "PR-")) return `${label} is required.`;
  if (!isValidDocumentNumber(kind, value))
    return `${label} must use ${kind === "challan" ? "{letter}{series}/{number}" : "PR-{letter}{series}-{number}"} format. Use one uppercase letter from A to Z, a numeric series, and a final number from 1 to 100 without leading zeros or spaces.`;
  const field = kind === "challan" ? "number" : "purchaseId";
  if (records.some((record) => record.id !== excludingId && record[field] === value))
    return `${label} ${value} already exists.`;
  return "";
}

export const numberRegistryCollection = (kind) => kind === "challan" ? "challanNumbers" : "purchaseNumbers";
// Valid Challan numbers contain exactly one slash; document IDs cannot contain it.
export const numberRegistryKey = (kind, value) => kind === "challan" ? value.replace("/", "-") : value;
