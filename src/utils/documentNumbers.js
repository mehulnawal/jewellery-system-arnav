export const CHALLAN_NUMBER_PATTERN = "A[0-9]+/([1-9]|[1-9][0-9]|100)";
export const PURCHASE_SUFFIX_PATTERN = "A[0-9]+-([1-9]|[1-9][0-9]|100)";
export const CHALLAN_NUMBER_HELP = "Format: A35/1. Use A{series}/{number}. Number must be 1-100.";
export const PURCHASE_NUMBER_HELP = "Format: PR-A35-1. Enter A35-1 after the fixed PR- prefix. Number must be 1 to 100.";

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
    return `${label} must use ${kind === "challan" ? "A{series}/{number}" : "PR-A{series}-{number}"} format, with a numeric series and a final number from 1 to 100 without leading zeros. Spaces are not allowed.`;
  const field = kind === "challan" ? "number" : "purchaseId";
  if (records.some((record) => record.id !== excludingId && record[field] === value))
    return `${label} ${value} already exists.`;
  return "";
}

export const numberRegistryCollection = (kind) => kind === "challan" ? "challanNumbers" : "purchaseNumbers";
// Valid Challan numbers contain exactly one slash; document IDs cannot contain it.
export const numberRegistryKey = (kind, value) => kind === "challan" ? value.replace("/", "-") : value;
