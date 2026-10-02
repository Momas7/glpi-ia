import Link from "next/link";
import { redirect } from "next/navigation";
import { JsonForm } from "@/components/forms/JsonForm";
import { getCurrentUser } from "@/lib/server-session";

export const metadata = { title: "Entrar · Chamados IA" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/tickets");
  return (
    <>
      <p className="mb-5 text-sm text-muted-foreground">Entre com seu e-mail e senha.</p>
      <JsonForm
        endpoint="/api/auth/login"
        submitLabel="Entrar"
        redirectTo="/tickets"
        fields={[
          { name: "email", label: "E-mail", type: "email", autoComplete: "username" },
          { name: "password", label: "Senha", type: "password", autoComplete: "current-password" },
        ]}
      />
      <Link href="/forgot" className="mt-4 block text-sm text-muted-foreground underline underline-offset-4">
        Esqueci minha senha
      </Link>
    </>
  );
}
