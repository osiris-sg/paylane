"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  FileSpreadsheet,
  FileImage,
  FileText,
  AlertTriangle,
  Trash2,
  ArrowLeft,
  Loader2,
  Copy,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { api } from "~/trpc/react";

interface DraftContact {
  id: string;
  company: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

const newId = () => Math.random().toString(36).slice(2, 11);

const REQUIRED_FIELDS: Array<keyof Omit<DraftContact, "id">> = ["company"];
const RECOMMENDED_FIELDS: Array<keyof Omit<DraftContact, "id">> = [
  "name",
  "email",
  "phone",
  "address",
];

interface Props {
  kind: "customers" | "suppliers";
}

const draftStorageKey = (kind: "customers" | "suppliers") =>
  `paylane:import-drafts:${kind}`;

export function ImportContacts({ kind }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<DraftContact[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore any saved drafts from a previous visit
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey(kind));
      if (raw) {
        const parsed = JSON.parse(raw) as DraftContact[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDrafts(parsed);
          toast.info(
            `Resumed ${parsed.length} draft${parsed.length === 1 ? "" : "s"} from your last session`,
          );
        }
      }
    } catch {
      // ignore corrupted draft state
    }
    setHydrated(true);
  }, [kind]);

  // Auto-persist drafts so they survive a page reload / browser restart
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (drafts.length === 0) {
        localStorage.removeItem(draftStorageKey(kind));
      } else {
        localStorage.setItem(draftStorageKey(kind), JSON.stringify(drafts));
      }
    } catch {
      // quota errors etc. — silent
    }
  }, [drafts, hydrated, kind]);

  const handleImported = (count: number, importedIds: Set<string>) => {
    toast.success(
      `Imported ${count} ${kind === "customers" ? "customer" : "supplier"}${count === 1 ? "" : "s"}`,
    );
    setDrafts((prev) => prev.filter((d) => !importedIds.has(d.id)));
    setSelectedIds(new Set());
    if (drafts.length === importedIds.size) {
      // Nothing left → bounce to the listing page
      router.push(`/${kind}`);
    }
  };

  const customerBulk = api.customer.bulkCreate.useMutation({
    onError: (e) => toast.error(e.message || "Import failed"),
  });

  const supplierBulk = api.supplier.bulkCreate.useMutation({
    onError: (e) => toast.error(e.message || "Import failed"),
  });

  const isSubmitting = customerBulk.isPending || supplierBulk.isPending;

  const handleFile = async (file: File) => {
    setExtracting(true);
    setFilename(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/extract-contacts", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed");
      }
      const { contacts } = (await res.json()) as {
        contacts: Array<Partial<DraftContact>>;
      };
      const next = (contacts ?? []).map((c) => ({
        id: newId(),
        company: c.company || "",
        name: c.name || "",
        email: c.email || "",
        phone: c.phone || "",
        address: c.address || "",
      }));
      if (next.length === 0) {
        toast.error("No contacts found in this file");
      } else {
        toast.success(`Extracted ${next.length} contact${next.length === 1 ? "" : "s"}`);
      }
      setDrafts((prev) => [...prev, ...next]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const updateDraft = (id: string, patch: Partial<DraftContact>) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const normaliseCompany = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  const duplicateKeys = (() => {
    const counts = new Map<string, number>();
    for (const d of drafts) {
      const key = normaliseCompany(d.company);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  })();

  const isDuplicate = (d: DraftContact) => {
    const key = normaliseCompany(d.company);
    return key !== "" && duplicateKeys.has(key);
  };

  const duplicateRowCount = drafts.filter(isDuplicate).length;

  const submit = () => {
    const targetIds = selectedIds.size > 0
      ? selectedIds
      : new Set(drafts.filter((d) => d.company.trim()).map((d) => d.id));

    const targets = drafts.filter((d) => targetIds.has(d.id) && d.company.trim());
    if (targets.length === 0) {
      toast.error("Select at least one row with a company name");
      return;
    }

    // Block if any targeted row collides with another (selected or not)
    const blockingDup = targets.find((d) => duplicateKeys.has(normaliseCompany(d.company)));
    if (blockingDup) {
      toast.error("Resolve duplicate companies before importing");
      return;
    }

    const payload = targets.map((d) => ({
      company: d.company.trim(),
      name: d.name.trim() || undefined,
      email: d.email.trim() || undefined,
      phone: d.phone.trim() || undefined,
      address: d.address.trim() || undefined,
    }));
    const importedIds = new Set(targets.map((d) => d.id));

    if (kind === "customers") {
      customerBulk.mutate(
        { customers: payload },
        { onSuccess: ({ count }) => handleImported(count, importedIds) },
      );
    } else {
      supplierBulk.mutate(
        { suppliers: payload },
        { onSuccess: ({ count }) => handleImported(count, importedIds) },
      );
    }
  };

  const missingCount = (d: DraftContact) =>
    RECOMMENDED_FIELDS.filter((f) => !d[f].trim()).length +
    REQUIRED_FIELDS.filter((f) => !d[f].trim()).length;

  const importableIds = drafts
    .filter((d) => d.company.trim() && !duplicateKeys.has(normaliseCompany(d.company)))
    .map((d) => d.id);

  const allImportableSelected =
    importableIds.length > 0 && importableIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () => {
    if (allImportableSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(importableIds));
  };

  const submitCount = selectedIds.size > 0
    ? drafts.filter((d) => selectedIds.has(d.id) && d.company.trim()).length
    : drafts.filter((d) => d.company.trim()).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/${kind}`)}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Import {kind === "customers" ? "Customers" : "Suppliers"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload an Excel sheet, PDF, or photo. AI will extract the contact list for review.
          </p>
        </div>
      </div>

      <Card>
        <CardContent
          className="flex flex-col items-center gap-3 p-8 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-4 text-muted-foreground">
            <FileSpreadsheet className="h-8 w-8" />
            <FileText className="h-8 w-8" />
            <FileImage className="h-8 w-8" />
          </div>
          <p className="text-sm text-muted-foreground">
            Drop a file here, or
          </p>
          <Button
            variant="outline"
            disabled={extracting}
            onClick={() => fileInputRef.current?.click()}
          >
            {extracting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Choose file
              </>
            )}
          </Button>
          {filename && (
            <p className="text-xs text-muted-foreground">Last upload: {filename}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Supported: .xlsx, .xls, .csv, .pdf, .png, .jpg
          </p>
        </CardContent>
      </Card>

      {drafts.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={allImportableSelected}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all importable rows"
                disabled={importableIds.length === 0}
              />
              <p className="text-sm font-medium">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `${drafts.length} contact${drafts.length === 1 ? "" : "s"} to review`}
                <span className="ml-2 text-xs text-muted-foreground">
                  · {drafts.filter((d) => missingCount(d) > 0).length} need attention
                  {duplicateRowCount > 0 && (
                    <span className="ml-1 text-red-600">
                      · {duplicateRowCount} duplicate{duplicateRowCount === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDrafts((prev) => [
                    ...prev,
                    {
                      id: newId(),
                      company: "",
                      name: "",
                      email: "",
                      phone: "",
                      address: "",
                    },
                  ])
                }
              >
                Add row
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrafts([])}
                className="text-destructive hover:text-destructive"
              >
                Clear all
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {drafts.map((d) => {
              const missing = RECOMMENDED_FIELDS.filter((f) => !d[f].trim());
              const companyMissing = !d.company.trim();
              const dup = isDuplicate(d);
              return (
                <Card
                  key={d.id}
                  className={
                    dup
                      ? "border-red-400 bg-red-50/40 ring-1 ring-red-200 dark:border-red-800 dark:bg-red-950/30"
                      : companyMissing
                        ? "border-red-300 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20"
                        : missing.length > 0
                          ? "border-amber-300 bg-amber-50/30 dark:border-amber-900 dark:bg-amber-950/20"
                          : ""
                  }
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-7"
                        checked={selectedIds.has(d.id)}
                        onCheckedChange={() => toggleSelect(d.id)}
                        disabled={dup || companyMissing}
                        aria-label={`Select ${d.company || "row"}`}
                      />
                      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <FieldInput
                        label="Company *"
                        value={d.company}
                        onChange={(v) => updateDraft(d.id, { company: v })}
                        invalid={companyMissing}
                      />
                      <FieldInput
                        label="Contact Name"
                        value={d.name}
                        onChange={(v) => updateDraft(d.id, { name: v })}
                        warn={!d.name.trim()}
                      />
                      <FieldInput
                        label="Email"
                        value={d.email}
                        onChange={(v) => updateDraft(d.id, { email: v })}
                        warn={!d.email.trim()}
                        type="email"
                      />
                      <FieldInput
                        label="Phone"
                        value={d.phone}
                        onChange={(v) => updateDraft(d.id, { phone: v })}
                        warn={!d.phone.trim()}
                      />
                      <FieldInput
                        label="Address"
                        value={d.address}
                        onChange={(v) => updateDraft(d.id, { address: v })}
                        warn={!d.address.trim()}
                      />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex flex-wrap gap-1.5">
                        {dup && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-400 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            <Copy className="h-3 w-3" />
                            Duplicate company — remove one
                          </span>
                        )}
                        {companyMissing && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            Company required
                          </span>
                        )}
                        {missing.map((f) => (
                          <span
                            key={f}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                          >
                            Missing {f}
                          </span>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDraft(d.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="sticky bottom-0 flex items-center justify-between rounded-md border bg-background p-3 shadow-md">
            <div className="flex flex-col">
              <p className="text-sm text-muted-foreground">
                {selectedIds.size > 0
                  ? `Importing ${submitCount} selected · ${drafts.length - selectedIds.size} stay as draft`
                  : duplicateKeys.size > 0
                    ? `Resolve ${duplicateRowCount} duplicate${duplicateRowCount === 1 ? "" : "s"} first`
                    : `${submitCount} ready to import`}
              </p>
              <p className="text-xs text-muted-foreground/70">
                Drafts auto-save in your browser — close the tab and pick up later.
              </p>
            </div>
            <Button
              onClick={submit}
              disabled={isSubmitting || submitCount === 0}
            >
              {isSubmitting
                ? "Importing..."
                : selectedIds.size > 0
                  ? `Import ${submitCount} selected`
                  : `Import all ${submitCount}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  invalid,
  warn,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  warn?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        className={
          invalid
            ? "border-red-400 focus-visible:ring-red-300"
            : warn
              ? "border-amber-300"
              : ""
        }
      />
    </label>
  );
}
