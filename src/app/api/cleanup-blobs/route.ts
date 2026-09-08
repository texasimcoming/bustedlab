import { NextRequest, NextResponse } from "next/server";

// Vercel Cron: runs daily at 03:00 UTC
// Deletes Vercel Blob uploads older than 2 hours
// These are temporary images uploaded for Google Lens reverse image search
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron or our own secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { list, del } = await import("@vercel/blob");
    const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const { blobs, cursor: nextCursor } = await list({
        limit: 100,
        cursor,
      });

      const toDelete = blobs.filter(blob => {
        const uploaded = new Date(blob.uploadedAt).getTime();
        return uploaded < cutoff;
      });

      if (toDelete.length > 0) {
        await del(toDelete.map(b => b.url));
        deleted += toDelete.length;
      }

      cursor = nextCursor;
    } while (cursor);

    return NextResponse.json({ deleted, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("Blob cleanup error:", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
