import { JsonForm } from "@/components/forms/JsonForm";

export const metadata = { title: "Nova senha · Sentinela" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <p className="mb-5 text-sm text-muted-foreground">Escolha uma nova senha.</p>
      {token ? (
        <JsonForm
          endpoint="/api/auth/reset"
          submitLabel="Salvar nova senha"
          hidden={{ token }}
          redirectTo="/login"
          fields={[
            {
              name: "password",
              label: "Nova senha",
              type: "password",
              autoComplete: "new-password",
              hint: "Mínimo de 12 caracteres.",
            },
          ]}
        />
      ) : (
        <p className="text-sm text-red-400">Link inválido ou expirado.</p>
      )}
    </>
  );
}
