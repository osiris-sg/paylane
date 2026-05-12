import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    CLERK_SECRET_KEY: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Meta WhatsApp Cloud API — optional. When unset, WhatsApp sends are no-ops.
    META_WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    META_WHATSAPP_API_VERSION: z.string().optional(),
    // CloudMailin inbound email — optional. When unset, the email-ingestion endpoint and settings UI no-op.
    CLOUDMAILIN_INBOUND_ADDRESS: z.string().optional(),
    CLOUDMAILIN_BASIC_AUTH_USER: z.string().optional(),
    CLOUDMAILIN_BASIC_AUTH_PASSWORD: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: z.string().default("/sign-in"),
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: z.string().default("/sign-up"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
    META_WHATSAPP_PHONE_NUMBER_ID: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    META_WHATSAPP_ACCESS_TOKEN: process.env.META_WHATSAPP_ACCESS_TOKEN,
    META_WHATSAPP_API_VERSION: process.env.META_WHATSAPP_API_VERSION,
    CLOUDMAILIN_INBOUND_ADDRESS: process.env.CLOUDMAILIN_INBOUND_ADDRESS,
    CLOUDMAILIN_BASIC_AUTH_USER: process.env.CLOUDMAILIN_BASIC_AUTH_USER,
    CLOUDMAILIN_BASIC_AUTH_PASSWORD: process.env.CLOUDMAILIN_BASIC_AUTH_PASSWORD,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
