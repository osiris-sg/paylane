"use client";

import { useParams } from "next/navigation";
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
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
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
      toast.success("Invoice marked as paid");
      void utils.invoice.getById.invalidate({ id: params.id });
    },
    onError: () => {
      toast.error("Failed to mark invoice as paid");
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
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

  const canSend = !isReceived && invoice.invoiceStatus === "DRAFT";
  const canAcknowledge = isReceived && invoice.invoiceStatus === "SENT";
  const canMarkPaid =
    isReceived &&
    (invoice.invoiceStatus === "SENT" || invoice.invoiceStatus === "OVERDUE");

  const timeline: TimelineEvent[] = (invoice.timelineItems as TimelineEvent[]) ?? [];
  const sortedTimeline = [...timeline].sort(
    (a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf()
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Back Button */}
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Link>
        </Button>
      </div>

      {/* Urgency Banner */}
      {showUrgencyBanner && (
        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
            isOverdue
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          }`}
        >
          {isOverdue ? (
            <AlertTriangle className="h-5 w-5 shrink-0" />
          ) : (
            <Clock className="h-5 w-5 shrink-0" />
          )}
          <div>
            <p className="font-semibold">
              {isOverdue
                ? `This invoice is overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? "s" : ""}`
                : `This invoice is due in ${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""}`}
            </p>
            <p className="text-sm opacity-80">
              {isOverdue
                ? "Payment was expected by " + dayjs(invoice.dueDate).format("MMMM D, YYYY")
                : "Due date: " + dayjs(invoice.dueDate).format("MMMM D, YYYY")}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              {invoice.invoiceNumber}
            </h1>
            <Badge variant="outline" className={iStatusConfig?.className}>
              {iStatusConfig?.label ?? invoice.invoiceStatus}
            </Badge>
            <Badge variant="outline" className={rStatusConfig?.className}>
              {rStatusConfig?.label ?? invoice.routingStatus}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            {isReceived
              ? `From ${invoice.senderCompany?.name ?? "Unknown"}`
              : `To ${invoice.customer?.name ?? "Unknown"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          {canMarkPaid && (
            <Button
              onClick={() => markPaid.mutate({ id: invoice.id })}
              disabled={markPaid.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {markPaid.isPending ? "Processing..." : "Mark as Paid"}
            </Button>
          )}
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Invoice Details */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
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
    </div>
  );
}
