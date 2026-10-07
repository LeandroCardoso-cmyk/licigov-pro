/**
 * Aplicabilidade EXPLÍCITA do modelo (piloto Edital multi-modelo) — domínio puro.
 *
 * O escopo de um binding tem cinco dimensões: modalidade, forma, plataforma, regime e critério. Nenhuma é inferida, completada
 * ou "adivinhada": o que não foi declarado não casa com pedido que o declara (igualdade EXATA, `binding.ts`). Para o Edital a
 * declaração de modalidade e forma é OBRIGATÓRIA (e a de plataforma, quando eletrônica) — não existe seleção opaca de modelo.
 *
 * Os tokens abaixo são SUGESTÕES de vocabulário para a UX (futuros modelos — Pregão Presencial, Concorrência eletrônica/
 * presencial, outras plataformas — entram sem mudar este contrato); o backend só exige token seguro e estável.
 */
import type { BindingScope } from "../binding";
import type { TemplateDocumentKind } from "../types";

export const SCOPE_DIMENSIONS = ["modality", "form", "platform", "regime", "criterion"] as const;
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

export const SCOPE_DIMENSION_LABEL: Readonly<Record<ScopeDimension, string>> = Object.freeze({
  modality: "Modalidade", form: "Forma", platform: "Plataforma", regime: "Regime de contratação", criterion: "Critério de julgamento",
});

/** Dimensões que a persistência ATUAL (migration 0317) consegue gravar: as cinco do escopo exato. */
export const PERSISTED_SCOPE_DIMENSIONS: readonly ScopeDimension[] = Object.freeze([...SCOPE_DIMENSIONS] as ScopeDimension[]);
/** Persistência anterior à 0317 (histórico/testes de compatibilidade): sem forma e plataforma. */
export const PERSISTED_SCOPE_DIMENSIONS_V0316: readonly ScopeDimension[] = Object.freeze(["modality", "regime", "criterion"] as ScopeDimension[]);

/** Vocabulário sugerido (não fechado): rótulo humano por token canônico. */
export const SCOPE_VOCABULARY: Readonly<Record<ScopeDimension, Readonly<Record<string, string>>>> = Object.freeze({
  modality: { pregao: "Pregão", concorrencia: "Concorrência", dispensa: "Dispensa", inexigibilidade: "Inexigibilidade" },
  form: { eletronica: "Eletrônica", presencial: "Presencial" },
  platform: { bll: "BLL", "compras-gov": "Compras.gov.br", licitanet: "Licitanet", propria: "Plataforma própria" },
  regime: { "empreitada-preco-unitario": "Empreitada por preço unitário", "empreitada-preco-global": "Empreitada por preço global", fornecimento: "Fornecimento", "servico-continuo": "Serviço contínuo" },
  criterion: { "menor-preco": "Menor preço", "maior-desconto": "Maior desconto", "tecnica-e-preco": "Técnica e preço" },
});

/** Token estável = SLUG exato do domínio (`binding.ts`): minúsculas, dígitos e hífens, até 64 caracteres (sem '|'). */
export const SCOPE_TOKEN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ScopeView = Readonly<Partial<Record<ScopeDimension, string>>>;

/** Lê as cinco dimensões de um escopo (aceita escopo antigo de 3 dimensões). */
export function readScope(scope: BindingScope | ScopeView | null | undefined): ScopeView {
  const out: Partial<Record<ScopeDimension, string>> = {};
  for (const d of SCOPE_DIMENSIONS) {
    const v = (scope as Partial<Record<ScopeDimension, unknown>> | null | undefined)?.[d];
    if (typeof v === "string" && v !== "") out[d] = v;
  }
  return out;
}

export function scopeDimensionsInUse(scope: BindingScope | ScopeView): ScopeDimension[] {
  const v = readScope(scope);
  return SCOPE_DIMENSIONS.filter((d) => v[d] !== undefined);
}

/** Dimensões usadas que a persistência não suporta (⇒ recusar; nunca descartar em silêncio). */
export function unsupportedScopeDimensions(scope: BindingScope | ScopeView, supported: readonly ScopeDimension[]): ScopeDimension[] {
  return scopeDimensionsInUse(scope).filter((d) => !supported.includes(d));
}

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
export const isElectronicForm = (form: string | undefined): boolean => form !== undefined && /^ELETRONIC[AO]$/.test(norm(form));
export const isPresentialForm = (form: string | undefined): boolean => form !== undefined && /^PRESENCIAL$/.test(norm(form));

export interface ScopeIssue { readonly dimension: ScopeDimension | "scope"; readonly code: "REQUIRED" | "INVALID_TOKEN" | "PLATFORM_REQUIRED_FOR_ELECTRONIC"; readonly message: string }

/**
 * Regras de declaração do escopo. Para `edital`: modalidade e forma são obrigatórias; plataforma é
 * obrigatória quando a forma é eletrônica. Para os demais tipos o escopo permanece livre (só valida token das dimensões usadas).
 */
export function validateExplicitScope(documentKind: TemplateDocumentKind, scope: BindingScope | ScopeView): ScopeIssue[] {
  const v = readScope(scope);
  const issues: ScopeIssue[] = [];
  for (const d of scopeDimensionsInUse(v)) {
    if (v[d]!.length > 64 || !SCOPE_TOKEN_RE.test(v[d]!)) issues.push({ dimension: d, code: "INVALID_TOKEN", message: `${SCOPE_DIMENSION_LABEL[d]}: use um slug estável (minúsculas, números e hífens; sem espaços nem '|').` });
  }
  if (documentKind === "edital") {
    // Regime e critério NÃO são obrigatórios no Edital multi-modelo: o critério (menor preço/maior desconto) é uma DECISÃO DE
    // COMPOSIÇÃO do documento (blocos condicionais), não aplicabilidade do modelo. Modalidade e forma definem o modelo.
    for (const d of ["modality", "form"] as const) {
      if (v[d] === undefined) issues.push({ dimension: d, code: "REQUIRED", message: `${SCOPE_DIMENSION_LABEL[d]} deve ser declarada explicitamente para o Edital (sem seleção automática).` });
    }
    if (isElectronicForm(v.form) && v.platform === undefined) {
      issues.push({ dimension: "platform", code: "PLATFORM_REQUIRED_FOR_ELECTRONIC", message: "Forma eletrônica exige a plataforma do certame declarada explicitamente." });
    }
  }
  return issues;
}

/** Rótulo curto e estável: "Pregão | Eletrônica | BLL" (modalidade | forma | plataforma); regime/critério vêm depois, se houver. */
export function scopeHeadline(scope: BindingScope | ScopeView): string {
  const v = readScope(scope);
  const label = (d: ScopeDimension): string | undefined => (v[d] === undefined ? undefined : SCOPE_VOCABULARY[d][v[d]!] ?? v[d]);
  const head = (["modality", "form", "platform"] as const).map(label).filter((x): x is string => x !== undefined);
  const tail = (["regime", "criterion"] as const).map(label).filter((x): x is string => x !== undefined);
  const all = [...head, ...tail];
  return all.length ? all.join(" | ") : "sem escopo declarado";
}

/** Igualdade exata de duas visões de escopo (ausente ≡ ausente). */
export function sameScopeView(a: BindingScope | ScopeView, b: BindingScope | ScopeView): boolean {
  const x = readScope(a); const y = readScope(b);
  return SCOPE_DIMENSIONS.every((d) => (x[d] ?? null) === (y[d] ?? null));
}
