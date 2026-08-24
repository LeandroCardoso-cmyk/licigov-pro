/**
 * C.3A-OPS.1 — Testes da lógica pura da superfície operacional de feature flags.
 * Cobre: permissão de escrita por ambiente (produção desabilita), reason/expiry obrigatórios,
 * flag única governável, rótulos e resumo de confirmação.
 */
import { describe, it, expect } from "vitest";
import {
  SHADOW_FLAG,
  environmentLabel,
  canOperate,
  validateActivation,
  validateDeactivation,
  buildConfirmationSummary,
  PRODUCTION_WRITE_BLOCKED_MESSAGE,
  DEFAULT_ACTIVATION_REASON,
  DEFAULT_DEACTIVATION_REASON,
} from "./shadowFlagSurface";

describe("C.3A-OPS.1 — flag única governável", () => {
  it("a UI só trabalha com FF_DIRECT_CONTRACT_SHADOW", () => {
    expect(SHADOW_FLAG).toBe("FF_DIRECT_CONTRACT_SHADOW");
  });
});

describe("C.3A-OPS.1 — autoridade de escrita por ambiente (backend)", () => {
  it("produção (writeAllowed=false) → controles desabilitados", () => {
    expect(canOperate({ writeAllowed: false })).toBe(false);
  });
  it("staging/development (writeAllowed=true) → controles disponíveis", () => {
    expect(canOperate({ writeAllowed: true })).toBe(true);
  });
  it("sem view → não opera (fail-closed)", () => {
    expect(canOperate(null)).toBe(false);
    expect(canOperate(undefined)).toBe(false);
  });
  it("mensagem de bloqueio de produção é clara", () => {
    expect(PRODUCTION_WRITE_BLOCKED_MESSAGE).toContain("bloqueadas em produção");
  });
});

describe("C.3A-OPS.1 — validação de ativação (enable=true)", () => {
  const future = new Date(Date.now() + 3600_000);

  it("reason vazio é recusado", () => {
    const r = validateActivation({ reason: "   ", expiresAt: future });
    expect(r.valid).toBe(false);
    expect(r.errors.reason).toBeTruthy();
  });
  it("expiry ausente é recusada (obrigatória para ativação)", () => {
    const r = validateActivation({ reason: "ok", expiresAt: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.expiresAt).toBeTruthy();
  });
  it("expiry no passado é recusada", () => {
    const r = validateActivation({ reason: "ok", expiresAt: new Date(Date.now() - 1000) });
    expect(r.valid).toBe(false);
    expect(r.errors.expiresAt).toBeTruthy();
  });
  it("reason + expiry futura → válido", () => {
    const r = validateActivation({ reason: "homologação", expiresAt: future });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
  });
});

describe("C.3A-OPS.1 — validação de desativação (enable=false)", () => {
  it("reason obrigatório; expiry não é exigida", () => {
    expect(validateDeactivation({ reason: "" }).valid).toBe(false);
    expect(validateDeactivation({ reason: "encerrando" }).valid).toBe(true);
  });
});

describe("C.3A-OPS.1 — rótulos e resumo", () => {
  it("rótulos de ambiente em pt-BR", () => {
    expect(environmentLabel("production")).toBe("Produção");
    expect(environmentLabel("staging")).toBe("Staging");
    expect(environmentLabel("development")).toBe("Desenvolvimento");
  });
  it("resumo de confirmação traz ambiente, org, flag, reason e expiry", () => {
    const s = buildConfirmationSummary({
      environment: "staging",
      organizationName: "Órgão Teste",
      reason: "  homologação  ",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect(s.environment).toBe("Staging");
    expect(s.organization).toBe("Órgão Teste");
    expect(s.flag).toBe(SHADOW_FLAG);
    expect(s.reason).toBe("homologação");
    expect(s.expiry).toBeTruthy();
  });
  it("resumo sem expiry (desativação) → expiry null", () => {
    const s = buildConfirmationSummary({ environment: "staging", organizationName: "X", reason: "off", expiresAt: null });
    expect(s.expiry).toBeNull();
  });
  it("reasons padrão institucionais existem", () => {
    expect(DEFAULT_ACTIVATION_REASON).toContain("Homologação operacional C.3A");
    expect(DEFAULT_DEACTIVATION_REASON).toContain("Encerramento da homologação");
  });
});
