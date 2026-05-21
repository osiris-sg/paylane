import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { requireSendAccess } from "~/server/api/lib/sending-access";
import { buildKey, presignUpload } from "~/lib/storage";

const ALLOWED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
] as const;

export const storageRouter = createTRPCRouter({
  /**
   * Returns a short-lived presigned PUT URL so the browser can upload a file
   * straight to S3 (avoids routing multi-MB files through the serverless
   * function). The caller then stores the returned `key` in the row's fileUrl.
   */
  createUploadUrl: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["invoices", "statements"]),
        contentType: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireSendAccess(ctx.db, ctx.user.companyId);

      if (!(ALLOWED_TYPES as readonly string[]).includes(input.contentType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported file type.",
        });
      }

      const key = buildKey(input.kind, ctx.user.companyId, input.contentType);
      const url = await presignUpload(key, input.contentType);
      return { key, url };
    }),
});
