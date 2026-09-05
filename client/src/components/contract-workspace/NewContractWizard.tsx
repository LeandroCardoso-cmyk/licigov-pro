import React from "react";
import { trpc } from "../../lib/trpc";
import { friendlyContractError, isRawValidationLeak } from "./contractErrorPolicy";

/**
 * NewContractWizard — REAL (tRPC).
 *
 * Cria contrato por QUATRO origens:
 *  - Processo Licitatório  (deriva de um processo)
 *  - Contratação Direta    (deriva de uma dispensa/inexigibilidade)
 *  - Novo (do zero)        (AVULSO — não vinculado a nenhum processo; dados digitados)
 *  - Externo (reconstrução) (PDF/DOCX → texto → extração assistida)
 */

export interface NewContractWizardProps {
  onCreated?: (contractId: string) => void;
}

type Origin = "processo_licitatorio" | "contratacao_direta" | "avulso" | "externo";

const ORIGINS: ReadonlyArray<readonly [Origin, string]> = [
  ["processo_licitatorio", "Do Processo"],
  ["contratacao_direta", "Da Contratação Direta"],
  ["avulso", "Novo (do zero)"],
  ["externo", "Externo (reconstrução)"],
];

/** Extrai "(id: ...)" da mensagem de conflito — ver contractWorkspaceRouter.createManual. */
function parseConflictExistingId(message: string): string | null {
  const m = message.match(/\(id: ([a-f0-9]+)\)/);
  return m ? m[1] : null;
}

export default function NewContractWizard({ onCreated }: NewContractWizardProps) {
  const utils = trpc.useUtils();
  const [origin, setOrigin] = React.useState<Origin>("avulso");
  const [contractNumber, setContractNumber] = React.useState("");
  const [originId, setOriginId] = React.useState("");
  const [rawText, setRawText] = React.useState("");
  // Campos do contrato avulso (novo do zero).
  const [contractor, setContractor] = React.useState("");
  const [object, setObject] = React.useState("");
  const [valueReais, setValueReais] = React.useState("");
  const [term, setTerm] = React.useState("");
  // Uma chave por tentativa de submissão — reenviada em retries (evita duplicidade em
  // reenvio de rede/duplo clique); reset após sucesso ou ao trocar de origem/forma.
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());

  // F7a — seleção institucional do processo canônico (reusa a listagem canônica
  // `procurementProcess.listProcesses`, tenant-scoped) em vez de exigir o id interno opaco.
  const processesQuery = trpc.procurementProcess.listProcesses.useQuery(
    { limit: 100 },
    { enabled: origin === "processo_licitatorio", refetchOnWindowFocus: false },
  );
  const processes = processesQuery.data?.processes ?? [];

  const onOk = (contractId: string) => {
    void utils.contractWorkspace.listContracts.invalidate();
    setIdempotencyKey(crypto.randomUUID()); // próxima criação usa uma chave nova
    onCreated?.(contractId);
  };
  const fromProc = trpc.contractWorkspace.createFromProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const fromDirect = trpc.contractWorkspace.createFromDirectProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const createManual = trpc.contractWorkspace.createManual.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const importExt = trpc.contractWorkspace.importExternalContract.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });

  const busy = fromProc.isPending || fromDirect.isPending || createManual.isPending || importExt.isPending;
  const rawErr = fromProc.error ?? fromDirect.error ?? createManual.error ?? importExt.error ?? null;
  // F7b — nunca exibir o corpo técnico/Zod; mapeamos para uma mensagem institucional e
  // preservamos o detalhe técnico apenas em observabilidade (console).
  React.useEffect(() => {
    if (isRawValidationLeak(rawErr)) {
      console.error("[NewContractWizard] validação recusada", { code: rawErr?.data?.code, detail: rawErr?.message });
    }
  }, [rawErr]);
  const err = friendlyContractError(rawErr);
  const conflictExistingId = createManual.error?.data?.code === "CONFLICT" ? parseConflictExistingId(createManual.error.message) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (origin === "processo_licitatorio") {
      fromProc.mutate({ processId: originId, contractNumber });
    } else if (origin === "contratacao_direta") {
      fromDirect.mutate({ directWorkspaceId: originId, contractNumber });
    } else if (origin === "avulso") {
      // Valor: usuário digita em reais; o sistema armazena em centavos.
      const parsed = parseFloat(valueReais.replace(/\./g, "").replace(",", "."));
      const valueCents = valueReais.trim() && !Number.isNaN(parsed) ? Math.round(parsed * 100) : undefined;
      createManual.mutate({
        idempotencyKey,
        contractNumber,
        contractor: contractor.trim() || undefined,
        object: object.trim() || undefined,
        value: valueCents,
        term: term.trim() || undefined,
      });
    } else {
      importExt.mutate({ source: "pdf", rawText, contractNumber: contractNumber || undefined });
    }
  };

  const inputCls = "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Novo Contrato</h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ORIGINS.map(([v, label]) => (
          <button key={v} type="button" onClick={() => { setOrigin(v); setOriginId(""); }}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition ${origin === v ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>{label}</button>
        ))}
      </div>

      <label className="block text-xs font-medium text-foreground">Número do contrato
        <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="CT-2026/001" className={inputCls} />
      </label>

      {origin === "processo_licitatorio" && (
        <label className="block text-xs font-medium text-foreground">
          Processo Licitatório
          <select value={originId} onChange={(e) => setOriginId(e.target.value)} className={inputCls} disabled={processesQuery.isLoading}>
            <option value="">{processesQuery.isLoading ? "Carregando processos…" : "Selecione o processo…"}</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.processNumber} — {p.object || "(sem objeto)"}
                {p.modality ? ` · ${p.modality}` : ""}
                {p.status ? ` · ${p.status}` : ""}
              </option>
            ))}
          </select>
          {!processesQuery.isLoading && processes.length === 0 && (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Nenhum processo licitatório disponível neste órgão. Crie o processo antes de derivar o contrato.
            </span>
          )}
        </label>
      )}

      {origin === "contratacao_direta" && (
        <label className="block text-xs font-medium text-foreground">
          ID da Contratação Direta
          <input value={originId} onChange={(e) => setOriginId(e.target.value)} placeholder="id de origem" className={inputCls} />
        </label>
      )}

      {origin === "avulso" && (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">Contratado (fornecedor)
            <input value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Razão social / nome" className={inputCls} />
          </label>
          <label className="block text-xs font-medium text-foreground">Objeto
            <textarea value={object} onChange={(e) => setObject(e.target.value)} rows={2} placeholder="Objeto do contrato" className={`${inputCls} resize-y`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-foreground">Valor (R$)
              <input value={valueReais} onChange={(e) => setValueReais(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-foreground">Vigência / prazo
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="12 meses" className={inputCls} />
            </label>
          </div>
          <span className="text-[11px] text-muted-foreground">Contrato <strong>avulso</strong> — não vinculado a processo. Nasce como <strong>minuta</strong> revisável; você pode gerar a íntegra e os aditivos depois.</span>
        </div>
      )}

      {origin === "externo" && (
        <label className="block text-xs font-medium text-foreground">Texto do contrato (PDF/DOCX convertido)
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={5} placeholder="Cole aqui o texto do contrato externo…" className={`${inputCls} resize-y`} />
          <span className="text-[11px] text-muted-foreground">O sistema faz a <strong>reconstrução assistida</strong> (fornecedor, objeto, prazo, valor, cláusulas) — uma sugestão que você revisa antes de criar o workspace.</span>
        </label>
      )}

      {err && !conflictExistingId && (
        <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{err}</p>
      )}
      {conflictExistingId && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>Já existe um contrato avulso com este número.</span>
          <button type="button" onClick={() => onCreated?.(conflictExistingId)} className="shrink-0 rounded-md border border-amber-300 px-2 py-1 font-medium hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900">
            Abrir contrato existente
          </button>
        </div>
      )}
      {importExt.data && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Reconstrução assistida — confiança {Math.round(importExt.data.confidence * 100)}%.</p>
          <p className="mt-0.5">{importExt.data.disclaimer}</p>
        </div>
      )}

      <button type="submit" disabled={busy || ((origin === "processo_licitatorio" || origin === "contratacao_direta") && !originId)} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {busy ? "Processando…" : origin === "externo" ? "Reconstruir contrato (assistido)" : origin === "avulso" ? "Criar contrato" : "Gerar contrato"}
      </button>
    </form>
  );
}
