# Runbook — Homologação E2E da rodada M8 em STAGING

Executor oficial: `pnpm homolog:e2e` (`server/__tests__/homologation/staging-homologation-e2e.test.ts` +
`scripts/homologation-e2e.ts`). Ele usa somente as APIs oficiais (login real, cookie de sessão, tRPC, RBAC do servidor).

## O que o executor faz (e o que não faz)
- Cria um processo sintético **NOVO** (`NNNN/AAAA`, NNNN de 1000 a 9999). O processo 2026/0001 nunca é reutilizado
  nem alterado: ele fica preservado como evidência histórica, junto com os 36 itens do leitor antigo.
- Na pesquisa de preços (M8-PRICE-IMPORT-001), faz a prévia do texto documental do caso real e espera 1 item,
  3 cotações, média R$ 4.000,00 e total R$ 40.000,00. Também envia um texto ambíguo e espera `PRECONDITION_FAILED`,
  sem nada gravado.
- No DFD (M8-AI-DFD-001), pede a sugestão de IA com o provider REAL do staging e espera texto sem "Pontuação de
  confiança", sem "Fatos utilizados" e sem `[REVISAR: 0.xx]`. Se a IA não produzir texto válido, espera recusa
  explícita com o DFD intacto. Nada é aceito no DFD.
- Jornada A: DFD → ETP → TR, com o TR emitido pelo **segundo** usuário (segregação de funções) → Edital BLL
  Revisão 2 → DOCX/PDF + replay.
- Jornadas B e C, mais o teste de isolamento entre órgãos.
- Guardas aplicadas ANTES de qualquer escrita:
  - destino só `https://licigov-pro-staging.up.railway.app`;
  - tenant só `homologacao-sintetica` (a organização 1 é recusada);
  - nenhum admin de plataforma e nenhum membro da organização 1.
- Senhas, cookies e tokens nunca são impressos nem gravados no relatório.

## Pré-requisitos (Owner)
1. Ter dois usuários **distintos**, membros ativos do tenant `homologacao-sintetica` (org 2), **ambos com papel `manager`
   ou superior**. O executor confere isso antes de qualquer escrita, porque atos governados e a emissão do TR exigem esse papel.
2. A Revisão 2 BLL deve estar vinculada ao tenant sintético (binding `tb4240c06340d9182eb981`), sem alteração.
3. A execução precisa alcançar `licigov-pro-staging.up.railway.app` via HTTPS. Já foi feita com sucesso a partir do
   **Console do Railway staging** (`/app`, que tem código e dependências completos). A sessão da nuvem do Claude NÃO
   alcança o staging, porque o egress é bloqueado.

## Resultado registrado (15/10/2026)
- **APROVADO 4/4**: run `MV9SXMKG`, Console do Railway staging, org 2, processo `4256/2026`.
- Evidência transcrita em `docs/ops/evidence/M8_E2E_HTTP_STAGING_2026-10-15.json`.
- Usuário com mais de uma organização: informe `HOMOLOG_ORGANIZATION_ID=2`. Os dois usuários precisam de papel
  `manager` ou superior.

## Execução numa máquina autorizada
```bash
git clone https://github.com/LeandroCardoso-cmyk/licigov-pro.git && cd licigov-pro
git checkout staging && git pull
corepack enable && pnpm install --frozen-lockfile

# Credenciais digitadas no terminal (não ficam no histórico do shell nem em arquivo):
read -r  -p "E-mail usuário 1 (elabora): " HOMOLOG_EMAIL;     export HOMOLOG_EMAIL
read -rs -p "Senha usuário 1: "            HOMOLOG_PASSWORD;  echo; export HOMOLOG_PASSWORD
read -r  -p "E-mail usuário 2 (emite): "   HOMOLOG_EMAIL_2;   export HOMOLOG_EMAIL_2
read -rs -p "Senha usuário 2: "            HOMOLOG_PASSWORD_2; echo; export HOMOLOG_PASSWORD_2

HOMOLOG_BASE_URL=https://licigov-pro-staging.up.railway.app \
HOMOLOG_EXERCICIO=2026 \
HOMOLOG_ORGANIZATION_ID=2 \
HOMOLOG_REPORT=homologacao-m8.json \
pnpm homolog:e2e

unset HOMOLOG_PASSWORD HOMOLOG_PASSWORD_2
```
Resultado esperado: todas as jornadas verdes. O arquivo `homologacao-m8.json` traz as métricas `PRICE_RESEARCH_M8`,
`DFD_AI`, `DFD`, `ETP`, `TR` (incluindo `structuredProposed`), as métricas do Edital e o modo "HTTP real (APIs
oficiais); não é homologação visual". Ele não contém credenciais.

## Depois da execução
- Envie o `homologacao-m8.json` (ou a saída `[HOMOLOGACAO]` do console) para registrar a evidência no Roadmap Mestre.
- Se houver falha, a saída do Vitest indica a etapa e o motivo. Nenhuma etapa grava dados fora do tenant sintético.
- A homologação **visual** (telas) continua sendo uma etapa separada. O executor não a substitui.

## Homologação VISUAL — roteiro mínimo (próxima etapa)
**Objetivo:** medir o trabalho que ainda sobra para o servidor. Não é repetir os testes automatizados.
- Use a org 2 e um processo **novo** criado pela tela.
- Não altere `4256/2026` nem `2026/0001`; eles são evidência.
- Anote os números de cada bloco.

**Preparação (uma vez):** em Configurações → Perfil de Licitações → "Padrões institucionais", defina os padrões
elegíveis que o órgão realmente usa: forma e prazo de pagamento, marcos, prazos de recebimento e índice de reajuste.
Sem isso, o TR não terá propostas.

1. **DFD:** gere a sugestão de IA da justificativa.
   - Confira se o texto vem limpo, sem confiança, lista de fatos ou títulos.
   - Confira se lacunas e avisos aparecem fora do texto.
   - Anote quantas edições foram necessárias.
2. **Pesquisa de Preços:** cole o texto do caso (1 item, 3 cotações) e clique em "Conferir extração".
   - Confira 1 item, 3 cotações, média e total corretos, e as linhas ignoradas listadas.
   - Importe.
3. **TR:** anote quantos parâmetros aparecem como proposta (padrão institucional) e quantos você digitou do zero.
   - Referência do E2E sem padrões: 21 confirmados manualmente de 37 ativos.
   - Anote quais campos pareceram redundantes.
4. **Edital BLL:** confirme a Revisão 2 resolvida (BOUND), os dados do órgão e do TR reaproveitados, e as pendências
   separadas entre "impede a elaboração" e "só publicação".
   - Anote quantas decisões do certame foram realmente novas.
   - Os 7 dados de publicação podem ficar para depois; não preencha datas fictícias.

**Saída esperada:** os números de cada bloco e a lista do que ainda parece repetido ou desnecessário. Esses são os
insumos da próxima simplificação. Não é preciso abrir uma rodada de correção antes de ter esses números.

## Homologação visual — resultado parcial (16/10/2026) e retomada
- **Percorrido:** processo `2026/9001` (org 2), com Perfil revisão 5 e 9 padrões do TR.
  - DFD: sugestão de IA aceita.
  - Pesquisa: importação correta.
  - Itens: aprovado e incorporado.
  - ETP: rascunho gerado com 8 lacunas.
  - Padrões do TR: pendências de 21 para 12.
- **Interrompido:**
  - TR: recusa "Autoria estruturada inválida (fail-closed) … Fundamentação".
  - Edital BLL: não alcançado.
- **Correções (PR `fix/m8-visual-round`):**
  - DFD: o texto sai sem `[REVISAR]` e as lacunas ficam listadas fora dele.
  - TR: a recusa diz o motivo, onde complementar e a próxima ação. O prompt também declara as seções de mínimo legal.
  - ETP/TR: lista "O que falta completar", organizada por seção.
  - Painel oficial: separa as versões emitidas dos snapshots técnicos.
  - Edital: a tela não mostra mais critério e regime antes de saber se há modelo vinculado.
  - Itens: o botão mostra "Item aprovado" e o indicador se atualiza sem F5.
  - CATMAT: o valor aparece como "similaridade textual", não como confiança.
  - Detalhes no Roadmap Mestre, seção "Rodada M8 — homologação visual".

**Catálogo oficial CATMAT/CATSER — conferência real ANTES do merge:**
1. Smoke real sobre o código do PR: adicione a label `catalog-smoke` ao PR (workflow `catalog-official-smoke.yml`).
   - Somente leitura, sem banco e sem segredos.
   - Saída 0 = consulta por código OK nos dois catálogos.
   - O relatório também classifica:
     - o filtro `descricaoItem` do CATMAT;
     - o parâmetro textual não documentado do CATSER (esperado: ignorado);
     - o limite de `tamanhoPagina`;
     - o tamanho do CATSER.
   - Relatório no log e no artefato do job.
2. `pnpm catalog:sync -- catser`: **só com autorização expressa do Owner**, depois do merge e do dimensionamento.
   - Publicação atômica num índice versionado sob a organização global 0. Nenhum órgão é alterado.
   - Falha ou concorrência não publica nada.

**Retomada (depois do deploy do PR em staging), num processo NOVO da org 2:**
- O `2026/9001` fica preservado como evidência desta rodada.
- Repita a pesquisa e o item com o mesmo texto do caso.
1. **DFD:** gere a sugestão de IA.
   - Confira se o texto vem sem `[REVISAR]` e se as lacunas aparecem listadas abaixo dele.
2. **Item → classificação:** na Inteligência do Item, clique em "Buscar no CATMAT (material)". Se nada aparecer, use
   "Verificar código" com um código conhecido.
   - Confira se as alternativas aparecem como "Verificado no catálogo oficial", com a data da consulta.
   - Confirmar exige o limiar institucional. Se ele não estiver configurado, a recusa é esperada: não configure um valor só para
     testar.
   - Se o catálogo estiver indisponível, confira a mensagem "Nenhum código foi sugerido nem alterado".
3. **ETP:** abra "O que falta completar" e resolva as lacunas no editor.
   - Confira se "v1 · gerado" aparece só em "Versões técnicas", e não entre as emitidas.
4. **TR:** gere o rascunho.
   - Se houver recusa, siga o "Onde complementar" da mensagem.
   - Anote as pendências restantes. A referência atual é 12.
5. **Edital:** escolha Pregão · Eletrônico · BLL e confirme que a Preparação do Edital (Rev. 2, BOUND) aparece sem os
   campos legados.
   - Anote as decisões novas do certame.
   - Deixe os 7 dados de publicação para depois.
