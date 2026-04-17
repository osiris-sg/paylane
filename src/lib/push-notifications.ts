import webpush from "web-push";
import { db } from "~/lib/db";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

function getVapidSubject(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && appUrl.startsWith("https://")) return appUrl;
  return "mailto:admin@osiris.sg";
}

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(getVapidSubject(), vapidPublicKey, vapidPrivateKey);
  console.log("[Push] VAPID configured");
} else {
  console.warn("[Push] VAPID keys not configured — push notifications disabled");
}

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
  renotify?: boolean;
}

/**
 * Send push notification to a specific user (all their devices)
 */
export async function sendPushNotification(
  clerkId: string,
  payload: NotificationPayload,
): Promise<{ success: boolean; sent: number; failed: number }> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return { success: false, sent: 0, failed: 0 };
  }

  try {
    const subscriptions = await db.pushSubscription.findMany({
      where: { clerkId },
    });

    if (subscriptions.length === 0) {
      return { success: true, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const failedEndpoints: string[] = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          { TTL: 3600 },
        );
        sent++;
      } catch (error: unknown) {
        const webPushError = error as { statusCode?: number };
        if (webPushError.statusCode === 404 || webPushError.statusCode === 410) {
          failedEndpoints.push(sub.endpoint);
        } else {
          console.error(`[Push] Error sending to ${sub.endpoint}:`, error);
        }
        failed++;
      }
    }

    if (failedEndpoints.length > 0) {
      await db.pushSubscription.deleteMany({
        where: { endpoint: { in: failedEndpoints } },
      });
    }

    return { success: true, sent, failed };
  } catch (error) {
    console.error("[Push] Error:", error);
    return { success: false, sent: 0, failed: 0 };
  }
}

/**
 * Send push notification to all users of a company
 */
export async function sendPushToCompany(
  companyId: string,
  payload: NotificationPayload,
): Promise<{ sent: number; failed: number }> {
  const users = await db.user.findMany({
    where: { companyId },
    select: { clerkId: true },
  });

  let totalSent = 0;
  let totalFailed = 0;

  for (const user of users) {
    const result = await sendPushNotification(user.clerkId, payload);
    totalSent += result.sent;
    totalFailed += result.failed;
  }

  return { sent: totalSent, failed: totalFailed };
}
