/**
 * PR B.2.2 — Orquestrador do fluxo supervisionado de ingestão (cliente).
 *
 * Sequência (reutiliza o ingestionRouter da B.2.1, SEM fluxo paralelo):
 *   createSession (idempotente + dedup por checksum) → upload multipart streaming (fetch/FormData,
 *   NUNCA base64/tRPC) → enqueueProcessing (replay-safe) → polling de getSessionStatus.
 *
 * Garante: guarda de duplo-clique, chave idempotente estável por tentativa, checksum no cliente
 * (o servidor é a autoridade), cancelamento sem corromper o estado persistido, retry idempotente.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { sha256HexOfBlob, sha256HexOfText, newIdempotencyKey } from "@/lib/ingestion/sha256";
import {
  PASTED_CONTENT_MIME,
  PASTED_CONTENT_FILENAME,
} from "@/lib/ingestion/capabilities";
import {
  derivePhase,
  type IngestionPhase,
  type IngestionSessionStatus,
} from "@/lib/ingestion/status";

export type IngestionImportType = "price_research" | "tr_items" | "catmat" | "generic";

export interface StartFileInput { kind: "file"; file: File }
export interface StartTextInput { kind: "text"; text: string }
export type StartInput = StartFileInput | StartTextInput;

interface UseSupervisedIngestionOptions {
  importType: IngestionImportType;
  /** Processo CANÔNICO (id string) ao qual a sessão fica vinculada. Obrigatório. */
  procurementProcessId: string;
  importPurpose?: string;
  onApproachReview?: (sessionId: number) => void;
}

const POLL_STATUSES: IngestionSessionStatus[] = ["uploaded", "queued", "parsing", "extracted", "normalized"];

function isPreconditionFailed(err: unknown): boolean {
  const data = (err as { data?: { code?: string } } | null)?.data;
  return data?.code === "PRECONDITION_FAILED";
}

export function useSupervisedIngestion(opts: UseSupervisedIngestionOptions) {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [clientPhase, setClientPhase] = useState<"idle" | "preparing" | "uploading" | "error">("idle");
  const [clientError, setClientError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const idempotencyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const createSession = trpc.ingestion.createSession.useMutation();
  const enqueue = trpc.ingestion.enqueueProcessing.useMutation();

  const statusQuery = trpc.ingestion.getSessionStatus.useQuery(
    { sessionId: sessionId ?? 0, procurementProcessId: opts.procurementProcessId },
    {
      enabled: sessionId != null,
      refetchInterval: (q) => {
        const s = q.state.data?.session?.status as IngestionSessionStatus | undefined;
        return s && POLL_STATUSES.includes(s) ? 1500 : false;
      },
      refetchOnWindowFocus: false,
    },
  );

  // Retomada por processo (reload): adota a sessão resumível SOMENTE deste processo canônico.
  const activeQuery = trpc.ingestion.getActiveSession.useQuery(
    { procurementProcessId: opts.procurementProcessId },
    { enabled: !!opts.procurementProcessId && sessionId == null, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    const resumed = activeQuery.data?.session?.id;
    if (sessionId == null && typeof resumed === "number") setSessionId(resumed);
  }, [activeQuery.data, sessionId]);

  const session = statusQuery.data?.session ?? null;
  const staging = statusQuery.data?.staging ?? null;

  const pending = staging?.pending ?? 0;
  const total = staging?.total ?? 0;

  const phase: IngestionPhase =
    clientPhase === "error"
      ? "failed"
      : clientPhase === "preparing"
      ? "preparing"
      : clientPhase === "uploading"
      ? "uploading"
      : session
      ? derivePhase({
          status: session.status as IngestionSessionStatus,
          pending,
          total,
          retryCount: session.retryCount ?? 0,
        })
      : "idle";

  async function uploadBytes(uploadPath: string, blob: Blob, fileName: string): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    const form = new FormData();
    form.append("file", blob, fileName);
    const res = await fetch(uploadPath, {
      method: "POST",
      body: form,
      credentials: "include",
      signal: controller.signal,
    });
    abortRef.current = null;
    if (!res.ok) {
      let message = "Falha no envio do arquivo.";
      try { message = (await res.json())?.error ?? message; } catch { /* corpo não-JSON */ }
      throw new Error(message);
    }
  }

  const start = useCallback(async (input: StartInput) => {
    if (submittingRef.current) return; // guarda de duplo-clique / submissão duplicada
    submittingRef.current = true;
    setClientError(null);
    setClientPhase("preparing");
    try {
      let blob: Blob, fileName: string, mimeType: string, checksum: string;
      if (input.kind === "file") {
        blob = input.file;
        fileName = input.file.name;
        mimeType = input.file.type || "application/octet-stream";
        checksum = await sha256HexOfBlob(input.file);
      } else {
        blob = new Blob([input.text], { type: PASTED_CONTENT_MIME });
        fileName = PASTED_CONTENT_FILENAME;
        mimeType = PASTED_CONTENT_MIME;
        checksum = await sha256HexOfText(input.text);
      }

      if (!idempotencyRef.current) idempotencyRef.current = newIdempotencyKey();

      const created = await createSession.mutateAsync({
        importType: opts.importType,
        sourceFileName: fileName,
        sourceMimeType: mimeType,
        sourceSize: blob.size,
        checksum,
        idempotencyKey: idempotencyRef.current,
        procurementProcessId: opts.procurementProcessId,
        importPurpose: opts.importPurpose,
      });

      setSessionId(created.sessionId);

      if (!created.duplicate) {
        setClientPhase("uploading");
        await uploadBytes(created.uploadPath, blob, fileName);
      }

      try {
        await enqueue.mutateAsync({ sessionId: created.sessionId });
      } catch (err) {
        // Sessão duplicada que ainda não recebeu bytes: envia agora e re-enfileira.
        if (isPreconditionFailed(err) && created.duplicate) {
          setClientPhase("uploading");
          await uploadBytes(created.uploadPath, blob, fileName);
          await enqueue.mutateAsync({ sessionId: created.sessionId });
        } else {
          throw err;
        }
      }

      setClientPhase("idle"); // a partir daqui a fase vem do polling da sessão
      opts.onApproachReview?.(created.sessionId);
      void statusQuery.refetch();
    } catch (err) {
      setClientPhase("error");
      setClientError(err instanceof Error ? err.message : "Falha ao iniciar a ingestão.");
    } finally {
      submittingRef.current = false;
    }
  }, [opts, createSession, enqueue, statusQuery]);

  const retry = useCallback(async () => {
    if (sessionId == null || submittingRef.current) return;
    submittingRef.current = true;
    setClientError(null);
    try {
      await enqueue.mutateAsync({ sessionId });
      void statusQuery.refetch();
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Falha ao reprocessar.");
    } finally {
      submittingRef.current = false;
    }
  }, [sessionId, enqueue, statusQuery]);

  const cancel = useCallback(() => {
    // Aborta o envio em curso; o backend faz cleanup do parcial. A sessão persiste.
    abortRef.current?.abort();
    abortRef.current = null;
    if (clientPhase === "preparing" || clientPhase === "uploading") {
      setClientPhase("idle");
      submittingRef.current = false;
    }
  }, [clientPhase]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    submittingRef.current = false;
    idempotencyRef.current = null;
    setSessionId(null);
    setClientPhase("idle");
    setClientError(null);
  }, []);

  return {
    sessionId,
    phase,
    session,
    staging,
    clientError,
    isBusy: submittingRef.current || clientPhase === "preparing" || clientPhase === "uploading",
    start,
    retry,
    cancel,
    reset,
  };
}
