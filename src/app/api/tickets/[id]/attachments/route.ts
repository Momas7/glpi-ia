import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { withAuth } from "@/lib/http";
import { MAX_ATTACHMENT_BYTES, listAttachments, saveAttachment } from "@/modules/tickets";

type Params = { id: string };

export const GET = withAuth<Params>(async ({ user, params }) =>
  NextResponse.json({ attachments: await listAttachments(user, params.id) }),
);

export const POST = withAuth<Params>(async ({ req, user, params }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_ATTACHMENT_BYTES + 1024 * 1024) throw new AppError(413, "Arquivo maior que o limite de 10 MB.");

  const form = await req.formData().catch(() => {
    throw new AppError(400, "Formulário inválido.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "Envie o arquivo no campo 'file'.");

  const attachment = await saveAttachment(user, params.id, {
    name: file.name,
    size: file.size,
    data: new Uint8Array(await file.arrayBuffer()),
  });
  return NextResponse.json({ attachment }, { status: 201 });
});
