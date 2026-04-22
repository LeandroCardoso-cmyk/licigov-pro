/**
 * Serviço de Geração de Documentos de Contratos
 * Gera Minuta de Contrato, Termos de Aditivo, Apostilamento e Rescisão
 * Baseado na Lei 14.133/2021 (Nova Lei de Licitações)
 */

interface ContractData {
  number: string;
  year: number;
  object: string;
  type: "fornecimento" | "servico" | "obra" | "concessao" | "outro";
  contractorName: string;
  contractorCNPJ?: string;
  contractorAddress?: string;
  contractorContact?: string;
  value: number;
  currentValue: number;
  startDate: Date;
  endDate: Date;
  fiscalUserName?: string;
  notes?: string;
  // Dados da organização
  organizationName?: string;
  organizationCNPJ?: string;
  organizationAddress?: string;
  // Origem (processo licitatório ou contratação direta)
  originType?: "processo" | "contratacao_direta" | "manual";
  originNumber?: string;
}

interface AmendmentData {
  number: number;
  type: "prazo" | "valor" | "escopo" | "misto";
  justification: string;
  newEndDate?: Date;
  daysAdded?: number;
  valueChange?: number;
  newTotalValue?: number;
  scopeChanges?: string;
  signedAt?: Date;
}

interface ApostilleData {
  number: number;
  type: "reajuste" | "correcao" | "designacao" | "outro";
  description: string;
  valueChange?: number;
  newTotalValue?: number;
  indexType?: string;
  indexValue?: string;
  signedAt?: Date;
}

interface RescissionData {
  type: "unilateral" | "bilateral" | "judicial";
  reason: string;
  effectiveDate: Date;
  penaltyAmount?: number;
  notes?: string;
}

/**
 * Formatar valor monetário
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Formatar data por extenso
 */
function formatDateExtensive(date: Date): string {
  const months = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];
  
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${day} de ${month} de ${year}`;
}

/**
 * Formatar data curta
 */
function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

/**
 * Gerar Minuta de Contrato
 */
export function generateContractMinuta(data: ContractData): string {
  const typeLabels = {
    fornecimento: "FORNECIMENTO",
    servico: "PRESTAÇÃO DE SERVIÇOS",
    obra: "EXECUÇÃO DE OBRA",
    concessao: "CONCESSÃO",
    outro: "CONTRATO ADMINISTRATIVO"
  };

  const originText = data.originType === "processo" 
    ? `Processo Licitatório nº ${data.originNumber || "___/____"}`
    : data.originType === "contratacao_direta"
    ? `Contratação Direta nº ${data.originNumber || "___/____"}`
    : "Contratação Direta";

  return `# MINUTA DE CONTRATO Nº ${data.number}/${data.year}

## ${typeLabels[data.type]}

**${data.organizationName || "[NOME DO ÓRGÃO]"}**, pessoa jurídica de direito público, inscrita no CNPJ sob o nº ${data.organizationCNPJ || "[CNPJ]"}, com sede na ${data.organizationAddress || "[ENDEREÇO]"}, neste ato representada por **[NOME DO ORDENADOR DE DESPESAS]**, **[CARGO]**, doravante denominada **CONTRATANTE**, e de outro lado **${data.contractorName}**, ${data.contractorCNPJ ? `inscrita no CNPJ sob o nº ${data.contractorCNPJ}` : "pessoa física/jurídica"}, ${data.contractorAddress ? `com sede/domicílio na ${data.contractorAddress}` : ""}, doravante denominada **CONTRATADA**, têm entre si justo e acordado, e celebram o presente Contrato, com fundamento na **Lei Federal nº 14.133, de 1º de abril de 2021** (Nova Lei de Licitações e Contratos Administrativos), mediante as cláusulas e condições seguintes:

---

## CLÁUSULA PRIMEIRA – DO OBJETO

**1.1.** O objeto do presente Contrato é **${data.object}**, conforme especificações constantes do ${originText}.

**1.2.** O objeto deste Contrato deverá ser executado em estrita conformidade com as normas técnicas aplicáveis e com os padrões de qualidade exigidos pela legislação vigente.

---

## CLÁUSULA SEGUNDA – DO VALOR E DA DOTAÇÃO ORÇAMENTÁRIA

**2.1.** O valor total do presente Contrato é de **${formatCurrency(data.value)}** (${data.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/[R$\s]/g, "")} reais).

**2.2.** Os recursos necessários à execução deste Contrato correrão por conta da seguinte dotação orçamentária:

- **Unidade Orçamentária:** [CÓDIGO]
- **Programa de Trabalho:** [CÓDIGO]
- **Elemento de Despesa:** [CÓDIGO]
- **Fonte de Recursos:** [CÓDIGO]

**2.3.** Para os exercícios subsequentes, as despesas correrão à conta dos recursos próprios para atender às despesas da mesma natureza, cuja alocação será feita no início de cada exercício financeiro.

---

## CLÁUSULA TERCEIRA – DA VIGÊNCIA E DO PRAZO DE EXECUÇÃO

**3.1.** O prazo de vigência deste Contrato é de **${Math.ceil((data.endDate.getTime() - data.startDate.getTime()) / (1000 * 60 * 60 * 24))} dias**, contados a partir de **${formatDateShort(data.startDate)}** até **${formatDateShort(data.endDate)}**.

**3.2.** O prazo de execução do objeto contratual poderá ser prorrogado, mediante termo aditivo, nas hipóteses previstas no art. 107 da Lei nº 14.133/2021, desde que devidamente justificado e autorizado pela autoridade competente.

**3.3.** A prorrogação de prazo deverá ser solicitada pela CONTRATADA com antecedência mínima de 30 (trinta) dias do término da vigência contratual, devidamente justificada.

---

## CLÁUSULA QUARTA – DAS OBRIGAÇÕES DA CONTRATADA

**4.1.** Constituem obrigações da CONTRATADA, além das demais previstas neste Contrato e na legislação aplicável:

**a)** Executar o objeto contratual de acordo com as especificações técnicas, normas e padrões de qualidade exigidos;

**b)** Manter, durante toda a execução do Contrato, as condições de habilitação e qualificação exigidas na contratação;

**c)** Responsabilizar-se pelos encargos trabalhistas, previdenciários, fiscais e comerciais resultantes da execução do Contrato;

**d)** Reparar, corrigir, remover, reconstruir ou substituir, às suas expensas, no total ou em parte, o objeto do Contrato em que se verificarem vícios, defeitos ou incorreções resultantes da execução ou de materiais empregados;

**e)** Indicar preposto para representá-la durante a execução do Contrato;

**f)** Comunicar à CONTRATANTE, por escrito, qualquer anormalidade de caráter urgente e prestar os esclarecimentos que julgar necessário;

**g)** Manter sigilo sobre dados, informações e documentos fornecidos pela CONTRATANTE ou obtidos em razão da execução do Contrato;

**h)** Cumprir todas as normas regulamentares sobre medicina e segurança do trabalho;

**i)** Não transferir a outrem, no todo ou em parte, o objeto deste Contrato, sem prévia e expressa anuência da CONTRATANTE.

---

## CLÁUSULA QUINTA – DAS OBRIGAÇÕES DA CONTRATANTE

**5.1.** Constituem obrigações da CONTRATANTE, além das demais previstas neste Contrato e na legislação aplicável:

**a)** Efetuar o pagamento nas condições e prazos estabelecidos neste Contrato;

**b)** Fornecer à CONTRATADA todos os elementos e informações necessários à execução do objeto contratual;

**c)** Exercer a fiscalização do Contrato por meio de servidor especialmente designado;

**d)** Notificar a CONTRATADA, por escrito, sobre imperfeições, falhas ou irregularidades constatadas na execução do objeto, para que sejam adotadas as medidas corretivas necessárias;

**e)** Aplicar as sanções administrativas contratuais pertinentes, em caso de inadimplemento.

---

## CLÁUSULA SEXTA – DA FISCALIZAÇÃO E DO ACOMPANHAMENTO

**6.1.** A execução deste Contrato será acompanhada e fiscalizada por ${data.fiscalUserName || "[NOME DO FISCAL]"}, designado(a) pela CONTRATANTE como **Fiscal do Contrato**, nos termos do art. 117 da Lei nº 14.133/2021.

**6.2.** O Fiscal do Contrato terá, entre outras, as seguintes atribuições:

**a)** Acompanhar e fiscalizar a execução do Contrato;

**b)** Atestar a execução do objeto contratual;

**c)** Comunicar à autoridade competente as irregularidades constatadas;

**d)** Propor aplicação de sanções administrativas, quando cabível.

**6.3.** A fiscalização exercida pela CONTRATANTE não exclui nem reduz a responsabilidade da CONTRATADA pela completa e perfeita execução do objeto contratual.

---

## CLÁUSULA SÉTIMA – DO PAGAMENTO

**7.1.** O pagamento será efetuado pela CONTRATANTE no prazo de até **30 (trinta) dias**, contados da apresentação da Nota Fiscal/Fatura, devidamente atestada pelo Fiscal do Contrato.

**7.2.** Para fazer jus ao pagamento, a CONTRATADA deverá apresentar:

**a)** Nota Fiscal/Fatura discriminada;

**b)** Prova de regularidade fiscal (FGTS, INSS, Fazendas Federal, Estadual e Municipal);

**c)** Certidão Negativa de Débitos Trabalhistas (CNDT).

**7.3.** Havendo erro na apresentação da Nota Fiscal/Fatura ou dos documentos exigidos, o prazo de pagamento será contado a partir da respectiva regularização.

**7.4.** O pagamento será efetuado mediante crédito em conta bancária indicada pela CONTRATADA.

---

## CLÁUSULA OITAVA – DO REAJUSTE

**8.1.** Os preços contratados são fixos e irreajustáveis pelo período de **12 (doze) meses**, contados da data de apresentação da proposta.

**8.2.** Após o período de 12 (doze) meses, os preços poderão ser reajustados, mediante solicitação da CONTRATADA, utilizando-se o **[ÍNDICE DE REAJUSTE]** ou outro índice que venha a substituí-lo.

**8.3.** O reajuste será formalizado por meio de apostilamento.

---

## CLÁUSULA NONA – DAS SANÇÕES ADMINISTRATIVAS

**9.1.** O descumprimento total ou parcial das obrigações assumidas pela CONTRATADA sujeitá-la-á às seguintes sanções, garantida a prévia defesa:

**a)** Advertência;

**b)** Multa de mora de **0,5% (meio por cento)** por dia de atraso, até o limite de **10% (dez por cento)** sobre o valor total do Contrato;

**c)** Multa compensatória de **10% (dez por cento)** sobre o valor total do Contrato, em caso de inexecução total ou parcial;

**d)** Suspensão temporária de participação em licitação e impedimento de contratar com a Administração, por prazo não superior a **3 (três) anos**;

**e)** Declaração de inidoneidade para licitar ou contratar com a Administração Pública.

**9.2.** As sanções previstas nas alíneas "a", "d" e "e" poderão ser aplicadas cumulativamente com as multas previstas nas alíneas "b" e "c".

**9.3.** A aplicação de sanções observará o disposto nos arts. 155 a 163 da Lei nº 14.133/2021.

---

## CLÁUSULA DÉCIMA – DA RESCISÃO

**10.1.** O presente Contrato poderá ser rescindido nas hipóteses previstas no art. 137 da Lei nº 14.133/2021, com as consequências indicadas no art. 139 da mesma Lei.

**10.2.** A rescisão poderá ser:

**a)** **Unilateral**, por ato da CONTRATANTE, nas hipóteses do art. 137, incisos I a XII e XVII, da Lei nº 14.133/2021;

**b)** **Bilateral**, por acordo entre as partes, mediante formalização de termo de rescisão;

**c)** **Judicial**, nos termos da legislação processual civil.

**10.3.** A rescisão administrativa ou amigável será precedida de autorização escrita e fundamentada da autoridade competente.

---

## CLÁUSULA DÉCIMA PRIMEIRA – DAS DISPOSIÇÕES GERAIS

**11.1.** Integram este Contrato, independentemente de transcrição, as seguintes peças:

**a)** ${originText};

**b)** Proposta da CONTRATADA;

**c)** Lei nº 14.133/2021 e demais normas aplicáveis.

**11.2.** Fica eleito o foro da Comarca de **[CIDADE/UF]** para dirimir quaisquer dúvidas ou controvérsias oriundas deste Contrato, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

**11.3.** Os casos omissos serão resolvidos de acordo com a Lei nº 14.133/2021 e demais normas aplicáveis.

---

E, por estarem assim justos e contratados, assinam o presente instrumento em **2 (duas) vias** de igual teor e forma, na presença das testemunhas abaixo identificadas.

**[CIDADE/UF]**, **${formatDateExtensive(data.startDate)}**.

---

**CONTRATANTE**

**[NOME DO ORDENADOR DE DESPESAS]**  
**[CARGO]**  
CPF: [CPF]

---

**CONTRATADA**

**${data.contractorName}**  
${data.contractorCNPJ ? `CNPJ: ${data.contractorCNPJ}` : "CPF: [CPF]"}  
Representante Legal: **[NOME]**  
CPF: [CPF]

---

**TESTEMUNHAS:**

1. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

2. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

${data.notes ? `\n---\n\n## OBSERVAÇÕES\n\n${data.notes}` : ""}
`;
}

/**
 * Gerar Termo de Aditivo
 */
export function generateAmendmentTerm(contractData: ContractData, amendmentData: AmendmentData): string {
  const typeLabels = {
    prazo: "PRAZO",
    valor: "VALOR",
    escopo: "ESCOPO",
    misto: "PRAZO, VALOR E ESCOPO"
  };

  let changesText = "";

  if (amendmentData.type === "prazo" || amendmentData.type === "misto") {
    changesText += `\n**1.1.** O prazo de vigência do Contrato fica prorrogado por **${amendmentData.daysAdded} dias**, passando a vigorar até **${amendmentData.newEndDate ? formatDateShort(amendmentData.newEndDate) : "[DATA]"}**.\n`;
  }

  if (amendmentData.type === "valor" || amendmentData.type === "misto") {
    const changeType = (amendmentData.valueChange || 0) > 0 ? "acréscimo" : "supressão";
    changesText += `\n**1.2.** O valor do Contrato fica ${changeType === "acréscimo" ? "acrescido" : "suprimido"} de **${formatCurrency(Math.abs(amendmentData.valueChange || 0))}**, passando o valor total para **${formatCurrency(amendmentData.newTotalValue || contractData.currentValue)}**.\n`;
  }

  if (amendmentData.type === "escopo" || amendmentData.type === "misto") {
    changesText += `\n**1.3.** O escopo do Contrato fica alterado conforme segue:\n\n${amendmentData.scopeChanges || "[DESCREVER ALTERAÇÕES NO ESCOPO]"}\n`;
  }

  return `# TERMO ADITIVO Nº ${amendmentData.number}

## AO CONTRATO Nº ${contractData.number}/${contractData.year}

**${contractData.organizationName || "[NOME DO ÓRGÃO]"}**, pessoa jurídica de direito público, inscrita no CNPJ sob o nº ${contractData.organizationCNPJ || "[CNPJ]"}, com sede na ${contractData.organizationAddress || "[ENDEREÇO]"}, neste ato representada por **[NOME DO ORDENADOR DE DESPESAS]**, **[CARGO]**, doravante denominada **CONTRATANTE**, e de outro lado **${contractData.contractorName}**, ${contractData.contractorCNPJ ? `inscrita no CNPJ sob o nº ${contractData.contractorCNPJ}` : "pessoa física/jurídica"}, doravante denominada **CONTRATADA**, têm entre si justo e acordado celebrar o presente **TERMO ADITIVO**, com fundamento na **Lei Federal nº 14.133, de 1º de abril de 2021**, mediante as cláusulas e condições seguintes:

---

## CLÁUSULA PRIMEIRA – DO OBJETO

**1.1.** O presente Termo Aditivo tem por objeto a alteração do **${typeLabels[amendmentData.type]}** do Contrato nº ${contractData.number}/${contractData.year}, cujo objeto é **${contractData.object}**.

---

## CLÁUSULA SEGUNDA – DAS ALTERAÇÕES

${changesText}

---

## CLÁUSULA TERCEIRA – DA JUSTIFICATIVA

**3.1.** A presente alteração contratual justifica-se por:

${amendmentData.justification}

**3.2.** A alteração está fundamentada no **art. 124** da Lei nº 14.133/2021.

---

## CLÁUSULA QUARTA – DA DOTAÇÃO ORÇAMENTÁRIA

${amendmentData.type === "valor" || amendmentData.type === "misto" ? `**4.1.** Os recursos necessários ao atendimento das despesas decorrentes deste Termo Aditivo correrão por conta da seguinte dotação orçamentária:

- **Unidade Orçamentária:** [CÓDIGO]
- **Programa de Trabalho:** [CÓDIGO]
- **Elemento de Despesa:** [CÓDIGO]
- **Fonte de Recursos:** [CÓDIGO]` : "**4.1.** Não há alteração na dotação orçamentária."}

---

## CLÁUSULA QUINTA – DAS DEMAIS CLÁUSULAS

**5.1.** Permanecem inalteradas as demais cláusulas e condições do Contrato original não expressamente modificadas por este Termo Aditivo.

---

E, por estarem assim justos e contratados, assinam o presente instrumento em **2 (duas) vias** de igual teor e forma, na presença das testemunhas abaixo identificadas.

**[CIDADE/UF]**, **${amendmentData.signedAt ? formatDateExtensive(amendmentData.signedAt) : "[DATA POR EXTENSO]"}**.

---

**CONTRATANTE**

**[NOME DO ORDENADOR DE DESPESAS]**  
**[CARGO]**  
CPF: [CPF]

---

**CONTRATADA**

**${contractData.contractorName}**  
${contractData.contractorCNPJ ? `CNPJ: ${contractData.contractorCNPJ}` : "CPF: [CPF]"}  
Representante Legal: **[NOME]**  
CPF: [CPF]

---

**TESTEMUNHAS:**

1. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

2. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
`;
}

/**
 * Gerar Termo de Apostilamento
 */
export function generateApostilleTerm(contractData: ContractData, apostilleData: ApostilleData): string {
  const typeLabels = {
    reajuste: "REAJUSTE DE PREÇOS",
    correcao: "CORREÇÃO",
    designacao: "DESIGNAÇÃO DE FISCAL",
    outro: "APOSTILAMENTO"
  };

  let contentText = "";

  if (apostilleData.type === "reajuste") {
    contentText = `**1.1.** Fica reajustado o valor do Contrato em **${apostilleData.indexValue || "[PERCENTUAL]"}%**, com base no índice **${apostilleData.indexType || "[ÍNDICE]"}**, passando o valor total de **${formatCurrency(contractData.currentValue)}** para **${formatCurrency(apostilleData.newTotalValue || contractData.currentValue)}**.

**1.2.** O reajuste tem como base o período de **[MÊS/ANO]** a **[MÊS/ANO]**, conforme previsto na Cláusula Oitava do Contrato original.

**1.3.** O reajuste será aplicado a partir de **[DATA]**.`;
  } else if (apostilleData.type === "correcao") {
    contentText = `**1.1.** ${apostilleData.description}`;
  } else if (apostilleData.type === "designacao") {
    contentText = `**1.1.** Fica designado(a) **[NOME DO NOVO FISCAL]**, matrícula nº **[MATRÍCULA]**, **[CARGO]**, como novo(a) Fiscal do Contrato, em substituição a **${contractData.fiscalUserName || "[FISCAL ANTERIOR]"}**.

**1.2.** O(A) novo(a) Fiscal do Contrato terá as atribuições previstas no art. 117 da Lei nº 14.133/2021 e na Cláusula Sexta do Contrato original.`;
  } else {
    contentText = `**1.1.** ${apostilleData.description}`;
  }

  return `# TERMO DE APOSTILAMENTO Nº ${apostilleData.number}

## AO CONTRATO Nº ${contractData.number}/${contractData.year}

## ${typeLabels[apostilleData.type]}

A **${contractData.organizationName || "[NOME DO ÓRGÃO]"}**, inscrita no CNPJ sob o nº ${contractData.organizationCNPJ || "[CNPJ]"}, neste ato representada por **[NOME DO ORDENADOR DE DESPESAS]**, **[CARGO]**, resolve **APOSTILAR** o **Contrato nº ${contractData.number}/${contractData.year}**, firmado com **${contractData.contractorName}**, ${contractData.contractorCNPJ ? `CNPJ nº ${contractData.contractorCNPJ}` : "pessoa física/jurídica"}, cujo objeto é **${contractData.object}**, para fazer constar o que segue:

---

## CLÁUSULA PRIMEIRA – DO APOSTILAMENTO

${contentText}

---

## CLÁUSULA SEGUNDA – DA FUNDAMENTAÇÃO LEGAL

**2.1.** O presente apostilamento tem fundamento no **art. 136** da Lei nº 14.133, de 1º de abril de 2021, que dispõe sobre alterações contratuais que não modifiquem a essência do contrato.

---

## CLÁUSULA TERCEIRA – DAS DEMAIS CLÁUSULAS

**3.1.** Permanecem inalteradas as demais cláusulas e condições do Contrato original não expressamente modificadas por este Apostilamento.

---

**[CIDADE/UF]**, **${apostilleData.signedAt ? formatDateExtensive(apostilleData.signedAt) : "[DATA POR EXTENSO]"}**.

---

**${contractData.organizationName || "[NOME DO ÓRGÃO]"}**

**[NOME DO ORDENADOR DE DESPESAS]**  
**[CARGO]**  
CPF: [CPF]
`;
}

/**
 * Gerar Termo de Rescisão
 */
export function generateRescissionTerm(contractData: ContractData, rescissionData: RescissionData): string {
  const typeLabels = {
    unilateral: "RESCISÃO UNILATERAL",
    bilateral: "RESCISÃO BILATERAL (AMIGÁVEL)",
    judicial: "RESCISÃO JUDICIAL"
  };

  const typeTexts = {
    unilateral: `A **CONTRATANTE** resolve **RESCINDIR UNILATERALMENTE** o **Contrato nº ${contractData.number}/${contractData.year}**, firmado com **${contractData.contractorName}**, com fundamento no **art. 137, incisos I a XII e XVII, da Lei nº 14.133/2021**.`,
    bilateral: `**${contractData.organizationName || "[NOME DO ÓRGÃO]"}**, doravante denominada **CONTRATANTE**, e **${contractData.contractorName}**, doravante denominada **CONTRATADA**, têm entre si justo e acordado celebrar o presente **TERMO DE RESCISÃO BILATERAL (AMIGÁVEL)** do **Contrato nº ${contractData.number}/${contractData.year}**, com fundamento no **art. 137, inciso XIII, da Lei nº 14.133/2021**.`,
    judicial: `Por força de decisão judicial transitada em julgado, fica **RESCINDIDO** o **Contrato nº ${contractData.number}/${contractData.year}**, firmado entre **${contractData.organizationName || "[NOME DO ÓRGÃO]"}** e **${contractData.contractorName}**.`
  };

  return `# TERMO DE ${typeLabels[rescissionData.type]}

## CONTRATO Nº ${contractData.number}/${contractData.year}

${typeTexts[rescissionData.type]}

---

## CLÁUSULA PRIMEIRA – DO OBJETO DO CONTRATO

**1.1.** O Contrato rescindido tinha por objeto **${contractData.object}**.

**1.2.** O Contrato foi firmado em **${formatDateShort(contractData.startDate)}**, com prazo de vigência até **${formatDateShort(contractData.endDate)}**.

**1.3.** O valor original do Contrato era de **${formatCurrency(contractData.value)}**, sendo o valor atual de **${formatCurrency(contractData.currentValue)}**.

---

## CLÁUSULA SEGUNDA – DO MOTIVO DA RESCISÃO

**2.1.** A rescisão do Contrato fundamenta-se no seguinte:

${rescissionData.reason}

${rescissionData.type === "unilateral" ? `\n**2.2.** A rescisão unilateral está prevista no **art. 137** da Lei nº 14.133/2021, que autoriza a Administração a rescindir o contrato nas hipóteses ali elencadas.` : ""}

${rescissionData.type === "bilateral" ? `\n**2.2.** A rescisão amigável está prevista no **art. 137, inciso XIII**, da Lei nº 14.133/2021, que permite a rescisão por acordo entre as partes.` : ""}

---

## CLÁUSULA TERCEIRA – DA DATA DE VIGÊNCIA DA RESCISÃO

**3.1.** A rescisão do Contrato produzirá efeitos a partir de **${formatDateShort(rescissionData.effectiveDate)}**.

---

${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? `## CLÁUSULA QUARTA – DAS PENALIDADES

**4.1.** Em razão da rescisão, fica a CONTRATADA sujeita ao pagamento de multa compensatória no valor de **${formatCurrency(rescissionData.penaltyAmount)}**, nos termos da Cláusula Nona do Contrato original.

**4.2.** O valor da multa será descontado da garantia contratual ou cobrado administrativamente ou judicialmente.

---

` : ""}## CLÁUSULA ${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "QUINTA" : "QUARTA"} – DAS OBRIGAÇÕES REMANESCENTES

**${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "5" : "4"}.1.** A CONTRATADA permanece responsável:

**a)** Pelos serviços já executados até a data da rescisão;

**b)** Pelos vícios e defeitos dos serviços executados, nos termos da legislação aplicável;

**c)** Pelas obrigações trabalhistas, previdenciárias e fiscais decorrentes da execução do Contrato.

**${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "5" : "4"}.2.** A CONTRATANTE fica obrigada a efetuar o pagamento dos serviços efetivamente executados e aceitos até a data da rescisão, mediante apresentação da documentação fiscal e comprovação de regularidade fiscal.

---

## CLÁUSULA ${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "SEXTA" : "QUINTA"} – DAS DISPOSIÇÕES FINAIS

**${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "6" : "5"}.1.** A rescisão do Contrato não exime as partes das responsabilidades e obrigações decorrentes de sua execução até a data da rescisão.

**${rescissionData.penaltyAmount && rescissionData.penaltyAmount > 0 ? "6" : "5"}.2.** Fica eleito o foro da Comarca de **[CIDADE/UF]** para dirimir quaisquer dúvidas ou controvérsias oriundas deste Termo de Rescisão.

---

${rescissionData.type === "bilateral" ? `E, por estarem assim justos e contratados, assinam o presente instrumento em **2 (duas) vias** de igual teor e forma, na presença das testemunhas abaixo identificadas.

**[CIDADE/UF]**, **${formatDateExtensive(rescissionData.effectiveDate)}**.

---

**CONTRATANTE**

**[NOME DO ORDENADOR DE DESPESAS]**  
**[CARGO]**  
CPF: [CPF]

---

**CONTRATADA**

**${contractData.contractorName}**  
${contractData.contractorCNPJ ? `CNPJ: ${contractData.contractorCNPJ}` : "CPF: [CPF]"}  
Representante Legal: **[NOME]**  
CPF: [CPF]

---

**TESTEMUNHAS:**

1. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

2. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   Nome: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
   CPF: \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_` : `**[CIDADE/UF]**, **${formatDateExtensive(rescissionData.effectiveDate)}**.

---

**${contractData.organizationName || "[NOME DO ÓRGÃO]"}**

**[NOME DO ORDENADOR DE DESPESAS]**  
**[CARGO]**  
CPF: [CPF]`}

${rescissionData.notes ? `\n---\n\n## OBSERVAÇÕES\n\n${rescissionData.notes}` : ""}
`;
}
