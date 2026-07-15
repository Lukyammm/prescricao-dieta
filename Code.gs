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
 * IMPORTANTE - INFORMAÇÕES DE USO:
 * O script configura a planilha (cria aba 'Base' e cabeçalhos)
 * no primeiro acesso automaticamente. Não é necessário
 * configurar IDs ou habilitar a API do Drive manualmente.
 * ============================================================
 */

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
const MAX_BASE64_CHARS = 30 * 1024 * 1024; // ~22MB decodificado, com margem de segurança

function processarPdf(base64Data, nomeArquivo) {
  try {
    if (!base64Data) {
      return { sucesso: false, erro: 'Nenhum arquivo recebido.' };
    }
    if (base64Data.length > MAX_BASE64_CHARS) {
      return { sucesso: false, erro: 'Arquivo muito grande. Envie um PDF com até ~20MB.' };
    }

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
 * Converte o blob do PDF em texto usando a Drive API v3 via UrlFetchApp.
 * Isso evita a necessidade de habilitar o serviço avançado do Drive manualmente.
 */
function extrairTextoDoPdf(blob) {
  // Chamada fantasma ao DriveApp para forçar o Apps Script a
  // pedir as permissões de escopo do Drive no momento da autorização
  DriveApp.getRootFolder();

  const metadados = {
    name: 'temp_extracao_' + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS
  };

  const formData = {
    metadata: Utilities.newBlob(JSON.stringify(metadados), 'application/json'),
    file: blob
  };

  const token = ScriptApp.getOAuthToken();
  const options = {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: formData,
    muteHttpExceptions: true
  };

  // Faz o upload com OCR via API do Google Drive
  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true';
  const response = UrlFetchApp.fetch(url, options);

  if (response.getResponseCode() !== 200) {
    throw new Error('Erro na API do Drive: ' + response.getContentText());
  }

  const arquivo = JSON.parse(response.getContentText());

  try {
    // Extrai o texto do documento criado
    const doc = DocumentApp.openById(arquivo.id);
    return doc.getBody().getText();
  } finally {
    // Limpa o arquivo temporário mesmo se a extração acima falhar,
    // para não deixar arquivos órfãos no Drive
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + arquivo.id, {
      method: 'delete',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
  }
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
 * Garante que a aba 'Base' exista e tenha cabeçalho
 */
function garantirAbaConfigurada() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Base');

  if (!sheet) {
    sheet = ss.insertSheet('Base');
    const cabecalho = [
      'Data', 'Clínica', 'Leito', 'Prontuário', 'Nome do Paciente',
      'Idade', 'Diagnóstico/Dieta', 'Desjejum', 'Colação', 'Almoço',
      'Lanche', 'Jantar', 'Ceia'
    ];
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Auto-ajustar algumas colunas
    sheet.setColumnWidth(5, 250); // Nome
    sheet.setColumnWidth(7, 200); // Diagnóstico
  }
  return sheet;
}

/**
 * Neutraliza valores que começam com =, +, -, @ (ou espaço/tab seguido
 * deles) para evitar injeção de fórmula na planilha (CSV/Sheets injection).
 * Tanto o setValues() do Apps Script quanto uma futura exportação/abertura
 * em Excel podem interpretar esse tipo de valor como fórmula executável.
 */
function sanitizarValorCelula(valor) {
  if (typeof valor !== 'string') return valor;
  return /^\s*[=+\-@]/.test(valor) ? "'" + valor : valor;
}

/**
 * Recebe os dados já revisados/corrigidos pelo admin no frontend
 * e grava uma linha por paciente na planilha vinculada.
 */
function salvarNaPlanilha(dados) {
  if (!dados || !Array.isArray(dados.pacientes)) {
    return { sucesso: false, erro: 'Dados inválidos recebidos do frontend.' };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (erroLock) {
    return {
      sucesso: false,
      erro: 'A planilha está sendo atualizada por outra pessoa. Tente novamente em instantes.'
    };
  }

  try {
    const sheet = garantirAbaConfigurada();

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
    ].map(sanitizarValorCelula));

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
  } finally {
    lock.releaseLock();
  }
}
