/**
 * Loads the scan engine (src/lib/scan.ts) outside Next, with the same import
 * rewrites scripts/check-identification.mjs applies: Vercel Blob is replaced
 * by an in-memory stub, and every "@/lib/x" import points at the real file.
 * Nothing else in the engine is touched, so what runs is the shipped logic.
 */
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const BLOB_STUB = `const put = async (path) => ({ url: "https://blob.test/" + path });
const del = async () => {};`;

export const localModule = (name) => pathToFileURL(join(REPO, `src/lib/${name}.ts`)).href;

export async function loadEngine(sourcePath = join(REPO, "src/lib/scan.ts"), label = "engine") {
  let src = readFileSync(sourcePath, "utf8");
  const required = [
    ['import { put, del } from "@vercel/blob";', BLOB_STUB],
    ['import { randomBytes } from "crypto";', 'import { randomBytes } from "node:crypto";'],
    ['import { LENS_BLOB_PREFIX } from "@/lib/constants";', 'const LENS_BLOB_PREFIX = "lens-scans/";'],
  ];
  for (const [from, to] of required) {
    if (!src.includes(from)) throw new Error(`${label}: cannot rewrite missing import: ${from}`);
    src = src.replace(from, to);
  }
  src = src.replace(/from "@\/lib\/([a-z0-9-]+)"/g, (_m, name) => `from "${localModule(name)}"`);
  const unresolved = src.match(/from "@\/[a-z0-9/-]+"/g);
  if (unresolved) throw new Error(`${label}: unresolved imports: ${[...new Set(unresolved)].join(", ")}`);
  const dir = mkdtempSync(join(tmpdir(), "bustedlab-engine-"));
  const file = join(dir, `${label}.ts`);
  writeFileSync(file, src, "utf8");
  return import(pathToFileURL(file).href);
}
