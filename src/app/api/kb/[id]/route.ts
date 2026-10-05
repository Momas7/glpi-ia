import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/http";
import { articlePatchSchema, deleteArticle, getArticle, patchArticle } from "@/modules/kb";

type Params = { id: string };

export const GET = withAuth<Params>(async ({ user, params }) => NextResponse.json({ article: await getArticle(user, params.id) }));

export const PATCH = withAuth<Params>(async ({ req, user, params }) => {
  const patch = articlePatchSchema.parse(await readJson(req));
  return NextResponse.json({ article: await patchArticle(user, params.id, patch) });
});

export const DELETE = withAuth<Params>(async ({ user, params }) => {
  await deleteArticle(user, params.id);
  return NextResponse.json({ ok: true });
});
