import { AppSidebar } from "@/components/AppSidebar";
import { AppTopbar } from "@/components/AppTopbar";
import { IncidentBanner } from "@/components/IncidentBanner";
import { ROLE_LABEL } from "@/lib/labels";
import { buildNavItems } from "@/lib/nav";
import { requireUser } from "@/lib/server-session";
import { getOpenIncidentBanner } from "@/modules/ai";

// Telas de trabalho (lista e detalhe) ficam sem fundos animados, de propósito.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const incidents = await getOpenIncidentBanner(user);
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <AppSidebar items={buildNavItems(user)} userName={user.name} roleLabel={ROLE_LABEL[user.role]} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <IncidentBanner incidents={incidents} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
