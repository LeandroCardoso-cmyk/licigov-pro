/**
 * A3-RD1 — Manifesto V1 machine-readable (FONTE ÚNICA canônica do reference set V1).
 *
 * Conteúdo jurídico VERIFICADO em fonte oficial (Planalto) via
 * `cross-environment-official-source-handoff` (ver docs/ops/legal-reference/
 * LEGAL_REFERENCE_MANIFEST_V1_2026.md). Este módulo é a ÚNICA representação do dataset:
 * o installer (A3-RD1), os testes e o CLI de hash consomem ESTE módulo — sem duplicar
 * o dataset em docs/script/migration/runtime.
 *
 * DOCS/CONTENT ONLY nesta fase: instalar ≠ ativar. O set nasce `draft` e só é ativado por
 * aprovação humana explícita (não executada aqui). Escopo GLOBAL/BR-FEDERAL (não-tenant).
 */
import { sha256Hex } from "./contentHash";

export type ProcurementType = "dispensa" | "inexigibilidade";

export interface LegalReferenceEntryV1 {
  readonly article: string;
  readonly inciso: string | null;
  readonly alinea: string | null;
  readonly canonicalLocator: string;
  readonly canonicalDisplay: string;
  readonly procurementType: ProcurementType;
  readonly hypothesisSummary: string;
}

export interface LegalValueOverrideV1 {
  readonly canonicalLocator: string;
  readonly valueCents: number;
}

/** Metadados/lineage do set V1 (fonte oficial via handoff externo). */
export const LEGAL_REFERENCE_V1_META = {
  law: "Lei nº 14.133/2021",
  jurisdiction: "BR-FEDERAL",
  scope: "GLOBAL",
  version: 1,
  effectiveFrom: "2026-01-01",
  effectiveTo: null as string | null,
  verificationMethod: "cross-environment-official-source-handoff",
  /** Bytes das páginas oficiais remotas não disponíveis neste ambiente — nunca fabricar. */
  sourceHash: "unavailable_in_current_environment",
  law_source: {
    authority: "Presidência da República / Planalto",
    identifier: "Lei nº 14.133, de 1º de abril de 2021",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm",
    publicationDate: "2021-04-01",
  },
  decree_source: {
    authority: "Presidência da República / Planalto",
    identifier: "Decreto nº 12.807, de 29 de dezembro de 2025",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12807.htm",
    publicationDate: "2025-12-30",
  },
} as const;

/**
 * 7 entries VERIFIED (Art. 74 I–V; Art. 75 I–II).
 * NOTA (A3-RD1 §1/§14): Art. 74, IV tem `procurementType = "inexigibilidade"` (o enum do domínio
 * de contratação direta é dispensa|inexigibilidade); a natureza de CREDENCIAMENTO fica registrada
 * apenas no `hypothesisSummary` — o enum NÃO é ampliado nesta fase.
 */
export const LEGAL_REFERENCE_V1_ENTRIES: readonly LegalReferenceEntryV1[] = [
  {
    article: "74", inciso: "I", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-74/inc-I", canonicalDisplay: "Art. 74, I",
    procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade por inviabilidade de competição: aquisição de materiais, equipamentos ou gêneros, ou contratação de serviços, que só possam ser fornecidos/prestados por produtor, empresa ou representante comercial exclusivo.",
  },
  {
    article: "74", inciso: "II", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-74/inc-II", canonicalDisplay: "Art. 74, II",
    procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: contratação de profissional do setor artístico, diretamente ou por meio de empresário exclusivo, desde que consagrado pela crítica especializada ou pela opinião pública.",
  },
  {
    article: "74", inciso: "III", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-74/inc-III", canonicalDisplay: "Art. 74, III",
    procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: contratação de serviços técnicos especializados de natureza predominantemente intelectual com profissional ou empresa de notória especialização (inciso com alíneas próprias); vedada para serviços de publicidade e divulgação.",
  },
  {
    article: "74", inciso: "IV", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-74/inc-IV", canonicalDisplay: "Art. 74, IV",
    procurementType: "inexigibilidade",
    hypothesisSummary: "Objetos que devam ou possam ser contratados por meio de credenciamento.",
  },
  {
    article: "74", inciso: "V", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-74/inc-V", canonicalDisplay: "Art. 74, V",
    procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: aquisição ou locação de imóvel cujas características de instalações e de localização tornem necessária sua escolha.",
  },
  {
    article: "75", inciso: "I", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-75/inc-I", canonicalDisplay: "Art. 75, I",
    procurementType: "dispensa",
    hypothesisSummary: "Dispensa em razão do valor: contratação de obras e serviços de engenharia ou de serviços de manutenção de veículos automotores, até o limite de valor vigente (valor em legal_value_override).",
  },
  {
    article: "75", inciso: "II", alinea: null,
    canonicalLocator: "lei-14.133-2021/art-75/inc-II", canonicalDisplay: "Art. 75, II",
    procurementType: "dispensa",
    hypothesisSummary: "Dispensa em razão do valor: contratação de outros serviços e compras, até o limite de valor vigente (valor em legal_value_override).",
  },
];

/** 2 value overrides VERIFIED (Decreto 12.807/2025, vigência 2026-01-01). */
export const LEGAL_REFERENCE_V1_OVERRIDES: readonly LegalValueOverrideV1[] = [
  { canonicalLocator: "lei-14.133-2021/art-75/inc-I", valueCents: 13098420 },
  { canonicalLocator: "lei-14.133-2021/art-75/inc-II", valueCents: 6549211 },
];

// ─── Objetos canônicos de CONTEÚDO (base dos hashes; sem lifecycle/verificationStatus/sourceHash) ───

const M = LEGAL_REFERENCE_V1_META;

export function entryContentObject(e: LegalReferenceEntryV1): Record<string, unknown> {
  return {
    law: M.law, article: e.article, inciso: e.inciso, alinea: e.alinea,
    canonicalLocator: e.canonicalLocator, canonicalDisplay: e.canonicalDisplay,
    procurementType: e.procurementType, hypothesisSummary: e.hypothesisSummary,
    sourceAuthority: M.law_source.authority, sourceIdentifier: M.law_source.identifier,
    sourceUrl: M.law_source.url, publicationDate: M.law_source.publicationDate,
    effectiveFrom: M.effectiveFrom, effectiveTo: M.effectiveTo,
  };
}

export function overrideContentObject(o: LegalValueOverrideV1): Record<string, unknown> {
  return {
    canonicalLocator: o.canonicalLocator, valueCents: o.valueCents,
    effectiveFrom: M.effectiveFrom, effectiveTo: M.effectiveTo,
    sourceAuthority: M.decree_source.authority, sourceIdentifier: M.decree_source.identifier,
    sourceUrl: M.decree_source.url, publicationDate: M.decree_source.publicationDate,
  };
}

/** Ordenação canônica determinística dos arrays de conteúdo. */
function sortedEntries(): LegalReferenceEntryV1[] {
  return [...LEGAL_REFERENCE_V1_ENTRIES].sort((a, b) => a.canonicalLocator.localeCompare(b.canonicalLocator));
}
function sortedOverrides(): LegalValueOverrideV1[] {
  return [...LEGAL_REFERENCE_V1_OVERRIDES].sort((a, b) =>
    (a.canonicalLocator + M.effectiveFrom).localeCompare(b.canonicalLocator + M.effectiveFrom));
}

export function coverageManifestObject(): Record<string, unknown> {
  return {
    law: M.law, jurisdiction: M.jurisdiction,
    supportedLocators: sortedEntries().map((e) => e.canonicalLocator).sort(),
    temporal: { effectiveFrom: M.effectiveFrom, effectiveTo: M.effectiveTo },
  };
}

export function referenceSetContentObject(): Record<string, unknown> {
  return {
    law: M.law, jurisdiction: M.jurisdiction, scope: M.scope, version: M.version,
    coverageManifest: coverageManifestObject(),
    entries: sortedEntries().map(entryContentObject),
    overrides: sortedOverrides().map(overrideContentObject),
  };
}

export interface ManifestHashes {
  readonly coverageManifestHash: string;
  readonly entryHashes: Record<string, string>; // canonicalLocator → structuralContentHash
  readonly overrideHashes: Record<string, string>; // canonicalLocator → contentHash
  readonly referenceSetContentHash: string;
}

/** Computa todos os hashes canônicos a partir da FONTE ÚNICA (reprodutível). */
export function computeManifestHashes(): ManifestHashes {
  const entryHashes: Record<string, string> = {};
  for (const e of sortedEntries()) entryHashes[e.canonicalLocator] = sha256Hex(entryContentObject(e));
  const overrideHashes: Record<string, string> = {};
  for (const o of sortedOverrides()) overrideHashes[o.canonicalLocator] = sha256Hex(overrideContentObject(o));
  return {
    coverageManifestHash: sha256Hex(coverageManifestObject()),
    entryHashes,
    overrideHashes,
    referenceSetContentHash: sha256Hex(referenceSetContentObject()),
  };
}
