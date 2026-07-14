# Termos Aditivos (Addenda)

Os **termos aditivos** alteram o contrato durante sua vigência, dentro dos limites da
Lei 14.133/2021. No LiciGov Pro, o aditivo é um **instrumento** do `ContractWorkspace`
(`server/domain/contractInstruments.ts`), exibido na aba **Aditivos**.

Router: `createAddendum` · Tabela: `contract_addenda`

## Tipos de aditivo

| Tipo | Descrição |
|---|---|
| **Prazo** | Prorrogação da vigência do contrato. |
| **Valor** | Alteração do valor contratado (reforço ou supressão de valor). |
| **Quantitativo** | Acréscimo ou supressão de quantidades do objeto (limites legais). |
| **Qualitativo** | Alteração de especificações/qualidade do objeto. |

## Fluxo do aditivo

```
Solicitar → Justificar → Gerar minuta → Parecer Jurídico (recomendado) → Documento Final
```

### 1. Solicitar
O usuário abre a solicitação do aditivo indicando o **tipo** (prazo, valor, quantitativo,
qualitativo) e os parâmetros pretendidos.

Todo aditivo registra **obrigatoriamente** a **Origem da Solicitação**, com um dos quatro
valores:

| Origem da Solicitação | Descrição |
|---|---|
| **Contract Workspace** | Solicitação nascida dentro do próprio Workspace do contrato. |
| **Institutional Request** | Solicitação originada de uma requisição institucional. |
| **Documento Externo** | Solicitação derivada de um documento externo. |
| **Solicitação Manual** | Solicitação registrada manualmente pelo servidor. |

### 2. Justificar
Registra-se a **justificativa técnica e legal** da alteração. Esta motivação é insumo tanto
para a minuta quanto para o parecer jurídico. O copiloto de Contratos pode **sugerir**
fundamentação — sempre revisável.

### 3. Gerar minuta
A minuta do **Termo Aditivo** é gerada de forma inteligente pelo domínio, apoiada em
legislação, jurisprudência, templates institucionais e cláusulas obrigatórias/facultativas.
A geração final do DOCX/PDF ocorre via **Document Engine**. Ver
[`document-generation.md`](./document-generation.md).

### 4. Parecer Jurídico (recomendado, nunca obrigatório)
Para aditivos, o parecer jurídico é **apenas recomendado** — em especial para aditivos de
**valor** e **quantitativo** — **nunca obrigatório**. O **Adaptive Recommendation Engine**
apenas **recomenda** (ANÁLISE → RECOMENDAÇÃO → MOTIVOS → BASE LEGAL → CONFIANÇA →
ALTERNATIVAS → DECISÃO DO SERVIDOR): ele nunca decide, obriga ou executa, e **nunca bloqueia
o fluxo**. A decisão de solicitar o parecer é sempre do servidor. Quando solicitado, o pedido
é encaminhado ao Business Domain Parecer Jurídico via **Institutional Request Engine**
(`LEGAL_OPINION_INITIAL` / `LEGAL_OPINION_FINAL`). Ver
[`legal-opinion.md`](./legal-opinion.md).

### 5. Documento Final
Com a minuta revisada e o parecer disponível (quando aplicável), consolida-se o
**documento final** do aditivo, referenciado na aba Documentos e refletido no `status` do
Workspace (`aditado`).

## Exemplo de transição de estado

```
Workspace: vigente
   └─ createAddendum(tipo = prazo)
        └─ minuta revisada + parecer (recomendado, a critério do servidor)
             └─ documento final → Workspace: aditado
```

## Princípios

- **Revisável sempre:** toda sugestão de cláusula ou justificativa vem com *reasoning*,
  *explainability*, *provenance* e *confidence*, e pode ser **rejeitada**.
- **Adaptativo, não impositivo:** o Adaptive Recommendation Engine apenas **recomenda** o
  caminho (com ou sem parecer); a decisão é sempre do servidor e o fluxo nunca é bloqueado.
- **Sem duplicação:** documentos e pareceres são referenciados, nunca copiados.
- **Determinístico:** IDs derivam de `sha256`; sem `Date.now()`/`Math.random()`.

## Fora de escopo

O aditivo trata da **instrumentalização documental** da alteração. Não executa recálculo
orçamentário, empenho, nem controle financeiro — isso pertence a sistemas de ERP, fora do
escopo do LiciGov Pro.
