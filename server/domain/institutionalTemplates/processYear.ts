/**
 * Exercício (ano) e sequência do processo, lidos do NÚMERO do processo — fonte única para a preparação do Edital e para a fonte
 * canônica PROCESS. Aceita os dois formatos usuais, sem ambiguidade: `AAAA/NNNN` (padrão do sistema) e `NNNN/AAAA` (comum em
 * prefeituras, ex.: "45/2026"). O ano precisa estar entre 1900 e 2099; quando os dois lados parecem ano (ex.: "2026/2025") vale o
 * formato do sistema (`AAAA/…`). Qualquer outro formato ⇒ sem exercício (o Edital pede a correção no cadastro do processo; nunca se
 * usa data de cadastro nem "ano corrente").
 *
 * Os modelos institucionais escrevem "Nº {numeroProcesso}/{ano}" — o número do processo é "único no exercício" (catálogo), isto é,
 * a SEQUÊNCIA. Por isso, quando o exercício é reconhecido, `sequence` é a parte sem o ano ("2026/253" ⇒ "253"); senão é o número inteiro.
 */
const YEAR = /^(19|20)\d{2}$/;

export interface ProcessNumberParts {
  readonly year: number | null;
  readonly sequence: string;
}

export function processNumberParts(processNumber: string | null | undefined): ProcessNumberParts {
  const raw = (processNumber ?? "").trim();
  const parts = raw.split("/").map((p) => p.trim());
  if (parts.length !== 2 || !parts.every((p) => /^\d+$/.test(p))) return { year: null, sequence: raw };
  const [head, tail] = parts;
  if (YEAR.test(head)) return { year: Number(head), sequence: tail };
  if (YEAR.test(tail)) return { year: Number(tail), sequence: head };
  return { year: null, sequence: raw };
}

export function processYearOf(processNumber: string | null | undefined): number | null {
  return processNumberParts(processNumber).year;
}
