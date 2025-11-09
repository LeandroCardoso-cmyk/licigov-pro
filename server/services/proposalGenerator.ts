/**
 * Serviço de geração de proposta comercial e documentos relacionados
 * 
 * Gera automaticamente:
 * - Proposta Comercial (PDF)
 * - Minuta de Contrato (DOCX)
 * - Termo de Referência (DOCX)
 * 
 * Todos os documentos incluem justificativa técnica baseada na Lei 14.133/2021
 */

import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

interface ProposalData {
  orgaoNome: string;
  orgaoCnpj: string;
  orgaoEndereco: string;
  orgaoCidade: string;
  orgaoEstado: string;
  orgaoCep: string;
  responsavelNome: string;
  responsavelCargo?: string;
  responsavelEmail: string;
  responsavelTelefone: string;
  planName: string;
  planPrice: number; // em centavos
  planSlug: string;
}

/**
 * Gera proposta comercial em PDF
 */
export async function generatePropostaComercial(data: ProposalData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const priceInReais = (data.planPrice / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

    // Cabeçalho
    doc.fontSize(20).font('Helvetica-Bold').text('PROPOSTA COMERCIAL', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).font('Helvetica').text(`Proposta Nº: ${Date.now()}`, { align: 'right' });
    doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
    doc.moveDown(2);

    // Dados do contratante
    doc.fontSize(14).font('Helvetica-Bold').text('1. DADOS DO CONTRATANTE');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Órgão: ${data.orgaoNome}`);
    doc.text(`CNPJ: ${data.orgaoCnpj}`);
    doc.text(`Endereço: ${data.orgaoEndereco}, ${data.orgaoCidade}/${data.orgaoEstado}, CEP: ${data.orgaoCep}`);
    doc.text(`Responsável: ${data.responsavelNome}${data.responsavelCargo ? ` - ${data.responsavelCargo}` : ''}`);
    doc.text(`E-mail: ${data.responsavelEmail}`);
    doc.text(`Telefone: ${data.responsavelTelefone}`);
    doc.moveDown(2);

    // Dados do contratado
    doc.fontSize(14).font('Helvetica-Bold').text('2. DADOS DO CONTRATADO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text('Razão Social: [SUA EMPRESA LTDA]');
    doc.text('CNPJ: [XX.XXX.XXX/0001-XX]');
    doc.text('Endereço: [SEU ENDEREÇO COMPLETO]');
    doc.text('E-mail: contato@licigov.com.br');
    doc.text('Telefone: (XX) XXXX-XXXX');
    doc.moveDown(2);

    // Objeto da contratação
    doc.fontSize(14).font('Helvetica-Bold').text('3. OBJETO DA CONTRATAÇÃO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      'Contratação de solução tecnológica em nuvem (SaaS) para gestão e automação de processos licitatórios, ' +
      'incluindo geração automatizada de documentos (ETP, TR, DFD e Edital), gestão de contratos, pareceres jurídicos, ' +
      'plano de contratações anual (PCA) e demais funcionalidades descritas no Termo de Referência anexo.',
      { align: 'justify' }
    );
    doc.moveDown(2);

    // Descrição da solução
    doc.fontSize(14).font('Helvetica-Bold').text('4. DESCRIÇÃO DA SOLUÇÃO');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      'O LiciGov Pro é uma plataforma completa de gestão de licitações que utiliza inteligência artificial para automatizar ' +
      'a elaboração de documentos licitatórios em conformidade com a Lei Federal nº 14.133/2021 (Nova Lei de Licitações). ' +
      'A solução oferece:',
      { align: 'justify' }
    );
    doc.moveDown(0.5);
    doc.list([
      'Geração automatizada de documentos licitatórios (ETP, TR, DFD, Edital)',
      'Sistema de colaboração com controle de permissões',
      'Versionamento e histórico completo de alterações',
      'Gestão de contratos e acompanhamento de vigências',
      'Geração de pareceres jurídicos automatizados',
      'Elaboração de Plano de Contratações Anual (PCA)',
      'Gestão de departamento com quadro Kanban',
      'Conformidade total com LGPD',
      'Suporte técnico especializado',
    ]);
    doc.moveDown(2);

    // Justificativa técnica
    doc.fontSize(14).font('Helvetica-Bold').text('5. JUSTIFICATIVA TÉCNICA E LEGAL');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(
      'A contratação da solução LiciGov Pro justifica-se pela necessidade de modernização e eficiência dos processos ' +
      'licitatórios do órgão, em conformidade com os princípios da Administração Pública previstos no art. 37 da ' +
      'Constituição Federal e nos arts. 11 e 12 da Lei nº 14.133/2021.',
      { align: 'justify' }
    );
    doc.moveDown(0.5);
    doc.text(
      'Fundamentos legais:',
      { underline: true }
    );
    doc.moveDown(0.5);
    doc.text(
      '• Art. 18 da Lei 14.133/2021: Estabelece a obrigatoriedade do Estudo Técnico Preliminar (ETP) para todas as ' +
      'contratações, documento que a solução gera automaticamente com base em inteligência artificial.',
      { align: 'justify' }
    );
    doc.moveDown(0.5);
    doc.text(
      '• Art. 19 da Lei 14.133/2021: Define a necessidade de elaboração do Termo de Referência (TR) ou Projeto Básico, ' +
      'documentos que a plataforma produz em conformidade com os requisitos legais.',
      { align: 'justify' }
    );
    doc.moveDown(0.5);
    doc.text(
      '• Art. 12, inciso VIII, da Lei 14.133/2021: Determina a elaboração do Plano de Contratações Anual (PCA), ' +
      'funcionalidade integrada na solução.',
      { align: 'justify' }
    );
    doc.moveDown(0.5);
    doc.text(
      '• Art. 75, inciso II, da Lei 14.133/2021: Permite a contratação direta por dispensa de licitação para serviços ' +
      'e compras de pequeno valor (até R$ 54.000,00 para outros órgãos da Administração Pública).',
      { align: 'justify' }
    );
    doc.moveDown(2);

    // Plano contratado
    doc.fontSize(14).font('Helvetica-Bold').text('6. PLANO CONTRATADO E VALOR');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Plano: ${data.planName}`);
    doc.text(`Valor Anual: ${priceInReais}`);
    doc.text('Forma de Pagamento: Pagamento anual antecipado via empenho');
    doc.text('Vigência: 12 (doze) meses a partir da data de ativação');
    doc.moveDown(2);

    // Validade da proposta
    doc.fontSize(14).font('Helvetica-Bold').text('7. VALIDADE DA PROPOSTA');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text('Esta proposta tem validade de 30 (trinta) dias a partir da data de emissão.');
    doc.moveDown(2);

    // Dados bancários
    doc.fontSize(14).font('Helvetica-Bold').text('8. DADOS BANCÁRIOS');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text('Banco: [BANCO]');
    doc.text('Agência: [XXXX]');
    doc.text('Conta Corrente: [XXXXX-X]');
    doc.text('PIX (CNPJ): [XX.XXX.XXX/0001-XX]');
    doc.moveDown(2);

    // Assinatura
    doc.moveDown(3);
    doc.text('_'.repeat(50), { align: 'center' });
    doc.text('[SEU NOME COMPLETO]', { align: 'center' });
    doc.text('[SEU CARGO]', { align: 'center' });
    doc.text('[SUA EMPRESA LTDA]', { align: 'center' });

    doc.end();
  });
}

/**
 * Gera minuta de contrato em DOCX
 */
export async function generateMinutaContrato(data: ProposalData): Promise<Buffer> {
  const priceInReais = (data.planPrice / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'MINUTA DE CONTRATO',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE SOFTWARE COMO SERVIÇO (SaaS)',
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: `Contrato que entre si celebram ${data.orgaoNome}, doravante denominado CONTRATANTE, e [SUA EMPRESA LTDA], doravante denominada CONTRATADA, para prestação de serviços de software como serviço (SaaS) para gestão de processos licitatórios, mediante as cláusulas e condições seguintes:`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA PRIMEIRA – DO OBJETO',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '1.1. O objeto do presente contrato é a prestação de serviços de software como serviço (SaaS) para gestão e automação de processos licitatórios, conforme especificações constantes no Termo de Referência anexo.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: `1.2. Plano contratado: ${data.planName}`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA SEGUNDA – DO VALOR E FORMA DE PAGAMENTO',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: `2.1. O valor total do contrato é de ${priceInReais} (valor por extenso), referente à assinatura anual do plano ${data.planName}.`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '2.2. O pagamento será realizado mediante empenho, em parcela única, no prazo de até 30 (trinta) dias após a emissão da nota fiscal.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA TERCEIRA – DA VIGÊNCIA',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '3.1. O presente contrato terá vigência de 12 (doze) meses, contados a partir da data de ativação do acesso à plataforma.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '3.2. O contrato poderá ser renovado por iguais períodos, mediante acordo entre as partes e disponibilidade orçamentária.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA QUARTA – DAS OBRIGAÇÕES DA CONTRATADA',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '4.1. Disponibilizar acesso à plataforma LiciGov Pro em até 48 (quarenta e oito) horas após confirmação do pagamento.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '4.2. Garantir disponibilidade mínima de 98% (noventa e oito por cento) da plataforma.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '4.3. Prestar suporte técnico conforme especificado no plano contratado.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '4.4. Manter a confidencialidade e segurança dos dados do CONTRATANTE, em conformidade com a Lei Geral de Proteção de Dados (LGPD).',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA QUINTA – DAS OBRIGAÇÕES DO CONTRATANTE',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '5.1. Efetuar o pagamento na forma e prazo estabelecidos.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '5.2. Utilizar a plataforma em conformidade com os termos de uso e legislação vigente.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '5.3. Manter atualizados os dados cadastrais e de contato.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA SEXTA – DA RESCISÃO',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '6.1. O presente contrato poderá ser rescindido por qualquer das partes, mediante notificação prévia de 30 (trinta) dias.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '6.2. Em caso de rescisão antecipada pelo CONTRATANTE, não haverá devolução de valores já pagos.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: 'CLÁUSULA SÉTIMA – DO FORO',
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: `7.1. Fica eleito o foro da Comarca de ${data.orgaoCidade}/${data.orgaoEstado} para dirimir quaisquer dúvidas ou controvérsias oriundas do presente contrato.`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: `E, por estarem assim justos e contratados, assinam o presente instrumento em 2 (duas) vias de igual teor e forma, na presença de 2 (duas) testemunhas.`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: `${data.orgaoCidade}/${data.orgaoEstado}, ${new Date().toLocaleDateString('pt-BR')}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: '_'.repeat(50),
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: data.orgaoNome,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: 'CONTRATANTE',
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '_'.repeat(50),
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: '[SUA EMPRESA LTDA]',
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: 'CONTRATADA',
            alignment: AlignmentType.CENTER,
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Gera Termo de Referência em DOCX
 */
export async function generateTermoReferencia(data: ProposalData): Promise<Buffer> {
  const priceInReais = (data.planPrice / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'TERMO DE REFERÊNCIA',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: 'CONTRATAÇÃO DE SOLUÇÃO TECNOLÓGICA PARA GESTÃO DE PROCESSOS LICITATÓRIOS',
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: '1. DO OBJETO',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '1.1. Contratação de solução tecnológica em nuvem (Software as a Service - SaaS) para gestão e automação de processos licitatórios, incluindo geração automatizada de documentos, gestão de contratos, pareceres jurídicos e demais funcionalidades especificadas neste Termo.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '2. DA JUSTIFICATIVA',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '2.1. A contratação justifica-se pela necessidade de modernização e otimização dos processos licitatórios do órgão, visando maior eficiência, transparência e conformidade com a Lei Federal nº 14.133/2021.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: '2.2. A solução proposta automatiza a elaboração de documentos obrigatórios (ETP, TR, DFD, Edital), reduzindo significativamente o tempo de trabalho manual e minimizando erros.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '3. DA DESCRIÇÃO DA SOLUÇÃO',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '3.1. A solução deverá oferecer, no mínimo, as seguintes funcionalidades:',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: 'a) Geração automatizada de Estudo Técnico Preliminar (ETP) conforme art. 18 da Lei 14.133/2021;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'b) Geração automatizada de Termo de Referência (TR) conforme art. 19 da Lei 14.133/2021;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'c) Geração automatizada de Documento de Formalização da Demanda (DFD);',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'd) Geração automatizada de Minutas de Edital;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'e) Sistema de colaboração com controle de permissões;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'f) Versionamento e histórico de alterações de documentos;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'g) Gestão de contratos com acompanhamento de vigências;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'h) Elaboração de Plano de Contratações Anual (PCA) conforme art. 12, VIII, da Lei 14.133/2021;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'i) Conformidade com a Lei Geral de Proteção de Dados (LGPD);',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'j) Suporte técnico especializado.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '4. DO VALOR ESTIMADO',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: `4.1. O valor estimado para a contratação é de ${priceInReais} anuais, referente ao plano ${data.planName}.`,
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '5. DA VIGÊNCIA',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '5.1. O contrato terá vigência de 12 (doze) meses, podendo ser prorrogado mediante acordo entre as partes.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '6. DA FORMA DE PAGAMENTO',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '6.1. O pagamento será realizado em parcela única anual, mediante empenho, no prazo de até 30 (trinta) dias após a emissão da nota fiscal.',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 200 },
          }),
          new Paragraph({
            text: '7. DA FUNDAMENTAÇÃO LEGAL',
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 200, after: 100 },
          }),
          new Paragraph({
            text: '7.1. A contratação fundamenta-se nos seguintes dispositivos legais:',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 100 },
          }),
          new Paragraph({
            text: 'a) Lei Federal nº 14.133/2021 (Nova Lei de Licitações), especialmente os arts. 12, 18, 19 e 75;',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'b) Lei Federal nº 13.709/2018 (Lei Geral de Proteção de Dados - LGPD);',
            alignment: AlignmentType.JUSTIFIED,
          }),
          new Paragraph({
            text: 'c) Constituição Federal, art. 37 (princípios da Administração Pública).',
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: `${data.orgaoCidade}/${data.orgaoEstado}, ${new Date().toLocaleDateString('pt-BR')}`,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new Paragraph({
            text: '_'.repeat(50),
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: data.responsavelNome,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: data.responsavelCargo || 'Responsável',
            alignment: AlignmentType.CENTER,
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
