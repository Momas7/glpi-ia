import { NextResponse } from "next/server";
import { withAuth } from "@/lib/http";
import { listPendingInvites } from "@/modules/admin";

export const GET = withAuth(async ({ user }) => NextResponse.json({ invites: await listPendingInvites(user) }));
