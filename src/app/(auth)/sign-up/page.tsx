"use client";

import { useState, useEffect } from "react";
import { useSignUp, useAuth } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { Loader2, Mail, Lock, Eye, EyeOff, User, LockKeyhole } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";

function SignUpForm() {
  const { signUp, setActive, isLoaded } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // If already signed in, go to dashboard
  useEffect(() => {
    if (isSignedIn) {
      router.replace(typeof window !== "undefined" && localStorage.getItem("paylane:pending-invite-token") ? "/invoices/accept-invite" : "/dashboard");
    }
  }, [isSignedIn, router]);

  const prefilledEmail = searchParams.get("email") ?? "";
  const inviteToken = searchParams.get("invite") ?? "";
  const isEmailLocked = !!prefilledEmail;

  // Stash the invite token in sessionStorage so it survives the Clerk
  // verification + onboarding chain; it gets consumed by /invoices/accept-invite.
  useEffect(() => {
    if (inviteToken && typeof window !== "undefined") {
      localStorage.setItem("paylane:pending-invite-token", inviteToken);
    }
  }, [inviteToken]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (prefilledEmail) setEmail(prefilledEmail);
  }, [prefilledEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;

    setError("");
    setLoading(true);

    try {
      // If there's a stale sign-up attempt, clear it by creating fresh
      if (signUp.status !== null) {
        console.log("[SignUp] Clearing stale sign-up state:", signUp.status);
      }

      console.log("[SignUp] Creating account with:", { email, firstName, lastName });
      const createResult = await signUp.create({
        emailAddress: email,
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      console.log("[SignUp] Create result:", createResult.status);

      if (createResult.status === "complete") {
        console.log("[SignUp] Complete immediately, setting session...");
        await setActive({ session: createResult.createdSessionId });
        router.replace(typeof window !== "undefined" && localStorage.getItem("paylane:pending-invite-token") ? "/invoices/accept-invite" : "/dashboard");
        return;
      }

      console.log("[SignUp] Preparing email verification...");
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      console.log("[SignUp] Verification email sent");
      setVerifying(true);
    } catch (err: unknown) {
      console.error("[SignUp] Error:", err);
      const clerkError = err as { errors?: { message: string; code: string; longMessage: string }[] };
      const errorCode = clerkError.errors?.[0]?.code;
      console.error("[SignUp] Clerk error code:", errorCode);

      // If client state is invalid, the user needs to clear cookies
      if (errorCode === "client_state_invalid") {
        setError("Session expired. Please clear your browser cookies for this site and try again.");
      } else if (errorCode === "form_identifier_exists") {
        setError("An account with this email already exists. Please sign in instead.");
      } else {
        setError(clerkError.errors?.[0]?.longMessage ?? clerkError.errors?.[0]?.message ?? "Sign up failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded || !signUp) return;

    setError("");
    setLoading(true);

    try {
      console.log("[SignUp] Attempting verification with code:", code);
      const result = await signUp.attemptEmailAddressVerification({ code });
      console.log("[SignUp] Verification result:", result.status, result);

      if (result.status === "complete") {
        console.log("[SignUp] Verification complete, setting active session...");
        await setActive({ session: result.createdSessionId });
        console.log("[SignUp] Session active, redirecting to dashboard");
        router.replace(typeof window !== "undefined" && localStorage.getItem("paylane:pending-invite-token") ? "/invoices/accept-invite" : "/dashboard");
      } else {
        console.log("[SignUp] Verification not complete, status:", result.status);
      }
    } catch (err: unknown) {
      console.error("[SignUp] Verification error:", err);
      const clerkError = err as { errors?: { message: string; code: string; longMessage: string }[] };
      console.error("[SignUp] Clerk errors:", JSON.stringify(clerkError.errors, null, 2));
      setError(clerkError.errors?.[0]?.longMessage ?? clerkError.errors?.[0]?.message ?? "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Verification code screen
  if (verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100 px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-blue-600">PayLane</h1>
          </div>

          <Card className="shadow-lg">
            <CardHeader className="pb-4 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <Mail className="h-6 w-6 text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                We sent a verification code to <strong>{email}</strong>
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerify} className="space-y-4">
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="code">Verification Code</Label>
                  <Input
                    id="code"
                    placeholder="Enter 6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="text-center text-lg tracking-widest"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {loading ? "Verifying..." : "Verify Email"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Sign up form
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-blue-600">PayLane</h1>
          <p className="mt-1 text-sm text-muted-foreground">Invoice management made simple</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-4 text-center">
            <h2 className="text-xl font-semibold">Create your account</h2>
            <p className="text-sm text-muted-foreground">
              {isEmailLocked
                ? "Complete your signup to start managing invoices"
                : "Get started with PayLane"}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="firstName"
                      placeholder="John"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    placeholder="Doe"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  {isEmailLocked ? (
                    <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  ) : (
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  )}
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => !isEmailLocked && setEmail(e.target.value)}
                    className={`pl-10 ${isEmailLocked ? "cursor-not-allowed bg-gray-50 text-gray-600" : ""}`}
                    readOnly={isEmailLocked}
                    required
                  />
                </div>
                {isEmailLocked && (
                  <p className="text-xs text-muted-foreground">
                    This email was provided by your invitation
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loading ? "Creating account..." : "Create Account"}
              </Button>
            </form>

            <Separator className="my-6" />

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/sign-in" className="font-medium text-blue-600 hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          PayLane - Get paid faster
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-gray-100">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    }>
      <SignUpForm />
    </Suspense>
  );
}
