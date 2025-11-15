/**
 * Serviço para gerar ZIP contendo proposta + documentos da empresa
 */

import archiver from 'archiver';
import { Readable } from 'stream';
import * as db from '../db';
import { generatePropostaComercial, generateMinutaContrato, generateTermoReferencia } from './proposalGenerator';
import { storageGet } from '../storage';

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
  planPrice: number;
  planSlug: string;
}

/**
 * Gera ZIP contendo:
 * - Proposta Comercial (PDF)
 * - Minuta de Contrato (DOCX)
 * - Termo de Referência (DOCX)
 * - Documentos da empresa (certidões, CNPJ, etc.)
 */
export async function generateProposalZip(proposalData: ProposalData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      // Gerar documentos da proposta
      const [propostaBuffer, contratoBuffer, trBuffer] = await Promise.all([
        generatePropostaComercial(proposalData),
        generateMinutaContrato(proposalData),
        generateTermoReferencia(proposalData),
      ]);

      // Buscar documentos da empresa
      const companyDocs = await db.getAllCompanyDocuments();

      // Criar ZIP
      const archive = archiver('zip', {
        zlib: { level: 9 } // Máxima compressão
      });

      const chunks: Buffer[] = [];
      
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      // Adicionar documentos da proposta
      archive.append(propostaBuffer, { name: '1-Proposta-Comercial.pdf' });
      archive.append(contratoBuffer, { name: '2-Minuta-Contrato.docx' });
      archive.append(trBuffer, { name: '3-Termo-Referencia.docx' });

      // Adicionar documentos da empresa
      if (companyDocs && companyDocs.length > 0) {
        for (const doc of companyDocs) {
          if (doc.fileKey) {
            try {
              // Buscar arquivo do S3
              const { url } = await storageGet(doc.fileKey);
              
              // Fazer download do arquivo
              const response = await fetch(url);
              if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                const fileName = doc.fileName || `${doc.type}.pdf`;
                archive.append(buffer, { name: `Documentos-Empresa/${fileName}` });
              }
            } catch (error) {
              console.error(`Erro ao adicionar documento ${doc.type}:`, error);
              // Continua mesmo se um documento falhar
            }
          }
        }
      }

      // Finalizar ZIP
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
}
