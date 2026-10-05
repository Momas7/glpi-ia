import { AiError } from "../types";
import type { LLMProvider, LLMRequest, LLMResult } from "./types";
import { parseOutput } from "./shared";

type Handler = (req: { system: string; user: string; model: string }) => unknown;

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

interface CatalogLine {
  id: string;
  name: string;
  teamId: string | null;
}

function parseCatalog(user: string): CatalogLine[] {
  const section = /CATEGORIAS:\n([\s\S]*?)\n\s*\nEQUIPES:/.exec(user)?.[1] ?? "";
  return section
    .split("\n")
    .map((line) => /^- (.+?) \| (.+?) \| (.+)$/.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ id: m[1], name: m[2], teamId: m[3] === "-" ? null : m[3] }));
}

function ticketText(user: string): string {
  return /<<<\n([\s\S]*?)\n>>>/.exec(user)?.[1] ?? "";
}

const RULES: { match: RegExp; category: string }[] = [
  { match: /\b(rede|wi-?fi|internet|vpn)\b/, category: "rede" },
  { match: /\b(senha|acesso|login|permiss)/, category: "acesso" },
  { match: /\bimpressora|\bimprimir/, category: "hardware" },
];

/** Triagem determinística por palavras-chave. Ignora qualquer instrução escrita no chamado. */
const triageHandler: Handler = ({ user }) => {
  const text = norm(ticketText(user));
  const catalog = parseCatalog(user);
  const rule = RULES.find((r) => r.match.test(text));
  const category = rule ? catalog.find((c) => norm(c.name).includes(rule.category)) : undefined;
  return {
    categoryId: category?.id ?? null,
    priority: /\b(urgente|parado|fora do ar)\b/.test(text) ? "HIGH" : "MEDIUM",
    teamId: category?.teamId ?? null,
    confidence: category ? 0.9 : 0.3,
  };
};

export class FakeLLMProvider implements LLMProvider {
  readonly name = "fake" as const;
  constructor(private readonly handler: Handler = triageHandler) {}

  async generate<T>(req: LLMRequest<T>): Promise<LLMResult<T>> {
    let raw: unknown;
    try {
      raw = this.handler({ system: req.system, user: req.user, model: req.model });
    } catch (err) {
      if (err instanceof AiError) throw err;
      throw new AiError(err instanceof Error ? err.message : "falha no provider fake", false, { cause: err });
    }
    return {
      data: parseOutput(req.schema, raw),
      usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: 40 },
    };
  }
}
