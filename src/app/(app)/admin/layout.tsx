import Link from "next/link";
import { assertAdminPage } from "@/lib/admin-guard";
import { requireUser } from "@/lib/server-session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  assertAdminPage(await requireUser());
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 border-b border-white/10 pb-3 text-sm">
        <h1 className="text-xl font-semibold">Administração</h1>
        <Link href="/admin/usuarios" className="text-muted-foreground hover:text-foreground">
          Usuários
        </Link>
        <Link href="/admin/equipes" className="text-muted-foreground hover:text-foreground">
          Equipes e categorias
        </Link>
        <Link href="/admin/integracoes" className="text-muted-foreground hover:text-foreground">
          Integrações
        </Link>
      </div>
      {children}
    </div>
  );
}
