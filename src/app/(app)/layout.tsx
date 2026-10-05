import { AppSidebar } from "@/components/AppSidebar";
import { ROLE_LABEL } from "@/lib/labels";
import { buildNavItems } from "@/lib/nav";
import { requireUser } from "@/lib/server-session";

// Telas de trabalho (lista e detalhe) ficam sem fundos animados, de propósito.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <AppSidebar items={buildNavItems(user)} userName={user.name} roleLabel={ROLE_LABEL[user.role]} />
      <main className="min-w-0 flex-1 p-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
