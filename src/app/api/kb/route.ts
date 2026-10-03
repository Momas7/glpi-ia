import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { articleInputSchema, createArticle, listArticles } from "@/modules/kb";

export const GET = withAuth(async ({ req, user }) => {
  const q = new URL(req.url).searchParams.get("q")?.trim() || undefined;
  return NextResponse.json({ articles: await listArticles(user, { q }) });
});

export const POST = withAuth(async ({ req, user }) => {
  const input = articleInputSchema.parse(await readJson(req));
  return NextResponse.json({ article: await createArticle(user, input) }, { status: 201 });
});
