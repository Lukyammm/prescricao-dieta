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

// O cabeçalho do relatório sai como "{NOME DA CLÍNICA}{DD/MM/AAAA}DATA: CLÍNICA:"
// (valor colado antes dos rótulos, sem separador) — confirmado a partir de PDFs
// reais exportados pelo sistema.
function detectarClinica(texto) {
  const match = texto.match(/^(.*?)(\d{2}\/\d{2}\/\d{4})\s*DATA:\s*CL[ÍI]NICA:\s*$/im);
  return match ? match[1].trim() : 'NÃO IDENTIFICADA';
}

function detectarData(texto) {
  const match = texto.match(/(\d{2}\/\d{2}\/\d{4})\s*DATA:\s*CL[ÍI]NICA:/i);
  return match ? match[1] : Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy');
}

// Linhas fixas de cabeçalho/rodapé que se repetem em toda página do relatório
// e não fazem parte de nenhum paciente — descartadas antes do parsing.
const LINHAS_IGNORADAS = [
  /^ENF\s+PRONT\/PACIENTE/i,
  /^Legenda:/i,
  /^Obs:\s*sopa inteira/i,
  /RELAT[ÓO]RIO PRESCRI[ÇC][ÃA]O DIET[ÉE]TICA/i,
  /^24\s*HRS\s*OBS\s*ACEIT\/COND/i,
  /^TIPO DE DIETA:/i,
  /DATA:\s*CL[ÍI]NICA:/i
];

// Marcador exclusivo (token que nunca aparece em texto real) para linhas que
// são EXATAMENTE a via de alimentação (ORAL/ENTERAL/MISTA como célula
// própria da tabela). Precisa ser inconfundível com texto comum porque a
// via também aparece como PALAVRA dentro do diagnóstico
// (ex: "DIETA ORAL - DE ACORDO COM..."), e ali NÃO é separador de refeição.
const ROTA_MARCADORES = {
  ORAL: '@@ROTA_ORAL@@',
  ENTERAL: '@@ROTA_ENTERAL@@',
  MISTA: '@@ROTA_MISTA@@'
};
const padraoRotaExata = /^(ORAL|ENTERAL|MISTA)$/i;

function linhasRelevantes(texto) {
  return texto.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !LINHAS_IGNORADAS.some(r => r.test(l)))
    .map(l => padraoRotaExata.test(l) ? ROTA_MARCADORES[l.toUpperCase()] : l);
}

// Códigos de leito observados: curto (1 letra + 3 dígitos, ex A514.02),
// EXTRA.EXTxx, ou o nome do setor repetido (ex "OBS BREVE 01- CIRÚRGICA I.01").
// Como o PDF às vezes gruda o código no final do nome da mãe sem espaço
// (ex "...DE LIMAA514.02"), a separação é feita por sufixo, não por linha inteira.
const padraoLeitoExtra = /(EXTRA\.\s?EXT\d{2})\s*$/i;
const padraoLeitoLongo = /(OBS\s*BREVE\s*\d{2}\s*-?\s*[A-ZÇÁÉÍÓÚÂÊÎÔÛÃÕÀ\s]{2,40}?\.\d{2})\s*$/i;
const padraoLeitoCurto = /([A-Z]\d{3}\.\d{2})\s*$/i;

function separarLeito(textoComLeito) {
  const padroes = [padraoLeitoExtra, padraoLeitoLongo, padraoLeitoCurto];
  for (let i = 0; i < padroes.length; i++) {
    const m = textoComLeito.match(padroes[i]);
    if (m) {
      return {
        nomeMae: textoComLeito.slice(0, m.index).trim(),
        leito: m[1].replace(/\s+/g, ' ').trim()
      };
    }
  }
  return { nomeMae: textoComLeito.trim(), leito: '' };
}

const padraoInicioPaciente = /^(\d{3,6})\s*-/;
const padraoIdentidade = /^(\d{3,6})\s*-\s*(.+?)-\s*(\d{1,3}\s*ano\(s\).*?)-\s*(.+?)(?=@@ROTA_(?:ORAL|ENTERAL|MISTA)@@|$)/i;

/**
 * Identifica cada bloco de paciente no texto e extrai:
 * - código do leito/enfermaria
 * - prontuário, nome, idade, nome da mãe
 * - diagnóstico / tipo de dieta
 * - conteúdo de cada refeição (na ordem em que aparece no texto)
 *
 * O texto extraído do PDF quebra cada célula da tabela em várias linhas
 * (largura da coluna, não pontuação), então a identificação do paciente e
 * do leito frequentemente fica espalhada por várias linhas — por isso cada
 * bloco de paciente é primeiro unido em uma única string antes de aplicar
 * os padrões acima.
 *
 * ATENÇÃO: a ordem das refeições extraídas do texto PODE não bater
 * 100% com a ordem visual da tabela (é uma limitação de extração de
 * PDF, não do código). Por isso a etapa de revisão no frontend é
 * OBRIGATÓRIA antes de gravar.
 */
function parsearPacientes(texto) {
  const linhas = linhasRelevantes(texto);
  const inicios = [];
  linhas.forEach((l, i) => { if (padraoInicioPaciente.test(l)) inicios.push(i); });

  const pacientes = [];

  for (let b = 0; b < inicios.length; b++) {
    const inicio = inicios[b];
    const fim = b + 1 < inicios.length ? inicios[b + 1] : linhas.length;
    const blocoJunto = linhas.slice(inicio, fim).join(' ').replace(/\s+/g, ' ').trim();

    const matchIdentidade = blocoJunto.match(padraoIdentidade);
    if (!matchIdentidade) continue; // formato inesperado nesse bloco; fica para a revisão manual

    const { nomeMae, leito } = separarLeito(matchIdentidade[4]);

    const paciente = {
      prontuario: matchIdentidade[1].trim(),
      nome: matchIdentidade[2].trim(),
      idade: matchIdentidade[3].trim(),
      nomeMae: nomeMae,
      leito: leito,
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

    // separa via/rota de alimentação (ORAL, ENTERAL, MISTA) do conteúdo
    // de diagnóstico + refeições, usando os marcadores exclusivos
    const restante = blocoJunto.slice(matchIdentidade[0].length);
    const partes = restante.split(/@@ROTA_(?:ORAL|ENTERAL|MISTA)@@/);
    const segmentos = partes.slice(1).map(s => s.trim()).filter(s => s.length > 0);

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
