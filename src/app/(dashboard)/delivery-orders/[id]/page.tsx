"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import { ArrowLeft, Download, PackageCheck } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { DocumentViewer } from "~/components/document-viewer";

export default function DeliveryOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = api.useUtils();

  const { data: order, isLoading, error } = api.deliveryOrder.getById.useQuery({ id: params.id });
  const { data: status } = api.onboarding.getStatus.useQuery();
  const myCompanyId = status?.companyId;

  const markViewed = api.deliveryOrder.markViewed.useMutation();

  // Receiver's first open → mark viewed.
  useEffect(() => {
    if (!order || !myCompanyId) return;
    if (order.receiverCompanyId !== myCompanyId) return;
    if (order.viewedAt) return;
    if (markViewed.isPending || markViewed.isSuccess) return;
    markViewed.mutate({ id: order.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.viewedAt, order?.receiverCompanyId, myCompanyId]);

  const handleDownload = async () => {
    try {
      const { url, filename } = await utils.deliveryOrder.getDownloadUrl.fetch({ id: params.id });
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't download the file");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground">
        <PackageCheck className="h-10 w-10" />
        <p>Delivery order not found.</p>
        <Button variant="outline" onClick={() => router.push("/delivery-orders")}>Back</Button>
      </div>
    );
  }

  const isSender = order.senderCompanyId === myCompanyId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/delivery-orders")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">DO {order.doNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {isSender
              ? order.customer
                ? `To ${order.customer.company || order.customer.name}`
                : "No customer assigned"
              : `From ${order.senderCompany.name}`}
            {order.sentAt ? ` · sent ${dayjs(order.sentAt).format("D MMM YYYY")}` : " · draft"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          Download
        </Button>
      </div>

      {order.fileUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Delivery Order</CardTitle>
            <CardDescription>Uploaded document</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[75vh] overflow-auto">
              <DocumentViewer url={order.fileUrl} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
