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

    const extraido = extrairDadosDoPdf(blob);

    // Preferência: tabela nativa do Google Docs (linhas/células preservam a
    // ordem real da grade). Só cai para o parsing por texto corrido — que
    // depende de adivinhar a ordem de leitura do OCR e pode sair
    // desalinhado — se o Google não reconheceu a tabela como tabela.
    let pacientes = parsearPacientesDeTabela(extraido.tabela);
    let modoExtracao = 'tabela';
    if (pacientes.length === 0) {
      pacientes = parsearPacientes(extraido.textoPlano);
      modoExtracao = 'texto-corrido';
    }

    const clinica = detectarClinica(extraido.textoPlano, nomeArquivo);
    const data = detectarData(extraido.textoPlano);

    return {
      sucesso: true,
      clinica: clinica,
      data: data,
      pacientes: pacientes,
      totalPacientes: pacientes.length,
      // Modo usado para extrair os pacientes: 'tabela' (confiável, lida
      // direto da grade) ou 'texto-corrido' (fallback, sujeito a
      // desalinhamento se o Google não reconheceu a tabela do PDF).
      modoExtracao: modoExtracao,
      // Texto bruto extraído pelo OCR do Google Docs. Exposto para o painel
      // "texto extraído (avançado)" do frontend, que serve para diagnosticar
      // casos em que o parsing sai desalinhado.
      textoBruto: extraido.textoPlano
    };
  } catch (erro) {
    return {
      sucesso: false,
      erro: erro.message
    };
  }
}

/**
 * Converte o blob do PDF em Google Doc (via Drive API v3 + OCR) e devolve
 * tanto a tabela nativa reconhecida pelo Docs (linhas/células, quando o
 * Google conseguiu detectar a grade) quanto o texto corrido completo
 * (usado para detectar clínica/data e como fallback de parsing).
 * Isso evita a necessidade de habilitar o serviço avançado do Drive manualmente.
 */
function extrairDadosDoPdf(blob) {
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
    const doc = DocumentApp.openById(arquivo.id);
    const body = doc.getBody();
    return {
      tabela: extrairLinhasDasTabelas(body),
      textoPlano: body.getText()
    };
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

/**
 * Lê as tabelas nativas reconhecidas pelo Google Docs na conversão e
 * devolve uma lista de linhas, cada uma como array de textos de célula na
 * ordem real da grade (coluna a coluna). Múltiplas tabelas (uma por página,
 * por exemplo) são concatenadas em sequência.
 */
function extrairLinhasDasTabelas(body) {
  const linhas = [];
  const tabelas = body.getTables();
  for (let t = 0; t < tabelas.length; t++) {
    const tabela = tabelas[t];
    const numLinhas = tabela.getNumRows();
    for (let r = 0; r < numLinhas; r++) {
      const linha = tabela.getRow(r);
      const numCelulas = linha.getNumCells();
      const celulas = [];
      for (let c = 0; c < numCelulas; c++) {
        celulas.push(linha.getCell(c).getText());
      }
      linhas.push(celulas);
    }
  }
  return linhas;
}

// ============================================================
// ETAPA 2: PARSING - TRANSFORMAR TEXTO BRUTO EM DADOS ESTRUTURADOS
// ============================================================

// O cabeçalho do relatório sai como "{NOME DA CLÍNICA}{DD/MM/AAAA}DATA: CLÍNICA:"
// (valor colado antes dos rótulos, sem separador) — confirmado a partir de PDFs
// reais exportados pelo sistema.
//
// ATENÇÃO: o sistema que gera o PDF TRUNCA o nome da clínica no cabeçalho
// quando ele passa da largura da célula (~18 caracteres). Ex.: o setor
// "A5-CIR DE CABEÇA E PESCOÇO" sai impresso como "A5-CIR DE CABEÇA E" — o
// resto do nome NÃO existe em lugar nenhum dentro do PDF (confirmado no
// conteúdo bruto de PDFs reais). A única fonte com o nome completo é o NOME
// DO ARQUIVO baixado do sistema, então quando o nome do arquivo "continua"
// o nome do cabeçalho, o nome do arquivo é usado no lugar.

// Normaliza um nome de setor para comparação: maiúsculas, sem acentos e só
// letras/números (ignora hífens, espaços e pontuação, que variam entre o
// cabeçalho do PDF e o nome do arquivo — ex. "A5-CIR" vs "A5CIR").
function normalizarSetor(valor) {
  return String(valor || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

// Extrai o nome do setor a partir do nome do arquivo enviado:
// remove a extensão e troca underscores por espaço.
function setorDoNomeDoArquivo(nomeArquivo) {
  return String(nomeArquivo || '')
    .replace(/\.pdf\s*$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tamanho do prefixo comum entre duas strings já normalizadas.
function prefixoComum(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function detectarClinica(texto, nomeArquivo) {
  const match = texto.match(/^(.*?)(\d{2}\/\d{2}\/\d{4})\s*DATA:\s*CL[ÍI]NICA:\s*$/im);
  const doCabecalho = match ? match[1].trim() : '';
  const doArquivo = setorDoNomeDoArquivo(nomeArquivo);

  if (!doCabecalho) {
    return doArquivo || 'NÃO IDENTIFICADA';
  }
  if (doArquivo) {
    const nCab = normalizarSetor(doCabecalho);
    const nArq = normalizarSetor(doArquivo);
    // Cabeçalho truncado: o nome do arquivo é mais longo e começa (quase)
    // igual ao do cabeçalho. A tolerância de 3 caracteres no prefixo cobre
    // acentos/cedilhas perdidos no nome do arquivo (ex. "CABE_A" p/ "CABEÇA").
    const truncado = nArq.length > nCab.length &&
      prefixoComum(nCab, nArq) >= Math.max(4, nCab.length - 3);
    if (truncado) {
      return doArquivo;
    }
  }
  return doCabecalho;
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

// ============================================================
// ETAPA 2a: PARSING A PARTIR DA TABELA NATIVA (caminho preferido)
// ============================================================

// Colunas da tabela, na ordem em que aparecem no PDF (ver cabeçalho
// "ENF PRONT/PACIENTE/DAT.NASC. DIAGN/DIETA DESJEJUM COLAÇÃO ALMOÇO
// LANCHE JANTAR CEIA 24HRS OBS ACEIT/COND").
const COLUNA_LEITO = 0;
const COLUNA_IDENTIDADE = 1;
const COLUNA_DIAGNOSTICO = 2;
const COLUNA_DESJEJUM = 3;

// Célula "PRONT/PACIENTE/DAT.NASC." já vem isolada por coluna aqui, então
// não precisa dos marcadores de via/rota usados no parsing por texto corrido.
const padraoIdentidadeCelula = /^(\d{3,6})\s*-\s*(.+?)-\s*(\d{1,3}\s*ano\(s\).*?)-\s*(.+)$/i;

function textoCelula(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim();
}

// Cada célula de diagnóstico/refeição começa com a via de alimentação
// (ORAL/ENTERAL/MISTA) como uma linha própria dentro da célula — remove
// esse prefixo para manter só o conteúdo relevante.
function removerViaInicial(texto) {
  return texto.replace(/^(ORAL|ENTERAL|MISTA)\b\s*/i, '').trim();
}

/**
 * Constrói a lista de pacientes a partir das linhas/células da tabela
 * nativa do Google Docs. Cada linha da tabela já corresponde exatamente a
 * um paciente, com uma célula por coluna — não há ambiguidade de ordem de
 * leitura como no parsing por texto corrido, então este é o caminho
 * preferido sempre que o Google reconhece a tabela do PDF.
 */
function parsearPacientesDeTabela(linhasTabela) {
  const pacientes = [];

  linhasTabela.forEach(celulas => {
    if (celulas.length <= COLUNA_DESJEJUM) return; // linha incompleta/inesperada

    const identidade = textoCelula(celulas[COLUNA_IDENTIDADE]);
    const matchIdentidade = identidade.match(padraoIdentidadeCelula);
    if (!matchIdentidade) return; // cabeçalho, linha de leito vazio, etc.

    pacientes.push({
      prontuario: matchIdentidade[1].trim(),
      nome: matchIdentidade[2].trim(),
      idade: matchIdentidade[3].trim(),
      nomeMae: matchIdentidade[4].trim(),
      leito: textoCelula(celulas[COLUNA_LEITO]),
      diagnostico: removerViaInicial(textoCelula(celulas[COLUNA_DIAGNOSTICO])),
      refeicoes: {
        DESJEJUM: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM])),
        COLACAO: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM + 1])),
        ALMOCO: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM + 2])),
        LANCHE: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM + 3])),
        JANTAR: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM + 4])),
        CEIA: removerViaInicial(textoCelula(celulas[COLUNA_DESJEJUM + 5]))
      }
    });
  });

  return pacientes;
}

// ============================================================
// ETAPA 2b: PARSING POR TEXTO CORRIDO (fallback)
// ============================================================
// Usado somente quando o Google não reconheceu a tabela do PDF como uma
// tabela nativa (comum em PDFs escaneados/baseados em imagem sem
// estrutura de grade detectável). Depende de adivinhar a ordem de leitura
// do OCR e por isso é mais sujeito a desalinhamento — por isso a etapa de
// revisão manual no frontend é sempre obrigatória.

// Marca o início de um paciente em QUALQUER ponto do texto (não apenas no
// início de uma linha). A extração de texto do Google Docs não garante que
// o prontuário de um novo paciente comece em uma linha própria — ele pode
// ficar colado ao final da última célula do paciente anterior. Ancorar a
// busca em início de linha fazia vários pacientes serem "engolidos" pelo
// bloco anterior, misturando os dados de refeição de pacientes diferentes.
const padraoInicioPacienteGlobal = /\d{3,6}\s*-\s*[^\d@][^@]{1,80}?-\s*\d{1,3}\s*ano\(s\)/gi;
// O grupo do nome da mãe (4) para de capturar antes do diagnóstico começar. O diagnóstico
// pode começar tanto com o marcador isolado de via quanto com a via colada
// sem espaço à primeira palavra do diagnóstico (ex: "ORALDIETA ZERO").
const padraoIdentidade = /^(\d{3,6})\s*-\s*(.+?)-\s*(\d{1,3}\s*ano\(s\).*?)-\s*(.+?)(?=@@ROTA_(?:ORAL|ENTERAL|MISTA)@@|(?:ORAL|ENTERAL|MISTA)[A-ZÀ-Ý]|$)/i;

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
  const textoUnico = linhas.join(' ').replace(/\s+/g, ' ').trim();

  const inicios = [];
  padraoInicioPacienteGlobal.lastIndex = 0;
  let matchInicio;
  while ((matchInicio = padraoInicioPacienteGlobal.exec(textoUnico)) !== null) {
    inicios.push(matchInicio.index);
  }

  const pacientes = [];

  for (let b = 0; b < inicios.length; b++) {
    const inicio = inicios[b];
    const fim = b + 1 < inicios.length ? inicios[b + 1] : textoUnico.length;
    const blocoJunto = textoUnico.slice(inicio, fim).trim();

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
    // de diagnóstico + refeições, usando os marcadores exclusivos.
    // A via do próprio diagnóstico (ex: "ORALDIETA ZERO") vem colada sem
    // espaço à primeira palavra do diagnóstico, então NÃO é reconhecida
    // como marcador isolado — por isso o texto antes do primeiro marcador
    // é sempre o diagnóstico, nunca uma refeição.
    const restante = blocoJunto.slice(matchIdentidade[0].length);
    const partes = restante.split(/@@ROTA_(?:ORAL|ENTERAL|MISTA)@@/);

    paciente.diagnostico = (partes[0] || '').trim().replace(/^(ORAL|ENTERAL|MISTA)\s*/i, '').trim();

    // segmentos seguintes = refeições, na ordem em que aparecem
    // (mapeadas na ordem padrão DESJEJUM->CEIA; CONFERIR na revisão)
    const segmentos = partes.slice(1).map(s => s.trim()).filter(s => s.length > 0);
    for (let m = 0; m < REFEICOES.length; m++) {
      if (segmentos[m]) {
        paciente.refeicoes[REFEICOES[m]] = segmentos[m];
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
