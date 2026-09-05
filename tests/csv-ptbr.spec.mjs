// Trava o formato do CSV exportado pelo Financeiro em pt-BR.
//
// Bug (v550 e anteriores): os valores saíam de `toFixed(2)`, ou seja
// "190.00" com ponto decimal. O Excel em pt-BR lê isso como texto — ou,
// dependendo da configuração de região, como 19000 — e as somas da planilha
// quebram sem aviso.
//
// Contrato: separador de campo `;`, decimal com vírgula, BOM UTF-8 no início
// (senão o Excel come os acentos) e campos de texto entre aspas (nome de
// categoria pode conter o próprio `;`).
//
// Rodar: node tests/csv-ptbr.spec.mjs

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const src = fs.readFileSync(path.resolve('app.js'), 'utf8').replace(/\r\n/g, '\n');

// Extrai _csvNum + _finExportCSV do app real (não reimplementa).
const iniNum = src.indexOf('function _csvNum(');
assert.ok(iniNum > 0, 'achou _csvNum no app.js');
const _csvNum = new Function(src.slice(iniNum, src.indexOf('\n', src.indexOf('}', iniNum))) + '\nreturn _csvNum;')();

// ---------- _csvNum: o coração do bug ----------
assert.equal(_csvNum(190), '190,00', 'inteiro vira 190,00');
assert.equal(_csvNum(190.5), '190,50', 'uma casa completa pra duas');
assert.equal(_csvNum(1234.567), '1234,57', 'arredonda pra 2 casas');
assert.equal(_csvNum(0), '0,00', 'zero');
assert.equal(_csvNum(-45.9), '-45,90', 'negativo mantém o sinal');
assert.equal(_csvNum(null), '0,00', 'null vira zero (não NaN)');
assert.equal(_csvNum(undefined), '0,00', 'undefined vira zero');
assert.ok(!_csvNum(1234.5).includes('.'), 'nenhum ponto decimal sobra');

// ---------- geração completa, com a função real ----------
// Roda _finExportCSV num ambiente mínimo, capturando o Blob em vez de baixar.
const iniExp = src.indexOf('function _finExportCSV(');
const fimExp = src.indexOf('\nfunction _finExportPDF(', iniExp);
assert.ok(iniExp > 0 && fimExp > iniExp, 'achou _finExportCSV');
const corpoExp = src.slice(iniNum, fimExp);

let capturado = null;
const sandbox = {
  Blob: class { constructor(parts){ capturado = parts.join(''); } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  document: { createElement: () => ({ click(){}, set href(v){}, set download(v){} }) },
  toast: () => {},
};
new Function(...Object.keys(sandbox), corpoExp + '\nreturn _finExportCSV;')(...Object.values(sandbox))(
  {
    meses: Array.from({ length: 12 }, (_, i) => ({ receita: 1000 + i, despesa: 250.5, saldo: 749.5 + i })),
    receitasPorCategoria: { 'Mensalidade': 12000, 'Venda; loja': 340.25 },
    despesasPorCategoria: { 'Aluguel': 9000 },
  },
  2026
);

assert.ok(capturado, 'o CSV foi gerado');
assert.ok(capturado.startsWith('﻿'), 'começa com BOM UTF-8 (acentuação no Excel)');

const linhas = capturado.replace(/^﻿/, '').split('\r\n');
assert.equal(linhas[0], 'Mês;Receita;Despesa;Saldo', 'cabeçalho com separador ;');
assert.equal(linhas[1], 'Jan/2026;1000,00;250,50;749,50', 'primeira linha em formato pt-BR');

const corpo = capturado.replace(/^﻿/, '');
assert.ok(!/\d\.\d\d(?=;|$|\r)/m.test(corpo), 'nenhum valor com ponto decimal em lugar nenhum');
assert.ok(corpo.includes('"Venda; loja";340,25'), 'categoria com ; sai entre aspas, sem quebrar colunas');
assert.ok(corpo.includes('"Mensalidade";12000,00'), 'categoria simples também sai citada');

console.log('✔ csv-ptbr: 13 asserts OK — decimal vírgula, separador ;, BOM, texto citado');
