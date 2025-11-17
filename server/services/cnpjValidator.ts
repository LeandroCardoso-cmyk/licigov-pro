/**
 * Serviço de validação de CNPJ
 * Valida formato e dígitos verificadores
 */

/**
 * Remove caracteres não numéricos do CNPJ
 */
export function cleanCNPJ(cnpj: string): string {
  return cnpj.replace(/[^\d]/g, "");
}

/**
 * Formata CNPJ para exibição (00.000.000/0000-00)
 */
export function formatCNPJ(cnpj: string): string {
  const cleaned = cleanCNPJ(cnpj);
  if (cleaned.length !== 14) return cnpj;
  
  return cleaned.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

/**
 * Valida formato e dígitos verificadores do CNPJ
 */
export function validateCNPJ(cnpj: string): {
  isValid: boolean;
  error?: string;
} {
  const cleaned = cleanCNPJ(cnpj);

  // Verifica se tem 14 dígitos
  if (cleaned.length !== 14) {
    return {
      isValid: false,
      error: "CNPJ deve conter 14 dígitos",
    };
  }

  // Verifica se todos os dígitos são iguais (CNPJ inválido)
  if (/^(\d)\1{13}$/.test(cleaned)) {
    return {
      isValid: false,
      error: "CNPJ inválido (todos os dígitos iguais)",
    };
  }

  // Validação dos dígitos verificadores
  const digits = cleaned.split("").map(Number);

  // Primeiro dígito verificador
  let sum = 0;
  let weight = 5;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const firstDigit = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  if (firstDigit !== digits[12]) {
    return {
      isValid: false,
      error: "CNPJ inválido (primeiro dígito verificador incorreto)",
    };
  }

  // Segundo dígito verificador
  sum = 0;
  weight = 6;
  for (let i = 0; i < 13; i++) {
    sum += digits[i] * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const secondDigit = sum % 11 < 2 ? 0 : 11 - (sum % 11);

  if (secondDigit !== digits[13]) {
    return {
      isValid: false,
      error: "CNPJ inválido (segundo dígito verificador incorreto)",
    };
  }

  return {
    isValid: true,
  };
}

/**
 * Consulta dados do CNPJ na Receita Federal (API pública)
 * Nota: Esta API pode estar instável ou indisponível
 */
export async function consultCNPJ(cnpj: string): Promise<{
  success: boolean;
  data?: {
    razaoSocial: string;
    nomeFantasia?: string;
    cnpj: string;
    situacao: string;
    endereco?: string;
    municipio?: string;
    uf?: string;
  };
  error?: string;
}> {
  const cleaned = cleanCNPJ(cnpj);

  // Valida formato primeiro
  const validation = validateCNPJ(cleaned);
  if (!validation.isValid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  try {
    // API pública da Receita Federal (não oficial)
    // Alternativas: https://www.receitaws.com.br/v1/cnpj/{cnpj}
    // Nota: Esta API pode ter limitações de rate limit
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleaned}`);

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: "CNPJ não encontrado na Receita Federal",
        };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      data: {
        razaoSocial: data.razao_social || data.nome_empresarial,
        nomeFantasia: data.nome_fantasia,
        cnpj: formatCNPJ(data.cnpj),
        situacao: data.descricao_situacao_cadastral || data.situacao,
        endereco: data.logradouro
          ? `${data.logradouro}, ${data.numero || "S/N"}${data.complemento ? ` - ${data.complemento}` : ""}`
          : undefined,
        municipio: data.municipio,
        uf: data.uf,
      },
    };
  } catch (error: any) {
    console.error("Erro ao consultar CNPJ:", error);
    return {
      success: false,
      error: "Erro ao consultar CNPJ na Receita Federal. Tente novamente mais tarde.",
    };
  }
}
