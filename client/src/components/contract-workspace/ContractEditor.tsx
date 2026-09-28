import React from "react";
import { trpc } from "../../lib/trpc";
import { formatCurrency, statusLabel } from "./labels";

/**
 * ContractEditor — REAL (tRPC).
 *
 * Edição supervisionada do contrato: objeto, prazos, valor, contratado, gestor e
 * fiscal (não obrigatórios). Cláusulas/garantias/penalidades editáveis via minutas.
 *
 * SEM-023 (PR-12): o save envia a revisão carregada (`expectedUpdatedAt`, CAS). Fora da MINUTA
 * nenhum campo é editável aqui: valor/contratado/objeto/vigência só mudam por Termo Aditivo ou
 * Apostilamento, e a troca de gestor/fiscal exige ação própria de designação (ainda não disponível).
 * Por isso o formulário inteiro fica desabilitado fora da minuta. Recusas do servidor aparecem sem
 * ambiguidade.
 */

export interface ContractData {
  id: string; contractNumber: string; contractor: string; object: string;
  value: number; term: string; manager: string; inspector: string;
  status: string; updatedAt: string;
}

export interface ContractEditorProps { contract: ContractData; onSaved?: () => void }

const DRAFT_STATUS = "minuta";
const REVISION_CONFLICT = "CONTRACT_REVISION_CONFLICT";
const REQUIRES_INSTRUMENT = "CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT";
const REQUIRES_ASSIGNMENT_ACTION = "CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION";

function formFrom(contract: ContractData) {
  return {
    contractor: contract.contractor, object: contract.object, term: contract.term,
    value: String(contract.value), manager: contract.manager, inspector: contract.inspector,
  };
}

export default function ContractEditor({ contract, onSaved }: ContractEditorProps) {
  const utils = trpc.useUtils();
  const [form, setForm] = React.useState(() => formFrom(contract));
  // Revisão (CAS) que este formulário representa — avança com o retorno do próprio save.
  const [revision, setRevision] = React.useState(contract.updatedAt);
  const set = (k: keyof ReturnType<typeof formFrom>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // O contrato mudou fora deste formulário (outro save, aditivo, apostilamento): reidrata com a versão nova
  // em vez de manter um formulário antigo que o servidor recusaria por revisão divergente.
  React.useEffect(() => {
    if (contract.updatedAt !== revision) {
      setForm(formFrom(contract));
      setRevision(contract.updatedAt);
    }
  }, [contract.updatedAt]);

  // Fora da minuta a edição genérica não altera nenhum campo (o servidor recusa fail-closed): trava tudo.
  const locked = contract.status !== DRAFT_STATUS;

  const save = trpc.contractWorkspace.updateContract.useMutation({
    onSuccess: (data) => {
      setRevision(data.workspace.updatedAt);
      void utils.contractWorkspace.loadContract.invalidate({ contractId: contract.id });
      onSaved?.();
    },
  });

  const errorMessage = save.error?.message ?? "";
  const isConflict = errorMessage.includes(REVISION_CONFLICT);
  const needsInstrument = errorMessage.includes(REQUIRES_INSTRUMENT);
  const needsAssignmentAction = errorMessage.includes(REQUIRES_ASSIGNMENT_ACTION);

  const submit = () => {
    if (locked) return; // nada editável fora da minuta (o servidor também recusa)
    save.mutate({
      contractId: contract.id, expectedUpdatedAt: revision, manager: form.manager, inspector: form.inspector,
      contractor: form.contractor, object: form.object, term: form.term, value: Number(form.value) || 0,
    });
  };

  const inputCls = "mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Contrato {contract.contractNumber}</h3>
        <span className="text-xs text-muted-foreground">{formatCurrency(Number(form.value) || 0)}</span>
      </div>
      {locked && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Contrato em status “{statusLabel(contract.status)}”: a edição direta só é permitida na minuta.
          Valor, contratado, objeto e vigência só mudam por Termo Aditivo ou Apostilamento (abas ao lado).
          A designação ou substituição de gestor e fiscal após a minuta exige uma ação própria e auditada,
          ainda não disponível.
        </p>
      )}
      <fieldset disabled={locked} className="space-y-3">
        <label className="block text-xs font-medium text-foreground">Contratado
          <input value={form.contractor} onChange={(e) => set("contractor", e.target.value)} className={inputCls} />
        </label>
        <label className="block text-xs font-medium text-foreground">Objeto
          <textarea value={form.object} onChange={(e) => set("object", e.target.value)} rows={2} className={`${inputCls} resize-y`} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-foreground">Valor (R$)
            <input type="number" step="0.01" value={form.value} onChange={(e) => set("value", e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-foreground">Vigência
            <input value={form.term} onChange={(e) => set("term", e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-foreground">Gestor (opcional)
            <input value={form.manager} onChange={(e) => set("manager", e.target.value)} className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-foreground">Fiscal (opcional)
            <input value={form.inspector} onChange={(e) => set("inspector", e.target.value)} className={inputCls} />
          </label>
        </div>
        <button type="submit" disabled={save.isPending || locked} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
          {save.isPending ? "Salvando…" : "Salvar contrato"}
        </button>
      </fieldset>
      {save.isSuccess && !save.error && <p className="text-xs text-green-700 dark:text-green-300">Contrato atualizado.</p>}
      {save.error && (
        <div role="alert" className="space-y-1 text-xs text-red-700 dark:text-red-300">
          <p>{isConflict ? "Não salvo: o contrato foi alterado depois que você o abriu." : needsInstrument ? "Não salvo: esta alteração exige Termo Aditivo ou Apostilamento." : needsAssignmentAction ? "Não salvo: a troca de gestor/fiscal após a minuta exige ação própria de designação." : "Não foi possível salvar o contrato."}</p>
          <p>{errorMessage}</p>
          {isConflict && (
            <button type="button" onClick={() => { save.reset(); void utils.contractWorkspace.loadContract.invalidate({ contractId: contract.id }); }}
              className="font-medium text-indigo-600 underline dark:text-indigo-400">Recarregar contrato</button>
          )}
        </div>
      )}
    </form>
  );
}
