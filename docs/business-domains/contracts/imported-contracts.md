# Contratos Externos (Importados) — Fluxo Obrigatório

## Por que existe

Nenhuma prefeitura inicia sua operação com apenas contratos novos. Existe sempre um
**acervo de contratos vigentes** firmados antes da adoção do LiciGov Pro. Por isso, o
cadastro de **contrato externo** é um fluxo **obrigatório** do Business Domain Contratos:
sem ele, o sistema não conseguiria representar a realidade contratual do órgão.

`originType = externo` · Router: `importExternalContract` · Tabela: `imported_contracts`

## Visão do fluxo

```
Upload PDF/DOCX
      │
      ▼
Reconstrução Assistida do Contrato
      │
      ▼
Identificação (fornecedor, objeto, prazo, valor, cláusulas)
      │
      ▼
Apresentação ao servidor
      │
      ▼
Servidor revisa e valida
      │
      ▼
Criação do ContractWorkspace (status: minuta — não vigente)
      │
      ▼
Disponível para Aditivos, Apostilamentos, Ocorrências e geração documental
```

> **Reconstrução Assistida, nunca perfeita.** O sistema **não** promete extração exata do
> contrato: a reconstrução é **assistida** e **depende integralmente da validação do
> servidor**. O contrato externo nasce como **minuta (não vigente)**, pendente de revisão
> humana antes de qualquer efeito.

## Etapas

### 1. Importar PDF/DOCX
O usuário envia o arquivo do contrato já assinado. O conteúdo é registrado em
`imported_contracts`, preservando o documento original **por referência** (sem duplicação).

### 2. Identificação (Reconstrução Assistida)
A **Reconstrução Assistida** processa o texto do documento para **identificar** os
campos-chave do contrato, sempre como sugestão sujeita à validação do servidor:

- Fornecedor / Contratada (`contractor`)
- Objeto (`object`)
- Vigência / prazo (`term`)
- Valor (`value`)
- Cláusulas do contrato
- Número do contrato (`contractNumber`)
- Gestor e fiscal, quando presentes (`manager`, `inspector`)

> A Reconstrução Assistida é **determinística e replay-safe**: o mesmo texto sempre produz o
> mesmo resultado. Não há dependência de `Date.now()` ou `Math.random()`, e os
> identificadores derivam de `sha256`.

### 3. Apresentação ao servidor e revisão
Os campos identificados pela Reconstrução Assistida são **apresentados ao servidor**, que
**revisa e valida** cada informação. Nenhum dado reconstruído é tratado como definitivo antes
dessa validação — a reconstrução é assistida, não automática.

### 4. Criação do Workspace
Somente após a revisão do servidor cria-se o `ContractWorkspace`. O contrato externo nasce
como **minuta (não vigente)**, pendente de confirmação. A partir daí, todo o ferramental do
domínio fica disponível: aditivos, apostilamentos, ocorrências e geração inteligente de
minutas.

## Revisão humana obrigatória

A Reconstrução Assistida é uma **sugestão**. Todos os campos identificados são
**revisáveis** pelo servidor antes da confirmação do Workspace, acompanhados de *confidence*
e *provenance* (de qual trecho do texto o dado foi identificado). Nada é gravado como
definitivo sem validação humana, e o contrato permanece como minuta até essa validação.

## O que este fluxo NÃO faz

- Não promete reconstrução **perfeita**: é assistida e depende da validação do servidor.
- Não coloca o contrato externo diretamente como `vigente` — ele nasce como **minuta**.
- Não importa histórico financeiro, empenhos ou pagamentos.
- Não faz OCR de documentos que não tenham camada de texto extraível como parte do escopo
  central (o foco é a Reconstrução Assistida sobre o texto disponível).
- Não integra automaticamente com sistemas externos de origem — apenas reconstrói, de forma
  assistida, o documento fornecido.
