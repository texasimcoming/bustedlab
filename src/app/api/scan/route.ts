import { NextRequest, NextResponse } from "next/server";
import { scanProduct, scanProductUrl, getUnresolvedResult } from "@/lib/scan";
import { getScansRemaining, incrementScanCount, incrementTotalScans, getTotalScans, isPaidUser } from "@/lib/redis";
import { cookies } from "next/headers";
import { Redis } from "@upstash/redis";

// Vision extraction (~2-8s) + Lens/Shopping search (~2-14s) + parallel
// verification (~2-10s) can add up past Vercel's default function
// duration. This requires a plan that supports the value below —
// confirm your Vercel plan's max before relying on it; Hobby plans cap
// lower than Pro. If scans are timing out in production, check this first.
export const maxDuration = 60;

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Browser fingerprint from cookie - persists across IP changes on mobile
async function getBrowserId(req: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("bl_bid")?.value || null;
}

const GLOBAL_DAILY_CAP = 500;

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  });
}

function getDailyKey(): string {
  return `global_scans:${new Date().toISOString().split("T")[0]}`;
}

async function getGlobalScansToday(): Promise<number> {
  try {
    return (await getRedis().get<number>(getDailyKey())) || 0;
  } catch {
    return 0;
  }
}

async function incrementGlobalScans(): Promise<void> {
  try {
    const redis = getRedis();
    const key = getDailyKey();
    await redis.incr(key);
    const midnight = new Date();
    midnight.setUTCHours(23, 59, 59, 999);
    await redis.expireat(key, Math.floor(midnight.getTime() / 1000));
  } catch { /* silent fail */ }
}

// GET - check remaining scans + real total scan count
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const cookieStore = await cookies();
  const sessionEmail = cookieStore.get("bl_session")?.value;

  try {
    if (sessionEmail) {
      const paid = await isPaidUser(sessionEmail);
      if (paid) {
        const totalScans = await getTotalScans();
        return NextResponse.json({ isPaid: true, remaining: 999, totalScans });
      }
    }
    const [remaining, totalScans] = await Promise.all([
      getScansRemaining(ip),
      getTotalScans(),
    ]);
    return NextResponse.json({ isPaid: false, remaining, totalScans });
  } catch {
    return NextResponse.json({ isPaid: false, remaining: 2, totalScans: 0 });
  }
}

// POST - run scan
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const cookieStore = await cookies();
  const sessionEmail = cookieStore.get("bl_session")?.value;

  let isPaid = false;
  try {
    if (sessionEmail) isPaid = await isPaidUser(sessionEmail);
  } catch { /* treat as free */ }

  // Browser fingerprint - secondary rate limit for mobile IP changers
  const browserId = await getBrowserId(req);

  if (!isPaid) {
    try {
      const remaining = await getScansRemaining(ip);
      if (remaining <= 0) {
        return NextResponse.json({ error: "scan_limit_reached" }, { status: 429 });
      }
    } catch { /* allow */ }

    try {
      const globalCount = await getGlobalScansToday();
      if (globalCount >= GLOBAL_DAILY_CAP) {
        return NextResponse.json({ error: "high_demand" }, { status: 503 });
      }
    } catch { /* allow */ }
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let result;

    if (contentType.includes("application/json")) {
      const { url, intent } = await req.json();
      if (!url) return NextResponse.json({ error: "URL required" }, { status: 400 });
      result = await scanProductUrl(url, intent as "verdict" | "finder" | null);
    } else {
      const formData = await req.formData();
      const imageFile = formData.get("image") as File | null;
      if (!imageFile) return NextResponse.json({ error: "Image required" }, { status: 400 });
      const base64 = Buffer.from(await imageFile.arrayBuffer()).toString("base64");
      const intent = formData.get("intent") as string | null;
      result = await scanProduct(base64, imageFile.type || "image/jpeg", intent as "verdict" | "finder" | null);
    }

    // Track usage
    if (!isPaid) {
      try { await incrementScanCount(ip); } catch { /* ignore */ }
      if (browserId) {
        try { await incrementScanCount(`browser:${browserId}`); } catch { /* ignore */ }
      }
      try { await incrementGlobalScans(); } catch { /* ignore */ }
    }
    // Always increment total — every real scan counts regardless of paid status
    try { await incrementTotalScans(); } catch { /* ignore */ }

    const response = NextResponse.json(result);
    // Set browser fingerprint cookie if not already set
    if (!browserId) {
      const newBid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      response.cookies.set("bl_bid", newBid, {
        maxAge: 60 * 60 * 24 * 30, // 30 days
        httpOnly: true,
        sameSite: "lax",
        secure: true,
      });
    }
    return response;
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json(getUnresolvedResult());
  }
}

// PATCH - check session
export async function PATCH() {
  const cookieStore = await cookies();
  const sessionEmail = cookieStore.get("bl_session")?.value;
  if (!sessionEmail) return NextResponse.json({ authenticated: false });
  try {
    const paid = await isPaidUser(sessionEmail);
    return NextResponse.json({ authenticated: true, email: sessionEmail, paid });
  } catch {
    return NextResponse.json({ authenticated: true, email: sessionEmail, paid: false });
  }
}
