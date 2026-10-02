import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // O pg usa módulos nativos opcionais; manter fora do bundle do servidor.
  serverExternalPackages: ["pg", "pg-boss", "pino"],
};

export default nextConfig;
