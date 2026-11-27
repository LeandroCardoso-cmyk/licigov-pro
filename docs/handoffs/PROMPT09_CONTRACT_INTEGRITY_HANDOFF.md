# PROMPT09_CONTRACT_INTEGRITY_HANDOFF — integridade contratual pré-piloto

> PROMPT 09 · 27/11/2026 · integrador único · base `staging` `8e995e0` · `main` `559ab3e` (inalterada). Sem migration.
> Não autoriza GO comercial, homologação humana nem piloto real.

## Riscos residuais do PROMPT 08 — confirmados × descartados
| Frente | Risco | Situação | Correção |
|---|---|---|---|
| A | Parecer validado só por contrato/data/conclusão | CONFIRMADO | Solicitação vinculada ao aditivo (`referenceDocumentId`) e à versão vigente do termo (referência documental única, fixada pelo servidor); formalização recusa parecer sem vínculo (`NOT_BOUND`), de outra versão (`STALE_TERM`), desfavorável/fora da allow-list; com ressalvas exige o registro do atendimento (declaração de quem formaliza); seleção de pareceres elegíveis na UI |
| A | Reutilização concorrente do parecer | CONFIRMADO (teórico) | Estruturalmente impossível (vínculo 1 parecer ↔ 1 aditivo) + checagem sob o lock do contrato |
| A | Reaproveitar correlationId reabria/estendia solicitação respondida (auditoria) | CONFIRMADO | `REQUEST_ALREADY_REGISTERED`; id da solicitação inclui o documento examinado |
| B1 | Aditivo finalizado com vencimento inconsistente após falha | CONFIRMADO | Vencimento/alertas/timeline na MESMA transação (executor opcional em `rescheduleExpiration`) |
| B2 | Replay de aditivo antigo restaurando vigência | CONFIRMADO | Retomada não reaplica efeitos |
| B3 | Corrida entre dois aditivos | CONFIRMADO (reagendamento fora da tx) | Serializado pelo lock do contrato; o 2º vê o vencimento do 1º |
| B4 | Efeito sem evidência | DESCARTADO/REFORÇADO | Evento fixa termo id+versão, parecer+conclusão, declaração de ressalvas, término anterior→novo |
| B5 | Novo término anterior ao vigente | CONFIRMADO | Redução só com confirmação explícita; término anterior à assinatura recusado; prorrogação sem exigência extra |
| B6 | Termo formalizado × versão gerada | CONFIRMADO | Termo congelado após formalização (reconferido antes da gravação); versão relida sob lock |
| C | Falha intermitente de 8 aditivos concorrentes | CAUSA COMPROVADA | Gap lock (REPEATABLE READ) em `official_documents.idx_odoc_tenant` entre 1ªs versões de linhagens distintas ⇒ deadlock; transação própria do `createDocument` em READ COMMITTED (correção preservada por GET_LOCK + leitura com lock + PK determinística). Medição: 2 deadlocks/5 rodadas → 0 |
| D | Upload × exclusão de tarefa | CONFIRMADO | Insert do anexo e exclusão sob `FOR UPDATE` da tarefa; exclusão única para `departmentTasks.delete` e `task.delete` trata anexos tardios |
| D | Órfão silencioso | CONFIRMADO | Inventário durável `task.attachment_storage_orphan` (activity_log) |
| D | Colisão de chave / objeto indisponível | CONFIRMADO | Sufixo aleatório; download distingue ausente (NOT_FOUND claro) de erro indeterminado |
| D | Exclusão cross-tenant | DESCARTADO | Chave sempre do servidor, limitada ao prefixo da própria tarefa |
| D | Delete marker / versões retidas | ESPERADO | Sem purge (política do bucket) |

## Riscos residuais (P2, fundamentados)
- `operational_events` sem índice por referência: o `FOR UPDATE` do reagendamento trava eventos do tenant durante a formalização (contenção, sem ciclo de locks encontrado). Índice `(organization_id, reference_type, reference_id, event_type)` exige migration — fora desta entrega.
- Aditivo formalizado pelo código anterior (somente sintéticos, janela de ~1 dia) cujo reagendamento tenha falhado não é reparado pela retomada.
- Aditivos em `aguardando_parecer` com parecer do contrato (sem vínculo) precisam de nova solicitação vinculada.
- Exclusão de tarefa: S3 antes do banco; falha da transação deixa registro sem objeto (download informa; nova tentativa conclui).
- Aditivo sintético `14093ee293c37665e925`: não alterado (manter como histórico pré-correção).
