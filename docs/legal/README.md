# Legal — Documentação

## Base Legal

### Lei 14.133/2021 — Nova Lei de Licitações e Contratos

A principal referência legal do LiciGov Pro. Principais dispositivos implementados:

| Artigo | Tema | Implementação |
|--------|------|--------------|
| Art. 6° | Definições (TR, ETP, DFD) | Tipos de documento: `tr`, `etp`, `dfd` |
| Art. 18 | Fase preparatória | Workflow documental |
| Art. 23 | Pesquisa de preços | Motor de importação CSV/XLSX |
| Art. 37 | Publicidade | Export e renderização de documentos |
| Art. 72 | Fiscalização | Activity logs imutáveis |
| Art. 89 | Prazo de vigência | RetentionPolicy `legal_permanent` |

### LGPD — Lei 13.709/2018

| Artigo | Tema | Implementação |
|--------|------|--------------|
| Art. 6° | Princípios | Minimização de dados, finalidade |
| Art. 37 | Registro de operações | Activity logs imutáveis |
| Art. 40 | Portabilidade | Export de dados por organização |
| Art. 46 | Segurança | Criptografia, bcrypt, hash de integridade |
| Art. 55 | Retenção | RetentionPolicy com 7 classes |

## RetentionPolicy por Tipo de Documento

| Tipo | Classe | Base Legal | Prazo |
|------|--------|-----------|-------|
| contrato | legal_permanent | Lei 14.133/2021, Art. 89 | Permanente |
| aditivo | legal_permanent | Lei 14.133/2021 | Permanente |
| edital | legal_permanent | Lei 14.133/2021 | Permanente |
| parecer | legal_7years | Decreto 9.094/2017 | 7 anos |
| ata | legal_7years | TCU | 7 anos |
| tr, etp, dfd | operational_3years | Prática administrativa | 3 anos |

## Conformidade em Auditoria

O LiciGov Pro gera evidências de conformidade via:
1. **Activity logs** imutáveis com timestamp, ator e contexto
2. **Document timeline** com todas as mudanças de status
3. **Versões imutáveis** de documentos
4. **Integrity fingerprints** SHA-256 por versão
5. **Export** de documentos em formatos legalmente aceitos (DOCX, PDF)

## Avisos

> Este sistema é uma ferramenta de apoio administrativo. Não constitui assessoria jurídica. Decisões de conformidade legal devem ser validadas pelo setor jurídico da organização.
