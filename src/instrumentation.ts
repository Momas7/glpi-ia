/** Valida o ambiente quando o servidor Next sobe (não roda durante o build). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("@/lib/config");
    getConfig();
  }
}
