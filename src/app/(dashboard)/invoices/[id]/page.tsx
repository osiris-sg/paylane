"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Send,
  CheckCircle,
  CreditCard,
  AlertTriangle,
  Clock,
  FileText,
  Download,
  Calendar,
  DollarSign,
  Hash,
  Trash2,
  CalendarClock,
  Pencil,
} from "lucide-react";
// NOTE: AlertTriangle is still used by the timeline icon logic and the shared
// confirmation dialog; Clock is still used by the empty-timeline placeholder.
// Both are intentionally retained.

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { useSendAccess } from "~/lib/use-send-access";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { OpenInAppBanner } from "~/components/open-in-app-banner";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import { formatCurrency } from "~/lib/currency";
// PDF/image viewer, wrapped in an error boundary so a pdf.js failure can never
// crash the page (it falls back to an "open in new tab" link).
import { DocumentViewer } from "~/components/document-viewer";

function InvoiceStatusBadge({ sentAt }: { sentAt: Date | string | null }) {
  const sent = !!sentAt;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${
        sent
          ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      }`}
    >
      {sent ? "Sent" : "Draft"}
    </span>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-medium">{value || "-"}</p>
      </div>
    </div>
  );
}

interface TimelineEvent {
  id: string;
  message: string;
  createdAt: string | Date;
  invoiceId: string;
}

function TimelineItem({ event }: { event: TimelineEvent }) {
  // Determine icon based on message content
  const msg = event.message.toLowerCase();
  let Icon = FileText;
  let color = "text-muted-foreground";
  if (msg.includes("created")) { Icon = FileText; color = "text-blue-500"; }
  else if (msg.includes("sent")) { Icon = Send; color = "text-blue-500"; }
  else if (msg.includes("acknowledged")) { Icon = CheckCircle; color = "text-green-500"; }
  else if (msg.includes("paid")) { Icon = CreditCard; color = "text-green-500"; }
  else if (msg.includes("overdue")) { Icon = AlertTriangle; color = "text-red-500"; }

  return (
    <div className="relative flex gap-3 pb-6 last:pb-0">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-border last:hidden" />

      {/* Icon dot */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background ${color}`}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium">{event.message}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{dayjs(event.createdAt).format("MMM D, YYYY [at] h:mm A")}</span>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = api.useUtils();

  const {
    data: invoice,
    isLoading,
    isFetching,
    error: invoiceError,
  } = api.invoice.getById.useQuery(
    { id: params.id },
    {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
  );
  const { data: featureFlags } = api.featureFlag.getAll.useQuery();

  const sendInvoice = api.invoice.send.useMutation({
    onSuccess: () => {
      toast.success("Invoice sent successfully");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to send invoice");
    },
  });

  const deleteInvoice = api.invoice.delete.useMutation({
    onSuccess: () => {
      toast.success("Invoice deleted");
      router.push("/invoices");
    },
    onError: () => {
      toast.error("Failed to delete invoice");
    },
  });

  const schedulePayment = api.invoice.schedulePayment.useMutation({
    onSuccess: () => {
      toast.success("Payment date scheduled");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to schedule payment");
    },
  });

  const updateInvoiceMut = api.invoice.update.useMutation({
    onSuccess: () => {
      toast.success("Invoice updated");
      void utils.invoice.getById.invalidate({ id: params.id });
      void utils.invoice.list.invalidate();
      setEditOpen(false);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update invoice");
    },
  });

  const { data: onboardingStatus } = api.onboarding.getStatus.useQuery();
  const myCompanyId = onboardingStatus?.companyId;

  // Bearer-link claim: a customer who arrived via a shared invoice link (e.g.
  // the WhatsApp invite) and just signed up lands here on an invoice that has
  // no receiver yet. Link it to their company so it shows up under their
  // received invoices. The server no-ops for the sender / already-linked rows.
  const claimUnlinked = api.invoice.claimUnlinked.useMutation({
    onSuccess: (res) => {
      if (res.status === "linked") {
        toast.success("Invoice added to your received invoices");
        void utils.invoice.getById.invalidate({ id: params.id });
        void utils.invoice.list.invalidate();
        void utils.invoice.getTabCounts.invalidate();
      }
    },
  });

  useEffect(() => {
    if (!invoice || !myCompanyId) return;
    if (invoice.receiverCompanyId) return; // already linked to someone
    if (invoice.senderCompanyId === myCompanyId) return; // sender's own invoice
    if (claimUnlinked.isPending || claimUnlinked.isSuccess) return;
    claimUnlinked.mutate({ invoiceId: invoice.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.receiverCompanyId, invoice?.senderCompanyId, myCompanyId]);

  const markViewed = api.invoice.markViewed.useMutation({
    onSuccess: () => {
      void utils.invoice.getById.invalidate({ id: params.id });
      void utils.invoice.getTabCounts.invalidate();
      void utils.invoice.list.invalidate();
    },
    onError: (err) => {
      console.error("markViewed failed", err);
    },
  });

  // First-time receiver visit → mark as viewed so the SUPPLIER tab badge
  // ticks down. Only fires when this user's company IS the receiver and
  // the invoice hasn't been viewed yet.
  useEffect(() => {
    if (!invoice || !myCompanyId) return;
    if (invoice.receiverCompanyId !== myCompanyId) return;
    if (invoice.viewedAt) return;
    if (markViewed.isPending || markViewed.isSuccess) return;
    markViewed.mutate({ id: invoice.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.viewedAt, invoice?.receiverCompanyId, myCompanyId]);

  const { data: customersData } = api.customer.list.useQuery({ limit: 100 });
  const customerList = customersData?.customers ?? [];

  const sendAccess = useSendAccess();

  const [scheduleDate, setScheduleDate] = useState("");
  const [showDocument, setShowDocument] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Download the originally-uploaded file. The server returns a presigned URL
  // (Content-Disposition: attachment for S3) or a legacy inline/data URL; we
  // trigger the download via a temporary anchor so it doesn't navigate away.
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { url, filename } = await utils.invoice.getDownloadUrl.fetch({ id: params.id });
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download the file");
    } finally {
      setDownloading(false);
    }
  };
  const [confirmAction, setConfirmAction] = useState<
    | null
    | {
        title: string;
        description: string;
        confirmLabel: string;
        onConfirm: () => void;
        destructive?: boolean;
      }
  >(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    invoiceNumber: "",
    reference: "",
    invoicedDate: "",
    paymentTerms: 30,
    currency: "SGD",
    customerId: "",
    fromAddress: "",
    toAddress: "",
    totalAmount: "",
    notes: "",
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-3 sm:gap-6 sm:p-6">
        <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        <div className="h-12 w-64 animate-pulse rounded bg-muted" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="h-96 animate-pulse rounded-lg bg-muted" />
          </div>
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  // Differentiate "still working" from a definitive miss. A retried-out
  // query (network, auth flap) is shown as a transient error with a
  // retry CTA, not as a hard "not found" — that confused users clicking
  // through from WhatsApp on a fresh in-app browser session.
  if (!invoice) {
    if (isFetching) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading invoice…</p>
        </div>
      );
    }
    if (invoiceError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-12">
          <FileText className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Couldn&apos;t load invoice</h2>
          <p className="text-muted-foreground">
            {invoiceError.message || "Network error. Try refreshing the page."}
          </p>
          <Button onClick={() => window.location.reload()} variant="outline">
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Invoice not found</h2>
        <p className="text-muted-foreground">
          The invoice you are looking for does not exist or has been deleted.
        </p>
        <Button asChild variant="outline">
          <Link href="/invoices">Back to Invoices</Link>
        </Button>
      </div>
    );
  }

  const isReceived = !!invoice.receiverCompany;

  const isSender = !isReceived; // This user's company sent the invoice
  const isReceiver = isReceived; // This user's company received the invoice

  const paymentApprovalEnabled = featureFlags?.paymentApprovalFlow ?? false;
  const sendingLocked = isSender && !sendAccess.canSend;

  const canSend = isSender && !invoice.sentAt && !sendingLocked;
  const canDelete = isSender && !sendingLocked;
  const canEdit = isSender && !invoice.sentAt && !sendingLocked;
  // Receivers can schedule a payment date once the invoice has actually been
  // sent to them (no more invoiceStatus to gate on).
  const canSchedulePayment =
    paymentApprovalEnabled && isReceiver && !!invoice.sentAt;

  const openEdit = () => {
    setEditForm({
      invoiceNumber: invoice.invoiceNumber,
      reference: invoice.reference ?? "",
      invoicedDate: dayjs(invoice.invoicedDate).format("YYYY-MM-DD"),
      paymentTerms: invoice.paymentTerms,
      currency: invoice.currency,
      customerId: invoice.customerId ?? "",
      fromAddress: invoice.fromAddress ?? "",
      toAddress: invoice.toAddress ?? "",
      totalAmount: Number(invoice.amount).toFixed(2),
      notes: invoice.notes ?? "",
    });
    setEditOpen(true);
  };

  const handleEditSave = () => {
    if (!editForm.invoiceNumber.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    const total = parseFloat(editForm.totalAmount) || 0;
    updateInvoiceMut.mutate({
      id: invoice.id,
      invoiceNumber: editForm.invoiceNumber.trim(),
      reference: editForm.reference.trim() || undefined,
      invoicedDate: new Date(editForm.invoicedDate),
      paymentTerms: editForm.paymentTerms,
      currency: editForm.currency,
      customerId: editForm.customerId || undefined,
      fromAddress: editForm.fromAddress.trim() || undefined,
      toAddress: editForm.toAddress.trim() || undefined,
      notes: editForm.notes.trim() || undefined,
      // Preserve existing line items; update total by passing a single synthetic item
      // so the amount recalc reflects the user's edited total.
      items: total > 0 ? [{
        description: invoice.description || "Invoice total",
        quantity: 1,
        unitPrice: total,
        amount: total,
        sortOrder: 0,
      }] : undefined,
      taxRate: 0,
    });
  };

  const askConfirm = (
    title: string,
    description: string,
    confirmLabel: string,
    onConfirm: () => void,
    destructive = false,
  ) => setConfirmAction({ title, description, confirmLabel, onConfirm, destructive });

  const timeline: TimelineEvent[] = (invoice.timelineItems as TimelineEvent[]) ?? [];
  const sortedTimeline = [...timeline].sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()
  );

  const hasActions = canSend || canSchedulePayment || canDelete || canEdit;

  return (
    <div className="flex flex-col gap-4 p-3 pb-24 sm:gap-6 sm:p-6 sm:pb-6">
      <OpenInAppBanner />

      {/* Back Button */}
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Link>
        </Button>
      </div>

      {isSender && sendAccess.state === "expired" && (
        <ExpiredBanner message="Your free trial has ended. Upgrade to edit, send, or delete this invoice." />
      )}
      {isSender && sendAccess.state === "locked" && (
        <LockedSendingCTA
          title="This invoice is locked"
          body="Start your free 14-day trial to send, edit, or delete this invoice."
        />
      )}

      {/* Mobile Summary Card */}
      <div className="sm:hidden">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold">{invoice.invoiceNumber}</p>
                  {isSender && <InvoiceStatusBadge sentAt={invoice.sentAt} />}
                </div>
                <p className="text-sm text-muted-foreground">
                  {isReceived ? `From ${invoice.senderCompany?.name ?? "Unknown"}` : `To ${invoice.customer?.company || invoice.customer?.name || "Unknown"}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{formatCurrency(invoice.amount, invoice.currency)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="font-medium">{dayjs(invoice.invoicedDate).format("MMM D, YYYY")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="font-medium">
                  {dayjs(invoice.dueDate).format("MMM D, YYYY")}
                </p>
              </div>
              {invoice.expectedPaymentDate && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Expected Payment</p>
                  <p className="font-medium text-blue-600">{dayjs(invoice.expectedPaymentDate).format("MMM D, YYYY")}</p>
                </div>
              )}
            </div>
            {invoice.fileUrl && (
              <div className="mt-3 flex flex-col gap-2">
                <Button variant="outline" className="w-full" onClick={() => setShowDocument(true)}>
                  <FileText className="mr-2 h-4 w-4" />
                  View Original Document
                </Button>
                <Button variant="outline" className="w-full" onClick={handleDownload} disabled={downloading}>
                  <Download className="mr-2 h-4 w-4" />
                  {downloading ? "Preparing…" : "Download"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desktop: Header */}
      <div className="hidden flex-col gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{invoice.invoiceNumber}</h1>
            {isSender && <InvoiceStatusBadge sentAt={invoice.sentAt} />}
          </div>
          <p className="text-muted-foreground">
            {isReceived ? `From ${invoice.senderCompany?.name ?? "Unknown"}` : `To ${invoice.customer?.company || invoice.customer?.name || "Unknown"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button variant="outline" onClick={openEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          {canSend && (
            <Button
              onClick={() => {
                if (!invoice.customerId) {
                  toast.error("Assign a customer before sending — click Edit to add one.");
                  return;
                }
                askConfirm(
                  "Send invoice?",
                  `This will mark ${invoice.invoiceNumber} as sent and notify the recipient.`,
                  "Send Invoice",
                  () => sendInvoice.mutate({ id: invoice.id }),
                );
              }}
              disabled={sendInvoice.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sendInvoice.isPending ? "Sending..." : "Send Invoice"}
            </Button>
          )}
          {canSchedulePayment && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Schedule Payment
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4" align="end">
                <div className="space-y-3">
                  <p className="text-sm font-medium">When will payment be made?</p>
                  <Input
                    type="date"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    min={dayjs().format("YYYY-MM-DD")}
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!scheduleDate || schedulePayment.isPending}
                    onClick={() => {
                      schedulePayment.mutate({
                        id: invoice.id,
                        expectedPaymentDate: new Date(scheduleDate),
                      });
                    }}
                  >
                    {schedulePayment.isPending ? "Scheduling..." : "Confirm"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {canDelete && (
            <Button
              variant="outline"
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() =>
                askConfirm(
                  "Delete this invoice?",
                  "This cannot be undone.",
                  "Delete",
                  () => deleteInvoice.mutate({ id: invoice.id }),
                  true,
                )
              }
              disabled={deleteInvoice.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {deleteInvoice.isPending ? "Deleting..." : "Delete"}
            </Button>
          )}
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {/* Left: Invoice Details */}
        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <Card className="hidden sm:block">
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
              <CardDescription>
                Core invoice fields
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-0 divide-y">
                <DetailRow icon={Hash} label="Invoice Number" value={invoice.invoiceNumber} />
                <DetailRow
                  icon={Calendar}
                  label="Invoice Date"
                  value={dayjs(invoice.invoicedDate).format("MMMM D, YYYY")}
                />
                <DetailRow
                  icon={Calendar}
                  label="Due Date"
                  value={dayjs(invoice.dueDate).format("MMMM D, YYYY")}
                />
                <DetailRow
                  icon={DollarSign}
                  label="Invoice Price (before tax)"
                  value={formatCurrency(invoice.subtotal, invoice.currency)}
                />
                <DetailRow
                  icon={DollarSign}
                  label="Tax Rate"
                  value={`${Number(invoice.taxRate)}%`}
                />
                <DetailRow
                  icon={DollarSign}
                  label="Total after tax"
                  value={
                    <span className="text-lg font-semibold">
                      {formatCurrency(invoice.amount, invoice.currency)}
                    </span>
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Line items are saved in DB but not displayed on the detail page */}
          {/* Uploaded Invoice File — desktop only, mobile uses full-screen dialog */}
          {invoice.fileUrl && (
            <Card className="hidden sm:block">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Uploaded Invoice</CardTitle>
                  <CardDescription>Original uploaded document</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
                  <Download className="mr-2 h-4 w-4" />
                  {downloading ? "Preparing…" : "Download"}
                </Button>
              </CardHeader>
              <CardContent>
                <div className="max-h-[70vh] overflow-auto">
                  <DocumentViewer url={invoice.fileUrl} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Timeline */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Activity Timeline</CardTitle>
              <CardDescription>
                History of events for this invoice
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sortedTimeline.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                  <Clock className="h-8 w-8" />
                  <p className="text-sm">No activity yet</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {sortedTimeline.map((event) => (
                    <TimelineItem key={event.id} event={event} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile: Sticky Bottom Action Bar */}
      {hasActions && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 border-t bg-white px-4 py-3 shadow-lg sm:hidden">
          {canEdit && (
            <Button size="sm" variant="outline" className="flex-1" onClick={openEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          )}
          {canSend && (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => {
                if (!invoice.customerId) {
                  toast.error("Assign a customer before sending — tap Edit to add one.");
                  return;
                }
                askConfirm(
                  "Send invoice?",
                  `Mark ${invoice.invoiceNumber} as sent and notify the recipient.`,
                  "Send",
                  () => sendInvoice.mutate({ id: invoice.id }),
                );
              }}
              disabled={sendInvoice.isPending}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send
            </Button>
          )}
        </div>
      )}

      {/* Edit Draft Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Draft Invoice</DialogTitle>
            <DialogDescription>
              Update fields below and save. Editing is only available while the invoice is still a draft.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid gap-1.5">
              <Label>Invoice Number <span className="text-red-600">*</span></Label>
              <Input value={editForm.invoiceNumber} onChange={(e) => setEditForm({ ...editForm, invoiceNumber: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Customer</Label>
              <Select value={editForm.customerId || "__none__"} onValueChange={(v) => setEditForm({ ...editForm, customerId: v === "__none__" ? "" : v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No customer —</SelectItem>
                  {customerList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company || c.name}
                      {c.company ? ` · ${c.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Reference</Label>
              <Input value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} placeholder="PO number, reference…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Invoice Date</Label>
                <Input type="date" value={editForm.invoicedDate} onChange={(e) => setEditForm({ ...editForm, invoicedDate: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Payment Terms (days)</Label>
                <Input type="number" min={0} value={editForm.paymentTerms} onChange={(e) => setEditForm({ ...editForm, paymentTerms: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Currency</Label>
                <Input value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Total Amount</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={editForm.totalAmount}
                  onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value.replace(/[^\d.]/g, "") })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>From Address</Label>
              <Textarea rows={2} value={editForm.fromAddress} onChange={(e) => setEditForm({ ...editForm, fromAddress: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>To Address</Label>
              <Textarea rows={2} value={editForm.toAddress} onChange={(e) => setEditForm({ ...editForm, toAddress: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={updateInvoiceMut.isPending}>
              {updateInvoiceMut.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shared confirmation dialog for status-changing actions */}
      <Dialog open={!!confirmAction} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle>{confirmAction?.title}</DialogTitle>
            <DialogDescription>
              {confirmAction?.description}
              <span className="mt-2 block font-medium text-red-600">
                Once changed, this cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                confirmAction?.onConfirm();
                setConfirmAction(null);
              }}
            >
              {confirmAction?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile: Full-screen Document Viewer */}
      {showDocument && invoice.fileUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white sm:hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold">Invoice Document</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleDownload} disabled={downloading}>
                <Download className="mr-1.5 h-4 w-4" />
                {downloading ? "…" : "Download"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowDocument(false)}>Close</Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <DocumentViewer url={invoice.fileUrl} />
          </div>
        </div>
      )}
    </div>
  );
}
