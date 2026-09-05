// Trava a allowlist _TELAS_MORPH (morphdom no nível do roteador, v552).
//
// Mesmo contrato do guard do Financeiro, um nível acima: uma tela só pode
// entrar na lista se
//   (a) for 100% event delegation — nenhum `.onclick=` / addEventListener na
//       cadeia de render (handler colado no nó some ou fica com closure velha)
//   (b) pintar SÍNCRONA — nenhum `.then(` appendando depois (o morph usa um
//       container de staging que é descartado após o diff)
//
// Também confere que toda chave da allowlist existe em _ROTAS: uma tela
// habilitada com nome errado nunca seria morfada, e o silêncio esconderia isso.
//
// Rodar: node tests/telas-morph-allowlist.spec.mjs

import assert from 'node:assert/strict';
import { src, TOPLEVEL, cadeia, exigirMorphSeguro, motivoDeFora } from './_fonte.mjs';

// ---------- rotas ----------
const iniRotas = src.indexOf('const _ROTAS = [');
assert.ok(iniRotas > 0, 'achou _ROTAS no app.js');
const blocoRotas = src.slice(iniRotas, src.indexOf('\n];', iniRotas));

// Parse POR ENTRADA (não com um regex global sobre o bloco): um regex global
// que não casa numa entrada emenda com a seguinte e valida a função errada,
// calado. Foi assim na v550 com o _FIN_MORPH.
const declaradasRotas = [...blocoRotas.matchAll(/\{\s*chave:\s*'(\w+)'/g)].map(m => ({
  chave: m[1], ini: m.index,
}));
assert.ok(declaradasRotas.length > 0, 'parseou ao menos uma rota');

const rotas = declaradasRotas.map((d, i) => {
  const fim = i + 1 < declaradasRotas.length ? declaradasRotas[i + 1].ini : blocoRotas.length;
  const trecho = blocoRotas.slice(d.ini, fim);
  const mPintar = trecho.match(/pintar:\s*\([^)]*\)\s*=>([\s\S]*)$/);
  assert.ok(mPintar, `rota "${d.chave}": não achei o \`pintar\``);
  // Funções de render chamadas dentro do `pintar` — cobre o caso de bloco com
  // duas chamadas, como produtoForm + tabbarProf.
  const alvos = [...mPintar[1].matchAll(/\b(render[A-Z]\w*|tabbarProf)\s*\(/g)].map(x => x[1]);
  return { chave: d.chave, alvos: [...new Set(alvos)] };
});

// O bloco tem tantas rotas quanto `chave:` — se divergir, o parse comeu alguma.
const nChaves = (blocoRotas.match(/chave:/g) || []).length;
assert.equal(rotas.length, nChaves,
  `parseei ${rotas.length} de ${nChaves} rotas declaradas em _ROTAS`);

// Toda rota precisa apontar ao menos uma função conhecida — senão o parse
// silenciosamente não teria o que varrer.
for (const r of rotas) {
  assert.ok(r.alvos.length > 0, `rota "${r.chave}": não identifiquei a função de render no \`pintar\``);
  for (const fn of r.alvos) {
    assert.ok(TOPLEVEL.has(fn), `rota "${r.chave}": "${fn}" não é função top-level do app.js`);
  }
}

// ---------- allowlist ----------
const iniTelas = src.indexOf('const _TELAS_MORPH = {');
assert.ok(iniTelas > 0, 'achou _TELAS_MORPH no app.js');
const blocoTelas = src.slice(iniTelas, src.indexOf('\n};', iniTelas));

const declaradas = [...blocoTelas.matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => ({ chave: m[1], ini: m.index }));

const habilitadas = [];
declaradas.forEach((d, i) => {
  const fim = i + 1 < declaradas.length ? declaradas[i + 1].ini : blocoTelas.length;
  const trecho = blocoTelas.slice(d.ini, fim);
  assert.ok(/pronto:\s*\(\)\s*=>/.test(trecho),
    `tela "${d.chave}" precisa declarar pronto() — é o que impede o morph de rodar ` +
    `quando a pintura naquele instante seria assíncrona`);
  habilitadas.push(d.chave);
});

// ---------- valida cada tela habilitada ----------
for (const chave of habilitadas) {
  const rota = rotas.find(r => r.chave === chave);
  assert.ok(rota,
    `tela "${chave}" está em _TELAS_MORPH mas não existe em _ROTAS — ` +
    `com a chave errada ela nunca seria morfada, e nada avisaria.`);

  const partes = rota.alvos.flatMap(fn => cadeia(fn));
  exigirMorphSeguro(chave, partes);

  const aux = partes.length - rota.alvos.length;
  console.log(`  ✔ ${chave.padEnd(15)} → ${rota.alvos.join(' + ').padEnd(30)}${aux > 0 ? `(+${aux} aux) ` : ''}delegation pura, síncrona`);
}

// ---------- diagnóstico das que ficaram de fora ----------
const fora = rotas.filter(r => !habilitadas.includes(r.chave));
if (fora.length) {
  console.log('');
  console.log(`  ${fora.length} tela(s) ainda fora — motivo:`);
  for (const r of fora) {
    const partes = r.alvos.flatMap(fn => cadeia(fn));
    const motivo = motivoDeFora(partes) || 'pronta, é só habilitar';
    console.log(`  · ${r.chave.padEnd(15)} ${motivo}`);
  }
}

console.log('');
console.log(`✔ telas-morph-allowlist: ${habilitadas.length} de ${rotas.length} telas habilitadas`);
