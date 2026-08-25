import { useCallback, useState } from "react";

/**
 * C.4A — chave de idempotência estável por TENTATIVA lógica.
 *
 * Contrato: uma chave por tentativa lógica; a MESMA chave é reutilizada em retry da mesma tentativa
 * (retry de rede do TanStack Query reusa as variables da mutation → mesma chave); uma nova geração
 * deliberada, DEPOIS de concluída, recebe nova chave via `rotate()` (chamar em `onSuccess`). Não usa
 * `localStorage` (estado apenas em memória do componente). O botão desabilitado durante `pending` evita
 * double-submit; a idempotência do backend é a garantia real, não o disabled visual.
 */
export function useIdempotencyKey(): { key: string; rotate: () => void } {
  const [key, setKey] = useState<string>(() => crypto.randomUUID());
  const rotate = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, rotate };
}
