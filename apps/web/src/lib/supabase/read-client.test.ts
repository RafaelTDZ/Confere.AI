import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReadClient, runWithAdminReads } from "@/lib/supabase/read-client";

const mocks = vi.hoisted(() => ({
  serverClient: { kind: "server" },
  adminClient: { kind: "admin" },
  createServer: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdmin,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createServer.mockResolvedValue(mocks.serverClient);
  mocks.createAdmin.mockReturnValue(mocks.adminClient);
});

describe("getReadClient", () => {
  it("usa o client do usuário (RLS) fora do contexto de job", async () => {
    await expect(getReadClient()).resolves.toBe(mocks.serverClient);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("usa service role dentro de runWithAdminReads", async () => {
    const client = await runWithAdminReads(() => getReadClient());

    expect(client).toBe(mocks.adminClient);
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("volta ao client do usuário depois do contexto", async () => {
    await runWithAdminReads(() => getReadClient());

    await expect(getReadClient()).resolves.toBe(mocks.serverClient);
  });

  it("propaga o resultado e o erro do callback", async () => {
    await expect(runWithAdminReads(async () => 42)).resolves.toBe(42);
    await expect(
      runWithAdminReads(async () => {
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");
  });
});
