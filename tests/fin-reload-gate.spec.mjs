// Testa _finChavesParaBuscar (app.js) — a decisão de QUAIS chaves o
// _finReload busca. Função pura: dá pra testar sem rede, sem DOM, sem backend.
//
// BUG que motivou (v510→v541): o gate era um `_finTs` único e global, e a
// chamada SELETIVA também o carimbava. Em prod:
//   1. tabbarProf() → _finReload(['cobrancas','contratos'])  carimba o gate
//   2. profFinanceiro() → _finReload() (full)                gate bloqueia
//   3. planos/despesas/categorias/matriculas nunca carregam por 15s
// Sintoma: aba Planos dizia "Nenhum plano cadastrado" com 7 planos no banco.
//
// O teste extrai a função do app.js REAL (não reimplementa), então se alguém
// mexer no gate sem pensar, isto quebra.
//
// Rodar: node tests/fin-reload-gate.spec.mjs

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const src = fs.readFileSync(path.resolve('app.js'), 'utf8');

// Extrai o bloco: const _FIN_CHAVES ... até o fim de _finChavesParaBuscar
const ini = src.indexOf('const _FIN_CHAVES');
const fim = src.indexOf('function _finReload(');
assert.ok(ini > 0, 'achou _FIN_CHAVES no app.js');
assert.ok(fim > ini, 'achou _finReload depois de _FIN_CHAVES');
const bloco = src.slice(ini, fim);

const _finChavesParaBuscar = new Function(bloco + '\nreturn _finChavesParaBuscar;')();
const TODAS = new Function(bloco + '\nreturn _FIN_CHAVES;')();
const TTL = new Function(bloco + '\nreturn _FIN_TTL;')();

const AGORA = 1_000_000;
const sorted = a => a.slice().sort();

// ---------- 1) cache vazio: busca tudo ----------
assert.deepEqual(
  sorted(_finChavesParaBuscar(undefined, {}, AGORA)),
  sorted(TODAS),
  '1) sem cache → busca todas as chaves'
);

// ---------- 2) tudo fresco: não busca nada ----------
const tudoFresco = Object.fromEntries(TODAS.map(k => [k, AGORA - 1000]));
assert.deepEqual(
  _finChavesParaBuscar(undefined, tudoFresco, AGORA),
  [],
  '2) tudo fresco → nenhuma query'
);

// ---------- 3) O BUG: seletivo não pode cegar o full ----------
// Simula tabbarProf() tendo buscado só cobrancas+contratos agora há pouco.
const soBadge = { cobrancas: AGORA - 100, contratos: AGORA - 100 };
const restantes = _finChavesParaBuscar(undefined, soBadge, AGORA);
assert.ok(restantes.length > 0, '3) full DEVE buscar o que o seletivo não trouxe');
assert.ok(restantes.includes('planos'),     '3) planos precisa entrar (era o sintoma reportado)');
assert.ok(restantes.includes('despesas'),   '3) despesas precisa entrar');
assert.ok(restantes.includes('categorias'), '3) categorias precisa entrar');
assert.ok(restantes.includes('matriculas'), '3) matriculas precisa entrar');
assert.ok(!restantes.includes('cobrancas'), '3) cobrancas fresca não repete');
assert.ok(!restantes.includes('contratos'), '3) contratos fresco não repete');

// ---------- 4) chave stale volta a ser buscada ----------
const staleP = { ...tudoFresco, planos: AGORA - TTL - 1 };
assert.deepEqual(
  _finChavesParaBuscar(undefined, staleP, AGORA),
  ['planos'],
  '4) só a chave expirada é rebuscada'
);

// ---------- 5) seletivo força mesmo com cache fresco ----------
assert.deepEqual(
  _finChavesParaBuscar('cobrancas', tudoFresco, AGORA),
  ['cobrancas'],
  '5a) string força a chave mesmo fresca'
);
assert.deepEqual(
  sorted(_finChavesParaBuscar(['despesas','rec'], tudoFresco, AGORA)),
  ['despesas','rec'],
  '5b) array força as listadas mesmo frescas'
);

// ---------- 6) force total ----------
assert.deepEqual(
  sorted(_finChavesParaBuscar(true, tudoFresco, AGORA)),
  sorted(TODAS),
  '6) _finReload(true) força tudo mesmo fresco'
);

// ---------- 7) fronteira exata do TTL ----------
assert.deepEqual(
  _finChavesParaBuscar(undefined, { ...tudoFresco, turmas: AGORA - TTL }, AGORA),
  ['turmas'],
  '7a) idade == TTL conta como expirada'
);
assert.deepEqual(
  _finChavesParaBuscar(undefined, { ...tudoFresco, turmas: AGORA - TTL + 1 }, AGORA),
  [],
  '7b) idade == TTL-1 ainda é fresca'
);

console.log('✔ fin-reload-gate: 7 cenários OK (' + TODAS.length + ' chaves, TTL ' + TTL + 'ms)');
