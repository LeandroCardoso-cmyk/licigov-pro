# PROMPT08_HOMOLOG_RC_FIXES_HANDOFF — correção integrada dos achados da homologação RC

> PROMPT 08 · 27/11/2026 · integrador único · base `staging` `c536ee1` · `main` `559ab3e` (inalterada).
> Não autoriza lançamento comercial, merge em `main` nem produção. Nenhuma migration nova.

## 1. Achados e causas-raiz
| ID | Sintoma | Causa-raiz |
|---|---|---|
| D-2 | Aditivo do Contract Workspace já nascia `finalizado`, mudava o status do contrato e reagendava vencimento/alertas | `createAddendumInstrument` avançava o instrumento e o contrato na criação; não existia comando de formalização |
| D-5 | "R$ 0,00" como valor estimado quando nenhum item tinha preço | `computeItemEstimates` tratava ausência como zero; quadro, prompts e prosa imprimiam `formatBRL(0)` |
| D-1 | Criar tarefa do departamento → 500; sem botão "Nova Tarefa" funcional; exportações quebradas | prazo string em coluna `timestamp(mode: date)` (TypeError do Drizzle); UI sem criação; botões apontando para procedures inexistentes |
| D-3 | Anexo de tarefa com URL pública do S3; exclusão deixava objeto órfão | `fileUrl` gravava URL pública; exclusão removia só a linha |

## 2. Correções
- **D-2** — criação registra **minuta** (ou `aguardando_parecer`) sem efeito no contrato; o novo término fica no termo como PROPOSTA.
  Novo comando `contractWorkspace.formalizeAddendum` (manager, membership real, idempotente, CAS, transação única): exige termo
  gerado, data de assinatura não futura (Brasília) e referência; aditivo de valor/quantitativo exige parecer jurídico **governado**,
  do mesmo contrato, **solicitado após a minuta**, com conclusão **favorável ou com ressalvas** (allow-list; registrada no evento)
  e **não vinculado a outro aditivo**. Efeitos aplicados uma vez;
  vencimento reagendado só na formalização. Sufixo "término da vigência em" reservado ao campo estruturado.
  Registro legado (`contracts.amendments.create`) exige data de assinatura não futura, comparada por data em Brasília, depois do
  isolamento por organização.
- **D-5** — regra única `shared/estimateLabel.ts` (`globalEstimateText`, textos M8) usada por UI, contextos de IA, quadro
  autoritativo e prosa do servidor (portanto DOCX/PDF); zero só é valor quando efetivamente informado.
- **D-1** — `parseTaskDeadline` (data local de Brasília), validação de responsável/processo no tenant, `CreateTaskDialog`
  (operator+), exportações apontando para `tasks.*`.
- **D-3** — chave S3 privada; download por URL assinada de 300 s após autorização; exclusão remove o objeto antes da linha
  (falha ⇒ nada removido, atividade registrada); exclusão de tarefa remove objetos dos anexos.

## 3. Evidências locais
Typecheck e lint dos alterados PASS; smokes MySQL afetados PASS; teste unitário do portão de parecer; suíte completa
(`pnpm test`, modo CI) 499 arquivos / 9.053 testes PASS. Auditoria independente: sem P0; P1 (portão de parecer; fuso do aditivo legado) corrigidos neste PR.

## 4. Aditivo sintético `14093ee293c37665e925` (homologação, org 2)
Não alterado nem excluído. Recomendação: manter como registro histórico do comportamento anterior à correção (auto-finalizado na
criação), anotado no dossiê de homologação; nenhuma correção retroativa. Rehomologar D-2 com um aditivo novo.

## 5. Backlog (P2)
Vínculo do parecer ao aditivo por `referenceDocumentId` (hoje: tempo + não reutilização; corrida entre duas formalizações simultâneas com o mesmo parecer); término pode recuar em relação à vigência atual (validar na formalização); id do parecer digitado à mão (seletor); exclusão de
tarefa não atômica entre S3 e banco; corrida upload/exclusão; versionamento do bucket (delete marker).
