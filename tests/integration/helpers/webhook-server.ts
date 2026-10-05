import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export interface ReceivedWebhook {
  headers: Record<string, string>;
  body: string;
}

/** Servidor HTTP local que faz o papel do n8n nos testes. `respond` decide o status (ou demora). */
export async function startWebhookServer(respond: (req: ReceivedWebhook, n: number) => number | Promise<number> = () => 200) {
  const received: ReceivedWebhook[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const hit: ReceivedWebhook = { headers: req.headers as Record<string, string>, body };
    received.push(hit);
    const status = await state.respond(hit, received.length);
    res.writeHead(status).end();
  });
  const state = { respond };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/webhook`,
    received,
    setRespond: (fn: typeof respond) => void (state.respond = fn),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
