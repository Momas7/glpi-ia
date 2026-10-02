export interface ApiResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T & { error?: string; issues?: { field: string; message: string }[] };
}

/** Chamada JSON do navegador para as rotas /api. O Origin é enviado automaticamente pelo navegador. */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function errorMessage(result: ApiResult): string {
  const detail = result.data.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
  return detail ? `${result.data.error} ${detail}` : (result.data.error ?? "Algo deu errado. Tente novamente.");
}
