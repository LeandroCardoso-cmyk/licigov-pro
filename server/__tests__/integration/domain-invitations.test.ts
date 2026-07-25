/**
 * PR A.1 — domain/invitations.ts (máquina de estados pura do convite institucional).
 */

import { describe, it, expect } from "vitest";
import {
  INVITATION_TTL_MS,
  DEFAULT_INVITATION_ROLE,
  computeInvitationExpiresAt,
  normalizeInvitationEmail,
  isInvitationExpiredByTime,
  effectiveInvitationStatus,
  isValidInvitationTransition,
  isTerminalInvitationStatus,
  computeInvitationActiveKey,
  canResendInvitation,
  canCancelInvitation,
  bumpResendMetadata,
  checkInvitationAcceptEligibility,
} from "../../domain/invitations";

describe("domain/invitations · TTL e expiração", () => {
  it("computeInvitationExpiresAt soma exatamente 7 dias (constante de domínio)", () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const created = new Date("2026-01-01T00:00:00.000Z");
    const expires = computeInvitationExpiresAt(created);
    expect(expires.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("isInvitationExpiredByTime: limite é inclusivo (now === expiresAt conta como expirado)", () => {
    const t = new Date("2026-01-08T00:00:00.000Z");
    expect(isInvitationExpiredByTime(t, t)).toBe(true);
    expect(isInvitationExpiredByTime(t, new Date(t.getTime() - 1))).toBe(false);
    expect(isInvitationExpiredByTime(t, new Date(t.getTime() + 1))).toBe(true);
  });

  it("DEFAULT_INVITATION_ROLE é 'operator' (mesmo default do schema)", () => {
    expect(DEFAULT_INVITATION_ROLE).toBe("operator");
  });
});

describe("domain/invitations · normalização de e-mail", () => {
  it("normalizeInvitationEmail: trim + lowercase", () => {
    expect(normalizeInvitationEmail("  Fulano@LiciGov.com.br  ")).toBe("fulano@licigov.com.br");
  });
});

describe("domain/invitations · effectiveInvitationStatus", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const past = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-02-01T00:00:00.000Z");

  it("pending + não expirado → continua pending", () => {
    expect(effectiveInvitationStatus("pending", future, now)).toBe("pending");
  });
  it("pending + expirado por tempo → expired (mesmo sem escrita no banco)", () => {
    expect(effectiveInvitationStatus("pending", past, now)).toBe("expired");
  });
  it("estados terminais não são afetados pela data (accepted/cancelled/superseded/expired)", () => {
    for (const s of ["accepted", "cancelled", "superseded", "expired"] as const) {
      expect(effectiveInvitationStatus(s, past, now)).toBe(s);
      expect(effectiveInvitationStatus(s, future, now)).toBe(s);
    }
  });
});

describe("domain/invitations · transições", () => {
  it("pending pode ir para accepted/cancelled/expired/superseded", () => {
    for (const to of ["accepted", "cancelled", "expired", "superseded"] as const) {
      expect(isValidInvitationTransition("pending", to)).toBe(true);
    }
  });
  it("estados terminais não têm transição de saída", () => {
    for (const from of ["accepted", "expired", "cancelled", "superseded"] as const) {
      expect(isTerminalInvitationStatus(from)).toBe(true);
      for (const to of ["pending", "accepted", "expired", "cancelled", "superseded"] as const) {
        expect(isValidInvitationTransition(from, to)).toBe(false);
      }
    }
  });
  it("pending não é terminal", () => {
    expect(isTerminalInvitationStatus("pending")).toBe(false);
  });
});

describe("domain/invitations · activeKey", () => {
  it("pending → \"{orgId}:{email}\"", () => {
    expect(computeInvitationActiveKey(700001, "fulano@x.com", "pending")).toBe("700001:fulano@x.com");
  });
  it("qualquer outro estado → null (libera o slot de unicidade)", () => {
    for (const s of ["accepted", "expired", "cancelled", "superseded"] as const) {
      expect(computeInvitationActiveKey(700001, "fulano@x.com", s)).toBeNull();
    }
  });
});

describe("domain/invitations · elegibilidade de reenvio/cancelamento", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const future = new Date("2026-02-01T00:00:00.000Z");
  const past = new Date("2026-01-01T00:00:00.000Z");

  it("canResendInvitation: só pending E não expirado", () => {
    expect(canResendInvitation("pending", future, now)).toBe(true);
    expect(canResendInvitation("pending", past, now)).toBe(false); // expirado por tempo
    expect(canResendInvitation("accepted", future, now)).toBe(false);
    expect(canResendInvitation("cancelled", future, now)).toBe(false);
  });

  it("canCancelInvitation: pending sempre (mesmo se já expirado por tempo — idempotente)", () => {
    expect(canCancelInvitation("pending")).toBe(true);
    expect(canCancelInvitation("accepted")).toBe(false);
    expect(canCancelInvitation("expired")).toBe(false);
    expect(canCancelInvitation("cancelled")).toBe(false);
  });

  it("bumpResendMetadata incrementa resendCount e marca lastSentAt = now", () => {
    const now2 = new Date("2026-03-01T00:00:00.000Z");
    expect(bumpResendMetadata({ resendCount: 0 }, now2)).toEqual({ resendCount: 1, lastSentAt: now2 });
    expect(bumpResendMetadata({ resendCount: 3 }, now2)).toEqual({ resendCount: 4, lastSentAt: now2 });
  });
});

describe("domain/invitations · checkInvitationAcceptEligibility", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const future = new Date("2026-02-01T00:00:00.000Z");
  const past = new Date("2026-01-01T00:00:00.000Z");

  it("convite inexistente (null) → NOT_FOUND", () => {
    expect(checkInvitationAcceptEligibility({ invitation: null, now })).toEqual({
      eligible: false, reason: "NOT_FOUND",
    });
  });

  it("convite pending e não expirado, sem checagem de e-mail (conta nova) → elegível", () => {
    const r = checkInvitationAcceptEligibility({
      invitation: { status: "pending", expiresAt: future, emailNormalized: "fulano@x.com" }, now,
    });
    expect(r).toEqual({ eligible: true });
  });

  it("convite pending mas expirado por tempo → EXPIRED", () => {
    const r = checkInvitationAcceptEligibility({
      invitation: { status: "pending", expiresAt: past, emailNormalized: "fulano@x.com" }, now,
    });
    expect(r).toEqual({ eligible: false, reason: "EXPIRED" });
  });

  it("convite cancelled/superseded → CANCELLED", () => {
    for (const status of ["cancelled", "superseded"] as const) {
      const r = checkInvitationAcceptEligibility({
        invitation: { status, expiresAt: future, emailNormalized: "fulano@x.com" }, now,
      });
      expect(r).toEqual({ eligible: false, reason: "CANCELLED" });
    }
  });

  it("convite accepted → ALREADY_ACCEPTED", () => {
    const r = checkInvitationAcceptEligibility({
      invitation: { status: "accepted", expiresAt: future, emailNormalized: "fulano@x.com" }, now,
    });
    expect(r).toEqual({ eligible: false, reason: "ALREADY_ACCEPTED" });
  });

  it("acceptExisting: e-mail da sessão diferente do convidado → EMAIL_MISMATCH", () => {
    const r = checkInvitationAcceptEligibility({
      invitation: { status: "pending", expiresAt: future, emailNormalized: "fulano@x.com" },
      now,
      acceptingEmail: "outro@x.com",
    });
    expect(r).toEqual({ eligible: false, reason: "EMAIL_MISMATCH" });
  });

  it("acceptExisting: e-mail bate (case-insensitive) → elegível", () => {
    const r = checkInvitationAcceptEligibility({
      invitation: { status: "pending", expiresAt: future, emailNormalized: "fulano@x.com" },
      now,
      acceptingEmail: "  Fulano@X.com  ",
    });
    expect(r).toEqual({ eligible: true });
  });
});
