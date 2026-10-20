/**
 * M8 (P1-C) — fixture de sessão do contrato ATUAL de extração: `extractionSummary.provenanceScan` vigente, vinculado ao
 * checksum da sessão (como o worker grava após executar a análise de declaração do documento). Fixtures que inserem
 * sessões "já extraídas" direto no banco usam isto; sem a evidência, a sessão é LEGADA e a promoção a recusa.
 */
import { PROVENANCE_SCAN_VERSION, type ProvenanceScanEvidence } from "../../domain/quoteProvenance";

export function currentProvenanceScanSummary(
  checksum: string, declaration: ProvenanceScanEvidence["declaration"] = null, parserType = "xlsx",
): { provenanceScan: ProvenanceScanEvidence } {
  return {
    provenanceScan: {
      version: PROVENANCE_SCAN_VERSION, sourceChecksum: checksum.toLowerCase(), parserType, parserVersion: "fixture",
      declaration, origin: "extraction", scannedAt: new Date(0).toISOString(),
    },
  };
}
