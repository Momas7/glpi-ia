import { NextResponse } from "next/server";
import { readBodyLimited } from "@/lib/body";
import { AppError } from "@/lib/errors";
import { withAuth } from "@/lib/http";
import { MAX_ATTACHMENT_BYTES, assertCanAttach, listAttachments, saveAttachment } from "@/modules/tickets";

type Params = { id: string };

// O corpo multipart tem um pouco de sobrecarga além do arquivo.
const MAX_BODY_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;

export const GET = withAuth<Params>(async ({ user, params }) =>
  NextResponse.json({ attachments: await listAttachments(user, params.id) }),
);

export const POST = withAuth<Params>(async ({ req, user, params }) => {
  await assertCanAttach(user, params.id); // 404/403 antes de ler qualquer byte do corpo
  const bytes = await readBodyLimited(req, MAX_BODY_BYTES);

  const form = await new Response(new Uint8Array(bytes), {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => {
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
