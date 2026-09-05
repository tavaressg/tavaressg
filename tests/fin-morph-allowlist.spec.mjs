// Trava a allowlist _FIN_TABS_MORPH (app.js).
//
// Uma aba só pode entrar na lista se cumprir DUAS condições. Este teste as
// verifica estaticamente no código real, então adicionar uma aba que não
// serve quebra o CI em vez de quebrar a tela do professor:
//
//   (a) 100% event delegation — nenhum `.onclick=` / `addEventListener` na
//       função de render. Handler colado no nó ou some (nó substituído) ou
//       fica com closure velha (nó preservado).
//   (b) render SÍNCRONO — nenhum `.then(` na função. O morph pinta num
//       container de staging que é descartado após o diff; append assíncrono
//       cairia no staging morto.
//
// Foi ignorar essas duas que produziu a série v530-v541.
//
// Rodar: node tests/fin-morph-allowlist.spec.mjs

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Normaliza CRLF: no Windows o working tree vem com \r\n (core.autocrlf), e
// regex que ancora em \n falha silenciosamente — o que já custou um debug aqui.
const src = fs.readFileSync(path.resolve('app.js'), 'utf8').replace(/\r\n/g, '\n');
const linhas = src.split('\n');

// ---------- lê o mapa _FIN_MORPH do código real ----------
// Cada entrada: { pronto: () => ..., pintar: (t) => _finAlgumaCoisa(t, ...) }
// O guard varre a função apontada em `pintar` — a SÍNCRONA — e não a de
// entrada da aba, que pode ter fallback async legítimo (v545, Matrículas).
const iniMorph = src.indexOf('const _FIN_MORPH = {');
assert.ok(iniMorph > 0, 'achou _FIN_MORPH no app.js');
const blocoMorph = src.slice(iniMorph, src.indexOf('\n};', iniMorph));

// Parse POR ENTRADA, não com um regex global sobre o bloco inteiro.
// Um regex global casava `aba:` de uma entrada com o `pintar:` da SEGUINTE
// quando a primeira não batia no formato esperado — e o guard passava
// validando a função errada, em silêncio. Aconteceu na v550: um `pintar`
// escrito como bloco `(t) => { ... }` fez o dashboard ser validado contra
// _finMatriculasPintar e a aba matriculas sumir da checagem.
// Agora: recorta o intervalo de cada entrada e falha alto se não parsear.
const declaradas = [...blocoMorph.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => ({
  aba: m[1], ini: m.index,
}));
assert.ok(declaradas.length > 0, '_FIN_MORPH tem ao menos uma aba');

const pintarPorAba = {};
declaradas.forEach((d, i) => {
  const fim = i + 1 < declaradas.length ? declaradas[i + 1].ini : blocoMorph.length;
  const trecho = blocoMorph.slice(d.ini, fim);

  const mPintar = trecho.match(/pintar:\s*\([^)]*\)\s*=>\s*(_fin\w+)\(/);
  assert.ok(
    mPintar,
    `aba "${d.aba}": não consegui identificar a função de \`pintar\`. ` +
    `Ela precisa ser uma chamada direta — \`pintar: (t) => _finAlgumaCoisa(t)\` — ` +
    `e não um bloco \`(t) => { ... }\`, senão o guard não tem o que varrer. ` +
    `Extraia o corpo para uma função nomeada.`
  );
  pintarPorAba[d.aba] = mPintar[1];
});

const allowlist = Object.keys(pintarPorAba);
// Toda aba declarada precisa ter sido parseada — se divergir, o parse comeu alguma.
assert.equal(allowlist.length, declaradas.length,
  `parseei ${allowlist.length} de ${declaradas.length} abas declaradas no _FIN_MORPH`);

// ---------- mapeia aba → função de render (lido do _finPintarAba) ----------
// Usado só na sanidade reversa (por que cada aba de fora está de fora).
const iniPintar = src.indexOf('function _finPintarAba(');
assert.ok(iniPintar > 0, 'achou _finPintarAba');
const corpoPintar = src.slice(iniPintar, src.indexOf('\n}', iniPintar));
const mapa = {};
for (const m of corpoPintar.matchAll(/_finTab==='(\w+)'\)\s*(_finRender\w+)/g)) mapa[m[1]] = m[2];
// o `else` final (sem comparação) é categorias
const mElse = corpoPintar.match(/else (_finRender\w+)\(target\);/);
if (mElse) mapa['categorias'] = mElse[1];

// Extrai o corpo EXATO de uma função top-level, fechando pelo balanço de
// chaves. Delimitar por "próxima definição top-level" pegaria demais: em
// Categorias, os _dlgRegister logo abaixo têm `.then` nos handlers de clique
// (o que é seguro — roda no click, não no render) e davam falso positivo.
function corpoDaFuncao(nome){
  const i = linhas.findIndex(l => l.startsWith('function ' + nome + '('));
  assert.ok(i >= 0, 'achou a função ' + nome);
  let nivel = 0, comecou = false;
  const out = [];
  for (let j = i; j < linhas.length; j++) {
    const linha = linhas[j];
    out.push(linha);
    // aproximação suficiente: ignora chaves dentro de string/template/comentário
    const limpa = linha
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

// Segue a cadeia de chamadas a partir da função de render, para não deixar
// buraco: em v544 o `tr.onclick` de Matrículas migrou de _finRenderMatriculas
// para a auxiliar _finMatriculasPintar, e um guard que só olhasse a função de
// entrada teria dado OK indevido. Só entram funções top-level do próprio
// arquivo (helpers de formatação e sheets ficam de fora — sheets vivem em
// document.body, morphdom no fin-body não as toca).
const TOPLEVEL = new Set(
  linhas.filter(l => l.startsWith('function ')).map(l => l.slice(9, l.indexOf('(')))
);
function cadeia(nome, vistos = new Set()){
  if (vistos.has(nome)) return [];
  vistos.add(nome);
  const corpo = corpoDaFuncao(nome);
  const out = [{ nome, corpo }];
  for (const m of corpo.matchAll(/\b(_fin[A-Za-z]+)\s*\(/g)) {
    const chamada = m[1];
    // Sheets abrem em document.body → fora do escopo do morph
    if (/Sheet$/.test(chamada)) continue;
    if (chamada === nome || !TOPLEVEL.has(chamada)) continue;
    out.push(...cadeia(chamada, vistos));
  }
  return out;
}

// ---------- valida cada aba da allowlist ----------
for (const aba of allowlist) {
  const fn = pintarPorAba[aba];
  assert.ok(fn, `aba "${aba}" do _FIN_MORPH aponta uma função em \`pintar\``);
  assert.ok(TOPLEVEL.has(fn), `"${fn}" (pintar da aba "${aba}") é função top-level do app.js`);

  // Toda aba precisa declarar `pronto()` — é o que impede o morph de rodar
  // quando a pintura naquele instante seria assíncrona (cold start).
  const iAba = blocoMorph.indexOf(aba + ':');
  const iPintar = blocoMorph.indexOf('pintar:', iAba);
  assert.ok(iAba >= 0 && iPintar > iAba, `aba "${aba}" está declarada no _FIN_MORPH`);
  const antesDoPintar = blocoMorph.slice(iAba, iPintar);
  assert.ok(/pronto:\s*\(\)\s*=>/.test(antesDoPintar),
    `aba "${aba}" precisa declarar pronto() no _FIN_MORPH — é o que impede o morph ` +
    `de rodar quando a pintura naquele instante seria assíncrona`);

  const partes = cadeia(fn);

  for (const { nome, corpo } of partes) {
    const onde = nome === fn ? '' : ` (via ${nome})`;

    // (a) delegation pura
    const handlers = corpo.match(/\.on(click|change|input|keydown|blur|focus|submit)\s*=|addEventListener\(/g) || [];
    assert.equal(
      handlers.length, 0,
      `aba "${aba}"${onde} está na allowlist do morphdom mas tem ${handlers.length} handler(s) direto(s): ` +
      `${[...new Set(handlers)].join(', ')}. Migre para data-click antes de habilitar o morph.`
    );

    // (b) render síncrono
    const asyncs = corpo.match(/\.then\(/g) || [];
    assert.equal(
      asyncs.length, 0,
      `aba "${aba}"${onde} está na allowlist mas faz fetch async (${asyncs.length}x .then). ` +
      `O morph usa container de staging descartável — append assíncrono se perde.`
    );
  }

  const extras = partes.length > 1 ? ` (+${partes.length - 1} aux)` : '';
  console.log(`  ✔ ${aba.padEnd(12)} → ${(fn + extras).padEnd(28)} delegation pura, render síncrono`);
}

// ---------- sanidade reversa: por que cada aba de fora está de fora ----------
for (const [aba, fn] of Object.entries(mapa)) {
  if (allowlist.includes(aba)) continue;
  const partes = cadeia(fn);
  const temAsync = partes.some(p => /\.then\(/.test(p.corpo));
  const temHandler = partes.some(p => /\.on(click|change|input|keydown)\s*=/.test(p.corpo));
  if (temAsync || temHandler) {
    const motivo = [temAsync && 'async', temHandler && 'handler direto'].filter(Boolean).join(' + ');
    console.log(`  · ${aba.padEnd(12)} fora da lista (correto: ${motivo})`);
  }
}

console.log(`✔ fin-morph-allowlist: ${allowlist.length} aba(s) habilitada(s), pré-requisitos verificados`);
