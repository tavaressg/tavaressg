// Leitura estática do app.js compartilhada pelos guards de allowlist.
// Extraído em v552 para que o guard do Financeiro e o das telas usem o MESMO
// parser — dois parsers separados divergem, e um guard que erra em silêncio é
// pior que não ter guard (aconteceu duas vezes: CRLF na v545, regex global
// emendando entradas na v550).

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// CRLF: o working tree no Windows vem com \r\n (core.autocrlf), e regex
// ancorada em \n falha calada.
export const src = fs.readFileSync(path.resolve('app.js'), 'utf8').replace(/\r\n/g, '\n');
export const linhas = src.split('\n');

export const TOPLEVEL = new Set(
  linhas.filter(l => l.startsWith('function ')).map(l => l.slice(9, l.indexOf('(')))
);

/** Corpo exato de uma função top-level, fechando pelo balanço de chaves.
 *  Delimitar por "próxima definição top-level" pega demais: handlers
 *  registrados logo abaixo (_dlgRegister) entrariam junto e dariam falso
 *  positivo — eles rodam no clique, não no render. */
export function corpoDaFuncao(nome){
  const i = linhas.findIndex(l => l.startsWith('function ' + nome + '('));
  assert.ok(i >= 0, 'achou a função ' + nome + ' no app.js');
  let nivel = 0, comecou = false;
  const out = [];
  for (let j = i; j < linhas.length; j++) {
    out.push(linhas[j]);
    const limpa = linhas[j]
      .replace(/\\./g, '')
      .replace(/'[^']*'/g, "''")
      .replace(/"[^"]*"/g, '""')
      .replace(/`[^`]*`/g, '``')
      .replace(/\/\/.*$/, '');
    for (const ch of limpa) {
      if (ch === '{') { nivel++; comecou = true; }
      else if (ch === '}') nivel--;
    }
    if (comecou && nivel <= 0) break;
  }
  return out.join('\n');
}

/** Todas as funções alcançáveis a partir de `nome`, seguindo as chamadas.
 *  Sheets são puladas de propósito: montam em document.body, fora de
 *  qualquer container morfado — handler nelas é inofensivo. */
export function cadeia(nome, vistos = new Set()){
  if (vistos.has(nome) || !TOPLEVEL.has(nome)) return [];
  vistos.add(nome);
  const corpo = corpoDaFuncao(nome);
  const out = [{ nome, corpo }];
  for (const m of corpo.matchAll(/\b([_a-zA-Z][\w]*)\s*\(/g)) {
    const chamada = m[1];
    if (/Sheet$/.test(chamada)) continue;
    if (chamada === nome || !TOPLEVEL.has(chamada)) continue;
    out.push(...cadeia(chamada, vistos));
  }
  return out;
}

const RE_HANDLER = /\.on(click|change|input|keydown|blur|focus|submit)\s*=|addEventListener\(/g;
const RE_ASYNC = /\.then\(/g;

/** Valida os dois pré-requisitos do morphdom numa cadeia de funções.
 *  (a) delegation pura  (b) pintura síncrona
 *  `rotulo` é o nome da tela/aba, usado só nas mensagens de erro. */
export function exigirMorphSeguro(rotulo, partes){
  for (const { nome, corpo } of partes) {
    const onde = partes[0] && nome === partes[0].nome ? '' : ` (via ${nome})`;

    const handlers = corpo.match(RE_HANDLER) || [];
    assert.equal(
      handlers.length, 0,
      `"${rotulo}"${onde} está na allowlist do morphdom mas tem ${handlers.length} handler(s) ` +
      `direto(s): ${[...new Set(handlers)].join(', ')}. Migre para data-click antes de habilitar.`
    );

    const asyncs = corpo.match(RE_ASYNC) || [];
    assert.equal(
      asyncs.length, 0,
      `"${rotulo}"${onde} está na allowlist mas faz fetch async (${asyncs.length}x .then). ` +
      `O morph usa container de staging descartável — append assíncrono se perde.`
    );
  }
}

/** Diagnóstico de por que algo está fora da allowlist. */
export function motivoDeFora(partes){
  const todo = partes.map(p => p.corpo).join('\n');
  const temAsync = RE_ASYNC.test(todo); RE_ASYNC.lastIndex = 0;
  const temHandler = RE_HANDLER.test(todo); RE_HANDLER.lastIndex = 0;
  return [temAsync && 'async', temHandler && 'handler direto'].filter(Boolean).join(' + ');
}
