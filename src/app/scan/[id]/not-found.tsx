import Link from "next/link";
import StatusPage from "@/components/StatusPage";

export default function ScanNotFound() {
  return (
    <StatusPage readout="0 HITS" label="NO RECORD AT THIS ADDRESS">
      <h1 className="status-title balance">This scan does not exist</h1>
      <p className="status-text">
        The link may be mistyped. Every archived scan has a permanent address, so a valid one
        never expires.
      </p>
      <Link href="/" className="btn-primary status-cta">Run a scan</Link>
    </StatusPage>
  );
}
