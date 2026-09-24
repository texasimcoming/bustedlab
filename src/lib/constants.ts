// Values shared across route boundaries that would otherwise force a heavy
// module (the scan engine) to be imported just to read one string.

// Prefix for the temporary public uploads Google Lens needs in order to run
// a reverse-image search. The cleanup cron scopes its deletes to this prefix
// so it can never touch anything else the project stores.
export const LENS_BLOB_PREFIX = "lens-scans/";
