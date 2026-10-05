/**
 * Mascaração de dados sensíveis antes de qualquer texto sair para um LLM.
 * Função pura: o mapa token → valor existe só em memória, durante o job.
 * Limite conhecido: nomes próprios não são mascarados (regex não resolve isso).
 */

export type MaskMap = Record<string, string>;
export interface Masked {
  text: string;
  map: MaskMap;
}

type Kind = "CPF" | "CNPJ" | "EMAIL" | "TEL" | "IP" | "CARTAO" | "SEGREDO";

const TOKEN = /\[(CPF|CNPJ|EMAIL|TEL|IP|CARTAO|SEGREDO)_(\d+)\]/g;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function cpfValid(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

function cnpjValid(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

function luhnValid(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

function ipv6Valid(candidate: string): boolean {
  // Evita confundir horários (10:30:15): exige "::" ou oito grupos.
  if (candidate.includes("::")) return candidate.split("::").length === 2;
  return candidate.split(":").length === 8;
}

export function mask(input: string): Masked {
  const map: MaskMap = {};
  const reverse = new Map<string, string>();
  const counters: Partial<Record<Kind, number>> = {};

  const tokenFor = (kind: Kind, value: string): string => {
    const key = `${kind}\u0000${value}`;
    const existing = reverse.get(key);
    if (existing) return existing;
    const n = (counters[kind] = (counters[kind] ?? 0) + 1);
    const token = `[${kind}_${n}]`;
    map[token] = value;
    reverse.set(key, token);
    return token;
  };

  // Texto que já parece um token vira "[CPF 1]": o unmask nunca troca por um valor que não é dele.
  let text = input.replace(TOKEN, "[$1 $2]");

  text = text.replace(
    /\b(senha|password|passwd|pwd|token|secret|segredo|api[_-]?key)(\s*[:=]\s*)(\S+)/gi,
    (_m, key: string, sep: string, value: string) => `${key}${sep}${tokenFor("SEGREDO", value)}`,
  );
  text = text.replace(
    /\b(senha|password|passwd)((?:\s+(?:nova|atual|antiga))?\s+(?:é|eh|is)\s+)(\S+)/gi,
    (_m, key: string, sep: string, value: string) => `${key}${sep}${tokenFor("SEGREDO", value)}`,
  );
  // "senha Abc12345": só quando a palavra seguinte parece uma senha (letras e números, 6+), para não mascarar "senha expirou".
  text = text.replace(
    /\b(senha|password|passwd)(\s+)(?=\S*\d)(?=\S*[A-Za-z])(\S{6,})/gi,
    (_m, key: string, sep: string, value: string) => `${key}${sep}${tokenFor("SEGREDO", value)}`,
  );
  text = text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, (m) => tokenFor("SEGREDO", m));
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, (m) => tokenFor("SEGREDO", m));
  text = text.replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/g, (_m, value: string) => `Bearer ${tokenFor("SEGREDO", value)}`);
  text = text.replace(/\bgk_[0-9a-f]{8}_[0-9a-f]{16,}\b/gi, (m) => tokenFor("SEGREDO", m));
  text = text.replace(/\b(?:sk|pk|ghp|AIza)[A-Za-z0-9_-]{16,}\b/g, (m) => tokenFor("SEGREDO", m));

  text = text.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, (m) => (luhnValid(m) ? tokenFor("CARTAO", m) : m));
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (m) => tokenFor("EMAIL", m));
  text = text.replace(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, (m) => (cnpjValid(m) ? tokenFor("CNPJ", m) : m));
  text = text.replace(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, (m) => (cpfValid(m) ? tokenFor("CPF", m) : m));
  text = text.replace(
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\.?\d)/g,
    (m) => tokenFor("IP", m),
  );
  text = text.replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, (m) =>
    ipv6Valid(m) ? tokenFor("IP", m) : m,
  );
  text = text.replace(/(?<!\d)(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)/g, (m) => tokenFor("TEL", m));

  return { text, map };
}

export function unmask(text: string, map: MaskMap): string {
  return text.replace(TOKEN, (token) => map[token] ?? token);
}

/** Desfaz tokens em todas as strings de um valor JSON (objetos, arrays e strings). */
export function unmaskDeep<T>(value: T, map: MaskMap): T {
  if (typeof value === "string") return unmask(value, map) as T;
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmaskDeep(v, map)])) as T;
  }
  return value;
}
