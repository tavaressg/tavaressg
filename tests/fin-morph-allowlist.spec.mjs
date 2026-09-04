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

const src = fs.readFileSync(path.resolve('app.js'), 'utf8');
const linhas = src.split('\n');

// ---------- lê a allowlist do código real ----------
const mAllow = src.match(/const _FIN_TABS_MORPH = (\[[^\]]*\]);/);
assert.ok(mAllow, 'achou _FIN_TABS_MORPH no app.js');
const allowlist = JSON.parse(mAllow[1].replace(/'/g, '"'));
assert.ok(Array.isArray(allowlist) && allowlist.length > 0, 'allowlist é array não-vazio');

// ---------- mapeia aba → função de render (lido do _finPintarAba) ----------
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

// ---------- valida cada aba da allowlist ----------
for (const aba of allowlist) {
  const fn = mapa[aba];
  assert.ok(fn, `aba "${aba}" da allowlist tem função de render mapeada em _finPintarAba`);

  const corpo = corpoDaFuncao(fn);

  // (a) delegation pura
  const handlers = corpo.match(/\.on(click|change|input|keydown|blur|focus|submit)\s*=|addEventListener\(/g) || [];
  assert.equal(
    handlers.length, 0,
    `aba "${aba}" (${fn}) está na allowlist do morphdom mas tem ${handlers.length} handler(s) direto(s): ` +
    `${[...new Set(handlers)].join(', ')}. Migre para data-click antes de habilitar o morph.`
  );

  // (b) render síncrono
  const asyncs = corpo.match(/\.then\(/g) || [];
  assert.equal(
    asyncs.length, 0,
    `aba "${aba}" (${fn}) está na allowlist mas faz fetch async (${asyncs.length}x .then). ` +
    `O morph usa container de staging descartável — append assíncrono se perde.`
  );

  console.log(`  ✔ ${aba.padEnd(12)} → ${fn.padEnd(22)} delegation pura, render síncrono`);
}

// ---------- sanidade reversa: abas com async NÃO podem estar na lista ----------
for (const [aba, fn] of Object.entries(mapa)) {
  if (allowlist.includes(aba)) continue;
  const corpo = corpoDaFuncao(fn);
  const temAsync = /\.then\(/.test(corpo);
  const temHandler = /\.on(click|change|input|keydown)\s*=/.test(corpo);
  if (temAsync || temHandler) {
    console.log(`  · ${aba.padEnd(12)} fora da lista (correto: ${temAsync ? 'async' : ''}${temAsync && temHandler ? ' + ' : ''}${temHandler ? 'handler direto' : ''})`);
  }
}

console.log(`✔ fin-morph-allowlist: ${allowlist.length} aba(s) habilitada(s), pré-requisitos verificados`);
