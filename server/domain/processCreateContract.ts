/**
 * R3 / PR-05 — "Create ≠ Reset" dos criadores canônicos de processo (SEM-002, SEM-003; invariante INV-02).
 *
 * CONTRATO ("padrão R3"), válido para `procurementProcess.createProcess` e `directProcurement.createProcess`:
 *
 * 1. CHAVE NATURAL = (organizationId do CONTEXTO autenticado, número do processo exatamente como enviado). Ela é
 *    materializada no id determinístico do registro (`plp:org:número` / `dpw:org:número`), que é a PRIMARY KEY —
 *    a unicidade é garantida pelo BANCO (sem check-then-insert, sem janela TOCTOU e sem migration).
 * 2. A criação é um INSERT PURO (nunca upsert). Se a chave natural já existe no MESMO órgão, o banco recusa
 *    (ER_DUP_ENTRY), a transação da criação é revertida e NADA é escrito — nem no registro existente nem nos seus
 *    dependentes (timeline, fatos do Contexto Canônico).
 * 3. Depois da recusa, o servidor relê o registro EXISTENTE (no mesmo órgão) e decide, sem escrever:
 *    - CONVERGÊNCIA (retry idempotente da MESMA criação) ⇒ sucesso com `created: false`, devolvendo o registro
 *      PERSISTIDO (nunca o objeto montado a partir do pedido). "Mesma criação" significa, cumulativamente:
 *        a) o MESMO ator: `responsibleUser` do registro === usuário autenticado; e
 *        b) payload idêntico ao registro persistido, comparado EXATAMENTE como gravado (sem trim, caixa ou
 *           qualquer normalização nova). A única equivalência é a que os criadores já aplicam ao gravar: opcional
 *           ausente ≡ "" (`modality ?? ""`, `legalBasis ?? ""`). A unidade demandante chega já normalizada pela
 *           fronteira de entrada existente (zod `.trim()` + `|| null` no router), igual ao valor gravado no fato:
 *           - Processo Licitatório: `object`, `startOption`, `modality` (ausente ≡ "") e `requestingUnit`
 *             (ausente/vazio ≡ nenhum fato de criação; presente ≡ exatamente um valor no(s) fato(s)
 *             `demand.requestingUnit` gravado(s) NA CRIAÇÃO, `sourceType = "process"`, `sourceVersion = "create"`).
 *           - Contratação Direta: `object`, `procurementType`, `startOption`, `legalBasis` (ausente ≡ "").
 *      Os endpoints não recebem chave de idempotência do cliente; por isso a identidade da operação é
 *      (tenant, número, ator, payload exato). A comparação é feita contra o estado ATUAL do registro: se ele
 *      foi alterado depois da criação (ex.: fundamento legal escolhido), um retry tardio deixa de ser "o mesmo" e
 *      recebe CONFLICT — fail-closed, ainda sem escrita.
 *    - Qualquer outra situação ⇒ `CONFLICT` com mensagem pt-BR ESTÁVEL e o token `PROCESS_ALREADY_EXISTS`.
 * 4. Nunca reseta etapa, status, flags, tipo, modalidade, procedimento ou fundamento legal de registro existente.
 *    Atualização legítima é operação `update` explícita (fora do create).
 * 5. Órgãos distintos com o mesmo número não colidem (o organizationId faz parte da chave) e permanecem isolados.
 * 6. RBAC inalterado: este contrato não muda quem pode chamar cada endpoint.
 */

/** Token estável do conflito de chave natural na criação (não traduzir; usado por testes/cliente). */
export const PROCESS_ALREADY_EXISTS = "PROCESS_ALREADY_EXISTS";

/** Mensagem estável (pt-BR) — Processo Licitatório. Não inclui dados do registro existente. */
export const PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE =
  "Já existe um processo licitatório com este número nesta organização. O processo existente não foi alterado: " +
  `abra-o pela lista de processos ou informe outro número (${PROCESS_ALREADY_EXISTS}).`;

/** Mensagem estável (pt-BR) — Contratação Direta. Não inclui dados do registro existente. */
export const DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE =
  "Já existe uma contratação direta com este número nesta organização. O processo existente não foi alterado: " +
  `abra-o pela lista de processos ou informe outro número (${PROCESS_ALREADY_EXISTS}).`;

/**
 * Lançado pela camada de persistência quando o INSERT puro da criação colide com a chave natural (PK
 * determinística). Carrega só o id do registro — o router relê o existente NO ÓRGÃO do contexto.
 */
export class ProcessAlreadyExistsError extends Error {
  constructor(readonly processId: string) {
    super(`Chave natural de processo já existente (${PROCESS_ALREADY_EXISTS}).`);
    this.name = "ProcessAlreadyExistsError";
  }
}

/** Opcional ausente ≡ "" — a mesma regra que os criadores aplicam ao gravar. NÃO faz trim nem outra normalização. */
const orEmpty = (v: string | null | undefined): string => v ?? "";

/**
 * Pedido de criação do Processo Licitatório, já com o ator autenticado. `requestingUnit` chega normalizado pela
 * fronteira de entrada (zod `.trim()` + `|| null`), exatamente como é gravado no fato de criação.
 */
export interface ProcurementCreateRequest {
  readonly actorUserId: number;
  readonly object: string;
  readonly startOption: string;
  readonly modality?: string | null;
  readonly requestingUnit?: string | null;
}

/** Estado persistido relevante do Processo Licitatório existente. */
export interface ExistingProcurementForCreate {
  readonly responsibleUser: number;
  readonly object: string;
  readonly startOption: string;
  readonly modality: string;
  /**
   * Valores dos fatos `demand.requestingUnit` gravados NA CRIAÇÃO (`sourceType = "process"`,
   * `sourceVersion = "create"`). Normalmente 0 ou 1; mais de um valor distinto só existe como resíduo do upsert
   * anterior ao R3 e é tratado como divergência (fail-closed ⇒ CONFLICT).
   */
  readonly createRequestingUnits: readonly string[];
}

/**
 * Campos em que o pedido difere do registro persistido. Lista vazia ⇒ retry idempotente da MESMA criação
 * (converge). Só NOMES de campo (sem valores) — seguro para log.
 */
export function procurementCreateMismatches(existing: ExistingProcurementForCreate, req: ProcurementCreateRequest): string[] {
  const out: string[] = [];
  if (existing.responsibleUser !== req.actorUserId) out.push("actor");
  if (existing.object !== req.object) out.push("object");
  if (existing.startOption !== req.startOption) out.push("startOption");
  if (orEmpty(existing.modality) !== orEmpty(req.modality)) out.push("modality");
  const units = [...new Set(existing.createRequestingUnits.filter((u) => u.length > 0))];
  const requested = orEmpty(req.requestingUnit);
  const sameUnit = requested.length === 0 ? units.length === 0 : units.length === 1 && units[0] === requested;
  if (!sameUnit) out.push("requestingUnit");
  return out;
}

/** Pedido de criação da Contratação Direta, já com o ator autenticado. */
export interface DirectProcurementCreateRequest {
  readonly actorUserId: number;
  readonly object: string;
  readonly procurementType: string;
  readonly startOption: string;
  readonly legalBasis?: string | null;
}

/** Estado persistido relevante da Contratação Direta existente. */
export interface ExistingDirectProcurementForCreate {
  readonly responsibleUser: number;
  readonly object: string;
  readonly procurementType: string;
  readonly startOption: string;
  readonly legalBasis: string;
}

/** Idem `procurementCreateMismatches`, para a Contratação Direta. */
export function directProcurementCreateMismatches(existing: ExistingDirectProcurementForCreate, req: DirectProcurementCreateRequest): string[] {
  const out: string[] = [];
  if (existing.responsibleUser !== req.actorUserId) out.push("actor");
  if (existing.object !== req.object) out.push("object");
  if (existing.procurementType !== req.procurementType) out.push("procurementType");
  if (existing.startOption !== req.startOption) out.push("startOption");
  if (orEmpty(existing.legalBasis) !== orEmpty(req.legalBasis)) out.push("legalBasis");
  return out;
}
