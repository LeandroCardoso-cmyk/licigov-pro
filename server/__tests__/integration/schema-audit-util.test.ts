/**
 * Auditoria de schema — utilitários puros (classificação de divergências).
 */

import { describe, it, expect } from "vitest";
import { toSnake, diffSchema } from "../../../scripts/schema-audit-util";

describe("schema-audit · toSnake", () => {
  it("converte camelCase → snake_case e preserva snake_case", () => {
    expect(toSnake("stagingItemId")).toBe("staging_item_id");
    expect(toSnake("organizationId")).toBe("organization_id");
    expect(toSnake("createdAt")).toBe("created_at");
    expect(toSnake("catmatCode")).toBe("catmat_code");
    expect(toSnake("organization_id")).toBe("organization_id");
    expect(toSnake("id")).toBe("id");
  });
});

describe("schema-audit · diffSchema", () => {
  it("separa AUSENTE (não existe) de DIVERGENTE (existe com outra caixa) e ignora as iguais", () => {
    const expected = new Map<string, readonly string[]>([
      ["t", ["id", "organizationId", "createdAt", "novaColuna"]],
    ]);
    const actual = new Map<string, Set<string>>([
      ["t", new Set(["id", "organization_id", "created_at"])],
    ]);
    const d = diffSchema(expected, actual);
    expect(d.missingTables).toEqual([]);
    expect(d.absentColumns).toEqual([{ table: "t", columns: ["novaColuna"] }]);
    expect(d.mismatchColumns).toEqual([{
      table: "t",
      pairs: [
        { drizzle: "organizationId", db: "organization_id" },
        { drizzle: "createdAt", db: "created_at" },
      ],
    }]);
  });

  it("detecta tabela ausente", () => {
    const d = diffSchema(new Map([["x", ["id"]]]), new Map());
    expect(d.missingTables).toEqual(["x"]);
    expect(d.absentColumns).toEqual([]);
    expect(d.mismatchColumns).toEqual([]);
  });

  it("tabela totalmente alinhada não gera divergência", () => {
    const d = diffSchema(new Map([["t", ["id", "nome"]]]), new Map([["t", new Set(["id", "nome"])]]));
    expect(d).toEqual({ missingTables: [], absentColumns: [], mismatchColumns: [] });
  });
});
