# Fluxo do Processo — 10 Etapas com Estados Próprios

> Cada etapa do Processo Licitatório tem **estados próprios**. Nenhuma é apenas
> um formulário. O sistema conduz o servidor; ele revisa e decide.

## 1. As 10 etapas

```
NEW_PROCESS → DFD (opcional) → ETP → PRICE_RESEARCH → ITEM_WORKSPACE
   → TR → NOTICE (Edital) → REVIEW → ISSUED → ARCHIVED
```

| # | Etapa | Papel |
|---|---|---|
| 1 | `NEW_PROCESS` | Wizard de início; pergunta como começar |
| 2 | `DFD` (opcional) | Estado do DFD (não obrigatório) |
| 3 | `ETP` | Rascunho automático revisado pelo servidor |
| 4 | `PRICE_RESEARCH` | Workspace vivo de pesquisa de preços |
| 5 | `ITEM_WORKSPACE` | Item Intelligence — o diferencial |
| 6 | `TR` | Termo de Referência construído das fontes |
| 7 | `NOTICE` | Edital: modalidade, forma e plataforma |
| 8 | `REVIEW` | Revisão consolidada humana |
| 9 | `ISSUED` | Processo emitido |
| 10 | `ARCHIVED` | Arquivamento com rastreabilidade preservada |

## 2. Wizard de Novo Processo (`NEW_PROCESS`)

Ao criar um processo, o sistema **pergunta como iniciar**:

1. **Criar DFD** — elaborar o Documento de Formalização da Demanda no sistema.
2. **Importar DFD/Ofício/Memorando/PDF** — trazer um documento existente.
3. **Iniciar direto pelo ETP** — quando não há DFD formal.

> O DFD **nunca** é obrigatório. O servidor escolhe o ponto de partida.

## 3. DFD é um estado, não um documento

O DFD tem estados próprios:

```
inexistente → importado → em_elaboracao → em_revisao → aprovado
```

- **Importado**: o sistema recebe PDF/DOCX, **interpreta**, **estrutura** o
  conteúdo e **pré-preenche os campos do ETP**.
- **Inexistente**: o fluxo salta a criação manual e começa no ETP.

## 4. Adaptive Process Engine

O **Adaptive Process Engine** adapta o fluxo ao contexto real do processo:

- **Sem DFD** → o fluxo **começa no ETP** (a etapa DFD é pulada).
- **DFD importado** → **pula a criação manual**; o DFD já entra estruturado e
  alimenta o ETP.
- **DFD em elaboração** → conduz o servidor pelos campos, sempre com sugestões.

O engine nunca força uma etapa que não faz sentido para o processo, e nunca
esconde uma etapa relevante. A adaptação é registrada na Timeline.

## 5. ETP — rascunho automático (`ETP`)

O ETP **nunca começa do zero**. O sistema gera um **primeiro rascunho
automaticamente** combinando:

- DFD (se existente/importado);
- documentos anexos ao processo;
- contexto do processo;
- memória institucional;
- Knowledge Graph;
- Institutional RAG (Lei 14.133/2021).

O servidor **revisa** o rascunho. Toda sugestão traz reasoning e explainability.

## 6. Encadeamento entre etapas

Cada etapa produz insumos para a seguinte:

- DFD → pré-preenche o ETP.
- ETP → orienta a Pesquisa de Preços e os Itens Inteligentes.
- Pesquisa de Preços → alimenta os `IntelligentProcurementItem`.
- Itens Inteligentes (aprovados) → alimentam o TR.
- TR aprovado → habilita a etapa de Edital.
- Edital → segue para REVIEW, ISSUED e ARCHIVED.

## 7. Diagrama de estados (visão consolidada)

```
        ┌───────────────┐
        │  NEW_PROCESS  │  pergunta como iniciar
        └───────┬───────┘
       (Adaptive Process Engine decide o caminho)
     ┌──────────┼─────────────┐
     ▼          ▼             ▼
 criar DFD  importar DFD   sem DFD
     │          │             │
     ▼          ▼             │
 ┌─────────────────┐          │
 │ DFD (estados)   │          │
 │ inexistente…    │          │
 │ …aprovado       │          │
 └────────┬────────┘          │
          └──────────┬────────┘
                     ▼
                 ┌───────┐
                 │  ETP  │  rascunho automático → revisão
                 └───┬───┘
                     ▼
             ┌───────────────┐
             │ PRICE_RESEARCH│  workspace vivo
             └───────┬───────┘
                     ▼
             ┌───────────────┐
             │ ITEM_WORKSPACE│  aprovação item a item
             └───────┬───────┘
                     ▼
                 ┌──────┐   ┌────────┐   ┌────────┐
                 │  TR  │──▶│ NOTICE │──▶│ REVIEW │
                 └──────┘   └────────┘   └───┬────┘
                                            ▼
                                     ┌────────┐  ┌──────────┐
                                     │ ISSUED │─▶│ ARCHIVED │
                                     └────────┘  └──────────┘
```

## 8. Regras do fluxo

- Nenhum documento é gerado fora deste fluxo.
- Nenhuma etapa substitui a decisão humana.
- Toda transição de etapa é registrada na Timeline append-only.
