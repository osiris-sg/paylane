"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText } from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DocumentViewer } from "~/components/document-viewer";
import { TimelineList, type TimelineEvent } from "~/components/activity-timeline";

// Compact label/value pair — same style as the invoice detail page.
function Field({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

export default function StatementDetailPage() {
  const params = useParams<{ id: string }>();
  const utils = api.useUtils();

  const {
    data: statement,
    isLoading,
    error,
  } = api.statement.getById.useQuery({ id: params.id });

  const { data: onboardingStatus } = api.onboarding.getStatus.useQuery();
  const myCompanyId = onboardingStatus?.companyId;

  const markViewed = api.statement.markViewed.useMutation({
    onSuccess: () => {
      void utils.statement.getById.invalidate({ id: params.id });
      void utils.statement.listIncoming.invalidate();
      void utils.statement.getTabCounts.invalidate();
    },
  });

  // First receiver visit → mark as viewed (mirrors the invoice detail page).
  useEffect(() => {
    if (!statement || !myCompanyId) return;
    if (statement.receiverCompanyId !== myCompanyId) return;
    if (statement.viewedAt) return;
    if (markViewed.isPending || markViewed.isSuccess) return;
    markViewed.mutate({ id: statement.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement?.id, statement?.viewedAt, statement?.receiverCompanyId, myCompanyId]);

  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { url, filename } = await utils.statement.getDownloadUrl.fetch({ id: params.id });
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

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="h-16 w-72 animate-pulse rounded bg-muted" />
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="w-[340px] animate-pulse rounded-lg bg-muted" />
          <div className="flex-1 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  if (!statement) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">
          {error ? "Couldn't load statement" : "Statement not found"}
        </h2>
        <p className="text-muted-foreground">
          {error
            ? error.message || "Network error. Try refreshing the page."
            : "The statement you are looking for does not exist or has been deleted."}
        </p>
        <Button asChild variant="outline">
          <Link href="/statements">Back to Statements</Link>
        </Button>
      </div>
    );
  }

  const isSender = statement.senderCompanyId === myCompanyId;

  // Statements created before the timeline existed have no stored rows —
  // derive a baseline history from the row's own timestamps so the card is
  // never empty. Newer statements accumulate real rows (sent / replaced /
  // viewed) written by the router.
  const timelineEvents: TimelineEvent[] =
    statement.timelineItems.length > 0
      ? statement.timelineItems
      : [
          {
            id: "derived-sent",
            message: "Statement sent to customer",
            createdAt: statement.sentAt,
          },
          ...(statement.viewedAt
            ? [
                {
                  id: "derived-viewed",
                  message: "Statement viewed by receiver",
                  createdAt: statement.viewedAt,
                },
              ]
            : []),
        ];
  const backHref = isSender ? "/statements?tab=sent" : "/statements?tab=received";
  const partyLabel = isSender ? "Customer" : "From";
  const partyName = isSender
    ? statement.customer.company || statement.customer.name
    : statement.senderCompany.name;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-0.5 h-7 text-muted-foreground" asChild>
            <Link href={backHref}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to Statements
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold tracking-tight">{partyName}</h1>
            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300">
              Sent
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Statement of account</p>
        </div>
        <Button variant="outline" onClick={handleDownload} disabled={downloading}>
          <Download className="mr-2 h-4 w-4" />
          {downloading ? "Preparing…" : "Download"}
        </Button>
      </div>

      {/* ── Body: details left, document right (single screen on desktop) ── */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-4 sm:w-[340px]">
          <Card className="shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Statement Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field
                label={partyLabel}
                value={
                  isSender ? (
                    <Link
                      href={`/customers/${statement.customer.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {partyName}
                    </Link>
                  ) : (
                    partyName
                  )
                }
              />
              <Field label="File" value={statement.fileName} />
              <Field
                label="Last updated"
                value={dayjs(statement.sentAt).format("MMM D, YYYY, HH:mm")}
              />
              <Field
                label="Viewed"
                value={
                  statement.viewedAt
                    ? dayjs(statement.viewedAt).format("MMM D, YYYY, HH:mm")
                    : "Not yet"
                }
              />
              {statement.notes && (
                <div className="col-span-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Notes
                  </p>
                  <p className="mt-0.5 text-sm">{statement.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="text-base">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-y-auto">
              <TimelineList events={timelineEvents} />
            </CardContent>
          </Card>
        </div>

        <div className="min-h-0 flex-1">
          <Card className="flex h-full min-h-[420px] flex-col">
            <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="text-base">Statement Document</CardTitle>
            </CardHeader>
            <CardContent
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-b-xl bg-muted/20"
              style={{ scrollbarGutter: "stable" }}
            >
              {statement.fileUrl ? (
                <DocumentViewer url={statement.fileUrl} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FileText className="h-10 w-10" />
                  <p className="text-sm">The statement file couldn&apos;t be loaded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
