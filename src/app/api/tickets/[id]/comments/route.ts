import { NextResponse } from "next/server";
import { withAuth, readJson } from "@/lib/http";
import { addComment, commentSchema, getComments } from "@/modules/tickets";

type Params = { id: string };

export const GET = withAuth<Params>(async ({ user, params }) =>
  NextResponse.json({ comments: await getComments(user, params.id) }),
);

export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const input = commentSchema.parse(await readJson(req));
  return NextResponse.json({ comment: await addComment(user, params.id, input) }, { status: 201 });
});
