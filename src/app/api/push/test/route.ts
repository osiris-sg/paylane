import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sendPushNotification } from "~/lib/push-notifications";

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await sendPushNotification(userId, {
      title: "PayLane",
      body: "Push notifications are working! You'll receive alerts for invoices and payments.",
      url: "/dashboard",
      tag: "test-notification",
    });

    return NextResponse.json({ success: true, sent: result.sent, failed: result.failed });
  } catch (error) {
    console.error("[Push] Test error:", error);
    return NextResponse.json({ error: "Failed to send test notification" }, { status: 500 });
  }
}
