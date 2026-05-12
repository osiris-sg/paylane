"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Send,
  Upload,
  FileText,
  ExternalLink,
  MailCheck,
  Inbox,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { api } from "~/trpc/react";
import { SendStatementDialog } from "~/components/statements/send-statement-dialog";
import { ExpiredBanner } from "~/components/subscription/expired-banner";
import { LockedSendingCTA } from "~/components/subscription/locked-sending-cta";
import { useSendAccess } from "~/lib/use-send-access";

dayjs.extend(relativeTime);

function StatementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: status } = api.onboarding.getStatus.useQuery();
  const companyModule = status?.module;
  const canSend = companyModule === "SEND" || companyModule === "BOTH";
  const canReceive = companyModule === "RECEIVE" || companyModule === "BOTH";
  const access = useSendAccess();

  const defaultTab = canReceive && !canSend ? "received" : "sent";
  const requested = searchParams.get("tab") ?? defaultTab;
  const activeTab =
    (requested === "sent" && canSend) || (requested === "received" && canReceive)
      ? requested
      : defaultTab;

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`/statements?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Statements
          </h1>
          <p className="text-muted-foreground">
            {canSend && canReceive
              ? "Manage statements you've sent and received"
              : canSend
                ? "Manage statements you've sent to your customers"
                : "Manage statements you've received from suppliers"}
          </p>
        </div>
        {canSend && (
          <Button asChild={access.canSend} disabled={!access.canSend}>
            {access.canSend ? (
              <Link href="/customers/send-statements">
                <Upload className="mr-2 h-4 w-4" />
                Bulk send
              </Link>
            ) : (
              <span className="cursor-not-allowed">
                <Upload className="mr-2 h-4 w-4" />
                Bulk send
              </span>
            )}
          </Button>
        )}
      </div>

      {canSend && access.state === "expired" && <ExpiredBanner />}
      {canSend && access.state === "locked" && <LockedSendingCTA />}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          {canSend && (
            <TabsTrigger value="sent" className="font-bold">
              CUSTOMER
            </TabsTrigger>
          )}
          {canReceive && (
            <TabsTrigger value="received" className="font-bold">
              SUPPLIER
            </TabsTrigger>
          )}
        </TabsList>
        {canSend && (
          <TabsContent value="sent" className="mt-4">
            <SentStatementsTable />
          </TabsContent>
        )}
        {canReceive && (
          <TabsContent value="received" className="mt-4">
            <ReceivedStatementsTable />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

export default function StatementsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      }
    >
      <StatementsContent />
    </Suspense>
  );
}

function SentStatementsTable() {
  const access = useSendAccess();
  const list = api.statement.listSent.useQuery();
  const [replaceFor, setReplaceFor] = useState<{
    customerId: string;
    customerLabel: string;
  } | null>(null);

  if (list.isLoading) return <TableSkeleton />;
  if (!list.data || list.data.length === 0) {
    return (
      <EmptyState
        icon={<MailCheck className="h-10 w-10 text-muted-foreground" />}
        title="No statements sent yet"
        body="Send a statement from any customer's detail page, or use Bulk send to upload several at once."
      />
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead>Viewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link
                        href={`/customers/${s.customer.id}`}
                        className="hover:underline"
                      >
                        <p className="font-medium">
                          {s.customer.company || s.customer.name}
                        </p>
                        {s.customer.company && s.customer.name &&
                          s.customer.name !== s.customer.company && (
                            <p className="text-xs text-muted-foreground">
                              {s.customer.name}
                            </p>
                          )}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-blue-600" />
                        <span className="truncate text-sm">{s.fileName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {dayjs(s.sentAt).fromNow()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.viewedAt ? (
                        <Badge
                          variant="outline"
                          className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          <Eye className="h-3 w-3" />
                          {dayjs(s.viewedAt).fromNow()}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="gap-1 border-gray-200 bg-gray-50 text-muted-foreground"
                        >
                          <EyeOff className="h-3 w-3" />
                          Not yet
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" asChild>
                          <a
                            href={s.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            View
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          disabled={!access.canSend}
                          onClick={() =>
                            setReplaceFor({
                              customerId: s.customer.id,
                              customerLabel:
                                s.customer.company || s.customer.name,
                            })
                          }
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" />
                          Replace
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {replaceFor && (
        <SendStatementDialog
          open
          onOpenChange={(o) => !o && setReplaceFor(null)}
          customerId={replaceFor.customerId}
          customerLabel={replaceFor.customerLabel}
          hasExisting
        />
      )}
    </>
  );
}

function ReceivedStatementsTable() {
  const list = api.statement.listIncoming.useQuery();
  const utils = api.useUtils();
  const markViewed = api.statement.markViewed.useMutation({
    onSuccess: async () => {
      await utils.statement.listIncoming.invalidate();
    },
  });

  if (list.isLoading) return <TableSkeleton />;
  if (!list.data || list.data.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-10 w-10 text-muted-foreground" />}
        title="No statements received yet"
        body="When a supplier sends you a statement of account, it'll show up here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">{s.senderCompany.name}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                      <span className="truncate text-sm">{s.fileName}</span>
                    </div>
                    {s.notes && (
                      <p className="mt-0.5 text-xs italic text-muted-foreground">
                        &ldquo;{s.notes}&rdquo;
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{dayjs(s.sentAt).fromNow()}</div>
                    <div className="text-xs text-muted-foreground">
                      {dayjs(s.sentAt).format("D MMM YYYY, HH:mm")}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.viewedAt ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-gray-200 bg-gray-50 text-muted-foreground"
                      >
                        Viewed
                      </Badge>
                    ) : (
                      <Badge className="gap-1 bg-blue-600 hover:bg-blue-700">
                        New
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        onClick={() => {
                          if (!s.viewedAt) markViewed.mutate({ id: s.id });
                        }}
                      >
                        <a
                          href={s.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        {icon}
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
