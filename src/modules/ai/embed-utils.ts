import type { Prisma } from "@/generated/prisma/client";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db";
import { contentHash } from "./chunking";
import type { EmbedDeps } from "./embedding/run";

/**
 * Identifica quem gerou o vetor (provider e modelo). Entra no hash do conteúdo: vetores de modelos diferentes
 * não são comparáveis, então trocar de modelo ou de provider invalida o índice e "Reindexar tudo" refaz tudo.
 */
export function embedSignature(deps: Partial<EmbedDeps>): string {
  if (deps.model !== undefined && deps.provider !== undefined) return `${deps.provider?.name ?? "none"}|${deps.model}`;
  const config = getConfig();
  return `${deps.provider?.name ?? config.EMBEDDING_PROVIDER}|${deps.model ?? config.AI_EMBEDDING_MODEL}`;
}

export const signed = (deps: Partial<EmbedDeps>, text: string) => contentHash(`${embedSignature(deps)}\u0000${text}`);

/** Literal que o pgvector entende: "[0.1,0.2,...]". Sempre passado como parâmetro, nunca concatenado ao SQL. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * Com filtros depois do índice HNSW, a busca precisa continuar procurando até achar linhas que passem
 * (varredura iterativa do pgvector 0.8+); sem isso, conteúdo visível some atrás de muitos vizinhos filtrados.
 */
export async function enableIterativeScan(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT '[1]'::vector`; // carrega a extensão, que define o parâmetro abaixo
  const supported = await tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('hnsw.iterative_scan', true) AS v`;
  if (supported[0]?.v !== null && supported[0]?.v !== undefined) await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
}

export async function withIterativeScan<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await enableIterativeScan(tx);
    return fn(tx);
  });
}
