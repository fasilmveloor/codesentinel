import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import pkg from "../../../package.json";

export async function GET() {
  const checks: Record<string, unknown> = {
    status: "ok",
    service: "codesentinel",
    version: pkg.version || "0.2.0",
  };

  // Database connectivity check
  try {
    const start = Date.now();
    await db.appConfig.findFirst({ select: { id: true } });
    checks.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = {
      status: "unhealthy",
      error: err instanceof Error ? err.message : "Database connection failed",
    };
    checks.status = "degraded";
  }

  // Rate limiter check (best-effort)
  try {
    const { getRateLimitStats } = await import("@/lib/rate-limit");
    const stats = await getRateLimitStats();
    checks.rateLimiter = { status: "healthy" };
    checks.rateLimitStats = {
      activeEntries: stats.active,
      expiredEntries: stats.expired,
    };
  } catch {
    checks.rateLimiter = { status: "unhealthy" };
    checks.status = "degraded";
  }

  const statusCode = checks.status === "ok" ? 200 : 503;
  return NextResponse.json(checks, { status: statusCode });
}
