"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Building2,
  FileText,
  Send,
  ExternalLink,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { InvoiceTable } from "~/components/invoices/invoice-table";
import {
  TimeSeriesChart,
  defaultRange,
  type Granularity,
} from "~/components/charts/time-series-chart";
import { SendStatementDialog } from "~/components/statements/send-statement-dialog";
import { useSendAccess } from "~/lib/use-send-access";
import { formatCurrency } from "~/lib/currency";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params?.id ?? "";

  const customer = api.customer.getById.useQuery({ id: customerId });

  const initialRange = defaultRange();
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  const series = api.customer.getTimeSeries.useQuery({
    customerId,
    granularity,
    from: new Date(from),
    to: new Date(to),
  });
  const aging = api.customer.getAgingData.useQuery({ customerId });
  const statement = api.statement.getForCustomer.useQuery({ customerId });
  const sendAccess = useSendAccess();
  const [stmtOpen, setStmtOpen] = useState(false);

  if (customer.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!customer.data) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
        <Button variant="outline" asChild>
          <Link href="/customers">Back to customers</Link>
        </Button>
      </div>
    );
  }

  const c = customer.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-3">
            <Link href="/customers">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Customers
            </Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            <Building2 className="h-6 w-6 text-blue-600" />
            {c.company || c.name}
          </h1>
          {c.company && c.name && c.name !== c.company && (
            <p className="text-sm text-muted-foreground">{c.name}</p>
          )}
        </div>
        <Button onClick={() => setStmtOpen(true)} disabled={!sendAccess.canSend}>
          <Send className="mr-2 h-4 w-4" />
          {statement.data ? "Replace statement" : "Send statement"}
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-3">
          {c.email && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.email}</span>
            </div>
          )}
          {c.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-4 w-4 shrink-0" />
              <span>{c.phone}</span>
            </div>
          )}
          {c.address && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{c.address}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {statement.data && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium">Latest statement</p>
                <p className="text-xs text-muted-foreground">
                  {statement.data.fileName} · sent{" "}
                  {dayjs(statement.data.sentAt).format("D MMM YYYY")}
                  {statement.data.viewedAt
                    ? ` · viewed ${dayjs(statement.data.viewedAt).format("D MMM")}`
                    : " · not yet viewed"}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href={statement.data.fileUrl}
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
        title="Sales"
        subtitle={`Invoiced to ${c.company || c.name}`}
        series={series.data?.series ?? []}
        total={series.data?.total ?? 0}
        granularity={granularity}
        from={from}
        to={to}
        stroke="#3b82f6"
        totalLabel="Total billed"
        onGranularityChange={setGranularity}
        onFromChange={setFrom}
        onToChange={setTo}
        isLoading={series.isLoading}
      />

      {aging.data && aging.data.some((b) => b.amount > 0) && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Invoice Aging</CardTitle>
            <p className="text-xs text-muted-foreground">
              Outstanding invoices to {c.company || c.name} by months since invoiced
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={aging.data}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={12}
                  tickFormatter={(v: string) => `${v} mo`}
                />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  formatter={(value) => [formatCurrency(value as number, "SGD"), "Amount"]}
                  labelFormatter={(label) => `${label} months outstanding`}
                  contentStyle={{
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    fontSize: "13px",
                  }}
                />
                <Bar
                  dataKey="amount"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Invoices</h2>
        <InvoiceTable type="sent" initialCustomerId={customerId} />
      </div>

      <SendStatementDialog
        open={stmtOpen}
        onOpenChange={setStmtOpen}
        customerId={customerId}
        customerLabel={c.company || c.name}
        hasExisting={!!statement.data}
      />
    </div>
  );
}
