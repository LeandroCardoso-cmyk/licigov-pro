/**
 * LICIGOV-FAST — registro ELETRÔNICO da decisão: o usuário autenticado é a identidade da decisão; ninguém redigita o que o sistema já sabe.
 *
 * Quando a operação NÃO exige fundamento institucional (política do órgão, derivação, registro de modelo, aprovar/disponibilizar/depreciar modelo), o cliente não
 * precisa informar autoridade/cargo/ato. O servidor monta a autoridade declarada a partir do que é FATO: quem está autenticado, o papel no órgão e a data do
 * servidor. NUNCA inventa ato administrativo: a referência diz, de forma explícita, que nenhum ato foi informado. Fundamento institucional real continua possível
 * (envie `decision` completa) e continua OBRIGATÓRIO onde o contrato o exige (evidência jurídica). O ledger segue registrando `recordedByUserId`, `correlationId`
 * e `authority_validation = NOT_VALIDATED_POLICY_PENDING`.
 */
import type { DeclaredAuthority } from "./governanceService";

export const ELECTRONIC_BASIS = "Registro eletrônico no LiciGov Pro pelo usuário autenticado (nenhum ato administrativo informado)";

export const ROLE_LABEL: Readonly<Record<string, string>> = Object.freeze({ viewer: "Leitor", operator: "Operador", manager: "Gestor", owner: "Titular" });

export interface ElectronicAuthorityInput {
  readonly userId: number;
  readonly userName: string | null | undefined;
  readonly userEmail: string | null | undefined;
  readonly orgRole: string | null | undefined;
  /** Data do servidor (AAAA-MM-DD), vinda do relógio das ports. */
  readonly today: string;
  /** Descrição curta da ação, usada na justificativa técnica automática. */
  readonly action: string;
  /** Observação livre opcional do usuário (vira a justificativa). */
  readonly note?: string | null | undefined;
}

export function electronicAuthority(i: ElectronicAuthorityInput): DeclaredAuthority {
  const name = (i.userName ?? "").trim() || (i.userEmail ?? "").trim() || `Usuário #${i.userId}`;
  const role = i.orgRole ? `${ROLE_LABEL[i.orgRole] ?? i.orgRole} do órgão (${i.orgRole})` : "Usuário autenticado";
  const note = (i.note ?? "").trim();
  return {
    decidedByName: name.slice(0, 255), decidedByRole: role.slice(0, 255), decidedByUserId: i.userId, decidedAt: i.today,
    basisReference: ELECTRONIC_BASIS, reason: (note || `${i.action} — registrado eletronicamente pelo usuário autenticado.`).slice(0, 5000),
  };
}

/** `decision` informada (fundamento institucional explícito) prevalece e segue validada como antes; ausente ⇒ autoridade eletrônica. */
export function resolveAuthority<T extends DeclaredAuthority>(decision: T | undefined, auto: ElectronicAuthorityInput): DeclaredAuthority {
  return decision ?? electronicAuthority(auto);
}
