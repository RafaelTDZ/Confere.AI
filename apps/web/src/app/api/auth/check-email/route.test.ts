import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/check-email/route";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  consumeRateLimit: vi.fn(),
  getCheckEmailRateLimit: vi.fn(),
  getCheckEmailRateWindowSeconds: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => ({
      status: init?.status ?? 200,
      body,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/supabase/public-client", () => ({
  createSupabasePublicClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  getCheckEmailRateLimit: mocks.getCheckEmailRateLimit,
  getCheckEmailRateWindowSeconds: mocks.getCheckEmailRateWindowSeconds,
}));

type FakeResponse = {
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
};

function makeRequest(
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  return new Request("http://localhost/api/auth/check-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(options.body ?? { email: "user@example.com" }),
  }) as unknown as NextRequest;
}

async function readJson(
  response: FakeResponse,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.consumeRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: "2026-10-23T12:01:00.000Z",
    retryAfterSeconds: 0,
  });
  mocks.getCheckEmailRateLimit.mockReturnValue(10);
  mocks.getCheckEmailRateWindowSeconds.mockReturnValue(60);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/check-email", () => {
  it("retorna exists true quando o email já está cadastrado", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ body: { email: " User@Example.com " } })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ exists: true });
    expect(mocks.rpc).toHaveBeenCalledWith("email_registered", {
      p_email: "user@example.com",
    });
  });

  it("retorna exists false quando o email não está cadastrado", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ exists: false });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("retorna 400 quando o email é obrigatório", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ body: {} })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Email é obrigatório" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o email é inválido", async () => {
    const { status, body } = await readJson(
      await POST(makeRequest({ body: { email: "sem-arroba" } })),
    );

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Email inválido" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retorna 429 com Retry-After sem chamar a RPC quando o rate limit bloqueia", async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: "2026-10-23T12:01:00.000Z",
      retryAfterSeconds: 45,
    });

    const { status, body, headers } = await readJson(
      await POST(makeRequest()),
    );

    expect(status).toBe(429);
    expect(body).toEqual({
      error: "Muitas verificações de email. Tente novamente mais tarde.",
    });
    expect(headers.get("Retry-After")).toBe("45");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("segue o fluxo quando o rate limiter lança erro (fail-open)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("banco indisponível");
    mocks.consumeRateLimit.mockRejectedValue(failure);

    const { status, body } = await readJson(await POST(makeRequest()));

    expect(status).toBe(200);
    expect(body).toEqual({ exists: true });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "[auth/check-email] rate limit indisponível",
      failure,
    );
  });

  it("usa o primeiro IP de x-forwarded-for no bucket com hash, sem IP cru", async () => {
    const ip = "203.0.113.7";

    await POST(
      makeRequest({
        headers: {
          "x-forwarded-for": `${ip}, 10.0.0.1`,
          "x-real-ip": "198.51.100.9",
        },
      }),
    );

    const expectedBucket = `check-email:ip:${hashIp(ip)}`;
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith({
      bucket: expectedBucket,
      limit: 10,
      windowSeconds: 60,
    });
    expect(expectedBucket).not.toContain(ip);
    expect(expectedBucket).toMatch(/^check-email:ip:[0-9a-f]{64}$/);
  });

  it("usa x-real-ip quando x-forwarded-for está ausente", async () => {
    const ip = "198.51.100.9";

    await POST(makeRequest({ headers: { "x-real-ip": ip } }));

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: `check-email:ip:${hashIp(ip)}` }),
    );
  });

  it("usa unknown no bucket quando nenhum IP está disponível", async () => {
    await POST(makeRequest());

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: `check-email:ip:${hashIp("unknown")}`,
      }),
    );
  });
});
