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
  Calendar,
  DollarSign,
  Hash,
  Trash2,
  CalendarClock,
  Pencil,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { useSendAccess } from "~/lib/use-send-access";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { OpenInAppBanner } from "~/components/open-in-app-banner";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
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

const invoiceStatusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300" },
  SENT: { label: "Sent", className: "bg-blue-100 text-blue-700 border-blue-400 dark:bg-blue-950 dark:text-blue-400" },
  PENDING_APPROVAL: { label: "Pending Approval", className: "bg-amber-100 text-amber-700 border-amber-400 dark:bg-amber-950 dark:text-amber-400" },
  PAID: { label: "Paid", className: "bg-green-100 text-green-700 border-green-400 dark:bg-green-950 dark:text-green-400" },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-700 border-red-400 dark:bg-red-950 dark:text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400" },
};

import { formatCurrency } from "~/lib/currency";

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

  const { data: invoice, isLoading } = api.invoice.getById.useQuery({
    id: params.id,
  });
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

  const markPaid = api.invoice.markPaid.useMutation({
    onSuccess: () => {
      toast.success("Payment submitted — pending sender approval");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to submit payment");
    },
  });

  const approvePayment = api.invoice.approvePayment.useMutation({
    onSuccess: () => {
      toast.success("Payment approved");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to approve payment");
    },
  });

  const rejectPayment = api.invoice.rejectPayment.useMutation({
    onSuccess: () => {
      toast.success("Payment rejected");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to reject payment");
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

  const markViewed = api.invoice.markViewed.useMutation({
    onSuccess: () => {
      void utils.invoice.getTabCounts.invalidate();
      void utils.invoice.list.invalidate();
    },
  });

  // First-time receiver visit → mark as viewed so the SUPPLIER tab badge
  // ticks down. No-op for sender or for invoices already viewed.
  useEffect(() => {
    if (invoice && !!invoice.receiverCompany && !invoice.viewedAt) {
      markViewed.mutate({ id: invoice.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, invoice?.viewedAt, invoice?.receiverCompany]);

  const { data: customersData } = api.customer.list.useQuery({ limit: 100 });
  const customerList = customersData?.customers ?? [];

  const sendAccess = useSendAccess();

  const [scheduleDate, setScheduleDate] = useState("");
  const [showDocument, setShowDocument] = useState(false);
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

  if (!invoice) {
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
  const daysUntilDue = dayjs(invoice.dueDate).diff(dayjs(), "day");
  const isOverdue = daysUntilDue < 0;
  const isDueSoon = !isOverdue && daysUntilDue <= 20;
  const showUrgencyBanner = isReceived && (isOverdue || isDueSoon);

  const iStatusConfig = invoiceStatusConfig[invoice.invoiceStatus];

  const isSender = !isReceived; // This user's company sent the invoice
  const isReceiver = isReceived; // This user's company received the invoice

  const paymentApprovalEnabled = featureFlags?.paymentApprovalFlow ?? false;
  const sendingLocked = isSender && !sendAccess.canSend;

  const canSend = isSender && invoice.invoiceStatus === "DRAFT" && !sendingLocked;
  const canMarkPaid =
    paymentApprovalEnabled &&
    isReceiver &&
    (invoice.invoiceStatus === "SENT" || invoice.invoiceStatus === "OVERDUE");
  const canApprovePayment = paymentApprovalEnabled && isSender && invoice.invoiceStatus === "PENDING_APPROVAL";
  const canRejectPayment = paymentApprovalEnabled && isSender && invoice.invoiceStatus === "PENDING_APPROVAL";
  const canDelete = isSender && !sendingLocked;
  const canEdit = isSender && invoice.invoiceStatus === "DRAFT" && !sendingLocked;
  const canSchedulePayment =
    paymentApprovalEnabled &&
    isReceiver &&
    (invoice.invoiceStatus === "SENT" || invoice.invoiceStatus === "OVERDUE");

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

  const hasActions = canSend || canSchedulePayment || canMarkPaid || canApprovePayment || canRejectPayment || canDelete || canEdit;

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
                <p className="text-lg font-bold">{invoice.invoiceNumber}</p>
                <p className="text-sm text-muted-foreground">
                  {isReceived ? `From ${invoice.senderCompany?.name ?? "Unknown"}` : `To ${invoice.customer?.company || invoice.customer?.name || "Unknown"}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{formatCurrency(invoice.amount, invoice.currency)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={iStatusConfig?.className}>{(invoice.invoiceStatus === "SENT" && isReceived) ? "Received" : (iStatusConfig?.label ?? invoice.invoiceStatus)}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Invoice Date</p>
                <p className="font-medium">{dayjs(invoice.invoicedDate).format("MMM D, YYYY")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className={`font-medium ${isOverdue ? "text-red-600" : isDueSoon ? "text-amber-600" : ""}`}>
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
            {isOverdue && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Overdue by {Math.abs(daysUntilDue)} days
              </div>
            )}
            {isDueSoon && !isOverdue && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
                <Clock className="h-4 w-4" />
                Due in {daysUntilDue} days
              </div>
            )}
            {invoice.fileUrl && (
              <Button variant="outline" className="mt-3 w-full" onClick={() => setShowDocument(true)}>
                <FileText className="mr-2 h-4 w-4" />
                View Original Document
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Desktop: Urgency Banner */}
      {showUrgencyBanner && (
        <div
          className={`hidden items-center gap-3 rounded-lg border px-4 py-3 sm:flex ${
            isOverdue
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          {isOverdue ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <Clock className="h-5 w-5 shrink-0" />}
          <div>
            <p className="font-semibold">
              {isOverdue ? `This invoice is overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? "s" : ""}` : `This invoice is due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`}
            </p>
            <p className="text-sm opacity-80">
              {isOverdue ? "Payment was expected by " + dayjs(invoice.dueDate).format("MMMM D, YYYY") : "Due date: " + dayjs(invoice.dueDate).format("MMMM D, YYYY")}
            </p>
          </div>
        </div>
      )}

      {/* Desktop: Header */}
      <div className="hidden flex-col gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{invoice.invoiceNumber}</h1>
            <Badge variant="outline" className={iStatusConfig?.className}>{(invoice.invoiceStatus === "SENT" && isReceived) ? "Received" : (iStatusConfig?.label ?? invoice.invoiceStatus)}</Badge>
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
          {canMarkPaid && (
            <Button
              onClick={() =>
                askConfirm(
                  "Mark as paid?",
                  "This submits the payment for sender approval.",
                  "Mark as Paid",
                  () => markPaid.mutate({ id: invoice.id }),
                )
              }
              disabled={markPaid.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {markPaid.isPending ? "Submitting..." : "Mark as Paid"}
            </Button>
          )}
          {canApprovePayment && (
            <Button
              onClick={() =>
                askConfirm(
                  "Approve this payment?",
                  "This marks the invoice as paid.",
                  "Approve Payment",
                  () => approvePayment.mutate({ id: invoice.id }),
                )
              }
              disabled={approvePayment.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {approvePayment.isPending ? "Approving..." : "Approve Payment"}
            </Button>
          )}
          {canRejectPayment && (
            <Button
              onClick={() =>
                askConfirm(
                  "Reject this payment?",
                  "This sends the invoice back to SENT. The receiver will be notified.",
                  "Reject Payment",
                  () => rejectPayment.mutate({ id: invoice.id }),
                  true,
                )
              }
              disabled={rejectPayment.isPending}
              variant="destructive"
            >
              {rejectPayment.isPending ? "Rejecting..." : "Reject Payment"}
            </Button>
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
                  value={
                    <span
                      className={
                        isOverdue
                          ? "text-red-600 dark:text-red-400"
                          : isDueSoon
                            ? "text-amber-600 dark:text-amber-400"
                            : ""
                      }
                    >
                      {dayjs(invoice.dueDate).format("MMMM D, YYYY")}
                    </span>
                  }
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
              <CardHeader>
                <CardTitle>Uploaded Invoice</CardTitle>
                <CardDescription>Original uploaded document</CardDescription>
              </CardHeader>
              <CardContent>
                {invoice.fileUrl.startsWith("data:application/pdf") ? (
                  <iframe src={invoice.fileUrl} className="h-[600px] w-full rounded border" title="Invoice PDF" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={invoice.fileUrl} alt="Uploaded invoice" className="w-full rounded border" />
                )}
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
          {canMarkPaid && (
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => askConfirm("Mark as paid?", "Submits for sender approval.", "Mark Paid", () => markPaid.mutate({ id: invoice.id }))} disabled={markPaid.isPending}>
              Mark Paid
            </Button>
          )}
          {canApprovePayment && (
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => askConfirm("Approve this payment?", "Marks the invoice as paid.", "Approve", () => approvePayment.mutate({ id: invoice.id }))} disabled={approvePayment.isPending}>
              Approve
            </Button>
          )}
          {canRejectPayment && (
            <Button size="sm" variant="destructive" className="flex-1" onClick={() => askConfirm("Reject this payment?", "Sends the invoice back to SENT.", "Reject", () => rejectPayment.mutate({ id: invoice.id }), true)} disabled={rejectPayment.isPending}>
              Reject
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
            <Button variant="ghost" size="sm" onClick={() => setShowDocument(false)}>Close</Button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {invoice.fileUrl.startsWith("data:application/pdf") ? (
              <iframe src={invoice.fileUrl} className="h-full w-full" title="Invoice PDF" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={invoice.fileUrl} alt="Invoice" className="w-full" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
