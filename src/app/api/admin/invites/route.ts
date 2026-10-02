import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/http";
import { listPendingInvites } from "@/modules/admin";

export const GET = withAdmin(async ({ user }) => NextResponse.json({ invites: await listPendingInvites(user) }));
