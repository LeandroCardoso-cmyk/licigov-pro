/**
 * R5 / R5.1 — guard TRANSVERSAL contra hidratação destrutiva de formulários (INV-05).
 *
 * Princípio: dados persistidos no servidor NUNCA são substituídos por defaults locais — nem antes da hidratação, nem
 * por um "salvar" com campos em branco. Três peças, todas puras e testáveis (o hook só as compõe):
 *  - `hydrateFormState(server, empty)`: estado inicial do formulário a partir do PERSISTIDO (campos ausentes ⇒ o vazio
 *    neutro informado, nunca um default decisório como "Favorável");
 *  - `buildSavePatch(server, local)`: só os campos que a pessoa MUDOU e que NÃO estão em branco — salvar vazio não
 *    apaga o que existe; nada muda ⇒ patch vazio (o chamador não salva);
 *  - `hydrationKey(...)`: chave da versão persistida; quando muda (outra pessoa salvou, reload), o formulário volta a
 *    hidratar a partir do servidor em vez de manter um estado local antigo.
 * `useHydratedForm` bloqueia o envio até a hidratação (`ready`), evitando que o 1º render com defaults seja salvo.
 */
import React from "react";

export type FormValues = Record<string, string | null>;

export function hydrateFormState<T extends FormValues>(server: Partial<Record<keyof T, string | null | undefined>> | null | undefined, empty: T): T {
  const out = { ...empty };
  if (!server) return out;
  for (const k of Object.keys(empty) as Array<keyof T>) {
    const v = server[k];
    if (v !== undefined) (out as FormValues)[k as string] = v ?? empty[k];
  }
  return out;
}

const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === "";

/** Campos alterados e não vazios. Um campo em branco nunca apaga o valor persistido. */
export function buildSavePatch<T extends FormValues>(server: Partial<T> | null | undefined, local: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const k of Object.keys(local) as Array<keyof T>) {
    const next = local[k];
    if (blank(next)) continue;
    if (server && server[k] === next) continue;
    patch[k] = next;
  }
  return patch;
}

export function hydrationKey(...parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => (p === null || p === undefined ? "∅" : String(p))).join("|");
}

/**
 * Hook: hidrata `empty` com `server` quando os dados chegam (`loading=false`) e de novo sempre que `key` muda.
 * Enquanto não hidratou, `ready=false` — o formulário não deve permitir envio.
 */
export function useHydratedForm<T extends FormValues>(params: {
  server: Partial<Record<keyof T, string | null | undefined>> | null | undefined;
  empty: T;
  key: string;
  loading: boolean;
}) {
  const { server, empty, key, loading } = params;
  const [values, setValues] = React.useState<T>(empty);
  const [hydratedKey, setHydratedKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (loading || hydratedKey === key) return;
    setValues(hydrateFormState(server, empty));
    setHydratedKey(key);
  }, [loading, key, hydratedKey, server, empty]);
  const setField = React.useCallback(<K extends keyof T>(k: K, v: T[K]) => setValues((prev) => ({ ...prev, [k]: v })), []);
  return { values, setField, ready: !loading && hydratedKey === key };
}
