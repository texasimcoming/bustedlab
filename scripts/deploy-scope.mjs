/**
 * Whether a production deploy needs the watchdog's paid diagnose, from the
 * list of files it changed (one per line, in the file named as the first
 * argument). Prints "diagnose=true" or "diagnose=false" for $GITHUB_OUTPUT,
 * and says why in the job summary. See deployNeedsDiagnose.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { deployNeedsDiagnose } from "./lib/autopilot.mjs";

let files = [];
try {
  files = readFileSync(process.argv[2], "utf8").split("\n");
} catch {
  files = [];
}
const diagnose = deployNeedsDiagnose(files);
const changed = files.map(f => f.trim()).filter(Boolean);
const why = diagnose
  ? `Diagnose: this deploy changed ${changed.length ? `${changed.length} file(s), not only docs, reports or workflows` : "files that could not be listed"}.`
  : `No paid diagnose: this deploy changed only docs, reports or workflow files (${changed.length}); the free checks still run.`;
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${why}\n`);
console.error(why);
console.log(`diagnose=${diagnose}`);
