/**
 * A3-RD1 — CLI de hashes do manifesto de referência jurídica V1.
 *
 * Lê a FONTE ÚNICA canônica (`server/domain/legalReference/manifestV1.ts`) e imprime os
 * hashes reprodutíveis (F-LEGAL1.1 §4.2). Substitui o antigo script .mjs que duplicava o
 * dataset — agora há UMA só representação machine-readable.
 *
 * Uso: `pnpm tsx server/scripts/legalReferenceManifestHashes.ts`
 * (execução repetida = saída idêntica → reprodutibilidade).
 */
import {
  LEGAL_REFERENCE_V1_ENTRIES,
  LEGAL_REFERENCE_V1_OVERRIDES,
  computeManifestHashes,
} from "../domain/legalReference/manifestV1";

const h = computeManifestHashes();
console.info("coverageManifestHash:", h.coverageManifestHash);
for (const e of [...LEGAL_REFERENCE_V1_ENTRIES].sort((a, b) => a.canonicalLocator.localeCompare(b.canonicalLocator))) {
  console.info(`entry ${e.canonicalDisplay.padEnd(11)} ${e.canonicalLocator} structuralContentHash: ${h.entryHashes[e.canonicalLocator]}`);
}
for (const o of LEGAL_REFERENCE_V1_OVERRIDES) {
  console.info(`override ${o.canonicalLocator} contentHash: ${h.overrideHashes[o.canonicalLocator]}`);
}
console.info("referenceSetContentHash:", h.referenceSetContentHash);
