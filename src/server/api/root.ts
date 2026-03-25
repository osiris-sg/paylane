import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { invoiceRouter } from "./routers/invoice";
import { customerRouter } from "./routers/customer";
import { notificationRouter } from "./routers/notification";
import { dashboardRouter } from "./routers/dashboard";

export const appRouter = createTRPCRouter({
  invoice: invoiceRouter,
  customer: customerRouter,
  notification: notificationRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
