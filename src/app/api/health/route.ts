import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { instrument } from "@/lib/request-log";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2000;

export function GET(req: Request) {
  return instrument(req, check);
}

async function check(): Promise<Response> {
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
