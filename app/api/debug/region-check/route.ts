// TEMPORARY verification route — added 2026-07-20, safe to delete once used.
//
// Purpose: prove query.wikidata.org is reachable from this project's real
// Vercel/Node runtime, not just from a browser context. Confirmed BLOCKED
// from the research sandbox with real executed output (plain `node fetch`,
// same request shape checkRegion() makes: {"reachable":false,"error":"fetch
// failed","ms":31}). Sandboxed dev/CI environments commonly restrict
// outbound network for security; production hosts like Vercel normally
// don't — but that's an expectation, not a test result, until this route
// is actually hit post-deploy.
//
// No auth: read-only, touches no user data, calls a public API and returns
// a small non-sensitive JSON result. Delete this file once the answer is
// confirmed either way — it isn't meant to be a permanent endpoint.
import { NextResponse } from "next/server";
import { checkRegion } from "@/lib/wines/region-hierarchy-checker";

export async function GET() {
  const startedAt = Date.now();
  try {
    const result = await checkRegion("Colli di Scandiano e di Canossa", "Italy");
    return NextResponse.json({
      reachableFromThisServer: true,
      elapsedMs: Date.now() - startedAt,
      result,
    });
  } catch (e) {
    return NextResponse.json(
      {
        reachableFromThisServer: false,
        elapsedMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
