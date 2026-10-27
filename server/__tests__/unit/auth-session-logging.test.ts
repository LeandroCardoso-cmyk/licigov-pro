/**
 * Logs de autenticação: sem cookie é o caso normal de quem não entrou (sem log — antes saía como ERRO a cada `auth.me`
 * anônimo); sessão expirada é informativa; assinatura inválida, token malformado, usuário inexistente e sessão revogada
 * são eventos de segurança (warn) com correlationId — nunca com o token. `verifySession` mantém o contrato (null).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request } from "express";
import { SignJWT } from "jose";
import type { User } from "../../../drizzle/schema";

vi.mock("../../db", () => ({ getUserByOpenId: vi.fn() }));

import { sdk, classifyJoseError } from "../../_core/sdk";
import { getUserByOpenId } from "../../db";

const userMock = vi.mocked(getUserByOpenId);
const user = (tokenVersion = 0) => ({ id: 7, openId: "open-1", tokenVersion } as unknown as User);
const req = (cookie?: string): Request =>
  ({ headers: cookie ? { cookie: `app_session_id=${cookie}` } : {}, correlationId: "corr-1", requestId: "req-1" }) as unknown as Request;

let out: { warn: string[]; error: string[]; info: string[] };
beforeEach(() => {
  out = { warn: [], error: [], info: [] };
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { out.warn.push(a.map(String).join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { out.error.push(a.map(String).join(" ")); });
  vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => { out.info.push(a.map(String).join(" ")); });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.info.push(a.map(String).join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

describe("auth · logs de sessão", () => {
  it("sem cookie: recusa sem nenhum log de aviso/erro", async () => {
    await expect(sdk.authenticateRequest(req())).rejects.toThrow();
    expect(out.warn).toEqual([]);
    expect(out.error).toEqual([]);
    expect(await sdk.verifySession(undefined)).toBeNull();
  });

  it("assinatura inválida: warn com motivo e correlationId, sem o token", async () => {
    const forged = await new SignJWT({ openId: "open-1", appId: "a", name: "n", tv: 0 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime("1h").sign(new TextEncoder().encode("outro-segredo-qualquer-com-32-chars!!"));
    await expect(sdk.authenticateRequest(req(forged))).rejects.toThrow();
    const all = [...out.warn, ...out.error].join("\n");
    expect(all).toContain("auth_session_rejected");
    expect(all).toContain("invalid_signature");
    expect(all).toContain("corr-1");
    expect(all).not.toContain(forged);
  });

  it("sessão expirada: informativo (não é incidente)", async () => {
    const expired = await sdk.signSession({ openId: "open-1", appId: "a", name: "n" }, { expiresInMs: -60_000 });
    await expect(sdk.authenticateRequest(req(expired))).rejects.toThrow();
    expect([...out.warn, ...out.error].join("\n")).not.toContain("auth_session");
    expect(out.info.join("\n")).toContain("auth_session_expired");
  });

  it("token malformado: warn malformed", async () => {
    await expect(sdk.authenticateRequest(req("nao-e-um-jwt"))).rejects.toThrow();
    expect([...out.warn, ...out.error].join("\n")).toContain("malformed");
  });

  it("usuário inexistente e sessão revogada: warn de segurança", async () => {
    const token = await sdk.signSession({ openId: "open-1", appId: "a", name: "n", tv: 0 });
    userMock.mockResolvedValueOnce(undefined as unknown as User);
    await expect(sdk.authenticateRequest(req(token))).rejects.toThrow();
    userMock.mockResolvedValueOnce(user(1));
    await expect(sdk.authenticateRequest(req(token))).rejects.toThrow();
    const all = [...out.warn, ...out.error].join("\n");
    expect(all).toContain("auth_session_unknown_user");
    expect(all).toContain("auth_session_revoked");
  });

  it("sessão válida: autentica sem log", async () => {
    userMock.mockResolvedValueOnce(user(0));
    const token = await sdk.signSession({ openId: "open-1", appId: "a", name: "n", tv: 0 });
    expect((await sdk.authenticateRequest(req(token))).id).toBe(7);
    expect([...out.warn, ...out.error]).toEqual([]);
  });

  it("classificação dos códigos do jose; desconhecido nunca vira sessão válida", () => {
    expect(classifyJoseError({ code: "ERR_JWT_EXPIRED" })).toBe("expired");
    expect(classifyJoseError({ code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" })).toBe("invalid_signature");
    expect(classifyJoseError({ code: "ERR_JWT_CLAIM_VALIDATION_FAILED" })).toBe("claims_invalid");
    expect(classifyJoseError(new Error("x"))).toBe("malformed");
  });
});
