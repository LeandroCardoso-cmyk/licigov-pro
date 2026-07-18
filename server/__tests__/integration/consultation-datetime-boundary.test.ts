/**
 * Regressão — conversão de data na fronteira do banco (Tirar Dúvidas).
 *
 * As colunas de data das consultas são DATETIME(3) (sem timezone). O MySQL rejeita o separador "T"
 * e o sufixo "Z" do ISO 8601 → o INSERT falhava em produção (bug latente: os testes usam repositório
 * in-memory). O repositório converte na fronteira: ISO ⇄ formato MySQL. Este teste trava o contrato.
 */

import { describe, it, expect } from "vitest";
import { toDbDatetime, fromDbDatetime } from "../../db/institutionalConsultations";

describe("Consulta institucional — conversão de data na fronteira do banco", () => {
  it("ISO (…T…Z) → formato aceito pelo MySQL (sem 'T', sem 'Z')", () => {
    const db = toDbDatetime("2026-07-18T01:50:16.293Z");
    expect(db).toBe("2026-07-18 01:50:16.293");
    expect(db).not.toContain("T");
    expect(db).not.toContain("Z");
  });

  it("formato do MySQL → ISO (UTC) para domínio/frontend", () => {
    expect(fromDbDatetime("2026-07-18 01:50:16.293")).toBe("2026-07-18T01:50:16.293Z");
  });

  it("round-trip preserva o instante", () => {
    const iso = "2026-07-18T01:50:16.293Z";
    expect(fromDbDatetime(toDbDatetime(iso))).toBe(iso);
  });

  it("valores nulos/ausentes são preservados como null (colunas anuláveis)", () => {
    expect(toDbDatetime(null)).toBeNull();
    expect(toDbDatetime(undefined)).toBeNull();
    expect(fromDbDatetime(null)).toBeNull();
    expect(toDbDatetime("data-invalida")).toBeNull();
  });
});
