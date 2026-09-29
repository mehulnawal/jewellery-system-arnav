import { useEffect, useRef, useState } from "react";
import { collection, doc, getDocsFromServer, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../ui/ToastContext";
import { formatDecimal } from "../../utils/inventoryRules";
import { pricingFor, purchaseLockedByChallan, savePurchase } from "../../utils/purchase";
import { PURCHASE_NUMBER_HELP, PURCHASE_SUFFIX_PATTERN } from "../../utils/documentNumbers.js";
import { purchaseNumberError, validatePurchaseForm } from "../../utils/purchaseValidation.js";
import { purchaseSaveError } from "../../utils/purchaseErrors.js";

const blankItem = () => ({ id: crypto.randomUUID(), type: "", shape: "", size: "", weight: "", pieces: "", box: "" });
const today = () => { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const moneyLabel = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
const errorId = (key) => `purchase-error-${key}`;
function FieldMessage({ field, error }) {
  return <small id={errorId(field)} className="purchase-field-message" aria-live="polite" role={error ? "alert" : undefined}>{error || "\u00a0"}</small>;
}
function Field({ label, field, error, help, optional, children }) {
  return <label className="purchase-field"><span>{label}{optional && <em>Optional</em>}</span>{children}{help && <small id={`purchase-help-${field}`}>{help}</small>}<FieldMessage field={field} error={error} /></label>;
}
function MasterField({ label, field, value, options, optional, inputProps, onChange, onBlur, error }) {
  const [focused, setFocused] = useState(false);
  const matches = options.filter((item) => item.toLowerCase().includes(value.toLowerCase())).slice(0, 7);
  return <Field label={label} field={field} error={error} optional={optional}>
    <input {...inputProps} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => { onBlur(); setTimeout(() => setFocused(false), 120); }} placeholder={optional ? "Optional" : `Search or add ${label.toLowerCase()}`} />
    {focused && value && <div className="purchase-master-menu">{matches.map((item) => <button type="button" key={item} onMouseDown={(event) => { event.preventDefault(); onChange(item); setFocused(false); }}>{item}</button>)}{!matches.some((item) => item.toLowerCase() === value.trim().toLowerCase()) && <small>New {label.toLowerCase()} will be saved</small>}</div>}
  </Field>;
}
// Keep server errors only while the values responsible for that error match.
const signature = (form, key) => {
  if (["customDiscount", "discountChoice"].includes(key)) return JSON.stringify([form.discountChoice, form.customDiscount]);
  if (key === "totalWeight") return JSON.stringify([form.totalWeight, form.items.map((item) => item.weight)]);
  if (key.startsWith("items.")) { const [, id, field] = key.split("."); const item = form.items.find((row) => row.id === id); return JSON.stringify(field === "size" ? [item?.type, item?.shape, item?.size] : item?.[field]); }
  return JSON.stringify(form[key]);
};

export default function PurchaseForm({ record, purchases, onClose, vendors, brokers, shapes, allowDimensions, inventory, challans }) {
  const { user } = useAuth(), toast = useToast(), formRef = useRef(null), savingRef = useRef(false);
  const [form, setForm] = useState(() => record ? { ...record, discountChoice: [0, 6, 7, 8].includes(Number(record.discount)) ? String(record.discount) : "custom", customDiscount: String(record.discount ?? ""), items: (record.items || []).map((item) => ({ ...item, id: item.id || crypto.randomUUID() })) } : {
    purchaseId: "PR-", date: today(), vendorName: "", brokerName: "", totalWeight: "", amount: "", discountChoice: "0", customDiscount: "", paymentDueDays: "0", items: [blankItem()],
  });
  const [touched, setTouched] = useState({}), [submitted, setSubmitted] = useState(false), [saving, setSaving] = useState(false), [globalError, setGlobalError] = useState("");
  const [availability, setAvailability] = useState({}), [availabilityAttempt, setAvailabilityAttempt] = useState(0), [serverErrors, setServerErrors] = useState({});
  // Snapshot listeners can expose our own just-written record before the save
  // promise resolves. Do not label that successful write a duplicate.
  const validation = validatePurchaseForm(form, { original: record, purchases: saving ? [] : purchases, inventory: saving ? [] : inventory, allowDimensions });
  const currentNumberError = validation.errors.purchaseId || "";
  const shouldCheckNumber = !record && !purchaseNumberError(form.purchaseId) && !currentNumberError;
  useEffect(() => {
    if (!shouldCheckNumber) return;
    let cancelled = false;
    const value = form.purchaseId;
    const timer = setTimeout(async () => {
      setAvailability({ value, status: "checking" });
      try {
        const existing = await getDocsFromServer(query(collection(db, "purchases"), where("purchaseId", "==", value), limit(1)));
        if (!cancelled) setAvailability({ value, status: existing.empty ? "available" : "duplicate" });
      } catch {
        if (!cancelled) setAvailability({ value, status: "failed" });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.purchaseId, shouldCheckNumber, availabilityAttempt]);
  const numberStatus = availability.value === form.purchaseId ? availability.status : "pending";
  const numberPending = shouldCheckNumber && ["pending", "checking"].includes(numberStatus);
  const errors = { ...validation.errors };
  if (shouldCheckNumber && numberStatus === "duplicate") errors.purchaseId = "This Purchase Number already exists.";
  if (shouldCheckNumber && numberStatus === "failed") errors.purchaseId = "Could not check this number. Check your connection and try again.";
  for (const [key, entry] of Object.entries(serverErrors)) if (signature(form, key) === entry.signature) errors[key] = entry.message;
  const visibleError = (key) => (submitted || touched[key] || serverErrors[key]?.signature === signature(form, key)
    || (key === "totalWeight" && validation.weightMismatch)
    || (key === "purchaseId" && shouldCheckNumber && ["duplicate", "failed"].includes(numberStatus))) ? errors[key] || "" : "";
  const touch = (key) => setTouched((state) => ({ ...state, [key]: true }));
  const update = (key, value) => { touch(key); setForm((state) => ({ ...state, [key]: value })); setGlobalError(""); };
  const updateItem = (id, key, value) => { touch(`items.${id}.${key}`); setForm((state) => ({ ...state, items: state.items.map((item) => item.id === id ? { ...item, [key]: value } : item) })); setGlobalError(""); };
  const inputProps = (key, label, optional = false) => ({
    "aria-label": label, "aria-invalid": Boolean(visibleError(key)), "aria-describedby": `${errorId(key)}${key === "purchaseId" ? " purchase-help-purchaseId" : ""}`,
    required: !optional, onBlur: () => touch(key),
  });
  const focusError = () => requestAnimationFrame(() => { const input = formRef.current?.querySelector('[aria-invalid="true"]'); input?.focus(); input?.scrollIntoView({ block: "nearest" }); });
  const pricing = validation.moneyValid ? pricingFor(form.amount, validation.discount) : null;
  const locked = record && purchaseLockedByChallan(record, inventory, challans);
  const submit = async (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    setSubmitted(true);
    if (Object.keys(errors).length || numberPending) { focusError(); return; }
    if (locked) { setGlobalError("This Purchase cannot be edited because its stock has been used in a Challan."); return; }
    savingRef.current = true; setSaving(true); setGlobalError("");
    try {
      const vendorName = vendors.find((name) => name.toLowerCase() === form.vendorName.trim().toLowerCase()) || form.vendorName.trim();
      const brokerName = brokers.find((name) => name.toLowerCase() === form.brokerName.trim().toLowerCase()) || form.brokerName.trim();
      const saved = await savePurchase({ purchase: { ...form, vendorName, brokerName, origin: record?.origin || "Manual", totalWeight: Number(form.totalWeight), paymentDueDays: Number(form.paymentDueDays), paymentDueDate: validation.dueDate, ...pricing }, items: form.items, user, existingInventory: inventory, edit: Boolean(record), allowDimensions });
      const masters = await Promise.allSettled([
        setDoc(doc(db, "vendors", encodeURIComponent(vendorName.toLowerCase())), { name: vendorName, normalized: vendorName.toLowerCase(), updatedAt: serverTimestamp() }, { merge: true }),
        brokerName ? setDoc(doc(db, "brokers", encodeURIComponent(brokerName.toLowerCase())), { name: brokerName, normalized: brokerName.toLowerCase(), updatedAt: serverTimestamp() }, { merge: true }) : Promise.resolve(),
      ]);
      toast(`Purchase ${saved.purchaseId} ${record ? "updated" : "created"}.`, "success");
      if (masters.some((result) => result.status === "rejected")) toast("Purchase saved, but supplier suggestions could not be updated.", "error");
      onClose();
    } catch (reason) {
      const fields = reason.fields || reason.details?.fields || (reason.field ? { [reason.field]: reason.message } : null);
      if (fields) {
        setServerErrors(Object.fromEntries(Object.entries(fields).map(([key, message]) => [key, { message, signature: signature(form, key) }])));
        focusError();
      } else setGlobalError(purchaseSaveError(reason, Boolean(record)));
    } finally { savingRef.current = false; setSaving(false); }
  };
  const simpleField = (key, label, attributes = {}) => <Field label={label} field={key} error={visibleError(key)}><input {...inputProps(key, label)} {...attributes} value={form[key]} onChange={(event) => update(key, event.target.value)} /></Field>;
  return <div className="purchase-modal"><form ref={formRef} className="purchase-modal-card purchase-form-card" noValidate onSubmit={submit} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
    <button type="button" className="purchase-close" aria-label="Close Purchase" disabled={saving} onClick={onClose}>×</button>
    <h2>{record ? "Edit Purchase" : "Create Purchase"}</h2>
    <p>Enter a Purchase Number. SKU, Group and Ageing are generated automatically.</p>
    <section className="purchase-form-grid">
      <Field label="Purchase Number" field="purchaseId" error={visibleError("purchaseId")} help={PURCHASE_NUMBER_HELP}>
        {record ? <input aria-label="Purchase Number" value={record.purchaseId || ""} readOnly /> : <div className={`purchase-number-input ${visibleError("purchaseId") ? "has-error" : ""}`}><span aria-hidden="true">PR-</span><input {...inputProps("purchaseId", "Purchase Number after PR-")} pattern={PURCHASE_SUFFIX_PATTERN} placeholder="B35-1" value={form.purchaseId.slice(3)} onChange={(event) => update("purchaseId", `PR-${event.target.value}`)} /></div>}
        {numberPending && <small className="purchase-availability" role="status">Checking availability...</small>}
        {numberStatus === "failed" && shouldCheckNumber && <button type="button" className="purchase-check-again" onClick={() => setAvailabilityAttempt((value) => value + 1)}>Check again</button>}
      </Field>
      {simpleField("date", "Date", { type: "date" })}
      <MasterField label="Vendor Name" field="vendorName" value={form.vendorName} options={vendors} inputProps={inputProps("vendorName", "Vendor Name")} onChange={(value) => update("vendorName", value)} onBlur={() => touch("vendorName")} error={visibleError("vendorName")} />
      <MasterField label="Broker Name" field="brokerName" value={form.brokerName || ""} options={brokers} optional inputProps={inputProps("brokerName", "Broker Name", true)} onChange={(value) => update("brokerName", value)} onBlur={() => touch("brokerName")} error="" />
      {simpleField("totalWeight", "Total Purchase Weight (ct)", { inputMode: "decimal" })}
      {simpleField("amount", "Amount", { inputMode: "decimal" })}
      <Field label="Discount" field="discountChoice" error={visibleError("discountChoice")}><select {...inputProps("discountChoice", "Discount")} value={form.discountChoice} onChange={(event) => update("discountChoice", event.target.value)}><option value="0">0%</option><option value="6">6%</option><option value="7">7%</option><option value="8">8%</option><option value="custom">Custom</option></select></Field>
      {form.discountChoice === "custom" && simpleField("customDiscount", "Custom Discount %", { inputMode: "decimal" })}
      {simpleField("paymentDueDays", "Payment Due Days", { inputMode: "numeric" })}
    </section>
    <section className="purchase-financials" aria-live="polite">
      <div><span>Gross Amount</span><b>{validation.errors.amount ? "--" : moneyLabel(Number(form.amount))}</b></div>
      <div><span>Discount {validation.discount === null ? "" : `${validation.discount}%`}</span><b>{pricing ? `- ${moneyLabel(pricing.discountAmount)}` : "--"}</b></div>
      <div><span>Final / Net Payable</span><b>{pricing ? moneyLabel(pricing.netPayable) : "--"}</b></div>
      <div><span>Payment Due Date</span><b>{validation.dueDate ? new Date(`${validation.dueDate}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "--"}</b></div>
    </section>
    <h3>Purchase Items</h3>{visibleError("items") && <FieldMessage field="items" error={visibleError("items")} />}
    <div className="purchase-items"><div className="purchase-items-scroll"><table><thead><tr>{["Type", "Shape", "Size (mm)", "Weight (ct)", "Pieces", "BOX"].map((label) => <th key={label}>{label}</th>)}<th /></tr></thead>
      <tbody>{form.items.map((item, index) => <tr key={item.id}>{["type", "shape", "size", "weight", "pieces", "box"].map((key) => {
        const field = `items.${item.id}.${key}`, label = `Item ${index + 1} ${key === "box" ? "BOX" : key[0].toUpperCase() + key.slice(1)}`;
        const props = { ...inputProps(field, label, key === "box"), value: item[key], onChange: (event) => updateItem(item.id, key, key === "box" ? event.target.value.toUpperCase() : event.target.value) };
        return <td key={key}>{["type", "shape"].includes(key) ? <select {...props}><option value="">Select</option>{(key === "type" ? ["CVD", "HP"] : [...new Set([...shapes, item.shape].filter(Boolean))]).map((value) => <option key={value}>{value}</option>)}</select> : <input {...props} inputMode={key === "pieces" ? "numeric" : ["size", "weight"].includes(key) ? "decimal" : undefined} placeholder={key === "size" ? allowDimensions ? "4.3X2.0" : "4.3" : undefined} />}<FieldMessage field={field} error={visibleError(field)} /></td>;
      })}<td><button type="button" className="purchase-icon-button remove" disabled={form.items.length === 1 || saving} onClick={() => setForm((state) => ({ ...state, items: state.items.filter((row) => row.id !== item.id) }))} aria-label={`Remove item ${index + 1}`}>×</button></td></tr>)}</tbody>
      <tfoot><tr><td colSpan="3">Total Items: {form.items.length}</td><td className={validation.weightMismatch ? "purchase-total-mismatch" : ""}>{validation.itemWeightsValid ? formatDecimal(validation.itemTotalWeight) : "--"}</td><td>{form.items.every((item) => /^\d+$/.test(String(item.pieces))) ? form.items.reduce((sum, item) => sum + Number(item.pieces), 0) : "--"}</td><td colSpan="2" /></tr></tfoot>
    </table></div><button type="button" className="purchase-add-item" disabled={saving} onClick={() => setForm((state) => ({ ...state, items: [...state.items, blankItem()] }))}>+ Add Item</button></div>
    {locked && <p className="purchase-error">This Purchase is locked because its stock has been used in a Challan.</p>}
    {globalError && <p className="purchase-error" role="alert">{globalError}</p>}
    <footer><button className="purchase-button primary" disabled={saving || numberPending || locked}>{saving ? "Saving..." : record ? "Save Purchase" : "Create Purchase"}</button><button type="button" className="purchase-button secondary" disabled={saving} onClick={onClose}>Cancel</button></footer>
  </form></div>;
}
