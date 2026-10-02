import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/http";
import { listUsers } from "@/modules/admin";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).default(50).transform((n) => Math.min(n, 100)),
  q: z.string().trim().max(200).optional(),
});

export const GET = withAdmin(async ({ req, user }) => {
  const query = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await listUsers(user, query));
});
