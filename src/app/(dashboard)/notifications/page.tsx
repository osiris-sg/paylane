"use client";

import { useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  FileDown,
  Clock,
  AlertTriangle,
  DollarSign,
  CheckCircle,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  BellOff,
} from "lucide-react";

dayjs.extend(relativeTime);

type NotificationType =
  | "INVOICE_RECEIVED"
  | "PAYMENT_DUE_SOON"
  | "PAYMENT_OVERDUE"
  | "INVOICE_PAID"
  | "INVOICE_ACKNOWLEDGED"
  | "GENERAL";

const typeConfig: Record<
  NotificationType,
  { icon: React.ElementType; borderColor?: string; iconColor: string }
> = {
  INVOICE_RECEIVED: {
    icon: FileDown,
    iconColor: "text-blue-500",
  },
  PAYMENT_DUE_SOON: {
    icon: Clock,
    borderColor: "border-l-yellow-500",
    iconColor: "text-yellow-500",
  },
  PAYMENT_OVERDUE: {
    icon: AlertTriangle,
    borderColor: "border-l-red-500",
    iconColor: "text-red-500",
  },
  INVOICE_PAID: {
    icon: DollarSign,
    iconColor: "text-green-500",
  },
  INVOICE_ACKNOWLEDGED: {
    icon: CheckCircle,
    iconColor: "text-emerald-500",
  },
  GENERAL: {
    icon: Bell,
    iconColor: "text-gray-500",
  },
};

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, refetch } = api.notification.list.useQuery({
    page,
    limit,
  });

  const { refetch: refetchUnread } = api.notification.getUnreadCount.useQuery();

  const markReadMutation = api.notification.markRead.useMutation({
    onSuccess: () => {
      void refetch();
      void refetchUnread();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to mark notification as read");
    },
  });

  const markAllReadMutation = api.notification.markAllRead.useMutation({
    onSuccess: () => {
      toast.success("All notifications marked as read");
      void refetch();
      void refetchUnread();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to mark all as read");
    },
  });

  const handleMarkRead = (id: string, read: boolean) => {
    if (!read) {
      markReadMutation.mutate({ id });
    }
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const hasUnread = data?.notifications.some((n) => !n.read);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Stay updated on your invoices and payments.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleMarkAllRead}
          disabled={markAllReadMutation.isPending || !hasUnread}
        >
          <CheckCheck className="mr-2 h-4 w-4" />
          {markAllReadMutation.isPending ? "Marking..." : "Mark all as read"}
        </Button>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse p-4">
              <div className="flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-24 rounded bg-muted" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && data?.notifications.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-16">
          <BellOff className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-semibold">You&apos;re all caught up!</h3>
          <p className="text-sm text-muted-foreground">No notifications.</p>
        </Card>
      )}

      {/* Notifications List */}
      {!isLoading && data && data.notifications.length > 0 && (
        <>
          <div className="space-y-2">
            {data.notifications.map((notification) => {
              const config =
                typeConfig[notification.type as NotificationType] ??
                typeConfig.GENERAL;
              const Icon = config.icon;
              const hasBorder = !!config.borderColor;

              return (
                <Card
                  key={notification.id}
                  className={`cursor-pointer border-l-4 transition-colors hover:bg-muted/50 ${
                    hasBorder ? config.borderColor : "border-l-transparent"
                  } ${!notification.read ? "bg-muted/30" : ""}`}
                  onClick={() =>
                    handleMarkRead(notification.id, notification.read)
                  }
                >
                  <div className="flex items-start gap-4 p-4">
                    {/* Unread indicator */}
                    <div className="flex items-center pt-0.5">
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${
                          !notification.read
                            ? "bg-blue-500"
                            : "bg-transparent"
                        }`}
                      />
                    </div>

                    {/* Type Icon */}
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted ${config.iconColor}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm leading-relaxed ${
                          !notification.read ? "font-medium" : ""
                        }`}
                      >
                        {notification.message}
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {dayjs(notification.createdAt).fromNow()}
                        </span>

                        {notification.invoice && (
                          <>
                            <Separator
                              orientation="vertical"
                              className="h-3"
                            />
                            <Link
                              href={`/invoices/${notification.invoice.id}`}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-3 w-3" />
                              {notification.invoice.invoiceNumber}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * limit + 1} to{" "}
                {Math.min(page * limit, data.totalCount)} of {data.totalCount}{" "}
                notifications
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(data.totalPages, p + 1))
                  }
                  disabled={page === data.totalPages}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
