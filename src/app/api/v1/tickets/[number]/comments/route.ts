import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withApiKey } from "@/lib/http";
import { addCommentFromApi } from "@/modules/tickets";

const bodySchema = z.object({
  authorEmail: z.string().email().max(254),
  body: z.string().trim().min(1).max(10_000),
  externalRef: z.string().trim().min(1).max(500).optional(),
});
const numberSchema = z.coerce.number().int().positive();

type Params = { number: string };

export const POST = withApiKey<Params>("comments:create", async ({ req, apiKey, params }) => {
  const ticketNumber = numberSchema.parse(params.number);
  const input = bodySchema.parse(await readJson(req));
  const result = await addCommentFromApi(apiKey, ticketNumber, input);
  return NextResponse.json({ comment: result.comment }, { status: result.created ? 201 : 200 });
});
