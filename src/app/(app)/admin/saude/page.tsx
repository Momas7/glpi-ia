import { SystemHealthView } from "@/components/admin/SystemHealthView";
import { requireUser } from "@/lib/server-session";
import { getSystemOverview } from "@/modules/system";

export const metadata = { title: "Saúde do sistema · Administração" };
export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const user = await requireUser();
  const overview = await getSystemOverview(user);
  return <SystemHealthView overview={overview} />;
}
