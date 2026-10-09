import Link from "next/link";
import StatusPage from "@/components/StatusPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

// Any address that is not a page. Next's default 404 is an unstyled line of
// text; somebody following a mistyped link from a post should land somewhere
// that still looks like the product and offers the one thing it does.
export default function NotFound() {
  return (
    <StatusPage readout="404" label="NOTHING AT THIS ADDRESS">
      <h1 className="status-title balance">This page does not exist</h1>
      <p className="status-text">The link may be mistyped or cut short. The scanner is one tap away.</p>
      <Link href="/" className="btn-primary status-cta">Run a scan</Link>
    </StatusPage>
  );
}
