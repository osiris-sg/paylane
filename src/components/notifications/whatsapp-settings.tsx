"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { MessageCircle, Send } from "lucide-react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export function WhatsAppSettings() {
  const utils = api.useUtils();
  const { data, isLoading } = api.notification.getWhatsAppPreferences.useQuery();
  const [number, setNumber] = useState("");
  const [optIn, setOptIn] = useState(false);

  useEffect(() => {
    if (data) {
      setNumber(data.whatsappNumber ?? "");
      setOptIn(data.whatsappOptIn);
    }
  }, [data]);

  const update = api.notification.updateWhatsAppPreferences.useMutation({
    onSuccess: () => {
      toast.success("WhatsApp preferences saved");
      void utils.notification.getWhatsAppPreferences.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const test = api.notification.sendTestWhatsApp.useMutation({
    onSuccess: () => toast.success("Test message sent — check WhatsApp"),
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    update.mutate({ whatsappNumber: number.trim() || "", whatsappOptIn: optIn });
  };

  const numberChanged = data && number.trim() !== (data.whatsappNumber ?? "");
  const optInChanged = data && optIn !== data.whatsappOptIn;
  const dirty = numberChanged || optInChanged;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4 text-green-600" />
          WhatsApp Notifications
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Get instant alerts on WhatsApp when invoices arrive, payments are made, or due dates approach.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="whatsapp-number" className="text-xs">
            WhatsApp Number
          </Label>
          <Input
            id="whatsapp-number"
            placeholder="+6591234567"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            Use international format with country code (e.g. +65 for Singapore).
          </p>
        </div>

        <label className="flex items-center gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={optIn}
            disabled={isLoading || !number.trim()}
            onChange={(e) => setOptIn(e.target.checked)}
          />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Send me WhatsApp notifications
            </p>
            <p className="text-xs text-muted-foreground">
              {number.trim()
                ? "You can turn this off any time."
                : "Enter a number first."}
            </p>
          </div>
        </label>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => test.mutate()}
            disabled={!data?.whatsappOptIn || test.isPending}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {test.isPending ? "Sending..." : "Send test"}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || update.isPending}
          >
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
