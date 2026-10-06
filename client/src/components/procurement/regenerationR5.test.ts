/**
 * PR-09 / R5 (decisões do owner) — UI de regeneração:
 *   A) confirmação explícita basta (sem justificativa textual); CANCELAR/fechar o diálogo NÃO chama a mutação
 *      (zero efeito); só "Substituir e gerar" dispara `onConfirm`;
 *   B) documento aprovado/oficial ⇒ "Gerar" bloqueado ANTES de qualquer chamada, com explicação do novo ciclo
 *      de versão governado (também reconhece a recusa do servidor pelo token estável);
 *   C) critério de julgamento / regime de execução: hidratação do persistido, vazio nunca apaga, 1ª definição
 *      não é "troca", sobrescrever é troca explícita; NULL persistido ⇒ "requer revisão".
 * Padrão do projeto: puro + árvore de elementos + varredura de fonte (sem testing-library/DOM).
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  planRegeneration, describeRegenerationBlock, isOfficialRegenerationRefusal,
  resolveEditalTextValues, editalTextProposal, editalTextOverwrites, editalTextPendingReview,
} from "./regenerationGuard";
import RegenerationConfirmDialog from "./RegenerationConfirmDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";

// A suíte de frontend roda em node sem transform JSX automático: os componentes usam o runtime clássico.
(globalThis as unknown as { React: typeof React }).React = React;

type El = React.ReactElement<Record<string, unknown>>;
function collect(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) collect(n, out); return out; }
  if (node && typeof node === "object" && "props" in (node as object)) {
    const el = node as El;
    out.push(el);
    collect(el.props.children, out);
  }
  return out;
}

const official = { reason: "official_emitted", officialVersion: 2, emittedAt: null } as const;
const human = { reason: "human_edit", operation: "human_edit", actorUserId: 9, at: null } as const;

describe("R5.A — plano de regeneração (decisão pura antes de qualquer chamada)", () => {
  it("conteúdo humano sem confirmação ⇒ confirm (nenhuma mutação); confirmado ⇒ mutate; IA-only ⇒ mutate", () => {
    expect(planRegeneration({ confirmed: false, needsReplace: true })).toBe("confirm");
    expect(planRegeneration({ confirmed: true, needsReplace: true })).toBe("mutate");
    expect(planRegeneration({ confirmed: false, needsReplace: false })).toBe("mutate");
    expect(planRegeneration({ confirmed: false, needsReplace: false, parameterChange: true })).toBe("confirm");
  });

  it("diálogo: CANCELAR/fechar não chama onConfirm (zero efeito); só a ação explícita confirma; sem campo de justificativa", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const tree = RegenerationConfirmDialog({ open: true, onOpenChange, documentLabel: "TR", humanEdit: human, currentLength: 1200, onConfirm });
    const els = collect(tree);
    const root = els.find((e) => e.type === AlertDialog)!;
    const cancel = els.find((e) => e.type === AlertDialogCancel)!;
    const action = els.find((e) => e.type === AlertDialogAction)!;
    expect(root.props.onOpenChange).toBe(onOpenChange);          // fechar (Esc/overlay/Cancelar) só muda `open`
    expect(cancel.props.onClick).toBeUndefined();                 // Cancelar não tem efeito próprio
    expect(cancel.props.children).toBe("Continuar editando");
    (root.props.onOpenChange as (o: boolean) => void)(false);     // dismiss
    expect(onConfirm).not.toHaveBeenCalled();
    (action.props.onClick as () => void)();                        // confirmação explícita
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Nenhuma justificativa textual obrigatória (decisão do owner): o diálogo não tem input/textarea.
    expect(els.some((e) => e.type === "input" || e.type === "textarea")).toBe(false);
    // Mostra que há edição humana e o que será substituído; o histórico é preservado.
    const text = JSON.stringify(els.map((e) => (typeof e.props.children === "string" ? e.props.children : "")));
    expect(text).toContain("Substituir e gerar");
  });
});

describe("R5.B — documento aprovado/oficial", () => {
  it("bloqueado mesmo após 'confirmar' (nunca chama o servidor)", () => {
    expect(planRegeneration({ confirmed: true, needsReplace: true, block: official })).toBe("blocked");
    expect(planRegeneration({ confirmed: false, needsReplace: false, block: { reason: "approved", officialVersion: null, emittedAt: null } })).toBe("blocked");
  });

  it("explica o novo ciclo de versão governado e aponta o caminho existente (edição + nova emissão)", () => {
    const t = describeRegenerationBlock("Edital", official)!;
    expect(t).toContain("v2");
    expect(t).toMatch(/novo ciclo de versão governado/);
    expect(t).toMatch(/nova emissão governada/);
    expect(describeRegenerationBlock("ETP", null)).toBeNull();
    expect(isOfficialRegenerationRefusal("OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: o TR já possui…")).toBe(true);
    expect(isOfficialRegenerationRefusal("HUMAN_EDIT_WOULD_BE_OVERWRITTEN: …")).toBe(false);
  });
});

describe("R5.C — critério de julgamento / regime de execução (texto institucional)", () => {
  const untouched = { judgmentCriterion: null, executionRegime: null };
  const persisted = { judgmentCriterion: "Menor preço", executionRegime: null };

  it("reload sem digitação ⇒ exibe o PERSISTIDO; NULL ⇒ vazio + requer revisão (nenhum padrão)", () => {
    expect(resolveEditalTextValues(untouched, persisted)).toEqual({ judgmentCriterion: "Menor preço", executionRegime: "" });
    expect(resolveEditalTextValues(untouched, null)).toEqual({ judgmentCriterion: "", executionRegime: "" });
    expect(editalTextPendingReview(persisted)).toEqual(["executionRegime"]);
    expect(editalTextPendingReview(null)).toEqual(["judgmentCriterion", "executionRegime"]);
  });

  it("envia só o digitado e diferente; vazio nunca apaga; 1ª definição não é troca; sobrescrever é troca", () => {
    expect(editalTextProposal(untouched, persisted)).toEqual({});
    expect(editalTextProposal({ judgmentCriterion: "  ", executionRegime: null }, persisted)).toEqual({});
    expect(editalTextProposal({ judgmentCriterion: "Menor preço", executionRegime: " Tarefa " }, persisted)).toEqual({ executionRegime: "Tarefa" });
    expect(editalTextOverwrites({ judgmentCriterion: null, executionRegime: "Tarefa" }, persisted)).toBe(false);
    expect(editalTextOverwrites({ judgmentCriterion: "Maior desconto", executionRegime: null }, persisted)).toBe(true);
  });
});

const read = (f: string) => readFileSync(path.join(process.cwd(), "client/src/components/procurement", f), "utf8");

describe("guarda de fonte — workspaces (R5)", () => {
  it.each([["ETPWorkspace.tsx", "ETP"], ["TRWorkspace.tsx", "TR"], ["EditalWorkspace.tsx", "Edital"]])(
    "%s decide pelo plano puro, desabilita 'Gerar' e explica o bloqueio oficial", (f, label) => {
      const src = read(f);
      expect(src).toContain("planRegeneration(");
      expect(src).toContain('if (plan === "blocked") return;');
      expect(src).toContain("draft?.regenerationBlock");
      expect(src).toContain("|| !!regenerationBlock}");
      expect(src).toContain(`<RegenerationBlockedNotice documentLabel="${label}" block={regenerationBlock} />`);
    });

  it("EditalWorkspace persiste critério/regime sem padrão (hidrata do persistido) e envia só a proposta", () => {
    const src = read("EditalWorkspace.tsx");
    expect(src).toContain("resolveEditalTextValues(proposedText, persisted)");
    expect(src).toContain("...textProposal");
    expect(src).toContain("Critério de julgamento");
    expect(src).toContain("Regime de execução");
    expect(src).toContain("requer revisão");
    expect(src).not.toMatch(/useState<EditalTextParams>\(\{ judgmentCriterion: "/);
  });
});
