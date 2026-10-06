/**
 * SEM-058 — a justificativa do DFD gerada por IA é só uma SUGESTÃO:
 *   - exibida AO LADO do texto atual, com a origem dele (importado / pré-preenchido / escrito por servidor / IA / vazio);
 *   - o texto atual só é substituído por um "Aceitar" humano explícito (consentimento literal, texto exibido);
 *   - "Descartar" não chama nenhuma mutação (zero efeito);
 *   - gerar NÃO recarrega nem altera o editor (não há mais confirmação "só em user_modified").
 * Padrão do projeto: puro + árvore de elementos + render estático + varredura de fonte (sem DOM).
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  acceptBlock, acceptLabel, buildAcceptInput, isSuggestionObsolete, replacesExistingText, originNote,
  type JustificationSuggestionUI, type JustificationOriginUI,
} from "./dfdJustificationSuggestion";
import { DFDJustificationSuggestionView } from "./DFDJustificationSuggestionPanel";

(globalThis as unknown as { React: typeof React }).React = React;

const sug = (over: Partial<JustificationSuggestionUI["current"]> = {}): JustificationSuggestionUI => ({
  suggestion: { text: "A Secretaria necessita do mobiliário para as salas de aula.", textHash: "abcd" },
  explanation: { executionId: "exec-abc123456789", provider: "gemini", model: "gemini-2.5-flash", promptVersion: "dfd-justificativa/1", unverifiedNumbers: [] },
  current: { text: "Texto importado do ofício da Secretaria.", origin: "imported", originLabel: "importado de documento existente", contentHash: "H1", ...over },
});

type El = React.ReactElement<Record<string, unknown>>;
function collect(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return out; }
  if (node && typeof node === "object" && "props" in (node as object)) { const el = node as El; out.push(el); collect(el.props.children, out); }
  return out;
}
const viewProps = (over: Record<string, unknown> = {}) => ({
  suggestion: sug(), docContentHash: "H1", dirty: false, pending: false, text: sug().suggestion.text,
  onTextChange: () => {}, onAccept: vi.fn(), onDiscard: vi.fn(), ...over,
}) as unknown as Parameters<typeof DFDJustificationSuggestionView>[0];

describe("SEM-058 — comparação: sugestão ao lado do texto atual, com a origem", () => {
  it.each([
    ["imported", "importado de documento existente"], ["prefilled", "pré-preenchido pelo sistema"],
    ["human_edited", "escrito/editado por servidor"], ["ai_suggestion", "sugestão de IA já aceita"], ["empty", "vazio"],
  ] as Array<[JustificationOriginUI, string]>)("origem %s é exibida junto do texto atual", (origin, label) => {
    const html = renderToStaticMarkup(createElement(DFDJustificationSuggestionView, viewProps({ suggestion: sug({ origin, originLabel: label }) })));
    expect(html).toContain("Texto atual (seção 2)");
    expect(html).toContain(label);
    expect(html).toContain(originNote(origin));
    expect(html).toContain("Sugestão da IA");
    expect(html).toContain("Texto importado do ofício da Secretaria."); // o texto atual sempre à vista
    expect(html).toContain("O DFD não foi alterado");
  });

  it("seção vazia: aviso 'ainda não preenchida' e botão de inserir (sem aviso de substituição)", () => {
    const s = sug({ text: null, origin: "empty", originLabel: "vazio (ainda não escrito)" });
    expect(replacesExistingText(s)).toBe(false);
    const html = renderToStaticMarkup(createElement(DFDJustificationSuggestionView, viewProps({ suggestion: s })));
    expect(html).toContain("Seção ainda não preenchida.");
    expect(html).toContain("Aceitar e inserir na seção 2");
    expect(html).not.toContain("será substituído");
  });

  it("texto atual existente: botão explicita a substituição e o aviso diz que fica no histórico", () => {
    expect(acceptLabel(sug())).toBe("Aceitar e substituir o texto atual");
    const html = renderToStaticMarkup(createElement(DFDJustificationSuggestionView, viewProps()));
    expect(html).toContain("Aceitar e substituir o texto atual");
    expect(html).toContain("permanece no histórico de edições");
  });

  it("números não confirmados pelo processo ficam destacados para revisão", () => {
    const s = sug(); s.explanation.unverifiedNumbers = ["75", "90"];
    expect(renderToStaticMarkup(createElement(DFDJustificationSuggestionView, viewProps({ suggestion: s })))).toContain("[REVISAR: …] não foram confirmados pelo processo: 75, 90");
  });
});

describe("SEM-058 — aceitar × descartar", () => {
  it("DESCARTAR só chama onDiscard: nenhuma chamada de aceite (zero efeito); ACEITAR envia o texto exibido", () => {
    const onAccept = vi.fn(); const onDiscard = vi.fn();
    const els = collect(DFDJustificationSuggestionView(viewProps({ onAccept, onDiscard, text: "Texto revisado pelo servidor." })));
    const buttons = els.filter((e) => e.type === "button");
    const discard = buttons.find((b) => b.props.children === "Descartar sugestão")!;
    const accept = buttons.find((b) => String(b.props.children).startsWith("Aceitar"))!;
    (discard.props.onClick as () => void)();
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    (accept.props.onClick as () => void)();
    expect(onAccept).toHaveBeenCalledWith("Texto revisado pelo servidor."); // texto editado pelo humano, não o original
  });

  it("Aceitar fica DESABILITADO (com motivo) se obsoleto, com edição não salva, texto curto ou pendente", () => {
    const base = { suggestion: sug(), docContentHash: "H1", text: "Texto suficientemente longo.", dirty: false, pending: false };
    expect(acceptBlock(base)).toBeNull();
    expect(acceptBlock({ ...base, docContentHash: "H2" })).toBe("obsolete");
    expect(acceptBlock({ ...base, dirty: true })).toBe("unsaved_edits");
    expect(acceptBlock({ ...base, text: "curto" })).toBe("empty_text");
    expect(acceptBlock({ ...base, pending: true })).toBe("pending");
    const html = renderToStaticMarkup(createElement(DFDJustificationSuggestionView, viewProps({ dirty: true })));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Aceitar e substituir/);
    expect(html).toContain("Salve-as (ou descarte-as)");
    expect(isSuggestionObsolete(sug(), "H2")).toBe(true);
    expect(isSuggestionObsolete(sug(), "H1")).toBe(false);
    expect(isSuggestionObsolete(null, "H1")).toBe(false);
  });

  it("entrada do aceite: consentimento literal, hash visto, execução da sugestão e chave de idempotência", () => {
    expect(buildAcceptInput({ processId: "p1", docContentHash: "H1", suggestion: sug(), text: "T", idempotencyKey: "k" })).toEqual({
      processId: "p1", expectedContentHash: "H1", suggestionExecutionId: "exec-abc123456789", text: "T", confirmAccept: true, idempotencyKey: "k",
    });
  });
});

describe("SEM-058 — guarda estática do DFDWorkspace", () => {
  const ROOT = path.resolve(import.meta.dirname, "../../../..");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ws = strip(readFileSync(path.join(ROOT, "client/src/components/procurement/DFDWorkspace.tsx"), "utf8"));

  it("gerar a sugestão não recarrega nem escreve o editor; não há confirmação condicionada a user_modified", () => {
    const gen = ws.slice(ws.indexOf("generateDFDJustification.useMutation"), ws.indexOf("acceptDFDJustification.useMutation"));
    expect(gen).toMatch(/setSuggestion\(/);
    expect(gen.slice(0, gen.indexOf("onError"))).not.toMatch(/reloadEditor|invalidate|setDraft/);
    expect(ws).not.toMatch(/confirmReplace/);
    expect(ws).not.toMatch(/user_modified/);
    expect(ws).not.toMatch(/window\.confirm\(\s*"A justificativa/);
  });

  it("a única chamada que grava o texto da IA é o aceite explícito (via buildAcceptInput, consentimento literal)", () => {
    expect(ws.match(/acceptJustification\.mutate\(/g)).toHaveLength(1);
    expect(ws).toMatch(/acceptJustification\.mutate\(buildAcceptInput\(/);
    const discard = ws.slice(ws.indexOf("const onDiscardSuggestion"), ws.indexOf("const state = "));
    expect(discard).not.toMatch(/\.mutate\(/); // descartar não muta
    expect(discard).toMatch(/setSuggestion\(null\)/);
  });
});
