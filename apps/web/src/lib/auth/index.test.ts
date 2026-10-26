import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthContext, resolveAuthState, UnauthorizedError } from "@/lib/auth";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

function authUser(appMetadata: Record<string, unknown> | null) {
  return {
    data: {
      user: {
        id: "user-1",
        email: "user@example.com",
        app_metadata: appMetadata,
      },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveAuthState", () => {
  it("devolve unauthenticated quando não há usuário", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(resolveAuthState()).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("devolve unauthenticated quando falta tenant_id", async () => {
    mocks.getUser.mockResolvedValue(authUser({ tenant_role: "owner" }));

    await expect(resolveAuthState()).resolves.toEqual({
      status: "unauthenticated",
    });
  });

  it("monta o contexto com os claims do JWT", async () => {
    mocks.getUser.mockResolvedValue(
      authUser({ tenant_id: "tenant-1", tenant_role: "admin" }),
    );

    await expect(resolveAuthState()).resolves.toEqual({
      status: "authenticated",
      context: {
        userId: "user-1",
        email: "user@example.com",
        tenantId: "tenant-1",
        role: "admin",
      },
    });
  });

  it("aceita o papel operator do banco", async () => {
    mocks.getUser.mockResolvedValue(
      authUser({ tenant_id: "tenant-1", tenant_role: "operator" }),
    );

    const state = await resolveAuthState();

    expect(state).toMatchObject({
      status: "authenticated",
      context: { role: "operator" },
    });
  });

  it("normaliza papel desconhecido para viewer", async () => {
    mocks.getUser.mockResolvedValue(
      authUser({ tenant_id: "tenant-1", tenant_role: "member" }),
    );

    const state = await resolveAuthState();

    expect(state).toMatchObject({
      status: "authenticated",
      context: { role: "viewer" },
    });
  });

  it("usa viewer quando o token não traz papel", async () => {
    mocks.getUser.mockResolvedValue(authUser({ tenant_id: "tenant-1" }));

    const state = await resolveAuthState();

    expect(state).toMatchObject({
      status: "authenticated",
      context: { role: "viewer" },
    });
  });
});

describe("getAuthContext", () => {
  it("lança UnauthorizedError sem sessão", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getAuthContext()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("devolve o contexto autenticado", async () => {
    mocks.getUser.mockResolvedValue(
      authUser({ tenant_id: "tenant-1", tenant_role: "owner" }),
    );

    await expect(getAuthContext()).resolves.toMatchObject({
      userId: "user-1",
      tenantId: "tenant-1",
      role: "owner",
    });
  });
});
