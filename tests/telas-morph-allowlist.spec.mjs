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
import { src, TOPLEVEL, cadeia, subTelas, exigirMorphSeguro, motivoDeFora, EXCECOES } from './_fonte.mjs';

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

// ---------- roteadores com morph ESCOPADO (v553) ----------
// aluno e professor não têm handler próprio: despacham pra sub-tela. O morph
// é escopado no body interno (`alvo` na rota), então quem precisa estar limpo
// é a cadeia da SUB-TELA habilitada — não a tela inteira. Topbar e tabbar
// ficam fora do diff e por isso não entram na varredura.
const ESCOPADAS = {
  aluno:     { roteador: 'renderAluno',     lista: '_ALUNO_MORPH', alvo: '#aluno-body' },
  professor: { roteador: 'renderProfessor', lista: '_PROF_MORPH',  alvo: '#prof-body'  },
};

function listaDe(nome){
  const i = src.indexOf('const ' + nome);
  assert.ok(i > 0, `achou "const ${nome}" no app.js`);
  const ini = src.indexOf('[', i), fim = src.indexOf(']', ini);
  assert.ok(ini > 0 && fim > ini, `${nome}: não achei o Set([...])`);
  return [...src.slice(ini, fim).matchAll(/'(\w+)'/g)].map(x => x[1]);
}

// ---------- valida cada tela habilitada ----------
let subsOk = 0;
for (const chave of habilitadas) {
  const rota = rotas.find(r => r.chave === chave);
  assert.ok(rota,
    `tela "${chave}" está em _TELAS_MORPH mas não existe em _ROTAS — ` +
    `com a chave errada ela nunca seria morfada, e nada avisaria.`);

  const esc = ESCOPADAS[chave];
  if (esc) {
    // o container do `alvo` precisa existir no código, com esse id exato:
    // sem ele o morph cai no catch e volta pro innerHTML='' calado.
    const id = esc.alvo.slice(1);
    assert.ok(src.includes(`id="${id}"`),
      `rota "${chave}" aponta alvo ${esc.alvo}, mas nenhum elemento com id="${id}" existe no app.js`);
    assert.ok(src.replace(/\s+/g, ' ').includes(`alvo: '${esc.alvo}'`),
      `rota "${chave}" deveria declarar alvo: '${esc.alvo}'`);

    const mapa = subTelas(esc.roteador);
    assert.ok(mapa.size > 0, `não parseei as sub-telas de ${esc.roteador}`);

    for (const sub of listaDe(esc.lista)) {
      const fn = mapa.get(sub);
      assert.ok(fn,
        `"${sub}" está em ${esc.lista} mas ${esc.roteador} não despacha essa sub-tela — ` +
        `ela nunca seria morfada, e o silêncio esconderia isso.`);
      const partes = cadeia(fn);
      exigirMorphSeguro(`${chave}/${sub}`, partes);
      console.log(`  ✔ ${(chave + '/' + sub).padEnd(15)} → ${fn.padEnd(30)}(+${partes.length - 1} aux) delegation pura, síncrona`);
      subsOk++;
    }
    // diagnóstico das sub-telas ainda fora
    const fora = [...mapa].filter(([k]) => !listaDe(esc.lista).includes(k));
    for (const [sub, fn] of fora) {
      const motivo = motivoDeFora(cadeia(fn)) || 'pronta, é só habilitar';
      console.log(`  · ${(chave + '/' + sub).padEnd(15)}   ${fn.padEnd(28)} ${motivo}`);
    }
    continue;
  }

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
if (EXCECOES.length) {
  console.log('');
  console.log(`  ${EXCECOES.length} linha(s) isenta(s) por \`morph-ok:\` — confira cada uma:`);
  [...new Set(EXCECOES)].forEach(x => console.log(`  ! ${x}`));
}
console.log('');
console.log(`✔ telas-morph-allowlist: ${habilitadas.length} de ${rotas.length} telas habilitadas` +
  (subsOk ? ` (${subsOk} sub-tela(s) escopada(s))` : ''));
