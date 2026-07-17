/**
 * ============================================================
 * QUANTITATIVO DE REFEIÇÕES (estilo planilha FATURAMENTO)
 * ============================================================
 * Traduz o texto livre de cada refeição do PDF ("CAFÉ COMPLETO DM
 * (RENAL) | FRUTA: MELANCIA") nos itens padronizados da planilha de
 * faturamento e soma as quantidades por clínica — o trabalho que o
 * admin fazia manualmente.
 *
 * Três abas de configuração (criadas automaticamente com os dados da
 * planilha FATURAMENTO, editáveis tanto pelo app quanto direto na planilha):
 *   - "Itens":    catálogo de itens por seção de refeição (layout oficial)
 *   - "Regras":   de-para texto do PDF -> item(ns) do catálogo
 *   - "Clinicas": nome da clínica no PDF -> coluna do quantitativo
 *
 * O resultado é gravado numa aba "QDR dd-MM" por dia, no mesmo layout
 * da planilha FATURAMENTO (itens nas linhas, clínicas nas colunas).
 * ============================================================
 */

// Ordem das refeições (mesma de REFEICOES em Code.gs; redeclarada aqui
// para que este módulo seja autocontido nos testes em Node).
const REFEICOES_ORDEM = ['DESJEJUM', 'COLACAO', 'ALMOCO', 'LANCHE', 'JANTAR', 'CEIA'];

// Seções extras que não existem na planilha FATURAMENTO mas aparecem
// nos PDFs — contadas à parte para dar visibilidade completa.
const ITENS_EXTRAS = {
  ENTERAL: [
    ['', 'Isosource Soya (frasco)'],
    ['', 'Survimed OPD HN (frasco)'],
    ['', 'Novasource REN (frasco)'],
    ['', 'Fresubin HP Energy (frasco)'],
    ['', 'Proline (suplemento)'],
    ['', 'Probiatop (sachê)'],
    ['', 'Módulo de proteína (medida)'],
    ['', 'Mix de fibras (medida)'],
    ['', 'FOS (medida)'],
    ['', 'Espessante (medida)'],
    ['', 'Dieta Zero']
  ],
  OUTROS: [
    ['', 'Chá'],
    ['', 'Chá DM'],
    ['', 'Queijo (porção)'],
    ['', 'Leite (copo)'],
    ['', 'Leite desnatado (copo)']
  ]
};

// Ordem das seções na aba de quantitativo. As 6 primeiras espelham a
// planilha FATURAMENTO; ENTERAL e OUTROS são seções extras.
const SECOES_QDR = [
  { chave: 'DESJEJUM', rotulo: 'Desjejum' },
  { chave: 'COLACAO', rotulo: 'Lanche da manhã (Colação)' },
  { chave: 'ALMOCO', rotulo: 'Almoço' },
  { chave: 'LANCHE', rotulo: 'Lanche Tarde' },
  { chave: 'JANTAR', rotulo: 'Jantar' },
  { chave: 'CEIA', rotulo: 'Ceia' },
  { chave: 'ENTERAL', rotulo: 'Enteral / Suplementos (dia inteiro)' },
  { chave: 'OUTROS', rotulo: 'Outros (sem linha no faturamento)' }
];

// ============================================================
// NORMALIZAÇÃO
// ============================================================

// Palavras sem valor de identificação, ignoradas na comparação de
// padrões e nomes de itens ("Café completo c/ pão" ~ "CAFE COMPLETO PAO").
const PALAVRAS_VAZIAS = {};
['DE', 'DO', 'DA', 'DOS', 'DAS', 'COM', 'C', 'P', 'S', 'PARA', 'E', 'O', 'A',
 'OU', 'EM', 'NO', 'NA', 'UND', 'REGULAR'].forEach(p => { PALAVRAS_VAZIAS[p] = true; });

function normalizarTexto(texto) {
  return String(texto || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d+)\s*ML\b/g, '$1ML') // "300 ML" e "(500ml)" viram o token 300ML/500ML
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// Divide em palavras significativas (sem acento, sem pontuação, sem
// palavras vazias). É a unidade de comparação de regras e itens.
function palavrasDe(texto) {
  return normalizarTexto(texto).split(' ').filter(p => p && !PALAVRAS_VAZIAS[p]);
}

function chaveDePalavras(palavras) {
  return palavras.slice().sort().join('|');
}

// ============================================================
// REGRAS PADRÃO (seed da aba "Regras")
// ============================================================
// Cada regra: refeições onde vale ('*' = todas), padrão de texto do PDF
// (palavras que precisam estar presentes na parte, em qualquer ordem) e
// item(ns) destino separados por ';'. Dentro de cada destino, '>' define
// alternativas: usa o primeiro nome que existir na seção da refeição
// (ex.: "Vitamina - Manga - DM > Vitamina - Padrão - DM" cai para o
// Padrão nas seções que não têm a variante de sabor).

const SABORES = [
  ['ACEROLA', 'Acerola'], ['AMEIXA', 'Ameixa'], ['CAJA', 'Cajá'],
  ['GOIABA', 'Goiaba'], ['GRAVIOLA', 'Graviola'], ['MANGA', 'Manga'],
  ['MARACUJA', 'Maracujá']
];

function montarRegrasPadrao() {
  const regras = [];
  const r = (padrao, itens, refeicoes) => regras.push({
    refeicoes: refeicoes || '*',
    padrao: padrao,
    itens: itens
  });

  // ---- Desjejum: cafés completos ----
  r('CAFE COMPLETO', 'Café Completo c/ pão hot dog');
  r('CAFE COMPLETO DM', 'Café completo DM c/ pão integral');
  r('CAFE COMPLETO RENAL', 'Café completo renal c/ hot dog');
  r('CAFE COMPLETO DM RENAL', 'Café completo DM renal c/ pão integral');
  r('CAFE COMPLETO SEM LACTOSE', 'Café comp. com leite sem lactose');
  r('CAFE COMPLETO LEITE SEM LACTOSE', 'Café comp. com leite sem lactose');
  r('CAFE COMPLETO LEITE DESNATADO', 'C.C. c/ Desnatado c/ Hot dog');
  r('CAFE COMPLETO DESNATADO PAO INTEGRAL', 'C.C. c/ Desnatado c/ pão integral');
  r('CAFE COMPLETO PAO INTEGRAL', 'Café completo c/ pão integral');
  r('CAFE COMPLETO TAPIOCA', 'Café completo c/ tapioca');
  r('CAFE COMPLETO CUSCUZ', 'Café completo c/ cuscuz');
  r('CAFE COMPLETO BISCOITO INTEGRAL', 'Café completo c/ biscoito integral');
  r('CAFE COMPLETO DM BISCOITO INTEGRAL', 'Café completo DM c/ biscoito integral');
  r('CAFE LEITE SEM LACTOSE', 'Café comp. com leite sem lactose');
  r('CAFE LEITE', 'Café Completo c/ pão hot dog');

  // ---- Sopas (almoço, jantar e colação) ----
  [['INTEIRA', 'inteira'], ['PASSADA', 'passada']].forEach(([tp, tn]) => {
    [['', ''], ['HAS', 'HAS'], ['DM', 'DM'], ['HAS DM', 'HAS DM']].forEach(([mp, mn]) => {
      const nomeMod = mn ? ' ' + mn : '';
      r(`SOPA ${tp}${mp ? ' ' + mp : ''}`, `Sopa ${tn}${nomeMod} (500ml)`);
      r(`SOPA ${tp}${mp ? ' ' + mp : ''} 300ML`, `Sopa ${tn}${nomeMod} (300ml)`);
      r(`SOPA ${tp}${mp ? ' ' + mp : ''} 500ML`, `Sopa ${tn}${nomeMod} (500ml)`);
    });
  });

  // ---- Dietas principais (almoço/jantar; em outras refeições o item
  //      pode não existir na seção e cai em "não reconhecidos") ----
  [
    ['GERAL', 'Geral', 'Geral conservador', 'Geral cons DM', 'Geral diálise', 'Geral diálise DM', 'Geral Hepato', 'Geral Hepato DM', 'Geral Hiper'],
    ['BRANDA', 'Branda', 'Branda Conservador', 'Branda Cons DM', 'Branda Diálise', 'Branda Diálise DM', 'Branda Hepato', 'Branda Hepato DM', 'Branda Hiper'],
    ['PASTOSA', 'Pastosa', 'Pastosa Conservador', 'Pastosa Cons DM', 'Pastosa Diálise', 'Pastosa Diálise DM', 'Pastosa Hepato', 'Pastosa Hepato DM', 'Pastosa Hiper']
  ].forEach(([base, nome, cons, consDm, dialise, dialiseDm, hepato, hepatoDm, hiper]) => {
    r(base, nome);
    r(`${base} HAS`, `${nome} HAS`);
    r(`${base} DM`, `${nome} DM`);
    r(`${base} HAS DM`, `${nome} HAS DM`);
    r(`${base} CONSERVADOR`, cons);
    r(`${base} CONSERVADOR DM`, consDm);
    r(`${base} DIALISE`, dialise);
    r(`${base} DIALISE DM`, dialiseDm);
    r(`${base} DIALISE HAS`, dialise);
    r(`${base} DIALISE HAS DM`, dialiseDm);
    r(`${base} HEPATO`, hepato);
    r(`${base} HEPATO DM`, hepatoDm);
    r(`${base} HIPER`, hiper);
  });

  // ---- Sucos ----
  r('SUCO', 'Suco - Padrão - Regular');
  r('SUCO DM', 'Suco - Padrão - DM');
  r('SUCO LARANJA', 'Suco de laranja > Suco - Laranja - Padrão > Suco - Padrão - Regular');
  r('SUCO MACA', 'Suco de Maçã sem Açucar > Suco - Padrão - Regular');
  SABORES.forEach(([sp, sn]) => {
    r(`SUCO ${sp}`, `Suco - ${sn} - Regular > Suco - Padrão - Regular`);
    r(`SUCO ${sp} DM`, `Suco - ${sn} - DM > Suco - Padrão - DM`);
  });

  // ---- Vitaminas ----
  const VARIANTES_VITAMINA = [
    ['', 'Regular'], ['DM', 'DM'], ['DM SEM LACTOSE', 'DM sem Lactose'],
    ['SEM LACTOSE', 'Sem lactose'], ['DESNATADO', 'Desnatado'], ['LEITE DESNATADO', 'Desnatado']
  ];
  VARIANTES_VITAMINA.forEach(([vp, vn]) => {
    r(`VITAMINA${vp ? ' ' + vp : ''}`, `Vitamina - Padrão - ${vn}`);
    SABORES.forEach(([sp, sn]) => {
      r(`VITAMINA ${sp}${vp ? ' ' + vp : ''}`, `Vitamina - ${sn} - ${vn} > Vitamina - Padrão - ${vn}`);
    });
  });

  // ---- Mingaus ----
  r('MINGAU', 'Mingau');
  r('MINGAU DM', 'Mingau DM');
  r('MINGAU SEM LACTOSE', 'Mingau sem lactose');
  r('MINGAU DM SEM LACTOSE', 'Mingau DM sem lactose > Mingau sem lactose DM');
  r('MINGAU LEITE DESNATADO', 'Mingau');

  // ---- Pães, biscoitos e avulsos ----
  r('PAO HOT DOG', 'Pão hot dog');
  r('PAO HOTDOG', 'Pão hot dog');
  r('PAO FRANCES', 'Pão francês');
  r('PAO INTEGRAL', 'Pão integral');
  r('PAO INTEGRAL SEM MARGARINA', 'Pão integral sem margarina > Pão integral');
  r('TAPIOCA', 'Tapioca');
  r('CUSCUZ', 'Cuscuz');
  r('BISCOITO SALGADO', 'Biscoito salgado');
  r('BISCOITO DOCE', 'Biscoito doce');
  r('BISCOITO INTEGRAL', 'Biscoito Integral');
  r('OVO', 'Ovo');
  r('OVOS', 'Ovo');
  r('OVOS FRITOS', 'Ovo');
  r('AGUA COCO', 'Água de côco');
  r('IOGURTE', 'Iogurte com polpas variadas');
  r('SORVETE', 'Sorvete 100ml');
  r('SORVETE', 'Sorvete 140ml', 'JANTAR');
  r('CALDO FEIJAO', 'Caldo de feijão');
  r('CALDO CARNE', 'Caldo Carne/Frango');
  r('CALDO FRANGO', 'Caldo Carne/Frango');
  r('SANDUICHE MISTO', 'Sanduiche misto');
  r('SANDUICHE FRANGO', 'Sanduiche de peito frango');
  r('SANDUICHE CREME FRANGO', 'Sanduiche de creme frango');
  r('SALADA FRUTA', 'Pratinhos de frutas');
  r('SALADA FRUTAS', 'Pratinhos de frutas');
  r('PRATINHO FRUTAS', 'Pratinhos de frutas');
  r('PRATINHOS FRUTAS', 'Pratinhos de frutas');
  r('LEITE SEM LACTOSE', 'Leite (sem lactose, copo 250ml)');
  r('LEITE MORNO', 'Leite (copo)');
  r('LEITE DESNATADO', 'Leite desnatado (copo)');
  r('QUEIJO', 'Queijo (porção)');
  r('CHA', 'Chá');
  r('CHA DM', 'Chá DM');

  // ---- Enterais e suplementos ----
  r('ISOSOURCE', 'Isosource Soya (frasco)');
  r('SURVIMED', 'Survimed OPD HN (frasco)');
  r('NOVASOURCE', 'Novasource REN (frasco)');
  r('FRESUBIN', 'Fresubin HP Energy (frasco)');
  r('PROLINE', 'Proline (suplemento)');
  r('PROBIATOP', 'Probiatop (sachê)');
  r('DIETA ZERO', 'Dieta Zero');
  r('MIX FIBRAS', 'Mix de fibras (medida)');
  r('MEDIDA FIBRAS', 'Mix de fibras (medida)');
  r('MED FIBRAS', 'Mix de fibras (medida)');
  r('MEDIDA MIX FIBRAS', 'Mix de fibras (medida)');
  r('MEDIDA PROTEINA', 'Módulo de proteína (medida)');
  r('MED PROTEINA', 'Módulo de proteína (medida)');
  r('MEDIDA FOS', 'FOS (medida)');
  r('MED FOS', 'FOS (medida)');
  r('MEDIDA ESPESSANTE', 'Espessante (medida)');
  r('ESPESSANTE', 'Espessante (medida)');

  return regras;
}

// Frutas conhecidas (nome no PDF -> linha de fruta da planilha).
// Nomes compostos primeiro para casar antes dos simples.
const FRUTAS_CONHECIDAS = [
  ['MELAO JAPONES', 'Melão japonês'],
  ['MELAO', 'Melão japonês'],
  ['ABACAXI', 'Abacaxi'],
  ['BANANA', 'Banana'],
  ['GOIABA', 'Goiaba'],
  ['LARANJA', 'Laranja'],
  ['MACA', 'Maçã'],
  ['MAMAO', 'Mamão'],
  ['MELANCIA', 'Melancia'],
  ['TANGERINA', 'Tangerina'],
  ['UVA', 'Uva']
];

// ============================================================
// COMPILAÇÃO DA CONFIGURAÇÃO
// ============================================================

/**
 * Compila catálogo + regras num objeto pronto para classificar.
 * itensPorSecao: { SECAO: [[id, nome], ...] } — inclui as seções extras.
 * regrasBrutas:  [{refeicoes, padrao, itens}]
 * clinicas:      [{coluna, aliases: []}]
 */
function prepararConfig(itensPorSecao, regrasBrutas, clinicas) {
  const indices = {}; // SECAO -> { porChave: {chavePalavras -> item}, lista: [...] }
  Object.keys(itensPorSecao).forEach(secao => {
    const porChave = {};
    const lista = [];
    itensPorSecao[secao].forEach(([id, nome]) => {
      const item = { secao: secao, id: String(id || ''), nome: String(nome) };
      lista.push(item);
      const chave = chaveDePalavras(palavrasDe(nome));
      if (!(chave in porChave)) porChave[chave] = item;
    });
    indices[secao] = { porChave: porChave, lista: lista };
  });

  const regras = regrasBrutas.map((regra, ordem) => {
    const palavras = palavrasDe(regra.padrao);
    const refeicoesStr = String(regra.refeicoes || '*').trim();
    return {
      padrao: regra.padrao,
      palavras: palavras,
      refeicoes: refeicoesStr === '*' || refeicoesStr === '' ? null
        : refeicoesStr.split(/[,;]/).map(s => normalizarTexto(s)).filter(Boolean),
      itens: String(regra.itens || '').split(';').map(s => s.trim()).filter(Boolean),
      especificidade: palavras.length * 1000 + normalizarTexto(regra.padrao).length,
      ordem: ordem
    };
  }).filter(regra => regra.palavras.length > 0 && regra.itens.length > 0);

  return {
    itensPorSecao: itensPorSecao,
    indices: indices,
    regras: regras,
    clinicas: clinicas || []
  };
}

/** Configuração padrão (seeds), usada nos testes e no primeiro acesso. */
function configPadrao() {
  const itens = {};
  Object.keys(ITENS_FATURAMENTO).forEach(secao => { itens[secao] = ITENS_FATURAMENTO[secao]; });
  Object.keys(ITENS_EXTRAS).forEach(secao => { itens[secao] = ITENS_EXTRAS[secao]; });
  return prepararConfig(itens, montarRegrasPadrao(), clinicasPadrao());
}

function clinicasPadrao() {
  const aliases = {
    'A5 UCP (UNIDADE DE CUIDADOS)': ['A5-UNID CUIDADOS', 'A5 UNID CUIDADOS 1'],
    'A5 CLINICA MEDICA/NEFROLOGIA/ CAB E PESCOÇO': ['A5-CIR DE CABEÇA E PESCOÇO', 'A5 CIR DE CABE A E PESCOCO']
  };
  return COLUNAS_CLINICAS.map(coluna => ({
    coluna: coluna,
    aliases: aliases[coluna] || []
  }));
}

// ============================================================
// RESOLUÇÃO DE ITENS E CLÍNICAS
// ============================================================

// Encontra o item do catálogo pelo nome (comparação por conjunto de
// palavras, tolerante a ordem/caixa/acentos), procurando primeiro na
// seção da refeição e depois nas seções extras.
function resolverItem(nomeAlvo, secaoRefeicao, config) {
  const chave = chaveDePalavras(palavrasDe(nomeAlvo));
  const ordem = [secaoRefeicao, 'ENTERAL', 'OUTROS'];
  for (let i = 0; i < ordem.length; i++) {
    const indice = config.indices[ordem[i]];
    if (indice && indice.porChave[chave]) return indice.porChave[chave];
  }
  return null;
}

// Resolve uma cadeia de alternativas "A > B > C": primeiro nome que
// existir na seção vence.
function resolverAlternativas(cadeia, secaoRefeicao, config) {
  const alternativas = String(cadeia).split('>').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < alternativas.length; i++) {
    const item = resolverItem(alternativas[i], secaoRefeicao, config);
    if (item) return item;
  }
  return null;
}

function normalizarChaveClinica(valor) {
  return normalizarTexto(valor).replace(/ /g, '');
}

function prefixoComumClinica(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Descobre a coluna do quantitativo para o nome de clínica que veio do
 * PDF, comparando com o nome da coluna e com os apelidos cadastrados.
 * Tolera pequenas diferenças de sufixo (acentos perdidos no nome do
 * arquivo, numerais extras). Devolve o nome da coluna ou ''.
 */
function resolverColunaClinica(nomePdf, clinicas) {
  const alvo = normalizarChaveClinica(nomePdf);
  if (!alvo) return '';
  let melhor = '';
  let melhorPrefixo = 0;
  (clinicas || []).forEach(clinica => {
    const candidatos = [clinica.coluna].concat(clinica.aliases || []);
    candidatos.forEach(candidato => {
      const chave = normalizarChaveClinica(candidato);
      if (!chave) return;
      if (chave === alvo) {
        melhor = clinica.coluna;
        melhorPrefixo = Infinity;
        return;
      }
      const prefixo = prefixoComumClinica(chave, alvo);
      const minimo = Math.max(6, Math.min(chave.length, alvo.length) - 3);
      if (prefixo >= minimo && prefixo > melhorPrefixo) {
        melhor = clinica.coluna;
        melhorPrefixo = prefixo;
      }
    });
  });
  return melhor;
}

// ============================================================
// CLASSIFICAÇÃO DE UMA REFEIÇÃO
// ============================================================

// Padrões de texto que são observação clínica (vazamento da coluna de
// OBS/24hrs do PDF), não itens de refeição — descartados sem alerta.
const PARTE_IGNORADA = /\b(EVAC|ACEITACAO|TRIAGEM|REAVALIACAO|INAPETENCIA)\b|^\d{1,2} \d{1,2}( |$)/;

const PADRAO_ACOMPANHANTE = /(LEVAR|OFERTAR|ENVIAR)\s+REFEI\S*\s*(DE\s+|PARA\s+|P\/?\s*)?O?\s*ACOMPANHANTE/i;

// Remove trechos que não são prescrição de item: observações **assim**,
// instruções de logística (LEVAR/ENVIAR/OFERTAR ...), setas >> e
// exclusões (NÃO ...; S/ ...).
function limparTextoRefeicao(texto) {
  return String(texto || '')
    .replace(/\*\*[^*]*(\*\*|$)/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/>{2,}[^+|;]*/g, ' ')
    .replace(/\b(LEVAR|OFERTAR|ENVIAR)\b[^+|;]*/gi, ' ')
    .replace(/\bN[ÃA]O:?\b[^+|;]*/gi, ' ')
    .replace(/\bS\/\s*[^+|;()]*/gi, ' ');
}

// Divide o texto da refeição em partes independentes: separadores
// explícitos (+ | ;) e o início de menção a fruta ("FRUTA: X",
// "FRUTA RENAL (X)"), que costuma vir colada ao item anterior.
function separarPartes(texto) {
  return texto
    .replace(/\bFRUTAS?\s*(RENAL|:|\()/gi, m => '|' + m)
    .split(/[+|;]/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// Extrai a primeira fruta conhecida mencionada na parte, na ordem em
// que o PDF lista (quando há opções — "ABACAXI, MAÇÃ OU MELANCIA" — a
// primeira citada é a marcada, como o admin faz).
function frutaDaParte(palavras) {
  for (let posicao = 0; posicao < palavras.length; posicao++) {
    for (let i = 0; i < FRUTAS_CONHECIDAS.length; i++) {
      const [padrao, nome] = FRUTAS_CONHECIDAS[i];
      const partesPadrao = padrao.split(' ');
      if (palavras.slice(posicao, posicao + partesPadrao.length).join(' ') === padrao) {
        return nome;
      }
    }
  }
  return '';
}

function removerPalavrasUsadas(palavras, usadas) {
  const restantes = palavras.slice();
  usadas.forEach(usada => {
    const posicao = restantes.indexOf(usada);
    if (posicao !== -1) restantes.splice(posicao, 1);
  });
  return restantes;
}

function contemTodas(palavras, requeridas) {
  const disponiveis = palavras.slice();
  for (let i = 0; i < requeridas.length; i++) {
    const posicao = disponiveis.indexOf(requeridas[i]);
    if (posicao === -1) return false;
    disponiveis.splice(posicao, 1);
  }
  return true;
}

// Casa uma parte contra as regras: escolhe sempre a regra mais
// específica que couber, remove as palavras usadas e repete — assim uma
// parte com dois itens ("TAPIOCA COM OVO") gera as duas contagens.
function casarParte(palavras, refeicao, config) {
  const achadas = [];
  let restantes = palavras.slice();
  while (restantes.length > 0) {
    let melhor = null;
    for (let i = 0; i < config.regras.length; i++) {
      const regra = config.regras[i];
      if (regra.refeicoes && regra.refeicoes.indexOf(refeicao) === -1) continue;
      if (!contemTodas(restantes, regra.palavras)) continue;
      if (!melhor ||
          regra.especificidade > melhor.especificidade ||
          (regra.especificidade === melhor.especificidade &&
           !!regra.refeicoes && !melhor.refeicoes)) {
        melhor = regra;
      }
    }
    if (!melhor) break;
    achadas.push(melhor);
    restantes = removerPalavrasUsadas(restantes, melhor.palavras);
  }
  return achadas;
}

/**
 * Classifica o texto livre de UMA refeição de UM paciente.
 * Devolve { itens: [{secao, id, nome, qtd}], naoReconhecidos: [texto],
 *           avisos: [texto] }.
 */
function classificarRefeicao(textoOriginal, refeicao, config) {
  const resultado = { itens: [], naoReconhecidos: [], avisos: [] };
  const texto = String(textoOriginal || '').trim();
  if (!texto) return resultado;

  // Refeição levada também para o acompanhante = +1 na linha ACOMPANHANTE
  if (PADRAO_ACOMPANHANTE.test(texto)) {
    const acompanhante = resolverItem('ACOMPANHANTE', refeicao, config);
    if (acompanhante) {
      resultado.itens.push({ secao: acompanhante.secao, id: acompanhante.id, nome: acompanhante.nome, qtd: 1 });
    } else {
      resultado.avisos.push('Refeição de acompanhante em "' + refeicao + '", mas a seção não tem linha ACOMPANHANTE.');
    }
  }

  const partes = separarPartes(limparTextoRefeicao(texto));

  partes.forEach(parte => {
    const palavras = palavrasDe(parte);
    if (palavras.length === 0) return;
    const parteNormalizada = palavras.join(' ');
    if (PARTE_IGNORADA.test(parteNormalizada)) return;

    // Quantidade explícita no começo da parte ("2 OVOS", "1 MED DE FOS")
    let qtd = 1;
    if (/^\d{1,2}$/.test(palavras[0])) {
      const n = parseInt(palavras[0], 10);
      if (n >= 1 && n <= 10) { qtd = n; palavras.shift(); }
    }
    if (palavras.length === 0) return;

    // Parte de fruta ("FRUTA: MELANCIA", "FRUTA RENAL (ABACAXI, ...)")
    if (palavras[0] === 'FRUTA' || palavras[0] === 'FRUTAS') {
      const nomeFruta = frutaDaParte(palavras.slice(1));
      if (!nomeFruta) return; // "FRUTA" genérica sem sabor: nada a contar
      const itemFruta = resolverItem(nomeFruta, refeicao, config);
      if (itemFruta) {
        resultado.itens.push({ secao: itemFruta.secao, id: itemFruta.id, nome: itemFruta.nome, qtd: qtd });
      } else {
        resultado.naoReconhecidos.push(parte);
      }
      return;
    }

    const regras = casarParte(palavras, refeicao, config);

    if (regras.length === 0) {
      // Parte que é só uma fruta avulsa ("+ TANGERINA")
      const nomeFruta = palavras.length <= 2 ? frutaDaParte(palavras) : '';
      if (nomeFruta) {
        const itemFruta = resolverItem(nomeFruta, refeicao, config);
        if (itemFruta) {
          resultado.itens.push({ secao: itemFruta.secao, id: itemFruta.id, nome: itemFruta.nome, qtd: qtd });
          return;
        }
      }
      // "ZERO PARA C/C 07/07" e afins: anotação de dieta zerada para
      // procedimento/exame, sem item a contar nesta refeição
      const semDigitos = palavras.filter(p => !/^\d+$/.test(p));
      if (semDigitos.length === 1 && semDigitos[0] === 'ZERO') return;
      resultado.naoReconhecidos.push(parte);
      return;
    }

    let resolveuAlgum = false;
    regras.forEach(regra => {
      regra.itens.forEach(cadeia => {
        const item = resolverAlternativas(cadeia, refeicao, config);
        if (item) {
          resultado.itens.push({ secao: item.secao, id: item.id, nome: item.nome, qtd: qtd });
          resolveuAlgum = true;
        } else {
          resultado.avisos.push('Regra "' + regra.padrao + '" aponta para "' + cadeia +
            '", que não existe na seção de ' + refeicao + ' nem nas seções extras.');
        }
      });
    });
    if (!resolveuAlgum) resultado.naoReconhecidos.push(parte);
  });

  return resultado;
}

// ============================================================
// AGREGAÇÃO: PACIENTES -> QUANTITATIVO
// ============================================================

/**
 * Gera o quantitativo agregado de uma clínica a partir da lista de
 * pacientes extraída do PDF (formato de parsearPacientes*).
 * Devolve:
 * {
 *   secoes: [{secao, rotulo, itens: [{id, nome, qtd, origens: [...]}]}],
 *   naoReconhecidos: [{refeicao, texto, leito, paciente}],
 *   avisos: [texto]
 * }
 */
function gerarQuantitativo(pacientes, config) {
  const contagens = {}; // 'SECAO||nome' -> {secao, id, nome, qtd, origens}
  const pacientesDietaZero = {}; // Dieta Zero conta 1 por paciente, não por refeição
  const naoReconhecidos = [];
  const avisos = [];

  (pacientes || []).forEach(paciente => {
    const refeicoes = paciente.refeicoes || {};
    REFEICOES_ORDEM.forEach(refeicao => {
      const texto = refeicoes[refeicao];
      if (!texto) return;
      const classificacao = classificarRefeicao(texto, refeicao, config);

      classificacao.itens.forEach(item => {
        if (item.nome === 'Dieta Zero') {
          const chavePaciente = (paciente.prontuario || '') + '|' + (paciente.leito || '');
          if (pacientesDietaZero[chavePaciente]) return;
          pacientesDietaZero[chavePaciente] = true;
        }
        const chave = item.secao + '||' + item.nome;
        if (!contagens[chave]) {
          contagens[chave] = { secao: item.secao, id: item.id, nome: item.nome, qtd: 0, origens: [] };
        }
        contagens[chave].qtd += item.qtd;
        contagens[chave].origens.push({
          leito: paciente.leito || '',
          paciente: paciente.nome || '',
          refeicao: refeicao,
          texto: texto
        });
      });

      classificacao.naoReconhecidos.forEach(parte => {
        naoReconhecidos.push({
          refeicao: refeicao,
          texto: parte,
          leito: paciente.leito || '',
          paciente: paciente.nome || ''
        });
      });

      classificacao.avisos.forEach(aviso => {
        if (avisos.indexOf(aviso) === -1) avisos.push(aviso);
      });
    });
  });

  // Organiza por seção, na ordem do catálogo (mesma ordem da planilha)
  const secoes = SECOES_QDR.map(({ chave, rotulo }) => {
    const indice = config.indices[chave];
    const itens = [];
    if (indice) {
      indice.lista.forEach(item => {
        const contagem = contagens[chave + '||' + item.nome];
        if (contagem && contagem.qtd > 0) itens.push(contagem);
      });
    }
    return { secao: chave, rotulo: rotulo, itens: itens };
  });

  return { secoes: secoes, naoReconhecidos: naoReconhecidos, avisos: avisos };
}
// Gerado a partir da planilha FATURAMENTO v3.5 (aba de dia, layout oficial).
// Cada item: [id de faturamento, nome oficial da linha].
const ITENS_FATURAMENTO = {
  DESJEJUM: [
    ["4", "FUNCIONARIO"],
    ["4", "ACOMPANHANTE"],
    ["5", "ACOMPANHANTE COM DESC + PTN"],
    ["1", "Café Completo c/ pão hot dog"],
    ["1", "Café Completo c/ pão francês"],
    ["3", "Café completo c/ pão integral"],
    ["1", "Café completo c/ tapioca"],
    ["1", "Café completo c/ b. salgado"],
    ["1", "Café completo c/ b. doce"],
    ["3", "Café completo c/ biscoito integral"],
    ["1", "Café completo c/ cuscuz"],
    ["1", "C.C. c/ Desnatado c/ Hot dog"],
    ["1", "C.C. c/ Desnatado c/ Hot dog sem margarina"],
    ["1", "C.C. c/ Desnatado c/ francês"],
    ["1", "C.C. c/ Desnatado c/ francês sem margarina"],
    ["3", "C.C. c/ Desnatado c/ pão integral"],
    ["3", "C.C. c/ Desnatado c/ pão integral sem margarina"],
    ["1", "C.C. c/ L. Desnatado c/ tapioca"],
    ["1", "C.C. c/. L. Desnatado c/ b. salgado"],
    ["3", "C.C. c/ L. Desnatado c/ b. Integral"],
    ["3", "Café completo DM c/ pão integral"],
    ["3", "Café completo DM c/ biscoito integral"],
    ["3", "Café completo DM c/ b. salgado"],
    ["2", "Café completo renal c/ hot dog"],
    ["2", "Café completo renal c/ L. Desnatado"],
    ["2", "Café completo DM renal c/ pão integral"],
    ["97", "Café comp. com leite sem lactose"],
    ["101", "Café comp. Padrão com PTN"],
    ["101", "Café comp. DM com PTN"],
    ["102", "Café comp. Padrão s/ Lac. c PTN"],
    ["102", "Café comp. DM s/ Lac. c PTN"],
    ["15", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["13", "Melancia"],
    ["12", "Melão japonês"],
    ["21", "Tangerina"],
    ["73", "Pão hot dog"],
    ["74", "Pão hot dog sem margarina"],
    ["73", "Pão francês"],
    ["74", "Pão francês sem margarina"],
    ["75", "Pão integral"],
    ["75", "Pão integral sem margarina"],
    ["76", "Tapioca"],
    ["76", "Tapioca sem margarina"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["67", "Cuscuz"],
    ["67", "Cuscuz sem margarina"],
    ["7", "Suco de laranja"],
    ["68", "Ovo"],
    ["10", "Água de côco"],
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["91", "Mingau"],
    ["91", "Mingau DM"],
    ["92", "Mingau sem lactose"],
    ["92", "Mingau sem lactose DM"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["96", "Leite (sem lactose, copo 250ml)"],
    ["65", "Café Litro"],
    ["78", "Sanduiche misto"],
  ],
  COLACAO: [
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["30", "Suco - Ameixa (polpa)"],
    ["7", "Suco - Laranja - Padrão"],
    ["94", "Suco de Maçã sem Açucar"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["59", "Vitamina - Acerola - Regular"],
    ["60", "Vitamina - Acerola - DM"],
    ["95", "Vitamina - Acerola - DM sem Lactose"],
    ["95", "Vitamina - Acerola - Sem lactose"],
    ["59", "Vitamina - Acerola - Desnatado"],
    ["59", "Vitamina - Ameixa - Regular"],
    ["60", "Vitamina - Ameixa - DM"],
    ["95", "Vitamina - Ameixa - DM sem Lactose"],
    ["95", "Vitamina - Ameixa - Sem lactose"],
    ["59", "Vitamina - Ameixa - Desnatado"],
    ["59", "Vitamina - Cajá - Regular"],
    ["60", "Vitamina - Cajá - DM"],
    ["95", "Vitamina - Cajá - DM sem Lactose"],
    ["95", "Vitamina - Cajá - Sem lactose"],
    ["59", "Vitamina - Cajá - Desnatado"],
    ["59", "Vitamina - Goiaba - Regular"],
    ["60", "Vitamina - Goiaba - DM"],
    ["95", "Vitamina - Goiaba - DM sem Lactose"],
    ["95", "Vitamina - Goiaba - Sem lactose"],
    ["59", "Vitamina - Goiaba - Desnatado"],
    ["59", "Vitamina - Graviola - Regular"],
    ["60", "Vitamina - Graviola - DM"],
    ["95", "Vitamina - Graviola - DM sem Lactose"],
    ["95", "Vitamina - Graviola - Sem lactose"],
    ["59", "Vitamina - Graviola - Desnatado"],
    ["59", "Vitamina - Manga - Regular"],
    ["60", "Vitamina - Manga - DM"],
    ["95", "Vitamina - Manga - DM sem Lactose"],
    ["95", "Vitamina - Manga - Sem lactose"],
    ["59", "Vitamina - Manga - Desnatado"],
    ["59", "Vitamina - Maracujá - Regular"],
    ["60", "Vitamina - Maracujá - DM"],
    ["95", "Vitamina - Maracujá - DM sem Lactose"],
    ["95", "Vitamina - Maracujá - Sem lactose"],
    ["59", "Vitamina - Maracujá - Desnatado"],
    ["21", "Tangerina"],
    ["25", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["12", "Melão japonês"],
    ["13", "Melancia"],
    ["9", "Pratinhos de frutas"],
    ["73", "Pão hot dog"],
    ["74", "Pão hot dog sem margarina"],
    ["73", "Pão francês"],
    ["74", "Pão francês sem margarina"],
    ["75", "Pão integral"],
    ["75", "Pão integral sem margarina"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["10", "Água de côco"],
    ["85", "Sorvete 100ml"],
    ["66", "Iogurte com polpas variadas"],
    ["26", "Polpa - Goiaba"],
    ["91", "Mingau"],
    ["91", "Mingau DM"],
    ["92", "Mingau sem lactose"],
    ["92", "Mingau DM sem lactose"],
    ["103", "Caldo Carne/Frango"],
  ],
  ALMOCO: [
    ["31", "FUNCIONARIO"],
    ["33", "ACOMPANHANTE"],
    ["35", "Geral"],
    ["35", "Geral HAS"],
    ["35", "Geral HAS DM"],
    ["35", "Geral DM"],
    ["38", "Geral conservador"],
    ["38", "Geral cons DM"],
    ["40", "Geral diálise"],
    ["40", "Geral diálise DM"],
    ["41", "Geral Hepato"],
    ["41", "Geral Hepato DM"],
    ["37", "Geral Pediatria"],
    ["39", "Geral Pediatria Renal Conservador"],
    ["36", "Geral Hiper"],
    ["42", "Branda"],
    ["42", "Branda HAS"],
    ["42", "Branda HAS DM"],
    ["42", "Branda DM"],
    ["45", "Branda Conservador"],
    ["45", "Branda Cons DM"],
    ["47", "Branda Diálise"],
    ["47", "Branda Diálise DM"],
    ["48", "Branda Hepato"],
    ["48", "Branda Hepato DM"],
    ["44", "Branda Pediatria"],
    ["46", "Branda Pediatria Renal Conservador"],
    ["43", "Branda Hiper"],
    ["49", "Pastosa"],
    ["49", "Pastosa HAS"],
    ["49", "Pastosa HAS DM"],
    ["49", "Pastosa DM"],
    ["51", "Pastosa Conservador"],
    ["51", "Pastosa Cons DM"],
    ["53", "Pastosa Diálise"],
    ["53", "Pastosa Diálise DM"],
    ["54", "Pastosa Hepato"],
    ["54", "Pastosa Hepato DM"],
    ["50", "Pastosa Pediatria"],
    ["52", "Pastosa Pediatria Renal Conservador"],
    ["57", "Sopa inteira (500ml)"],
    ["57", "Sopa Inteira HAS (500ml)"],
    ["55", "Sopa passada (500ml)"],
    ["55", "Sopa passada HAS (500ml)"],
    ["55", "Sopa passada HAS DM (500ml)"],
    ["55", "Sopa passada DM (500ml)"],
    ["58", "Sopa inteira (300ml)"],
    ["58", "Sopa inteira HAS (300ml)"],
    ["56", "Sopa passada (300ml)"],
    ["56", "Sopa passada HAS (300ml)"],
    ["56", "Sopa passada HAS DM (300ml)"],
    ["56", "Sopa passada DM (300ml)"],
    ["86", "Limão"],
    ["68", "Ovo"],
    ["103", "Caldo de feijão"],
    ["85", "Sorvete 100ml"],
    ["73", "Pão Hot Dog (com margarina)"],
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["59", "Vitamina - Acerola - Regular"],
    ["60", "Vitamina - Acerola - DM"],
    ["95", "Vitamina - Acerola - DM sem Lactose"],
    ["95", "Vitamina - Acerola - Sem lactose"],
    ["59", "Vitamina - Acerola - Desnatado"],
    ["59", "Vitamina - Ameixa - Regular"],
    ["60", "Vitamina - Ameixa - DM"],
    ["95", "Vitamina - Ameixa - DM sem Lactose"],
    ["95", "Vitamina - Ameixa - Sem lactose"],
    ["59", "Vitamina - Ameixa - Desnatado"],
    ["59", "Vitamina - Cajá - Regular"],
    ["60", "Vitamina - Cajá - DM"],
    ["95", "Vitamina - Cajá - DM sem Lactose"],
    ["95", "Vitamina - Cajá - Sem lactose"],
    ["59", "Vitamina - Cajá - Desnatado"],
    ["59", "Vitamina - Goiaba - Regular"],
    ["60", "Vitamina - Goiaba - DM"],
    ["95", "Vitamina - Goiaba - DM sem Lactose"],
    ["95", "Vitamina - Goiaba - Sem lactose"],
    ["59", "Vitamina - Goiaba - Desnatado"],
    ["59", "Vitamina - Graviola - Regular"],
    ["60", "Vitamina - Graviola - DM"],
    ["95", "Vitamina - Graviola - DM sem Lactose"],
    ["95", "Vitamina - Graviola - Sem lactose"],
    ["59", "Vitamina - Graviola - Desnatado"],
    ["59", "Vitamina - Manga - Regular"],
    ["60", "Vitamina - Manga - DM"],
    ["95", "Vitamina - Manga - DM sem Lactose"],
    ["95", "Vitamina - Manga - Sem lactose"],
    ["59", "Vitamina - Manga - Desnatado"],
    ["59", "Vitamina - Maracujá - Regular"],
    ["60", "Vitamina - Maracujá - DM"],
    ["95", "Vitamina - Maracujá - DM sem Lactose"],
    ["95", "Vitamina - Maracujá - Sem lactose"],
    ["59", "Vitamina - Maracujá - Desnatado"],
    ["15", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["13", "Melancia"],
    ["12", "Melão japonês"],
    ["21", "Tangerina"],
    ["67", "Cuscuz"],
    ["10", "Água de côco"],
    ["91", "Mingau"],
    ["72", "Pão integral"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["78", "Sanduiche misto"],
  ],
  LANCHE: [
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["7", "Suco de Laranja"],
    ["94", "Suco de Maçã Sem Açucar"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["59", "Vitamina - Acerola - Regular"],
    ["60", "Vitamina - Acerola - DM"],
    ["95", "Vitamina - Acerola - DM sem Lactose"],
    ["95", "Vitamina - Acerola - Sem lactose"],
    ["59", "Vitamina - Acerola - Desnatado"],
    ["59", "Vitamina - Ameixa - Regular"],
    ["60", "Vitamina - Ameixa - DM"],
    ["95", "Vitamina - Ameixa - DM sem Lactose"],
    ["95", "Vitamina - Ameixa - Sem lactose"],
    ["59", "Vitamina - Ameixa - Desnatado"],
    ["59", "Vitamina - Cajá - Regular"],
    ["60", "Vitamina - Cajá - DM"],
    ["95", "Vitamina - Cajá - DM sem Lactose"],
    ["95", "Vitamina - Cajá - Sem lactose"],
    ["59", "Vitamina - Cajá - Desnatado"],
    ["59", "Vitamina - Goiaba - Regular"],
    ["60", "Vitamina - Goiaba - DM"],
    ["95", "Vitamina - Goiaba - DM sem Lactose"],
    ["95", "Vitamina - Goiaba - Sem lactose"],
    ["59", "Vitamina - Goiaba - Desnatado"],
    ["59", "Vitamina - Graviola - Regular"],
    ["60", "Vitamina - Graviola - DM"],
    ["95", "Vitamina - Graviola - DM sem Lactose"],
    ["95", "Vitamina - Graviola - Sem lactose"],
    ["59", "Vitamina - Graviola - Desnatado"],
    ["59", "Vitamina - Manga - Regular"],
    ["60", "Vitamina - Manga - DM"],
    ["95", "Vitamina - Manga - DM sem Lactose"],
    ["95", "Vitamina - Manga - Sem lactose"],
    ["59", "Vitamina - Manga - Desnatado"],
    ["59", "Vitamina - Maracujá - Regular"],
    ["60", "Vitamina - Maracujá - DM"],
    ["95", "Vitamina - Maracujá - DM sem Lactose"],
    ["95", "Vitamina - Maracujá - Sem lactose"],
    ["59", "Vitamina - Maracujá - Desnatado"],
    ["15", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["13", "Melancia"],
    ["12", "Melão japonês"],
    ["21", "Tangerina"],
    ["30", "Polpa ameixa"],
    ["73", "Pão hot dog"],
    ["74", "Pão hot dog sem margarina"],
    ["73", "Pão francês"],
    ["74", "Pão francês sem margarina"],
    ["72", "Pão integral sem margarina"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["76", "Tapioca"],
    ["67", "Cuscuz"],
    ["10", "Água de côco"],
    ["85", "Sorvete 100ml"],
    ["66", "Iogurte com polpas variadas"],
    ["91", "Mingau"],
    ["91", "Mingau DM"],
    ["92", "Mingau sem lactose"],
    ["92", "Mingau DM sem lactose"],
    ["9", "Pratinhos de frutas"],
    ["80", "Leite (litro)"],
    ["96", "Leite (sem lactose, copo 250ml)"],
    ["68", "Ovo"],
    ["65", "Café Litro"],
    ["78", "Sanduiche misto"],
  ],
  JANTAR: [
    ["62", "FUNCIONARIO"],
    ["63", "ACOMPANHANTE"],
    ["57", "Sopa inteira (500ml)"],
    ["57", "Sopa Inteira HAS (500ml)"],
    ["57", "Sopa Inteira HAS DM (500ml)"],
    ["57", "Sopa Inteira DM (500ml)"],
    ["55", "Sopa passada (500ml)"],
    ["55", "Sopa passada HAS (500ml)"],
    ["55", "Sopa passada HAS DM (500ml)"],
    ["55", "Sopa passada DM (500ml)"],
    ["58", "Sopa inteira (300ml)"],
    ["58", "Sopa inteira HAS (300ml)"],
    ["58", "Sopa Inteira HAS DM (300ml)"],
    ["58", "Sopa Inteira DM (300ml)"],
    ["56", "Sopa passada (300ml)"],
    ["56", "Sopa passada HAS (300ml)"],
    ["56", "Sopa passada HAS DM (300ml)"],
    ["56", "Sopa passada DM (300ml)"],
    ["105", "Sopa Inteira 300ml Pão Forma Integral"],
    ["106", "Sopa Inteira 500ml Pão Forma Integral"],
    ["107", "Sopa Inteira 300ml Pão Hot Dog"],
    ["42", "Branda"],
    ["42", "Branda HAS"],
    ["42", "Branda HAS DM"],
    ["42", "Branda DM"],
    ["45", "Branda Conservador"],
    ["45", "Branda Cons DM"],
    ["47", "Branda Diálise"],
    ["47", "Branda Diálise DM"],
    ["48", "Branda Hepato"],
    ["48", "Branda Hepato DM"],
    ["44", "Branda Pediatria"],
    ["46", "Branda Pediatria Renal Conservador"],
    ["43", "Branda Hiper"],
    ["49", "Pastosa"],
    ["49", "Pastosa HAS"],
    ["49", "Pastosa HAS DM"],
    ["49", "Pastosa DM"],
    ["51", "Pastosa Conservador"],
    ["51", "Pastosa Cons DM"],
    ["53", "Pastosa Diálise"],
    ["53", "Pastosa Diálise DM"],
    ["54", "Pastosa Hepato"],
    ["54", "Pastosa Hepato DM"],
    ["50", "Pastosa Pediatria"],
    ["52", "Pastosa Pediatria Renal Conservador"],
    ["73", "Pão hot dog"],
    ["74", "Pão hot dog sem margarina"],
    ["73", "Pão francês"],
    ["74", "Pão francês sem margarina"],
    ["75", "Pão integral"],
    ["75", "Pão integral sem margarina"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["76", "Tapioca"],
    ["67", "Cuscuz"],
    ["77", "Sanduiche de peito frango"],
    ["77", "Sanduiche de creme frango"],
    ["78", "Sanduiche misto"],
    ["68", "Ovo"],
    ["85", "Sorvete 140ml"],
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["59", "Vitamina - Acerola - Regular"],
    ["60", "Vitamina - Acerola - DM"],
    ["95", "Vitamina - Acerola - DM sem Lactose"],
    ["95", "Vitamina - Acerola - Sem lactose"],
    ["59", "Vitamina - Acerola - Desnatado"],
    ["59", "Vitamina - Ameixa - Regular"],
    ["60", "Vitamina - Ameixa - DM"],
    ["95", "Vitamina - Ameixa - DM sem Lactose"],
    ["95", "Vitamina - Ameixa - Sem lactose"],
    ["59", "Vitamina - Ameixa - Desnatado"],
    ["59", "Vitamina - Cajá - Regular"],
    ["60", "Vitamina - Cajá - DM"],
    ["95", "Vitamina - Cajá - DM sem Lactose"],
    ["95", "Vitamina - Cajá - Sem lactose"],
    ["59", "Vitamina - Cajá - Desnatado"],
    ["59", "Vitamina - Goiaba - Regular"],
    ["60", "Vitamina - Goiaba - DM"],
    ["95", "Vitamina - Goiaba - DM sem Lactose"],
    ["95", "Vitamina - Goiaba - Sem lactose"],
    ["59", "Vitamina - Goiaba - Desnatado"],
    ["59", "Vitamina - Graviola - Regular"],
    ["60", "Vitamina - Graviola - DM"],
    ["95", "Vitamina - Graviola - DM sem Lactose"],
    ["95", "Vitamina - Graviola - Sem lactose"],
    ["59", "Vitamina - Graviola - Desnatado"],
    ["59", "Vitamina - Manga - Regular"],
    ["60", "Vitamina - Manga - DM"],
    ["95", "Vitamina - Manga - DM sem Lactose"],
    ["95", "Vitamina - Manga - Sem lactose"],
    ["59", "Vitamina - Manga - Desnatado"],
    ["59", "Vitamina - Maracujá - Regular"],
    ["60", "Vitamina - Maracujá - DM"],
    ["95", "Vitamina - Maracujá - DM sem Lactose"],
    ["95", "Vitamina - Maracujá - Sem lactose"],
    ["59", "Vitamina - Maracujá - Desnatado"],
    ["25", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["13", "Melancia"],
    ["12", "Melão japonês"],
    ["21", "Tangerina"],
    ["10", "Água de côco"],
    ["91", "Mingau"],
    ["91", "Mingau DM"],
    ["92", "Mingau sem lactose"],
    ["92", "Mingau DM sem lactose"],
    ["66", "Iogurte com polpas variadas"],
    ["96", "Leite (sem lactose, copo 250ml)"],
    ["80", "Leite (litro)"],
    ["9", "Pratinhos de frutas"],
  ],
  CEIA: [
    ["73", "Pão hot dog"],
    ["74", "Pão hot dog sem margarina"],
    ["73", "Pão francês"],
    ["74", "Pão francês sem margarina"],
    ["75", "Pão integral"],
    ["71", "Biscoito salgado"],
    ["70", "Biscoito doce"],
    ["72", "Biscoito Integral"],
    ["7", "Suco de laranja"],
    ["10", "Água de côco"],
    ["15", "Abacaxi"],
    ["18", "Banana"],
    ["19", "Goiaba"],
    ["20", "Laranja"],
    ["16", "Maçã"],
    ["14", "Mamão"],
    ["17", "Uva"],
    ["13", "Melancia"],
    ["21", "Tangerina"],
    ["12", "Melão japonês"],
    ["7", "Suco - Padrão - Regular"],
    ["7", "Suco - Acerola - Regular"],
    ["7", "Suco - Ameixa - Regular"],
    ["7", "Suco - Cajá - Regular"],
    ["7", "Suco - Goiaba - Regular"],
    ["7", "Suco - Graviola - Regular"],
    ["7", "Suco - Manga - Regular"],
    ["7", "Suco - Maracujá - Regular"],
    ["8", "Suco - Padrão - DM"],
    ["8", "Suco - Acerola - DM"],
    ["8", "Suco - Ameixa - DM"],
    ["8", "Suco - Cajá - DM"],
    ["8", "Suco - Goiaba - DM"],
    ["8", "Suco - Graviola - DM"],
    ["8", "Suco - Manga - DM"],
    ["23", "Suco - Maracujá - DM"],
    ["59", "Vitamina - Padrão - Regular"],
    ["60", "Vitamina - Padrão - DM"],
    ["95", "Vitamina - Padrão - DM sem Lactose"],
    ["95", "Vitamina - Padrão - Sem lactose"],
    ["59", "Vitamina - Padrão - Desnatado"],
    ["59", "Vitamina - Acerola - Regular"],
    ["60", "Vitamina - Acerola - DM"],
    ["95", "Vitamina - Acerola - DM sem Lactose"],
    ["95", "Vitamina - Acerola - Sem lactose"],
    ["59", "Vitamina - Acerola - Desnatado"],
    ["59", "Vitamina - Ameixa - Regular"],
    ["60", "Vitamina - Ameixa - DM"],
    ["95", "Vitamina - Ameixa - DM sem Lactose"],
    ["95", "Vitamina - Ameixa - Sem lactose"],
    ["59", "Vitamina - Ameixa - Desnatado"],
    ["59", "Vitamina - Cajá - Regular"],
    ["60", "Vitamina - Cajá - DM"],
    ["95", "Vitamina - Cajá - DM sem Lactose"],
    ["95", "Vitamina - Cajá - Sem lactose"],
    ["59", "Vitamina - Cajá - Desnatado"],
    ["59", "Vitamina - Goiaba - Regular"],
    ["60", "Vitamina - Goiaba - DM"],
    ["95", "Vitamina - Goiaba - DM sem Lactose"],
    ["95", "Vitamina - Goiaba - Sem lactose"],
    ["59", "Vitamina - Goiaba - Desnatado"],
    ["59", "Vitamina - Graviola - Regular"],
    ["60", "Vitamina - Graviola - DM"],
    ["95", "Vitamina - Graviola - DM sem Lactose"],
    ["95", "Vitamina - Graviola - Sem lactose"],
    ["59", "Vitamina - Graviola - Desnatado"],
    ["59", "Vitamina - Manga - Regular"],
    ["60", "Vitamina - Manga - DM"],
    ["95", "Vitamina - Manga - DM sem Lactose"],
    ["95", "Vitamina - Manga - Sem lactose"],
    ["59", "Vitamina - Manga - Desnatado"],
    ["59", "Vitamina - Maracujá - Regular"],
    ["60", "Vitamina - Maracujá - DM"],
    ["95", "Vitamina - Maracujá - DM sem Lactose"],
    ["95", "Vitamina - Maracujá - Sem lactose"],
    ["59", "Vitamina - Maracujá - Desnatado"],
    ["9", "Pratinhos de frutas"],
    ["80", "Leite (litro)"],
    ["96", "Leite (sem lactose, copo 250ml)"],
    ["91", "Mingau"],
    ["91", "Mingau DM"],
    ["92", "Mingau sem lactose"],
    ["92", "Mingau DM sem lactose"],
    ["66", "Iogurte com polpas variadas"],
    ["68", "Ovo"],
    ["87", "Quentinha, und"],
    ["", "Utilizado no dia, sem refeição específica"],
    ["88", "Opção 1: Coffee-break: Suco, café, bolo simples, mini sanduíche no pão de forma com patê de frango, descartáveis e louça para servir."],
    ["89", "Opção 2: Coffee-break: Suco, café, bolo simples, torrada, 2 patês, biscoitos finos doces, biscoitos finos salgados, descartáveis e louça para servir."],
    ["90", "Opção 3: Coffee-break: Suco, café, chocolate quente, bolo com cobertura, mini sanduíche, mini salada de frutas, canudinhos de frango, biscoitos finos doces, biscoitos finos salgados + geleia de fruta, descartáveis e louça para servir."],
    ["98", "Copos descartáveis com tampa de 300 ml"],
    ["99", "Copos descartáveis com tampa de 100 ml"],
    ["100", "Salada crua:: vegetais crus não folhosos ralados ou em cortes pequenos para porcionamento na unidade"],
    ["108", "Gelatina regular, com descartável, pote de 100ml com tampa"],
    ["104", "Refeição de colaborador e acompanhantes, com opção de proteína vegetariana"],
    ["22", "Polpa de Cajá - 100g"],
    ["23", "Polpa de Maracujá - 100g"],
    ["24", "Polpa de Caju - 100g"],
    ["25", "Polpa de Abacaxi - 100g"],
    ["26", "Polpa de Goiaba - 100g"],
    ["27", "Polpa de Acerola - 100g"],
    ["28", "Polpa de Manga - 100g"],
    ["29", "Polpa de Graviola - 100g"],
    ["30", "Polpa ameixa"],
    ["87", "Talher (und)"],
    ["79", "Suco para reunião 200ml"],
    ["81", "Bolo fatia -120g"],
    ["65", "Café Litro"],
  ],
};

// Colunas de clínica, na ordem da planilha FATURAMENTO.
const COLUNAS_CLINICAS = [
  "ALOJAMENTO",
  "QT",
  "UTI",
  "ONCO C",
  "HEMATO",
  "CIR ONCO",
  "CIR VASCULAR",
  "CIR UROLOGIA",
  "EXTRA",
  "A5 CLINICA MEDICA/NEFROLOGIA/ CAB E PESCOÇO",
  "ORTO 1",
  "CASA DA GESTANTE",
  "CL CIR GERAL",
  "A7 CLINICA MEDICA/TORÁCICA",
  "UIB CIRURGICA 1 E 2",
  "UIB CLINICA",
  "UIB Vascular",
  "UIB Hemato Onco",
  "UIB Obstétrica 1",
  "CARDIO PED",
  "CpN 3",
  "Uncico",
  "OBST. C6",
  "CLI GINECOL.",
  "A5 UCP (UNIDADE DE CUIDADOS)"
];

// ============================================================
// CONFIGURAÇÃO NAS ABAS DA PLANILHA (Apps Script)
// ============================================================
// As três abas são criadas com os dados padrão no primeiro uso e podem
// ser editadas tanto pelo app quanto diretamente na planilha.

const ABA_ITENS = 'Itens';
const ABA_REGRAS = 'Regras';
const ABA_CLINICAS = 'Clinicas';

function rotuloDaSecao(chave) {
  for (let i = 0; i < SECOES_QDR.length; i++) {
    if (SECOES_QDR[i].chave === chave) return SECOES_QDR[i].rotulo;
  }
  return chave;
}

function garantirAbaComCabecalho(ss, nome, cabecalho) {
  let sheet = ss.getSheetByName(nome);
  let criada = false;
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    criada = true;
  }
  return { sheet: sheet, criada: criada };
}

function garantirConfigQuantitativo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const itens = garantirAbaComCabecalho(ss, ABA_ITENS, ['Seção', 'ID faturamento', 'Nome do item']);
  if (itens.criada) {
    const linhas = [];
    SECOES_QDR.forEach(({ chave }) => {
      const lista = ITENS_FATURAMENTO[chave] || ITENS_EXTRAS[chave] || [];
      lista.forEach(([id, nome]) => linhas.push([chave, id, nome]));
    });
    itens.sheet.getRange(2, 1, linhas.length, 3).setValues(linhas);
  }

  const regras = garantirAbaComCabecalho(ss, ABA_REGRAS,
    ['Refeições (* = todas)', 'Texto no PDF', 'Item(ns) na planilha (";" separa itens, ">" define alternativas)']);
  if (regras.criada) {
    const linhas = montarRegrasPadrao().map(regra => [regra.refeicoes, regra.padrao, regra.itens]);
    regras.sheet.getRange(2, 1, linhas.length, 3).setValues(linhas);
  }

  const clinicas = garantirAbaComCabecalho(ss, ABA_CLINICAS,
    ['Coluna no quantitativo', 'Nomes no PDF (separados por ";")']);
  if (clinicas.criada) {
    const linhas = clinicasPadrao().map(clinica => [clinica.coluna, clinica.aliases.join('; ')]);
    clinicas.sheet.getRange(2, 1, linhas.length, 2).setValues(linhas);
  }

  return ss;
}

function lerAba(ss, nome) {
  const sheet = ss.getSheetByName(nome);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

/** Lê as três abas de configuração e compila o classificador. */
function carregarConfigQuantitativo() {
  const ss = garantirConfigQuantitativo();

  const itensPorSecao = {};
  SECOES_QDR.forEach(({ chave }) => { itensPorSecao[chave] = []; });
  lerAba(ss, ABA_ITENS).forEach(([secao, id, nome]) => {
    const chave = normalizarTexto(secao).replace(/ /g, '');
    if (itensPorSecao[chave] && String(nome).trim()) {
      itensPorSecao[chave].push([String(id || ''), String(nome).trim()]);
    }
  });

  const regras = lerAba(ss, ABA_REGRAS)
    .map(([refeicoes, padrao, itens]) => ({ refeicoes: refeicoes, padrao: padrao, itens: itens }))
    .filter(regra => String(regra.padrao).trim() && String(regra.itens).trim());

  const clinicas = lerAba(ss, ABA_CLINICAS)
    .filter(([coluna]) => String(coluna).trim())
    .map(([coluna, aliases]) => ({
      coluna: String(coluna).trim(),
      aliases: String(aliases || '').split(';').map(s => s.trim()).filter(Boolean)
    }));

  return prepararConfig(itensPorSecao, regras, clinicas);
}

// ============================================================
// ENDPOINT: GERAR O QUANTITATIVO (chamado pelo frontend)
// ============================================================

/**
 * Recebe { clinica, data, pacientes } (a lista já revisada na prévia) e
 * devolve o quantitativo classificado + catálogo/colunas para a tela de
 * conferência.
 */
function montarQuantitativo(dados) {
  try {
    if (!dados || !Array.isArray(dados.pacientes)) {
      return { sucesso: false, erro: 'Dados inválidos recebidos do frontend.' };
    }
    const config = carregarConfigQuantitativo();
    const resultado = gerarQuantitativo(dados.pacientes, config);

    const catalogo = SECOES_QDR.map(({ chave, rotulo }) => ({
      secao: chave,
      rotulo: rotulo,
      itens: (config.indices[chave] ? config.indices[chave].lista : [])
        .map(item => ({ id: item.id, nome: item.nome }))
    }));

    return {
      sucesso: true,
      secoes: resultado.secoes,
      naoReconhecidos: resultado.naoReconhecidos,
      avisos: resultado.avisos,
      coluna: resolverColunaClinica(dados.clinica, config.clinicas),
      colunas: config.clinicas.map(clinica => clinica.coluna),
      catalogo: catalogo
    };
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  }
}

// ============================================================
// GRAVAÇÃO: ABA "QDR dd-MM" (mesmo layout da planilha FATURAMENTO)
// ============================================================

function nomeAbaQdr(data) {
  const partes = String(data || '').split('/');
  if (partes.length >= 2) return 'QDR ' + partes[0] + '-' + partes[1];
  return 'QDR ' + String(data || 'sem data');
}

/**
 * Cria a aba do dia com o esqueleto completo: para cada seção, uma linha
 * de cabeçalho (ID | Seção | clínicas... | TOTAL) seguida de uma linha
 * por item do catálogo, na mesma ordem da planilha FATURAMENTO.
 */
function garantirAbaQdr(ss, nome, config) {
  let sheet = ss.getSheetByName(nome);
  if (sheet) return sheet;

  sheet = ss.insertSheet(nome);
  const colunas = config.clinicas.map(clinica => clinica.coluna);
  const totalColunas = 2 + colunas.length + 1;
  const linhas = [];
  const formatos = []; // [linha (1-based), tipo]

  SECOES_QDR.forEach(({ chave, rotulo }) => {
    const indice = config.indices[chave];
    if (!indice || indice.lista.length === 0) return;
    linhas.push(['ID', rotulo].concat(colunas).concat(['TOTAL']));
    formatos.push([linhas.length, 'cabecalho']);
    indice.lista.forEach(item => {
      const linha = [item.id, item.nome];
      for (let c = 0; c < colunas.length; c++) linha.push('');
      const numLinha = linhas.length + 1;
      const inicio = colunaParaLetra(3);
      const fim = colunaParaLetra(2 + colunas.length);
      linha.push('=SUM(' + inicio + numLinha + ':' + fim + numLinha + ')');
      linhas.push(linha);
    });
  });

  sheet.getRange(1, 1, linhas.length, totalColunas).setValues(linhas);
  formatos.forEach(([numLinha]) => {
    sheet.getRange(numLinha, 1, 1, totalColunas)
      .setFontWeight('bold')
      .setBackground('#e8eaf6')
      .setWrap(true);
  });
  sheet.setColumnWidth(2, 280);
  sheet.setFrozenColumns(2);
  return sheet;
}

function colunaParaLetra(coluna) {
  let letra = '';
  while (coluna > 0) {
    const resto = (coluna - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    coluna = Math.floor((coluna - 1) / 26);
  }
  return letra;
}

/**
 * Escreve as contagens de UMA clínica na aba do dia: zera a coluna da
 * clínica e preenche os valores novos (re-upload do mesmo PDF substitui
 * a própria coluna sem tocar nas outras clínicas).
 */
function escreverColunaQdr(sheet, coluna, contagens, config) {
  const valores = sheet.getDataRange().getValues();
  if (valores.length === 0) throw new Error('Aba de quantitativo vazia.');

  // localiza a coluna da clínica pela primeira linha de cabeçalho
  let indiceColuna = -1;
  let colunaInserida = false;
  const cabecalho = valores[0];
  for (let c = 2; c < cabecalho.length; c++) {
    if (String(cabecalho[c]).trim() === coluna) { indiceColuna = c; break; }
  }
  if (indiceColuna === -1) {
    // coluna criada na aba Clinicas depois da aba do dia: insere antes do TOTAL
    indiceColuna = cabecalho.length - 1;
    sheet.insertColumnBefore(indiceColuna + 1);
    colunaInserida = true;
  }

  // mapa (seção normalizada + nome do item normalizado) -> quantidade
  const desejado = {};
  contagens.forEach(contagem => {
    if (!contagem || !(contagem.qtd > 0)) return;
    const chave = normalizarTexto(contagem.secao).replace(/ /g, '') + '||' +
      chaveDePalavras(palavrasDe(contagem.nome));
    desejado[chave] = (desejado[chave] || 0) + Number(contagem.qtd);
  });

  const rotulosParaChave = {};
  SECOES_QDR.forEach(({ chave, rotulo }) => {
    rotulosParaChave[normalizarTexto(rotulo)] = chave;
  });

  // reescreve a coluna da clínica inteira de uma vez (cabeçalhos de seção
  // mantidos), para que um re-upload substitua a coluna sem deixar sobras
  const naoEncontrados = [];
  const colunaValores = [];
  const linhasCabecalho = [];
  const linhasItem = [];
  let secaoAtual = '';
  for (let l = 0; l < valores.length; l++) {
    if (String(valores[l][0]).trim() === 'ID') {
      secaoAtual = rotulosParaChave[normalizarTexto(valores[l][1])] || '';
      linhasCabecalho.push(l);
      colunaValores.push([colunaInserida ? coluna : valores[l][indiceColuna]]);
      continue;
    }
    const nome = String(valores[l][1] || '').trim();
    if (!secaoAtual || !nome) {
      colunaValores.push([colunaInserida ? '' : valores[l][indiceColuna]]);
      continue;
    }
    linhasItem.push(l);
    const chave = secaoAtual + '||' + chaveDePalavras(palavrasDe(nome));
    if (chave in desejado) {
      colunaValores.push([desejado[chave]]);
      delete desejado[chave];
    } else {
      colunaValores.push(['']);
    }
  }
  sheet.getRange(1, indiceColuna + 1, colunaValores.length, 1).setValues(colunaValores);

  if (colunaInserida) {
    // formata os cabeçalhos da coluna nova e reescreve as fórmulas de
    // TOTAL, que não se expandem sozinhas para a coluna inserida
    linhasCabecalho.forEach(l => {
      sheet.getRange(l + 1, indiceColuna + 1)
        .setFontWeight('bold').setBackground('#e8eaf6').setWrap(true);
    });
    const letraFim = colunaParaLetra(indiceColuna + 1);
    linhasItem.forEach(l => {
      sheet.getRange(l + 1, indiceColuna + 2)
        .setValue('=SUM(C' + (l + 1) + ':' + letraFim + (l + 1) + ')');
    });
  }

  Object.keys(desejado).forEach(chave => {
    naoEncontrados.push(chave.split('||')[0] + ': item sem linha na aba (adicione na aba Itens e regrave)');
  });
  return naoEncontrados;
}

// ============================================================
// ENDPOINT: GRAVAR TUDO (chamado pelo frontend após conferência)
// ============================================================

/**
 * payload = {
 *   data, clinica, coluna,
 *   contagens: [{secao, id, nome, qtd}],
 *   pacientes: [...],                        // grava também na aba Base
 *   regrasNovas: [{refeicoes, padrao, itens}], // aprendidas na conferência
 *   itensNovos: [{secao, id, nome}]
 * }
 */
function salvarQuantitativo(payload) {
  if (!payload || !Array.isArray(payload.contagens)) {
    return { sucesso: false, erro: 'Dados inválidos recebidos do frontend.' };
  }
  if (!payload.coluna) {
    return { sucesso: false, erro: 'Escolha a coluna da clínica antes de gravar.' };
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
    const ss = garantirConfigQuantitativo();

    // 1. aprende itens e regras novos criados na tela de conferência
    (payload.itensNovos || []).forEach(item => {
      if (item && item.secao && item.nome) {
        ss.getSheetByName(ABA_ITENS).appendRow(
          [item.secao, item.id || '', sanitizarValorCelula(item.nome)]);
      }
    });
    (payload.regrasNovas || []).forEach(regra => {
      if (regra && regra.padrao && regra.itens) {
        ss.getSheetByName(ABA_REGRAS).appendRow([
          regra.refeicoes || '*',
          sanitizarValorCelula(regra.padrao),
          sanitizarValorCelula(regra.itens)
        ]);
      }
    });

    // 2. memoriza o nome do PDF como apelido da coluna escolhida
    aprenderApelidoClinica(ss, payload.clinica, payload.coluna);

    // 3. recarrega a configuração já com o que foi aprendido
    const config = carregarConfigQuantitativo();

    // 4. grava o quantitativo na aba do dia
    const sheetQdr = garantirAbaQdr(ss, nomeAbaQdr(payload.data), config);
    const pendencias = escreverColunaQdr(sheetQdr, payload.coluna, payload.contagens, config);

    // 5. grava a lista de pacientes na aba Base (auditoria)
    let linhasBase = 0;
    if (Array.isArray(payload.pacientes) && payload.pacientes.length > 0) {
      linhasBase = gravarPacientesNaBase({
        data: payload.data,
        clinica: payload.clinica,
        pacientes: payload.pacientes
      });
    }

    return {
      sucesso: true,
      aba: sheetQdr.getName(),
      coluna: payload.coluna,
      itensGravados: payload.contagens.filter(c => c && c.qtd > 0).length,
      linhasBase: linhasBase,
      pendencias: pendencias
    };
  } catch (erro) {
    return { sucesso: false, erro: erro.message };
  } finally {
    lock.releaseLock();
  }
}

function aprenderApelidoClinica(ss, nomePdf, coluna) {
  const nome = String(nomePdf || '').trim();
  if (!nome) return;
  const sheet = ss.getSheetByName(ABA_CLINICAS);
  if (!sheet || sheet.getLastRow() < 2) return;
  const valores = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();

  for (let l = 0; l < valores.length; l++) {
    const aliases = String(valores[l][1] || '').split(';').map(s => s.trim()).filter(Boolean);
    const candidatos = [String(valores[l][0])].concat(aliases).map(normalizarChaveClinica);
    if (String(valores[l][0]).trim() === coluna) {
      if (candidatos.indexOf(normalizarChaveClinica(nome)) === -1) {
        aliases.push(nome);
        sheet.getRange(l + 2, 2).setValue(sanitizarValorCelula(aliases.join('; ')));
      }
      return;
    }
  }
  // coluna nova, ainda não cadastrada
  sheet.appendRow([sanitizarValorCelula(coluna), sanitizarValorCelula(nome)]);
}

// ============================================================
// EXPORT PARA TESTES (Node) — não afeta o Apps Script
// ============================================================
if (typeof module !== 'undefined') {
  module.exports = {
    normalizarTexto: normalizarTexto,
    palavrasDe: palavrasDe,
    montarRegrasPadrao: montarRegrasPadrao,
    prepararConfig: prepararConfig,
    configPadrao: configPadrao,
    clinicasPadrao: clinicasPadrao,
    resolverColunaClinica: resolverColunaClinica,
    classificarRefeicao: classificarRefeicao,
    gerarQuantitativo: gerarQuantitativo,
    limparTextoRefeicao: limparTextoRefeicao,
    nomeAbaQdr: nomeAbaQdr,
    garantirAbaQdr: garantirAbaQdr,
    escreverColunaQdr: escreverColunaQdr,
    ITENS_FATURAMENTO: ITENS_FATURAMENTO,
    ITENS_EXTRAS: ITENS_EXTRAS,
    COLUNAS_CLINICAS: COLUNAS_CLINICAS,
    SECOES_QDR: SECOES_QDR
  };
}
