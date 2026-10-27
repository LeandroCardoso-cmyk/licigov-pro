import { COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { SESSION_TTL_MS } from "../config/auth";
import { serviceLogger } from "../services/observabilityService";

const authLog = serviceLogger("Auth");

/**
 * Motivo de uma sessão não aceita. `absent` é o caso NORMAL de quem ainda não entrou (landing, login, `auth.me`
 * anônimo) — não é falha e não é registrado. Os demais são registrados como evento de segurança, sem o token.
 */
export type SessionRejection = "absent" | "expired" | "invalid_signature" | "malformed" | "claims_invalid" | "payload_incomplete";

/** Classificação pelo código do jose (v6). Erro desconhecido ⇒ `malformed` (nunca tratado como sessão válida). */
export function classifyJoseError(error: unknown): Exclude<SessionRejection, "absent" | "payload_incomplete"> {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_JWT_EXPIRED") return "expired";
  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") return "invalid_signature";
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" || code === "ERR_JOSE_ALG_NOT_ALLOWED") return "claims_invalid";
  return "malformed";
}

type VerifiedSession = { openId: string; appId: string; name: string; tv: number };

// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  /** PR A.1 — tokenVersion do usuário no momento da emissão (revogação de sessão). Default 0. */
  tv?: number;
};

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    // RC-SEC-PR-A (SEC-022): expiração do JWT alinhada ao TTL de sessão seguro
    // (default 24h, configurável via SESSION_TTL_HOURS) — era 1 ano.
    const expiresInMs = options.expiresInMs ?? SESSION_TTL_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      // PR A.1 — claim `tv`: comparado contra users.tokenVersion em authenticateRequest.
      tv: payload.tv ?? 0,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<VerifiedSession | null> {
    const result = await this.verifySessionDetailed(cookieValue);
    return result.ok ? result.session : null;
  }

  /** Verificação com o MOTIVO da recusa (quem registra é `authenticateRequest`, com o correlationId da requisição). */
  private async verifySessionDetailed(
    cookieValue: string | undefined | null
  ): Promise<{ ok: true; session: VerifiedSession } | { ok: false; reason: SessionRejection }> {
    if (!cookieValue) return { ok: false, reason: "absent" };

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, tv } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        return { ok: false, reason: "payload_incomplete" };
      }

      // PR A.1 — sessões emitidas ANTES desta mudança não têm o claim `tv`; tratamos como 0
      // (retrocompatível — continuam válidas até a próxima redefinição de senha, que bumpa
      // tokenVersion para 1 e as invalida).
      return { ok: true, session: { openId, appId, name, tv: typeof tv === "number" ? tv : 0 } };
    } catch (error) {
      return { ok: false, reason: classifyJoseError(error) };
    }
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const verified = await this.verifySessionDetailed(sessionCookie);
    // correlationId/requestId já validados pelo correlationMiddleware (nunca o cabeçalho cru, nunca o token).
    const trace = {
      correlationId: (req as unknown as Record<string, unknown>)["correlationId"] ?? null,
      requestId: (req as unknown as Record<string, unknown>)["requestId"] ?? null,
    };

    if (!verified.ok) {
      // Sem cookie é o caso normal de quem não entrou: não é registrado (antes saía como erro a cada `auth.me` anônimo).
      if (verified.reason === "expired") authLog.info("auth_session_expired", trace);
      else if (verified.reason !== "absent") authLog.warn("auth_session_rejected", { reason: verified.reason, ...trace });
      throw ForbiddenError("Invalid session cookie");
    }
    const session = verified.session;

    const user = await db.getUserByOpenId(session.openId);

    if (!user) {
      authLog.warn("auth_session_unknown_user", trace);
      throw ForbiddenError("User not found");
    }

    // PR A.1 — revogação de sessão: se a senha foi redefinida depois que este JWT foi emitido,
    // users.tokenVersion já avançou além do que o token carrega — a sessão não vale mais.
    if (session.tv !== (user.tokenVersion ?? 0)) {
      authLog.warn("auth_session_revoked", { userId: user.id, ...trace });
      throw ForbiddenError("Session revoked");
    }

    return user;
  }
}

export const sdk = new SDKServer();
