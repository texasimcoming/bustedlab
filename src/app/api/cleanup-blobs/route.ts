import { NextRequest, NextResponse } from "next/server";
import { LENS_BLOB_PREFIX } from "@/lib/constants";
import crypto from "crypto";

// Vercel Cron: runs daily at 03:00 UTC.
//
// Backstop only. The scan pipeline deletes each Lens upload the moment the
// reverse-image call that needed it returns, so in normal operation this
// finds nothing. It exists to catch the uploads left behind when a request
// crashed or timed out between the upload and the delete.
export const maxDuration = 60;

// Anything older than this that still exists is, by definition, orphaned:
// no scan runs for an hour.
const ORPHAN_AGE_MS = 60 * 60 * 1000;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // FAIL CLOSED. With no secret configured the previous version compared
  // against the literal string "Bearer undefined", which anyone could send.
  if (!secret) return false;
  const provided = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { list, del } = await import("@vercel/blob");
    const cutoff = Date.now() - ORPHAN_AGE_MS;
    let deleted = 0;
    let cursor: string | undefined;

    do {
      // Scoped to the scan pipeline's own prefix. Listing the whole store
      // and deleting everything past a cutoff would take any other blob the
      // project ever stores with it.
      const { blobs, cursor: nextCursor } = await list({
        limit: 100,
        cursor,
        prefix: LENS_BLOB_PREFIX,
      });

      const toDelete = blobs.filter(blob => new Date(blob.uploadedAt).getTime() < cutoff);

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
