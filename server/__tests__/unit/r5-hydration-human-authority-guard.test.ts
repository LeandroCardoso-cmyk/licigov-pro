/**
 * R5 / R5.1 — guard TRANSVERSAL (INV-05) + PR-10 (SEM-019) + PR-11 (SEM-021/SEM-022).
 *
 *  - `effectiveOpinionPatch` (pura): campo em branco não apaga; igual ao persistido não conta; conclusão não vira null;
 *  - guarda estática: os formulários oficiais hidratam do persistido (`useHydratedForm`), não abrem com default
 *    decisório ("favoravel") e só registram com aceite humano explícito (`confirmOfficial` / `confirmAccept`);
 *  - guarda estática do servidor: gerar justificativa NÃO persiste nem emite documento oficial.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { effectiveOpinionPatch, type LegalOpinionDraft } from "../../domain/legalOpinionDraft";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const draft = {
  id: "d1", organizationId: 1, workspaceId: "w1", requestId: "r1", opinionType: "LEGAL_OPINION_INITIAL",
  report: "Relatório", foundation: "Fundamentação", conclusion: "Conclusão", conclusionType: "favoravel",
  recommendations: ["a"], reservations: [], attachments: [], status: "rascunho", version: 3, signed: false,
  signatureMethod: null, signedBy: null, signedAt: null, author: 1, correlationId: "c", createdAt: "", updatedAt: "",
} as unknown as LegalOpinionDraft;

describe("PR-10 — effectiveOpinionPatch", () => {
  it("descarta brancos, iguais e conclusão nula por omissão", () => {
    expect(effectiveOpinionPatch(draft, { report: "", foundation: "  ", conclusion: "Conclusão", conclusionType: null, recommendations: ["a"] })).toEqual({});
  });
  it("mantém só o que mudou", () => {
    expect(effectiveOpinionPatch(draft, { report: "Novo relatório", conclusionType: "desfavoravel", reservations: ["r"] }))
      .toEqual({ report: "Novo relatório", conclusionType: "desfavoravel", reservations: ["r"] });
  });
});

describe("R5.1 — formulários oficiais hidratam do persistido e exigem aceite humano", () => {
  const FORMS = [
    "client/src/components/legal-opinion/LegalOpinionEditor.tsx",
    "client/src/components/direct-procurement/ContractJustificationWorkspace.tsx",
    "client/src/components/direct-procurement/PriceJustificationWorkspace.tsx",
  ];

  it.each(FORMS)("%s usa useHydratedForm e bloqueia envio antes da hidratação", (rel) => {
    const src = stripComments(read(rel));
    expect(src).toMatch(/useHydratedForm\(/);
    expect(src).toMatch(/form\.ready/);
  });

  it("o editor de parecer não preseleciona conclusão e envia expectedVersion (CAS)", () => {
    const src = stripComments(read("client/src/components/legal-opinion/LegalOpinionEditor.tsx"));
    expect(src).not.toMatch(/useState<[^>]*>\(\s*"(favoravel|desfavoravel|com_ressalvas|parcialmente_favoravel)"/);
    expect(src).not.toMatch(/useState\(\s*"(favoravel|desfavoravel)"/);
    expect(src).toMatch(/expectedVersion:/);
  });

  it("justificativas só registram com aceite explícito", () => {
    expect(stripComments(read("client/src/components/direct-procurement/ContractJustificationWorkspace.tsx"))).toMatch(/confirmAccept:\s*true/);
    expect(stripComments(read("client/src/components/direct-procurement/PriceJustificationWorkspace.tsx"))).toMatch(/confirmOfficial:\s*true/);
  });

  it("servidor: gerar justificativa da contratação não persiste nem emite documento oficial", () => {
    const src = stripComments(read("server/services/directProcurementService.ts"));
    const start = src.indexOf("export async function generateContractJustification");
    const end = src.indexOf("export async function acceptContractJustification");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/upsertContractJustification|generateOfficialDocument|insert[A-Z]\w*\(/);
  });
});
