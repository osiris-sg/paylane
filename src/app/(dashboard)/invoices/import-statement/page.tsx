"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { Button } from "~/components/ui/button";
import { SendAccessGuard } from "~/components/subscription/send-access-guard";

interface StatementInvoice {
  invoiceNumber: string;
  invoicedDate: string;
  xReference?: string | null;
  amount: number;
  description?: string | null;
}

interface StatementExtraction {
  customer: {
    company: string;
    name?: string | null;
    email?: string | null;
    accountCode?: string | null;
  };
  currency: string;
  periodEnding?: string | null;
  invoices: StatementInvoice[];
}

export interface PendingStatementPayload {
  extraction: StatementExtraction;
  fileDataUrl: string;
  fileName: string;
}

const STORAGE_KEY = "paylane:pending-statement";

export default function ImportStatementPage() {
  return (
    <SendAccessGuard
      title="Import Statement"
      lockedTitle="Importing statements is locked"
      lockedBody="Start your free 14-day trial to extract invoices from a bank statement."
      expiredMessage="Your free trial has ended. Upgrade to import statements again."
    >
      <ImportStatementPageInner />
    </SendAccessGuard>
  );
}

function ImportStatementPageInner() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!validTypes.includes(file.type)) {
        toast.error("Unsupported format. Use JPG, PNG, WebP or PDF.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error("File too large (max 20MB)");
        return;
      }

      setFileName(file.name);
      setExtracting(true);

      try {
        const fileDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/extract-statement", { method: "POST", body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Extraction failed");
        }
        const { data } = (await res.json()) as { data: StatementExtraction };

        if (!data.invoices || data.invoices.length === 0) {
          toast.error("No invoices found in this statement");
          setExtracting(false);
          return;
        }

        const payload: PendingStatementPayload = {
          extraction: data,
          fileDataUrl,
          fileName: file.name,
        };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

        toast.success(`Extracted ${data.invoices.length} invoice${data.invoices.length === 1 ? "" : "s"}`);
        router.push("/invoices/upload");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Extraction failed";
        console.error("Statement extraction failed:", err);
        toast.error(msg);
        setExtracting(false);
      }
    },
    [router],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/invoices")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-semibold">Import Statement of Accounts</span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-gray-50 p-6">
        <div className="mx-auto max-w-xl">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
              dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white hover:border-gray-400"
            }`}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              {extracting ? (
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              ) : (
                <FileSpreadsheet className="h-8 w-8 text-gray-400" />
              )}
            </div>
            <p className="text-lg font-medium">
              {extracting ? `Extracting invoices from ${fileName}…` : "Drop your statement of accounts here"}
            </p>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Upload a statement PDF (or image) and we&apos;ll pull every invoice into the same staging table as a regular
              upload — so you can review, assign a customer, and save them as drafts.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">JPG, PNG, WebP, or PDF (max 20MB)</p>
            {!extracting && (
              <label className="mt-4 cursor-pointer">
                <Button variant="outline" asChild>
                  <span>
                    <Upload className="mr-2 h-4 w-4" />
                    Select Statement
                  </span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void processFile(f);
                    e.target.value = "";
                  }}
                  className="hidden"
                />
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
