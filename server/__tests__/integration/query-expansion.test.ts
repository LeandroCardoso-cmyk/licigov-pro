/**
 * Retrieval — expansão de siglas/vocabulário de licitações (busca lexical).
 * O usuário pergunta pela sigla; as normas usam a forma por extenso. A expansão faz os trechos casarem.
 */

import { describe, it, expect } from "vitest";
import { expandQueryTerms } from "../../services/institutionalIntegration/knowledgeRetrievalService";

describe("Retrieval — expansão de siglas/vocabulário", () => {
  it("expande os documentos do fluxo (DFD/ETP/TR/PB)", () => {
    expect(expandQueryTerms("Quando o DFD é obrigatório?")).toEqual(expect.arrayContaining(["documento", "formalizacao", "demanda"]));
    expect(expandQueryTerms("Como elaborar o TR?")).toEqual(expect.arrayContaining(["termo", "referencia"]));
    expect(expandQueryTerms("O que vai no ETP?")).toEqual(expect.arrayContaining(["estudo", "tecnico", "preliminar"]));
    expect(expandQueryTerms("Preciso de projeto básico (PB)?")).toEqual(expect.arrayContaining(["projeto", "basico"]));
  });

  it("expande registro de preços e órgãos/normas (SRP/TCU/PNCP/IN)", () => {
    expect(expandQueryTerms("Como funciona o SRP?")).toEqual(expect.arrayContaining(["sistema", "registro", "precos"]));
    expect(expandQueryTerms("O que diz o TCU?")).toEqual(expect.arrayContaining(["tribunal", "contas", "uniao"]));
    expect(expandQueryTerms("consultar o PNCP")).toEqual(expect.arrayContaining(["portal", "nacional", "contratacoes"]));
    expect(expandQueryTerms("a IN 65 exige o quê?")).toEqual(expect.arrayContaining(["instrucao", "normativa"]));
  });

  it("expande variantes morfológicas", () => {
    expect(expandQueryTerms("é obrigatório?")).toEqual(expect.arrayContaining(["obrigatoriedade"]));
    expect(expandQueryTerms("cabe dispensa?")).toEqual(expect.arrayContaining(["dispensavel"]));
    expect(expandQueryTerms("prorrogação do contrato")).toEqual(expect.arrayContaining(["prorrogar"]));
  });

  it("NÃO expande palavras comuns ambíguas — evita ruído ('me', 'ir', 'art')", () => {
    const t1 = expandQueryTerms("você pode me explicar como ir ao pregão?");
    expect(t1).not.toContain("microempresa"); // 'me' (pronome) não é sigla
    const t2 = expandQueryTerms("o que diz o art 5?");
    expect(t2).not.toContain("anotacao"); // 'art' = artigo, não ART
    // mas 'pregao' (palavra completa) expande normalmente
    expect(t1).toContain("pregoeiro");
  });

  it("consulta sem sigla conhecida permanece só com os termos tokenizados", () => {
    expect(expandQueryTerms("usar concorrência").sort()).toEqual(["concorrencia", "usar"].sort());
  });

  it("RAG-QUALITY-001 — descarta pronomes interrogativos ('quando'), que não carregam conteúdo jurídico", () => {
    // Sem normalização de comprimento, termos interrogativos favoreciam blocos grandes/genéricos que
    // os contêm incidentalmente — generaliza para qualquer pergunta, não só o caso de teste do RAG-QUALITY-001.
    expect(expandQueryTerms("quando usar concorrência")).not.toContain("quando");
    expect(expandQueryTerms("quando usar concorrência").sort()).toEqual(["concorrencia", "usar"].sort());
  });
});
