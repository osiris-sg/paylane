"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Truck,
  FileText,
  ExternalLink,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { InvoiceTable } from "~/components/invoices/invoice-table";
import {
  TimeSeriesChart,
  defaultRange,
  type Granularity,
} from "~/components/charts/time-series-chart";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const supplierId = params?.id ?? "";

  const supplier = api.supplier.getById.useQuery({ id: supplierId });

  const initialRange = defaultRange();
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  const series = api.supplier.getTimeSeries.useQuery({
    supplierId,
    granularity,
    from: new Date(from),
    to: new Date(to),
  });

  // The latest statement (if any) the supplier sent to this user.
  const linkedCompanyId = supplier.data?.linkedCompanyId;
  const incoming = api.statement.getFromSupplierCompany.useQuery(
    { senderCompanyId: linkedCompanyId ?? "" },
    { enabled: !!linkedCompanyId },
  );

  // Auto-mark as viewed once the supplier page loads with an unviewed
  // statement on file. The receiver doesn't need to click anything for
  // this — landing here counts as having seen the notification.
  const utils = api.useUtils();
  const markViewed = api.statement.markViewed.useMutation({
    onSuccess: async () => {
      await utils.statement.getFromSupplierCompany.invalidate();
    },
  });
  useEffect(() => {
    if (incoming.data && !incoming.data.viewedAt) {
      markViewed.mutate({ id: incoming.data.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.data?.id]);

  if (supplier.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!supplier.data) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Supplier not found.</p>
        <Button variant="outline" asChild>
          <Link href="/suppliers">Back to suppliers</Link>
        </Button>
      </div>
    );
  }

  const s = supplier.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-3">
          <Link href="/suppliers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Suppliers
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
          <Truck className="h-6 w-6 text-purple-600" />
          {s.company || s.name}
        </h1>
        {s.company && s.name && s.name !== s.company && (
          <p className="text-sm text-muted-foreground">{s.name}</p>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-3">
          {s.email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{s.email}</span>
            </div>
          )}
          {s.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4 shrink-0" />
              <span>{s.phone}</span>
            </div>
          )}
          {s.address && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{s.address}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {incoming.data && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Latest statement received</p>
                <p className="text-xs text-muted-foreground">
                  {incoming.data.fileName} · sent{" "}
                  {dayjs(incoming.data.sentAt).format("D MMM YYYY")}
                </p>
                {incoming.data.notes && (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    &ldquo;{incoming.data.notes}&rdquo;
                  </p>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href={incoming.data.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      <TimeSeriesChart
        title="Purchases"
        subtitle={`Invoiced by ${s.company || s.name}`}
        series={series.data?.series ?? []}
        total={series.data?.total ?? 0}
        granularity={granularity}
        from={from}
        to={to}
        stroke="#8b5cf6"
        totalLabel="Total received"
        onGranularityChange={setGranularity}
        onFromChange={setFrom}
        onToChange={setTo}
        isLoading={series.isLoading}
      />

      <div>
        <h2 className="mb-3 text-lg font-semibold">Invoices</h2>
        {s.linkedCompanyId ? (
          <InvoiceTable
            type="received"
            initialSenderCompanyId={s.linkedCompanyId}
          />
        ) : (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              This supplier isn&apos;t on PayLane yet, so there are no invoices to show.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
