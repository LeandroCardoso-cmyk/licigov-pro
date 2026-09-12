import { createHash } from "node:crypto";

// Canonicalização (F-LEGAL1.1 §4.2): SHA-256 / UTF-8(NFC) / canonical JSON /
// chaves ordenadas / arrays de conteúdo pré-ordenados / sem espaços / null explícito /
// centavos inteiros / datas ISO-8601. Lifecycle mutável NÃO entra no objeto de conteúdo.
function canon(v) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  if (typeof v === "string") return v.normalize("NFC");
  return v;
}
const sha256 = (obj) => createHash("sha256").update(JSON.stringify(canon(obj)), "utf8").digest("hex");

const LAW = "Lei nº 14.133/2021";
const JUR = "BR-FEDERAL";
const SCOPE = "GLOBAL";
const AUTH = "Presidência da República / Planalto";
const LEI_ID = "Lei nº 14.133, de 1º de abril de 2021";
const LEI_URL = "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm";
const LEI_PUB = "2021-04-01";
const DEC_ID = "Decreto nº 12.807, de 29 de dezembro de 2025";
const DEC_URL = "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12807.htm";
const DEC_PUB = "2025-12-30";
const FROM = "2026-01-01";
const TO = null;

// Objeto de CONTEÚDO da entry (o que entra no structuralContentHash). Sem lifecycle/verificationStatus.
const entryContent = (e) => ({
  law: LAW, article: e.article, inciso: e.inciso, alinea: e.alinea,
  canonicalLocator: e.canonicalLocator, canonicalDisplay: e.canonicalDisplay,
  procurementType: e.procurementType, hypothesisSummary: e.hypothesisSummary,
  sourceAuthority: AUTH, sourceIdentifier: LEI_ID, sourceUrl: LEI_URL,
  publicationDate: LEI_PUB, effectiveFrom: FROM, effectiveTo: TO,
});

const entries = [
  { article: "74", inciso: "I", alinea: null, canonicalLocator: "lei-14.133-2021/art-74/inc-I", canonicalDisplay: "Art. 74, I", procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade por inviabilidade de competição: aquisição de materiais, equipamentos ou gêneros, ou contratação de serviços, que só possam ser fornecidos/prestados por produtor, empresa ou representante comercial exclusivo." },
  { article: "74", inciso: "II", alinea: null, canonicalLocator: "lei-14.133-2021/art-74/inc-II", canonicalDisplay: "Art. 74, II", procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: contratação de profissional do setor artístico, diretamente ou por meio de empresário exclusivo, desde que consagrado pela crítica especializada ou pela opinião pública." },
  { article: "74", inciso: "III", alinea: null, canonicalLocator: "lei-14.133-2021/art-74/inc-III", canonicalDisplay: "Art. 74, III", procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: contratação de serviços técnicos especializados de natureza predominantemente intelectual com profissional ou empresa de notória especialização (inciso com alíneas próprias); vedada para serviços de publicidade e divulgação." },
  { article: "74", inciso: "IV", alinea: null, canonicalLocator: "lei-14.133-2021/art-74/inc-IV", canonicalDisplay: "Art. 74, IV", procurementType: "credenciamento",
    hypothesisSummary: "Objetos que devam ou possam ser contratados por meio de credenciamento." },
  { article: "74", inciso: "V", alinea: null, canonicalLocator: "lei-14.133-2021/art-74/inc-V", canonicalDisplay: "Art. 74, V", procurementType: "inexigibilidade",
    hypothesisSummary: "Inexigibilidade: aquisição ou locação de imóvel cujas características de instalações e de localização tornem necessária sua escolha." },
  { article: "75", inciso: "I", alinea: null, canonicalLocator: "lei-14.133-2021/art-75/inc-I", canonicalDisplay: "Art. 75, I", procurementType: "dispensa",
    hypothesisSummary: "Dispensa em razão do valor: contratação de obras e serviços de engenharia ou de serviços de manutenção de veículos automotores, até o limite de valor vigente (valor em legal_value_override)." },
  { article: "75", inciso: "II", alinea: null, canonicalLocator: "lei-14.133-2021/art-75/inc-II", canonicalDisplay: "Art. 75, II", procurementType: "dispensa",
    hypothesisSummary: "Dispensa em razão do valor: contratação de outros serviços e compras, até o limite de valor vigente (valor em legal_value_override)." },
].sort((a, b) => a.canonicalLocator.localeCompare(b.canonicalLocator));

const overrideContent = (o) => ({
  canonicalLocator: o.canonicalLocator, valueCents: o.valueCents, effectiveFrom: FROM, effectiveTo: TO,
  sourceAuthority: AUTH, sourceIdentifier: DEC_ID, sourceUrl: DEC_URL, publicationDate: DEC_PUB,
});
const overrides = [
  { canonicalLocator: "lei-14.133-2021/art-75/inc-I", valueCents: 13098420 },
  { canonicalLocator: "lei-14.133-2021/art-75/inc-II", valueCents: 6549211 },
].sort((a, b) => (a.canonicalLocator + a.effectiveFrom).localeCompare(b.canonicalLocator + b.effectiveFrom));

const coverageManifest = {
  law: LAW, jurisdiction: JUR,
  supportedLocators: entries.map((e) => e.canonicalLocator).sort(),
  temporal: { effectiveFrom: FROM, effectiveTo: TO },
};

const setContent = {
  law: LAW, jurisdiction: JUR, scope: SCOPE, version: 1,
  coverageManifest,
  entries: entries.map(entryContent),
  overrides: overrides.map(overrideContent),
};

console.log("coverageManifestHash:", sha256(coverageManifest));
for (const e of entries) console.log(`entry ${e.canonicalDisplay.padEnd(11)} structuralContentHash: ${sha256(entryContent(e))}`);
for (const o of overrides) console.log(`override ${o.canonicalLocator} contentHash: ${sha256(overrideContent(o))}`);
console.log("referenceSetContentHash:", sha256(setContent));
