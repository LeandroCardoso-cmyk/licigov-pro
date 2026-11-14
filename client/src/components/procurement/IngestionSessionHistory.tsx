import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { actorLabel, formatDateTimeBR } from "../../lib/processDocumentStatus";
import { formatBytes, sessionStatusLabel, type SessionHistoryView } from "../../lib/ingestionHistoryView";

/**
 * M8 (homologação visual) — histórico SOMENTE LEITURA das importações (ingestão canônica) do processo: arquivo de origem,
 * quem enviou, aprovou e promoveu, e a Pesquisa de Preços gerada. Visível mesmo com a ingestão desligada (evidência já
 * registrada). Só exibe o que está registrado — etapa sem registro aparece como "não registrada", nunca inventada.
 */
const PAGE = 10;

export function IngestionSessionHistoryList({ sessions }: { sessions: readonly SessionHistoryView[] }) {
  return (
    <ol className="divide-y divide-border">
      {sessions.map((s) => (
        <li key={s.id} className="py-3 text-sm" data-testid="ingestion-session">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium text-foreground" title={s.sourceFileName}>
              Importação nº {s.id} · {s.sourceFileName}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {sessionStatusLabel(s.status)}
            </span>
          </div>
          <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
            <div><dt className="inline">Enviado: </dt><dd className="inline">{formatDateTimeBR(s.createdAt)} por {actorLabel(s.uploadedBy.name, s.uploadedBy.userId)}</dd></div>
            <div>
              <dt className="inline">Aprovação: </dt>
              <dd className="inline">{s.approval ? `${formatDateTimeBR(s.approval.at)} por ${actorLabel(s.approval.name, s.approval.userId)}` : "não registrada"}</dd>
            </div>
            <div>
              <dt className="inline">Promoção à pesquisa: </dt>
              <dd className="inline">
                {s.promotion
                  ? `${s.promotion.at ? formatDateTimeBR(s.promotion.at) : "data não registrada"}${s.promotion.userId ? ` por ${actorLabel(s.promotion.name, s.promotion.userId)}` : ""}`
                  : "não promovida"}
              </dd>
            </div>
            <div>
              <dt className="inline">Arquivo: </dt>
              <dd className="inline">{formatBytes(s.sourceSize)}{s.checksumPrefix ? ` · sha256 ${s.checksumPrefix}…` : ""}</dd>
            </div>
            {s.promotion?.researchId && (
              <div className="sm:col-span-2"><dt className="inline">Pesquisa gerada: </dt><dd className="inline font-mono">{s.promotion.researchId}</dd></div>
            )}
          </dl>
        </li>
      ))}
    </ol>
  );
}

export default function IngestionSessionHistory({ processId }: { processId: string }) {
  const [offset, setOffset] = useState(0);
  const q = trpc.ingestion.listSessionHistory.useQuery({ procurementProcessId: processId, limit: PAGE, offset }, { enabled: !!processId });
  const sessions = (q.data?.sessions ?? []) as SessionHistoryView[];
  if (!processId) return null;
  return (
    <section aria-label="Histórico de importações" className="rounded-xl border border-border bg-card p-5">
      <h2 className="font-semibold text-foreground">Histórico de importações</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Arquivos importados para a pesquisa deste processo, com quem enviou, aprovou e promoveu. Somente leitura.
      </p>
      {q.isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>
      ) : q.error ? (
        <p role="alert" className="mt-3 text-xs text-destructive">Não foi possível carregar o histórico de importações.</p>
      ) : sessions.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{offset > 0 ? "Sem mais importações." : "Nenhuma importação registrada para este processo."}</p>
      ) : (
        <div className="mt-2"><IngestionSessionHistoryList sessions={sessions} /></div>
      )}
      {(offset > 0 || q.data?.hasMore) && (
        <div className="mt-3 flex gap-2 text-xs">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="rounded-md border border-input px-2 py-1 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">Mais recentes</button>
          <button type="button" disabled={!q.data?.hasMore} onClick={() => setOffset(offset + PAGE)}
            className="rounded-md border border-input px-2 py-1 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">Mais antigas</button>
        </div>
      )}
    </section>
  );
}
