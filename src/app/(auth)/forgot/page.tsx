import Link from "next/link";
import { JsonForm } from "@/components/forms/JsonForm";

export const metadata = { title: "Recuperar senha · Chamados IA" };

export default function ForgotPage() {
  return (
    <>
      <p className="mb-5 text-sm text-muted-foreground">Informe seu e-mail para receber o link de redefinição.</p>
      <JsonForm
        endpoint="/api/auth/forgot"
        submitLabel="Enviar link"
        successMessage="Se o e-mail estiver cadastrado, enviaremos as instruções."
        fields={[{ name: "email", label: "E-mail", type: "email", autoComplete: "username" }]}
      />
      <Link href="/login" className="mt-4 block text-sm text-muted-foreground underline underline-offset-4">
        Voltar ao login
      </Link>
    </>
  );
}
