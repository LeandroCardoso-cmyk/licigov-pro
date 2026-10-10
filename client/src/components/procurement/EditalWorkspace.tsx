import React, { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import OfficialPromotionSection from "./OfficialPromotionSection";
import DraftEditor from "./DraftEditor";
import GroundingNotice from "./GroundingNotice";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import RegenerationConfirmDialog from "./RegenerationConfirmDialog";
import RegenerationBlockedNotice from "./RegenerationBlockedNotice";
import EditalTemplateBridgeCard from "./EditalTemplateBridgeCard";
import EditalPreparationPanel from "./EditalPreparationPanel";
import EditalPreflightCard from "./EditalPreflightCard";
import EditalTemplateReviewPanel from "./EditalTemplateReviewPanel";
import { generateReady, reviewReadiness, type PreflightView, type ReviewStateView } from "@/lib/editalPreparation";
import { bridgeAllowsGeneration, trPinOf, type TemplateResolutionView, type TrCandidateView } from "@/lib/editalTemplateBridge";
import {
  editalParamsComplete, editalParamsDiffer, isEditalParametersChangedRefusal, isHumanEditRefusal,
  needsReplaceConfirmation, resolveEditalFormValues, planRegeneration,
  resolveEditalTextValues, editalTextProposal, editalTextOverwrites, editalTextPendingReview, type EditalTextParams,
} from "./regenerationGuard";

const SOURCE_LABELS: Record<string, string> = {
  tr: "Termo de Referência (TR)", etp: "Estudo Técnico Preliminar (ETP)",
  dfd: "Documento de Formalização da Demanda (DFD)", itens: "Itens aprovados",
  criterio_julgamento: "Critério de julgamento", regime_contratacao: "Regime de contratação",
  objeto: "Objeto",
};
const labelSource = (k: string) => SOURCE_LABELS[k] ?? k;

/**
 * EditalWorkspace — REAL (wired to tRPC).
 *
 * UX: seleção guiada (modalidade + forma). A forma presencial exige motivação
 * (art. 17, § 2º): o sistema pode estruturar uma minuta de justificativa, mas ela
 * depende dos fatos do processo e não é garantia legal automática. Eletrônico exige
 * plataforma. O servidor valida e monta a MINUTA do edital — revisão e decisão são
 * humanas.
 *
 * PR-09 (SEM-009) — os parâmetros são DECISÃO HUMANA persistida por processo: o formulário HIDRATA os
 * parâmetros gravados no rascunho canônico (reviewableDraft.parameters) e NUNCA assume padrões (campos
 * vazios até a escolha explícita). "Gerar edital" usa os parâmetros persistidos (o servidor os lê); trocar
 * um parâmetro é ação explícita confirmada (atual × proposto). PR-09 (SEM-014) — regenerar sobre conteúdo
 * humano exige confirmação explícita (diálogo), e a versão atual fica preservada no histórico.
 *
 * R5 (0311) — critério de julgamento e regime de execução são FATOS institucionais persistidos no rascunho
 * canônico (como modalidade/forma/plataforma): hidratados do persistido, nunca pré-preenchidos com padrão;
 * não definidos ⇒ "requer revisão" ([REVISAR] na minuta). Edital aprovado/oficial ⇒ sem regeneração direta.
 */

type Modality =
  | "pregao"
  | "concorrencia"
  | "leilao"
  | "concurso"
  | "chamada_publica"
  | "credenciamento"
  | "registro_de_precos";
type Form = "eletronico" | "presencial";
type Platform =
  | "compras_gov"
  | "bll"
  | "licitanet"
  | "portal_proprio"
  | "outra";

const MODALITY_LABELS: Record<Modality, string> = {
  pregao: "Pregão",
  concorrencia: "Concorrência",
  leilao: "Leilão",
  concurso: "Concurso",
  chamada_publica: "Chamada Pública",
  credenciamento: "Credenciamento",
  registro_de_precos: "Registro de Preços",
};

const FORM_LABELS: Record<Form, string> = {
  eletronico: "Eletrônico",
  presencial: "Presencial",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  compras_gov: "Compras.gov.br",
  bll: "BLL",
  licitanet: "LicitaNet",
  portal_proprio: "Portal próprio",
  outra: "Outra",
};

export type EditalWorkspaceProps = {
  processId?: string;
  /** Abre o TR do processo (onde os Parâmetros estruturados são confirmados). */
  onOpenTr?: () => void;
};

export default function EditalWorkspace({
  processId = "",
  onOpenTr,
}: EditalWorkspaceProps) {
  const [object, setObject] = useState("");
  // R9 / SEM-057 — edição não salva no DraftEditor bloqueia a emissão oficial.
  const [editorDirty, setEditorDirty] = useState(false);
  // PR-09 (SEM-009) — escolha EXPLÍCITA do usuário (null = não tocou). Sem padrão de useState: o valor
  // exibido é a escolha explícita OU o parâmetro PERSISTIDO (hidratação), nunca um default silencioso.
  const [proposed, setProposed] = useState<{ modality: Modality | null; form: Form | null; platform: Platform | null }>({
    modality: null, form: null, platform: null,
  });
  // R5 (0311) — critério/regime digitados (null = não tocou ⇒ exibe o persistido). Sem padrão.
  const [proposedText, setProposedText] = useState<EditalTextParams>({ judgmentCriterion: null, executionRegime: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const utils = trpc.useUtils();
  // Objeto pré-preenchido com o do processo (mesmo padrão do ETP/TR; sem reentrada de dado existente).
  const processQuery = trpc.procurementProcess.loadProcess.useQuery({ processId }, { enabled: !!processId });
  const processObject = processQuery.data?.process?.object ?? "";
  useEffect(() => { if (!object && processObject) setObject(processObject); }, [processObject]);

  const { key: editalKey, rotate: rotateEditalKey } = useIdempotencyKey();
  // C.4B.2 — leitura canônica RELOAD-SAFE do rascunho persistido (fonte única de verdade do conteúdo).
  const reviewable = trpc.procurementProcess.reviewableDraft.useQuery(
    { processId, kind: "edital" }, { enabled: !!processId },
  );
  const draft = reviewable.data?.draft ?? null;
  const persisted = draft?.parameters ?? null;
  const effective = resolveEditalFormValues<Modality, Form, Platform>(proposed, persisted);
  const { modality, form, platform } = effective;
  const textValues = resolveEditalTextValues(proposedText, persisted);
  const textProposal = editalTextProposal(proposedText, persisted);
  const textPending = editalTextPendingReview(persisted);
  // Troca = sobrescrever fato decidido (núcleo diferente OU critério/regime definido trocado). Definir pela 1ª
  // vez um critério/regime ainda não definido NÃO é troca (sem confirmação de parâmetros).
  const paramsChanged = editalParamsDiffer(effective, persisted) || editalTextOverwrites(proposedText, persisted);
  const paramsComplete = editalParamsComplete(effective);
  const regenerationBlock = draft?.regenerationBlock ?? null;
  const describeParams = (
    v: { modality: Modality | null; form: Form | null; platform: Platform | null },
    t?: { judgmentCriterion?: string | null; executionRegime?: string | null } | null,
  ) =>
    [v.modality ? MODALITY_LABELS[v.modality] : "—", v.form ? FORM_LABELS[v.form] : "—",
      v.form === "eletronico" && v.platform ? PLATFORM_LABELS[v.platform] : null,
      t?.judgmentCriterion ? `critério: ${t.judgmentCriterion}` : null,
      t?.executionRegime ? `regime: ${t.executionRegime}` : null].filter(Boolean).join(" / ");
  const effectiveText = {
    judgmentCriterion: textProposal.judgmentCriterion ?? persisted?.judgmentCriterion ?? null,
    executionRegime: textProposal.executionRegime ?? persisted?.executionRegime ?? null,
  };

  // P0 — estado de desatualização das fontes (SOURCE_CHANGED): read-only. Com parâmetros persistidos o
  // servidor calcula a staleness contra ELES (a proposta da UI não acende/apaga o alerta).
  const sourceState = trpc.procurementProcess.editalSourceState.useQuery(
    {
      processId, object: object.trim() || "-",
      modality: modality ?? undefined, form: form ?? undefined,
      platform: form === "eletronico" ? platform ?? undefined : undefined,
    },
    { enabled: !!processId && !!object.trim() },
  );
  // Bridge Edital → modelo institucional: a resolução e o motor são do SERVIDOR; aqui só se exibe e se confirma o TR exato.
  const coreComplete = !!modality && !!form && (form !== "eletronico" || !!platform);
  const resolutionQuery = trpc.procurementProcess.editalTemplateResolution.useQuery(
    { processId, modality: modality ?? undefined, form: form ?? undefined, platform: form === "eletronico" ? platform ?? undefined : undefined },
    { enabled: !!processId && coreComplete },
  );
  const resolution = (coreComplete ? resolutionQuery.data : undefined) as TemplateResolutionView | undefined;
  const bound = resolution?.status === "BOUND";
  const trQuery = trpc.procurementProcess.editalTrCandidates.useQuery({ processId }, { enabled: !!processId && bound });
  const trCandidates = (bound ? trQuery.data ?? [] : []) as TrCandidateView[];
  const [selectedTrId, setSelectedTrId] = useState<string | null>(null);
  const trPin = trPinOf(trCandidates.find((c) => c.documentId === selectedTrId));
  const bridgeGate = bridgeAllowsGeneration(resolution, trPin);
  const boundParams = { modality: modality ?? undefined, form: form ?? undefined, platform: form === "eletronico" ? platform ?? undefined : undefined };
  // Preflight SOMENTE LEITURA (mesma revisão/fontes/composer da geração): o botão só é operacional com READY (o backend segue fail-closed).
  const preflightQuery = trpc.procurementProcess.editalTemplatePreflight.useQuery(
    { processId, ...boundParams, ...(trPin ? { officialPins: { TR: trPin } } : {}) },
    { enabled: !!processId && bound && !!trPin },
  );
  const preflight = (bound && trPin ? preflightQuery.data : undefined) as PreflightView | undefined;
  const genReady = generateReady(bound, !!trPin, preflight);
  const reviewQuery = trpc.procurementProcess.editalTemplateReviewState.useQuery({ processId }, { enabled: !!processId });
  const templateReviewBlockers = reviewReadiness(reviewQuery.data as ReviewStateView | undefined).blockers;
  const generateNotice = trpc.procurementProcess.generateNotice.useMutation({
    // Recusas governadas (conteúdo humano / troca de parâmetros sem confirmação) ⇒ diálogo; nada gravado.
    onError: (e) => {
      if (isHumanEditRefusal(e.message) || isEditalParametersChangedRefusal(e.message)) setConfirmOpen(true);
    },
    onSuccess: (data) => {
      setConfirmOpen(false);
      // Rascunho institucional não persiste parâmetros legados: mantém a escolha atual na tela (nada a "voltar a exibir").
      if (data.generationMode !== "INSTITUTIONAL_TEMPLATE") {
        setProposed({ modality: null, form: null, platform: null }); // volta a exibir o persistido
        setProposedText({ judgmentCriterion: null, executionRegime: null });
      }
      rotateEditalKey();
      if (processId) {
        utils.procurementProcess.reviewableDraft.invalidate({ processId, kind: "edital" });
        utils.procurementProcess.editalSourceState.invalidate();
        utils.procurementProcess.editalTemplateReviewState.invalidate({ processId });
        utils.procurementProcess.editalTemplatePreflight.invalidate();
      }
    },
  });

  const handleGenerate = (confirmed = false) => {
    if (!processId || !object.trim() || !paramsComplete) return;
    if (bound) {
      // Motor institucional (decidido pelo servidor): o TR oficial EXATO confirmado segue no payload; sem confirmação ⇒ nada é enviado.
      if (!trPin || regenerationBlock) return;
      generateNotice.mutate({
        processId, object: object.trim(),
        modality: modality ?? undefined, form: form ?? undefined, platform: form === "eletronico" ? platform ?? undefined : undefined,
        officialPins: { TR: trPin }, idempotencyKey: editalKey,
      });
      return;
    }
    // Decisão PURA antes de qualquer chamada (bloqueado ⇒ nada; confirmação ⇒ diálogo; cancelar = zero efeito).
    const plan = planRegeneration({
      confirmed, needsReplace: needsReplaceConfirmation(draft), parameterChange: paramsChanged, block: regenerationBlock,
    });
    if (plan === "blocked") return;
    if (plan === "confirm") { setConfirmOpen(true); return; }
    generateNotice.mutate({
      processId,
      object: object.trim(),
      // Parâmetros persistidos são lidos NO SERVIDOR: só envia proposta na 1ª decisão ou na troca explícita.
      ...(persisted && !paramsChanged ? {} : {
        modality: modality ?? undefined,
        form: form ?? undefined,
        platform: form === "eletronico" ? platform ?? undefined : undefined,
      }),
      // R5 — critério/regime: só os digitados e diferentes do persistido (vazio nunca apaga o definido).
      ...textProposal,
      confirmParameterChange: paramsChanged && confirmed ? true : undefined,
      confirmReplace: confirmed && needsReplaceConfirmation(draft) ? true : undefined,
      expectedContentHash: draft?.contentHash,
      idempotencyKey: editalKey,
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">Edital</h1>
      <p className="text-sm text-muted-foreground">
        Prepare uma minuta com base no TR e nas demais fontes do processo. Confira modalidade,
        forma, plataforma e pendências [REVISAR]. A decisão e a revisão são humanas.
      </p>

      <div className="mt-5 space-y-4 rounded-xl border border-border bg-card p-5">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Registro de preços para materiais de expediente"
            className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Modalidade</span>
            <select
              value={modality ?? ""}
              onChange={(e) => setProposed((p) => ({ ...p, modality: (e.target.value || null) as Modality | null }))}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>Selecione a modalidade</option>
              {(Object.keys(MODALITY_LABELS) as Modality[]).map((m) => (
                <option key={m} value={m}>
                  {MODALITY_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Forma</span>
            <select
              value={form ?? ""}
              onChange={(e) => setProposed((p) => ({ ...p, form: (e.target.value || null) as Form | null }))}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>Selecione a forma</option>
              {(Object.keys(FORM_LABELS) as Form[]).map((f) => (
                <option key={f} value={f}>
                  {FORM_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form === "presencial" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Justificativa sujeita à revisão.</strong> Confira a motivação da forma presencial
            incluída na minuta e complete-a com os fatos do processo antes da aprovação.
          </div>
        ) : form === "eletronico" ? (
          <label className="flex flex-col text-sm sm:max-w-xs">
            <span className="mb-1 font-medium text-foreground">Plataforma</span>
            <select
              value={platform ?? ""}
              onChange={(e) => setProposed((p) => ({ ...p, platform: (e.target.value || null) as Platform | null }))}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              <option value="" disabled>Selecione a plataforma</option>
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* R5 (0311) — critério de julgamento / regime de execução: fatos institucionais persistidos (sem padrão). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Critério de julgamento</span>
            <input
              type="text"
              maxLength={100}
              value={textValues.judgmentCriterion}
              onChange={(e) => setProposedText((t) => ({ ...t, judgmentCriterion: e.target.value }))}
              placeholder="Definido pela Administração (art. 33)"
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
            {!textValues.judgmentCriterion.trim() && (
              <span className="mt-1 text-xs text-amber-600 dark:text-amber-400">Não definido — requer revisão ([REVISAR] na minuta).</span>
            )}
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Regime de execução</span>
            <input
              type="text"
              maxLength={100}
              value={textValues.executionRegime}
              onChange={(e) => setProposedText((t) => ({ ...t, executionRegime: e.target.value }))}
              placeholder="Definido pela Administração, quando aplicável"
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
            {!textValues.executionRegime.trim() && (
              <span className="mt-1 text-xs text-amber-600 dark:text-amber-400">Não definido — requer revisão ([REVISAR] na minuta).</span>
            )}
          </label>
        </div>
        {(["judgmentCriterion", "executionRegime"] as const).some((k) => proposedText[k]?.trim() === "" && !!persisted?.[k]) && (
          <p className="text-xs text-muted-foreground">
            Um parâmetro já definido não é apagado ao deixar o campo vazio — o valor definido é mantido.
          </p>
        )}

        {/* PR-09 (SEM-009) — origem dos parâmetros: persistidos × proposta (troca = ação explícita). */}
        {persisted && !paramsChanged && (
          <p className="text-xs text-muted-foreground">
            Parâmetros definidos para este Edital: {describeParams(persisted, persisted)}.
            {textPending.length > 0 && (
              <> Requer revisão (não definido): {textPending.map((k) => (k === "judgmentCriterion" ? "critério de julgamento" : "regime de execução")).join(", ")}.</>
            )}
          </p>
        )}
        {persisted && paramsChanged && (
          <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-800 dark:text-orange-300" role="status">
            <strong>Troca de parâmetros.</strong> Atual: {describeParams(persisted, persisted)} → proposto: {describeParams(effective, effectiveText)}.
            A troca só é aplicada ao gerar, com confirmação.{" "}
            <button
              type="button" className="underline"
              onClick={() => { setProposed({ modality: null, form: null, platform: null }); setProposedText({ judgmentCriterion: null, executionRegime: null }); }}
            >
              Manter os parâmetros atuais
            </button>
          </div>
        )}
        {!persisted && !paramsComplete && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Defina modalidade, forma{form === "eletronico" ? " e plataforma" : ""} para gerar — nenhum padrão é assumido.
          </p>
        )}

        {coreComplete && (
          <EditalTemplateBridgeCard
            resolution={resolution} candidates={trCandidates} selectedTrId={selectedTrId} onSelectTr={setSelectedTrId}
            candidatesLoading={bound && trQuery.isLoading}
          />
        )}
        {!bridgeGate.allowed && bridgeGate.reason && resolution?.status === "BOUND" && <p className="text-xs text-amber-600 dark:text-amber-400">{bridgeGate.reason}</p>}
        {bound && selectedTrId && trCandidates.some((c) => c.documentId === selectedTrId && !c.current) && (
          <p role="alert" className="text-xs text-destructive">O TR oficial selecionado foi substituído por uma versão mais recente. Selecione o TR oficial exato novamente — nenhuma versão é escolhida automaticamente.</p>
        )}
        {bound && (
          <EditalPreflightCard preflight={preflight} loading={preflightQuery.isFetching} hasTrPin={!!trPin} onRecheck={() => { void preflightQuery.refetch(); }} />
        )}
        {bound && !genReady.ready && trPin && genReady.reason && <p className="text-xs text-amber-600 dark:text-amber-400">{genReady.reason}</p>}

        <button
          type="button"
          onClick={() => handleGenerate()}
          disabled={!processId || !object.trim() || !paramsComplete || generateNotice.isPending || !bridgeGate.allowed || !genReady.ready || !!regenerationBlock}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {generateNotice.isPending ? "Gerando..." : bound ? "Gerar edital com modelo institucional" : "Gerar edital"}
        </button>
        {!processId && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o edital.
          </p>
        )}
        <RegenerationBlockedNotice documentLabel="Edital" block={regenerationBlock} />
        {generateNotice.isError && !isHumanEditRefusal(generateNotice.error.message) && !isEditalParametersChangedRefusal(generateNotice.error.message) && (
          <p className="text-sm text-destructive">
            {domainErrorMessage(generateNotice.error.message, "Falha ao gerar o edital.")}
          </p>
        )}
      </div>

      {bound && (
        <div className="mt-6">
          <EditalPreparationPanel processId={processId} params={boundParams} trPin={trPin} onOpenTr={onOpenTr} onChanged={() => { void utils.procurementProcess.editalTemplatePreflight.invalidate(); }} />
        </div>
      )}

      {draft && (
        <div className="mt-6">
          {/* P0 — origem/contexto: a minuta nasce dos documentos do processo (reaproveitamento canônico). */}
          <div className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-800 dark:text-blue-300">
            <strong>Minuta gerada com base nos documentos do processo.</strong>
            {sourceState.data && sourceState.data.usedSources.length > 0 && (
              <span> Fontes reaproveitadas: {sourceState.data.usedSources.map(labelSource).join(", ")}.</span>
            )}
            {sourceState.data && sourceState.data.missing.length > 0 && (
              <span className="block text-xs opacity-90">
                Pendências para revisar: {sourceState.data.missing.map(labelSource).join(", ")}.
              </span>
            )}
            <span className="block text-xs opacity-80">
              Gerada em {new Date(draft.updatedAt).toLocaleString("pt-BR")} · situação: {draft.status}.
            </span>
          </div>

          {/* P0 — explicabilidade mínima: estado de fundamentação (RAG governado). */}
          <GroundingNotice grounding={draft.grounding ?? null} />

          {/* P0 — alerta de desatualização: fontes-base mudaram após a geração (NÃO regenera sozinho). */}
          {sourceState.data?.state === "source_changed" && (
            <div className="mb-3 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-800 dark:text-orange-300" role="alert">
              <strong>Documentos-base alterados.</strong> Os documentos-base deste Edital (DFD/ETP/TR/itens/parâmetros)
              foram alterados após a geração da minuta. Revise ou regenere antes da aprovação.
              {/* R9 / SEM-047 — lista O QUE mudou (minutas antigas, sem marcador por fonte, mostram só o aviso). */}
              {(sourceState.data.changedSources ?? []).length > 0 && (
                <span className="mt-1 block">Mudou: {sourceState.data.changedSources.map((c) => c.label).join(", ")}.</span>
              )}
            </div>
          )}

          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho editável (revisão humana). Edite e salve; a
            emissão oficial exige revisão de um terceiro (SoD).
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 font-semibold text-foreground">{draft.title}</h2>
            {/* C.4B.3B — edição humana governada do rascunho persistido. */}
            <DraftEditor processId={processId} kind="edital" content={draft.content} contentHash={draft.contentHash} onDirtyChange={setEditorDirty} />
          </div>
        </div>
      )}

      {draft && <div className="mt-6"><EditalTemplateReviewPanel processId={processId} contentKey={draft.contentHash} /></div>}

      <RegenerationConfirmDialog
        open={confirmOpen} onOpenChange={setConfirmOpen} documentLabel="Edital"
        humanEdit={draft?.humanEdit ?? null} currentLength={draft?.content.length}
        parameterChange={persisted && paramsChanged ? { current: describeParams(persisted, persisted), proposed: describeParams(effective, effectiveText) } : null}
        pending={generateNotice.isPending} onConfirm={() => handleGenerate(true)}
      />

      {/* C.4B.1/C.4B.2 — autoridade oficial: revisão pré-emissão do conteúdo exato + emissão governada. */}
      <OfficialPromotionSection processId={processId} kind="edital" reviewSnapshot={reviewable.data?.draft ?? null} hasUnsavedEdits={editorDirty} templateReviewBlockers={templateReviewBlockers} />
    </div>
  );
}
