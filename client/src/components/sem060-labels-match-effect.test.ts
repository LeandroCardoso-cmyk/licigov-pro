/**
 * SEM-060 — rótulos que correspondem ao EFEITO real:
 *   a) "Gerar publicações" também avança a etapa → o rótulo/feedback dizem os dois efeitos (e a etapa vem do servidor);
 *   b) "Importar DFD" legado só registra um evento → rótulo e retorno dizem exatamente isso;
 *   c) LegacyImportWizard dizia "você confirma" mas grava direto → a cópia descreve a gravação imediata;
 *   d) CopilotPanel: "Aceitar/Rejeitar" sem handler → só existem com handler real (sem sucesso falso);
 *   e) "Assinar parecer" é irreversível → abre confirmação explícita; só a ação do diálogo muta.
 * Padrão do projeto: render estático (react-dom/server) + árvore de elementos + varredura de fonte (sem DOM).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLISH_BUTTON_LABEL, PUBLISH_EFFECT_NOTE, publishSuccessMessage } from "./direct-procurement/publicationCopy";
import { LEGACY_DFD_REGISTER_BUTTON, LEGACY_DFD_REGISTER_NOTE, legacyDfdRegisteredMessage } from "./procurement/legacyDfdImportCopy";
import { LEGACY_IMPORT_NOTE, LEGACY_IMPORT_BUTTON, legacyImportResultTitle } from "./department-operation/legacyImportCopy";
import { signConfirmEffects, SIGN_CONFIRM_ACTION } from "./legal-opinion/signatureConfirm";
import CopilotPanel from "./contract-workspace/CopilotPanel";

(globalThis as unknown as { React: typeof React }).React = React;

const ROOT = path.resolve(import.meta.dirname, "../../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => strip(readFileSync(path.join(ROOT, rel), "utf8"));

type El = React.ReactElement<Record<string, unknown>>;
function collect(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return out; }
  if (node && typeof node === "object" && "props" in (node as object)) { const el = node as El; out.push(el); collect(el.props.children, out); }
  return out;
}

describe("a) publicações: rótulo = efeito (gera E avança a etapa)", () => {
  it("o botão e a nota dizem que a etapa avança; o feedback usa a etapa devolvida pelo servidor", () => {
    expect(PUBLISH_BUTTON_LABEL).toBe("Gerar publicações e avançar para a etapa Publicação");
    expect(PUBLISH_EFFECT_NOTE).toMatch(/move o processo para a etapa Publicação/);
    expect(PUBLISH_EFFECT_NOTE).toMatch(/não os publica nos veículos oficiais/);
    expect(publishSuccessMessage(3, "Publicação")).toBe("3 documento(s) de publicação gerado(s). O processo avançou para a etapa Publicação.");
  });

  it("PublicationWorkspace usa o rótulo do efeito (nunca o rótulo antigo isolado) e mostra a etapa efetiva do servidor", () => {
    const src = read("client/src/components/direct-procurement/PublicationWorkspace.tsx");
    expect(src).toMatch(/PUBLISH_BUTTON_LABEL/);
    expect(src).not.toMatch(/"Gerar publicações"/);
    expect(src).toMatch(/STAGE_LABELS\[publish\.data\.stage\]/);
  });

  it("o servidor devolve a transição efetiva (publish gera E move para PUBLICATION; LEG-011 aponta publish como a transição canônica)", () => {
    const router = read("server/routers/directProcurementRouter.ts");
    const body = router.slice(router.indexOf("publish: orgRoleProcedure"), router.indexOf("configureFlags: orgRoleProcedure"));
    // Integrado com SEM-064: o ponteiro/status só passa a `publicado` DEPOIS de as publicações estarem gravadas
    // (`markDirectPublished`), e a resposta continua declarando a etapa efetiva (SEM-060).
    expect(body).toMatch(/markDirectPublished\(ws\)/);
    expect(body).toMatch(/return \{ publications, contractExtract, stage: moved\.currentStage \}/);
  });
});

describe("b) 'Importar DFD' legado só registra um evento", () => {
  it("rótulo e retorno dizem exatamente isso (sem prometer importação)", () => {
    expect(LEGACY_DFD_REGISTER_BUTTON).toBe("Registrar no histórico");
    expect(LEGACY_DFD_REGISTER_NOTE).toMatch(/só registra, no histórico do processo/);
    expect(LEGACY_DFD_REGISTER_NOTE).toMatch(/não importa o conteúdo e não cria o DFD/);
    expect(legacyDfdRegisteredMessage("PDF")).toBe("Registrado no histórico do processo: DFD de origem (PDF). O conteúdo NÃO foi importado e nenhum DFD foi criado.");
  });

  it("DFDWorkspace: o bloco legado não tem mais o botão 'Importar DFD' e mostra o retorno de sucesso", () => {
    const src = read("client/src/components/procurement/DFDWorkspace.tsx");
    expect(src).not.toMatch(/>\s*Importar DFD\s*</);
    expect(src).not.toMatch(/"Importar DFD"/);
    expect(src).toMatch(/LEGACY_DFD_REGISTER_BUTTON/);
    expect(src).toMatch(/legacyDfdRegisteredMessage\(SOURCE_LABELS\[source\]\)/);
  });

  it("o servidor realmente só registra um evento (não persiste DFD)", () => {
    const router = read("server/routers/procurementProcessRouter.ts");
    const body = router.slice(router.indexOf("importDFD: orgRoleProcedure"));
    const importBody = body.slice(0, body.indexOf("return { dfd };"));
    expect(importBody).toMatch(/recordProcessEvent\(/);
    expect(importBody).not.toMatch(/insertGeneratedDocument|applyDraftContentMutationTx|generateDFDDraft/);
  });
});

describe("c) LegacyImportWizard: a cópia descreve a gravação imediata", () => {
  it("não diz 'você confirma'; diz que registra de imediato como Origem Externa", () => {
    expect(LEGACY_IMPORT_NOTE).not.toMatch(/você confirma/i);
    expect(LEGACY_IMPORT_NOTE).toMatch(/registra o documento de imediato como Origem Externa, sem pedir confirmação dos campos antes/);
    expect(LEGACY_IMPORT_BUTTON).toMatch(/registrar como Origem Externa/i);
    expect(legacyImportResultTitle(0.667)).toBe("Registrado como Origem Externa (extração assistida) — confiança 67%. Confira os campos extraídos.");
    const src = read("client/src/components/department-operation/LegacyImportWizard.tsx");
    expect(src).not.toMatch(/você confirma/i);
    expect(src).toMatch(/LEGACY_IMPORT_NOTE/);
  });
});

describe("d) CopilotPanel: sem handler real, sem botão", () => {
  const rec = { reasoning: "r", explainability: "e", provenance: "p", confidence: 0.8 };

  it("sem onAccept/onReject: nenhum botão Aceitar/Rejeitar e aviso de recomendação apenas informativa", () => {
    const html = renderToStaticMarkup(createElement(CopilotPanel, { recommendation: rec }));
    expect(html).not.toContain("Aceitar");
    expect(html).not.toContain("Rejeitar");
    expect(html).not.toContain("<button");
    expect(html).toContain("apenas informativa");
  });

  it("com handlers reais: os botões existem e chamam EXATAMENTE os handlers fornecidos", () => {
    const onAccept = vi.fn(); const onReject = vi.fn();
    const buttons = collect(CopilotPanel({ recommendation: rec, onAccept, onReject })).filter((e) => e.type === "button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.onClick).toBe(onAccept);
    expect(buttons[1].props.onClick).toBe(onReject);
    // só um handler ⇒ só o botão correspondente (nunca botão órfão)
    const only = collect(CopilotPanel({ recommendation: rec, onReject })).filter((e) => e.type === "button");
    expect(only).toHaveLength(1);
    expect(only[0].props.onClick).toBe(onReject);
  });

  it("o único consumidor (DocumentsWorkspace) não passa handlers ⇒ painel informativo", () => {
    const src = read("client/src/components/contract-workspace/DocumentsWorkspace.tsx");
    expect(src).toMatch(/<CopilotPanel recommendation=\{rec\} busy=\{generate\.isPending\} \/>/);
  });
});

describe("e) 'Assinar parecer' exige confirmação explícita do efeito irreversível", () => {
  it("a confirmação descreve a irreversibilidade, a imutabilidade, a emissão e a exigência de atribuição", () => {
    const e = signConfirmEffects("manual").join("\n");
    expect(e).toMatch(/não pode ser desfeita/);
    expect(e).toMatch(/imutável/);
    expect(e).toMatch(/documento oficial/);
    expect(e).toMatch(/procurador atribuído/);
    expect(signConfirmEffects("icp_brasil")[0]).toContain("ICP-Brasil");
    expect(SIGN_CONFIRM_ACTION).toBe("Assinar e tornar imutável");
  });

  it("o botão 'Assinar parecer' só abre o diálogo; a ÚNICA chamada de sign.mutate está na ação do diálogo", () => {
    const src = read("client/src/components/legal-opinion/SignaturePanel.tsx");
    expect(src.match(/sign\.mutate\(/g)).toHaveLength(1);
    const trigger = src.slice(src.indexOf("disabled={sign.isPending || signed}"), src.indexOf("Devolver à origem"));
    expect(trigger).toMatch(/onClick=\{\(\) => setConfirmOpen\(true\)\}/);
    expect(trigger).not.toMatch(/sign\.mutate/);
    const action = src.slice(src.indexOf("<AlertDialogAction"), src.indexOf("</AlertDialogAction>"));
    expect(action).toMatch(/sign\.mutate\(\{ workspaceId, method, idempotencyKey: ensureSignKey\(\) \}\)/);
    expect(src).toMatch(/<AlertDialogCancel>\{SIGN_CONFIRM_CANCEL\}<\/AlertDialogCancel>/); // cancelar não tem efeito próprio
  });

  it("NEW-007 intacto: a atribuição continua exigida NO SERVIDOR antes de assinar (a tela não decide autoridade)", () => {
    const router = read("server/routers/legalOpinionWorkspaceRouter.ts");
    const body = router.slice(router.indexOf("signOpinion: legalMutationProcedure"), router.indexOf("returnOpinion: legalMutationProcedure"));
    expect(body).toMatch(/requireAssignedLawyer\([^)]*"sign_opinion"\)/);
    expect(body.indexOf("requireAssignedLawyer")).toBeLessThan(body.indexOf("signOpinion({"));
  });
});
