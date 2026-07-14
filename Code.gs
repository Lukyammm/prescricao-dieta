/**
 * ============================================================
 * AUTOMAÇÃO DE PRESCRIÇÃO DIETÉTICA - HUC
 * ============================================================
 * Fluxo:
 * 1. Admin faz upload do PDF baixado do sistema (por clínica/setor)
 * 2. Backend converte PDF -> Google Doc (usa OCR/extração de texto)
 * 3. Regex identifica cada paciente e organiza os dados
 * 4. Frontend mostra prévia EDITÁVEL para conferência
 * 5. Admin confirma -> grava na planilha (banco de dados)
 *
 * IMPORTANTE - CONFIGURAÇÃO NECESSÁRIA ANTES DE USAR:
 * 1. No editor do Apps Script: Serviços (ícone +) -> adicionar "Drive API"
 *    (isso habilita a conversão PDF -> texto via OCR do Google)
 * 2. Ajustar a constante SPREADSHEET_ID abaixo com o ID da planilha
 *    (pegue da URL: docs.google.com/spreadsheets/d/AQUI_O_ID/edit)
 * 3. Ajustar SHEET_NAME se sua aba tiver outro nome
 * 4. Ajustar a função salvarNaPlanilha() para bater com as colunas
 *    reais da sua planilha FATURAMENTO (hoje está com uma estrutura
 *    genérica que funciona, mas o ideal é você confirmar comigo as
 *    colunas exatas depois de testar)
 * ============================================================
 */

// ---------- CONFIGURAÇÃO ----------
const SPREADSHEET_ID = '1C4GzyQZV1syk1T-LDAvUeX7tAINyE-ASURxFmBN5QGU'; // TODO: ajustar
const SHEET_NAME = 'Base'; // TODO: ajustar para o nome real da aba

// Ordem das refeições como aparecem no cabeçalho do PDF
const REFEICOES = ['DESJEJUM', 'COLACAO', 'ALMOCO', 'LANCHE', 'JANTAR', 'CEIA'];

// ============================================================
// WEB APP - ENTRADA
// ============================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Automação de Prescrição Dietética - HUC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
// ETAPA 1: RECEBER O PDF E EXTRAIR TEXTO
// ============================================================
/**
 * Recebe o PDF em base64 vindo do frontend, converte em texto
 * usando o truque do Google Docs + OCR, e devolve o texto bruto.
 */
function processarPdf(base64Data, nomeArquivo) {
  try {
    const bytes = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(bytes, 'application/pdf', nomeArquivo);

    const textoExtraido = extrairTextoDoPdf(blob);
    const pacientes = parsearPacientes(textoExtraido);
    const clinica = detectarClinica(textoExtraido);
    const data = detectarData(textoExtraido);

    return {
      sucesso: true,
      clinica: clinica,
      data: data,
      pacientes: pacientes,
      totalPacientes: pacientes.length
    };
  } catch (erro) {
    return {
      sucesso: false,
      erro: erro.message
    };
  }
}

/**
 * Converte o blob do PDF em texto usando o serviço avançado do Drive
 * (Drive API precisa estar habilitada em Serviços no editor do Apps Script)
 */
function extrairTextoDoPdf(blob) {
  const resource = {
    title: 'temp_extracao_' + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS
  };
  const options = {
    ocr: true,
    ocrLanguage: 'pt'
  };

  const arquivoTemp = Drive.Files.insert(resource, blob, options);
  const doc = DocumentApp.openById(arquivoTemp.id);
  const texto = doc.getBody().getText();

  // limpa o arquivo temporário criado no Drive
  Drive.Files.remove(arquivoTemp.id);

  return texto;
}

// ============================================================
// ETAPA 2: PARSING - TRANSFORMAR TEXTO BRUTO EM DADOS ESTRUTURADOS
// ============================================================

function detectarClinica(texto) {
  const match = texto.match(/CL[ÍI]NICA\s*:\s*(.+)/i);
  return match ? match[1].trim().split('\n')[0] : 'NÃO IDENTIFICADA';
}

function detectarData(texto) {
  const match = texto.match(/DATA\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);
  return match ? match[1] : Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy');
}

/**
 * Identifica cada bloco de paciente no texto e extrai:
 * - código do leito/enfermaria
 * - prontuário, nome, idade, nome da mãe
 * - diagnóstico / tipo de dieta
 * - conteúdo de cada refeição (na ordem em que aparece no texto)
 *
 * ATENÇÃO: a ordem das refeições extraídas do texto PODE não bater
 * 100% com a ordem visual da tabela (é uma limitação de extração de
 * PDF, não do código). Por isso a etapa de revisão no frontend é
 * OBRIGATÓRIA antes de gravar.
 */
function parsearPacientes(texto) {
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const pacientes = [];

  // Padrão do código de leito/enfermaria: ex B500.03, A501.01, C700.03,
  // EXTRA.EXT01, ou variações tipo "OBS BREVE 01- CIRÚRGICA I.01"
  const padraoLeito = /^([A-Z]{1,10}\.?\s?\d{0,4}\.\d{2}|EXTRA\.\s?EXT\d{2})$/i;

  // Padrão da linha de identificação do paciente:
  // NUMERO-NOME-IDADE ano(s)...-NOME DA MAE
  const padraoPaciente = /^(\d{3,6})\s*-\s*(.+?)-\s*(\d{1,3}\s*ano\(s\).+?)-\s*(.+)$/i;

  let indiceAtual = 0;

  while (indiceAtual < linhas.length) {
    const linha = linhas[indiceAtual];
    const matchPaciente = linha.match(padraoPaciente);

    if (matchPaciente) {
      const paciente = {
        prontuario: matchPaciente[1].trim(),
        nome: matchPaciente[2].trim(),
        idade: matchPaciente[3].trim(),
        nomeMae: matchPaciente[4].trim(),
        leito: '',
        diagnostico: '',
        tipoDieta: '',
        refeicoes: {
          DESJEJUM: '',
          COLACAO: '',
          ALMOCO: '',
          LANCHE: '',
          JANTAR: '',
          CEIA: ''
        }
      };

      // procura o código de leito nas próximas linhas
      let j = indiceAtual + 1;
      while (j < linhas.length && j < indiceAtual + 3) {
        if (padraoLeito.test(linhas[j])) {
          paciente.leito = linhas[j];
          break;
        }
        j++;
      }

      // a partir daqui, coleta os blocos ORAL/ENTERAL/MISTA até
      // encontrar o próximo paciente (ou fim do texto)
      const blocos = [];
      let k = j + 1;
      while (k < linhas.length && !padraoPaciente.test(linhas[k])) {
        blocos.push(linhas[k]);
        k++;
      }

      // separa via/rota de alimentação (ORAL, ENTERAL, MISTA)
      // do conteúdo de diagnóstico + refeições
      const rotaRegex = /^(ORAL|ENTERAL|MISTA)$/i;
      let segmentos = [];
      let segmentoAtual = [];

      blocos.forEach(l => {
        if (rotaRegex.test(l)) {
          if (segmentoAtual.length > 0) {
            segmentos.push(segmentoAtual.join(' '));
          }
          segmentoAtual = [];
        } else {
          segmentoAtual.push(l);
        }
      });
      if (segmentoAtual.length > 0) segmentos.push(segmentoAtual.join(' '));

      // primeiro segmento = diagnóstico + tipo de dieta
      if (segmentos.length > 0) {
        paciente.diagnostico = segmentos[0];
      }

      // segmentos seguintes = refeições, na ordem em que aparecem
      // (mapeadas na ordem padrão DESJEJUM->CEIA; CONFERIR na revisão)
      for (let m = 0; m < REFEICOES.length; m++) {
        if (segmentos[m + 1]) {
          paciente.refeicoes[REFEICOES[m]] = segmentos[m + 1];
        }
      }

      pacientes.push(paciente);
      indiceAtual = k;
    } else {
      indiceAtual++;
    }
  }

  return pacientes;
}

// ============================================================
// ETAPA 3: GRAVAR NA PLANILHA (após confirmação do admin)
// ============================================================
/**
 * Recebe os dados já revisados/corrigidos pelo admin no frontend
 * e grava uma linha por paciente na planilha.
 *
 * ATENÇÃO: ajustar a ordem/nome das colunas abaixo para bater
 * exatamente com a estrutura real da planilha FATURAMENTO.
 * Esta é uma estrutura genérica de exemplo.
 */
function salvarNaPlanilha(dados) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      throw new Error('Aba "' + SHEET_NAME + '" não encontrada na planilha.');
    }

    const linhas = dados.pacientes.map(p => [
      dados.data,
      dados.clinica,
      p.leito,
      p.prontuario,
      p.nome,
      p.idade,
      p.diagnostico,
      p.refeicoes.DESJEJUM,
      p.refeicoes.COLACAO,
      p.refeicoes.ALMOCO,
      p.refeicoes.LANCHE,
      p.refeicoes.JANTAR,
      p.refeicoes.CEIA
    ]);

    if (linhas.length > 0) {
      const proximaLinha = sheet.getLastRow() + 1;
      sheet.getRange(proximaLinha, 1, linhas.length, linhas[0].length)
        .setValues(linhas);
    }

    return {
      sucesso: true,
      linhasGravadas: linhas.length
    };
  } catch (erro) {
    return {
      sucesso: false,
      erro: erro.message
    };
  }
}
