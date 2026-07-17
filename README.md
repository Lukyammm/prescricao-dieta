# prescricao-dieta

Automação da prescrição dietética do HUC: o admin envia o PDF
"Relatório Prescrição Dietética" de cada clínica e o sistema

1. extrai a lista de pacientes e suas refeições (`Code.gs`);
2. traduz o texto livre de cada refeição nos itens padronizados da
   planilha de faturamento e monta o **quantitativo** (quantos de cada
   item, por refeição, por clínica) — o mesmo mapa que era preenchido à
   mão (`Quantitativo.gs`);
3. mostra tudo numa tela de conferência editável e grava:
   - a lista de pacientes na aba `Base` (auditoria);
   - o quantitativo na aba `QDR dia-mês`, no mesmo layout da planilha
     FATURAMENTO (itens nas linhas, clínicas nas colunas). Cada PDF
     preenche a coluna da sua clínica; reenviar o mesmo PDF substitui
     apenas aquela coluna.

## Configuração (abas criadas automaticamente)

No primeiro uso o script cria três abas na planilha vinculada, já
populadas com os dados extraídos da planilha FATURAMENTO oficial. Elas
podem ser editadas direto na planilha, e o app também aprende por elas:

- **Itens** — catálogo de itens por seção (Desjejum, Lanche da manhã,
  Almoço, Lanche Tarde, Jantar, Ceia, mais as seções extras
  Enteral/Suplementos e Outros).
- **Regras** — de-para do texto do PDF para item(ns) do catálogo.
  O padrão casa por palavras (qualquer ordem, sem acento); `;` separa
  vários itens contados de uma vez e `>` define alternativas (usa o
  primeiro nome que existir na seção da refeição).
- **Clinicas** — nome da clínica no PDF → coluna do quantitativo.

Quando um texto não casa com nenhuma regra, ele aparece na tela em
"não reconhecidos": o admin escolhe o item (ou cria um novo) e, marcando
"lembrar", a regra é gravada na aba `Regras` e aplicada nos próximos PDFs.

## Testes

Os parsers de `Code.gs` (`parsearPacientesDeTabela` e `parsearPacientes`)
e o motor de quantitativo de `Quantitativo.gs` (`classificarRefeicao`,
`gerarQuantitativo`) são funções puras e podem ser testadas fora do Apps
Script com Node:

```
node test/parsing.test.js
node test/quantitativo.test.js
```

`parsing.test.js` cobre os padrões de desalinhamento observados em PDFs
reais (nomes de pacientes concatenados, refeições vazando entre
pacientes, cabeçalho vazando para células de dados). `quantitativo.test.js`
cobre a tradução de textos reais de refeição em itens (cafés completos e
variantes, sopas com volume, dietas principais com modificadores em
qualquer ordem, frutas, sucos/vitaminas por sabor, enterais e
suplementos, exclusões "NÃO: ...", refeição de acompanhante e a
deduplicação de Dieta Zero por paciente).
