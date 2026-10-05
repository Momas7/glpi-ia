/**
 * Indexa a base de conhecimento (artigos publicados e chamados resolvidos) no pgvector, em lotes e com pausa.
 * Uso: npm run ai:reindex   (usa o .env; precisa de AI_ENABLED=true e do provider de embeddings configurado).
 * Pode ser interrompido e repetido: o que já está atualizado é pulado sem gastar cota.
 */
import { reindexAll } from "../src/modules/ai";
import { getConfig } from "../src/lib/config";

const config = getConfig();
if (!config.AI_ENABLED) {
  console.error("AI_ENABLED está desligado: nada será indexado. Defina AI_ENABLED=true no .env.");
  process.exit(1);
}
console.log(`Provider de embeddings: ${config.EMBEDDING_PROVIDER} · modelo: ${config.AI_EMBEDDING_MODEL}`);
const done = await reindexAll();
console.log(`Pronto: ${done.articles} artigos, ${done.tickets} chamados resolvidos e ${done.openTickets} chamados abertos indexados (os já atualizados foram pulados).`);
process.exit(0);
