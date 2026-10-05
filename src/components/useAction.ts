"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage, sendJson } from "@/lib/client-api";

/** Executa uma chamada à API e atualiza a página; guarda erro e estado de envio para o formulário. */
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run<T = Record<string, unknown>>(url: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) {
    setError(null);
    setPending(true);
    const result = await sendJson<T>(url, method, body);
    setPending(false);
    if (!result.ok) {
      setError(errorMessage(result));
      return null;
    }
    router.refresh();
    return result.data;
  }

  return { run, error, pending };
}
