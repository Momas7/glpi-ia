import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withApiKey } from "@/lib/http";
import { createTicketFromApi } from "@/modules/tickets";

const bodySchema = z.object({
  requesterEmail: z.string().email().max(254),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  categoryName: z.string().trim().min(1).max(80).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  externalRef: z.string().trim().min(1).max(500).optional(),
});

export const POST = withApiKey("tickets:create", async ({ req, apiKey }) => {
  const input = bodySchema.parse(await readJson(req));
  const result = await createTicketFromApi(apiKey, input);
  return NextResponse.json({ ticket: result.ticket }, { status: result.created ? 201 : 200 });
});
