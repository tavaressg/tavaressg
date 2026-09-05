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
      // Escape vira 'x', nao vazio: apagar o \D de /\D/g deixava `//g`, e o
      // removedor de comentario logo abaixo comia o resto da linha — junto
      // com a chave de fechamento. A funcao passava a "terminar" no fim do
      // arquivo (a cadeia de renderCadastroAluno ia a 459 fns / 1648 handlers,
      // e montaFora podia pular funcao por ver um document.body.append alheio).
      .replace(/\\./g, 'x')
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

// `openSheet(node)` termina em document.body.appendChild — quem chama monta
// modal do mesmo jeito, so' que por um helper. Sem isso o guard contava os
// handlers de dezenas de sheets como bloqueio da tela que apenas as ABRE.
const MONTA_EM_BODY = /document\.body\.append(Child)?\(|openSheet\s*\(/;
/* Retorna um no' no nivel de cima da funcao — `  return w;`. Painter devolve
   no'; modal so' appenda em document.body e nao devolve nada. */
const DEVOLVE_NO = /\n {2}return\s+[A-Za-z_$]/;

/** Uma funcao que monta em `document.body` e' modal: vive FORA de qualquer
 *  container morfado, entao `.onclick=` nela e' inofensivo — o no' nunca passa
 *  pelo diff. Generaliza a regra antiga, que era por NOME (`*Sheet$`) e deixava
 *  passar as dezenas de `abrirX`/`rsX`/`bibX` que fazem exatamente a mesma coisa. */
export function montaFora(nome){
  if (/Sheet$/.test(nome)) return true;
  if (!TOPLEVEL.has(nome)) return false;
  const corpo = corpoDaFuncao(nome);
  if (!MONTA_EM_BODY.test(corpo)) return false;
  // Hibrida (monta modal E devolve no' pro caller, como profAlunos) pinta nos
  // DOIS lugares. Nao da' pra decidir estaticamente qual handler e' de qual
  // metade, entao ela NAO e' pulada: os handlers dela contam como bloqueio e a
  // tela fica fora da allowlist ate' alguem separar as duas coisas. Errar pro
  // lado de nao habilitar e' o unico erro barato aqui.
  return !DEVOLVE_NO.test(corpo);
}

/** Todas as funções alcançáveis a partir de `nome`, seguindo as chamadas.
 *  Modais são puladas de propósito (ver montaFora). */
/* Funcoes que aparecem no corpo de um painter mas nunca pintam DENTRO do
   container morfado — seguir a cadeia por elas da' falso positivo e, no caso
   do `render`, arrasta o app inteiro (profAlunos ia a 484 funcoes).
     · render/renderBg/goAluno/goProf — o roteador. So' aparecem dentro de
       handlers ("ao clicar, redesenha"), que rodam DEPOIS do diff, nao durante.
     · _dlg* — o instalador da delegacao: um addEventListener em `document`,
       idempotente, que e' justamente a solucao, nao o problema. */
const NAO_PINTAM = new Set([
  'render', 'renderBg', 'goAluno', 'goProf',
  '_dlgInstall', '_dlgRegister', '_dlgFire', '_dlgMake',
  // _finPaintBody pinta o #fin-body — outro alvo de morph, com allowlist e
  // guard proprios (fin-morph-allowlist.spec.mjs). Seguir por ele arrastava a
  // cadeia inteira do Financeiro pra dentro de quem apenas chama _finReload
  // (o Painel), e la' o proprio _finReload so' pinta se .fin-body existir.
  '_finPaintBody',
]);

export function cadeia(nome, vistos = new Set()){
  if (vistos.has(nome) || !TOPLEVEL.has(nome)) return [];
  vistos.add(nome);
  const corpo = corpoDaFuncao(nome);
  const out = [{ nome, corpo }];
  for (const m of corpo.matchAll(/\b([_a-zA-Z][\w]*)\s*\(/g)) {
    const chamada = m[1];
    if (NAO_PINTAM.has(chamada) || montaFora(chamada)) continue;
    if (chamada === nome || !TOPLEVEL.has(chamada)) continue;
    out.push(...cadeia(chamada, vistos));
  }
  return out;
}

const RE_HANDLER = /\.on(click|change|input|keydown|blur|focus|submit)\s*=|addEventListener\(/g;
/* Pintura assincrona. `await` conta tanto quanto `.then(`: o guard so' olhava
   `.then(` e deixava passar `async function _initList(){ ...await...; paint(); }`
   — mesmo bug, sintaxe diferente (achado migrando profVideosOnboard, v553). */
const ESCREVE_DOM = /\.(appendChild|append|prepend|replaceChildren|replaceWith|insertAdjacent\w*)\(|\.(innerHTML|outerHTML|textContent)\s*=/;
const RE_ASYNC = /\.then\(|\bawait\s/g;

/** Valida os dois pré-requisitos do morphdom numa cadeia de funções.
 *  (a) delegation pura  (b) pintura síncrona
 *  `rotulo` é o nome da tela/aba, usado só nas mensagens de erro. */
export const EXCECOES = [];

export function exigirMorphSeguro(rotulo, partes){
  for (const { nome, corpo } of partes) {
    const onde = partes[0] && nome === partes[0].nome ? '' : ` (via ${nome})`;

    const handlers = corpo.match(RE_HANDLER) || [];
    assert.equal(
      handlers.length, 0,
      `"${rotulo}"${onde} está na allowlist do morphdom mas tem ${handlers.length} handler(s) ` +
      `direto(s): ${[...new Set(handlers)].join(', ')}. Migre para data-click antes de habilitar.`
    );

    // `morph-ok:` isenta UMA linha da checagem de async. Existe para o caso em
    // que o callback nao appenda no container — ele resolve o no' pelo id no
    // momento em que roda (`_shareRedraw`) ou nao toca DOM nenhum. E' escape
    // hatch de verdade: exige a justificativa escrita na propria linha, e o
    // guard LISTA cada uso no fim da execucao pra que nenhuma passe despercebida.
    const asyncs = corpo.split('\n')
      .filter(l => !l.includes('morph-ok:'))
      .join('\n').match(RE_ASYNC) || [];
    corpo.split('\n').forEach(l => { if (l.includes('morph-ok:')) EXCECOES.push(`${rotulo}${onde}: ${l.trim().slice(0, 110)}`); });
    // Async so' e' problema em quem TAMBEM escreve DOM: e' o append depois do
    // await que se perde no staging descartavel. Um carregador puro
    // (`_loadMeusPedidos`: guarda o dado e chama renderBg) nao pinta nada e nao
    // deve travar a tela. Como corpoDaFuncao devolve a funcao top-level INTEIRA,
    // uma closure interna que pinta depois do await (o `paint()` de
    // profVideosOnboard) cai aqui do mesmo jeito.
    if (asyncs.length && ESCREVE_DOM.test(corpo)) {
      assert.fail(
        `"${rotulo}"${onde} está na allowlist mas pinta depois de um await/then ` +
        `(${asyncs.length}x). O morph usa container de staging descartável — ` +
        `append assíncrono se perde. Use predicado pronto() + geração de pintura.`
      );
    }
  }
}

/** Diagnóstico de por que algo está fora da allowlist. */
export function motivoDeFora(partes){
  const todo = partes.map(p => p.corpo).join('\n');
  const temAsync = partes.some(p => {
    const semIsentas = p.corpo.split('\n').filter(l => !l.includes('morph-ok:')).join('\n');
    RE_ASYNC.lastIndex = 0;
    return RE_ASYNC.test(semIsentas) && ESCREVE_DOM.test(p.corpo);
  });
  RE_ASYNC.lastIndex = 0;
  const temHandler = RE_HANDLER.test(todo); RE_HANDLER.lastIndex = 0;
  return [temAsync && 'async', temHandler && 'handler direto'].filter(Boolean).join(' + ');
}

/** Mapa sub-tela → funcao de render, lido do corpo do roteador:
 *      if (nav==='yama') body.appendChild(profYama());
 *  Ler do codigo (em vez de repetir a lista aqui) e' o que impede o guard de
 *  validar uma funcao que o roteador nao usa mais. */
export function subTelas(roteador){
  const corpo = corpoDaFuncao(roteador);
  const mapa = new Map();
  const re = /nav\s*===\s*'(\w+)'\s*\)?\s*(?:\{\s*)?body\.appendChild\((\w+)\(/g;
  for (const m of corpo.matchAll(re)) mapa.set(m[1], m[2]);
  return mapa;
}
