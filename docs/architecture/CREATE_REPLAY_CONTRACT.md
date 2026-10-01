# Contrato permanente de replay de criação (R3.5)

> Programa: Remediação de Autoridade Semântica — fase R3 (Create ≠ Reset), checkpoint R3.5.
> Estado: **IMPLEMENTED_PENDING_REVIEW** na branch de integração `work/autonomous-semantic-remediation-r3-r11`.
> Fontes normativas no código: `server/domain/processCreateContract.ts` (PR-05), `server/domain/legalOpinionDraft.ts`
> e `server/domain/contractCreation.ts` (PR-06).

## 1. Problema

Uma criação (`createProcess`, `createDraft`, `createFromProcurement`/`createFromDirect`/`createManual`/importação) pode
ser reenviada: duplo clique, retry de rede, reenvio pelo navegador depois de minutos. Até a R3, os criadores eram
**upsert** por id determinístico: o reenvio — ou qualquer criação com o mesmo número — **resetava** estado institucional
(SEM-002, SEM-003, SEM-006, SEM-007). A R3 trocou tudo por INSERT puro + decisão pós-colisão. A pergunta da R3.5 é
o que acontece com o replay **tardio**: o request original chega de novo depois que o registro evoluiu.

## 2. Decisão técnica

Avaliadas as quatro alternativas pedidas:

| Alternativa | Avaliação |
|---|---|
| **Comparar com o estado persistido atual** (escolhida) | Já implementada (PR-05/PR-06). Determinística, sem migration, sem dado novo. Converge enquanto os campos do *payload semântico de criação* não mudaram; depois disso, CONFLICT com zero escrita. |
| Fingerprint de criação persistido | Exigiria coluna nova nos quatro domínios só para transformar um CONFLICT seguro em convergência. O fingerprint não é identidade (INV-10) e não acrescenta autoridade; o cliente continua precisando reler o registro. Rejeitada: custo estrutural sem ganho institucional. |
| Snapshot de origem / fatos imutáveis de criação | Usado **onde já existe**: o fato `demand.requestingUnit` com `sourceVersion = create` (PR-05) é comparado como fato de criação, não como estado atual. Não foram criados fatos novos. |
| Outro mecanismo governado | Para criações que já recebem **chave de idempotência** do cliente (`contractWorkspace.createManual`, importações governadas), a convergência é pela chave + hash do pedido (`idempotency_keys`): mesma chave + payload diferente ⇒ CONFLICT (INV-11). |

**Contrato permanente (todos os domínios):**

1. Chave natural inexistente ⇒ cria (INSERT puro, numa transação local com o evento inicial).
2. Chave existente + mesmo ator + payload semântico **idêntico ao persistido** (e, nos domínios com estado inicial
   exigido, o registro ainda no estado que a criação produz) ⇒ **converge**: devolve o registro persistido, zero escrita.
3. Qualquer outra situação — inclusive o replay do request original **depois** de uma mudança legítima de um campo do
   payload — ⇒ **CONFLICT** com token estável, zero escrita no registro e nos filhos.
4. O replay **nunca** é caminho de leitura nem de atualização: o cliente que recebe CONFLICT relê pelo endpoint de
   leitura canônico (`loadProcess`, `getWorkspace`, `getContract`…).

O resultado 3 é fail-closed por construção: sem intenção de criação persistida, um replay tardio é indistinguível de uma
criação conflitante, e a única resposta segura é recusar sem tocar em nada.

## 3. Matriz por domínio

| Domínio | Chave natural | Payload semântico comparado | Estado exigido para convergir | Replay tardio após mudança fora do payload | Replay tardio após mudança de campo do payload |
|---|---|---|---|---|---|
| Processo Licitatório | (órgão, número exato) — PK `plp:` | ator, objeto, início, modalidade (ausente ≡ ""), fato de criação `requestingUnit` | qualquer | converge (P2) | CONFLICT (P9) |
| Contratação Direta | (órgão, número exato) — PK `dpw:` | ator, objeto, tipo, início, fundamento (ausente ≡ "") | qualquer | converge (D2) | CONFLICT (D7) |
| Parecer (workspace canônico) | um parecer vigente por workspace/solicitação | ator, tipo, relatório, fundamentação, conclusão, listas | rascunho v1 não assinado | — (qualquer edição gera v2) | CONFLICT (L3); assinado ⇒ `LEGAL_OPINION_ALREADY_SIGNED` (L1) |
| Contrato (workspace canônico) | (órgão, número normalizado), qualquer origem — UNIQUE 0310 | ator, origem, processo de origem, número, contratado, objeto, valor, prazo, gestor, fiscal | `minuta` | CONFLICT depois de sair de `minuta` (C12) | CONFLICT (C4) |

Testes (MySQL 8 real): `create-not-reset-processes-mysql-smoke` (P1–P9, D1–D7) e
`create-not-reset-legal-contract-mysql-smoke` (L1–L8, C1–C13).

## 4. Relação com o Pilot Reset

Depois de um reset governado (B2/B3, `docs/architecture/PILOT_RESET_GOVERNED_LIFECYCLE.md`), a geração anterior continua
existindo com o id determinístico do número. Um `createProcess` com o mesmo número recebe CONFLICT — o número pertence
à linhagem; a geração ativa é aberta pela leitura canônica. Reset nunca é feito por "criar de novo".

## 5. Limites conhecidos

- Registros criados antes da PR-05/PR-06 podem ter resíduo do upsert antigo (por exemplo, mais de um fato de criação);
  o replay desses casos recebe CONFLICT (fail-closed). Nenhum dado é corrigido por este contrato.
- A convergência exige o **mesmo ator**: outro usuário com payload idêntico recebe CONFLICT (não é retry da mesma criação).
