import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

export async function GET() {
  try {
    await Promise.race([
      getDb().$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS),
      ),
    ]);
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (err) {
    logger.error({ err }, "health check: banco inacessível");
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
