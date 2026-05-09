import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { invoiceRouter } from "./routers/invoice";
import { customerRouter } from "./routers/customer";
import { supplierRouter } from "./routers/supplier";
import { notificationRouter } from "./routers/notification";
import { dashboardRouter } from "./routers/dashboard";
import { onboardingRouter } from "./routers/onboarding";
import { adminRouter } from "./routers/admin";
import { featureFlagRouter } from "./routers/featureFlag";
import { subscriptionRouter } from "./routers/subscription";

export const appRouter = createTRPCRouter({
  invoice: invoiceRouter,
  customer: customerRouter,
  supplier: supplierRouter,
  notification: notificationRouter,
  dashboard: dashboardRouter,
  onboarding: onboardingRouter,
  admin: adminRouter,
  featureFlag: featureFlagRouter,
  subscription: subscriptionRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
