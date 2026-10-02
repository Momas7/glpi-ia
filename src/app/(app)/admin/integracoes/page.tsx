import { ApiKeyForm, RetryDeliveryButton, RevokeKeyButton } from "@/components/admin/ApiKeyForm";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { listApiKeys, listFailedDeliveries } from "@/modules/integrations";

export const metadata = { title: "Integrações · Administração" };

/** Mostra só o host do destino: o caminho do webhook do n8n funciona como segredo. */
function webhookHost(): string | null {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return "URL inválida";
  }
}

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [keys, failures] = await Promise.all([listApiKeys(user), listFailedDeliveries(user)]);
  const host = webhookHost();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">n8n</h2>
        {host ? (
          <p className="text-sm">
            <Badge variant="outline" className="border-0 bg-emerald-500/15 text-emerald-300">
              Configurado
            </Badge>{" "}
            Avisos enviados para <code>{host}</code>.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Não configurado: defina <code>N8N_WEBHOOK_URL</code> e <code>N8N_WEBHOOK_SECRET</code> no ambiente. Sem isso os
            avisos só vão para o log e <strong>os links de redefinição de senha não chegam a ninguém</strong> (convites
            continuam funcionando pelo link exibido ao admin).
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Chaves de API</h2>
        <ApiKeyForm />
        <ul className="flex flex-col gap-2 text-sm">
          {keys.length === 0 && <li className="text-muted-foreground">Nenhuma chave criada.</li>}
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{k.name}</span>
              <code className="text-muted-foreground">gk_{k.prefix}_…</code>
              <span className="text-muted-foreground">{k.scopes.join(", ")}</span>
              <span className="text-muted-foreground">
                {k.lastUsedAt ? `último uso ${formatDateTime(k.lastUsedAt)}` : "nunca usada"}
              </span>
              {k.revokedAt ? <Badge variant="outline">Revogada</Badge> : <RevokeKeyButton id={k.id} name={k.name} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Avisos com falha</h2>
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma falha de entrega.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {failures.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3">
                <code>{f.type}</code>
                {f.ticketNumber && <span>chamado #{f.ticketNumber}</span>}
                <span className="text-muted-foreground">
                  {f.attempts} tentativas · {f.lastError ?? "sem detalhe"} · {formatDateTime(f.createdAt)}
                </span>
                {!f.type.startsWith("auth.") && <RetryDeliveryButton id={f.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
