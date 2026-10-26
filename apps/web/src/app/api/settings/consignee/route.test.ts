import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PUT } from "@/app/api/settings/consignee/route";

const mocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  getPartyById: vi.fn(),
  setDefaultConsignee: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/auth", () => {
  class UnauthorizedError extends Error {
    constructor(message = "Nao autenticado") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }

  return {
    UnauthorizedError,
    getAuthContext: mocks.getAuthContext,
  };
});

vi.mock("@/lib/documents", () => {
  class PartyNotFoundError extends Error {
    constructor(message = "Empresa não encontrada") {
      super(message);
      this.name = "PartyNotFoundError";
    }
  }

  return {
    PartyNotFoundError,
    getPartyById: mocks.getPartyById,
  };
});

vi.mock("@/lib/documents/consignee-settings", () => ({
  setDefaultConsignee: mocks.setDefaultConsignee,
}));

const { UnauthorizedError } = await import("@/lib/auth");
const { PartyNotFoundError } = await import("@/lib/documents");

const TENANT_ID = "tenant-1";
const PARTY_ID = "8b3d6f1a-4c2e-4f5a-9b7d-1e2f3a4b5c6d";

function authContext(role: "owner" | "admin" | "operator" | "viewer") {
  return {
    userId: "user-1",
    email: "user@example.com",
    tenantId: TENANT_ID,
    role,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/consignee", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: { status: number; json: () => Promise<unknown> }) {
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthContext.mockResolvedValue(authContext("admin"));
  mocks.getPartyById.mockResolvedValue({
    id: PARTY_ID,
    name: "Empresa LTDA",
    cnpj: "12345678000199",
    address: {},
    created_at: "2026-10-26T00:00:00.000Z",
    updated_at: "2026-10-26T00:00:00.000Z",
  });
  mocks.setDefaultConsignee.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PUT /api/settings/consignee", () => {
  it("retorna 401 sem sessão", async () => {
    mocks.getAuthContext.mockRejectedValue(new UnauthorizedError());

    const { status, body } = await readJson(await PUT(makeRequest({ partyId: PARTY_ID })));

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Usuário não autenticado" });
    expect(mocks.setDefaultConsignee).not.toHaveBeenCalled();
  });

  it.each(["viewer", "operator"] as const)(
    "retorna 403 para o perfil %s",
    async (role) => {
      mocks.getAuthContext.mockResolvedValue(authContext(role));

      const { status, body } = await readJson(await PUT(makeRequest({ partyId: PARTY_ID })));

      expect(status).toBe(403);
      expect(body).toEqual({
        error: "Apenas owner/admin podem definir o consignee padrão",
      });
      expect(mocks.setDefaultConsignee).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ partyId: "abc" }],
    [{ partyId: 42 }],
    [{ partyId: undefined }],
    [{}],
    [null],
  ])("retorna 400 quando partyId é inválido (%j)", async (payload) => {
    const { status, body } = await readJson(await PUT(makeRequest(payload)));

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Empresa inválida" });
    expect(mocks.getPartyById).not.toHaveBeenCalled();
    expect(mocks.setDefaultConsignee).not.toHaveBeenCalled();
  });

  it("retorna 400 quando a empresa não pertence ao tenant", async () => {
    mocks.getPartyById.mockRejectedValue(new PartyNotFoundError());

    const { status, body } = await readJson(await PUT(makeRequest({ partyId: PARTY_ID })));

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Empresa não encontrada" });
    expect(mocks.getPartyById).toHaveBeenCalledWith(TENANT_ID, PARTY_ID);
    expect(mocks.setDefaultConsignee).not.toHaveBeenCalled();
  });

  it("salva a empresa como consignee padrão", async () => {
    const { status, body } = await readJson(await PUT(makeRequest({ partyId: PARTY_ID })));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, partyId: PARTY_ID });
    expect(mocks.setDefaultConsignee).toHaveBeenCalledWith(TENANT_ID, PARTY_ID);
  });

  it("remove o consignee padrão quando partyId é null", async () => {
    const { status, body } = await readJson(await PUT(makeRequest({ partyId: null })));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, partyId: null });
    expect(mocks.getPartyById).not.toHaveBeenCalled();
    expect(mocks.setDefaultConsignee).toHaveBeenCalledWith(TENANT_ID, null);
  });

  it("retorna 500 em erro inesperado", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("banco indisponível");
    mocks.setDefaultConsignee.mockRejectedValue(failure);

    const { status, body } = await readJson(await PUT(makeRequest({ partyId: PARTY_ID })));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Falha ao salvar consignee padrão" });
    expect(consoleError).toHaveBeenCalledWith(
      "[api/settings/consignee] PUT",
      failure,
    );
  });
});
