/**
 * Testes leves (Node puro, sem framework) para os parsers de Code.gs.
 * Rodar com: node test/parsing.test.js
 *
 * Cobrem os padrões de desalinhamento observados num PDF real (clínica
 * A5-UNID CUIDADOS): nomes de pacientes diferentes concatenados na mesma
 * célula, refeições de um paciente vazando para outro, e texto de
 * cabeçalho de coluna aparecendo dentro de uma célula de dados.
 */
const assert = require('assert');
const { parsearPacientesDeTabela, parsearPacientes, REFEICOES } = require('../Code.gs');

let falhas = 0;

function teste(nome, fn) {
  try {
    fn();
    console.log('OK   -', nome);
  } catch (erro) {
    falhas++;
    console.error('FALHA -', nome);
    console.error('       ', erro.message);
  }
}

// ------------------------------------------------------------------
// parsearPacientesDeTabela
// ------------------------------------------------------------------

teste('tabela: linha bem formada não gera avisos', () => {
  const linhas = [
    ['A502.03', '5125-RENATA MELO DO NASCIMENTO-35 ano(s) 4 mes(es) e 25 dia(s)-MARIA MELO DA SILVA',
      'ENTERAL\nADENOCARCINOMA GÁSTRICO', 'ENTERAL\n160ML - ISOSOURCE SOYA', 'ENTERAL\n160ML - ISOSOURCE SOYA',
      'ENTERAL\n160ML - ISOSOURCE SOYA', 'ENTERAL\n160ML - ISOSOURCE SOYA', 'ENTERAL\n160ML - ISOSOURCE SOYA',
      'ENTERAL\n160ML - ISOSOURCE SOYA']
  ];
  const pacientes = parsearPacientesDeTabela(linhas);
  assert.strictEqual(pacientes.length, 1);
  assert.deepStrictEqual(pacientes[0].avisos, []);
});

teste('tabela: linha de leito vazio (sem identidade) é ignorada, não gera paciente', () => {
  const linhas = [
    ['A504.01', '', '', '', '', '', '', '', '']
  ];
  const pacientes = parsearPacientesDeTabela(linhas);
  assert.strictEqual(pacientes.length, 0);
});

teste('tabela: célula de refeição com identidade de outro paciente embutida gera aviso', () => {
  const linhas = [
    ['A503.03', '34801-FRANCISCO PEREIRA DOS SANTOS-84 ano(s) 0 mes(es) e 2 dia(s)-GEOGINA NAZARIO DOS SANTOS',
      'MISTA\nNEOPLASIA MALIGNA DA PROSTATA',
      // desjejum com dado de outro paciente colado (reproduz o padrão visto no PDF real)
      'ORAL\nSOPA PASSADA ** (ZERO - S/ SONDA)80ML - ISOSOURCE ENVIAR COLHER ** 34277-JOSE AUGUSTO DE LIMA-61 ano(s) 11 mes(es) e 30 dia(s)-MARIA AUGUSTA DE LIMA',
      'ORAL\nSOPA PASSADA', 'ORAL\nSOPA PASSADA', 'ORAL\nVITAMINA', 'ORAL\nVITAMINA', 'ORAL\nVITAMINA']
  ];
  const pacientes = parsearPacientesDeTabela(linhas);
  assert.strictEqual(pacientes.length, 1);
  assert.ok(pacientes[0].avisos.some(a => a.includes('mistura com outro paciente')),
    'esperava aviso de mistura, avisos: ' + JSON.stringify(pacientes[0].avisos));
});

teste('tabela: célula de refeição com texto de cabeçalho vazado gera aviso', () => {
  const linhas = [
    ['A506.04', '35436-MARIA DE FATIMA DE ALMEIDA-72 ano(s) 2 mes(es) e 12 dia(s)-MARIA LUISA OLIVEIRA DE ALMEIDA',
      'ENTERAL\nDIETA ENTERAL', 'ENTERAL\n150ML SURVIMED OPD HN', 'ENTERAL\n150ML SURVIMED OPD HN',
      'ENTERAL\n150ML SURVIMED OPD HN',
      // lanche com o próprio texto do cabeçalho de coluna vazado dentro da célula
      'LANCHE - 15h INSTABILIDADE', 'ENTERAL\n150ML SURVIMED OPD HN', 'ENTERAL\n150ML SURVIMED OPD HN']
  ];
  const pacientes = parsearPacientesDeTabela(linhas);
  assert.strictEqual(pacientes.length, 1);
  assert.ok(pacientes[0].avisos.some(a => a.includes('cabeçalho de coluna')),
    'esperava aviso de cabeçalho vazado, avisos: ' + JSON.stringify(pacientes[0].avisos));
});

teste('tabela: número de colunas fora do esperado gera aviso sem descartar o paciente', () => {
  const linhas = [
    // faltando a coluna CEIA (só 8 colunas em vez de 9)
    ['A502.03', '5125-RENATA MELO DO NASCIMENTO-35 ano(s) 4 mes(es) e 25 dia(s)-MARIA MELO DA SILVA',
      'ENTERAL\nDIAGNOSTICO', 'ENTERAL\nA', 'ENTERAL\nB', 'ENTERAL\nC', 'ENTERAL\nD', 'ENTERAL\nE']
  ];
  const pacientes = parsearPacientesDeTabela(linhas);
  assert.strictEqual(pacientes.length, 1);
  assert.ok(pacientes[0].avisos.some(a => a.includes('Número de colunas')),
    'esperava aviso de contagem de colunas, avisos: ' + JSON.stringify(pacientes[0].avisos));
});

// ------------------------------------------------------------------
// parsearPacientes (fallback texto corrido)
// ------------------------------------------------------------------

function textoPacienteCompleto(identidade, diagnostico, refeicoes) {
  // a via do diagnóstico vem colada sem espaço/linha própria no PDF real
  // (ex: "ORALDIETA ZERO"), então fica grudada na linha da identidade aqui
  // também — só as refeições têm a via em linha própria (isolada).
  const linhas = [identidade + 'ORAL' + diagnostico];
  refeicoes.forEach(r => {
    linhas.push('ORAL');
    linhas.push(r);
  });
  return linhas.join('\n');
}

teste('texto corrido: paciente com as 6 refeições completas não gera aviso de contagem', () => {
  const texto = textoPacienteCompleto(
    '13339-ANALBERYA DE FREITAS MORAIS-44 ano(s) 4 mes(es) e 15 dia(s)-ELENICE ANASTACIO DE FREITAS',
    'DIETA GERAL',
    ['LEITE MORNO + TAPIOCA', 'PÃO INTEGRAL COM QUEIJO', 'GERAL', 'VITAMINA', 'SUCO', 'CHÁ']
  );
  const pacientes = parsearPacientes(texto);
  assert.strictEqual(pacientes.length, 1);
  assert.strictEqual(pacientes[0].avisos.filter(a => a.includes('Quantidade de refeições')).length, 0);
  assert.strictEqual(pacientes[0].refeicoes.JANTAR, 'SUCO');
});

teste('texto corrido: refeição faltando desloca a contagem e gera aviso', () => {
  // só 5 refeições em vez de 6 (uma "engolida"/ausente no OCR)
  const texto = textoPacienteCompleto(
    '13339-ANALBERYA DE FREITAS MORAIS-44 ano(s) 4 mes(es) e 15 dia(s)-ELENICE ANASTACIO DE FREITAS',
    'DIETA GERAL',
    ['LEITE MORNO + TAPIOCA', 'PÃO INTEGRAL COM QUEIJO', 'GERAL', 'VITAMINA', 'SUCO']
  );
  const pacientes = parsearPacientes(texto);
  assert.strictEqual(pacientes.length, 1);
  assert.ok(pacientes[0].avisos.some(a => a.includes('Quantidade de refeições')),
    'esperava aviso de contagem, avisos: ' + JSON.stringify(pacientes[0].avisos));
  // com o deslocamento, o conteúdo de JANTAR (5º valor mapeado) é o que na
  // verdade era a refeição CEIA/última do paciente
  assert.strictEqual(pacientes[0].refeicoes.JANTAR, 'SUCO');
  assert.strictEqual(pacientes[0].refeicoes.CEIA, '');
});

teste('texto corrido: refeição contendo identidade de outro paciente gera aviso de mistura', () => {
  const texto = textoPacienteCompleto(
    '34801-FRANCISCO PEREIRA DOS SANTOS-84 ano(s) 0 mes(es) e 2 dia(s)-GEOGINA NAZARIO DOS SANTOS',
    'NEOPLASIA MALIGNA DA PROSTATA',
    [
      'MINGAU DM',
      // sem hífen antes de "ano(s)" simula um deslize do OCR: ainda cai no
      // padrão de identidade embutida, mas não é reconhecido como início de
      // um novo bloco de paciente — por isso permanece "grudado" nesta
      // refeição em vez de virar um paciente à parte.
      'SOPA PASSADA ** (ZERO - S/ SONDA)80ML - ISOSOURCE ** 34277-JOSE AUGUSTO DE LIMA 61 ano(s) 11 mes(es) e 30 dia(s) MARIA AUGUSTA DE LIMA',
      'SOPA PASSADA', 'VITAMINA DM', 'VITAMINA DM', 'VITAMINA DM'
    ]
  );
  const pacientes = parsearPacientes(texto);
  assert.strictEqual(pacientes.length, 1);
  assert.ok(pacientes[0].avisos.some(a => a.includes('mistura com outro paciente')),
    'esperava aviso de mistura, avisos: ' + JSON.stringify(pacientes[0].avisos));
});

console.log('');
if (falhas > 0) {
  console.error(falhas + ' teste(s) falharam.');
  process.exit(1);
} else {
  console.log('Todos os testes passaram.');
}
