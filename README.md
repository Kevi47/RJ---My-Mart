# RJ My Mart: Invoice Verification & Stock Reconciliation

A companion to Polosys ERP (BRD v0.3). It reads supplier invoices from a photo, checks them against Polosys stock-on-hand, counts physical receiving by barcode (phone or laptop, live), and produces a reconciliation report for manager approval and export back to Polosys.

**Stack:** React + Vite (frontend), Supabase (Postgres, auth, realtime, storage), Vercel (hosting + `/api/extract` serverless function), Claude Opus 5.5 vision (invoice reading).

## How BRD requirements map to the app

| BRD | Where |
|---|---|
| FR-1 SOH upload | **Stock (SOH)** page: upload the Polosys *Stock Report* Excel |
| FR-2 Invoice capture | **New invoice**: photos → `api/extract.ts` (layout-agnostic, structured output) |
| FR-3 Price & SOH cross-check | Invoice → *Lines & price check*: flags No change / MRP changed / Sale price issue / Cost changed / New item |
| FR-4 Dual MRP lines | MRP-changed lines create an `mrp_batches` row on approval; old SOH line untouched; *MRP Batches* sheet in export |
| FR-5 Live scan counter | *Receive* tab and phone scanner: "3 of 6", over-scan alert |
| FR-6 Reconciliation | *Reconciliation* tab: qty variance + price variance |
| FR-7 Manager approval | Approve / send lines back (only `manager`/`admin`, enforced in the database) |
| FR-8 Export | *Download Polosys import file* (.xlsx). Column layout to be finalised with Polosys (BRD Q1) |
| FR-9 Validation | qty×rate, discount, tax, line total, invoice total + round-off, GST vs HSN |
| FR-10 Learn-once mapping | Confirmed matches saved per supplier; unknown barcode → pick line once |
| FR-11 Units / effective cost | Cases × UPC + pieces; net cost after discount + scheme |
| FR-12 Header + duplicates | Duplicate supplier+invoice-no warning; e-invoice QR verify |
| FR-13 Margin alert | Store threshold in Settings |
| FR-14 Phone as scanner | QR on the *Receive* tab → phone joins; realtime sync; offline queue; undo; who/device per scan |
| Auditability | **Audit log** page |
| Q4 loose goods | "Loose / no barcode" line toggle → *Set count* |
| Q7 multiple stores | Stores in Settings; store picker in the header |

## One-time setup

### 1. Supabase
1. Open the project → **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.
2. **Project Settings → API**: copy the *Project URL* and the *anon / publishable* key.
3. (Optional) **Authentication → Providers → Email**: turn off *Confirm email* if staff don't have working mailboxes.

The first account to sign up becomes the **admin**. Later sign-ups wait until an admin ticks *Active* in Settings.

### 2. Local run
```bash
cp .env.example .env.local   # fill in the keys
npm install
npm run dev
```

### 3. Vercel
1. vercel.com → **Add New → Project** → import `Kevi47/RJ---My-Mart` (framework preset: Vite).
2. **Environment Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (optionally `CLAUDE_MODEL`).
3. Deploy. In Supabase → **Authentication → URL Configuration**, add the Vercel URL as Site URL.

## Trial without Supabase
Reads invoice photos and matches them against a stock export, printing the checks:
```bash
node --env-file=.env.local scripts/try-invoices.mts "amballur stock.xlsx" invoice1.jpg invoice2.jpg
```

## Daily flow
1. Upload the latest Polosys stock report (**Stock (SOH)**).
2. **New invoice** → photograph → *Read invoice* → check flagged lines, match unmatched items, confirm pack MRP where asked.
3. **Start receiving** → open the QR on a phone → scan every unit. New barcodes are linked once.
4. **Finish scanning** → manager reviews **Reconciliation** → approve or send lines back.
5. **Download Polosys import file**.

## Open items from the BRD
- **Q1 / FR-8:** Polosys import column layout. Adjust `src/lib/exportPolosys.ts` once known.
- **Q3:** whether Polosys holds two MRPs per code. The export lists new MRP batches separately for now.
- The Polosys stock export has **no MRP or barcode columns**. MRP is learned from approved invoices; barcodes are learned while scanning. If Polosys can add MRP/Barcode columns to the export, the upload uses them automatically.
