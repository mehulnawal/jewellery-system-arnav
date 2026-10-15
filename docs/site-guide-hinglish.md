# Grantha Exports — Site aur Code Guide

Yeh guide current repository ke code par based hai. Live deployed site aur uske data ko alag se verify nahi kiya gaya hai. Isse client ko business flow aur developer ko code map samajhne mein madad milegi.

## 1. Site ka purpose

Grantha Exports ek diamond inventory aur business workflow system hai:

**Purchase ya manual entry → Inventory stock → Party ko Challan par maal issue → Return aur sale record → Final invoice → Payment settlement → Dashboard aur reports**

Client ko bolne ke liye:

> “Is system mein diamond stock maintain hota hai. Stock manually ya Purchase ke through add hota hai. Party ko maal bhejne par Challan banta hai aur available stock kam hota hai. Jo maal return aata hai, woh stock mein wapas add hota hai. Jo party rakhti hai, uska final invoice banta hai. Payment record hone par Challan complete hota hai. Admin dashboard aur histories se poora movement dekh sakta hai.”

## 2. Login aur permissions

- Login Access ID/email aur password se hota hai. Firebase Auth login sambhalta hai; Firestore mein employee profile, role aur permissions rehti hain.
- Admin staff account bana sakta hai aur Inventory, Purchase, ya Challan Stage 1–4 ki permissions assign kar sakta hai.
- Staff ko assigned modules dikhte hain. Check Inventory logged-in users ke liye view-only lookup hai.
- Dashboard, Master Price List, Activity Log, Weekly Report, histories aur Settings admin routes hain.
- Permissions UI ke saath Firestore rules mein bhi enforce hoti hain.

Code: [AuthContext.jsx](../src/auth/AuthContext.jsx), [accessPolicy.js](../src/auth/accessPolicy.js), [ProtectedRoute.jsx](../src/auth/ProtectedRoute.jsx), [App.jsx](../src/App.jsx), [firestore.rules](../firestore.rules).

## 3. Har screen ka kaam

| Screen | Kya hota hai | Code |
|---|---|---|
| Dashboard | Available stock, stock ageing, Challan movement, payments pending, Purchase due dates aur attention items. Analysis period 7/30/90 days ya custom. | [BusinessDashboard.jsx](../src/modules/dashboard/BusinessDashboard.jsx) |
| Inventory | Stock add/edit/search, groups, Excel import/export aur print. Manual form: Type, Shape, Size, Weight, optional Box. SKU automatic. | [Inventory.jsx](../src/modules/inventory/Inventory.jsx) |
| Check Inventory | View-only stock lookup. Shape, Type, Group, Ageing aur sort filters. Result Excel export/print. | [CheckInventory.jsx](../src/modules/checkInventory/CheckInventory.jsx) |
| Purchase | Vendor, optional broker, date, Purchase number, amount, discount, payment due aur item details save. Purchase save hone par linked Inventory entries banti hain. Excel import/export aur print. | [Purchase.jsx](../src/modules/purchase/Purchase.jsx), [PurchaseForm.jsx](../src/modules/purchase/PurchaseForm.jsx) |
| Challan | Party ko issue kiye maal ka four-stage lifecycle. Inventory SKU, return, sale, invoice aur payment record. Stage 1/2 par images attach karne ka option. | [Challan.jsx](../src/modules/challan/Challan.jsx) |
| Master Price List | Admin Type + Shape + Height + optional Width ke exact combination ka price set karta hai. Matching price Challan mein auto-fill ho sakta hai; missing price manually enter ho sakti hai. Excel import/export. | [MasterPrices.jsx](../src/modules/masterPrices/MasterPrices.jsx) |
| Activity Log | Daily record: kisne kab Inventory, Purchase, Challan ya price list mein action kiya. Print aur Excel export. | [ActivityLog.jsx](../src/modules/activityLog/ActivityLog.jsx) |
| Weekly Report | Selected week ki actions ki summary, search aur filters. | [WeeklyReport.jsx](../src/modules/weeklyReport/WeeklyReport.jsx) |
| Vendor Purchase History | Ek vendor ke Purchases aur details. | [VendorPurchaseHistory.jsx](../src/modules/history/VendorPurchaseHistory.jsx) |
| Party Challan History | Ek party ke active/completed Challans aur stage details. | [PartyChallanHistory.jsx](../src/modules/history/PartyChallanHistory.jsx) |
| Settings | Staff accounts/permissions, import templates, Inventory SKU format setting, Danger Zone. | [AdminSettings.jsx](../src/modules/admin/AdminSettings.jsx) |

## 4. Challan ke four stages

1. **Stage 1 — Goods Out:** Party, Challan number aur Inventory item select karte hain. Issue ki hui weight/pieces available stock se kam hoti hain.
2. **Stage 2 — Return / Sale:** Party ne jitna maal return kiya, woh enter hota hai. Returned quantity stock mein wapas aati hai. Baaki sold/kept quantity hoti hai.
3. **Stage 3 — Final Invoice / Payment Pending:** Sold/kept maal ka final invoice confirm hota hai. Invoice ban gaya hai, payment abhi pending ho sakti hai.
4. **Stage 4 — Completed:** Amount paid aur settlement discount record hota hai. Inka total final invoice amount ke barabar hona zaroori hai; phir Challan complete hota hai.

Client ko “maal bheja”, “sale final hui” aur “payment complete hui” teen alag events ki tarah samjhao. Stage UI [Challan.jsx](../src/modules/challan/Challan.jsx) mein aur calculations [challanCalculations.js](../src/utils/challanCalculations.js) mein hain.

## 5. Client demo ka order

1. Admin login aur Settings mein staff permissions dikhao.
2. Master Price List mein price combination dikhao.
3. Inventory mein item add karo aur automatic SKU samjhao.
4. Purchase save karke linked Inventory stock dikhao.
5. Check Inventory mein search/filter dikhao.
6. Challan Stage 1 mein stock issue karke available stock kam hota dikhao.
7. Stage 2 mein partial return enter karke stock wapas aata dikhao.
8. Stage 3 final invoice aur Stage 4 payment settlement dikhao.
9. Dashboard, Party/Vendor History aur Activity Log dikhao.

Real business data par demo entries banane se pehle test data ke liye alag jagah tay karo.

## 6. Important business rules

- **Document numbers manually enter hote hain.** Challan example B35/1; Purchase example PR-B35-1. Format aur duplicate checks [documentNumbers.js](../src/utils/documentNumbers.js) mein hain.
- **Inventory SKU automatic** Type, Shape aur Size se banta hai. Duplicate identity validate hoti hai. Code: [inventoryIdentity.js](../src/utils/inventoryIdentity.js), [inventoryRules.js](../src/utils/inventoryRules.js).
- **Stock ageing:** 0–30 din green, 31–45 yellow, 46+ red. Code: [ageingConfig.js](../src/config/ageingConfig.js).
- Staff ke liye Inventory item aur Challan edit ka 60-minute window hai; admin ke paas wider control hai. Purchase-related stock edits ke alag rules hain. Code: [firestore.rules](../firestore.rules), [Challan.jsx](../src/modules/challan/Challan.jsx).
- Agar Purchase ka stock kisi Challan mein use ho chuka hai, Purchase edit par restriction hai. Code: [purchase.js](../src/utils/purchase.js), [PurchaseForm.jsx](../src/modules/purchase/PurchaseForm.jsx).
- **Purchase payment due date** calculate/display hoti hai, lekin Purchase payment settlement saved records mein track nahi hoti. Dashboard is limitation ko bhi batata hai.
- **Danger Zone reset** admin ka permanent business-data deletion action hai. Iske liye password re-verification aur multiple confirmations hain. Code: [DangerZone.jsx](../src/modules/admin/DangerZone.jsx), [BusinessReset.jsx](../src/modules/admin/BusinessReset.jsx), [resetCore.mjs](../functions/resetCore.mjs).

## 7. Code kahan likha hai

| Kaam | File/folder |
|---|---|
| App ko start karna, providers | [main.jsx](../src/main.jsx) |
| URL se page select karna | [App.jsx](../src/App.jsx) |
| Sidebar, header, theme, logout | [DashboardLayout.jsx](../src/layouts/DashboardLayout.jsx) |
| Page ke forms, tables, buttons | src/modules/ mein us page ki .jsx file |
| Page ka design | Usi module ki .css file; common theme [theme.css](../src/styles/theme.css) |
| Login aur permissions | [AuthContext.jsx](../src/auth/AuthContext.jsx), [accessPolicy.js](../src/auth/accessPolicy.js) |
| Firebase connection | [config.js](../src/firebase/config.js) |
| Database security rules | [firestore.rules](../firestore.rules) |
| Purchase save aur stock creation | [purchase.js](../src/utils/purchase.js) |
| Challan stock/amount calculations | [Challan.jsx](../src/modules/challan/Challan.jsx), [challanCalculations.js](../src/utils/challanCalculations.js) |
| Challan image upload | [cloudinary.js](../src/utils/cloudinary.js) |
| Business reset backend | [index.mjs](../functions/index.mjs), [resetCore.mjs](../functions/resetCore.mjs) |
| Commands/dependencies | [package.json](../package.json) |
| Hosting build/redirect | [netlify.toml](../netlify.toml) |

**Code flow:** main.jsx app start karta hai → App.jsx URL ke hisaab se page select karta hai → DashboardLayout.jsx sidebar/header dikhata hai → src/modules/ ki screen Firestore data padhti/save karti hai → src/utils/ validation aur calculations karta hai → firestore.rules database permissions enforce karti hain.

Technology: frontend React + Vite; login Firebase Auth; database Firestore; Challan images Cloudinary; static hosting configuration Netlify mein. Firestore business data ko read/write karne ke liye [businessWrites.js](../src/firebase/businessWrites.js) system availability/reset generation check karta hai.

## 8. Local computer par kaise chalana hai

Project folder mein PowerShell se:

    npm install
    Copy-Item .env.example .env
    npm run dev

.env mein Firebase project ki values bharni hain. Challan image upload ke liye Cloudinary values bhi chahiye. Variable names [.env.example](../.env.example) mein hain. Production build check npm run build se hota hai; build se pehle Inventory contract verification chalti hai. Config [package.json](../package.json) aur [netlify.toml](../netlify.toml) mein hai.

### Sabse simple map

- src/modules = screen par kya dikhega
- src/utils = business validation aur calculations
- src/auth = kaun kaunsa page use karega
- src/firebase + firestore.rules = data kaise connect, save aur protect hoga

