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
  ExternalLink,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";

type DeviceType = "ios" | "android" | "desktop";
type BrowserType = "safari" | "chrome" | "firefox" | "samsung" | "edge" | "other";

function detectDevice(): { device: DeviceType; browser: BrowserType } {
  if (typeof window === "undefined") return { device: "desktop", browser: "other" };

  const ua = navigator.userAgent.toLowerCase();

  // Device detection
  let device: DeviceType = "desktop";
  if (/iphone|ipad|ipod/.test(ua)) {
    device = "ios";
  } else if (/android/.test(ua)) {
    device = "android";
  }

  // Browser detection
  let browser: BrowserType = "other";
  if (/samsungbrowser/.test(ua)) {
    browser = "samsung";
  } else if (/edg/.test(ua)) {
    browser = "edge";
  } else if (/chrome|crios/.test(ua) && !/edg/.test(ua)) {
    browser = "chrome";
  } else if (/safari/.test(ua) && !/chrome/.test(ua)) {
    browser = "safari";
  } else if (/firefox|fxios/.test(ua)) {
    browser = "firefox";
  }

  return { device, browser };
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
}

function getSteps(device: DeviceType, browser: BrowserType): Step[] {
  if (device === "ios") {
    if (browser === "safari") {
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
    }
    // iOS Chrome/Firefox - need to use Safari
    return [
      {
        icon: <ExternalLink className="h-6 w-6" />,
        title: "Open in Safari",
        description: "On iPhone/iPad, you need Safari to add apps to your home screen. Copy this URL and open it in Safari.",
      },
      {
        icon: <Share className="h-6 w-6" />,
        title: "Tap the Share button",
        description: "It's the square with an arrow at the bottom of Safari",
      },
      {
        icon: <Plus className="h-6 w-6" />,
        title: "Tap \"Add to Home Screen\"",
        description: "Then tap Add — PayLane will appear as an app",
      },
    ];
  }

  if (device === "android") {
    if (browser === "chrome") {
      return [
        {
          icon: <MoreVertical className="h-6 w-6" />,
          title: "Tap the menu button",
          description: "It's the three dots (⋮) in the top-right corner of Chrome",
        },
        {
          icon: <Download className="h-6 w-6" />,
          title: "Tap \"Install app\" or \"Add to Home screen\"",
          description: "You'll see one of these options in the menu",
        },
        {
          icon: <Smartphone className="h-6 w-6" />,
          title: "Tap \"Install\"",
          description: "PayLane will be installed and appear in your app drawer",
        },
      ];
    }
    if (browser === "samsung") {
      return [
        {
          icon: <MoreVertical className="h-6 w-6" />,
          title: "Tap the menu button",
          description: "It's the three horizontal lines (≡) at the bottom-right",
        },
        {
          icon: <Plus className="h-6 w-6" />,
          title: "Tap \"Add page to\" → \"Home screen\"",
          description: "This adds PayLane as a shortcut to your home screen",
        },
        {
          icon: <Smartphone className="h-6 w-6" />,
          title: "Done!",
          description: "You can now open PayLane directly from your home screen",
        },
      ];
    }
    return [
      {
        icon: <MoreVertical className="h-6 w-6" />,
        title: "Tap the browser menu",
        description: "Look for the three dots or menu icon",
      },
      {
        icon: <Download className="h-6 w-6" />,
        title: "Look for \"Install\" or \"Add to Home screen\"",
        description: "The exact wording depends on your browser",
      },
      {
        icon: <Smartphone className="h-6 w-6" />,
        title: "Confirm the installation",
        description: "PayLane will appear on your home screen",
      },
    ];
  }

  // Desktop
  return [
    {
      icon: <Monitor className="h-6 w-6" />,
      title: "Look for the install icon",
      description: "In Chrome/Edge, you'll see a ⊕ or download icon in the address bar (right side)",
    },
    {
      icon: <Download className="h-6 w-6" />,
      title: "Click \"Install\"",
      description: "A prompt will appear asking to install PayLane",
    },
    {
      icon: <Smartphone className="h-6 w-6" />,
      title: "Done!",
      description: "PayLane will open as a standalone app window",
    },
  ];
}

export function PWAInstallGuide({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [info, setInfo] = useState<{ device: DeviceType; browser: BrowserType }>({
    device: "desktop",
    browser: "other",
  });
  const [alreadyInstalled, setAlreadyInstalled] = useState(false);

  useEffect(() => {
    setInfo(detectDevice());
    setAlreadyInstalled(isStandalone());
  }, []);

  const steps = getSteps(info.device, info.browser);

  const deviceLabel =
    info.device === "ios" ? "iPhone/iPad" : info.device === "android" ? "Android" : "Desktop";
  const browserLabel =
    info.browser === "safari"
      ? "Safari"
      : info.browser === "chrome"
        ? "Chrome"
        : info.browser === "samsung"
          ? "Samsung Internet"
          : info.browser === "edge"
            ? "Edge"
            : info.browser === "firefox"
              ? "Firefox"
              : "your browser";

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
            Get the full app experience — instant access, push notifications, and works offline.
            <br />
            <span className="mt-1 inline-block text-xs">
              Detected: {deviceLabel} · {browserLabel}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-4">
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
    // Don't show if already installed or if user dismissed
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
