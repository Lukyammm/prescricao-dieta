# prescricao-dieta

## Testes

Os parsers de `Code.gs` (`parsearPacientesDeTabela` e `parsearPacientes`) são
funções puras e podem ser testadas fora do Apps Script com Node:

```
node test/parsing.test.js
```

Os testes cobrem os padrões de desalinhamento observados em PDFs reais
(nomes de pacientes diferentes concatenados, refeições vazando entre
pacientes, texto de cabeçalho vazando para dentro de uma célula de dados) e
verificam que o campo `avisos` de cada paciente sinaliza esses casos para
revisão manual.