/**
 * LICIGOV-LAUNCH-READY — convergência — contratos puros: LR-08 (aviso comercial nunca derruba a solicitação; destinatário só
 * por configuração válida) e LR-07 (checkout por usuário desativado na superfície do servidor).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../../services/email/emailOutboxService", () => ({ enqueueEmail: vi.fn() }));
vi.mock("../../services/email/emailDispatcher", () => ({ kick: vi.fn() }));

import { enqueueEmail } from "../../services/email/emailOutboxService";
import { notifyCommercialProposalReceived } from "../../routers/commercialRouter";
import { EMAIL_CONFIG, resolveCommercialNotificationEmail } from "../../config/email";

const enqueueMock = vi.mocked(enqueueEmail);
const base = { proposalId: 7, orgaoNome: "Órgão X", orgaoCidade: "Cidade", orgaoEstado: "SP" };

describe("LR-08 — aviso interno de nova solicitação comercial", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("destinatário: só endereço válido, normalizado; nunca padrão inventado", () => {
    expect(resolveCommercialNotificationEmail(undefined)).toBe("");
    expect(resolveCommercialNotificationEmail("  ")).toBe("");
    expect(resolveCommercialNotificationEmail("não-é-email")).toBe("");
    expect(resolveCommercialNotificationEmail(" Comercial@Exemplo.Gov.BR ")).toBe("comercial@exemplo.gov.br");
  });

  it("sem destinatário: não enfileira e não falha", async () => {
    const prev = EMAIL_CONFIG.commercialNotificationEmail;
    EMAIL_CONFIG.commercialNotificationEmail = "";
    try {
      await expect(notifyCommercialProposalReceived(base)).resolves.toBe("not_configured");
      expect(enqueueMock).not.toHaveBeenCalled();
    } finally { EMAIL_CONFIG.commercialNotificationEmail = prev; }
  });

  it("falha do outbox é registrada e NÃO propaga (a solicitação já está persistida)", async () => {
    const prev = EMAIL_CONFIG.commercialNotificationEmail;
    EMAIL_CONFIG.commercialNotificationEmail = "comercial@teste.local";
    enqueueMock.mockRejectedValueOnce(new Error("outbox indisponível"));
    try {
      await expect(notifyCommercialProposalReceived(base)).resolves.toBe("failed");
    } finally { EMAIL_CONFIG.commercialNotificationEmail = prev; }
  });

  it("idempotência por solicitação e conteúdo mínimo", async () => {
    const prev = EMAIL_CONFIG.commercialNotificationEmail;
    EMAIL_CONFIG.commercialNotificationEmail = "comercial@teste.local";
    try {
      await notifyCommercialProposalReceived(base);
      const arg = enqueueMock.mock.calls[0][0];
      expect(arg.idempotencyKey).toBe("commercial_proposal:7");
      expect(Object.keys(arg.payload).sort()).toEqual(["adminUrl", "orgaoCidade", "orgaoEstado", "orgaoNome", "proposalId"]);
    } finally { EMAIL_CONFIG.commercialNotificationEmail = prev; }
  });
});

describe("LR-07/LR-03 — superfícies desativadas no servidor (sem apagar Stripe)", () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
  it("checkout e ativação por proposta recusam com LEGACY_ENDPOINT_DISABLED; stripeService preservado", () => {
    expect(read("routers/billingRouter.ts")).toMatch(/throwLegacyEndpointDisabled\(\s*"billing\.createCheckoutSession"/);
    expect(read("routers/commercialRouter.ts")).toMatch(/throwLegacyEndpointDisabled\(\s*"commercial\.activateSubscription"/);
    expect(read("routers/commercialRouter.ts")).not.toMatch(/createSubscription\(/);
    expect(read("services/stripeService.ts").length).toBeGreaterThan(0);
  });
});
