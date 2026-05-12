"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — same as a typical invoice upload

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export function SendStatementDialog({
  open,
  onOpenChange,
  customerId,
  customerLabel,
  hasExisting,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerLabel: string;
  hasExisting: boolean;
  onSent?: () => void;
}) {
  const utils = api.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = api.statement.sendToCustomer.useMutation({
    onSuccess: async () => {
      await utils.statement.getForCustomer.invalidate({ customerId });
      toast.success("Statement sent");
      reset();
      onOpenChange(false);
      onSent?.();
    },
    onError: (e) => setError(e.message),
  });

  const reset = () => {
    setFile(null);
    setNotes("");
    setError(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handlePick = (f: File | null) => {
    setError(null);
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Only PDF or image files (PNG, JPEG, WebP).");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File is too large (max 8 MB).");
      return;
    }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      send.mutate({
        customerId,
        fileDataUrl: dataUrl,
        fileName: file.name,
        fileType: file.type,
        notes: notes.trim() || undefined,
      });
    } catch {
      setError("Couldn't read that file.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send statement to {customerLabel}</DialogTitle>
          <DialogDescription>
            {hasExisting
              ? "This will replace the previous statement on file for this customer."
              : "Attach the SOA file. The customer will get a notification on PayLane."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label className="text-sm">File</Label>
            <label className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center transition-colors hover:border-blue-300 hover:bg-blue-50">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <FileText className="h-6 w-6 text-blue-600" />
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB · click to replace
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-gray-400" />
                  <p className="text-sm font-medium">Click to upload</p>
                  <p className="text-xs text-muted-foreground">
                    PDF or image, up to 8 MB
                  </p>
                </>
              )}
            </label>
          </div>

          <div>
            <Label htmlFor="stmt-notes" className="text-sm">
              Notes (optional)
            </Label>
            <Textarea
              id="stmt-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context for the recipient…"
              rows={2}
              className="mt-1 resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={send.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!file || send.isPending}>
            {send.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send statement"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
