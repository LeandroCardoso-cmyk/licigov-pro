/**
 * PR A.1 — utils/inviteState.ts (máquina de decisão da tela de aceite de convite).
 */

import { describe, it, expect } from "vitest";
import { resolveInviteView } from "./inviteState";

describe("inviteState · resolveInviteView", () => {
  it("carregando (query em voo ou sem dados ainda) → loading", () => {
    expect(resolveInviteView({ isLoading: true, data: undefined, currentUserEmail: null })).toEqual({ kind: "loading" });
    expect(resolveInviteView({ isLoading: false, data: undefined, currentUserEmail: null })).toEqual({ kind: "loading" });
  });

  it("token inválido → invalid, com o motivo repassado", () => {
    const result = resolveInviteView({ isLoading: false, data: { valid: false, reason: "INVITATION_EXPIRED" }, currentUserEmail: null });
    expect(result).toEqual({ kind: "invalid", reason: "INVITATION_EXPIRED" });
  });

  it("token válido, sem usuário autenticado → create_account", () => {
    const result = resolveInviteView({ isLoading: false, data: { valid: true, emailNormalized: "fulano@x.com" }, currentUserEmail: null });
    expect(result).toEqual({ kind: "create_account" });
  });

  it("token válido, autenticado com o MESMO e-mail (case-insensitive) → accept_as_current_user", () => {
    const result = resolveInviteView({
      isLoading: false,
      data: { valid: true, emailNormalized: "fulano@x.com" },
      currentUserEmail: "  Fulano@X.com  ",
    });
    expect(result).toEqual({ kind: "accept_as_current_user" });
  });

  it("token válido, autenticado com e-mail DIFERENTE → email_mismatch", () => {
    const result = resolveInviteView({
      isLoading: false,
      data: { valid: true, emailNormalized: "convidado@x.com" },
      currentUserEmail: "outro@x.com",
    });
    expect(result).toEqual({ kind: "email_mismatch", invitedEmail: "convidado@x.com", currentEmail: "outro@x.com" });
  });

  it("token válido sem emailNormalized (defensivo) e autenticado → não força mismatch", () => {
    const result = resolveInviteView({ isLoading: false, data: { valid: true }, currentUserEmail: "fulano@x.com" });
    expect(result).toEqual({ kind: "accept_as_current_user" });
  });
});
