# Centro de Operações do Departamento — Arquitetura

> **Business Domain 5 — FASE 5 — Production Ready Core**
> Objetivo: substituir a planilha de acompanhamento dos departamentos de licitações por um
> **Centro de Operações inteligente e integrado**.

## Definição

O `DepartmentOperationCenter` é a **camada operacional consolidadora** do LiciGov Pro.
Ele **acompanha, organiza, consolida e recomenda** — nunca cria licitações, contratações
diretas, contratos, pareceres, TRs ou editais. Esses artefatos nascem sempre nos seus
respectivos Business Domains; o Centro de Operações apenas os **observa por referência**.

### O que ele É
- Um consolidador operacional multi-tenant do departamento de licitações.
- A "planilha inteligente" que os departamentos hoje mantêm à mão, agora viva e integrada.
- Uma camada de acompanhamento, organização e recomendação.

### O que ele NÃO É (nunca implementar)
- **NÃO** é ERP municipal.
- **NÃO** é sistema financeiro, contábil, tributário, patrimonial, de folha, almoxarifado,
  pagamentos ou execução orçamentária.
- **NÃO** exibe indicadores financeiros.
- **NÃO** duplica dados dos Business Domains — consome tudo **por referência**.
- **NÃO** cria artefatos de licitação; apenas acompanha os que já existem.

## As cinco áreas

| Área | Nome | Papel |
|---|---|---|
| **1** | Centro de Operações (tela inicial) | Consolida automaticamente tudo em uma visão única + indicadores + recomendações |
| **2** | Painel de Acompanhamento | Substitui a planilha: 1 linha = 1 contratação, colunas = marcos operacionais |
| **3** | Calendário Operacional | Acompanha **eventos** (não workflow): sessões, reuniões, vencimentos, tarefas |
| **4** | Timeline Operacional | Histórico completo append-only (quem / quando / o quê) |
| **5** | Minha Caixa de Entrada | Pendências do usuário: tarefas, pareceres, contratos, solicitações, aprovações |

Cada área tem documentação própria nesta pasta.

## Consolidação sem duplicação

Princípio central: **nenhum dado dos Business Domains é copiado**. O Centro de Operações
mantém apenas **referências** (IDs de tenant + domínio + entidade) e resolve os dados sob
demanda através do **Kernel Access Service**.

```
Processo Licitatório ─┐
Contratação Direta   ─┤
Contratos / Aditivos ─┼──►  Kernel Access Service  ──►  DepartmentOperationCenter
Parecer Jurídico     ─┤        (leitura por referência)      (consolida + recomenda)
Institutional Request─┘
```

Consequência: quando um Business Domain muda um dado, o Centro de Operações reflete a mudança
imediatamente, sem sincronização manual e sem risco de divergência.

## Reuso do Kernel (sem reimplementar)

O domínio **reutiliza** serviços já existentes, nunca os duplica:

- **Kernel Access Service** — leitura por referência de todos os Business Domains.
- **Institutional Request Engine** — solicitações institucionais consolidadas na Área 1 e 5.
- **Timeline** — motor de histórico append-only usado pela Área 4.
- **Adaptive Recommendation Engine** — priorização, gargalos, riscos, sobrecarga e
  vencimentos (ver `recommendations.md`). O **servidor sempre decide**.
- **Business Domains existentes** — Processo Licitatório, Contratação Direta, Contratos,
  Parecer Jurídico.

## Conceitos introduzidos por este domínio

- **OperationRecord** — registro manual de itens que **não nasceram no LiciGov** (legados e
  externos). Ver `legacy-records.md`.
- **Marcos operacionais** — colunas do Painel de Acompanhamento, preenchidas automaticamente
  quando o dado existe e manualmente **apenas** para informação externa ao sistema.
- **Canais de publicação configuráveis** — cada município define os órgãos; apenas o PNCP é
  padrão. Ver `monitoring-panel.md`.

## Garantias transversais

- **Multi-tenant** — todo dado é isolado por tenant; nenhuma consulta cruza fronteiras.
- **Replay-safe** — todos os identificadores derivam de `sha256` determinístico, permitindo
  reprocessamento idempotente sem duplicar eventos, alertas ou recomendações.
- **Explainability** — toda recomendação carrega `reasoning`, `confidence`, `legalBasis`
  (quando aplicável), `impact` e alternativas.
- **Observabilidade** — cada consolidação, alerta e recomendação é rastreável na Timeline.

## Routers

| Router | Responsabilidade |
|---|---|
| `departmentOperationRouter` | Consolidação das 5 áreas, indicadores, calendário, timeline, caixa de entrada, relatórios |
| `operationRecordRouter` | CRUD de OperationRecord (legados e externos), cadastro rápido, importação assistida |

## Documentos gerados

- **Relatório Operacional** — DOCX / PDF
- **Relatório de Pendências** — DOCX / PDF
- **Relatório de Produtividade** — DOCX / PDF

Nenhum relatório contém indicadores financeiros.
