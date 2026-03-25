"use client";

import React from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TRPCReactProvider } from "~/trpc/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <Toaster richColors position="top-right" closeButton />
      <ClerkProvider>
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </ClerkProvider>
    </ThemeProvider>
  );
}
