/**
 * PR A.1 — deriva um slug a partir do nome do órgão (AdminOrganizacoes.tsx), pré-preenchendo o
 * campo até o usuário editar manualmente.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
