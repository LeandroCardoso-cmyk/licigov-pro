/**
 * Sprint 2.5 — Document Diff Engine types.
 *
 * Modelo oficial de comparação entre versões documentais:
 * semântico, orientado a blocos, auditável e export-ready.
 */
import type { DocumentBlock, DocumentSection, DocumentVariable, StructuredDocumentContent } from "./documentTypes";

// ─── Change types ─────────────────────────────────────────────────────────────

export type DiffChangeType = "added" | "removed" | "modified" | "unchanged";

// ─── Granular diff units ──────────────────────────────────────────────────────

export interface BlockDiff {
  blockId:       string;
  changeType:    DiffChangeType;
  before?:       DocumentBlock;
  after?:        DocumentBlock;
  changedFields?: string[];
}

export interface SectionDiff {
  sectionId:  string;
  changeType: DiffChangeType;
  before?:    DocumentSection;
  after?:     DocumentSection;
  blockDiffs: BlockDiff[];
}

export interface VariableDiff {
  key:        string;
  changeType: DiffChangeType;
  before?:    string;
  after?:     string;
}

export interface MetadataDiff {
  field:      string;
  changeType: DiffChangeType;
  before?:    unknown;
  after?:     unknown;
}

export interface TextDiff {
  changeType:    DiffChangeType;
  beforeLength?: number;
  afterLength?:  number;
  hasChanges:    boolean;
  addedChars?:   number;
  removedChars?: number;
}

// ─── Composite diff ───────────────────────────────────────────────────────────

export interface DocumentDiff {
  fromVersionNumber:   number;
  toVersionNumber:     number;
  documentId:          number;
  organizationId:      number;
  computedAt:          string; // ISO timestamp
  textDiff:            TextDiff;
  structuredDiff: {
    hasSectionChanges:   boolean;
    sectionDiffs:        SectionDiff[];
    variableDiffs:       VariableDiff[];
    metadataDiffs:       MetadataDiff[];
    totalChangedBlocks:  number;
    totalChangedSections: number;
  };
  summary: {
    totalChanges:        number;
    hasTextChange:       boolean;
    hasStructuredChange: boolean;
    changeTypes:         DiffChangeType[];
    severity:            "none" | "minor" | "moderate" | "major";
  };
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

export function diffBlocks(
  beforeBlocks: DocumentBlock[] = [],
  afterBlocks:  DocumentBlock[] = [],
): BlockDiff[] {
  const diffs: BlockDiff[] = [];
  const beforeMap = new Map(beforeBlocks.map(b => [b.id, b]));
  const afterMap  = new Map(afterBlocks.map(b => [b.id, b]));

  for (const [id, block] of beforeMap) {
    if (!afterMap.has(id)) {
      diffs.push({ blockId: id, changeType: "removed", before: block });
    }
  }

  for (const [id, block] of afterMap) {
    const before = beforeMap.get(id);
    if (!before) {
      diffs.push({ blockId: id, changeType: "added", after: block });
    } else {
      const changedFields: string[] = [];
      if (before.type    !== block.type)    changedFields.push("type");
      if (before.content !== block.content) changedFields.push("content");
      if (before.order   !== block.order)   changedFields.push("order");
      if (changedFields.length > 0) {
        diffs.push({ blockId: id, changeType: "modified", before, after: block, changedFields });
      }
    }
  }

  return diffs;
}

export function diffSections(
  beforeSections: DocumentSection[] = [],
  afterSections:  DocumentSection[] = [],
): SectionDiff[] {
  const diffs: SectionDiff[] = [];
  const beforeMap = new Map(beforeSections.map(s => [s.id, s]));
  const afterMap  = new Map(afterSections.map(s => [s.id, s]));

  for (const [id, sec] of beforeMap) {
    if (!afterMap.has(id)) {
      diffs.push({ sectionId: id, changeType: "removed", before: sec, blockDiffs: [] });
    }
  }

  for (const [id, sec] of afterMap) {
    const before = beforeMap.get(id);
    if (!before) {
      diffs.push({ sectionId: id, changeType: "added", after: sec, blockDiffs: [] });
    } else {
      const blockDiffs  = diffBlocks(before.blocks, sec.blocks);
      const hasChanges  =
        before.title !== sec.title ||
        before.order !== sec.order ||
        blockDiffs.some(d => d.changeType !== "unchanged");
      diffs.push({
        sectionId:  id,
        changeType: hasChanges ? "modified" : "unchanged",
        before,
        after:      sec,
        blockDiffs,
      });
    }
  }

  return diffs;
}

export function diffVariables(
  beforeVars: DocumentVariable[] = [],
  afterVars:  DocumentVariable[] = [],
): VariableDiff[] {
  const diffs: VariableDiff[] = [];
  const beforeMap = new Map(beforeVars.map(v => [v.key, v.value ?? ""]));
  const afterMap  = new Map(afterVars.map(v => [v.key, v.value ?? ""]));

  for (const [key, val] of beforeMap) {
    if (!afterMap.has(key)) {
      diffs.push({ key, changeType: "removed", before: val });
    } else if (afterMap.get(key) !== val) {
      diffs.push({ key, changeType: "modified", before: val, after: afterMap.get(key) });
    }
  }

  for (const [key, val] of afterMap) {
    if (!beforeMap.has(key)) {
      diffs.push({ key, changeType: "added", after: val });
    }
  }

  return diffs;
}

export function diffMetadata(
  before: Record<string, unknown> | null | undefined,
  after:  Record<string, unknown> | null | undefined,
): MetadataDiff[] {
  const diffs: MetadataDiff[] = [];
  const bm = before ?? {};
  const am = after  ?? {};
  const keys = new Set([...Object.keys(bm), ...Object.keys(am)]);

  for (const key of keys) {
    if (JSON.stringify(bm[key]) !== JSON.stringify(am[key])) {
      diffs.push({
        field:      key,
        changeType: !(key in bm) ? "added" : !(key in am) ? "removed" : "modified",
        before:     bm[key],
        after:      am[key],
      });
    }
  }

  return diffs;
}

// ─── Main compute function ────────────────────────────────────────────────────

export function computeDiff(
  documentId:        number,
  organizationId:    number,
  fromVersionNumber: number,
  toVersionNumber:   number,
  beforeContent:     string | null,
  afterContent:      string | null,
  beforeStructured:  StructuredDocumentContent | null,
  afterStructured:   StructuredDocumentContent | null,
): DocumentDiff {
  // Text diff
  const beforeLen = beforeContent?.length ?? 0;
  const afterLen  = afterContent?.length  ?? 0;
  const hasTextChange = beforeContent !== afterContent;
  const textDiff: TextDiff = {
    changeType:    !hasTextChange ? "unchanged" : beforeContent === null ? "added" : afterContent === null ? "removed" : "modified",
    beforeLength:  beforeLen,
    afterLength:   afterLen,
    hasChanges:    hasTextChange,
    addedChars:    afterLen > beforeLen  ? afterLen  - beforeLen : 0,
    removedChars:  beforeLen > afterLen  ? beforeLen - afterLen  : 0,
  };

  // Structured diff
  const sectionDiffs   = diffSections(beforeStructured?.sections ?? [], afterStructured?.sections ?? []);
  const variableDiffs  = diffVariables(beforeStructured?.variables ?? [], afterStructured?.variables ?? []);
  const metadataDiffs  = diffMetadata(
    beforeStructured?.metadata as Record<string, unknown> | null,
    afterStructured?.metadata  as Record<string, unknown> | null,
  );

  const totalChangedBlocks   = sectionDiffs.reduce(
    (sum, s) => sum + s.blockDiffs.filter(b => b.changeType !== "unchanged").length, 0,
  );
  const totalChangedSections = sectionDiffs.filter(s => s.changeType !== "unchanged").length;
  const hasStructuredChange  = totalChangedSections > 0 || variableDiffs.length > 0 || metadataDiffs.length > 0;

  const totalChanges =
    (hasTextChange ? 1 : 0) +
    totalChangedSections +
    variableDiffs.length +
    metadataDiffs.length;

  const changeTypes = Array.from(new Set([
    ...sectionDiffs.map(s => s.changeType),
    ...variableDiffs.map(v => v.changeType),
    ...metadataDiffs.map(m => m.changeType),
    ...(hasTextChange ? [textDiff.changeType] : []),
  ])).filter(t => t !== "unchanged") as DiffChangeType[];

  const severity: "none" | "minor" | "moderate" | "major" =
    totalChanges === 0   ? "none"     :
    totalChanges <= 3    ? "minor"    :
    totalChanges <= 10   ? "moderate" : "major";

  return {
    fromVersionNumber,
    toVersionNumber,
    documentId,
    organizationId,
    computedAt: new Date().toISOString(),
    textDiff,
    structuredDiff: {
      hasSectionChanges: totalChangedSections > 0,
      sectionDiffs,
      variableDiffs,
      metadataDiffs,
      totalChangedBlocks,
      totalChangedSections,
    },
    summary: {
      totalChanges,
      hasTextChange,
      hasStructuredChange,
      changeTypes,
      severity,
    },
  };
}
