import React from "react";
import { trpc } from "../../lib/trpc";
import { friendlyContractError, isRawValidationLeak } from "./contractErrorPolicy";
import { parseReaisInputToDecimal } from "../../lib/money";

/**
 * NewContractWizard — REAL (tRPC).
 *
 * Cria contrato por QUATRO origens:
 *  - Processo Licitatório  (deriva de um processo)
 *  - Contratação Direta    (deriva de uma dispensa/inexigibilidade)
 *  - Novo (do zero)        (AVULSO — não vinculado a nenhum processo; dados digitados)
 *  - Externo (reconstrução) (PDF/DOCX → texto → extração assistida)
 *
 * SEM-062: nas origens Processo/Contratação Direta o contrato NÃO herda nada em silêncio. O servidor devolve uma
 * PROPOSTA (`contractWorkspace.proposeInheritance`) com a procedência de cada candidata (id da proposta e da decisão
 * de ratificação); o servidor escolhe nada — o usuário seleciona, confere e CONFIRMA contratado/valor (editáveis).
 * Sem evidência canônica (ex.: processo licitatório não tem registro de adjudicação) o assistente diz isso e deixa
 * os campos em branco.
 */

export interface NewContractWizardProps {
  onCreated?: (contractId: string) => void;
}

type Origin = "processo_licitatorio" | "contratacao_direta" | "avulso" | "externo" | "legado";

const ORIGINS: ReadonlyArray<readonly [Origin, string]> = [
  ["processo_licitatorio", "Do Processo"],
  ["contratacao_direta", "Da Contratação Direta"],
  ["avulso", "Novo (do zero)"],
  ["externo", "Externo (reconstrução)"],
  ["legado", "Vigente (processo anterior)"],
];

/** Extrai "(id: ...)" da mensagem de conflito — ver contractWorkspaceRouter.createManual e domain/contractCreation. */
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
  // Contrato vigente de processo anterior (legado): término e referência declarada de origem.
  const [endDate, setEndDate] = React.useState("");
  const [sourceReference, setSourceReference] = React.useState("");
  // Reaproveitamento: registro do processo anterior (objeto/origem/vencimento já informados) e aditivos já formalizados.
  const [legacyRecordId, setLegacyRecordId] = React.useState("");
  const [priorAmendments, setPriorAmendments] = React.useState<Array<{ type: "prazo" | "valor" | "quantitativo" | "qualitativo"; reference: string; newTerm: string }>>([]);
  // SEM-062 — proposta selecionada (id do registro da proposta) + campos CONFIRMADOS pelo usuário (reais).
  const [proposalId, setProposalId] = React.useState("");
  const [inheritContractor, setInheritContractor] = React.useState("");
  const [inheritValueReais, setInheritValueReais] = React.useState("");
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

  // Registros operacionais que podem originar um contrato vigente (processo/contratação legados, contrato externo já monitorado).
  const legacyRecords = trpc.operationRecord.listRecords.useQuery({ limit: 100 }, { enabled: origin === "legado", refetchOnWindowFocus: false });
  const originCandidates = (legacyRecords.data?.records ?? []).filter((r) => ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo"].includes(r.recordType));
  const selectedRecord = originCandidates.find((r) => r.id === legacyRecordId);
  // SEM-062 — proposta de herança (somente leitura; nunca preenche sozinha).
  const inheritanceQuery = trpc.contractWorkspace.proposeInheritance.useQuery(
    { sourceType: origin === "contratacao_direta" ? "contratacao_direta" : "processo_licitatorio", sourceId: originId },
    { enabled: (origin === "processo_licitatorio" || origin === "contratacao_direta") && originId.trim().length > 0, retry: false, refetchOnWindowFocus: false },
  );
  const inheritance = (origin === "processo_licitatorio" || origin === "contratacao_direta") && originId.trim() ? inheritanceQuery.data : undefined;
  const selectProposal = (id: string, c: { supplierName: string; value: number }) => {
    setProposalId(id);
    setInheritContractor(c.supplierName);
    setInheritValueReais(String(c.value).replace(".", ","));
  };
  const resetInheritance = () => { setProposalId(""); setInheritContractor(""); setInheritValueReais(""); };

  const onOk = (contractId: string) => {
    void utils.contractWorkspace.listContracts.invalidate();
    setIdempotencyKey(crypto.randomUUID()); // próxima criação usa uma chave nova
    onCreated?.(contractId);
  };
  const fromProc = trpc.contractWorkspace.createFromProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const fromDirect = trpc.contractWorkspace.createFromDirectProcurement.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const createManual = trpc.contractWorkspace.createManual.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const importExt = trpc.contractWorkspace.importExternalContract.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });
  const registerLegacy = trpc.contractWorkspace.registerInForceContract.useMutation({ onSuccess: (r) => onOk(r.workspace.id) });

  const busy = fromProc.isPending || fromDirect.isPending || createManual.isPending || importExt.isPending || registerLegacy.isPending;
  const rawErr = fromProc.error ?? fromDirect.error ?? createManual.error ?? importExt.error ?? registerLegacy.error ?? null;
  // F7b — nunca exibir o corpo técnico/Zod; mapeamos para uma mensagem institucional e
  // preservamos o detalhe técnico apenas em observabilidade (console).
  React.useEffect(() => {
    if (isRawValidationLeak(rawErr)) {
      console.error("[NewContractWizard] validação recusada", { code: rawErr?.data?.code, detail: rawErr?.message });
    }
  }, [rawErr]);
  const err = friendlyContractError(rawErr);
  // R3 / PR-06 — CONFLICT (CONTRACT_ALREADY_EXISTS) em QUALQUER origem: a criação nunca altera o contrato existente.
  const conflictExistingId = rawErr?.data?.code === "CONFLICT" ? parseConflictExistingId(rawErr.message) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (origin === "processo_licitatorio") {
      fromProc.mutate({ processId: originId, contractNumber });
    } else if (origin === "contratacao_direta") {
      // SEM-062 — com proposta selecionada, envia a proposta (procedência) e os valores CONFIRMADOS (reais).
      fromDirect.mutate({
        directWorkspaceId: originId, contractNumber,
        ...(proposalId ? {
          sourceProposalId: proposalId,
          contractor: inheritContractor.trim() || undefined,
          value: parseReaisInputToDecimal(inheritValueReais),
        } : {}),
      });
    } else if (origin === "avulso") {
      // NEW-038: o valor do contrato é guardado em REAIS (DECIMAL 15,2), como no editor — nunca centavos.
      const valueReaisDecimal = parseReaisInputToDecimal(valueReais);
      createManual.mutate({
        idempotencyKey,
        contractNumber,
        contractor: contractor.trim() || undefined,
        object: object.trim() || undefined,
        value: valueReaisDecimal,
        term: term.trim() || undefined,
      });
    } else if (origin === "legado") {
      registerLegacy.mutate({
        idempotencyKey,
        contractNumber,
        contractor: contractor.trim(),
        object: object.trim() || undefined, // vazio + registro de origem ⇒ o objeto vem do registro
        term: term.trim(),
        value: parseReaisInputToDecimal(valueReais),
        endDate: endDate || undefined,
        sourceReference: sourceReference.trim() || undefined,
        ...(legacyRecordId ? { legacyRecordId } : {}),
        ...(priorAmendments.length ? { priorAmendments: priorAmendments.map((a) => ({ type: a.type, ...(a.reference.trim() ? { reference: a.reference.trim() } : {}), ...(a.newTerm.trim() ? { newTerm: a.newTerm.trim() } : {}) })) } : {}),
      });
    } else {
      importExt.mutate({ source: "pdf", rawText, contractNumber: contractNumber || undefined });
    }
  };

  const inputCls = "mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Novo Contrato</h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {ORIGINS.map(([v, label]) => (
          <button key={v} type="button" onClick={() => { setOrigin(v); setOriginId(""); resetInheritance(); }}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition ${origin === v ? "border-indigo-400 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>{label}</button>
        ))}
      </div>

      <label className="block text-xs font-medium text-foreground">Número do contrato
        <input value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} placeholder="CT-2026/001" className={inputCls} />
      </label>

      {origin === "processo_licitatorio" && (
        <label className="block text-xs font-medium text-foreground">
          Processo Licitatório
          <select value={originId} onChange={(e) => { setOriginId(e.target.value); resetInheritance(); }} className={inputCls} disabled={processesQuery.isLoading}>
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
          <input value={originId} onChange={(e) => { setOriginId(e.target.value); resetInheritance(); }} placeholder="id de origem" className={inputCls} />
        </label>
      )}

      {/* SEM-062 — proposta de contratado/valor (procedência explícita; o usuário seleciona e confirma). */}
      {inheritance?.kind === "no_canonical_evidence" && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">{inheritance.message}</p>
      )}
      {origin === "contratacao_direta" && inheritance?.kind === "proposal" && (
        <fieldset className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <legend className="px-1 font-medium">Propostas registradas nesta contratação</legend>
          <p>{inheritance.notice}</p>
          <p className="text-[11px]">Decisão de ratificação vigente: rev. {inheritance.decision.revision} ({inheritance.decision.decidedAt}, {inheritance.decision.decidedByRole}).</p>
          {inheritance.candidates.map((c) => (
            <label key={c.proposalId} className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="inherit-proposal" checked={proposalId === c.proposalId} onChange={() => selectProposal(c.proposalId, c)} className="mt-0.5" />
              <span>
                <strong>{c.supplierName || "(sem nome)"}</strong>{c.supplierDocument ? ` · ${c.supplierDocument}` : ""} · {c.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                <span className="block text-[11px] opacity-80">Proposta {c.proposalId}{c.protocol ? ` · protocolo ${c.protocol}` : ""}</span>
              </span>
            </label>
          ))}
          {proposalId && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <label className="block text-xs font-medium">Contratado (confirme)
                <input value={inheritContractor} onChange={(e) => setInheritContractor(e.target.value)} className={inputCls} />
              </label>
              <label className="block text-xs font-medium">Valor (R$) (confirme)
                <input value={inheritValueReais} onChange={(e) => setInheritValueReais(e.target.value)} inputMode="decimal" className={inputCls} />
              </label>
            </div>
          )}
          {!proposalId && <p className="text-[11px]">Sem seleção, o contrato nasce com contratado e valor em branco (editáveis na minuta).</p>}
        </fieldset>
      )}

      {origin === "legado" && (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">Partir de um registro já cadastrado (opcional)
            <select value={legacyRecordId} onChange={(e) => setLegacyRecordId(e.target.value)} className={inputCls} aria-label="Registro de origem">
              <option value="">Não — digitar os dados</option>
              {originCandidates.map((r) => <option key={r.id} value={r.id}>{r.number || "(sem número)"} — {r.object || r.recordType}</option>)}
            </select>
            {selectedRecord && <span className="mt-1 block text-[11px] text-muted-foreground">O objeto e a origem serão reaproveitados do registro (o que você digitar prevalece); o registro fica vinculado ao contrato{selectedRecord.recordType === "contrato_externo" ? " e o vencimento que ele acompanhava passa para o contrato, sem alertas duplicados" : ""}.</span>}
          </label>
          <label className="block text-xs font-medium text-foreground">Contratado (fornecedor)
            <input value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Razão social / nome" className={inputCls} required />
          </label>
          <label className="block text-xs font-medium text-foreground">Objeto
            <textarea value={object} onChange={(e) => setObject(e.target.value)} rows={2} placeholder={selectedRecord?.object ? `Vem do registro: ${selectedRecord.object}` : "Objeto do contrato"} className={`${inputCls} resize-y`} required={!selectedRecord?.object} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-foreground">Valor (R$)
              <input value={valueReais} onChange={(e) => setValueReais(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-foreground">Vigência / prazo
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="12 meses, de 01/03/2026 a 28/02/2027" className={inputCls} required />
            </label>
            <label className="block text-xs font-medium text-foreground">Término da vigência (opcional)
              <input type="date" aria-label="Término da vigência" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            </label>
            <label className="block text-xs font-medium text-foreground">Processo de origem (opcional)
              <input value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="Pregão 12/2023" className={inputCls} />
            </label>
          </div>
          <fieldset className="space-y-2 rounded-md border border-border px-3 py-2">
            <legend className="px-1 text-xs font-medium text-foreground">Aditivos já formalizados (opcional)</legend>
            <p className="text-[11px] text-muted-foreground">Informe os aditivos que já existem fora do sistema: o próximo termo continua a numeração e cita o histórico. São registrados como <strong>declarados, não verificados</strong>; não geram termo nem alteram o contrato.</p>
            {priorAmendments.map((a, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr_1fr_auto] items-center gap-2">
                <select aria-label={`Tipo do aditivo ${i + 1}`} value={a.type} onChange={(e) => setPriorAmendments(priorAmendments.map((x, j) => (j === i ? { ...x, type: e.target.value as typeof a.type } : x)))} className={inputCls}>
                  <option value="prazo">Prazo</option><option value="valor">Valor</option><option value="quantitativo">Quantitativo</option><option value="qualitativo">Qualitativo</option>
                </select>
                <input aria-label={`Vigência do aditivo ${i + 1}`} value={a.newTerm} onChange={(e) => setPriorAmendments(priorAmendments.map((x, j) => (j === i ? { ...x, newTerm: e.target.value } : x)))} placeholder="Prazo/vigência" className={inputCls} />
                <input aria-label={`Referência do aditivo ${i + 1}`} value={a.reference} onChange={(e) => setPriorAmendments(priorAmendments.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} placeholder="1º Termo Aditivo, 12/03/2025" className={inputCls} />
                <button type="button" onClick={() => setPriorAmendments(priorAmendments.filter((_, j) => j !== i))} className="text-xs text-red-700 hover:underline">Remover</button>
              </div>
            ))}
            {priorAmendments.length < 20 && <button type="button" onClick={() => setPriorAmendments([...priorAmendments, { type: "prazo", reference: "", newTerm: "" }])} className="text-xs font-medium text-indigo-700 hover:underline">+ Adicionar aditivo anterior</button>}
          </fieldset>
          <span className="text-[11px] text-muted-foreground">Contrato <strong>já assinado fora do sistema</strong>: entra como <strong>vigente</strong>, com os dados que você declara (registrados em seu nome no histórico), pronto para aditivos e apostilamentos. Não é preciso recriar DFD, ETP, TR ou edital. Com o término informado, o vencimento e os alertas vão para o Centro de Operações.</span>
        </div>
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
          <span>Já existe um contrato com este número nesta organização (o número é único, qualquer que seja a origem). Nada foi alterado no contrato existente.</span>
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
        {busy ? "Processando…" : origin === "externo" ? "Reconstruir contrato (assistido)" : origin === "avulso" ? "Criar contrato" : origin === "legado" ? "Registrar contrato vigente" : "Gerar contrato"}
      </button>
    </form>
  );
}
