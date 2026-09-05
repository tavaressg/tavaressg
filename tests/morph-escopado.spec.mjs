// Morph ESCOPADO num container interno (v553).
//
// A tese que sustenta _ALUNO_MORPH/_PROF_MORPH: se o diff acontece só dentro
// de #prof-body, o que está FORA dele (topbar, tabbar) nunca é tocado — nem
// morfado nem reconstruído — e por isso pode continuar usando `.onclick=`.
// Se isso for falso, a decisão de não migrar a tabbar cai junto.
//
// Rodar: node tests/morph-escopado.spec.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true, runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;
window.eval(fs.readFileSync(path.resolve('vendor/morphdom.min.js'), 'utf8'));
const morphdom = window.morphdom;
assert.equal(typeof morphdom, 'function', 'morphdom carregou');
const root = document.getElementById('root');

// Constrói a tela igual renderProfessor: topbar + #prof-body + tabbar
let cliques = 0;
const montar = (conteudo) => {
  const v = document.createElement('div');
  v.className = 'view';
  v.innerHTML = '<div class="topbar">Painel</div>';
  const body = document.createElement('div');
  body.id = 'prof-body';
  body.innerHTML = conteudo;
  v.appendChild(body);
  const bar = document.createElement('div');
  bar.className = 'tabbar';
  bar.innerHTML = '<span>Alunos</span>';
  bar.onclick = () => { cliques++; };   // handler colado no nó, como hoje
  v.appendChild(bar);
  return v;
};

// 1º paint: caminho antigo (innerHTML='' + append)
root.innerHTML = '';
root.appendChild(montar('<p>versão 1</p>'));
const barAntes  = root.querySelector('.tabbar');
const bodyAntes = root.querySelector('#prof-body');

// repaint de fundo: morph escopado no alvo
const staging = root.cloneNode(false);
staging.appendChild(montar('<p>versão 2</p>'));
const de   = staging.querySelector('#prof-body');
const para = root.querySelector('#prof-body');
assert.ok(de,   'o alvo existe na árvore de staging (clone vazio + build)');
assert.ok(para, 'o alvo existe no DOM real');
morphdom(para, de, { childrenOnly: true });

const barDepois  = root.querySelector('.tabbar');
const bodyDepois = root.querySelector('#prof-body');

assert.equal(bodyDepois.innerHTML, '<p>versão 2</p>', 'o conteúdo do alvo foi atualizado');
assert.equal(bodyDepois, bodyAntes, 'childrenOnly preserva o próprio #prof-body');
assert.equal(barDepois, barAntes,
  'a tabbar fora do alvo é o MESMO nó — é isso que dispensa migrar os `.onclick=` dela');
assert.equal(typeof barDepois.onclick, 'function', 'o handler da tabbar sobreviveu');
barDepois.dispatchEvent(new window.Event('click'));
assert.equal(cliques, 1, 'e continua disparando');

// a árvore de staging é descartada: seus nós não podem ter vazado pro DOM
assert.equal(de.isConnected, false, 'o nó de staging ficou fora do documento');
assert.equal(root.querySelectorAll('#prof-body').length, 1, 'nenhum id duplicado sobrou');

console.log('✔ morph-escopado: 8 asserts OK — alvo atualizado, tabbar intacta');
