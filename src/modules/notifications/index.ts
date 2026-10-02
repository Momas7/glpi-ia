import { logger } from "@/lib/logger";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type MailTransport = (mail: Mail) => Promise<void>;

/**
 * Fase 1: não há SMTP ainda (entra na Fase 2). O transporte padrão registra o e-mail em log,
 * o que serve ao desenvolvimento local. Em produção, configure o SMTP antes de depender disso.
 */
let transport: MailTransport = async (mail) => {
  logger.info({ to: mail.to, subject: mail.subject, text: mail.text }, "e-mail (transporte de log)");
};

export function setMailTransport(next: MailTransport): void {
  transport = next;
}

export function sendMail(mail: Mail): Promise<void> {
  return transport(mail);
}
