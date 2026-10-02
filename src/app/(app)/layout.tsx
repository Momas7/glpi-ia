import Link from "next/link";
import { LogoutButton } from "@/components/forms/LogoutButton";
import { ROLE_LABEL } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";

// Telas de trabalho (lista e detalhe) ficam sem fundos animados, de propósito.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/tickets" className="font-semibold">
            Chamados IA
          </Link>
          <Link href="/tickets" className="text-muted-foreground hover:text-foreground">
            Chamados
          </Link>
          <Link href="/tickets/new" className="text-muted-foreground hover:text-foreground">
            Novo chamado
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {user.name} · {ROLE_LABEL[user.role]}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
