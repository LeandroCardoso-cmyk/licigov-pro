/**
 * R2 / LEG-032 — `contact.submitContactForm` desativado de forma governada (decisão humana: DISABLE).
 *
 * Contrato comprovado:
 *  - a procedure continua registrada no appRouter e com o mesmo schema de input;
 *  - chamador público (anônimo) com input válido ⇒ `FORBIDDEN` + `LEGACY_ENDPOINT_DISABLED`, sempre;
 *  - `notifyOwner` NUNCA é chamado (nenhum efeito colateral);
 *  - input inválido continua barrado pela validação zod (`BAD_REQUEST`) — a validação roda antes do handler;
 *  - o rate limit `api` continua na frente da procedure (roda ANTES do handler);
 *  - o canal canônico `/solicitar-proposta` → `commercial.create` segue intacto (público + rate limit dedicado).
 *
 * `commercial.create` tem cobertura funcional própria em `pr0-security-emergency-closure(-mysql-smoke).test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const notifyOwnerMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../_core/notification", () => ({ notifyOwner: notifyOwnerMock }));

import { contactRouter } from "../../routers/contactRouter";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";
import { resetRateLimit } from "../../services/rateLimiter";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const IP = "203.0.113.32";

function publicCaller() {
  return contactRouter.createCaller({
    user: null,
    organizationId: null,
    orgMembership: null,
    correlationId: "leg032-corr",
    requestId: "leg032-req",
    req: { headers: {}, ip: IP },
    res: { setHeader: () => undefined },
  } as unknown as Parameters<typeof contactRouter.createCaller>[0]);
}

const validInput = () => ({
  name: "Fulano de Tal",
  email: "fulano@example.gov.br",
  organ: "Prefeitura de Teste",
  phone: "44999990000",
  message: "Gostaria de uma demonstração.",
});

describe("LEG-032 — contact.submitContactForm desativado", () => {
  beforeEach(() => {
    notifyOwnerMock.mockClear();
    resetRateLimit(`ip:${IP}`, "api");
  });

  it("chamador público com input válido ⇒ FORBIDDEN + LEGACY_ENDPOINT_DISABLED", async () => {
    const err = await publicCaller()
      .submitContactForm(validInput())
      .then(() => null, (e: unknown) => e as { code?: string; message?: string });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("FORBIDDEN");
    expect(err?.message).toContain(LEGACY_ENDPOINT_DISABLED);
    expect(err?.message).toContain("/solicitar-proposta");
    expect(notifyOwnerMock).not.toHaveBeenCalled();
  });

  it("recusa é determinística (chamadas repetidas, sem mensagem opcional) e nunca notifica o dono", async () => {
    for (let i = 0; i < 3; i++) {
      const { message: _omit, ...withoutMessage } = validInput();
      await expect(publicCaller().submitContactForm(withoutMessage)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(LEGACY_ENDPOINT_DISABLED),
      });
    }
    expect(notifyOwnerMock).not.toHaveBeenCalled();
  });

  it("input inválido continua barrado pela validação (BAD_REQUEST) sem efeito colateral", async () => {
    await expect(
      publicCaller().submitContactForm({ ...validInput(), email: "nao-e-email" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(notifyOwnerMock).not.toHaveBeenCalled();
  });

  it("rate limit 'api' roda ANTES do handler (excedido ⇒ TOO_MANY_REQUESTS, ainda sem notificar)", async () => {
    // RATE_LIMITS.api.max = 100 por minuto; as 100 primeiras chegam ao handler (FORBIDDEN).
    for (let i = 0; i < 100; i++) {
      await expect(publicCaller().submitContactForm(validInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(publicCaller().submitContactForm(validInput())).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(notifyOwnerMock).not.toHaveBeenCalled();
    resetRateLimit(`ip:${IP}`, "api");
  });
});

describe("LEG-032 — freeze estrutural", () => {
  const SRC = read("server/routers/contactRouter.ts");
  const ROUTERS = read("server/routers.ts");

  it("procedure continua registrada no appRouter (contact: contactRouter)", async () => {
    expect(ROUTERS).toMatch(/contact:\s*contactRouter/);
    const { appRouter } = await import("../../routers");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procedures["contact.submitContactForm"]).toBeDefined();
  }, 120_000);

  it("schema de input preservado (5 campos, 1 .input) e handler começa pelo guard LEG-032", () => {
    expect((SRC.match(/\.input\(/g) ?? []).length).toBe(1);
    for (const field of ["name:", "email:", "organ:", "phone:", "message:"]) expect(SRC).toContain(field);
    expect(SRC).toMatch(
      /\.mutation\(async \(\{ ctx \}\)[^\n]*=>\s*\{\s*throwLegacyEndpointDisabled\(\s*"contact\.submitContactForm",\s*"LEG-032"/,
    );
  });

  it("não há mais chamada a notifyOwner no router", () => {
    expect(SRC).not.toMatch(/notifyOwner\s*\(/);
  });

  it("landing/ContactForm.tsx não é importado por nenhum arquivo do client (sem UI alcançável)", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && !rel.endsWith("landing/ContactForm.tsx")) {
          if (/ContactForm/.test(read(rel))) importers.push(rel);
        }
      }
    };
    walk("client/src");
    expect(importers).toEqual([]);
    const APP = read("client/src/App.tsx");
    expect(APP).toContain('path={"/solicitar-proposta"}');
  });

  it("canal canônico preservado: commercial.create público com rate limit dedicado e usado por /solicitar-proposta", () => {
    const COMMERCIAL = read("server/routers/commercialRouter.ts");
    const createBlock = COMMERCIAL.slice(COMMERCIAL.indexOf("create:"), COMMERCIAL.indexOf("list:"));
    expect(createBlock).toContain("publicProcedure");
    expect(COMMERCIAL).toContain('rateLimitMiddleware("commercial")');
    expect(COMMERCIAL).not.toContain("LEGACY_ENDPOINT_DISABLED");
    expect(read("client/src/pages/SolicitarProposta.tsx")).toContain("trpc.commercial.create.useMutation");
  });
});
