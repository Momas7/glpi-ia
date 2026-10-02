import { JsonForm } from "@/components/forms/JsonForm";

export const metadata = { title: "Aceitar convite · Chamados IA" };

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <p className="mb-5 text-sm text-muted-foreground">Crie sua conta a partir do convite.</p>
      {token ? (
        <JsonForm
          endpoint="/api/auth/accept-invite"
          submitLabel="Criar conta"
          hidden={{ token }}
          redirectTo="/login"
          fields={[
            { name: "name", label: "Nome", autoComplete: "name" },
            {
              name: "password",
              label: "Senha",
              type: "password",
              autoComplete: "new-password",
              hint: "Mínimo de 12 caracteres.",
            },
          ]}
        />
      ) : (
        <p className="text-sm text-red-400">Link de convite inválido.</p>
      )}
    </>
  );
}
