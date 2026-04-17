"use client";

import { useState, useEffect } from "react";
import {
  Share,
  Plus,
  MoreVertical,
  Download,
  Smartphone,
  Monitor,
  X,
  ArrowDown,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";

type BrowserType = "safari" | "chrome-ios" | "chrome-android" | "chrome-desktop" | "samsung" | "edge" | "firefox" | "other";

function detectBrowser(): BrowserType {
  if (typeof window === "undefined") return "other";

  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);

  // iOS browsers
  if (isIOS) {
    if (/crios/.test(ua)) return "chrome-ios";
    if (/fxios/.test(ua)) return "firefox"; // Firefox on iOS
    if (/safari/.test(ua) && !/chrome/.test(ua)) return "safari";
    return "other"; // Other iOS browser
  }

  // Android browsers
  if (isAndroid) {
    if (/samsungbrowser/.test(ua)) return "samsung";
    if (/chrome/.test(ua) && !/edg/.test(ua)) return "chrome-android";
    if (/firefox/.test(ua)) return "firefox";
    return "other";
  }

  // Desktop browsers
  if (/edg/.test(ua)) return "edge";
  if (/chrome/.test(ua)) return "chrome-desktop";
  if (/safari/.test(ua)) return "safari";
  if (/firefox/.test(ua)) return "firefox";

  return "other";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: "copy-url";
}

function getBrowserLabel(browser: BrowserType): string {
  switch (browser) {
    case "safari": return "Safari";
    case "chrome-ios": return "Chrome (iPhone)";
    case "chrome-android": return "Chrome (Android)";
    case "chrome-desktop": return "Chrome";
    case "samsung": return "Samsung Internet";
    case "edge": return "Edge";
    case "firefox": return "Firefox";
    default: return "your browser";
  }
}

function getSteps(browser: BrowserType): Step[] {
  switch (browser) {
    case "safari":
      return [
        {
          icon: <Share className="h-6 w-6" />,
          title: "Tap the Share button",
          description: "It's the square with an arrow at the bottom of Safari",
        },
        {
          icon: <ArrowDown className="h-6 w-6" />,
          title: "Scroll down and tap \"Add to Home Screen\"",
          description: "You may need to scroll down in the share sheet to find it",
        },
        {
          icon: <Plus className="h-6 w-6" />,
          title: "Tap \"Add\"",
          description: "PayLane will appear as an app icon on your home screen",
        },
      ];

    case "chrome-ios":
      return [
        {
          icon: <Share className="h-6 w-6" />,
          title: "Tap the Share button",
          description: "It's the square with an arrow at the top-right of Chrome",
        },
        {
          icon: <ArrowDown className="h-6 w-6" />,
          title: "Tap \"Add to Home Screen\"",
          description: "Scroll down in the share sheet if you don't see it",
        },
        {
          icon: <Plus className="h-6 w-6" />,
          title: "Tap \"Add\"",
          description: "PayLane will appear as an app icon on your home screen",
        },
      ];

    case "chrome-android":
      return [
        {
          icon: <MoreVertical className="h-6 w-6" />,
          title: "Tap the menu button (three dots)",
          description: "It's in the top-right corner of Chrome",
        },
        {
          icon: <Download className="h-6 w-6" />,
          title: "Tap \"Install app\" or \"Add to Home screen\"",
          description: "You'll see one of these options in the menu",
        },
        {
          icon: <Smartphone className="h-6 w-6" />,
          title: "Tap \"Install\"",
          description: "PayLane will appear in your app drawer and home screen",
        },
      ];

    case "samsung":
      return [
        {
          icon: <MoreVertical className="h-6 w-6" />,
          title: "Tap the menu (three lines)",
          description: "It's at the bottom-right of Samsung Internet",
        },
        {
          icon: <Plus className="h-6 w-6" />,
          title: "Tap \"Add page to\" then \"Home screen\"",
          description: "This adds PayLane as a shortcut",
        },
        {
          icon: <Smartphone className="h-6 w-6" />,
          title: "Done!",
          description: "Open PayLane directly from your home screen",
        },
      ];

    case "chrome-desktop":
    case "edge":
      return [
        {
          icon: <Monitor className="h-6 w-6" />,
          title: "Look for the install icon in the address bar",
          description: "You'll see a \"+\" or download icon on the right side of the URL bar",
        },
        {
          icon: <Download className="h-6 w-6" />,
          title: "Click \"Install\"",
          description: "A prompt will ask to install PayLane",
        },
        {
          icon: <Smartphone className="h-6 w-6" />,
          title: "Done!",
          description: "PayLane opens as a standalone app window",
        },
      ];

    case "firefox":
      return [
        {
          icon: <MoreVertical className="h-6 w-6" />,
          title: "Firefox doesn't support app installation",
          description: "For the best experience, open PayLane in Chrome or Safari",
          action: "copy-url",
        },
      ];

    default:
      return [
        {
          icon: <Copy className="h-6 w-6" />,
          title: "Open in Chrome or Safari",
          description: "Copy the URL below and open it in Chrome or Safari for the best experience",
          action: "copy-url",
        },
      ];
  }
}

export function PWAInstallGuide({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [browser, setBrowser] = useState<BrowserType>("other");
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBrowser(detectBrowser());
    setAlreadyInstalled(isStandalone());
  }, []);

  const steps = getSteps(browser);
  const browserLabel = getBrowserLabel(browser);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  if (alreadyInstalled) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <Smartphone className="h-7 w-7 text-green-600" />
            </div>
            <DialogTitle className="text-xl">Already Installed!</DialogTitle>
            <DialogDescription>
              PayLane is already installed as an app on your device.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center pt-2">
            <Button onClick={() => onOpenChange(false)}>Got it</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100">
            <Smartphone className="h-7 w-7 text-blue-600" />
          </div>
          <DialogTitle className="text-xl">Add PayLane to Home Screen</DialogTitle>
          <DialogDescription>
            Get the full app experience — instant access and push notifications.
            <br />
            <span className="mt-1 inline-block text-xs">
              Detected: {browserLabel}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {steps.map((step, i) => (
            <div key={i}>
              <div className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  {step.icon}
                </div>
                <div className="flex-1 pt-0.5">
                  <p className="text-sm font-semibold">
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                      {i + 1}
                    </span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
                </div>
              </div>
              {step.action === "copy-url" && (
                <div className="ml-14 mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyUrl}
                    className="gap-2"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied!" : "Copy PayLane URL"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Skip for now
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Small banner component for the dashboard to prompt install
 */
export function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (localStorage.getItem("pwa-install-dismissed")) return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Smartphone className="h-5 w-5 text-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-900">Install PayLane as an app</p>
            <p className="text-xs text-blue-700">Get push notifications and quick access from your home screen</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-blue-600 hover:bg-blue-100"
            onClick={() => {
              setShow(false);
              localStorage.setItem("pwa-install-dismissed", "true");
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setGuideOpen(true)}>
            Install
          </Button>
        </div>
      </div>
      <PWAInstallGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
