import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { BUDGET_PROVIDED_BY, budgetOutdatedInDraft, budgetPendingItems } from "@/lib/budgetAllocation";
import BudgetDisclosureCard from "./BudgetDisclosureCard";

export interface BudgetPendingNoticeProps {
  processId: string;
  /** Documento em que o aviso aparece (o texto do marcador muda só no nome). */
  documentLabel: "TR" | "Edital";
  /** `drafting`: durante a elaboração (discreto, com "Informar agora"). `finalizing`: junto da emissão (contexto único da emissão). */
  variant: "drafting" | "finalizing";
  /** Só TR: digest dos dados orçamentários com que o rascunho foi gerado (marcador `orcamento:`); diferente do atual ⇒ aviso de atualização. */
  draftBudgetDigest?: string | null;
}

/**
 * LICIGOV-FAST PR-2 — pendências INFORMATIVAS dos Dados orçamentários do processo (dotação/fonte). NUNCA bloqueia elaborar, gerar, exportar
 * ou emitir: indica o que falta, quem costuma fornecer e permite informar ali mesmo (o MESMO registro único do processo). Sem pendência
 * (declarado ou não aplicável), não aparece.
 */
export function BudgetPendingNotice({ processId, documentLabel, variant, draftBudgetDigest }: BudgetPendingNoticeProps) {
  const query = trpc.procurementProcess.budgetDisclosure.useQuery({ processId }, { enabled: !!processId, retry: false });
  const [open, setOpen] = useState(false);
  const allocation = query.data?.enabled ? query.data.allocation : null;
  const items = budgetPendingItems(allocation);
  const outdated = budgetOutdatedInDraft(allocation, draftBudgetDigest);
  if (outdated && variant === "finalizing") {
    return (
      <div role="status" className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 dark:text-sky-300" data-testid="budget-outdated-in-draft">
        <strong>Dados orçamentários atualizados depois da geração deste {documentLabel}.</strong> Atualize a seção “Adequação orçamentária” (ou gere novamente) para reaproveitá-los; se o texto já foi ajustado, desconsidere. Não impede a emissão.
      </div>
    );
  }
  // Card aberto continua montado depois de salvar (a confirmação de sucesso aparece mesmo que a pendência deixe de existir).
  if (items.length === 0 && !open) return null;
  if (items.length === 0) return <div className="mb-3"><BudgetDisclosureCard processId={processId} mode="allocation" /></div>;
  const list = items.map((i) => i.label).join(" e ");
  if (variant === "finalizing") {
    return (
      <div role="status" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300" data-testid="budget-pending-finalizing">
        <strong>Pendência informativa:</strong> {list} ainda não {items.length === 1 ? "informada" : "informadas"}. O {documentLabel} pode ser emitido assim: o texto indica que {items.length === 1 ? "será indicada" : "serão indicadas"} pelo setor responsável, e a pendência fica registrada no documento emitido.
        <span className="mt-1 block text-xs">A formalização da contratação continua exigindo a indicação dos créditos orçamentários; isso não muda aqui.</span>
      </div>
    );
  }
  return (
    <div className="mb-3 space-y-2 text-xs text-muted-foreground" data-testid="budget-pending-drafting">
      <p>
        Ainda não {items.length === 1 ? "informada" : "informadas"}: {list} (normalmente fornecidas pelo {BUDGET_PROVIDED_BY.toLowerCase()}). Não impede gerar nem emitir o {documentLabel};
        informe uma vez e o TR e o Edital reaproveitam.{" "}
        <button type="button" className="text-primary underline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Fechar" : "Informar agora"}</button>
      </p>
      {open && <BudgetDisclosureCard processId={processId} mode="allocation" />}
    </div>
  );
}
