/**
 * Homologação visual M8 (P1) — "ETP · v1 · gerado" aparecia sob "Documentos oficiais (versões emitidas)".
 * Com a política de emissão, a lista principal mostra SÓ versões emitidas do tipo do contexto; snapshots técnicos
 * ("gerado") ficam à parte, recolhidos e rotulados como não oficiais. Dados/versões/hashes inalterados (só apresentação).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const st = vi.hoisted(() => ({ docs: [] as unknown[] }));
const mutation = vi.hoisted(() => () => ({ mutate: () => {}, isPending: false, variables: undefined }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    documentEngine: {
      list: { useQuery: () => ({ data: { documents: st.docs }, isLoading: false }) },
      exportInstitutional: { useMutation: mutation },
      preview: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
(globalThis as { React?: typeof React }).React = React;
import OfficialDocumentPanel from "@/components/documents/OfficialDocumentPanel";

const doc = (o: Record<string, unknown>) => ({ id: String(o.id), title: `Doc ${o.id}`, documentType: "etp", version: 1, status: "gerado", ...o });
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(OfficialDocumentPanel as never, { businessDomain: "processo_licitatorio", origin: "p1", ...props }));
const mainList = (html: string) => html.split('data-testid="technical-snapshots"')[0];

describe("OfficialDocumentPanel — emitidas × snapshots técnicos (homologação visual M8)", () => {
  beforeEach(() => { st.docs = []; });

  it("ETP só com snapshot 'gerado': lista principal vazia ('Nenhuma versão emitida'); snapshot à parte, rotulado não oficial", () => {
    st.docs = [doc({ id: "e1" }), doc({ id: "t1", documentType: "tr", status: "emitido" })];
    const html = render({ title: "Documentos oficiais (versões emitidas)", requireStatusForExport: "emitido", documentType: "etp" });
    expect(mainList(html)).toContain("Nenhuma versão emitida ainda.");
    expect(mainList(html)).not.toContain("Doc e1");
    expect(html).toContain("Versões técnicas (snapshots gerados na elaboração — não são versões oficiais emitidas) — 1");
    expect(html).toContain("snapshot técnico (não emitido)");
    expect(html).not.toContain("Doc t1"); // o TR não aparece na seção do ETP
  });

  it("versão emitida aparece na lista principal com exportação; snapshot continua separado", () => {
    st.docs = [doc({ id: "e1" }), doc({ id: "e2", version: 2, status: "emitido" })];
    const html = render({ requireStatusForExport: "emitido", documentType: "etp" });
    expect(mainList(html)).toContain("Doc e2");
    expect(mainList(html)).toContain(">DOCX<");
    expect(mainList(html)).not.toContain("Doc e1");
  });

  it("sem política de emissão (outros domínios): comportamento anterior — todos listados, status bruto", () => {
    st.docs = [doc({ id: "x1", documentType: "contrato" })];
    const html = render({ businessDomain: "contratos" });
    expect(html).toContain("Doc x1");
    expect(html).toContain("· gerado");
    expect(html).not.toContain("technical-snapshots");
  });
});
