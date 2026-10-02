import { describeRegenerationBlock, type RegenerationBlock } from "./regenerationGuard";

/**
 * R5 (decisão do owner) — documento APROVADO/OFICIAL: "Gerar novamente" fica indisponível e a tela explica
 * que substituir o documento oficial exige um novo ciclo de versão governado (capacidade futura). O
 * servidor recusa de todo modo (OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE).
 */
export default function RegenerationBlockedNotice({ documentLabel, block }: { documentLabel: string; block: RegenerationBlock }) {
  const text = describeRegenerationBlock(documentLabel, block);
  if (!text) return null;
  return (
    <div
      className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-800 dark:text-blue-300"
      role="status"
    >
      <strong>Documento oficial — nova versão governada necessária.</strong> {text}
    </div>
  );
}
