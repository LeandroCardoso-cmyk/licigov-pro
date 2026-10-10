/**
 * AUTHORITY MATRIX do Edital institucional (CONTEXT_REUSE 2.0) — para CADA variável do modelo `EDITAL_PREGAO_ELETRONICO_BLL`,
 * DE ONDE vem o valor e ONDE a pessoa (se for o caso) o informa. Tabela literal, auditável e coberta por teste (100% das variáveis
 * do catálogo; variável nova sem linha aqui falha o teste e a preparação do modelo — nunca vira "decisão manual por omissão").
 *
 *  EXISTING_CANONICAL          autoridade canônica já existente (cadastro do órgão, divulgação do orçamento): somente leitura
 *  ORG_ROLE_PROFILE            papel institucional do Perfil de Licitações (nome/cargo/ato/vigência): informado UMA vez por órgão
 *  ORG_POLICY_PROFILE          política estável do órgão (prazos, canais, foro, sanções…): informada UMA vez por órgão
 *  UPSTREAM_PROCESS            Processo (número, ano, objeto)
 *  UPSTREAM_DFD                Contexto canônico afirmado na abertura do Processo e/ou no DFD (unidade requisitante)
 *  UPSTREAM_ETP                (nenhuma variável: o ETP é documento textual; não há dado estruturado do ETP — provado em teste)
 *  UPSTREAM_ITEMS              Itens da contratação canônicos
 *  UPSTREAM_PRICE_RESEARCH     estimativa derivada da Pesquisa de Preços aprovada
 *  UPSTREAM_TR                 "Parâmetros estruturados do TR": fatos confirmados NO fluxo do TR, consumidos pelo TR e pelo Edital
 *  TRUE_PROCESS_DECISION       decisão genuína NOVA do certame (sem autoridade reutilizável)
 *  CONDITIONAL                 oculto enquanto a condição `requiredWhen` estiver inativa (a entrada segue o campo `entry`)
 *  POST_AWARD                  pós-homologação (fora da preparação)
 *
 * `entry` diz ONDE a pessoa informa o dado quando ele ainda não existe: TR_SECTION (Parâmetros estruturados do TR), ORG_PROFILE
 * (Perfil institucional de Licitações), PREPARATION (preparação do Edital) ou NONE (o sistema já sabe / pós-homologação).
 * `defaultEligible` = pode virar PADRÃO INSTITUCIONAL por ação humana explícita (nunca data do certame, objeto, quantidade, valor
 * nem decisão jurídica casuística). Puro, sem I/O.
 */
import { isRealCalendarDate } from "./valueTypes2";
import type { VariableDef2 } from "./variableCatalog2";

export type AuthorityClass =
  | "EXISTING_CANONICAL" | "ORG_ROLE_PROFILE" | "ORG_POLICY_PROFILE" | "UPSTREAM_PROCESS" | "UPSTREAM_DFD" | "UPSTREAM_ETP"
  | "UPSTREAM_ITEMS" | "UPSTREAM_PRICE_RESEARCH" | "UPSTREAM_TR" | "TRUE_PROCESS_DECISION" | "CONDITIONAL" | "POST_AWARD";

export const AUTHORITY_CLASSES: readonly AuthorityClass[] = [
  "EXISTING_CANONICAL", "ORG_ROLE_PROFILE", "ORG_POLICY_PROFILE", "UPSTREAM_PROCESS", "UPSTREAM_DFD", "UPSTREAM_ETP",
  "UPSTREAM_ITEMS", "UPSTREAM_PRICE_RESEARCH", "UPSTREAM_TR", "TRUE_PROCESS_DECISION", "CONDITIONAL", "POST_AWARD",
];

export type EntryPoint = "NONE" | "TR_SECTION" | "ORG_PROFILE" | "PREPARATION";

export interface AuthorityEntry {
  readonly cls: AuthorityClass;
  readonly entry: EntryPoint;
  readonly defaultEligible: boolean;
  /** Por que esta é a autoridade (explicabilidade; também documentado em EDITAL_CONTEXT_REUSE.md). */
  readonly basis: string;
}

const E = (cls: AuthorityClass, entry: EntryPoint, basis: string, defaultEligible = false): AuthorityEntry => ({ cls, entry, defaultEligible, basis });

const list = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const table: Record<string, AuthorityEntry> = {};
const put = (names: string, entry: AuthorityEntry): void => {
  for (const n of list(names)) {
    if (table[n]) throw new Error(`variável duplicada na Authority Matrix: ${n}`);
    table[n] = entry;
  }
};

// ── existente / upstream determinístico ───────────────────────────────────────────────────────────────────────────
put("instituicao.municipioCnpj instituicao.municipioEndereco instituicao.municipioNome instituicao.municipioSede instituicao.municipioSite instituicao.municipioTelefone instituicao.municipioUfExtenso",
  E("EXISTING_CANONICAL", "NONE", "Cadastro do órgão (snapshot da identidade institucional)"));
put("controle.orcamentoSigilosoSimNao", E("EXISTING_CANONICAL", "NONE", "Derivado da decisão governada de divulgação do orçamento"));
put("processo.numeroProcesso processo.ano processo.objetoResumido", E("UPSTREAM_PROCESS", "NONE", "Processo licitatório (número, ano e objeto)"));
put("processo.secretariaRequisitante", E("UPSTREAM_DFD", "NONE", "Contexto canônico: unidade requisitante afirmada na abertura do Processo e/ou no DFD"));
put("processo.quadroItensContratacao", E("UPSTREAM_ITEMS", "NONE", "Itens da contratação canônicos (quantidade = plannedQuantity)"));
put("julgamento.valorEstimado", E("UPSTREAM_PRICE_RESEARCH", "NONE", "Estimativa derivada da Pesquisa de Preços aprovada (somente com divulgação pública)"));

// ── Perfil institucional de Licitações: PAPÉIS ─────────────────────────────────────────────────────────────────────
put("instituicao.autoridadeCompetenteNome instituicao.autoridadeCompetenteCargo", E("ORG_ROLE_PROFILE", "ORG_PROFILE", "Papel AUTORIDADE_COMPETENTE do Perfil de Licitações"));
put("instituicao.pregoeiroNome instituicao.pregoeiroPortaria", E("ORG_ROLE_PROFILE", "ORG_PROFILE", "Papel PREGOEIRO do Perfil de Licitações (nome + ato de designação)"));
put("sancoes.autoridadeSancionadora", E("ORG_ROLE_PROFILE", "ORG_PROFILE", "Papel AUTORIDADE_SANCIONADORA do Perfil de Licitações"));
put("instituicao.equipeApoio", E("ORG_ROLE_PROFILE", "ORG_PROFILE", "Papel EQUIPE_DE_APOIO do Perfil de Licitações"));
put("instituicao.signatarioEditalNome instituicao.signatarioEditalCargo", E("ORG_ROLE_PROFILE", "ORG_PROFILE", "Papel ASSINANTE_DO_EDITAL do Perfil de Licitações"));

// ── Perfil institucional de Licitações: POLÍTICAS ───────────────────────────────────────────────────────────────────
put(`contratacao.formaAssinaturaContrato contratacao.indiceAtualizacaoFinanceira contratacao.marcoInicialVigencia contratacao.prazoAssinaturaContrato
  contratacao.prazoDecisaoAdministracao contratacao.prazoRespostaReequilibrio decisao.aceitaRegistroCadastral habilitacao.prazoValidadeCertidaoFalencia
  habilitacao.prazoValidadeCertidoesSemPrazo instituicao.canalDenuncias instituicao.canalEsclarecimentos instituicao.canalImpugnacoes
  instituicao.diarioOficialMunicipio instituicao.foroComarca instituicao.portalTransparenciaUrl julgamento.antecedenciaMinimaReinicioSessao
  julgamento.horarioExpedienteSessao julgamento.janelaIntencaoRecurso julgamento.prazoConvocacaoPropostaAjustada julgamento.prazoDiligencia
  julgamento.prazoDiligenciaExequibilidade julgamento.prazoProrrogacaoConvocacao sancoes.baseCalculoMultaMora sancoes.multaMoraPercentual
  sancoes.multaTeto sancoes.tabelaMultas`, E("ORG_POLICY_PROFILE", "ORG_PROFILE", "Política estável do órgão registrada no Perfil de Licitações"));

// ── Parâmetros estruturados do TR (fatos confirmados no fluxo do TR) ───────────────────────────────────────────────
const TR = (names: string, basis: string, eligible = false) => put(names, E("UPSTREAM_TR", "TR_SECTION", basis, eligible));
TR(`contratacao.formaPagamento contratacao.prazoPagamento contratacao.marcoInicialPagamento contratacao.marcoInicialExecucao
  contratacao.marcoInicialRecebimentoProvisorio contratacao.prazoRecebimentoProvisorio contratacao.prazoRecebimentoDefinitivo
  contratacao.prazoSubstituicaoObjeto contratacao.indiceReajuste`, "Parâmetro estruturado do TR; padrão institucional permitido (cláusula recorrente, não casuística)", true);
TR(`contratacao.formaFornecimento contratacao.localEntrega contratacao.prazoExecucao contratacao.prazoVigencia decisao.contratoPorEscopo
  decisao.declaracaoEspecificaObjeto decisao.exigeAmostra decisao.exigeCatalogo decisao.exigeMarcaModelo decisao.exigeProvaConceito
  decisao.matrizDeRiscos decisao.participacaoCooperativa decisao.pastaTecnica decisao.repactuacao decisao.servicoOuFornecimentoContinuo
  decisao.subcontratacao decisao.tratamentoDadosPessoais decisao.visitaTecnicaFacultativa habilitacao.autorizacaoAtividadeExigida
  habilitacao.requisitosQualificacaoTecnica processo.objetoCompleto decisao.exigeGarantiaContratual decisao.instrumentoContratual
  decisao.exigeBalanco decisao.exigeCapitalOuPlMinimo decisao.consorcio contratacao.fiscalContrato contratacao.gestorContrato`,
  "Parâmetro estruturado do TR; específico do objeto/decisão jurídica casuística ⇒ sem padrão institucional");

// ── Decisões genuínas do certame (preparação do Edital) ────────────────────────────────────────────────────────────
const DEC = (names: string, basis: string, eligible = false) => put(names, E("TRUE_PROCESS_DECISION", "PREPARATION", basis, eligible));
DEC(`julgamento.modoDisputa decisao.intervaloMinimoLances decisao.propostaSemIdentificacao processo.enderecoEletronicoBll processo.regulamentoBllVersao
  julgamento.prazoValidadeProposta julgamento.parametroExequibilidade processo.horarioAbertura processo.horarioFimRecebimentoPropostas`,
  "Decisão do certame com padrão institucional permitido (configuração recorrente da plataforma/sessão)", true);
DEC(`controle.dataDivulgacaoPrevista controle.utilizaSrp decisao.anexosAdicionais decisao.beneficioAfastado decisao.cotaReservada decisao.exclusivoMeEpp
  decisao.formaJulgamento decisao.inversaoFases decisao.regulamentoMunicipalVerificado decisao.tratamentoRegional julgamento.criterioJulgamento
  julgamento.dataOrcamentoEstimado julgamento.regimeParticipacao processo.dataAbertura processo.dataEmissaoEdital processo.dataFimRecebimentoPropostas
  processo.dataInicioRecebimentoPropostas processo.numeroPregao`,
  "Decisão nova do certame: data do certame ou decisão jurídica casuística, sem autoridade reutilizável");

// ── Condicionais: ocultas até a condição ficar ativa; a entrada segue a autoridade do dado ──────────────────────────
const COND = (names: string, entry: EntryPoint, basis: string) => put(names, E("CONDITIONAL", entry, basis));
COND(`contratacao.condicoesSubcontratacao contratacao.regraCustosMercadoRepactuacao habilitacao.canalAgendamentoVisita habilitacao.criteriosAvaliacaoAmostra
  habilitacao.criteriosProvaConceito habilitacao.declaracoesEspecificasObjeto habilitacao.itensExigeAmostra habilitacao.itensExigeCatalogo
  habilitacao.localEntregaAmostra habilitacao.localProvaConceito habilitacao.periodoVisitaTecnica habilitacao.prazoEntregaAmostra habilitacao.prazoProvaConceito
  processo.descricaoPastaTecnica contratacao.instrumentoEquivalenteTipo participacao.percentualAcrescimoConsorcio
  contratacao.percentualGarantiaContratual habilitacao.indicesEconomicoFinanceiros habilitacao.percentualCapitalPlMinimo habilitacao.tipoExigenciaCapitalPl`,
  "TR_SECTION", "Condicional cuja condição nasce em parâmetro do TR: informado no TR quando ativo");
COND(`contratacao.prazoComunicacaoIncidenteDados contratacao.prazoPrestacaoGarantia contratacao.prazoRespostaRepactuacao decisao.adesaoAta
  habilitacao.registroCadastralAceito srp.marcoInicialVigenciaAta srp.prazoAssinaturaAta`,
  "ORG_PROFILE", "Condicional de política do órgão: informado no Perfil de Licitações quando ativo");
COND(`decisao.modalidadeTratamentoRegional instituicao.decretoMunicipalRegulamentador julgamento.baseDoLance julgamento.casasDecimaisDesconto
  julgamento.casasDecimaisPreco julgamento.dotacaoOrcamentaria julgamento.duracaoEtapaLances julgamento.fonteRecursos julgamento.intervaloMinimoLances
  julgamento.momentoDivulgacaoOrcamento julgamento.regraProrrogacaoAutomatica julgamento.regrasEtapaAbertaFechada participacao.abrangenciaExclusividadeMeEpp
  participacao.abrangenciaExclusividadeRegional participacao.baseLegalTratamentoRegional participacao.criterioDelimitacaoRegiao
  julgamento.baseIncidenciaDesconto srp.regraQuantidadeMinimaCotacaoSrp participacao.percentualCotaReservada participacao.percentualPrioridadeRegional processo.listaAnexosAdicionais
  srp.condicoesAlteracaoPrecosRegistrados srp.limiteAdesaoAta srp.orgaoGerenciadorSrp srp.orgaosParticipantesSrp srp.prazoVigenciaAta`,
  "PREPARATION", "Condicional de decisão do certame: informado na preparação quando ativo");

// ── Pós-homologação ──────────────────────────────────────────────────────────────────────────────────────────────────
put(`pos.anoAta pos.anoContrato pos.contratadoCnpj pos.contratadoEndereco pos.contratadoRazaoSocial pos.contratadoRepresentanteNome
  pos.contratadoRepresentanteQualificacao pos.dataAssinaturaAta pos.dataAssinaturaContrato pos.fornecedorRegistradoCnpj pos.fornecedorRegistradoEndereco
  pos.fornecedorRegistradoRazaoSocial pos.fornecedorRegistradoRepresentante pos.numeroAta pos.numeroContrato pos.percentualDescontoContratado
  pos.quadroCadastroReserva pos.quadroItensContratados pos.quadroPrecosRegistrados pos.valorContrato`,
  E("POST_AWARD", "NONE", "Pós-homologação: fora da preparação do Edital"));

/** Linha da matriz para a variável, ou `undefined` quando o modelo não a cobre (outro modelo/catálogo). */
export function authorityEntryOf(variableName: string): AuthorityEntry | undefined {
  return Object.prototype.hasOwnProperty.call(table, variableName) ? table[variableName] : undefined;
}

export const AUTHORITY_MATRIX_VARIABLES: readonly string[] = Object.freeze(Object.keys(table).sort());

/** Cobertura: variáveis do catálogo SEM linha na matriz (deve ser vazio para o modelo BLL). */
export function uncoveredVariables(vars: readonly Pick<VariableDef2, "name">[]): string[] {
  return vars.filter((v) => !authorityEntryOf(v.name)).map((v) => v.name);
}

/** Variáveis do catálogo que são parâmetros estruturados do TR (entrada no fluxo do TR). */
export function trSectionVariables(vars: readonly Pick<VariableDef2, "name">[]): string[] {
  return vars.filter((v) => authorityEntryOf(v.name)?.entry === "TR_SECTION").map((v) => v.name);
}

/** Variável elegível a padrão institucional (por ação humana explícita). */
export const isDefaultEligible = (variableName: string): boolean => authorityEntryOf(variableName)?.defaultEligible === true;

// ── Papéis institucionais → variáveis ─────────────────────────────────────────────────────────────────────────────────

export const ROLE_KEYS = [
  "CHEFE_DO_EXECUTIVO", "AUTORIDADE_COMPETENTE", "AGENTE_DE_CONTRATACAO", "PREGOEIRO", "EQUIPE_DE_APOIO",
  "AUTORIDADE_SANCIONADORA", "DIRETOR_LICITACOES", "ASSINANTE_DO_EDITAL",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABEL: Readonly<Record<RoleKey, string>> = {
  CHEFE_DO_EXECUTIVO: "Chefe do Executivo (Prefeito)",
  AUTORIDADE_COMPETENTE: "Autoridade competente",
  AGENTE_DE_CONTRATACAO: "Agente de contratação",
  PREGOEIRO: "Pregoeiro",
  EQUIPE_DE_APOIO: "Equipe de apoio",
  AUTORIDADE_SANCIONADORA: "Autoridade sancionadora",
  DIRETOR_LICITACOES: "Diretor(a) de Licitações",
  ASSINANTE_DO_EDITAL: "Quem subscreve o Edital",
};

export type RoleField = "name" | "cargo" | "ato" | "nameAndCargo";
/** Variável do catálogo → (papel, campo do papel). Projeção DETERMINÍSTICA; nenhum papel deriva de outro (Prefeito ≠ autoridade competente). */
export const ROLE_VARIABLES: Readonly<Record<string, { readonly role: RoleKey; readonly field: RoleField }>> = Object.freeze({
  "instituicao.autoridadeCompetenteNome": { role: "AUTORIDADE_COMPETENTE", field: "name" },
  "instituicao.autoridadeCompetenteCargo": { role: "AUTORIDADE_COMPETENTE", field: "cargo" },
  "instituicao.pregoeiroNome": { role: "PREGOEIRO", field: "name" },
  "instituicao.pregoeiroPortaria": { role: "PREGOEIRO", field: "ato" },
  "sancoes.autoridadeSancionadora": { role: "AUTORIDADE_SANCIONADORA", field: "nameAndCargo" },
  "instituicao.equipeApoio": { role: "EQUIPE_DE_APOIO", field: "name" },
  "instituicao.signatarioEditalNome": { role: "ASSINANTE_DO_EDITAL", field: "name" },
  "instituicao.signatarioEditalCargo": { role: "ASSINANTE_DO_EDITAL", field: "cargo" },
});

export interface RoleAssignment {
  readonly name: string;
  readonly cargo?: string;
  /** Ato / portaria / delegação que fundamenta a designação. */
  readonly ato?: string;
  /** Data de referência do ato (AAAA-MM-DD). */
  readonly dataReferencia?: string;
  /** Fim da vigência (AAAA-MM-DD): vencida ⇒ NÃO é usada (nunca silenciosamente). */
  readonly vigenciaAte?: string;
}
export type RoleAssignments = Readonly<Partial<Record<RoleKey, RoleAssignment>>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validIsoDate = (s: string): boolean => ISO_DATE.test(s) && isRealCalendarDate(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));

export function validateRoleAssignments(raw: unknown): { ok: true; value: RoleAssignments } | { ok: false; issues: string[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issues: ["roles deve ser um objeto { PAPEL → designação }"] };
  const issues: string[] = [];
  const out: Partial<Record<RoleKey, RoleAssignment>> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ROLE_KEYS as readonly string[]).includes(key)) { issues.push(`papel desconhecido: ${key}`); continue; }
    if (typeof v !== "object" || v === null || Array.isArray(v)) { issues.push(`${key}: designação deve ser um objeto`); continue; }
    const o = v as Record<string, unknown>;
    const extra = Object.keys(o).filter((k) => !["name", "cargo", "ato", "dataReferencia", "vigenciaAte"].includes(k));
    if (extra.length) { issues.push(`${key}: campos desconhecidos (${extra.join(", ")})`); continue; }
    const text = (k: string, max: number, required = false): string | undefined => {
      const val = o[k];
      if (val === undefined || val === null || val === "") { if (required) issues.push(`${key}.${k}: obrigatório`); return undefined; }
      if (typeof val !== "string" || val.trim() === "" || val.length > max) { issues.push(`${key}.${k}: texto inválido (até ${max})`); return undefined; }
      return val.replace(/\s+/g, " ").trim();
    };
    const date = (k: string): string | undefined => {
      const val = o[k];
      if (val === undefined || val === null || val === "") return undefined;
      if (typeof val !== "string" || !validIsoDate(val)) { issues.push(`${key}.${k}: data inválida (AAAA-MM-DD)`); return undefined; }
      return val;
    };
    const name = text("name", 400, true), cargo = text("cargo", 200), ato = text("ato", 300), dataReferencia = date("dataReferencia"), vigenciaAte = date("vigenciaAte");
    if (name) out[key as RoleKey] = { name, ...(cargo ? { cargo } : {}), ...(ato ? { ato } : {}), ...(dataReferencia ? { dataReferencia } : {}), ...(vigenciaAte ? { vigenciaAte } : {}) };
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: out };
}

export type RoleValueResolution =
  | { readonly state: "OK"; readonly value: string; readonly role: RoleKey }
  | { readonly state: "MISSING"; readonly role: RoleKey; readonly reason: string }
  | { readonly state: "STALE"; readonly role: RoleKey; readonly reason: string };

/** Valor do papel para a variável (projeção determinística). Designação vencida em `asOf` é STALE: nunca usada em silêncio. */
export function resolveRoleVariable(variableName: string, roles: RoleAssignments | null | undefined, asOf: string): RoleValueResolution | null {
  const rv = ROLE_VARIABLES[variableName];
  if (!rv) return null;
  const a = roles?.[rv.role];
  if (!a) return { state: "MISSING", role: rv.role, reason: `papel ${ROLE_LABEL[rv.role]} não designado no Perfil de Licitações` };
  if (a.vigenciaAte && a.vigenciaAte < asOf) return { state: "STALE", role: rv.role, reason: `designação de ${ROLE_LABEL[rv.role]} vencida em ${a.vigenciaAte}` };
  const value = rv.field === "name" ? a.name : rv.field === "cargo" ? a.cargo : rv.field === "ato" ? a.ato : a.cargo ? `${a.name}, ${a.cargo}` : a.name;
  if (!value) return { state: "MISSING", role: rv.role, reason: `${ROLE_LABEL[rv.role]}: ${rv.field === "cargo" ? "cargo" : "ato de designação"} não informado` };
  return { state: "OK", value, role: rv.role };
}
