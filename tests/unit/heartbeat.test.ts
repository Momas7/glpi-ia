import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_INTERVAL_MS, WORKER_STALE_SECONDS, startHeartbeat } from "@/modules/system/heartbeat";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startHeartbeat", () => {
  it("bate ao iniciar e a cada 60 s até ser parado", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const stop = startHeartbeat("worker", record);
    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(record).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(record).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(record).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(record).toHaveBeenCalledTimes(4);
  });

  it("falha ao gravar não derruba o processo (o erro é só registrado)", async () => {
    const record = vi.fn().mockRejectedValue(new Error("banco fora"));
    const stop = startHeartbeat("worker", record);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(record).toHaveBeenCalledTimes(2);
    stop();
  });

  it("o worker é considerado parado depois de 180 s", () => {
    expect(WORKER_STALE_SECONDS).toBe(180);
  });
});
