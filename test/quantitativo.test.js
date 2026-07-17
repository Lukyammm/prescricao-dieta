/**
 * Testes leves (Node puro, sem framework) para o motor de quantitativo
 * de Quantitativo.gs. Rodar com: node test/quantitativo.test.js
 *
 * Os textos de refeição usados aqui foram copiados de PDFs reais
 * (clínicas OBS BREVE 02 - VASCULAR e A5-UNID CUIDADOS), incluindo as
 * quebras de linha do OCR.
 */
const assert = require('assert');
const {
  configPadrao,
  classificarRefeicao,
  gerarQuantitativo,
  resolverColunaClinica,
  clinicasPadrao
} = require('../Quantitativo.gs');

const config = configPadrao();

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

// Resumo compacto "SECAO:Nome xQtd" para comparar classificações.
function resumo(resultado) {
  return resultado.itens.map(item => item.secao + ':' + item.nome + ' x' + item.qtd).sort();
}

function classifica(texto, refeicao) {
  return classificarRefeicao(texto, refeicao, config);
}

// ------------------------------------------------------------------
// classificarRefeicao — casos reais dos PDFs
// ------------------------------------------------------------------

teste('café completo DM renal com fruta vira 2 itens', () => {
  const r = classifica('CAFÉ COMPLETO\nDM (RENAL) | FRUTA:\nMELANCIA', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), [
    'DESJEJUM:Café completo DM renal c/ pão integral x1',
    'DESJEJUM:Melancia x1'
  ]);
  assert.deepStrictEqual(r.naoReconhecidos, []);
});

teste('suplemento + biscoito: cada parte vira um item', () => {
  const r = classifica('PROLINE + BISCOITO\nINTEGRAL', 'LANCHE');
  assert.deepStrictEqual(resumo(r), [
    'ENTERAL:Proline (suplemento) x1',
    'LANCHE:Biscoito Integral x1'
  ]);
});

teste('sopa com volume explícito + refeição de acompanhante', () => {
  const r = classifica('SOPA PASSADA 300\nML >> LEVAR\nREFEIÇÃO PARA\nACOMPANHANTE', 'ALMOCO');
  assert.deepStrictEqual(resumo(r), [
    'ALMOCO:ACOMPANHANTE x1',
    'ALMOCO:Sopa passada (300ml) x1'
  ]);
});

teste('sopa sem volume usa 500ml como padrão', () => {
  const r = classifica('SOPA INTEIRA HAS\n(FRANGO)', 'ALMOCO');
  assert.deepStrictEqual(resumo(r), ['ALMOCO:Sopa Inteira HAS (500ml) x1']);
});

teste('modificadores em qualquer ordem: GERAL HAS/DM = Geral HAS DM', () => {
  assert.deepStrictEqual(resumo(classifica('GERAL HAS/DM', 'ALMOCO')), ['ALMOCO:Geral HAS DM x1']);
  assert.deepStrictEqual(resumo(classifica('GERAL DM/HAS', 'ALMOCO')), ['ALMOCO:Geral HAS DM x1']);
});

teste('BRANDA DM (CONSERVADOR) escolhe a regra mais específica', () => {
  const r = classifica('BRANDA DM\n(CONSERVADOR)\nFRUTA: ABACAXI', 'ALMOCO');
  assert.deepStrictEqual(resumo(r), ['ALMOCO:Abacaxi x1', 'ALMOCO:Branda Cons DM x1']);
});

teste('dieta enteral conta o frasco', () => {
  const r = classifica('160ML - ISOSOURCE\nSOYA', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), ['ENTERAL:Isosource Soya (frasco) x1']);
});

teste('exclusões (NÃO: ...) não geram contagem', () => {
  const r = classifica('CAFÉ COMPLETO\nNÃO: BANANA', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), ['DESJEJUM:Café Completo c/ pão hot dog x1']);
});

teste('observações **entre asteriscos** são ignoradas', () => {
  const r = classifica('BRANDA DIALISE DM\n**NÃO SUCO**', 'ALMOCO');
  assert.deepStrictEqual(resumo(r), ['ALMOCO:Branda Diálise DM x1']);
});

teste('vitamina de sabor com variante DM sem lactose + medida de FOS', () => {
  const r = classifica('VITAMINA DE GOIABA\nDM (SEM\nLACTOSE) + 1 MED\nDE FOS', 'LANCHE');
  assert.deepStrictEqual(resumo(r), [
    'ENTERAL:FOS (medida) x1',
    'LANCHE:Vitamina - Goiaba - DM sem Lactose x1'
  ]);
});

teste('vitamina de sabor cai para Padrão na seção sem a variante', () => {
  // o Desjejum só tem as linhas de vitamina Padrão
  const r = classifica('VITAMINA DE MANGA\n(SEM LACTOSE)', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), ['DESJEJUM:Vitamina - Padrão - Sem lactose x1']);
});

teste('nome de item com palavras em outra ordem resolve mesmo assim', () => {
  // Desjejum tem "Mingau sem lactose DM"; a regra aponta "Mingau DM sem lactose"
  const r = classifica('MINGAU DM (SEM\nLACTOSE)', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), ['DESJEJUM:Mingau sem lactose DM x1']);
});

teste('fruta renal com opções conta a primeira fruta listada', () => {
  const r = classifica('CAFÉ COMPLETO\nCOM CUSCUZ + OVO\nFRUTA RENAL\n(TANGERINA,\nABACAXI,\nMELANCIA)', 'DESJEJUM');
  assert.deepStrictEqual(resumo(r), [
    'DESJEJUM:Café completo c/ cuscuz x1',
    'DESJEJUM:Ovo x1',
    'DESJEJUM:Tangerina x1'
  ]);
});

teste('quantidade explícita no início da parte ("2 OVOS")', () => {
  const r = classifica('BRANDA DIALISE DM\n(SEM PROTEINA) + 2\nOVOS', 'ALMOCO');
  assert.deepStrictEqual(resumo(r), ['ALMOCO:Branda Diálise DM x1', 'ALMOCO:Ovo x2']);
});

teste('texto sem regra vai para não reconhecidos', () => {
  const r = classifica('PANQUECA DE ESPINAFRE', 'CEIA');
  assert.deepStrictEqual(r.itens, []);
  assert.deepStrictEqual(r.naoReconhecidos, ['PANQUECA DE ESPINAFRE']);
});

teste('observação clínica vazada (EVAC/aceitação) é descartada em silêncio', () => {
  const r = classifica('06/07 - BOA\nACEITAÇÃO |\nEVAC: OK', 'JANTAR');
  assert.deepStrictEqual(r.itens, []);
  assert.deepStrictEqual(r.naoReconhecidos, []);
});

teste('acompanhante em seção sem linha ACOMPANHANTE gera aviso, não contagem', () => {
  const r = classifica('MINGAU (SEM\nLACTOSE) >> LEVAR\nREFEIÇÃO PARA\nACOMPANHANTE', 'COLACAO');
  assert.deepStrictEqual(resumo(r), ['COLACAO:Mingau sem lactose x1']);
  assert.strictEqual(r.avisos.length, 1);
});

// ------------------------------------------------------------------
// gerarQuantitativo — agregação por paciente
// ------------------------------------------------------------------

function pacienteDe(leito, refeicoes) {
  return {
    prontuario: leito, nome: 'PACIENTE ' + leito, idade: '', nomeMae: '',
    leito: leito, diagnostico: '', avisos: [],
    refeicoes: Object.assign({
      DESJEJUM: '', COLACAO: '', ALMOCO: '', LANCHE: '', JANTAR: '', CEIA: ''
    }, refeicoes)
  };
}

teste('agrega contagens de vários pacientes com rastreio de origem', () => {
  const pacientes = [
    pacienteDe('L01', { DESJEJUM: 'CAFÉ COMPLETO DM', ALMOCO: 'GERAL HAS/DM' }),
    pacienteDe('L02', { DESJEJUM: 'CAFÉ COMPLETO DM', ALMOCO: 'BRANDA DM' }),
    pacienteDe('L03', { DESJEJUM: 'CAFÉ COMPLETO' })
  ];
  const q = gerarQuantitativo(pacientes, config);
  const desjejum = q.secoes.find(s => s.secao === 'DESJEJUM');
  const cafeDm = desjejum.itens.find(i => i.nome === 'Café completo DM c/ pão integral');
  assert.strictEqual(cafeDm.qtd, 2);
  assert.deepStrictEqual(cafeDm.origens.map(o => o.leito).sort(), ['L01', 'L02']);
  const cafe = desjejum.itens.find(i => i.nome === 'Café Completo c/ pão hot dog');
  assert.strictEqual(cafe.qtd, 1);
  const almoco = q.secoes.find(s => s.secao === 'ALMOCO');
  assert.strictEqual(almoco.itens.find(i => i.nome === 'Geral HAS DM').qtd, 1);
  assert.strictEqual(almoco.itens.find(i => i.nome === 'Branda DM').qtd, 1);
});

teste('paciente em dieta zero conta 1 vez, não 1 por refeição', () => {
  const pacientes = [pacienteDe('EXT01', {
    DESJEJUM: 'DIETA ZERO', COLACAO: 'DIETA ZERO', ALMOCO: 'DIETA ZERO',
    LANCHE: 'DIETA ZERO', JANTAR: 'DIETA ZERO', CEIA: 'DIETA ZERO'
  })];
  const q = gerarQuantitativo(pacientes, config);
  const enteral = q.secoes.find(s => s.secao === 'ENTERAL');
  assert.strictEqual(enteral.itens.find(i => i.nome === 'Dieta Zero').qtd, 1);
});

teste('dieta enteral 6x ao dia conta 6 frascos', () => {
  const pacientes = [pacienteDe('A502.03', {
    DESJEJUM: '160ML - ISOSOURCE SOYA', COLACAO: '160ML - ISOSOURCE SOYA',
    ALMOCO: '160ML - ISOSOURCE SOYA', LANCHE: '160ML - ISOSOURCE SOYA',
    JANTAR: '160ML - ISOSOURCE SOYA', CEIA: '160ML - ISOSOURCE SOYA'
  })];
  const q = gerarQuantitativo(pacientes, config);
  const enteral = q.secoes.find(s => s.secao === 'ENTERAL');
  assert.strictEqual(enteral.itens.find(i => i.nome === 'Isosource Soya (frasco)').qtd, 6);
});

teste('textos não reconhecidos carregam refeição e paciente', () => {
  const pacientes = [pacienteDe('L09', { CEIA: 'PANQUECA DE ESPINAFRE' })];
  const q = gerarQuantitativo(pacientes, config);
  assert.strictEqual(q.naoReconhecidos.length, 1);
  assert.strictEqual(q.naoReconhecidos[0].refeicao, 'CEIA');
  assert.strictEqual(q.naoReconhecidos[0].leito, 'L09');
});

// ------------------------------------------------------------------
// resolverColunaClinica — de-para de clínicas
// ------------------------------------------------------------------

teste('clínica do PDF resolve para a coluna da planilha (apelido)', () => {
  const clinicas = clinicasPadrao();
  assert.strictEqual(
    resolverColunaClinica('A5-UNID CUIDADOS', clinicas),
    'A5 UCP (UNIDADE DE CUIDADOS)');
  // nome vindo do NOME DO ARQUIVO, com cedilha perdida e sufixo numérico
  assert.strictEqual(
    resolverColunaClinica('A5CIR DE CABE A E PESCOCO', clinicas),
    'A5 CLINICA MEDICA/NEFROLOGIA/ CAB E PESCOÇO');
  assert.strictEqual(
    resolverColunaClinica('CIR VASCULAR', clinicas), 'CIR VASCULAR');
});

teste('clínica desconhecida devolve vazio (admin escolhe na tela)', () => {
  assert.strictEqual(resolverColunaClinica('OBS BREVE 02 - VASCULAR', clinicasPadrao()), '');
});

// ------------------------------------------------------------------

console.log('');
if (falhas > 0) {
  console.error(falhas + ' teste(s) falharam.');
  process.exit(1);
}
console.log('Todos os testes passaram.');
