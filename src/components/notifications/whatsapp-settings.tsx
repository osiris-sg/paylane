"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { MessageCircle, Send } from "lucide-react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

function normalisePhone(s: string) {
  return s.replace(/\s+/g, "");
}

export function WhatsAppSettings() {
  const utils = api.useUtils();
  const { data, isLoading } = api.notification.getWhatsAppPreferences.useQuery();
  const { data: status } = api.onboarding.getStatus.useQuery();
  const companyPhone = status?.companyPhone?.trim() ?? "";

  const [useCompanyPhone, setUseCompanyPhone] = useState(false);
  const [customNumber, setCustomNumber] = useState("");
  const [optIn, setOptIn] = useState(false);

  // Hydrate from server. If the saved number matches the company phone,
  // pre-select the "Same as company phone" radio.
  useEffect(() => {
    if (!data) return;
    const saved = data.whatsappNumber ?? "";
    if (companyPhone && normalisePhone(saved) === normalisePhone(companyPhone)) {
      setUseCompanyPhone(true);
      setCustomNumber("");
    } else {
      setUseCompanyPhone(false);
      setCustomNumber(saved);
    }
    setOptIn(data.whatsappOptIn);
  }, [data, companyPhone]);

  const effectiveNumber = useCompanyPhone ? companyPhone : customNumber.trim();

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
    if (optIn && !effectiveNumber) {
      toast.error(
        useCompanyPhone
          ? "Set a company phone first, or pick a different number."
          : "Enter a WhatsApp number.",
      );
      return;
    }
    update.mutate({ whatsappNumber: effectiveNumber, whatsappOptIn: optIn });
  };

  const dirty =
    !!data &&
    (effectiveNumber !== (data.whatsappNumber ?? "") ||
      optIn !== data.whatsappOptIn);

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
        <div className="grid gap-2">
          {companyPhone && (
            <label className="flex items-start gap-2 cursor-pointer rounded-md border bg-white px-3 py-2">
              <input
                type="radio"
                name="wa-source"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={useCompanyPhone}
                onChange={() => setUseCompanyPhone(true)}
                disabled={isLoading}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Same as company phone</p>
                <p className="text-xs text-muted-foreground">{companyPhone}</p>
              </div>
            </label>
          )}

          <label className="flex items-start gap-2 cursor-pointer rounded-md border bg-white px-3 py-2">
            <input
              type="radio"
              name="wa-source"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={!useCompanyPhone || !companyPhone}
              onChange={() => setUseCompanyPhone(false)}
              disabled={isLoading}
            />
            <div className="flex-1">
              <p className="text-sm font-medium">Use a different number</p>
              {(!useCompanyPhone || !companyPhone) && (
                <Input
                  className="mt-2"
                  placeholder="+6591234567"
                  value={customNumber}
                  onChange={(e) => setCustomNumber(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={isLoading}
                />
              )}
            </div>
          </label>
        </div>

        <label className="flex items-center gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={optIn}
            disabled={isLoading || !effectiveNumber}
            onChange={(e) => setOptIn(e.target.checked)}
          />
          <div className="flex-1">
            <p className="text-sm font-medium">Send me WhatsApp notifications</p>
            <p className="text-xs text-muted-foreground">
              {effectiveNumber
                ? "You can turn this off any time."
                : "Pick a number first."}
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
