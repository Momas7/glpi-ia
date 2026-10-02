import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import { ForbiddenError, TicketNotFoundError, getTicket } from "./service";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type Sniff = (data: Uint8Array) => boolean;

const startsWith = (...bytes: number[]): Sniff => (d) => bytes.every((b, i) => d[i] === b);

const isPlainText: Sniff = (d) => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(d);
    // sem NUL nem controles além de \t \n \r
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
};

// Tipos permitidos: extensão → (tipo gravado, conferência do conteúdo real pelos primeiros bytes)
const ALLOWED: Record<string, { mime: string; sniff: Sniff }> = {
  png: { mime: "image/png", sniff: startsWith(0x89, 0x50, 0x4e, 0x47) },
  jpg: { mime: "image/jpeg", sniff: startsWith(0xff, 0xd8, 0xff) },
  jpeg: { mime: "image/jpeg", sniff: startsWith(0xff, 0xd8, 0xff) },
  pdf: { mime: "application/pdf", sniff: startsWith(0x25, 0x50, 0x44, 0x46) },
  txt: { mime: "text/plain", sniff: isPlainText },
  log: { mime: "text/plain", sniff: isPlainText },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sniff: startsWith(0x50, 0x4b, 0x03, 0x04),
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sniff: startsWith(0x50, 0x4b, 0x03, 0x04),
  },
};

export class InvalidAttachmentError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}
export class AttachmentTooLargeError extends AppError {
  constructor() {
    super(413, "Arquivo maior que o limite de 10 MB.");
  }
}

// O diretório de uploads é configurável e fica fora do bundle: os comentários evitam que o build rastreie o projeto inteiro.
const uploadDir = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? "./uploads");

/** Só o nome base, sem separadores nem caracteres de controle; usado apenas para exibição. */
function displayName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "arquivo";
  return base.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "arquivo";
}

/** Confere visibilidade e permissão ANTES de ler o corpo da requisição. */
export async function assertCanAttach(actor: SessionUser, ticketId: string): Promise<void> {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  if (!can(actor, "attachment:add", ticket)) throw new ForbiddenError();
}

export async function saveAttachment(
  actor: SessionUser,
  ticketId: string,
  file: { name: string; size: number; data: Uint8Array },
) {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  if (!can(actor, "attachment:add", ticket)) throw new ForbiddenError();

  if (file.size > MAX_ATTACHMENT_BYTES || file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError();
  }
  const filename = displayName(file.name);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const rule = ALLOWED[ext];
  if (!rule) throw new InvalidAttachmentError("Tipo de arquivo não permitido.");
  if (!rule.sniff(file.data)) throw new InvalidAttachmentError("O conteúdo do arquivo não corresponde à extensão.");

  // O nome gravado é gerado aqui; o nome original nunca entra no caminho.
  const storedName = `${randomUUID()}.${ext}`;
  const dir = uploadDir();
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, storedName), file.data, { flag: "wx" });

  return getDb().attachment.create({
    data: {
      ticketId,
      uploaderId: actor.id,
      filename,
      storedName,
      mimeType: rule.mime,
      size: file.data.byteLength,
    },
  });
}

export async function listAttachments(actor: SessionUser, ticketId: string) {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  return getDb().attachment.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } });
}

export async function getAttachmentFile(actor: SessionUser, ticketId: string, attachmentId: string) {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  const attachment = await getDb().attachment.findFirst({ where: { id: attachmentId, ticketId } });
  if (!attachment) throw new AppError(404, "Anexo não encontrado.");
  const data = await readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ uploadDir(), attachment.storedName));
  return { attachment, data };
}
