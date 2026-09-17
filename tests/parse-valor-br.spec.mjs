// Guard do _parseValorBR (v569): valor negociado do plano no wizard vinha com strip
// frágil que quebrava "R$ 150,50" em cenários mistos (bug relatado). Roda a função
// REAL extraída do app.js — nunca reimplementar aqui, senão o teste diverge calado.
import assert from 'node:assert/strict';
import { src } from './_fonte.mjs';

const i = src.indexOf('function _parseValorBR(');
assert.ok(i >= 0, 'achou _parseValorBR no app.js');
let nivel = 0, comecou = false, fim = i;
for (let j = i; j < src.length; j++) {
  const c = src[j];
  if (c === '{') { nivel++; comecou = true; }
  else if (c === '}') { nivel--; if (comecou && nivel === 0) { fim = j + 1; break; } }
}
const corpo = src.slice(i, fim);
const _parseValorBR = new Function(corpo + '; return _parseValorBR;')();

const casos = [
  ['150,50',       150.5],
  ['R$ 150,50',    150.5],
  ['1.500,00',     1500],
  ['150.50',       150.5],   // ponto como decimal (padrão internacional/casual)
  ['150',          150],
  ['1500',         1500],
  ['1.500',        1500],    // 3 dígitos após ponto → milhar
  ['R$ 1.500,00',  1500],
  ['0',            0],
  ['',             null],
  [null,           null],
  ['abc',          null],
  ['R$ 199,90',    199.9],
];

let ok = 0;
for (const [entrada, esperado] of casos) {
  const r = _parseValorBR(entrada);
  assert.equal(r, esperado, `_parseValorBR(${JSON.stringify(entrada)}) → esperado ${esperado}, veio ${r}`);
  ok++;
}
console.log(`✔ parse-valor-br: ${ok}/${casos.length} asserts OK — vírgula decimal, ponto ambíguo por comprimento, "R$ " tolerado`);
