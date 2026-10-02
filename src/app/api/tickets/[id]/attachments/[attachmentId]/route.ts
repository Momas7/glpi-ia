import { withAuth } from "@/lib/http";
import { getAttachmentFile } from "@/modules/tickets";

type Params = { id: string; attachmentId: string };

export const GET = withAuth<Params>(async ({ user, params }) => {
  const { attachment, data } = await getAttachmentFile(user, params.id, params.attachmentId);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": attachment.mimeType,
      "content-length": String(data.byteLength),
      // nunca exibir inline: evita que conteúdo enviado por usuário execute no domínio do app
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
});
