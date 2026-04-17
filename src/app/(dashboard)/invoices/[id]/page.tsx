"use client";

import { useState } from "react";
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
  Building2,
  Calendar,
  DollarSign,
  Hash,
  MapPin,
  Trash2,
  CalendarClock,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
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

const routingStatusConfig: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "border-yellow-500 bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400" },
  ACKNOWLEDGED: { label: "Acknowledged", className: "border-green-500 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400" },
  FAILED: { label: "Failed", className: "bg-red-100 text-red-700 border-red-500 dark:bg-red-950 dark:text-red-400" },
};

const invoiceStatusConfig: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300" },
  SENT: { label: "Sent", className: "bg-blue-100 text-blue-700 border-blue-400 dark:bg-blue-950 dark:text-blue-400" },
  PENDING_APPROVAL: { label: "Pending Approval", className: "bg-amber-100 text-amber-700 border-amber-400 dark:bg-amber-950 dark:text-amber-400" },
  PAID: { label: "Paid", className: "bg-green-100 text-green-700 border-green-400 dark:bg-green-950 dark:text-green-400" },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-700 border-red-400 dark:bg-red-950 dark:text-red-400" },
  CANCELLED: { label: "Cancelled", className: "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400" },
};

function formatCurrency(amount: number | unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
  }).format(Number(amount));
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

  const { data: invoice, isLoading } = api.invoice.getById.useQuery({
    id: params.id,
  });

  const sendInvoice = api.invoice.send.useMutation({
    onSuccess: () => {
      toast.success("Invoice sent successfully");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to send invoice");
    },
  });

  const acknowledgeInvoice = api.invoice.acknowledge.useMutation({
    onSuccess: () => {
      toast.success("Invoice acknowledged");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to acknowledge invoice");
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

  const [scheduleDate, setScheduleDate] = useState("");

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

  const rStatusConfig = routingStatusConfig[invoice.routingStatus];
  const iStatusConfig = invoiceStatusConfig[invoice.invoiceStatus];

  const isSender = !isReceived; // This user's company sent the invoice
  const isReceiver = isReceived; // This user's company received the invoice

  const canSend = isSender && invoice.invoiceStatus === "DRAFT";
  const canAcknowledge = isReceiver && invoice.invoiceStatus === "SENT";
  const canMarkPaid =
    isReceiver &&
    (invoice.invoiceStatus === "SENT" || invoice.invoiceStatus === "OVERDUE");
  const canApprovePayment = isSender && invoice.invoiceStatus === "PENDING_APPROVAL";
  const canRejectPayment = isSender && invoice.invoiceStatus === "PENDING_APPROVAL";
  const canDelete = isSender && invoice.invoiceStatus === "DRAFT";
  const canSchedulePayment =
    isReceiver &&
    (invoice.invoiceStatus === "SENT" || invoice.invoiceStatus === "OVERDUE");

  const timeline: TimelineEvent[] = (invoice.timelineItems as TimelineEvent[]) ?? [];
  const sortedTimeline = [...timeline].sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()
  );

  const [showDocument, setShowDocument] = useState(false);

  const hasActions = canSend || canAcknowledge || canSchedulePayment || canMarkPaid || canApprovePayment || canRejectPayment || canDelete;

  return (
    <div className="flex flex-col gap-4 p-3 pb-24 sm:gap-6 sm:p-6 sm:pb-6">
      {/* Back Button */}
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Link>
        </Button>
      </div>

      {/* Mobile Summary Card */}
      <div className="sm:hidden">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-bold">{invoice.invoiceNumber}</p>
                <p className="text-sm text-muted-foreground">
                  {isReceived ? `From ${invoice.senderCompany?.name ?? "Unknown"}` : `To ${invoice.customer?.name ?? "Unknown"}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold">{formatCurrency(invoice.amount, invoice.currency)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={iStatusConfig?.className}>{iStatusConfig?.label ?? invoice.invoiceStatus}</Badge>
              <Badge variant="outline" className={rStatusConfig?.className}>{rStatusConfig?.label ?? invoice.routingStatus}</Badge>
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
            <Badge variant="outline" className={iStatusConfig?.className}>{iStatusConfig?.label ?? invoice.invoiceStatus}</Badge>
            <Badge variant="outline" className={rStatusConfig?.className}>{rStatusConfig?.label ?? invoice.routingStatus}</Badge>
          </div>
          <p className="text-muted-foreground">
            {isReceived ? `From ${invoice.senderCompany?.name ?? "Unknown"}` : `To ${invoice.customer?.name ?? "Unknown"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSend && (
            <Button
              onClick={() => sendInvoice.mutate({ id: invoice.id })}
              disabled={sendInvoice.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sendInvoice.isPending ? "Sending..." : "Send Invoice"}
            </Button>
          )}
          {canAcknowledge && (
            <Button
              onClick={() => acknowledgeInvoice.mutate({ id: invoice.id })}
              disabled={acknowledgeInvoice.isPending}
              variant="outline"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {acknowledgeInvoice.isPending ? "Acknowledging..." : "Acknowledge"}
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
              onClick={() => markPaid.mutate({ id: invoice.id })}
              disabled={markPaid.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {markPaid.isPending ? "Submitting..." : "Mark as Paid"}
            </Button>
          )}
          {canApprovePayment && (
            <Button
              onClick={() => approvePayment.mutate({ id: invoice.id })}
              disabled={approvePayment.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {approvePayment.isPending ? "Approving..." : "Approve Payment"}
            </Button>
          )}
          {canRejectPayment && (
            <Button
              onClick={() => rejectPayment.mutate({ id: invoice.id })}
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
              onClick={() => {
                if (window.confirm("Are you sure you want to delete this invoice?")) {
                  deleteInvoice.mutate({ id: invoice.id });
                }
              }}
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
                Full details for this invoice
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-0 divide-y sm:grid-cols-2 sm:divide-y-0">
                <div className="space-y-0 divide-y pr-0 sm:pr-6">
                  <DetailRow
                    icon={Hash}
                    label="Invoice Number"
                    value={invoice.invoiceNumber}
                  />
                  <DetailRow
                    icon={FileText}
                    label="Reference"
                    value={invoice.reference}
                  />
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
                  {invoice.expectedPaymentDate && (
                    <DetailRow
                      icon={CalendarClock}
                      label="Expected Payment"
                      value={
                        <span className="font-medium text-blue-600">
                          {dayjs(invoice.expectedPaymentDate).format("MMMM D, YYYY")}
                        </span>
                      }
                    />
                  )}
                  <DetailRow
                    icon={Clock}
                    label="Payment Terms"
                    value={invoice.paymentTerms}
                  />
                </div>
                <div className="space-y-0 divide-y pl-0 sm:border-l sm:pl-6">
                  <DetailRow
                    icon={DollarSign}
                    label="Amount"
                    value={
                      <span className="text-lg">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </span>
                    }
                  />
                  <DetailRow
                    icon={Building2}
                    label="From"
                    value={invoice.senderCompany?.name ?? "-"}
                  />
                  <DetailRow
                    icon={Building2}
                    label="To"
                    value={invoice.receiverCompany?.name ?? invoice.customer?.name ?? "-"}
                  />
                  <DetailRow
                    icon={MapPin}
                    label="From Address"
                    value={invoice.fromAddress}
                  />
                  <DetailRow
                    icon={MapPin}
                    label="To Address"
                    value={invoice.toAddress}
                  />
                </div>
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
          {canSend && (
            <Button size="sm" className="flex-1" onClick={() => sendInvoice.mutate({ id: invoice.id })} disabled={sendInvoice.isPending}>
              <Send className="mr-1.5 h-3.5 w-3.5" /> Send
            </Button>
          )}
          {canAcknowledge && (
            <Button size="sm" variant="outline" className="flex-1" onClick={() => acknowledgeInvoice.mutate({ id: invoice.id })} disabled={acknowledgeInvoice.isPending}>
              Acknowledge
            </Button>
          )}
          {canMarkPaid && (
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => markPaid.mutate({ id: invoice.id })} disabled={markPaid.isPending}>
              Mark Paid
            </Button>
          )}
          {canApprovePayment && (
            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => approvePayment.mutate({ id: invoice.id })} disabled={approvePayment.isPending}>
              Approve
            </Button>
          )}
          {canRejectPayment && (
            <Button size="sm" variant="destructive" className="flex-1" onClick={() => rejectPayment.mutate({ id: invoice.id })} disabled={rejectPayment.isPending}>
              Reject
            </Button>
          )}
        </div>
      )}

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
