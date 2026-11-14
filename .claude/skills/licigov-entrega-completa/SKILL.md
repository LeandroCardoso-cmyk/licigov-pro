---
name: licigov-entrega-completa
description: "Executa missões completas do LiciGov Pro de ponta a ponta: investigação proporcional, implementação por integrador único, testes, auditoria independente, correção dos achados impeditivos e entrega consolidada. Use em bugs, features, integração de PR/CI e gates de staging quando houver autorização expressa do Owner."
---

# LiciGov Pro — Entrega completa em uma única missão

Este procedimento orienta a **execução**; **não concede permissões novas**. Responda em português do Brasil.

**Ordem de autoridade:** (1) `docs/architecture/PRODUCT_NORTH_STAR.md` (Constituição) → (2) código e contratos reais (dizem o que EXISTE
hoje; não legitimam violar regra) → (3) instruções vigentes do repositório (contratos em `docs/architecture/`, regras de módulos) → (4)
`CLAUDE.md` → (5) `LICIGOV_CLAUDE_PLAYBOOK.md`, se existir → (6) documentação histórica. Esta skill não substitui nenhum deles: é só o
procedimento de execução.

## Regra principal — uma missão completa, uma entrega validada

**Não encerre depois de investigar, escrever código, testar ou auditar.** Se o Owner autorizou essas etapas, execute **todas na mesma
missão**, sem pedir instruções intermediárias para etapas já autorizadas. O resultado é entrega validada (ou bloqueio específico), não outro
plano genérico. Não prometa trabalho posterior.

**Relação com `plan-first` e `brainstorming`:** quando o Owner autoriza expressamente o pipeline, essa autorização JÁ é a confirmação que
essas skills exigem — o plano vai em poucas linhas no início e no relatório, sem aguardar resposta. Sem autorização expressa, elas prevalecem
(apresentar o plano e aguardar).

## Antes de agir

1. Confirmar repo, branch, HEAD/base SHA, working tree (preservar trabalho não relacionado), ambiente, ferramentas e permissões.
2. Extrair do pedido: resultado observável, escopo autorizado, ações proibidas, evidências e gates.
3. Faltando autorização para ação sensível, executar só os passos permitidos; a skill nunca é autorização.
4. Mapear causalidade, consumidores e invariantes com código real e Graphify proporcional (`graphify-out/`, `bash tools/graphify/run.sh explain "X"`).
   O código prevalece sobre o grafo. **REUTILIZAR → INTEGRAR → CORRIGIR → ESTENDER → CRIAR**: motor documental compartilhado
   (`server/domain/institutionalTemplates/*`, `templateCompositionService.ts`), Cognitive Kernel / AIExecutionEngine e serviços existentes —
   nunca mecanismos paralelos.

## Orquestração proporcional — muitos investigadores, um único integrador

- **Pequena:** uma sessão; diagnóstico, patch e validação sem subagentes de investigação. A auditoria é um revisor somente leitura curto
  sobre o diff; para mudança só de texto/documentação sem efeito em código, autorrevisão registrada no relatório.
- **Média:** até 2–3 investigadores **somente leitura** quando a independência reduzir latência (ex.: arquitetura/Graphify; backend/contratos/banco;
  segurança/RBAC/tenant; frontend/servidor público; testes/regressões).
- **Crítica:** discovery paralelo dirigido, **um único integrador** que escreve, auditor independente somente leitura.
- Auditores não editam; os achados vão ao integrador. Não criar agentes por quantidade, duplicar sessões nem editar concorrentemente a mesma árvore.

## Pipeline integral (cada etapa só se autorizada)

1. **Diagnóstico focado:** reproduzir, localizar contratos, fixar critérios de aceite; parar o discovery quando houver evidência suficiente.
2. **Implementação:** menor patch testável, sem refatoração geral sem objetivo; preservar tenant, RBAC no backend, memberships, menor
   privilégio, CAS, ledger e auditoria persistida, versionamento, M1/M2, hash/replay, imutabilidade, provenance/lineage, segregação de
   funções, idempotência, fail-closed, LGPD (nenhum dado pessoal em logs, exports ou fixtures) e LICIGOV-FAST (sem confirmações/etapas artificiais).
3. **Testes dirigidos:** unitário/integrado, MySQL **isolado e descartável**, casos negativos de segurança conforme o risco. Nunca dados da
   organização 1 (referências reais de Moreira Sales) — e nunca reclassificá-la como sintética; organização 2 só com autorização expressa de escrita.
4. **Auditoria somente leitura, uma vez, proporcional ao risco:** alguém que não fez o patch revisa o delta e os contratos; severidade
   baseada em reprodução ou evidência no código. Classificar:
   **P0** = segurança, tenant, autoria, autorização ou integridade; **P1** = defeito funcional/regressão da missão; **P2** = cosmético,
   otimização ou débito preexistente.
5. **Correções na mesma execução:** P0/P1 do escopo → corrigir e retestar; P2/preexistente → backlog no relatório. Depois das correções,
   só verificação dirigida ao delta corrigido; nova auditoria apenas se a correção tocar contrato protegido ou segurança. No máximo dois
   ciclos: se P0/P1 persistir, `BLOCKED` com evidência. Não reabrir auditoria ampla sem alteração material ou fato crítico novo.
6. **Gates finais no estado FINAL** (nunca durante edição concorrente), proporcionais ao risco: typecheck, lint dos alterados, build, Vitest
   dos afetados (suíte completa só com motivo concreto ou na CI), MySQL/RBAC/tenant/replay/CAS/idempotência e Graphify; CI no HEAD exato
   quando houver PR. Sem evidência, não há PASS. Graphify: antes (dependências), durante (dúvidas de consumidores) e depois (o hook de
   pre-commit atualiza o grafo; conferir consistência). Se o hook reescrever `graphify-out/.graphify_root` com caminho absoluto, restaurar
   o arquivo (não versionar).
7. **Commit local só quando autorizado. Remoto, somente se cada operação (push, PR, merge, verificação de deploy) estiver nomeada no próprio
   pedido:** push normal → PR → CI → correção delimitada da CI → revalidar PR, base/HEAD SHA, diff,
   proteções e gates → merge **squash** na `staging` com `expectedHeadSha` → verificar o deploy **automático** (commit, predeploy, boot, health,
   logs). Merge em staging não autoriza produção. Se algo não foi autorizado, parar no limite — sem pedir autorização para o que já foi dado.
   Mensagens de commit e corpo de PR sem URLs/identificadores de sessão (decisão do Owner; remover rodapé automático do PR se aparecer).
8. **Relatório único:** objetivo e baseline; causa; arquivos; testes/gates reais; auditoria e correções; segurança/integridade; SHA/PR/CI/merge/
   deploy reais (quando houver); riscos impeditivos; **um** próximo incremento de valor comercial.

## Portões de parada

Bloqueie somente por: autorização ausente; tenant/ambiente equivocado; conflito material base/HEAD; risco de segurança, tenant, autoria ou
integridade; gate crítico não mitigável no escopo; mudança de contrato protegido não autorizada; ator humano legítimo ausente; migration,
segredo ou produção fora do escopo. Reporte `BLOCKED` específico, nunca PASS inventado. Problemas cosméticos ou dívidas anteriores não travam
uma entrega segura.

**Atos humanos:** IA não marca declaração pessoal no lugar de uma pessoa, não atesta revisão inexistente, não substitui `[REVISAR]` por falsa
conferência, não reconhece desvios em laço para forçar emissão, não simula decisão jurídica e não trata duas identidades técnicas como prova
de duas pessoas. O Owner da plataforma não substitui a autoridade competente do órgão. Revisão técnica automatizada não é revisão humana nem
parecer jurídico (ver `CLAUDE.md`, "Agentes de IA, confirmações humanas e evidências").

**Sem autorização específica, nunca:** merge (inclusive staging), `main`/produção, deploy manual, SQL/migration em staging ou produção,
secrets/flags, policies/bindings/limiares, atos ou documentos institucionais, operações destrutivas, escrita em tenant real. A continuidade da
sessão não amplia autorização.

## Encerramento

Critérios atendidos: **termine**, registre P2 no backlog e aponte o próximo valor ao servidor público (DFD → ETP → TR → Edital); não
transforme pendências não vinculantes em bloqueios. Não proponha nova auditoria ou refatoração genérica sem objetivo comercial ou risco
concreto como próximo passo. Critérios não atendidos:
evidência exata, trabalho preservado e a única decisão pendente.
