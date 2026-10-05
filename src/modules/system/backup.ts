import { readFile } from "node:fs/promises";
import { z } from "zod";

/** Estado gravado pelos scripts de backup/restauração (`estado-backup.json`). Campos desconhecidos são ignorados. */
const stateSchema = z.object({
  lastBackupAt: z.iso.datetime({ offset: true }).nullable(),
  lastBackupBytes: z.number().int().nonnegative().nullable().default(null),
  lastBackupOk: z.boolean(),
  lastRestoreTestAt: z.iso.datetime({ offset: true }).nullable().default(null),
  lastRestoreTestOk: z.boolean().nullable().default(null),
  detail: z.string().max(500).optional(),
});

export type BackupState = z.infer<typeof stateSchema>;

export const BACKUP_STALE_HOURS = 26;

export function parseBackupState(raw: unknown): BackupState | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface BackupStatus {
  configured: boolean;
  state: BackupState | null;
  /** Sem backup bom há mais de 26 h (ou o último falhou, ou o arquivo sumiu/está ilegível). */
  stale: boolean;
  ageHours: number | null;
}

/** Lê o estado do backup. Nunca lança: arquivo ausente ou inválido vira "sem estado". */
export async function readBackupState(path: string | undefined = process.env.BACKUP_STATE_FILE, now: Date = new Date()): Promise<BackupStatus> {
  if (!path) return { configured: false, state: null, stale: false, ageHours: null };
  let state: BackupState | null = null;
  try {
    state = parseBackupState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    state = null;
  }
  if (!state || !state.lastBackupAt) return { configured: true, state, stale: true, ageHours: null };
  const ageHours = (now.getTime() - new Date(state.lastBackupAt).getTime()) / 3_600_000;
  return { configured: true, state, stale: !state.lastBackupOk || ageHours > BACKUP_STALE_HOURS, ageHours };
}
