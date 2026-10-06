import { formatIssues } from "@/lib/institutionalTemplatesView";

export type ImportResultView =
  | { ok: true; format: string; sourceFormat: string; summary: { nodeCount: number; nodesByType: Record<string, number>; variables: readonly string[] }; warnings: readonly string[] }
  | { ok: false; format: string; stage: string; issues: readonly { code: string; path: string; message: string }[] };

const STAGE_LABEL: Record<string, string> = { intake: "recebimento do arquivo", parse: "leitura do conteúdo", validation: "validação do modelo" };

/** Resultado da importação: candidato válido (vai SOMENTE para rascunho) ou os motivos objetivos da recusa. */
export function ImportResultPanel({ result }: { result: ImportResultView }) {
  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <p className="font-medium">Importação recusada na etapa de {STAGE_LABEL[result.stage] ?? result.stage}. Nada foi criado.</p>
        <ul className="mt-1 list-disc pl-5">{formatIssues(result.issues).map((m) => <li key={m}>{m}</li>)}</ul>
      </div>
    );
  }
  return (
    <div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      <p className="font-medium">Modelo candidato válido — será criado SOMENTE como rascunho (DRAFT). Importar nunca publica.</p>
      <p className="mt-1">{result.summary.nodeCount} bloco(s); variáveis do catálogo: {result.summary.variables.length ? result.summary.variables.join(", ") : "nenhuma"}.</p>
      {result.warnings.length > 0 && <ul className="mt-1 list-disc pl-5">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    </div>
  );
}
