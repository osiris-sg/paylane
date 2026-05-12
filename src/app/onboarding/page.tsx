"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PWAInstallGuide, isStandalone as isStandaloneCheck } from "~/components/pwa-install-guide";
import {
  Building2,
  Mail,
  Plus,
  Trash2,
  Send as SendIcon,
  ArrowRight,
  ArrowLeft,
  Check,
  Users,
  Sparkles,
  MessageCircle,
} from "lucide-react";

import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Badge } from "~/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

interface SupplierRow {
  id: number;
  companyName: string;
  email: string;
  contactName: string;
}

const COUNTRY_CODES = [
  { code: "+65", country: "Singapore", short: "SG" },
  { code: "+60", country: "Malaysia", short: "MY" },
  { code: "+1", country: "United States", short: "US" },
  { code: "+44", country: "United Kingdom", short: "UK" },
  { code: "+61", country: "Australia", short: "AU" },
  { code: "+81", country: "Japan", short: "JP" },
  { code: "+82", country: "South Korea", short: "KR" },
  { code: "+86", country: "China", short: "CN" },
  { code: "+91", country: "India", short: "IN" },
  { code: "+852", country: "Hong Kong", short: "HK" },
  { code: "+886", country: "Taiwan", short: "TW" },
  { code: "+62", country: "Indonesia", short: "ID" },
  { code: "+63", country: "Philippines", short: "PH" },
  { code: "+66", country: "Thailand", short: "TH" },
  { code: "+84", country: "Vietnam", short: "VN" },
  { code: "+49", country: "Germany", short: "DE" },
  { code: "+33", country: "France", short: "FR" },
  { code: "+39", country: "Italy", short: "IT" },
  { code: "+34", country: "Spain", short: "ES" },
  { code: "+31", country: "Netherlands", short: "NL" },
  { code: "+46", country: "Sweden", short: "SE" },
  { code: "+41", country: "Switzerland", short: "CH" },
  { code: "+971", country: "UAE", short: "AE" },
  { code: "+966", country: "Saudi Arabia", short: "SA" },
  { code: "+55", country: "Brazil", short: "BR" },
  { code: "+52", country: "Mexico", short: "MX" },
  { code: "+64", country: "New Zealand", short: "NZ" },
  { code: "+27", country: "South Africa", short: "ZA" },
  { code: "+234", country: "Nigeria", short: "NG" },
  { code: "+254", country: "Kenya", short: "KE" },
  { code: "+7", country: "Russia", short: "RU" },
  { code: "+48", country: "Poland", short: "PL" },
  { code: "+90", country: "Turkey", short: "TR" },
  { code: "+20", country: "Egypt", short: "EG" },
  { code: "+92", country: "Pakistan", short: "PK" },
  { code: "+880", country: "Bangladesh", short: "BD" },
  { code: "+94", country: "Sri Lanka", short: "LK" },
  { code: "+95", country: "Myanmar", short: "MM" },
  { code: "+856", country: "Laos", short: "LA" },
  { code: "+855", country: "Cambodia", short: "KH" },
];

function PhoneCodeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = COUNTRY_CODES.find((c) => c.code === value);

  const filtered = COUNTRY_CODES.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.code.includes(q) ||
      c.country.toLowerCase().includes(q) ||
      c.short.toLowerCase().includes(q)
    );
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[90px] shrink-0 justify-between px-2 font-normal sm:w-[105px] sm:px-2.5"
        >
          {selected ? `${selected.code} ${selected.short}` : "+65 SG"}
          <svg className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <div className="border-b px-3 py-2">
          <input
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search country or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No results</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.code}
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                  setSearch("");
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 ${
                  c.code === value ? "bg-gray-50 font-medium" : ""
                }`}
              >
                <span className="w-12 tabular-nums">{c.code}</span>
                <span className="text-muted-foreground">{c.country}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const RECEIVE_STEPS = [
  { title: "Your Company", description: "Tell us about your business" },
  { title: "Add Suppliers", description: "Invite your suppliers to get paid faster" },
  { title: "All Set!", description: "You're ready to receive invoices" },
];

const SEND_STEPS = [
  { title: "Your Company", description: "Tell us about your business" },
  { title: "All Set!", description: "You're ready to send invoices" },
];

function StepIndicator({ currentStep, steps }: { currentStep: number; steps: { title: string }[] }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              i < currentStep
                ? "bg-green-500 text-white"
                : i === currentStep
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
          </div>
          <span
            className={`hidden text-sm sm:inline ${
              i === currentStep ? "font-medium text-gray-900" : "text-gray-500"
            }`}
          >
            {step.title}
          </span>
          {i < steps.length - 1 && (
            <div className={`h-px w-8 ${i < currentStep ? "bg-green-500" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pwaGuideOpen, setPwaGuideOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true); // assume true on SSR so we don't flash the gate

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsMobile(/iphone|ipad|ipod|android/i.test(navigator.userAgent));
    const refresh = () => setIsStandalone(isStandaloneCheck());
    refresh();
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      mq.removeEventListener("change", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Company form
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [phoneCode, setPhoneCode] = useState("+65");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");

  // WhatsApp opt-in (optional, can also be set later from Notifications)
  const [wantsWhatsapp, setWantsWhatsapp] = useState(false);
  const [whatsappUseCompanyPhone, setWhatsappUseCompanyPhone] = useState(true);
  const [whatsappCode, setWhatsappCode] = useState("+65");
  const [whatsappNumber, setWhatsappNumber] = useState("");

  // Suppliers form
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([
    { id: Date.now(), companyName: "", email: "", contactName: "" },
  ]);

  // Results from invite
  const [inviteResults, setInviteResults] = useState<
    { email: string; status: "created" | "linked" | "exists" }[]
  >([]);

  const utils = api.useUtils();
  // Tracks whether we've completed onboarding from this page mount. Once true,
  // the auto-redirect-on-onboarded effect below stops firing — otherwise a
  // post-mutation cache invalidation (status flips to onboarded:true) would
  // race against the mutation's own router.push and React unmount errors.
  const justCompletedRef = useRef(false);

  // Load current company info
  const { data: status, isLoading: statusLoading } = api.onboarding.getStatus.useQuery();

  const companyModule = status?.module;
  const wasInvited = !!status?.invitedByCompanyName;
  // Show supplier invite step only for RECEIVE companies that signed up on their own (not invited)
  const showSupplierStep = !wasInvited && (companyModule === "RECEIVE" || companyModule === "BOTH");
  const steps = showSupplierStep ? RECEIVE_STEPS : SEND_STEPS;

  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!status) return;
    console.log("[Onboarding] status effect", {
      onboarded: status.onboarded,
      justCompleted: justCompletedRef.current,
      prefilled,
    });
    // If user just completed onboarding here, the mutation handler is
    // navigating — don't compete with it.
    if (status.onboarded && !justCompletedRef.current) {
      console.log("[Onboarding] already onboarded → /dashboard");
      router.replace("/dashboard");
      return;
    }
    // Prefill from invitation data (only once)
    if (!prefilled) {
      if (status.invitedByCompanyName) {
        setCompanyName(status.invitedByCompanyName);
      }
      if (status.userEmail) {
        setCompanyEmail(status.userEmail);
      }
      setPrefilled(true);
    }
  }, [status, router, prefilled]);

  const updateWhatsapp = api.notification.updateWhatsAppPreferences.useMutation({
    // Don't block onboarding if WhatsApp save fails — they can retry from
    // the Notifications page later.
    onError: (err) =>
      toast.error(
        err.message ||
          "Couldn't save WhatsApp preferences. You can set them up later from Notifications.",
      ),
  });

  const updateCompany = api.onboarding.updateCompany.useMutation({
    onSuccess: () => {
      if (showSupplierStep) {
        // RECEIVE/BOTH still has a suppliers step before the All Set screen.
        setStep(1);
        return;
      }
      // SEND-only: the only thing remaining was the "All Set + install PWA"
      // screen. If the user is already running the app as a PWA, skip
      // straight to the dashboard — no install prompt needed.
      if (isStandalone) {
        completeOnboarding.mutate();
      } else {
        setStep(1);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update company");
    },
  });

  const addSuppliers = api.onboarding.addSuppliers.useMutation({
    onSuccess: (results) => {
      setInviteResults(results);
      // Same shortcut for RECEIVE/BOTH — All Set screen exists only to
      // nudge a PWA install, which is moot once they're already in it.
      if (isStandalone) {
        completeOnboarding.mutate();
      } else {
        setStep(2);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add suppliers");
    },
  });

  const completeOnboarding = api.onboarding.complete.useMutation({
    onSuccess: () => {
      console.log("[Onboarding] complete mutation success");
      justCompletedRef.current = true;
      toast.success("Welcome to PayLane!");
      // Update the cache synchronously so the destination page's
      // OnboardingGuard sees onboarded:true without a refetch race.
      if (status) {
        console.log("[Onboarding] setting cached getStatus.onboarded=true");
        utils.onboarding.getStatus.setData(undefined, { ...status, onboarded: true });
      }
      const inviteToken =
        typeof window !== "undefined" ? localStorage.getItem("paylane:pending-invite-token") : null;
      let target = "/dashboard";
      if (inviteToken) target = "/invoices/accept-invite";
      else if (status?.firstInvoiceId) target = `/invoices/${status.firstInvoiceId}`;
      console.log("[Onboarding] post-success navigation →", target);
      router.push(target);
    },
    onError: (err) => {
      console.error("[Onboarding] complete mutation error:", err.message, err);
    },
  });

  // Show loading while checking status. MUST be after every hook above so
  // hook order stays consistent across renders — otherwise an onboarded:true
  // flip mid-session (e.g. setData after complete) skips later hooks and
  // triggers React #300.
  if (statusLoading || status?.onboarded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  // Supplier row management
  const addSupplierRow = () => {
    setSuppliers([...suppliers, { id: Date.now(), companyName: "", email: "", contactName: "" }]);
  };

  const removeSupplierRow = (id: number) => {
    if (suppliers.length <= 1) return;
    setSuppliers(suppliers.filter((s) => s.id !== id));
  };

  const updateSupplierRow = (id: number, field: keyof SupplierRow, value: string) => {
    setSuppliers(suppliers.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  // Step handlers
  const handleStep1Submit = () => {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }

    // Save WhatsApp opt-in alongside company info. Both run in parallel —
    // company-update drives the step transition, WhatsApp failure only toasts.
    if (wantsWhatsapp) {
      const sourceCode = whatsappUseCompanyPhone ? phoneCode : whatsappCode;
      const sourceNumber = whatsappUseCompanyPhone ? companyPhone : whatsappNumber;
      const digits = sourceNumber.replace(/\D/g, "");
      if (!digits) {
        toast.error(
          whatsappUseCompanyPhone
            ? "Add a company phone above or pick a different WhatsApp number."
            : "Add your WhatsApp number or uncheck the opt-in.",
        );
        return;
      }
      updateWhatsapp.mutate({
        whatsappNumber: `${sourceCode}${digits}`,
        whatsappOptIn: true,
      });
    }

    updateCompany.mutate({
      name: companyName.trim(),
      email: companyEmail.trim() || undefined,
      phone: companyPhone.trim() ? `${phoneCode} ${companyPhone.trim()}` : undefined,
      address: companyAddress.trim() || undefined,
    });
  };

  const handleStep2Submit = () => {
    const validSuppliers = suppliers.filter(
      (s) => s.companyName.trim() && s.email.trim(),
    );

    if (validSuppliers.length === 0) {
      toast.error("Add at least one supplier with a company name and email");
      return;
    }

    addSuppliers.mutate({
      suppliers: validSuppliers.map((s) => ({
        companyName: s.companyName.trim(),
        email: s.email.trim(),
        contactName: s.contactName.trim() || undefined,
      })),
    });
  };

  const handleSkipSuppliers = () => {
    setStep(2);
  };

  const handleFinish = () => {
    completeOnboarding.mutate();
  };

  // Mobile / tablet users have to install the PWA before continuing. We
  // detect standalone mode (matchMedia + iOS navigator.standalone) and gate
  // the rest of onboarding behind it. Once they open the app from their
  // home screen, isStandalone flips and they see the normal flow.
  if (isMobile && !isStandalone) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-blue-50 to-white p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Install PayLane first</h1>
            <p className="text-sm text-muted-foreground">
              On your phone, PayLane runs as an app. Install it to your home screen, then open
              it from there to finish setting up your company.
            </p>
          </div>
          <Card className="text-left">
            <CardContent className="space-y-4 pt-6">
              <Button className="w-full" size="lg" onClick={() => setPwaGuideOpen(true)}>
                Show me how
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                After you tap <strong>Add to Home Screen</strong>, open PayLane from the new
                icon — this page will continue automatically.
              </p>
            </CardContent>
          </Card>
        </div>
        <PWAInstallGuide open={pwaGuideOpen} onOpenChange={setPwaGuideOpen} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-2xl space-y-8">
        {/* Step indicator */}
        <StepIndicator currentStep={step} steps={steps} />

        {/* Step 1: Company Info */}
        {step === 0 && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Set up your company</CardTitle>
              <CardDescription>
                This is how your suppliers will see you when they receive invoices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>
                  Company Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="Acme Pte Ltd"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Company Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="accounts@acme.com"
                      type="email"
                      value={companyEmail}
                      onChange={(e) => setCompanyEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Phone</Label>
                  <div className="flex gap-1.5">
                    <PhoneCodeSelect value={phoneCode} onChange={setPhoneCode} />
                    <Input
                      placeholder="1234 5678"
                      value={companyPhone}
                      onChange={(e) => setCompanyPhone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Address</Label>
                <Textarea
                  placeholder="123 Business Park, Singapore 123456"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  rows={2}
                />
              </div>

              <Separator />

              <div className="space-y-3 rounded-lg border bg-green-50/30 p-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={wantsWhatsapp}
                    onChange={(e) => setWantsWhatsapp(e.target.checked)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium">
                        Get WhatsApp notifications
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Instant alerts when invoices arrive, payments are made, or due dates approach.
                      You can change this later from Notifications.
                    </p>
                  </div>
                </label>

                {wantsWhatsapp && (
                  <div className="grid gap-2 pl-7">
                    {companyPhone.trim() && (
                      <label className="flex items-start gap-2 cursor-pointer rounded-md border bg-white px-3 py-2">
                        <input
                          type="radio"
                          name="whatsapp-source"
                          className="mt-0.5 h-4 w-4 shrink-0"
                          checked={whatsappUseCompanyPhone}
                          onChange={() => setWhatsappUseCompanyPhone(true)}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">Same as company phone</p>
                          <p className="text-xs text-muted-foreground">
                            {phoneCode} {companyPhone}
                          </p>
                        </div>
                      </label>
                    )}

                    <label className="flex items-start gap-2 cursor-pointer rounded-md border bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="whatsapp-source"
                        className="mt-0.5 h-4 w-4 shrink-0"
                        checked={!whatsappUseCompanyPhone || !companyPhone.trim()}
                        onChange={() => setWhatsappUseCompanyPhone(false)}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Use a different number</p>
                        {(!whatsappUseCompanyPhone || !companyPhone.trim()) && (
                          <div className="mt-2 flex gap-1.5">
                            <PhoneCodeSelect value={whatsappCode} onChange={setWhatsappCode} />
                            <Input
                              placeholder="91234567"
                              value={whatsappNumber}
                              onChange={(e) => setWhatsappNumber(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        )}
                      </div>
                    </label>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button onClick={handleStep1Submit} disabled={updateCompany.isPending}>
                  {updateCompany.isPending ? "Saving..." : "Continue"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Add Suppliers (RECEIVE module only) */}
        {step === 1 && showSupplierStep && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
              <CardTitle className="text-2xl">Invite your suppliers</CardTitle>
              <CardDescription>
                Add the companies that send you invoices. We&apos;ll email them to join PayLane
                so they can get paid faster.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {suppliers.map((supplier, index) => (
                <div
                  key={supplier.id}
                  className="flex items-start gap-3 rounded-lg border bg-gray-50/50 p-3"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                    {index + 1}
                  </div>
                  <div className="grid flex-1 gap-3 sm:grid-cols-3">
                    <div className="grid gap-1">
                      <Label className="text-xs">
                        Company Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        placeholder="Supplier Co."
                        value={supplier.companyName}
                        onChange={(e) => updateSupplierRow(supplier.id, "companyName", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">
                        Email <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        type="email"
                        placeholder="accounts@supplier.com"
                        value={supplier.email}
                        onChange={(e) => updateSupplierRow(supplier.id, "email", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs">Contact Name</Label>
                      <Input
                        placeholder="John Doe"
                        value={supplier.contactName}
                        onChange={(e) => updateSupplierRow(supplier.id, "contactName", e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-5 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeSupplierRow(supplier.id)}
                    disabled={suppliers.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={addSupplierRow} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add Another Supplier
              </Button>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button variant="link" onClick={handleSkipSuppliers} className="text-muted-foreground">
                    Skip for now
                  </Button>
                </div>
                <Button onClick={handleStep2Submit} disabled={addSuppliers.isPending}>
                  <SendIcon className="mr-2 h-4 w-4" />
                  {addSuppliers.isPending ? "Sending Invites..." : "Send Invites & Continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Final Step: Done */}
        {((showSupplierStep && step === 2) || (!showSupplierStep && step === 1)) && (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <Sparkles className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle className="text-2xl">You&apos;re all set!</CardTitle>
              <CardDescription>
                {inviteResults.length > 0
                  ? `We've sent invite emails to ${inviteResults.filter((r) => r.status === "created").length} supplier(s). They'll be notified to join PayLane.`
                  : showSupplierStep
                    ? "Your company is set up. You can add suppliers anytime from the Customers page."
                    : "Your company is set up. You can start sending invoices to your customers."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Invite results */}
              {inviteResults.length > 0 && (
                <div className="space-y-2">
                  {inviteResults.map((result, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border px-4 py-2"
                    >
                      <span className="text-sm">{result.email}</span>
                      <Badge
                        variant={
                          result.status === "linked"
                            ? "default"
                            : result.status === "created"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {result.status === "linked"
                          ? "Already on PayLane"
                          : result.status === "created"
                            ? "Invite Sent"
                            : "Already Added"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              <Separator />

              <div className="flex flex-col items-center gap-3">
                {isMobile ? (
                  <>
                    <Button size="lg" onClick={() => setPwaGuideOpen(true)}>
                      Add PayLane to Home Screen
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button variant="link" size="sm" className="text-muted-foreground" onClick={handleFinish} disabled={completeOnboarding.isPending}>
                      {completeOnboarding.isPending ? "Loading..." : "Skip, go to dashboard"}
                    </Button>
                  </>
                ) : (
                  <Button size="lg" onClick={handleFinish} disabled={completeOnboarding.isPending}>
                    {completeOnboarding.isPending ? "Loading..." : "Go to Dashboard"}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <PWAInstallGuide open={pwaGuideOpen} onOpenChange={setPwaGuideOpen} onComplete={handleFinish} />
      </div>
    </div>
  );
}
