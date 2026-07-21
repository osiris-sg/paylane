# Upload Invoice Flow

End-to-end documentation of the **bulk invoice upload** feature: dropping one or
many files, AI data extraction, customer matching / creation, automatic draft
saving, the duplicate / updated status logic, and finally saving or sending.

- **UI:** `src/app/(dashboard)/invoices/upload/page.tsx`
- **AI extraction endpoint:** `src/app/api/extract-invoice/route.ts`
- **Persist procedure:** `invoice.upsertFromUpload` (`src/server/api/routers/invoice.ts`)
- **Edit procedure:** `invoice.update` (same file)
- **Customer create:** `customer.create` (`src/server/api/routers/customer.ts`)
- **File storage:** `storage.createUploadUrl` → S3 presigned PUT (`src/lib/upload-file.ts`)

The page is gated behind `<SendAccessGuard>` — only companies with SEND access
(TRIAL / PAID) can upload; LOCKED / EXPIRED companies see an upsell.

---

## 1. The big picture

```
 Drop N files
     │
     ▼  (one row added per file, status = "extracting")
 ┌─────────────────────────────────────────────────────────────┐
 │  For EACH file, independently and in parallel:               │
 │                                                              │
 │   1. POST /api/extract-invoice  ── Claude reads the doc ──►  │   AI extraction
 │   2. Upload raw file to S3 (presigned PUT) → fileKey         │
 │   3. Match extracted customer name against existing customers│   customer match
 │   4. If no match → queue a "Save this customer?" prompt      │
 │   5. Auto-save row as a DRAFT via upsertFromUpload           │   draft persist
 │      → status becomes "Draft Saved" / "Duplicate" / "Updated"│
 └─────────────────────────────────────────────────────────────┘
     │
     ▼  (user reviews the table, fixes fields, assigns customers)
 Select rows → "Save Drafts"  or  "Send to Customer"
```

Every file is processed **independently** — extraction, S3 upload, and the
draft save all run per-row, so one slow or failed file never blocks the others.

---

## 2. Staging files (multi-upload)

`addFiles()` accepts a `FileList` (drag-drop or file picker) and, for each file:

- Validates type (`jpeg / png / webp / pdf`) and size (≤ 20 MB).
- Skips exact duplicates already staged (same `fileName` + `fileSize`).
- Creates a local `UploadedInvoice` row with a client-side `id`, `status:
  "extracting"`, and empty fields.
- Immediately fires `processFile(id, file)` in the background — **no "extract"
  button**; extraction starts the moment a file lands.

All rows live in React state (`invoices`), so the user can keep dropping more
files while earlier ones are still extracting.

### The row shape (`UploadedInvoice`)
Key fields that drive the flow:

| Field | Meaning |
| ----- | ------- |
| `id` | client-side row id (not the DB id) |
| `dbId` | set **after** the draft auto-saves — presence means "row exists in DB" |
| `status` | `extracting` → `ready` → `saving` → `saved` / `sent` / `error` |
| `uploadResult` | `created` / `duplicate` / `updated` — what the auto-save did |
| `customerId` | the assigned customer (empty until matched/assigned) |
| `customerName` | the **AI-extracted** bill-to name (used for matching + the create prompt) |
| `fileKey` | the S3 object key returned by the presigned upload |

---

## 3. AI data extraction — `processFile()` + `/api/extract-invoice`

1. The file is POSTed as `multipart/form-data` to `/api/extract-invoice`.
2. The route (Clerk-authenticated) base64-encodes the file and sends it to
   **Claude** (`@anthropic-ai/sdk`, model from `ANTHROPIC_MODEL`) as either a
   `document` block (PDF) or an `image` block (JPG/PNG/WebP).
3. The prompt asks Claude to return **JSON only** with a fixed schema:
   `invoiceNumber, customerName, customerEmail, reference, invoicedDate,
   dueDate, paymentTerms, currency, subtotal, taxRate, taxAmount, totalAmount,
   items[], notes`. Missing fields come back as `null`.
4. The route strips any ``` ```json ``` fences and `JSON.parse`s the response,
   returning `{ data }`.

Back in `processFile`, after extraction succeeds:
- The raw file is uploaded to S3 via `uploadViaPresignedPut()` →
  `createUploadUrl` mutation; the returned **object key** becomes `fileKey`
  (later stored as the invoice's `fileUrl`).
- Totals are recomputed defensively: `subtotal` from line items, `taxAmount`
  from `taxRate`, `totalAmount` as the sum — using AI values when present.
- Sensible fallbacks fill blanks (`DRAFT-<id>` invoice number, today's date,
  Net 30, SGD, 9% tax).
- The row is patched to `status: "ready"` with all extracted values.

If extraction or upload throws, the row flips to `status: "error"` with the
message, and the rest of the batch carries on.

### Missing-number detection
After extraction, `findMissingInvoiceNumbers()` looks at all `ready` rows,
groups invoice numbers by their text prefix, and flags **gaps in the running
sequence** (e.g. you uploaded `INV-001` and `INV-003` but not `INV-002`). Only
small gaps (≤ 20) are flagged to avoid false positives on month/year rollovers.
A banner lists the suspected missing numbers so the user can check.

---

## 4. Customer handling — match, then create-if-missing

This is the core of "if there is no customer, we ask them to create it."

### 4a. Auto-match against existing customers
During `processFile`, the extracted `customerName` / `customerEmail` is matched
against the company's existing customers using `normaliseCompany()` — which
strips legal suffixes (`Pte Ltd`, `Sdn Bhd`, `Inc`, …) and punctuation so
`"PT. ASIANFAST MARINE"` ≈ `"Asianfast Marine Industries Pte Ltd"`. A match wins
on either:
- exact email match, or
- fuzzy company/contact-name containment (either direction).

On a hit, `matchedCustomerId` is set and the row is pre-assigned.

### 4b. No match → queue a "Save this customer?" prompt
If the AI read a customer name but **nothing matched**, the name is pushed onto
`newCustomerQueue`. This drives a dialog that walks the queue one customer at a
time:

- **Deduped** across the batch by normalised name — if five invoices are all for
  the same new customer, you're asked **once**.
- A name is skipped if it's already in `handledCustomerKeys` (you created or
  dismissed it earlier this session).
- The dialog (`handleConfirmNewCustomer`) prefills the company/email the AI read.
  Saving calls `customer.create`, which **requires a company name and at least
  one of email/phone** (so an off-platform customer is always reachable).
- On save, the new customer is **auto-assigned to every unassigned row** whose
  extracted name matches — and (see §6) flushed to those rows' saved drafts.
- **Skip** just dismisses it; the row stays customer-less and can be assigned
  manually later.

### 4c. Other ways to assign a customer
- **Inline picker** in each row's Customer cell (`CustomerPicker`) — search,
  select, or "Add Customer".
- **Add Customer dialog** (`handleCreateCustomer`) — manual create, auto-assigns
  to the triggering row (or all selected rows in bulk mode).
- **Bulk assign** — select rows, pick one customer for all of them.

All assignment paths route through `assignCustomer()` / `bulkAssignCustomer()`,
which update local state **and** persist to the saved draft (§6).

---

## 5. Auto-save as DRAFT — `upsertFromUpload`

As soon as a row is `ready`, `processFile` auto-saves it by calling
`invoice.upsertFromUpload` — **no button press needed**. This is an *upsert*
keyed on `(invoiceNumber, senderCompanyId)`:

### If no invoice with that number exists → **create**
A new `Invoice` is created with `routingStatus: PENDING`, the line items, the S3
`fileUrl`, and `customerId` (if matched). The row gets `dbId` and
`uploadResult: "created"`, and the badge shows **Draft Saved** (green).

### If an invoice with that number already exists → compare
`upsertFromUpload` does a **field-by-field comparison** between the existing row
and the upload, with tolerance for AI re-extraction noise:
- numbers compared with a `< 0.01` epsilon;
- free-text (`reference`, `notes`) normalised to alphanumerics with an 85%
  length-similarity threshold so cosmetic rewordings don't count as changes;
- customer compared by id, falling back to fuzzy name match against the existing
  customer when the upload didn't supply an id.

Then:
- **All fields equal → `duplicate`.** Nothing is written. Badge shows
  **Duplicate** (amber), and a toast says it already exists. The row becomes
  read-only and is excluded from bulk actions.
- **Something differs → `updated`.** The existing invoice's data fields are
  overwritten (items replaced, totals recalculated), **but `routingStatus` and
  receiver are preserved**, and fields the AI couldn't re-extract
  (`customerId`, `reference`, `notes`) are kept when the upload omits them. A
  timeline entry "Invoice overridden via re-upload" is added. Badge shows
  **Updated** (purple) and the toast lists exactly which fields changed.

So a re-upload of the same file is a safe no-op, and a corrected re-upload
updates in place instead of creating a duplicate.

### Status badges summary

| Badge | Meaning |
| ----- | ------- |
| **Extracting** (blue, spinner) | AI is reading the document |
| **Saving…** (amber, spinner) | `ready` but the draft auto-save is still in flight (`dbId` not yet set) |
| **Draft Saved** (green) | `created` — new draft persisted |
| **Duplicate** (amber) | identical invoice already existed; nothing written |
| **Updated** (purple) | existing invoice overwritten with the new data |
| **Saving / Saved / Sent** | states during an explicit bulk Save/Send |
| **Error** (red) | extraction, upload, or save failed (message on the row) |

---

## 6. Persisting edits after the draft is saved

The **first** save is automatic, but the row already lives in the DB after that.
Later edits — most importantly the **customer assignment** — must be flushed to
that draft, otherwise they'd only live in local React state and be lost if the
user navigated away.

- `flushCustomerAssignment(rows, customerId)` calls `invoice.update` for any row
  that already has a `dbId`, writing the new `customerId` immediately.
- `assignCustomer` / `bulkAssignCustomer` wrap local-state update + flush, and
  every assignment path (inline picker, confirm-prompt, Add Customer dialog,
  bulk) goes through them.
- A **race guard** in `processFile` handles assigning a customer *while the
  draft is still saving*: if the upsert returned with no customer but the local
  row has since gained one, it flushes that assignment as soon as the `dbId`
  arrives.

Other field edits (number, dates, amount, reference, line items) are flushed
when the user clicks **Save Drafts** / **Send** via `persistEdits()`.

---

## 7. Saving / sending the batch

The action bar appears when rows are selected:

- **Save Drafts** (`handleBulkSave`) — for each selected `ready` row, calls
  `persistEdits()`. If the row already has a `dbId` it `invoice.update`s it;
  otherwise it falls back to `invoice.create`. Row → **Saved**.
- **Send to Customer** (`handleBulkSend`) — same persist step, then
  `invoice.send`. **Requires a customer** on each row (else a toast blocks it).
  Row → **Sent**.
- **Remove** (`handleBulkRemove`) — drops the rows and deletes any auto-saved
  drafts from the DB so abandoned drafts don't linger.

Because each auto-saved draft is a real DB row, an in-flight save survives the
user navigating away — a `beforeunload` warning fires while
`inFlightSaves` is non-empty so the tab isn't hard-closed mid-request.

---

## 8. Statement-of-account import (related entry point)

`/invoices/import-statement` can redirect here with an extracted **statement**
(many invoices for one customer) stashed in `sessionStorage`.
`hydrateFromStatement()` reads it once on mount, matches-or-creates the single
shared customer, stages one `ready` row per invoice (skipping re-extraction),
and auto-saves them all in parallel via the same `upsertFromUpload` path.

---

## 9. Failure modes & guarantees

- **Extraction fails** → row `error`; batch continues.
- **S3 upload fails** → row `error`; no draft saved.
- **Duplicate number** → no write, marked `duplicate`.
- **Customer create requires** company + (email or phone) — enforced server-side.
- **Customer assignment** is persisted immediately to any saved draft (§6).
- **Navigating away mid-save** → in-flight requests still complete; a
  `beforeunload` prompt guards accidental tab closes.
- Every DB write is tenant-scoped by `senderCompanyId = ctx.user.companyId`.
