# TR Inteligente — Termo de Referência Construído das Fontes

> O Termo de Referência **não é escrito do zero**. É **construído
> automaticamente** a partir de todas as fontes do processo. O servidor
> **revisa**; nunca redige do nada.

## 1. Filosofia aplicada ao TR

Coerente com a filosofia do domínio — **conduzir, não gerar** — o TR é
**consequência** de todo o planejamento anterior. Quando o servidor chega à
etapa `TR`, o processo já acumulou contexto suficiente para o sistema propor um
documento estruturado e fundamentado.

## 2. Fontes que alimentam o TR

O TR Inteligente é montado combinando:

- **DFD** (quando existente/importado);
- **ETP** (rascunho revisado e aprovado);
- **Pesquisa de Preços** (`PriceResearchWorkspace`);
- **Itens Inteligentes** aprovados (`IntelligentProcurementItem`);
- **CATMAT/CATSER** escolhidos pelo servidor;
- **Histórico** do município e compras semelhantes;
- **Copilotos** e memória institucional.

```
DFD + ETP + Pesquisa de Preços + Itens Inteligentes
   + CATMAT + Histórico + Copilotos
                │
                ▼
        kernelAccessService
     (RAG Lei 14.133/2021 + KG + llm.ts)
                │
                ▼
        TR Inteligente (rascunho)
                │
                ▼
        Servidor revisa e aprova
```

## 3. Somente itens aprovados entram no TR

O TR só considera os `IntelligentProcurementItem` com `status` aprovado e
`approvedBy` preenchido. A aprovação individual dos itens (Item Intelligence
Workspace) é **pré-requisito** para a construção do TR. Isso garante que cada
item do TR já foi revisado, com CATMAT escolhido e especificações validadas.

## 4. Participação multi-copiloto

A construção do TR é coordenada pelo **Multi-Copilot Orchestrator**, com
participação automática de:

- **Copiloto de Planejamento** — coerência do objeto e do escopo;
- **Copiloto de TR Intelligence** — estrutura e cláusulas do TR;
- **Copiloto de Pesquisa de Preços** — consistência de valores e quantidades;
- **Copiloto Jurídico** — aderência à Lei 14.133/2021;
- **Agente de Contratação** — visão integrada do processo.

Cada contribuição carrega **reasoning, explainability, provenance e
confidence**, exibidos ao servidor durante a revisão.

## 5. Revisão humana obrigatória

O rascunho do TR é **editável, revisável e validado por humano**:

- o servidor lê cada seção com as justificativas associadas;
- pode aceitar, ajustar ou rejeitar trechos e cláusulas;
- alertas dos copilotos aparecem inline, **sem bloquear**;
- a aprovação do TR é registrada e habilita a etapa de **Edital**.

> O sistema nunca finaliza o TR sozinho. Nunca oculta a fundamentação de uma
> cláusula. Nunca substitui a decisão do servidor.

## 6. Estrutura jurídica

O TR segue o **art. 6º, XXIII** da Lei 14.133/2021. O conteúdo é fundamentado
com apoio do **Institutional RAG** sobre a Lei 14.133/2021, sempre acessado
**via `kernelAccessService`** e gerado pelo pipeline oficial
`server/_core/llm.ts` (Gemini 2.5 Flash). Toda saída inclui o aviso de revisão
obrigatória.

## 7. Do TR ao Edital

Com o TR aprovado, o processo avança para a etapa `NOTICE` (Edital), onde se
escolhe a **modalidade**, a **forma** (Eletrônico/Presencial) e, quando
aplicável, a **plataforma**. O TR aprovado é a base normativa e técnica do
Edital.

## 8. Rastreabilidade

Cada versão, revisão, contribuição de copiloto e aprovação do TR é registrada na
**Timeline append-only**, preservando a linha do tempo completa do documento
para auditoria.
