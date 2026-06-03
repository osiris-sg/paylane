"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileText, Loader2, Send, Save, UserPlus } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { SendAccessGuard } from "~/components/subscription/send-access-guard";
import { uploadViaPresignedPut } from "~/lib/upload-file";

// "PT. ASIANFAST MARINE" ≈ "Asianfast Marine Pte Ltd"
function normalise(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\b(pt\.?|pte\.?|ltd\.?|limited|corp\.?|corporation|inc\.?|llc|co\.?|company|gmbh|sdn|bhd|private)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function UploadInner() {
  const router = useRouter();
  const utils = api.useUtils();

  const { data: customersData, refetch: refetchCustomers } = api.customer.list.useQuery({ limit: 100 });
  const customers = customersData?.customers ?? [];

  const createUploadUrl = api.storage.createUploadUrl.useMutation();
  const createCustomer = api.customer.create.useMutation();
  const createDO = api.deliveryOrder.createFromUpload.useMutation();
  const sendDO = api.deliveryOrder.send.useMutation();

  const [status, setStatus] = useState<"idle" | "extracting" | "ready" | "saving">("idle");
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [fileType, setFileType] = useState("");
  const [doNumber, setDoNumber] = useState("");
  const [reference, setReference] = useState("");
  const [doDate, setDoDate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Add-customer dialog
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ company: "", name: "", email: "", phone: "", address: "" });

  const handleFile = async (file: File) => {
    const valid = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!valid.includes(file.type)) { toast.error("Unsupported format (PDF/JPG/PNG/WebP)"); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error("File too large (max 20MB)"); return; }

    setStatus("extracting");
    setFileName(file.name);
    setFileType(file.type);
    try {
      // Extract DO number + customer with AI, and upload the file to S3 in parallel.
      const [extractRes, key] = await Promise.all([
        (async () => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/extract-do", { method: "POST", body: fd });
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Extraction failed");
          return (await res.json()).data as {
            doNumber?: string;
            reference?: string;
            doDate?: string;
            customer?: { company?: string; name?: string; email?: string; phone?: string };
          };
        })(),
        uploadViaPresignedPut(file, "delivery-orders", (input) => createUploadUrl.mutateAsync(input)),
      ]);

      setFileKey(key);
      setDoNumber(extractRes.doNumber ?? "");
      setReference(extractRes.reference ?? "");
      setDoDate(extractRes.doDate ?? "");

      // Try to match the extracted customer to an existing one.
      const needle = normalise(extractRes.customer?.company ?? "");
      const email = extractRes.customer?.email?.toLowerCase();
      const match = customers.find((c) => {
        if (email && c.email?.toLowerCase() === email) return true;
        if (!needle) return false;
        const company = normalise(c.company ?? "");
        const name = normalise(c.name);
        return (
          (company && (company === needle || company.includes(needle) || needle.includes(company))) ||
          (name && (name === needle || name.includes(needle) || needle.includes(name)))
        );
      });
      if (match) {
        setCustomerId(match.id);
      } else if (extractRes.customer?.company) {
        // Prefill the add-customer dialog with the AI's reading.
        setForm({
          company: extractRes.customer.company,
          name: extractRes.customer.name ?? "",
          email: extractRes.customer.email ?? "",
          phone: extractRes.customer.phone ?? "",
          address: "",
        });
        setAddOpen(true);
      }
      setStatus("ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to process file");
      setStatus("idle");
      setFileName("");
    }
  };

  const handleCreateCustomer = async () => {
    if (!form.company.trim()) { toast.error("Company name is required"); return; }
    if (!form.email.trim() && !form.phone.trim()) {
      toast.error("Add an email or phone so the customer can be reached");
      return;
    }
    try {
      const created = await createCustomer.mutateAsync({
        company: form.company.trim(),
        name: form.name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
      });
      await refetchCustomers();
      setCustomerId(created.id);
      setAddOpen(false);
      toast.success("Customer added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add customer");
    }
  };

  const save = async (thenSend: boolean) => {
    if (!doNumber.trim()) { toast.error("DO number is required"); return; }
    if (!fileKey) { toast.error("File still uploading — try again"); return; }
    if (thenSend && !customerId) { toast.error("Assign a customer to send"); return; }
    setStatus("saving");
    try {
      const created = await createDO.mutateAsync({
        doNumber: doNumber.trim(),
        reference: reference.trim() || undefined,
        doDate: doDate ? new Date(doDate) : undefined,
        customerId: customerId || undefined,
        fileUrl: fileKey,
        fileName,
        fileType,
      });
      if (thenSend) {
        await sendDO.mutateAsync({ id: created.id });
        toast.success("Delivery order sent");
      } else {
        toast.success("Delivery order saved as draft");
      }
      void utils.deliveryOrder.listSent.invalidate();
      router.push("/delivery-orders");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setStatus("ready");
    }
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-1">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/delivery-orders")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">Upload Delivery Order</h1>
      </div>

      {status === "idle" ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
            dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-white hover:border-gray-400"
          }`}
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <Upload className="h-8 w-8 text-gray-400" />
          </div>
          <p className="text-lg font-medium">Drop your delivery order here</p>
          <p className="mt-1 text-sm text-muted-foreground">PDF, JPG, PNG or WebP (max 20MB)</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) void handleFile(e.target.files[0]); e.target.value = ""; }}
          />
        </label>
      ) : (
        <div className="space-y-4 rounded-xl border bg-white p-5">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-blue-600" />
            <span className="truncate font-medium">{fileName}</span>
            {status === "extracting" && <Loader2 className="ml-auto h-4 w-4 animate-spin text-blue-600" />}
          </div>

          {status === "extracting" ? (
            <p className="text-sm text-muted-foreground">Reading the delivery order…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="do-number">DO Number <span className="text-red-600">*</span></Label>
                  <Input id="do-number" value={doNumber} onChange={(e) => setDoNumber(e.target.value)} placeholder="DO-12345" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="do-reference">Reference</Label>
                  <Input id="do-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / ref" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="do-date">Date</Label>
                  <Input id="do-date" type="date" value={doDate} onChange={(e) => setDoDate(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Customer</Label>
                <div className="flex gap-2">
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.company || c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => { setForm({ company: "", name: "", email: "", phone: "", address: "" }); setAddOpen(true); }}>
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    New
                  </Button>
                </div>
                {!selectedCustomer && (
                  <p className="text-xs text-amber-700">Assign a customer to send this delivery order.</p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" disabled={status === "saving"} onClick={() => save(false)}>
                  <Save className="mr-1.5 h-4 w-4" />
                  Save draft
                </Button>
                <Button className="flex-1" disabled={status === "saving" || !customerId} onClick={() => save(true)}>
                  <Send className="mr-1.5 h-4 w-4" />
                  {status === "saving" ? "Sending…" : "Save & send"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a new customer</DialogTitle>
            <DialogDescription>Saved to your account and assigned to this delivery order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-company">Company <span className="text-red-600">*</span></Label>
              <Input id="c-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Pte Ltd" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-name">Contact Name</Label>
              <Input id="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Doe" />
            </div>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Add an <strong>email or phone</strong> — at least one is required so we can reach this customer (e.g. via WhatsApp) when they&apos;re not on E-StatementNow.
            </p>
            <div className="grid gap-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@acme.com" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-phone">Phone</Label>
              <Input id="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+65 1234 5678" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateCustomer}
              disabled={createCustomer.isPending || !form.company.trim() || (!form.email.trim() && !form.phone.trim())}
            >
              {createCustomer.isPending ? "Saving…" : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DeliveryOrderUploadPage() {
  return (
    <SendAccessGuard
      title="Upload Delivery Order"
      lockedTitle="Uploading is locked"
      lockedBody="Start your free 14-day trial to upload and send delivery orders."
      expiredMessage="Your free trial has ended. Upgrade to upload delivery orders again."
    >
      <UploadInner />
    </SendAccessGuard>
  );
}
