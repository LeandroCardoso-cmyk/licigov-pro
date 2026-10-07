/**
 * INVENTÁRIO DA FONTE derivado de um PACOTE DE MODELO (mapeamento governado + catálogo v2) — domínio puro e determinístico.
 *
 * O inventário nunca é "provado" por si só: a matriz de prontidão o CONFRONTA com o AST real e com as capacidades. Aqui ele é
 * derivado do mapeamento aprovado (dado versionado no repositório), sem entrada do cliente: mesma entrada ⇒ mesmo inventário
 * ⇒ mesmo SHA-256 (registrado na procedência).
 */
import { conditionVariables } from "../conditionalDsl2";
import type { MasterMapping } from "../masterCompiler";
import { findVariable2, type VariableCatalog2 } from "../variableCatalog2";
import { ANY_SECTION, type InputDisposition, type InventoryInput, type InventorySource, type SourceInventory } from "./sourceInventory";

export function buildSourceInventory(pkg: {
  readonly mapping: MasterMapping; readonly catalog: VariableCatalog2; readonly sourceLogicalVersion: string; readonly sourceSha256: string;
}): SourceInventory {
  const { mapping, catalog } = pkg;
  const sourceOf = (name: string): InventorySource | undefined => findVariable2(catalog, name)?.source as InventorySource | undefined;
  const inputs: InventoryInput[] = Object.keys(mapping.inputs).sort().map((key): InventoryInput => {
    const d = mapping.inputs[key];
    switch (d.kind) {
      case "variable": return { key, disposition: "VARIABLE", variable: d.var, ...(sourceOf(d.var) ? { source: sourceOf(d.var) } : {}) };
      case "control": return { key, disposition: "CONTROL_ONLY", variable: d.var, ...(sourceOf(d.var) ? { source: sourceOf(d.var) } : {}) };
      case "aiSlot": return { key, disposition: "AI_SLOT", variable: d.slotKey };
      case "dataTable": {
        const src = sourceOf(d.source);
        const disposition: InputDisposition = src === "ITEMS" ? "ITEMS_TABLE" : "DATA_TABLE";
        return { key, disposition, variable: d.source, ...(src ? { source: src } : {}) };
      }
      case "docRef": return { key, disposition: "DOC_REF", variable: d.role, source: d.docKind === "TR" ? "TR" : undefined } as InventoryInput;
    }
  });
  const conditionTypes = Object.keys(mapping.conditions).sort().flatMap((key) =>
    [...new Set(conditionVariables(mapping.conditions[key].when))].sort().map((variable) => ({ key, variable })));
  const annexes = [...mapping.annexes].sort((a, b) => a.order - b.order).map((a) => ({ sourceId: a.id, annexId: a.id }));
  const annexIds = new Set(annexes.map((a) => a.annexId));
  const refs = new Map<string, { fromSection: string; to: { kind: "SECTION" | "ANNEX"; id: string } }>();
  for (const x of mapping.crossReferences) {
    for (const t of x.targets) {
      const to = { kind: annexIds.has(t) ? ("ANNEX" as const) : ("SECTION" as const), id: t };
      refs.set(`${to.kind}:${t}`, { fromSection: ANY_SECTION, to });
    }
  }
  const guards = (mapping.guards ?? []).flatMap((g) => {
    const d = mapping.inputs[g.placeholder];
    return d && (d.kind === "variable" || d.kind === "control") ? [{ variable: d.var }] : [];
  });
  const aiSlots = inputs.filter((i) => i.disposition === "AI_SLOT").map((i) => ({ slotKey: i.variable }));
  return {
    schema: "tpl-source-inventory/1", sourceLogicalVersion: pkg.sourceLogicalVersion, sourceSha256: pkg.sourceSha256,
    declared: {
      inputsTotal: inputs.length, controlOnlyInputs: inputs.filter((i) => i.disposition === "CONTROL_ONLY").length,
      conditionTypes: new Set(conditionTypes.map((c) => c.key)).size,
    },
    inputs, conditionTypes, annexes, crossReferences: [...refs.values()].sort((a, b) => (a.to.id < b.to.id ? -1 : 1)), aiSlots, guards,
  };
}
