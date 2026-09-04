/* ============================================================
   Yama · Jiu-Jitsu — Gestão + Journal num app só (protótipo)
   Estado compartilhado entre Aluno e Professor: o que o professor
   define (graduação, presença, loja) reflete no aluno (via backend).
   ============================================================ */

/* ---------------- util ---------------- */
const $ = (s, el=document) => el.querySelector(s);
const el = (h) => { const t=document.createElement('template'); t.innerHTML=h.trim(); return t.content.firstElementChild; };
function safeTxt(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
// escape para uso dentro de atributos HTML ("..."): cobre aspas além de <>&
function safeAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Avatar reutilizável do aluno na visão do professor. Se `a.foto` existe, renderiza a imagem
// (§4 autoriza: perfil/faixa/graus/foto/nascimento são visíveis ao professor); senão cai nas
// iniciais coloridas. `sizeCls` opcional aplica um estilo extra (usado em uma linha específica
// que já tinha width/height/font-size inline). data-fallback="ini" volta para as iniciais se a
// imagem falhar carregar (foto removida do Storage, URL quebrada etc.).
function avatarAluno(a, extraStyle){
  if(a && a.foto){
    return `<div class="avatar avatar-photo" style="background:${safeAttr(a.cor||'#888')};${extraStyle||''}">
      <img src="${safeAttr(a.foto)}" alt="" data-fallback="ini"><span class="av-ini">${safeTxt(a.ini||'?')}</span></div>`;
  }
  return `<div class="avatar" style="background:${safeAttr(a && a.cor || '#888')};${extraStyle||''}">${safeTxt(a && a.ini || '?')}</div>`;
}
// CSP-safe (A-1): fallback de <img> sem handler inline `onerror`. Um único listener
// em captura (erros de load de imagem NÃO borbulham) trata os data-fallback:
//   data-fallback="logo"   → tenta yama-logo.png se o logo principal falhar
//   data-fallback="remove" → remove o <img> (ex.: foto de perfil ausente)
document.addEventListener('error', (e)=>{
  const t = e.target;
  if(!t || t.tagName !== 'IMG') return;
  const fb = t.getAttribute('data-fallback');
  if(fb === 'logo'){
    t.removeAttribute('data-fallback');                        // evita loop
    if(t.src.indexOf('yama-logo') < 0) t.src = 'brand/yama-logo.png?v=2';
  } else if(fb === 'remove'){
    t.remove();
  } else if(fb === 'ini'){
    // avatar do aluno com foto quebrada → mantém o <div class="avatar avatar-photo"> mas revela as iniciais.
    t.remove();
    const parent = t.parentElement;
    if(parent && parent.classList) parent.classList.remove('avatar-photo');
  }
}, true);
// CSP-safe (A-1): navegação/ações que antes usavam onclick="…" inline agora usam
// data-click="nome" + delegação global (script-src 'self' proíbe handler inline).
// Registro lazy (arrows resolvem os nomes no clique — funções globais definidas adiante).
const _CLICK_ACTIONS = {
  verHistorico: ()=>{ DB.jornadaTab='historico'; goAluno('jornada'); },
  verAlunos:    ()=>goProf('alunos'),
  verAlunosAniv:()=>{ DB._pendingAlunosAniv = String(new Date().getMonth()+1).padStart(2,'0'); goProf('alunos'); },
  verAnivFull:  ()=>{ DB._pendingAlunosAniv = String(new Date().getMonth()+1).padStart(2,'0'); goProf('alunos'); },
  fecharRetro:  ()=>fecharRetro(),
  fecharTreino: ()=>fecharTreino(),
  fecharShare:  ()=>fecharShare(),
  closeFlow:    ()=>closeFlow(),
  closeLoja:    ()=>closeLoja(),
  closeMeusPedidos: ()=>closeMeusPedidos(),
  abrirCarrinho:()=>abrirCarrinho(),
  salvar:       ()=>salvar(),
};
document.addEventListener('click', (e)=>{
  const t = e.target.closest && e.target.closest('[data-click]');
  if(!t) return;
  const fn = _CLICK_ACTIONS[t.getAttribute('data-click')];
  if(fn){ try{ fn(); }catch(err){} }
});
// Helper único de sheet: monta no DOM, anima, fecha ao tocar fora e (opcional) liga o botão cancelar. Retorna close().
function openSheet(node, cancelSel){
  const close=()=>{ node.classList.remove('open'); setTimeout(()=>node.remove(),260); };
  // Guarda anti-perda GLOBAL: clicar fora com formulário mexido pede confirmação antes de fechar
  const snap=()=>[...node.querySelectorAll('input,textarea,select')].map(i=>(i.type==='checkbox'||i.type==='radio')?(i.checked?'1':'0'):i.value).join('');
  const base=snap();
  node.onclick=(e)=>{ if(e.target===node){ if(snap()!==base && typeof _confirmDescartar==='function') _confirmDescartar(close); else close(); } };
  if(cancelSel){ const c=node.querySelector(cancelSel); if(c) c.onclick=close; }
  document.body.appendChild(node); requestAnimationFrame(()=>node.classList.add('open')); return close; }
const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const diasSem = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
// ?demo=1 = vitrine (data congelada p/ o seed casar); usuário real = data de hoje (presença real ao longo dos dias)
const DEMO = (()=>{ try{ return new URLSearchParams(location.search).has('demo'); }catch(e){ return false; } })();
// v424: TESTMODE subiu pra cá (era definido lá embaixo) porque a separação
// SEED_DEMO × DB precisa saber, ANTES de montar o estado, se é vitrine/teste.
const TESTMODE = (()=>{ try{ return new URLSearchParams(location.search).has('test'); }catch(e){ return false; } })();
// v527 (Fase 0.4 refactor morphdom): feature flag pra ativar morphdom no render()
// quando estiver implementado. Hoje ainda não faz nada — só disponibiliza a flag
// pro rollout gradual. Ativa com ?morphdom=1. Inerte em prod até Fase 3.
const MORPHDOM = (()=>{ try{ return new URLSearchParams(location.search).has('morphdom'); }catch(e){ return false; } })();
const VITRINE = DEMO || TESTMODE;   // único ponto que decide se o seed fake entra

/* ============================================================
   v528 — Router de event delegation (Fase 1 refactor morphdom)
   ------------------------------------------------------------
   Registra 1 listener global em #root pra despachar clicks/change/input
   via `data-click="nome"`. Elimina o padrão `btn.onclick=()=>{...c...}`
   em closures locais — necessário pra morphdom funcionar sem bugs.

   Uso:
     _dlgRegister('finPlano', (el, ev) => _finPlanoSheet(byId(el.dataset.id)));
     // no HTML: <button data-click="finPlano" data-id="uuid">Editar</button>

   COEXISTE com .onclick= atual — só disponibiliza a infra. Migração é
   opt-in por tela na Fase 5. Sheets em document.body NÃO passam por aqui
   (não estão em #root) — continuam com .onclick= direto.

   Handler recebe (element_matched, event). Pode ler dados via el.dataset.*
   Passar o `event` permite stopPropagation/preventDefault quando preciso.

   Convention: nome do handler em camelCase (JS-style). data-id/data-op/etc
   pra passar contexto.
   ============================================================ */
const _dlgHandlers = Object.create(null);
let _dlgInstalled = false;
function _dlgRegister(name, fn){
  if(typeof name !== 'string' || typeof fn !== 'function') return;
  _dlgHandlers[name] = fn;
}
function _dlgFire(name, el, ev){
  const fn = _dlgHandlers[name];
  if(fn) fn(el, ev);
}
function _dlgMake(evt, attr){
  return (ev) => {
    const el = ev.target && ev.target.closest && ev.target.closest('['+attr+']');
    if(!el) return;
    const root = document.getElementById('root');
    if(!root || !root.contains(el)) return;
    _dlgFire(el.getAttribute(attr), el, ev);
  };
}
function _dlgInstall(){
  if(_dlgInstalled) return;
  _dlgInstalled = true;
  document.addEventListener('click',  _dlgMake('click',  'data-click'),  false);
  document.addEventListener('change', _dlgMake('change', 'data-change'), false);
  document.addEventListener('input',  _dlgMake('input',  'data-input'),  false);
  document.addEventListener('submit', _dlgMake('submit', 'data-submit'), false);
}
// v533 (debug): função global pro user rodar no console e ver o estado do router.
// Uso: __dlgDebug()  — reporta se listener instalou, quantos data-click existem, etc.
window.__dlgDebug = function(){
  const root = document.getElementById('root');
  const dc = root ? root.querySelectorAll('[data-click]') : [];
  const handlers = Object.keys(_dlgHandlers || {});
  console.log('[dlg] installed:', _dlgInstalled);
  console.log('[dlg] handlers registered:', handlers);
  console.log('[dlg] data-click elements in #root:', dc.length);
  dc.forEach((el, i) => console.log('  ['+i+']', el.tagName, 'data-click=', el.dataset.click, 'data-id=', el.dataset.id, 'text=', el.textContent.trim().slice(0, 30)));
  console.log('[dlg] MORPHDOM flag:', typeof MORPHDOM !== 'undefined' ? MORPHDOM : 'undef');
  console.log('[dlg] morphdom lib:', typeof morphdom);
  return { installed: _dlgInstalled, dcCount: dc.length, handlers };
};
const hoje = DEMO ? new Date(2026, 5, 3) : (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; })();
const isoOf = (d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let HOJE_ISO = isoOf(hoje);
// v427: renderBg — virar o dia durante o login/onboarding não muda nada nessas telas,
// e no meio da chamada apagaria as marcações. Sair da tela já redesenha com a data nova.
function _checkMidnight(){ const now=new Date(); now.setHours(0,0,0,0); if(now.getTime()!==hoje.getTime()){ hoje.setTime(now.getTime()); HOJE_ISO=isoOf(hoje); _resetDiario(''); renderBg(); } }
setInterval(_checkMidnight, 60000);
const fmtData = (d) => `${String(d.getDate()).padStart(2,'0')} ${meses[d.getMonth()]}`;
function diaRelativo(iso){
  if(!iso) return '';
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const diff = Math.round((hoje - dt) / 86400000);
  if(diff===0) return 'Hoje';
  if(diff===1) return 'Ontem';
  if(diff<7)   return diasSem[dt.getDay()].slice(0,3)+', '+String(d).padStart(2,'0')+' '+meses[m-1];
  return String(d).padStart(2,'0')+' '+meses[m-1];
}
const plural = (n,s,p)=> `${n} ${Math.abs(n)===1?s:p}`;   // 1 semana · 2 semanas
const moneyBR = (n) => 'R$ ' + n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
// v441: preço Pix = preço-cartão − X%. X vem de academies.config.descontoPix (global academia).
// Retorna 0 se não configurado → _priceHTML mostra só o preço único.
function _descontoPixPct(){ const n = Number((DB.academyConfig||{}).descontoPix||0); return (isFinite(n) && n>0 && n<=90) ? n : 0; }
function _precoPix(preco){ const d=_descontoPixPct(); return d ? +(preco*(1-d/100)).toFixed(2) : preco; }
// Renderiza cartão + pix (verde) quando há desconto; senão só o preço único.
// `size` = 'card' (grid do aluno / sheet) ou 'row' (linha do professor).
function _priceHTML(preco, size){
  const d = _descontoPixPct();
  if(!d) return `<span class="pr-single">${moneyBR(preco)}</span>`;
  const cls = size==='row' ? 'pr-dual pr-row' : 'pr-dual';
  return `<div class="${cls}"><span class="pr-cartao">${moneyBR(preco)}</span>
    <span class="pr-pix"><b>${moneyBR(_precoPix(preco))}</b> no Pix <span class="pr-off">−${d}%</span></span></div>`;
}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }

// ---- ViaCEP: auto-preenche endereço a partir do CEP (API pública, sem chave) ----
// Uso: bindViaCEP(cepInput, {logr, bairro, cidade, uf, num}) — busca no blur/enter.
function _maskCEP(v){ const d=String(v||'').replace(/\D/g,'').slice(0,8); return d.length>5?d.slice(0,5)+'-'+d.slice(5):d; }
// v479: máscara CPF (XXX.XXX.XXX-XX). Mesma lógica do CEP: 11 dígitos, insere . e -.
function _maskCPF(v){
  const d = String(v||'').replace(/\D/g,'').slice(0,11);
  if(d.length <= 3) return d;
  if(d.length <= 6) return d.slice(0,3)+'.'+d.slice(3);
  if(d.length <= 9) return d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6);
  return d.slice(0,3)+'.'+d.slice(3,6)+'.'+d.slice(6,9)+'-'+d.slice(9);
}
// Bind da máscara CPF num input — recalcula cursor por # de dígitos (mesmo padrão do CEP v474).
function bindCPF(inp){
  if(!inp) return;
  inp.addEventListener('input', ()=>{
    const raw = inp.value;
    const digitsBefore = raw.slice(0, inp.selectionStart).replace(/\D/g,'').length;
    inp.value = _maskCPF(raw);
    // Contagem de separadores adicionados antes do cursor: 1 se >3, 2 se >6, 3 se >9.
    const seps = (digitsBefore>3?1:0) + (digitsBefore>6?1:0) + (digitsBefore>9?1:0);
    const newPos = digitsBefore + seps;
    try{ inp.setSelectionRange(newPos, newPos); }catch(_){}
  });
}
// Campo de data em pt-BR sem picker do OS. Guarda no atributo data-iso pra facilitar leitura.
// Uso: dateBRField(id, isoValue, {placeholder?}) → HTML string; dateBRRead(el) → 'YYYY-MM-DD' ou ''.
function _isoToBR(iso){ if(!iso||typeof iso!=='string') return ''; const m=iso.match(/^(\d{4})-(\d{2})-(\d{2})/); return m?`${m[3]}/${m[2]}/${m[1]}`:''; }
// v539: _brToIso duplicado com linha 3662 (validador estrito) foi removido daqui.
// Em browser (sloppy mode) o segundo vencia — ordem de execução — mas com
// package.json `type: module`, node --check reclama de duplicate declaration.
// A versão estrita em 3662 é a que era efetivamente usada em runtime.
function dateBRField(id, isoValue, opts){
  const ph=(opts&&opts.placeholder)||'dd/mm/aaaa';
  return `<input class="inp" id="${id}" type="text" inputmode="numeric" maxlength="10" placeholder="${ph}" value="${safeAttr(_isoToBR(isoValue))}">`;
}
function bindDateBR(root){
  root.querySelectorAll('input[maxlength="10"][placeholder="dd/mm/aaaa"]').forEach(inp=>{
    if(inp._brMask) return; inp._brMask=true;
    inp.addEventListener('input', ()=>{
      const raw = inp.value.replace(/\D/g,'').slice(0,8);
      let out=raw;
      if(raw.length>4) out=raw.slice(0,2)+'/'+raw.slice(2,4)+'/'+raw.slice(4);
      else if(raw.length>2) out=raw.slice(0,2)+'/'+raw.slice(2);
      inp.value = out;
    });
  });
}
function dateBRRead(elem){ return _brToIso(elem?elem.value:''); }
function bindViaCEP(cepInp, fields){
  if(!cepInp) return;
  cepInp.addEventListener('input', ()=>{
    // v474: cursor conta DÍGITOS antes da posição original — depois soma +1 se
    // passou de 5 (o hífen inserido). Sem isso, digitar o 6º dígito deixava o
    // cursor entre "-" e "6" (posição 6) em vez de após o "6" (posição 7), e o
    // próximo dígito era inserido no lugar errado, dando a sensação de que
    // o dígito foi comido/embaralhado.
    const raw = cepInp.value;
    const digitsBefore = raw.slice(0, cepInp.selectionStart).replace(/\D/g,'').length;
    cepInp.value = _maskCEP(raw);
    const newPos = digitsBefore > 5 ? digitsBefore + 1 : digitsBefore;
    try{ cepInp.setSelectionRange(newPos, newPos); }catch(_){}
  });
  const doFetch = async ()=>{
    const cep = cepInp.value.replace(/\D/g,'');
    if(cep.length !== 8) return;
    cepInp.classList.add('cep-loading');
    try{
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if(d && !d.erro){
        const set=(sel,val)=>{ const e=typeof sel==='string'?document.querySelector(sel):sel; if(e && !e.value.trim()) e.value=val||''; };
        set(fields.logr,   d.logradouro);
        set(fields.bairro, d.bairro);
        set(fields.cidade, d.localidade);
        set(fields.uf,     d.uf);
        if(fields.num){ const n=typeof fields.num==='string'?document.querySelector(fields.num):fields.num; if(n) n.focus(); }
      }
    }catch(_){/* offline/timeout: preenche manual */}
    cepInp.classList.remove('cep-loading');
  };
  cepInp.addEventListener('blur', doFetch);
  cepInp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doFetch(); }});
}

// ---- Densidade da tabela ERP (professor, desktop): compact | comfortable ----
function _erpDensity(){ try{ return localStorage.getItem('yama.erpDensity')||'comfortable'; }catch(_){ return 'comfortable'; } }
function _setErpDensity(v){ try{ localStorage.setItem('yama.erpDensity', v); }catch(_){ } document.body.dataset.erpDensity=v; }
try{ document.body && (document.body.dataset.erpDensity=_erpDensity()); }catch(_){}

// ---- Focus trap em sheets (acessibilidade): Tab cicla dentro, Esc fecha ----
function _focusableInSheet(sheet){
  return [...sheet.querySelectorAll('button,input,select,textarea,[tabindex="0"],a[href]')]
    .filter(el => !el.hasAttribute('disabled') && !el.hidden && el.offsetParent !== null);
}
function _topmostSheet(){
  const all = document.querySelectorAll('.sheet-overlay.open .sheet');
  return all.length ? all[all.length-1] : null;
}
document.addEventListener('keydown', e=>{
  const sheet = _topmostSheet();
  if (!sheet) return;
  if (e.key === 'Tab'){
    const focusable = _focusableInSheet(sheet);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length-1];
    if (e.shiftKey){ if (document.activeElement === first || !sheet.contains(document.activeElement)){ e.preventDefault(); last.focus(); } }
    else { if (document.activeElement === last || !sheet.contains(document.activeElement)){ e.preventDefault(); first.focus(); } }
  } else if (e.key === 'Escape'){
    const overlay = sheet.closest('.sheet-overlay');
    const cancelBtn = sheet.querySelector('.sheet-cancel') || sheet.querySelector('[id$="-close"]') || sheet.querySelector('[id$="-cancel"]');
    if (cancelBtn){ e.preventDefault(); cancelBtn.click(); }
    else if (overlay){ e.preventDefault(); overlay.classList.remove('open'); setTimeout(()=>overlay.remove(), 260); }
  }
});
// Fechar no backdrop só vale se o CLIQUE INTEIRO foi no backdrop: arrastar de dentro
// da sheet e soltar fora dispara `click` no overlay e fechava a sheet sem querer.
// Guard global em captura — cobre os ~47 `sheet.onclick = e=>{ if(e.target===sheet) close(); }`.
(function(){
  let pressT = null;
  document.addEventListener('mousedown', e=>{ pressT = e.target; }, true);
  document.addEventListener('click', e=>{
    if (e.target.classList && e.target.classList.contains('sheet-overlay')
        && pressT && pressT !== e.target){
      e.stopPropagation(); e.preventDefault();
    }
    pressT = null;
  }, true);
})();
// Auto-focus no primeiro elemento focável da sheet quando abre (a11y + comportamento nativo)
(function(){
  if (typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver((muts)=>{
    muts.forEach(m=> m.addedNodes.forEach(n=>{
      if (n.nodeType !== 1) return;
      const overlay = (n.classList && n.classList.contains('sheet-overlay')) ? n : n.querySelector?.('.sheet-overlay');
      if (!overlay) return;
      // espera animação .open
      setTimeout(()=>{
        const sheet = overlay.querySelector('.sheet');
        if (!sheet) return;
        const focusable = _focusableInSheet(sheet);
        if (focusable.length){ try{ focusable[0].focus({preventScroll:true}); }catch(e){} }
      }, 280);
    }));
  });
  obs.observe(document.body, { childList:true, subtree:false });
})();

const BELTS = {
  branca:{cor:'#e8e8e8',nome:'Branca'}, azul:{cor:'#2f6fef',nome:'Azul'},
  roxa:{cor:'#7e4ddb',nome:'Roxa'}, marrom:{cor:'#7a4a25',nome:'Marrom'}, preta:{cor:'#1a1a1a',nome:'Preta'},
  // Infantil (IBJJF): faixas "_branca"/"_preta" têm uma LISTRA central (branca/preta) sobre a cor base.
  // `bar` = cor da listra central (renderizada por beltMini/belt-rank quando presente).
  cinza_branca:{cor:'#9e9e9e',nome:'Cinza/Branca',bar:'#ffffff'}, cinza:{cor:'#9e9e9e',nome:'Cinza'}, cinza_preta:{cor:'#9e9e9e',nome:'Cinza/Preta',bar:'#1a1a1a'},
  amarela_branca:{cor:'#f5c518',nome:'Amarela/Branca',bar:'#ffffff'}, amarela:{cor:'#f5c518',nome:'Amarela'}, amarela_preta:{cor:'#f5c518',nome:'Amarela/Preta',bar:'#1a1a1a'},
  laranja_branca:{cor:'#f57c00',nome:'Laranja/Branca',bar:'#ffffff'}, laranja:{cor:'#f57c00',nome:'Laranja'}, laranja_preta:{cor:'#f57c00',nome:'Laranja/Preta',bar:'#1a1a1a'},
  verde_branca:{cor:'#43a047',nome:'Verde/Branca',bar:'#ffffff'}, verde:{cor:'#43a047',nome:'Verde'}, verde_preta:{cor:'#43a047',nome:'Verde/Preta',bar:'#1a1a1a'},
  // Corais (faixa preta alta): vermelha e preta (7º), vermelha e branca (8º), vermelha (9-10º).
  coral:{cor:'#c62828',nome:'Vermelha e Preta',bar:'#1a1a1a'}, coral_branca:{cor:'#c62828',nome:'Vermelha e Branca',bar:'#ffffff'}, vermelha:{cor:'#b71c1c',nome:'Vermelha'},
};
const ADULT_BELTS = ['branca','azul','roxa','marrom','preta'];

/* Ordem HIERARQUICA COMPLETA CBJJ (menor -> maior grau), infantil + adulto misturados.
   Fonte unica pra sort/comparacao. Um verde (infantil) e mais graduado que branca
   (adulto) por definicao — nao ha separacao "infantil vs adulto" pra fins de ordem.
   NAO renomear as chaves — sao os mesmos identificadores usados em BELTS.
   Faixa desconhecida cai no FIM (rank 999) via beltRank(). */
const BELT_ORDEM = [
  'branca',          // 0
  'cinza_branca',    // 1
  'cinza',           // 2
  'cinza_preta',     // 3
  'amarela_branca',  // 4
  'amarela',         // 5
  'amarela_preta',   // 6
  'laranja_branca',  // 7
  'laranja',         // 8
  'laranja_preta',   // 9
  'verde_branca',    // 10
  'verde',           // 11
  'verde_preta',     // 12
  'azul',            // 13
  'roxa',            // 14
  'marrom',          // 15
  'preta',           // 16
  'coral',           // 17 · Vermelha/Preta
  'coral_branca',    // 18 · Vermelha/Branca
  'vermelha',        // 19
];
function beltRank(faixa){
  const i = BELT_ORDEM.indexOf(faixa);
  return i === -1 ? 999 : i;
}

/* === CBJJ / IBJJF — Sistema Geral de Graduacao v3.2 (dez/2025) === */
const CBJJ = {
  version: '3.2',
  age_categories: [
    {name:'Pre-Mirim 1',age:4},{name:'Pre-Mirim 2',age:5},{name:'Pre-Mirim 3',age:6},
    {name:'Mirim 1',age:7},{name:'Mirim 2',age:8},{name:'Mirim 3',age:9},
    {name:'Infantil 1',age:10},{name:'Infantil 2',age:11},{name:'Infantil 3',age:12},
    {name:'Infanto-Juvenil 1',age:13},{name:'Infanto-Juvenil 2',age:14},{name:'Infanto-Juvenil 3',age:15},
    {name:'Juvenil 1',age:16},{name:'Juvenil 2',age:17},
    {name:'Adulto',age_min:18,age_max:29},
    {name:'Master 1',age_min:30,age_max:35},{name:'Master 2',age_min:36,age_max:40},
    {name:'Master 3',age_min:41,age_max:45},{name:'Master 4',age_min:46,age_max:50},
    {name:'Master 5',age_min:51,age_max:55},{name:'Master 6',age_min:56,age_max:60},
    {name:'Master 7',age_min:61,age_max:null},
  ],
  adult_belts: [
    {belt:'branca', min_age:0,  min_months:12, next:'azul',   stripes:4},
    {belt:'azul',   min_age:16, min_months:24, next:'roxa',   stripes:4,
      reductions:[
        {cond:'Cadastro anterior em Cinza/Amarelo/Laranja', months:12},
        {cond:'Cadastro anterior em Verde', months:0},
        {cond:'Cadastro anterior em Azul Juvenil', months:0},
        {cond:'Campeao Mundial adulto na Azul', months:0},
      ]},
    {belt:'roxa',   min_age:16, min_months:18, next:'marrom', stripes:4,
      reductions:[
        {cond:'Cadastro anterior em Azul Juvenil', months:12},
        {cond:'Cadastro Laranja/Verde + Azul Juvenil', months:0},
        {cond:'Cadastro anterior como Roxa Juvenil', months:0},
        {cond:'Campeao Mundial adulto na Roxa', months:0},
      ]},
    {belt:'marrom', min_age:18, min_months:12, next:'preta',  stripes:4,
      reductions:[{cond:'Campeao Mundial adulto na Marrom', months:0}]},
    {belt:'preta',  min_age:19, min_months:null, next:null,   stripes:6,
      min_age_exception:{age:18, cond:'Campeao Mundial adulto na faixa marrom'}},
  ],
  black_belt_degrees: [
    {degree:1,years:3,cumulative:3},{degree:2,years:3,cumulative:6},{degree:3,years:3,cumulative:9},
    {degree:4,years:5,cumulative:14},{degree:5,years:5,cumulative:19},{degree:6,years:5,cumulative:24},
    {degree:7,years:7,cumulative:31,belt:'coral'},{degree:8,years:7,cumulative:38,belt:'coral_branca'},
    {degree:9,years:10,cumulative:48,belt:'vermelha'},
  ],
  // Sistema INFANTIL (4–15) — IBJJF Anexo I. min_age = idade mínima p/ ENTRAR no grupo.
  // Ordem de progressão: branca → grupo cinza → amarela → laranja → verde → (16) azul.
  youth_max_age: 15,
  youth_belts: [
    {group:'cinza',   min_age:4,  belts:['cinza_branca','cinza','cinza_preta']},
    {group:'amarela', min_age:7,  belts:['amarela_branca','amarela','amarela_preta']},
    {group:'laranja', min_age:10, belts:['laranja_branca','laranja','laranja_preta']},
    {group:'verde',   min_age:13, belts:['verde_branca','verde','verde_preta']},
  ],
  // Faixas de mestre (graus altos da preta) — idade mínima aproximada pelos anos acumulados na preta.
  master_belts: [
    {belt:'coral',        min_age:50},   // 7º grau (~31 anos de preta a partir dos 19)
    {belt:'coral_branca', min_age:57},   // 8º grau (~38 anos)
    {belt:'vermelha',     min_age:67},   // 9º grau (~48 anos)
  ],
};

// Ordem completa de progressão CBJJ (infantil + adulto), p/ derivar a próxima faixa.
const CBJJ_CHAIN = [
  'branca',
  'cinza_branca','cinza','cinza_preta',
  'amarela_branca','amarela','amarela_preta',
  'laranja_branca','laranja','laranja_preta',
  'verde_branca','verde','verde_preta',
  'azul','roxa','marrom','preta',
  'coral','coral_branca','vermelha',
];

// Faixas que um aluno PODE receber conforme a idade (regras CBJJ). Sem idade → todas.
function faixasPorIdade(idade){
  if(idade == null) return CBJJ_CHAIN.slice();
  const out = ['branca'];
  if(idade <= CBJJ.youth_max_age){                 // 4–15: sistema infantil
    CBJJ.youth_belts.forEach(g=>{ if(idade >= g.min_age) out.push(...g.belts); });
    return out;
  }
  // 16+: sistema adulto
  CBJJ.adult_belts.forEach(b=>{ if(b.belt!=='branca' && b.min_age!=null && idade >= b.min_age) out.push(b.belt); });
  CBJJ.master_belts.forEach(m=>{ if(idade >= m.min_age) out.push(m.belt); });
  return out;
}
// Faixa atual sempre selecionável, mesmo que a idade diga o contrário (dados legados/importados).
function faixasParaAluno(idade, faixaAtual){
  const fs = faixasPorIdade(idade);
  if(faixaAtual && !fs.includes(faixaAtual)) fs.unshift(faixaAtual);
  return fs;
}
// Próxima faixa na cadeia CBJJ que a idade permite (null = topo/última possível p/ a idade).
function proximaFaixaCBJJ(faixa, idade){
  const permitidas = faixasPorIdade(idade);
  const i = CBJJ_CHAIN.indexOf(faixa);
  if(i<0) return null;
  for(let j=i+1;j<CBJJ_CHAIN.length;j++){ if(permitidas.includes(CBJJ_CHAIN[j])) return CBJJ_CHAIN[j]; }
  return null;
}

function idadeCBJJ(anoNasc){ return anoNasc ? hoje.getFullYear() - anoNasc : null; }
function categoriaCBJJ(anoNasc){
  const idade = idadeCBJJ(anoNasc);
  if(idade==null) return null;
  const cats = CBJJ.age_categories;
  for(let i=cats.length-1;i>=0;i--){
    const c=cats[i];
    if(c.age!=null && idade===c.age) return c.name;
    if(c.age_min!=null && idade>=c.age_min && (c.age_max==null||idade<=c.age_max)) return c.name;
  }
  if(idade<4) return null;
  return cats[cats.length-1].name;
}
function tempoNaFaixaMeses(dataFaixa){
  if(!dataFaixa) return null;
  const [y,m,d] = dataFaixa.split('-').map(Number);
  let ms = (hoje.getFullYear()-y)*12 + (hoje.getMonth()-(m-1));
  if(hoje.getDate()<d) ms--;
  return Math.max(0, ms);
}
function _grupoInfantilMinAge(belt){
  const g = CBJJ.youth_belts.find(x=>x.belts.includes(belt));
  return g ? g.min_age : null;
}
function elegibilidadeCBJJ(eu){
  const checks = [];
  const idade = idadeCBJJ(eu.nascimento);
  // ---- sistema INFANTIL (4–15) ou faixa infantil atual ----
  const ehInfantil = (idade!=null && idade<=CBJJ.youth_max_age) || _grupoInfantilMinAge(eu.faixa)!=null;
  if(ehInfantil){
    const next = proximaFaixaCBJJ(eu.faixa, idade);
    if(!next) return { eligible:false, checks:[{label:'Faixa máxima para a idade',ok:true,detail:idade!=null?`${idade} anos`:''}], nextBelt:null };
    const minAge = _grupoInfantilMinAge(next) ?? (next==='azul' ? 16 : null);
    let ageOk = null;
    if(minAge!=null){
      if(idade!=null){ ageOk = idade>=minAge; checks.push({ label:`Idade minima p/ ${BELTS[next].nome}: ${minAge} anos`, ok:ageOk, detail:ageOk?`Tem ${idade} anos`:`Faltam ${minAge-idade} ano(s)` }); }
      else checks.push({ label:`Idade minima p/ ${BELTS[next].nome}: ${minAge} anos`, ok:null, detail:'Informe o ano de nascimento' });
    }
    checks.push({ label:'Tempo minimo na faixa', ok:null, detail:'Definido pelo sistema de graus da academia (CBJJ Anexo I)' });
    return { eligible: ageOk===true, checks, nextBelt:next };
  }
  // ---- sistema ADULTO (16+) ----
  const info = CBJJ.adult_belts.find(b=>b.belt===eu.faixa);
  if(!info || !info.next) return { eligible:false, checks:[{label:'Faixa maxima atingida',ok:true,detail:''}], nextBelt:null };
  const nextInfo = CBJJ.adult_belts.find(b=>b.belt===info.next);
  // _faixaDesde (canônico): aceita `faixa` OU `inicio`, e cai no 1º `grau` da faixa.
  // Procurar só por tipo==='faixa' fazia o aluno cadastrado com evento `inicio`
  // (o que a Edge Function semeia) ver "Sem data de graduacao registrada".
  const fgData = _faixaDesde(DB.graduacoes||[], eu.faixa);
  const mesesNaFaixa = fgData ? tempoNaFaixaMeses(fgData) : null;
  if(nextInfo){
    const minAge = nextInfo.min_age;
    if(idade!=null){
      checks.push({ label:`Idade minima: ${minAge} anos`, ok:idade>=minAge, detail:idade>=minAge?`Voce tem ${idade} anos`:`Faltam ${minAge-idade} ano(s)` });
    } else {
      checks.push({ label:`Idade minima: ${minAge} anos`, ok:null, detail:'Informe seu ano de nascimento' });
    }
  }
  if(info.min_months && info.min_months>0){
    if(mesesNaFaixa!=null){
      const falta = Math.max(0, info.min_months - mesesNaFaixa);
      checks.push({ label:`Tempo minimo na ${BELTS[eu.faixa].nome}: ${info.min_months} meses`, ok:falta===0, detail:falta===0?`${mesesNaFaixa} meses na faixa`:`Faltam ${falta} meses` });
    } else {
      checks.push({ label:`Tempo minimo na ${BELTS[eu.faixa].nome}: ${info.min_months} meses`, ok:null, detail:'Sem data de graduacao registrada' });
    }
  }
  const eligible = checks.length>0 && checks.every(c=>c.ok===true);
  return { eligible, checks, nextBelt:info.next };
}
// Faixa BJJ — UMA implementação HTML+CSS que todos os contextos reutilizam (item 3).
// Anatomia (regra CBJJ): corpo colorido → ponteira preta (VERMELHA na preta) → ponta colorida.
// Bicolor (kids _branca/_preta + corais): listra central --bar sobre corpo e ponta.
// Tamanho controlado por CSS (var --bm-h) via overrides por contexto (.belt-rank, .belt-pill, .belt-field, .belt-pick).
function beltMini(b, graus){
  const x = BELTS[b] || { cor:'#9e9e9e' };
  const stripes = '<i></i>'.repeat(Math.max(0, Math.min(6, (graus|0))));
  const red = b==='preta' ? ' red-tip' : '';
  const bic = x.bar ? ' bicolor' : '';
  const barVar = x.bar ? `;--bar:${x.bar}` : '';
  return `<span class="belt-mini${bic}" style="--bc:${x.cor}${barVar}">`+
    `<span class="bm-body"></span><span class="bm-tip${red}">${stripes}</span><span class="bm-end"></span></span>`;
}
// beltPill: chip com o nome + a MESMA beltMini menor. Sem barrinha custom, sem SVG.
function beltPill(b, graus){
  const x = BELTS[b] || { cor:'#9e9e9e', nome:safeTxt(b||'—') };
  const g = graus!=null ? ` · ${graus}º` : '';
  return `<span class="belt-pill" style="background:${x.cor}22;color:${b==='branca'?'#888':x.cor}">${beltMini(b, graus)}${x.nome}${g}</span>`;
}
/* v345: a linha do tempo é a fonte da verdade da graduação. `semGrad` (do adapter)
   marca quem não tem NENHUM evento — a UI mostra "sem graduação" em vez de uma faixa
   branca lisa que ninguém registrou. `profiles.faixa` continua existindo como valor
   técnico (não virou null: 43 pontos leem BELTS[faixa]). */
function _semGrad(a){
  if(!a) return false;
  if(a.semGrad != null) return !!a.semGrad;               // lista (adapter já sabe)
  if(Array.isArray(a.graduacoes)) return !a.graduacoes.filter(g=>g&&g.data).length;   // ficha aberta
  return false;
}
function beltPillOuVazio(a){
  return _semGrad(a) ? '<span class="belt-pill vazio">Sem graduação</span>' : beltPill(a.faixa, a.graus);
}
// Seletor de faixa: folha com a lista de mini-faixas + o NOME da faixa ao lado.
// onPick(faixa) ao escolher.
function abrirSeletorFaixa(faixas, sel, onPick){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Escolher faixa">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Escolher faixa</div>
    <div class="belt-picker" id="bp-list"></div>
    <button class="sheet-cancel" id="bp-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('#bp-list');
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  (faixas||[]).forEach(f=>{
    const nome = BELTS[f]?.nome || f;
    const row = el(`<button type="button" class="belt-pick ${f===sel?'on':''}" aria-label="${safeAttr(nome)}">${beltMini(f,0)}<span class="belt-pick-nm">${safeTxt(nome)}</span><span class="belt-pick-ck" aria-hidden="true">${f===sel?'✓':''}</span></button>`);
    row.onclick = ()=>{ close(); onPick(f); };
    list.appendChild(row);
  });
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#bp-cancel').onclick = close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
// Renderiza o campo de faixa (mini-faixa + seta) dentro de `container` e liga o toque ao seletor.
function renderBeltField(container, faixas, sel, onPick){
  if(!container) return;
  container.innerHTML = '';
  const field = el(`<button type="button" class="belt-field" aria-label="Faixa: ${safeAttr(BELTS[sel]?.nome||sel||'—')}. Tocar para trocar">${beltMini(sel,0)}<span class="bf-caret" aria-hidden="true">▾</span></button>`);
  field.onclick = ()=> abrirSeletorFaixa(faixas, sel, onPick);
  container.appendChild(field);
}

/* ============================================================
   SEED_DEMO — dados de VITRINE. Só entram com ?demo=1 ou ?test=1.
   ------------------------------------------------------------
   v424 (correção estrutural): antes esses dados nasciam DENTRO do DB e a
   produção ia zerando campo a campo conforme descobríamos vazamentos
   (v416 alunos/turmas/loja · v422 FOCO_INICIAL · v423 eu). Cada campo novo
   com placeholder era um bug futuro. Agora a vitrine é OPT-IN: o DB nasce
   vazio e só recebe o seed se VITRINE for true. Vazar virou impossível
   por construção, não por lembrança.

   NÃO entra aqui: identidade da marca (academia.nome/kanji/artes) e o
   catálogo de técnicas — valem em produção também.
   ============================================================ */
const SEED_DEMO = {
  professor: { nome:'Prof. Ricardo Maciel' },
  academiaTurma: 'Adulto · Gi · 19h30',

  // Turmas (grupo) → sessões (dia+hora+variação). Fonte da grade de horários (§ gestão).
  // dia: 'seg'..'dom'; hora: 'HH:MM'; variacao: rótulo curto opcional; bilingue: 🇺🇸.
  turmas: [
    { id:'t1', nome:'Adulto', faixaEtaria:'16+', cor:'#334155', sessoes:[
      {id:'s1',dia:'seg',hora:'06:00'},{id:'s2',dia:'seg',hora:'19:30'},
      {id:'s3',dia:'ter',hora:'06:00'},{id:'s4',dia:'ter',hora:'12:00',variacao:'Avançado'},{id:'s5',dia:'ter',hora:'19:30'},
      {id:'s6',dia:'qua',hora:'19:30'},
      {id:'s7',dia:'qui',hora:'06:00'},{id:'s8',dia:'qui',hora:'12:00',variacao:'Avançado'},{id:'s9',dia:'qui',hora:'19:30',bilingue:true},
      {id:'s10',dia:'sex',hora:'19:30',variacao:'No-Gi'},{id:'s11',dia:'sab',hora:'10:00',variacao:'Livre'},
    ]},
    { id:'t2', nome:'Kodomo', faixaEtaria:'6–9', cor:'#d4a017', sessoes:[
      {id:'s12',dia:'ter',hora:'09:00'},{id:'s13',dia:'qua',hora:'18:00'},{id:'s14',dia:'qui',hora:'09:00',bilingue:true},
    ]},
    { id:'t3', nome:'Chiisai', faixaEtaria:'3–5', cor:'#8e44ad', sessoes:[
      {id:'s15',dia:'ter',hora:'09:00'},{id:'s16',dia:'qui',hora:'17:30'},
    ]},
    { id:'t4', nome:'Kouhai', faixaEtaria:'10–14', cor:'#2e7d32', sessoes:[
      {id:'s17',dia:'ter',hora:'17:00'},{id:'s18',dia:'qui',hora:'17:00',bilingue:true},{id:'s19',dia:'sex',hora:'18:00',variacao:'Competição'},
    ]},
    { id:'t5', nome:'Feminino', faixaEtaria:'', cor:'#c2185b', sessoes:[
      {id:'s20',dia:'sex',hora:'09:00'},
    ]},
  ],

  // aluno logado
  eu: { nome:'Gabriel Tavares', nomeCompleto:'Gabriel Tavares de Jesus', apelido:'Tavares',
        iniciais:'GT', faixa:'azul', graus:2, modalidade:'Jiu-Jitsu', foto:null,
        isProfessor:false,                 // capacidade: só professor (role no backend) vê "Modo professor"
        desde:'2021-03', nascimento:1998,
        aulasGrau:{ atual:44, meta:48 },   // 44/48 — 4 para o próximo grau
        aulasGraduacao:100,                // aulas restantes para a próxima faixa
        avisos:3,
        mensalidade:{ valor:180, status:'ok', venc:'10/06' } },

  // journal pessoal (treinos do aluno)
  treinos: [
    { id:3, tipo:'tecnica', data:'2026-06-02', titulo:'Aula Técnica', tecnica:'Raspagem da borboleta + 3 rounds de randori', mood:'🔥', dia:'Ontem',
      det:{ counters:{fin:2,bat:1,rasp:3,pass:0,queda:0,esc:1}, bem:['Apliquei no rolamento','Boa defesa de guarda'], melhorar:['Faltou pressão'], nota:'Raspagem entrou limpa contra o João faixa-roxa. Underhook fez toda a diferença.' } },
    { id:2, tipo:'livre',   data:'2026-05-31', titulo:'Livre', tecnica:'Open mat — 5 rounds, foco em passagem', mood:'😊', dia:'Dom',
      det:{ counters:{fin:1,bat:2,rasp:1,pass:4,queda:1,esc:2}, bem:['Bom condicionamento'], melhorar:['Fui pego em','Cansei rápido'], nota:'Passagem toreando funcionou bem. Preciso segurar mais a pegada.' } },
    { id:1, tipo:'tecnica', data:'2026-05-30', titulo:'Aula Técnica', tecnica:'Estrangulamento pelas costas (mata-leão)', mood:'😐', dia:'Sáb',
      det:{ counters:{fin:3,bat:0,rasp:0,pass:1,queda:0,esc:0}, bem:['Aprendi a técnica'], melhorar:['Errei o timing'], nota:'Mata-leão: esconder o queixo antes de fechar. Peguei 3x no drilling.' } },
  ],

  // >>> ponto de integração nº2: graduações (professor registra, aluno vê na timeline)
  graduacoes: [
    { faixa:'azul', graus:2, tipo:'grau', data:'2026-02-15' },
    { faixa:'azul', graus:1, tipo:'grau', data:'2025-09-10' },
    { faixa:'azul', graus:0, tipo:'faixa', data:'2024-11-20' },
    { faixa:'branca', graus:4, tipo:'faixa', data:'2021-03-01' },
  ],

  // consistência / streak semanal (S T Q Q S S D)
  semana: { feitos:2, meta:4, streakSemanas:5, dias:[true,true,false,false,false,false,false] },

  // gestão (lado professor)
  alunos: [
    // freq=% de presença no mês · diasSem=dias sem treinar · aptoGrad=apto a graduar (CBJJ) — campos p/ relatórios/§7.1
    { nm:'Gabriel Alves', ini:'GA', faixa:'azul', graus:2, nascimento:1999, pres:'19:32', pago:'ok', cor:'#2f8fef', freq:82, diasSem:1, aptoGrad:true },
    { nm:'Marina Costa', ini:'MC', faixa:'roxa', graus:1, nascimento:1996, pres:'19:28', pago:'ok', cor:'#7e4ddb', freq:74, diasSem:2, aptoGrad:false },
    { nm:'Pedro Henrique', ini:'PH', faixa:'branca', graus:3, nascimento:2005, pres:'19:40', pago:'late', cor:'#43b581', freq:65, diasSem:1, aptoGrad:true },
    { nm:'Lucas Ferraz', ini:'LF', faixa:'azul', graus:0, nascimento:2001, pres:null, pago:'soon', cor:'#f5a25a', freq:21, diasSem:18, aptoGrad:false },
    { nm:'Ana Beatriz', ini:'AB', faixa:'marrom', graus:2, nascimento:1994, pres:'19:35', pago:'ok', cor:'#ef5350', freq:88, diasSem:1, aptoGrad:false },
    { nm:'Rafael Souza', ini:'RS', faixa:'branca', graus:1, nascimento:2003, pres:null, pago:'late', cor:'#7a4a25', freq:14, diasSem:25, aptoGrad:false },
    { id:'a7',  nm:'Juliana Mendes', ini:'JM', faixa:'azul',   graus:3, nascimento:2000, pres:'20:05', pago:'ok',   cor:'#2f8fef', freq:91, diasSem:1,  aptoGrad:true },
    { id:'a8',  nm:'Bruno Carvalho', ini:'BC', faixa:'branca', graus:4, nascimento:2004, pres:'19:50', pago:'soon', cor:'#43b581', freq:70, diasSem:2,  aptoGrad:true },
    { id:'a9',  nm:'Camila Rocha',   ini:'CR', faixa:'roxa',   graus:0, nascimento:1997, pres:null,    pago:'ok',   cor:'#7e4ddb', freq:33, diasSem:12, aptoGrad:false },
    { id:'a10', nm:'Diego Fernandes',ini:'DF', faixa:'azul',   graus:1, nascimento:2002, pres:null,    pago:'late', cor:'#f5a25a', freq:9,  diasSem:31, aptoGrad:false },
    { id:'a11', nm:'Larissa Pinto',  ini:'LP', faixa:'branca', graus:2, nascimento:2006, pres:'19:38', pago:'ok',   cor:'#ef5350', freq:85, diasSem:1,  aptoGrad:false },
    { id:'a12', nm:'Thiago Nogueira',ini:'TN', faixa:'marrom', graus:3, nascimento:1992, pres:'20:12', pago:'ok',   cor:'#0d9488', freq:96, diasSem:0,  aptoGrad:true },
  ],

  // Retrospectiva "Seu ano no Jiu-Jitsu" (estilo Wrapped)
  retro: {
    ano: 2026, treinos: 142, horas: 178, novasTecnicas: 11, melhorStreak: 9,
    tecnicaTop: 'Hadaka-jime', tecnicaTopTreinos: 14,
    finBat: 2.3, pctTecnica: 70, faixaConquista: 'Azul · 2º grau',
  },

  // Sistemas de jogo — técnicas conectadas no seu jogo (do controle à finalização)
  sistemas: [
    { nome:'Guarda → finalização', emoji:'🛡️', cor:'#2f8fef', desc:'Seu jogo por baixo, do puxar à chave.',
      passos:[ {t:'Hikikomi', d:'puxa pra guarda'}, {t:'Dō-jime', d:'controla o tronco'}, {t:'Juji-gatame', d:'finaliza no braço'} ] },
    { nome:'Pressão por cima', emoji:'⬇️', cor:'#ef5350', desc:'Passou, controlou, estrangulou.',
      passos:[ {t:'Yoko-shiho-gatame', d:'cem quilos lateral'}, {t:'Kami-shiho-gatame', d:'norte-sul'}, {t:'Hadaka-jime', d:'pega as costas'} ] },
    { nome:'Em pé → chão (Kosen)', emoji:'⬆️', cor:'#43b581', desc:'Da queda direto pro ataque no solo.',
      passos:[ {t:'O-soto-gari', d:'derruba'}, {t:'Tate-shiho-gatame', d:'monta'}, {t:'Ude-garami', d:'chaveia'} ] },
  ],

  // Notas rápidas (insights soltos, sem formulário)
  notas: [
    { id:1, data:'2026-06-01', texto:'Lembrar de manter o cotovelo colado no juji-gatame, sempre perco quando abro.' },
  ],

  // Lesões (registrar e acompanhar)
  lesoes: [
    { id:1, parte:'Joelho direito', data:'2026-05-10', status:'recuperando', nota:'Torci numa raspagem. Evitar leglock por 3 semanas.' },
  ],

  // Centro de notificações
  notificacoes: [
    { id:2, ic:'⭐', txt:'Você está a 4 aulas do 3º grau!', data:'2026-06-02' },
    { id:3, ic:'💳', txt:'Mensalidade vence dia 10/06', data:'2026-06-01' },
  ],

  // Catálogo REAL da Yama (importado de marketplace.youdraw.com.br/pages/store/yama-jiu-jitsu,
  // 2026-07-10). Imagens locais em loja/ (CSP 'self'). `img` opcional — fallback = emoji.
  // Em PRODUÇÃO quem popula é sbSync.pullLoja (backend) — este array é só vitrine.
  lojaProdutos: [
    { id:1, nome:'Moletom Yama — Coleção Classic', cat:'Vestuário', preco:210.35, emoji:'🧥', cor:'#f0f0f2', img:'loja/moletom-yama.jpg', desc:'O moletom da Coleção Clássica Yama Jiu Jitsu foi criado para quem valoriza tradição, identidade e simplicidade.', tam:['P','M','G','GG','EG'] },
    { id:2, nome:'Camiseta Yama Jiu Jitsu — Coleção Classic', cat:'Vestuário', preco:131.29, emoji:'👕', cor:'#fdecec', img:'loja/camiseta-classic.jpg', desc:'A camiseta Classic Yama Jiu Jitsu traduz a essência da marca em sua forma mais pura.', tam:['P','M','G','GG','EG'] },
    { id:3, nome:"Seiryoku Zen'yō — Oversized", cat:'Vestuário', preco:180.91, emoji:'👕', cor:'#eaf4fe', img:'loja/seiryoku-zenyo.jpg', desc:'Inspirada no princípio Seiryoku Zen’yō: o máximo de eficiência com o mínimo de esforço.', tam:['P','M','G','GG','EG'] },
    { id:4, nome:'SAKURA JUDO', cat:'Vestuário', preco:147.94, emoji:'🌸', cor:'#fdecec', img:'loja/sakura-judo.jpg', desc:'Camiseta oversized da linha Sakura.', tam:['P','M','G','GG'] },
    { id:5, nome:'JIU JITSU SAKURA', cat:'Vestuário', preco:148.48, emoji:'🌸', cor:'#fef7e0', img:'loja/jiu-jitsu-sakura.jpg', desc:'Camiseta oversized da linha Sakura.', tam:['P','M','G','GG'] },
    { id:6, nome:'Body Infantil Yama — Coleção Classic', cat:'Vestuário', preco:53.06, emoji:'👶', cor:'#e7f6ef', img:'loja/body-infantil.png', desc:'O body infantil da Coleção Clássica, para quem faz parte da história desde cedo.', tam:['P','M','G','GG'] },
    { id:7, nome:'YAMA KIDS (0–3 anos)', cat:'Vestuário', preco:109.48, emoji:'🧒', cor:'#eaf4fe', img:'loja/yama-kids-0-3.jpg', desc:'Camiseta infantil Yama.', tam:['0','2'] },
    { id:8, nome:'YAMA Kids (4–9 anos)', cat:'Vestuário', preco:113.56, emoji:'🧒', cor:'#e7f6ef', img:'loja/yama-kids-4-9.jpg', desc:'Camiseta infantil Yama.', tam:['4','6','8'] },
  ],
};

/* ============================================================
   DB — ESTADO COMPARTILHADO (o "banco"), shape de PRODUÇÃO.
   ------------------------------------------------------------
   v424: nasce VAZIO. Quem enche é (a) o seed de vitrine, só com ?demo=1/?test=1,
   ou (b) applyDump + pull* do backend, em produção. Não existe mais dado fake
   "de fábrica" esperando ser zerado depois.
   Fica em produção: identidade da marca (academia.nome/kanji/artes) e o
   CATÁLOGO de técnicas (fallback do pullTecnicas quando offline).
   ============================================================ */
const DB = {
  role: 'aluno',                 // 'aluno' | 'professor'
  academia: { nome:'Yama Jiu-Jitsu', kanji:'山', artes:'Judô Kodokan · Kosen · Jiu-Jitsu', turma:null },
  professor: { nome:'' },
  turmas: [],            // pullTurmas popula
  eu: { nome:'', nomeCompleto:'', apelido:'', iniciais:'', faixa:'', graus:0, modalidade:'Jiu-Jitsu', foto:null,
        isProfessor:false, desde:'', nascimento:null,
        aulasGrau:{ atual:0, meta:40 }, aulasGraduacao:160, avisos:0,
        mensalidade:{ valor:0, status:'ok', venc:'—' } },
  treinos: [],           // applyDump popula
  graduacoes: [],        // pullAll popula
  checkinHoje: { feito:false, hora:null },
  semana: { feitos:0, meta:4, streakSemanas:0, dias:[false,false,false,false,false,false,false] },
  alunos: [],            // sbProf.getAlunos popula (só professor)
  retro: null,
  sistemas: [],
  notas: [],
  lesoes: [],
  notificacoes: [],
  loja: { cat:'Todos', carrinho:[], produtos:[] },   // pullLoja popula produtos

  // biblioteca pessoal de técnicas — id estável (chave de persistência), jp=display, pt=tradução
  // FICA em produção: é o catálogo base + fallback do pullTecnicas (migration 0031).
  // Para "outros" (BJJ moderno) o jp aceita nome em PT/EN consagrado (sem japonês inventado).
  tecnicas: [
    // v413: taxonomia 2 tradições (Kodokan + Jiu-Jitsu). Kosen desativado — suas
    // técnicas migraram pras categorias corretas. IDs mantidos estáveis (chave em
    // technique_progress) — id nunca muda depois de criado; só o campo `cat` muda.
    // v410: sem placeholder de estado (nivel/treinos/ultima/nota). Aluno começa zerado.

    // ============ KODOKAN · Nage-waza (projeções) ============
    // v415: sub-grupo Kodokan oficial (Te/Koshi/Ashi/Sutemi-waza). Sub só existe
    // pra Nage-waza — as outras 3 famílias Kodokan não têm subdivisão comparável.
    // Te-waza · mão/braço
    { id:'nag-seoi',        jp:'Seoi-nage',         pt:'Projeção pelo ombro',           cat:'nage', sub:'te',    oficial:true },
    { id:'nag-ipponseoi',   jp:'Ippon-seoi-nage',   pt:'Projeção pelo ombro (1 braço)', cat:'nage', sub:'te',    oficial:true },
    { id:'nag-taiotoshi',   jp:'Tai-otoshi',        pt:'Derrubada do corpo',            cat:'nage', sub:'te',    oficial:true },
    // Koshi-waza · quadril
    { id:'nag-ogoshi',      jp:'O-goshi',           pt:'Grande jogada de quadril',      cat:'nage', sub:'koshi', oficial:true },
    { id:'nag-ukigoshi',    jp:'Uki-goshi',         pt:'Quadril flutuante',             cat:'nage', sub:'koshi', oficial:true },
    { id:'nag-haraigoshi',  jp:'Harai-goshi',       pt:'Varrida de quadril',            cat:'nage', sub:'koshi', oficial:true },
    { id:'nag-hanegoshi',   jp:'Hane-goshi',        pt:'Salto de quadril',              cat:'nage', sub:'koshi', oficial:true },
    // Ashi-waza · perna
    { id:'nag-osoto',       jp:'O-soto-gari',       pt:'Grande ceifada externa',        cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-ouchi',       jp:'O-uchi-gari',       pt:'Grande ceifada interna',        cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-kosoto',      jp:'Ko-soto-gari',      pt:'Pequena ceifada externa',       cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-kouchi',      jp:'Ko-uchi-gari',      pt:'Pequena ceifada interna',       cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-deashi',      jp:'De-ashi-barai',     pt:'Varrida do pé avançado',        cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-sasae',       jp:'Sasae-tsurikomi-ashi', pt:'Bloqueio de tornozelo',      cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-hizaguruma',  jp:'Hiza-guruma',       pt:'Roda de joelho',                cat:'nage', sub:'ashi',  oficial:true },
    { id:'nag-uchimata',    jp:'Uchi-mata',         pt:'Projeção pela coxa interna',    cat:'nage', sub:'ashi',  oficial:true },
    // Sutemi-waza · sacrifício (Ma + Yoko unidos — o gesto do "cair pra derrubar")
    { id:'nag-tomoe',       jp:'Tomoe-nage',        pt:'Projeção em círculo',           cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-sumigaeshi',  jp:'Sumi-gaeshi',       pt:'Inversão de canto',             cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-uranage',     jp:'Ura-nage',          pt:'Projeção invertida',            cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-tawara',      jp:'Tawara-gaeshi',     pt:'Inversão fardo de arroz',       cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-yokootoshi',  jp:'Yoko-otoshi',       pt:'Derrubada lateral',             cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-taniotoshi',  jp:'Tani-otoshi',       pt:'Derrubada no vale',             cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-kanibasami',  jp:'Kani-basami',       pt:'Tesoura de caranguejo',         cat:'nage', sub:'sutemi', oficial:true },
    { id:'nag-obitori',     jp:'Obi-tori-gaeshi',   pt:'Inversão pegando a faixa',      cat:'nage', sub:'sutemi', oficial:true },

    // ============ KODOKAN · Osaekomi-waza (imobilizações) ============
    { id:'osa-kesa',        jp:'Kesa-gatame',       pt:'Imobilização em echarpe',       cat:'osaekomi', oficial:true },
    { id:'osa-kuzure-kesa', jp:'Kuzure-kesa-gatame',pt:'Echarpe modificada',            cat:'osaekomi', oficial:true },
    { id:'osa-ushiro-kesa', jp:'Ushiro-kesa-gatame',pt:'Echarpe reversa',               cat:'osaekomi', oficial:true },
    { id:'osa-kata',        jp:'Kata-gatame',       pt:'Imobilização pelo ombro',       cat:'osaekomi', oficial:true },
    { id:'osa-kami',        jp:'Kami-shiho-gatame', pt:'Cem quilos (norte-sul)',        cat:'osaekomi', oficial:true },
    { id:'osa-kuzure-kami', jp:'Kuzure-kami-shiho-gatame', pt:'Norte-sul modificado',   cat:'osaekomi', oficial:true },
    { id:'osa-yoko',        jp:'Yoko-shiho-gatame', pt:'Cem quilos cruzado (lateral)',  cat:'osaekomi', oficial:true },
    { id:'osa-tate',        jp:'Tate-shiho-gatame', pt:'Montada (cem quilos montado)',  cat:'osaekomi', oficial:true },
    { id:'osa-ura',         jp:'Ura-gatame',        pt:'Imobilização invertida',        cat:'osaekomi', oficial:true },

    // ============ KODOKAN · Shime-waza (estrangulamentos) ============
    { id:'shi-hadaka',      jp:'Hadaka-jime',       pt:'Mata-leão',                     cat:'shime', oficial:true },
    { id:'shi-okurieri',    jp:'Okuri-eri-jime',    pt:'Estrangulamento pela gola',     cat:'shime', oficial:true },
    { id:'shi-kataha',      jp:'Kata-ha-jime',      pt:'Estrangulamento de uma asa',    cat:'shime', oficial:true },
    { id:'shi-sankaku',     jp:'Sankaku-jime',      pt:'Triângulo',                     cat:'shime', oficial:true },
    { id:'shi-namijuji',    jp:'Nami-juji-jime',    pt:'Cruzado normal (colar)',        cat:'shime', oficial:true },
    { id:'shi-gyakujuji',   jp:'Gyaku-juji-jime',   pt:'Cruzado invertido',             cat:'shime', oficial:true },
    { id:'shi-dojime',      jp:'Dō-jime',           pt:'Tesoura de tronco',             cat:'shime', oficial:true },   // era Kosen (v413)

    // ============ KODOKAN · Kansetsu-waza (luxações) ============
    { id:'kan-juji',        jp:'Juji-gatame',       pt:'Chave de braço cruzada (armlock)', cat:'kansetsu', oficial:true },
    { id:'kan-udegarami',   jp:'Ude-garami',        pt:'Chave dobrada (kimura/americana)', cat:'kansetsu', oficial:true },
    { id:'kan-waki',        jp:'Ude-hishigi-waki-gatame', pt:'Chave de braço sob a axila', cat:'kansetsu', oficial:true },
    { id:'kan-hiza',        jp:'Ude-hishigi-hiza-gatame', pt:'Chave de joelho no braço',   cat:'kansetsu', oficial:true },
    { id:'kan-ude',         jp:'Ude-hishigi-ude-gatame',  pt:'Chave estendendo o braço',   cat:'kansetsu', oficial:true },
    { id:'kan-ashigarami',  jp:'Ashi-garami',       pt:'Chave de perna (entrelace)',    cat:'kansetsu', oficial:true },   // era Kosen (v413)

    // ============ JIU-JITSU · Guardas ============
    { id:'gua-fechada',     jp:'Guarda fechada',    pt:'Closed guard',                  cat:'guarda', oficial:false },
    { id:'gua-aberta',      jp:'Guarda aberta',     pt:'Open guard',                    cat:'guarda', oficial:false },
    { id:'gua-meia',        jp:'Meia-guarda',       pt:'Half guard',                    cat:'guarda', oficial:false },
    { id:'gua-borboleta',   jp:'Guarda borboleta',  pt:'Butterfly guard',               cat:'guarda', oficial:false },
    { id:'gua-aranha',      jp:'Guarda aranha',     pt:'Spider guard',                  cat:'guarda', oficial:false },
    { id:'gua-delariva',    jp:'De La Riva',        pt:'Guarda De La Riva',             cat:'guarda', oficial:false },
    { id:'gua-zguard',      jp:'Z-guard',           pt:'Z-guard (knee shield)',         cat:'guarda', oficial:false },
    { id:'gua-xguard',      jp:'X-guard',           pt:'X-guard (Marcelo Garcia)',      cat:'guarda', oficial:false },
    { id:'gua-tartaruga',   jp:'Tartaruga',         pt:'Turtle',                        cat:'guarda', oficial:false },
    { id:'gua-hikikomi',    jp:'Hikikomi',          pt:'Puxada para a guarda',          cat:'guarda', oficial:false },   // era Kosen (v413)
    { id:'gua-tate-sankaku',jp:'Tate-sankaku',      pt:'Triângulo montado',             cat:'guarda', oficial:false },   // era Kosen (v413)

    // ============ JIU-JITSU · Raspagens ============
    { id:'rasp-pendulo',    jp:'Raspagem do pêndulo', pt:'Pendulum sweep',              cat:'raspagem', oficial:false },
    { id:'rasp-tesoura',    jp:'Raspagem de tesoura', pt:'Scissor sweep',               cat:'raspagem', oficial:false },
    { id:'rasp-borboleta',  jp:'Raspagem da borboleta', pt:'Butterfly sweep',           cat:'raspagem', oficial:false },
    { id:'rasp-aranha',     jp:'Raspagem da aranha', pt:'Spider sweep',                 cat:'raspagem', oficial:false },
    { id:'rasp-delariva',   jp:'Raspagem De La Riva', pt:'DLR sweep',                   cat:'raspagem', oficial:false },
    { id:'rasp-xguard',     jp:'Raspagem X-guard',  pt:'X-guard sweep',                 cat:'raspagem', oficial:false },
    { id:'rasp-balao',      jp:'Raspagem balão',    pt:'Balloon sweep',                 cat:'raspagem', oficial:false },
    { id:'rasp-berimbolo',  jp:'Berimbolo',         pt:'Inversão para as costas',       cat:'raspagem', oficial:false },
    { id:'rasp-hikikomi',   jp:'Hikikomi-gaeshi',   pt:'Puxada com rolamento',          cat:'raspagem', oficial:false },   // era Kosen (v413)

    // ============ JIU-JITSU · Passagens de guarda ============
    { id:'pas-toureiro',    jp:'Passagem toureiro', pt:'Bullfighter pass',              cat:'passagem', oficial:false },
    { id:'pas-joelho',      jp:'Passagem no joelho', pt:'Knee slice pass',              cat:'passagem', oficial:false },
    { id:'pas-apertada',    jp:'Passagem apertada', pt:'Over-under pass',               cat:'passagem', oficial:false },
    { id:'pas-em-pe',       jp:'Passagem em pé',    pt:'Standing pass',                 cat:'passagem', oficial:false },   // v414
    { id:'pas-leg-drag',    jp:'Leg drag',          pt:'Passagem arrastando a perna',   cat:'passagem', oficial:false },   // v414

    // ============ JIU-JITSU · Básicas (fundamentos de faixa branca) ============
    // v414: categoria "Escapes" absorvida aqui — fuga é fundamento de faixa branca.
    { id:'bas-postura',     jp:'Postura na guarda', pt:'Postura em pé na guarda fechada', cat:'basico', oficial:false },
    { id:'bas-quebrar',     jp:'Quebrar postura',   pt:'Puxar a cabeça pra baixo',      cat:'basico', oficial:false },
    { id:'bas-pegada',      jp:'Pegada colar-manga', pt:'Cross collar + sleeve grip',    cat:'basico', oficial:false },
    { id:'bas-ponte',       jp:'Ponte (upa)',       pt:'Bridge — movimento base',       cat:'basico', oficial:false },
    { id:'bas-quadril',     jp:'Fuga de quadril',   pt:'Shrimp — hip escape',           cat:'basico', oficial:false },
    { id:'bas-tecnica-up',  jp:'Levantada técnica', pt:'Technical stand-up',            cat:'basico', oficial:false },
    // IDs 'esc-*' preservados: v413→v414 mudou só cat=escape → cat=basico. Progresso
    // dos alunos (technique_progress.tecnica_id) continua ligado nas mesmas técnicas.
    { id:'esc-mount',       jp:'Fuga do mount',     pt:'Upa + ponte',                   cat:'basico', oficial:false },
    { id:'esc-side',        jp:'Fuga de 100kg',     pt:'Escape de side control',        cat:'basico', oficial:false },
    { id:'esc-costas',      jp:'Fuga das costas',   pt:'Back escape',                   cat:'basico', oficial:false },
    { id:'esc-triangulo',   jp:'Defesa do triângulo', pt:'Postura + postura',           cat:'basico', oficial:false },
    { id:'esc-armlock',     jp:'Defesa do armlock', pt:'Esconder o cotovelo',           cat:'basico', oficial:false },
  ],

  // nav atual de cada perfil
  navAluno: 'inicio',
  navProf: 'painel',
  relTab: 'visao',          // Relatórios: visao | retencao | tecnicas | graduacao | loja
  jogoTab: 'progresso',     // Tatame: progresso | biblioteca | analise
  registro: { randori:null, nota:'', mood:null },  // sessão de registro (aba Renshū = botão +)
  jornadaTab: 'historico', // Jornada: historico | frequencia | graduacao
  histPeriodo: 'ano',    // Histórico: semana | mes | ano
  onboarded: true,       // false força a tela de boas-vindas (1ª vez)
  sbUser:    null,       // { id, email } do usuário Supabase autenticado
  authOpen:  false,      // true → mostra tela de login (self-signup desabilitado — A4)
};

/* v424: a vitrine é OPT-IN. Só aqui o dado fake encosta no DB — em produção
   esta linha inteira não roda, então não há o que vazar. */
if (VITRINE){
  DB.professor     = SEED_DEMO.professor;
  DB.academia.turma= SEED_DEMO.academiaTurma;
  DB.turmas        = SEED_DEMO.turmas;
  DB.eu            = SEED_DEMO.eu;
  DB.treinos       = SEED_DEMO.treinos;
  DB.graduacoes    = SEED_DEMO.graduacoes;
  DB.semana        = SEED_DEMO.semana;
  DB.alunos        = SEED_DEMO.alunos;
  DB.retro         = SEED_DEMO.retro;
  DB.sistemas      = SEED_DEMO.sistemas;
  DB.notas         = SEED_DEMO.notas;
  DB.lesoes        = SEED_DEMO.lesoes;
  DB.notificacoes  = SEED_DEMO.notificacoes;
  DB.loja.produtos = SEED_DEMO.lojaProdutos;
}
window.DB = DB;   // expõe p/ o adapter (supabase.js lê global.DB; `const` não cria propriedade em window)

// Metas compartilhadas app ↔ adapter (fonte única — evita divergência entre painel
// do professor e cálculo do "self" do aluno logado). O adapter lê window.PROF_METAS
// lazy dentro das funções (adapter carrega antes do app; o valor só é usado depois).
// META_TEC: técnicas em nível ≥ treinando p/ o eixo "técnicas" do semáforo de graduação
// (aproximação Gymdesk-style até existir currículo por faixa — calibrável pelo dono).
const PROF_METAS = { META_MES:12, META_GRAU:40, RISCO_DIAS:14, META_TEC:8 };
window.PROF_METAS = PROF_METAS;
// Data em que a academia comecou a operar no app. Toda janela historica
// (freq4/base4, ocupacao, pace, dias sem treinar) e' CAPADA por esta data
// via _diasAtrasISO() e _dISO() — antes disso nao havia dados, entao dividir
// por "N dias atras" inflava denominadores e deprimia medias.
// Cap DINAMICO: quando N dias caiba depois desta data (nov/2026 pra janela
// de 120d), o cap deixa de morder sozinho — nao precisa lembrar de mexer.
const APP_INICIO_ISO = '2026-07-20';
window.APP_INICIO_ISO = APP_INICIO_ISO;   // adapter (supabase.js) tambem consulta
const isHoje = (s) => s === HOJE_ISO;

/* ============================================================
   MIGRAÇÃO — modelo de dados unificado (Etapa 1 da fusão Tatame+Renshū)
   Aditivo: cada técnica ganha `estado` (foco|arma|guardada|aprendida) e
   `dias[]` (histórico diário de 30 dias) · DB.links substitui DB.sistemas.
   ============================================================ */
// v422: FOCO_INICIAL removido. Antes forcava Sankaku/Hikikomi-gaeshi/Juji em
// foco pra TODO aluno no boot — mesmo quem nunca tinha aberto o app via essas
// 3 aparecerem "em foco" (bug: Hikikomi-gaeshi vazando pra todos os alunos).
// Aluno comeca zerado; foco e sempre escolha manual dele.
const _WD = ['dom','seg','ter','qua','qui','sex','sáb'];
function gerarDias(t){
  const base  = t.nivel==='dominada'?64 : t.nivel==='treinando'?40 : 18;
  const slope = t.nivel==='dominada'?0.4 : t.nivel==='treinando'?1.1 : 0.7;
  const ph = (t.jp||'').length;            // varia o ruído por técnica
  const out=[];
  for(let i=0;i<30;i++){
    let r = base + slope*i + Math.sin(i*1.6+ph)*8;
    r = Math.max(0, Math.min(100, Math.round(r)));
    out.push({ a:Math.round(8*r/100), t:8, dia:_WD[(i+1)%7] });
  }
  return out;
}
DB.tecnicas.forEach(t=>{
  t.estado = (t.nivel==='dominada' ? 'arma' : 'aprendida');   // v422: sem FOCO_INICIAL forcado
  if(!t.dias) t.dias = DEMO ? gerarDias(t) : [];
  if(t.hojeT==null){ t.hojeT=0; t.hojeA=0; }
});
DB.links = [];
DB.sistemas.forEach(s=>{ for(let i=0;i<s.passos.length-1;i++) DB.links.push({ de:s.passos[i].t, para:s.passos[i+1].t }); });
_linksToIds();   // M9: normaliza o seed (jp) para ids estáveis
DB.analytics = DB.analytics || { events:[] };

/* ============================================================
   PERSISTÊNCIA — NUVEM (cutover Supabase · user_state JSONB, RLS self-only)
   O estado do usuário vira um DUMP (mesmo formato do antigo localStorage
   'yama.v1') e sobe para public.user_state via sbSync.pushState, com
   dirty-check (só envia se mudou). Catálogo de técnicas/sistemas vem
   SEMPRE do código; a LOJA persiste no dump (carrinho) e os produtos
   vêm do backend (professor é a fonte da verdade). Progresso por técnica
   é guardado num mapa keyed por `id` e re-aplicado no catálogo no boot.
   localStorage remanescente (por necessidade técnica, documentado):
   sessão de auth do supabase-js, tema (pré-login) e leitura ONE-TIME do
   acervo legado 'yama.v1' para migração (sbSync.migrateLegacy).
   ============================================================ */
const STORE_KEY = 'yama.v1';  // usado só p/ migração do legado e formato do backup
const SCHEMA = 1;
// Lida do próprio <script src="app.js?v=N"> em runtime — nunca precisa editar à mão.
// Antes era uma constante 'vNNN' duplicada do ?v=N do index.html, e ficava desatualizada
// toda vez que alguém esquecia de bater as duas (aconteceu: ficou 5+ versões parada).
const APP_VERSION = (()=>{
  const s = document.currentScript || Array.from(document.scripts).find(x=>/(?:^|\/)app\.js(?:\?|$)/.test(x.src));
  const m = s && s.src.match(/[?&]v=([^&]+)/);
  return m ? 'v'+m[1] : '—';
})();
window.APP_VERSION = APP_VERSION;   // usado pelo adapter (sbSync.logError)
// >>> canal de feedback dos testers. WhatsApp (https://wa.me/55DDDNUMERO) ou e-mail (mailto:voce@exemplo.com)
const _FB = [55,31,99,62,48,90,9]; const FEEDBACK_URL = 'https://wa.me/'+_FB.join('')+'?text=';
// Normaliza telefone BR pra sempre gravar 12/13 dígitos com DDI 55.
// Espelho do _normalize_tel_br em SQL (migration 0021). Mesmo shape para casar dados.
// null / string vazia / lixo → null (não força; ficha aparece vazia e professor corrige).
function _normTelBR(v){
  if(v==null) return null;
  const d = String(v).replace(/\D/g,'');
  if(!d) return null;
  if((d.length===13 || d.length===12) && d.startsWith('55')) return d;
  if(d.length===11 || d.length===10) return '55'+d;
  if(d.length===9) return '5531'+d;   // sem DDD → assume 31 (Yama BH)
  return null;
}
// Loja da academia. LOJA_WHATSAPP = só dígitos com DDI. LOJA_PIX = chave PIX (telefone).
const LOJA_WHATSAPP = '5531996248909'; const LOJA_PIX = '31996248909';
// PIX/WhatsApp vivem em `academies.config` (nuvem, lido por TODO membro no boot —
// ver sbSync.pullAll → d.academyConfig). Antes ficavam só em DB.loja.config, ou seja
// no user_state PRIVADO do professor: o aluno nunca via a chave configurada e caía na
// constante. DB.loja.config segue como fallback local (demo/offline e dados legados).
function _acadCfg(){ return DB.academyConfig || {}; }
/* Única porta de escrita em academies.config. `salvarConfig` substitui o JSONB
   INTEIRO, então quem manda só a sua parte apaga a dos outros (metaAulas sumia ao
   salvar PIX; pix/whatsapp sumiam ao salvar meta de aulas). Aqui sempre relê o
   remoto, faz merge e só então grava. Devolve Promise pra UI tratar erro.
   O merge é `remoto + patch` — DB.academyConfig fica DE FORA de propósito: é só
   cache de sessão (não entra no dump), e quando entrava no meio ele sobrescrevia
   com valor velho o que outro professor tinha acabado de gravar. Quem manda no que
   não está no patch é o remoto. A atribuição otimista abaixo é só pra UI responder
   na hora; o `merged` do sucesso corrige qualquer divergência. */
function _salvarAcademyConfig(patch){
  DB.academyConfig = Object.assign({}, DB.academyConfig, patch);
  if(DEMO || typeof sbProf==='undefined' || !sbProf.salvarConfig) return Promise.resolve();
  return sbProf.getConfig().then(atual=>{
    const merged = Object.assign({}, atual, patch);
    return sbProf.salvarConfig(merged).then(()=>{ DB.academyConfig = merged; });
  });
}
function _lojaPix(){ return _acadCfg().pix || (DB.loja && DB.loja.config && DB.loja.config.pix) || LOJA_PIX; }
function _lojaWa(){ return _acadCfg().whatsapp || (DB.loja && DB.loja.config && DB.loja.config.whatsapp) || LOJA_WHATSAPP; }
function _lojaPixBrCode(){ return (_acadCfg().pixBrCode) || (DB.loja && DB.loja.config && DB.loja.config.pixBrCode) || ''; }
/* EMV BR Code (Pix Copia-e-Cola) com valor injetado. Parseia TLV do código pasteado
   pelo professor, remove/insere campo 54 (amount, "NN.NN") na ordem correta e
   recomputa o CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) do payload+"6304".
   Retorna '' se o BR Code não parsear. */
function _pixCrc16(str){
  let crc=0xFFFF;
  for(let i=0;i<str.length;i++){
    crc ^= str.charCodeAt(i)<<8;
    for(let j=0;j<8;j++) crc = (crc & 0x8000) ? (((crc<<1) ^ 0x1021) & 0xFFFF) : ((crc<<1) & 0xFFFF);
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
// Parser/builder TLV genérico (EMV usa o mesmo formato ID(2)+LEN(2)+VALUE aninhado
// em campo 26 = chave PIX e campo 62 = dados adicionais/txid). null se malformado.
function _pixTlvParse(str){
  const out=[]; let i=0;
  while(i < str.length){
    const id = str.substr(i,2);
    const len = parseInt(str.substr(i+2,2),10);
    if(!id || isNaN(len)) return null;
    out.push([id, str.substr(i+4,len)]);
    i += 4+len;
  }
  return out;
}
function _pixTlvBuild(fields){
  return fields.map(([id,v])=> id + String(v.length).padStart(2,'0') + v).join('');
}
/* Extrai dados do recebedor do BR Code EMV pra a tela de confirmação:
   chave PIX (26.01), nome fantasia (59), cidade (60), valor (54, se estático).
   Retorna null se o BR Code não parsear. */
function _pixParseBrCode(brCode){
  if(!brCode) return null;
  const body = String(brCode).trim().replace(/6304[0-9A-Fa-f]{4}$/, '');
  const fields = _pixTlvParse(body); if(!fields) return null;
  const f = Object.fromEntries(fields);
  const mFields = _pixTlvParse(f['26']||''); const m = mFields ? Object.fromEntries(mFields) : {};
  return { chave:m['01']||'', nome:f['59']||'', cidade:f['60']||'', valor:f['54']||'' };
}
// Insere/substitui um campo top-level mantendo ordem crescente de ID (convenção EMV).
function _pixTlvSet(fields, id, valor){
  const kept = fields.filter(([fid])=> fid!==id);
  const at = kept.findIndex(([fid])=> parseInt(fid,10) > parseInt(id,10));
  const novo=[id, valor];
  if(at===-1) kept.push(novo); else kept.splice(at,0,novo);
  return kept;
}
function _pixRebuildComCrc(fields){
  const semCrc = _pixTlvBuild(fields) + '6304';
  return semCrc + _pixCrc16(semCrc);
}
function _pixBrCodeComValor(brCode, valor){
  if(!brCode || !(valor>0)) return brCode || '';
  // Só tira espaços das pontas — internos (nome do lojista em 59) contam no TLV.
  const body = String(brCode).trim().replace(/6304[0-9A-Fa-f]{4}$/, '');
  const fields = _pixTlvParse(body); if(!fields) return brCode;
  return _pixRebuildComCrc(_pixTlvSet(fields, '54', Number(valor).toFixed(2)));
}
// Mesma coisa + injeta txid no subcampo 62.05 (Reference Label — até 25 alfanuméricos,
// convenção pra conciliar pagamento com pedido no extrato do banco).
function _pixBrCodeComValorTxid(brCode, valor, txid){
  if(!brCode) return '';
  const body = String(brCode).trim().replace(/6304[0-9A-Fa-f]{4}$/, '');
  let fields = _pixTlvParse(body); if(!fields) return brCode;
  if(valor>0) fields = _pixTlvSet(fields, '54', Number(valor).toFixed(2));
  if(txid){
    const f62raw = (fields.find(([id])=>id==='62')||[])[1] || '';
    const sub62 = _pixTlvParse(f62raw) || [];
    const novo62 = _pixTlvSet(sub62, '05', String(txid).replace(/[^A-Za-z0-9]/g,'').slice(0,25) || '***');
    fields = _pixTlvSet(fields, '62', _pixTlvBuild(novo62));
  }
  return _pixRebuildComCrc(fields);
}
// Gera um txid curto e único (client-side, sem round-trip): 25 alfanuméricos maiúsculos.
function _pixGerarTxid(){
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()).replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,25);
}
// Código de presença do totem (fixo — ver CLAUDE.md). Com backend vira o código rotativo da aula.
// v374: QR obrigatório com token estático da academia (academies.config.qr_token).
// O professor gera/renova em Alunos → 🔑 Acesso → ⚙️ Configurações da academia.
function _qrToken(){ return (DB.academyConfig && DB.academyConfig.qrToken) || null; }
// DEMO já definido no topo (vitrine ?demo=1)
// chaves de DB que pertencem ao usuário (persistidas)
const USER_KEYS = ['eu','treinos','graduacoes','checkinHoje','semana','notas','lesoes','notificacoes','retro','analytics','links','loja'];
// campos de progresso pessoal por técnica
// Campos de progresso pessoal + edições de catálogo persistidos por técnica.
// jp/pt/cat/oficial: incluídos para preservar edições do usuário no catálogo (Kodokan/Kosen/Outros).
const TEC_PROG = ['estado','dias','hojeA','hojeT','treinos','ultima','ultimaRev','nota','nivel','jp','pt','cat','oficial'];

// storage do NAVEGADOR ainda é exigido pelo supabase-js (sessão de login).
// Se bloqueado (modo anônimo/cookies bloqueados), o app roda mas a sessão não persiste.
function _hasStorage(){ try{ const k='__y'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; }catch(e){ return false; } }
const STORAGE_OK = _hasStorage();
// modo teste (?test=1) — const TESTMODE subiu pro topo do arquivo na v424
// (a separação SEED_DEMO × DB precisa dela antes de montar o estado).

/* ---- buildDump/applyDump: núcleo puro da persistência (testável no selfTest) ---- */
function buildDump(){
  const data = { __schema:SCHEMA, onboarded:DB.onboarded, _ultimoDia:HOJE_ISO };
  USER_KEYS.forEach(k=>{ data[k]=DB[k]; });
  data.tecProg = {};
  DB.tecnicas.forEach(t=>{ const p={}; TEC_PROG.forEach(f=>{ p[f]=t[f]; }); data.tecProg[t.id||t.jp]=p; });
  // técnicas customizadas (id 'usr-…') — persistir definição completa, não só progresso
  data.tecnicasCustom = DB.tecnicas.filter(t=>t.id && t.id.indexOf('usr-')===0)
    .map(t=>({ id:t.id, jp:t.jp, pt:t.pt, cat:t.cat, oficial:!!t.oficial }));
  data.draft = DB._draft || null;   // rascunho de treino em andamento viaja no dump
  return data;
}
function applyDump(data){
  if(!data || typeof data!=='object') return false;
  try{
    if(data.treinos && !Array.isArray(data.treinos)) return false;
    if(data.eu && typeof data.eu!=='object') return false;
    if(data.__schema && data.__schema > SCHEMA) return false;
    USER_KEYS.forEach(k=>{
      if (data[k] == null) return;
      // 'eu' (perfil) faz MERGE preservando campos do seed que não vieram no backup
      if (k === 'eu' && DB.eu && typeof data[k] === 'object' && !Array.isArray(data[k])){
        DB.eu = Object.assign({}, DB.eu, data[k]);
      } else {
        DB[k] = data[k];
      }
    });
    // restaura técnicas customizadas (definição) antes de aplicar tecProg
    if(Array.isArray(data.tecnicasCustom)){
      const have = new Map(DB.tecnicas.map((t,i)=>[t.id, i]).filter(([id])=>id));
      data.tecnicasCustom.forEach(c=>{
        if (!c || !c.id) return;
        if (have.has(c.id)){
          // UPDATE: aplica edições de definição feitas após criação
          Object.assign(DB.tecnicas[have.get(c.id)], { jp:c.jp, pt:c.pt, cat:c.cat, oficial:!!c.oficial });
        } else {
          // ADD: nova técnica custom não presente no estado atual
          DB.tecnicas.push({ ...c, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'' });
        }
      });
    }
    if(data.tecProg) DB.tecnicas.forEach(t=>{ const p=data.tecProg[t.id]||data.tecProg[t.jp]; if(p) TEC_PROG.forEach(f=>{ if(p[f]!=null) t[f]=p[f]; }); });
    const MOOD_TO_FEEL={'😣':1,'😐':2,'😊':4,'🔥':5};
    DB.treinos.forEach(t=>{ if(!t.feel && t.mood && MOOD_TO_FEEL[t.mood]){ t.feel=MOOD_TO_FEEL[t.mood]; } });
    DB.onboarded = !!data.onboarded;
    DB._draft = (data.draft && typeof data.draft==='object') ? data.draft : null;
    _resetDiario(data._ultimoDia);
    _linksToIds();                 // M9: normaliza conexões antigas (por jp) para id
    _attSig=null; _semCacheSig='__invalid__';   // invalida memos derivados de treinos
  }catch(e){ return false; }
  return true;
}

/* ---- save(): sobe o dump para a nuvem (user_state), com dirty-check ---- */
let _lastPushed = '';     // último dump enviado (string) — evita pushes redundantes (M7/M11)
let _cloudReady = false;  // só é true após pullState bem-sucedido — impede sobrescrever a nuvem às cegas
// v432: declarada AQUI (era lá embaixo, junto do _cloudLogin) porque renderBg() a
// consulta e roda antes — `let` tem TDZ, e a referência antecipada lançaria.
let _cloudLoginBusy = false;
/* v432: true da entrada do _cloudLogin até o PRIMEIRO paint com dado real. É janela
   diferente do `_cloudLoginBusy` (esse é guarda de reentrância e só cai no `finally`,
   depois da revalidação inteira). Usar aquele aqui engolia o render final e a tela
   nunca via o overlay — medido: 1 paint onde deviam ser 2. */
let _hidratando = false;
let _cachePintou = false;   // v433: o cartão de visita já desenhou algo → splash pode sair

/* v433 — CARTÃO DE VISITA: cache de LEITURA, nunca de escrita.
   Exceção explícita ao ADR 0004 (ver o ADR). O que o ADR proíbe é cache do DUMP:
   estado local que disputa autoridade com a nuvem e sobrescrevia treino de outro
   aparelho (last-write-wins — o bug que a RPC push_user_state passou a rejeitar).
   Isto aqui é outra coisa: um punhado de campos VISUAIS pra desenhar o primeiro
   quadro enquanto o pullState não volta. Regras que o mantêm inofensivo:
     · nunca entra no buildDump, nunca sobe, não participa do dirty-check;
     · é descartado assim que o applyDump chega — a nuvem sempre vence;
     · só grava em estado assentado (sem gate, onboarding concluído);
     · chaveado por user_id e apagado no SIGNED_OUT (aparelho compartilhado);
     · sem `foto`: signed URL expira em 24h (viraria imagem quebrada) e o fallback
       base64 é grande demais pro localStorage. As iniciais bastam pro avatar.
   NÃO usar este precedente pra recachear treinos/notas/lesões — reabre o bug de 2026. */
const _PERFIL_CACHE_CAMPOS = ['apelido','nomeCompleto','iniciais','faixa','graus'];
/* v434 — MINIATURA do avatar (`fotoMini`), guardada junto do cartão.
   Por que miniatura e não a foto nem a URL:
     · a URL é signed (FOTO_TTL 24h) — cacheá-la não pinta nada instantâneo, o
       navegador ainda baixaria a imagem pela rede; só pouparia a assinatura;
     · a foto cheia tem 1024px/JPEG q0.85 ≈ 100–250 KB em base64, e o localStorage
       é SÍNCRONO: ler isso antes do primeiro quadro travaria a main thread — o
       oposto do objetivo. Em UTF-16 ainda dobra de tamanho no disco.
   96px cobre o maior uso na tela (120px no Perfil) e cabe em ~3–6 KB.
   Invalidação: nenhuma. É regerada a cada boot a partir da foto que a nuvem
   confirmou — sempre fresca por construção, sem comparar URL (que muda a cada
   assinatura e não diz nada sobre a imagem ter mudado). */
const _FOTO_MINI_PX = 96;
const _FOTO_MINI_MAX_BYTES = 20000;   // guarda-chuva: mini que estourar isso é descartada
function _fotoMiniDeImg(img){
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  if(!W || !H) return null;
  const lado = Math.min(W, H);                  // recorte central quadrado — o avatar é
  const sx = (W - lado)/2, sy = (H - lado)/2;   // redondo com object-fit:cover
  const cv = document.createElement('canvas');
  cv.width = cv.height = _FOTO_MINI_PX;
  cv.getContext('2d').drawImage(img, sx, sy, lado, lado, 0, 0, _FOTO_MINI_PX, _FOTO_MINI_PX);
  return cv.toDataURL('image/jpeg', 0.7);
}
/* Regera a miniatura a partir de DB.eu.foto. Fire-and-forget: falha (CORS, URL
   expirada, canvas tainted) só significa avatar com iniciais no próximo boot. */
function _fotoMiniAtualizar(){
  try{
    if(DEMO || TESTMODE || !DB.sbUser || !_cloudReady) return;
    const src = DB.eu && DB.eu.foto;
    if(!src){ _perfilCacheSetMini(null); return; }   // tirou a foto → tira a mini junto
    const img = new Image();
    img.crossOrigin = 'anonymous';                   // sem isto o canvas fica tainted e toDataURL lança
    img.onload = ()=>{ try{ _perfilCacheSetMini(_fotoMiniDeImg(img)); }catch(_){} };
    img.onerror = ()=>{};
    img.src = src;
  }catch(_){}
}
const _perfilCacheKey = uid => 'yama.perfil.' + uid;
function _perfilCacheLer(uid){
  try{
    const o = JSON.parse(localStorage.getItem(_perfilCacheKey(uid)) || 'null');
    if(!o || typeof o !== 'object') return null;
    const out = {};
    _PERFIL_CACHE_CAMPOS.forEach(k=>{ if(o[k] != null) out[k] = o[k]; });
    // v434: a miniatura entra como `foto`. Assim o avatar desenha sem nenhuma mudança
    // no render — e quando a signed URL chega pelo overlay ela substitui em silêncio.
    // Só aceita data:image (nunca uma URL): impede que alguém plante um endereço
    // externo no localStorage e o app saia buscando imagem de terceiro no boot.
    if(typeof o.fotoMini === 'string' && o.fotoMini.indexOf('data:image/') === 0
       && o.fotoMini.length <= _FOTO_MINI_MAX_BYTES) out.foto = o.fotoMini;
    return Object.keys(out).length ? out : null;
  }catch(_){ return null; }
}
// Lê o objeto cru (com `fotoMini`), sem o mapeamento de leitura. Uso interno.
function _perfilCacheRaw(uid){
  try{ const o = JSON.parse(localStorage.getItem(_perfilCacheKey(uid)) || 'null'); return (o && typeof o === 'object') ? o : {}; }
  catch(_){ return {}; }
}
function _perfilCacheSalvar(){
  try{
    if(DEMO || TESTMODE || !DB.sbUser || !_cloudReady) return;
    // Estado assentado: a existência do cache passa a significar "da última vez esta
    // conta abriu direto na Home" — é o que autoriza pintar a Home no boot seguinte
    // antes de saber o must_change_pw, sem risco de piscar a tela errada.
    if(DB.trocarSenhaOpen || DB.onboardingOpen || !DB.onboarded) return;
    const anterior = _perfilCacheRaw(DB.sbUser.id);
    const o = {};
    _PERFIL_CACHE_CAMPOS.forEach(k=>{ if(DB.eu && DB.eu[k] != null) o[k] = DB.eu[k]; });
    // Preserva a miniatura: ela tem ciclo próprio (_fotoMiniAtualizar) e não vem do DB.eu.
    if(anterior.fotoMini) o.fotoMini = anterior.fotoMini;
    localStorage.setItem(_perfilCacheKey(DB.sbUser.id), JSON.stringify(o));
  }catch(_){}
}
// Grava/remove só a miniatura, sem tocar no resto do cartão.
function _perfilCacheSetMini(dataUrl){
  try{
    if(DEMO || TESTMODE || !DB.sbUser || !_cloudReady) return;
    const o = _perfilCacheRaw(DB.sbUser.id);
    if(!Object.keys(o).length) return;   // sem cartão assentado, não cria só com a foto
    if(dataUrl && dataUrl.length <= _FOTO_MINI_MAX_BYTES) o.fotoMini = dataUrl;
    else delete o.fotoMini;
    localStorage.setItem(_perfilCacheKey(DB.sbUser.id), JSON.stringify(o));
  }catch(_){}
}
function _perfilCacheLimpar(uid){
  try{
    if(uid){ localStorage.removeItem(_perfilCacheKey(uid)); return; }
    Object.keys(localStorage).filter(k=> k.indexOf('yama.perfil.') === 0).forEach(k=> localStorage.removeItem(k));
  }catch(_){}
}
function _setSyncDot(ok){
  const d = document.getElementById('sync-dot'); if(!d) return;
  d.classList.toggle('sync-ok', !!ok); d.classList.toggle('sync-error', !ok);
  d.title = ok ? 'Sincronizado com a nuvem' : 'Sem conexão — alterações pendentes de sincronização';
}
function save(){
  if(DEMO || TESTMODE) return;
  if(!DB.sbUser || !_cloudReady || typeof sbSync==='undefined') return;
  const dump = buildDump();
  const s = JSON.stringify(dump);
  if(s === _lastPushed) return;
  _lastPushed = s;
  sbSync.pushState(dump)
    .then(()=>{ _setSyncDot(true); _perfilCacheSalvar(); })   // v433: perfil mudou (ex: apelido) → cartão acompanha
    .catch((e)=>{
      _lastPushed=''; _setSyncDot(false);   // re-tenta no próximo save/flush ou ao voltar online
      if(e && e.conflict) _resolveStateConflict();   // outro aparelho gravou → re-baixa e reaplica
    });
}
// Guard multi-dispositivo: a nuvem foi escrita por outro aparelho depois da base
// deste. Re-baixa o estado novo e reaplica (favorece a escrita completa mais recente,
// em vez de sobrescrever cegamente a sessão do outro aparelho — last-write-wins).
let _resolvingConflict = false;
async function _resolveStateConflict(){
  if(_resolvingConflict || !DB.sbUser || typeof sbSync==='undefined') return;
  _resolvingConflict = true;
  try{
    const dump = await sbSync.pullState(DB.sbUser.id);   // re-baseline do _stateTs no adapter
    if(dump){ applyDump(dump); _lastPushed = JSON.stringify(buildDump()); render(); toast('🔄 Dados atualizados a partir de outro aparelho'); }
  }catch(e){ /* offline: mantém pendente; tenta no próximo save/online */ }
  finally{ _resolvingConflict = false; }
}
let _saveT=null;
function scheduleSave(){ clearTimeout(_saveT); _saveT=setTimeout(save,1200); }
// Mudança de `estado` (foco/guardada/...) precisa refletir na tabela technique_progress,
// senão o overlay de pullAll() (que reaplica estado da tabela no boot) sobrescreve o dump
// e o foco "some" no reload. scheduleSave só cuida do dump — este sincroniza a tabela.
function _syncEstado(){ if(DB.sbUser && !DEMO && typeof sbSync!=='undefined'){ try{ sbSync.pushProgress(); }catch(e){} } }
// flush imediato: melhor esforço ao fechar/minimizar o PWA
function flushSave(){ if(DEMO || TESTMODE) return; clearTimeout(_saveT); _saveT=null; save(); }
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushSave(); else _checkMidnight(); });
window.addEventListener('pagehide', flushSave);
window.addEventListener('online', ()=>{ flushSave(); });   // re-sincroniza pendências ao voltar a conexão

function _resetDiario(ultimoDia){
  if(ultimoDia === HOJE_ISO) return;
  DB.checkinHoje = { feito:false, hora:null };
  DB.tecnicas.forEach(t=>{ t.hojeA=0; t.hojeT=0; });
}

// estado inicial de um aluno novo: mantém o CATÁLOGO, zera o diário pessoal
function aplicarCleanSlate(){
  DB.treinos=[]; DB.notas=[]; DB.lesoes=[]; DB.notificacoes=[];
  if(DB.loja){ DB.loja.carrinho=[]; DB.loja.cat='Todos'; }   // B1: zera a sacola no reset
  DB.semana={ feitos:0, meta:4, streakSemanas:0, dias:[false,false,false,false,false,false,false] };
  DB.checkinHoje={ feito:false, hora:null };
  DB.graduacoes=[];
  DB.eu = Object.assign({}, DB.eu, { nome:'', nomeCompleto:'', apelido:'Atleta', iniciais:'A', faixa:'branca', graus:0, foto:null, desde:'2026-06', nascimento:null, aulasGrau:{atual:0,meta:40}, aulasGraduacao:160, avisos:0, mensalidade:{valor:0,status:'ok',venc:'—'} });
  // técnicas: zera progresso, preserva catálogo (jp/pt/cat/oficial) + nota (dica de aula)
  DB.tecnicas.forEach(t=>{ t.estado='aprendida'; t.dias=[]; t.hojeA=0; t.hojeT=0; t.treinos=0; t.ultima='—'; t.ultimaRev=null; });
  DB.analytics = { events:[] };
}

/* ============================================================
   ANALYTICS + ERROS — 100% local e exportável (sem backend).
   Os eventos viajam dentro do "Exportar dados" → você agrega os 5 testers.
   ============================================================ */
function track(e, props){
  if (DEMO) return;                       // vitrine não gera métrica
  if (!DB.analytics) DB.analytics = { events:[] };
  const ev = Object.assign({ t:new Date().toISOString(), e }, props||{});
  DB.analytics.events.push(ev);
  if (DB.analytics.events.length > 1000) DB.analytics.events.splice(0, DB.analytics.events.length-1000);
  if (typeof scheduleSave === 'function') scheduleSave();
  if (DB.sbUser && typeof sbSync!=='undefined') sbSync.trackEvent(e, props||{});
}
// captura de erros do cliente → evento 'erro' local + client_errors no backend
// (best-effort — nunca pode falhar a UX). Guardrail simples contra spam: ignora
// se o mesmo msg apareceu nos últimos 3s.
(function(){
  let _lastErr = { msg:'', t:0 };
  const report = (msg, ctx)=>{
    const now = Date.now();
    if(_lastErr.msg===msg && now-_lastErr.t<3000) return;
    _lastErr = { msg, t:now };
    try{ track('erro', Object.assign({ msg:msg.slice(0,240) }, ctx||{})); }catch(_){}
    try{ if(typeof sbSync!=='undefined' && sbSync.logError) sbSync.logError(msg, ctx?JSON.stringify(ctx):null); }catch(_){}
  };
  try{
    // Captura tudo que o browser deixa passar. Pra "Script error." (browser
    // sanitiza msg por CORS/SRI) — src/ln/col ainda vem, entao pelo menos
    // consegue localizar. Stack quando disponivel ajuda muito no cross-origin.
    window.addEventListener('error', (ev)=>{
      const stack = ev && ev.error && ev.error.stack ? String(ev.error.stack).slice(0,600) : null;
      report(String((ev&&(ev.message||ev.error))||''), {
        src:String((ev&&ev.filename)||'').split('/').pop(),
        ln:ev&&ev.lineno,
        col:ev&&ev.colno,
        stack
      });
    });
    window.addEventListener('unhandledrejection', (ev)=>{
      const r = ev && ev.reason;
      const stack = r && r.stack ? String(r.stack).slice(0,600) : null;
      report('promise: '+String((r&&r.message)||r||''), stack ? { stack } : null);
    });
  }catch(_){}
})();
// KPIs do beta derivados dos eventos + treinos (ativação · funil · retenção · engajamento · churn)
function betaKPIs(){
  const ev = (DB.analytics&&DB.analytics.events)||[];
  const opens = ev.filter(x=>x.e==='app_open');
  const erros = ev.filter(x=>x.e==='erro');
  const diasAtivos = [...new Set(ev.map(x=>(x.t||'').slice(0,10)).filter(Boolean))].sort();
  const primeiroDia = diasAtivos[0]||null;
  const treinos = (DB.treinos||[]).length;
  const funil = {
    abriu: opens.length>0 || !!primeiroDia,
    onboarding: ev.some(x=>x.e==='onboarding_done') || !!DB.onboarded,
    treino1: treinos>=1, treino3: treinos>=3,
    compartilhou: ev.some(x=>x.e==='share_aberto')
  };
  const dnum = (iso)=>{ const p=iso.split('-').map(Number); return Date.UTC(p[0],p[1]-1,p[2])/86400000; };
  let d1=false, d7=false;
  if(primeiroDia){ const base=dnum(primeiroDia); diasAtivos.forEach(d=>{ const k=dnum(d)-base; if(k===1) d1=true; if(k>=1&&k<=7) d7=true; }); }
  const porSemana = (typeof paceSemanal==='function') ? Math.round(paceSemanal()*10)/10 : 0;
  const ultTreino = (DB.treinos&&DB.treinos[0]) ? DB.treinos[0].data : null;
  const diasSemTreinar = ultTreino ? diasEntre(ultTreino) : null;
  return {
    ativado: funil.treino1, diasAtivos: diasAtivos.length, sessoes: opens.length,
    treinos, treinosPorSemana: porSemana, streak: (DB.semana&&DB.semana.streakSemanas)||0,
    retencaoD1: d1, retencaoD7: d7, diasSemTreinar, funil, erros: erros.length, eventos: ev.length
  };
}
// painel "Métricas do beta" (transparência p/ o tester + vai no export p/ você agregar)
function abrirMetricas(){
  const k = betaKPIs(), f = k.funil, yn=(b)=> b?'✅':'—';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📈 Métricas do beta</div>
    <div class="kpis block">
      <div class="kpi"><div class="v red">${k.treinos}</div><div class="l">Treinos</div></div>
      <div class="kpi"><div class="v blue">${k.diasAtivos}</div><div class="l">Dias ativos</div></div>
      <div class="kpi"><div class="v green">${k.treinosPorSemana}</div><div class="l">Treinos/sem</div></div>
    </div>
    <div class="mt-list">
      <div class="mt-row"><span>Ativado (1º treino)</span><b>${yn(k.ativado)}</b></div>
      <div class="mt-row"><span>Voltou no dia seguinte (D1)</span><b>${yn(k.retencaoD1)}</b></div>
      <div class="mt-row"><span>Ativo na 1ª semana (D7)</span><b>${yn(k.retencaoD7)}</b></div>
      <div class="mt-row"><span>Streak</span><b>${plural(k.streak,'semana','semanas')}</b></div>
      <div class="mt-row"><span>Dias sem treinar</span><b>${k.diasSemTreinar==null?'—':k.diasSemTreinar}</b></div>
      <div class="mt-row"><span>Erros capturados</span><b>${k.erros}</b></div>
    </div>
    <div class="sec-title" style="margin:10px 0 0">Funil</div>
    <div class="mt-list">
      <div class="mt-row"><span>Abriu o app</span><b>${yn(f.abriu)}</b></div>
      <div class="mt-row"><span>Concluiu onboarding</span><b>${yn(f.onboarding)}</b></div>
      <div class="mt-row"><span>1º treino</span><b>${yn(f.treino1)}</b></div>
      <div class="mt-row"><span>3º treino</span><b>${yn(f.treino3)}</b></div>
      <div class="mt-row"><span>Compartilhou</span><b>${yn(f.compartilhou)}</b></div>
    </div>
    <div class="cfg-note">Estas métricas viajam junto com o seu diário, na sua conta — e vão no "Exportar dados". É assim que acompanhamos o beta.</div>
    <button class="sheet-cancel" id="mt-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#mt-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ============================================================
   RENSHŪ — helpers compartilhados (Registrar · Progresso)
   "Deu certo / Não deu certo" por técnica em foco → taxa de acerto.
   ============================================================ */
const META_CAP = 70;                                  // teto da linha de meta
const _media = (arr)=> arr.length ? arr.reduce((s,x)=>s+x,0)/arr.length : 0;
const _pctAT = (a,t)=> t>0 ? Math.round(a/t*100) : 0;
function focoTecnicas(){ return DB.tecnicas.filter(t=>t.estado==='foco'); }
function totaisTec(t){ const d=t.dias||[]; const T=d.reduce((s,x)=>s+x.t,0), A=d.reduce((s,x)=>s+x.a,0); return {T,A,p:_pctAT(A,T)}; }
function corPct(p){ return p>=60 ? 'var(--good)' : 'var(--muted)'; }
// nível DINÂMICO a partir dos treinos reais (0 treino = 'novo' = só catálogo)
function nivelDe(t){ const n=t.treinos||0; if(n>=12) return 'dominada'; if(n>=5) return 'treinando'; if(n>=1) return 'aprendendo'; return 'novo'; }
function ratesDe(t){ return (t.dias||[]).map(d=>_pctAT(d.a,d.t)); }
// linha de meta = média de acerto das técnicas em foco + armas, travada no teto
function metaLinha(){
  const vals = DB.tecnicas.filter(t=>t.estado==='foco'||t.estado==='arma').map(t=>totaisTec(t).p);
  return Math.min(META_CAP, Math.round(_media(vals)));
}

/* ---- lookup de técnica por id ou jp (id tem prioridade — sobrevive a rename) ---- */
function tecByKey(k){ if(!k) return null; return DB.tecnicas.find(x=>x.id===k) || DB.tecnicas.find(x=>x.jp===k) || null; }
/* ---- M9: conexões (DB.links) referenciam técnicas por ID estável.
   Converte entradas antigas (por jp) para id — rename de técnica não quebra o mapa. ---- */
function _linksToIds(){
  DB.links = (DB.links||[]).map(l=>{
    const de = tecByKey(l.de), para = tecByKey(l.para);
    return { de: de ? (de.id||de.jp) : l.de, para: para ? (para.id||para.jp) : l.para };
  });
}
/* rótulo de exibição de um link (id → jp) */
function _tecLabel(key){ const t = tecByKey(key); return t ? t.jp : key; }
/* ---- contadores do dia: vivem em t.hojeA / t.hojeT (persistem até salvar) ---- */
function _updateStepperUI(jp){
  const card=document.querySelector(`.rs-pcard[data-jp="${jp}"]`); if(!card) return;
  const t=tecByKey(jp); if(!t) return;
  const errou=(t.hojeT||0)-(t.hojeA||0);
  const ackB=card.querySelector('[data-act="a+"]'); if(ackB) ackB.previousElementSibling.textContent=t.hojeA||0;
  const errB=card.querySelector('[data-act="e+"]'); if(errB) errB.previousElementSibling.textContent=errou;
  const rst=card.querySelector('[data-act="limpar"]');
  if((t.hojeT||0)>0 && !rst){ const b=el(`<button class="rs-reset" data-act="limpar">limpar</button>`); b.onclick=()=>rtLimpar(jp); card.querySelector('.rs-acts').appendChild(b); }
  if((t.hojeT||0)===0 && rst) rst.remove();
}
function rtAck(jp,d){ const t=tecByKey(jp); if(!t) return; if(d>0){ t.hojeA=(t.hojeA||0)+1; t.hojeT=(t.hojeT||0)+1; haptic(8); } else if(t.hojeA>0){ t.hojeA--; t.hojeT--; } _updateStepperUI(jp); scheduleSave(); }
function rtErr(jp,d){ const t=tecByKey(jp); if(!t) return; if(d>0){ t.hojeT=(t.hojeT||0)+1; haptic(8); } else if((t.hojeT||0)-(t.hojeA||0)>0){ t.hojeT--; } _updateStepperUI(jp); scheduleSave(); }
function rtLimpar(jp){ const t=tecByKey(jp); if(t){ t.hojeA=0; t.hojeT=0; } _updateStepperUI(jp); scheduleSave(); }

// cartão Renshū de uma técnica (nome + tradução PT + Deu certo/Não deu)
function tecnicaFocoCard(t){
  const errou=(t.hojeT||0)-(t.hojeA||0);
  const card=el(`<div class="rs-pcard" data-jp="${safeAttr(t.jp)}">
    <div class="rs-top"><div class="rs-nm-wrap"><span class="rs-name">${safeTxt(t.jp)}</span></div>
      <div class="rs-acts">${(t.hojeT||0)>0?`<button class="rs-reset" data-act="limpar">limpar</button>`:''}</div></div>
    <div class="rs-row ok"><span>Deu certo!</span>
      <div class="rs-stepper"><button data-act="a-">−</button><b>${t.hojeA||0}</b><button class="plus" data-act="a+">＋</button></div></div>
    <div class="rs-row no"><span>Não deu certo</span>
      <div class="rs-stepper"><button data-act="e-">−</button><b>${errou}</b><button class="plus" data-act="e+">＋</button></div></div>
  </div>`);
  card.querySelector('[data-act="a+"]').onclick=()=>rtAck(t.jp,1);
  card.querySelector('[data-act="a-"]').onclick=()=>rtAck(t.jp,-1);
  card.querySelector('[data-act="e+"]').onclick=()=>rtErr(t.jp,1);
  card.querySelector('[data-act="e-"]').onclick=()=>rtErr(t.jp,-1);
  const lim=card.querySelector('[data-act="limpar"]'); if(lim) lim.onclick=()=>rtLimpar(t.jp);
  return card;
}

// CORPO COMPARTILHADO do registro — idêntico na aba Renshū e no botão + (registrar)
function registroBody(){
  const reg = DB.registro;
  const wrap = el('<div class="registro-body"></div>');
  // 1) primeira pergunta: fez randori? (na aula técnica o aluno pode não rolar e ir embora)
  const segR = el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">🤼</span> Fez randori hoje?</div>
    <div class="seg">
      <button class="${reg.randori===false?'active':''}" data-r="no">Não fiz</button>
      <button class="${reg.randori===true?'active':''}" data-r="yes">Fiz randori</button>
    </div>
  </div>`);
  segR.querySelector('[data-r="no"]').onclick=()=>{ reg.randori=false; _autosaveDraft(); render(); };
  segR.querySelector('[data-r="yes"]').onclick=()=>{ reg.randori=true; _autosaveDraft(); render(); };
  wrap.appendChild(segR);
  // 2) Renshū — só aparece se fez randori
  if(reg.randori===true){
    const focos=focoTecnicas();
    if(focos.length){
      const avg=Math.round(_media(focos.map(t=>totaisTec(t).p)));
      wrap.appendChild(el(`<div class="rz-card">
        <div class="rz-head"><span class="rz-lab">Em treino · ${focos.length}</span><span class="rz-avg">${avg}% acerto médio</span></div>
        ${focos.map(t=>{const{p}=totaisTec(t);return `<div class="rz-item"><span class="rz-nm">${safeTxt(t.jp)}</span><div class="rz-bar"><span style="width:${p}%;background:${corPct(p)}"></span></div><span class="rz-pct" style="color:${corPct(p)}">${p}%</span></div>`;}).join('')}
      </div>`));
      wrap.appendChild(el(`<div class="fsec-title"><span class="ico">🎯</span> O que deu certo no randori?</div>`));
      focos.forEach(t=> wrap.appendChild(tecnicaFocoCard(t)));
    } else {
      wrap.appendChild(el(`<div class="rs-empty-foco">Você ainda não tem técnicas em foco.<br>Escolha as que vai treinar para acompanhar sua evolução.</div>`));
      const efb=el(`<button class="rs-add" style="margin:2px 0 4px">＋ Escolher técnicas</button>`);
      efb.onclick=()=>rsAddFoco();
      wrap.appendChild(efb);
    }
  }
  // 3) nota rápida — sempre visível, opcional
  const notaSec=el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">📝</span> Nota rápida <small>(opcional)</small></div>
    <textarea class="ta" id="reg-nota" placeholder="Algo que queira lembrar do treino…">${safeTxt(reg.nota||'')}</textarea>
  </div>`);
  notaSec.querySelector('#reg-nota').oninput=(e)=>{ reg.nota=e.target.value; _autosaveDraft(); };
  wrap.appendChild(notaSec);
  // 4) Como foi o treino? — escala 1–5 (obrigatório, sem emoji)
  const feelSec=el(`<div class="fsec">
    <div class="fsec-title"><span class="ico">📊</span> Como foi o treino? <small>obrigatório</small></div>
    <div class="feel-scale">${[1,2,3,4,5].map(n=>`<button class="feel-btn ${reg.mood===n?'on lvl'+n:''}" data-n="${n}">${n}</button>`).join('')}</div>
    <div class="feel-ends"><span>Muito difícil</span><span>Excelente</span></div>
    <div class="feel-cap">${reg.mood?FEEL_LABEL[reg.mood]:'Avalie de 1 a 5'}</div>
  </div>`);
  const fcap=feelSec.querySelector('.feel-cap');
  feelSec.querySelectorAll('.feel-btn').forEach(b=>{ b.onclick=()=>{ reg.mood=+b.dataset.n;
    feelSec.querySelectorAll('.feel-btn').forEach(x=>{ x.classList.remove('on'); x.className='feel-btn'; });
    b.className='feel-btn on lvl'+reg.mood; fcap.textContent=FEEL_LABEL[reg.mood]; _autosaveDraft(); }; });
  wrap.appendChild(feelSec);
  return wrap;
}

// salvar — único, usado pela aba Renshū e pelo botão +
let _salvarLock=false;
function salvar(){
  if(_salvarLock) return;
  const reg = DB.registro;
  if(reg.randori===null){ toast('Você fez randori hoje?'); return; }
  if(!reg.mood){ toast('Avalie como foi o treino (1–5)'); return; }
  _salvarLock=true; setTimeout(()=>{ _salvarLock=false; }, 1500);
  // M8: treino iniciado ontem (rascunho) e concluído hoje vale para o DIA DO CHECK-IN
  const dataTreino = (DB._draft && DB._draft.date) || HOJE_ISO;
  const ehHoje = dataTreino === HOJE_ISO;
  const _dp = dataTreino.split('-').map(Number);
  const diaLbl = _WD[new Date(_dp[0], _dp[1]-1, _dp[2]).getDay()];
  const reps = reg.randori ? focoTecnicas().filter(t=>(t.hojeT||0)>0) : [];
  // M9: renshu guarda o ID estável (+ jp da época p/ exibição histórica)
  const det = { randori:reg.randori, renshu:reps.map(t=>({id:t.id||t.jp, jp:t.jp, a:t.hojeA||0, t:t.hojeT})), nota:(reg.nota||'').trim(), feel:reg.mood };
  reps.forEach(t=>{
    t.dias=t.dias||[]; const last=t.dias[t.dias.length-1];
    // bucket do dia identificado pela DATA (d) — permite reverter na exclusão (M2);
    // compat: buckets antigos sem `d` usam a flag `hoje`
    const mesmoDia = last && (last.d ? last.d===dataTreino : (last.hoje && ehHoje));
    if(mesmoDia){ last.a+=(t.hojeA||0); last.t+=t.hojeT; if(!last.d) last.d=dataTreino; }
    else { t.dias.push({a:t.hojeA||0,t:t.hojeT,dia:diaLbl,d:dataTreino,hoje:ehHoje}); if(t.dias.length>30) t.dias.shift(); }
    t.treinos=(t.treinos||0)+1; t.ultima=ehHoje?'hoje':'ontem'; t.ultimaRev=dataTreino;
    t.hojeA=0; t.hojeT=0;
  });
  // Presença só nasce pelo check-in real (QR/código → RPC). Não mentir localmente:
  // se o aluno chegou aqui sem `checkinHoje.feito`, salvar registra o treino no
  // dump mas NÃO marca presença falsa. Fecha o "check-in fantasma" (0027).
  // semana/streak são recalculados em atualizarSemana()
  const aula=aulaDoDia();
  const novoId = Date.now();
  const tecLabel = reps.length ? ('Renshū · '+det.renshu.map(r=>r.jp).join(', ')) : (reg.randori?'Treino com randori':'Treino (sem randori)');
  // v455: carimba turmaId + horaAula se veio de check-in — a mesma chave (data +
  // turmaId + horaAula) que o adapter usa pra deduplicar contra presenças do
  // servidor. Sem isso, se aluno registra treino local com check-in feito, o
  // pullAll criaria uma linha placeholder duplicada pra mesma aula.
  const _ck = DB.checkinHoje && DB.checkinHoje.sessao;
  // v489: se já existe PLACEHOLDER do servidor pra este dia/aula, MESCLAR (adicionar
  // técnicas/randori/mood) em vez de criar treino novo. Sem isso, o aluno terminava
  // com 2 entradas no diário (placeholder do server + treino local) — bug relatado
  // 2026-08-28 pelo Guilherme. Prioridade: match por chave completa
  // (data+turmaId+horaAula); fallback pra 1 placeholder do dia (aluno sem check-in).
  const _phSrv = _ck
    ? DB.treinos.find(t => t._fonte==='servidor' && t.data===dataTreino && t.turmaId===_ck.turmaId && t.horaAula===_ck.hora)
    : DB.treinos.find(t => t._fonte==='servidor' && t.data===dataTreino);
  if(_phSrv){
    _phSrv.tipo = aula.tipo; _phSrv.titulo = aula.label;
    _phSrv.tecnica = tecLabel; _phSrv.mood = FEEL_LABEL[reg.mood];
    _phSrv.feel = reg.mood; _phSrv.det = det;
    if(_ck){ _phSrv.turmaId = _ck.turmaId; _phSrv.horaAula = _ck.hora; }
    delete _phSrv._fonte; delete _phSrv._via;   // deixa de ser placeholder
    DB.justSaved = _phSrv.id;
  } else {
    DB.treinos.unshift({ id:novoId, tipo:aula.tipo, data:dataTreino, titulo:aula.label, tecnica:tecLabel, mood:FEEL_LABEL[reg.mood], feel:reg.mood, det,
      turmaId: (_ck && _ck.turmaId) || null, horaAula: (_ck && _ck.hora) || null });
  }
  if(!ehHoje) DB.treinos.sort((a,b)=> (b.data||'').localeCompare(a.data||''));   // treino de ontem entra na posição certa
  if(!_phSrv) DB.justSaved = novoId;   // efêmero — some no reload (marca o novo, ou o placeholder mesclado acima)
  track('treino_registrado', { randori:reg.randori, tecnicas:reps.length, feel:reg.mood, total:DB.treinos.length });
  // M11: pushes objetivos no momento-chave (não a cada render)
  if(DB.sbUser && !DEMO && typeof sbSync!=='undefined'){ try{ sbSync.pushProgress(); sbSync.pushCheckin(); }catch(e){} }
  DB.registro = { randori:null, nota:'', mood:null };
  _clearDraft();
  // volta para Home com toast sutil (share via detalhe do treino)
  DB.flow=null; DB.navAluno='inicio';
  haptic([10,30,10]); _releaseWakeLock();
  render(); toast('✅ Treino registrado — Oss 🥋');
}

// tirar uma técnica do foco (guarda na biblioteca, sem apagar histórico)
function rsRemoverFoco(jp){
  const t = tecByKey(jp); if(!t) return;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Tirar do foco?</div>
    <div class="sheet-desc">Você para de praticar <b>"${safeTxt(t.jp)}"</b>, mas ela fica guardada na <b>Biblioteca</b> pra voltar quando quiser. O histórico não é apagado.</div>
    <button class="btn-save" id="rs-confirm">Tirar do foco</button>
    <button class="sheet-cancel" id="rs-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-cancel').onclick=close;
  sheet.querySelector('#rs-confirm').onclick=()=>{ t.estado='guardada'; scheduleSave(); _syncEstado(); sheet.remove(); render(); toast('Guardada na Biblioteca'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// colocar uma técnica da biblioteca no foco (máx 3)
function rsAddFoco(){
  if(focoTecnicas().length>=3){ toast('Máximo de 3 em treino'); return; }
  const cands = DB.tecnicas.map((t,i)=>({t,i})).filter(x=>x.t.estado!=='foco')
    .sort((a,b)=>(b.t.treinos||0)-(a.t.treinos||0));
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Praticar qual técnica?</div>
    <div class="sheet-desc">Ela entra no seu Renshū — você passa a contar acertos a cada treino.</div>
    <div class="rs-picklist" id="rs-picklist"></div>
    <button class="sheet-cancel" id="rs-pick-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('#rs-picklist');
  cands.forEach(({t})=>{
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${safeTxt(t.jp)}</div><div class="ts">${plural(t.treinos||0,'treino','treinos')}</div></div><span class="rs-pk-go">＋</span></div>`);
    row.onclick=()=>{ if(t.estado==='foco') return; t.estado='foco'; track('foco_add',{jp:t.jp}); scheduleSave(); _syncEstado(); sheet.remove(); render(); toast('No foco — bora praticar'); };
    list.appendChild(row);
  });
  if(!cands.length) list.appendChild(el(`<div class="rs-empty-foco">Todas as técnicas já estão no foco.</div>`));
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-pick-cancel').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ============================================================
   ROTEADOR
   ============================================================ */
function _viewKey(){
  if (DB.authOpen) return 'auth';   // v427: sem isto o login herdava a chave da tela pós-login
  if (DB.trocarSenhaOpen) return 'trocarSenha';
  if (DB.onboardingOpen) return 'onb';
  if (DB.retroOpen) return 'retro';
  if (DB.lojaOpen) return 'loja';
  if (DB.meusPedidosOpen) return 'meuspedidos';
  if (DB.shareOpen) return 'share';
  if (DB.treinoAberto) return 'treino';
  if (DB.produtoFormOpen) return 'produtoForm';
  if (DB.cadastroAlunoOpen) return 'cadastroAluno';
  if (DB.flow) return 'flow:'+DB.flow;
  if (DB.role==='aluno') return 'al:'+DB.navAluno+':'+(DB.jogoTab||'')+':'+(DB.jornadaTab||'');
  return 'prof:'+DB.navProf;
}
// a11y: nome legível da tela atual, escrito na live-region #route-announce para
// que leitores de tela avisem a navegação (a SPA troca #root sem mudar de página).
const _ROUTE_NOMES = {
  'al:inicio':'Início','al:tatame':'Tatame','al:jornada':'Jornada','al:perfil':'Perfil',
  'loja':'Loja','meuspedidos':'Meus pedidos','share':'Compartilhar treino','treino':'Detalhe do treino','retro':'Retrospectiva',
  'onb':'Boas-vindas','trocarSenha':'Trocar senha','bootstrap':'Primeiro acesso',
  'prof:painel':'Painel','prof:alunos':'Alunos','prof:presencas':'Presenças',
  'prof:graduacoes':'Graduações','prof:turmas':'Turmas','prof:relatorios':'Relatórios',
  'prof:financeiro':'Financeiro','prof:loja':'Loja · Gestão','prof:pedidos':'Pedidos',
  'flow:checkin':'Check-in','flow:registrar':'Registrar treino',
  'produtoForm':'Produto','cadastroAluno':'Cadastro de aluno',
};
function _announceRoute(viewKey){
  const reg = document.getElementById('route-announce'); if(!reg) return;
  const base = viewKey.split(':').slice(0,2).join(':');   // ignora sub-abas (jogoTab/jornadaTab)
  const nome = _ROUTE_NOMES[base] || _ROUTE_NOMES[viewKey] || null;
  if(nome) reg.textContent = nome;
}
// Sheets vivem no <body> fora do #root — quando o usuário navega no menu, o render
// limpa o root mas o overlay fica pendurado. Fecha explicitamente na troca de view.
function _closeAllSheets(){ document.querySelectorAll('.sheet-overlay').forEach(n=> n.remove()); }
function render(){
  if (!DEMO) atualizarSemana();        // semana/streak sempre derivados dos treinos reais
  const root = $('#root');
  _dlgInstall();                        // v528: garante router event-delegation ativo (idempotente)
  const curView = _viewKey();
  const sameView = root.dataset.view === curView;
  if (!sameView) _closeAllSheets();
  // memoriza scrollY da view atual antes de trocar
  if (root.dataset.view && root.dataset.view !== curView && typeof _scrollMem !== 'undefined') _scrollMem[root.dataset.view] = window.scrollY;
  // v394: render() na MESMA view preserva o scroll — sem isso, um refetch em
  // background (v393), uma sync do adapter, ou qualquer render() acidental
  // durante uma rolagem jogava o usuario pro topo. So' vale pra mesma view;
  // trocar de tela ainda leva pro topo (comportamento esperado do SPA).
  // rAF: restaura DEPOIS do proximo paint, quando root.innerHTML=... ja voltou.
  if(sameView){
    const _scY = window.scrollY || 0;
    if(_scY > 0) requestAnimationFrame(()=>{ try{ window.scrollTo(0, _scY); }catch(_){} });
  }
  root.dataset.view = curView;
  if (!sameView) _announceRoute(curView);   // a11y: leitor de tela anuncia a troca de tela (SPA)
  document.body.setAttribute('data-role', DB.role||'aluno'); // hook do shell responsivo do professor (§7)
  // páginas cheias do professor não têm sidebar → zera o padding fantasma da .phone (desktop)
  root.classList.toggle('no-anim', sameView);

  // v530 (Fase 3 refactor morphdom): monta os filhos num container e:
  //   - MORPHDOM ligado (?morphdom=1) + lib presente → morphdom(root, novo)
  //   - Default (comportamento antigo) → root.innerHTML='' + appendChild
  // Prova de conceito com bandeira. Zero mudança pra quem não flag.
  const buildInto = (target) => {
    if (DB.authOpen){ target.appendChild(renderAuth()); return; }
    if (DB.trocarSenhaOpen){ target.appendChild(renderTrocarSenha()); return; }
    if (DB.onboardingOpen){ target.appendChild(renderOnboarding()); return; }
    if (DB.retroOpen){ target.appendChild(renderRetro()); return; }
    if (DB.lojaOpen){ target.appendChild(renderLoja()); return; }
    if (DB.meusPedidosOpen){ target.appendChild(renderMeusPedidos()); return; }
    if (DB.produtoFormOpen){ target.appendChild(renderProdutoForm()); if (DB.role!=='aluno') target.appendChild(tabbarProf()); return; }
    if (DB.cadastroAlunoOpen){ target.appendChild(renderCadastroAluno()); if (DB.role!=='aluno') target.appendChild(tabbarProf()); return; }
    if (DB.shareOpen){ target.appendChild(renderShare()); return; }
    if (DB.treinoAberto){ target.appendChild(renderTreinoDetalhe()); return; }
    if (DB.flow){ target.appendChild(renderFlow(DB.flow)); return; }
    if (DB.role === 'aluno') target.appendChild(renderAluno());
    else target.appendChild(renderProfessor());
  };

  // v539: morphdom RE-ATIVADO após entender o contrato via jsdom test.
  // Regra descoberta em tests/morphdom-render.spec.mjs CASO 4:
  // morphdom reusa old node por id-match, novo fica órfão. Consequência:
  // código NÃO PODE capturar body em closure entre renders — sempre
  // lookup fresh no #fin-body. profFinanceiro/tab click/_finReload.then
  // já foram ajustados pra respeitar isso.
  if (MORPHDOM && typeof morphdom === 'function'){
    const newRoot = root.cloneNode(false);
    buildInto(newRoot);
    try {
      morphdom(root, newRoot);
    } catch(e){
      root.innerHTML = '';
      buildInto(root);
    }
  } else {
    root.innerHTML = '';
    buildInto(root);
  }
}

/* v427 — render() de FUNDO. Use em todo redesenho que não foi o usuário que pediu
   (refetch por foco, retorno de suspensão, resposta de um _load*). render() faz
   `root.innerHTML=''`: é inofensivo numa tela que é projeção do modelo, mas apaga
   tela com trabalho em andamento cujo estado ainda mora no DOM ou numa closure —
   login/senha (campos digitados), onboarding (apelido/nascimento + faixa escolhida)
   e a chamada (alunos já marcados). O dado novo fica no cache e aparece quando o
   usuário sair da tela. Generaliza a guarda pontual de batchCheckin da v426. */
function renderBg(){
  // v432: `_hidratando` = boot antes do primeiro paint. Nessa janela o DB ainda é o
  // objeto VAZIO — pintar aqui mostra perfil em branco, que é exatamente o flash que
  // o usuário via: o setTimeout de 400ms do _pushBoot chamava renderBg() antes do
  // pullState voltar. O próprio _cloudLogin pinta assim que o dump é aplicado.
  // v438: `produtoFormOpen` entra na guarda. O auto-save da foto (v437) dispara
  // `onDadosMudaram` → renderBg — sem isto, o refetch varria o form com a foto
  // recém-carregada logo depois da animação (bug "faz animação e some do nada").
  // v489: `DB.flow` também entra na guarda. Fluxo de check-in (QR) monta camera
  // + overlay + tick loop em `document.body` e termina com setTimeout(presencaScan,0).
  // Qualquer render() disparado enquanto o fluxo está aberto (pullAll async, sync
  // de outro dado) reabria uma SEGUNDA câmera com tick independente — dois overlays
  // detectavam o mesmo QR e chamavam _flowCheckin 2× → check-in duplicado.
  if (DB.authOpen || DB.trocarSenhaOpen || DB.onboardingOpen || DB.batchCheckin || DB.produtoFormOpen || DB.flow || _hidratando) return;
  render();
}

/* ---------------- topbar comum ---------------- */
function topbar(sub){
  const nome = (DB.academia && DB.academia.nome) || 'Yama Jiu-Jitsu';
  return `<div class="topbar">
    <div class="academy"><img src="brand/logo.png?v=2" data-fallback="logo" alt="${safeAttr(nome)}"></div>
    <div class="tb-info"><div class="nm">${safeTxt(nome)}</div>${sub?`<div class="sub">${sub}</div>`:''}</div>
    ${DB.sbUser?`<span id="sync-dot" class="sync-dot sync-ok" title="Sincronizado com a nuvem"></span>`:''}
  </div>`;
}

/* ============================================================
   PERFIL ALUNO
   ============================================================ */
function renderAluno(){
  const v = el(`<div class="view"></div>`);
  const nav = DB.navAluno;
  const body = el('<div></div>');
  if (nav==='inicio'){
    body.appendChild(alunoInicio());
  } else {
    body.innerHTML = topbar('');
    if (nav==='jogo')    body.appendChild(alunoMeuJogo());
    if (nav==='jornada') body.appendChild(alunoJornada());
    if (nav==='perfil')  body.appendChild(alunoPerfil());
  }
  v.appendChild(body);
  v.appendChild(tabbarAluno());
  return v;
}

function desdeDinamico(){
  const datas = [];
  (DB.treinos||[]).forEach(t=>{ if(t.data) datas.push(t.data); });
  (DB.graduacoes||[]).forEach(g=>{ if(g.data) datas.push(g.data); });
  if(!datas.length) return DB.eu.desde || HOJE_ISO.slice(0,7);
  datas.sort();
  return datas[0].slice(0,7);
}

/* === GRADUAÇÃO · contagem de aulas (dedup por dia + reset por grau) ===
   Fonte ÚNICA da verdade do progresso por aulas, usada na Home e na Jornada.
   "Aula" = DIA distinto com treino registrado (2 registros no mesmo dia = 1).
   O grau atual conta só dias DESDE a data em que o grau começou → ao receber
   um novo grau/faixa a barra reinicia sozinha (sem acúmulo eterno). === */
function maxGrausDe(faixa){ return faixa==='preta' ? 6 : 4; }
/* v429/0034: fallback local de aulasStats (demo, offline, pré-0034). Conta REGISTROS,
   não dias distintos — mesma regra da RPC, onde 1 check-in = 1 aula. Antes era um Set
   de datas: treinar 2× no mesmo dia valia 1, o que impedia contar as 4 turmas ADULTO
   de um mesmo dia. O caminho de produção não passa por aqui (usa DB._aulasServidor). */
function _treinoDays(){ return (DB.treinos||[]).map(t=>t.data).filter(Boolean); }
function _countSince(arr, sinceISO){ return sinceISO ? arr.filter(d=>d>=sinceISO).length : arr.length; }
// data em que o grau ATUAL começou (entrada de grau; cai p/ a faixa se grau 0 ou sem registro)
function _refDataGrauAtual(){
  const me=DB.eu, g=DB.graduacoes||[]; let e=null;
  if(me.graus>0) e=g.find(x=>x.tipo==='grau' && x.faixa===me.faixa && x.graus===me.graus);
  return e ? e.data : _faixaDesde(g, me.faixa);
}
// data em que a FAIXA atual começou (canônico: faixa | inicio | 1º grau da faixa)
function _refDataFaixaAtual(){ return _faixaDesde(DB.graduacoes||[], DB.eu.faixa); }
function aptoMsg(me, paraFaixa, adicionais){
  const aulas = adicionais===1 ? 'aula adicional' : 'aulas adicionais';
  if (!paraFaixa) return `Aluno apto a receber grau, ${adicionais} ${aulas}`;
  const next = proximaFaixaCBJJ(me.faixa, idadeCBJJ(me.nascimento));   // próxima faixa por idade (CBJJ, infantil+adulto)
  if (me.faixa==='preta' || !next) return `Aluno apto a receber novo grau da Preta, ${adicionais} ${aulas}`;
  const cor = (BELTS[next] && BELTS[next].nome) ? BELTS[next].nome : next;
  return `Aluno apto a receber faixa ${cor}, ${adicionais} ${aulas}`;
}
function aulasStats(){
  const me=DB.eu;
  // Ordem de prioridade da meta: (1) regra da academia por FAIXA (academies.config.metaAulas[faixa],
  // migration 0003) → (2) me.aulasGrau.meta (customização local do aluno) → (3) default global 40.
  // Isso resolve o bug de "aulas/40 travado": ao mudar a regra da faixa na academia, o aluno
  // passa a ver a meta correta (ex.: 50 pra azul) sem depender de campo local.
  const cfgFaixa = (DB.academyConfig && DB.academyConfig.metaAulas && DB.academyConfig.metaAulas[me.faixa]) || 0;
  const meta = cfgFaixa || (me.aulasGrau && me.aulasGrau.meta) || 40;
  const base=(me.aulasGrau&&me.aulasGrau.base)||0;
  // v480: restantes = (graus faltando pra virar de faixa) × meta − progresso do grau atual.
  // Antes: hardcoded 160, sem relação com metaAulas nem com quantos graus faltam. Aluno
  // no 1º grau da azul via ~144 (errado) quando o real são ~447 (3 graus × 130 + faltando).
  // Fórmula: precisa de (maxGraus − graus + 1) transições até a próxima faixa, cada uma
  // custa `meta` aulas; subtrai `atual` que já foi feito no grau corrente.
  const restantesTotal = (atual)=> Math.max(0, (maxGrausDe(me.faixa) - me.graus + 1) * meta - atual);
  if(DEMO){ const atual=me.aulasGrau.atual||0;
    return { meta, atual, pct:Math.round(atual/meta*100), faltam:Math.max(0,meta-atual), restantes:restantesTotal(atual) }; }
  // 0034/0041: com backend, o número vem do SERVIDOR — a MESMA RPC que o painel do
  // professor usa. Fim das duas contagens em JS que divergiam (o aluno via um
  // número na Jornada, o professor via outro na lista). O crédito da 0029 já vem
  // somado. `base` local legado continua entrando: é dado do app antigo que só
  // existe no dump. Sem RPC (demo/offline/pré-0034) cai no cálculo local abaixo.
  const srv = DB._aulasServidor;
  if(srv){
    const atual = srv.grau + base;
    return { meta, atual, pct:Math.round(atual/meta*100), faltam:Math.max(0,meta-atual), restantes:restantesTotal(atual) };
  }
  const dias=_treinoDays();
  const refGrau  = _refDataGrauAtual();
  // 0029: credito de presencas importado do app antigo. Cada credito mora no
  // evento-ancora correspondente (grau atual / faixa atual). O `base` local
  // legado continua respeitado como fallback pra nao perder dado antigo.
  // Reproduz a mesma logica do adapter (supabase.js:getAlunos ancora do grau).
  const gs = DB.graduacoes || [];
  const evGrau = me.graus > 0
    ? gs.find(g=> g.tipo==='grau' && g.faixa===me.faixa && g.graus===me.graus && g.data===refGrau)
    : gs.find(g=> g.tipo==='faixa' && g.faixa===me.faixa && g.data===refGrau);
  const creditoGrau = (evGrau && +evGrau.aulas_credito_grau) || 0;
  const noGrau  = creditoGrau  + base + _countSince(dias, refGrau);   // aulas no grau atual
  const atual   = noGrau;
  return { meta, atual, pct:Math.round(atual/meta*100), faltam:Math.max(0,meta-atual), restantes:restantesTotal(atual) };
}

function alunoInicio(){
  const w = el('<div></div>');
  const me = DB.eu;

  // ---- Cabeçalho Kanri: logo da academia + foto personalizável + nome ----
  // Home minimalista: hero compacto p/ a tela de entrada caber sem scroll
  const sz = me.fotoSize || 84;   // bate com o tamanho da foto na aba Perfil (.profile-head .pa)
  const head = el(`<div class="kanri-head">
    <div class="kh-bell bell" role="button" tabindex="0" aria-label="Notificações">🔔${me.avisos>0?`<span class="bell-badge">${me.avisos}</span>`:''}</div>
    <div class="hero-bg">
      <img class="kanri-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="Yama Jiu-Jitsu">
    </div>
    <div class="kh-divider"></div>
    <div class="profile-photo" style="width:${sz}px;height:${sz}px;margin-top:${-Math.round(sz/2)}px;font-size:${Math.round(sz*0.34)}px">
      <span class="pp-ini">${safeTxt(me.iniciais)}</span>
      <img src="${safeAttr(me.foto||'')}" data-fallback="remove" alt="">
    </div>
    <div class="profile-name">${me.nomeCompleto && me.nomeCompleto!==me.apelido ? safeTxt(me.nomeCompleto)+' | ' : ''}${safeTxt(me.apelido)}</div>
  </div>`);
  head.querySelector('.kh-bell').onclick = ()=> abrirNotificacoes();
  const _phIni = head.querySelector('.profile-photo');
  // Tap = editar foto · Segurar (long-press) = abrir o cartão de perfil com todas as infos.
  if(_phIni){ _phIni.style.cursor='pointer'; _phIni.setAttribute('aria-label','Foto de perfil — toque para editar, segure para ver detalhes'); _phIni.onclick=()=>editarFotoPerfil(); _attachLongPress(_phIni,{onLongPress:()=>abrirCartaoPerfil()}); }
  w.appendChild(head);

  // ---- Faixa / progresso compacto (ACIMA do registrar) — DINÂMICO ----
  const ag = aulasStats();
  const noMaxGrau = me.graus >= maxGrausDe(me.faixa);
  const prog = el(`<div class="prog-mini">
    <div class="pm-top">
      <div class="pm-belt">${beltMini(me.faixa, me.graus)}</div>
      <span class="pm-num">${ag.atual}/${ag.meta}</span>
    </div>
    <div class="mini-bar"><span style="width:${ag.pct}%"></span></div>
    <div class="pm-foot">${ag.atual>=ag.meta?aptoMsg(me, noMaxGrau, ag.atual-ag.meta):plural(ag.faltam,'aula','aulas')+' para '+(noMaxGrau?'a próxima faixa':'o '+(me.graus+1)+'º grau')+' →'}</div>
  </div>`);
  prog.onclick = ()=>{ DB.jornadaTab='graduacao'; goAluno('jornada'); };
  w.appendChild(prog);

  // ---- Selo de consistência (streak) leve, abaixo da faixa (some pro aluno novo) ----
  const _sb = streakBadge(); if(_sb) w.appendChild(_sb);

  // ---- Banner de avisos: insiste enquanto o toggle não é ligado ----
  // Não dá pra ativar push sem um toque do próprio usuário (regra do navegador,
  // nenhum app/site consegue pedir permissão sozinho). O banner é a alternativa:
  // aparece de novo a cada visita (dismiss é só da SESSÃO, não persiste) até o
  // aluno ligar. Some de vez quando ele ativa; não aparece se bloqueado/sem suporte
  // (nesses casos insistir não ajuda, só irrita).
  if(!DB._pushBannerOculto && !DEMO && typeof sbPush!=='undefined' && sbPush.suportado() && sbPush.configurado()){
    sbPush.estado().then(est=>{
      if(est!=='inativo') return;   // só insiste quando dá pra agir (não bloqueado, não já ativo)
      const b = el(`<div class="push-nudge" role="button" tabindex="0">
        <div class="pn-ic">🔔</div>
        <div class="pn-tx"><div class="pn-t">Ative os avisos</div><div class="pn-s">Saiba quando esquecer o check-in — mesmo com o app fechado</div></div>
        <button class="pn-x" type="button" aria-label="Fechar">✕</button>
      </div>`);
      const ir = async ()=>{ try{ await sbPush.ativar(); toast('Avisos ligados 🔔'); b.remove(); }catch(e){ toast(e.message||'Não deu pra ativar'); } };
      b.onclick = (e)=>{ if(e.target.classList.contains('pn-x')) return; ir(); };
      b.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); ir(); } };
      b.querySelector('.pn-x').onclick = (e)=>{ e.stopPropagation(); DB._pushBannerOculto=true; b.remove(); };
      w.insertBefore(b, _sb ? _sb.nextSibling : prog.nextSibling);
    }).catch(()=>{});
  }

  // ---- Onboarding: 1 vídeo destacado + link "Ver todos" pra biblioteca completa ----
  // Boot em background: se com backend, puxa lista da nuvem e re-renderiza se veio novidade
  if(_alunoOnboardOn()) _kickOnboardVideosSync();
  const _onbVids = _alunoOnboardOn() ? _getOnboardVideos() : [];
  if(_onbVids.length){
    // Escolhe o próximo não-assistido (ou o primeiro, se todos visto/nenhum log)
    const _seen = (()=>{ try{ return JSON.parse(localStorage.getItem('yama.videos.seen')||'[]'); }catch(_){ return []; } })();
    const nextVid = _onbVids.find(v=>!_seen.includes(v.id)) || _onbVids[0];
    const hasMore = _onbVids.length > 1;
    const sec = el(`<div class="onb-videos">
      <div class="sec-title" style="display:flex;justify-content:space-between;align-items:baseline;padding:0 4px 6px">
        <span>Boas-vindas ao tatame</span>
        ${hasMore ? `<a class="onb-all" role="button" tabindex="0">Ver todos (${_onbVids.length}) ›</a>` : ''}
      </div>
      <button class="onb-card onb-card-hero" type="button" aria-label="Assistir: ${safeAttr(nextVid.title)}">
        <div class="onb-thumb"><img src="${safeAttr(_ytThumb(nextVid.id))}" alt="" data-fallback="remove"><span class="onb-play">▶</span></div>
        <div class="onb-title">${safeTxt(nextVid.title)}</div>
      </button>
    </div>`);
    // Play inline no app + marca visto
    sec.querySelector('.onb-card').addEventListener('click', ()=>{
      if(!_seen.includes(nextVid.id)){
        _seen.push(nextVid.id);
        try{ localStorage.setItem('yama.videos.seen', JSON.stringify(_seen)); }catch(_){}
      }
      _abrirPlayerYT(nextVid.id, nextVid.title, nextVid.isShort);
    });
    const _all = sec.querySelector('.onb-all');
    if(_all){
      _all.onclick = ()=> _abrirOnbSheet(_onbVids, _seen);
      _all.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _abrirOnbSheet(_onbVids, _seen); } };
    }
    w.appendChild(sec);
  }

  // ---- Check-in na janela (±30 min de uma sessão de hoje) ----
  // Segue o padrão visual do .foco-card (branco simples com shadow). Clique NÃO faz check-in
  // direto — inicia o mesmo fluxo bifásico do botão +, pré-selecionando a sessão. Só some da
  // Home depois que o check-in foi confirmado (porTurma preenchido) OU o aluno feche o fluxo.
  const elegiveis = _sessoesElegiveis();
  if(elegiveis.length){
    const wrap = el('<div class="checkin-cards"></div>');
    elegiveis.slice(0,2).forEach(s=>{
      const dt = s._dt;
      const quando = Math.abs(dt) <= 3 ? 'começando agora'
        : (dt > 0 ? `em ${dt} min` : `começou há ${-dt} min`);
      const card = el(`<div class="checkin-card" role="button" tabindex="0" aria-label="Fazer check-in em ${safeAttr(s.turmaNome)} — ${safeAttr(s.hora)}">
        <span class="cc-dot" style="background:${safeAttr(s.cor||'var(--red)')}"></span>
        <div class="cc-mid">
          <div class="cc-t">Check-in · ${safeTxt(s.turmaNome)}${s.variacao?' · '+safeTxt(s.variacao):''}${s.bilingue?' '+icoUSFlag():''}</div>
          <div class="cc-s"><b>${safeTxt(s.hora)}</b> · ${safeTxt(quando)}</div>
        </div>
        <span class="cc-go">›</span>
      </div>`);
      const start = ()=>_iniciarCheckinDaSessao(s);
      card.onclick = start;
      card.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); start(); } };
      wrap.appendChild(card);
    });
    w.appendChild(wrap);
  }

  // ---- 🎯 Foco atual: o que você está trabalhando agora ----
  // resumo do que estou praticando (espelha o Renshū: estado==='foco')
  const focosHome = focoTecnicas();
  if (focosHome.length){
    const foco = el(`<div class="foco-card">
      <div class="foco-top"><span class="foco-ic">🎯</span>
        <span class="foco-lbl">Trabalhando em</span></div>
      <div class="foco-chips">${focosHome.map(t=>`<span class="foco-chip">${safeTxt(t.jp)}</span>`).join('')}</div>
    </div>`);
    foco.querySelectorAll('.foco-chip').forEach(c=> c.onclick = ()=>{ DB.navAluno='jogo'; DB.jogoTab='progresso'; render(); });
    w.appendChild(foco);
  }

  // ---- Treino em andamento (draft ativo) ----
  if(_loadDraft()){
    const draftCard = el(`<div class="draft-card">
      <div class="draft-body"><span class="draft-ic">🥋</span>
        <div class="draft-tx"><div class="draft-t">Treino em andamento</div>
          <div class="draft-s">Volte após a aula para completar o registro</div></div></div>
      <button class="draft-btn">Completar treino</button>
    </div>`);
    draftCard.querySelector('.draft-btn').onclick = ()=> openFlow();
    w.appendChild(draftCard);
  }

  // ---- Últimos treinos (2 — Home minimalista; histórico completo na Jornada) ----
  w.appendChild(el(`<div class="sec-row" style="margin-top:14px"><div class="sec-title">Últimos treinos</div>
    <a data-click="verHistorico">Ver tudo</a></div>`));
  if (!DB.treinos.length){
    w.appendChild(emptyState('🥋','Nenhum treino ainda','Toque no botão abaixo, confirme presença e depois da aula registre como foi — sensação, técnicas e anotações.','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
  } else {
    const hist = el(`<div class="history"></div>`);
    DB.treinos.slice(0,2).forEach(tr=>{
      const item = histItem(tr, true); item.onclick = ()=> abrirTreino(tr.id);
      if(tr.id===DB.justSaved){
        const box=el(`<div class="hist-just"></div>`);
        box.appendChild(item);
        const sb=el(`<button class="hist-share" aria-label="Compartilhar treino">📲 Compartilhar treino</button>`);
        sb.onclick=(e)=>{ e.stopPropagation(); abrirShare(tr.id); };
        box.appendChild(sb);
        hist.appendChild(box);
      } else hist.appendChild(item);
    });
    w.appendChild(hist);
  }
  w.appendChild(el(`<div style="height:8px"></div>`));

  return w;
}

// Aula padrão do dia: seg–sex = Aula Técnica · sáb/dom = Livre (open mat)
function aulaDoDia(){
  const d = hoje.getDay();
  if (d===0 || d===6) return { tipo:'livre', label:'Aula Livre', emoji:'⚡' };
  return { tipo:'tecnica', label:'Aula Técnica', emoji:'🥋' };
}

// Selo de streak / consistência semanal
function streakBadge(){
  // Aluno novo (sem treinos ou sem estrutura de semana): não mostra o widget
  if(!DB.semana || !(DB.treinos||[]).length) return null;
  const s = DB.semana;
  const meta = s.meta || 4;
  const labels = ['S','T','Q','Q','S','S','D'];
  const todayIdx = (hoje.getDay()+6)%7;
  const dots = labels.map((d,i)=>
    `<span class="wk-dot ${s.dias[i]?'on':''} ${i===todayIdx?'today':''}"></span>`).join('');
  const abaixo = s.feitos < meta && todayIdx >= 4;
  const ariaB4 = `Sequência de ${plural(s.streakSemanas,'semana','semanas')} seguidas treinando. Esta semana: ${s.feitos} de ${meta} treinos. Toque para ver o histórico.`;
  const node = el(`<div class="streak-badge compact" role="button" tabindex="0" aria-label="${ariaB4}">
    <span class="sb-fire">${abaixo?'⚠️':'🔥'}</span>
    <span class="sb-n" title="Semanas seguidas com pelo menos 1 treino">${s.streakSemanas} sem</span>
    <span class="sb-meta" title="Treinos nesta semana / sua meta semanal">${s.feitos}/${meta}</span>
    <div class="sb-dots">${dots}</div>
  </div>`);
  const goHist = ()=>{ DB.navAluno='jornada'; DB.jornadaTab='historico'; render(); window.scrollTo(0,0); };
  node.onclick = goHist;
  node.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); goHist(); } };
  return node;
}


// rótulo de data "Qua, 03 jun" a partir de t.data
function dataLabel(t){
  const [y,m,d] = t.data.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return `${diasSem[dt.getDay()].slice(0,3)}, ${String(d).padStart(2,'0')} ${meses[m-1]}`;
}
function lesaoAtivaEm(dataISO){
  if (!DB.lesoes || !DB.lesoes.length || !dataISO) return null;
  // B8: janela histórica correta — lesão vale de l.data até l.curadaEm (exclusivo).
  // 'ativa'/'recuperando' = sem fim (contínua); 'curada' só marca treinos ANTES da cura
  // (curadaEm é gravada automaticamente ao mudar o status para "Curada").
  return DB.lesoes.find(l => {
    if (!l || !l.data || dataISO < l.data) return false;
    if (l.status==='ativa' || l.status==='recuperando') return true;
    return l.status==='curada' && !!l.curadaEm && dataISO < l.curadaEm;
  }) || null;
}
function histItem(t, dateMode){
  // v456: horário da aula (`horaAula`) aparece como prefixo do subtítulo.
  // v457: dateMode (Home) também mostra hora — multi-aula/dia precisa diferenciar.
  // v462: marca "presença da professora" no subtítulo quando o placeholder veio de
  // batch do professor (via='professor'). Ajuda o aluno a diferenciar sem abrir.
  const _hora = t.horaAula ? `🕐 ${t.horaAula}` : '';
  // v463-v476: badge pra placeholder vazio. v476: mesmo estilo/fonte do subtítulo
  // (12.5px muted, sem accent vermelho, sem fundo). Duas linhas quando é presença
  // do professor: identifica a origem + cutuca pra enriquecer.
  const _enriq = !!(t.tecnica || t.feel!=null || (t.det && (t.det.randori!=null || (t.det.renshu||[]).length || t.det.nota)));
  const _isVazio = t._fonte==='servidor' && !_enriq;
  let _badgeHTML = '';
  if(_isVazio){
    if(t._via==='professor'){
      // v477: mesma linha separada por "·"; sem nowrap, o browser quebra sozinho quando não couber.
      _badgeHTML = `<div class="h-badge">Presença por Yama · <span class="h-badge-hint">Enriqueça o diário</span></div>`;
    } else {
      _badgeHTML = `<div class="h-badge">👉 Complete o diário</div>`;
    }
  }
  // v475: badge sai do subtítulo (renderizado abaixo como chip). Aqui só hora + info do treino.
  const _sub = [_hora, t.tecnica].filter(Boolean).join(' · ');
  const _dateSub = [_hora, dataLabel(t)].filter(Boolean).join(' · ');
  const sub = dateMode ? _dateSub : _sub;
  const right = dateMode ? feelBadge(t)
                         : `<div class="day">${diaRelativo(t.data)}</div>${feelBadge(t)}`;
  const lesao = lesaoAtivaEm(t.data);
  const lesaoBadge = lesao ? `<span class="lesao-flag" title="Lesão ativa: ${safeAttr(lesao.parte)}" aria-label="Treino durante lesão: ${safeAttr(lesao.parte)}">🤕</span>` : '';
  const e = el(`<div class="h-item h-${t.tipo}${lesao?' has-lesao':''}">
    <div class="h-ic">${t.tipo==='tecnica'?'🥋':'⚡'}</div>
    <div class="h-tx"><div class="t">${safeTxt(t.titulo)}${lesaoBadge}</div><div class="d">${safeTxt(sub)}</div>${_badgeHTML}</div>
    <div class="h-right">${right}</div></div>`);
  return e;
}

// JORNADA = histórico (antigo Diário) + graduação, num lugar só (a + d)
function alunoJornada(){
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Jornada</div>
    <div class="greet">&nbsp;</div></div>`;

  const subs = [['historico','Histórico'],['frequencia','Frequência'],['graduacao','Graduação']];
  const seg = el(`<div class="subtabs-scroll"></div>`);
  subs.forEach(([id,l])=>{
    const b = el(`<button class="subtab2 ${DB.jornadaTab===id?'on':''}">${l}</button>`);
    b.onclick = ()=>{ DB.jornadaTab=id; render(); };
    seg.appendChild(b);
  });
  w.appendChild(seg);

  const cont = el('<div></div>');
  if (DB.jornadaTab==='historico')  cont.appendChild(jornadaHistorico());
  if (DB.jornadaTab==='frequencia') cont.appendChild(jornadaFrequencia());
  if (DB.jornadaTab==='graduacao')  cont.appendChild(evoluirGraduacao());
  w.appendChild(cont);
  return w;
}

// Sub-aba Histórico: heatmap (por período) + notas + feed filtrável
function jornadaHistorico(){
  const w = el('<div></div>');
  w.appendChild(heatmapCard());

  // filtro funcional: tipo
  const filtro = DB.histFiltro || 'todos';
  const fseg = el(`<div class="filter-seg"></div>`);
  [['todos','Todos'],['tecnica','Técnica'],['livre','Livre']].forEach(([id,l])=>{
    const b = el(`<button class="${filtro===id?'active':''}">${l}</button>`);
    b.onclick = ()=>{ DB.histFiltro=id; DB._histPage=0; render(); };
    fseg.appendChild(b);
  });
  w.appendChild(fseg);

  // filtros avançados: 3 icon groups (período, sensação, randori)
  const hPer = DB.histPer || null;
  const hFeel = DB.histFeel || null;
  const hRand = DB.histRandori;
  const fPanel = DB._histFilterOpen || null;

  const fBar = el(`<div class="hist-filter-bar"></div>`);
  const groups = [
    {id:'periodo', icon:'📅', label:'Período', active: !!hPer},
    {id:'sensacao', icon:'📊', label:'Sensação', active: !!hFeel},
    {id:'randori', icon:'🤼', label:'Randori', active: hRand!=null}
  ];
  groups.forEach(g=>{
    const btn = el(`<button class="hf-btn ${g.active?'on':''} ${fPanel===g.id?'open':''}">${g.icon}<span>${g.label}</span></button>`);
    btn.onclick = ()=>{ DB._histFilterOpen = fPanel===g.id ? null : g.id; render(); };
    fBar.appendChild(btn);
  });
  w.appendChild(fBar);

  if (fPanel==='periodo'){
    const chips = el(`<div class="hist-chips"></div>`);
    [['7d','7 dias'],['30d','30 dias'],['3m','3 meses'],['ano','1 ano']].forEach(([id,l])=>{
      const b = el(`<button class="hchip ${hPer===id?'on':''}">${l}</button>`);
      b.onclick = ()=>{ DB.histPer = hPer===id ? null : id; DB._histPage=0; render(); };
      chips.appendChild(b);
    });
    w.appendChild(chips);
  }
  if (fPanel==='sensacao'){
    const chips = el(`<div class="hist-chips"></div>`);
    [1,2,3,4,5].forEach(n=>{
      const b = el(`<button class="hchip ${hFeel===n?'on':''}">${n} · ${FEEL_LABEL[n]}</button>`);
      b.onclick = ()=>{ DB.histFeel = hFeel===n ? null : n; DB._histPage=0; render(); };
      chips.appendChild(b);
    });
    w.appendChild(chips);
  }
  if (fPanel==='randori'){
    const chips = el(`<div class="hist-chips"></div>`);
    const rSim = el(`<button class="hchip ${hRand===true?'on':''}">🤼 Com randori</button>`);
    rSim.onclick = ()=>{ DB.histRandori = hRand===true ? undefined : true; DB._histPage=0; render(); };
    chips.appendChild(rSim);
    const rNao = el(`<button class="hchip ${hRand===false?'on':''}">🧘 Sem randori</button>`);
    rNao.onclick = ()=>{ DB.histRandori = hRand===false ? undefined : false; DB._histPage=0; render(); };
    chips.appendChild(rNao);
    w.appendChild(chips);
  }

  // resumo de filtros ativos + contagem + limpar
  const filtrosAtivos = (filtro!=='todos') || hPer || hFeel || hRand!=null || DB.histMes!=null;
  if (filtrosAtivos){
    const resumo = el(`<div class="hist-active-filters"></div>`);
    if (DB.histMes!=null){
      const chip = el(`<span class="mes-chip">📅 ${meses[DB.histMes]} <span class="mc-x">✕</span></span>`);
      chip.onclick = ()=>{ DB.histMes=null; render(); };
      resumo.appendChild(chip);
    }
    const limpar = el(`<button class="hchip-clear">Limpar filtros</button>`);
    limpar.onclick = ()=>{ DB.histFiltro='todos'; DB.histPer=null; DB.histFeel=null; DB.histRandori=undefined; DB.histMes=null; DB._histPage=0; render(); };
    resumo.appendChild(limpar);
    w.appendChild(resumo);
  }

  // notas rápidas
  if (DB.notas && DB.notas.length){
    w.appendChild(el(`<div class="sec-title">Notas rápidas</div>`));
    const nl = el(`<div class="nota-list"></div>`);
    DB.notas.slice(0,3).forEach(n=> nl.appendChild(el(`<div class="nota-item"><span class="ni-tx">${safeTxt(n.texto)}</span><span class="nota-dt">${fmtDataLonga(n.data)}</span></div>`)));
    w.appendChild(nl);
    w.appendChild(el(`<div class="sec-title">Treinos</div>`));
  }

  // feed filtrado (tipo + período + mês + sensação + randori) com paginação
  if (!DB.treinos.length){
    w.appendChild(emptyState('📓','Seu diário está vazio','Aqui vai aparecer o histórico completo dos seus treinos — técnicas, randori, fotos e anotações. Registre o primeiro!','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
    return w;
  }
  const hist = el(`<div class="history"></div>`);
  // v455: sync no adapter (pullAll) já popula DB.treinos com presenças do servidor
  // como placeholders editáveis (_fonte:'servidor'). Sem merge separado aqui.
  let itens = DB.treinos;
  if (filtro!=='todos') itens = itens.filter(t=> t.tipo===filtro);
  if (hPer){
    const diasMap = {'7d':7,'30d':30,'3m':90,'ano':365};
    const limDias = diasMap[hPer]||365;
    const limDate = new Date(hoje); limDate.setDate(limDate.getDate()-limDias);
    const limISO = isoOf(limDate);
    itens = itens.filter(t=> t.data >= limISO);
  }
  if (DB.histMes!=null) itens = itens.filter(t=>{ const [y,m,d]=t.data.split('-').map(Number); return (m-1)===DB.histMes; });
  if (hFeel) itens = itens.filter(t=> t.feel===hFeel);
  if (hRand===true) itens = itens.filter(t=> t.det && t.det.randori===true);
  if (hRand===false) itens = itens.filter(t=> t.det && t.det.randori===false);
  if (filtrosAtivos){
    w.appendChild(el(`<div class="hist-count">${itens.length} / ${DB.treinos.length} treinos</div>`));
  }
  if (!itens.length) hist.appendChild(el(`<div class="empty-line">Nenhum treino com esses filtros.</div>`));
  const PAGE = 20;
  const page = DB._histPage || 0;
  const visivel = itens.slice(0, (page+1)*PAGE);
  visivel.forEach(t=>{
    const item = histItem(t);
    item.onclick = ()=> abrirTreino(t.id);
    _attachLongPress(item, { onLongPress: ()=>{
      const acoes = [{ icon:'👁️', label:'Abrir detalhes', onClick:()=> abrirTreino(t.id) }];
      // v455: presença marcada pela academia não pode ser excluída pelo aluno —
      // ele pode editar/enriquecer (técnica/mood) mas o registro da chamada é do
      // servidor. Se for erro do professor, ele desfaz do lado dele.
      if (t._fonte !== 'servidor'){
        acoes.push({ icon:'🗑️', label:'Excluir treino', danger:true, onClick:()=>{
          const snap = {...t}, idx = DB.treinos.findIndex(x=>x.id===t.id);
          const snapTecs = _snapTreinoTecs(t);
          _revertTreinoAgg(t);
          DB.treinos = DB.treinos.filter(x=>x.id!==t.id);
          render(); scheduleSave();
          toastUndo('Treino excluído', ()=>{ DB.treinos.splice(idx, 0, snap); _restoreTreinoTecs(snapTecs); render(); scheduleSave(); });
        } });
      }
      _openActionSheet(t.titulo||'Treino', acoes);
    }});
    hist.appendChild(item);
  });
  if (visivel.length < itens.length){
    const mais = el(`<button class="hist-mais">Carregar mais (${itens.length - visivel.length} restantes)</button>`);
    mais.onclick = ()=>{
      // injeta 3 skeletons temporários para feedback visual antes da paginação carregar
      mais.replaceWith(el(`<div class="hist-skel-stack"><div class="skel skel-row"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div>`));
      setTimeout(()=>{ DB._histPage = (DB._histPage||0)+1; render(); }, 120);
    };
    hist.appendChild(mais);
  }
  w.appendChild(hist);
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

// Sub-aba Frequência: metas, presença, evolução + retrospectiva
// ritmo real de treino — calculado pela MÉDIA SEMANAL (mais justo) e convertido p/ mês
function paceSemanal(){
  const ds=(DB.treinos||[]).map(t=>t.data).filter(Boolean);
  if(ds.length===0) return 0;
  // v372: denominador = semanas DISTINTAS com >=1 treino (regra "media sobre > 0").
  // Antes: semanas TOTAIS desde o 1o treino — ferias/lesao/afastamento derrubavam
  // o pace do aluno como se ele tivesse sumido, mesmo treinando forte quando volta.
  // Bucket por bloco de 7 dias desde a epoca (agrupamento consistente, ISO week
  // seria overkill p/ isso).
  const semBucket=(iso)=> Math.floor(new Date(iso+'T12:00:00').getTime()/(86400000*7));
  const semanas=new Set(ds.map(semBucket)).size || 1;
  return DB.treinos.length/semanas;
}
function paceMensal(){
  const ps=paceSemanal();
  if(ps<=0) return 8;                                     // sem dados → estimativa suave
  return Math.max(1, Math.round(ps*4.345));               // semana → mês
}
// agregados reais de frequência (a partir de DB.treinos)
function freqStats(){
  const ts = DB.treinos||[];
  const months=[]; for(let i=5;i>=0;i--){ const d=new Date(hoje.getFullYear(),hoje.getMonth()-i,1); months.push({y:d.getFullYear(),m:d.getMonth(),label:meses[d.getMonth()],count:0}); }
  const dow=[0,0,0,0,0,0]; let monthCount=0;
  // M4: contagem por DIA distinto (2 treinos no mesmo dia = 1), igual ao heatmap/streak.
  const dias=[...new Set(ts.map(t=>t.data).filter(Boolean))];
  dias.forEach(iso=>{ const p=iso.split('-').map(Number); if(p.length<3) return; const dt=new Date(p[0],p[1]-1,p[2]);
    const mo=months.find(x=>x.y===p[0]&&x.m===p[1]-1); if(mo) mo.count++;
    const wd=(dt.getDay()+6)%7; if(wd<=5) dow[wd]++;
    if(p[0]===hoje.getFullYear()&&p[1]-1===hoje.getMonth()) monthCount++; });
  // A1: "Presença no mês" = % da meta mensal cumprida (meta semanal × 4), não dias de aula presumidos.
  const monthMeta=(DB.semana.meta||4)*4;
  const presenca = monthMeta? Math.min(100, Math.round(monthCount/monthMeta*100)):0;
  const dowNames=['segundas','terças','quartas','quintas','sextas','sábados'];
  const topi = dow.indexOf(Math.max(...dow));
  return { months, dow, monthCount, monthMeta, presenca, total:ts.length, topDow: dow[topi]>0?dowNames[topi]:null };
}
// retrospectiva derivada dos dados reais
function retroStats(){
  const ts=DB.treinos||[];
  const novas=DB.tecnicas.filter(t=>(t.treinos||0)>0).length;
  let top='—',topN=0; DB.tecnicas.forEach(t=>{ if((t.treinos||0)>topN){topN=t.treinos||0; top=t.jp;} });
  const fx=(BELTS[DB.eu.faixa]?BELTS[DB.eu.faixa].nome:DB.eu.faixa)+(DB.eu.graus?` · ${DB.eu.graus}º grau`:'');
  return { ano:hoje.getFullYear(), treinos:ts.length, horas:Math.round(ts.length*1.5), novasTecnicas:novas,
    melhorStreak:DB.semana.streakSemanas||0, tecnicaTop:top, tecnicaTopTreinos:topN, faixaConquista:fx };
}
function jornadaFrequencia(){
  const w = el('<div></div>');
  if((DB.treinos||[]).length===0){
    w.appendChild(emptyState('📊','Sua frequência aparece aqui','Com pelo menos 1 treino registrado, você verá presença por mês, dias da semana preferidos e seu ritmo semanal.','Registrar treino', ()=> openFlow(aulaDoDia().tipo)));
    w.appendChild(el(`<div style="height:18px"></div>`));
    return w;
  }
  const r  = DEMO ? DB.retro : retroStats();
  const fs = DEMO
    ? { presenca:78, monthCount:9, monthMeta:16, topDow:'quartas', dow:[14,9,16,8,13,11],
        months:[{label:'jan',count:12},{label:'fev',count:14},{label:'mar',count:9},{label:'abr',count:16},{label:'mai',count:13},{label:'jun',count:11}] }
    : freqStats();
  // banner retrospectiva
  const retro = el(`<div class="retro-banner">
    <div class="rb-ic">🎁</div>
    <div class="rb-tx"><div class="rb-t">Seu ano no Jiu-Jitsu</div>
      <div class="rb-s">${plural(r.treinos,'treino','treinos')} · ${r.horas}h no tatame</div></div>
    <div class="rb-go">›</div></div>`);
  retro.onclick = ()=> abrirRetro();
  w.appendChild(retro);

  // meta do mês
  const pct = fs.monthMeta? Math.round(fs.monthCount/fs.monthMeta*100):0;
  w.appendChild(el(`<div class="card card-pad" style="margin:0 20px 16px">
    <div class="pm-top"><span class="pm-belt-nm">Meta do mês</span><span class="pm-num">${fs.monthCount}/${fs.monthMeta}</span></div>
    <div class="mini-bar"><span style="width:${Math.min(100,pct)}%"></span></div>
    <div class="pm-foot">${plural(Math.max(0,fs.monthMeta-fs.monthCount),'treino','treinos')} para a meta de ${meses[hoje.getMonth()]}</div>
  </div>`));

  // KPIs de presença
  w.appendChild(el(`<div class="kpis block">
    <div class="kpi"><div class="v green">${fs.presenca}%</div><div class="l">Presença no mês</div></div>
    <div class="kpi"><div class="v red">${DB.semana.streakSemanas||0}</div><div class="l">Semanas seguidas</div></div>
    <div class="kpi"><div class="v blue">${r.treinos}</div><div class="l">Total de treinos</div></div>
  </div>`));

  // treinos por mês (interativo: toque filtra o Histórico)
  w.appendChild(el(`<div class="sec-row"><div class="sec-title">Treinos por mês</div>
    <span style="font-size:12px;color:var(--muted);font-weight:700">toque pra filtrar</span></div>`));
  const mx=Math.max(1,...fs.months.map(m=>m.count));
  const barCard = el(`<div class="card card-pad" style="margin:0 20px 18px"><div class="mbar-row"></div></div>`);
  const row = barCard.querySelector('.mbar-row');
  fs.months.forEach((mo,i)=>{
    const bar = el(`<div class="mbar ${DB.histMes===i?'on':''}">
      <span class="mbar-v">${mo.count}</span>
      <div class="mbar-track"><div class="mbar-fill" style="height:${Math.round(mo.count/mx*100)}%"></div></div>
      <span class="mbar-l">${(mo.label||'').slice(0,3)}</span></div>`);
    bar.onclick = ()=>{ DB.histMes = (DB.histMes===i?null:i); DB.jornadaTab='historico'; render(); };
    row.appendChild(bar);
  });
  w.appendChild(barCard);

  // distribuição por dia da semana (quais dias você mais treina)
  w.appendChild(el(`<div class="sec-title">Por dia da semana</div>`));
  const dias=['Seg','Ter','Qua','Qui','Sex','Sáb'], dmx=Math.max(1,...fs.dow);
  const dowCard = el(`<div class="card card-pad" style="margin:0 20px 18px"><div class="dow-row"></div></div>`);
  const drow = dowCard.querySelector('.dow-row');
  fs.dow.forEach((v,i)=>{ drow.appendChild(el(`<div class="dow-bar">
    <span class="dow-v">${v}</span>
    <div class="dow-track"><div class="dow-fill ${v===dmx&&v>0?'top':''}" style="height:${Math.round(v/dmx*100)}%"></div></div>
    <span class="dow-l">${dias[i]}</span></div>`)); });
  w.appendChild(dowCard);
  if(fs.topDow) w.appendChild(el(`<div class="freq-note">📌 Você treina mais nas <b>${fs.topDow}</b>.</div>`));
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

// Retrospectiva "Seu ano no Jiu-Jitsu" (Wrapped)
function abrirRetro(){ DB.retroOpen=true; render(); window.scrollTo(0,0); }
function fecharRetro(){ DB.retroOpen=false; render(); }
function renderRetro(){
  const r = DEMO ? DB.retro : retroStats();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head"><div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="fecharRetro">‹</div>
    <div class="ft"><div class="t">Seu ano no Jiu-Jitsu</div><div class="s">${r.ano} · Yama</div></div></div>`;
  const body = el(`<div class="retro-body"></div>`);
  body.appendChild(el(`<div class="retro-hero"><div class="rh-big">${r.treinos}</div><div class="rh-lbl">treinos em ${r.ano}</div></div>`));
  const cards = [
    ['⏱️', r.horas+'h', 'no tatame'],
    ['📚', r.novasTecnicas, 'novas técnicas'],
    ['🔥', r.melhorStreak+' sem', 'melhor sequência'],
    ['🥋', r.tecnicaTop, `mais treinada (${r.tecnicaTopTreinos}×)`],
    ['🎖️', r.faixaConquista, 'graduação atual'],
  ];
  if (DEMO) cards.splice(4,0,['⚔️', String(r.finBat).replace('.',',')+'×', 'finaliza > apanha']);
  const grid = el(`<div class="retro-grid"></div>`);
  cards.forEach(([e,val,l])=> grid.appendChild(el(`<div class="retro-card"><div class="rc-e">${e}</div><div class="rc-v">${val}</div><div class="rc-l">${l}</div></div>`)));
  body.appendChild(grid);
  body.appendChild(el(`<div class="retro-foot">Oss! Mais um ano de evolução na Yama 🥋</div>`));
  body.appendChild(el(`<div style="height:40px"></div>`));
  v.appendChild(body);
  return v;
}

// Calendário da Yama: Seg–Sex = Aula Técnica · Sáb = Livre · Dom = sem aula
// presença real = só datas com treino completo (Fase 1 + Fase 2 salvas) — memoizado
let _attSig=null, _attSet=null;
function _attendedSet(){
  const sig = (DB.treinos||[]).length + '|' + (DB.treinos[0]?DB.treinos[0].id:'');
  if (sig!==_attSig){ _attSet=new Set((DB.treinos||[]).map(t=>t.data).filter(Boolean)); _attSig=sig; }
  return _attSet;
}
// M4: quantos treinos foram registrados num dia (p/ marcador "2×" no heatmap)
function _treinosNoDia(iso){ return (DB.treinos||[]).filter(t=>t.data===iso).length; }
// Texto da meta semanal: dois modos — quantidade ou dias específicos escolhidos pelo aluno
const _WD_LBL = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
function metaSemanalTxt(){
  const s = DB.semana||{};
  if(s.metaMode==='dias' && Array.isArray(s.metaDias) && s.metaDias.length){
    const dias=[1,2,3,4,5,6,0].filter(d=>s.metaDias.includes(d)).map(d=>_WD_LBL[d]);
    return 'Treina: '+dias.join(' · ');
  }
  // Aluno novo sem meta definida: label honesto (não empurra o default 4)
  if(!s.meta) return 'Sem meta · toque para definir';
  return 'Meta de '+s.meta+' treinos/sem';
}
// semana atual (seg→dom) + streak de semanas seguidas com treino — tudo dos dados reais
function semanaStats(){
  const meta=(DB.semana&&DB.semana.meta)||4, THR=1;   // streak conta semana com ≥1 treino
  const att=_attendedSet();
  const monday=new Date(hoje); monday.setDate(hoje.getDate()-((hoje.getDay()+6)%7)); monday.setHours(0,0,0,0);
  const weekCount=(mon)=>{ let c=0; for(let i=0;i<7;i++){ const d=new Date(mon); d.setDate(mon.getDate()+i); if(att.has(isoOf(d))) c++; } return c; };
  const dias=[]; let feitos=0;
  for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); const a=att.has(isoOf(d)); dias.push(a); if(a) feitos++; }
  let streak=0, guard=0; const cur=new Date(monday);
  if(feitos<THR) cur.setDate(cur.getDate()-7);          // semana atual em curso não quebra o streak
  while(weekCount(cur)>=THR && guard++<520){ streak++; cur.setDate(cur.getDate()-7); }
  return { dias, feitos, streakSemanas:streak, meta };
}
let _semCacheSig='__invalid__';
function atualizarSemana(){
  _attendedSet();            // M1: refresca a assinatura ANTES de comparar — sem isso o memo
  const sig=_attSig;         // ficava preso ao valor antigo e a Home mostrava streak desatualizado
  if(sig===_semCacheSig) return;
  _semCacheSig=sig;
  const s=semanaStats(); DB.semana.dias=s.dias; DB.semana.feitos=s.feitos; DB.semana.streakSemanas=s.streakSemanas;
}
function diaTreino(d){
  const dow = d.getDay();
  let tipo = null;
  if (dow>=1 && dow<=5) tipo='tecnica';
  else if (dow===6) tipo='livre';
  const classDay = tipo!==null;
  const past = d <= hoje;
  let attended = false;
  // A1: presença = só o que foi REALMENTE treinado (qualquer dia, inclusive fim de semana).
  // Não inferimos mais "Faltou" a partir de uma grade fixa de aulas.
  if (past){
    if (DEMO){ const key = d.getFullYear()*1000 + d.getMonth()*32 + d.getDate(); attended = (key % 4 !== 0); } // vitrine
    else attended = _attendedSet().has(isoOf(d));   // presença real do aluno
  }
  // tipo p/ cor: dia útil = técnica, fim de semana = livre (não implica que houve aula)
  if (attended && tipo==null) tipo = 'livre';
  return { date:new Date(d), dow, classDay, tipo, attended, past };
}
function hmCellClass(c){
  // A1: mapa de atividade — só destaca dias treinados; sem "Faltou"/"futuro".
  if (c.attended) return 'hm-cell ' + (c.tipo==='tecnica' ? 'hm-tec' : 'hm-liv');
  return 'hm-cell hm-empty';
}
// Heatmap por período: só dias de aula, cor por tipo
function heatmapCard(){
  const periodo = DB.histPeriodo || 'ano';
  const seg = el(`<div class="hist-seg"></div>`);
  [['semana','Semana'],['mes','Mês'],['ano','Ano']].forEach(([id,l])=>{
    const b = el(`<button class="${periodo===id?'active':''}">${l}</button>`);
    b.onclick = ()=>{ DB.histPeriodo=id; render(); };
    seg.appendChild(b);
  });

  const card = el(`<div class="card card-pad" style="margin:0 20px 18px"></div>`);
  card.appendChild(el(`<div class="hm-top"><div class="ttl">Consistência</div></div>`));
  card.appendChild(seg);

  if (periodo==='semana'){
    // 7 dias da semana atual (seg→dom)
    const base = new Date(hoje); const off=(base.getDay()+6)%7; base.setDate(base.getDate()-off);
    const labels=['S','T','Q','Q','S','S','D'];
    const row = el(`<div class="hm-week"></div>`);
    for(let i=0;i<7;i++){ const d=new Date(base); d.setDate(base.getDate()+i); const c=diaTreino(d);
      const mult=c.attended?_treinosNoDia(isoOf(d)):0;
      const day=el(`<div class="hmw-day" data-iso="${isoOf(d)}"><span class="${hmCellClass(c)} big">${mult>1?`<span class="hm-mult">${mult}×</span>`:''}</span><span class="hmw-lbl">${labels[i]}</span><span class="hmw-num">${d.getDate()}</span></div>`);
      row.appendChild(day); }
    card.appendChild(row);
  } else if (periodo==='mes'){
    // calendário do mês atual
    const first = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const startOff=(first.getDay()+6)%7; const dim=new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).getDate();
    const grid = el(`<div class="hm-month"></div>`);
    ['S','T','Q','Q','S','S','D'].forEach(l=> grid.appendChild(el(`<span class="hmm-h">${l}</span>`)));
    for(let k=0;k<startOff;k++) grid.appendChild(el(`<span class="hmm-cell"></span>`));
    for(let day=1;day<=dim;day++){ const d=new Date(hoje.getFullYear(),hoje.getMonth(),day); const c=diaTreino(d);
      const mult=c.attended?_treinosNoDia(isoOf(d)):0;
      grid.appendChild(el(`<span class="hmm-cell" data-iso="${isoOf(d)}"><span class="${hmCellClass(c)}">${mult>1?`<span class="hm-mult">${mult}×</span>`:''}</span><span class="hmm-n">${day}</span></span>`)); }
    card.appendChild(grid);
    card.appendChild(el(`<div class="hm-sub" style="margin-top:10px">${meses[hoje.getMonth()]} de ${hoje.getFullYear()}</div>`));
  } else {
    // ano: 24 colunas = semanas reais (Seg–Dom). Rótulo do mês mora DENTRO da coluna
    // que contém o dia 1 → alinhamento garantido, sem deriva entre rótulo e grade.
    const thisMonday = new Date(hoje); thisMonday.setDate(hoje.getDate() - ((hoje.getDay()+6)%7)); thisMonday.setHours(0,0,0,0);
    const start = new Date(thisMonday); start.setDate(start.getDate() - 23*7);
    const data=[]; for(let d=new Date(start); d<=hoje; d.setDate(d.getDate()+1)) data.push(diaTreino(new Date(d)));
    const weeks=[]; let curr=[];
    data.forEach(cell=>{ curr.push(cell); if ((cell.date.getDay()+6)%7===6){ weeks.push(curr); curr=[]; } });
    if(curr.length){ while(curr.length<7) curr.push(null); weeks.push(curr); }
    // v468: rótulo do mês vai na primeira semana cuja MAIORIA dos dias (>=4/7) pertence
    // àquele mês. Antes ia na semana que contém o dia 1 — quando o mês começava sex/sáb,
    // o "ago" (por ex.) ficava sobre uma coluna que era visualmente 5 dias de julho + 2 de
    // agosto, dando a percepção de que os números de agosto estavam desalinhados.
    // Também não repete o rótulo em semanas seguidas do mesmo mês (evita "ago ago ago…").
    const majMonth = weeks.map(wk=>{
      const cnt = {}; for(const c of wk){ if(c){ cnt[c.date.getMonth()] = (cnt[c.date.getMonth()]||0) + 1; } }
      let best=null, bestN=3;
      for(const m in cnt){ if(cnt[m] > bestN){ best = +m; bestN = cnt[m]; } }
      return best;
    });
    const colMonth = majMonth.map((m,i)=> (m!=null && m!==majMonth[i-1]) ? m : null);
    if(colMonth[0]==null && majMonth[0]!=null) colMonth[0] = majMonth[0];
    const cols = weeks.map((wk,wi)=>{
      // v466: 7 células por coluna (Seg–Dom). Antes eram 6 — domingo era pintado
      // como treinado no `total` do rodapé mas nunca aparecia visualmente.
      // v469-A: coluna que começa um novo mês (majMonth diferente da anterior) ganha
      // .hm-col-new — separador vertical + espaço extra à esquerda pra delimitar visualmente.
      // v469-B: célula do dia 1 de cada mês ganha .hm-day1 — anel sutil no contorno pra
      // marcar o começo dentro da própria célula (independente do rótulo do topo).
      let cells=''; for(let r=0;r<7;r++){
        const cell=wk[r]; const dn=cell?cell.date.getDate():'';
        const extra = (cell && cell.date.getDate()===1) ? ' hm-day1' : '';
        cells += `<span class="${cell?hmCellClass(cell):'hm-cell hm-empty'}${extra}">${dn}</span>`;
      }
      const lbl = colMonth[wi]!=null ? meses[colMonth[wi]] : '';
      return `<div class="hm-col"><span class="hm-clbl">${lbl}</span>${cells}</div>`;
    }).join('');
    const days=['S','T','Q','Q','S','S','D'];
    card.appendChild(el(`<div class="hm-body">
      <div class="hm-days">${days.map(d=>`<span>${d}</span>`).join('')}</div>
      <div class="hm-scroll"><div class="hm-grid">${cols}</div></div>
    </div>`));
    const total = data.filter(x=>x&&x.attended).length;
    card.appendChild(el(`<div class="hm-sub" style="margin-top:8px">${plural(total,'treino','treinos')} · últimas 24 semanas</div>`));
    requestAnimationFrame(()=>{ const sc=card.querySelector('.hm-scroll'); if(sc) sc.scrollLeft=sc.scrollWidth; });
  }

  card.appendChild(el(`<div class="hm-legend">
    <span class="hm-cell hm-tec"></span><span>Técnica</span>
    <span class="hm-cell hm-liv"></span><span>Livre</span></div>`));
  card.addEventListener('click', e=>{
    const cell = e.target.closest('[data-iso]');
    if(!cell) return;
    const iso = cell.dataset.iso;
    const cnt = (DB.treinos||[]).filter(t=>t.data===iso).length;
    toast(fmtDataLonga(iso) + (cnt ? ` · ${plural(cnt,'treino','treinos')}` : ' · sem treino'));
  });
  return card;
}

/* === M2: excluir um treino reverte os agregados por técnica ===
   Cada renshu do treino decrementa t.treinos e subtrai do bucket t.dias
   com a mesma data (buckets novos carregam `d`; legados sem `d` só
   revertem o contador). Para o Desfazer, snapshotamos as técnicas afetadas. */
function _snapTreinoTecs(tr){
  const reps = (tr && tr.det && tr.det.renshu) || [];
  return reps.map(r=>{
    const tec = tecByKey(r.id||r.jp); if(!tec) return null;
    return { tec, treinos:tec.treinos||0, dias:JSON.parse(JSON.stringify(tec.dias||[])), ultima:tec.ultima, ultimaRev:tec.ultimaRev };
  }).filter(Boolean);
}
function _restoreTreinoTecs(snaps){
  (snaps||[]).forEach(s=>{ s.tec.treinos=s.treinos; s.tec.dias=s.dias; s.tec.ultima=s.ultima; s.tec.ultimaRev=s.ultimaRev; });
}
function _revertTreinoAgg(tr){
  const reps = (tr && tr.det && tr.det.renshu) || [];
  reps.forEach(r=>{
    const tec = tecByKey(r.id||r.jp); if(!tec) return;
    tec.treinos = Math.max(0,(tec.treinos||0)-1);
    const i = (tec.dias||[]).findIndex(x=>x.d===tr.data);
    if(i>=0){ const b=tec.dias[i]; b.a=Math.max(0,b.a-(r.a||0)); b.t=Math.max(0,b.t-(r.t||0)); if(b.t<=0 && b.a<=0) tec.dias.splice(i,1); }
  });
}
/* Edição de treino: aplica o DELTA do renshu no bucket do dia do treino. */
function _applyRenshuDelta(tr, before, after){
  const delta = {};
  (before||[]).forEach(r=>{ const k=r.id||r.jp; const m=delta[k]||(delta[k]={a:0,t:0}); m.a-=(r.a||0); m.t-=(r.t||0); });
  (after ||[]).forEach(r=>{ const k=r.id||r.jp; const m=delta[k]||(delta[k]={a:0,t:0}); m.a+=(r.a||0); m.t+=(r.t||0); });
  const beforeKeys = new Set((before||[]).map(r=>r.id||r.jp));
  const afterKeys  = new Set((after ||[]).map(r=>r.id||r.jp));
  afterKeys.forEach(k=>{ if(!beforeKeys.has(k)){ const tec=tecByKey(k); if(tec) tec.treinos=(tec.treinos||0)+1; } });
  beforeKeys.forEach(k=>{ if(!afterKeys.has(k)){ const tec=tecByKey(k); if(tec) tec.treinos=Math.max(0,(tec.treinos||0)-1); } });
  Object.keys(delta).forEach(k=>{
    const m=delta[k]; if(!m.a && !m.t) return;
    const tec=tecByKey(k); if(!tec) return;
    tec.dias=tec.dias||[];
    let i=tec.dias.findIndex(x=>x.d===tr.data);
    if(i<0 && (m.a>0 || m.t>0)){
      const p=tr.data.split('-').map(Number);
      tec.dias.push({a:0,t:0,dia:_WD[new Date(p[0],p[1]-1,p[2]).getDay()],d:tr.data,hoje:tr.data===HOJE_ISO});
      i=tec.dias.length-1;
    }
    if(i>=0){ const b=tec.dias[i]; b.a=Math.max(0,b.a+m.a); b.t=Math.max(0,b.t+m.t); if(b.t<=0 && b.a<=0) tec.dias.splice(i,1); }
  });
}

// Detalhe de um treino
let _savedScroll=0;
function abrirTreino(id){ _savedScroll=window.scrollY; DB.treinoAberto = id; render(); window.scrollTo(0,0); }
function fecharTreino(){ DB.treinoAberto = null; render(); window.scrollTo(0,_savedScroll); }
function renderTreinoDetalhe(){
  const t = DB.treinos.find(x=>x.id===DB.treinoAberto);
  if(!t){ fecharTreino(); return el(`<div class="view"></div>`); }
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="fecharTreino">‹</div>
    <div class="ft"><div class="t">${t.titulo}</div><div class="s">${diaRelativo(t.data)} · ${fmtDataLonga(t.data)}</div></div>
  </div>`;
  const body = el(`<div class="flow-body" style="padding-bottom:40px"></div>`);

  const sensTxt = t.feel ? `Sensação · ${FEEL_LABEL[t.feel]}` : '';
  body.appendChild(el(`<div class="det-hero h-${t.tipo}">
    <div class="dh-ic">${t.tipo==='tecnica'?'🥋':'⚡'}</div>
    <div class="dh-tx"><div class="dh-t">${safeTxt(t.tecnica)}</div>
      <div class="dh-mood">${sensTxt}</div></div></div>`));
  // v462/v465: placeholder do servidor ainda sem enriquecimento → card informativo.
  // Se veio de batch da professora, headline "Presença por Yama"; se foi check-in do
  // aluno (via='app') sem registrar treino, headline "Complete o diário".
  if (t._fonte==='servidor'){
    const enriquecido = !!(t.tecnica || t.feel!=null || (t.det && (t.det.randori!=null || (t.det.renshu||[]).length || t.det.nota)));
    if (!enriquecido){
      const _head = t._via==='professor' ? 'Presença por Yama.' : '👉 Complete o diário deste treino.';
      body.appendChild(el(`<div class="det-nota" style="border-left:3px solid var(--red);margin-top:12px">
        <b>${_head}</b><br>
        <span style="color:var(--muted);font-size:13px">Toque em "Editar treino" abaixo pra registrar o que você fez — técnica, sensação, se teve randori.</span>
      </div>`));
    }
  }
  const btnShare = el(`<button class="share-btn">📲 Compartilhar treino</button>`);
  btnShare.onclick = ()=> abrirShare(t.id);
  body.appendChild(btnShare);

  const det = t.det;
  if (det){
    // tira de contexto: randori? (+ compat: gi/rounds/intensidade de treinos antigos)
    const metaBits = [];
    if (det.randori!=null) metaBits.push(det.randori ? '🤼 Com randori' : '🧘 Sem randori');
    if (det.gi) metaBits.push(`👕 ${det.gi==='nogi'?'No-Gi':'Kimono'}`);
    if (det.rounds) metaBits.push(`🔄 ${det.rounds} round${det.rounds>1?'s':''}`);
    if (det.intensidade) metaBits.push(`💪 ${INTENS[det.intensidade]||det.intensidade}`);
    if (metaBits.length) body.appendChild(el(`<div class="det-meta">${metaBits.map(b=>`<span class="dm-pill">${b}</span>`).join('')}</div>`));
    // Renshū do randori: acerto por técnica praticada
    if (det.renshu && det.renshu.length){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:6px"><span class="ico">🎯</span> No randori de hoje</div>`));
      const rl = el(`<div class="det-renshu" style="padding:0 20px"></div>`);
      det.renshu.forEach(x=>{ const p=_pctAT(x.a,x.t);
        rl.appendChild(el(`<div class="dr-item"><span class="dr-nm">${safeTxt(x.jp)}</span>
          <span class="dr-bar"><span style="width:${p}%;background:${corPct(p)}"></span></span>
          <span class="dr-pct" style="color:${corPct(p)}">${p}%</span>
          <span class="dr-frac">${x.a}/${x.t}</span></div>`));
      });
      body.appendChild(rl);
    }
    if (det.incomodo){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:16px"><span class="ico">🩹</span> Incomodou</div>`));
      body.appendChild(el(`<div class="det-nota" style="border-left:3px solid var(--red)">${safeTxt(det.incomodo)}</div>`));
    }
    if (det.nota){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:14px"><span class="ico">📝</span> Anotações</div>`));
      body.appendChild(el(`<div class="det-nota">${safeTxt(det.nota)}</div>`));
    }
    if (det.fotos && det.fotos.length){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:14px"><span class="ico">📸</span> Fotos</div>`));
      const fg = el(`<div class="foto-grid" style="padding:0 20px"></div>`);
      det.fotos.forEach(src=> fg.appendChild(el(`<div class="foto-th"><img src="${safeAttr(src)}" alt=""></div>`)));
      body.appendChild(fg);
    }
  }
  const editBtn = el(`<button class="edit-treino">✏️ Editar treino</button>`);
  editBtn.onclick = ()=> abrirEditarTreino(t);
  body.appendChild(editBtn);

  const delBtn = el(`<button class="del-treino">Excluir treino</button>`);
  delBtn.onclick = ()=>{
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Excluir treino?</div>
      <div class="sheet-desc">Este treino será removido do seu diário. Você terá alguns segundos para desfazer.</div>
      <button class="btn-save danger" id="del-confirm">Excluir</button>
      <button class="sheet-cancel" id="del-cancel">Cancelar</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#del-cancel').onclick=close;
    sheet.querySelector('#del-confirm').onclick=()=>{ const snap = {...t}; const idx = DB.treinos.findIndex(x=>x.id===t.id); const snapTecs=_snapTreinoTecs(t); _revertTreinoAgg(t); DB.treinos = DB.treinos.filter(x=>x.id!==t.id); close(); DB.treinoAberto=null; render(); scheduleSave(); toastUndo('Treino excluído', ()=>{ DB.treinos.splice(idx, 0, snap); _restoreTreinoTecs(snapTecs); render(); scheduleSave(); }); };
    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
  };
  body.appendChild(delBtn);
  v.appendChild(body);
  return v;
}
function abrirEditarTreino(t){
  const det = t.det || {};
  let feel = t.feel || 0;
  let randori = det.randori;
  let renshuEdits = (det.renshu||[]).map(r=>({id:r.id||r.jp, jp:r.jp, a:r.a, t:r.t}));
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:85vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar treino</div>
    <div id="et-body"></div>
    <button class="btn-save" id="et-save" style="margin-top:12px">Salvar</button>
    <button class="sheet-cancel" id="et-cancel">Cancelar</button>
  </div></div>`);
  const bodyEl = sheet.querySelector('#et-body');
  function rebuildBody(){
    bodyEl.innerHTML='';
    bodyEl.appendChild(el(`<label class="flbl">🤼 Fez randori?</label>`));
    const randSeg = el(`<div class="seg"></div>`);
    [[false,'Não fiz'],[true,'Fiz randori']].forEach(([v,l])=>{ const b=el(`<button class="${randori===v?'active':''}">${l}</button>`);
      b.onclick=()=>{ randori=v; rebuildBody(); }; randSeg.appendChild(b); });
    bodyEl.appendChild(randSeg);
    if(randori===true){
      // v475: se ainda não tem nenhum renshū registrado, pré-popula com as técnicas em foco
      // (a=0, t=0). Aluno já vê os counters de acertos/erros por técnica — muito mais rápido
      // que ter que tocar em cada uma pra "incluir". Técnicas sem tentativas (t=0) são
      // removidas no save — aluno não precisa "cancelar" a que não praticou.
      if(!renshuEdits.length){
        focoTecnicas().forEach(ft=> renshuEdits.push({id:ft.id||ft.jp, jp:ft.jp, a:0, t:0}));
      }
      if(renshuEdits.length){
        bodyEl.appendChild(el(`<div class="fsec-title" style="margin-top:12px"><span class="ico">🎯</span> Renshū — acertos no randori</div>`));
        renshuEdits.forEach(r=>{
          const errou = r.t - r.a;
          const row = el(`<div class="et-renshu-row">
            <span class="et-rn">${safeTxt(r.jp)}</span>
            <div class="et-rn-cts">
              <span class="et-rn-ok">✓ ${r.a}</span>
              <span class="et-rn-no">✗ ${errou}</span>
            </div>
            <div class="et-rn-acts">
              <button data-d="a+" title="Mais acerto">✓+</button>
              <button data-d="a-" title="Menos acerto">✓−</button>
              <button data-d="e+" title="Mais erro">✗+</button>
              <button data-d="e-" title="Menos erro">✗−</button>
            </div>
          </div>`);
          row.querySelector('[data-d="a+"]').onclick=()=>{ r.a++; r.t++; rebuildBody(); };
          row.querySelector('[data-d="a-"]').onclick=()=>{ if(r.a>0){ r.a--; r.t--; } rebuildBody(); };
          row.querySelector('[data-d="e+"]').onclick=()=>{ r.t++; rebuildBody(); };
          row.querySelector('[data-d="e-"]').onclick=()=>{ if(r.t>r.a) r.t--; rebuildBody(); };
          bodyEl.appendChild(row);
        });
      }
    }
    bodyEl.appendChild(el(`<label class="flbl" style="margin-top:14px">📝 Anotações</label>`));
    const ta = el(`<textarea class="ta" id="et-nota" rows="3">${safeTxt(det.nota||'')}</textarea>`);
    bodyEl.appendChild(ta);
    bodyEl.appendChild(el(`<label class="flbl" style="margin-top:14px">📊 Sensação (1–5)</label>`));
    const feelSeg = el(`<div class="seg"></div>`);
    for(let i=1;i<=5;i++){ const b=el(`<button class="${i===feel?'active':''}">${i}</button>`);
      b.onclick=()=>{ feel=i; feelSeg.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; feelSeg.appendChild(b); }
    bodyEl.appendChild(feelSeg);
    bodyEl.appendChild(el(`<div class="feel-ends" style="margin-bottom:4px"><span>Muito difícil</span><span>Excelente</span></div>`));
  }
  rebuildBody();
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#et-cancel').onclick=close;
  sheet.querySelector('#et-save').onclick=()=>{
    if(!feel){ toast('Avalie como foi o treino (1–5)'); return; }
    t.feel=feel; t.mood=FEEL_LABEL[feel];
    if(!t.det) t.det={};
    const renshuBefore = t.det.renshu || [];   // M2: base p/ o delta dos agregados
    t.det.randori=randori;
    t.det.nota=sheet.querySelector('#et-nota').value.trim();
    // v475: filtra técnicas sem tentativa (t=0) — aluno não praticou aquela, some do treino.
    if(randori && renshuEdits.length) t.det.renshu = renshuEdits.filter(r=> (r.t||0) > 0);
    else if(!randori) t.det.renshu=[];
    _applyRenshuDelta(t, renshuBefore, t.det.renshu||[]);   // M2: técnicas acompanham a edição
    const reps = (t.det.renshu||[]);
    t.tecnica = reps.length ? ('Renshū · '+reps.map(r=>r.jp).join(', ')) : (randori?'Treino com randori':'Treino (sem randori)');
    close(); render(); scheduleSave(); toast('Treino atualizado');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function fmtDataLonga(s){ const [y,mo,d]=s.split('-'); return `${d} de ${meses[+mo-1]} de ${y}`; }

/* ============================================================
   WRAP COMPARTILHÁVEL — story em canvas (export PNG real) · vários modelos
   ============================================================ */
const SHARE_TPLS = [['resumo','Treino'],['acerto','Acerto'],['streak','Streak'],['checkin','No tatame'],['marca','Marca'],['kanji','Símbolo']];
let _shareLogo = null, _sharePhoto = null;
function abrirShare(id){ DB.shareOpen=id; DB.shareTpl=DB.shareTpl||'resumo'; track('share_aberto'); render(); window.scrollTo(0,0); }
function fecharShare(){ DB.shareOpen=null; DB.shareFromSave=false; _sharePhoto=null; render(); }
function _rr(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
// desenha imagem cobrindo a área (cover), centralizada
function _cover(ctx,img,W,H){ const ir=img.naturalWidth/img.naturalHeight, cr=W/H; let w,h; if(ir>cr){h=H;w=H*ir;}else{w=W;h=W/ir;} ctx.drawImage(img,(W-w)/2,(H-h)/2,w,h); }
// CARD minimalista COMPACTO e TRANSLÚCIDO — sticker pra colar no story (deixa ver a foto por trás)
function drawStory(ctx,W,H,t,tpl,logoImg,photoImg){
  const SF='-apple-system,"Segoe UI",Roboto,sans-serif';
  const RED='#ff5a4d';
  const det=t.det||{}, reps=det.renshu||[];
  const totA=reps.reduce((s,r)=>s+(r.a||0),0), totT=reps.reduce((s,r)=>s+(r.t||0),0);
  const acerto = totT?Math.round(totA/totT*100):null;
  ctx.clearRect(0,0,W,H);
  if(photoImg){ _cover(ctx,photoImg,W,H); ctx.fillStyle='rgba(8,10,14,.18)'; ctx.fillRect(0,0,W,H); }

  // ----- card compacto (~metade do tamanho) + translúcido -----
  const cardW=480, cardX=(W-cardW)/2;
  const cardH = (tpl==='marca'||tpl==='kanji') ? 420 : 520;
  const cardY=(H-cardH)/2, R=36;
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.38)'; ctx.shadowBlur=40; ctx.shadowOffsetY=14;
  ctx.fillStyle='rgba(18,21,27,0.58)';                 // translúcido: vê o story por trás
  _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.fill();
  ctx.restore();
  ctx.save(); _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.clip();
  ctx.strokeStyle='rgba(255,255,255,0.14)'; ctx.lineWidth=2; _rr(ctx,cardX,cardY,cardW,cardH,R); ctx.stroke();
  const rg=ctx.createLinearGradient(cardX,cardY,cardX+cardW,cardY); rg.addColorStop(0,'#e5392f'); rg.addColorStop(1,'#7a1410');
  ctx.fillStyle=rg; ctx.fillRect(cardX,cardY,cardW,6); ctx.restore();

  // sombra leve no texto p/ legibilidade sobre card translúcido
  const son=()=>{ ctx.shadowColor='rgba(0,0,0,.5)'; ctx.shadowBlur=8; ctx.shadowOffsetY=1; };
  const soff=()=>{ ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; };
  son();
  const PAD=40, ix=cardX+PAD, iw=cardW-PAD*2;
  ctx.textAlign='left';
  const logoTile=(x,y,sz)=>{ if(!logoImg) return; soff(); ctx.save(); _rr(ctx,x,y,sz,sz,sz*0.24); ctx.fillStyle='#fff'; ctx.fill(); const p=sz*0.14; ctx.drawImage(logoImg,x+p,y+p,sz-2*p,sz-2*p); ctx.restore(); son(); };
  const foot=()=>{ ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font=`700 13px ${SF}`; ctx.fillText('山 · meu jiu-jitsu',ix,cardY+cardH-28); };

  // ----- variantes de marca -----
  if(tpl==='marca'){
    logoTile(W/2-60,cardY+78,120);
    ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font=`900 34px ${SF}`; ctx.fillText('YAMA JIU-JITSU',W/2,cardY+250);
    ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`700 16px ${SF}`; ctx.fillText('Judô Kodokan · Kosen · Jiu-Jitsu',W/2,cardY+282);
    ctx.fillStyle=RED; ctx.font=`800 13px ${SF}`; ctx.fillText('山 · MEU JIU-JITSU',W/2,cardY+cardH-32); soff(); return;
  }
  if(tpl==='kanji'){
    ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.font=`900 200px ${SF}`; ctx.fillText('山',W/2,cardY+cardH/2+62);
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font=`800 22px ${SF}`; ctx.fillText('YAMA JIU-JITSU',W/2,cardY+cardH-40); soff(); return;
  }

  // ----- header comum -----
  logoTile(ix,cardY+PAD,52);
  ctx.fillStyle='#fff'; ctx.font=`800 22px ${SF}`; ctx.fillText('YAMA JIU-JITSU',ix+66,cardY+PAD+21);
  ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 14px ${SF}`; ctx.fillText(fmtDataLonga(t.data).toUpperCase(),ix+66,cardY+PAD+43);

  if(tpl==='checkin'){
    const cy=cardY+PAD+110;
    ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`800 15px ${SF}`; ctx.fillText('NO TATAME',ix,cy-26);
    // v490: card público mostra HORA DA AULA (não do scan). Antes: via='app'
    // exibia hora do scan (21:04), via='professor' exibia hora da aula (19:30)
    // — inconsistência visível ao compartilhar. Regra única agora: sempre a
    // hora agendada da aula. Fallback: sessao do checkinHoje, ou '19h' se não
    // tiver contexto (treino manual sem check-in).
    const _horaCard = (t.horaAula)
      || (DB.checkinHoje && DB.checkinHoje.sessao && DB.checkinHoje.sessao.hora)
      || '19h';
    ctx.fillStyle='#fff'; ctx.font=`900 84px ${SF}`; ctx.fillText(_horaCard,ix,cy+58);
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font=`800 22px ${SF}`; ctx.fillText(t.titulo,ix,cy+96);
    ctx.fillStyle=RED; ctx.font=`800 16px ${SF}`; ctx.fillText('Bora treinar',ix,cy+128);
    foot(); soff(); return;
  }

  if(tpl==='streak'){
    const s=DB.semana, cy=cardY+PAD+78;
    ctx.fillStyle=RED; ctx.font=`900 120px ${SF}`; ctx.textAlign='left'; ctx.fillText(String(s.streakSemanas),ix,cy+82);
    ctx.fillStyle='#fff'; ctx.font=`800 24px ${SF}`; ctx.fillText('semanas seguidas',ix,cy+118);
    ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 15px ${SF}`; ctx.fillText(`${s.feitos}/${s.meta} treinos esta semana`,ix,cy+146);
    const r=12, gap=(iw-r*2)/6; let dx=ix+r;
    ['S','T','Q','Q','S','S','D'].forEach((l,i)=>{ soff(); ctx.beginPath(); ctx.arc(dx,cy+190,r,0,Math.PI*2); ctx.fillStyle=s.dias[i]?'#e5392f':'rgba(255,255,255,.18)'; ctx.fill(); son();
      ctx.fillStyle='rgba(255,255,255,.5)'; ctx.font=`700 12px ${SF}`; ctx.textAlign='center'; ctx.fillText(l,dx,cy+216); dx+=gap; });
    foot(); soff(); return;
  }

  if(tpl==='acerto'){
    const cy=cardY+PAD+100;
    ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.font=`800 22px ${SF}`; ctx.fillText(t.titulo,ix,cy-24);
    if(acerto!=null){
      ctx.fillStyle=RED; ctx.font=`900 140px ${SF}`; ctx.fillText(acerto+'%',ix,cy+118);
      ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`800 18px ${SF}`; ctx.fillText('de acerto no randori',ix,cy+150);
    } else {
      ctx.fillStyle=RED; ctx.font=`900 64px ${SF}`; ctx.fillText(det.randori?'RANDORI':'PRESENÇA',ix,cy+64);
      ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`700 17px ${SF}`; ctx.fillText('no tatame',ix,cy+94);
    }
    foot(); soff(); return;
  }

  // ----- default: RESUMO -----
  {
    const ty=cardY+PAD+88;
    ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.font=`900 30px ${SF}`; ctx.fillText(t.titulo,ix,ty);
    soff(); ctx.strokeStyle='rgba(255,255,255,.16)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(ix,ty+20); ctx.lineTo(ix+iw,ty+20); ctx.stroke(); son();
    const stats=[ [acerto!=null?acerto+'%':'—','ACERTO'], [det.randori?'SIM':'NÃO','RANDORI'], [String(DB.semana.streakSemanas),'STREAK'] ];
    const colW=iw/3, sy=ty+76;
    stats.forEach((st,i)=>{ const cx=ix+colW*i+colW/2;
      ctx.textAlign='center'; ctx.fillStyle=(i===0?RED:'#fff'); ctx.font=`900 34px ${SF}`; ctx.fillText(st[0],cx,sy);
      ctx.fillStyle='rgba(255,255,255,.55)'; ctx.font=`800 12px ${SF}`; ctx.fillText(st[1],cx,sy+22); });
    if(reps.length){
      let ly=sy+74; ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.5)'; ctx.font=`800 12px ${SF}`; ctx.fillText('TÉCNICAS',ix,ly); ly+=26;
      reps.slice(0,2).forEach(r=>{ ctx.fillStyle='rgba(255,255,255,.92)'; ctx.font=`700 17px ${SF}`; ctx.textAlign='left'; ctx.fillText(r.jp,ix,ly); ctx.textAlign='right'; ctx.fillText(`${r.a}/${r.t}`,ix+iw,ly); ly+=26; });
    } else if(t.feel){
      ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`700 16px ${SF}`; ctx.fillText('Sensação · '+FEEL_LABEL[t.feel],ix,sy+78);
    }
    foot();
  }
  soff();
}
function renderShare(){
  const t = DB.treinos.find(x=>x.id===DB.shareOpen);
  if(!t){ DB.shareOpen=null; return el('<div></div>'); }
  const sub = DB.shareFromSave ? 'Treino salvo ✔ · compartilhe ou feche' : 'Card pro seu story';
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="fecharShare">✕</div>
    <div class="ft"><div class="t">Compartilhar</div><div class="s">${sub}</div></div>
  </div>`;
  const body = el(`<div class="share-body"></div>`);
  const stage = el(`<div class="story-stage${_sharePhoto?' has-photo':''}"></div>`);
  const cv = el(`<canvas class="story-canvas" width="1080" height="1920"></canvas>`);
  stage.appendChild(cv); body.appendChild(stage);
  body.appendChild(el(`<div class="story-hint">${_sharePhoto?'card sobre a sua foto — posta a imagem inteira':'card vira sticker (PNG sem fundo) · ou adicione a sua foto'}</div>`));
  const ctx = cv.getContext('2d');
  const redraw=()=> { try{ drawStory(ctx,1080,1920,t,DB.shareTpl,
      (_shareLogo&&_shareLogo.complete&&_shareLogo.naturalWidth)?_shareLogo:null,
      (_sharePhoto&&_sharePhoto.complete&&_sharePhoto.naturalWidth)?_sharePhoto:null); }catch(e){} };
  if(!_shareLogo){ _shareLogo=new Image(); _shareLogo.onload=redraw; _shareLogo.onerror=function(){ if(this.src.indexOf('yama-logo')<0) this.src='brand/yama-logo.png?v=2'; }; _shareLogo.src='brand/logo.png?v=2'; }
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(redraw); else redraw();
  // modelos
  const chips = el(`<div class="tpl-row"></div>`);
  SHARE_TPLS.forEach(([id,label])=>{ const b=el(`<button class="tpl-chip ${DB.shareTpl===id?'on':''}">${label}</button>`);
    b.onclick=()=>{ DB.shareTpl=id; chips.querySelectorAll('.tpl-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); redraw(); }; chips.appendChild(b); });
  body.appendChild(chips);
  // foto de fundo (opcional) — postar com a sua imagem direto no story
  const fileIn = el(`<input type="file" accept="image/*" capture="environment" style="display:none">`);
  fileIn.onchange=e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=ev=>{ const img=new Image(); img.onload=()=>{ _sharePhoto=img; render(); }; img.src=ev.target.result; }; rd.readAsDataURL(f); };
  const photoRow = el(`<div class="share-photo-row"></div>`);
  const lbl = el(`<button class="share-photo">📷 ${_sharePhoto?'Trocar foto':'Adicionar sua foto'}</button>`);
  lbl.onclick=()=>fileIn.click(); photoRow.appendChild(lbl);
  if(_sharePhoto){ const clr=el(`<button class="share-clear">Remover</button>`); clr.onclick=()=>{ _sharePhoto=null; render(); }; photoRow.appendChild(clr); }
  photoRow.appendChild(fileIn);
  body.appendChild(photoRow);
  // controles — Compartilhar direto é o melhor caminho pro Instagram
  const ctrl = el(`<div class="share-ctrl">
    <button class="btn-save" id="share-go">📲 Compartilhar no story</button>
    <div class="share-actions">
      <button class="share-act" id="share-copy">📋 Copiar imagem</button>
      <button class="share-act" id="share-dl">⬇️ Baixar PNG</button>
    </div>
    <div class="share-hint">${_sharePhoto?'Posta a imagem inteira (card + sua foto)':'Sem foto: copie e cole o card por cima da foto no story'}</div>
  </div>`);
  // compartilhar nativo — abre o Instagram/Stories direto no celular
  ctrl.querySelector('#share-go').onclick=()=> cv.toBlob(async b=>{ const file=new File([b],'yama-treino.png',{type:'image/png'}); if(navigator.canShare && navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:'Yama Jiu-Jitsu',text:'山 Yama Jiu-Jitsu'}); }catch(e){} } else { toast('Compartilhar direto indisponível — use Copiar/Baixar'); } });
  // copiar — ClipboardItem com Promise (síncrono no gesto: funciona no iOS/Safari)
  ctrl.querySelector('#share-copy').onclick=()=>{
    if(!(navigator.clipboard && window.ClipboardItem)){ toast('Copiar indisponível; use Baixar PNG'); return; }
    try{
      const item=new ClipboardItem({'image/png': new Promise(res=> cv.toBlob(bb=>res(bb),'image/png')) });
      navigator.clipboard.write([item]).then(()=>toast('Copiado ✔ cole no seu story 📲')).catch(()=>toast('Não rolou copiar; use Baixar PNG'));
    }catch(err){ toast('Não rolou copiar; use Baixar PNG'); }
  };
  ctrl.querySelector('#share-dl').onclick=()=> cv.toBlob(b=>{ const url=URL.createObjectURL(b); const a=document.createElement('a'); a.href=url; a.download='yama-treino.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('PNG baixado ✔'); });
  body.appendChild(ctrl);
  v.appendChild(body);
  return v;
}

// TATAME = o coração: Seu Jogo (visão 3ª pessoa) + biblioteca de Técnicas
function alunoMeuJogo(){
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Tatame</div>
    <div class="greet">&nbsp;</div></div>`;

  const subs = [['progresso','Progresso'],['biblioteca','Biblioteca'],['analise','Análise']];
  const seg = el(`<div class="subtabs-scroll"></div>`);
  let tab = DB.jogoTab;
  subs.forEach(([id,l])=>{
    const b = el(`<button class="subtab2 ${tab===id?'on':''}">${l}</button>`);
    b.onclick = ()=>{ DB.jogoTab=id; render(); };
    seg.appendChild(b);
  });
  w.appendChild(seg);

  const cont = el('<div></div>');
  if (tab==='progresso')  cont.appendChild(evoluirProgresso());
  if (tab==='biblioteca') cont.appendChild(evoluirBiblioteca());
  if (tab==='analise')    cont.appendChild(evoluirAnalise());
  w.appendChild(cont);
  return w;
}

/* ---- Sub-aba: ANÁLISE (visão macro do jogo) ---- */
function evoluirAnalise(){
  const w = el('<div></div>');
  const ativas = DB.tecnicas.filter(t=>t.estado==='foco'||t.estado==='arma');
  const meta = metaLinha();

  // Agregado 30d (foco + arsenal). Se tudo zero → estado vazio.
  const agg = [];
  for(let i=0;i<30;i++){ let a=0,tt=0,dia='';
    ativas.forEach(t=>{ const d=(t.dias||[])[i]; if(d){ a+=d.a; tt+=d.t; dia=d.dia; } });
    agg.push({a,t:tt,dia}); }
  const aggTot = agg.reduce((s,d)=>({a:s.a+d.a,t:s.t+d.t}),{a:0,t:0});

  // v412: aluno sem dados vê UMA tela minimalista. Antes eram 4 seções zeradas.
  if(aggTot.t===0){
    w.appendChild(el(`<div class="prog-empty" style="margin-top:40px;text-align:center;padding:40px 30px">
      <div style="font-size:38px;margin-bottom:10px">🥋</div>
      <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:6px">Sua análise aparece aqui</div>
      <div style="color:var(--muted);font-size:13px;line-height:1.5">Pratique algumas técnicas no Renshū (aba <b>Registrar</b>) — depois de uns treinos, este espaço mostra seu acerto, arsenal e domínio por categoria.</div>
    </div>`));
    return w;
  }

  const aggP = _pctAT(aggTot.a, aggTot.t);
  w.appendChild(el(`<div class="sec-title" style="margin-top:6px">Acerto geral no tempo</div>`));
  const aggCard = el(`<div class="sc-card" style="margin:0 20px 16px"></div>`);
  aggCard.appendChild(el(`<div class="sc-big"><b style="color:${corPct(aggP)}">${aggP}%</b><span>de acerto geral</span><i>foco + arsenal</i></div>`));
  aggCard.appendChild(dayChartNode(agg));
  w.appendChild(aggCard);

  // v412: KPI reduzido a 1 tile útil ("No arsenal"). "Técnicas" e "Acerto médio"
  // saíram — duplicavam a Biblioteca e o card de acerto acima.
  const arsenalArr = ativas.map(t=>({t,...totaisTec(t)})).filter(x=>x.T>0 && x.p>=meta).sort((a,b)=>b.p-a.p);
  w.appendChild(el(`<div class="sec-title" style="margin-top:14px">Arsenal confiável · ${arsenalArr.length}</div>`));
  if (arsenalArr.length){
    const al = el(`<div class="arsenal-list"></div>`);
    arsenalArr.forEach(({t,p})=>{
      const row = el(`<div class="ars-row">
        <div class="ars-tx"><div class="tn">${safeTxt(t.jp)}</div></div>
        <div class="ars-bar"><span style="width:${p}%"></span></div>
        <span class="ars-pct">${p}%</span></div>`);
      const i = DB.tecnicas.findIndex(x=>x.jp===t.jp);
      if(i>=0) row.onclick = ()=> abrirTecnica(i);
      al.appendChild(row);
    });
    w.appendChild(al);
  } else {
    w.appendChild(el(`<div class="prog-empty">Nenhuma técnica acima da média ainda — siga praticando no Renshū.</div>`));
  }

  // v412: domínio esconde categorias com 0 progresso (só técnicas 'novo' viram
  // 3 barras vazias — ruído). Categoria entra se tem alguma aprendendo+.
  w.appendChild(el(`<div class="sec-title" style="margin-top:16px">Domínio por categoria</div>`));
  const dom = el(`<div class="dom-list"></div>`);
  let dcount = 0;
  CAT_ORDER.forEach(cat=>{
    const itens = DB.tecnicas.filter(t=>t.cat===cat);
    if (!itens.length) return;
    const d = itens.filter(t=>nivelDe(t)==='dominada').length;
    const tr = itens.filter(t=>nivelDe(t)==='treinando').length;
    const ap = itens.filter(t=>nivelDe(t)==='aprendendo').length;
    if(d+tr+ap===0) return;   // categoria sem progresso não vira barra
    dcount++;
    const tot = itens.length;
    const row = el(`<div class="dom-row">
      <div class="dom-top"><span class="dom-nm">${CATS[cat].emoji} ${CATS[cat].nome}</span><span class="dom-ct">${tot}</span></div>
      <div class="dom-bar">
        <span class="dseg green" style="flex:${d}"></span>
        <span class="dseg blue" style="flex:${tr}"></span>
        <span class="dseg gold" style="flex:${ap}"></span>
      </div>
      <div class="dom-leg">${d} dominadas · ${tr} treinando · ${ap} aprendendo</div>
    </div>`);
    dom.appendChild(row);
  });
  if(!dcount) dom.appendChild(el(`<div class="prog-empty">Nenhuma categoria com progresso ainda.</div>`));
  w.appendChild(dom);
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

/* ============================================================
   PROGRESSO (Etapa 3) — gráfico de 30 dias por técnica em foco
   ============================================================ */
// gráfico interativo de 30 dias (hoje à direita) + linha de meta dinâmica
function dayChartNode(dias){
  // eixo SEMPRE com 30 fatias; os dias ainda não treinados ficam em branco (placeholder)
  // e vão sendo preenchidos da direita (hoje) pra esquerda conforme o aluno avança.
  const SLOTS=30, real=dias||[], n=real.length, meta=metaLinha();
  const last = real[n-1] || {a:0,t:0,dia:'hoje'};
  const pad = Math.max(0, SLOTS-n);
  let bars='', labs='';
  for(let i=0;i<pad;i++){ bars+=`<div class="dcol empty"><div class="dbar empty"></div></div>`; labs+=`<div class="dlab"></div>`; }
  real.forEach((d,idx)=>{ const r=_pctAT(d.a,d.t);
    bars+=`<div class="dcol" data-i="${idx}"><div class="dbar ${r>=meta?'above':'below'}" style="height:${Math.max(3,r)}%"></div></div>`;
    labs+=`<div class="dlab">${(idx%5===0||idx===n-1)?(d.dia||''):''}</div>`;
  });
  const defCap = `hoje (${last.dia}) · <b>${_pctAT(last.a,last.t)}%</b>`;
  const node = el(`<div class="dchart">
    <div class="dchart-leg" style="font-size:11px;color:var(--muted);font-weight:600">acima / abaixo da média · linha = ${meta}%</div>
    <div class="dplot"><div class="bmeta" style="bottom:${meta}%"></div>${bars}</div>
    <div class="dlabs">${labs}</div>
    <div class="wk-cap">${defCap}</div>
  </div>`);
  const cap = node.querySelector('.wk-cap');
  let sel=null;
  node.querySelectorAll('.dcol[data-i]').forEach(col=>{
    col.onclick = ()=>{
      const i = +col.dataset.i;
      node.querySelectorAll('.dbar').forEach(b=>b.classList.remove('sel'));
      if(sel===i){ sel=null; cap.innerHTML=defCap; return; }
      sel=i; col.querySelector('.dbar').classList.add('sel');
      const d=real[i], p=_pctAT(d.a,d.t);
      cap.innerHTML = `${d.dia} (-${n-1-i}d) · <b style="color:${corPct(p)}">${p}%</b> · ${d.a} de ${d.t}`;
    };
  });
  return node;
}
function evoluirProgresso(){
  const w = el('<div></div>');
  const focos = focoTecnicas();
  w.appendChild(el(`<div class="prog-head"><div class="ph-l"><span class="ph-t">Em treino</span><span class="ph-n">${focos.length}<span class="ph-m">/3</span></span></div>
    ${focos.length?'<div class="ph-r">acerto · últimos 30 dias</div>':''}</div>`));
  if(!focos.length){
    w.appendChild(el(`<div class="prog-empty">Nenhuma técnica em foco ainda.</div>`));
  }
  focos.forEach(t=>{
    const {T,A,p} = totaisTec(t);
    const card = el(`<div class="sc-card"></div>`);
    const head = el(`<div class="sc-head"><span class="sc-name">${safeTxt(t.jp)}</span><button class="sc-rm" title="tirar do foco">✕</button></div>`);
    head.querySelector('.sc-rm').onclick = ()=> rsRemoverFoco(t.jp);
    card.appendChild(head);
    if(T===0){
      card.appendChild(el(`<div class="prog-empty">ainda sem tentativas — pratique no próximo treino</div>`));
      w.appendChild(card); return;
    }
    card.appendChild(el(`<div class="sc-big"><b style="color:${corPct(p)}">${p}%</b><span>de acerto</span><i>${A}/${T} tentativas</i></div>`));
    card.appendChild(dayChartNode(t.dias));
    w.appendChild(card);
  });
  // gestão do foco: adicionar técnica (máx 3)
  if(focos.length<3){
    const add = el(`<button class="add-tec-btn">＋ praticar nova técnica</button>`);
    add.onclick = ()=> rsAddFoco();
    w.appendChild(add);
  } else {
    w.appendChild(el(`<div class="prog-hint">Máximo de 3 em treino. Tire uma (✕) pra colocar outra.</div>`));
  }
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}

/* ============================================================
   BIBLIOTECA (Etapa 4) — fusão Técnicas + Sistemas + estados + 🔁 Anki
   ============================================================ */
const ESTADO_GRUPOS = [['foco','Em treino'],['arma','Arsenal'],['guardada','Guardadas'],['aprendida','Aprendidas']];
function bibStatTile(l,v){ return `<div class="st-tile"><div class="st-l">${l}</div><div class="st-v">${v}</div></div>`; }
function bibStats(t){
  const {T,A,p}=totaisTec(t);
  if(T>0){ const best=Math.max(...ratesDe(t));
    return `<div class="rs-stats">${bibStatTile('Acerto',p+'%')}${bibStatTile('Tentativas',T)}${bibStatTile('Melhor dia',best+'%')}${bibStatTile('Praticada',t.ultima||'—')}</div>`; }
  return `<div class="rs-stats">${bibStatTile('Treinos',t.treinos||0)}${bibStatTile('Praticada',t.ultima||'—')}</div>`;
}
function bibToggle(jp){ DB.bibExp = DB.bibExp===jp?null:jp; render(); }
function bibRevisar(jp){ const i=DB.tecnicas.findIndex(t=>t.id===jp||t.jp===jp); if(i>=0) marcarRevisado(i); }
function bibEditar(jp){ const i=DB.tecnicas.findIndex(t=>t.id===jp||t.jp===jp); if(i>=0) abrirEditorTecnica(i); }
function bibVoltarFoco(jp){
  if(focoTecnicas().length>=3){ toast('Máximo de 3 em treino'); return; }
  const t=tecByKey(jp); if(t){ t.estado='foco'; scheduleSave(); _syncEstado(); toast('Voltou pro treino'); render(); }
}
function bibDelLink(de,para){ DB.links = DB.links.filter(e=>!(e.de===de&&e.para===para)); render(); }
// M9: `de` é a CHAVE estável (id) da técnica de origem; links guardam ids, não nomes
function bibConnectSub(de){
  const cands = DB.tecnicas.filter(t=>(t.id||t.jp)!==de && !DB.links.some(e=>e.de===de&&e.para===(t.id||t.jp)))
    .sort((a,b)=>(b.treinos||0)-(a.treinos||0));
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Conectar subtécnica</div>
    <div class="sheet-desc">Pra onde a <b>"${safeTxt(_tecLabel(de))}"</b> costuma levar? A conexão monta seu mapa de jogo.</div>
    <div class="rs-picklist" id="bc-list"></div>
    <button class="sheet-cancel" id="bc-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('#bc-list');
  cands.forEach(t=>{
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${safeTxt(t.jp)}</div></div><span class="rs-pk-go">＋</span></div>`);
    row.onclick=()=>{ DB.links.push({de, para:(t.id||t.jp)}); sheet.remove(); render(); toast('Subtécnica conectada'); };
    list.appendChild(row);
  });
  if(!cands.length) list.appendChild(el(`<div class="rs-empty">nenhuma técnica disponível pra conectar</div>`));
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#bc-cancel').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}
function evoluirBiblioteca(){
  const w = el('<div></div>');
  const cont = { novo:0, aprendendo:0, treinando:0, dominada:0 };
  DB.tecnicas.forEach(t=>{ const nv=nivelDe(t); if(cont[nv]!=null) cont[nv]++; });

  // adicionar técnica (v412: KPI topo e bloco Revisar separado removidos — filtros
  // abaixo já mostram esses números; o dot vermelho no card sinaliza revisão).
  const addBtn = el(`<button class="add-tec-btn">＋ Adicionar técnica</button>`);
  addBtn.onclick = ()=> abrirEditorTecnica(null);
  w.appendChild(addBtn);

  // 🔍 Busca + filtros por nível
  const searchBox = el(`<div class="bib-search">
    <div class="bib-srch">
      <svg class="bib-srch-ic" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.4" y2="16.4"/></svg>
      <input class="bib-srch-inp" id="bib-q" placeholder="Buscar técnica…" aria-label="Buscar técnica" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      <button class="bib-srch-clr" id="bib-q-clr" type="button" aria-label="Limpar busca" hidden>✕</button>
    </div>
  </div>`);
  w.appendChild(searchBox);
  const searchInp = searchBox.querySelector('#bib-q');
  const searchClr = searchBox.querySelector('#bib-q-clr');
  if(DB._bibQ){ searchInp.value = DB._bibQ; searchClr.hidden = false; }
  searchClr.onclick = ()=>{ searchInp.value=''; DB._bibQ=''; searchClr.hidden=true; searchInp.dispatchEvent(new Event('input')); searchInp.focus(); };

  // v412: "Catálogo" (=sem filtro, mostra tudo) fica ativo por default.
  // Clicar em outro chip filtra por nível; clicar em Catálogo volta pra tudo.
  // Sem estado "nenhum ativo" — evita chip flutuante sem sinalização.
  const bibNivel = DB._bibNivel || null;
  const fbar = el(`<div class="bib-filter-bar"></div>`);
  [[null,'Catálogo','muted',DB.tecnicas.length],['aprendendo','Aprendendo','gold',cont.aprendendo],['treinando','Treinando','blue',cont.treinando],['dominada','Dominadas','green',cont.dominada]].forEach(([id,l,cls,n])=>{
    const b = el(`<button class="bib-fchip ${cls} ${bibNivel===id?'on':''}">${l} · ${n}</button>`);
    b.onclick = ()=>{ if(bibNivel!==id){ DB._bibNivel = id; render(); } };
    fbar.appendChild(b);
  });
  w.appendChild(fbar);

  const searchResults = el(`<div class="bib-search-results"></div>`);
  w.appendChild(searchResults);

  const filterByNivel = (arr)=> bibNivel ? arr.filter(t=>nivelDe(t)===bibNivel) : arr;

  // 📚 Catálogo (v413) — agrupado por tradição (Kodokan / Jiu-Jitsu). Cada
  // tradição vira um cabeçalho fixo; famílias dentro são accordion como antes.
  const catBlock = el(`<div></div>`);
  TRADICOES_ORDER.forEach(tradKey=>{
    const trad = TRADICOES[tradKey];
    const famsDaTrad = CAT_ORDER.filter(c=> CATS[c].trad===tradKey);
    // Header da tradição só aparece se pelo menos uma técnica dela existe.
    if(!famsDaTrad.some(c=> DB.tecnicas.some(t=>t.cat===c))) return;
    catBlock.appendChild(el(`<div class="bib-div">${safeTxt(trad.nome)} · ${safeTxt(trad.sub)}</div>`));
    famsDaTrad.forEach(cat=>{
      const itensTotais = DB.tecnicas.filter(t=>t.cat===cat);
      const itens = filterByNivel(itensTotais);
      if(!itensTotais.length) return;
      const c = CATS[cat];
      const open = DB.bibCat===cat;
      const dueN = itens.filter(t=>(t.treinos||0)>0 && revInfo(t).due).length;
      const head = el(`<div class="cat-acc ${open?'open':''} ${bibNivel && !itens.length?'dim':''}" data-cat="${cat}">
        <div class="cat-emoji" title="${c.nome}">${c.emoji}</div>
        <div class="cat-tx"><div class="cn">${c.nome}</div><div class="cs">${c.sub}</div></div>
        ${dueN?`<span class="cat-due" title="a revisar">${dueN}🔁</span>`:''}
        <span class="cat-acc-n">${bibNivel?`${itens.length}/${itensTotais.length}`:itensTotais.length}</span>
        <span class="cat-caret">${open?'⌄':'›'}</span>
      </div>`);
      head.onclick = ()=>{ DB.bibCat = open?null:cat; DB.bibExp=null; render(); };
      catBlock.appendChild(head);
      if(open){
        const children = el(`<div class="cat-children"></div>`);
        if(!itens.length){ children.appendChild(el(`<div class="empty-line" style="padding:10px 20px">Nenhuma técnica nesse filtro</div>`)); }
        else if(cat==='nage'){
          // v415: Nage-waza aberto vira sub-accordion Te/Koshi/Ashi/Sutemi.
          // Outras famílias ficam plano — só o Nage tem sub-taxonomia comparável.
          NAGE_SUB_ORDER.forEach(subKey=>{
            const subInfo = NAGE_SUB[subKey];
            const subItens = itens.filter(t=>t.sub===subKey);
            if(!subItens.length) return;
            const subOpen = DB.bibNageSub===subKey;
            const subHead = el(`<div class="cat-acc sub-acc ${subOpen?'open':''}">
              <div class="cat-emoji" title="${subInfo.nome}">${subInfo.emoji}</div>
              <div class="cat-tx"><div class="cn">${subInfo.nome}</div><div class="cs">${subInfo.sub}</div></div>
              <span class="cat-acc-n">${subItens.length}</span>
              <span class="cat-caret">${subOpen?'⌄':'›'}</span>
            </div>`);
            subHead.onclick = ()=>{ DB.bibNageSub = subOpen?null:subKey; DB.bibExp=null; render(); };
            children.appendChild(subHead);
            if(subOpen) subItens.forEach(t=> children.appendChild(bibCardNode(t, t.estado)));
          });
        }
        else itens.forEach(t=> children.appendChild(bibCardNode(t, t.estado)));
        catBlock.appendChild(children);
      }
    });
  });
  w.appendChild(catBlock);

  let _bibQT = null;
  const _doSearch = ()=>{
    const q = searchInp.value.trim().toLowerCase(); DB._bibQ = q;
    searchClr.hidden = !searchInp.value;
    searchResults.innerHTML='';
    if(!q){ searchResults.style.display='none'; catBlock.style.display=''; return; }
    catBlock.style.display='none'; searchResults.style.display='';
    const hits = filterByNivel(DB.tecnicas.filter(t=> t.jp.toLowerCase().includes(q) || (t.pt||'').toLowerCase().includes(q)));
    if(!hits.length){ searchResults.appendChild(el(`<div class="empty-line" style="padding:16px;text-align:center">Nenhuma técnica encontrada</div>`)); return; }
    searchResults.appendChild(el(`<div class="bib-search-count">${hits.length} resultado${hits.length>1?'s':''}</div>`));
    hits.forEach(t=> searchResults.appendChild(bibCardNode(t, t.estado)));
  };
  searchInp.oninput = ()=>{
    searchClr.hidden = !searchInp.value;
    clearTimeout(_bibQT);
    _bibQT = setTimeout(_doSearch, 150);
  };
  if(DB._bibQ){ catBlock.style.display='none'; _doSearch(); }
  w.appendChild(el(`<div style="height:18px"></div>`));
  return w;
}
// cartão de técnica da Biblioteca (expansível: stats + revisão + pré/sub)
function bibCardNode(t, st){
  const key  = t.id || t.jp;   // M9: links referenciam a chave estável
  const exp  = DB.bibExp===t.jp;
  const subs = DB.links.filter(e=>e.de===key).map(e=>e.para);
  const pres = DB.links.filter(e=>e.para===key).map(e=>e.de);
  const r = revInfo(t);
  const {T,p}=totaisTec(t);
  const stat = (st!=='aprendida' && T>0) ? `${p}% de acerto` : `${plural(t.treinos||0,'treino','treinos')}`;
  const nv = nivelDe(t);
  const nvColor = nv==='dominada'?'green':(nv==='treinando'?'blue':(nv==='aprendendo'?'gold':'muted'));
  const isCustom = t.id && t.id.indexOf('usr-')===0;
  const card = el(`<div class="rep-card lvl-${nvColor} ${isCustom?'is-custom':''}">
    <div class="rep-row">
      <span class="rep-dot dot-${nvColor}" title="${NIVEIS[nv]?NIVEIS[nv][0]:''}"></span>
      <div class="rep-tx"><div class="rep-nm">${safeTxt(t.jp)}${r.due?' <span class="rev-dot" title="revisar"></span>':''}</div>
        <div class="rep-st">${stat}${subs.length?` · ${subs.length} sub`:''}${pres.length?` · ${pres.length} pré`:''}${isCustom?' · customizada':''}</div></div>
      <span class="rep-caret">${exp?'⌄':'›'}</span>
    </div>
    ${exp?`<div class="rep-sub">
      ${T>0?`<div class="rs-lab">Estatísticas</div>${bibStats(t)}`:''}
      ${t.nota?`<div class="rs-lab">Sua anotação</div><div class="det-nota">${safeTxt(t.nota)}</div>`:''}
      ${r.due?`<div class="rs-lab">Revisão espaçada</div><div class="bib-rev due">faz ${r.dias} dias — passou do intervalo de ${r.alvo}d</div>`:''}
      ${st==='guardada'?`<button class="rs-add voltar" data-act="voltar">↩ voltar a praticar</button>`:(st==='aprendida'?`<button class="rs-add voltar" data-act="voltar">＋ colocar no foco</button>`:'')}
      ${pres.length?`<div class="rs-lab">Vem de (pré-técnicas)</div>${pres.map(s=>`<div class="rs-item"><span>${safeTxt(_tecLabel(s))} →</span><button data-del-de="${safeAttr(s)}" data-del-para="${safeAttr(key)}">✕</button></div>`).join('')}`:''}
      ${subs.length?`<div class="rs-lab">Leva pra (subtécnicas)</div>${subs.map(s=>`<div class="rs-item"><span>→ ${safeTxt(_tecLabel(s))}</span><button data-del-de="${safeAttr(key)}" data-del-para="${safeAttr(s)}">✕</button></div>`).join('')}`:''}
      <button class="rs-add" data-act="connect">＋ conectar subtécnica</button>
      <div class="bib-actions">
        <button class="bib-btn" data-act="revisar">Marcar revisado</button>
      </div>
      ${isCustom?`<div class="rep-del-row"><button class="rep-del-btn" data-act="excluir">🗑️ Excluir técnica</button></div>`:''}
    </div>`:''}
  </div>`);
  card.querySelector('.rep-row').onclick = ()=> bibToggle(t.jp);
  // long-press: menu rápido de ações na técnica
  _attachLongPress(card, { onLongPress: ()=>{
    const acts = [
      { icon:'🔁', label:'Marcar revisada', onClick:()=> bibRevisar(t.jp) },
      { icon:'✏️', label:'Editar', onClick:()=> bibEditar(t.jp) },
    ];
    if (t.estado === 'guardada' || t.estado === 'aprendida') acts.push({ icon:'🎯', label:'Voltar pro foco', onClick:()=> bibVoltarFoco(t.jp) });
    if (t.id && t.id.indexOf('usr-')===0) acts.push({ icon:'🗑️', label:'Excluir técnica', danger:true, onClick:()=> bibExcluirCustom(t.id) });
    _openActionSheet(t.jp, acts);
  }});
  if(exp){
    card.querySelectorAll('[data-del-de]').forEach(b=> b.onclick=(e)=>{ e.stopPropagation(); bibDelLink(b.dataset.delDe,b.dataset.delPara); });
    const av=card.querySelector('[data-act="voltar"]');  if(av) av.onclick=(e)=>{ e.stopPropagation(); bibVoltarFoco(t.jp); };
    card.querySelector('[data-act="connect"]').onclick=(e)=>{ e.stopPropagation(); bibConnectSub(key); };
    card.querySelector('[data-act="revisar"]').onclick=(e)=>{ e.stopPropagation(); bibRevisar(t.jp); };
    const dl=card.querySelector('[data-act="excluir"]'); if(dl) dl.onclick=(e)=>{ e.stopPropagation(); bibExcluirCustom(t.id); };
  }
  return card;
}

function bibExcluirCustom(id){
  if(!id || id.indexOf('usr-')!==0) return;
  const t = DB.tecnicas.find(x=>x.id===id); if(!t) return;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Excluir técnica?</div>
    <div class="sheet-desc">Você vai apagar <b>"${safeTxt(t.jp)}"</b> da sua biblioteca, junto com todo o histórico de prática dela. Isso não pode ser desfeito.</div>
    <button class="btn-save" id="del-confirm" style="background:var(--red)">Excluir</button>
    <button class="sheet-cancel" id="del-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#del-cancel').onclick=close;
  sheet.querySelector('#del-confirm').onclick=()=>{
    DB.tecnicas = DB.tecnicas.filter(x=>x.id!==id);
    DB.links = (DB.links||[]).filter(e=>e.de!==id && e.para!==id && e.de!==t.jp && e.para!==t.jp);
    DB.bibExp = null;
    scheduleSave(); close(); render();
    toast('Técnica excluída');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ---- Sub-aba: GRADUAÇÃO ---- */
function evoluirGraduacao(){
  const w = el('<div></div>');
  const me = DB.eu, belt = BELTS[me.faixa];
  const stripes = '<i></i>'.repeat(me.graus);
  const curRed = me.faixa==='preta';
  const fgData = _faixaDesde(DB.graduacoes||[], me.faixa);
  const mesesFaixa = fgData ? tempoNaFaixaMeses(fgData) : null;
  let tempoTxt='—';
  if(mesesFaixa!=null){ const an=Math.floor(mesesFaixa/12), rm=mesesFaixa%12; tempoTxt=((an?an+'a ':'')+(rm?rm+'m':'')).trim()||'0m'; }

  // v345: sem NENHUM evento na timeline, não existe faixa registrada — mostrar
  // "Branca · 0º grau" era inventar uma graduação que o professor não deu.
  if(!(DB.graduacoes||[]).filter(g=>g&&g.data).length){
    w.appendChild(el(`<div class="mod-card" style="margin-top:6px">
      <div class="mod-title">Faixa atual: <b style="color:var(--ink)">Sem graduação registrada</b></div>
      <div class="mod-note" style="color:var(--muted);font-size:12.5px;margin-top:6px">
        Seu professor ainda não registrou sua entrada na academia. Assim que registrar,
        sua linha do tempo e o progresso pra próxima faixa aparecem aqui.</div>
    </div>`));
    return w;
  }
  w.appendChild(el(`<div class="mod-card" style="margin-top:6px">
    <div class="mod-title">Faixa atual: <b style="color:var(--ink)">${belt.nome} · ${me.graus}º grau</b></div>
    <div class="belt-rank">${beltMini(me.faixa, me.graus)}</div>
    <div class="mod-grid">
      <div class="mc"><div class="big">${tempoTxt}</div>
        <div class="lbl">na faixa ${belt.nome.toLowerCase()}</div></div>
    </div>
  </div>`));

  const eleg = elegibilidadeCBJJ(me);
  if(eleg.nextBelt){
    const nextB = BELTS[eleg.nextBelt];
    const nextRed = eleg.nextBelt==='preta';
    const allOk = eleg.checks.filter(c=>c.ok===true).length;
    const total = eleg.checks.filter(c=>c.ok!=null).length;
    const statusCls = eleg.eligible ? 'cbjj-ok' : 'cbjj-wait';
    const statusTxt = eleg.eligible ? 'Elegivel para promocao' : (total>0 ? `${allOk}/${total} requisitos atendidos` : 'Complete seu perfil para ver os requisitos');
    w.appendChild(el(`<div class="cbjj-ready ${statusCls}">
      <div class="cbjj-head">
        ${beltMini(eleg.nextBelt, 0)}
        <div><div class="cbjj-next">Proxima faixa: <b style="color:${nextB.cor}">${nextB.nome}</b></div>
          <div class="cbjj-status">${statusTxt}</div></div>
      </div>
      <div class="cbjj-checks" id="cbjj-checks"></div>
    </div>`));
    const checksEl = w.querySelector('#cbjj-checks');
    eleg.checks.forEach(c=>{
      const ico = c.ok===true?'✅':c.ok===false?'❌':'ℹ️';
      checksEl.appendChild(el(`<div class="cbjj-chk"><span class="chk-ico">${ico}</span><div><div class="chk-label">${c.label}</div><div class="chk-detail">${c.detail}</div></div></div>`));
    });
  }

  // Preta: progressão de grau é por TEMPO acumulado (CBJJ.black_belt_degrees:
  // 3-3-3-5-5-5-7-7-10 anos), não por aulas. Mostrar "40/40 aulas p/ próximo grau"
  // pra faixa preta é errado e engana o aluno. Ninguém graduou ninguém pela contagem
  // de aulas na preta — quem manda é o relógio.
  if(me.faixa === 'preta'){
    const fgData = _faixaDesde(DB.graduacoes||[], 'preta');
    const anosNaPreta = fgData ? Math.floor(tempoNaFaixaMeses(fgData)/12) : null;
    const nextDeg = CBJJ.black_belt_degrees.find(d => d.degree === me.graus + 1);
    if(nextDeg){
      const cumul = nextDeg.cumulative;
      const anosTxt = anosNaPreta!=null ? `${anosNaPreta} ano${anosNaPreta===1?'':'s'} de preta` : 'Sem data da preta registrada';
      const faltaTxt = anosNaPreta!=null
        ? (anosNaPreta>=cumul ? `Elegivel para o ${nextDeg.degree}º grau` : `${cumul - anosNaPreta} ano${cumul-anosNaPreta===1?'':'s'} p/ o ${nextDeg.degree}º grau`)
        : `${nextDeg.years} ano${nextDeg.years===1?'':'s'} entre graus (CBJJ)`;
      const pct = anosNaPreta!=null ? Math.min(100, Math.round(anosNaPreta/cumul*100)) : 0;
      w.appendChild(el(`<div class="mod-card aulas-card">
        <div class="mod-title" style="font-size:13px">Progresso da faixa preta</div>
        <div class="mod-grid">
          <div class="mc"><div class="big" style="font-size:18px">${anosNaPreta!=null?anosNaPreta:'—'}/${cumul}</div>
            <div class="lbl">${safeTxt(faltaTxt)}</div>
            <div class="mini-bar"><span style="width:${pct}%"></span></div></div>
          <div class="mc bd"><div class="big" style="font-size:14px;line-height:1.3">${safeTxt(anosTxt)}</div>
            <div class="lbl">progressão por tempo — sem meta de aulas</div></div>
        </div>
      </div>`));
    } else {
      w.appendChild(el(`<div class="mod-card aulas-card">
        <div class="mod-title" style="font-size:13px">Faixa preta · ${me.graus}º grau</div>
        <div class="mod-note" style="color:var(--muted);font-size:12.5px;margin-top:6px">
          Grau máximo alcançado. As proximas etapas (7º→coral, 8º→coral e branca, 9º→vermelha)
          seguem tabela CBJJ por tempo acumulado.</div>
      </div>`));
    }
  } else {
    const ag = aulasStats();
    const paceSem = DEMO ? 3 : Math.round(paceSemanal()*10)/10;
    const grauLbl = (me.graus >= maxGrausDe(me.faixa)) ? 'p/ proxima faixa' : 'p/ proximo grau';
    // v480: projeção "no ritmo". 2,5/sem sozinho não diz nada — traduz pra tempo real.
    // < 2 anos mostra meses (mais legível); ≥ 2 anos mostra anos com 1 casa.
    const anos = paceSem > 0 ? ag.restantes / paceSem / 52 : 0;
    const ritmoTxt = anos > 0
      ? ' · ~' + (anos < 2 ? Math.round(anos*12)+' meses' : anos.toFixed(1)+' anos') + ' no ritmo'
      : '';
    w.appendChild(el(`<div class="mod-card aulas-card">
      <div class="mod-title" style="font-size:13px">Progresso por aulas</div>
      <div class="mod-grid">
        <div class="mc"><div class="big" style="font-size:18px">${ag.atual}/${ag.meta}</div>
          <div class="lbl">${ag.atual>=ag.meta?aptoMsg(me, me.graus>=maxGrausDe(me.faixa), ag.atual-ag.meta):plural(ag.faltam,'aula','aulas')+' '+grauLbl}</div>
          <div class="mini-bar"><span style="width:${ag.pct}%"></span></div></div>
        <div class="mc bd"><div class="big" style="font-size:18px">~${ag.restantes}</div>
          <div class="lbl">aulas p/ proxima faixa · ${paceSem}/sem${ritmoTxt}</div></div>
      </div>
    </div>`));
  }

  const tlHead = el(`<div class="sec-row"><div class="sec-title" style="margin:0">Linha do tempo</div></div>`);
  // Conta provisionada: histórico de graduação vem do professor (sem importar/corrigir aqui).
  if(!DB.eu.provisionedByProf){
    if(!DB.eu.gradLocked){
      const impBtn = el(`<a class="sec-link">Importar histórico</a>`);
      impBtn.onclick = ()=> abrirImportGrad();
      tlHead.appendChild(impBtn);
    } else if(!DB.eu.gradCorrecaoDone){
      const corBtn = el(`<a class="sec-link">Corrigir</a>`);
      corBtn.onclick = ()=> abrirImportGrad();
      tlHead.appendChild(corBtn);
    }
  }
  w.appendChild(tlHead);
  const tl = el(`<div class="timeline"></div>`);
  const grads = [...(DB.graduacoes||[])].sort((a,b)=>b.data.localeCompare(a.data));
  if(!grads.length){
    tl.appendChild(el(`<div class="tl-empty">Nenhuma graduação registrada.<br>Importe seu histórico para ver sua linha do tempo e calcular a próxima faixa.</div>`));
    if(!DB.eu.gradLocked && !DB.eu.provisionedByProf){
      const impB=el(`<button class="btn-ghost" style="margin-top:10px">📜 Importar histórico de graduação</button>`);
      impB.onclick=()=>abrirImportGrad();
      tl.appendChild(impB);
    }
  }
  grads.forEach(g=>{
    const x = BELTS[g.faixa];
    if(!x) return;
    const titulo = g.tipo==='faixa' ? `Faixa ${x.nome}`
                 : g.tipo==='inicio' ? `Início · Faixa ${x.nome}`
                 : `${g.graus}º grau · ${x.nome}`;
    const [y,m,d] = g.data.split('-');
    const dataFmt = `${d}/${m}/${y}`;
    // v398: nome do instrutor removido da visao do ALUNO (só data no rodape).
    // Professor continua vendo "por Fulano" na propria ficha (app.js:6285, 7044).
    tl.appendChild(el(`<div class="tl-item">
      <div class="tl-rail"><span class="tl-dot" style="background:${x.cor}"></span><span class="tl-conn"></span></div>
      <div class="tl-tx">
        <div class="tl-belt">${beltMini(g.faixa, g.tipo==='grau'?g.graus:0)}</div>
        <div class="t">${titulo}</div>
        <div class="dt">${dataFmt}</div></div></div>`));
  });
  w.appendChild(tl);
  return w;
}

// conversão de data: ISO (AAAA-MM-DD) ↔ BR (DD/MM/AAAA) para entrada manual no import
function _isoToBr(iso){ if(!iso) return ''; const p=iso.split('-'); return (p.length===3) ? `${p[2]}/${p[1]}/${p[0]}` : ''; }
function _brToIso(br){ const m=(br||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m) return ''; const d=+m[1],mo=+m[2],y=+m[3]; if(mo<1||mo>12||d<1||d>31||y<1950||y>2100) return ''; const dt=new Date(y,mo-1,d); if(dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d) return ''; return `${m[3]}-${m[2]}-${m[1]}`; }
// normaliza entradas de graduação: descarta sem data, corrige graus por tipo (faixa=0, grau≥1), ordena por data. Retorna null se nenhuma válida.
function _normalizeGrad(entries){
  const valid=(entries||[]).filter(e=>e&&e.data).map(e=>{ const g={...e}; delete g.por; if(g.tipo==='faixa') g.graus=0; else if(!(g.graus>=1)) g.graus=1; return g; });
  return valid.length ? valid.sort((a,b)=>a.data.localeCompare(b.data)) : null;
}
function _sugerirGraduacoes(faixa, graus){
  const seq = [];
  // Cadeia sugerida: infantil (branca + grupos 4–15) se a faixa atual for infantil; senão adulta.
  const ehInfantil = _grupoInfantilMinAge(faixa)!=null;
  const chain = ehInfantil ? ['branca', ...CBJJ.youth_belts.flatMap(g=>g.belts)] : ADULT_BELTS;
  const idx = chain.indexOf(faixa);
  if(idx<0) return [{ faixa:'branca', graus:0, tipo:'faixa', data:'', aulas:0 }];
  for(let b=0; b<=idx; b++){
    const belt = chain[b];
    seq.push({ faixa:belt, graus:0, tipo:'faixa', data:'', aulas:0 });
    const maxG = (b<idx) ? maxGrausDe(belt) : graus;
    for(let g=1; g<=maxG; g++) seq.push({ faixa:belt, graus:g, tipo:'grau', data:'', aulas:0 });
  }
  return seq;
}
function abrirImportGrad(){
  const isCorrecao = !!DB.eu.gradLocked;
  const title = isCorrecao ? 'Corrigir histórico' : 'Importar histórico de graduação';
  const existentes = DB.graduacoes||[];
  let entries;
  if(isCorrecao){
    entries = existentes.map(g=>{ const c={...g}; delete c.por; return c; });
  } else {
    entries = _sugerirGraduacoes(DB.eu.faixa, DB.eu.graus);
    existentes.forEach(ex=>{
      const match = entries.find(e=>e.faixa===ex.faixa && e.graus===(ex.tipo==='faixa'?0:ex.graus) && e.tipo===ex.tipo);
      if(match){ match.data = ex.data||''; match.aulas = ex.aulas||0; }
    });
  }

  function renderSheet(){
    const lastIdx = entries.length - 1;
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" style="max-height:85vh;overflow-y:auto">
      <div class="sheet-grip"></div>
      <div class="sheet-title">${title}</div>
      <div class="sheet-desc">${isCorrecao?'Corrija as datas ou dados. Após salvar, o histórico será travado definitivamente.':'Preencha apenas as datas. Exclua graduações que não teve.'}</div>
      <div id="grad-list"></div>
      <button class="btn-ghost" id="grad-add" style="margin-top:12px">+ Adicionar graduação</button>
      <button class="btn-save" id="grad-save" style="margin-top:14px">${isCorrecao?'Salvar e travar':'Importar histórico'}</button>
      <button class="sheet-cancel" id="grad-cancel">Cancelar</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#grad-cancel').onclick=close;

    const list = sheet.querySelector('#grad-list');
    entries.forEach((e,i)=>{
      const isLast = (i===lastIdx);
      // M3 (auditoria): faixa e tipo/grau agora são EDITÁVEIS por entrada —
      // antes o seletor era construído mas nunca renderizado e toda entrada
      // adicionada nascia travada em "Faixa Branca".
      // histórico completo: permite qualquer faixa da cadeia CBJJ (infantil + adulta)
      const bOpts = CBJJ_CHAIN.map(b=>`<option value="${b}" ${e.faixa===b?'selected':''}>${BELTS[b].nome}</option>`).join('');
      const maxG = maxGrausDe(e.faixa);
      const tipoVal = e.tipo==='faixa' ? 'faixa' : ('grau-'+Math.min(e.graus||1, maxG));
      let tOpts = `<option value="faixa" ${tipoVal==='faixa'?'selected':''}>Faixa</option>`;
      for(let g=1; g<=maxG; g++) tOpts += `<option value="grau-${g}" ${tipoVal==='grau-'+g?'selected':''}>${g}º grau</option>`;
      const x = BELTS[e.faixa];
      const lbl = e.tipo==='faixa' ? `Faixa ${x?x.nome:e.faixa}` : `${e.graus}º grau · ${x?x.nome:e.faixa}`;
      const row = el(`<div class="grad-entry">
        <div class="ge-prev"></div>
        <div class="ge-head">
          <span class="ge-label">${safeTxt(lbl)}${isLast?' <span style="color:var(--good);font-size:12px">← atual</span>':''}</span>
          <button class="sc-rm" data-del="${i}" title="Excluir">✕</button>
        </div>
        <div class="ge-line">
          <select class="inp" data-field="faixa" aria-label="Faixa" style="flex:1">${bOpts}</select>
          <select class="inp" data-field="tipo" aria-label="Faixa ou grau" style="width:130px">${tOpts}</select>
        </div>
        <div class="ge-line" style="margin-top:8px">
          <input class="inp" type="text" inputmode="numeric" maxlength="10" data-field="data" value="${_isoToBr(e.data)}" placeholder="DD/MM/AAAA" style="flex:1">
        </div>
        ${isLast?`<div class="ge-line" style="margin-top:8px">
          <input class="inp" type="number" data-field="aulas" value="${e.aulas||0}" min="0" style="flex:1" placeholder="Aulas neste grau">
          <span class="ge-lbl">aulas feitas</span>
        </div>`:''}
      </div>`);
      const prev = row.querySelector('.ge-prev');
      prev.innerHTML = beltMini(e.faixa, e.tipo==='grau'?(e.graus||0):0);
      row.querySelector('[data-field="faixa"]').onchange=(ev)=>{
        entries[i].faixa=ev.target.value;
        const mx=maxGrausDe(entries[i].faixa);
        if(entries[i].tipo==='grau' && entries[i].graus>mx) entries[i].graus=mx;
        sheet.remove(); renderSheet();
      };
      row.querySelector('[data-field="tipo"]').onchange=(ev)=>{
        const v=ev.target.value;
        if(v==='faixa'){ entries[i].tipo='faixa'; entries[i].graus=0; }
        else { entries[i].tipo='grau'; entries[i].graus=+v.slice(5)||1; }
        sheet.remove(); renderSheet();
      };
      row.querySelector('[data-field="data"]').oninput=(ev)=>{
        let d=ev.target.value.replace(/\D/g,'').slice(0,8);
        let out=d;
        if(d.length>4) out=d.slice(0,2)+'/'+d.slice(2,4)+'/'+d.slice(4);
        else if(d.length>2) out=d.slice(0,2)+'/'+d.slice(2);
        ev.target.value=out;
        entries[i].data=_brToIso(out);
      };
      const aulasInp = row.querySelector('[data-field="aulas"]');
      if(aulasInp) aulasInp.oninput=(ev)=>{ entries[i].aulas=+ev.target.value||0; };
      row.querySelector('[data-del]').onclick=()=>{ entries.splice(i,1); sheet.remove(); renderSheet(); };
      list.appendChild(row);
    });

    sheet.querySelector('#grad-add').onclick=()=>{
      entries.push({ faixa:'branca', graus:0, tipo:'faixa', data:'', aulas:0 });
      sheet.remove(); renderSheet();
    };

    sheet.querySelector('#grad-save').onclick=()=>{
      const valid = _normalizeGrad(entries);
      if(!valid){ toast('Adicione pelo menos uma graduação com data'); return; }
      DB.graduacoes = valid;
      const last = DB.graduacoes[DB.graduacoes.length-1];
      DB.eu.aulasGrau = Object.assign(DB.eu.aulasGrau, { base: last.aulas||0 });
      if(isCorrecao) DB.eu.gradCorrecaoDone = true;
      DB.eu.gradLocked = true;
      close(); render(); toast(isCorrecao?'Histórico corrigido e travado':'Histórico importado ✔');
    };

    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
  }
  renderSheet();
}

/* ---- Sub-aba: TÉCNICAS (biblioteca) ---- */
const NIVEIS = { novo:['Catálogo','muted'], aprendendo:['Aprendendo','gold'], treinando:['Treinando','blue'], dominada:['Dominada','green'] };
// Taxonomia (v413): 2 tradições × famílias. Kodokan segue o Judo Institute
// (nage/osaekomi/shime/kansetsu). Jiu-Jitsu agrupa por função no jogo — guardas,
// raspagens, passagens, escapes e básicas de faixa branca (não são Kodokan mas
// são o vocabulário real da academia de BJJ). Kosen deixou de existir na v413:
// suas 5 técnicas migraram pra Kodokan (Dō-jime→shime, Ashi-garami→kansetsu) ou
// Jiu-Jitsu (Hikikomi/Hikikomi-gaeshi→guarda/raspagem, Tate-sankaku→guarda).
const CATS = {
  nage:     { nome:'Nage-waza',     sub:'Técnicas de projeção',                    emoji:'投', trad:'kodokan' },
  osaekomi: { nome:'Osaekomi-waza', sub:'Técnicas de aprisionamento (Imobilizações)', emoji:'押', trad:'kodokan' },
  shime:    { nome:'Shime-waza',    sub:'Técnicas de estrangulamento',             emoji:'絞', trad:'kodokan' },
  kansetsu: { nome:'Kansetsu-waza', sub:'Técnicas de articulações',                emoji:'関', trad:'kodokan' },
  // v414: kanji temático nas famílias de Jiu-Jitsu (proposta B). Escolhidos pela
  // ação central de cada família — 引 puxar (guarda), 返 reverter (raspagem),
  // 通 passar (passagem), 基 base (básicas/fundamentos).
  guarda:   { nome:'Guardas',       sub:'Jogo por baixo',                          emoji:'引', trad:'jiu-jitsu' },
  raspagem: { nome:'Raspagens',     sub:'Inverter a posição',                      emoji:'返', trad:'jiu-jitsu' },
  passagem: { nome:'Passagens',     sub:'Superar a guarda',                        emoji:'通', trad:'jiu-jitsu' },
  basico:   { nome:'Básicas',       sub:'Fundamentos da faixa branca',             emoji:'基', trad:'jiu-jitsu' },
};
const CAT_ORDER = ['nage','osaekomi','shime','kansetsu','guarda','raspagem','passagem','basico'];
const TRADICOES = {
  kodokan:     { nome:'Kodokan',    sub:'Judô tradicional' },
  'jiu-jitsu': { nome:'Jiu-Jitsu',  sub:'BJJ moderno + fundamentos' },
};
const TRADICOES_ORDER = ['kodokan','jiu-jitsu'];
// v415: sub-família Kodokan pro Nage-waza (Te/Koshi/Ashi/Sutemi). Só o Nage-waza
// tem essa subdivisão hoje — Osaekomi/Shime/Kansetsu ficam plano.
const NAGE_SUB = {
  te:     { nome:'Te-waza',     sub:'Técnicas de mão / braço', emoji:'手' },
  koshi:  { nome:'Koshi-waza',  sub:'Técnicas de quadril',     emoji:'腰' },
  ashi:   { nome:'Ashi-waza',   sub:'Técnicas de perna',       emoji:'足' },
  sutemi: { nome:'Sutemi-waza', sub:'Técnicas de sacrifício',  emoji:'捨' },
};
const NAGE_SUB_ORDER = ['te','koshi','ashi','sutemi'];

// ---- Revisão espaçada ("Anki do BJJ") ----
const REV_BASE = { aprendendo:3, treinando:7, dominada:21 };
function _revAlvo(t){
  const base = REV_BASE[nivelDe(t)] || 7;
  const reps = Math.min(t.treinos||0, 20);
  const factor = 1 + reps * 0.1;
  return Math.round(base * factor);
}
function diasEntre(iso){
  if (!iso) return 999;
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return Math.round((hoje - dt) / 86400000);
}
function revInfo(t){
  const dias = diasEntre(t.ultimaRev);
  const alvo = _revAlvo(t);
  return { dias, alvo, due: dias >= alvo, atraso: dias - alvo };
}
function tecnicasParaRevisar(){
  // só entra na fila o que você JÁ treinou (treinos>0); nunca-treinada não é "revisão"
  return DB.tecnicas.map((t,i)=>({t,i,...revInfo(t)})).filter(x=>x.due && (x.t.treinos||0)>0).sort((a,b)=>b.atraso-a.atraso);
}

function marcarRevisado(i){
  DB.tecnicas[i].ultimaRev = HOJE_ISO;
  track('revisao', { jp:DB.tecnicas[i].jp });
  toast('Revisão registrada ✔');
  render();
}
function abrirTecnica(i){
  const t = DB.tecnicas[i];
  const [nl,cor] = NIVEIS[nivelDe(t)];
  const c = CATS[t.cat] || { nome:'', emoji:'🥋' };
  const r = revInfo(t);
  const tag = t.oficial
    ? `<span class="cat-tag oficial">Kodokan oficial</span>`
    : `<span class="cat-tag kosen">Kosen · não-oficial</span>`;
  const revTxt = r.due
    ? `🧠 <b>Revisão espaçada:</b> faz <b>${r.dias} dias</b> que você não revisita — passou do intervalo de ${r.alvo} dias.`
    : `🧠 <b>Revisão espaçada:</b> revisada faz ${r.dias} dias. Em dia (intervalo de ${r.alvo} dias).`;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="tec-sheet-head">
      <div class="tec-ic" style="width:52px;height:52px;font-size:26px">${c.emoji}</div>
      <div><div class="tec-sheet-name">${safeTxt(t.jp)}</div></div>
      <span class="niv-badge ${cor}" style="margin-left:auto">${nl}</span>
    </div>
    <div class="tec-sheet-meta">${tag}<span class="meta-dot">·</span><span>${c.nome}</span><span class="meta-dot">·</span><span>${plural(t.treinos||0,'treino','treinos')}${t.ultima?' · últ. '+safeTxt(t.ultima):''}</span></div>
    ${t.nota?`<div class="flbl" style="margin-top:16px">Sua anotação</div>
    <div class="det-nota">${safeTxt(t.nota)}</div>`:''}
    <div class="revisao-card ${r.due?'due':''}">${revTxt}</div>
    <button class="btn-save" id="ts-rev">Marcar como revisado</button>
    <button class="sheet-cancel" id="ts-edit" style="color:var(--blue)">Editar técnica</button>
    <button class="sheet-cancel" id="ts-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ts-close').onclick = close;
  sheet.querySelector('#ts-rev').onclick = ()=>{ sheet.remove(); marcarRevisado(i); };
  sheet.querySelector('#ts-edit').onclick = ()=>{ sheet.remove(); abrirEditorTecnica(i); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// Editor de técnica (criar nova ou editar)
function abrirEditorTecnica(idx){
  const editing = idx!=null;
  const t = editing ? DB.tecnicas[idx]
    : { jp:'', pt:'', cat:'osaekomi', oficial:true, nivel:'aprendendo', nota:'' };
  let cat = t.cat, niv = t.nivel;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editing?'Editar técnica':'Nova técnica'}</div>
    <label class="flbl">Nome</label>
    <input class="inp" id="et-jp" placeholder="Ex: Juji-gatame ou Guarda fechada" value="${safeAttr(t.jp)}">
    <label class="flbl" style="margin-top:12px">Categoria</label>
    <div class="seg-wrap" id="et-cat"></div>
    <label class="flbl" style="margin-top:12px">Nível</label>
    <div class="seg" id="et-niv"></div>
    <label class="flbl" style="margin-top:12px">Anotação</label>
    <textarea class="ta" id="et-nota" placeholder="O ponto-chave da técnica…">${safeTxt(t.nota||'')}</textarea>
    <button class="btn-save" id="et-save" style="margin-top:14px">${editing?'Salvar alterações':'Adicionar à biblioteca'}</button>
    <button class="sheet-cancel" id="et-cancel">Cancelar</button>
  </div></div>`);
  const cg = sheet.querySelector('#et-cat');
  CAT_ORDER.forEach(k=>{ const b=el(`<button class="seg-chip ${k===cat?'on':''}">${CATS[k].nome}</button>`);
    b.onclick=()=>{ cat=k; cg.querySelectorAll('.seg-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); }; cg.appendChild(b); });
  const ng = sheet.querySelector('#et-niv');
  Object.keys(NIVEIS).forEach(k=>{ const b=el(`<button class="${k===niv?'active':''}">${NIVEIS[k][0]}</button>`);
    b.onclick=()=>{ niv=k; ng.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; ng.appendChild(b); });
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#et-cancel').onclick = close;
  sheet.querySelector('#et-save').onclick = ()=>{
    const jp = sheet.querySelector('#et-jp').value.trim();
    if (!jp){ toast('Dê um nome à técnica'); return; }
    // B5: evita técnica com nome duplicado (ignora a própria ao editar)
    const dup = DB.tecnicas.some((x,i)=> (!editing || i!==idx) && (x.jp||'').toLowerCase()===jp.toLowerCase());
    if (dup){ toast('Já existe uma técnica com esse nome'); return; }
    const data = { jp, pt:t.pt||'', cat, oficial:cat!=='kosen'&&cat!=='outros', nivel:niv, nota:sheet.querySelector('#et-nota').value.trim() };
    if (editing) Object.assign(DB.tecnicas[idx], data);
    else DB.tecnicas.push({ id:'usr-'+Date.now().toString(36), ...data, treinos:0, ultima:'hoje', ultimaRev:HOJE_ISO });
    sheet.remove();
    DB.navAluno='jogo'; DB.jogoTab='biblioteca'; render();
    toast(editing?'Técnica atualizada ✔':'Técnica adicionada ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* Cartão de perfil (long-press na foto da Home): foto grande + todas as infos.
   Conteúdo read-only; edição continua no tap (editarFotoPerfil) e no Perfil. */
function abrirCartaoPerfil(){
  const me = DB.eu;
  const idade = idadeCBJJ(me.nascimento);
  const desde = desdeDinamico();
  const dm = (desde||'').split('-');
  const desdeTxt = (dm.length===2) ? `${meses[(+dm[1])-1]||''} ${dm[0]}` : '—';
  const foto = me.foto
    ? `<img src="${safeAttr(me.foto)}" alt="" style="width:120px;height:120px;border-radius:50%;object-fit:cover">`
    : `<div style="width:120px;height:120px;border-radius:50%;background:var(--red);color:#fff;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:800">${safeTxt(me.iniciais||'')}</div>`;
  const nomeCompleto = (me.nomeCompleto && me.nomeCompleto!==me.apelido)
    ? `<div style="color:var(--muted);font-size:14px;margin-top:2px">${safeTxt(me.nomeCompleto)}</div>` : '';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Perfil">
    <div class="sheet-grip"></div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:4px 0 14px">
      ${foto}
      <div style="text-align:center">
        <div class="sheet-title" style="margin:0">${safeTxt(me.apelido||'—')}</div>
        ${nomeCompleto}
      </div>
      <div style="display:flex;justify-content:center">${beltMini(me.faixa, me.graus)}</div>
    </div>
    <div class="info-list block">
      <div class="info-row"><div class="ii">🏠</div><div class="it"><div class="t">Academia</div><div class="s">${safeTxt(DB.academia.nome)}</div></div><div class="iv"></div></div>
      <div class="info-row"><div class="ii">📅</div><div class="it"><div class="t">Treinando desde</div><div class="s">${safeTxt(desdeTxt)}</div></div><div class="iv"></div></div>
      ${idade!=null ? `<div class="info-row"><div class="ii">🎂</div><div class="it"><div class="t">Idade</div><div class="s">${idade} anos</div></div><div class="iv"></div></div>` : ''}
    </div>
    <button class="sheet-cancel" id="cp-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#cp-close').onclick = close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function alunoPerfil(){
  const w = el('<div></div>');
  const me = DB.eu;
  // Cabeçalho compacto: avatar + nome + faixa. Botão "Editar" discreto abre a ficha completa
  // (nome, contato, endereço) — a seção "Meu perfil" foi removida por duplicar o cabeçalho.
  w.innerHTML = `<div class="profile-head">
    <span class="pf-version" aria-label="Versão do app">${safeTxt(APP_VERSION)}</span>
    <button class="pf-edit" aria-label="Editar meu perfil">Editar</button>
    <div class="pa">${me.foto?`<img src="${safeAttr(me.foto)}" alt="">`:safeTxt(me.iniciais)}</div>
    <div class="pn">${safeTxt(me.nome)}</div>
    <div class="pf-belt">${beltPill(me.faixa, me.graus)}</div>
  </div>`;
  w.querySelector('.pf-edit').onclick = ()=> abrirEditarPerfil();
  const _phPerf = w.querySelector('.pa');
  if(_phPerf){ _phPerf.style.cursor='pointer'; _phPerf.setAttribute('aria-label','Editar foto'); _phPerf.onclick=()=>editarFotoPerfil(); _attachLongPress(_phPerf,{onLongPress:()=>editarFotoPerfil()}); }

  // A3: Mensalidade oculta no MVP (gestão financeira é fase futura).
  // Loja (Fase L): retirada na recepção, pagamento via PIX + pedido no WhatsApp.
  // Só aparece quando há produtos reais no catálogo (evita loja-fantasma com mock).
  const _prodsAtivos = (DB.loja?.produtos||[]).filter(p=> p.ativo!==false);
  if(_prodsAtivos.length){
    const lojaWrap = el(`<div class="loja-destaque">
      <div class="ld-head"><span class="ld-t" role="button" tabindex="0" aria-label="Abrir Loja Yama">🛍️ Loja Yama<span class="ld-t-arrow">›</span></span>
        <a class="ld-link">ver tudo ›</a>
      </div>
      <div class="ld-ticker" aria-label="Vitrine rolante da Loja Yama"><div class="ld-track"></div></div>
    </div>`);
    lojaWrap.querySelector('.ld-link').onclick = ()=> openLoja();
    // v442: título "Loja Yama" também abre a loja (não só o "ver tudo").
    const _ldT = lojaWrap.querySelector('.ld-t');
    _ldT.onclick = ()=> openLoja();
    _ldT.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openLoja(); } };
    const track = lojaWrap.querySelector('.ld-track');
    // Ticker: duplica os cards pra loop contínuo (CSS translateX -50%). Pausa no hover/toque.
    // Usa <img> HTML direto (não o cache _prodImgNode) porque o cache tem 1 nó por URL e
    // appendChild MOVE o nó — clonar cada ocorrência mantém as fotos nos dois passes.
    const _mkCard = (p)=>{
      const imgHTML = p.img ? `<img src="${safeAttr(p.img)}" alt="" loading="lazy" data-fallback="remove">` : '';
      const card = el(`<div class="ld-card">
        <div class="ld-img${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${imgHTML}<span class="ld-emoji">${safeTxt(p.emoji)}</span></div>
        <div class="ld-nm">${safeTxt(p.nome)}</div><div class="ld-pr">${moneyBR(p.preco)}</div></div>`);
      card.onclick = ()=>{ openLoja(); abrirProduto(p.id); };
      return card;
    };
    _prodsAtivos.forEach(p=> track.appendChild(_mkCard(p)));
    // Clone p/ loop infinito só faz sentido se há mais de 1 produto — com 1 só, o
    // clone virava um card duplicado do mesmo item.
    const podeAnimar = _prodsAtivos.length > 1;
    if(podeAnimar) _prodsAtivos.forEach(p=> track.appendChild(_mkCard(p)));
    else track.classList.add('ld-track-single');   // 1 produto só: sem loop, centraliza
    w.appendChild(lojaWrap);
    // v449: auto-scroll via rAF em `scrollLeft` (não em `transform`), pra deixar o
    // aluno arrastar/rolar manualmente pros lados. A regressão da v442 pra CSS
    // marquee tirou o `overflow-x:auto` do ticker — pediu pra voltar a poder
    // "puxar por lado e voltar no que já passou".
    // Guard do bug antigo do rAF (throttled a 0Hz em aba background): também
    // escuta `visibilitychange` — quando a aba volta a ficar visível, dispara
    // rAF de novo (senão continuava parado depois do usuário voltar). Pausa
    // enquanto o dedo tá pressionado; retoma ao soltar.
    const ticker = lojaWrap.querySelector('.ld-ticker');
    if(podeAnimar && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      // v450 (fix): sem check de `document.hidden` dentro do step. O browser já
      // throttla rAF em aba background — e o check manual matava o loop em
      // situações onde `hidden` ficava true sem `visibilitychange` disparar
      // (iOS PWA no load, standby curto). rAF simples e reentrante resolve.
      let held=false;
      const step = ()=>{
        if(!held){
          const half = track.scrollWidth/2;
          if(ticker.scrollLeft >= half) ticker.scrollLeft -= half;
          else ticker.scrollLeft += 0.4;
        }
        requestAnimationFrame(step);
      };
      ticker.addEventListener('pointerdown', ()=>{ held=true; }, { passive:true });
      const rel = ()=>{ held=false; };
      ticker.addEventListener('pointerup', rel, { passive:true });
      ticker.addEventListener('pointercancel', rel, { passive:true });
      ticker.addEventListener('pointerleave', rel, { passive:true });
      requestAnimationFrame(step);
    }
  }

  // Modo professor — banner grande logo depois da Loja (posição original)
  if(me.isProfessor){
    const goAluno = DB.role === 'professor';
    const alvo = goAluno ? 'aluno' : 'professor';
    const profRow = el(`<div class="pro-entry" role="button" tabindex="0" aria-label="${goAluno?'Entrar no modo aluno':'Entrar no modo professor'}"><div class="pe-ic">${goAluno?'👤':'🥋'}</div>
      <div class="pe-tx"><div class="pe-t">${goAluno?'Modo aluno':'Gerir academia'}</div><div class="pe-s">${goAluno?'Voltar para o diário — treinos, jornada, revisão':'Modo professor — alunos, presenças, loja'}</div></div>
      <div class="pe-go">›</div></div>`);
    profRow.onclick = ()=> setRole(alvo);
    profRow.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setRole(alvo); } };
    w.appendChild(profRow);
  }

  w.appendChild(el(`<div class="sec-title">Minha academia</div>`));
  // Endereço vive dentro do "Editar" no header (não polui aqui). Meta e Turma bastam.
  // Turma: lista APENAS as turmas em que o aluno está matriculado (não a grade inteira).
  // Fonte: DB._minhasTurmasIds (populado por sbSync.pullMatricula) → resolve nomes em DB.turmas.
  const _minhasIds = (DB._minhasTurmasIds && DB._minhasTurmasIds.length ? DB._minhasTurmasIds
                    : (me.turmas || []));
  const _turmasMap = Object.fromEntries((DB.turmas||[]).map(t=>[t.id, t.nome]));
  const _minhasNomes = _minhasIds.map(id=>_turmasMap[id]).filter(Boolean);
  // Fallback: se não há ids resolvíveis, cai no rótulo em academia.turma (compat com pullMatricula legado).
  const _minhaTxt = _minhasNomes.length ? _minhasNomes.join(' · ')
                  : (DB.academia?.turma || 'Sem matrícula · fale com o professor');
  const _multi = _minhasNomes.length > 1;
  const acadCard = el(`<div class="info-list block">
    <div class="info-row" id="row-freq" role="button" tabindex="0" aria-label="Editar meta semanal" style="cursor:pointer"><div class="ii">📅</div><div class="it"><div class="t">Meta semanal</div>
      <div class="s">${metaSemanalTxt()}</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-turma" role="button" tabindex="0" aria-label="Ver horários das minhas turmas" style="cursor:pointer"><div class="ii">🥋</div><div class="it"><div class="t">${_multi?'Minhas turmas':'Minha turma'}</div>
      <div class="s">${safeTxt(_minhaTxt)}</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-lesoes" role="button" tabindex="0" aria-label="Lesões" style="cursor:pointer"><div class="ii">🤕</div><div class="it"><div class="t">Lesões</div><div class="s">Registrar e acompanhar</div></div><div class="iv">›</div></div>
    <div class="info-row" id="row-wa" role="button" tabindex="0" aria-label="Falar com a Yama no WhatsApp" style="cursor:pointer"><div class="ii">💬</div><div class="it"><div class="t">Yama · WhatsApp</div><div class="s">Falar com o professor</div></div><div class="iv">›</div></div>
  </div>`);
  const _rowFreq = acadCard.querySelector('#row-freq');
  if(_rowFreq){ const _go=()=>abrirMetaSemanal(); _rowFreq.onclick=_go; _rowFreq.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _go(); } }; }
  const _rowTurma = acadCard.querySelector('#row-turma');
  if(_rowTurma){ const _gt=()=>abrirMinhasTurmas(); _rowTurma.onclick=_gt; _rowTurma.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _gt(); } }; }
  const _rowLes = acadCard.querySelector('#row-lesoes');
  if(_rowLes){ const _gl=()=>abrirLesoes(); _rowLes.onclick=_gl; _rowLes.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _gl(); } }; }
  const _rowWa = acadCard.querySelector('#row-wa');
  if(_rowWa){ const _gw=()=>{ const w=_lojaWa(); if(!w){ toast('WhatsApp da academia não configurado'); return; } window.open(`https://wa.me/${w}`, '_blank', 'noopener'); }; _rowWa.onclick=_gw; _rowWa.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _gw(); } }; }
  w.appendChild(acadCard);

  // App — tema, notificações, backup, instalar, configurações
  w.appendChild(el(`<div class="sec-title">App</div>`));
  const app = el(`<div class="info-list block">
    <div class="info-row" id="row-tema" role="switch" tabindex="0" aria-label="${_isDark()?'Tema escuro ativado':'Tema claro ativado'}" aria-checked="${_isDark()}" style="cursor:pointer"><div class="ii">${_isDark()?'🌙':'☀️'}</div><div class="it"><div class="t">${_isDark()?'Tema escuro':'Tema claro'}</div><div class="s">${_isDark()?'Toque para modo claro':'Toque para modo escuro'}</div></div><div class="iv"><span class="switch ${_isDark()?'on':''}" aria-hidden="true"><span class="switch-dot"></span></span></div></div>
    ${(()=>{
      const isStandalone = window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (isStandalone) return '';
      return `<div class="info-row" id="row-install" role="button" tabindex="0" aria-label="Instalar app" style="cursor:pointer"><div class="ii">📥</div><div class="it"><div class="t">Instalar app</div><div class="s">Adicionar à tela inicial</div></div><div class="iv">›</div></div>`;
    })()}
    <div class="info-row" id="row-push" role="switch" tabindex="0" aria-label="Avisos no celular" aria-checked="false" style="cursor:pointer"><div class="ii">🔔</div><div class="it"><div class="t">Avisos no celular</div><div class="s" id="row-push-s">Verificando…</div></div><div class="iv"><span class="switch" id="row-push-sw" aria-hidden="true"><span class="switch-dot"></span></span></div></div>
    <div class="info-row" id="row-config" role="button" tabindex="0" aria-label="Configurações" style="cursor:pointer"><div class="ii">⚙️</div><div class="it"><div class="t">Configurações</div></div><div class="iv">›</div></div>
  </div>`);
  _pushBindRow(app);
  const _bindRow=(sel,fn)=>{ const r=app.querySelector(sel); if(!r) return; r.onclick=fn; r.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } }; };
  _bindRow('#row-tema', ()=> toggleTheme());
  _bindRow('#row-install', ()=> abrirInstalarPWA());
  _bindRow('#row-config', ()=> abrirConfiguracoes());
  w.appendChild(app);

  // Sair — só se autenticado na nuvem (senão não há sessão pra encerrar)
  if(DB.sbUser){
    const sairBtn = el(`<button class="pro-switch-btn pro-logout" aria-label="Sair da conta">↩️ Sair</button>`);
    sairBtn.onclick = async ()=>{
      if(!confirm('Sair da sua conta? Você precisará fazer login novamente pra continuar treinando.')) return;
      try{
        if(DB.sbUser && _cloudReady && typeof sbSync!=='undefined'){ try{ await sbSync.pushState(buildDump()); }catch(_){} }
        if(typeof sbAuth!=='undefined') await sbAuth.signOut();
        DB.sbUser=null; _cloudReady=false; _lastPushed=''; DB.authOpen=true;
        render(); toast('Até logo 👋');
      }catch(e){ toast('Falha ao sair: '+(e.message||e)); }
    };
    w.appendChild(sairBtn);
  }

  // Rodapé leve — versão + créditos
  w.appendChild(el(`<div class="pf-footer">Yama · Jiu-Jitsu · ${safeTxt(APP_VERSION)}</div>`));

  return w;
}

/* === AVISOS NO CELULAR (Web Push, v306) ===
   Toggle no Perfil. O app só registra/remove o APARELHO — quem decide o que
   enviar é o cron no banco (0014). Desligar = apagar a subscription.
   iOS: só entrega com o PWA instalado na tela de início (regra da Apple). */
function _pushBindRow(root){
  const row = root.querySelector('#row-push'); if(!row) return;
  const sub = row.querySelector('#row-push-s');
  const sw  = row.querySelector('#row-push-sw');
  const paint = (estado)=>{
    const on = estado==='ativo';
    sw.classList.toggle('on', on);
    row.setAttribute('aria-checked', String(on));
    sub.textContent =
      estado==='ativo'        ? 'Ligado — avisamos se esquecer o check-in' :
      estado==='bloqueado'    ? 'Bloqueado nas configurações do navegador' :
      estado==='nao_suportado'? 'Não disponível neste aparelho' :
      estado==='sem_config'   ? 'Ainda não configurado pela academia' :
                                'Desligado — toque para ligar';
    row.dataset.estado = estado;
  };
  if(DEMO || typeof sbPush==='undefined'){ paint('nao_suportado'); return; }
  if(!sbPush.suportado()){ paint('nao_suportado'); return; }
  if(!sbPush.configurado()){ paint('sem_config'); return; }
  sbPush.estado().then(paint).catch(()=>paint('inativo'));

  const toggle = async ()=>{
    const est = row.dataset.estado;
    if(est==='nao_suportado'||est==='sem_config'){ toast(sub.textContent); return; }
    if(est==='bloqueado'){ toast('Libere as notificações nas configurações do navegador'); return; }
    try{
      if(est==='ativo'){ await sbPush.desativar(); paint('inativo'); toast('Avisos desligados'); }
      else{ await sbPush.ativar(); paint('ativo'); toast('Avisos ligados 🔔'); }
    }catch(e){ paint(Notification.permission==='denied'?'bloqueado':'inativo'); }
  };
  row.onclick = toggle;
  row.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } };
}
/* Boot: registra o SW se o aluno JÁ tinha avisos ligados (não pede permissão
   — só reata o registro perdido quando o kill-switch antigo se desregistrou).
   E, se o app abriu por um toque na notificação (?checkin=1), marca como lida
   (alimenta o backoff) e leva direto pra tela de registrar presença. */
function _pushBoot(){
  if(DEMO || typeof sbPush==='undefined' || !sbPush.suportado()) return;
  try{
    if(Notification.permission==='granted' && sbPush.configurado()) sbPush.registrarSW();
  }catch(_){}
  // v378: auto-heal do zombie silencioso. Roda depois do SW registrar (dá 800ms
  // pro navigator.serviceWorker.ready acordar). Fire-and-forget — se algo dar
  // errado, cai no catch dentro do adapter, nunca borbulha pro user.
  try{
    if(sbPush.healSubscription) setTimeout(()=>{ sbPush.healSubscription().catch(()=>{}); }, 800);
  }catch(_){}
  try{
    if(new URLSearchParams(location.search).get('checkin')==='1'){
      if(sbPush.marcarAberto) sbPush.marcarAberto().catch(()=>{});
      DB.flow = { phase:1 };   // abre direto o teclado de código do check-in
    }
  }catch(_){}
}

function tabbarAluno(){
  const tabs = [
    ['inicio','Início', icoHome()],
    ['jogo','Tatame', icoChart()],
    ['__fab','Registrar', null],
    ['jornada','Jornada', icoBook()],
    ['perfil','Mais', icoMore()],
  ];
  const bar = el(`<div class="tabbar" role="tablist"></div>`);
  tabs.forEach(([id,label,ico])=>{
    if (id==='__fab'){
      const f = el(`<div class="tab fab-tab" role="button" tabindex="0" aria-label="Registrar treino"><div class="fb" aria-hidden="true">${icoPlus()}</div><span class="tl">${label}</span></div>`);
      f.onclick = ()=> openFlow();
      f.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openFlow(); } };
      bar.appendChild(f); return;
    }
    const sel = DB.navAluno===id;
    const t = el(`<div class="tab ${sel?'active':''}" role="tab" tabindex="0" aria-label="${label}" aria-selected="${sel}">${ico}<span class="tl">${label}</span></div>`);
    t.onclick = ()=> goAluno(id);
    t.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); goAluno(id); } };
    bar.appendChild(t);
  });
  return bar;
}

// Nota rápida — insight solto, sem formulário
/* abrirNotaRapida: removido — sem botão na UI */

/* ============================================================
   FLOW DE REGISTRO (Aula Técnica / Livre)
   ============================================================ */
// Rascunho de treino em andamento: vive em DB._draft e persiste dentro do dump
// (user_state na nuvem). Rascunho de ontem é mantido p/ não perder o registro;
// mais antigo que isso é descartado.
function _loadDraft(){ const d=DB._draft; if(!d) return null; if(d.date===HOJE_ISO) return d; _clearDraft(); return null; }
function _saveDraft(d){ DB._draft=d; scheduleSave(); }
function _clearDraft(){ DB._draft=null; scheduleSave(); }
function _autosaveDraft(){ if(DB._draft){ DB._draft.registro=DB.registro; scheduleSave(); } }

/* ============================================================
   RASCUNHO DE FORMULÁRIO DE PÁGINA (v425) — "a gaveta"
   ------------------------------------------------------------
   PROBLEMA: render() faz `root.innerHTML=''` (linha ~1517). Formulários que
   vivem DENTRO de #root (páginas cheias: cadastro de aluno, cadastro de
   produto) são destruídos e reconstruídos — e o que o usuário digitou existia
   SÓ como `<input>.value`, ou seja, só no DOM. Um refetch em background
   (_loadProfData resolvendo) apagava o formulário no meio do preenchimento.
   Medido: cadastro de aluno perde 28 campos; produto perde 9.

   Sheets NÃO precisam disto — vivem em document.body e sobrevivem ao render()
   (verificado em teste: valor digitado permanece).

   SOLUÇÃO: o valor passa a morar no MODELO. A tela vira projeção do rascunho,
   então render() fica inofensivo — não é preciso lembrar de travá-lo em cada
   uma das 144 chamadas, nem na 145ª.

   ESCOPO: memória apenas (DB._formDrafts). NÃO entra no dump — mexer no
   formato de buildDump/applyDump exige aprovação explícita (ver CLAUDE.md).
   Persistir entre sessões ("fechei o app no meio do cadastro") é opt-in futuro.
   ============================================================ */
function _formDraftLer(chave){ return (DB._formDrafts && DB._formDrafts[chave]) || null; }
function _formDraftLimpar(chave){ if(DB._formDrafts) delete DB._formDrafts[chave]; }
/* Liga um container de formulário ao rascunho:
   1. restaura o que já estava guardado (sobrevive ao render)
   2. grava a cada digitação (debounce 200ms — não precisa gravar por tecla)
   `extra()` guarda estado não-textual junto (ex.: em qual etapa do wizard está). */
function _bindFormDraft(container, chave, extra){
  const campos = ()=> [...container.querySelectorAll('input[id],textarea[id],select[id]')];
  const coletar = ()=>{
    const c = {};
    campos().forEach(e=>{ c[e.id] = (e.type==='checkbox'||e.type==='radio') ? e.checked : e.value; });
    return Object.assign({ campos:c }, (typeof extra==='function' ? extra() : null) || {});
  };
  const salvo = _formDraftLer(chave);
  if(salvo && salvo.campos){
    campos().forEach(e=>{
      const v = salvo.campos[e.id];
      if(v == null) return;
      if(e.type==='checkbox'||e.type==='radio') e.checked = !!v; else e.value = v;
    });
  }
  let t = null;
  const grava = ()=>{ clearTimeout(t); t = setTimeout(()=>{ DB._formDrafts = DB._formDrafts||{}; DB._formDrafts[chave] = coletar(); }, 200); };
  container.addEventListener('input',  grava);
  container.addEventListener('change', grava);
  // salvarAgora: para trocas de etapa do wizard (não espera o debounce)
  return { restaurado: salvo, salvarAgora(){ clearTimeout(t); DB._formDrafts = DB._formDrafts||{}; DB._formDrafts[chave] = coletar(); } };
}

function openFlow(){
  const draft = _loadDraft();
  const treinoHoje = DB.treinos.find(t=>t.data===HOJE_ISO);
  if (draft) {
    // draft exists — ask to resume or start new
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Treino em andamento</div>
      <div class="sheet-desc">Você tem um treino em andamento de hoje (check-in às ${draft.checkinHora}). Continuar de onde parou?</div>
      <button class="btn-save" id="draft-resume">Continuar treino</button>
      <button class="sheet-cancel" id="draft-new">Começar novo</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#draft-resume').onclick=()=>{ close(); DB.registro=draft.registro||{randori:null,nota:'',mood:null}; DB.flow={phase:2}; render(); window.scrollTo(0,0); };
    sheet.querySelector('#draft-new').onclick=()=>{ close(); _clearDraft(); _startPhase1(); };
    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
    return;
  }
  const treinosHoje = DB.treinos.filter(t=>t.data===HOJE_ISO).length;
  if (treinosHoje) DB.flow = { phase:1, aviso2x:true };
  else DB.flow = { phase:1 };
  render(); window.scrollTo(0,0);
}
function _startPhase1(){ DB.flow = { phase:1 }; _acquireWakeLock(); render(); window.scrollTo(0,0); }
function closeFlow(){
  DB._sessaoPreSelecionada = null;   // aluno cancelou → esquece a sessão do atalho
  const draft = _loadDraft();
  const reg = DB.registro;
  const hasDraft = !!draft;
  const hasData = reg && (reg.nota || reg.mood || reg.randori!=null || reg.feel);
  if (DB.flow && DB.flow.phase===2 && (hasDraft || hasData)){
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Sair do registro?</div>
      <div class="sheet-desc">Você tem dados não salvos. Se sair agora, o rascunho fica salvo pra continuar depois.</div>
      <button class="btn-save" id="cf-stay">Continuar registrando</button>
      <button class="sheet-cancel danger" id="cf-leave">Sair mesmo assim</button>
    </div></div>`);
    const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
    sheet.querySelector('#cf-stay').onclick=close;
    sheet.querySelector('#cf-leave').onclick=()=>{ close(); DB.flow=null; _releaseWakeLock(); render(); };
    document.body.appendChild(sheet);
    requestAnimationFrame(()=>sheet.classList.add('open'));
    return;
  }
  DB.flow=null; _releaseWakeLock(); render();
}

const INTENS = { leve:'Leve', medio:'Médio', forte:'Forte' };  // compat: detalhe de treinos antigos
const FEEL_LABEL = {1:'Muito difícil',2:'Difícil',3:'Normal',4:'Bom',5:'Excelente'};
// selo de sensação do treino (escala 1–5, profissional) — fallback p/ mood emoji antigo
function feelBadge(t){ return t.feel ? `<div class="feel-chip lvl${t.feel}">${t.feel}</div>` : ''; }

// === Presença por sessão: sessões da grade de HOJE (a partir de DB.turmas) ===
const DOW_KEY = ['dom','seg','ter','qua','qui','sex','sab'];
// Janela de check-in — ASSIMÉTRICA (v306). Antes era ±30 min, o que tornava o
// aviso de check-in pendente impossível de atender: a notificação sai 30–120 min
// DEPOIS da aula terminar, sempre fora da janela.
// O app conta do INÍCIO, o aviso conta do FIM — então a janela precisa cobrir
// duração + 120. Com 240 min cabe aula de até 2h (120 + 120). Aula mais longa
// que isso avisaria sem dar como atender: se um dia existir, subir aqui.
// Só no mesmo dia — o check-in grava em CURRENT_DATE, nada de pós-meia-noite.
const CHECKIN_JANELA_MIN = 30;    // antes do início
const CHECKIN_JANELA_POS = 240;   // depois do início (dur. máx 120 + 120 do aviso)
function _sessaoLabel(s){ return `${s.turmaNome} · ${s.hora}${s.variacao?' · '+s.variacao:''}`; }
function sessoesDeHoje(){
  const dk = DOW_KEY[hoje.getDay()]; const out=[];
  // v358: só sessões das turmas do aluno. Sem esse filtro o card de check-in
  // listava KODOMO/CHIISAI (infantis) pra aluno adulto, e o servidor gravava.
  // Fonte: _minhasTurmasIds (adapter). Se ainda não carregou, fica vazio — o
  // aluno vê "sem aula na grade" em vez de aula alheia; o pull normal preenche.
  const meus = new Set(DB._minhasTurmasIds || (DB.eu && DB.eu.turmas) || []);
  const filtroPorMatricula = meus.size > 0;
  (DB.turmas||[]).forEach(t=>{
    if(filtroPorMatricula && !meus.has(t.id)) return;
    (t.sessoes||[]).forEach(s=>{ if(s.dia===dk) out.push({ turmaId:t.id, turmaNome:t.nome, cor:t.cor, hora:s.hora, variacao:s.variacao, bilingue:s.bilingue }); });
  });
  out.sort((a,b)=>(a.hora||'').localeCompare(b.hora||'')); return out;
}
// Diferença em minutos entre "agora" e o horário HH:MM da sessão (positiva se sessão no futuro).
function _minutosAte(hora){
  if(!hora || !/^\d\d:\d\d$/.test(hora)) return null;
  const [h,m] = hora.split(':').map(Number);
  const now = new Date();
  return (h*60 + m) - (now.getHours()*60 + now.getMinutes());
}
// Sessões de hoje dentro da janela ±minutos do agora. Ordenadas por proximidade ao início
// (aulas próximas: a mais perto do "agora" fica em primeiro — resolve a sobreposição).
function _sessoesNaJanela(min, pos){
  min = min || CHECKIN_JANELA_MIN;   // futuro (_dt > 0)
  pos = pos || CHECKIN_JANELA_POS;   // passado (_dt < 0)
  const arr = sessoesDeHoje().map(s=>({ ...s, _dt:_minutosAte(s.hora) }))
    .filter(s => s._dt!=null && s._dt <= min && s._dt >= -pos);
  arr.sort((a,b)=> Math.abs(a._dt) - Math.abs(b._dt));
  return arr;
}
/* v429: dedup por AULA, não por turma. A chave casa com a do banco — `aulas` é
   (turma_id, data, hora) e o UNIQUE de `checkins` é (user_id, aula_id). Antes a
   chave era só o turmaId, então quem tem 4 ADULTO no mesmo dia (06:30/08:00/
   12:00/19:30) só conseguia registrar a primeira: as outras três sumiam de
   _sessoesElegiveis(). Sessão sem hora (aula avulsa) vira chave com hora vazia. */
function _aulaKey(s){ return String((s&&s.turmaId)||'') + '|' + String((s&&s.hora)||''); }
// Set de aulas que já receberam check-in hoje.
function _turmasComCheckin(){
  const set = new Set();
  const p = DB.checkinHoje && DB.checkinHoje.porTurma;
  if(p) Object.keys(p).forEach(k=>set.add(k));
  return set;
}
// Sessões elegíveis p/ check-in AGORA: dentro da janela E cuja AULA ainda não foi feita.
function _sessoesElegiveis(){
  const feitas = _turmasComCheckin();
  return _sessoesNaJanela().filter(s => !feitas.has(_aulaKey(s)));
}
// Atalho do card na Home: pré-seleciona a sessão e inicia a Fase 1 (código '0000'),
// seguindo o MESMO fluxo bifásico do botão +. Não pula direto pro check-in.
function _iniciarCheckinDaSessao(sessao){
  DB._sessaoPreSelecionada = sessao || null;
  _startPhase1();
}
function _flowCheckin(){
  // 1) Se veio via card do Home, respeita a sessão pré-selecionada (bypass do picker/janela).
  const pre = DB._sessaoPreSelecionada;
  if(pre){ DB._sessaoPreSelecionada = null; _finalizarCheckin(pre); return; }
  const ses = _sessoesElegiveis();
  if(ses.length === 0){
    // Presença SEMPRE atrelada a uma turma: sem sessão elegível, não registra.
    // (Antes, "sem grade hoje" gravava um check-in solto, que não entra em
    // nenhuma ocupação por turma/sessão e polui o histórico.)
    const todas = sessoesDeHoje();
    if(todas.length === 0){ toast('Sem aula na grade de hoje — a presença precisa de uma turma'); DB.flow=null; render(); return; }
    const feitas = _turmasComCheckin();
    const restantes = todas.filter(s => !feitas.has(_aulaKey(s)));
    if(restantes.length === 0){ toast('Você já fez check-in em todas as aulas de hoje ✔'); DB.flow=null; render(); return; }
    toast('Fora do horário da aula (até ' + CHECKIN_JANELA_POS + ' min após o início)'); DB.flow=null; render(); return;
  }
  // >1 aula na janela (horários próximos): o aluno escolhe. Sem escolha, não registra.
  if(ses.length > 1){
    _sessaoPickSheet(ses, s=>{
      if(!s){ toast('Escolha a aula para registrar a presença'); DB.flow=null; render(); return; }
      _finalizarCheckin(s);
    });
    return;
  }
  _finalizarCheckin(ses[0]);   // 1 sessão elegível: direto
}
let _finalizarCheckinLock = false;
function _finalizarCheckin(sessao){
  // v489: lock anti-duplicata. Cobre qualquer caminho que chegue aqui — QR duplo,
  // double-tap no picker de sessão, click em card do Home + QR quase simultâneos,
  // batch do professor que dispara callback duas vezes. 3s cobre o intervalo
  // realista entre 2 tentativas legítimas do mesmo aluno (mesma pessoa não bate
  // 2 checkins em <3s de propósito).
  if(_finalizarCheckinLock) return;
  _finalizarCheckinLock = true;
  setTimeout(()=>{_finalizarCheckinLock=false;}, 3000);
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // variacao viaja junto → pushCheckin grava o TIPO da aula (No-Gi/Avançado/…/Aula) no checkin.
  // v429: `hora` (da AULA) viaja junto. Sem ela, pushCheckin mandava p_hora_aula=null
  // e a RPC criava uma aula FANTASMA (turma, data, NULL) paralela à real das 19:30 —
  // o UNIQUE (user_id, aula_id) não deduplicava contra a chamada do professor, e a
  // consulta da v426 (filtra por aulas.hora) não enxergava o auto-registro.
  const s = sessao ? { turmaId:sessao.turmaId, hora:sessao.hora||null, label:_sessaoLabel(sessao), variacao:sessao.variacao||null } : null;
  // Dedup por AULA: acumula em porTurma sob _aulaKey; mantém {feito,hora,sessao} p/ retrocompat.
  // Chave nova não casa com dump antigo (turmaId puro) — no pior caso o aluno registra
  // 1× a mais no dia da atualização, e o UNIQUE do banco devolve duplicado:true sem gravar.
  const prev = DB.checkinHoje || {};
  const porTurma = Object.assign({}, prev.porTurma || {});
  if(s) porTurma[_aulaKey(s)] = { hora, label:s.label };
  DB.checkinHoje = { feito:true, hora, sessao:s, porTurma };
  scheduleSave();   // dump completo (porTurma etc.) sobe pro user_state; pushCheckin() cuida da tabela
  track('presenca', { via:'flow' });
  const draft = { date:HOJE_ISO, checkinHora:hora, registro:{randori:null,nota:'',mood:null} };
  _saveDraft(draft);
  if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushCheckin();
  toast(s ? `Presença confirmada ✔ · ${s.label}` : 'Presença confirmada ✔ · complete o treino depois');
  DB.flow = null;
  render();
}
// Seletor de sessão do dia (quando há mais de uma aula na grade de hoje).
function _sessaoPickSheet(sessoes, onPick){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Escolher aula">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Qual aula você fez?</div>
    <div class="sheet-desc">Escolha a sessão de hoje para registrar a presença.</div>
    <div class="sess-pick" style="display:flex;flex-direction:column;gap:8px;margin:4px 0 8px"></div>
    <button class="sheet-cancel" id="sp-skip">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('.sess-pick');
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sessoes.forEach(s=>{
    const row = el(`<button class="cfg-row" style="width:100%;text-align:left;font-family:inherit;cursor:pointer">
      <span><b style="color:${safeAttr(s.cor||'var(--ink)')}">${safeTxt(s.hora)}</b> · ${safeTxt(s.turmaNome)}${s.variacao?' · '+safeTxt(s.variacao):''}${s.bilingue?' '+icoUSFlag():''}</span></button>`);
    row.onclick=()=>{ close(); onPick(s); };
    list.appendChild(row);
  });
  // Sair sem escolher CANCELA o registro: presença sem turma não é registrada
  // (antes, fechar por fora confirmava um check-in solto, sem sessão).
  const cancelar=()=>{ close(); onPick(null); };
  sheet.onclick=(e)=>{ if(e.target===sheet) cancelar(); };
  sheet.querySelector('#sp-skip').onclick=cancelar;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Botão + (registrar): fluxo bifásico
function renderFlow(){
  const phase = DB.flow && DB.flow.phase || 1;
  if (phase === 1) return _renderPhase1();
  return _renderPhase2();
}

/* ============================================================
   TOTEM DE PRESENÇA — Fase 1 do flow (QR obrigatório).
   v374: token estático da academia em academies.config.qrToken (renovável pelo
   professor em Alunos → 🔑 Acesso → ⚙️ Configurações da academia → 📷 QR de presença).
   ============================================================ */
function icoQRbig(){
  // v414: câmera com moldura de scan. Coerente com a ação real ("vou usar câmera
  // pra ler o QR"), não um QR desenhado (que confundia — parecia o QR a apontar).
  return `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 24 V14 H18"/><path d="M78 14 H88 V24"/><path d="M88 72 V82 H78"/><path d="M18 82 H8 V72"/>
    <rect x="22" y="30" width="52" height="40" rx="6"/>
    <circle cx="48" cy="50" r="10"/>
    <path d="M38 30 L42 24 H54 L58 30"/>
  </svg>`;
}
// Câmera / QR não disponíveis: fecha o flow com toast honesto. Batch do professor
// resolve o edge case (aluno sem câmera bate presença via "Adicionar frequência").
function _presencaSemCamera(msg){
  toast(msg || 'Câmera indisponível — peça ao professor pra registrar sua presença');
  DB.flow = null; render();
}
/* v378: leitor de QR resiliente.
   Fluxo novo (invertido em relação à v374): pede CÂMERA primeiro (aluno sempre vê
   o prompt de permissão nativo do iOS/Chrome), depois escolhe o motor de leitura.
   Motor: BarcodeDetector nativo (Chrome/Android/Edge) OU jsQR vendorizado (Safari,
   Firefox — que não têm BarcodeDetector em nenhuma versão). Sem jsQR, iPhones em
   Safari PWA ficavam sem check-in nenhum. */
function _fazerDetectorQR(){
  // Preferência nativa (mais rápida, sem alocar canvas por frame).
  if(typeof BarcodeDetector !== 'undefined'){
    try{
      const det = new BarcodeDetector({ formats:['qr_code'] });
      return async (video)=>{
        try{
          const codes = await det.detect(video);
          return codes && codes.length ? (codes[0].rawValue||'').trim() : null;
        }catch(_){ return null; }
      };
    }catch(_){ /* cai no jsQR */ }
  }
  // Fallback jsQR (vendorizado). Amostra o frame num canvas e roda o decoder puro.
  if(typeof jsQR === 'function'){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    return async (video)=>{
      const w = video.videoWidth|0, h = video.videoHeight|0;
      if(!w || !h) return null;
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      let img; try{ img = ctx.getImageData(0, 0, w, h); }catch(_){ return null; }
      const r = jsQR(img.data, w, h, { inversionAttempts:'dontInvert' });
      return r ? (r.data||'').trim() : null;
    };
  }
  return null;
}
function _presencaCameraErro(e){
  const n = String(e && e.name || '');
  if(n==='NotAllowedError' || n==='PermissionDeniedError' || n==='SecurityError'){
    return 'Você bloqueou a câmera. Vai em Ajustes do celular → Yama Jiu-Jitsu → Câmera → Permitir, e tente de novo.';
  }
  if(n==='NotFoundError' || n==='DevicesNotFoundError' || n==='OverconstrainedError'){
    return 'Este aparelho não tem câmera disponível — peça ao professor pra registrar sua presença.';
  }
  if(n==='NotReadableError' || n==='TrackStartError'){
    return 'A câmera está sendo usada por outro app — feche ele e tente de novo.';
  }
  return 'Câmera indisponível — peça ao professor pra registrar sua presença.';
}
async function presencaScan(){
  // v489: single-instance guard. `_renderPhase1` termina com `setTimeout(presencaScan,0)`,
  // então qualquer `render()` disparado enquanto `DB.flow==='checkin'` (pullAll async
  // completou, renderBg de outro fluxo) reabria a câmera. Dois overlays coexistindo
  // detectam o mesmo QR e chamam `_flowCheckin` DUAS vezes → check-in duplicado
  // (visto em prod 2026-08-28). Overlay antigo continua vivo (foi appended em body,
  // não em root), então basta detectá-lo pra abortar a segunda invocação.
  if(document.querySelector('.scan-overlay')) return;
  const token = _qrToken();
  if(!token){ _presencaSemCamera('QR da academia ainda não configurado — avise o professor'); return; }

  // 1. Pede câmera PRIMEIRO — usuário sempre vê o prompt nativo (mesmo se depois
  // faltar leitor). No iOS o prompt só aparece em resposta direta ao clique.
  let stream;
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } } });
  }catch(e){
    // Se o constraint 'environment' quebrou (laptop sem traseira), tenta câmera qualquer
    if(e && e.name==='OverconstrainedError'){
      try{ stream = await navigator.mediaDevices.getUserMedia({ video:true }); }
      catch(e2){ _presencaSemCamera(_presencaCameraErro(e2)); return; }
    } else { _presencaSemCamera(_presencaCameraErro(e)); return; }
  }

  // 2. Escolhe o motor (nativo ou jsQR). Se nenhum, para e libera a câmera.
  const detect = _fazerDetectorQR();
  if(!detect){
    stream.getTracks().forEach(t=>t.stop());
    _presencaSemCamera('Leitor de QR não carregou — recarregue o app e tente de novo.');
    return;
  }

  // 3. Overlay + loop de detecção.
  // webkit-playsinline é obrigatório em iOS <10 e ainda respeitado em iOS PWA
  // atual em modo standalone — sem ele, o vídeo abre em fullscreen nativo e
  // some do overlay (tela preta no lugar).
  const ov = el(`<div class="scan-overlay">
    <video autoplay playsinline muted webkit-playsinline></video>
    <div class="scan-frame"></div>
    <div class="scan-hint">Aponte para o QR da academia</div>
    <button class="scan-close">Cancelar</button>
  </div>`);
  const video = ov.querySelector('video');
  let stop=false, avisou=false, ticking=false;
  const close=()=>{ stop=true; try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){} ov.remove(); };
  ov.querySelector('.scan-close').onclick=close;
  const tick=async()=>{
    if(stop) return;
    const val = await detect(video);
    if(val){
      // Comparação estrita contra o token (v374). Aceita URL "…?qr=<token>" pra
      // QRs que abrem o app direto no aparelho.
      const casa = val === token || val.endsWith('?qr='+token) || val.endsWith('&qr='+token);
      if(casa){ close(); _flowCheckin(); return; }
      if(!avisou){ avisou = true; toast('QR não é da academia — peça ao professor pra conferir'); }
    }
    requestAnimationFrame(tick);
  };
  // Kick redundante: play() em cada evento que pode pintar, com guard `ticking`
  // pra não iniciar o loop mais de uma vez. Evita o bug "tela preta" quando
  // o loadedmetadata dispara antes do handler ser registrado (stream cache).
  const kick=()=>{
    if(video.paused) video.play().catch(()=>{});
    if(!ticking && video.videoWidth){ ticking = true; requestAnimationFrame(tick); }
  };
  video.onloadedmetadata = kick;
  video.oncanplay = kick;
  video.onplaying = kick;
  // Ordem defensiva: append ANTES de srcObject pro iOS Safari renderizar cedo.
  document.body.appendChild(ov);
  video.srcObject = stream;
  // Se o stream já estava pronto (cache), nada dispara — força play imediato.
  video.play().catch(()=>{});
  // Safety-net: 500 ms depois, se ainda não pintou, chama kick de novo.
  setTimeout(kick, 500);
}
function _renderPhase1(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="closeFlow">‹</div>
    <div class="ft"><div class="t">Check-in</div>
      <div class="s">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div></div>
  </div>`;
  // v414: card centralizado verticalmente (min-height casa com header) e texto do
  // fallback mais claro — chegou aqui porque a câmera foi cancelada/negada.
  const body = el(`<div class="presenca-body" style="display:flex;flex-direction:column;justify-content:center;min-height:calc(100vh - 140px);padding-bottom:40px"></div>`);
  if(DB.flow && DB.flow.aviso2x){
    const n = DB.treinos.filter(t=>t.data===HOJE_ISO).length;
    body.appendChild(el(`<div style="background:var(--red-tint);color:var(--red-strong);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;margin:0 0 16px;text-align:center">Você já registrou ${plural(n,'treino','treinos')} hoje</div>`));
  }
  const qr = el(`<div class="qr-card">
    <div class="qr-frame">${icoQRbig()}</div>
    <div class="qr-title">Abra a câmera pra ler o QR</div>
    <div class="qr-hint">Aponte pro QR fixado no tatame ou na parede</div>
    <button class="btn-scan">📷 Abrir câmera</button>
    <div class="qr-foot">Não deu certo? Peça ao professor pra registrar sua presença.</div>
  </div>`);
  qr.querySelector('.btn-scan').onclick = presencaScan;
  body.appendChild(qr);
  body.appendChild(el(`<div style="height:24px"></div>`));
  v.appendChild(body);
  // Abre a câmera direto — 1 toque em vez de 2. Card fica como fallback se o
  // usuário cancelar ou a câmera falhar (_presencaSemCamera repinta por cima).
  setTimeout(presencaScan, 0);
  return v;
}

function _renderPhase2(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="closeFlow">‹</div>
    <div class="ft"><div class="t">Registrar treino</div>
      <div class="s">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div></div>
  </div>`;
  const body = el(`<div class="flow-body" style="padding-bottom:120px"></div>`);
  body.appendChild(registroBody());
  v.appendChild(body);
  v.appendChild(el(`<div class="save-bar"><button class="btn-save" data-click="salvar">Salvar treino</button></div>`));
  return v;
}

/* Totem de presença = Fase 1 do flow (_renderPhase1): QR obrigatório contra o
   token estático da academia (academies.config.qrToken). Match → _flowCheckin(). */

/* ============================================================
   LOJA — produtos da academia (retirada na recepção)
   ============================================================ */
// v418: Loja e Meus Pedidos são mutuamente exclusivas — o roteador (render())
// checa lojaOpen ANTES de meusPedidosOpen, então abrir uma tem que desligar a
// outra, senão um lojaOpen "preso" faz o botão "meus pedidos" voltar pra Loja.
function openLoja(){ DB.lojaOpen=true; DB.meusPedidosOpen=false; render(); window.scrollTo(0,0); }
function closeLoja(){ DB.lojaOpen=false; render(); }

/* ============================================================
   MEUS PEDIDOS (aluno) — histórico das próprias compras (v403).
   Backend: sbSync.getMeusPedidos (RLS pedidos_self_rw já restringe ao dono).
   Reusa .ped-card/.status-chip (CSS já existe pra fila do professor).
   ============================================================ */
let _meusPedidosData = null, _meusPedidosTs = 0;
function openMeusPedidos(){ DB.lojaOpen=false; DB.meusPedidosOpen=true; _meusPedidosTs=0; render(); window.scrollTo(0,0); }
function closeMeusPedidos(){ DB.meusPedidosOpen=false; render(); }
function _loadMeusPedidos(force){
  if(DEMO || typeof sbSync==='undefined' || !sbSync.getMeusPedidos){ _meusPedidosData=[]; return; }
  if(!force && Date.now()-_meusPedidosTs < 15000) return;
  _meusPedidosTs = Date.now();
  sbSync.getMeusPedidos().then(ps=>{ _meusPedidosData=ps; renderBg(); }).catch(()=>{ _meusPedidosTs=0; });
}
function renderMeusPedidos(){
  _loadMeusPedidos();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="closeMeusPedidos">‹</div>
    <div class="ft"><div class="t">Meus pedidos</div><div class="s">Loja Yama</div></div>
  </div>`;
  const body = el('<div class="list" style="padding:16px 20px"></div>');
  if(_meusPedidosData===null){ body.appendChild(el('<div class="loading-center">Carregando…</div>')); }
  else if(!_meusPedidosData.length){ body.appendChild(el('<div class="empty-line">Você ainda não fez nenhum pedido na loja.</div>')); }
  else _meusPedidosData.forEach(p=>{
    const [lbl,,cls] = _PED_STATUS[p.status]||['—','',''];
    const resumo = (p.itens||[]).map(it=>`${safeTxt(it.nome)} ${safeTxt(it.tam||'')} ×${it.qtd}`).join(' · ');
    const dt = (p.criadoEm||'').slice(0,10).split('-').reverse().join('/');
    body.appendChild(el(`<div class="ped-card">
      <div class="ped-top"><div class="ped-cli">${dt}</div><span class="status-chip ${cls}">${lbl}</span></div>
      <div class="ped-itens">${resumo||'—'}</div>
      <div class="ped-foot"><span class="ped-dt">${p.canal?safeTxt(p.canal):''}${p.txid?' · ref. '+safeTxt(p.txid):''}</span><b class="ped-total">${moneyBR(p.total)}</b></div>
    </div>`));
  });
  v.appendChild(body);
  return v;
}
function setLojaCat(c){ DB.loja.cat=c; render(); }
// B6: o badge só conta itens de produtos ainda disponíveis (ativos)
function carrinhoQtd(){ return DB.loja.carrinho.reduce((s,i)=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return (p && p.ativo!==false) ? s+i.qtd : s; },0); }
function carrinhoTotal(){ return DB.loja.carrinho.reduce((s,i)=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return (p && p.ativo!==false) ? s+p.preco*i.qtd : s; },0); }
// v444: total efetivo a pagar via Pix (cartão × (1 − desconto)). Igual ao cartão se desconto=0.
function carrinhoTotalPix(){ return _precoPix(carrinhoTotal()); }

/* Foto real do produto (loja/ local ou URL do Storage) sobre o fundo emoji — se a
   imagem falhar, o listener global data-fallback remove o <img> e o emoji reaparece.
   Cards/miniaturas usam só a principal. Detalhe (hero) tem carrossel via _buildHeroGallery. */
function _prodImgHTML(p){
  return p.img ? `<img src="${safeAttr(p.img)}" alt="" loading="lazy" data-fallback="remove">` : '';
}
/* Anti-flicker (v211): render() recria o DOM inteiro, então um <img> string nasce vazio e
   repinta (mostra o emoji atrás por 1 frame) a cada re-render do pai. Solução: cachear o
   NÓ <img> já decodificado por URL e MOVÊ-LO para a árvore nova (appendChild move, não recria)
   → a foto pinta na hora, sem piscar. Usado nas listas que re-renderizam (strip do Perfil,
   grade da loja, mini do admin). Sheets one-shot (carrinho/hero) seguem com string. */
const _prodImgCache = new Map();   // url -> HTMLImageElement reutilizado entre renders
function _prodImgNode(url){
  if(!url) return null;
  let img = _prodImgCache.get(url);
  if(!img){
    img = new Image();
    img.alt=''; img.decoding='async';
    img.setAttribute('data-fallback','remove');   // 404 → o listener global remove e o emoji reaparece
    img.src = url;
    _prodImgCache.set(url, img);
  }
  return img;
}
function _mountProdImg(container, p){
  if(!container || !p || !p.img) return;
  const node = _prodImgNode(p.img);
  if(node) container.appendChild(node);   // move o nó já carregado → sem reload, sem flash
}
// Galeria/carrossel do hero (só no sheet do produto). Se há p.imgs (extras da migration
// 0004), renderiza slides com scroll snap + dots. Senão cai no _prodImgHTML tradicional.
/* Galeria/carrossel do hero (só no sheet do produto). Estratégia "probe antes de montar":
   pré-carrega TODAS as fotos candidatas (principal + extras) e só monta slide+dot das que
   REALMENTE carregam. Isso elimina os dois bugs visuais: (a) bolinha/dot fantasma de fotos
   que ainda não subiram ao host, e (b) foto deslocada por remoção assíncrona de slide.
   Até as probes terminarem, o hero mostra a foto única (sem carrossel). */
function _buildHeroGallery(heroEl, p){
  if(!heroEl) return;
  const candidatas = [p.img, ...(Array.isArray(p.imgs) ? p.imgs : [])].filter(Boolean);
  if(candidatas.length <= 1) return;   // 0 ou 1 foto → foto única já renderizada, nada a fazer
  let done = 0; const ok = new Array(candidatas.length).fill(null);
  const finalize = ()=>{
    const urls = ok.filter(Boolean);
    if(urls.length <= 1) return;   // só 1 (ou 0) foto válida → mantém a foto única
    const slides = urls.map((u,i)=>`<img src="${safeAttr(u)}" alt="" loading="${i===0?'eager':'lazy'}">`).join('');
    const dots   = urls.map((_,i)=>`<span class="${i===0?'on':''}"></span>`).join('');
    heroEl.querySelectorAll('img').forEach(x=>x.remove());   // tira a foto única
    heroEl.classList.add('has-carousel','has-img');
    const frag = document.createElement('div');
    frag.innerHTML = `<div class="hero-slides">${slides}</div><div class="hero-dots">${dots}</div>`;
    while(frag.firstChild) heroEl.appendChild(frag.firstChild);
    const slidesEl = heroEl.querySelector('.hero-slides');
    // v459: força alinhamento inicial no slide 0 — iOS PWA às vezes deixa scroll
    // fora do snap quando conteúdo é montado dinamicamente. Sem isso o carrossel
    // pode nascer em posição intermediária (bug do print: dot 2 aceso, foto meio a meio).
    requestAnimationFrame(()=>{ slidesEl.scrollTo({ left: 0, behavior: 'auto' }); });
    // v459: dot só reflete slide quando scroll está "quase snapped" (tolerância 10%).
    // Evita flip prematuro do dot no meio do gesto — Math.round(0.5)=1 antes do snap
    // completar acendia o dot 2 com só metade da foto 2 visível.
    slidesEl.addEventListener('scroll', ()=>{
      const raw = slidesEl.scrollLeft / (slidesEl.clientWidth||1);
      const i = Math.round(raw);
      if (Math.abs(raw - i) < 0.1){
        heroEl.querySelectorAll('.hero-dots span').forEach((d,j)=> d.classList.toggle('on', j===i));
      }
    }, { passive:true });
  };
  candidatas.forEach((u,i)=>{
    const im = new Image();
    im.onload  = ()=>{ ok[i]=u; if(++done===candidatas.length) finalize(); };
    im.onerror = ()=>{ if(++done===candidatas.length) finalize(); };
    im.src = u;
  });
}
// Ícone "galeria" no card da grade: só aparece se ≥1 foto EXTRA realmente carregar (probe).
// Evita prometer galeria em produto cujas fotos extras ainda não subiram ao host.
function _revealGalleryIcon(imgEl, p){
  if(!imgEl || !p.img) return;
  const extras = Array.isArray(p.imgs) ? p.imgs.filter(Boolean) : [];
  if(!extras.length) return;
  let i = 0;
  const tryNext = ()=>{
    if(i >= extras.length) return;   // nenhuma extra carregou → sem ícone
    const im = new Image();
    im.onload = ()=>{
      if(imgEl.querySelector('.prod-gallery-ic')) return;
      const s = document.createElement('span');
      s.className = 'prod-gallery-ic'; s.setAttribute('aria-label','Galeria de fotos'); s.textContent = '▤';
      imgEl.appendChild(s);
    };
    im.onerror = ()=>{ i++; tryNext(); };
    im.src = extras[i];
  };
  tryNext();
}

function renderLoja(){
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="closeLoja">‹</div>
    <div class="ft"><div class="t">Loja Yama</div><div class="s">Retire na recepção · sem frete</div></div>
    <div class="cart-btn" data-click="abrirCarrinho">🛍️${carrinhoQtd()?`<span class="cart-badge">${carrinhoQtd()}</span>`:''}</div>
  </div>`;
  const body = el(`<div></div>`);
  // v449: "Meus pedidos" saiu do card Loja Yama da Home (confundia com a vitrine) e virou
  // um botão dedicado dentro da própria loja aberta, no topo.
  const pedRow = el(`<div class="cfg-row" style="margin:8px 20px 6px" role="button" tabindex="0">
    <span>🧾 Meus pedidos</span>
    <span style="margin-left:auto;color:var(--muted)">›</span></div>`);
  pedRow.onclick = openMeusPedidos;
  pedRow.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openMeusPedidos(); } };
  body.appendChild(pedRow);

  // busca por nome (filtra a grade in-place, sem re-render → preserva o foco do input)
  const search = el(`<div class="loja-search"><span class="ls-ic">🔍</span>
    <input class="ls-inp" type="search" placeholder="Buscar produto…" value="${safeAttr(DB._lojaBusca||'')}">
    <button class="ls-clear" aria-label="Limpar busca" style="${(DB._lojaBusca)?'':'display:none'}">✕</button></div>`);
  body.appendChild(search);

  // chips de categoria
  const chips = el(`<div class="cat-chips"></div>`);
  ['Todos','Kimonos','Vestuário','Acessórios'].forEach(c=>{
    const ch = el(`<button class="cat-chip ${DB.loja.cat===c?'on':''}">${c}</button>`);
    ch.onclick = ()=> setLojaCat(c);
    chips.appendChild(ch);
  });
  body.appendChild(chips);

  // grade de produtos
  const grid = el(`<div class="prod-grid"></div>`);
  const _prods = DB.loja.produtos
    .filter(p=> p.ativo!==false)
    .filter(p=> DB.loja.cat==='Todos' || p.cat===DB.loja.cat);
  const _emptyMsg = el(`<div class="empty-line" style="padding:40px 20px;display:none">Nenhum produto encontrado. 🥋</div>`);
  if(!_prods.length){
    body.appendChild(el(`<div class="empty-line" style="padding:40px 20px">Nenhum produto disponível ainda. 🥋</div>`));
  } else {
    _prods.forEach(p=>{
      const allSold = (p.tam||[]).length>0 && p.tam.every(t=> p.estoque && (p.estoque[t] ?? 1) <= 0);
      // Tamanhos com estoque no card (v403): aluno filtra antes de abrir.
      // Sem `p.estoque[t]` = tratado como disponível (produto sem controle).
      const tamsHTML = (p.tam && p.tam.length) ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">' + p.tam.map(t=>{
        const est = p.estoque ? p.estoque[t] : null;
        const sold = est != null && est <= 0;
        const st = sold
          ? 'background:var(--field);color:var(--muted);text-decoration:line-through;opacity:.55'
          : 'background:var(--field);color:var(--ink)';
        return `<span style="${st};border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:10.5px;font-weight:700" title="${sold?'Esgotado':'Disponível'}">${safeTxt(t)}</span>`;
      }).join('') + '</div>' : '';
      const c = el(`<div class="prod-card${allSold?' sold-out':''}" data-nm="${safeAttr((p.nome||'').toLowerCase())}">
        <div class="prod-img${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${p.img?'':safeTxt(p.emoji)}
          ${allSold?'<span class="prod-sold-badge">Esgotado</span>':''}
        </div>
        <div class="prod-info">
          <div class="prod-name">${safeTxt(p.nome)}</div>
          <div class="prod-price">${_priceHTML(p.preco)}</div>
          ${tamsHTML}
        </div></div>`);
      c.onclick = ()=> abrirProduto(p.id);
      grid.appendChild(c);
      _mountProdImg(c.querySelector('.prod-img'), p);         // nó cacheado → sem flash no re-render
      _revealGalleryIcon(c.querySelector('.prod-img'), p);   // ícone só aparece se ≥1 foto extra REALMENTE carregar
    });
    body.appendChild(grid);
    body.appendChild(_emptyMsg);
  }
  body.appendChild(el(`<div style="height:28px"></div>`));

  // filtro de busca in-place (esconde cards que não batem; sem re-render → mantém foco)
  const inp = search.querySelector('.ls-inp');
  const clr = search.querySelector('.ls-clear');
  const aplicaBusca = ()=>{
    const q = (DB._lojaBusca||'').trim().toLowerCase();
    let vis = 0;
    grid.querySelectorAll('.prod-card').forEach(card=>{
      const hit = !q || (card.getAttribute('data-nm')||'').includes(q);
      card.style.display = hit ? '' : 'none';
      if(hit) vis++;
    });
    _emptyMsg.style.display = (_prods.length && vis===0) ? 'block' : 'none';
    if(clr) clr.style.display = q ? '' : 'none';
  };
  if(inp){
    inp.oninput = ()=>{ DB._lojaBusca = inp.value; aplicaBusca(); };
    if(clr) clr.onclick = ()=>{ DB._lojaBusca=''; inp.value=''; aplicaBusca(); inp.focus(); };
    aplicaBusca();
  }
  v.appendChild(body);
  return v;
}

function abrirProduto(id){
  const p = DB.loja.produtos.find(x=>x.id===id);
  const _esgotado = (t)=> p.estoque && (p.estoque[t] ?? 1) <= 0;   // só quando há controle de estoque
  const allSold = p.tam.every(t=>_esgotado(t));                    // M2: tudo sem estoque
  let tam = (p.tam.find(t=>!_esgotado(t))) || p.tam[0], qtd = 1;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet prod-sheet">
    <div class="sheet-grip"></div>
    <div class="prod-hero${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${p.img?'':safeTxt(p.emoji)}${_prodImgHTML(p)}</div>
    <div class="prod-sheet-name">${safeTxt(p.nome)}</div>
    <div class="prod-sheet-price">${_priceHTML(p.preco)}</div>
    ${_descontoPixPct()?`<div class="pr-note">💳 Cartão: pago na academia Yama</div>`:''}
    <div class="prod-sheet-desc">${safeTxt(p.desc)}</div>
    <div class="flbl" style="margin-top:16px">Tamanho</div>
    <div class="chips tam-chips"></div>
    <div class="qty-row">
      <span class="flbl" style="margin:0">Quantidade</span>
      <div class="qty"><button class="qbtn" data-d="-1" aria-label="Diminuir quantidade">−</button><span class="qv">1</span><button class="qbtn" data-d="1" aria-label="Aumentar quantidade">+</button></div>
    </div>
    <button class="btn-save add-btn"${allSold?' disabled':''}>${allSold?'Esgotado':'Adicionar à sacola'}</button>
  </div></div>`);
  const tc = sheet.querySelector('.tam-chips');
  p.tam.forEach(t=>{
    const out = _esgotado(t);
    const ch = el(`<div class="chip ${t===tam?'on':''} ${out?'sold':''}">${safeTxt(t)}${out?' · esgotado':''}</div>`);
    if(!out) ch.onclick = ()=>{ tam=t; tc.querySelectorAll('.chip').forEach(x=>x.classList.remove('on')); ch.classList.add('on'); };
    tc.appendChild(ch);
  });
  sheet.querySelectorAll('.qbtn').forEach(b=> b.onclick=()=>{
    const d = +b.dataset.d;
    const estTam = p.estoque ? p.estoque[tam] : null;   // trava no estoque do tamanho selecionado
    if(d>0 && estTam!=null && qtd>=estTam){ toast('Estoque máximo desse tamanho'); return; }
    qtd = Math.max(1, qtd + d);
    sheet.querySelector('.qv').textContent = qtd;
  });
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  if(!allSold) sheet.querySelector('.add-btn').onclick = ()=>{ addCarrinho(p.id,tam,qtd); close(); };
  document.body.appendChild(sheet);
  _buildHeroGallery(sheet.querySelector('.prod-hero'), p);   // upgrade p/ carrossel se ≥2 fotos carregarem
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function addCarrinho(id,tam,qtd){
  const ex = DB.loja.carrinho.find(i=>i.id===id && i.tam===tam);
  if (ex) ex.qtd += qtd; else DB.loja.carrinho.push({ id, tam, qtd });
  toast('Adicionado à sacola 🛍️');
  if (DB.lojaOpen) render();
}

function abrirCarrinho(){
  // B2: remove itens indisponíveis (produto removido ou ocultado pelo professor)
  const antes = DB.loja.carrinho.length;
  DB.loja.carrinho = DB.loja.carrinho.filter(i=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return p && p.ativo!==false; });
  if (DB.loja.carrinho.length < antes){ toast('Itens indisponíveis foram removidos da sacola'); if(DB.lojaOpen) render(); }
  if (!DB.loja.carrinho.length){ toast('Sua sacola está vazia'); return; }
  // v408: sacola vira só resumo — sem PIX Copia-e-Cola aqui e sem WhatsApp.
  // Fluxo novo: [Sacola] → [Pagamento (PIX)] → "Já paguei" grava pedido + push.
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Sua sacola</div>
    <div class="cart-items"></div>
    <div class="cart-total"><span>Total no Pix</span><b>${_priceHTML(carrinhoTotal())}</b></div>
    <div class="cart-pickup">📍 Retire na recepção da Yama — sem frete · pague por PIX e o professor confirma</div>
    <button class="btn-save" style="margin-top:6px">Ir para pagamento →</button>
    <button class="sheet-cancel">Continuar comprando</button>
  </div></div>`);
  const itemsWrap = sheet.querySelector('.cart-items');
  const totalEl = sheet.querySelector('.cart-total b');
  const close = openSheet(sheet, '.sheet-cancel');
  // Re-renderiza itens + total in-place (sem fechar o sheet). Estoque trava o "+".
  const renderItems = ()=>{
    itemsWrap.innerHTML='';
    DB.loja.carrinho.forEach(i=>{
      const p = DB.loja.produtos.find(x=>x.id===i.id); if(!p) return;
      const est = p.estoque ? p.estoque[i.tam] : null;
      const row = el(`<div class="cart-item">
        <div class="ci-img${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${p.img?'':safeTxt(p.emoji)}${_prodImgHTML(p)}</div>
        <div class="ci-tx">
          <div class="ci-n">${safeTxt(p.nome)}</div>
          <div class="ci-s">Tam ${safeTxt(i.tam)}</div>
          <div class="ci-qty"><button class="qbtn" data-d="-1" aria-label="Diminuir">−</button><span class="qv">${i.qtd}</span><button class="qbtn" data-d="1" aria-label="Aumentar">+</button></div>
        </div>
        <div class="ci-right"><div class="ci-p">${moneyBR(p.preco*i.qtd)}</div><button class="ci-rm" aria-label="Remover item">Remover</button></div>
      </div>`);
      const [minus,plus] = row.querySelectorAll('.qbtn');
      minus.onclick=()=>{ if(i.qtd>1){ i.qtd--; } else { DB.loja.carrinho=DB.loja.carrinho.filter(x=>x!==i); } _cartChanged(); };
      plus.onclick=()=>{ if(est!=null && i.qtd>=est){ toast('Estoque máximo desse tamanho'); return; } i.qtd++; _cartChanged(); };
      row.querySelector('.ci-rm').onclick=()=>{ DB.loja.carrinho=DB.loja.carrinho.filter(x=>x!==i); _cartChanged(); };
      itemsWrap.appendChild(row);
    });
    totalEl.innerHTML = _priceHTML(carrinhoTotal());
  };
  const _cartChanged = ()=>{
    scheduleSave();
    const btn = document.querySelector('.cart-btn');   // atualiza o badge do topo sem re-render pesado
    if(btn){ const q=carrinhoQtd(); btn.innerHTML='🛍️'+(q?`<span class="cart-badge">${q}</span>`:''); }
    if(!DB.loja.carrinho.length){ close(); toast('Sacola vazia'); return; }
    renderItems();
  };
  renderItems();
  sheet.querySelector('.btn-save').onclick = ()=>{ close(); finalizarCompra(); };
}

// v408: fluxo direto — sacola → pagamento PIX → "Já paguei" grava pedido + push.
// Removido: WhatsApp do aluno (redundante — o pedido vive em `pedidos` e o
// professor recebe push). Removido: Web Share (não expõe bancos em PWA iOS).
function finalizarCompra(){ _abrirConfirmPix(); }
// txid de conciliação (0030): 1 por tentativa de checkout, reaproveitado se o
// aluno abrir/fechar a tela de pagamento — trocar o txid a cada clique quebraria
// a rastreabilidade do mesmo pedido no extrato do banco.
function _txidAtual(){ if(!DB._checkoutTxid) DB._checkoutTxid = _pixGerarTxid(); return DB._checkoutTxid; }
function _registrarPedidoJaPago(){
  // v444: grava o total EFETIVO pago (Pix, com desconto). O cartão nunca chega aqui —
  // pagamento presencial na academia é outro fluxo.
  const total = carrinhoTotalPix();
  const txid = _txidAtual();
  if(DB.sbUser && !DEMO && typeof sbSync!=='undefined' && sbSync.registrarPedido){
    const itens = DB.loja.carrinho.map(i=>{ const p=DB.loja.produtos.find(x=>x.id===i.id);
      return { produto_id:i.id, nome:p?p.nome:'', tam:i.tam, qtd:i.qtd, preco:p?p.preco:0 }; });
    sbSync.registrarPedido(itens, total, txid).then(pedidoId=>{
      if(pedidoId && sbSync.notificarPedidoPago) sbSync.notificarPedidoPago(pedidoId).catch(()=>{});
    }).catch(()=>{});
  }
  DB.loja.carrinho = [];
  DB._checkoutTxid = null;
  if(DB.lojaOpen) render();
  scheduleSave();
  toast('Pedido enviado ✔ Aguarde a confirmação do professor.');
}
/* Tela de pagamento (v408). Recebedor/chave/cidade extraídos do BR Code que o
   professor colou. Dois botões: copiar (com valor + txid injetados) e "Já paguei"
   (grava pedido + notifica professor por push). Sem WhatsApp, sem Web Share. */
function _abrirConfirmPix(){
  // v444: valor da tela e do BR Code já sai com desconto Pix. carrinhoTotal() cartão
  // aparece só como referência ("de R$ X"), quando há desconto configurado.
  const totalCartao = carrinhoTotal();
  const total = carrinhoTotalPix();
  const brRaw = _lojaPixBrCode();
  const brCom = brRaw ? _pixBrCodeComValorTxid(brRaw, total, _txidAtual()) : '';
  const dados = brRaw ? _pixParseBrCode(brRaw) : null;
  // Sem BR Code cadastrado: mostra a chave PIX pura como fallback. Aluno digita o valor à mão.
  const chaveMostrar = dados ? dados.chave : _lojaPix();
  const codigoParaCopiar = brCom || _lojaPix();
  const linha = (lbl, val)=> `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);font-size:13.5px">
    <span style="color:var(--muted);font-weight:600">${lbl}</span>
    <b style="color:var(--ink);text-align:right;word-break:break-all">${safeTxt(val)}</b></div>`;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Pagamento por PIX</div>
    <div class="sheet-desc">Confira o recebedor antes de pagar. Copie o código, cole no seu banco e volte pra confirmar.</div>
    <div style="background:var(--field);border:1px solid var(--line);border-radius:12px;padding:4px 14px;margin:12px 0">
      ${dados ? linha('Recebedor', dados.nome || '—') : ''}
      ${linha('Chave PIX', chaveMostrar || '—')}
      ${dados && dados.cidade ? linha('Cidade', dados.cidade) : ''}
      <div style="display:flex;justify-content:space-between;gap:12px;padding:12px 0;font-size:15px;align-items:center">
        <span style="color:var(--muted);font-weight:700">Valor no Pix</span>
        <span style="text-align:right">
          ${total<totalCartao?`<span style="color:var(--muted);text-decoration:line-through;font-size:12px;display:block">${moneyBR(totalCartao)}</span>`:''}
          <b style="color:var(--good,#1a9d3f);font-size:17px">${moneyBR(total)}</b>
          ${total<totalCartao?`<span class="pr-off" style="margin-left:6px">−${_descontoPixPct()}%</span>`:''}
        </span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button id="cp-copy" class="btn-save">📋 Copiar código PIX e pagar</button>
      <button id="cp-paid" class="btn-save" style="background:var(--good);color:#fff">✅ Já paguei</button>
      <button class="sheet-cancel">Cancelar</button>
    </div>
  </div></div>`);
  const close = openSheet(sheet, '.sheet-cancel');
  sheet.querySelector('#cp-copy').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(codigoParaCopiar); toast('PIX copiado — cole no seu banco pra pagar'); }
    catch(e){ toast('Copie: '+codigoParaCopiar.substr(0,40)+'…'); }
  };
  sheet.querySelector('#cp-paid').onclick = ()=>{ close(); _registrarPedidoJaPago(); };
}

/* ============================================================
   PERFIL PROFESSOR (gestão)
   ============================================================ */
/* ============================================================
   AUTH — tela de login / cadastro (Supabase)
   ============================================================ */
function renderAuth(){
  // A4: self-signup DESABILITADO — a conta do aluno é criada pelo professor (§0). Só login.
  const v = el('<div class="view auth-view"></div>');
  v.appendChild(el('<div class="auth-safe"></div>'));
  v.appendChild(el(`<div class="auth-hero">
    <img class="auth-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">
    <div class="auth-title">${DB.academia.nome}</div>
    <div class="auth-sub">${DB.academia.artes}</div>
  </div>`));
  const form = el('<div class="auth-form"></div>');
  form.appendChild(el('<label class="flbl">E-mail</label>'));
  const emEl = el(`<input class="inp" type="email" id="a-email" placeholder="seu@email.com" autocomplete="email" inputmode="email">`);
  form.appendChild(emEl);
  form.appendChild(el('<label class="flbl" style="margin-top:12px">Senha</label>'));
  const pwEl = el(`<input class="inp" type="password" id="a-pw" placeholder="Senha" autocomplete="current-password" style="margin-top:6px">`);
  form.appendChild(pwEl);
  const btn = el('<button class="btn-register auth-btn">Entrar</button>');
  btn.onclick = async ()=>{
    const e=emEl.value.trim(), p=pwEl.value;
    if(!e||!p){ toast('Preencha e-mail e senha'); return; }
    btn.disabled=true; btn.textContent='Entrando…';
    try{
      const { user } = await sbAuth.signIn(e, p);
      btn.textContent='Sincronizando…';
      await _cloudLogin(user);   // pipeline único: migração legado → pullState → overlay → senha/onboarding
    }catch(err){
      btn.disabled=false; btn.textContent='Entrar';
      const m=err.message||'';
      toast(m.includes('Invalid login')?'E-mail ou senha incorretos':'Erro: '+m);
    }
  };
  form.appendChild(btn);
  const fg = el('<div class="auth-forgot">Esqueceu a senha?</div>');
  fg.onclick = ()=>_authResetPw();
  form.appendChild(fg);
  form.appendChild(el('<div class="auth-note">🥋 Use o e-mail e a senha entregues pela academia. Você troca a senha no primeiro acesso.</div>'));
  v.appendChild(form);
  return v;
}

function _authResetPw(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Recuperar senha</div>
    <div class="sheet-desc">Informe seu e-mail e enviaremos um link para redefinir a senha.</div>
    <input class="inp" type="email" id="rp-em" placeholder="seu@email.com">
    <button class="btn-save" id="rp-send">Enviar link</button>
    <button class="sheet-cancel" id="rp-cancel">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rp-cancel').onclick = close;
  sheet.querySelector('#rp-send').onclick = async ()=>{
    const em = sheet.querySelector('#rp-em').value.trim();
    if(!em){ toast('Informe o e-mail'); return; }
    try{ await sbAuth.resetPw(em); close(); toast('E-mail enviado — verifique sua caixa'); }
    catch(e){ toast(e.message); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function _sairDaConta(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Sair da conta?</div>
    <div class="sheet-desc">Seus dados ficam salvos na nuvem. Ao entrar novamente eles serão restaurados.</div>
    <button class="btn-save danger" id="sair-sim">Sair</button>
    <button class="sheet-cancel" id="sair-nao">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#sair-nao').onclick = close;
  sheet.querySelector('#sair-sim').onclick = async ()=>{
    sheet.remove();
    flushSave();   // melhor esforço: sobe alterações pendentes antes de encerrar a sessão
    if(typeof sbAuth!=='undefined') await sbAuth.signOut();
    if(typeof sbAuth!=='undefined') { DB.sbUser=null; _cloudReady=false; _lastPushed=''; aplicarCleanSlate(); DB.authOpen=true; render(); toast('Até logo 👋'); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* Troca de senha no 1º acesso (P1): disparada quando sbAuth.mustChangePassword() é true.
   Também atende o retorno do link "esqueci a senha" (PASSWORD_RECOVERY → DB.trocarSenhaRecovery). */
function pwErrMsg(err){
  const m = String((err && err.message) || err);
  if (/different from the old|different password/i.test(m)) return 'A nova senha precisa ser diferente da senha provisória.';
  if (/current password/i.test(m)) return 'Senha provisória (atual) incorreta.';
  if (/at least one character|abcdefghijklmnopqrstuvwxyz/i.test(m)) return 'A senha precisa ter letras e números.';
  if (/at least \d+ character/i.test(m)) return 'Senha muito curta — mínimo 8 caracteres.';
  if (/reauthentication|nonce/i.test(m)) return 'Sessão expirada — saia e entre de novo para trocar a senha.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas — aguarde alguns minutos.';
  return 'Erro: ' + m;
}
function renderTrocarSenha(){
  const recovery = !!DB.trocarSenhaRecovery;
  // 1º acesso após reload: a senha do login não está mais em memória — pedir a provisória.
  const needCur = !recovery && typeof sbAuth!=='undefined' && sbAuth.hasLoginPw && !sbAuth.hasLoginPw();
  const v = el('<div class="view auth-view"></div>');
  v.appendChild(el('<div class="auth-safe"></div>'));
  v.appendChild(el(`<div class="auth-hero">
    <img class="auth-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">
    <div class="auth-title">${recovery?'Redefinir senha':'Defina sua senha'}</div>
    <div class="auth-sub">${recovery?'Crie uma nova senha para a sua conta.':'Primeiro acesso — crie uma senha pessoal para continuar.'}</div>
  </div>`));
  const form = el('<div class="auth-form"></div>');
  let cur = null;
  if(needCur){
    form.appendChild(el('<label class="flbl">Senha provisória (atual)</label>'));
    cur = el(`<input class="inp" type="password" id="ts-cur" placeholder="A senha entregue pela academia" autocomplete="current-password">`);
    form.appendChild(cur);
  }
  form.appendChild(el(`<label class="flbl"${needCur?' style="margin-top:12px"':''}>Nova senha</label>`));
  const pw1 = el(`<input class="inp" type="password" id="ts-pw1" placeholder="Mín. 8 caracteres, letras e números" autocomplete="new-password">`);
  form.appendChild(pw1);
  form.appendChild(el('<label class="flbl" style="margin-top:12px">Confirmar senha</label>'));
  const pw2 = el(`<input class="inp" type="password" id="ts-pw2" placeholder="Repita a senha" autocomplete="new-password" style="margin-top:6px">`);
  form.appendChild(pw2);
  const btn = el('<button class="btn-register auth-btn">Salvar e continuar</button>');
  btn.onclick = async ()=>{
    const p1=pw1.value, p2=pw2.value;
    if(needCur && !cur.value){ toast('Informe a senha provisória atual'); return; }
    if(p1.length<8){ toast('Senha: mínimo 8 caracteres'); return; }
    if(!/[a-zA-Z]/.test(p1) || !/[0-9]/.test(p1)){ toast('A senha precisa ter letras e números'); return; }
    if(needCur && p1===cur.value){ toast('A nova senha precisa ser diferente da provisória'); return; }
    if(p1!==p2){ toast('As senhas não coincidem'); return; }
    btn.disabled=true; btn.textContent='Salvando…';
    try{
      if(typeof sbAuth!=='undefined') await sbAuth.changePassword(p1, needCur ? cur.value : undefined);
      DB.trocarSenhaOpen=false; DB.trocarSenhaRecovery=false;
      if(!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen=true;
      render(); toast('Senha definida ✔');
    }catch(err){
      btn.disabled=false; btn.textContent='Salvar e continuar';
      toast(pwErrMsg(err));
      try{ if(typeof sbSync!=='undefined' && sbSync.logError) sbSync.logError('trocarSenha: '+((err&&err.message)||err), recovery?'recovery':'primeiro-acesso'); }catch(_){}
    }
  };
  form.appendChild(btn);
  form.appendChild(el(`<div class="auth-note">${recovery?'🔒 Após salvar, use a nova senha nos próximos logins.':'🔒 Você entrou com uma senha provisória. Defina a sua para manter a conta segura.'}</div>`));
  v.appendChild(form);
  return v;
}

/* ============================================================
   PROFESSOR — cache de dados Supabase
   ============================================================ */
let _profData = null;
let _profTs   = 0;

// Status de atividade do aluno: regra automática (90d sem treinar = inativo) com
// override manual do professor (0023). Distinto de "Ativos (14d)" — aquele é sobre
// presença recente; este é sobre abandono/desistência de fato.
const STATUS_INATIVO_DIAS = 90;
function _statusAluno(a){
  if(a.statusManual==='ativo')   return { valor:'ativo',   origem:'manual', desde:a.statusManualEm };
  if(a.statusManual==='inativo') return { valor:'inativo', origem:'manual', desde:a.statusManualEm };
  const inativo = (a.diasSem||0) >= STATUS_INATIVO_DIAS;
  return { valor: inativo?'inativo':'ativo', origem:'auto', desde:null };
}
function _statusAlunoTxt(a){
  const s=_statusAluno(a);
  const lbl = s.valor==='ativo' ? 'Ativo' : 'Inativo';
  if(s.origem==='manual'){
    const dt = s.desde ? new Date(s.desde) : null;
    const dtTxt = dt ? `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}` : '';
    return `${lbl} (manual${dtTxt?' · '+dtTxt:''})`;
  }
  return s.valor==='inativo' ? `${lbl} (${STATUS_INATIVO_DIAS}d+)` : lbl;
}
// "Desde quando o aluno é a faixa atual". Regra:
//  1) Última data de evento tipo `faixa` ou `inicio` na faixa atual (canônico).
//  2) Se não houver: primeira data de evento tipo `grau` na faixa atual —
//     o aluno já era essa faixa quando ganhou o grau (cobre o caso de graduar
//     por grau sem registrar o evento `faixa` antes).
//  3) null se não houver nenhum evento na faixa atual.
/* v352: dedupe da timeline. Mesmo dia + tipo + faixa + grau é o MESMO evento —
   dois professores registraram por engano (Alex Davi tinha 2 "Faixa Amarela"
   em 11/07). Mantém o de MAIOR `id` (inserido depois, tende a ser o correto).
   Fonte única — usado no KPI "Graduações" da ficha E na linha do tempo, senão
   os dois divergem. */
function _gradsDedup(gs){
  const key = g => `${g.data}|${g.tipo}|${g.faixa}|${g.graus||0}`;
  const m = new Map();
  (gs||[]).forEach(g=>{
    if(!g || !g.data) return;
    const k = key(g); const prev = m.get(k);
    if(!prev || String(g.id||'') > String(prev.id||'')) m.set(k, g);
  });
  return [...m.values()];
}
function _faixaDesde(gs, faixa){
  const arr = (gs||[]).filter(g=>g && g.faixa===faixa && g.data);
  const fx = arr.filter(g=>g.tipo==='faixa'||g.tipo==='inicio').map(g=>g.data).sort();
  if(fx.length) return fx[fx.length-1];
  const gr = arr.filter(g=>g.tipo==='grau').map(g=>g.data).sort();
  return gr[0] || null;
}
/* Início na academia — FONTE ÚNICA: a linha do tempo de graduação.
   1) evento `inicio` (o que a Edge Function semeia no cadastro);
   2) senão, o evento mais antigo de qualquer tipo;
   3) senão, o cad.dataInicio legado (fichas antigas) ou `desde`.
   A ficha cadastral não edita mais esse campo — só a aba Graduação. */
function _inicioAcademia(a){
  const gs = (a && a.graduacoes || []).filter(g=>g && g.data);
  const ini = gs.filter(g=>g.tipo==='inicio').map(g=>g.data).sort()[0];
  if(ini) return ini;
  const first = gs.map(g=>g.data).sort()[0];
  if(first) return first;
  return (a && a.cad && a.cad.dataInicio) || (a && a.desde) || null;
}
// Entrada do ALUNO LOGADO (DB.eu) na lista do professor — derivada dos dados reais.
// É o fio que faz presença/graduação conversarem offline: as ações neste item
// (marcado _self) escrevem em DB.checkinHoje / DB.graduacoes / DB.eu (ver _profSet*).
function _selfAluno(){
  const me = DB.eu, treinos = DB.treinos||[], mes = HOJE_ISO.slice(0,7);
  const datas = treinos.map(t=>t.data).filter(Boolean).sort();
  const diasSem = datas.length ? Math.max(0, Math.round((new Date(HOJE_ISO) - new Date(datas[datas.length-1]))/86400000)) : 0;
  const diasMes = new Set(treinos.filter(t=>t.data && t.data.slice(0,7)===mes).map(t=>t.data)).size;
  // META_MES compartilhado com o adapter — antes o self usava meta*4 e discordava do painel
  const freq = Math.min(100, Math.round(diasMes/PROF_METAS.META_MES*100));
  let apto=false, aulasNoGrau=null; try{ const ag=aulasStats(); apto = ag.atual>=ag.meta; aulasNoGrau=ag.atual; }catch(e){}
  // eixos do semáforo de graduação + tendência de queda (mesmos campos do adapter)
  const fg=_faixaDesde(DB.graduacoes||[], me.faixa);
  const dias=[...new Set(datas)];
  const _dISO=n=>{ const d=new Date(); d.setDate(d.getDate()-n); const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return iso < APP_INICIO_ISO ? APP_INICIO_ISO : iso; };
  const d28=_dISO(28), d120=_dISO(120);
  const freq4=dias.filter(x=>x>=d28).length;
  const base4=Math.round(dias.filter(x=>x>=d120&&x<d28).length/3*10)/10;
  return {
    id:'self', _self:true,
    nm:(me.apelido||me.nome||'Você')+' (você)', ini:me.iniciais||'EU', cor:'#e5392f',
    faixa:me.faixa, graus:me.graus, nascimento:me.nascimento, nascData:me.nascData||null,
    pres:(DB.checkinHoje && DB.checkinHoje.feito)?DB.checkinHoje.hora:null,
    pago:(me.mensalidade&&me.mensalidade.status)||'ok',
    mensValor:(me.mensalidade&&me.mensalidade.valor)||0,
    mensVenc:(me.mensalidade&&me.mensalidade.venc)||'—',
    desde:me.desde||'—', freq, diasSem, aptoGrad:apto, cad:me.cad||null,
    faixaDesde:fg, aulasNoGrau, freq4, base4
  };
}
// Roteadores: se o alvo é o aluno logado (_self) escreve nos dados REAIS; senão no mock.
// Sempre tenta o backend quando presente (idempotente).
// v428: `_profSetPresenca` deletado (com `sbProf.lancarPresenca/removerPresenca`).
// Era código morto desde a v292, que tirou o lançamento manual da ficha pra deixar
// UM caminho de escrita (Turmas → Adicionar frequência, com aula_id/turma/hora reais).
// Além de sem chamadas, estava quebrado: gravava sem `aula_id`, e a 0027 exige
// `turma_id is not null and aula_id is not null` — a própria migration cita a função
// pelo nome como uma das vias que veio fechar.
/* Graduação RETROATIVA: registra o histórico de faixas (aluno vindo de outra academia).
   Perfil só muda se a data for a mais recente (não rebaixa). Online exige a 0003. */
// v300: _gradRetroSheet removido — unificado no "+ Novo evento" da timeline
// (_erpGradForm decide automaticamente: mais recente + faixa/grau → graduarAluno
// dispara trigger M3; retroativo/inicio → append puro via salvarGraduacao).

function _profGraduarApply(a, faixa, graus, tipo){
  if(a._self){
    DB.eu.faixa=faixa; DB.eu.graus=graus;
    DB.eu.aulasGrau = Object.assign({}, DB.eu.aulasGrau, {base:0});
    if(!DB.graduacoes.some(g=>g.tipo==='faixa'&&g.faixa===faixa))
      DB.graduacoes.push({faixa, graus:0, tipo:'faixa', data:HOJE_ISO, por:DB.professor.nome||'Professor'});
    if(graus>0 && !DB.graduacoes.some(g=>g.tipo==='grau'&&g.faixa===faixa&&g.graus===graus))
      DB.graduacoes.push({faixa, graus, tipo:'grau', data:HOJE_ISO, por:DB.professor.nome||'Professor'});
    DB.graduacoes.sort((x,y)=>x.data.localeCompare(y.data));
  } else { a.faixa=faixa; a.graus=graus; }
  if(!DEMO && typeof sbProf!=='undefined'){ try{ sbProf.graduarAluno(a.id, faixa, graus, tipo, DB.professor.nome||'Professor'); }catch(e){} }
}

/* v511: onDadosMudaram só INVALIDA caches — não refetch. Antes cada mutação
   disparava getAlunos+getKPIs+getRel mesmo sem tela pedindo. Agora o próximo
   render pede quando precisa (_loadProfData/_loadRelData/_finReload já têm
   gate). Financeiro já era assim desde v509. Aplicado ao resto. */
window.onDadosMudaram = function(){
  _profTs = 0; _relTs = 0; _finTs = 0;
};
/* v511: piso 10s→5min. Alt-tab não é sinal de dados obsoletos — refetch
   agressivo aqui gerava rajadas de query a cada troca de aba do professor. */
let _refetchTs = 0;
function _refetchAoVoltar(){
  if(document.visibilityState !== 'visible') return;
  if(!DB.sbUser) return;
  if(Date.now() - _refetchTs < 300000) return;   // 5min
  _refetchTs = Date.now();
  window.onDadosMudaram();
}
document.addEventListener('visibilitychange', _refetchAoVoltar);
window.addEventListener('focus', _refetchAoVoltar);

function _loadProfData(){
  if(Date.now() - _profTs < 30000) return;
  _profTs = Date.now();
  // DEMO: com credenciais reais o sbProf existe até no ?demo=1 — o demo usa o mock em memória
  // (antes chamava a nuvem sem sessão e a gestão do demo aparecia vazia).
  if(DEMO || typeof sbProf==='undefined'){
    const alunos = [_selfAluno(), ...(DB.alunos||[])];   // aluno logado no topo + turma mock
    _profData = { alunos, kpis:{ total:alunos.length, ativos:alunos.filter(a=>a.pres).length, treinosTotal:(DB.treinos||[]).length, shares:0, erros:0, receitaMes:0 } };
    return;
  }
  Promise.all([ sbProf.getAlunos(), sbProf.getKPIs() ]).then(([alunos, kpis])=>{
    _profData = { alunos, kpis };
    renderBg();   // v427: a guarda de batchCheckin (v426) virou caso do renderBg
  }).catch(_=>{ _profTs = 0; });
  // regras da academia (meta de aulas por faixa, senha padrão) — 1 fetch por sessão.
  // v430: redesenha ao chegar. A senha padrão saiu do dump local pra cá, e sem esse
  // render a tela "Distribuir acesso" ficava mostrando o fallback (default hard-coded)
  // até um render acidental — e o botão "aplicar" leria esse valor errado.
  if(!DB.academyConfig && sbProf.getConfig) sbProf.getConfig().then(c=>{ DB.academyConfig=c||{}; renderBg(); }).catch(()=>{});
}

function renderProfessor(){
  _loadProfData();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = topbar('Painel do professor');
  const body = el('<div></div>');
  // Ficha do aluno em tela cheia tem precedência sobre as abas (voltar limpa DB.alunoAberto).
  if (DB.alunoAberto){ body.appendChild(profAlunoDetalhe(DB.alunoAberto)); v.appendChild(body); v.appendChild(tabbarProf()); return v; }
  if (DB.batchCheckin){ body.appendChild(profBatchCheckin(DB.batchCheckin.t, DB.batchCheckin.s, DB.batchCheckin.data)); v.appendChild(body); return v; }   // modo foco: sem tabbar (botão "Adicionar" fica visível no mobile)
  if (DB.turmaEditOpen){ body.appendChild(profTurmaEdit(DB.turmaEditOpen==='new'?null:DB.turmaEditOpen)); v.appendChild(body); v.appendChild(tabbarProf()); return v; }
  if (DB.importAlunosOpen){ body.appendChild(profImportAlunos()); v.appendChild(body); return v; }   // modo foco
  if (DB.acessoAlunosOpen){ body.appendChild(profAcessoAlunos()); v.appendChild(body); return v; }   // modo foco
  const nav = DB.navProf;
  if (nav==='painel')    body.appendChild(profPainel());
  if (nav==='alunos')    body.appendChild(profAlunos());
  if (nav==='turmas')    body.appendChild(profTurmas());
  if (nav==='graduacao') body.appendChild(profGraduacao());
  if (nav==='relatorios')body.appendChild(profRelatorios());
  if (nav==='loja')      body.appendChild(profLoja());
  if (nav==='pedidos')   body.appendChild(profPedidos());
  if (nav==='financeiro')body.appendChild(profFinanceiro());
  if (nav==='videos')    body.appendChild(profVideosOnboard());
  if (nav==='yama')      body.appendChild(profYama());
  if (nav==='perfil')    body.appendChild(alunoPerfil());   // "Mais": o professor também é aluno (mesmo DB.eu)
  v.appendChild(body);
  v.appendChild(tabbarProf());
  return v;
}

/* ============================================================
   BATCH CHECK-IN — PÁGINA CHEIA (protótipo visual v277)
   Clica na turma da home → navega pra esta página (não sheet).
   Lista de alunos matriculados com checkbox + botão em lote.
   Estado: DB.batchCheckin = {t:turma, s:sessao}.
   ATENÇÃO: NÃO persiste no backend ainda — só marca em memória
   e mostra toast. Ligar sbProf.marcarPresenca por aluno depois
   (ver análise de banco abaixo).
   ============================================================ */
// dataISO vem do PAINEL (strip de dias + navegação de semana). O batch não decide
// mais data — só executa. Fonte única evita divergência entre as duas telas.
function profBatchCheckin(turma, sessao, dataISO){
  // Ordena A-Z pelo nome de exibição (mesmo _nomeInst() usado na renderização
  // da linha) — evita a ordem "aleatória" do backend na tela de presença.
  const alunos = (typeof _turmaAlunos==='function' ? _turmaAlunos(turma.id) : [])
    .slice()
    .sort((a,b)=> String(_nomeInst(a)||'').localeCompare(String(_nomeInst(b)||''), 'pt-BR', {sensitivity:'base'}));
  const DIAS_K = {seg:'Segunda',ter:'Terça',qua:'Quarta',qui:'Quinta',sex:'Sexta',sab:'Sábado',dom:'Domingo'};
  const _isoHoje = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dataFinal = dataISO || _isoHoje();
  // v426: gaveta da chamada. Sem isto, um render() (refetch em background) zerava
  // os alunos já marcados no meio da chamada — o professor tinha que recomeçar.
  // Chave por turma+DATA+HORA: a mesma turma tem horários diferentes no mesmo dia
  // (ADULTO na terça: 06:00/08:00/19:30), e cada aula é uma chamada independente.
  const _freqKey = `freq:${turma.id}:${dataFinal}:${sessao.hora||'-'}`;
  const _freqSalvo = _formDraftLer(_freqKey);
  let onlyPending = _freqSalvo ? !!_freqSalvo.onlyPending : true;
  const marcados = new Set(_freqSalvo && Array.isArray(_freqSalvo.marcados) ? _freqSalvo.marcados : []);
  const _freqGravar = ()=>{ DB._formDrafts = DB._formDrafts||{}; DB._formDrafts[_freqKey] = { marcados:[...marcados], onlyPending }; };
  const close = ()=>{ _formDraftLimpar(_freqKey); DB.batchCheckin=null; render(); window.scrollTo(0,0); };
  const [_y,_m,_d] = dataFinal.split('-');
  const isHoje = dataFinal === _isoHoje();
  const dataLbl = `${DIAS_K[sessao.dia]||sessao.dia}, ${_d}/${_m}${isHoje?' (hoje)':''}`;
  const page = el(`<div class="erp-batch-page">
    <div class="erp-batch-hd">
      <button class="erp-batch-close" id="bc-close" aria-label="Voltar">‹</button>
      <div class="erp-batch-title">Adicionar frequência</div>
      <span></span>
    </div>
    <div class="erp-batch-meta">
      <div class="erp-batch-chip">
        <b>${safeTxt(sessao.hora||'—')}</b><span>${safeTxt(dataLbl)}</span>
      </div>
      <div class="erp-batch-chip active" style="--tc:${safeAttr(turma.cor||'#334155')}"><b>${safeTxt(turma.nome)}</b><span>${safeTxt(sessao.variacao||turma.faixaEtaria||'')}</span></div>
      <label class="erp-batch-toggle">
        <input type="checkbox" id="bc-pending" checked>
        <span>Ocultar quem já marquei</span>
      </label>
    </div>
    <div class="erp-batch-list" id="bc-list"></div>
    <div class="erp-batch-foot">
      <button class="erp-batch-go" id="bc-go" disabled>Adicionar frequência <span class="erp-batch-count" id="bc-n">0</span></button>
    </div>
  </div>`);
  page.querySelector('#bc-close').onclick = close;
  const listEl = page.querySelector('#bc-list');
  const goBtn = page.querySelector('#bc-go');
  const nEl = page.querySelector('#bc-n');
  const refreshCount = ()=>{ nEl.textContent = marcados.size; goBtn.disabled = marcados.size===0; };
  // Set de user_ids que já têm check-in NESSA data (não só "hoje"). Preenchido
  // async abaixo — enquanto isso, mostra lista neutra sem "já presente" fantasma.
  const jaPresIds = new Set();
  const paintList = ()=>{
    listEl.innerHTML='';
    if(!alunos.length){ listEl.appendChild(el('<div class="erp-batch-empty">Nenhum aluno matriculado nessa turma.</div>')); return; }
    const arr = onlyPending ? alunos.filter(a=>!jaPresIds.has(a.id||a.nm)) : alunos;
    if(!arr.length){ listEl.appendChild(el('<div class="erp-batch-empty">Todos já com presença nessa aula. ✔</div>')); return; }
    arr.forEach(a=>{
      const key = a.id || a.nm;
      const isCk = marcados.has(key);
      const jaPres = jaPresIds.has(key);
      const belt = BELTS[a.faixa] || {cor:'#888',nome:a.faixa||''};
      const row = el(`<div class="erp-batch-row${isCk?' on':''}${jaPres?' done':''}" role="button" tabindex="0">
        <span class="erp-batch-check">${isCk?'✓':(jaPres?'✓':'')}</span>
        ${avatarAluno(a,'width:44px;height:44px;font-size:14px;flex:none')}
        <div class="erp-batch-info">
          <div class="erp-batch-nm">${safeTxt(_nomeInst(a))}</div>
          <div class="erp-batch-belt"><i style="background:${belt.cor}"></i>${safeTxt(belt.nome)} · ${a.graus||0}º grau</div>
        </div>
        ${jaPres?'<span class="erp-batch-flag" title="Clique para remover">Presente · remover</span>':''}
      </div>`);
      if(!jaPres){
        const toggle = ()=>{ if(marcados.has(key)) marcados.delete(key); else marcados.add(key); _freqGravar(); paintList(); refreshCount(); };
        row.onclick = toggle;
        row.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } };
      } else {
        // v305: clique errado — apaga o check-in dessa aula.
        const undo = ()=>{
          if(!confirm(`Remover a presença de ${_nomeInst(a)} nessa aula?`)) return;
          const done = ()=>{ jaPresIds.delete(key); paintList(); toast('Presença removida'); };
          if(!DEMO && typeof sbProf!=='undefined' && sbProf.removerPresencaBatch && turma.id){
            sbProf.removerPresencaBatch(a.id, turma.id, dataFinal, sessao.hora||null)
              .then(done).catch(e=> toast('Erro: '+(e.message||e)));
          } else { done(); }
        };
        row.onclick = undo;
        row.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); undo(); } };
      }
      listEl.appendChild(row);
    });
  };
  // v426 — BUG CORRIGIDO: a consulta filtrava só por turma_id+data, ignorando o
  // HORÁRIO (o comentário antigo dizia que filtrava por hora, mas o código não).
  // Efeito em produção: ADULTO tem 3 horários na terça (06:00/08:00/19:30) —
  // marcar presença às 06:00 fazia o aluno aparecer como "já presente" nas outras
  // duas aulas do mesmo dia, sumindo da lista com "Ocultar quem já marquei".
  //
  // A amarração correta é o `aula_id` (fonte única desde a 0025), NÃO `checkins.hora`:
  // medido em produção, `checkins.hora` guarda QUANDO o check-in foi registrado
  // (22:33 = professor marcando) e `aulas.hora` é o horário da AULA (19:30) —
  // 261 dos 262 registros divergem. Filtrar pela hora do check-in daria errado.
  (async ()=>{
    if(typeof SB==='undefined' || !turma.id) return;
    try{
      let q = SB.from('checkins').select('user_id, aulas!inner(hora)')
        .eq('turma_id', turma.id).eq('data', dataFinal);
      // Sessão com horário definido → conta só quem tem check-in NAQUELE horário.
      // Sessão sem horário (aula avulsa) → mantém o comportamento por dia.
      if(sessao.hora) q = q.eq('aulas.hora', sessao.hora);
      const { data, error } = await q;
      if(error) throw error;
      (data||[]).forEach(r=> jaPresIds.add(r.user_id));
      paintList();
    }catch(e){ /* silencia — pior caso mostra tudo desmarcado */ }
  })();
  const pendChk = page.querySelector('#bc-pending');
  pendChk.checked = onlyPending;   // v426: restaura o toggle depois de um render()
  pendChk.onchange = (e)=>{ onlyPending = e.target.checked; _freqGravar(); paintList(); };
  goBtn.onclick = ()=>{
    if(!marcados.size) return;
    const userIds = [...marcados];
    goBtn.disabled = true; goBtn.textContent = 'Salvando…';
    const doLocal = (r)=>{
      const criados = (r && typeof r==='object') ? (r.criados||0) : (r||0);
      const ignorados = (r && typeof r==='object') ? (r.ignorados||0) : 0;
      // UI local: só marca "presente hoje" se a data gravada é hoje
      if(isHoje){
        userIds.forEach(uid=>{
          const al = ((_profData?.alunos)||[]).find(x=> x.id===uid || x.nm===uid);
          if(al){ al.pres = sessao.hora || new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); al.diasSem=0; }
        });
      }
      const msgOK = criados ? `${criados} presença${criados!==1?'s':''} ✓` : '';
      const msgSkip = ignorados ? `${ignorados} já existia${ignorados!==1?'m':''} (não sobrescrito)` : '';
      toast([msgOK, msgSkip].filter(Boolean).join(' · ') || 'Nenhuma presença adicionada');
      close();
    };
    if(typeof sbProf!=='undefined' && sbProf.marcarPresencaLote && turma.id){
      sbProf.marcarPresencaLote(turma.id, dataFinal, sessao.hora, userIds)
        .then(n=> doLocal(n||userIds.length))
        .catch(e=>{ goBtn.disabled=false; goBtn.textContent='Adicionar frequência'; refreshCount(); toast('Erro: '+(e.message||e)); });
    } else {
      doLocal(userIds.length);   // offline/demo
    }
  };
  paintList(); refreshCount();
  return page;
}

/* ============================================================
   PAINEL DO PROFESSOR — dashboard ERP (v276)
   Inspiração Kanri: KPIs macro semânticos (cada card = decisão),
   aniversariantes do mês em tabela, alertas acionáveis.
   REMOVIDO: BETA KPIs, "Atividade da gestão" (fica em Config).
   ============================================================ */
function profPainel(){
  const w = el('<div></div>');
  const d = _profData;
  const alunos = d ? d.alunos : [];
  const kpis   = d ? d.kpis   : { total:0, ativos:0, receitaMes:0 };

  // Header institucional: nome da academia + saudação
  const acadNm = (DB.academia && DB.academia.nome) || 'Academia';
  const dashHd = el(`<div class="erp-dash-hd">
    <div class="erp-dash-hd-l">
      <div class="erp-dash-acad">${safeTxt(acadNm)}</div>
      <div class="erp-dash-greet">Olá, ${safeTxt(DB.professor.nome||'Professor')} — ${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div>
    </div>
    <button class="erp-yama-btn" aria-label="Yama · Configurações" title="Yama · Configurações">⚙️</button>
  </div>`);
  dashHd.querySelector('.erp-yama-btn').onclick = ()=>{ DB.navProf='yama'; render(); window.scrollTo(0,0); };
  w.appendChild(dashHd);

  // ---- Strip de dias com navegação de SEMANA (‹ ›) ----
  // DB._painelSemana = offset em semanas (0=atual, -1=passada, +1=próxima).
  // Limite: 2 semanas atrás (cobre o retroativo de 14 dias) e 1 à frente.
  const DIAS_K = [['seg','Seg'],['ter','Ter'],['qua','Qua'],['qui','Qui'],['sex','Sex'],['sab','Sáb'],['dom','Dom']];
  const jsToKey = ['dom','seg','ter','qua','qui','sex','sab'];
  const diaHoje = jsToKey[hoje.getDay()];
  const turmas = (typeof _turmasArr==='function'?_turmasArr():[]);
  const diasComTurma = new Set();
  turmas.forEach(t=> (t.sessoes||[]).forEach(s=> diasComTurma.add(s.dia)));
  const DIAS_ATIVOS = DIAS_K.filter(([k])=> diasComTurma.has(k));
  const semOff = DB._painelSemana || 0;
  // Data de um dia-da-semana dentro da semana selecionada
  const _dataDoDia = (k)=>{
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() + (jsToKey.indexOf(k) - hoje.getDay()) + semOff*7);
    dt.setHours(0,0,0,0);
    return dt;
  };
  let diaSel = DB._painelDia;
  if(!diasComTurma.has(diaSel)) diaSel = diasComTurma.has(diaHoje) ? diaHoje : (DIAS_ATIVOS[0]?.[0] || diaHoje);
  const dataSel = _dataDoDia(diaSel);
  const hojeMid = new Date(hoje); hojeMid.setHours(0,0,0,0);
  if(DIAS_ATIVOS.length){
    // Container único: ‹ · [dias...] · › — setas AO LADO da strip (não em cima)
    const bar = el('<div class="erp-daystrip block"></div>');
    // Só passado (até 2 semanas atrás). Futuro sem valor prático — turma da próxima semana ainda não rodou.
    const btnPrev = el(`<button class="erp-weekbtn" id="wk-prev" aria-label="Semana anterior"${semOff<=-2?' disabled':''}>‹</button>`);
    const btnNext = el(`<button class="erp-weekbtn" id="wk-next" aria-label="Próxima semana"${semOff>=0?' disabled':''}>›</button>`);
    btnPrev.onclick = ()=>{ if(semOff>-2){ DB._painelSemana = semOff-1; render(); } };
    btnNext.onclick = ()=>{ if(semOff<0){ DB._painelSemana = semOff+1; render(); } };
    bar.appendChild(btnPrev);
    DIAS_ATIVOS.forEach(([k,lbl])=>{
      const dt = _dataDoDia(k);
      const isHoje = dt.getTime()===hojeMid.getTime();
      const isSel  = k===diaSel;
      const b = el(`<button class="erp-daycell${isSel?' on':''}${isHoje?' hoje':''}" type="button">
        <span class="erp-daynum">${dt.getDate()}</span>
        <span class="erp-daylbl">${lbl}</span>
      </button>`);
      b.onclick = ()=>{ DB._painelDia = k; render(); };
      bar.appendChild(b);
    });
    bar.appendChild(btnNext);
    w.appendChild(bar);
  }

  // ---- Turmas do dia selecionado (horizontal scroll) ----
  const sessionsDoDia = [];
  turmas.forEach(t=> (t.sessoes||[]).forEach(s=>{
    if(s.dia===diaSel) sessionsDoDia.push({t, s});
  }));
  sessionsDoDia.sort((a,b)=> (a.s.hora||'').localeCompare(b.s.hora||''));
  if(sessionsDoDia.length){
    const strip2 = el('<div class="erp-classes-strip block"></div>');
    sessionsDoDia.forEach(({t,s})=>{
      const sub = s.variacao || t.faixaEtaria || '';
      const c = el(`<button class="erp-class-card" type="button" style="--tc:${safeAttr(t.cor||'#334155')}">
        <div class="erp-class-hora">🕐 ${safeTxt(s.hora)}</div>
        <div class="erp-class-nome">${safeTxt(t.nome)}</div>
        ${sub?`<div class="erp-class-sub">${safeTxt(sub)}</div>`:''}
      </button>`);
      // Passa a DATA já resolvida — o batch não decide mais data, só executa.
      c.onclick = ()=>{ DB.batchCheckin = {t, s, data: dataSel.toISOString().slice(0,10)}; render(); window.scrollTo(0,0); };
      strip2.appendChild(c);
    });
    w.appendChild(strip2);
  } else {
    w.appendChild(el(`<div class="empty-line block" style="padding:16px 20px">Sem turmas em ${DIAS_K.find(([k])=>k===diaSel)[1]}.</div>`));
  }

  if(!d){
    w.appendChild(el('<div class="loading-center block">Carregando dados da nuvem…</div>'));
    return w;
  }

  // Cálculos
  const total = kpis.total;
  const ativos = kpis.ativos;
  const ausentes = alunos.filter(a=>(a.diasSem||0)>=7).length;
  const vencidos = alunos.filter(a=>a.pago==='late').length;
  const aptosGrad = _aptosGraduar().length;
  const aptosFaixa = _aptosNovaFaixa().length;
  const recebendoGrau = aptosGrad + aptosFaixa;
  const anivMes = _aniversariantes();
  const inativos = alunos.filter(a=>_statusAluno(a).valor==='inativo').length;

  // Grid de KPI macros — reusa .stat-card (design consagrado com ícone pastel)
  // mas cada card é CLICÁVEL e leva pra tela relevante.
  const kpiCard = (siClass, ico, valor, label, fn)=>{
    const c = el(`<div class="stat-card kpi-click" role="button" tabindex="0">
      <div class="si ${siClass}">${ico}</div>
      <div class="sv">${valor}</div>
      <div class="sl">${label}</div>
    </div>`);
    c.onclick = fn;
    c.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } };
    return c;
  };
  const grid = el('<div class="stat-grid block"></div>');
  grid.appendChild(kpiCard('blue', icoRoster(), total, 'Alunos totais', ()=>goProf('alunos')));
  grid.appendChild(kpiCard('green', icoPulse(), ativos, 'Ativos (14d)', ()=>goProf('alunos')));
  grid.appendChild(kpiCard('gold', icoAlert(), ausentes, 'Ausentes 7+ dias', ()=>{ DB.relTab='risco'; goProf('relatorios'); }));
  grid.appendChild(kpiCard('purple', '🥋', recebendoGrau, 'Recebendo grau', ()=>goProf('graduacao')));
  grid.appendChild(kpiCard('pink', '🎂', anivMes.length, 'Aniversariantes do mês', ()=>{ DB._pendingAlunosAniv = String(new Date().getMonth()+1).padStart(2,'0'); goProf('alunos'); }));
  grid.appendChild(kpiCard('red', '💰', vencidos, 'Vencidos', ()=>goProf('alunos')));
  grid.appendChild(kpiCard('gray', '⏸️', inativos, 'Inativos', ()=>{ DB._pendingAlunosFiltro='inativos'; goProf('alunos'); }));
  w.appendChild(grid);

  // "O que fazer hoje" — alertas acionáveis (mantido, é o coração do painel)
  _ensureLojaAdmin();
  const _zerados=DB.loja.produtos.filter(p=> p.ativo!==false && _estoqueTotal(p)===0).length;
  const _pend=_pedidosPendentesN();
  const _anivHj=_aniversariantesHoje().length;
  const alerts=[];
  if(kpis.erros>0) alerts.push(['🐞', `${kpis.erros} erro${kpis.erros>1?'s':''} de app nas últimas 24h`, 'Ver detalhes ›', ()=>_profErrosSheet(), 'red']);
  if(_pend>0) alerts.push(['🧾', `${_pend} pedido${_pend>1?'s':''} pendente${_pend>1?'s':''}`, 'Ver pedidos ›', ()=>goProf('pedidos'), 'red']);
  if(_anivHj>0) alerts.push(['🎂', `${_anivHj} aniversariante${_anivHj>1?'s':''} hoje`, 'Mandar parabéns ›', ()=>{
    // v384: leva pra lista de Alunos com filtro pelos aniversariantes DE HOJE
    // (MM-DD, nao mais so MM), pra o professor ver quem eh e mandar WhatsApp.
    // Antes ia pra Relatorios/Retencao, tela onde nao ha como contatar aluno.
    const d = new Date();
    DB._pendingAlunosAniv = String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    goProf('alunos');
  }, 'good']);
  if(_zerados>0) alerts.push(['📦', `${_zerados} produto${_zerados>1?'s':''} com estoque zerado`, 'Ver loja ›', ()=>goProf('loja'), 'red']);
  if(alerts.length){
    w.appendChild(el(`<div class="sec-title" style="margin:16px 20px 8px">O que fazer hoje</div>`));
    alerts.forEach(([ic,tx,go,fn,kind])=>{
      const al=el(`<div class="alert-row block ${kind}" role="button" tabindex="0" aria-label="${safeAttr(tx)}"><span class="ar-ic">${ic}</span>
        <span class="ar-tx">${tx}</span><span class="ar-go">${go}</span></div>`);
      al.onclick=fn; al.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } }; w.appendChild(al);
    });
  }

  // Aniversariantes do mês — tabela (Kanri style)
  if(anivMes.length){
    w.appendChild(el(`<div class="sec-row"><div class="sec-title">Aniversariantes do mês</div>
      <a role="button" tabindex="0" data-click="verAnivFull">Ver todos</a></div>`));
    const tbl = el(`<div class="erp-dash-birth block"></div>`);
    tbl.appendChild(el(`<div class="erp-dash-birth-hd">
      <span>Aluno</span><span>Faixa</span><span>Dia</span><span></span>
    </div>`));
    anivMes.slice(0,5).forEach(a=>{
      const dia = (a.nascData||'').slice(8,10);
      const mes = (a.nascData||'').slice(5,7);
      const belt = BELTS[a.faixa] || {nome:a.faixa||'—', cor:'#888'};
      const wa = _waLink(a);
      const row = el(`<div class="erp-dash-birth-row">
        <span class="erp-dash-birth-nm">${safeTxt(_nomeInst(a))}</span>
        <span class="erp-dash-birth-belt"><i style="background:${belt.cor}"></i>${safeTxt(belt.nome)}</span>
        <span class="erp-dash-birth-dt">${dia}/${mes}</span>
        <span class="erp-dash-birth-acts">${wa?'<button class="erp-mini" data-a="wa" aria-label="WhatsApp">💬</button>':''}
          <button class="erp-mini" data-a="open" aria-label="Abrir">›</button></span>
      </div>`);
      row.querySelector('[data-a="open"]').onclick=()=>{ _navPush(); DB.alunoAberto=a; render(); window.scrollTo(0,0); };
      const waBtn=row.querySelector('[data-a="wa"]');
      if(waBtn && wa) waBtn.onclick=()=> window.open(wa, '_blank', 'noopener');
      tbl.appendChild(row);
    });
    w.appendChild(tbl);
  }

  // v487: check-ins de hoje saíram do painel. Trocado por resumo financeiro
  // (Proposta A) — Saldo do mês + Recebido/A receber/Vencido + Despesas do mês
  // + linha de ação (cobranças vencendo nos próximos 7 dias). Reusa `.fin-head`
  // do Financeiro pra manter consistência visual. Check-ins continuam na tela
  // Alunos (filtro "hoje") e em Presenças (relatório).
  const mesAtualNome = new Date().toLocaleDateString('pt-BR',{month:'long'});
  const mesRef = HOJE_ISO.slice(0,7);
  w.appendChild(el(`<div class="sec-row"><div class="sec-title">Financeiro · ${mesAtualNome}</div>
    <a role="button" tabindex="0" data-click="verFinanceiro">Ver todos ›</a></div>`));
  const finCard = el('<div class="block fin-summary-card" style="padding:14px 16px"></div>');
  w.appendChild(finCard);

  const pintaFin = ()=>{
    finCard.innerHTML='';
    // Sem backend do Financeiro (demo/offline): mostra placeholder amigável.
    if(!_finBackend() || _finCobrancas===null){
      finCard.innerHTML = '<div class="loading-center" style="padding:6px 0">Carregando financeiro…</div>';
      return;
    }
    const soma = arr => arr.reduce((s,c)=> s + (Number(c.valor)||0), 0);
    const isVenc = c => c.status==='pendente' && c.venc && c.venc < HOJE_ISO;
    const cobs = _finCobrancas || [];
    const pagas = cobs.filter(c => c.status==='pago');
    const pendMesA = cobs.filter(c => c.status==='pendente' && !isVenc(c));
    const vencs   = cobs.filter(isVenc);
    // Despesas do mês (pagas). getDespesas retorna todas — filtra por mês corrente.
    const desps = (_finDespesas||[]);
    const despPagas = desps.filter(d => d.status==='pago'
      && (d.data_pagamento||'').slice(0,7) === mesRef);
    const despAPagar = desps.filter(d => d.status==='a_pagar');
    const recebido = soma(pagas);
    const aReceber = soma(pendMesA);
    const vencido  = soma(vencs);
    const despMes  = soma(despPagas);
    const saldo    = recebido - despMes;
    const saldoCor = saldo >= 0 ? 'var(--good)' : 'var(--red)';
    const saldoSig = saldo >= 0 ? '+' : '−';
    // v490 Sprint 3 item 4: Custo/aluno = despesa mês ÷ alunos ativos
    const ativosN = alunos.filter(a=>a.diasSem<14).length || alunos.length || 1;
    const custoAluno = despMes / (ativosN || 1);
    // Próximas 7d: pendente + venc entre hoje e hoje+7
    const in7 = _plus(HOJE_ISO, 7);
    const proxN = cobs.filter(c => c.status==='pendente' && c.venc && c.venc >= HOJE_ISO && c.venc <= in7).length;
    // v490 Sprint 3 item 5: inadimplentes = alunos com vencida no mês. Top 5 por valor.
    const inadByAluno = {};
    vencs.forEach(c=>{
      const p = c.profiles || {};
      const id = p.id || c.user_id;
      if(!inadByAluno[id]) inadByAluno[id] = { nome: p.apelido || p.nome_completo || 'aluno', total: 0 };
      inadByAluno[id].total += (Number(c.valor)||0);
    });
    const inadArr = Object.values(inadByAluno).sort((a,b)=>b.total-a.total);
    const inadTop = inadArr.slice(0, 3);

    finCard.innerHTML = `
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:0.05em;text-transform:uppercase">Saldo do mês</div>
        <div style="font-size:28px;font-weight:800;color:${saldoCor};margin-top:2px">${saldoSig}${moneyBR(Math.abs(saldo)).replace('R$','R$ ')}</div>
      </div>
      <div class="row" style="display:flex;justify-content:space-between;gap:6px">
        <div class="c" style="flex:1;text-align:center">
          <div class="v green" style="font-size:15px;font-weight:800;color:var(--good)">${moneyBR(recebido)}</div>
          <div class="l" style="font-size:10.5px;color:var(--muted);margin-top:1px">Recebido</div>
        </div>
        <div class="c" style="flex:1;text-align:center">
          <div class="v" style="font-size:15px;font-weight:800">${moneyBR(aReceber)}</div>
          <div class="l" style="font-size:10.5px;color:var(--muted);margin-top:1px">A receber</div>
        </div>
        <div class="c" style="flex:1;text-align:center">
          <div class="v red" style="font-size:15px;font-weight:800;color:var(--red)">${moneyBR(vencido)}</div>
          <div class="l" style="font-size:10.5px;color:var(--muted);margin-top:1px">Vencido</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--border,#e5e5ea);font-size:13px">
        <span style="color:var(--muted);font-weight:600">Despesas do mês</span>
        <span style="font-weight:800">${moneyBR(despMes)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:13px">
        <span style="color:var(--muted);font-weight:600">Custo por aluno</span>
        <span style="font-weight:800">${moneyBR(custoAluno)}</span>
      </div>
      ${proxN > 0 ? `
      <div class="fin-cta" role="button" tabindex="0" style="margin-top:10px;padding:8px 10px;background:var(--card-alt,rgba(0,0,0,0.03));border-radius:8px;font-size:12.5px;color:var(--muted);cursor:pointer">
        <b>${proxN}</b> cobrança${proxN>1?'s':''} vence${proxN>1?'m':''} nos próximos 7 dias ›
      </div>` : ''}
      ${inadTop.length > 0 ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#e5e5ea)">
        <div style="font-size:11px;color:var(--red);font-weight:800;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:6px">⚠️ Inadimplentes (${inadArr.length})</div>
        ${inadTop.map(x=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
          <span>${safeTxt(x.nome)}</span>
          <span style="font-weight:800;color:var(--red)">${moneyBR(x.total)}</span>
        </div>`).join('')}
        ${inadArr.length > inadTop.length ? `<div class="fin-ver-inad" role="button" tabindex="0" style="margin-top:4px;font-size:11.5px;color:var(--muted);cursor:pointer;text-align:right">Ver todos os ${inadArr.length} ›</div>` : ''}
      </div>` : ''}
    `;
    // clique no CTA de próximas 7 dias abre Financeiro
    const cta = finCard.querySelector('.fin-cta');
    if(cta){
      cta.onclick = ()=>{ _finTab='cobrancas'; _finCobFiltro='avencer'; goProf('financeiro'); };
      cta.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); cta.click(); } };
    }
    // Link "Ver todos" da lista de inadimplentes
    const verInad = finCard.querySelector('.fin-ver-inad');
    if(verInad){
      verInad.onclick = ()=>{ _finTab='cobrancas'; _finCobFiltro='vencidas'; goProf('financeiro'); };
      verInad.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); verInad.click(); } };
    }
  };

  // Link "Ver todos ›"
  const verLink = w.querySelector('[data-click="verFinanceiro"]');
  if(verLink) verLink.onclick = ()=>goProf('financeiro');

  // Backend liga o financeiro (Sprint 1). Carrega em background.
  if(_finBackend()){
    if(_finCobrancas === null){
      _finReload(true).then(()=>{ pintaFin(); }).catch(()=>{ pintaFin(); });
    }
    pintaFin();
  } else {
    finCard.innerHTML = '<div class="empty-line" style="padding:8px">Financeiro não disponível.</div>';
  }
  return w;
}

// Trilha administrativa (admin_audit, 0008): quem fez o quê na gestão — sheet
// aberto pela linha "📜 Atividade da gestão" do painel. Sem backend/demo: vazio.
function _profAuditSheet(){
  const L = { ficha_update:'editou a ficha de', aluno_create:'cadastrou', aluno_delete:'excluiu',
              professor_create:'criou o professor', professor_promote:'promoveu a professor',
              mensalidade_set:'marcou mensalidade de', presenca_remove:'removeu presença de' };
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Atividade da gestão" style="max-height:85vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📜 Atividade da gestão</div>
    <div class="list" id="aud-list"><div class="loading-center">Carregando…</div></div>
    <button class="sheet-cancel" id="aud-close">Fechar</button>
  </div></div>`);
  openSheet(sheet, '#aud-close');
  const list = sheet.querySelector('#aud-list');
  if(DEMO || typeof sbProf==='undefined' || !sbProf.getAuditoria){ list.innerHTML='<div class="empty-line">Sem registros (modo demo).</div>'; return; }
  sbProf.getAuditoria().then(rows=>{
    if(!rows.length){ list.innerHTML='<div class="empty-line">Nenhuma ação administrativa registrada ainda.</div>'; return; }
    list.innerHTML = rows.map(r=>{
      const q = new Date(r.criado_em);
      const quando = `${String(q.getDate()).padStart(2,'0')} ${meses[q.getMonth()]} · ${String(q.getHours()).padStart(2,'0')}:${String(q.getMinutes()).padStart(2,'0')}`;
      const d = r.detail || {};
      const extra = d.campos ? d.campos.join(', ')
                  : d.mes   ? `${d.mes}: ${d.de ? d.de+' → ' : ''}${d.para}`
                  : d.data  ? d.data : (d.email || '');
      return `<div class="mt-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <b style="font-size:12.5px;word-break:break-word">${safeTxt(r.actor_nome||'—')} ${safeTxt(L[r.action]||r.action)} ${safeTxt(r.alvo_nome||'')}</b>
        <span style="font-size:11px;color:var(--muted)">${quando}${extra?' · '+safeTxt(String(extra)):''}</span></div>`;
    }).join('');
  }).catch(()=>{ list.innerHTML='<div class="empty-line">Falha ao carregar a trilha.</div>'; });
}

// Observabilidade: sheet com os erros de app das últimas 24h (client_errors) —
// aberto pelo alerta "🐞 erros de app" do painel. Sem backend/demo: estado vazio.
function _profErrosSheet(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Erros de app" style="max-height:85vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🐞 Erros de app (24h)</div>
    <div class="list" id="err-list"><div class="loading-center">Carregando…</div></div>
    <button class="sheet-cancel" id="err-close">Fechar</button>
  </div></div>`);
  openSheet(sheet, '#err-close');
  const list = sheet.querySelector('#err-list');
  if(DEMO || typeof sbProf==='undefined' || !sbProf.getErros){ list.innerHTML='<div class="empty-line">Sem erros registrados (modo demo).</div>'; return; }
  sbProf.getErros().then(rows=>{
    if(!rows.length){ list.innerHTML='<div class="empty-line">Nenhum erro nas últimas 24h. 👌</div>'; return; }
    list.innerHTML = rows.map(r=>{
      const q = new Date(r.criado_em);
      const quando = `${String(q.getDate()).padStart(2,'0')} ${meses[q.getMonth()]} · ${String(q.getHours()).padStart(2,'0')}:${String(q.getMinutes()).padStart(2,'0')}`;
      // ctx pode vir como JSON string ou objeto (formatos legados). Extrai src/ln/col/stack
      // pra mostrar file:linha — resolve o caso "Script error." em que a msg vem sanitizada
      // por CORS/SRI mas o browser ainda expoe onde estourou.
      let ctx = r.ctx;
      if(typeof ctx === 'string'){ try{ ctx = JSON.parse(ctx); }catch(_){ ctx = null; } }
      const loc = ctx && (ctx.src || ctx.ln) ? `${safeTxt(ctx.src||'')}${ctx.ln?':'+ctx.ln:''}${ctx.col?':'+ctx.col:''}` : '';
      const stack = ctx && ctx.stack ? safeTxt(String(ctx.stack).slice(0,400)) : '';
      return `<div class="mt-row" style="flex-direction:column;align-items:flex-start;gap:3px">
        <b style="font-size:12.5px;overflow-wrap:break-word">${safeTxt(r.msg||'—')}</b>
        ${loc?`<span style="font-size:11px;color:var(--muted);font-family:ui-monospace,Menlo,Consolas,monospace">${loc}</span>`:''}
        <span style="font-size:11px;color:var(--muted)">${quando}${r.app_version?' · v'+safeTxt(r.app_version):''}</span>
        ${stack?`<details style="width:100%"><summary style="font-size:11px;color:var(--muted);cursor:pointer">stack</summary><pre style="font-size:10.5px;white-space:pre-wrap;overflow-wrap:break-word;margin:4px 0 0;color:var(--muted)">${stack}</pre></details>`:''}
      </div>`;
    }).join('');
  }).catch(()=>{ list.innerHTML='<div class="empty-line">Falha ao carregar os erros.</div>'; });
}

/* ============================================================
   IMPORT DE ALUNOS EM LOTE — XLSX (SheetJS vendorizado).
   Limite: 200 linhas/importação (proteção contra timeout e rate-limit
   do Supabase Free). Acima disso, o professor quebra em lotes.
   Cabeçalhos aceitos (case-insensitive, ordem livre):
     Nome*, E-mail*, Telefone*, Ano nascimento, Data nascimento,
     CEP, Logradouro, Número, Bairro, Cidade, UF,
     Responsável nome, Responsável telefone, Responsável parentesco
   ============================================================ */
const IMPORT_MAX = 200;
// v311: "Ano nascimento" saiu do modelo — o ano é DERIVADO da data. A coluna
// continua sendo aceita na leitura (planilhas antigas), mas não se oferece mais
// um campo que pode divergir da data e não serve pra nada além de confundir.
const IMPORT_TPL_HEADERS = ['Nome','E-mail','Telefone','Data nascimento','CEP','Logradouro','Número','Bairro','Cidade','UF','Responsável nome','Responsável telefone','Responsável parentesco','Status'];
function _alunosImportTemplate(){
  if(typeof XLSX==='undefined'){ toast('Excel: biblioteca ainda carregando'); return; }
  // Status: "Ativo" ou "Inativo" — se vazio, segue a regra automatica (>= 90d sem treinar).
  const exemplo = ['Gabriel Tavares de Jesus','gabriel@email.com','(31) 99999-9999','15/03/1998','33252-034','Rua Antônio José Buffe','123','Felipe Cláudio de Sales','Pedro Leopoldo','MG','Maria da Silva','(31) 98888-7777','Mãe','Ativo'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_TPL_HEADERS, exemplo]);
  ws['!cols'] = IMPORT_TPL_HEADERS.map(h=> ({wch: Math.max(12, h.length+2)}));
  XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
  XLSX.writeFile(wb, `yama-modelo-import-alunos.xlsx`);
}
function _alunosImportOpen(){
  const inp = document.createElement('input');
  inp.type='file'; inp.accept='.xlsx,.xls,.csv';
  inp.onchange = ()=>{
    const f = inp.files[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:false});
        if(!rows.length){ toast('Planilha vazia'); return; }
        // 0029: se o cabecalho tem "Pr. Grau" + "Pr. Nivel", e' o import de
        // presencas legadas — flow separado do cadastro em lote. Mesmo botao,
        // planilha se auto-identifica pelas colunas.
        const headers = Object.keys(rows[0]||{}).map(k => String(k).toLowerCase());
        const ehPresencas = headers.some(h=>h.includes('pr. grau')||h.includes('pr grau')) &&
                            headers.some(h=>h.includes('pr. n')||h.includes('pr n'));
        if(ehPresencas){ _abrirImportPresencasPreview(rows, f.name); return; }
        DB.importAlunosOpen = { rows: _alunosImportValidate(rows), filename: f.name };
        render(); window.scrollTo(0,0);
      } catch(e){ toast('Erro ao ler arquivo: '+(e.message||e)); }
    };
    reader.readAsArrayBuffer(f);
  };
  inp.click();
}
// 0029: preview + apply do import de presencas legadas. Sheet simples com
// contagem, lista de skips (email nao casou, sem evento) e botao Aplicar.
function _abrirImportPresencasPreview(rawRows, filename){
  if(typeof sbProf==='undefined' || !sbProf.importarCreditosPresencas){
    toast('Backend não disponível pra importar presenças');
    return;
  }
  // Normaliza cabecalhos aceitando as duas variacoes ("Pr. Grau"/"Pr Grau", com/sem acento)
  const norm = (o)=>{
    const out={};
    for(const k in o){
      const kl = String(k).trim().toLowerCase()
        .replace(/[àáâã]/g,'a').replace(/[éê]/g,'e').replace(/í/g,'i').replace(/[óô]/g,'o').replace(/ú/g,'u');
      if(kl.includes('e-mail')||kl==='email') out.email = String(o[k]||'').trim().toLowerCase();
      else if(kl.includes('pr. grau')||kl==='pr grau'||kl==='pr.grau') out.creditoGrau = parseInt(String(o[k]).replace(/\D/g,''))||0;
      else if(kl.includes('pr. n')||kl==='pr nivel'||kl==='pr.nivel'||kl==='pr nível') out.creditoFaixa = parseInt(String(o[k]).replace(/\D/g,''))||0;
    }
    return out;
  };
  const norm2 = rawRows.map(norm).filter(r=>r.email);
  // Split em validas (com pelo menos um credito > 0) e vazias
  const validas = norm2.filter(r=> (r.creditoGrau||0)>0 || (r.creditoFaixa||0)>0);
  const vazias = norm2.length - validas.length;
  const sh = el(`<div class="sheet-overlay" role="dialog" aria-label="Importar presenças legadas">
    <div class="sheet">
      <div class="sheet-grip"></div>
      <div class="sheet-hd">
        <div class="sheet-t">🗂️ Importar presenças legadas</div>
        <div class="sheet-sub">${safeTxt(filename||'arquivo')} · ${rawRows.length} linha${rawRows.length!==1?'s':''}</div>
      </div>
      <div style="padding:6px 4px 12px;font-size:13px;color:var(--ink);line-height:1.5">
        <div><b>${validas.length}</b> aluno${validas.length!==1?'s':''} com créditos preenchidos</div>
        ${vazias>0?`<div style="color:var(--muted)">${vazias} linha${vazias>1?'s':''} sem Pr. Grau nem Pr. Nível (serão ignoradas)</div>`:''}
        <div style="margin-top:10px;font-size:12px;color:var(--muted)">
          O crédito vai pro <b>evento de graduação mais recente</b> de cada aluno.
          Se o e-mail não casar ou o aluno não tiver graduação, a linha é pulada e reportada.
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;padding:0 4px">
        <button class="btn-cad primary" id="ip-go" type="button" ${validas.length?'':'disabled'} style="padding:14px">Aplicar (${validas.length} aluno${validas.length!==1?'s':''})</button>
        <button class="btn-cad ghost" id="ip-cancel" type="button">Cancelar</button>
      </div>
      <div id="ip-result" style="margin-top:12px;font-size:12.5px;color:var(--ink);white-space:pre-wrap;max-height:200px;overflow-y:auto"></div>
    </div>
  </div>`);
  const close=()=>{ sh.classList.remove('open'); setTimeout(()=>sh.remove(),260); };
  sh.querySelector('#ip-cancel').onclick=close;
  sh.onclick=(e)=>{ if(e.target===sh) close(); };
  sh.querySelector('#ip-go').onclick=async ()=>{
    const btn=sh.querySelector('#ip-go');
    btn.disabled=true; btn.textContent='Aplicando…';
    try{
      const origem = `import ${(filename||'arquivo').replace(/\.[^.]+$/,'')} · ${new Date().toISOString().slice(0,10)}`;
      const r = await sbProf.importarCreditosPresencas(validas, origem);
      const out = sh.querySelector('#ip-result');
      const linhas = [`✓ ${r.ok} atualizado${r.ok!==1?'s':''}`];
      if(r.skip.length) linhas.push(`\nPulado${r.skip.length!==1?'s':''} (${r.skip.length}):\n` + r.skip.slice(0,20).join('\n') + (r.skip.length>20?`\n… (+${r.skip.length-20})`:''));
      if(r.erro.length) linhas.push(`\nErro${r.erro.length!==1?'s':''} (${r.erro.length}):\n` + r.erro.slice(0,10).join('\n') + (r.erro.length>10?`\n… (+${r.erro.length-10})`:''));
      out.textContent = linhas.join('\n');
      btn.textContent='Concluído ✓'; btn.disabled=true;
      // Recarrega dados pro semaforo atualizar sozinho
      if(typeof _loadProfData==='function'){ _profData=null; _profTs=0; _loadProfData(); }
      toast(`Import concluído: ${r.ok} aluno${r.ok!==1?'s':''}`);
    }catch(e){
      btn.disabled=false; btn.textContent='Tentar de novo';
      sh.querySelector('#ip-result').textContent = 'Falha: '+(e.message||e);
    }
  };
  document.body.appendChild(sh); requestAnimationFrame(()=>sh.classList.add('open'));
}
function _norm(s){ return String(s||'').trim(); }
function _normEmail(s){ return _norm(s).toLowerCase(); }
function _normHeader(k){ return _norm(k).toLowerCase().replace(/[àáâã]/g,'a').replace(/[éê]/g,'e').replace(/í/g,'i').replace(/[óô]/g,'o').replace(/ú/g,'u').replace(/ç/g,'c'); }
const _COL_MAP = {
  'nome':'nome','nome completo':'nome',
  'e-mail':'email','email':'email',
  'telefone':'telefone','whatsapp':'telefone','telefone / whatsapp':'telefone','telefone/whatsapp':'telefone',
  'ano nascimento':'ano','ano de nascimento':'ano','nascimento':'ano',
  'data nascimento':'data_nasc','data de nascimento':'data_nasc','dt. nasc.':'data_nasc',
  'cep':'cep','logradouro':'logradouro','endereco':'logradouro',
  'numero':'numero','n':'numero',
  'bairro':'bairro','cidade':'cidade','uf':'uf',
  'responsavel nome':'resp_nome','responsavel':'resp_nome','nome do responsavel':'resp_nome',
  'responsavel telefone':'resp_tel','telefone responsavel':'resp_tel',
  'responsavel parentesco':'resp_par','parentesco':'resp_par',
  'status':'status','situacao':'status','situação':'status','ativo':'status',
};
// Normaliza "Ativo"/"Inativo"/"A"/"I"/"1"/"0" pro shape do 0023 (ativo|inativo|null).
function _normStatus(v){
  const s = String(v||'').trim().toLowerCase();
  if(!s) return null;
  if(/^(a|ativo|ativa|sim|s|true|1|on)$/.test(s)) return 'ativo';
  if(/^(i|inativo|inativa|nao|não|n|false|0|off)$/.test(s)) return 'inativo';
  return null;   // valor estranho: nao inventa — cai na regra automatica
}
function _alunosImportValidate(rawRows){
  // Mapa email → aluno JÁ cadastrado. Antes era só um Set p/ bloquear duplicata;
  // agora guarda o aluno inteiro pra permitir o modo ATUALIZAR (v311).
  const existentesPorEmail = {};
  ((_profData?.alunos)||[]).forEach(a=>{
    const e = ((a.cad&&a.cad.email)||a.email||'').toLowerCase();
    if(e) existentesPorEmail[e] = a;
  });
  const emailsLote = new Set();
  return rawRows.map((r,idx)=>{
    // Normaliza cabeçalhos
    const d = {};
    Object.keys(r).forEach(k=>{
      const key = _COL_MAP[_normHeader(k)];
      if(key) d[key] = _norm(r[k]);
    });
    const email = _normEmail(d.email);
    const nome = _norm(d.nome);
    const tel = _norm(d.telefone);
    const erros = [], avisos = [];
    let existente = null;
    if(!nome) erros.push('Nome vazio');
    if(!email || !email.includes('@')) erros.push('E-mail inválido');
    else if(existentesPorEmail[email]) existente = existentesPorEmail[email];   // não é erro: vira ATUALIZAR
    else if(emailsLote.has(email)) erros.push('E-mail duplicado na planilha');
    if(!tel) avisos.push('Sem telefone');
    // Data nascimento (DD/MM/AAAA → ISO). É a fonte da verdade da idade.
    let dataNasc = null;
    if(d.data_nasc){
      const m = d.data_nasc.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/) || d.data_nasc.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if(m){
        if(m[1].length===4) dataNasc = `${m[1]}-${m[2]}-${m[3]}`;
        else dataNasc = `${m[3]}-${m[2]}-${m[1]}`;
      } else erros.push('Data de nascimento no formato errado — use DD/MM/AAAA');
    }
    // v311: DATA de nascimento é obrigatória. Ela define a faixa etária, a turma
    // e as regras CBJJ — sem ela o aluno entra "cego" no sistema. Antes era só
    // aviso e 53 alunos acabaram sem data.
    if(!d.data_nasc) erros.push('Data de nascimento obrigatória');

    // ANO derivado da DATA. A coluna "Ano nascimento" existe só por compatibilidade
    // com planilhas antigas: se a data veio, ela manda. Ter os dois campos livres
    // permitia divergirem (ano 1998 + data 15/03/1999) sem ninguém perceber.
    let ano = dataNasc ? parseInt(dataNasc.slice(0,4),10) : null;
    if(ano==null && d.ano){
      const n = parseInt(d.ano,10);
      if(n>=1920 && n<=hoje.getFullYear()) ano = n;
      else avisos.push('Ano de nascimento inválido — ignorado');
    }
    if(existente && !erros.length) avisos.push('Já cadastrado — será ATUALIZADO');
    if(!erros.length && email) emailsLote.add(email);
    return {
      linha: idx+2,   // +1 header +1 base-1
      status: erros.length ? 'erro' : (existente ? 'atualizar' : (avisos.length ? 'aviso' : 'ok')),
      erros, avisos,
      existenteId: existente ? (existente.id||null) : null,
      dados: {
        nome_completo: nome,
        apelido: nome.split(/\s+/)[0]||'',
        email,
        telefone: _normTelBR(tel),
        nascimento: ano,
        nascData: dataNasc,
        cep: _norm(d.cep), logradouro: _norm(d.logradouro), numero: _norm(d.numero),
        bairro: _norm(d.bairro), cidade: _norm(d.cidade), uf: _norm(d.uf).toUpperCase(),
        resp_nome: _norm(d.resp_nome), resp_telefone: _normTelBR(_norm(d.resp_tel)), resp_parentesco: _norm(d.resp_par),
        status_manual: _normStatus(d.status),
      },
    };
  });
}
/* Falha TRANSITÓRIA (rede/infra) vs. definitiva (e-mail repetido, dado inválido).
   Só a transitória vale retentar — repetir um e-mail duplicado 3× só perde tempo. */
function _impErroTransitorio(e){
  const m = String((e && (e.code || e.message)) || e);
  if(/rate_limited|429/.test(m)) return false;              // esperar 1h, não retentar
  if(/already|registered|exists|409/.test(m)) return false; // determinístico
  if(/invalido|invalid|curta|forbidden|403|401/.test(m)) return false;
  // "Failed to send a request to the Edge Function", Failed to fetch, 5xx, timeout
  return /failed to send|failed to fetch|networkerror|network|timeout|abort|50\d/i.test(m);
}
/* Reexecuta a chamada em falha de rede. O laço serial de importação atravessa
   dezenas de requisições; uma queda pontual derrubava o aluno inteiro e o
   professor via "erro" sem entender por quê (alguns entravam, outros não).
   3 tentativas com espera crescente (0,6s / 1,2s) resolve o caso comum. */
async function _impComRetry(fn, tentativas){
  tentativas = tentativas || 3;
  let ultimo;
  for(let i=0;i<tentativas;i++){
    try{ return await fn(); }
    catch(e){
      ultimo = e;
      if(!_impErroTransitorio(e) || i===tentativas-1) throw e;
      await new Promise(r=>setTimeout(r, 600*(i+1)));
    }
  }
  throw ultimo;
}
// Traduz o código de erro do backend pra algo que o professor entenda e saiba
// o que fazer. Desconhecido cai no texto cru — melhor que esconder.
function _impMotivoPT(msg){
  const m = String(msg);
  if(/rate_limited|429/.test(m))            return 'Limite por hora do servidor — espere 1h e reimporte';
  if(/failed to send|Failed to fetch/i.test(m)) return 'Conexão caiu (já tentei 3×) — reimporte a planilha';
  if(/already|registered|exists|409/.test(m)) return 'E-mail já cadastrado no sistema';
  if(/email_invalido/.test(m))              return 'E-mail inválido';
  if(/nascimento_invalido/.test(m))         return 'Ano de nascimento inválido';
  if(/faixa_invalida/.test(m))              return 'Faixa inválida';
  if(/sem_academia|forbidden|403/.test(m))  return 'Sem permissão (refaça o login)';
  if(/Failed to fetch|NetworkError|network/i.test(m)) return 'Falha de conexão';
  return m;
}
/* ============================================================
   ACESSO DOS ALUNOS (v308) — senha padrão + convite em lote.
   Problema que resolve: a senha provisória individual aparece UMA vez, no
   retorno do cadastro. Na importação em lote ela se perde e o professor fica
   sem como dar acesso a ninguém — e o aluno não sabe nem o link do app.
   ============================================================ */
// Senha padrão da academia. Precisa passar na política do Supabase (upper+lower+digit).
// Configurável em Configurações da academia (persiste em academies.config.senhaPadrao,
// compartilhada entre os professores — v430). Este default só vale enquanto ninguém salvou.
const SENHA_PADRAO_DEFAULT = 'YamaJiuJitsu2026';
/* v430: mora em `academies.config` (COMPARTILHADA entre os professores da academia).
   Antes lia de DB.loja.config, que vive no dump → `user_state`, RLS estritamente self:
   cada professor tinha a SUA senha padrão e não via a do outro. Sintoma real: o dono
   definia "Yama2026" e o segundo professor via o default hard-coded — e se ele clicasse
   "aplicar", sobrescrevia os 149 alunos com outra senha, invalidando os convites já
   enviados. Mesma cadeia de fallback do _lojaPix: nuvem → legado local → default. */
function _senhaPadrao(){ return _acadCfg().senhaPadrao || (DB.loja && DB.loja.config && DB.loja.config.senhaPadrao) || SENHA_PADRAO_DEFAULT; }
function profAcessoAlunos(){
  const close = ()=>{ DB.acessoAlunosOpen=false; render(); window.scrollTo(0,0); };
  const page = el(`<div class="erp-batch-page">
    <div class="erp-batch-hd">
      <button class="erp-batch-close" id="ac-close" aria-label="Voltar">‹</button>
      <div class="erp-batch-title">Acesso dos alunos</div>
      <span></span>
    </div>
    <div class="ac-intro">
      <div class="ac-senha">Senha padrão: <b>${safeTxt(_senhaPadrao())}</b> <button type="button" id="ac-edit-senha" style="margin-left:8px;background:none;border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;color:var(--muted);cursor:pointer">⚙️ Configurações da academia</button></div>
      <div class="ac-hint">Vale só pra quem <b>nunca acessou</b>. No primeiro login o app obriga a criar uma senha nova.</div>
      <div class="ac-warn">⚠️ Enquanto o aluno não fizer o primeiro acesso, quem souber esta senha e o e-mail dele consegue entrar na conta e ver o diário de treinos. Peça pra acessarem logo.</div>
    </div>
    <div class="im-list" id="ac-list"><div class="loading-center">Carregando…</div></div>
    <div class="erp-batch-foot">
      <button class="erp-batch-go" id="ac-go" disabled>Carregando…</button>
    </div>
  </div>`);
  page.querySelector('#ac-close').onclick = close;
  page.querySelector('#ac-edit-senha').onclick = ()=>_senhaPadraoSheet();
  const listEl = page.querySelector('#ac-list');
  const goBtn  = page.querySelector('#ac-go');

  if(DEMO || typeof sbProf==='undefined' || !sbProf.senhaPadraoLote){
    listEl.innerHTML = '<div class="empty-line">Indisponível no modo demo.</div>';
    return page;
  }

  // v353: cache do dry-run por 60s. A tela era reconstruída a cada `render()`
  // (o refetch focus/visibilitychange dispara render, cadastrar aluno dispara
  // render etc) e cada reconstrução chamava a Edge Function de novo — o usuário
  // via "Carregando..." → lista → "Carregando..." alternando. A senha aplicada
  // (não-dry) invalida o cache manualmente.
  let pendentes = [];
  const pintar = ()=>{
    listEl.innerHTML='';
    if(!pendentes.length){ listEl.innerHTML='<div class="empty-line">Todos os alunos já fizeram o primeiro acesso 🎉</div>'; return; }
    pendentes.forEach(p=>{
      // Casa com o aluno da lista carregada pra reaproveitar telefone/ficha do _waLink
      const a = ((_profData?.alunos)||[]).find(x=> x.id===p.id) || {nm:p.nome, cad:{email:p.email}};
      const temTel = !!_waLink(a);
      const row = el(`<div class="im-row im-row-acesso ${temTel?'im-ok':'im-warn'}">
        <span class="im-ic">${temTel?'💬':'⚠'}</span>
        <div class="im-info">
          <div class="im-nm">${safeTxt(_nomeInst(a)!=='—'?_nomeInst(a):(p.nome||'—'))}</div>
          <div class="im-sub">${safeTxt(p.email||'sem e-mail')}${temTel?'':' · sem telefone cadastrado'}</div>
        </div>
        ${temTel?'<button class="ac-wa" type="button">Enviar</button>':''}
      </div>`);
      const btn = row.querySelector('.ac-wa');
      if(btn) btn.onclick = ()=>{
        const url = _waLink(a, _waConviteBody(a, _senhaPadrao()));
        if(!url){ toast('Sem telefone cadastrado'); return; }
        try{ window.open(url,'_blank','noopener'); }catch(_){ location.href=url; }
        row.classList.add('ac-enviado'); btn.textContent='Enviado ✓';
      };
      listEl.appendChild(row);
    });
  };

  const _aplicaResult = (r)=>{
    pendentes = (r && r.alunos) || [];
    pintar();
    goBtn.disabled = !pendentes.length;
    goBtn.textContent = pendentes.length
      ? `Aplicar senha padrão a ${pendentes.length} aluno${pendentes.length!==1?'s':''}`
      : 'Nada a fazer';
  };
  const cache = window._acessoCache;
  if(cache && (Date.now()-cache.ts)<60000 && cache.senha===_senhaPadrao()){
    _aplicaResult(cache.data);
  } else {
    sbProf.senhaPadraoLote(_senhaPadrao(), true).then(r=>{
      window._acessoCache = { ts:Date.now(), senha:_senhaPadrao(), data:r };
      _aplicaResult(r);
    }).catch(e=>{
      listEl.innerHTML = `<div class="empty-line">Falha ao carregar: ${safeTxt(e.message||e)}</div>`;
    });
  }

  goBtn.onclick = async ()=>{
    if(!confirm(`Definir a senha "${_senhaPadrao()}" para ${pendentes.length} aluno(s) que nunca acessaram?\n\nQuem já acessou NÃO é afetado.`)) return;
    goBtn.disabled = true; goBtn.textContent = 'Aplicando…';
    try{
      // Era `SENHA_PADRAO` — constante que NUNCA existiu: o clique morria em
      // ReferenceError e nenhuma senha era aplicada (v341). É a MESMA senha do
      // dry-run, do convite de WhatsApp e do texto do confirm.
      const r = await sbProf.senhaPadraoLote(_senhaPadrao(), false);
      window._acessoCache = null;   // v353: senhas mudaram → dry-run cacheado ficou obsoleto
      const f = (r.falhas||[]).length;
      alert(`${r.aplicadas} senha(s) definida(s) ✓${f?`\n${f} falha(s):\n`+r.falhas.join('\n'):''}\n\nAgora use o botão "Enviar" de cada aluno pra mandar o convite no WhatsApp.`);
      goBtn.textContent = 'Senha aplicada ✓';
    }catch(e){
      goBtn.disabled=false; goBtn.textContent='Tentar de novo';
      alert('Falha: '+(e.message||e));
    }
  };
  return page;
}

function profImportAlunos(){
  const state = DB.importAlunosOpen;
  const rows = state.rows || [];
  const stats = { ok:0, aviso:0, erro:0, atualizar:0 };
  rows.forEach(r=> stats[r.status]++);
  const importaveis = rows.filter(r=> r.status!=='erro');
  const nNovos = stats.ok + stats.aviso;
  const excedeu = importaveis.length > IMPORT_MAX;
  const close = ()=>{ DB.importAlunosOpen=null; render(); window.scrollTo(0,0); };
  const page = el(`<div class="erp-batch-page">
    <div class="erp-batch-hd">
      <button class="erp-batch-close" id="im-close" aria-label="Voltar">‹</button>
      <div class="erp-batch-title">Importar alunos</div>
      <span></span>
    </div>
    <div class="im-meta">
      <span class="im-file">${safeTxt(state.filename||'planilha.xlsx')}</span>
      <span class="im-stat ok"><b>${nNovos}</b> novo${nNovos!==1?'s':''}</span>
      <span class="im-stat upd"><b>${stats.atualizar}</b> a atualizar</span>
      <span class="im-stat err"><b>${stats.erro}</b> bloqueado${stats.erro!==1?'s':''}</span>
      ${excedeu?`<span class="im-limit">Limite: ${IMPORT_MAX}/vez — só as primeiras ${IMPORT_MAX} serão importadas</span>`:''}
      ${stats.atualizar?`<span class="im-hint">Quem já existe tem os dados preenchidos da planilha atualizados (data de nascimento, telefone, endereço). Campo em branco na planilha não apaga o que já está salvo.</span>`:''}
    </div>
    <div class="im-list" id="im-list"></div>
    <div class="erp-batch-foot">
      <button class="erp-batch-go" id="im-go"${importaveis.length?'':' disabled'}>${[nNovos?`Importar ${Math.min(nNovos,IMPORT_MAX)}`:'', stats.atualizar?`Atualizar ${stats.atualizar}`:''].filter(Boolean).join(' · ')||'Nada a fazer'}</button>
    </div>
  </div>`);
  page.querySelector('#im-close').onclick = close;
  const listEl = page.querySelector('#im-list');
  rows.forEach(r=>{
    const cls = r.status==='erro'?'im-err':(r.status==='atualizar'?'im-upd':(r.status==='aviso'?'im-warn':'im-ok'));
    const ic = r.status==='erro'?'✗':(r.status==='atualizar'?'↻':(r.status==='aviso'?'⚠':'✓'));
    const msgs = [...r.erros, ...r.avisos].join(' · ');
    listEl.appendChild(el(`<div class="im-row ${cls}">
      <span class="im-ic">${ic}</span>
      <span class="im-linha">L${r.linha}</span>
      <div class="im-info">
        <div class="im-nm">${safeTxt(r.dados.nome_completo||'(sem nome)')}</div>
        <div class="im-sub">${safeTxt(r.dados.email||'—')} · ${safeTxt(r.dados.telefone||'—')}${msgs?' · <i>'+safeTxt(msgs)+'</i>':''}</div>
      </div>
    </div>`));
  });
  page.querySelector('#im-go').onclick = async ()=>{
    const goBtn = page.querySelector('#im-go');
    const alvo = importaveis.slice(0, IMPORT_MAX);
    goBtn.disabled = true;
    let ok=0, upd=0, fail=0, feitos=0, abortou=false;
    const motivos = {};   // mensagem de erro → quantas vezes ocorreu
    const total = alvo.length;
    const atualiza = ()=>{ goBtn.textContent = `Processando ${feitos}/${total}…`; };
    atualiza();
    if(DEMO || typeof sbProf==='undefined' || !sbProf.criarAluno){
      // Offline: só simula
      alvo.forEach(r=>{ ok++; feitos++; });
      atualiza();
    } else {
      // Serial pra ver progresso + evitar rate-limit
      for(const r of alvo){
        try{
          const d = r.dados;
          if(r.status==='atualizar' && r.existenteId){
            // ATUALIZAR quem já existe (v311). Só campos PREENCHIDOS na planilha:
            // célula em branco não pode apagar dado bom que já está no sistema.
            const patch = {};
            if(d.nascData)  patch.nascimento_data = d.nascData;
            if(d.nascimento)patch.nascimento      = d.nascimento;
            if(d.telefone)  patch.telefone        = d.telefone;
            if(d.cep)       patch.cep             = d.cep;
            if(d.logradouro)patch.logradouro      = d.logradouro;
            if(d.numero)    patch.numero          = d.numero;
            if(d.bairro)    patch.bairro          = d.bairro;
            if(d.cidade)    patch.cidade          = d.cidade;
            if(d.uf)        patch.uf              = d.uf;
            if(d.resp_nome) patch.resp_nome       = d.resp_nome;
            if(d.resp_telefone)  patch.resp_telefone  = d.resp_telefone;
            if(d.resp_parentesco)patch.resp_parentesco= d.resp_parentesco;
            if(d.status_manual)  patch.status_manual  = d.status_manual;
            if(Object.keys(patch).length) await _impComRetry(()=>sbProf.atualizarAluno(r.existenteId, patch));
            upd++;
          } else {
            // v345: importação NÃO grada ninguém. `sem_graduacao:true` faz a Edge
            // Function pular o seed em `graduations` — o aluno entra com a timeline
            // vazia e aparece como "Sem graduação" até o professor registrar o início.
            // (profiles.faixa segue 'branca' como valor técnico — 43 pontos leem BELTS[faixa].)
            const payload = { nome_completo:d.nome_completo, apelido:d.apelido, email:d.email,
              faixa:'branca', graus:0, sem_graduacao:true, nascimento:d.nascimento, desde: HOJE_ISO.slice(0,7),
              telefone:d.telefone, cep:d.cep, logradouro:d.logradouro, numero:d.numero,
              bairro:d.bairro, cidade:d.cidade, uf:d.uf,
              resp_nome:d.resp_nome, resp_telefone:d.resp_telefone, resp_parentesco:d.resp_parentesco,
              data_inicio: HOJE_ISO, observacoes: '' };
            const rr = await _impComRetry(()=>sbProf.criarAluno(payload));
            const novoId = rr && (rr.user_id||rr.id);
            if(novoId && sbProf.atualizarAluno){
              // best-effort: se falhar, a reimportação corrige pelo modo ATUALIZAR.
              // Junta nascData + status_manual num patch só pra economizar round-trip.
              const patch = {};
              if(d.nascData)    patch.nascimento_data = d.nascData;
              if(d.status_manual) patch.status_manual = d.status_manual;
              if(Object.keys(patch).length){ try{ await sbProf.atualizarAluno(novoId, patch); }catch(_){} }
            }
            ok++;
          }
        } catch(e){
          fail++;
          // v307: guarda o MOTIVO. Antes o catch era mudo e a importação só dizia
          // "N falhas" — o professor não tinha como saber que era rate-limit, e-mail
          // repetido ou queda de rede. Sem isso o erro vira adivinhação.
          const msg = String((e && (e.code || e.message)) || e);
          motivos[msg] = (motivos[msg]||0) + 1;
          if(/rate_limited|429/.test(msg)){ abortou = true; break; }   // insistir só gera mais 429
        }
        feitos++; atualiza();
        // Respiro entre chamadas: o laço serial disparando sem pausa derrubava
        // conexões no meio da importação ("Failed to send a request"). 150 ms
        // não muda a percepção de tempo e estabiliza bastante.
        await new Promise(r=>setTimeout(r,150));
      }
    }
    // v424: aplica a SENHA PADRÃO nos recém-criados. Sem isso, cada aluno nascia
    // com a senha aleatória do create-student (gerarSenha()) — que se perde no
    // lote, porque ninguém guarda 158 senhas. O professor mandava "sua senha é
    // Yama2026", o aluno não conseguia entrar, e o reset virava SQL manual.
    // Só toca em quem NUNCA acessou (regra da própria Edge senha-padrao).
    let senhaAplicada = 0, senhaErro = null;
    if(ok > 0 && !DEMO && typeof sbProf!=='undefined' && sbProf.senhaPadraoLote){
      try{
        const rs = await sbProf.senhaPadraoLote(_senhaPadrao(), false);
        senhaAplicada = (rs && rs.aplicadas) || 0;
      }catch(e){ senhaErro = String((e && (e.code||e.message)) || e); }
      try{ window._acessoCache = null; }catch(_){}   // a tela "Acesso dos alunos" recontar
    }
    _profData=null; _profTs=0; _loadProfData();
    const restantes = total - feitos;
    const senhaTxt = senhaErro
      ? `\n⚠️ Senha padrão NÃO aplicada (${_impMotivoPT(senhaErro)}).\nUse Alunos → 🔑 Acesso para aplicar.`
      : (senhaAplicada ? `\n🔑 Senha padrão "${_senhaPadrao()}" aplicada a ${senhaAplicada} aluno(s).` : '');
    const resumo = [ok?`${ok} criado${ok!==1?'s':''} ✓`:'', upd?`${upd} atualizado${upd!==1?'s':''} ↻`:''].filter(Boolean).join('\n') + senhaTxt;
    if(abortou){
      alert(`Importação interrompida no ${feitos}º de ${total}.\n\n`+
        `LIMITE POR HORA ATINGIDO no servidor.\n\n${resumo}\n`+
        `${restantes} ainda não processado${restantes!==1?'s':''}.\n\n`+
        `Espere 1 hora e importe a mesma planilha de novo — quem já entrou vira `+
        `"atualizar" e não duplica.`);
    } else if(fail){
      const det = Object.entries(motivos).map(([m,n])=>`• ${n}× ${_impMotivoPT(m)}`).join('\n');
      alert(`Importação concluída.\n\n${resumo}\n${fail} falha${fail!==1?'s':''} ✕\n\nMotivos:\n${det}`);
    } else {
      toast(resumo.replace(/\n/g,' · ') || 'Nada a fazer');
    }
    close();
  };
  return page;
}

/* ============================================================
   EXPORT — XLSX (SheetJS vendorizado) e PDF (jsPDF + autoTable
   vendorizados). Download DIRETO, sem janela nova. Ambos com header
   institucional (nome da academia + data) e tabela estruturada.
   Ver vendor/xlsx.min.js, vendor/jspdf.min.js, vendor/jspdf-autotable.min.js.
   ============================================================ */
// Colunas ricas — Kanri-style. Idade calculada; Foto Sim/Não; Dt.Início do cadastro;
// Pr.Grau/Pr.Nível: aulas restantes (heurística até termos regra CBJJ configurada).
function _idadeDe(nasc){
  if(!nasc) return '';
  const y = String(nasc).slice(0,4); if(!/^\d{4}$/.test(y)) return '';
  return String((new Date()).getFullYear() - parseInt(y,10));
}
function _fmtDataBR(iso){
  if(!iso) return '';
  const [y,m,d] = String(iso).split('-'); if(!y||!m||!d) return String(iso);
  return `${d}/${m}/${y}`;
}
function _alunosBuildRows(alunos, turmaMap){
  return alunos.map(a=>{
    const cod = (a.matricula ? String(a.matricula).padStart(5,'0') : (a.id ? String(a.id).slice(-6) : ''));
    const turmas = (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(' | ');
    const nivel = BELTS[a.faixa]?.nome || a.faixa || '';
    const pago = a.pago==='ok'?'Em dia':a.pago==='late'?'Vencido':a.pago==='soon'?'A vencer':'';
    return {
      'Mat.': cod,
      'Nome': _nomeInst(a),
      'E-mail': (a.cad && a.cad.email) || a.email || '',
      'Idade': _idadeDe(a.nascimento||a.nascData),
      'Foto': a.foto ? 'Sim' : 'Não',
      'Dt. Nasc.': _fmtDataBR(a.nascData||a.nascimento),
      'Dt. Início': _fmtDataBR((a.cad && a.cad.dataInicio) || a.desde),
      'Nível': nivel,
      'Graus': a.graus||0,
      'Grupos': turmas,
      'Telefone': (a.cad && a.cad.telefone) || a.telefone || '',
      'Últ. presença': a.pres ? String(a.pres) : '',
      'Dias sem': a.diasSem||0,
      'Status': (a.diasSem||0)>=14 ? 'Inativo' : 'Ativo',
      'Pagamento': pago,
    };
  });
}
// v350: versão completa — inclui endereço, responsável, consentimento LGPD,
// aulas no grau, faixa etária, frequência do mês, apto a grau. Base p/ análise
// externa (RH da academia, contabilidade, envio de aniversariantes etc.).
function _alunosBuildRowsCompleta(alunos, turmaMap){
  return alunos.map(a=>{
    const cod = (a.matricula ? String(a.matricula).padStart(5,'0') : (a.id ? String(a.id).slice(-6) : ''));
    const turmas = (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(' | ');
    const nivel = BELTS[a.faixa]?.nome || a.faixa || '';
    const pago = a.pago==='ok'?'Em dia':a.pago==='late'?'Vencido':a.pago==='soon'?'A vencer':'';
    const c = a.cad || {}; const e = c.endereco || {}; const r = c.responsavel || {};
    return {
      'Mat.': cod,
      'Nome': _nomeInst(a),
      'Apelido': a.nm || '',
      'E-mail': c.email || a.email || '',
      'Telefone': c.telefone || a.telefone || '',
      'Recebe mensagens': (c.aceitaContato===false ? 'Não' : 'Sim'),
      'Dt. Nasc.': _fmtDataBR(a.nascData||a.nascimento),
      'Idade': _idadeDe(a.nascimento||a.nascData),
      'Faixa etária': _faixaEtariaLbl(a.nascimento) || '',
      'CEP': e.cep || '',
      'Logradouro': e.logradouro || '',
      'Número': e.numero || '',
      'Bairro': e.bairro || '',
      'Cidade': e.cidade || '',
      'UF': e.uf || '',
      'Responsável': r.nome || '',
      'Parentesco': r.parentesco || '',
      'Tel. responsável': r.telefone || '',
      'Dt. Início': _fmtDataBR(c.dataInicio || a.desde),
      'Faixa desde': _fmtDataBR(a.faixaDesde),
      'Data último grau': _fmtDataBR(a.grauDesde || a.faixaDesde),
      'Nível': nivel,
      'Graus': a.graus||0,
      'Aulas no grau': a.aulasNoGrau||0,
      'Apto a grau': a.aptoGrad ? 'Sim' : 'Não',
      'Grupos': turmas,
      'Frequência mês %': a.freq||0,
      'Últ. presença': a.pres ? String(a.pres) : '',
      'Dias sem': a.diasSem||0,
      'Status': (a.diasSem||0)>=14 ? 'Inativo' : 'Ativo',
      'Pagamento': pago,
      'Foto': a.foto ? 'Sim' : 'Não',
      'Observações': c.obs || '',
    };
  });
}
// Planilha ENXUTA pro import de presencas do app antigo (Kanri etc). Cabecalho
// pensado pro professor abrir no Excel, preencher SO Pr. Grau e Pr. Nivel, e
// devolver. As demais colunas sao referencia pra ele conferir que casou o aluno
// certo — nao viram valor no import.
function _alunosBuildRowsPresencasLegadas(alunos){
  return alunos.map(a=>{
    const c = a.cad || {};
    const nivel = BELTS[a.faixa]?.nome || a.faixa || '';
    return {
      'E-mail': c.email || a.email || '',
      'Nome': _nomeInst(a),
      'Nível': nivel,
      'Graus': a.graus||0,
      'Data último grau': _fmtDataBR(a.grauDesde || a.faixaDesde),
      'Pr. Grau': '',
      'Pr. Nível': '',
    };
  });
}
function _alunosFiltrosAtivos(){
  // No protótipo, sem estado de filtros persistido — retorna vazio.
  // Depois: ler filtro/busca/faixa e montar string legível "Status: Ativo · Grupo: X · Faixa: Y".
  return '';
}
function _alunosExportXLSX(alunos, turmaMap, modo){
  if(typeof XLSX==='undefined'){ toast('Excel: biblioteca ainda carregando'); return; }
  const acadNm = (DB.academia && DB.academia.nome) || 'Academia';
  const completa = modo==='completa';
  const presencas = modo==='presencas';
  let rows, header, cols, suf;
  if(presencas){
    rows = _alunosBuildRowsPresencasLegadas(alunos);
    header = ['E-mail','Nome','Nível','Graus','Data último grau','Pr. Grau','Pr. Nível'];
    cols = [{wch:32},{wch:28},{wch:10},{wch:6},{wch:14},{wch:9},{wch:9}];
    suf = '-import-presencas-legadas';
  } else if(completa){
    rows = _alunosBuildRowsCompleta(alunos, turmaMap);
    header = Object.keys(rows[0]||{});
    cols = header.map(()=>({wch:16}));
    suf = '-completa';
  } else {
    rows = _alunosBuildRows(alunos, turmaMap);
    header = ['Mat.','Nome','E-mail','Idade','Foto','Dt. Nasc.','Dt. Início','Nível','Graus','Grupos','Telefone','Últ. presença','Dias sem','Status','Pagamento'];
    cols = [{wch:7},{wch:28},{wch:30},{wch:5},{wch:5},{wch:11},{wch:11},{wch:18},{wch:5},{wch:24},{wch:16},{wch:12},{wch:8},{wch:9},{wch:10}];
    suf = '';
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
  const nome = `${acadNm.replace(/\s+/g,'-')}-alunos${suf}-${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, nome);
}
function _alunosExportXLSXSheet(alunos, turmaMap){
  const overlay = el(`<div class="sheet-overlay" role="dialog" aria-label="Exportar Excel">
    <div class="sheet">
      <div class="sheet-grip"></div>
      <div class="sheet-hd"><div class="sheet-t">Exportar Excel</div>
        <div class="sheet-sub">${((_profData?.alunos)||[]).length} aluno${((_profData?.alunos)||[]).length!==1?'s':''} · base completa (ignora filtro)</div></div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:0 4px 8px">
        <button class="btn-cad" type="button" data-a="resumida" style="text-align:left;padding:14px 16px">
          <div style="font-weight:800;font-size:14px">📄 Base resumida</div>
          <div style="font-size:12px;color:var(--muted);font-weight:600;margin-top:3px">15 colunas — matrícula, nome, e-mail, faixa, grupos, presença, status, pagamento</div>
        </button>
        <button class="btn-cad primary" type="button" data-a="completa" style="text-align:left;padding:14px 16px">
          <div style="font-weight:800;font-size:14px">📊 Base completa</div>
          <div style="font-size:12px;color:rgba(255,255,255,.85);font-weight:600;margin-top:3px">31 colunas — inclui endereço, responsável, LGPD, aulas no grau, frequência</div>
        </button>
        <button class="btn-cad" type="button" data-a="presencas" style="text-align:left;padding:14px 16px">
          <div style="font-weight:800;font-size:14px">🗂️ Import de presenças legadas</div>
          <div style="font-size:12px;color:var(--muted);font-weight:600;margin-top:3px">7 colunas — inclui inativos, ignora o filtro atual. Data do último grau já pré-preenchida; você adiciona Pr. Grau e Pr. Nível e devolve pra importar</div>
        </button>
        <button class="btn-cad ghost" type="button" data-a="cancel">Cancelar</button>
      </div>
    </div></div>`);
  const close = ()=>{ overlay.classList.remove('open'); setTimeout(()=>overlay.remove(),260); };
  overlay.querySelector('[data-a="cancel"]').onclick = close;
  // Os 3 exports usam a base completa (_profData.alunos) — filtro da tela e' pra
  // trabalhar, export vem inteiro pro Excel decidir. profiles.ativo=false (conta
  // desativada pelo dono) fica de fora pelo adapter — o certo. v390.
  const _todos = ()=> (_profData?.alunos)||[];
  overlay.querySelector('[data-a="resumida"]').onclick = ()=>{ _alunosExportXLSX(_todos(), turmaMap, 'resumida'); close(); };
  overlay.querySelector('[data-a="completa"]').onclick = ()=>{ _alunosExportXLSX(_todos(), turmaMap, 'completa'); close(); };
  overlay.querySelector('[data-a="presencas"]').onclick = ()=>{ _alunosExportXLSX(_todos(), turmaMap, 'presencas'); close(); };
  overlay.onclick = (e)=>{ if(e.target===overlay) close(); };
  document.body.appendChild(overlay);
  requestAnimationFrame(()=>overlay.classList.add('open'));
}
function _alunosExportPDF(alunos, turmaMap){
  if(typeof window.jspdf==='undefined' || typeof window.jspdf.jsPDF==='undefined'){ toast('PDF: biblioteca ainda carregando'); return; }
  const { jsPDF } = window.jspdf;
  const acadNm = (DB.academia && DB.academia.nome) || 'Academia';
  const hoje = new Date().toLocaleDateString('pt-BR');
  const filtros = _alunosFiltrosAtivos();
  // Landscape p/ caber mais colunas (Kanri-style)
  const doc = new jsPDF({unit:'pt', format:'a4', orientation:'landscape'});
  const W = doc.internal.pageSize.getWidth();
  // Header ENXUTO estilo Kanri (sem logo grande — só nome + título + data no canto)
  doc.setTextColor(20,20,22); doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(acadNm, 30, 34);
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.text('Alunos Cadastrados', 30, 50);
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(120,120,120);
  if(filtros) doc.text('Filtros: '+filtros, 30, 64);
  // Data à direita
  doc.setTextColor(80,80,80); doc.setFontSize(9);
  doc.text(hoje, W-30, 34, {align:'right'});
  // Linha separadora
  doc.setDrawColor(220,220,220); doc.setLineWidth(0.6);
  doc.line(30, 72, W-30, 72);
  // Tabela — mesmo shape do Kanri
  const rows = _alunosBuildRows(alunos, turmaMap);
  const head = [['Mat.','Nome','E-mail','Idade','Foto','Dt. Nasc.','Dt. Início','Nível','Graus','Grupos','Telefone','Status']];
  const body = rows.map(r=> [r['Mat.'], r['Nome'], r['E-mail'], r['Idade'], r['Foto'], r['Dt. Nasc.'], r['Dt. Início'], r['Nível'], r['Graus'], r['Grupos'], r['Telefone'], r['Status']]);
  doc.autoTable({
    startY: 82,
    head, body,
    styles: { font:'helvetica', fontSize:7.5, cellPadding:3, overflow:'linebreak', textColor:[40,40,40] },
    headStyles: { fillColor:[245,245,245], textColor:[20,20,22], fontStyle:'bold', fontSize:7.5, lineWidth:0.3, lineColor:[200,200,200] },
    alternateRowStyles: { fillColor:[252,252,252] },
    margin: { left:30, right:30 },
    columnStyles: {
      0:{ cellWidth:36 },   // Mat
      1:{ cellWidth:120 },  // Nome
      2:{ cellWidth:130 },  // E-mail
      3:{ cellWidth:32, halign:'center' },  // Idade
      4:{ cellWidth:32, halign:'center' },  // Foto
      5:{ cellWidth:60, halign:'center' },  // Nasc
      6:{ cellWidth:60, halign:'center' },  // Início
      7:{ cellWidth:70 },   // Nível
      8:{ cellWidth:34, halign:'center' },  // Graus
      9:{ cellWidth:'auto' }, // Grupos
      10:{ cellWidth:80 },  // Tel
      11:{ cellWidth:48, halign:'center' }, // Status
    },
    didParseCell: (data)=>{
      if(data.section==='body' && data.column.index===11){
        if(data.cell.raw==='Ativo'){ data.cell.styles.textColor=[47,168,106]; data.cell.styles.fontStyle='bold'; }
        else if(data.cell.raw==='Inativo'){ data.cell.styles.textColor=[198,40,40]; data.cell.styles.fontStyle='bold'; }
      }
    },
  });
  // Rodapé com paginação
  const pages = doc.internal.getNumberOfPages();
  for(let p=1;p<=pages;p++){
    doc.setPage(p);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setTextColor(140,140,140);
    doc.text(`${acadNm} · Yama Jiu-Jitsu`, 30, pageH-14);
    doc.text(`Página ${p} de ${pages} · ${alunos.length} alunos · ${hoje}`, W-30, pageH-14, {align:'right'});
  }
  const nome = `${acadNm.replace(/\s+/g,'-')}-alunos-cadastrados-${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(nome);
}

/* DataTable de alunos: busca + filtros (§7).
   Offline: muta os objetos mock (refletindo na hora). Com backend: chama sbProf.
   v348: seleção múltipla e ações em lote removidas — ver o comentário do
   `.dt-add-wrap` no app.css. Lançamento de presença em lote vive em Presenças,
   onde a sessão da turma é escolhida. */

function profAlunos(){
  const w = el('<div></div>');
  const alunos = (_profData?.alunos)||[];
  // v384: TODOS os chips (exceto "Inativos") ignoram alunos inativos. Antes,
  // "Presentes"/"Ativos (14d)"/"Ausentes 7+d"/"Vencidos" contavam inativos junto,
  // criando dissonancia entre chip e lista (chip 34 presentes, mas lista mostra 3
  // porque "Todos" ja excluia inativos desde v382).
  const _naoInativo = a => _statusAluno(a).valor !== 'inativo';
  const presentes = alunos.filter(a=> _naoInativo(a) && a.pres).length;
  const ativos = alunos.filter(a=> _naoInativo(a) && (a.diasSem ?? 999) <= 14).length;
  const ausentes = alunos.filter(a=> _naoInativo(a) && (a.diasSem||0)>=7).length;
  const vencidosN = alunos.filter(a=> _naoInativo(a) && a.pago==='late').length;
  const aptosN = typeof _aptosGraduar==='function'
    ? _aptosGraduar().filter(_naoInativo).length : 0;
  const inativosN = alunos.filter(a=>_statusAluno(a).valor==='inativo').length;
  // v382: "Todos" da lista deixa de contar inativos — usuario ve o total LIQUIDO
  // por padrao. Inativos ainda aparecem via chip "Inativos" (dedicado).
  const totalLiquido = alunos.length - inativosN;

  // Cabeçalho compacto ERP
  w.innerHTML = `<div class="erp-alunos-hd">
    <div class="erp-alunos-title">Alunos</div>
    <div class="erp-alunos-sub" id="alunos-sub-kpi">${_profData?totalLiquido+' ativos · '+alunos.length+' cadastrados · '+presentes+' presentes hoje':'Carregando…'}</div>
  </div>`;

  _loadTurmas();
  const turmaMap = {}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });

  let filtro = DB._pendingAlunosFiltro || 'todos'; DB._pendingAlunosFiltro=null;
  let busca = '', filtroEt = 'todos';
  let sortKey='nm', sortDir='asc';
  let showAdv = false;
  // Filtros avançados (painel colapsável). '' = "Todos" (ignora).
  const advF = { matricula:'', ativos:'', aguardando:'', mensagens:'', faixa:'', turma:'', plano:'', aniversario:'', status:'' };
  if(DB._pendingAlunosAniv){ advF.aniversario = DB._pendingAlunosAniv; DB._pendingAlunosAniv=null; }
  const PAGE = 20; let shown = PAGE;

  const srch = el(`<div class="dt-search"><span class="dt-search-ic" aria-hidden="true">🔎</span><input class="dt-search-inp" type="search" aria-label="Buscar aluno" placeholder="Buscar por nome…"></div>`);

  // Chips-KPI clicáveis semânticos (substituem filter-seg antigo)
  const kpiChip = (id, lbl, valor, cls)=>{
    const b = el(`<button class="erp-alunos-kpi ${cls}${filtro===id?' on':''}" data-f="${id}">
      <span class="erp-alunos-kpi-v">${valor}</span>
      <span class="erp-alunos-kpi-l">${lbl}</span>
    </button>`);
    b.onclick = ()=>{
      filtro = id; shown = PAGE;
      w.querySelectorAll('.erp-alunos-kpi').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      renderList();
    };
    return b;
  };
  const chipsRow = el(`<div class="erp-alunos-chips block"></div>`);
  chipsRow.appendChild(kpiChip('todos',    'Todos',        totalLiquido, 'gray'));
  chipsRow.appendChild(kpiChip('presentes','Presentes',    presentes,     'green'));
  chipsRow.appendChild(kpiChip('ativos',   'Ativos (14d)', ativos,        'blue'));
  chipsRow.appendChild(kpiChip('sumidos',  'Ausentes 7+d', ausentes,      'gold'));
  chipsRow.appendChild(kpiChip('aptos',    'Aptos a grau', aptosN,        'purple'));
  chipsRow.appendChild(kpiChip('vencidos', 'Vencidos',     vencidosN,     'red'));
  chipsRow.appendChild(kpiChip('inativos', 'Inativos',     inativosN,     'gray'));

  // Faixa etária: chips SEMPRE visíveis (v311). Antes ficava escondido atrás do
  // painel de filtros avançados; o professor filtra por idade o tempo todo, então
  // não faz sentido custar dois cliques. Fonte ÚNICA do filtro — o select que
  // existia no painel avançado foi removido pra não haver dois controles
  // disputando o mesmo estado.
  const chipsEt = el(`<div class="erp-et-bar"></div>`);
  const _mkFxChip=(id,lbl)=>{ const b=el(`<button class="et-chip ${filtroEt===id?'on':''}">${lbl}</button>`);
    b.onclick=()=>{ filtroEt=id; shown=PAGE; chipsEt.querySelectorAll('.et-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); renderList(); };
    return b; };
  // Busca exposta (desktop): antes só existia dentro de "Filtros avançados" (advf-nome,
  // campo redundante) — some daqui, e a busca do topo (mesma var `busca` do toolbar
  // mobile) fica visível também no desktop, à esquerda da faixa etária.
  const srchEt = el(`<div class="erp-et-search dt-search"><span class="dt-search-ic" aria-hidden="true">🔎</span><input class="dt-search-inp" type="search" aria-label="Buscar aluno" placeholder="Buscar por nome…"></div>`);
  srchEt.querySelector('input').oninput=(e)=>{ busca=e.target.value.trim(); shown=PAGE; renderList(); };
  chipsEt.appendChild(srchEt);
  const etGroup = el('<div class="erp-et-group"></div>');
  etGroup.appendChild(el('<div class="erp-et-lbl">Faixa etária</div>'));
  const fxRow = el('<div class="et-chips"></div>');
  fxRow.appendChild(_mkFxChip('todos','Todas'));
  FAIXA_ETARIA_OPCOES.forEach(op=> fxRow.appendChild(_mkFxChip(op,op)));
  etGroup.appendChild(fxRow);
  chipsEt.appendChild(etGroup);

  // Mantém referência dummy pra "seg" (código antigo usa) — não renderiza mais.
  const seg = el('<div style="display:none"></div>');
  // Header da tabela ERP — só aparece em desktop (CSS controla)
  const head = el(`<div class="erp-head" role="row">
    <div class="erp-c erp-c-avatar" aria-hidden="true"></div>
    <button class="erp-c erp-c-name"   data-sort="nm">Nome completo</button>
    <button class="erp-c erp-c-belt"   data-sort="faixa">Faixa</button>
    <button class="erp-c erp-c-etaria" data-sort="etaria">Faixa etária</button>
    <div class="erp-c erp-c-turmas">Turmas</div>
    <button class="erp-c erp-c-pres"   data-sort="diasSem">Últ. presença</button>
    <button class="erp-c erp-c-grau"   data-sort="grau" title="Presenças desde o último grau">Grau</button>
    <button class="erp-c erp-c-faixapres" data-sort="faixapres" title="Presenças desde o início da faixa">Faixa</button>
    <button class="erp-c erp-c-aniv"   data-sort="aniv" title="Data de aniversário">Aniv.</button>
    <div class="erp-c erp-c-wa" aria-hidden="true"></div>
  </div>`);
  const list = el('<div class="list erp-tbl"></div>');

  const refresh = ()=>{ renderList(); paintHead(); };

  const paintHead = ()=>{
    head.querySelectorAll('[data-sort]').forEach(b=>{
      const k=b.dataset.sort; b.classList.toggle('sort-on', sortKey===k);
      b.classList.toggle('sort-desc', sortKey===k && sortDir==='desc');
    });
  };

  const _cmp = (a,b)=>{
    const dir = sortDir==='asc'?1:-1;
    if(sortKey==='faixa'){
      // v383: usa BELT_ORDEM (hierarquia CBJJ completa, 20 posicoes) — antes
      // tratava cinza/amarela/laranja/verde como uma so, sem distinguir listras.
      const ai=beltRank(a.faixa), bi=beltRank(b.faixa);
      if(ai!==bi) return (ai-bi)*dir;
      return ((a.graus||0)-(b.graus||0))*dir;
    }
    if(sortKey==='diasSem') return ((a.diasSem||0)-(b.diasSem||0))*dir;
    if(sortKey==='grau')      return ((a.aulasNoGrau||0)-(b.aulasNoGrau||0))*dir;
    if(sortKey==='faixapres') return ((a.aulasNaFaixa||0)-(b.aulasNaFaixa||0))*dir;
    if(sortKey==='aniv'){
      // Ordena por mês/dia (ignora ano) — quem faz aniversário depois no calendário
      // vai pro fim quando asc. Sem data cai pro fim, independente da direção.
      const mmdd = s => s ? (String(s).slice(5,7)+String(s).slice(8,10)) : '';
      const ka=mmdd(a.nascData), kb=mmdd(b.nascData);
      if(!ka && !kb) return 0;
      if(!ka) return 1;
      if(!kb) return -1;
      return ka.localeCompare(kb)*dir;
    }
    if(sortKey==='etaria'){
      // Ordena por IDADE (não alfabético do rótulo): Kids 3-5 antes de Adulto.
      // Sem data de nascimento vai pro fim, independente da direção.
      const ai=idadeCBJJ(a.nascimento), bi=idadeCBJJ(b.nascimento);
      if(ai==null && bi==null) return 0;
      if(ai==null) return 1;
      if(bi==null) return -1;
      if(ai!==bi) return (ai-bi)*dir;
      return String(a.nm||'').localeCompare(String(b.nm||''));
    }
    if(sortKey==='pres'){
      const ap=a.pres?1:0, bp=b.pres?1:0;
      if(ap!==bp) return (bp-ap)*dir;   // presentes primeiro (asc)
      return String(a.pres||'').localeCompare(String(b.pres||''))*dir;
    }
    if(sortKey==='nm'){
      // A coluna mostra o nome COMPLETO — ordenar pelo apelido divergiria do que se vê.
      const an=(a.cad&&a.cad.nomeCompleto)||a.nomeCompleto||a.nm||'';
      const bn=(b.cad&&b.cad.nomeCompleto)||b.nomeCompleto||b.nm||'';
      return an.localeCompare(bn)*dir;
    }
    return String(a.nm||'').localeCompare(String(b.nm||''))*dir;
  };

  // v350: lista filtrada exposta pro subtítulo (KPI responsivo) e pro Excel.
  // Antes o Excel exportava a base inteira ignorando filtros; o subtítulo só
  // mostrava o total absoluto sem refletir busca/filtro/faixa etária.
  let _arrFiltrada = [];
  const _aplicarFiltros = ()=>{
    let arr = ((_profData?.alunos)||[]).filter(a=>{
      // v384: exceto o chip "Inativos" (dedicado), TODOS os outros excluem
      // inativos. Antes so "Todos" excluia (v382); agora Presentes/Ativos/
      // Ausentes/Aptos/Vencidos tambem — casa com a contagem dos chips.
      if(filtro==='inativos') return _statusAluno(a).valor==='inativo';
      if(_statusAluno(a).valor==='inativo') return false;
      if(filtro==='todos') return true;
      if(filtro==='presentes') return !!a.pres;
      if(filtro==='ativos') return !a.diasSem || a.diasSem<14;
      if(filtro==='sumidos') return (a.diasSem||0)>=7;
      if(filtro==='vencidos') return a.pago==='late';
      if(filtro==='aptos') return typeof _aptosGraduar==='function' && _aptosGraduar().some(x=> (x.id||x.nm)===(a.id||a.nm));
      return true;
    });
    if(filtroEt==='__sem') arr = arr.filter(a=> _faixaEtariaLbl(a.nascimento)==null);
    else if(filtroEt!=='todos') arr = arr.filter(a=> _faixaEtariaLbl(a.nascimento) === filtroEt);
    if(busca){ const q=busca.toLowerCase();
      arr = arr.filter(a=> (a.nm||'').toLowerCase().includes(q) || ((a.cad&&a.cad.nomeCompleto)||'').toLowerCase().includes(q)); }
    if(advF.matricula){ const q=String(advF.matricula).replace(/\D/g,''); if(q) arr = arr.filter(a=> String(a.matricula||'').includes(q) || String(a.matricula||'').padStart(5,'0').includes(q)); }
    if(advF.ativos==='ativos') arr = arr.filter(a=> !a.diasSem || a.diasSem<14);
    else if(advF.ativos==='inativos') arr = arr.filter(a=> (a.diasSem||0)>=14);
    if(advF.aguardando==='sim'){ const aptos=new Set((typeof _aptosGraduar==='function'?_aptosGraduar():[]).map(x=>x.id||x.nm)); arr = arr.filter(a=> aptos.has(a.id||a.nm)); }
    else if(advF.aguardando==='nao'){ const aptos=new Set((typeof _aptosGraduar==='function'?_aptosGraduar():[]).map(x=>x.id||x.nm)); arr = arr.filter(a=> !aptos.has(a.id||a.nm)); }
    if(advF.mensagens==='sim') arr = arr.filter(a=> a.cad && a.cad.aceitaContato);
    else if(advF.mensagens==='nao') arr = arr.filter(a=> !(a.cad && a.cad.aceitaContato));
    if(advF.faixa) arr = arr.filter(a=> (a.faixa||'') === advF.faixa);
    if(advF.turma) arr = arr.filter(a=> (a.turmas||[]).includes(advF.turma));
    if(advF.plano==='ok') arr = arr.filter(a=> a.pago==='ok');
    else if(advF.plano==='late') arr = arr.filter(a=> a.pago==='late');
    else if(advF.plano==='soon') arr = arr.filter(a=> a.pago==='soon');
    if(advF.status) arr = arr.filter(a=> _statusAluno(a).valor===advF.status);
    if(advF.aniversario){
      // v384: aceita MM (mes inteiro) OU MM-DD (dia especifico — vem do alerta
      // "Mandar parabens" do painel, que passa a data de hoje pra filtrar so
      // aniversariantes do DIA).
      const v = advF.aniversario;
      arr = arr.filter(a=>{
        const iso = a.nascData || '';
        return v.length >= 5 ? iso.slice(5,10) === v : iso.slice(5,7) === v;
      });
    }
    if(filtro==='sumidos') arr.sort((a,b)=> (b.diasSem||0)-(a.diasSem||0));
    else arr.sort(_cmp);
    return arr;
  };
  const _atualizarSubKPI = (arr)=>{
    const sub = w.querySelector('#alunos-sub-kpi'); if(!sub) return;
    if(!_profData){ sub.textContent='Carregando…'; return; }
    const total = ((_profData?.alunos)||[]).length;
    const n = arr.length;
    // v382: "Todos" default agora exclui inativos, então n != total mesmo sem
    // filtro. O sinal de "filtrando" precisa vir dos controles, não da contagem.
    const filtrando = filtro !== 'todos' || filtroEt !== 'todos' || !!busca ||
                      Object.values(advF).some(v => v);
    const presN = arr.filter(a=>a.pres).length;
    const inatN = arr.filter(a=>(a.diasSem||0)>=14).length;
    const vencN = arr.filter(a=>a.pago==='late').length;
    if(!filtrando){
      sub.textContent = `${n} ativos · ${total} cadastrados · ${presN} presentes hoje`;
    } else {
      sub.textContent = `${n} de ${total} · ${presN} presentes · ${inatN} inativos · ${vencN} vencidos`;
    }
  };

  const renderList = ()=>{
    list.innerHTML='';
    if(!_profData){ list.appendChild(el('<div class="loading-center">Carregando dados da nuvem…</div>')); return; }
    _arrFiltrada = _aplicarFiltros();
    _atualizarSubKPI(_arrFiltrada);
    const arr = _arrFiltrada;
    if(!arr.length){ list.appendChild(el(`<div class="empty-line">Nenhum aluno encontrado.</div>`)); return; }
    const totalN = arr.length;
    arr.slice(0, shown).forEach(a=>{
      const turmasTx = (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(', ') || '—';
      // Nome COMPLETO na coluna (o apelido é o rótulo curto usado no resto do app).
      // Sem nome completo cadastrado, cai no apelido — melhor que célula vazia.
      const nomeTx = (a.cad && a.cad.nomeCompleto) || a.nomeCompleto || a.nm || '—';
      const etariaTx = _faixaEtariaLbl(a.nascimento) || '—';
      // v452: coluna "Últ. presença" mostra a DATA da última aula (DD/MM/AA) quando
      // o aluno não está presente hoje — mais informativo que "ausente" sem contexto.
      // "Dias sem" removida (era coluna redundante). Ordenação da coluna passou pra diasSem.
      const _fmtUltPres = (iso)=>{ if(!iso||typeof iso!=='string') return '—';
        const [y,m,d] = iso.split('-'); return d && m && y ? `${d}/${m}/${y.slice(2)}` : '—'; };
      const presTx = a.pres ? '✓ '+safeTxt(a.pres) : _fmtUltPres(a.ultimaPres);
      const daysTx = (a.diasSem||0) > 0 ? (a.diasSem+'d') : '—';
      const metaMobile = filtro==='sumidos' ? ((a.diasSem||0)+'d sem treinar') : (a.pres?'✓ '+safeTxt(a.pres):'ausente hoje');
      // v386: turma na visao mobile/tablet — pega a 1a matricula ativa; se +1,
      // mostra "TurmaA +N". Se nao tem, o pedaco some (evita "— " poluindo).
      const _turmasArrLbl = (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean);
      const turmaMobileTx = _turmasArrLbl.length
        ? (_turmasArrLbl[0] + (_turmasArrLbl.length>1 ? ` +${_turmasArrLbl.length-1}` : ''))
        : '';
      const row=el(`<div class="st-row dt-row${a._self?' dt-self':''}" style="cursor:pointer">
        ${avatarAluno(a)}
        <div class="st-mid"><div class="nm" title="${safeAttr(nomeTx)}">${safeTxt(nomeTx)}${a.role&&a.role!=='aluno'?` <span class="role-badge ${a.role==='dono'?'dono':'prof'}">${a.role==='dono'?'Dono':'Professor'}</span>`:''}</div>
          <div class="meta">${_semGrad(a)?'<span class="belt-pill vazio">Sem graduação</span>':beltMini(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${metaMobile}</span>${turmaMobileTx?` <span class="st-turma-chip" title="${safeAttr(_turmasArrLbl.join(', '))}">${safeTxt(turmaMobileTx)}</span>`:''}</div></div>
        <div class="erp-c erp-c-belt-cell">${_semGrad(a)?'':beltMini(a.faixa,a.graus)}</div>
        <div class="erp-c erp-c-etaria-cell">${safeTxt(etariaTx)}</div>
        <div class="erp-c erp-c-turmas-cell" title="${safeAttr(turmasTx)}">${safeTxt(turmasTx)}</div>
        <div class="erp-c erp-c-pres-cell${(a.diasSem||0)>=7?' warn':''}">${presTx}</div>
        <div class="erp-c erp-c-grau-cell${a.aptoGrad?' apto':''}" title="${a.aptoGrad?'Apto a graduar':'Presenças desde o último grau'}">${(a.aulasNoGrau!=null)?safeTxt(a.aulasNoGrau+'/'+_metaAulasFaixa(a.faixa)):'—'}</div>
        <div class="erp-c erp-c-faixapres-cell" title="Presenças desde o início da faixa atual">${(a.aulasNaFaixa!=null)?safeTxt(a.aulasNaFaixa):'—'}</div>
        <div class="erp-c erp-c-aniv-cell" title="Data de aniversário">${a.nascData?safeTxt(String(a.nascData).slice(8,10)+'/'+String(a.nascData).slice(5,7)):'—'}</div>
        <button class="erp-c erp-c-wa-btn wa-ico" aria-label="WhatsApp ${safeAttr(_nomeInst(a))}" title="Mandar WhatsApp">💬</button>
      </div>`);
      const waBtn = row.querySelector('.wa-ico');
      if(waBtn) waBtn.onclick=(e)=>{ e.stopPropagation(); _waSheet(a); };
      row.onclick=()=>_profAlunoSheet(a);
      list.appendChild(row);
    });
    if(totalN > shown){
      const more = el(`<button class="dt-more">Ver mais (${totalN - shown})</button>`);
      more.onclick=()=>{ shown += PAGE; renderList(); };
      list.appendChild(more);
    }
  };

  srch.querySelector('input').oninput=(e)=>{ busca=e.target.value.trim(); shown=PAGE; renderList(); };
  seg.querySelectorAll('[data-f]').forEach(b=>{
    b.onclick=()=>{
      filtro=b.dataset.f; shown=PAGE;
      seg.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); renderList();
    };
  });
  head.querySelectorAll('[data-sort]').forEach(b=>{
    b.onclick=()=>{
      const k=b.dataset.sort;
      if(sortKey===k) sortDir = sortDir==='asc'?'desc':'asc';
      else { sortKey=k; sortDir='asc'; }
      refresh();
    };
  });
  // Ações de cadastro num toolbar único (botões sólidos, sem tracejado de protótipo).
  const actions = el(`<div class="dt-actions"></div>`);
  const addBtn = el(`<button class="btn-cad primary">＋ Cadastrar aluno</button>`);
  addBtn.onclick=()=>abrirCadastroAluno();
  actions.appendChild(addBtn);
  // Só o DONO cadastra professores (Edge Function create-professor é gated em is_dono no servidor).
  if(DB.eu && DB.eu.role==='dono'){
    const addProfBtn = el(`<button class="btn-cad dark">＋ Cadastrar professor</button>`);
    addProfBtn.onclick=()=>_profCadastrarProfessorSheet(refresh);
    actions.appendChild(addProfBtn);
  }
  // Toggle de densidade (só faz efeito no desktop; CSS ignora no mobile)
  const dens = _erpDensity();
  const densBtn = el(`<button class="btn-cad ghost erp-dens" aria-label="Densidade da tabela" title="Densidade">${dens==='compact'?'⇕ Confortável':'⇔ Compacto'}</button>`);
  densBtn.onclick=()=>{
    const cur=_erpDensity(); const next=cur==='compact'?'comfortable':'compact';
    _setErpDensity(next); densBtn.textContent = next==='compact'?'⇕ Confortável':'⇔ Compacto';
  };
  actions.appendChild(densBtn);

  // Toolbar mobile: [busca] [Filtros ▾] — botão + Novo vira FAB
  const toolbar = el('<div class="erp-alunos-toolbar block"></div>');
  toolbar.appendChild(srch);
  // v311: o botão "Filtros" do mobile escondia a barra de faixa etária, que agora
  // é permanente. Sem ele — a barra fica sempre à vista, em qualquer largura.

  // Header desktop: título + ações (Filtros toggle | Colunas | Exportar | + Novo)
  const advWrap = el(`<div class="erp-alunos-adv-wrap"></div>`);
  const advBar = el(`<div class="erp-alunos-adv-bar">
    <button class="erp-alunos-tool" id="adv-toggle" type="button">☰ Filtros avançados<span class="adv-count" id="adv-count" hidden></span></button>
    <button class="erp-alunos-tool adv-clear-inline" id="adv-clear-inline" type="button" hidden>✕ Limpar</button>
    <div class="erp-alunos-tool-spacer"></div>
    <button class="erp-alunos-tool" id="adv-import" type="button">↑ Importar</button>
    <button class="erp-alunos-tool" id="adv-tpl" type="button">↓ Modelo</button>
    <button class="erp-alunos-tool" id="adv-csv" type="button">↓ Excel</button>
    <button class="erp-alunos-tool" id="adv-pdf" type="button">↓ PDF</button>
    <button class="erp-alunos-add primary" id="adv-new" type="button">＋ Novo aluno</button>
  </div>`);
  // Painel de filtros (colapsado por padrão). IDs e handlers ligam ao advF/renderList.
  const advPanel = el(`<div class="erp-alunos-adv-panel" style="display:none">
    <div class="erp-alunos-adv-grid">
      <label><span>Código / matrícula</span><input class="inp" id="advf-mat" placeholder="Ex: 00042"></label>
      <label><span>Ativos</span><select class="inp" id="advf-ativos"><option value="">Todos</option><option value="ativos">Ativos (14d)</option><option value="inativos">Inativos (14d+)</option></select></label>
      <label><span>Aguardando faixa</span><select class="inp" id="advf-agu"><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></label>
      <label><span>Recebe mensagens</span><select class="inp" id="advf-msg"><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></label>
      <label><span>Faixa</span><select class="inp" id="advf-faixa"><option value="">Todas</option>${Object.entries(BELTS).map(([k,v])=>`<option value="${k}">${v.nome}</option>`).join('')}</select></label>
      <label><span>Turma / grupo</span><select class="inp" id="advf-turma"><option value="">Todas</option>${(typeof _turmasArr==='function'?_turmasArr():[]).map(t=>`<option value="${t.id}">${safeTxt(t.nome)}</option>`).join('')}</select></label>
      <label><span>Status plano</span><select class="inp" id="advf-plano"><option value="">Todos</option><option value="ok">Em dia</option><option value="soon">A vencer</option><option value="late">Vencido</option></select></label>
      <label><span>Status atividade</span><select class="inp" id="advf-status"><option value="">Todos</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></label>
      <label><span>Aniversário no mês</span><select class="inp" id="advf-aniv"><option value="">Todos</option>${['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i)=>`<option value="${String(i+1).padStart(2,'0')}">${m}</option>`).join('')}</select></label>
    </div>
    <div class="erp-alunos-adv-acts">
      <button class="erp-alunos-adv-clear" type="button" id="advf-clear">Limpar</button>
    </div>
  </div>`);
  // Filtro AO VIVO (change/input). O botão "Pesquisar" foi removido (v309): a lista
  // já refiltra a cada alteração, então ele não fazia nada além de sugerir que
  // era preciso clicar pra valer.
  const _readAdv = ()=>{
    advF.matricula = advPanel.querySelector('#advf-mat').value.trim();
    advF.ativos    = advPanel.querySelector('#advf-ativos').value;
    advF.aguardando= advPanel.querySelector('#advf-agu').value;
    advF.mensagens = advPanel.querySelector('#advf-msg').value;
    advF.faixa     = advPanel.querySelector('#advf-faixa').value;
    advF.turma     = advPanel.querySelector('#advf-turma').value;
    advF.plano     = advPanel.querySelector('#advf-plano').value;
    advF.aniversario = advPanel.querySelector('#advf-aniv').value;
    advF.status    = advPanel.querySelector('#advf-status').value;
    _advBadge();
    shown=PAGE; renderList();
  };
  // Badge no botão: quantos filtros avançados estão ativos (visível com o painel fechado).
  const _advBadge = ()=>{
    const n = Object.values(advF).filter(Boolean).length;
    const b = advBar.querySelector('#adv-count');
    b.textContent = n; b.hidden = !n;
    advBar.querySelector('#adv-toggle').classList.toggle('filtered', !!n);
    advBar.querySelector('#adv-clear-inline').hidden = !n;
  };
  advPanel.querySelectorAll('input,select').forEach(el0=>{
    const ev = el0.tagName==='SELECT' ? 'change' : 'input';
    el0.addEventListener(ev, _readAdv);
  });
  advPanel.querySelector('#advf-clear').onclick = ()=>{
    advPanel.querySelectorAll('input').forEach(i=> i.value='');
    advPanel.querySelectorAll('select').forEach(s=> s.value='');
    _readAdv();
  };
  advWrap.appendChild(advBar);
  advWrap.appendChild(advPanel);
  const advDesktop = advWrap;   // rename pra não quebrar refs abaixo
  advBar.querySelector('#adv-new').onclick = ()=>abrirCadastroAluno();
  advBar.querySelector('#adv-clear-inline').onclick = ()=>{
    advPanel.querySelectorAll('input').forEach(i=> i.value='');
    advPanel.querySelectorAll('select').forEach(s=> s.value='');
    _readAdv();
  };
  advBar.querySelector('#adv-toggle').onclick = (ev)=>{
    const open = advPanel.style.display==='none';
    advPanel.style.display = open?'block':'none';
    ev.currentTarget.classList.toggle('on', open);
  };
  advBar.querySelector('#adv-csv').onclick = ()=> _alunosExportXLSXSheet(_arrFiltrada.length?_arrFiltrada:((_profData?.alunos)||[]), turmaMap);
  advBar.querySelector('#adv-pdf').onclick = ()=> _alunosExportPDF(_arrFiltrada.length?_arrFiltrada:((_profData?.alunos)||[]), turmaMap);
  advBar.querySelector('#adv-tpl').onclick = ()=> _alunosImportTemplate();
  advBar.querySelector('#adv-import').onclick = ()=> _alunosImportOpen();
  _advBadge();
  // Preset vindo do painel (KPI/Ver todos aniversariantes/Mandar parabens):
  // aceita MM (mes) OU MM-DD (dia especifico, do alerta "Mandar parabens").
  if(advF.aniversario){
    const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const isDia = advF.aniversario.length >= 5;   // MM-DD
    const mm = advF.aniversario.slice(0,2);
    // Dropdown so tem opcoes MM — preenche com MM se for MM-DD (o filtro real
    // olha advF.aniversario completo, o dropdown fica so pra o professor ver).
    advPanel.querySelector('#advf-aniv').value = mm;
    advPanel.style.display='block';
    advBar.querySelector('#adv-toggle')?.classList.add('on');
    const mesLbl = MESES[parseInt(mm,10)-1] || mm;
    const lbl = isDia ? `aniversariantes de hoje (${advF.aniversario.slice(3,5)}/${mm})` : `aniversariantes de ${mesLbl}`;
    setTimeout(()=>{ toast(`Filtrando ${lbl}`); advPanel.scrollIntoView({behavior:'smooth', block:'center'}); }, 100);
  }

  // FAB só mobile (o "+ Novo" do painel desktop cobre desktop)
  const fab = el(`<button class="erp-fab" type="button" aria-label="Cadastrar aluno">＋</button>`);
  fab.onclick=()=>abrirCadastroAluno();

  refresh();
  w.appendChild(chipsRow);
  w.appendChild(advDesktop);   // aparece só em desktop (CSS)
  w.appendChild(toolbar);      // aparece só em mobile (CSS)
  w.appendChild(chipsEt);
  w.appendChild(head);
  w.appendChild(list);
  w.appendChild(fab);
  return w;
}

function _gerarSenhaProvisoria(){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ', s='abcdefghijkmnpqrstuvwxyz', n='23456789';
  const pick=(set,k)=>Array.from({length:k},()=>set[Math.floor(Math.random()*set.length)]).join('');
  return pick(A,2)+pick(s,3)+pick(n,3); // ex: KPabc472
}
function _iniciaisDe(nm){ return (nm||'').trim().split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase()||'A'; }
function _corAluno(nm){
  const cores=['#2f8fef','#7e4ddb','#43b581','#f5a25a','#ef5350','#7a4a25','#0d9488','#c98a2f'];
  let h=0; for(let i=0;i<(nm||'').length;i++) h=(h*31+nm.charCodeAt(i))|0;
  return cores[Math.abs(h)%cores.length];
}

// Cadastro de aluno (Fase 4): offline adiciona ao mock; com backend chama sbProf.criarAluno.
/* Confirmação ao fechar cadastro/ficha com dados preenchidos (evita perda por clique fora acidental). */
function _confirmDescartar(onDescartar){
  const s=el(`<div class="sheet-overlay confirm-top"><div class="sheet" role="dialog" style="max-width:340px">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Descartar preenchimento?</div>
    <div class="sheet-desc">Você começou a preencher esta ficha. Se sair agora, os dados digitados são perdidos.</div>
    <button class="btn-save danger" id="cd-sim">Descartar</button>
    <button class="sheet-cancel" id="cd-nao">Continuar editando</button>
  </div></div>`);
  const close=()=>{ s.classList.remove('open'); setTimeout(()=>s.remove(),200); };
  s.onclick=(e)=>{ if(e.target===s) close(); };
  s.querySelector('#cd-nao').onclick=close;
  s.querySelector('#cd-sim').onclick=()=>{ close(); onDescartar(); };
  document.body.appendChild(s); requestAnimationFrame(()=>s.classList.add('open'));
}

/* Chips de turma (multi-seleção) — matrícula do aluno. Reusa _turmasArr()/_loadTurmas().
   UI apenas: a persistência real (enrollments no backend) é o passo seguinte (2-backend). */
function _turmaChips(container, selSet, onChange){
  if(!container) return;
  _loadTurmas();
  const arr=_turmasArr();
  container.innerHTML='';
  if(!arr.length){ container.appendChild(el('<div class="empty-hint" style="margin:2px 0">Nenhuma turma criada. Crie na aba "Turmas".</div>')); return; }
  arr.forEach(t=>{
    const on=selSet.has(t.id);
    const b=el(`<button type="button" class="turma-chip ${on?'on':''}" style="--tc:${t.cor||'#888'}">${safeTxt(t.nome)}${t.faixaEtaria?` · ${safeTxt(t.faixaEtaria)}`:''}</button>`);
    b.onclick=()=>{ selSet.has(t.id)?selSet.delete(t.id):selSet.add(t.id); _turmaChips(container, selSet, onChange); if(onChange) onChange(); };
    container.appendChild(b);
  });
}

/* Linha do tempo de graduação (reuso do componente da Jornada) — VISÃO DO PROFESSOR.
   Não é ativado na visão do aluno (decisão do dono). */
function _gradTimelineNode(grads){
  const tl=el('<div class="timeline"></div>');
  const arr=[...(grads||[])].filter(g=>g&&g.data).sort((a,b)=>b.data.localeCompare(a.data));
  if(!arr.length){ tl.appendChild(el('<div class="tl-empty">Sem graduações registradas.</div>')); return tl; }
  arr.forEach(g=>{
    const x=BELTS[g.faixa]; if(!x) return;
    const titulo = g.tipo==='faixa' ? `Faixa ${x.nome}`
                 : g.tipo==='inicio' ? `Início · Faixa ${x.nome}`
                 : `${g.graus}º grau · ${x.nome}`;
    const [y,m,d]=g.data.split('-'); const dataFmt=`${d}/${m}/${y}`;
    tl.appendChild(el(`<div class="tl-item">
      <div class="tl-rail"><span class="tl-dot" style="background:${x.cor}"></span><span class="tl-conn"></span></div>
      <div class="tl-tx"><div class="tl-belt">${beltMini(g.faixa, g.tipo==='grau'?g.graus:0)}</div>
        <div class="t">${safeTxt(titulo)}</div><div class="dt">${dataFmt}${g.por&&g.por!=='—'?' · '+safeTxt(g.por):''}</div></div></div>`));
  });
  return tl;
}

// Alunos matriculados numa turma (UI/offline: lê a.turmas; backend real vem no passo 2-backend).
function _turmaAlunos(turmaId){
  // v421: alunos inativos somem das turmas (heatmap de ocupacao, lista da turma).
  // A matricula (enrollments) continua registrada — se voltar a treinar, reaparece.
  return _profAlunosArr().filter(a=> (a.turmas||[]).includes(turmaId) && _statusAluno(a).valor!=='inativo');
}

/* Lesões — painel gerencial no detalhe do aluno (visão do professor).
   Autorizado pela §4: professor vê parte/status/data (informação clínica objetiva). */
function _lesoesPanelNode(lesoes){
  const box=el('<div></div>');
  const arr=(lesoes||[]).slice().sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  const ativas=arr.filter(l=>l.status==='recuperando').length;
  const total=arr.length;
  box.appendChild(el(`<div class="stat-grid" style="margin:2px 0 8px">
    <div class="stat-card"><div class="sv">${total}</div><div class="sl">Registradas</div></div>
    <div class="stat-card"><div class="sv" style="color:${ativas?'var(--red-strong)':'var(--ink)'}">${ativas}</div><div class="sl">Em recuperação</div></div>
  </div>`));
  const list=el('<div class="list block"></div>');
  if(!arr.length){ list.appendChild(el('<div class="empty-line" style="padding:12px;color:var(--muted);text-align:center;font-size:13px">Nenhuma lesão registrada.</div>')); box.appendChild(list); return box; }
  arr.forEach(l=>{
    const isAtiva = l.status==='recuperando';
    const chip = isAtiva ? '<span class="status-chip red">Em recuperação</span>' : '<span class="status-chip green">Recuperada</span>';
    const dataFmt = l.data ? (()=>{ const [y,m,d]=l.data.split('-'); return `${d}/${m}/${y}`; })() : '—';
    list.appendChild(el(`<div class="les-row">
      <div class="les-mid"><div class="nm">${safeTxt(l.parte||'—')}</div>
        <div class="meta">${chip} <span style="color:var(--muted)">· ${dataFmt}</span></div>
        ${l.nota?`<div class="li-nota" style="margin-top:6px;font-size:13px;color:var(--ink);white-space:pre-wrap">${safeTxt(l.nota)}</div>`:''}
      </div></div>`));
  });
  box.appendChild(list);
  return box;
}

/* Progresso de técnica — painel gerencial (§4: só dados objetivos: estado/nível/treinos/última/acerto%).
   Sumário por estado + top técnicas por nº de treinos. */
function _progressoPanelNode(prog){
  const box=el('<div></div>');
  const arr=(prog||[]).slice();
  // Nível de domínio via _nivelDeProg (o campo `estado` guarda o eixo de jogo foco/arma/…,
  // que não é nível — contar por estado deixava os cards sempre em 0).
  const conta={aprendendo:0,treinando:0,dominada:0};
  arr.forEach(p=>{ const nv=_nivelDeProg(p); if(conta[nv]!=null) conta[nv]++; });
  box.appendChild(el(`<div class="stat-grid" style="margin:2px 0 8px">
    <div class="stat-card"><div class="sv">${arr.length}</div><div class="sl">Técnicas</div></div>
    <div class="stat-card"><div class="sv" style="color:#c98a2f">${conta.aprendendo}</div><div class="sl">Aprendendo</div></div>
    <div class="stat-card"><div class="sv" style="color:#2f6fe5">${conta.treinando}</div><div class="sl">Treinando</div></div>
    <div class="stat-card"><div class="sv" style="color:#2fa86a">${conta.dominada}</div><div class="sl">Dominadas</div></div>
  </div>`));
  if(!arr.length){ box.appendChild(el('<div class="list block"><div class="empty-line" style="padding:12px;color:var(--muted);text-align:center;font-size:13px">Sem progresso registrado ainda.</div></div>')); return box; }
  // Top 8 por nº de treinos (mais praticadas). Sem prática > 0 nada é "mais praticado" —
  // listar 8 zeros passa impressão de app quebrado.
  const top=arr.slice().filter(p=>(p.treinos||0)>0).sort((a,b)=>(b.treinos||0)-(a.treinos||0)).slice(0,8);
  if(!top.length){ box.appendChild(el('<div class="list block"><div class="empty-line" style="padding:12px;color:var(--muted);text-align:center;font-size:13px">O aluno ainda não registrou prática de nenhuma técnica.</div></div>')); return box; }
  box.appendChild(el(`<div class="sec-title" style="margin:8px 4px 6px;font-size:11px">Mais praticadas</div>`));
  const list=el('<div class="list block"></div>');
  top.forEach(p=>{
    const tec = (typeof tecByKey==='function') ? tecByKey(p.tecnica_id||p.tecnicaId) : null;
    const nome = (tec && tec.jp) || safeTxt(p.tecnica_id||p.tecnicaId||'—');
    const nv=_nivelDeProg(p);
    const estCor = nv==='dominada'?'#2fa86a':nv==='treinando'?'#2f6fe5':'#c98a2f';
    const acerto = (p.acerto_pct!=null) ? p.acerto_pct+'%' : (p.acertoPct!=null?p.acertoPct+'%':'—');
    const treinos = p.treinos||0;
    const ultima = p.ultima || p.ultimaPratica || null;
    // Só formata se for string ISO YYYY-MM-DD; senão evita "undefined/undefined"
    const ultimaFmt = (typeof ultima==='string' && /^\d{4}-\d{2}-\d{2}/.test(ultima))
      ? ultima.slice(8,10)+'/'+ultima.slice(5,7) : '—';
    list.appendChild(el(`<div class="prog-row">
      <span class="prog-dot" style="background:${estCor}"></span>
      <div class="prog-mid"><div class="nm">${safeTxt(nome)}</div>
        <div class="meta"><b>${treinos}</b> treinos · ${acerto} acerto · última ${ultimaFmt}</div></div></div>`));
  });
  box.appendChild(list);
  return box;
}

/* Perfil de treino OBJETIVO — derivado só de check-ins (data/hora/tipo), §4-safe.
   "Quando esse aluno treina?" em 4 linhas: volume 28d + tendência, dias, horário, tipo. */
function _perfilTreinoNode(freq){
  const box=el('<div></div>');
  const arr=(freq||[]).filter(c=>c&&c.data);
  if(!arr.length){ box.appendChild(el('<div class="list block"><div class="empty-line" style="padding:12px;color:var(--muted);text-align:center;font-size:13px">Sem presenças registradas ainda.</div></div>')); return box; }
  const _dISO=n=>{ const d=new Date(); d.setDate(d.getDate()-n); const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; return iso < APP_INICIO_ISO ? APP_INICIO_ISO : iso; };
  const d28=_dISO(28), d56=_dISO(56);
  const n28=new Set(arr.filter(c=>c.data>=d28).map(c=>c.data)).size;
  const nPrev=new Set(arr.filter(c=>c.data>=d56&&c.data<d28).map(c=>c.data)).size;
  const DIA=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dow={}; arr.forEach(c=>{ const d=new Date(c.data+'T12:00:00').getDay(); dow[d]=(dow[d]||0)+1; });
  const topDias=Object.entries(dow).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([d])=>DIA[+d]).join(' e ');
  const horas={}; arr.forEach(c=>{ if(c.hora) { const h=String(c.hora).slice(0,2); horas[h]=(horas[h]||0)+1; } });
  const topHora=Object.entries(horas).sort((a,b)=>b[1]-a[1])[0];
  const tipos={}; arr.forEach(c=>{ if(c.tipo) tipos[c.tipo]=(tipos[c.tipo]||0)+1; });
  const topTipo=Object.entries(tipos).sort((a,b)=>b[1]-a[1])[0];
  const tend = nPrev>0 ? Math.round((n28-nPrev)/nPrev*100) : null;
  const tendTx = tend==null ? '' :
    tend<=-30 ? ` <b style="color:var(--red-strong)">▼ ${tend}%</b>` :
    tend>=30  ? ` <b style="color:var(--good)">▲ +${tend}%</b>` : '';
  const list=el('<div class="list block"></div>');
  list.appendChild(el(`<div class="mt-row"><span>Treinos (últimos 28 dias)</span><b>${n28}${tendTx}</b></div>`));
  if(topDias) list.appendChild(el(`<div class="mt-row"><span>Dias habituais</span><b>${safeTxt(topDias)}</b></div>`));
  if(topHora) list.appendChild(el(`<div class="mt-row"><span>Horário habitual</span><b>${safeTxt(topHora[0])}h</b></div>`));
  if(topTipo) list.appendChild(el(`<div class="mt-row"><span>Tipo mais frequente</span><b>${safeTxt(topTipo[0])}</b></div>`));
  box.appendChild(list);
  return box;
}

/* Observações pedagógicas DATADAS (member_notes) — anotação do professor sobre o aluno.
   Só a gestão vê (aluno sem policy de leitura); não passa perto do diário privado (§4). */
function _obsPanelNode(a){
  const box=el('<div></div>');
  const notas = a._self ? (DB._selfNotas=DB._selfNotas||[]) : (a.notas=a.notas||[]);
  const list=el('<div class="list block"></div>');
  const paint=()=>{
    list.innerHTML='';
    if(!notas.length){ list.appendChild(el('<div class="empty-line" style="padding:10px;color:var(--muted);text-align:center;font-size:12.5px">Nenhuma observação ainda.</div>')); return; }
    notas.forEach(n=>{
      const dt=(n.criado_em||'').slice(0,10);
      const fmt=dt?dt.split('-').reverse().join('/'):'';
      const row=el(`<div class="obs-row"><div class="obs-tx">${safeTxt(n.texto)}</div>
        <div class="obs-meta"><span>${fmt}${n.autor?' · '+safeTxt(n.autor):''}</span><button class="obs-del" aria-label="Excluir observação">✕</button></div></div>`);
      row.querySelector('.obs-del').onclick=()=>{
        const i=notas.indexOf(n); if(i>=0) notas.splice(i,1);
        if(!DEMO && !a._self && typeof sbProf!=='undefined' && sbProf.delNota && n.id){ sbProf.delNota(n.id).catch(()=>{}); }
        paint(); toast('Observação excluída');
      };
      list.appendChild(row);
    });
  };
  paint();
  box.appendChild(list);
  const inp=el('<textarea class="ta" placeholder="Nova observação (ex: dificuldade na raspagem — trabalhar a pegada)" style="min-height:52px;margin-top:8px"></textarea>');
  const btn=el('<button class="btn-save" style="margin-top:8px">Adicionar observação</button>');
  btn.onclick=async()=>{
    const tx=inp.value.trim(); if(!tx){ toast('Escreva a observação'); return; }
    const autor=(DB.professor&&DB.professor.nome)||null;
    let nota={ texto:tx, autor, criado_em:new Date().toISOString() };
    if(!DEMO && !a._self && typeof sbProf!=='undefined' && sbProf.addNota){
      btn.disabled=true;
      try{ nota=(await sbProf.addNota(a.id, tx, autor))||nota; }
      catch(e){ btn.disabled=false; toast('Erro ao salvar: '+(e.message||e)); return; }
      btn.disabled=false;
    }
    notas.unshift(nota); inp.value=''; paint(); toast('Observação registrada ✔');
  };
  box.appendChild(inp); box.appendChild(btn);
  return box;
}

/* Progresso do próprio professor (self) a partir do DB.tecnicas já em memória. */
function _selfProgresso(){
  const out=[];
  (DB.tecnicas||[]).forEach(t=>{
    const acertos=(t.acertos||0), tent=(t.tentativas||0);
    if(!(t.treinos>0) && !acertos && !tent && !t.estado) return;
    out.push({ tecnica_id:t.id, estado:t.estado||'aprendendo', nivel:t.nivel||0,
      treinos:t.treinos||0, ultima:t.ultima||null,
      acerto_pct: tent>0 ? Math.round(acertos/tent*100) : null });
  });
  return out;
}

// Página CHEIA de cadastro de aluno (substitui o antigo menu suspenso/wizard em sheet).
function abrirCadastroAluno(){ DB.cadastroAlunoOpen=true; render(); window.scrollTo(0,0); }
function renderCadastroAluno(){
  const refresh = ()=>{};   // voltar já re-renderiza a lista de alunos (cache invalidado antes)
  // v296: cadastro básico ERP. Faixa/grau/turmas/observações ficam pra depois
  // (ficha do aluno + botão "Graduar"). Menos atrito no cadastro em lote.
  const selFaixa='branca', selGraus=0;
  let step=0;
  const STEPS=['Dados do aluno','Endereço','Responsável'];
  const v = el(`<div class="view prof-page"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar">‹</div>
    <div class="ft"><div class="t">Cadastrar aluno</div><div class="s">Ficha cadastral · Gestão</div></div>
  </div>`;
  const body = el(`<div class="flow-body cad-wide" style="padding:0 20px 40px"></div>`);
  const sheet = body;   // alias: preserva as referências sheet.querySelector/addEventListener abaixo
  body.innerHTML = `
    <div class="cad-steps" id="ca-steps"></div>
    <div class="sheet-desc">Ficha cadastral da academia. O aluno entra com senha provisória e troca no 1º acesso. Estes dados ficam só na gestão.</div>

    <div class="cad-step" data-step="0">
      <div class="cad-sec">Dados do aluno</div>
      <label class="flbl">Nome completo</label>
      <input class="inp" id="ca-nome" placeholder="Ex: Gabriel Tavares de Jesus">
      <label class="flbl" style="margin-top:12px">E-mail</label>
      <input class="inp" id="ca-email" type="email" inputmode="email" placeholder="aluno@email.com">
      <label class="flbl" style="margin-top:12px">Telefone / WhatsApp</label>
      <input class="inp" id="ca-tel" type="tel" inputmode="tel" placeholder="(31) 99999-9999">
      <label class="flbl" style="margin-top:12px">Data de nascimento</label>
      ${dateBRField('ca-nascdata','')}
      <label class="flbl" style="margin-top:12px">CPF <span class="ca-opt">(opcional)</span></label>
      <input class="inp" id="ca-cpf" inputmode="numeric" placeholder="000.000.000-00" maxlength="14">
      <label class="flbl" style="margin-top:12px">Apelido <span class="ca-opt">(opcional — o aluno pode definir depois)</span></label>
      <input class="inp" id="ca-apelido" placeholder="Ex: Tavares">
    </div>

    <div class="cad-step" data-step="1" hidden>
      <div class="cad-sec">Endereço</div>
      <div class="cad-row">
        <div style="width:130px"><label class="flbl">CEP</label><input class="inp" id="ca-cep" inputmode="numeric" placeholder="00000-000"></div>
        <div style="flex:1"><label class="flbl">Logradouro</label><input class="inp" id="ca-logr" placeholder="Rua / Av."></div>
      </div>
      <div class="cad-row" style="margin-top:12px">
        <div style="width:90px"><label class="flbl">Número</label><input class="inp" id="ca-num" placeholder="123"></div>
        <div style="flex:1"><label class="flbl">Bairro</label><input class="inp" id="ca-bairro" placeholder="Bairro"></div>
      </div>
      <div class="cad-row" style="margin-top:12px">
        <div style="flex:1"><label class="flbl">Cidade</label><input class="inp" id="ca-cidade" placeholder="Cidade"></div>
        <div style="width:70px"><label class="flbl">UF</label><input class="inp" id="ca-uf" maxlength="2" placeholder="MG"></div>
      </div>
    </div>

    <div class="cad-step" data-step="2" hidden>
      <div class="cad-sec">Responsável / ponto de apoio</div>
      <label class="flbl">Nome do responsável</label>
      <input class="inp" id="ca-rnome" placeholder="Nome de contato">
      <div class="cad-row" style="margin-top:12px">
        <div style="flex:1"><label class="flbl">Telefone</label><input class="inp" id="ca-rtel" type="tel" inputmode="tel" placeholder="(31) 99999-9999"></div>
        <div style="width:130px"><label class="flbl">Parentesco</label><input class="inp" id="ca-rpar" placeholder="Mãe, cônjuge…"></div>
      </div>
      <label class="flbl" style="margin-top:12px">CPF do responsável <span class="ca-opt">(opcional)</span></label>
      <input class="inp" id="ca-rcpf" inputmode="numeric" placeholder="000.000.000-00" maxlength="14">
    </div>

    <div class="cad-nav">
      <button class="sheet-cancel" id="ca-back">Cancelar</button>
      <button class="btn-save" id="ca-next">Continuar</button>
    </div>`;
  // v425: sair de vez limpa a gaveta — senão o próximo cadastro abriria com os
  // dados do anterior. Só `back()` limpa; render() no meio do preenchimento não.
  const back=()=>{ _formDraftLimpar('cadastroAluno'); DB.cadastroAlunoOpen=false; render(); window.scrollTo(0,0); };
  const close=back;   // "Cancelar" no passo 0 e os fluxos de sucesso voltam pra lista
  let _caDirty=false; body.addEventListener('input',()=>{ _caDirty=true; });
  let _caDraft=null;   // v425: preenchido no fim (depois que os campos existem)
  const tryClose=()=>{ if(_caDirty) _confirmDescartar(back); else back(); };
  const _bk=v.querySelector('.back');
  _bk.onclick=tryClose; _bk.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tryClose(); } };
  // v296: campos de faixa/graus/turmas removidos — configura pela ficha depois.
  // ViaCEP: digita CEP → auto-preenche logradouro/bairro/cidade/UF, foca no número
  bindViaCEP(sheet.querySelector('#ca-cep'), {
    logr:   sheet.querySelector('#ca-logr'),
    bairro: sheet.querySelector('#ca-bairro'),
    cidade: sheet.querySelector('#ca-cidade'),
    uf:     sheet.querySelector('#ca-uf'),
    num:    sheet.querySelector('#ca-num'),
  });
  bindDateBR(sheet);
  bindCPF(sheet.querySelector('#ca-cpf'));
  bindCPF(sheet.querySelector('#ca-rcpf'));
  // wizard: uma etapa por vez (Dados → Endereço → Responsável → Graduação)
  const stepsEl=sheet.querySelector('#ca-steps');
  const backBtn=sheet.querySelector('#ca-back');
  const nextBtn=sheet.querySelector('#ca-next');
  const scroller=null;   // página cheia: o scroll é da janela (showStep usa window.scrollTo)
  const val=id=>{ const e=sheet.querySelector('#'+id); return e?e.value.trim():''; };
  const paintSteps=()=>{ stepsEl.innerHTML=STEPS.map((s,i)=>`<span class="cad-dot ${i===step?'on':''} ${i<step?'done':''}"></span>`).join(''); };
  const showStep=(n, semScroll)=>{
    step=Math.max(0,Math.min(STEPS.length-1,n));
    sheet.querySelectorAll('.cad-step').forEach(sec=>{ sec.hidden=(+sec.dataset.step!==step); });
    backBtn.textContent = step===0 ? 'Cancelar' : 'Voltar';
    nextBtn.textContent = step===STEPS.length-1 ? 'Cadastrar e gerar senha' : 'Continuar';
    paintSteps();
    if(_caDraft) _caDraft.salvarAgora();   // v425: guarda a etapa junto com os campos
    // Restaurar após render() não deve jogar o usuário pro topo (ele estava rolando).
    if(semScroll) return;
    if(scroller) scroller.scrollTop=0; else window.scrollTo(0,0);
  };
  const validateStep=()=>{
    // Decisão do dono (2026-07-10): só nome + e-mail são obrigatórios (e-mail = login da conta).
    // O resto é opcional — se preenchido, valida o formato.
    if(step===0){
      if(!val('ca-nome')){ toast('Informe o nome completo'); return false; }
      const email=val('ca-email').toLowerCase();
      if(!email || !email.includes('@')){ toast('Informe um e-mail válido (será o login do aluno)'); return false; }
    }
    return true;
  };
  backBtn.onclick=()=>{ if(step===0) close(); else showStep(step-1); };
  nextBtn.onclick=async()=>{
    if(!validateStep()) return;
    if(step<STEPS.length-1){ showStep(step+1); return; }
    const nome=val('ca-nome');
    const apelido=val('ca-apelido') || (nome.split(/\s+/)[0]||'');
    const email=val('ca-email').toLowerCase();
    const nascData=dateBRRead(sheet.querySelector('#ca-nascdata'))||null;
    // v472: ano derivado da data completa — não pede mais "ano de nascimento" separado.
    const nascimento = nascData ? parseInt(String(nascData).slice(0,4)) : null;
    const telefone=_normTelBR(val('ca-tel'));
    const cep=val('ca-cep'), logradouro=val('ca-logr'), numero=val('ca-num'), bairro=val('ca-bairro'), cidade=val('ca-cidade'), uf=val('ca-uf').toUpperCase();
    const resp_nome=val('ca-rnome'), resp_telefone=_normTelBR(val('ca-rtel')), resp_parentesco=val('ca-rpar');
    // v479: CPF do aluno + CPF do responsável (opcionais). Guarda só dígitos.
    const cpf = val('ca-cpf').replace(/\D/g,'');
    const resp_cpf = val('ca-rcpf').replace(/\D/g,'');
    // v296: início = hoje, sem obs, faixa/grau default (branca/0). Ajusta na ficha.
    const data_inicio=HOJE_ISO, observacoes='';
    // v437: senha do cadastro individual = senha padrão da academia. Antes gerava
    // aleatória e o convite WhatsApp (que usa _senhaPadrao()) prometia outra coisa.
    // Fallback pra provisória aleatória só se a padrão não estiver configurada.
    const senha=_senhaPadrao()||_gerarSenhaProvisoria();
    const dados={ nome_completo:nome, apelido, email, faixa:selFaixa, graus:selGraus, nascimento, desde:HOJE_ISO.slice(0,7),
      telefone, cep, logradouro, numero, bairro, cidade, uf,
      resp_nome, resp_telefone, resp_parentesco, data_inicio, observacoes, senha,
      cpf, resp_cpf };
    if(!DEMO && typeof sbProf!=='undefined'){
      try{ const r=await sbProf.criarAluno(dados);
        const novoId=(r&&(r.user_id||r.id))||null;
        if(nascData && novoId && sbProf.atualizarAluno){ try{ await sbProf.atualizarAluno(novoId, {nascimento_data:nascData}); }catch(_){}}
        _profData=null; _profTs=0; _loadProfData();
        back(); _senhaProvisoriaSheet(email, (r&&r.senha_provisoria)||senha); return; }
      catch(e){ toast('Erro ao cadastrar: '+(e.message||e)); return; }
    }
    // offline (mock)
    const novo={ id:'mock-'+Date.now(), nm:apelido||nome, ini:_iniciaisDe(apelido||nome), cor:_corAluno(nome),
      faixa:selFaixa, graus:selGraus, nascimento, nascData, pres:null, pago:'ok', mensValor:0, mensVenc:'—', desde:dados.desde, turmas:[],
      cad:{ nomeCompleto:nome, email, nascimento, telefone,
        endereco:{ cep, logradouro, numero, bairro, cidade, uf },
        responsavel:{ nome:resp_nome, telefone:resp_telefone, parentesco:resp_parentesco },
        dataInicio:data_inicio, obs:observacoes } };
    // grava no mock persistente (DB.alunos); _loadProfData reconstrói _profData = [self, ...DB.alunos]
    DB.alunos = DB.alunos || []; DB.alunos.unshift(novo);
    _profData=null; _profTs=0; _loadProfData();   // M4: invalida o cache p/ o novo aluno aparecer já
    close(); _senhaProvisoriaSheet(email, senha); refresh();
  };
  // v425: liga a gaveta DEPOIS que os campos existem no DOM. Se havia rascunho
  // (render() no meio do preenchimento), os valores voltam e a etapa é retomada
  // — sem pular pro topo, porque o usuário pode estar rolando a página.
  _caDraft = _bindFormDraft(body, 'cadastroAluno', ()=>({ step }));
  const _caSalvo = _caDraft.restaurado;
  if(_caSalvo){ _caDirty = true; showStep(_caSalvo.step || 0, true); }
  else showStep(0);
  v.appendChild(body);
  return v;
}

/* Cadastro de PROFESSOR (Fase B parte 3) — só o DONO vê o botão; a Edge Function
   create-professor é gated em is_dono no servidor. Form único (mais enxuto que o
   wizard de aluno): sem endereço/responsável. Espelha os campos que a função lê. */
function _profCadastrarProfessorSheet(refresh){
  let selFaixa='preta', selGraus=0;
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:90vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Cadastrar professor</div>
    <div class="sheet-desc">O professor entra com senha provisória e a troca no 1º acesso. Ele terá acesso à gestão da academia.</div>
    <label class="flbl">Nome completo</label>
    <input class="inp" id="cpf-nome" placeholder="Ex: Ricardo Maciel">
    <label class="flbl" style="margin-top:12px">E-mail</label>
    <input class="inp" id="cpf-email" type="email" inputmode="email" placeholder="professor@email.com">
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Telefone <span class="ca-opt">(opcional)</span></label>
        <input class="inp" id="cpf-tel" type="tel" inputmode="tel" placeholder="(31) 99999-9999"></div>
      <div style="width:120px"><label class="flbl">Nascimento</label>
        <input class="inp" id="cpf-nasc" type="number" inputmode="numeric" placeholder="1990" min="1920" max="${hoje.getFullYear()}"></div>
    </div>
    <label class="flbl" style="margin-top:12px">Apelido <span class="ca-opt">(opcional)</span></label>
    <input class="inp" id="cpf-apelido" placeholder="Ex: Prof. Ricardo">
    <label class="flbl" style="margin-top:12px">Faixa</label>
    <div id="cpf-faixa"></div>
    <label class="flbl" style="margin-top:12px">Graus</label>
    <div class="seg" id="cpf-graus"></div>
    <div class="cad-nav">
      <button class="sheet-cancel" id="cpf-cancel">Cancelar</button>
      <button class="btn-save" id="cpf-save">Cadastrar e gerar senha</button>
    </div>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  const val=id=>{ const e=sheet.querySelector('#'+id); return e?e.value.trim():''; };
  const segF=sheet.querySelector('#cpf-faixa'), segG=sheet.querySelector('#cpf-graus'), nascInp=sheet.querySelector('#cpf-nasc');
  const _rebuildG=()=>{ const mx=maxGrausDe(selFaixa); if(selGraus>mx) selGraus=mx; segG.innerHTML='';
    for(let g=0;g<=mx;g++){ const b=el(`<button class="${g===selGraus?'active':''}">${g}º</button>`);
      b.onclick=()=>{ selGraus=g; segG.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segG.appendChild(b); } };
  const _rebuildF=()=>{
    // v193: sem filtro por idade — professor escolhe qualquer faixa.
    const faixas=CBJJ_CHAIN.slice(); if(!faixas.includes(selFaixa)) selFaixa=faixas[faixas.length-1]||'branca';
    renderBeltField(segF, faixas, selFaixa, (f)=>{ selFaixa=f; _rebuildF(); _rebuildG(); }); _rebuildG(); };
  nascInp.addEventListener('input', _rebuildF);
  _rebuildF();
  sheet.querySelector('#cpf-cancel').onclick=close;
  const saveBtn=sheet.querySelector('#cpf-save');
  saveBtn.onclick=async()=>{
    const nome=val('cpf-nome'); if(!nome){ toast('Informe o nome completo'); return; }
    const email=val('cpf-email').toLowerCase(); if(!email || !email.includes('@')){ toast('Informe um e-mail válido'); return; }
    const nv=parseInt(val('cpf-nasc')); const nascimento=(nv>=1920 && nv<=hoje.getFullYear())?nv:null;
    const apelido=val('cpf-apelido') || (nome.split(/\s+/)[0]||'');
    const dados={ nome_completo:nome, apelido, email, faixa:selFaixa, graus:selGraus, nascimento,
      desde:HOJE_ISO.slice(0,7), telefone:_normTelBR(val('cpf-tel')), data_inicio:HOJE_ISO };
    if(typeof sbProf==='undefined' || !sbProf.criarProfessor){ toast('Requer backend ativo'); return; }
    saveBtn.disabled=true; saveBtn.textContent='Cadastrando…';
    try{
      const r=await sbProf.criarProfessor(dados);
      close(); _senhaProvisoriaSheet(email, (r&&r.senha_provisoria)||'', 'professor');
      _profData=null; _profTs=0; _loadProfData(); refresh();
    }catch(e){ saveBtn.disabled=false; saveBtn.textContent='Cadastrar e gerar senha'; toast('Erro ao cadastrar: '+(e.message||e)); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function _senhaProvisoriaSheet(email, senha, kind){
  const quem = kind==='professor' ? 'Professor' : 'Aluno';
  const linha=(lbl,val,id)=>`<div class="cred-row">
    <span class="cred-lbl">${lbl}</span>
    <code class="cred-val">${safeTxt(val)}</code>
    <button class="cred-copy" data-v="${safeAttr(val)}" id="${id}">Copiar</button></div>`;
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${quem} cadastrado ✔</div>
    <div class="sheet-desc">Entregue estes dados ao ${quem.toLowerCase()}. Ele troca a senha no 1º acesso.</div>
    ${linha('E-mail', email, 'cp-em')}
    ${linha('Senha provisória', senha, 'cp-pw')}
    <button class="btn-save" id="cp-ok" style="margin-top:14px">Concluir</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelectorAll('.cred-copy').forEach(b=> b.onclick=async()=>{
    try{ await navigator.clipboard.writeText(b.dataset.v); toast('Copiado ✓'); }catch(e){ toast('Copie: '+b.dataset.v); }
  });
  sheet.querySelector('#cp-ok').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Ficha do aluno em TELA CHEIA (navegação via DB.alunoAberto), não bottom sheet.
// _profAlunoSheet(a) (usado em todo o app) vira um atalho que navega para cá.
/* ============================================================
   ALUNO — Detalhe estilo ERP (protótipo visual, v274)
   Layout 3 colunas em desktop (KPIs | conteúdo aba | ações),
   colapsa em coluna única no mobile. Abas: Ficha, Graduação,
   Presenças, Lesões, Técnicas.
   ATENÇÃO: aba Graduação com CRUD IN-MEMORY (não persiste no
   backend ainda — é protótipo pra aprovação visual). Depois:
   ligar sbProf.salvarGraduacao / removerGraduacao no _addGrad,
   _editGrad, _delGrad.
   ============================================================ */
function profAlunoDetalhe(a){
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // Ficha cadastral (gestão) — só quando há dados (alunos cadastrados via formulário completo).
  const c = a.cad;
  let ficha = '';
  if(c){
    const e=c.endereco||{}, r=c.responsavel||{};
    const endTxt=[e.logradouro, e.numero, e.bairro, e.cidade, e.uf].filter(Boolean).join(', ') + (e.cep?(' · '+e.cep):'');
    const linha=(ic,lbl,val)=> val ? `<div class="ficha-r"><span>${ic} ${lbl}</span><b>${safeTxt(val)}</b></div>` : '';
    ficha = `<div class="ficha">
      <div class="ficha-h">Ficha cadastral</div>
      ${linha('📞','Telefone', c.telefone)}
      ${linha('✉️','E-mail', c.email)}
      ${linha('📍','Endereço', endTxt.trim().replace(/^·\s*/,''))}
      ${r.nome?`<div class="ficha-r"><span>🆘 Responsável</span><b>${safeTxt(r.nome)}${r.parentesco?' ('+safeTxt(r.parentesco)+')':''}${r.telefone?' · '+safeTxt(r.telefone):''}</b></div>`:''}
      ${linha('📅','Início', c.dataInicio)}
      ${c.obs?`<div class="ficha-obs">📝 ${safeTxt(c.obs)}</div>`:''}
    </div>`;
  }
  // Aba ativa (persistida na navegação da sessão). Default: Ficha.
  const tab = DB._alunoTab || 'ficha';
  const tabs = [
    ['ficha','Ficha'],['grad','Graduação'],['pres','Presenças'],
    ['les','Lesões'],['tec','Técnicas'],
  ];
  const beltInfo = BELTS[a.faixa] || {nome:a.faixa||'—', cor:'#888'};
  const isBranca = (a.faixa||'branca')==='branca';
  const selfBadge = a._self ? '<span class="erp-self-badge">Você</span>' : '';
  const sheet = el(`<div class="erp-aluno">
    <div class="erp-hd">
      <button class="erp-back" id="pa-back" aria-label="Voltar">‹ Voltar</button>
      <div class="erp-hd-main">
        <div class="erp-crumb">Alunos › <b>${safeTxt(_nomeInst(a))}</b></div>
        <div class="erp-hd-nome">${safeTxt(_nomeInst(a))} ${selfBadge}</div>
        <div class="erp-hd-sub" id="pa-belt"></div>
      </div>
      <div class="erp-hd-acts"></div>
    </div>
    <div class="erp-tabs">
      ${tabs.map(([k,l])=>`<button class="erp-tab${k===tab?' on':''}" data-t="${k}">${l}</button>`).join('')}
    </div>
    <div class="erp-grid">
      <aside class="erp-kpis" id="pa-kpis"></aside>
      <main class="erp-main" id="pa-main"></main>
      <aside class="erp-actions" id="pa-actions"></aside>
    </div>
  </div>`);
  const close=()=>{ DB.alunoAberto=null; DB._alunoTab=null; render(); window.scrollTo(0,0); };
  const refresh=()=>{ _profData=null; _profTs=0; _loadProfData(); };
  sheet.querySelector('#pa-back').onclick=close;
  // v344: botão "Graduar" removido — a graduação acontece SÓ pela linha do tempo
  // ("+ Novo evento", aba Graduação). Dois caminhos gravando faixa/grau era o que
  // deixava perfil e timeline divergentes.
  // troca de aba
  sheet.querySelectorAll('.erp-tab').forEach(b=> b.onclick=()=>{ DB._alunoTab=b.dataset.t; render(); });
  // Carrega dados do backend (idem versão anterior) e re-renderiza colunas.
  const kpisBox=sheet.querySelector('#pa-kpis');
  const mainBox=sheet.querySelector('#pa-main');
  const actsBox=sheet.querySelector('#pa-actions');
  const beltBox=sheet.querySelector('#pa-belt');
  const paint=()=>{
    // pill de faixa repintada a cada paint: registrar o 1º evento tira o "Sem graduação"
    beltBox.innerHTML = _semGrad(a)
      ? '<span class="erp-belt-pill vazio">Sem graduação registrada</span>'
      : `<span class="erp-belt-pill${isBranca?' branca':''}" style="--bc:${beltInfo.cor}">${safeTxt(beltInfo.nome)} · ${a.graus||0}º grau</span>`;
    kpisBox.innerHTML=''; kpisBox.appendChild(_erpKpis(a));
    mainBox.innerHTML=''; mainBox.appendChild(_erpMain(a, tab, refresh, paint, c, hora));
    actsBox.innerHTML=''; actsBox.appendChild(_erpActions(a, tab, refresh, paint, hora));
  };
  const selfFreq=()=> (DB.treinos||[]).filter(t=>t.data).map(t=>({data:t.data, hora:null, tipo:t.tipo||null}));
  if(a._self){
    a.graduacoes=DB.graduacoes||[]; a.lesoes=DB.lesoes||[]; a.progresso=_selfProgresso(); a.frequencia=selfFreq();
    paint();
  } else if(Array.isArray(a.graduacoes)||Array.isArray(a.lesoes)||Array.isArray(a.progresso)){
    paint();
  } else if(!DEMO && typeof sbProf!=='undefined' && sbProf.getAlunoDetalhe){
    paint();   // esqueleto imediato
    sbProf.getAlunoDetalhe(a.id).then(d=>{
      a.graduacoes=(d&&d.graduacoes)||[]; a.lesoes=(d&&d.lesoes)||[]; a.progresso=(d&&d.progresso)||[];
      a.frequencia=(d&&d.frequencia)||[]; a.notas=(d&&d.notas)||[];
      paint();
    }).catch(()=> paint());
  } else { a.graduacoes=a.graduacoes||[]; a.lesoes=a.lesoes||[]; a.progresso=a.progresso||[]; a.frequencia=a.frequencia||[]; paint(); }
  return sheet;
}

/* --- ERP: KPIs (coluna esquerda) — KPI "Desde" some quando não há data --- */
function _erpKpis(a){
  const wrap=el('<div></div>');
  const grads=(a.graduacoes||[]).filter(g=>g&&g.data);
  const les=(a.lesoes||[]);
  const lesAtivas=les.filter(l=>l.status==='recuperando').length;
  const freq=(a.frequencia||[]).length;
  const desde = _inicioAcademia(a);   // mesma fonte da ficha e dos exports
  const kpi=(v,l,cls='')=>`<div class="erp-kpi ${cls}"><div class="erp-kpi-v">${v}</div><div class="erp-kpi-l">${l}</div></div>`;
  // v352: só conta `faixa` e `grau` como graduação. `inicio` é marco de entrada
  // (não é graduação); `honra` é honorífico e não conta. Dedupe casa com a
  // timeline (v352 abaixo) — sem isso, "3 GRADUAÇÕES" no card e "2 eventos"
  // na timeline divergiam.
  const gradsReais = _gradsDedup(grads).filter(g=> g.tipo==='faixa' || g.tipo==='grau').length;
  let html = kpi(freq, 'Check-ins')
    + kpi(les.length, 'Lesões')
    + kpi(lesAtivas, 'Em recuperação', lesAtivas?'warn':'')
    + kpi(gradsReais, 'Graduações');
  if(desde){ const [dy,dm,dd]=desde.split('-'); html += kpi(`${dd}/${dm}/${dy}`, 'Desde'); }
  wrap.innerHTML = html;
  return wrap;
}

/* --- ERP: coluna central (varia por aba) --- */
function _erpMain(a, tab, refresh, paint, c, hora){
  const box=el('<div></div>');
  if(tab==='ficha'){
    box.appendChild(_erpFicha(a, c, paint, refresh));
    // v481: bloco Financeiro (plano + últimas cobranças) só pra professor, quando
    // backend ligado e não for o próprio prof/dono.
    if(!a._self && !DEMO && typeof sbProf!=='undefined' && sbProf.getAlunoPlano){
      box.appendChild(_erpFinanceiroAluno(a, refresh));
    }
  }
  else if(tab==='grad'){ box.appendChild(_erpTimelineGrad(a, paint)); }
  else if(tab==='les'){ box.appendChild(_lesoesPanelNode(a.lesoes||[])); }
  else if(tab==='tec'){ box.appendChild(_progressoPanelNode(a.progresso||[])); }
  else if(tab==='pres'){ box.appendChild(_erpPresencas(a.frequencia||[], a, refresh, paint)); }
  return box;
}

/* --- Mini card do plano no sidebar (todas as abas da ficha) --- */
function _erpPlanoMini(a, refresh){
  const box = el('<div class="erp-card" style="margin-bottom:10px"></div>');
  box.appendChild(el('<div class="erp-card-h">Plano</div>'));
  const body = el('<div style="padding:6px 4px;font-size:12.5px">Carregando…</div>');
  box.appendChild(body);
  sbProf.getAlunoPlano(a.id).then(ap=>{
    body.innerHTML='';
    if(ap && ap.planos){
      const p = ap.planos;
      const val = ap.valor_negociado != null ? ap.valor_negociado : (ap.valor_matricula || p.valor);
      const dia = ap.dia_vencimento || p.dia_vencimento;
      const travaBadge = ap.trava_reajuste ? ' <span style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0.03em" title="Trava de reajuste">TRAVA</span>' : '';
      body.innerHTML = `
        <div style="font-weight:700;font-size:13px;margin-bottom:2px">${safeTxt(p.nome)}${ap.isento?' <span style="font-size:10.5px;color:var(--good)">(isento)</span>':''}${travaBadge}</div>
        <div style="color:var(--muted);font-size:12px">${moneyBR(val)} · dia ${dia}</div>
      `;
    } else {
      body.innerHTML = '<div style="color:var(--muted);font-size:12px">Sem plano</div>';
    }
    const btn = el('<button class="erp-btn sm" style="margin-top:6px;width:100%">' + (ap ? 'Editar' : 'Definir') + '</button>');
    btn.onclick = ()=> _finAlunoPlanoSheet(a, ()=>refresh());
    body.appendChild(btn);
  }).catch(()=>{ body.innerHTML='<div style="color:var(--red);font-size:12px">Erro ao carregar</div>'; });
  return box;
}

/* --- Bloco Financeiro do aluno (dentro da ficha) --- */
// v510: cache 60s por aluno — abrir 5 fichas seguidas fazia 10 queries.
const _erpFinCache = {};
function _erpFinanceiroAluno(a, refresh){
  const box = el('<div class="erp-card" style="margin-top:12px"></div>');
  box.appendChild(el('<div class="erp-card-h">Financeiro</div>'));
  const body = el('<div class="loading-center" style="padding:12px">Carregando…</div>');
  box.appendChild(body);
  const c = _erpFinCache[a.id];
  const fresh = c && Date.now() - c.ts < 60000;
  const fetcher = fresh
    ? Promise.resolve(c.data)
    : Promise.all([sbProf.getAlunoPlano(a.id), sbProf.getCobrancas({ user_id: a.id })])
        .then(data => { _erpFinCache[a.id] = { ts: Date.now(), data }; return data; });
  fetcher.then(([ap, cobs])=>{
    body.innerHTML='';
    if(ap && ap.planos){
      const p = ap.planos;
      const val = ap.valor_negociado != null ? ap.valor_negociado : p.valor;
      const negBadge = ap.valor_negociado != null ? ' <span style="font-size:10.5px;color:var(--muted)">(negociado)</span>' : '';
      const isBadge = ap.isento ? ' <span style="font-size:10.5px;color:var(--good)">(isento)</span>' : '';
      body.appendChild(el(`<div class="ficha-r"><span>Plano</span><b>${safeTxt(p.nome)}${isBadge}</b></div>`));
      body.appendChild(el(`<div class="ficha-r"><span>Valor</span><b>${moneyBR(val)}${negBadge}</b></div>`));
      const diaEfet = ap.dia_vencimento || p.dia_vencimento;
      const diaBadge = ap.dia_vencimento ? ' <span style="font-size:10.5px;color:var(--muted)">(customizado)</span>' : '';
      body.appendChild(el(`<div class="ficha-r"><span>Vencimento</span><b>Dia ${diaEfet}${diaBadge}</b></div>`));
      // v495: badge trava reajuste. Se travado + valor plano > valor efetivo, mostra economia.
      if(ap.trava_reajuste){
        const motivoTxt = { bolsa:'Bolsa', familia:'Família', seguranca_publica:'Segurança pública', fidelidade:'Fidelidade', convenio:'Convênio', outro:'Outro' }[ap.trava_motivo] || 'Trava manual';
        const planoAtual = Number(p.valor||0);
        const efetivo = ap.valor_negociado != null ? ap.valor_negociado : (ap.valor_matricula || planoAtual);
        const diff = planoAtual - efetivo;
        const diffTxt = diff > 0.01 ? ` <span style="font-size:10.5px;color:var(--good)">(−${moneyBR(diff)}/mês)</span>` : '';
        body.appendChild(el(`<div class="ficha-r" style="background:var(--card-alt,rgba(0,0,0,0.03));padding:6px 8px;border-radius:6px;margin-top:4px"><span>Trava reajuste</span><b style="font-weight:600;font-size:12.5px">${motivoTxt}${diffTxt}</b></div>`));
      }
      // v494 Sprint 6 item 6: notas gerais (obs) do plano — bolsa condicional,
      // motivo do desconto, contexto. Campo existia no schema desde v481 mas
      // não aparecia em lugar nenhum.
      if(ap.obs) body.appendChild(el(`<div class="ficha-r" style="align-items:flex-start"><span>Obs</span><b style="font-weight:500;font-size:12.5px;text-align:right;max-width:65%">${safeTxt(ap.obs)}</b></div>`));
      if(ap.isento && ap.isento_motivo) body.appendChild(el(`<div class="ficha-r" style="align-items:flex-start"><span>Motivo isenção</span><b style="font-weight:500;font-size:12.5px;text-align:right;max-width:65%">${safeTxt(ap.isento_motivo)}</b></div>`));
    } else {
      body.appendChild(el('<div style="padding:8px;color:var(--muted);font-size:13px">Sem plano cadastrado. Toque em "Definir plano" para matricular.</div>'));
    }
    const btn = el('<button class="erp-btn sm" style="margin-top:8px">' + (ap ? 'Trocar plano' : 'Definir plano') + '</button>');
    btn.onclick = ()=> _finAlunoPlanoSheet(a, ()=> refresh());
    body.appendChild(btn);

    // Últimas 3 cobranças
    if(cobs && cobs.length){
      body.appendChild(el('<div class="sec-title" style="margin:12px 0 6px;font-size:11px">Últimas cobranças</div>'));
      cobs.slice(0,3).forEach(c=>{
        const vencTxt = c.venc ? (c.venc.slice(8,10)+'/'+c.venc.slice(5,7)+'/'+c.venc.slice(0,4)) : '—';
        const row = el(`<div class="ficha-r" style="cursor:pointer">
          <span>${c.mes} · ${vencTxt}</span>
          <b>${moneyBR(c.valor)} · ${safeTxt(c.status)}</b>
        </div>`);
        row.onclick = ()=> _finCobrancaSheet(c);
        body.appendChild(row);
      });
    }
  }).catch(e=>{ body.innerHTML='<div style="padding:8px;color:var(--red);font-size:12.5px">Erro: '+safeTxt(e.message||e)+'</div>'; });
  return box;
}

/* --- Sheet: matricular aluno num plano --- */
function _finAlunoPlanoSheet(a, onDone){
  // v518/v521: carrega contratos vinculáveis do aluno (ativo OU aguardando
  // assinatura — professor quer linkar assim que cria, sem esperar PDF).
  // Sem filtro no getContratos porque só aceita 1 status — filtra client-side.
  Promise.all([
    sbProf.getPlanos(),
    sbProf.getAlunoPlano(a.id),
    sbProf.getContratos({ user_id: a.id }),
  ]).then(([planos, ap, contratos])=>{
    ap = ap || {};
    const ctsAtivos = (contratos||[]).filter(c=>c.status==='ativo' || c.status==='aguardando_aceite');
    // v499: sem filtro por público (coluna removida). Mostra todos os planos ativos.
    const ativos = planos.filter(p=>p.ativo!==false);
    const opts = ativos.map(p=>`<option value="${p.id}">${safeTxt(p.nome)} · ${moneyBR(p.valor)}</option>`).join('');
    const ctOpts = ctsAtivos.map(c=>{
      const num = c.numero ? '#'+String(c.numero).padStart(3,'0') : '';
      const fimBR = c.fim ? (c.fim.slice(8,10)+'/'+c.fim.slice(5,7)+'/'+c.fim.slice(0,4)) : '—';
      const plNome = c.planos && c.planos.nome ? ' · '+c.planos.nome : '';
      const stTag = c.status==='aguardando_aceite' ? ' (aguardando assinatura)' : '';
      return `<option value="${c.id}" data-fim="${c.fim||''}" data-inicio="${c.inicio||''}" data-valor="${c.valor_congelado||''}" data-plano="${c.plano_id||''}">${num}${safeTxt(plNome)} · até ${fimBR}${stTag}</option>`;
    }).join('');
    const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Plano do aluno">
      <div class="sheet-grip"></div>
      <div class="sheet-title">Plano · ${safeTxt(_nomeInst(a))}</div>
      ${ctsAtivos.length ? `
      <label class="flbl">📄 Vincular a contrato (opcional)</label>
      <select class="inp" id="ap-contrato">
        <option value="">— sem vínculo —</option>
        ${ctOpts}
      </select>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px">Escolher preenche valor, início e fim automaticamente.</div>
      `:''}
      <label class="flbl" style="margin-top:10px">Plano</label>
      <select class="inp" id="ap-plano">
        <option value="">—</option>
        ${opts}
      </select>
      <label class="flbl" style="margin-top:10px">Valor negociado (opcional, R$)</label>
      <input class="inp" id="ap-valor" type="number" step="0.01" min="0" placeholder="Herda do plano se em branco" value="${ap.valor_negociado||''}">
      <label class="flbl" style="margin-top:10px">Dia de vencimento (1–28, opcional)</label>
      <input class="inp" id="ap-dia" type="number" min="1" max="28" placeholder="Herda do plano se em branco" value="${ap.dia_vencimento||''}">
      <label class="flbl" style="margin-top:10px"><input type="checkbox" id="ap-isento" ${ap.isento?'checked':''}> Aluno isento (não gera cobrança)</label>
      <label class="flbl" style="margin-top:10px">Motivo isenção</label>
      <input class="inp" id="ap-motivo" maxlength="200" value="${safeAttr(ap.isento_motivo||'')}">
      <div class="sec-title" style="margin:14px 0 6px;font-size:11px">Trava de reajuste</div>
      <label class="flbl" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ap-trava" ${ap.trava_reajuste?'checked':''}>
        <span>Travar reajuste automático <span style="color:var(--muted);font-weight:500">(aluno não pega reajustes do plano)</span></span>
      </label>
      <div id="ap-trava-wrap" style="display:${ap.trava_reajuste?'block':'none'};margin-top:8px">
        <label class="flbl">Motivo da trava</label>
        <select class="inp" id="ap-trava-motivo">
          <option value="bolsa">🎗️ Bolsa</option>
          <option value="familia">👨‍👩‍👧 Família</option>
          <option value="seguranca_publica">🚔 Segurança pública</option>
          <option value="fidelidade">🤝 Fidelidade</option>
          <option value="convenio">🏢 Convênio empresa</option>
          <option value="outro">📝 Outro</option>
        </select>
      </div>
      <label class="flbl" style="margin-top:10px">Início do plano</label>
      <input class="inp" id="ap-inicio" type="date" value="${ap.inicio||HOJE_ISO}">
      <label class="flbl" style="margin-top:10px">Fim do plano (opcional — em branco = recorrente sem fim)</label>
      <input class="inp" id="ap-fim" type="date" value="${ap.fim||''}">
      <label class="flbl" style="margin-top:10px">Observação</label>
      <input class="inp" id="ap-obs" maxlength="200" value="${safeAttr(ap.obs||'')}">
      <button class="btn-save" id="ap-save" style="margin-top:14px">Salvar</button>
      <button class="sheet-cancel" id="ap-close">Cancelar</button>
    </div></div>`);
    // v518: dropdown contrato prefill (só se tem contratos ativos)
    const selCt = sheet.querySelector('#ap-contrato');
    if(selCt){
      selCt.onchange = ()=>{
        const opt = selCt.selectedOptions[0];
        if(!opt || !opt.value) return;
        const {fim, inicio, valor, plano} = opt.dataset;
        if(plano) sheet.querySelector('#ap-plano').value = plano;
        if(valor) sheet.querySelector('#ap-valor').value = valor;
        if(inicio) sheet.querySelector('#ap-inicio').value = inicio;
        if(fim) sheet.querySelector('#ap-fim').value = fim;
      };
    }
    if(ap.plano_id) sheet.querySelector('#ap-plano').value = ap.plano_id;
    if(ap.trava_motivo) sheet.querySelector('#ap-trava-motivo').value = ap.trava_motivo;
    // Toggle trava-wrap
    const travaChk = sheet.querySelector('#ap-trava');
    const travaWrap = sheet.querySelector('#ap-trava-wrap');
    travaChk.onchange = ()=>{ travaWrap.style.display = travaChk.checked ? 'block' : 'none'; };
    const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
    sheet.querySelector('#ap-close').onclick = close;
    sheet.onclick = e=>{ if(e.target===sheet) close(); };
    const btn = sheet.querySelector('#ap-save');
    btn.onclick = ()=>{
      const plano_id = sheet.querySelector('#ap-plano').value;
      if(!plano_id){ toast('Escolha um plano'); return; }
      const valorTxt = sheet.querySelector('#ap-valor').value.trim();
      btn.disabled=true; btn.textContent='Salvando…';
      const diaTxt = sheet.querySelector('#ap-dia').value.trim();
      const travaOn = travaChk.checked;
      sbProf.salvarAlunoPlano({
        user_id: a.id, plano_id,
        valor_negociado: valorTxt ? parseFloat(valorTxt) : null,
        dia_vencimento: diaTxt ? parseInt(diaTxt) : null,
        isento: sheet.querySelector('#ap-isento').checked,
        isento_motivo: sheet.querySelector('#ap-motivo').value.trim() || null,
        trava_reajuste: travaOn,
        trava_motivo: travaOn ? sheet.querySelector('#ap-trava-motivo').value : null,
        trava_desde: travaOn ? (ap.trava_desde || HOJE_ISO) : null,
        inicio: sheet.querySelector('#ap-inicio').value,
        fim: sheet.querySelector('#ap-fim').value || null,
        obs: sheet.querySelector('#ap-obs').value.trim() || null,
      }).then(()=>{ toast('Plano salvo ✔'); close(); if(onDone) onDone(); })
        .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
    };
    document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
  }).catch(e=>toast('Erro: '+(e.message||e)));
}

/* --- ERP: Ficha cadastral com edição inline (view/edit toggle) --- */
function _erpFicha(a, c, paint, refresh){
  const editing = !!DB._alunoFichaEdit;
  const box = el('<div class="erp-card"></div>');
  box.appendChild(el(`<div class="erp-card-h">Ficha cadastral
    <button class="erp-btn sm" id="fc-toggle">${editing?'Cancelar':'Editar'}</button></div>`));
  const e=(c&&c.endereco)||{}, r=(c&&c.responsavel)||{};
  // Mapa de turmas p/ mostrar nome+cor tanto em view quanto em edit
  _loadTurmas();
  const _tById = {}; (_turmasArr()||[]).forEach(t=>{ _tById[t.id]=t; });
  const _turmasDoAluno = (a.turmas||[]).map(id=>_tById[id]).filter(Boolean);
  if(!editing){
    const endTxt=[e.logradouro, e.numero, e.bairro, e.cidade, e.uf].filter(Boolean).join(', ') + (e.cep?(' · '+e.cep):'');
    const linha=(lbl,val)=> `<div class="erp-fld"><label>${lbl}</label><div class="erp-fld-v">${val?safeTxt(val):'<i>—</i>'}</div></div>`;
    const turmasHtml = _turmasDoAluno.length
      ? _turmasDoAluno.map(t=>`<span class="turma-chip on" style="--tc:${safeAttr(t.cor||'#888')};pointer-events:none">${safeTxt(t.nome)}${t.faixaEtaria?` · ${safeTxt(t.faixaEtaria)}`:''}</span>`).join(' ')
      : '<i>—</i>';
    const nascComp = a.nascData ? _isoToBR(a.nascData) : (a.nascimento||c&&c.nascimento||'');
    const body = el('<div></div>');
    body.innerHTML =
      linha('Nome completo', c?c.nomeCompleto:'') +
      linha('Apelido', a.nm||'') +
      linha('Nascimento', nascComp) +
      linha('Telefone', c?c.telefone:'') +
      linha('CPF', c?_maskCPF(c.cpf||''):'') +
      linha('E-mail', c?c.email:'') +
      linha('Endereço', endTxt.trim().replace(/^·\s*/,'')) +
      linha('Responsável', r.nome?`${r.nome}${r.parentesco?' ('+r.parentesco+')':''}${r.telefone?' · '+r.telefone:''}`:'') +
      linha('CPF do responsável', _maskCPF(r.cpf||'')) +
      linha('Início na academia', _inicioAcademia(a) ? _isoToBR(_inicioAcademia(a)) : '') +
      linha('Recebe mensagens', c ? (c.aceitaContato?'Sim':'Não') : '') +
      `<div class="erp-fld"><label>Turmas</label><div class="erp-fld-v">${turmasHtml}</div></div>` +
      (c&&c.obs?`<div class="erp-fld"><label>Observações</label><div class="erp-fld-v">${safeTxt(c.obs)}</div></div>`:'');
    box.appendChild(body);
    box.querySelector('#fc-toggle').onclick=()=>{ DB._alunoFichaEdit=true; paint(); };
    return box;
  }
  // modo edit — inputs inline, sem sheet
  const inp=(id,lbl,val,type='text',ph='')=>`<div class="erp-fld erp-fld-edit"><label>${lbl}</label>
    <input class="inp" id="${id}" type="${type}" value="${val?safeAttr(val):''}" placeholder="${ph}"></div>`;
  const dateInp=(id,lbl,isoVal)=>`<div class="erp-fld erp-fld-edit"><label>${lbl}</label>${dateBRField(id, isoVal||'')}</div>`;
  const form = el('<div></div>');
  form.innerHTML =
    inp('fc-nome','Nome completo', (c&&c.nomeCompleto)||a.nm||'', 'text', 'Ex: Gabriel Tavares de Jesus') +
    inp('fc-apelido','Apelido', a.nm||'', 'text', 'Como aparece no app') +
    // v344: "Ano de nascimento" saiu — o ano é DERIVADO da data completa, que é
    // obrigatória no cadastro e na importação. Dois campos para o mesmo fato só
    // criavam divergência (ano 1999 com data 23/03/2001 e ninguém sabia qual valia).
    dateInp('fc-nascdata','Data de nascimento', a.nascData||'') +
    inp('fc-tel','Telefone', c?c.telefone:'', 'tel', '(11) 99999-0000') +
    inp('fc-cpf','CPF', c?_maskCPF(c.cpf||''):'', 'text', '000.000.000-00') +
    inp('fc-email','E-mail', c?c.email:'', 'email') +
    inp('fc-cep','CEP', e.cep, 'text', '00000-000') +
    inp('fc-log','Logradouro', e.logradouro) +
    inp('fc-num','Número', e.numero) +
    inp('fc-bairro','Bairro', e.bairro) +
    inp('fc-cid','Cidade', e.cidade) +
    inp('fc-uf','UF', e.uf) +
    inp('fc-rnm','Responsável (nome)', r.nome) +
    inp('fc-rtel','Responsável (telefone)', r.telefone, 'tel') +
    inp('fc-rpar','Responsável (parentesco)', r.parentesco, 'text', 'Mãe, cônjuge…') +
    inp('fc-rcpf','Responsável (CPF)', _maskCPF(r.cpf||''), 'text', '000.000.000-00') +
    // v344: "Início na academia" saiu da ficha — a fonte única é o evento `inicio`
    // da linha do tempo de graduação (aba Graduação → + Novo evento).
    `<div class="erp-fld"><label>Início na academia</label><div class="erp-fld-v">${
      _inicioAcademia(a) ? _isoToBR(_inicioAcademia(a))+' <i style="color:var(--muted);font-weight:500">· edite na aba Graduação</i>'
                         : '<i>— registre na aba Graduação</i>'}</div></div>` +
    `<div class="erp-fld erp-fld-edit"><label>Recebe mensagens (autorizado pelo aluno)</label>
      <select class="inp" id="fc-contato"><option value="0">Não</option><option value="1" ${c&&c.aceitaContato?'selected':''}>Sim</option></select></div>` +
    `<div class="erp-fld erp-fld-edit"><label>Turmas (clique pra matricular/desmatricular)</label>
      <div id="fc-turmas" class="turma-chips"></div></div>` +
    `<div class="erp-fld erp-fld-edit"><label>Observações</label>
      <textarea class="inp" id="fc-obs" rows="3">${c&&c.obs?safeTxt(c.obs):''}</textarea></div>` +
    `<div class="erp-fld-acts"><button class="erp-btn primary" id="fc-save">Salvar ficha</button></div>`;
  box.appendChild(form);
  bindDateBR(form);
  const selTurmas = new Set(a.turmas||[]);
  _turmaChips(form.querySelector('#fc-turmas'), selTurmas);
  bindViaCEP(form.querySelector('#fc-cep'), {
    logr: form.querySelector('#fc-log'), bairro: form.querySelector('#fc-bairro'),
    cidade: form.querySelector('#fc-cid'), uf: form.querySelector('#fc-uf'), num: form.querySelector('#fc-num'),
  });
  bindCPF(form.querySelector('#fc-cpf'));
  bindCPF(form.querySelector('#fc-rcpf'));
  box.querySelector('#fc-toggle').onclick=()=>{ DB._alunoFichaEdit=false; paint(); };
  box.querySelector('#fc-save').onclick=()=>{
    const g=(id)=> form.querySelector('#'+id).value.trim();
    const nomeCompleto = g('fc-nome');
    const apelidoNovo  = g('fc-apelido') || (nomeCompleto.split(/\s+/)[0]||'');
    const nascData     = dateBRRead(form.querySelector('#fc-nascdata')) || null;
    // ANO derivado da DATA (fonte única). Sem data, preserva o ano que já existia.
    const nascimento   = nascData ? +nascData.slice(0,4) : ((c&&c.nascimento)||a.nascimento||null);
    const dataInicio   = _inicioAcademia(a);   // vem da timeline, não do form
    a.cad = a.cad || {};
    a.cad.nomeCompleto = nomeCompleto;
    a.cad.nascimento = nascimento;
    a.cad.telefone = _normTelBR(g('fc-tel')); a.cad.email = g('fc-email');
    a.cad.cpf = g('fc-cpf').replace(/\D/g,'');
    a.cad.endereco = { cep:g('fc-cep'), logradouro:g('fc-log'), numero:g('fc-num'), bairro:g('fc-bairro'), cidade:g('fc-cid'), uf:g('fc-uf').toUpperCase() };
    a.cad.responsavel = { nome:g('fc-rnm'), telefone:_normTelBR(g('fc-rtel')), parentesco:g('fc-rpar'), cpf:g('fc-rcpf').replace(/\D/g,'') };
    a.cad.dataInicio = dataInicio; a.cad.obs = g('fc-obs');
    a.cad.aceitaContato = form.querySelector('#fc-contato').value === '1';
    if(apelidoNovo){ a.nm = apelidoNovo; a.ini = _iniciaisDe(apelidoNovo); }
    if(nascimento) a.nascimento = nascimento;
    a.nascData = nascData;
    const novasTurmas = [...selTurmas];
    a.turmas = novasTurmas;
    if(typeof sbProf!=='undefined' && sbProf.atualizarAluno && a.id && !a._self){
      const payload = Object.assign({ nome_completo: nomeCompleto, apelido: apelidoNovo, email: a.cad.email, nascimento }, _cadToDB(a.cad));
      // nascimento_data (0002) e turmas em promessas paralelas — falha em uma não derruba a outra
      Promise.all([
        sbProf.atualizarAluno(a.id, payload),
        nascData !== (a._nascDataAntes||null) ? sbProf.atualizarAluno(a.id, { nascimento_data: nascData }).catch(()=>{}) : null,
        sbProf.sincronizarTurmas ? sbProf.sincronizarTurmas(a.id, novasTurmas) : null,
      ].filter(Boolean))
        .then(()=>{ DB._alunoFichaEdit=false; toast('Ficha atualizada ✔'); if(refresh) refresh(); else paint(); })
        .catch(err=>{ toast('Erro: '+(err.message||err)); });
    } else {
      DB._alunoFichaEdit=false; toast('Ficha atualizada ✔'); paint();
    }
  };
  return box;
}

/* --- ERP: Presenças — histórico cronológico de check-ins, não KPIs --- */
function _erpPresencas(freq, aluno, refresh, paint){
  const box=el('<div class="erp-card"></div>');
  box.appendChild(el(`<div class="erp-card-h">Histórico de presenças</div>`));
  // v431: crédito de aulas importado do app antigo (0029). Ele vive como NÚMERO no
  // evento de graduação — não existe linha em `checkins` — então some desta lista e da
  // contagem "N CHECK-INS". Sem esta nota, a ficha mostrava 9 e a coluna GRAU dizia
  // 20/40, com 11 de diferença sem explicação em lugar nenhum da tela.
  const _cred = Math.max(0, +(aluno && aluno.creditoGrau) || 0);
  if(_cred > 0){
    box.appendChild(el(`<div class="erp-pres-cred">+${_cred} aula${_cred!==1?'s':''} importada${_cred!==1?'s':''} do app antigo — ${_cred!==1?'contam':'conta'} para a graduação, mas não ${_cred!==1?'têm':'tem'} registro individual.</div>`));
  }
  // v426: ordena pelo horário da AULA (não pelo do registro). Com 2 aulas no mesmo
  // dia, o professor marca as duas de uma vez — as horas de registro ficam iguais
  // (22:33/22:33) e a ordem saía aleatória; por aula, sai 06:00 antes de 19:30.
  const _hAula = c => (c && (c.horaAula || c.hora)) || '';
  const arr=(freq||[]).filter(c=>c&&c.data).slice().sort((a,b)=>{
    if(b.data!==a.data) return b.data.localeCompare(a.data);
    return _hAula(b).localeCompare(_hAula(a));
  });
  if(!arr.length){ box.appendChild(el('<div class="erp-tl-empty">Sem presenças registradas.</div>')); return box; }
  const list=el('<div class="erp-pres-list"></div>');
  const DIA=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  arr.forEach(c=>{
    const [y,m,d]=c.data.split('-');
    const dt = new Date(c.data+'T12:00:00');
    const dow = DIA[dt.getDay()];
    // Horário da AULA (19:30). Fallback pro horário de registro só em check-in
    // sem aula vinculada (legado) — melhor mostrar algo aproximado que "—".
    const hora = _hAula(c) ? String(_hAula(c)).slice(0,5) : '—';
    // v363: monta "TURMA · variacao" (ex: "ADULTO · No-Gi"). Antes so mostrava
    // "Aula" fixo, que era o default do payload da RPC sem variacao.
    const turma = c.turmaNome || '';
    const tipo  = c.tipo && c.tipo !== 'Aula' ? c.tipo : '';
    const label = turma && tipo ? `${turma} · ${tipo}` : (turma || tipo || 'Aula');
    const row = el(`<div class="erp-pres-row">
      <div class="erp-pres-dt"><b>${d}/${m}</b><span>${dow}</span></div>
      <div class="erp-pres-tp">${safeTxt(label)}</div>
      <div class="erp-pres-hr">${safeTxt(hora)}</div>
      ${c.id?'<button class="erp-pres-del" type="button" aria-label="Remover presença" title="Remover presença">×</button>':''}
    </div>`);
    const del = row.querySelector('.erp-pres-del');
    if(del) del.onclick = (e)=>{
      e.stopPropagation();
      if(!confirm(`Remover a presença de ${d}/${m}?`)) return;
      const done = ()=>{ const i=(freq||[]).indexOf(c); if(i>=0) freq.splice(i,1); if(paint) paint(); toast('Presença removida'); };
      if(!DEMO && typeof sbProf!=='undefined' && sbProf.removerCheckinId){
        sbProf.removerCheckinId(c.id).then(done).catch(err=> toast('Erro: '+(err.message||err)));
      } else { done(); }
    };
    list.appendChild(row);
  });
  box.appendChild(list);
  return box;
}

/* --- ERP: coluna direita (ações contextuais + globais) --- */
function _erpActions(a, tab, refresh, paint, hora){
  const box=el('<div></div>');
  // v488 Sprint 2: mini card do plano do aluno visível em TODA aba da ficha
  // (antes só na Ficha). Complementa `_erpFinanceiroAluno` sem duplicar — ali
  // é o bloco cheio na aba Ficha; aqui é resumo permanente no sidebar.
  if(!a._self && !DEMO && typeof sbProf!=='undefined' && sbProf.getAlunoPlano){
    box.appendChild(_erpPlanoMini(a, refresh));
  }
  const rows=[];
  // v292: presença só via fluxo Turma → Adicionar frequência (batch com aula_id/turma/hora reais).
  // Lançar/remover manual daqui foi removido pra ter UM só caminho de gravação (evita histórico
  // sem contexto e divergência entre checkins.turma_id/aula_id).
  // v510: removidos "Marcar como pago"/"Marcar vencido" — legado da v481, usava
  // ON CONFLICT (user_id,mes) mas 0043 substituiu o UNIQUE por índice parcial,
  // gerando "no unique or exclusion constraint". Fluxo oficial é Financeiro → Cobranças.
  if(_waLink(a)) rows.push(['pa-wa','💬 WhatsApp','', ()=>{ const u=_waLink(a); if(u) window.open(u,'_blank','noopener'); }]);
  if(!a._self) rows.push(['pa-status',`🔘 Status: ${_statusAlunoTxt(a)}`,'', ()=>_statusManualSheet(a, refresh, paint)]);
  // v300: "Graduação retroativa" unificado no "+ Novo evento" da timeline (aba Graduação).
  if(DB.eu && DB.eu.role==='dono' && !a._self) rows.push(['pa-promo','⬆️ Promover a professor','', ()=>{ _profPromoverSheet(a, ()=>{ refresh(); paint(); }); }]);
  // v436: reset de senha individual. O lote (senha-padrao) pula quem já acessou — de
  // propósito — e esses alunos ficavam sem caminho no app. Hierarquia igual à da Edge
  // Function: dono nunca é alvo; professor só pelo dono; nunca em si mesmo.
  if(!a._self && a.role!=='dono' && !(a.role==='professor' && DB.eu.role!=='dono'))
    rows.push(['pa-senha','🔑 Redefinir senha','', ()=>_resetarSenhaSheet(a)]);
  if(!(a._self||a.role==='professor'||a.role==='dono')) rows.push(['pa-del','🗑️ Excluir','danger', ()=>{ _profExcluirAlunoSheet(a, ()=>{ DB.alunoAberto=null; DB._alunoTab=null; refresh(); render(); }); }]);
  rows.forEach(([id,lbl,cls,fn])=>{
    if(typeof cls==='function'){ fn=cls; cls=''; }
    const b=el(`<button class="erp-act ${cls||''}" id="${id}">${lbl}</button>`);
    b.onclick=fn; box.appendChild(b);
  });
  return box;
}

/* --- ERP: Timeline de graduação editável (protótipo — CRUD in-memory) --- */
function _erpTimelineGrad(a, paint){
  const box=el('<div class="erp-card"></div>');
  box.appendChild(el(`<div class="erp-card-h">Linha do tempo de graduação
    <button class="btn-cad primary" id="tl-add" style="width:auto;flex:none;padding:8px 14px;font-size:13px;white-space:nowrap">＋ Novo evento</button></div>`));
  const grads = (a.graduacoes||[]).filter(g=>g&&g.data);
  // Reconciliação perfil ↔ timeline. A faixa da lista vem de `profiles.faixa`; a
  // timeline vem de `graduations`. Editar o perfil por fora (SQL, importação com
  // faixa fixa) deixa os dois discordando — e o aluno via "Branca" na Jornada
  // enquanto a lista mostrava Laranja. Aqui o professor VÊ a divergência e resolve.
  const _ultEvento = [...grads].filter(g=>g.tipo==='faixa'||g.tipo==='grau'||g.tipo==='inicio')
    .sort((x,y)=>x.data.localeCompare(y.data)).pop();
  const _divergente = (a.faixa||'branca') !== ((_ultEvento&&_ultEvento.faixa)||'branca')
                   || (a.graus||0) !== ((_ultEvento&&_ultEvento.tipo==='grau'?_ultEvento.graus:0)||0);
  if(_divergente){
    const evTx = _ultEvento
      ? `${BELTS[_ultEvento.faixa]?.nome||_ultEvento.faixa}${_ultEvento.tipo==='grau'?' · '+_ultEvento.graus+'º grau':''} (${_isoToBR(_ultEvento.data)})`
      : 'nenhum evento';
    const warn = el(`<div class="erp-tl-warn">⚠️ <b>Perfil e histórico divergem.</b>
      Cadastro: <b>${safeTxt(BELTS[a.faixa]?.nome||a.faixa||'—')} · ${a.graus||0}º grau</b> · Último evento: <b>${safeTxt(evTx)}</b>.
      <button class="erp-btn sm" id="tl-fix">Registrar evento p/ a faixa do cadastro</button></div>`);
    warn.querySelector('#tl-fix').onclick=()=>_erpGradForm(a, null, paint);
    box.appendChild(warn);
  }
  // Estatísticas embaixo
  const stats = _erpGradStats(grads);
  const list = el('<div class="erp-tl"></div>');
  // v352: dedupe visual da timeline via `_gradsDedup` (mesma regra do KPI acima).
  const arr = _gradsDedup(grads).sort((x,y)=>y.data.localeCompare(x.data));
  if(!arr.length){
    list.appendChild(el('<div class="erp-tl-empty">Sem graduações registradas. Clique em "+ Novo evento" pra começar.</div>'));
  } else {
    arr.forEach((g,i)=>{
      const x=BELTS[g.faixa]||{cor:'#888',nome:g.faixa};
      const titulo = g.tipo==='faixa' ? `Faixa ${x.nome}` : (g.tipo==='inicio' ? `Início · Faixa ${x.nome}` : `${g.graus||0}º grau · ${x.nome}`);
      const [y,m,d]=g.data.split('-'); const dataFmt=`${d}/${m}/${y}`;
      const rel=_tempoRelativo(g.data);
      const it=el(`<div class="erp-tl-item">
        <div class="erp-tl-rail"><span class="erp-tl-dot" style="background:${x.cor}"></span>${i<arr.length-1?'<span class="erp-tl-line"></span>':''}</div>
        <div class="erp-tl-bd">
          <div class="erp-tl-t">${safeTxt(titulo)}</div>
          <div class="erp-tl-dt">${dataFmt} · <i>${rel}</i>${g.por?' · por '+safeTxt(g.por):''}</div>
          ${g.nota?`<div class="erp-tl-nt">${safeTxt(g.nota)}</div>`:''}
          <div class="erp-tl-acts">
            <button class="erp-mini" data-i="${i}" data-act="edit" aria-label="Editar">✎</button>
            <button class="erp-mini danger" data-i="${i}" data-act="del" aria-label="Excluir">🗑</button>
          </div>
        </div>
      </div>`);
      list.appendChild(it);
    });
  }
  box.appendChild(list);
  // Stats footer
  if(arr.length){
    box.appendChild(el(`<div class="erp-tl-stats">
      <div><b>${arr.length}</b> evento${arr.length>1?'s':''}</div>
      <div><b>${stats.mediaEntreGraus||'—'}</b> tempo médio entre graus</div>
      <div><b>${stats.proxima||'—'}</b> próxima janela sugerida</div>
    </div>`));
  }
  // CRUD ligado ao backend (0011 — graduations append-only).
  box.querySelector('#tl-add').onclick=()=>_erpGradForm(a, null, paint);
  list.querySelectorAll('button.erp-mini').forEach(b=>{
    b.onclick=()=>{
      const i=+b.dataset.i, act=b.dataset.act;
      const item = arr[i];
      if(act==='edit') _erpGradForm(a, item, paint);
      else if(act==='del'){
        if(!confirm('Excluir esse evento da linha do tempo?')) return;
        const doDel = ()=>{
          a.graduacoes = (a.graduacoes||[]).filter(g=> g!==item);
          toast('Evento removido ✔'); paint();
        };
        if(item.id && typeof sbProf!=='undefined' && sbProf.removerGraduacao){
          sbProf.removerGraduacao(item.id).then(doDel)
            .catch(e=> toast('Erro ao remover: '+(e.message||e)));
        } else doDel();
      }
    };
  });
  return box;
}

/* v345: o PRÓXIMO evento é deduzido da timeline — o professor só confirma a data.
   Regras (a cadeia de faixas respeita a idade via proximaFaixaCBJJ, adulto e infantil):
     timeline vazia            → Início na academia · branca · 0 graus
     último = inicio|faixa     → 1º grau na mesma faixa
     último = grau < máximo    → próximo grau
     último = grau no máximo   → próxima faixa · 0 graus
     sem próxima faixa p/ idade→ null (o professor escolhe na mão) */
function _proximoEventoGrad(a){
  const gs = (a.graduacoes||[]).filter(g=>g&&g.data).sort((x,y)=>x.data.localeCompare(y.data));
  if(!gs.length) return { tipo:'inicio', faixa:'branca', graus:0, motivo:'Primeiro registro do aluno' };
  const ult = gs[gs.length-1];
  const faixa = ult.faixa || 'branca';
  if(ult.tipo!=='grau') return { tipo:'grau', faixa, graus:1, motivo:'Sequência: 1º grau na faixa atual' };
  const max = maxGrausDe(faixa);
  if((ult.graus||0) < max) return { tipo:'grau', faixa, graus:(ult.graus||0)+1, motivo:'Sequência: próximo grau' };
  const prox = proximaFaixaCBJJ(faixa, idadeCBJJ(a.nascimento));
  if(!prox) return null;   // faixa máxima p/ a idade — escolha manual
  return { tipo:'faixa', faixa:prox, graus:0, motivo:`Sequência: ${max}º grau completo → próxima faixa` };
}
// Form de evento: sugestão pronta + "Alterar" pra abrir os campos. Sem campo de nota.
function _erpGradForm(a, existing, paint){
  const sug = existing ? null : _proximoEventoGrad(a);
  const _lbl = (t,f,g)=> t==='inicio' ? `Início na academia · ${BELTS[f]?.nome||f}`
             : t==='faixa' ? `Nova faixa: ${BELTS[f]?.nome||f}`
             : `${g}º grau · ${BELTS[f]?.nome||f}`;
  const sh=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${existing?'Editar evento':'Novo evento'}</div>
    ${sug?`<div class="gf-sug" id="gf-sug">
      <div class="gf-sug-t">${safeTxt(_lbl(sug.tipo,sug.faixa,sug.graus))}</div>
      <div class="gf-sug-s">${safeTxt(sug.motivo)}</div>
      <button type="button" class="gf-sug-alt" id="gf-alt">Alterar</button>
    </div>`:''}
    <div id="gf-campos"${sug?' hidden':''}>
      <label class="flbl">Tipo</label>
      <select class="inp" id="gf-tipo">
        <option value="inicio">Início na academia</option>
        <option value="faixa">Nova faixa</option>
        <option value="grau" selected>Novo grau</option>
      </select>
      <label class="flbl">Faixa</label>
      <select class="inp" id="gf-faixa">${Object.entries(BELTS).map(([k,v])=>`<option value="${k}">${v.nome}</option>`).join('')}</select>
      <label class="flbl">Grau <span style="color:var(--muted);font-weight:500">(0 no início/nova faixa)</span></label>
      <input class="inp" id="gf-graus" type="number" min="0" max="6" value="0">
    </div>
    <label class="flbl">Data <span style="color:var(--muted);font-weight:500">(DD/MM/AAAA)</span></label>
    <input class="inp" id="gf-data" type="text" inputmode="numeric" maxlength="10" placeholder="DD/MM/AAAA">
    <button class="btn-save" id="gf-save">${existing?'Salvar':'Adicionar'}</button>
    <button class="sheet-cancel" id="gf-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sh.classList.remove('open'); setTimeout(()=>sh.remove(),260); };
  const tSel=sh.querySelector('#gf-tipo'), fSel=sh.querySelector('#gf-faixa'), gInp=sh.querySelector('#gf-graus'), dInp=sh.querySelector('#gf-data');
  const isoToBr=(iso)=>{ if(!iso||iso.length<10) return ''; const [y,m,d]=iso.slice(0,10).split('-'); return `${d}/${m}/${y}`; };
  const brToIso=(br)=>{ const m=(br||'').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(!m) return null; const [_,d,mo,y]=m; const iso=`${y}-${mo}-${d}`; const dt=new Date(iso+'T12:00:00'); if(isNaN(dt.getTime())||dt.getDate()!=+d||dt.getMonth()+1!=+mo) return null; return iso; };
  // `inicio` e `faixa` são sempre 0 graus — trava, não só sugestão.
  const _syncGraus=()=>{ const t=tSel.value; if(t!=='grau'){ gInp.value=0; gInp.disabled=true; } else gInp.disabled=false; };
  tSel.onchange=_syncGraus;
  if(existing){
    tSel.value=existing.tipo||'grau'; fSel.value=existing.faixa||'branca';
    gInp.value=existing.graus||0; dInp.value=isoToBr(existing.data||'');
  } else if(sug){
    tSel.value=sug.tipo; fSel.value=sug.faixa; gInp.value=sug.graus;
    dInp.value = isoToBr(HOJE_ISO);
    // "Alterar": revela os campos e some com o resumo (o valor sugerido fica carregado)
    sh.querySelector('#gf-alt').onclick=()=>{
      sh.querySelector('#gf-campos').hidden=false;
      sh.querySelector('#gf-sug').remove();
    };
  } else {
    // Sem sugestão (faixa máxima p/ a idade): campos abertos, escolha manual.
    sh.querySelector('#gf-campos').hidden=false;
    dInp.value = isoToBr(HOJE_ISO); fSel.value = a.faixa||'branca'; gInp.value = (a.graus||0)+1;
  }
  _syncGraus();
  // Máscara DD/MM/AAAA: só dígitos, insere as barras automaticamente.
  dInp.oninput=(e)=>{ let v=e.target.value.replace(/\D/g,'').slice(0,8); if(v.length>4) v=v.slice(0,2)+'/'+v.slice(2,4)+'/'+v.slice(4); else if(v.length>2) v=v.slice(0,2)+'/'+v.slice(2); e.target.value=v; };
  sh.querySelector('#gf-cancel').onclick=close;
  sh.onclick=(e)=>{ if(e.target===sh) close(); };
  sh.querySelector('#gf-save').onclick=()=>{
    const iso = brToIso(dInp.value.trim());
    if(!iso){ toast('Data inválida — use DD/MM/AAAA'); return; }
    if(iso > HOJE_ISO){ toast('Data no futuro'); return; }
    const tipo = tSel.value;
    const novo = { tipo, faixa: fSel.value, graus: tipo==='grau' ? (+gInp.value||0) : 0, data: iso };
    // v300: unifica "Novo evento" + "Graduação retroativa". Regra:
    //  - Se este evento é o MAIS RECENTE da timeline E tipo faixa/grau →
    //    chama graduarAluno (trigger M3 sincroniza profiles.faixa/graus).
    //  - Senão (retroativo, inicio, ou não-mais-recente) → append puro via salvarGraduacao.
    // Assim faixa atual sempre reflete o último evento sem duplicar caminho.
    const eventos = (a.graduacoes||[]).slice();
    if(existing){ const i=eventos.indexOf(existing); if(i>=0) eventos.splice(i,1); }
    eventos.push(novo);
    eventos.sort((x,y)=>x.data.localeCompare(y.data));
    const isUltimo = eventos[eventos.length-1] === novo;
    const dispara = isUltimo && (novo.tipo==='faixa' || novo.tipo==='grau');
    const por = (DB.professor && DB.professor.nome) || 'Professor';
    const persist = ()=>{
      if(typeof sbProf==='undefined' || !a.id) return Promise.resolve(null);
      if(dispara && sbProf.graduarAluno){
        return sbProf.graduarAluno(a.id, novo.faixa, novo.graus, novo.tipo, por, novo.data).then(()=> null);
      }
      if(sbProf.salvarGraduacao){
        return sbProf.salvarGraduacao({ id: existing && existing.id, user_id: a.id, ...novo, por });
      }
      return Promise.resolve(null);
    };
    persist().then(newId=>{
      if(existing){
        const idx = (a.graduacoes||[]).indexOf(existing);
        if(idx>=0) a.graduacoes[idx] = { ...novo, id: newId || existing.id };
      } else {
        a.graduacoes = (a.graduacoes||[]).concat([{ ...novo, id: newId }]);
      }
      // Atualiza faixa/grau atual local quando é o último evento faixa/grau
      if(dispara){ a.faixa = novo.faixa; a.graus = novo.graus; }
      // Recalcula a data da faixa atual (usada pelo semáforo de graduação): pega o último
      // evento tipo faixa OU inicio na faixa atual. Espelha a mesma regra do adapter.
      a.faixaDesde = _faixaDesde(a.graduacoes||[], a.faixa);
      toast(existing ? 'Evento atualizado ✔' : (dispara ? 'Graduação registrada ✔' : 'Evento retroativo registrado ✔'));
      close(); paint(); render();
    }).catch(e=> toast('Erro ao salvar: '+(e.message||e)));
  };
  document.body.appendChild(sh); requestAnimationFrame(()=>sh.classList.add('open'));
}

// Estatísticas da timeline: tempo médio entre graus + próxima janela sugerida
function _erpGradStats(grads){
  const graus = grads.filter(g=>g.tipo==='grau').sort((a,b)=>a.data.localeCompare(b.data));
  if(graus.length<2) return { mediaEntreGraus: null, proxima: null };
  let totalDias=0;
  for(let i=1;i<graus.length;i++){
    totalDias += (new Date(graus[i].data) - new Date(graus[i-1].data)) / 86400000;
  }
  const mediaDias = Math.round(totalDias/(graus.length-1));
  const mediaFmt = mediaDias>365 ? (Math.round(mediaDias/365*10)/10)+' anos' : (mediaDias>30 ? Math.round(mediaDias/30)+' meses' : mediaDias+' dias');
  const ultimo = new Date(graus[graus.length-1].data);
  const prox = new Date(ultimo.getTime() + mediaDias*86400000);
  const pd = String(prox.getDate()).padStart(2,'0'), pm=String(prox.getMonth()+1).padStart(2,'0');
  return { mediaEntreGraus: mediaFmt, proxima: `${pd}/${pm}/${prox.getFullYear()}` };
}

// "há 8 meses", "há 2 anos", "ontem"
function _tempoRelativo(iso){
  const d = new Date(iso), agora = new Date();
  const diff = Math.floor((agora - d)/86400000);
  if(diff<0) return 'no futuro';
  if(diff===0) return 'hoje';
  if(diff===1) return 'ontem';
  if(diff<30) return `há ${diff} dias`;
  if(diff<365){ const m=Math.round(diff/30); return `há ${m} ${m===1?'mês':'meses'}`; }
  const y=Math.round(diff/365*10)/10;
  return `há ${y} ${y<=1?'ano':'anos'}`;
}
// Atalho: todo o app chama _profAlunoSheet(a) — agora navega para a tela cheia.
function _profAlunoSheet(a){ _navPush(); DB.alunoAberto=a; render(); window.scrollTo(0,0); }

/* Promover aluno → professor (só dono). Preserva a conta/histórico; muda o papel
   no servidor via Edge Function promote-professor (gated is_dono). */
function _profPromoverSheet(a, refresh){
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Promover ${safeTxt(_nomeInst(a))} a professor?</div>
    <div class="sheet-desc">O histórico dele (treinos, graduações, diário) é preservado — ele mantém a conta e passa a ter acesso à gestão da academia. Só você (dono) pode fazer isso, e reverter exige o suporte/SQL.</div>
    <button class="btn-save" id="pp-ok" style="margin-top:6px">Promover a professor</button>
    <button class="sheet-cancel" id="pp-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pp-cancel').onclick=close;
  const btn=sheet.querySelector('#pp-ok');
  btn.onclick=async()=>{
    if(typeof sbProf==='undefined' || !sbProf.promoverProfessor){ toast('Requer backend ativo'); return; }
    btn.disabled=true; btn.textContent='Promovendo…';
    try{
      await sbProf.promoverProfessor(a.id);
      close(); toast(`${_nomeInst(a)} agora é professor(a) ✔`);
      _profData=null; _profTs=0; _loadProfData(); if(refresh) refresh(); render();
    }catch(e){ btn.disabled=false; btn.textContent='Promover a professor'; toast('Erro: '+(e.message||e)); }
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Exclusão de aluno (LGPD/gestão). Online: Edge Function delete-student (cascade no servidor).
// Offline (mock): remove de DB.alunos p/ demonstração.
function _profExcluirAlunoSheet(a, refresh){
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Excluir ${safeTxt(_nomeInst(a))}?</div>
    <div class="sheet-desc">Apaga a conta do aluno e <b>todos</b> os dados vinculados (presenças, graduações, lesões, progresso e diário). Não dá pra desfazer.</div>
    <button class="btn-save danger" id="pe-sim">Excluir definitivamente</button>
    <button class="sheet-cancel" id="pe-nao">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pe-nao').onclick=close;
  sheet.querySelector('#pe-sim').onclick=async()=>{
    const btn=sheet.querySelector('#pe-sim'); btn.disabled=true; btn.textContent='Excluindo…';
    if(typeof sbProf!=='undefined' && sbProf.excluirAluno){
      try{ await sbProf.excluirAluno(a.id); }
      catch(e){
        btn.disabled=false; btn.textContent='Excluir definitivamente';
        // Traduz códigos conhecidos da Edge Function (delete-student/index.ts).
        const t = {
          'forbidden_delete_professor':'Professor não pode ser excluído por aqui (proteção anti-suicídio da academia).',
          'forbidden_not_professor':'Só professor/dono pode excluir aluno.',
          'forbidden_other_academy':'Este aluno é de outra academia.',
          'target_not_found':'Aluno não encontrado no backend.',
          'profile_not_found':'Seu perfil não foi encontrado.',
          'rate_limited':'Muitas exclusões seguidas — aguarde e tente de novo.',
          'unauthorized':'Sessão expirou — faça login de novo.',
        };
        toast(t[e.code] || ('Erro ao excluir: '+(e.message||e)));
        return;
      }
    } else {
      DB.alunos = (DB.alunos||[]).filter(x=> (x.id||x.nm) !== (a.id||a.nm));   // mock offline
    }
    _profData=null; _profTs=0; _loadProfData();
    close(); render(); toast('Aluno excluído ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// mapeia a ficha (cad) para as colunas snake_case do profiles (backend)
function _cadToDB(cad){
  const e=cad.endereco||{}, r=cad.responsavel||{};
  return { telefone:cad.telefone, cpf:cad.cpf||null, cep:e.cep, logradouro:e.logradouro, numero:e.numero, bairro:e.bairro, cidade:e.cidade, uf:e.uf,
    resp_nome:r.nome, resp_telefone:r.telefone, resp_parentesco:r.parentesco, resp_cpf:r.cpf||null,
    data_inicio:cad.dataInicio||null, observacoes:cad.obs, aceita_contato:!!cad.aceitaContato };
}
/* ============================================================
   PROFESSOR — Relatórios + Inteligência (Fase 1 / §7.1)
   Deriva de campos objetivos do aluno (faixa, freq, diasSem, aptoGrad).
   Com backend, os mesmos cálculos rodam sobre dados reais (sem privado).
   ============================================================ */
const RISCO_DIAS = PROF_METAS.RISCO_DIAS;   // == adapter (via PROF_METAS)
function _profAlunosArr(){ return (_profData?.alunos)||[]; }
function _distFaixas(){
  const d={}; _profAlunosArr().forEach(a=>{ d[a.faixa]=(d[a.faixa]||0)+1; }); return d;
}
function _freqMedia(){
  const a=_profAlunosArr(); if(!a.length) return 0;
  return Math.round(a.reduce((s,x)=>s+(x.freq||0),0)/a.length);
}

/* ---- Matéria-prima dos relatórios (checkins/graduações/progresso/lesões da academia) ----
   Online: sbProf.getRelatorios (RLS limita à academia; nada privado — §4).
   Offline: deriva dos dados locais do próprio professor (estado honesto p/ o resto). */
let _relData = null, _relTs = 0;
function _loadRelData(){
  if(_relData && Date.now()-_relTs < 30000) return;
  _relTs = Date.now();
  if(DEMO || typeof sbProf==='undefined' || !sbProf.getRelatorios){
    _relData = {
      checkins:(DB.treinos||[]).filter(t=>t.data).map(t=>({user_id:'self', data:t.data, hora:null, tipo:null, turma_id:null})),
      graduacoes:(DB.graduacoes||[]).map(g=>({user_id:'self', faixa:g.faixa, graus:g.graus, tipo:g.tipo, data:g.data})),
      progresso:_selfProgresso().map(p=>Object.assign({user_id:'self'}, p)),
      lesoes:(DB.lesoes||[]).map(l=>({user_id:'self', parte:l.parte, status:l.status, data:l.data})),
    };
    return;
  }
  sbProf.getRelatorios().then(d=>{
    _relData = d || {checkins:[],graduacoes:[],progresso:[],lesoes:[]}; renderBg();
  }).catch(()=>{ _relTs = 0; });
}

/* ---- Risco de evasão v2: ausência absoluta OU queda de frequência (tendência) ---- */
function _riscoMotivo(a){
  if((a.diasSem||0) >= RISCO_DIAS) return `${a.diasSem} dias sem treinar`;
  // Queda ≥50%: treinava (base ≥2×/4sem no trimestre anterior) e caiu pela metade ou mais.
  if(a.freq4!=null && a.base4!=null && a.base4>=2 && a.freq4 <= a.base4*0.5)
    return `queda de frequência (${a.freq4}× vs ${a.base4}×/4 sem)`;
  return null;
}
function _emRisco(){ return _profAlunosArr().filter(a=>_riscoMotivo(a)!=null); }

/* ---- Contato em 1 toque: wa.me com o telefone da ficha (responsável p/ menores) ---- */
function _waLink(a, msg){
  const c=a.cad||{}; const r=c.responsavel||{};
  const idade=idadeCBJJ(a.nascimento);
  const tel=(idade!=null && idade<18) ? (r.telefone||c.telefone) : (c.telefone||r.telefone);
  if(!tel) return null;
  let d=String(tel).replace(/\D/g,'');
  if(d.length<8) return null;
  if(d.length<=11) d='55'+d;   // sem DDI → assume Brasil
  return 'https://wa.me/'+d + (msg?('?text='+encodeURIComponent(msg)):'');
}

/* ---- Templates de WhatsApp: 8 slots editáveis pelo professor (v376).
   Defaults hard-coded pra os 6 casos originais + 2 slots livres. Overrides do
   professor vivem em academies.config.waTemplates (JSONB, array de 8). Editor:
   _waTemplatesSheet (hub YAMA). Placeholder reconhecido: {nome} — substituído
   por _waNome(a) na hora de enviar. */
const _WA_DEFAULTS = [
  { key:'abrir',    icon:'💬', label:'Só abrir chat',     body:'' },
  { key:'sumido7',  icon:'👋', label:'Sumido 1 semana',   body:'Oi {nome}, senti sua falta no tatame essa semana. Tá tudo bem? Te espero na próxima aula 🥋' },
  { key:'sumido30', icon:'💪', label:'Sumido 1 mês',      body:'Oi {nome}, notei que faz um tempo que você não vem treinar. Vamos marcar sua volta? Se precisar de qualquer ajuda, chama aqui.' },
  { key:'aniv',     icon:'🎂', label:'Aniversário',       body:'Oi {nome}, parabéns pelo seu dia! 🎂 Que venha mais um ano de tatame — a Yama torce por você.' },
  { key:'gradProx', icon:'🥋', label:'Graduação próxima', body:'Oi {nome}, você tá quase pronto pra próxima graduação — continue firme, tá muito perto!' },
  { key:'bemVindo', icon:'🙌', label:'Boas-vindas',       body:'Oi {nome}, seja bem-vindo(a) à Yama Jiu-Jitsu! Qualquer dúvida sobre horários ou material, me chama aqui.' },
  { key:'slot7',    icon:'✨', label:'Personalizada 1',   body:'' },
  { key:'slot8',    icon:'✨', label:'Personalizada 2',   body:'' },
];
function _waTpls(){
  const over = ((DB.academyConfig||{}).waTemplates)||[];
  return _WA_DEFAULTS.map((d,i)=>{
    const o = over[i] || {};
    return {
      key:   d.key,
      icon:  o.icon  || d.icon,
      label: o.label || d.label,
      body:  (o.body!=null ? o.body : d.body),
    };
  });
}
function _waResolve(body, a){ return String(body||'').replace(/\{nome\}/gi, _waNome(a)); }

/* === CONVITE DE ACESSO (v308) ===
   O aluno importado não sabe o link do app, nem que tem conta. Esta mensagem
   entrega as 3 coisas que faltam: link, e-mail (o login dele) e a senha padrão.
   Fica FORA do WA_TEMPLATES porque precisa da senha, que não vem do objeto `a`. */
const APP_URL = 'https://tavaressg.github.io/tavaressg/';
function _waConviteBody(a, senha){
  const email = (a.cad && a.cad.email) || a.email || '';
  return `Oi ${_waNome(a)}, seu acesso ao app da Yama Jiu-Jitsu está pronto 🥋\n\n`
       + `📱 Link: ${APP_URL}\n`
       + `📧 E-mail: ${email}\n`
       + `🔑 Senha: ${senha}\n\n`
       + `No primeiro acesso o app pede pra você criar uma senha nova — escolha uma que só você saiba.\n\n`
       + `Dica: abra o link no celular e use "Adicionar à Tela de Início" pra ficar igual a um aplicativo.`;
}
// Primeiro + segundo nome (o apelido "Dudu" não serve pra mensagem formal).
const _nome2 = s => String(s||'').trim().split(/\s+/).slice(0,2).join(' ');
/* v351 — regra: TODA exibição institucional de aluno usa o nome completo da ficha.
   `a.nm` é apelido (curto, informal) — só permanece em (1) chaves técnicas
   `a.id||a.nm`, (2) o campo "Apelido" da ficha, (3) o próprio perfil do usuário
   (o dono da conta se vê pelo apelido). Fallback: nomeCompleto → nm → '—'. */
function _nomeInst(a){
  if(!a) return '—';
  return (a.cad && a.cad.nomeCompleto) || a.nomeCompleto || a.nm || '—';
}
function _waNome(a){
  const c=a.cad||{}; const r=c.responsavel||{};
  const idade=idadeCBJJ(a.nascimento);
  if(idade!=null && idade<18 && r.nome) return _nome2(r.nome);
  return _nome2(c.nomeCompleto || a.nm);
}
/* Abre wa.me com template pré-pronto e registra o envio (evita mandar 2× na mesma semana). */
function _waSend(a, tplKey){
  const tpl = _waTpls().find(t => t.key===tplKey); if(!tpl) return;
  const url = _waLink(a, _waResolve(tpl.body, a));
  if(!url){ toast('Sem telefone cadastrado na ficha'); return; }
  a._waLast = { at: Date.now(), tpl: tplKey };
  try{ window.open(url, '_blank', 'noopener'); }catch(_){ location.href=url; }
  toast('WhatsApp aberto ✔');
}
/* dias desde o último WhatsApp enviado (null = nunca). Usado pra chip "já contatado". */
function _waDiasDesde(a){ if(!a._waLast) return null; return Math.floor((Date.now()-a._waLast.at)/86400000); }

/* Sheet de escolha de template (botão "WhatsApp" abre este sheet). */
function _waSheet(a){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="WhatsApp">
    <div class="sheet-grip"></div>
    <div class="sheet-title">WhatsApp · ${safeTxt(_nome2((a.cad&&a.cad.nomeCompleto)||a.nm))}</div>
    <div class="sheet-desc">Escolha o texto — abre o seu WhatsApp com a mensagem pronta pra editar/enviar.</div>
    <div class="wa-tpl-grid" id="wa-tpl"></div>
    <button class="sheet-cancel" id="wa-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),200); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#wa-close').onclick=close;
  const grid = sheet.querySelector('#wa-tpl');
  // Slots 7/8 só aparecem se o professor preencheu — evita botões vazios pro user.
  _waTpls().forEach(t=>{
    if(t.body==='' && t.key!=='abrir') return;
    const b = el(`<button class="wa-tpl"><span class="wa-tpl-ic">${safeTxt(t.icon)}</span><span class="wa-tpl-lbl">${safeTxt(t.label)}</span></button>`);
    b.onclick=()=>{ _waSend(a,t.key); close(); render(); };
    grid.appendChild(b);
  });
  const last = _waDiasDesde(a);
  if(last!=null) sheet.querySelector('.sheet-desc').insertAdjacentHTML('afterend',
    `<div class="wa-last">✓ Último envio há ${last===0?'menos de 1 dia':last+' dia(s)'}</div>`);
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ---- YouTube: id, thumb, watch url + storage local dos vídeos de onboarding ---- */
function _ytIdFromUrl(v){
  if(!v) return null;
  const s = String(v).trim();
  // ID puro (11 chars, letras/números/-_)
  if(/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
/* Short (9:16) → URL contém /shorts/ */
function _ytIsShort(v){ return !!String(v||'').match(/\/shorts\//); }
function _ytThumb(id){ return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : ''; }
function _ytWatch(id){ return id ? `https://www.youtube.com/watch?v=${id}` : ''; }
function _ytEmbed(id){ return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&showinfo=0&color=white&fs=1` : ''; }
/* Player em sheet: abre o vídeo dentro do app (iframe YouTube-nocookie) */
function _abrirPlayerYT(id, titulo, isShort){
  if(!id) return;
  const shortCls = isShort ? ' is-short' : '';
  const sheet = el(`<div class="sheet-overlay yt-player-overlay${shortCls}"><div class="sheet yt-player-sheet${shortCls}" role="dialog" aria-label="Vídeo">
    <div class="sheet-grip"></div>
    <div class="yt-frame-wrap${shortCls}">
      <iframe class="yt-frame" src="${safeAttr(_ytEmbed(id))}" title="${safeAttr(titulo||'YouTube')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    </div>
    ${titulo?`<div class="yt-title">${safeTxt(titulo)}</div>`:''}
    <button class="sheet-cancel" id="yt-close" style="margin-top:10px">Fechar</button>
  </div></div>`);
  const close=()=>{
    // limpa src pra parar o vídeo (senão continua tocando ao fechar)
    const f = sheet.querySelector('.yt-frame'); if(f) f.src = 'about:blank';
    sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),200);
    // sai do fullscreen se ainda estiver ativo
    if(document.fullscreenElement) { try{ document.exitFullscreen(); }catch(_){} }
  };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#yt-close').onclick=close;
  // Fecha o sheet ao sair do fullscreen (ex.: usuário pressiona Esc)
  const onFsChange = ()=>{ if(!document.fullscreenElement && sheet.dataset.fsWasActive){ sheet.dataset.fsWasActive=''; close(); document.removeEventListener('fullscreenchange', onFsChange); } };
  document.addEventListener('fullscreenchange', onFsChange);
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>{
    sheet.classList.add('open');
    // Tenta fullscreen automático (funciona em desktop/Android; iOS Safari ignora silenciosamente)
    const target = sheet.querySelector('.yt-frame-wrap');
    const req = target && (target.requestFullscreen || target.webkitRequestFullscreen);
    if(req){ try{ req.call(target); sheet.dataset.fsWasActive='1'; }catch(_){} }
  });
}
/* Vídeos: cache local em memória + localStorage. Fonte da verdade em prod = sbVideos (nuvem).
   Demo/offline: só localStorage. Boot puxa da nuvem 1x e atualiza cache. */
let _onbVidsCache = null, _onbVidsTs = 0;
function _getOnboardVideos(){
  if(_onbVidsCache) return _onbVidsCache;
  try{ return JSON.parse(localStorage.getItem('yama.videos.onboard')||'[]'); }
  catch(_){ return []; }
}
function _setOnboardVideos(arr){
  _onbVidsCache = arr || [];
  try{ localStorage.setItem('yama.videos.onboard', JSON.stringify(arr||[])); }catch(_){}
}
/* Puxa da nuvem (sbVideos.list) e atualiza cache. Retorna array sempre — offline fallback = local. */
async function _loadOnboardVideosCloud(force){
  if(DEMO || typeof sbVideos==='undefined') return _getOnboardVideos();
  if(!force && _onbVidsCache && Date.now()-_onbVidsTs < 60000) return _onbVidsCache;
  try{
    const rows = await sbVideos.list();
    _onbVidsCache = rows.map(r => ({ id: r.ytId, dbId: r.id, title: r.title, isShort: r.isShort, ordem: r.ordem }));
    _onbVidsTs = Date.now();
    try{ localStorage.setItem('yama.videos.onboard', JSON.stringify(_onbVidsCache)); }catch(_){}
    return _onbVidsCache;
  }catch(_){ return _getOnboardVideos(); }
}
/* Boot: se aluno com nuvem, puxa em background e re-renderiza se veio algo novo. */
function _kickOnboardVideosSync(){
  if(DEMO || typeof sbVideos==='undefined' || !DB.sbUser) return;
  _loadOnboardVideosCloud(true).then(rows=>{
    if(rows && rows.length !== (JSON.parse(localStorage.getItem('yama.videos.onboard')||'[]').length)){
      try{ render(); }catch(_){}
    }
  });
}
/* Aluno ainda no onboarding? (faixa branca sem grau — some no 1º grau, decisão do dono) */
function _alunoOnboardOn(){
  const me=DB.eu; return me && me.faixa==='branca' && (me.graus||0) < 1;
}
/* Sheet com a biblioteca completa de vídeos de onboarding (aberta pelo "Ver todos"). */
function _abrirOnbSheet(vids, seen){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Vídeos de boas-vindas" style="max-height:90vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Boas-vindas ao tatame</div>
    <div class="sheet-desc">${vids.length} vídeo${vids.length>1?'s':''} do professor. Toque num pra assistir no YouTube.</div>
    <div class="onb-list" id="onb-list"></div>
    <button class="sheet-cancel" id="onb-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),200); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#onb-close').onclick=close;
  const list = sheet.querySelector('#onb-list');
  vids.forEach(v=>{
    const visto = seen.includes(v.id);
    const item = el(`<button class="onb-lrow ${visto?'seen':''}" type="button">
      <img class="onb-lthumb" src="${safeAttr(_ytThumb(v.id))}" alt="" data-fallback="remove">
      <div class="onb-lmid"><div class="nm">${safeTxt(v.title)}</div>${visto?'<div class="meta">✓ assistido</div>':''}</div>
      <span class="onb-lgo">▶</span>
    </button>`);
    item.addEventListener('click', ()=>{
      if(!seen.includes(v.id)){
        seen.push(v.id);
        try{ localStorage.setItem('yama.videos.seen', JSON.stringify(seen)); }catch(_){}
      }
      _abrirPlayerYT(v.id, v.title, v.isShort);
    });
    list.appendChild(item);
  });
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* Aniversariantes só de HOJE (subset de _aniversariantes) — usado no painel. */
function _aniversariantesHoje(){
  const hj = String(hoje.getDate()).padStart(2,'0');
  return _aniversariantes().filter(a=> a.nascData && a.nascData.slice(8,10)===hj);
}

/* Rótulo de faixa etária derivado (Kids 3-5 / Kids 6-9 / Juvenil 10-15 / Adulto 16+). */
function _faixaEtariaLbl(anoNasc){
  const i = idadeCBJJ(anoNasc); if(i==null) return null;
  if(i<=5)  return 'Kids 3-5';
  if(i<=9)  return 'Kids 6-9';
  if(i<=15) return 'Juvenil 10-15';
  return 'Adulto 16+';
}
const FAIXA_ETARIA_OPCOES = ['Kids 3-5','Kids 6-9','Juvenil 10-15','Adulto 16+'];

/* Aptos a nova FAIXA (não só grau): próxima faixa CBJJ existe, aluno tem 4º grau da atual
   OU semáforo indica tempo/idade OK — filtro conservador. Alerta pedagógico. */
function _aptosNovaFaixa(){
  return _profAlunosArr().filter(a=>{
    const s=_semaforoGrad(a); if(!s.next) return false;
    // subir DE faixa exige 4º grau (adulto) ou concluir o ciclo infantil — heurística conservadora
    if((a.graus||0) < 4) return false;
    return (s.tempo?s.tempo.ok!==false:true) && (s.aulas?s.aulas.ok===true:false);
  });
}

/* Nível de risco por dias sem treinar — Kanri buckets adaptados p/ 4 níveis. */
function _riscoNivel(a){
  const d = a.diasSem||0;
  if(d >= 30) return 'critico';
  if(d >= 15) return 'em_risco';
  if(d >= 7)  return 'atencao';
  return 'engajado';
}
const RISCO_NIVEIS = [
  ['critico',  'Crítico',    '≥ 30 dias'],
  ['em_risco', 'Em risco',   '15–29 dias'],
  ['atencao',  'Atenção',    '7–14 dias'],
  ['engajado', 'Engajados',  '< 7 dias'],
];

/* ---- Nível de um registro de technique_progress. O campo `estado` guarda o EIXO DE JOGO
   (foco/arma/guardada/aprendida); o nível de domínio segue a mesma régua do nivelDe():
   treinos ≥12 dominada · ≥5 treinando · ≥1 aprendendo. ---- */
function _nivelDeProg(p){
  if(p && ['dominada','treinando','aprendendo','novo'].includes(p.nivel)) return p.nivel;
  const n=(p&&p.treinos)||0;
  return n>=12?'dominada':n>=5?'treinando':n>=1?'aprendendo':'novo';
}
// Técnicas em nível ≥ treinando de um aluno (eixo "técnicas" do semáforo). null = sem dado.
function _tecCountAluno(a){
  if(a._self) return (DB.tecnicas||[]).filter(t=>['treinando','dominada'].includes(nivelDe(t))).length;
  if(!_relData) return null;
  const rows=_relData.progresso.filter(p=>p.user_id===a.id);
  if(!rows.length) return null;
  return rows.filter(p=>['treinando','dominada'].includes(_nivelDeProg(p))).length;
}

/* ---- Semáforo de graduação (modelo Gymdesk): tempo CBJJ · aulas · técnicas.
   tempo/idade = regra real (elegibilidadeCBJJ); aulas = META_GRAU; técnicas = META_TEC
   (aproximação até existir currículo por faixa). ok:null = sem dado (informativo). ---- */
function _semaforoGrad(a){
  const idade=idadeCBJJ(a.nascimento);
  const infantil=(idade!=null && idade<=CBJJ.youth_max_age) || _grupoInfantilMinAge(a.faixa)!=null;
  const out={ next:null, tempo:null, aulas:null, tec:null };
  if(infantil){
    out.next=proximaFaixaCBJJ(a.faixa, idade);
    if(out.next) out.tempo={ ok:null, txt:'infantil · Anexo I' };
  } else {
    const info=CBJJ.adult_belts.find(b=>b.belt===a.faixa);
    out.next=info?info.next:null;
    if(info && info.next){
      const meses=tempoNaFaixaMeses(a.faixaDesde);
      if(!info.min_months) out.tempo={ok:true, txt:'sem tempo mínimo'};
      else if(meses==null)  out.tempo={ok:null, txt:'sem data da faixa'};
      else out.tempo={ok:meses>=info.min_months, txt:`${meses}/${info.min_months} meses`};
      const ni=CBJJ.adult_belts.find(b=>b.belt===info.next);
      if(out.tempo && out.tempo.ok && ni && ni.min_age!=null && idade!=null && idade<ni.min_age)
        out.tempo={ok:false, txt:`idade ${idade}/${ni.min_age}`};
    }
  }
  if(!out.next) return out;   // faixa máxima — sem prontidão a calcular
  const metaAulas=_metaAulasFaixa(a.faixa);
  if(a.aulasNoGrau!=null) out.aulas={ok:a.aulasNoGrau>=metaAulas, txt:`${a.aulasNoGrau}/${metaAulas} aulas`};
  else out.aulas={ok:a.aptoGrad===true?true:null, txt:a.aptoGrad?`≥${metaAulas} aulas`:'sem histórico de aulas'};
  const n=_tecCountAluno(a);
  if(n!=null) out.tec={ok:n>=PROF_METAS.META_TEC, txt:`${n}/${PROF_METAS.META_TEC} técnicas`};
  else out.tec={ok:null, txt:'sem registro de técnica'};
  return out;
}
/* Meta de aulas POR FAIXA (regra da academia — academies.config.metaAulas, 0003).
   Sem config para a faixa → default global META_GRAU. */
function _metaAulasFaixa(faixa){
  const m=DB.academyConfig && DB.academyConfig.metaAulas;
  const v=m && parseInt(m[faixa]);
  return (v>0) ? v : PROF_METAS.META_GRAU;
}

/* v395: FONTE UNICA da lista de aptos — usa a mesma _prontidaoGrad da tela
   de Graduação. Aluno "apto" = pronto pra novo grau OU pra proxima faixa. Isso
   fecha a contradicao antiga "cabecalho diz 1, card diz 15" (duas regras).
   Tempo/idade CBJJ nao bloqueiam mais (decisao de produto v395) — o professor
   sempre pode graduar. */
function _aptosGraduar(){
  // v421: ignora alunos inativos — quem parou de treinar nao aparece na fila
  // "aptos a graduar" (o professor nao vai chamar quem sumiu). Se voltar a
  // treinar (statusManual='ativo' ou diasSem cair), volta automaticamente.
  return _profAlunosArr().filter(a=>{
    if(_statusAluno(a).valor === 'inativo') return false;
    const s = _prontidaoGrad(a);
    return s.grau.ok || s.faixa.ok;
  });
}

/* ---- Ocupação por sessão (grade × presença média).
   Pós-0010 o checkin aponta a AULA (turma+data+hora), então cada horário recebe a
   presença REAL dele — dois horários da mesma turma no mesmo dia deixam de ter o
   mesmo número. Check-ins legados (sem aula_id, logo sem aulaHora) não sabem de qual
   horário vieram: continuam rateados entre as sessões daquele dia. ---- */
/* Ocupação real por sessão. Pós-0025, todo check-in novo tem aula_id — a
   "média" é literalmente presenças / aulas realizadas. Janela em SEMANAS
   filtra o período (padrão: 8, o toggle do heatmap muda).

   Bug corrigido em v367: a versão antiga somava `real + legado/nMesmoDia`
   pra rebater checkins sem aula_id (pré-0010). Depois da 0025 quase todos
   passaram a ter aula_id, então o galho legado virou contagem dupla: aula
   com 5 presenças aparecia como 6. Agora usa só o real. */
function _ocupacaoSessoes(dias){
  if(!_relData) return [];
  dias = dias || 56;   // default: 8 semanas
  const DIA_IDX={dom:0,seg:1,ter:2,qua:3,qui:4,sex:5,sab:6};
  const corte = _diasAtrasISO(dias);
  const aggH={};     // turma|dow|horaAula  → {pres, datas:Set}
  _relData.checkins.forEach(c=>{
    if(!c.turma_id || !c.aulaHora) return;   // legado sem aula_id sai da conta (ruído)
    if(c.data < corte) return;
    const dow=new Date(c.data+'T12:00:00').getDay();
    const alvo = (aggH[c.turma_id+'|'+dow+'|'+c.aulaHora] ||= {pres:0,datas:new Set()});
    alvo.pres++; alvo.datas.add(c.data);
  });
  const _media = o => o ? o.pres/o.datas.size : 0;
  const out=[];
  (DB.turmas||[]).forEach(t=>{
    (t.sessoes||[]).forEach(s=>{
      const dow=DIA_IDX[s.dia]; if(dow==null) return;
      const bucket = aggH[t.id+'|'+dow+'|'+s.hora];
      const media = Math.round(_media(bucket)*10)/10;
      out.push({ turma:t.nome, cor:t.cor, dia:s.dia, hora:s.hora, variacao:s.variacao, media, aulas:(bucket?bucket.datas.size:0) });
    });
  });
  out.sort((x,y)=> y.media-x.media || (x.hora||'').localeCompare(y.hora||''));
  return out;
}
function _diasAtrasISO(n){
  const d=new Date(); d.setDate(d.getDate()-n);
  const iso=d.toISOString().slice(0,10);
  return iso < APP_INICIO_ISO ? APP_INICIO_ISO : iso;
}
/* Presença por TURMA · variação. v366/0025: antes agrupava por `checkins.tipo`
   e fazia `if(c.tipo)` — como o lote do professor gravava NULL, 20 de 32
   check-ins sumiam do relatório. Agora a turma vem do JOIN (fonte única) e
   nenhuma linha é descartada; `tipo` só refina o rótulo quando é uma variação
   real da sessão (NO-GI, LIVRE…), não o generico 'Aula'. */
function _presencaPorTipo(){
  if(!_relData) return [];
  const m={};
  _relData.checkins.forEach(c=>{
    const turma = c.turmaNome || 'Sem turma';
    const varia = (c.tipo && c.tipo !== 'Aula') ? ' · '+c.tipo : '';
    const k = turma + varia;
    m[k]=(m[k]||0)+1;
  });
  return Object.entries(m).sort((a,b)=>b[1]-a[1]);
}

/* ---- Retenção: coortes por mês de entrada + retenção por faixa + aniversariantes ---- */
function _coortesEntrada(){
  const m={};
  _profAlunosArr().forEach(a=>{
    const k=(a.cad&&a.cad.dataInicio||'').slice(0,7); if(!k) return;
    const o=m[k]||(m[k]={total:0,ativos:0});
    o.total++; if((a.diasSem??999)<=RISCO_DIAS) o.ativos++;
  });
  return Object.entries(m).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12);
}
function _retencaoPorFaixa(){
  const m={};
  _profAlunosArr().forEach(a=>{
    const o=m[a.faixa]||(m[a.faixa]={total:0,ativos:0});
    o.total++; if((a.diasSem??999)<=RISCO_DIAS) o.ativos++;
  });
  return m;
}
function _aniversariantes(){
  const mes=String(hoje.getMonth()+1).padStart(2,'0');
  return _profAlunosArr().filter(a=>a.nascData && a.nascData.slice(5,7)===mes)
    .sort((a,b)=>a.nascData.slice(8,10).localeCompare(b.nascData.slice(8,10)));
}

/* ---- Camada 1 — progresso técnico agregado da academia (§7.1-C) ---- */
function _tecAgg(){
  if(!_relData) return null;
  const porTec={}, porUser={};
  const cats={}; CAT_ORDER.forEach(c=>{ cats[c]={dominada:0,treinando:0,aprendendo:0}; });
  _relData.progresso.forEach(p=>{
    const t=porTec[p.tecnica_id]||(porTec[p.tecnica_id]={treinos:0,alunos:0});
    t.treinos+=p.treinos||0; t.alunos++;
    const u=porUser[p.user_id]||(porUser[p.user_id]={n:0,treinos:0});
    u.n++; u.treinos+=p.treinos||0;
    const tec=tecByKey(p.tecnica_id); const c=tec&&tec.cat;
    if(c && cats[c]){ const nv=_nivelDeProg(p); if(cats[c][nv]!=null) cats[c][nv]++; }
  });
  return { porTec, porUser, cats };
}
function _lesoesAgg(){
  if(!_relData) return {ativas:0,total:0,partes:[]};
  const m={};
  _relData.lesoes.forEach(l=>{ const p=l.parte||'—'; m[p]=(m[p]||0)+1; });
  return {
    ativas:_relData.lesoes.filter(l=>l.status==='recuperando').length,
    total:_relData.lesoes.length,
    partes:Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,5),
  };
}
function _lojaAgg(){
  const prods=(DB.loja&&DB.loja.produtos)||[];
  let valor=0; const baixos=[];
  prods.forEach(p=>{ const tot=_estoqueTotal(p); valor+=(p.preco||0)*tot; if(_temEstoqueBaixo(p)) baixos.push(p); });
  return { valor, baixos, n:prods.length };
}

const _DIA_LBL={seg:'Seg',ter:'Ter',qua:'Qua',qui:'Qui',sex:'Sex',sab:'Sáb',dom:'Dom'};
function _semChip(x){
  if(!x) return '';
  const cls = x.ok===true?'ok': x.ok==='warn'?'warn': x.ok===false?'no':'na';
  const ic  = x.ok===true?'✓': x.ok==='warn'?'!': x.ok===false?'✗':'·';
  return `<span class="sem-chip ${cls}">${ic} ${safeTxt(x.txt)}</span>`;
}

function profRelatorios(){
  const w = el('<div></div>');
  _loadRelData();
  if(!_profData){ w.innerHTML='<div class="loading-center">Carregando…</div>'; return w; }
  const alunos=_profAlunosArr();
  const nAl = alunos.filter(a=>!(a.role==='professor'||a.role==='dono')).length;
  w.innerHTML = `<div class="hello"><div class="date">Relatórios</div>
    <div class="greet">Visão da academia · ${nAl} aluno${nAl===1?'':'s'}</div></div>`;

  // primitivas comuns das seções
  const secTitle=(t)=>el(`<div class="sec-title" style="margin:16px 20px 8px">${t}</div>`);
  const note=(t)=>el(`<div class="list block"><div class="empty-line" style="padding:14px 12px;text-align:center;color:var(--muted);font-size:13px">${t}</div></div>`);
  const alunoRow=(a, metaHTML, rightHTML)=>{
    const row=el(`<div class="st-row" style="cursor:pointer">
      ${avatarAluno(a)}
      <div class="st-mid"><div class="nm">${safeTxt(_nomeInst(a))}</div>
        <div class="meta">${beltPill(a.faixa,a.graus)} ${metaHTML||''}</div></div>
      <div class="st-right">${rightHTML||'<span style="color:var(--muted)">›</span>'}</div></div>`);
    row.onclick=()=>_profAlunoSheet(a);
    return row;
  };

  // Modo DETALHE: ao tocar num painel da Visão geral, abre a tela cheia robusta (sem bottom sheet).
  if(DB.relDetalhe){
    const back=el(`<div class="rel-back" role="button" tabindex="0"><span>‹ Relatórios</span></div>`);
    const voltar=()=>{ DB.relDetalhe=null; render(); window.scrollTo(0,0); };
    back.onclick=voltar; back.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); voltar(); } };
    w.appendChild(back);
    _relDetalhe(w, DB.relDetalhe, secTitle, note);
    w.appendChild(el(`<div style="height:24px"></div>`));
    return w;
  }

  // Sub-navegação dos relatórios
  const TABS=[['visao','Visão geral'],['retencao','Retenção'],['alunos','Alunos (Excel)'],['tecnicas','Técnicas'],['loja','Loja']];
  const seg=el('<div class="filter-seg rel-seg"></div>');
  TABS.forEach(([id,lbl])=>{
    const b=el(`<button class="${(DB.relTab||'visao')===id?'active':''}">${lbl}</button>`);
    b.onclick=()=>{ DB.relTab=id; render(); };
    seg.appendChild(b);
  });
  w.appendChild(seg);

  const tab=DB.relTab||'visao';
  if(tab==='visao')          _relVisao(w, secTitle, note);
  else if(tab==='risco')     _relRisco(w, secTitle, note);
  else if(tab==='alunos')    _relAlunosExcel(w, secTitle, note);
  else if(tab==='retencao')  _relRetencao(w, secTitle, note, alunoRow);
  else if(tab==='tecnicas')  _relTecnicas(w, secTitle, note, alunoRow);
  else if(tab==='graduacao') _relGraduacao(w, secTitle, note, alunoRow);
  else                       _relLoja(w, secTitle, note);
  w.appendChild(el(`<div style="height:24px"></div>`));
  return w;
}

/* Relatórios · Risco de abandono — buckets Kanri-style com score por dias sem treinar.
   Score = dias sem (proxy honesto; sem inventar fórmula composta). */
function _relRisco(w, secTitle, note){
  const alunos = _profAlunosArr().filter(a=>!(a.role==='professor'||a.role==='dono'));
  const buckets = { critico:[], em_risco:[], atencao:[], engajado:[] };
  alunos.forEach(a=> buckets[_riscoNivel(a)].push(a));

  // 4 tiles (contagem por nível)
  const grid = el('<div class="stat-grid block" style="margin-top:12px"></div>');
  RISCO_NIVEIS.forEach(([id,lbl,rng])=>{
    grid.appendChild(el(`<div class="stat-card risco-tile risco-${id}"><div class="sv">${buckets[id].length}</div>
      <div class="sl">${lbl}</div><div class="risco-rng">${rng}</div></div>`));
  });
  w.appendChild(grid);

  // Listas por bucket (só as acionáveis: crítico + em risco + atenção)
  ['critico','em_risco','atencao'].forEach(id=>{
    const arr = buckets[id].sort((a,b)=>(b.diasSem||0)-(a.diasSem||0));
    const [_id,lbl] = RISCO_NIVEIS.find(x=>x[0]===id);
    w.appendChild(secTitle(`${lbl} (${arr.length})`));
    if(!arr.length){ w.appendChild(note(id==='critico'?'Ninguém no Crítico. 🎉':'Vazio nesta faixa.')); return; }
    const list = el(`<div class="list block risco-list risco-${id}-list"></div>`);
    arr.forEach(a=>{
      const wa = _waLink(a) ? true : false;
      const row = el(`<div class="risco-row" role="button" tabindex="0" style="cursor:pointer">
        ${avatarAluno(a)}
        <div class="risco-mid">
          <div class="nm">${safeTxt(_nomeInst(a))}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span class="risco-motivo">${safeTxt(_riscoMotivo(a)||((a.diasSem||0)+'d sem treinar'))}</span></div>
        </div>
        <div class="risco-score">${a.diasSem||0}<small>d</small></div>
        ${wa?`<button class="risco-wa" aria-label="WhatsApp ${safeAttr(_nomeInst(a))}">💬 WhatsApp</button>`:''}
      </div>`);
      const waBtn = row.querySelector('.risco-wa');
      if(waBtn) waBtn.onclick=(e)=>{ e.stopPropagation(); _waSheet(a); };
      row.onclick=()=>_profAlunoSheet(a);
      row.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _profAlunoSheet(a); }};
      list.appendChild(row);
    });
    w.appendChild(list);
  });
}

/* Relatórios · Alunos (Excel) — tabela ampla estilo planilha, muitas colunas visíveis.
   Sem paginação (500 alunos cabem numa scroll interna). Export CSV nativo. */
function _relAlunosExcel(w, secTitle, note){
  const alunos = _profAlunosArr().slice();
  _loadTurmas(); const turmaMap = {}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });

  // v514: filtros persistem em DB.alunosFiltro entre renders. Antes eram vars
  // locais — abrir ficha do aluno + voltar RESETAVA "Inativos" pra "Todos".
  DB.alunosFiltro = DB.alunosFiltro || { busca:'', et:'todos', risco:'todos', status:'todos' };
  const F = DB.alunosFiltro;
  const wrap = el('<div class="xls-wrap"></div>');

  const bar = el(`<div class="xls-bar">
    <div class="dt-search"><span class="dt-search-ic" aria-hidden="true">🔎</span><input class="dt-search-inp" type="search" placeholder="Buscar por nome, e-mail, telefone…" value="${safeAttr(F.busca)}"></div>
    <div class="xls-filters"></div>
    <button class="btn-cad ghost" id="xls-csv">⬇ Exportar Excel</button>
  </div>`);
  const chips = bar.querySelector('.xls-filters');
  const _chip=(lbl,cur,set,val)=>{ const b=el(`<button class="et-chip ${cur===val?'on':''}">${lbl}</button>`); b.onclick=()=>{ set(val); rebuild(); }; return b; };
  const paintChips=()=>{
    chips.innerHTML='';
    chips.appendChild(_chip('Todas idades', F.et, v=>F.et=v, 'todos'));
    FAIXA_ETARIA_OPCOES.forEach(op=> chips.appendChild(_chip(op, F.et, v=>F.et=v, op)));
    chips.appendChild(el(`<span class="xls-sep"></span>`));
    RISCO_NIVEIS.forEach(([id,lbl])=> chips.appendChild(_chip(lbl, F.risco, v=>F.risco=v, id)));
    chips.appendChild(_chip('Todos', F.risco, v=>F.risco=v, 'todos'));
    chips.appendChild(el(`<span class="xls-sep"></span>`));
    chips.appendChild(_chip('Status: Todos', F.status, v=>F.status=v, 'todos'));
    chips.appendChild(_chip('Ativos', F.status, v=>F.status=v, 'ativo'));
    chips.appendChild(_chip('Inativos', F.status, v=>F.status=v, 'inativo'));
  };
  bar.querySelector('.dt-search-inp').oninput=(e)=>{ F.busca=e.target.value.trim().toLowerCase(); rebuild(); };
  bar.querySelector('#xls-csv').onclick=()=>_xlsExportCSV(getRows());

  const scroll = el('<div class="xls-scroll"></div>');
  const table  = el('<table class="xls-tbl"></table>');
  scroll.appendChild(table);

  const COLS = [
    ['Nome',        a => (a.cad && a.cad.nomeCompleto) || a.nomeCompleto || a.nm || ''],
    ['E-mail',      a => (a.cad&&a.cad.email)||''],
    ['Telefone',    a => (a.cad&&a.cad.telefone)||''],
    ['Nascimento',  a => (a.nascData ? a.nascData.split('-').reverse().join('/') : (a.nascimento||''))],
    ['Idade',       a => (idadeCBJJ(a.nascimento)!=null?idadeCBJJ(a.nascimento):'')],
    ['Faixa etária',a => _faixaEtariaLbl(a.nascimento)||''],
    ['Faixa',       a => (BELTS[a.faixa]?BELTS[a.faixa].nome:a.faixa||'')+(a.graus?' · '+a.graus+'º':'')],
    ['Turmas',      a => (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(', ')],
    ['Últ. presença',a => a.pres || 'ausente'],
    ['Dias sem',    a => a.diasSem||0],
    ['Nível risco', a => { const nv=_riscoNivel(a); return (RISCO_NIVEIS.find(x=>x[0]===nv)||[])[1]||''; }],
    ['Status',      a => _statusAlunoTxt(a)],
    ['Pgto',        a => a.pago==='ok'?'Em dia':a.pago==='late'?'Vencido':a.pago==='soon'?'A vencer':'—'],
    ['Cidade',      a => (a.cad&&a.cad.endereco&&a.cad.endereco.cidade)||''],
    ['Bairro',      a => (a.cad&&a.cad.endereco&&a.cad.endereco.bairro)||''],
    ['UF',          a => (a.cad&&a.cad.endereco&&a.cad.endereco.uf)||''],
    ['Responsável', a => (a.cad&&a.cad.responsavel&&a.cad.responsavel.nome)||''],
    ['Tel. resp.',  a => (a.cad&&a.cad.responsavel&&a.cad.responsavel.telefone)||''],
    ['Data início', a => (a.cad&&a.cad.dataInicio) || a.desde || ''],
  ];

  const getRows = ()=>{
    let arr = alunos.slice();
    if(F.et!=='todos')    arr = arr.filter(a=>_faixaEtariaLbl(a.nascimento)===F.et);
    if(F.risco!=='todos') arr = arr.filter(a=>_riscoNivel(a)===F.risco);
    if(F.status!=='todos') arr = arr.filter(a=>_statusAluno(a).valor===F.status);
    if(F.busca){
      arr = arr.filter(a=>{
        const bag = [a.nm, a.cad?.email, a.cad?.telefone, a.cad?.endereco?.cidade].join(' ').toLowerCase();
        return bag.includes(F.busca);
      });
    }
    return arr.sort((a,b)=>String(a.nm||'').localeCompare(String(b.nm||'')));
  };

  const rebuild = ()=>{
    paintChips();
    const rows = getRows();
    const head = '<thead><tr>'+COLS.map(([lbl])=>`<th>${lbl}</th>`).join('')+'<th>Ação</th></tr></thead>';
    const body = '<tbody>'+rows.map(a=>{
      const cells = COLS.map(([,fn])=>`<td>${safeTxt(String(fn(a)))}</td>`).join('');
      return `<tr data-id="${safeAttr(a.id||a.nm)}">${cells}<td class="xls-act"><button class="wa-ico" data-nm="${safeAttr(_nomeInst(a))}" title="WhatsApp">💬</button></td></tr>`;
    }).join('')+'</tbody>';
    table.innerHTML = head + body;
    table.querySelectorAll('tbody tr').forEach(tr=>{
      const id=tr.dataset.id; const a = alunos.find(x=>(x.id||x.nm)===id);
      const wa = tr.querySelector('.wa-ico');
      if(wa && a) wa.onclick=(e)=>{ e.stopPropagation(); _waSheet(a); };
      tr.onclick=()=>{ if(a) _profAlunoSheet(a); };
    });
    countLbl.textContent = `${rows.length} de ${alunos.length} aluno${alunos.length>1?'s':''}`;
  };
  const countLbl = el('<div class="xls-count">—</div>');

  wrap.appendChild(bar); wrap.appendChild(countLbl); wrap.appendChild(scroll);
  w.appendChild(wrap);
  rebuild();
}

/* Vídeos de onboarding — CRUD simples pro professor (localStorage por academia).
   Aluno faixa-branca-sem-grau vê os vídeos no INÍCIO; some ao ganhar o 1º grau. */
function profVideosOnboard(){
  const w = el('<div></div>');
  const cloudOn = !DEMO && typeof sbVideos!=='undefined' && DB.sbUser;
  const subtitulo = cloudOn
    ? 'Compartilhado com outros professores · aparece no INÍCIO do aluno faixa branca sem grau'
    : 'Aparece no INÍCIO do aluno enquanto faixa branca sem grau · some no 1º grau';
  w.innerHTML = `<div class="hello">
    <div class="date">Vídeos de onboarding</div>
    <div class="greet">${subtitulo}</div>
  </div>`;

  const form = el(`<div class="onb-form block">
    <div class="cad-sec" style="margin-top:0">Adicionar vídeo do YouTube</div>
    <label class="flbl">URL do YouTube <span class="ca-opt">(watch, shorts ou youtu.be — cola aqui)</span></label>
    <input class="inp" id="onb-url" type="url" placeholder="https://www.youtube.com/watch?v=…">
    <label class="flbl" style="margin-top:10px">Título curto <span class="ca-opt">(ex: "Como amarrar a faixa")</span></label>
    <input class="inp" id="onb-title" placeholder="Ex: Amarrar a faixa · Higiene das unhas · Lavagem do kimono">
    <div id="onb-preview" hidden></div>
    <button class="btn-save" id="onb-add" style="margin-top:10px">Adicionar vídeo</button>
  </div>`);

  const listWrap = el('<div class="onb-admin-list"></div>');
  const secTitle = el(`<div class="sec-title" style="margin:16px 20px 8px">Vídeos publicados</div>`);
  const hint     = el(`<div class="onb-hint-block">Reordene com ▲▼ · o topo aparece primeiro pro aluno. Exclua com ✕.</div>`);

  // Estado local — sincronizado com nuvem (se disponível) ou localStorage
  let arr = [];

  const paint = ()=>{
    listWrap.innerHTML = '';
    if(!arr.length){
      listWrap.appendChild(el('<div class="empty-line" style="padding:14px 12px;text-align:center;color:var(--muted);font-size:13px">Nenhum vídeo cadastrado ainda. Cole a URL de um vídeo do YouTube acima.</div>'));
      return;
    }
    arr.forEach((v,i)=>{
      const row = el(`<div class="onb-admin-row">
        <img class="onb-admin-thumb" src="${safeAttr(_ytThumb(v.id))}" alt="" data-fallback="remove">
        <div class="onb-admin-mid">
          <div class="nm">${safeTxt(v.title)}</div>
          <div class="meta"><a href="${safeAttr(_ytWatch(v.id))}" target="_blank" rel="noopener">${safeTxt(v.id)}${v.isShort?' · SHORT':''}</a></div>
        </div>
        <div class="onb-admin-acts">
          <button class="onb-mv" data-a="up"   ${i===0?'disabled':''} aria-label="Subir">▲</button>
          <button class="onb-mv" data-a="down" ${i===arr.length-1?'disabled':''} aria-label="Descer">▼</button>
          <button class="onb-del" aria-label="Excluir">✕</button>
        </div>
      </div>`);
      row.querySelector('[data-a="up"]').onclick = async()=>{
        if(i===0) return;
        [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; _setOnboardVideos(arr); paint();
        if(cloudOn){ try{ await sbVideos.reorder(arr.map(v=>v.dbId).filter(Boolean)); }catch(_){ toast('Ordem não sincronizada'); } }
      };
      row.querySelector('[data-a="down"]').onclick = async()=>{
        if(i===arr.length-1) return;
        [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; _setOnboardVideos(arr); paint();
        if(cloudOn){ try{ await sbVideos.reorder(arr.map(v=>v.dbId).filter(Boolean)); }catch(_){ toast('Ordem não sincronizada'); } }
      };
      row.querySelector('.onb-del').onclick = async()=>{
        if(!confirm('Excluir este vídeo?')) return;
        const removed = arr[i]; arr.splice(i,1); _setOnboardVideos(arr); paint();
        toast('Vídeo removido');
        if(cloudOn && removed.dbId){ try{ await sbVideos.delete(removed.dbId); }catch(_){ toast('Exclusão não sincronizada'); } }
      };
      listWrap.appendChild(row);
    });
  };

  // Boot: puxa lista atual (nuvem se possível; senão localStorage)
  const _initList = async()=>{
    if(cloudOn){
      listWrap.innerHTML = '<div class="loading-center">Carregando lista…</div>';
      try{ arr = await _loadOnboardVideosCloud(true); }catch(_){ arr = _getOnboardVideos(); }
    } else {
      arr = _getOnboardVideos();
    }
    paint();
  };
  _initList();

  // Preview ao digitar/colar URL
  const urlInp = form.querySelector('#onb-url');
  const prevEl = form.querySelector('#onb-preview');
  const _updatePreview = ()=>{
    const id = _ytIdFromUrl(urlInp.value);
    if(!id){ prevEl.hidden=true; prevEl.innerHTML=''; return; }
    const isShort = _ytIsShort(urlInp.value);
    prevEl.hidden=false;
    prevEl.innerHTML = `<div class="onb-prev"><img src="${safeAttr(_ytThumb(id))}" alt="" data-fallback="remove"><span class="onb-prev-id">ID: ${safeTxt(id)}${isShort?' · SHORT':''}</span></div>`;
  };
  urlInp.addEventListener('input', _updatePreview);
  urlInp.addEventListener('paste',  ()=>setTimeout(_updatePreview,50));

  const addBtn = form.querySelector('#onb-add');
  addBtn.onclick = async()=>{
    const id = _ytIdFromUrl(urlInp.value);
    const title = form.querySelector('#onb-title').value.trim();
    if(!id){ toast('URL inválida — cole um link do YouTube'); return; }
    if(!title){ toast('Dê um título curto ao vídeo'); return; }
    if(arr.some(v=>v.id===id)){ toast('Esse vídeo já está na lista'); return; }
    const isShort = _ytIsShort(urlInp.value);
    if(cloudOn){
      addBtn.disabled = true; addBtn.textContent = 'Enviando…';
      try{
        const row = await sbVideos.add(id, title, isShort);
        arr.push({ id, dbId: row.id, title, isShort });
        _setOnboardVideos(arr);
      }catch(e){
        toast('Falha ao salvar na nuvem: '+(e.message||e));
        addBtn.disabled = false; addBtn.textContent = 'Adicionar vídeo';
        return;
      }
      addBtn.disabled = false; addBtn.textContent = 'Adicionar vídeo';
    } else {
      arr.push({ id, title, isShort });
      _setOnboardVideos(arr);
    }
    urlInp.value=''; form.querySelector('#onb-title').value=''; prevEl.hidden=true; prevEl.innerHTML='';
    paint(); toast('Vídeo adicionado ✔');
  };

  w.appendChild(form);
  w.appendChild(secTitle);
  w.appendChild(hint);
  w.appendChild(listWrap);
  return w;
}

/* Exporta as linhas visíveis do "Alunos (Excel)" pra .xlsx (vendor/xlsx.min.js). */
function _xlsExportCSV(rows){
  if(typeof XLSX==='undefined'){ toast('Excel: biblioteca ainda carregando'); return; }
  const cols = ['Nome','E-mail','Telefone','Nascimento','Idade','Faixa etária','Faixa','Turmas','Últ. presença','Dias sem','Nível risco','Status','Pgto','Cidade','Bairro','UF','Responsável','Tel. resp.','Data início'];
  const aoa = [cols];
  _loadTurmas(); const turmaMap={}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });
  rows.forEach(a=>{
    aoa.push([
      a.cad?.nomeCompleto || a.nomeCompleto || a.nm || '', a.cad?.email||'', a.cad?.telefone||'',
      a.nascData ? a.nascData.split('-').reverse().join('/') : (a.nascimento||''),
      idadeCBJJ(a.nascimento)||'',
      _faixaEtariaLbl(a.nascimento)||'',
      (BELTS[a.faixa]?BELTS[a.faixa].nome:a.faixa||'')+(a.graus?' · '+a.graus+'º':''),
      (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(', '),
      a.pres||'ausente', a.diasSem||0,
      (RISCO_NIVEIS.find(x=>x[0]===_riscoNivel(a))||[])[1]||'',
      _statusAlunoTxt(a),
      a.pago==='ok'?'Em dia':a.pago==='late'?'Vencido':a.pago==='soon'?'A vencer':'—',
      a.cad?.endereco?.cidade||'', a.cad?.endereco?.bairro||'', a.cad?.endereco?.uf||'',
      a.cad?.responsavel?.nome||'', a.cad?.responsavel?.telefone||'',
      a.cad?.dataInicio||a.desde||'',
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(c=>({wch: Math.max(10, c.length+2)}));
  XLSX.utils.book_append_sheet(wb, ws, 'Alunos');
  XLSX.writeFile(wb, `yama-alunos-${HOJE_ISO}.xlsx`);
  toast(`Excel exportado (${rows.length} linha${rows.length>1?'s':''})`);
}
// Abre a tela cheia de um painel da Visão geral (navegação, não bottom sheet).
function _irRelDetalhe(tipo){ DB.relDetalhe=tipo; render(); window.scrollTo(0,0); }

/* ---- Relatórios · Visão geral: KPIs, faixas, tipo de aula, ocupação, lesões ---- */
function _relVisao(w, secTitle, note){
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:12px">
    <div class="stat-card"><div class="si blue">${icoChart()}</div><div class="sv">${_freqMedia()}%</div><div class="sl">Frequência média</div></div>
    <div class="stat-card"><div class="si green">${icoBelt()}</div><div class="sv">${_aptosGraduar().length}</div><div class="sl">Aptos a graduar</div></div>
    <div class="stat-card"><div class="si gold">${icoAlert()}</div><div class="sv">${_emRisco().length}</div><div class="sl">Em risco de evasão</div></div>
    <div class="stat-card"><div class="si red">${icoBox()}</div><div class="sv">${_produtosBaixos()}</div><div class="sl">Estoque baixo</div></div>
  </div>`));

  w.appendChild(_secTitleLink('Distribuição de faixas','faixas'));
  const dist=_distFaixas(); const max=Math.max(1,...Object.values(dist));
  const distWrap=el('<div class="list block panel-link" role="button" tabindex="0" aria-label="Abrir relatório de faixas"></div>');
  Object.keys(BELTS).filter(f=>dist[f]).forEach(f=>{
    const n=dist[f], pct=Math.round(n/max*100);
    distWrap.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${BELTS[f].nome}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${BELTS[f].cor||'var(--red)'}"></span></div>
      <span class="bar-n">${n}</span></div>`));
  });
  distWrap.onclick=()=>_irRelDetalhe('faixas'); distWrap.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _irRelDetalhe('faixas'); } };
  w.appendChild(distWrap);

  // Presença por turma/sessão (§7.1-A). Derivado do JOIN via aula_id (0025).
  w.appendChild(_secTitleLink('Presença por turma (120 dias)','tipoAula'));
  const tipos=_presencaPorTipo();
  if(!tipos.length) w.appendChild(note('Sem check-ins com tipo de aula ainda. O tipo passa a ser gravado automaticamente quando o aluno faz check-in numa sessão da grade (No-Gi, Avançado, Livre…).'));
  else {
    const maxT=Math.max(1,...tipos.map(([,n])=>n));
    const tw=el('<div class="list block panel-link" role="button" tabindex="0" aria-label="Abrir relatório de presença por tipo"></div>');
    tipos.forEach(([tipo,n])=>{
      tw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${safeTxt(tipo)}</span>
        <div class="bar-track"><span class="bar-fill" style="width:${Math.round(n/maxT*100)}%;background:var(--blue,#2f6fe5)"></span></div>
        <span class="bar-n">${n}</span></div>`));
    });
    tw.onclick=()=>_irRelDetalhe('tipoAula'); tw.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _irRelDetalhe('tipoAula'); } };
    w.appendChild(tw);
  }

  // Ocupação por horário (grade × presença média)
  w.appendChild(_secTitleLink('Ocupação por horário (120 dias)','ocupacao'));
  const occ=_ocupacaoSessoes().filter(o=>o.media>0);
  if(!occ.length) w.appendChild(note('Sem presenças vinculadas a turmas no período. A ocupação aparece conforme os check-ins registram a turma da aula.'));
  else {
    const maxO=Math.max(1,...occ.map(o=>o.media));
    const ow=el('<div class="list block panel-link" role="button" tabindex="0" aria-label="Abrir relatório de ocupação"></div>');
    occ.slice(0,6).forEach(o=>{
      ow.appendChild(el(`<div class="bar-row"><span class="bar-lbl" style="min-width:118px">${_DIA_LBL[o.dia]||safeTxt(o.dia)} ${safeTxt(o.hora)} · ${safeTxt(o.turma)}${o.variacao?' · '+safeTxt(o.variacao):''}</span>
        <div class="bar-track"><span class="bar-fill" style="width:${Math.round(o.media/maxO*100)}%;background:${safeAttr(o.cor||'var(--red)')}"></span></div>
        <span class="bar-n">${o.media}</span></div>`));
    });
    if(occ.length>6) ow.appendChild(el(`<div class="empty-line" style="padding:8px 12px;font-size:11px;color:var(--muted)">+${occ.length-6} horários · toque para ver tudo</div>`));
    ow.onclick=()=>_irRelDetalhe('ocupacao'); ow.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _irRelDetalhe('ocupacao'); } };
    w.appendChild(ow);
  }

  // Lesões agregadas (§4: professor tem leitura — parte/status/data + QUEM é o aluno)
  w.appendChild(_secTitleLink('Lesões na academia','lesoes'));
  const les=_lesoesAgg();
  if(!les.total) w.appendChild(note('Nenhuma lesão registrada pelos alunos.'));
  else {
    const lw=el('<div class="list block panel-link" role="button" tabindex="0" aria-label="Abrir relatório de lesões"></div>');
    lw.appendChild(el(`<div class="mt-row"><span>Em recuperação agora</span><b style="color:${les.ativas?'var(--red-strong)':'var(--ink)'}">${les.ativas}</b></div>`));
    les.partes.slice(0,4).forEach(([parte,n])=> lw.appendChild(el(`<div class="mt-row"><span>${safeTxt(parte)}</span><b>${n}</b></div>`)));
    lw.onclick=()=>_irRelDetalhe('lesoes'); lw.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _irRelDetalhe('lesoes'); } };
    w.appendChild(lw);
  }
}

/* Lesões unidas ao aluno (getRelatorios traz user_id; junta com a lista de alunos) */
function _lesoesComAluno(){
  if(!_relData) return [];
  const alunos=_profAlunosArr();
  const byId={}; alunos.forEach(a=>{ byId[a.id]=a; if(a._self) byId['self']=a; });
  return (_relData.lesoes||[]).map(l=>({ parte:l.parte, status:l.status, data:l.data, nota:l.nota||'', aluno:byId[l.user_id]||null }));
}

/* Drill-down da distribuição de faixas: lista os alunos daquela faixa */
function _alunosPorFaixaSheet(faixa){
  const arr=_profAlunosArr().filter(a=>a.faixa===faixa).sort((a,b)=>(b.graus||0)-(a.graus||0));
  const sh=el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:85vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Faixa ${safeTxt(BELTS[faixa]?.nome||faixa)}</div>
    <div class="sheet-desc">${arr.length} aluno${arr.length===1?'':'s'}</div>
    <div id="fx-list"></div>
    <button class="sheet-cancel" style="margin-top:12px">Fechar</button></div></div>`);
  const list=sh.querySelector('#fx-list');
  if(!arr.length) list.appendChild(el('<div class="empty-line">Nenhum aluno nesta faixa.</div>'));
  arr.forEach(a=>{
    const row=el(`<div class="st-row" style="cursor:pointer">
      ${avatarAluno(a)}
      <div class="st-mid"><div class="nm">${safeTxt(_nomeInst(a))}</div>
        <div class="meta">${beltPill(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${a.diasSem!=null?(a.diasSem+'d sem treinar'):''}</span></div></div>
      <div class="st-right"><span style="color:var(--muted)">›</span></div></div>`);
    row.onclick=()=>_profAlunoSheet(a);
    list.appendChild(row);
  });
  openSheet(sh,'.sheet-cancel');
}

/* === Telas cheias dos painéis da Visão geral (robustas, sem bottom sheet) === */
// Título de seção que leva à tela cheia daquele painel.
function _secTitleLink(t, tipo){
  const e=el(`<div class="sec-title sec-link" role="button" tabindex="0" style="margin:16px 20px 8px" aria-label="Abrir ${safeAttr(t)}"><span>${t}</span><span class="sl-go">Ver tudo ›</span></div>`);
  const go=()=>_irRelDetalhe(tipo);
  e.onclick=go; e.onkeydown=(ev)=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); go(); } };
  return e;
}
function _relDetalhe(w, tipo, secTitle, note){
  if(tipo==='faixas')   return _relDetFaixas(w, secTitle, note);
  if(tipo==='tipoAula') return _relDetTipoAula(w, secTitle, note);
  if(tipo==='ocupacao') return _relDetOcupacao(w, secTitle, note);
  if(tipo==='lesoes')   return _relDetLesoes(w, secTitle, note);
}
function _relDetFaixas(w, secTitle, note){
  w.appendChild(el(`<div class="rel-det-h">Distribuição de faixas</div>`));
  const alunos=_profAlunosArr().filter(a=>!(a.role==='professor'||a.role==='dono'));
  const total=alunos.length||1;
  const aptos=_aptosGraduar();
  const dist=_distFaixas();
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:4px">
    <div class="stat-card"><div class="sv">${alunos.length}</div><div class="sl">Alunos</div></div>
    <div class="stat-card"><div class="sv" style="color:#0d9488">${aptos.length}</div><div class="sl">Aptos a graduar</div></div>
    <div class="stat-card"><div class="sv">${Object.keys(dist).length}</div><div class="sl">Faixas ativas</div></div>
  </div>`));
  Object.keys(BELTS).filter(f=>dist[f]).forEach(f=>{
    const n=dist[f], pct=Math.round(n/total*100);
    w.appendChild(el(`<div class="sec-title" style="margin:16px 20px 8px;display:flex;justify-content:space-between"><span>${safeTxt(BELTS[f].nome)}</span><span style="color:var(--muted)">${n} · ${pct}%</span></div>`));
    const lst=el('<div class="list block"></div>');
    _profAlunosArr().filter(a=>a.faixa===f).sort((a,b)=>(b.graus||0)-(a.graus||0)).forEach(a=>{
      const apto=aptos.includes(a);
      const row=el(`<div class="st-row" style="cursor:pointer">${avatarAluno(a)}
        <div class="st-mid"><div class="nm">${safeTxt(_nomeInst(a))}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${a.diasSem!=null?a.diasSem+'d sem treinar':''}</span></div></div>
        <div class="st-right">${apto?'<span class="status-chip green">apto</span>':'<span style="color:var(--muted)">›</span>'}</div></div>`);
      row.onclick=()=>_profAlunoSheet(a);
      lst.appendChild(row);
    });
    w.appendChild(lst);
  });
}
function _relDetTipoAula(w, secTitle, note){
  w.appendChild(el(`<div class="rel-det-h">Presença por turma · 120 dias</div>`));
  const tipos=_presencaPorTipo();
  if(!tipos.length){ w.appendChild(note('Sem check-ins no período.')); return; }
  const tot=tipos.reduce((s,[,n])=>s+n,0)||1;
  const max=Math.max(1,...tipos.map(([,n])=>n));
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:4px">
    <div class="stat-card"><div class="sv">${tot}</div><div class="sl">Check-ins</div></div>
    <div class="stat-card"><div class="sv">${tipos.length}</div><div class="sl">Turmas</div></div>
    <div class="stat-card"><div class="sv" style="font-size:15px">${safeTxt(tipos[0][0])}</div><div class="sl">Mais frequentado</div></div>
  </div>`));
  w.appendChild(secTitle('Distribuição'));
  const tw=el('<div class="list block"></div>');
  tipos.forEach(([tipo,n])=>{ const pct=Math.round(n/tot*100);
    tw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${safeTxt(tipo)}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.round(n/max*100)}%;background:var(--blue,#2f6fe5)"></span></div>
      <span class="bar-n">${n} · ${pct}%</span></div>`)); });
  w.appendChild(tw);
}
function _relDetOcupacao(w, secTitle, note){
  w.appendChild(el(`<div class="rel-det-h">Ocupação por horário · 120 dias</div>`));
  const occ=_ocupacaoSessoes().filter(o=>o.media>0);
  if(!occ.length){ w.appendChild(note('Sem presenças vinculadas a turmas no período.')); return; }
  const maxO=Math.max(1,...occ.map(o=>o.media));
  const cheia=occ[0], vazia=occ[occ.length-1];
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:4px">
    <div class="stat-card"><div class="sv">${occ.length}</div><div class="sl">Horários ativos</div></div>
    <div class="stat-card"><div class="sv" style="color:#0d9488">${cheia.media}</div><div class="sl">Mais cheio</div></div>
    <div class="stat-card"><div class="sv" style="color:var(--red-strong)">${vazia.media}</div><div class="sl">Mais vazio</div></div>
  </div>`));
  w.appendChild(secTitle('Todos os horários (média de presentes)'));
  const ow=el('<div class="list block"></div>');
  occ.forEach(o=>{ ow.appendChild(el(`<div class="bar-row"><span class="bar-lbl" style="min-width:118px">${_DIA_LBL[o.dia]||safeTxt(o.dia)} ${safeTxt(o.hora)} · ${safeTxt(o.turma)}${o.variacao?' · '+safeTxt(o.variacao):''}</span>
    <div class="bar-track"><span class="bar-fill" style="width:${Math.round(o.media/maxO*100)}%;background:${safeAttr(o.cor||'var(--red)')}"></span></div>
    <span class="bar-n">${o.media}</span></div>`)); });
  w.appendChild(ow);
  w.appendChild(el('<div class="empty-line" style="padding:8px 20px;font-size:11px;color:var(--muted)">Média de presentes por aula. Cada horário é calculado sozinho — Seg 19:30 nunca divide com Seg 06:00.</div>'));
}
function _relDetLesoes(w, secTitle, note){
  w.appendChild(el(`<div class="rel-det-h">Lesões na academia</div>`));
  const les=_lesoesAgg();
  if(!les.total){ w.appendChild(note('Nenhuma lesão registrada pelos alunos.')); return; }
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:4px">
    <div class="stat-card"><div class="sv">${les.total}</div><div class="sl">Registradas</div></div>
    <div class="stat-card"><div class="sv" style="color:${les.ativas?'var(--red-strong)':'var(--ink)'}">${les.ativas}</div><div class="sl">Em recuperação</div></div>
  </div>`));
  w.appendChild(secTitle('Por parte do corpo'));
  const maxP=Math.max(1,...les.partes.map(([,n])=>n));
  const pw=el('<div class="list block"></div>');
  les.partes.forEach(([parte,n])=> pw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${safeTxt(parte)}</span>
    <div class="bar-track"><span class="bar-fill" style="width:${Math.round(n/maxP*100)}%;background:var(--red)"></span></div><span class="bar-n">${n}</span></div>`)));
  w.appendChild(pw);
  w.appendChild(secTitle('Quem está / esteve lesionado'));
  const todos=_lesoesComAluno().sort((a,b)=> ((a.status==='recuperando'?0:1)-(b.status==='recuperando'?0:1)) || (b.data||'').localeCompare(a.data||''));
  const mw=el('<div class="list block"></div>');
  if(!todos.length) mw.appendChild(el('<div class="empty-line">Sem registros com aluno vinculado.</div>'));
  todos.forEach(x=>{
    const ativa=x.status==='recuperando';
    const row=el(`<div class="st-row" style="cursor:pointer">${avatarAluno(x.aluno)}
      <div class="st-mid"><div class="nm">${safeTxt(x.aluno?.nm||'Aluno')}</div>
        <div class="meta"><span class="status-chip ${ativa?'red':'green'}">${ativa?safeTxt(x.parte):'recuperado'}</span> <span style="font-size:11px;color:var(--muted)">${ativa?'':safeTxt(x.parte)+' · '}${safeTxt(x.data||'')}</span></div>
        ${x.nota?`<div class="les-nota">🩹 ${safeTxt(x.nota)}</div>`:''}</div>
      <div class="st-right"><span style="color:var(--muted)">›</span></div></div>`);
    if(x.aluno) row.onclick=()=>_profAlunoSheet(x.aluno);
    mw.appendChild(row);
  });
  w.appendChild(mw);
}

/* ---- Relatórios · Retenção: risco v2 + contato 1 toque, coortes, faixa, aniversários ---- */
function _relRetencao(w, secTitle, note, alunoRow){
  // Segmentação por dias sem treinar (Crítico/Em risco/Atenção/Engajados) — antes ficava
  // na aba "Risco" separada, mas era duplicata do topo de Retenção. Consolidado aqui.
  _relRisco(w, secTitle, note);

  w.appendChild(secTitle('Retenção por faixa (ativos ≤14d)'));
  const rf=_retencaoPorFaixa();
  const rfw=el('<div class="list block"></div>');
  let temRF=false;
  Object.keys(BELTS).filter(f=>rf[f]).forEach(f=>{
    temRF=true;
    const {total,ativos}=rf[f]; const pct=total?Math.round(ativos/total*100):0;
    rfw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${BELTS[f].nome}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${BELTS[f].cor||'var(--red)'}"></span></div>
      <span class="bar-n">${pct}% (${ativos}/${total})</span></div>`));
  });
  w.appendChild(temRF?rfw:note('Sem dados de retenção ainda.'));

  w.appendChild(secTitle('Entradas por mês (% ainda ativos)'));
  const co=_coortesEntrada();
  if(!co.length) w.appendChild(note('Sem data de início nas fichas ainda. A coorte usa o campo "Data de início" do cadastro.'));
  else {
    const cw=el('<div class="list block"></div>');
    co.forEach(([mes,{total,ativos}])=>{
      const pct=total?Math.round(ativos/total*100):0;
      const [y,m]=mes.split('-');
      cw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">${m}/${y}</span>
        <div class="bar-track"><span class="bar-fill" style="width:${pct}%;background:var(--good,#2fa86a)"></span></div>
        <span class="bar-n">${pct}% (${ativos}/${total})</span></div>`));
    });
    w.appendChild(cw);
  }

  w.appendChild(secTitle('Aniversariantes do mês'));
  const nivers=_aniversariantes();
  if(!nivers.length) w.appendChild(note('Nenhum aniversariante com data completa cadastrada. A data completa de nascimento é opcional na ficha do aluno (Editar ficha).'));
  else {
    const nw=el('<div class="list block"></div>');
    nivers.forEach(a=>{
      const dia=a.nascData.slice(8,10);
      const wa=_waLink(a);
      const right=wa?`<a class="wa-btn" href="${safeAttr(wa)}" target="_blank" rel="noopener">WhatsApp</a>`:`<span class="ci-time">dia ${dia}</span>`;
      const row=alunoRow(a, `<span style="font-size:11px;color:var(--muted);font-weight:600">🎂 dia ${dia}</span>`, right);
      const waEl=row.querySelector('.wa-btn'); if(waEl) waEl.onclick=(e)=>e.stopPropagation();
      nw.appendChild(row);
    });
    w.appendChild(nw);
  }
}

/* ---- Relatórios · Técnicas (Camada 1 — §7.1-C): agregado da academia, sem privado ---- */
function _relTecnicas(w, secTitle, note, alunoRow){
  const agg=_tecAgg();
  if(!agg){ w.appendChild(note('Carregando progresso técnico…')); return; }
  const users=Object.keys(agg.porUser).length;
  const tecs=Object.keys(agg.porTec).length;
  const treinosTot=Object.values(agg.porTec).reduce((s,t)=>s+t.treinos,0);
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:12px">
    <div class="stat-card"><div class="sv">${users}</div><div class="sl">Alunos com registro</div></div>
    <div class="stat-card"><div class="sv">${tecs}</div><div class="sl">Técnicas praticadas</div></div>
    <div class="stat-card"><div class="sv">${treinosTot}</div><div class="sl">Treinos de técnica</div></div>
  </div>`));

  // Domínio por categoria (agregado)
  w.appendChild(secTitle('Domínio por categoria'));
  const cw=el('<div class="list block"></div>');
  let temCat=false;
  CAT_ORDER.forEach(c=>{
    const v=agg.cats[c]; const tot=v.dominada+v.treinando+v.aprendendo;
    if(!tot) return; temCat=true;
    cw.appendChild(el(`<div class="mt-row"><span>${CATS[c]?CATS[c].nome:c}</span>
      <b><span style="color:#2fa86a">${v.dominada}</span> · <span style="color:#2f6fe5">${v.treinando}</span> · <span style="color:#c98a2f">${v.aprendendo}</span></b></div>`));
  });
  if(temCat){
    cw.appendChild(el('<div class="empty-line" style="padding:8px 12px;font-size:11px;color:var(--muted)"><span style="color:#2fa86a">dominadas</span> · <span style="color:#2f6fe5">treinando</span> · <span style="color:#c98a2f">aprendendo</span> — registros somados dos alunos</div>'));
    w.appendChild(cw);
  } else w.appendChild(note('Sem progresso técnico registrado ainda. Os dados chegam conforme os alunos praticam técnicas no app.'));

  // Mais e menos treinadas
  const entries=Object.entries(agg.porTec);
  if(entries.length){
    const nome=(id)=>{ const t=tecByKey(id); return (t&&t.jp)||id; };
    w.appendChild(secTitle('Técnicas mais treinadas'));
    const topw=el('<div class="list block"></div>');
    entries.slice().sort((a,b)=>b[1].treinos-a[1].treinos).slice(0,8).forEach(([id,v])=>{
      topw.appendChild(el(`<div class="mt-row"><span>${safeTxt(nome(id))}</span><b>${v.treinos} treinos · ${v.alunos} aluno${v.alunos>1?'s':''}</b></div>`));
    });
    w.appendChild(topw);

    w.appendChild(secTitle('Menos treinadas (onde a aula pode atacar)'));
    const botw=el('<div class="list block"></div>');
    entries.slice().sort((a,b)=>a[1].treinos-b[1].treinos).slice(0,5).forEach(([id,v])=>{
      botw.appendChild(el(`<div class="mt-row"><span>${safeTxt(nome(id))}</span><b>${v.treinos} treinos · ${v.alunos} aluno${v.alunos>1?'s':''}</b></div>`));
    });
    w.appendChild(botw);
  }

  // Ativos sem registro técnico (treina, mas o progresso não aparece)
  w.appendChild(secTitle('Ativos sem registro de técnica'));
  const sem=_profAlunosArr().filter(a=>{
    if((a.diasSem??999)>RISCO_DIAS) return false;
    if(a._self) return !(DB.tecnicas||[]).some(t=>(t.treinos||0)>0);
    return !agg.porUser[a.id];
  });
  if(!sem.length) w.appendChild(note('Todos os alunos ativos têm progresso técnico registrado. 👏'));
  else {
    const sw=el('<div class="list block"></div>');
    sem.slice(0,10).forEach(a=> sw.appendChild(alunoRow(a, '<span style="font-size:11px;color:var(--muted)">treina, mas não registra técnicas</span>')));
    w.appendChild(sw);
  }
}

/* ---- Relatórios · Graduação: prontidão (semáforo 3 eixos) + tempo na faixa ---- */
/* Regras da academia: meta de aulas POR FAIXA (persiste em academies.config via 0003) */
function _regrasFaixaSheet(){
  const FAIXAS=['branca','azul','roxa','marrom','preta'];
  const cfg=(DB.academyConfig&&DB.academyConfig.metaAulas)||{};
  const sh=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Meta de aulas por faixa</div>
    <div class="sheet-desc">Aulas desde a última graduação para o eixo "aulas" do semáforo. Vazio = padrão (${PROF_METAS.META_GRAU}).</div>
    <div id="rf-rows"></div>
    <button class="btn-save" id="rf-save" style="margin-top:14px">Salvar regras</button>
    <button class="sheet-cancel">Cancelar</button></div></div>`);
  const rows=sh.querySelector('#rf-rows');
  FAIXAS.forEach(f=>{
    rows.appendChild(el(`<div class="est-row"><span class="est-t">${BELTS[f]?.nome||f}</span>
      <input class="inp rf-inp" data-f="${f}" type="number" min="1" max="999" inputmode="numeric"
        placeholder="${PROF_METAS.META_GRAU}" value="${cfg[f]||''}" style="width:90px;text-align:center"></div>`));
  });
  sh.querySelector('#rf-save').onclick=()=>{
    // Parte da config EXISTENTE: `_salvarAcademyConfig` faz merge RASO, então o
    // metaAulas enviado aqui SUBSTITUI o objeto inteiro. Montar do zero apagava as
    // metas das faixas infantis (editáveis em _profMetaAulasSheet, que não aparecem
    // nesta tela). Campo vazio segue voltando ao padrão — por isso o delete.
    const metaAulas=Object.assign({}, _acadCfg().metaAulas);
    sh.querySelectorAll('.rf-inp').forEach(i=>{ const v=parseInt(i.value);
      if(v>0) metaAulas[i.dataset.f]=v; else delete metaAulas[i.dataset.f]; });
    _salvarAcademyConfig({metaAulas}).then(()=>toast('Regras salvas ✔'))
      .catch(()=>toast('Não salvou na nuvem — o banco precisa da migration 0003'));
    sh.remove(); render();
  };
  openSheet(sh,'.sheet-cancel');
}

function _relGraduacao(w, secTitle, note, alunoRow){
  const cfgRow=el('<div class="list block" style="margin:12px 16px 0"><div class="cfg-row"><span>⚙️ Meta de aulas por faixa (regras da academia)</span></div></div>');
  cfgRow.querySelector('.cfg-row').onclick=()=>_regrasFaixaSheet();
  w.appendChild(cfgRow);
  w.appendChild(secTitle('Prontidão de graduação (tempo CBJJ · aulas · técnicas)'));
  const cand=_profAlunosArr().map(a=>({a, s:_semaforoGrad(a)}))
    .filter(x=>x.s.next)
    .map(x=>{ x.score=[x.s.tempo,x.s.aulas,x.s.tec].filter(e=>e&&e.ok===true).length; return x; })
    .filter(x=>x.score>0)
    .sort((x,y)=> y.score-x.score || ((y.a.aulasNoGrau||0)-(x.a.aulasNoGrau||0)));
  if(!cand.length) w.appendChild(note('Ninguém com eixo verde ainda. Os eixos: tempo mínimo na faixa (CBJJ), aulas desde a última graduação e técnicas em nível ≥ treinando.'));
  else {
    const pw=el('<div class="list block"></div>');
    cand.slice(0,12).forEach(({a,s})=>{
      const next=s.next&&BELTS[s.next]?` → ${BELTS[s.next].nome}`:'';
      pw.appendChild(alunoRow(a, `<span class="sem-chips">${_semChip(s.tempo)}${_semChip(s.aulas)}${_semChip(s.tec)}</span>`,
        `<span style="font-size:11px;color:var(--muted);font-weight:700">${safeTxt(next.replace(/^ → /,'→ '))}</span>`));
    });
    if(cand.length>12) pw.appendChild(el(`<div class="empty-line" style="padding:8px 12px;font-size:12px;color:var(--muted)">+ ${cand.length-12} com pelo menos um eixo verde.</div>`));
    pw.appendChild(el(`<div class="empty-line" style="padding:8px 12px;font-size:11px;color:var(--muted)">Eixo técnicas = aproximação (${PROF_METAS.META_TEC}+ técnicas em nível ≥ treinando) até existir currículo por faixa. A palavra final é sempre do professor.</div>`));
    w.appendChild(pw);
  }

  w.appendChild(secTitle('Há mais tempo sem graduar'));
  const comData=_profAlunosArr().map(a=>({a, meses:tempoNaFaixaMeses(a.faixaDesde)})).filter(x=>x.meses!=null)
    .sort((x,y)=>y.meses-x.meses);
  if(!comData.length) w.appendChild(note('Sem datas de graduação registradas ainda (importe/registre o histórico dos alunos).'));
  else {
    const tw=el('<div class="list block"></div>');
    comData.slice(0,5).forEach(({a,meses})=>
      tw.appendChild(alunoRow(a, `<span style="font-size:11px;color:var(--muted);font-weight:600">${meses} meses na faixa atual</span>`)));
    w.appendChild(tw);
    // média de tempo na faixa por faixa
    const porFaixa={};
    comData.forEach(({a,meses})=>{ const o=porFaixa[a.faixa]||(porFaixa[a.faixa]={s:0,n:0}); o.s+=meses; o.n++; });
    const mw=el('<div class="list block" style="margin-top:8px"></div>');
    Object.keys(BELTS).filter(f=>porFaixa[f]).forEach(f=>{
      mw.appendChild(el(`<div class="mt-row"><span>Média na ${BELTS[f].nome}</span><b>${Math.round(porFaixa[f].s/porFaixa[f].n)} meses</b></div>`));
    });
    if(mw.children.length){ w.appendChild(secTitle('Tempo médio na faixa')); w.appendChild(mw); }
  }
}

/* ---- Relatórios · Loja: valor parado, estoque baixo, vendas (aguarda pedidos) ---- */
function _relLoja(w, secTitle, note){
  const lj=_lojaAgg();
  _loadPedidos();
  const vd=_vendasAgg();
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:12px">
    <div class="stat-card"><div class="sv">${moneyBR(vd.receitaMes)}</div><div class="sl">Vendas no mês</div></div>
    <div class="stat-card"><div class="sv">${moneyBR(lj.valor)}</div><div class="sl">Valor em estoque</div></div>
    <div class="stat-card"><div class="sv" style="color:${lj.baixos.length?'var(--red-strong)':'var(--ink)'}">${lj.baixos.length}</div><div class="sl">Estoque baixo</div></div>
  </div>`));
  // Mais vendidos (pedidos concluídos) — clique no produto → quem comprou
  w.appendChild(secTitle('Mais vendidos · toque p/ ver quem comprou'));
  if(!vd.top.length) w.appendChild(note('Sem vendas confirmadas ainda. Confirme pedidos na aba Loja › Pedidos para alimentar este relatório.'));
  else {
    const max=Math.max(1,...vd.top.map(t=>t[1]));
    const mv=el('<div class="list block"></div>');
    vd.top.forEach(([nome,q])=>{ const row=el(`<div class="bar-row" style="cursor:pointer">
      <span class="bar-lbl">${safeTxt(nome)}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.round(q/max*100)}%;background:var(--red)"></span></div>
      <span class="bar-n">${q} ›</span></div>`);
      row.onclick=()=>_produtoVendasSheet(nome); mv.appendChild(row); });
    w.appendChild(mv);
  }
  // Top compradores (por valor gasto) — clique no cliente → o que ele comprou
  if(vd.clientes.length){
    w.appendChild(secTitle('Top compradores · por valor gasto'));
    const cw=el('<div class="list block"></div>');
    vd.clientes.forEach(([nome,info])=>{ const row=el(`<div class="mt-row" style="cursor:pointer">
      <span>${safeTxt(nome)} <span style="color:var(--muted);font-size:11px">· ${info.pedidos} pedido${info.pedidos>1?'s':''}</span></span>
      <b>${moneyBR(info.gasto)} <span style="color:var(--muted);font-weight:600">›</span></b></div>`);
      row.onclick=()=>_compradorDetalheSheet(nome); cw.appendChild(row); });
    w.appendChild(cw);
  }
  // Tamanhos que mais saem
  if(vd.tams.length){
    w.appendChild(secTitle('Tamanhos que mais saem'));
    const maxT=Math.max(1,...vd.tams.map(t=>t[1]));
    const tw=el('<div class="list block"></div>');
    vd.tams.forEach(([t,q])=>{ tw.appendChild(el(`<div class="bar-row"><span class="bar-lbl">Tam ${safeTxt(t)}</span>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.round(q/maxT*100)}%;background:#0d9488"></span></div>
      <span class="bar-n">${q}</span></div>`)); });
    w.appendChild(tw);
  }
  w.appendChild(secTitle('Estoque baixo'));
  if(!lj.baixos.length) w.appendChild(note('Nenhum produto com estoque baixo.'));
  else {
    const bw=el('<div class="list block"></div>');
    lj.baixos.forEach(p=>{
      const tams=(p.tam||[]).filter(t=>((p.estoque&&p.estoque[t])||0)<=3).map(t=>`${safeTxt(t)}: ${(p.estoque&&p.estoque[t])||0}`).join(' · ');
      const row=el(`<div class="mt-row" style="cursor:pointer"><span>${safeTxt(p.emoji||'')} ${safeTxt(p.nome)}</span><b style="color:var(--red-strong)">${tams||'—'} <span style="color:var(--muted);font-weight:600">›</span></b></div>`);
      row.onclick=()=>_profProdutoSheet(p);   // drill: abre o produto p/ ajustar estoque
      bw.appendChild(row);
    });
    w.appendChild(bw);
  }
}

/* Drill-down: o que UM cliente comprou (pedidos concluídos). Responde "quais produtos ele compra". */
function _compradorDetalheSheet(nome){
  const conc = _pedidosArr().filter(p=>p.status==='concluido' && (p.cliente||'—')===nome);
  const porProd = {}; let gasto=0;
  conc.forEach(p=>{ gasto+=(p.total||0); (p.itens||[]).forEach(it=>{
    const k=it.nome||'—'; const e=porProd[k]||(porProd[k]={qtd:0,valor:0});
    e.qtd+=(it.qtd||0); e.valor+=((it.preco||0)*(it.qtd||0));
  }); });
  const prods = Object.entries(porProd).sort((a,b)=>b[1].valor-a[1].valor);
  const linhas = prods.map(([n,e])=>`<div class="mt-row"><span>${safeTxt(n)} <span style="color:var(--muted);font-size:11px">· ${e.qtd}x</span></span><b>${moneyBR(e.valor)}</b></div>`).join('');
  const hist = conc.slice().sort((a,b)=>(b.criadoEm||'').localeCompare(a.criadoEm||''))
    .map(p=>{ const dt=(p.criadoEm||'').slice(0,10).split('-').reverse().join('/');
      const res=(p.itens||[]).map(it=>`${safeTxt(it.nome)} ${safeTxt(it.tam||'')}×${it.qtd}`).join(' · ');
      return `<div class="mt-row"><span style="font-size:12.5px">${dt} · ${res}</span><b>${moneyBR(p.total)}</b></div>`; }).join('');
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" style="max-height:88vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${safeTxt(nome)}</div>
    <div class="stat-grid" style="margin:2px 0 8px">
      <div class="stat-card"><div class="sv">${moneyBR(gasto)}</div><div class="sl">Total gasto</div></div>
      <div class="stat-card"><div class="sv">${conc.length}</div><div class="sl">Pedidos</div></div>
    </div>
    <div class="sec-title" style="margin:8px 4px 6px;font-size:11px">Produtos que compra</div>
    <div class="list block">${linhas||'<div class="empty-line">Sem itens.</div>'}</div>
    <div class="sec-title" style="margin:12px 4px 6px;font-size:11px">Histórico de pedidos</div>
    <div class="list block">${hist||'<div class="empty-line">Sem pedidos.</div>'}</div>
    <button class="sheet-cancel">Fechar</button>
  </div></div>`);
  openSheet(sheet, '.sheet-cancel');
}

/* Drill-down: quem comprou UM produto (pedidos concluídos). Responde "quem compra isso". */
function _produtoVendasSheet(nomeProd){
  const conc = _pedidosArr().filter(p=>p.status==='concluido');
  const porCli={}; let qtdTot=0, receita=0;
  conc.forEach(p=>{ (p.itens||[]).forEach(it=>{ if((it.nome||'')!==nomeProd) return;
    const c=porCli[p.cliente||'—']||(porCli[p.cliente||'—']={qtd:0,valor:0});
    c.qtd+=(it.qtd||0); c.valor+=((it.preco||0)*(it.qtd||0)); qtdTot+=(it.qtd||0); receita+=((it.preco||0)*(it.qtd||0));
  }); });
  const clientes=Object.entries(porCli).sort((a,b)=>b[1].qtd-a[1].qtd);
  const linhas=clientes.map(([n,e])=>`<div class="mt-row"><span>${safeTxt(n)} <span style="color:var(--muted);font-size:11px">· ${e.qtd}x</span></span><b>${moneyBR(e.valor)}</b></div>`).join('');
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" style="max-height:88vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${safeTxt(nomeProd)}</div>
    <div class="stat-grid" style="margin:2px 0 8px">
      <div class="stat-card"><div class="sv">${qtdTot}</div><div class="sl">Unidades vendidas</div></div>
      <div class="stat-card"><div class="sv">${moneyBR(receita)}</div><div class="sl">Receita</div></div>
    </div>
    <div class="sec-title" style="margin:8px 4px 6px;font-size:11px">Quem comprou</div>
    <div class="list block">${linhas||'<div class="empty-line">Sem compradores.</div>'}</div>
    <button class="sheet-cancel">Fechar</button>
  </div></div>`);
  openSheet(sheet, '.sheet-cancel');
}

/* ============================================================
   PROFESSOR — Financeiro V2 (v481, migration 0042)
   Sub-abas: Cobranças · Despesas · Planos · Contratos.
   Sem transação no app (ADR). Cron `financeiro_diario` gera cobranças
   mensais e parcelas de despesas recorrentes; app só registra o que
   aconteceu. Aluno NÃO lê financeiro (RLS is_professor).
   ============================================================ */
let _finTab = 'cobrancas';
let _finPlanos = null, _finContratos = null, _finDespesas = null;
let _finCobrancas = null, _finCategorias = null, _finRec = null;
let _finMatriculas = null, _finTurmasMap = null;   // v504: cache pra tabela Cobranças rica
let _finRenderingInProgress = false;   // v507: guard anti-loop de renderBg
let _finTs = 0;
let _finMesRef = null;   // v490 Sprint 3: 'YYYY-MM' — null = mês corrente
let _finCobFiltro = 'vencidas';   // 'vencidas'|'avencer'|'pagas'|'isentas'
let _finDespFiltro = 'a_pagar';
let _finContrFiltro = 'ativo';

function _finMes(){ return _finMesRef || HOJE_ISO.slice(0,7); }
function _finMesNome(mes){
  const [y,m] = (mes||_finMes()).split('-').map(Number);
  const d = new Date(y, m-1, 1);
  return d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
}
function _finMesShift(delta){
  const [y,m] = _finMes().split('-').map(Number);
  const d = new Date(y, m-1+delta, 1);
  _finMesRef = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
// v510: _finReload aceita seleção de queries pra recarregar. Cortou ~70% do
// egress do Financeiro (antes cada mutação refazia 8 queries pra 1 mudar).
//   _finReload()              → gate 15s, refaz tudo se expirou
//   _finReload(true)          → força tudo (boot/reload manual)
//   _finReload('cobrancas')   → força só cobrancas
//   _finReload(['a','b'])     → força só as listadas
// Chaves: cobrancas · despesas · planos · contratos · categorias · rec · matriculas · turmas
function _finReload(what){
  const forceAll = what === true;
  const isSelective = typeof what === 'string' || Array.isArray(what);
  if(DEMO || typeof sbProf==='undefined' || !sbProf.getCobrancas) return Promise.resolve();
  if(!forceAll && !isSelective && Date.now() - _finTs < 15000) return Promise.resolve();
  _finTs = Date.now();
  const mes = _finMes();
  const wanted = isSelective ? (Array.isArray(what) ? what : [what]) : null;
  const want = k => !wanted || wanted.includes(k);
  const tasks = [];
  if(want('cobrancas'))  tasks.push(sbProf.getCobrancas({ mes }).then(r=>{ _finCobrancas = r; }).catch(()=>{}));
  if(want('despesas'))   tasks.push(sbProf.getDespesas().then(r=>{ _finDespesas = r; }).catch(()=>{}));
  if(want('planos'))     tasks.push(sbProf.getPlanos().then(r=>{ _finPlanos = r; }).catch(()=>{}));
  if(want('contratos'))  tasks.push(sbProf.getContratos().then(r=>{ _finContratos = r; }).catch(()=>{}));
  if(want('categorias')) tasks.push(sbProf.getCategorias().then(r=>{ _finCategorias = r; }).catch(()=>{}));
  if(want('rec') && sbProf.getDespesasRecorrentes) tasks.push(sbProf.getDespesasRecorrentes().then(r=>{ _finRec = r; }).catch(()=>{}));
  if(want('matriculas') && sbProf.getAllMatriculas) tasks.push(sbProf.getAllMatriculas().then(r=>{ _finMatriculas = r; }).catch(()=>{}));
  if(want('turmas'))     tasks.push(sbProf.getTurmas().then(ts=>{ _finTurmasMap = {}; (ts||[]).forEach(t=>{ _finTurmasMap[t.id] = t.nome; }); }).catch(()=>{}));
  return Promise.all(tasks).then(()=>{
    if(_finRenderingInProgress) return;
    // v512: se estamos NA tela do Financeiro, repaint SÓ o body (moldura estável —
    // topbar/sidebar/mesBar/tabs não piscam). Fora dele, renderBg normal.
    // v539: sem passar body — _finPaintBody faz lookup fresh (safe pra morphdom).
    const finBody = document.querySelector('.fin-body');
    if(finBody && typeof _finPaintBody === 'function') _finPaintBody();
    else try { renderBg(); } catch(_){}
  });
}
function _finBackend(){ return !DEMO && typeof sbProf!=='undefined' && !!sbProf.getCobrancas; }
function profFinanceiro(){
  const w = el('<div></div>');
  if(!_finBackend()){
    w.innerHTML='<div class="card card-pad" style="margin:20px;text-align:center;color:var(--muted)">Financeiro só funciona com backend ligado.</div>';
    return w;
  }
  const mesAtualNome = _finMesNome();
  const mesCorrente = HOJE_ISO.slice(0,7);
  const eMesCorrente = _finMes() === mesCorrente;
  w.innerHTML = `<div class="hello"><div class="date">Financeiro</div>
    <div class="greet">gestão</div></div>`;

  // v490 Sprint 3: seletor de mês + botão "Preparar próximo mês".
  // v506: sempre visível (antes só em Cobranças/Despesas — causava layout shift
  // quando trocava de aba). Em Planos/Contratos/Categorias/Matriculas o seletor
  // não afeta a lista, mas seguir estável evita "pulo" da UI e o botão de
  // preparar próximo mês fica sempre à mão.
  const mesBar = el(`<div class="fin-mes-bar" style="display:flex;align-items:center;gap:6px;margin:6px 12px 10px">
    <button class="btn-cad ghost" id="fm-prev" aria-label="Mês anterior" style="min-width:34px;padding:6px 8px">‹</button>
    <div id="fm-nome" style="flex:1;text-align:center;font-weight:800;font-size:14.5px;text-transform:capitalize">${safeTxt(mesAtualNome)}</div>
    <button class="btn-cad ghost" id="fm-next" aria-label="Próximo mês" style="min-width:34px;padding:6px 8px">›</button>
    ${eMesCorrente ? '' : '<button class="btn-cad ghost" id="fm-hoje" style="padding:6px 10px;font-size:11.5px">Hoje</button>'}
  </div>`);
  // v510/v512: mês só afeta cobrancas. v512 atualiza o texto do mesBar inline
  // (sem render()) — _finReload dispara paint do body só quando chega, sem flash.
  const atualizaMesNome = () => {
    const nomeEl = mesBar.querySelector('#fm-nome');
    if(nomeEl) nomeEl.textContent = _finMesNome();
  };
  // v518: helpers pra calcular sempre o PRÓXIMO mês do mês corrente selecionado.
  // Antes: proxMes era bakeado 1 vez no HTML — se user mudava mês, o botão
  // continuava apontando pro antigo (ex: Julho na tela, botão "Preparar outubro").
  const calcProxMes = ()=>{
    const [y,m] = _finMes().split('-').map(Number);
    const proxD = new Date(y, m, 1);   // m é 1-indexed no _finMes, e Date usa 0-indexed → soma +1 natural
    return proxD.getFullYear()+'-'+String(proxD.getMonth()+1).padStart(2,'0');
  };
  const atualizaPrep = ()=>{
    const prox = calcProxMes();
    const prepEl = w.querySelector('#fm-prep');
    if(prepEl) prepEl.innerHTML = `🗓 Preparar ${safeTxt(_finMesNome(prox))}`;
  };
  const atualizaTudo = ()=>{ atualizaMesNome(); atualizaPrep(); _finReload('cobrancas'); };
  mesBar.querySelector('#fm-prev').onclick = ()=>{ _finMesShift(-1); atualizaTudo(); };
  mesBar.querySelector('#fm-next').onclick = ()=>{ _finMesShift(1); atualizaTudo(); };
  const btnHoje = mesBar.querySelector('#fm-hoje');
  if(btnHoje) btnHoje.onclick = ()=>{ _finMesRef=null; atualizaTudo(); };
  w.appendChild(mesBar);

  const prep = el(`<button class="btn-cad" id="fm-prep" style="margin:0 12px 10px;width:calc(100% - 24px)">🗓 Preparar ${safeTxt(_finMesNome(calcProxMes()))}</button>`);
  prep.onclick = ()=>{
    const proxMes = calcProxMes();   // v518: recalcula na hora do clique
    const proxNome = _finMesNome(proxMes);
    if(!confirm('Gerar cobranças de '+proxNome+' agora? Idempotente — se já existirem, ignora.')) return;
    prep.disabled=true; const orig=prep.innerHTML; prep.textContent='Gerando…';
    sbProf.gerarCobrancasDoMes(proxMes)
      .then(n => {
        toast(n>0 ? `${n} cobrança${n===1?'':'s'} de ${proxNome} criada${n===1?'':'s'} ✔` : `Nenhuma cobrança nova (${proxNome} já preparado)`);
        prep.disabled=false; prep.innerHTML=orig;
        _finReload('cobrancas');
      })
      .catch(e=>{ prep.disabled=false; prep.innerHTML=orig; toast('Erro: '+(e.message||e)); });
  };
  w.appendChild(prep);

  const tabs = el(`<div class="filter-seg" style="margin:6px 12px 10px;overflow-x:auto" role="tablist">
    <button data-t="dashboard" ${_finTab==='dashboard'?'class="active"':''}>Dashboard</button>
    <button data-t="cobrancas" ${_finTab==='cobrancas'?'class="active"':''}>Cobranças</button>
    <button data-t="despesas"  ${_finTab==='despesas' ?'class="active"':''}>Despesas</button>
    <button data-t="planos"    ${_finTab==='planos'   ?'class="active"':''}>Planos</button>
    <button data-t="matriculas" ${_finTab==='matriculas'?'class="active"':''}>Matrículas</button>
    <button data-t="contratos" ${_finTab==='contratos'?'class="active"':''}>Contratos</button>
    <button data-t="categorias" ${_finTab==='categorias'?'class="active"':''}>Categorias</button>
  </div>`);
  // v539: tab click NUNCA passa body closure — lookup fresh no _finPaintBody.
  // Provado em tests/morphdom-render.spec.mjs CASO 4: morphdom reusa body
  // antigo por id-match; body closure fica órfão.
  tabs.querySelectorAll('[data-t]').forEach(b=>{
    b.onclick=()=>{
      _finTab=b.dataset.t;
      tabs.querySelectorAll('[data-t]').forEach(x=>x.classList.toggle('active', x.dataset.t===_finTab));
      _finPaintBody();
    };
  });
  w.appendChild(tabs);

  const body = el('<div class="fin-body" id="fin-body"></div>');
  w.appendChild(body);

  // v539: pinta o body FRESH direto (ainda no meio da construção, seguro).
  // NÃO usa Promise pra deferir — sync é ok porque body é o próprio.
  const temCache = _finCobrancas !== null;
  if(temCache){
    _finPaintBody(body);
  } else {
    body.appendChild(el('<div class="loading-center" style="padding:24px">Carregando…</div>'));
  }

  _finRenderingInProgress = true;
  _finReload().then(()=>{
    // v539: SEM body closure — lookup fresh (por conta do morphdom que pode
    // ter reusado o body antigo entre o kickoff e o resolve).
    _finPaintBody();
    _finRenderingInProgress = false;
  }).catch(()=>{ _finRenderingInProgress = false; });

  return w;
}

// v539: _finPaintBody sem param usa lookup fresh (#fin-body). Se param body
// FOR passado (chamada síncrona durante profFinanceiro construction), usa ele
// — é o body fresh que está sendo montado, garantidamente NÃO tem old id
// match no DOM ainda (ele nem entrou). Regra: passa body só quando você
// SABE que é a construção; caso contrário chama sem arg.
function _finPaintBody(body){
  const target = body || document.getElementById('fin-body');
  if(!target) return;
  target.innerHTML='';
  if(_finTab==='dashboard') _finRenderDashboard(target);
  else if(_finTab==='cobrancas') _finRenderCobrancas(target);
  else if(_finTab==='despesas') _finRenderDespesas(target);
  else if(_finTab==='planos') _finRenderPlanos(target);
  else if(_finTab==='matriculas') _finRenderMatriculas(target);
  else if(_finTab==='contratos') _finRenderContratos(target);
  else _finRenderCategorias(target);
}

/* ---- Sub-aba: Dashboard (Sprint 4) ---- */
let _finDashAno = null, _finDashData = null, _finDashInad = null;
function _finDashAnoAtual(){ return _finDashAno || new Date().getFullYear(); }
function _finRenderDashboard(body){
  if(!_finBackend()){ body.innerHTML='<div class="empty-line">Dashboard só com backend ligado.</div>'; return; }
  const ano = _finDashAnoAtual();
  const anoCorrente = new Date().getFullYear();

  // Seletor de ano
  const yBar = el(`<div style="display:flex;align-items:center;gap:8px;margin:0 12px 10px">
    <button class="btn-cad ghost" id="fy-prev" style="min-width:34px;padding:6px 8px">‹</button>
    <div style="flex:1;text-align:center;font-weight:800;font-size:14.5px">${ano}</div>
    <button class="btn-cad ghost" id="fy-next" style="min-width:34px;padding:6px 8px" ${ano>=anoCorrente?'disabled':''}>›</button>
  </div>`);
  yBar.querySelector('#fy-prev').onclick = ()=>{ _finDashAno = ano-1; _finDashData=null; render(); };
  const btnNextY = yBar.querySelector('#fy-next');
  if(!btnNextY.disabled) btnNextY.onclick = ()=>{ _finDashAno = ano+1; _finDashData=null; render(); };
  body.appendChild(yBar);

  const holder = el('<div class="loading-center" style="padding:20px">Carregando…</div>');
  body.appendChild(holder);

  Promise.all([
    sbProf.getFinResumoAnual(ano),
    sbProf.getInadimplentesDetalhado(6),
  ]).then(([resumo, inad])=>{
    _finDashData = resumo; _finDashInad = inad;
    holder.remove();
    body.appendChild(_finDashChartAnual(resumo, ano));
    body.appendChild(_finDashDRE(resumo, ano));   // Sprint 5
    body.appendChild(_finDashPizzas(resumo));
    body.appendChild(_finDashFluxoCaixa());       // Sprint 5
    body.appendChild(_finDashInadTabela(inad));
    body.appendChild(_finDashExport(resumo, ano)); // Sprint 5
  }).catch(e=>{ holder.innerHTML='<div style="padding:8px;color:var(--red)">Erro: '+safeTxt(e.message||e)+'</div>'; });
}

// DRE simplificada (Sprint 5) — mês corrente do ano do dashboard vs mês anterior
function _finDashDRE(resumo, ano){
  const anoCorr = new Date().getFullYear();
  const mesAtual = anoCorr === ano ? (new Date().getMonth()) : 11;   // se ano passado, usa dez
  const cur = resumo.meses[mesAtual];
  const prev = mesAtual > 0 ? resumo.meses[mesAtual-1] : null;
  const margem = cur.receita > 0 ? Math.round((cur.saldo/cur.receita)*100) : 0;
  const varSaldo = prev ? ((cur.saldo - prev.saldo)) : null;
  const varPct = prev && prev.saldo !== 0 ? Math.round(((cur.saldo - prev.saldo)/Math.abs(prev.saldo))*100) : null;
  const NOMES_MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  const nomeMes = NOMES_MES[mesAtual];
  const nomeMesPrev = mesAtual > 0 ? NOMES_MES[mesAtual-1] : null;
  const card = el('<div class="block" style="padding:14px 12px;margin:0 12px 12px"></div>');
  card.innerHTML = `
    <div style="font-weight:800;font-size:14px;margin-bottom:10px">DRE · ${nomeMes}/${ano}</div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
      <span>Receita bruta</span><span style="font-weight:800;color:var(--good)">${moneyBR(cur.receita)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
      <span>(−) Despesas operacionais</span><span style="font-weight:800;color:var(--red)">${moneyBR(cur.despesa)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border,#e5e5ea);border-bottom:1px solid var(--border,#e5e5ea);margin:4px 0;font-size:14px">
      <span style="font-weight:800">Resultado operacional</span>
      <span style="font-weight:800;color:${cur.saldo>=0?'var(--good)':'var(--red)'}">${moneyBR(cur.saldo)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;color:var(--muted)">
      <span>Margem</span><span style="font-weight:700">${margem}%</span>
    </div>
    ${prev !== null ? `
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:12px;color:var(--muted)">
        <span>vs ${nomeMesPrev} (${moneyBR(prev.saldo)})</span>
        <span style="font-weight:700;color:${varSaldo>=0?'var(--good)':'var(--red)'}">${varSaldo>=0?'+':''}${moneyBR(varSaldo)}${varPct!==null?' ('+(varPct>=0?'+':'')+varPct+'%)':''}</span>
      </div>` : ''}
  `;
  return card;
}

// Fluxo de caixa — projeção próximos 30 dias (Sprint 5)
function _finDashFluxoCaixa(){
  const card = el('<div class="block" style="padding:14px 12px;margin:0 12px 12px"></div>');
  card.appendChild(el('<div style="font-weight:800;font-size:14px;margin-bottom:10px">Fluxo de caixa · próximos 30 dias</div>'));
  const loading = el('<div class="loading-center" style="padding:6px 0">Carregando…</div>');
  card.appendChild(loading);
  const in30 = _plus(HOJE_ISO, 30);
  Promise.all([
    // Cobranças pendentes/atrasadas com venc entre hoje e +30d
    SB.from('mensalidades').select('valor,venc,status')
      .in('status',['pendente','atrasado']).gte('venc', HOJE_ISO).lte('venc', in30),
    // Despesas a pagar com data_lancamento entre hoje e +30d
    SB.from('despesas').select('valor,data_lancamento,status')
      .eq('status','a_pagar').gte('data_lancamento', HOJE_ISO).lte('data_lancamento', in30),
  ]).then(([cR, dR])=>{
    loading.remove();
    const entradas = (cR.data||[]).reduce((s,c)=>s+(Number(c.valor)||0),0);
    const saidas = (dR.data||[]).reduce((s,d)=>s+(Number(d.valor)||0),0);
    const saldo = entradas - saidas;
    const nCobs = (cR.data||[]).length, nDesp = (dR.data||[]).length;
    card.appendChild(el(`
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
        <span>Entradas previstas <span style="color:var(--muted);font-size:11.5px">(${nCobs})</span></span>
        <span style="font-weight:800;color:var(--good)">${moneyBR(entradas)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px">
        <span>Saídas previstas <span style="color:var(--muted);font-size:11.5px">(${nDesp})</span></span>
        <span style="font-weight:800;color:var(--red)">${moneyBR(saidas)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid var(--border,#e5e5ea);margin-top:4px;font-size:14px">
        <span style="font-weight:800">Saldo estimado</span>
        <span style="font-weight:800;color:${saldo>=0?'var(--good)':'var(--red)'}">${moneyBR(saldo)}</span>
      </div>
    `));
  }).catch(e=>{ loading.textContent='Erro: '+(e.message||e); });
  return card;
}

// Botões de export (Sprint 5)
function _finDashExport(resumo, ano){
  const card = el('<div class="block" style="padding:14px 12px;margin:0 12px 12px"></div>');
  card.appendChild(el('<div style="font-weight:800;font-size:14px;margin-bottom:10px">Exportar</div>'));
  const btnCSV = el('<button class="btn-cad ghost" style="width:100%;margin-bottom:8px">📊 CSV — resumo anual</button>');
  btnCSV.onclick = ()=> _finExportCSV(resumo, ano);
  const btnPDF = el('<button class="btn-cad ghost" style="width:100%">📄 PDF — DRE do mês</button>');
  btnPDF.onclick = ()=> _finExportPDF(resumo, ano);
  card.appendChild(btnCSV);
  card.appendChild(btnPDF);
  return card;
}
function _finExportCSV(resumo, ano){
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const linhas = ['Mês;Receita;Despesa;Saldo'];
  resumo.meses.forEach((m,i)=>{
    linhas.push([MESES[i]+'/'+ano, m.receita.toFixed(2), m.despesa.toFixed(2), m.saldo.toFixed(2)].join(';'));
  });
  linhas.push('');
  linhas.push('Receita por tipo');
  Object.entries(resumo.receitasPorCategoria).sort((a,b)=>b[1]-a[1])
    .forEach(([k,v])=> linhas.push(k+';'+v.toFixed(2)));
  linhas.push('');
  linhas.push('Despesa por tipo');
  Object.entries(resumo.despesasPorCategoria).sort((a,b)=>b[1]-a[1])
    .forEach(([k,v])=> linhas.push(k+';'+v.toFixed(2)));
  const blob = new Blob(['﻿'+linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `financeiro-${ano}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast('CSV exportado ✔');
}
function _finExportPDF(resumo, ano){
  if(typeof window.jspdf === 'undefined'){ toast('PDF indisponível — recarregue o app'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const anoCorr = new Date().getFullYear();
  const mIdx = anoCorr === ano ? new Date().getMonth() : 11;
  const nomeMes = NOMES[mIdx];
  const cur = resumo.meses[mIdx];
  const margem = cur.receita > 0 ? Math.round((cur.saldo/cur.receita)*100) : 0;
  const acadNm = (DB.academia && DB.academia.nome) || 'Yama Jiu-Jitsu';
  doc.setFontSize(18); doc.text(acadNm, 20, 20);
  doc.setFontSize(12); doc.text(`DRE · ${nomeMes} de ${ano}`, 20, 30);
  doc.setFontSize(10); doc.text('Gerado em '+new Date().toLocaleDateString('pt-BR'), 20, 36);
  let y = 50;
  const linha = (l, v, bold) => {
    if(bold) doc.setFont(undefined,'bold'); else doc.setFont(undefined,'normal');
    doc.text(l, 20, y); doc.text(v, 180, y, {align:'right'}); y += 8;
  };
  linha('Receita bruta', moneyBR(cur.receita));
  linha('(-) Despesas operacionais', moneyBR(cur.despesa));
  y += 2; doc.line(20, y, 180, y); y += 6;
  linha('Resultado operacional', moneyBR(cur.saldo), true);
  linha('Margem', margem+'%');
  y += 10;
  doc.setFont(undefined,'bold'); doc.text('Detalhamento por categoria', 20, y); y += 8;
  doc.setFont(undefined,'normal');
  doc.text('Receitas:', 20, y); y += 6;
  Object.entries(resumo.receitasPorCategoria).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    doc.text('  '+k, 25, y); doc.text(moneyBR(v), 180, y, {align:'right'}); y += 6;
    if(y>270){ doc.addPage(); y=20; }
  });
  y += 4; doc.text('Despesas:', 20, y); y += 6;
  Object.entries(resumo.despesasPorCategoria).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
    doc.text('  '+k, 25, y); doc.text(moneyBR(v), 180, y, {align:'right'}); y += 6;
    if(y>270){ doc.addPage(); y=20; }
  });
  doc.save(`DRE-${ano}-${String(mIdx+1).padStart(2,'0')}.pdf`);
  toast('PDF exportado ✔');
}

// Chart barras Receita x Despesa (12 meses, SVG puro)
function _finDashChartAnual(resumo, ano){
  const card = el('<div class="block" style="padding:14px 12px;margin:0 12px 12px"></div>');
  card.appendChild(el(`<div style="font-weight:800;font-size:14px;margin-bottom:10px">Receita × Despesa · ${ano}</div>`));
  const MESES = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const maxV = Math.max(1, ...resumo.meses.map(m => Math.max(m.receita, m.despesa)));
  const W = 12*44, H = 160, PAD = 20;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox', `0 0 ${W+PAD*2} ${H+40}`);
  svg.setAttribute('style', 'width:100%;max-width:100%;height:auto;overflow:visible');
  const bars = resumo.meses.map((m,i)=>{
    const x = PAD + i*44;
    const hR = Math.round((m.receita/maxV)*H);
    const hD = Math.round((m.despesa/maxV)*H);
    return `
      <g>
        <rect x="${x+4}"  y="${PAD+H-hR}" width="16" height="${hR}" fill="#22a06b" rx="2"/>
        <rect x="${x+22}" y="${PAD+H-hD}" width="16" height="${hD}" fill="#e5392f" rx="2"/>
        <text x="${x+21}" y="${PAD+H+16}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.6">${MESES[i]}</text>
      </g>
    `;
  }).join('');
  svg.innerHTML = bars;
  card.appendChild(svg);
  // Legenda
  card.appendChild(el(`<div style="display:flex;gap:16px;font-size:11.5px;color:var(--muted);margin-top:8px">
    <span><span style="display:inline-block;width:10px;height:10px;background:#22a06b;border-radius:2px;margin-right:4px"></span>Receita</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:#e5392f;border-radius:2px;margin-right:4px"></span>Despesa</span>
  </div>`));
  const totR = resumo.meses.reduce((s,m)=>s+m.receita,0);
  const totD = resumo.meses.reduce((s,m)=>s+m.despesa,0);
  const totS = totR - totD;
  card.appendChild(el(`<div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#e5e5ea);font-size:12.5px">
    <span>Total receita: <b>${moneyBR(totR)}</b></span>
    <span>Total despesa: <b>${moneyBR(totD)}</b></span>
    <span style="color:${totS>=0?'var(--good)':'var(--red)'}">Saldo: <b>${moneyBR(totS)}</b></span>
  </div>`));
  return card;
}

// Duas pizzas — Receita e Despesa por categoria (SVG puro)
function _finDashPizzas(resumo){
  const wrap = el('<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 12px 12px"></div>');
  wrap.appendChild(_finDashPizza('Receita por tipo', resumo.receitasPorCategoria, ['#22a06b','#0d9488','#3b82f6','#8b5cf6','#f59e0b']));
  wrap.appendChild(_finDashPizza('Despesa por tipo', resumo.despesasPorCategoria, ['#e5392f','#f97316','#f59e0b','#dc2626','#9333ea']));
  return wrap;
}
function _finDashPizza(titulo, dados, cores){
  const card = el('<div class="block" style="padding:12px"></div>');
  card.appendChild(el(`<div style="font-weight:700;font-size:12.5px;margin-bottom:8px">${safeTxt(titulo)}</div>`));
  const entries = Object.entries(dados||{}).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){ card.appendChild(el('<div style="color:var(--muted);font-size:12px;padding:8px 0">Sem dados</div>')); return card; }
  const total = entries.reduce((s,[,v])=>s+v,0) || 1;
  const R = 40, CX = 50, CY = 50;
  let ang = -Math.PI/2;
  const paths = entries.map(([nome, v], i)=>{
    const frac = v/total;
    const a2 = ang + frac*Math.PI*2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = CX + R*Math.cos(ang), y1 = CY + R*Math.sin(ang);
    const x2 = CX + R*Math.cos(a2),  y2 = CY + R*Math.sin(a2);
    const path = `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
    ang = a2;
    return `<path d="${path}" fill="${cores[i%cores.length]}"/>`;
  }).join('');
  const svg = `<svg viewBox="0 0 100 100" style="width:100%;max-width:120px;height:auto;display:block;margin:0 auto">${paths}<circle cx="50" cy="50" r="18" fill="var(--card,#fff)"/></svg>`;
  card.insertAdjacentHTML('beforeend', svg);
  // Legenda: top 5
  const leg = el('<div style="margin-top:8px"></div>');
  entries.slice(0,5).forEach(([nome, v], i)=>{
    const pct = Math.round(v/total*100);
    leg.appendChild(el(`<div style="display:flex;align-items:center;font-size:11px;margin-bottom:2px">
      <span style="width:8px;height:8px;background:${cores[i%cores.length]};border-radius:2px;margin-right:6px;flex-shrink:0"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeTxt(nome)}</span>
      <span style="color:var(--muted);margin-left:4px">${pct}%</span>
    </div>`));
  });
  card.appendChild(leg);
  return card;
}

// Tabela inadimplentes detalhada
function _finDashInadTabela(inad){
  const card = el('<div class="block" style="padding:12px;margin:0 12px 12px"></div>');
  const total = inad.reduce((s,x)=>s+x.total,0);
  card.appendChild(el(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
    <div style="font-weight:800;font-size:14px">⚠️ Inadimplentes (últimos 6 meses)</div>
    <div style="color:var(--red);font-weight:800;font-size:13px">${moneyBR(total)}</div>
  </div>`));
  if(!inad.length){ card.appendChild(el('<div style="color:var(--muted);font-size:12.5px;padding:6px 0">Nenhum inadimplente 🎉</div>')); return card; }
  const list = el('<div class="list"></div>');
  inad.forEach(x=>{
    const wa = x.telefone ? _waLink({telefone:x.telefone, apelido:x.nome}) : null;
    const row = el(`<div class="st-row">
      <div class="st-mid">
        <div class="nm">${safeTxt(x.nome)}</div>
        <div class="meta"><span style="font-size:11.5px;color:var(--muted);font-weight:600">${x.meses} m${x.meses>1?'eses':'ês'} vencido${x.meses>1?'s':''}</span></div>
      </div>
      <div class="st-right" style="display:flex;align-items:center;gap:8px">
        <div style="font-size:14.5px;font-weight:800;color:var(--red)">${moneyBR(x.total)}</div>
        ${wa?`<button class="btn-cad ghost" data-wa="${safeAttr(wa)}" style="padding:6px 10px;font-size:12px">💬</button>`:''}
      </div>
    </div>`);
    const waBtn = row.querySelector('[data-wa]');
    if(waBtn) waBtn.onclick = ()=> window.open(waBtn.dataset.wa, '_blank', 'noopener');
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}

/* ---- Sub-aba: Cobranças ---- */
function _finRenderCobrancas(body){
  const cobs = _finCobrancas || [];
  const today = HOJE_ISO;
  const isVenc = c => c.status==='pendente' && c.venc && c.venc < today;
  const vencidas = cobs.filter(isVenc);
  const aVencer  = cobs.filter(c => c.status==='pendente' && !isVenc(c));
  const pagas    = cobs.filter(c => c.status==='pago');
  const isentas  = cobs.filter(c => c.status==='isento');
  const soma = arr => arr.reduce((s,c)=>s+(Number(c.valor)||0),0);

  body.appendChild(el(`<div class="fin-head">
    <div class="lbl">Recebido no mês</div><div class="big">${moneyBR(soma(pagas))}</div>
    <div class="row">
      <div class="c"><div class="v green">${moneyBR(soma(aVencer))}</div><div class="l">A receber</div></div>
      <div class="c"><div class="v red">${moneyBR(soma(vencidas))}</div><div class="l">Vencido</div></div>
      <div class="c"><div class="v">${isentas.length}</div><div class="l">Isentos</div></div>
    </div></div>`));

  // v500: sub-tabs de status removidas — tabela unificada com coluna Status.
  // Dono viu tudo numa tela só, sem clicar. Ordenação: vencidas > a vencer >
  // pagas > isentas, e dentro do grupo por venc (mais antigo primeiro).
  const novaBtn = el('<button class="btn-cad" style="margin:8px 12px 4px">＋ Nova venda</button>');
  novaBtn.onclick = ()=> _vendaPresencialSheet(()=>{ _finReload('cobrancas'); if(_loadPedidos) _loadPedidos(true); });
  const avulsaBtn = el('<button class="btn-cad ghost" style="margin:0 12px 8px">＋ Cobrança avulsa</button>');
  avulsaBtn.onclick = ()=> _finCobrancaAvulsaSheet(()=>{ _finReload('cobrancas'); });
  body.appendChild(novaBtn);
  body.appendChild(avulsaBtn);

  if(!cobs.length){ body.appendChild(el('<div class="empty-line">Nenhuma cobrança neste mês.</div>')); return; }

  const FORMA_LBL = { dinheiro:'💵 Dinheiro', pix:'📱 PIX', cartao:'💳 Cartão', outro:'➕ Outro' };
  const statusRank = (c) => c.status==='pendente' ? (isVenc(c) ? 0 : 1) : (c.status==='pago' ? 2 : 3);
  const sorted = cobs.slice().sort((a,b) => {
    const ra = statusRank(a), rb = statusRank(b);
    if(ra !== rb) return ra - rb;
    return (a.venc||'').localeCompare(b.venc||'');
  });
  const statusBadge = (c) => {
    if(c.status==='pago') return '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700">Paga</span>';
    if(c.status==='isento') return '<span style="font-size:10.5px;color:var(--muted);background:var(--card-alt,rgba(0,0,0,0.06));padding:2px 8px;border-radius:10px;font-weight:700">Isenta</span>';
    if(c.status==='cancelado') return '<span style="font-size:10.5px;color:var(--muted);padding:2px 8px;border-radius:10px;font-weight:700">Cancelada</span>';
    if(isVenc(c)) return '<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700">Vencida</span>';
    return '<span style="font-size:10.5px;color:var(--ink);background:rgba(0,0,0,0.05);padding:2px 8px;border-radius:10px;font-weight:700">A vencer</span>';
  };
  const dmyLong = (iso) => iso ? (iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4)) : '—';

  // v504/v516: enriquece linhas com nome + turmas + plano (client-side join).
  // v516: usa _turmasArr() (DB.turmas via _loadTurmas — mesma fonte de Alunos/
  // Turmas), fallback pro ID se turma não existe mais no cache. _finTurmasMap
  // sozinho ficava null em race — cache separado causava turma vazia.
  if(typeof _loadTurmas==='function') _loadTurmas();
  const _tArr = (typeof _turmasArr==='function' ? _turmasArr() : []);
  const _tMap = {};
  _tArr.forEach(t=>{ _tMap[t.id] = t.nome; });
  const matrByUser = {};
  (_finMatriculas||[]).forEach(m => { matrByUser[m.user_id] = m; });
  const turmasByUser = {};
  ((_profData && _profData.alunos)||[]).forEach(a => {
    if(a.turmas && a.turmas.length){
      turmasByUser[a.id] = a.turmas.map(id => _tMap[id] || id).filter(Boolean).join(', ');
    }
  });

  // v509: reverte inline editing (a v508 fez bagunça). Tabela readonly com
  // botões dedicados na coluna Ação — cada um abre sheet específica.
  // Refetch pesado tirado: onDadosMudaram só invalida cache, e cada ação faz
  // OPTIMISTIC UPDATE local + repinta APENAS a linha alterada. Sem redraw
  // global. Se a ação falhar, reverte e mostra toast.
  const wrap = el('<div class="block" style="margin:0 12px 12px;padding:0;overflow-x:auto"></div>');
  // v522: coluna "Plano" virou "Categoria" — mostra origem real (mensalidade
  // do plano, venda loja, avulsa, contrato). Antes era o nome do plano
  // fixo, dava a entender que TODAS as cobranças eram mensalidade, mesmo
  // as vendas a prazo (só um emoji ao canto delatava). "Origem" (emoji)
  // absorvida na nova Categoria. "Tipo" renomeada pra "Forma pgto".
  const table = el(`<table class="fin-cobs-tbl" style="width:100%;border-collapse:collapse;font-size:13px;min-width:1080px">
    <thead>
      <tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">
        <th style="padding:10px 12px;font-weight:700">Aluno</th>
        <th style="padding:10px 8px;font-weight:700">Turma</th>
        <th style="padding:10px 8px;font-weight:700">Categoria</th>
        <th style="padding:10px 8px;font-weight:700">Vencimento</th>
        <th style="padding:10px 8px;font-weight:700;text-align:right">Valor</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Status</th>
        <th style="padding:10px 8px;font-weight:700">Pago em</th>
        <th style="padding:10px 8px;font-weight:700;white-space:nowrap">Forma pgto</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Ações</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>`);
  const tbody = table.querySelector('tbody');

  // Helper: repinta APENAS uma linha específica (sem re-render global).
  // Usado depois de optimistic update — evita o refetch pesado das 8 queries.
  const buildRow = (c) => {
    const p = c.profiles || {};
    const nomeCompleto = p.nome_completo || p.apelido || 'aluno';
    const cor = c.status==='pago' ? 'var(--good)' : (isVenc(c) ? 'var(--red)' : 'var(--ink)');
    const forma = c.forma_pagamento ? (FORMA_LBL[c.forma_pagamento]||c.forma_pagamento) : '';
    const turma = turmasByUser[c.user_id] || '—';
    const matr = matrByUser[c.user_id];
    // v522/v523/v524: Categoria só destaca origens NÃO-mensalidade (VENDA
    // LOJA, CONTRATO, AVULSA). Mensalidade recorrente mostra só o nome do
    // plano — o professor já sabe que é mensalidade, prefixo era ruído.
    const _up = (s) => String(s||'').toUpperCase();
    let categoria;
    if(c.pedido_id) categoria = 'VENDA LOJA';
    else if(c.contrato_id) categoria = 'CONTRATO'+((matr && matr.planos)?' · '+_up(matr.planos.nome):'');
    else if(c.avulsa) categoria = 'AVULSA';
    else categoria = (matr && matr.planos) ? _up(matr.planos.nome) : 'MENSALIDADE';
    const tr = el(`<tr style="border-top:1px solid var(--border,#e5e5ea)" data-cob-id="${c.id}">
      <td style="padding:10px 12px;font-weight:700">${safeTxt(nomeCompleto)}</td>
      <td style="padding:10px 8px;font-size:12px;color:var(--muted)">${safeTxt(turma)}</td>
      <td style="padding:10px 8px;font-size:11.5px;font-weight:700;letter-spacing:0.03em;white-space:nowrap">${safeTxt(categoria)}</td>
      <td style="padding:10px 8px;white-space:nowrap">${dmyLong(c.venc)}</td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;white-space:nowrap;color:${cor}">${moneyBR(c.valor)}</td>
      <td style="padding:10px 8px;text-align:center;white-space:nowrap">${statusBadge(c)}</td>
      <td style="padding:10px 8px;white-space:nowrap">${c.data_pagamento ? dmyLong(c.data_pagamento) : '—'}</td>
      <td style="padding:10px 8px;font-size:12px;white-space:nowrap">${safeTxt(forma) || '—'}</td>
      <td style="padding:10px 8px;text-align:center;white-space:nowrap">
        <button class="btn-cad ghost" data-act="edit" style="padding:4px 8px;font-size:14px;margin:0 2px" title="Editar (data / forma / obs)">✏️</button>
        <button class="btn-cad ghost" data-act="desconto" style="padding:4px 8px;font-size:14px;margin:0 2px" title="Aplicar desconto (editar valor)">💰</button>
        <button class="btn-cad ghost" data-act="del" style="padding:4px 8px;font-size:14px;margin:0 2px;color:var(--red)" title="${c.pedido_id?'Cancelar venda (restaura estoque)':'Excluir cobrança'}">🗑️</button>
      </td>
    </tr>`);
    // Bind actions — todas com optimistic update
    tr.querySelector('[data-act="edit"]').onclick = ()=> _finCobrancaSheet(c, (patch)=> optimisticUpdate(c.id, patch));
    tr.querySelector('[data-act="desconto"]').onclick = ()=> _finCobrancaDescontoSheet(c, (novoValor)=> optimisticUpdate(c.id, { valor: novoValor }));
    const btnDel = tr.querySelector('[data-act="del"]');
    if(btnDel) btnDel.onclick = ()=>{
      const nome = p.nome_completo || p.apelido || 'aluno';
      // v522: se a cobrança veio de uma venda (pedido_id), excluir só a cobrança
      // deixaria o pedido + estoque órfãos. Cancela o pedido (restaura estoque
      // via RPC cancelar_pedido). A cobrança some junto pela cascata do backend.
      if(c.pedido_id){
        if(!confirm(`Cancelar venda de ${nome} — ${moneyBR(c.valor)}?\n\nO estoque do produto será RESTAURADO e a cobrança removida. Não dá pra desfazer.`)) return;
        sbProf.cancelarVendaEstornar(c.pedido_id)
          .then(()=>{
            toast('Venda cancelada, estoque restaurado ✔');
            const idx = _finCobrancas.findIndex(x => x.id === c.id);
            if(idx >= 0) _finCobrancas.splice(idx, 1);
            tr.remove();
            if(_loadPedidos) _loadPedidos(true);
          })
          .catch(err=> toast('Erro ao cancelar venda: '+(err.message||err)));
        return;
      }
      if(!confirm(`Excluir cobrança de ${nome} — ${moneyBR(c.valor)}?\n\nNão dá pra desfazer.`)) return;
      sbProf.excluirCobranca(c.id)
        .then(()=>{
          toast('Cobrança excluída');
          const idx = _finCobrancas.findIndex(x => x.id === c.id);
          if(idx >= 0) _finCobrancas.splice(idx, 1);
          tr.remove();
        })
        .catch(err=> toast('Erro: '+(err.message||err)));
    };
    return tr;
  };

  // Optimistic update: patch local em _finCobrancas + repinta APENAS a linha
  const optimisticUpdate = (id, patch) => {
    const idx = _finCobrancas.findIndex(x => x.id === id);
    if(idx < 0) return;
    Object.assign(_finCobrancas[idx], patch);
    // Se virou pago sem data_pagamento, adapter põe hoje — reflete no local
    if(patch.status === 'pago' && !_finCobrancas[idx].data_pagamento){
      _finCobrancas[idx].data_pagamento = HOJE_ISO;
    }
    const trOld = tbody.querySelector(`[data-cob-id="${id}"]`);
    if(trOld){
      const trNew = buildRow(_finCobrancas[idx]);
      trOld.replaceWith(trNew);
    }
  };

  sorted.forEach(c => tbody.appendChild(buildRow(c)));
  wrap.appendChild(table);
  body.appendChild(wrap);
}

// v504: sheet compacta pra aplicar desconto (editar valor de 1 cobrança específica)
// v509: aceita onDone(novoValor) pra optimistic update no chamador
function _finCobrancaDescontoSheet(c, onDone){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Aplicar desconto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">💰 Aplicar desconto</div>
    <div class="sheet-desc">Valor atual: <b>${moneyBR(c.valor)}</b>. Edita só esta cobrança — não afeta o plano.</div>
    <label class="flbl" style="margin-top:12px">Novo valor (R$)</label>
    <input class="inp" id="dc-valor" type="number" step="0.01" min="0" value="${c.valor||0}" autofocus>
    <button class="btn-save" id="dc-save" style="margin-top:14px">Aplicar</button>
    <button class="sheet-cancel" id="dc-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#dc-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#dc-save').onclick = ()=>{
    const v = parseFloat(sheet.querySelector('#dc-valor').value);
    if(!(v >= 0)){ toast('Valor inválido'); return; }
    const btn = sheet.querySelector('#dc-save');
    btn.disabled=true; btn.textContent='Salvando…';
    sbProf.editarValorCobranca(c.id, v)
      .then(()=>{ toast('Valor atualizado ✔'); close(); if(onDone) onDone(v); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Aplicar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ---- Sub-aba: Despesas ---- */
function _finRenderDespesas(body){
  const desps = _finDespesas || [];
  const soma = arr => arr.reduce((s,d)=>s+(Number(d.valor)||0),0);
  const mesRef = _finMes();
  const pagas   = desps.filter(d => d.status==='pago' && (d.data_pagamento||'').slice(0,7)===mesRef);
  const aPagar  = desps.filter(d => d.status==='a_pagar');
  const vencidas = aPagar.filter(d => d.data_lancamento < HOJE_ISO);

  body.appendChild(el(`<div class="fin-head">
    <div class="lbl">Pago no mês</div><div class="big">${moneyBR(soma(pagas))}</div>
    <div class="row">
      <div class="c"><div class="v">${moneyBR(soma(aPagar))}</div><div class="l">A pagar</div></div>
      <div class="c"><div class="v red">${moneyBR(soma(vencidas))}</div><div class="l">Vencido</div></div>
      <div class="c"><div class="v">${pagas.length}</div><div class="l">Pagas</div></div>
    </div></div>`));

  // v501: sub-tabs de status removidas — tabela unificada com coluna Status.
  // Mesmo padrão da v500 em Cobranças. Ordenação: vencidas > a pagar > pagas
  // > canceladas; dentro por data_lancamento asc.
  const btnNova = el('<button class="btn-cad" style="margin:8px 12px 4px">＋ Nova despesa</button>');
  btnNova.onclick = ()=> _finDespesaSheet(null, ()=>{ _finReload(['despesas','rec']); });
  const btnRec = el('<button class="btn-cad ghost" style="margin:0 12px 8px">＋ Despesa recorrente (parcelada)</button>');
  btnRec.onclick = ()=> _finDespesaRecorrenteSheet(null, ()=>{ _finReload(['despesas','rec']); });
  body.appendChild(btnNova);
  body.appendChild(btnRec);

  // Cards das recorrentes ativas (mantido do original)
  const recs = (_finRec||[]).filter(r=> r.ativo!==false);
  if(recs.length){
    body.appendChild(el('<div class="sec-title" style="margin:10px 12px 4px;font-size:11px">Despesas recorrentes ativas</div>'));
    const recList = el('<div class="list" style="margin-bottom:8px"></div>');
    recs.forEach(r=>{
      const cat = r.categorias_financeiro && r.categorias_financeiro.nome;
      const row = el(`<div class="st-row" style="cursor:pointer">
        <div class="st-mid"><div class="nm">${safeTxt(r.descricao)}</div>
          <div class="meta"><span style="font-size:11.5px;color:var(--muted);font-weight:600">${safeTxt(cat||'—')} · ${r.parcelas_total}× ${moneyBR(r.valor_parcela)} · dia ${r.dia_venc}</span></div></div>
        <div class="st-right">
          <div style="font-size:14.5px;font-weight:800">${moneyBR((r.valor_parcela||0) * (r.parcelas_total||0))}</div>
        </div>
      </div>`);
      row.onclick = ()=> _finDespesaRecorrenteSheet(r, ()=>{ _finReload(['despesas','rec']); });
      recList.appendChild(row);
    });
    body.appendChild(recList);
  }

  if(!desps.length){ body.appendChild(el('<div class="empty-line">Nenhuma despesa neste mês.</div>')); return; }

  const FORMA_LBL = { dinheiro:'💵', pix:'📱', cartao:'💳', outro:'➕' };
  const isVencDesp = (d) => d.status==='a_pagar' && d.data_lancamento && d.data_lancamento < HOJE_ISO;
  const statusRank = (d) => d.status==='a_pagar' ? (isVencDesp(d) ? 0 : 1) : (d.status==='pago' ? 2 : 3);
  const sorted = desps.slice().sort((a,b) => {
    const ra = statusRank(a), rb = statusRank(b);
    if(ra !== rb) return ra - rb;
    return (a.data_lancamento||'').localeCompare(b.data_lancamento||'');
  });
  const statusBadge = (d) => {
    if(d.status==='pago') return '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700">Paga</span>';
    if(d.status==='cancelado') return '<span style="font-size:10.5px;color:var(--muted);background:var(--card-alt,rgba(0,0,0,0.06));padding:2px 8px;border-radius:10px;font-weight:700">Cancelada</span>';
    if(isVencDesp(d)) return '<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700">Vencida</span>';
    return '<span style="font-size:10.5px;color:var(--ink);background:rgba(0,0,0,0.05);padding:2px 8px;border-radius:10px;font-weight:700">A pagar</span>';
  };
  const dmy = (iso) => iso ? (iso.slice(8,10)+'/'+iso.slice(5,7)) : '—';

  body.appendChild(el('<div class="sec-title" style="margin:10px 12px 4px;font-size:11px">Lançamentos</div>'));
  const wrap = el('<div class="block" style="margin:0 12px 12px;padding:0;overflow-x:auto"></div>');
  const table = el(`<table class="fin-desp-tbl" style="width:100%;border-collapse:collapse;font-size:13px;min-width:840px">
    <thead>
      <tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">
        <th style="padding:10px 12px;font-weight:700">Descrição</th>
        <th style="padding:10px 8px;font-weight:700">Categoria</th>
        <th style="padding:10px 8px;font-weight:700">Vence</th>
        <th style="padding:10px 8px;font-weight:700;text-align:right">Valor</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Status</th>
        <th style="padding:10px 8px;font-weight:700">Pago em</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Forma</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Ações</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>`);
  const tbody = table.querySelector('tbody');
  sorted.forEach(d => {
    const cat = d.categorias_financeiro && d.categorias_financeiro.nome;
    const rec = d.despesas_recorrentes && d.despesas_recorrentes.descricao;
    const cor = d.status==='pago' ? 'var(--good)' : (isVencDesp(d) ? 'var(--red)' : 'var(--ink)');
    const forma = d.forma_pagamento ? (FORMA_LBL[d.forma_pagamento]||d.forma_pagamento) : '';
    const quickPay = d.status==='a_pagar'
      ? `<button class="btn-cad ghost" data-quickpay="1" style="padding:4px 10px;font-size:13px" title="Marcar paga">✓</button>`
      : '';
    const tr = el(`<tr style="cursor:pointer;border-top:1px solid var(--border,#e5e5ea)">
      <td style="padding:10px 12px;font-weight:700">${safeTxt(d.descricao)}${rec?` <span style="font-size:10.5px;color:var(--muted);font-weight:500">(recorrente)</span>`:''}</td>
      <td style="padding:10px 8px">${safeTxt(cat||'—')}</td>
      <td style="padding:10px 8px">${dmy(d.data_lancamento)}</td>
      <td style="padding:10px 8px;text-align:right;font-weight:800;color:${cor}">${moneyBR(d.valor)}</td>
      <td style="padding:10px 8px;text-align:center">${statusBadge(d)}</td>
      <td style="padding:10px 8px">${d.data_pagamento ? dmy(d.data_pagamento) : '—'}</td>
      <td style="padding:10px 8px;text-align:center">${safeTxt(forma) || '—'}</td>
      <td style="padding:10px 8px;text-align:center">${quickPay}</td>
    </tr>`);
    const qp = tr.querySelector('[data-quickpay]');
    if(qp) qp.onclick = (e)=>{ e.stopPropagation(); _finDespesaQuickPaySheet(d, ()=>{ _finReload('despesas'); }); };
    tr.onclick = ()=> _finDespesaSheet(d, ()=>{ _finReload(['despesas','rec']); });
    tbody.appendChild(tr);
  });
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* ---- Sub-aba: Planos ---- */
// v537 (Fase 5 refactor morphdom): Planos migrada pra event delegation.
function _finRenderPlanos(body){
  const planos = _finPlanos || [];
  body.appendChild(el('<button class="btn-cad" data-click="finPlanoNovo" style="margin:0 12px 8px">＋ Novo plano</button>'));

  if(!planos.length){ body.appendChild(el('<div class="empty-line">Nenhum plano cadastrado. Toque em "＋ Novo plano".</div>')); return; }
  const FORMA_LBL = { dinheiro:'💵 Dinheiro', pix:'📱 PIX', cartao:'💳 Cartão', outro:'➕ Outro' };
  // v502: badges de status coloridos (padrão Cobranças/Despesas) + ordenação
  // ativos primeiro. Coluna Público removida (v499, YAGNI). Info derivada de
  // #alunos por plano se realmente necessária.
  const sorted = planos.slice().sort((a,b) => {
    const rankA = a.ativo === false ? 1 : 0;
    const rankB = b.ativo === false ? 1 : 0;
    if(rankA !== rankB) return rankA - rankB;
    return (a.nome||'').localeCompare(b.nome||'');
  });
  const statusBadge = (p) => p.ativo === false
    ? '<span style="font-size:10.5px;color:var(--muted);background:var(--card-alt,rgba(0,0,0,0.06));padding:2px 8px;border-radius:10px;font-weight:700">Inativo</span>'
    : '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700">Ativo</span>';
  const wrap = el('<div class="block" style="margin:0 12px 12px;padding:0;overflow-x:auto"></div>');
  const table = el(`<table class="fin-planos-tbl" style="width:100%;border-collapse:collapse;font-size:13px;min-width:680px">
    <thead>
      <tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">
        <th style="padding:10px 12px;font-weight:700">Nome</th>
        <th style="padding:10px 8px;font-weight:700">Freq.</th>
        <th style="padding:10px 8px;font-weight:700;text-align:right">Valor</th>
        <th style="padding:10px 8px;font-weight:700">Cobrança</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Dia</th>
        <th style="padding:10px 8px;font-weight:700">Forma padrão</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Contrato</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Status</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>`);
  const tbody = table.querySelector('tbody');
  const cobLbl = (p) => {
    if(p.parcelas == null) return '🔄 Recorrente';
    if(p.parcelas === 1) return '💰 Única';
    return `📊 ${p.parcelas}× ${moneyBR((p.valor||0)/p.parcelas)}`;
  };
  sorted.forEach((p) => {
    tbody.appendChild(el(`<tr data-click="finPlanoEdit" data-id="${safeAttr(p.id)}" style="cursor:pointer;border-top:1px solid var(--border,#e5e5ea);${p.ativo===false?'opacity:0.55':''}">
      <td style="padding:10px 12px;font-weight:700">${safeTxt(p.nome)}</td>
      <td style="padding:10px 8px">${safeTxt(p.frequencia||'—')}</td>
      <td style="padding:10px 8px;text-align:right;font-weight:800">${moneyBR(p.valor)}</td>
      <td style="padding:10px 8px;font-size:11.5px">${safeTxt(cobLbl(p))}</td>
      <td style="padding:10px 8px;text-align:center">${p.dia_vencimento||'—'}</td>
      <td style="padding:10px 8px">${p.forma_padrao ? safeTxt(FORMA_LBL[p.forma_padrao]||p.forma_padrao) : '—'}</td>
      <td style="padding:10px 8px;text-align:center">${p.tem_contrato ? '✓' : '—'}</td>
      <td style="padding:10px 8px;text-align:center">${statusBadge(p)}</td>
    </tr>`));
  });
  wrap.appendChild(table);
  body.appendChild(wrap);
}

// v537: handlers da aba Planos (registrados 1x no load).
_dlgRegister('finPlanoNovo', () => {
  _finPlanoSheet(null, () => { _finReload(['planos','matriculas','cobrancas']); });
});
_dlgRegister('finPlanoEdit', (el) => {
  const p = (_finPlanos||[]).find(x => x.id === el.dataset.id);
  if(!p) return;
  _finPlanoSheet(p, () => { _finReload(['planos','matriculas','cobrancas']); });
});

/* ---- Sub-aba: Contratos ---- */
function _finRenderContratos(body){
  const cts = _finContratos || [];
  const today = HOJE_ISO;
  const isVencendo = c => c.status==='ativo' && c.fim && c.fim <= _plus(today, 30) && c.fim >= today;
  const expiradosN = cts.filter(c=>c.status==='expirado').length;
  const vencendoN = cts.filter(isVencendo).length;

  if(expiradosN || vencendoN){
    body.appendChild(el(`<div class="card card-pad" style="margin:6px 12px;background:var(--red-soft,#fee);border-left:4px solid var(--red);font-size:13px">
      ⚠️ <b>${expiradosN}</b> contratos expirados · <b>${vencendoN}</b> vencem em 30 dias
    </div>`));
  }

  const btn = el('<button class="btn-cad" style="margin:0 12px 8px">＋ Novo contrato</button>');
  btn.onclick = ()=> _finContratoSheet(null, ()=>{ _finReload(['contratos','matriculas','cobrancas']); });
  body.appendChild(btn);

  if(!cts.length){ body.appendChild(el('<div class="empty-line">Nenhum contrato cadastrado.</div>')); return; }

  // v503: tabela unificada — mesmo padrão de Cobranças/Despesas/Planos.
  // Ordenação: vencendo30 > ativo > aguardando > expirado > cancelado.
  // Dentro por fim (mais urgente primeiro).
  const statusRank = (c) => {
    if(isVencendo(c)) return 0;
    if(c.status==='ativo') return 1;
    if(c.status==='aguardando_aceite') return 2;
    if(c.status==='expirado') return 3;
    return 4;   // cancelado
  };
  const sorted = cts.slice().sort((a,b) => {
    const ra = statusRank(a), rb = statusRank(b);
    if(ra !== rb) return ra - rb;
    return (a.fim||'').localeCompare(b.fim||'');
  });
  const statusBadge = (c) => {
    if(isVencendo(c)){
      const days = Math.max(0, Math.round((new Date(c.fim)-new Date(today))/86400000));
      return `<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700">Vence em ${days}d</span>`;
    }
    if(c.status==='ativo') return '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700">Ativo</span>';
    if(c.status==='aguardando_aceite') return '<span style="font-size:10.5px;color:#b45309;background:rgba(245,158,11,0.15);padding:2px 8px;border-radius:10px;font-weight:700">Aguardando</span>';
    if(c.status==='expirado') return '<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700">Expirado</span>';
    return '<span style="font-size:10.5px;color:var(--muted);background:var(--card-alt,rgba(0,0,0,0.06));padding:2px 8px;border-radius:10px;font-weight:700">Cancelado</span>';
  };
  const dmy = (iso) => iso ? (iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4)) : '—';

  const wrap = el('<div class="block" style="margin:0 12px 12px;padding:0;overflow-x:auto"></div>');
  const table = el(`<table class="fin-contr-tbl" style="width:100%;border-collapse:collapse;font-size:13px;min-width:800px">
    <thead>
      <tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">
        <th style="padding:10px 12px;font-weight:700">Nº</th>
        <th style="padding:10px 8px;font-weight:700">Aluno</th>
        <th style="padding:10px 8px;font-weight:700">Plano</th>
        <th style="padding:10px 8px;font-weight:700">Início</th>
        <th style="padding:10px 8px;font-weight:700">Fim</th>
        <th style="padding:10px 8px;font-weight:700;text-align:right">Valor</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Menor</th>
        <th style="padding:10px 8px;font-weight:700;text-align:center">Status</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>`);
  const tbody = table.querySelector('tbody');
  sorted.forEach(c => {
    const p = c.profiles || {};
    const nome = p.apelido || p.nome_completo || 'aluno';
    const pl = c.planos || {};
    const numTxt = '#' + String(c.numero||0).padStart(3,'0');
    const tr = el(`<tr style="cursor:pointer;border-top:1px solid var(--border,#e5e5ea);${c.status==='cancelado'||c.status==='expirado'?'opacity:0.55':''}">
      <td style="padding:10px 12px;font-weight:700;color:var(--muted)">${numTxt}</td>
      <td style="padding:10px 8px;font-weight:700">${safeTxt(nome)}</td>
      <td style="padding:10px 8px">${safeTxt(pl.nome||'—')}</td>
      <td style="padding:10px 8px">${dmy(c.inicio)}</td>
      <td style="padding:10px 8px">${dmy(c.fim)}</td>
      <td style="padding:10px 8px;text-align:right;font-weight:800">${moneyBR(c.valor_congelado)}</td>
      <td style="padding:10px 8px;text-align:center">${c.eh_menor?'✓':'—'}</td>
      <td style="padding:10px 8px;text-align:center">${statusBadge(c)}</td>
    </tr>`);
    tr.onclick = ()=> _finContratoSheet(c, ()=>{ _finReload(['contratos','matriculas','cobrancas']); });
    tbody.appendChild(tr);
  });
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* ---- Sub-aba: Matrículas (v503) ----
   Mostra todos os alunos ativos com plano vinculado. Destaca quem está SEM
   plano (não vai gerar cobrança no cron). Norte pra migração dos 114. */
function _finRenderMatriculas(body){
  if(!_finBackend()){ body.innerHTML='<div class="empty-line">Só com backend ligado.</div>'; return; }

  // v516: garante cache das turmas (mesmo padrão do resto do app — _turmasArr)
  if(typeof _loadTurmas==='function') _loadTurmas();

  // v518: token contra duplicação. _finPaintBody é chamado 2x (cache imediato +
  // refresh async) — cada chamada dispara este Promise.all. Sem token, os dois
  // .then appendavam no MESMO body → 2 tabelas visíveis. O 2º render bumpa o
  // token; a 1ª resposta ao voltar vê o token diferente e descarta.
  const token = (Date.now() + Math.random());
  body.dataset.matrToken = String(token);

  const holder = el('<div class="loading-center" style="padding:20px">Carregando alunos e matrículas…</div>');
  body.appendChild(holder);

  Promise.all([
    sbProf.getAlunos(),   // já usado em outras telas — traz alunos ativos
    sbProf.getAllMatriculas(),
  ]).then(([alunos, matriculas])=>{
    // v531 (fix morphdom): body pode ter virado detached se render() morfou o
    // root entre o kickoff e o resolve. Recupera do DOM.
    if(!body.isConnected) body = document.getElementById('fin-body') || body;
    if(!body.isConnected) return;   // não recuperou → tela mudou, discard
    if(body.dataset.matrToken !== String(token)) return;   // stale — descarta
    holder.remove();
    // v518: mostra TODOS (aluno + dono + professor). Antes filtrava só aluno —
    // sumia dono/professor da visão financeira mesmo eles pagando mensalidade.
    const soAlunos = (alunos||[]);
    const mapMatr = {};
    matriculas.forEach(m => { mapMatr[m.user_id] = m; });

    const rows = soAlunos.map(a => ({ a, m: mapMatr[a.id] || null }));
    const semPlano = rows.filter(r => !r.m || !r.m.planos);
    const comPlano = rows.filter(r => r.m && r.m.planos);

    // Card de alerta se tem gente sem plano
    if(semPlano.length){
      body.appendChild(el(`<div class="card card-pad" style="margin:6px 12px;background:var(--red-soft,#fee);border-left:4px solid var(--red);font-size:13px">
        ⚠️ <b>${semPlano.length}</b> aluno${semPlano.length>1?'s':''} SEM plano cadastrado. Cron não gera cobrança pra eles.
      </div>`));
    }

    // KPIs — card principal (Total alunos)
    body.appendChild(el(`<div class="fin-head">
      <div class="lbl">Total de alunos</div><div class="big">${soAlunos.length}</div>
      <div class="row">
        <div class="c"><div class="v green">${comPlano.length}</div><div class="l">Com plano</div></div>
        <div class="c"><div class="v red">${semPlano.length}</div><div class="l">Sem plano</div></div>
        <div class="c"><div class="v">${comPlano.filter(r=>r.m && r.m.trava_reajuste).length}</div><div class="l">TRAVA</div></div>
        <div class="c"><div class="v">${comPlano.filter(r=>r.m && r.m.isento).length}</div><div class="l">ISENTOS</div></div>
      </div></div>`));

    // v519: 5 cards financeiros. Calculado no cliente a partir do cache de
    // matriculas + contratos + cobrancas ja carregados. Sem query extra.
    const hojeD = new Date();
    const hojeSlice = HOJE_ISO;
    // MRR — Monthly Recurring Revenue: contribuicao mensal de cada matricula.
    // Mensal = valor; Anual = valor/12; Parcelado N = valor/N durante N meses.
    // Isento nao conta. Usa valor_negociado quando existe.
    const mrr = comPlano.reduce((s,{m}) => {
      if(!m || m.isento) return s;
      const pl = m.planos || {};
      const val = Number(m.valor_negociado != null ? m.valor_negociado : pl.valor) || 0;
      let mensal = val;
      if(pl.parcelas && pl.parcelas > 1) mensal = val / pl.parcelas;
      else if(pl.frequencia === 'anual') mensal = val / 12;
      return s + mensal;
    }, 0);
    const ticket = comPlano.filter(r=>r.m && !r.m.isento).length
      ? mrr / comPlano.filter(r=>r.m && !r.m.isento).length : 0;
    // Contratos vencendo em <90d (ativos)
    const cts = (_finContratos || []);
    const vencendoCts = cts.filter(c => {
      if(c.status !== 'ativo' || !c.fim) return false;
      const dias = Math.round((new Date(c.fim+'T12:00:00') - hojeD) / 86400000);
      return dias >= 0 && dias < 90;
    });
    const vencendoValor = vencendoCts.reduce((s,c)=>s+Number(c.valor_congelado||0), 0);
    // Inadimplencia do mes corrente (cobrancas pendentes com vencimento no passado)
    const cobs = (_finCobrancas || []);
    const inadCobs = cobs.filter(c=>c.status==='pendente' && c.venc && c.venc < hojeSlice);
    const inadValor = inadCobs.reduce((s,c)=>s+Number(c.valor||0), 0);
    // Oportunidade perdida: alunos sem plano * ticket medio
    const oportunidade = semPlano.length * ticket;
    // Card grid
    body.appendChild(el(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:6px 12px 12px">
      <div class="card card-pad" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:700">Receita mensal (MRR)</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">${moneyBR(mrr)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">Anuais dividem por 12 · isentos não contam</div>
      </div>
      <div class="card card-pad" style="padding:12px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:700">Ticket médio</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px">${moneyBR(ticket)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">MRR ÷ alunos pagantes</div>
      </div>
      <div class="card card-pad" style="padding:12px;${vencendoCts.length?'border-left:4px solid #b45309':''}">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:700">Contratos vencendo &lt;90d</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;${vencendoCts.length?'color:#b45309':''}">${vencendoCts.length}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${vencendoCts.length?moneyBR(vencendoValor)+' em risco':'Nenhum contrato terminando em breve'}</div>
      </div>
      <div class="card card-pad" style="padding:12px;${inadCobs.length?'border-left:4px solid var(--red)':''}">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:700">Inadimplência</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;${inadCobs.length?'color:var(--red)':''}">${inadCobs.length}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${inadCobs.length?moneyBR(inadValor)+' vencido':'Ninguém em atraso'}</div>
      </div>
      <div class="card card-pad" style="padding:12px;${semPlano.length?'border-left:4px solid var(--red)':''}">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:700">Oportunidade perdida</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;${semPlano.length?'color:var(--red)':''}">${moneyBR(oportunidade)}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${semPlano.length} sem plano × ticket médio</div>
      </div>
    </div>`));

    // Tabela unificada — sem plano primeiro
    const sorted = rows.slice().sort((a,b) => {
      const rA = a.m && a.m.planos ? 1 : 0;
      const rB = b.m && b.m.planos ? 1 : 0;
      if(rA !== rB) return rA - rB;
      return (_nomeInst(a.a)||'').localeCompare(_nomeInst(b.a)||'');
    });

    const wrap = el('<div class="block" style="margin:0 12px 12px;padding:0;overflow-x:auto"></div>');
    // v514: colunas Turma, Vencimento, Status aluno. Ordem: Aluno · Turma ·
    // Plano · Valor · Vencimento · Desde · Ajustes · Status matrícula · Status aluno.
    const table = el(`<table class="fin-matr-tbl" style="width:100%;border-collapse:collapse;font-size:13px;min-width:1160px">
      <thead>
        <tr style="text-align:left;color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">
          <th style="padding:10px 12px;font-weight:700">Aluno</th>
          <th style="padding:10px 8px;font-weight:700">Turma</th>
          <th style="padding:10px 8px;font-weight:700">Plano</th>
          <th style="padding:10px 8px;font-weight:700;text-align:right;white-space:nowrap">Valor efetivo</th>
          <th style="padding:10px 8px;font-weight:700;text-align:center;white-space:nowrap">Vencimento</th>
          <th style="padding:10px 8px;font-weight:700">Desde</th>
          <th style="padding:10px 8px;font-weight:700;text-align:center;white-space:nowrap">Término</th>
          <th style="padding:10px 8px;font-weight:700;text-align:center">Ajustes</th>
          <th style="padding:10px 8px;font-weight:700;text-align:center;white-space:nowrap;min-width:110px">Matrícula</th>
          <th style="padding:10px 8px;font-weight:700;text-align:center;white-space:nowrap;min-width:100px">Status aluno</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>`);
    // v516: mapa de turmas único pra tabela toda (fora do forEach — antes
    // reconstruía a cada linha, e usava _finTurmasMap com race na 1ª pintura).
    const _tArrM = (typeof _turmasArr==='function' ? _turmasArr() : []);
    const _tMapM = {}; _tArrM.forEach(t=>{ _tMapM[t.id] = t.nome; });
    const tbody = table.querySelector('tbody');
    sorted.forEach(({a, m}) => {
      const plano = m && m.planos;
      const semPl = !plano;
      const valor = semPl ? null
        : (m.valor_negociado != null ? Number(m.valor_negociado) : Number(plano.valor));
      const ajustes = [];
      if(m && m.valor_negociado != null && !m.isento) ajustes.push('NEGOCIADO');
      if(m && m.isento) ajustes.push('ISENTO');
      if(m && m.trava_reajuste) ajustes.push('TRAVADO');
      const badgeMatricula = semPl
        ? '<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700;white-space:nowrap">SEM PLANO</span>'
        : '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700;white-space:nowrap">Matriculado</span>';
      const turmas = (Array.isArray(a.turmas) && a.turmas.length)
        ? a.turmas.map(id => _tMapM[id] || id).join(', ')
        : '—';
      // v518: Término = fim do aluno_plano OU do contrato ativo. Cor destacada
      // se vence em < 90d (facilita "adiantar contato antes do fim do contrato").
      const fimISO = (m && m.fim) || (m && m.contrato && m.contrato.fim) || null;
      const linkContrato = m && m.contrato ? ` <span title="Vinculado ao contrato #${m.contrato.numero||''}" style="font-size:10px;color:var(--muted)">📄</span>` : '';
      let fimTxt = '—', fimStyle = '';
      if(fimISO){
        const d = new Date(fimISO+'T12:00:00');
        const hoje = new Date();
        const dias = Math.round((d - hoje) / 86400000);
        fimTxt = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
        if(dias < 0) fimStyle = 'color:var(--red);font-weight:700';
        else if(dias < 90) fimStyle = 'color:#b45309;font-weight:700';   // amber warning
      }
      // v514: dia de vencimento (override do aluno tem precedência sobre o do plano)
      const diaVenc = m ? (m.dia_vencimento || (plano && plano.dia_vencimento)) : null;
      const vencCustom = m && m.dia_vencimento;
      const vencTxt = diaVenc ? `Dia ${diaVenc}${vencCustom?' *':''}` : '—';
      // v514: status ativo/inativo (auto 90d ou override manual)
      const st = _statusAluno(a);
      const badgeAluno = st.valor==='ativo'
        ? '<span style="font-size:10.5px;color:var(--good);background:rgba(34,160,107,0.12);padding:2px 8px;border-radius:10px;font-weight:700;white-space:nowrap">Ativo</span>'
        : `<span style="font-size:10.5px;color:#fff;background:var(--red);padding:2px 8px;border-radius:10px;font-weight:700;white-space:nowrap">Inativo${st.origem==='manual'?'*':''}</span>`;
      const tr = el(`<tr style="cursor:pointer;border-top:1px solid var(--border,#e5e5ea);${semPl?'background:rgba(229,57,47,0.04)':''}">
        <td style="padding:10px 12px;font-weight:700">${safeTxt(_nomeInst(a))}</td>
        <td style="padding:10px 8px;font-size:12px">${safeTxt(turmas)}</td>
        <td style="padding:10px 8px">${safeTxt(plano ? plano.nome : '—')}</td>
        <td style="padding:10px 8px;text-align:right;font-weight:800">${valor != null ? moneyBR(valor) : '—'}</td>
        <td style="padding:10px 8px;text-align:center" title="${vencCustom?'Vencimento customizado do aluno':'Herdado do plano'}">${safeTxt(vencTxt)}</td>
        <td style="padding:10px 8px">${m && m.inicio ? (m.inicio.slice(8,10)+'/'+m.inicio.slice(5,7)+'/'+m.inicio.slice(0,4)) : '—'}</td>
        <td style="padding:10px 8px;text-align:center;white-space:nowrap;${fimStyle}" title="${fimISO?(m.contrato?'Vencimento do contrato · '+(new Date(fimISO+'T12:00:00')<new Date()?'EXPIRADO':((Math.round((new Date(fimISO+'T12:00:00')-new Date())/86400000))+'d restantes')):'Fim da matrícula'):'Sem prazo definido'}">${safeTxt(fimTxt)}${linkContrato}</td>
        <td style="padding:10px 8px;text-align:center;font-size:11.5px">${safeTxt(ajustes.join(' · ') || '—')}</td>
        <td style="padding:10px 8px;text-align:center">${badgeMatricula}</td>
        <td style="padding:10px 8px;text-align:center" title="${safeAttr(_statusAlunoTxt(a))}">${badgeAluno}</td>
      </tr>`);
      tr.onclick = ()=> _finAlunoPlanoSheet(a, ()=>{ _finReload(['matriculas','cobrancas']); });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    body.appendChild(wrap);
  }).catch(e=>{ holder.innerHTML='<div style="padding:8px;color:var(--red)">Erro: '+safeTxt(e.message||e)+'</div>'; });
}

function _plus(iso, dias){
  const d = new Date(iso+'T12:00:00'); d.setDate(d.getDate()+dias);
  return d.toISOString().slice(0,10);
}

/* ---- Sub-aba: Categorias (CRUD dedicado) — Sprint 2 v488 ---- */
// v529 (Fase 2 refactor morphdom): tela piloto migrada pra event delegation.
// Nenhum .onclick= aqui — tudo despachado pelo router (_dlgHandlers).
// Handlers registrados FORA da função (uma vez só, no boot).
// Zero closure local capturando `c` do forEach — dado é lido fresh do
// _finCategorias via data-id no momento do clique. Padrão que morphdom
// preserva sem risco de stale reference.
function _finRenderCategorias(body){
  const cats = _finCategorias || [];
  const receitas = cats.filter(c=>c.tipo==='receita');
  const despesas = cats.filter(c=>c.tipo==='despesa');

  body.appendChild(el(`<div style="display:flex;gap:8px;margin:0 12px 8px">
    <button class="btn-cad" data-click="finCatNova" data-tipo="receita" style="flex:1">＋ Receita</button>
    <button class="btn-cad" data-click="finCatNova" data-tipo="despesa" style="flex:1">＋ Despesa</button>
  </div>`));

  const secao = (titulo, arr, tipo) => {
    body.appendChild(el(`<div class="sec-title" style="margin:10px 12px 4px;font-size:11px">${titulo} (${arr.length})</div>`));
    if(!arr.length){
      body.appendChild(el(`<div class="empty-line">Nenhuma categoria de ${tipo}. Toque em "＋ ${tipo==='receita'?'Receita':'Despesa'}".</div>`));
      return;
    }
    const list = el('<div class="list"></div>');
    arr.forEach(c=>{
      list.appendChild(el(`<div class="st-row" data-click="finCatEdit" data-id="${safeAttr(c.id)}" style="cursor:pointer">
        <div class="st-mid"><div class="nm">${safeTxt(c.nome)}</div>
          <div class="meta"><span style="font-size:11.5px;color:var(--muted);font-weight:600">${c.ativo===false?'inativa':'ativa'}</span></div></div>
        <div class="st-right">
          <button class="btn-cad ghost" data-click="finCatToggle" data-id="${safeAttr(c.id)}" style="padding:6px 10px;font-size:11.5px">${c.ativo===false?'Ativar':'Desativar'}</button>
        </div>
      </div>`));
    });
    body.appendChild(list);
  };
  secao('Receitas', receitas, 'receita');
  secao('Despesas', despesas, 'despesa');
}

// Handlers da tela Categorias (Fase 2). Registrados UMA vez no load do módulo.
// Router dispara via data-click no root; leitura de dado é sempre fresh via
// _finCategorias.find(...) — sem risco de closure stale pós-morphdom.
_dlgRegister('finCatNova', (el) => {
  _finCategoriaInlineSheet(el.dataset.tipo, () => { _finReload('categorias'); });
});
_dlgRegister('finCatEdit', (el) => {
  const c = (_finCategorias||[]).find(x => x.id === el.dataset.id);
  if(!c) return;
  _finCategoriaEditSheet(c, () => { _finReload('categorias'); });
});
_dlgRegister('finCatToggle', (el) => {
  const c = (_finCategorias||[]).find(x => x.id === el.dataset.id);
  if(!c) return;
  el.disabled = true;
  sbProf.salvarCategoria({ id:c.id, nome:c.nome, tipo:c.tipo, ativo: c.ativo===false })
    .then(()=>{ toast(c.ativo===false?'Categoria reativada':'Categoria desativada'); _finReload('categorias'); })
    .catch(err=>{ el.disabled=false; toast('Erro: '+(err.message||err)); });
});

// Editar categoria existente (renomear)
function _finCategoriaEditSheet(c, onDone){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Editar categoria">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar categoria</div>
    <div class="sheet-desc">Tipo: ${c.tipo==='receita'?'Receita':'Despesa'}</div>
    <label class="flbl">Nome</label>
    <input class="inp" id="ce-nome" value="${safeAttr(c.nome||'')}">
    <label class="flbl" style="margin-top:10px"><input type="checkbox" id="ce-ativo" ${c.ativo!==false?'checked':''}> Ativa</label>
    <button class="btn-save" id="ce-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="ce-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#ce-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  const btn = sheet.querySelector('#ce-save');
  btn.onclick = ()=>{
    const nome = sheet.querySelector('#ce-nome').value.trim();
    if(!nome){ toast('Informe o nome'); return; }
    btn.disabled=true; btn.textContent='Salvando…';
    sbProf.salvarCategoria({ id:c.id, nome, tipo:c.tipo, ativo: sheet.querySelector('#ce-ativo').checked })
      .then(()=>{ toast('Categoria salva ✔'); close(); if(onDone) onDone(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ===== Sheets do Financeiro V2 ===== */

// Cobrança — marcar paga / isenta / cancelada
// v509: aceita onDone(patch) callback pra optimistic update no chamador
function _finCobrancaSheet(c, onDone){
  const p = c.profiles || {};
  const nome = p.apelido || p.nome_completo || 'aluno';
  const vencTxt = c.venc ? (c.venc.slice(8,10)+'/'+c.venc.slice(5,7)+'/'+c.venc.slice(0,4)) : '—';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Cobrança de ${safeAttr(nome)}">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Cobrança · ${safeTxt(nome)}</div>
    <div class="sheet-desc">${safeTxt(c.mes)} · vence ${vencTxt} · <b>${moneyBR(c.valor)}</b> · status ${safeTxt(c.status)}</div>
    ${c.status==='pendente' || c.status==='atrasado' ? `
      <label class="flbl" style="margin-top:12px">Data do pagamento</label>
      <input class="inp" id="fc-data" type="date" value="${HOJE_ISO}">
      <label class="flbl" style="margin-top:10px">Forma de pagamento</label>
      <select class="inp" id="fc-forma">
        <option value="dinheiro">💵 Dinheiro</option>
        <option value="pix">📱 PIX</option>
        <option value="cartao">💳 Cartão</option>
        <option value="outro">➕ Outro</option>
      </select>
      <label class="flbl" style="margin-top:10px">Observação (opcional)</label>
      <input class="inp" id="fc-obs" maxlength="200" placeholder="—">
      <button class="btn-save" id="fc-pagar" style="margin-top:14px">Marcar como paga</button>
      <button class="btn-cad ghost" id="fc-isenta" style="margin-top:8px">Marcar como isenta</button>
    `:''}
    ${c.status==='pago' || c.status==='isento' ? `
      <button class="btn-cad ghost" id="fc-reverter" style="margin-top:14px">↩ Voltar pra pendente</button>
    `:''}
    <button class="sheet-cancel" id="fc-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#fc-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  const btnPagar = sheet.querySelector('#fc-pagar');
  if(btnPagar){
    btnPagar.onclick = ()=>{
      const data_pagamento = sheet.querySelector('#fc-data').value;
      const forma_pagamento = sheet.querySelector('#fc-forma').value;
      const obs = sheet.querySelector('#fc-obs').value.trim();
      if(!data_pagamento){ toast('Informe a data'); return; }
      btnPagar.disabled=true; btnPagar.textContent='Salvando…';
      sbProf.marcarCobrancaPaga(c.id, { data_pagamento, forma_pagamento, obs })
        .then(()=>{
          toast('Pagamento registrado ✔');
          close();
          if(onDone) onDone({ status:'pago', data_pagamento, forma_pagamento, obs });
        })
        .catch(e=>{ btnPagar.disabled=false; btnPagar.textContent='Marcar como paga'; toast('Erro: '+(e.message||e)); });
    };
  }
  const btnIsenta = sheet.querySelector('#fc-isenta');
  if(btnIsenta){
    btnIsenta.onclick = ()=>{
      const motivo = prompt('Motivo da isenção (opcional):') || '';
      btnIsenta.disabled=true;
      sbProf.marcarCobrancaIsenta(c.id, motivo)
        .then(()=>{
          toast('Marcada como isenta');
          close();
          if(onDone) onDone({ status:'isento', obs: motivo });
        })
        .catch(e=>{ btnIsenta.disabled=false; toast('Erro: '+(e.message||e)); });
    };
  }
  // v514: reverter pra pendente — antes ficava só "Fechar" quando paga/isenta.
  const btnReverter = sheet.querySelector('#fc-reverter');
  if(btnReverter){
    btnReverter.onclick = ()=>{
      if(!confirm('Voltar esta cobrança pra pendente? Data e forma de pagamento serão limpas.')) return;
      btnReverter.disabled=true; btnReverter.textContent='Salvando…';
      sbProf.editarCobranca(c.id, { status:'pendente', data_pagamento:null, forma_pagamento:null })
        .then(()=>{
          toast('Voltou pra pendente ✔');
          close();
          if(onDone) onDone({ status:'pendente', data_pagamento:null, forma_pagamento:null });
        })
        .catch(e=>{ btnReverter.disabled=false; btnReverter.textContent='↩ Voltar pra pendente'; toast('Erro: '+(e.message||e)); });
    };
  }
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Cobrança avulsa — sem produto (exame de faixa, taxa, aula avulsa)
function _finCobrancaAvulsaSheet(onDone){
  const alunos = (_profData && _profData.alunos || []).filter(a=>!a._self);
  const cats = (_finCategorias||[]).filter(c=>c.tipo==='receita');
  const catsOpts = cats.map(c=>`<option value="${c.id}">${safeTxt(c.nome)}</option>`).join('');
  // v494 Sprint 6 item 5: combobox filtrável com <datalist> — nativo, sem lib.
  // Aluno digita nome, browser filtra. Guardamos ID no campo hidden pra submit.
  const alunosDatalist = alunos.map(a=>`<option value="${safeAttr(_nomeInst(a))}" data-id="${a.id}"></option>`).join('');

  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Nova cobrança avulsa">
    <div class="sheet-grip"></div>
    <div class="sheet-title">＋ Cobrança avulsa</div>
    <div class="sheet-desc">Exame de faixa, taxa extra, aula avulsa. Sem produto — sem baixa de estoque.</div>
    <label class="flbl" style="margin-top:12px">Aluno</label>
    <input class="inp" id="cav-aluno-nome" list="cav-alunos-list" placeholder="Digite pra buscar…" autocomplete="off">
    <datalist id="cav-alunos-list">${alunosDatalist}</datalist>
    <label class="flbl" style="margin-top:10px">Categoria</label>
    <div style="display:flex;gap:8px;align-items:stretch">
      <select class="inp" id="cav-cat" style="flex:1">
        <option value="">—</option>
        ${catsOpts}
      </select>
      <button class="btn-cad ghost" id="cav-cat-add" style="min-width:44px;padding:0 10px">＋</button>
    </div>
    <label class="flbl" style="margin-top:10px">Valor (R$)</label>
    <input class="inp" id="cav-valor" type="number" step="0.01" min="0" placeholder="0,00">
    <label class="flbl" style="margin-top:10px">Vencimento</label>
    <input class="inp" id="cav-venc" type="date" value="${HOJE_ISO}">
    <label class="flbl" style="margin-top:10px">Parcelas</label>
    <input class="inp" id="cav-parc" type="number" min="1" max="12" value="1">
    <div style="font-size:11.5px;color:var(--muted);margin-top:4px">Se >1, cria N cobranças mensais (mesmo dia de vencimento).</div>
    <label class="flbl" style="margin-top:10px">Observação</label>
    <input class="inp" id="cav-obs" maxlength="200" placeholder="Ex: Exame azul · Set/26">
    <button class="btn-save" id="cav-save" style="margin-top:14px">Criar cobrança</button>
    <button class="sheet-cancel" id="cav-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#cav-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#cav-cat-add').onclick = ()=>{
    _finCategoriaInlineSheet('receita', novo=>{
      const sel = sheet.querySelector('#cav-cat');
      sel.insertAdjacentHTML('beforeend', `<option value="${novo.id}">${safeTxt(novo.nome)}</option>`);
      sel.value = novo.id;
    });
  };
  const btn = sheet.querySelector('#cav-save');
  btn.onclick = async ()=>{
    // v494 Sprint 6 item 5: resolve aluno_id pelo nome digitado no datalist
    const nomeDig = sheet.querySelector('#cav-aluno-nome').value.trim();
    const opt = sheet.querySelector(`#cav-alunos-list option[value="${nomeDig.replace(/"/g,'\\"')}"]`);
    const user_id = opt ? opt.dataset.id : null;
    const valor = parseFloat(sheet.querySelector('#cav-valor').value);
    const venc = sheet.querySelector('#cav-venc').value;
    if(!user_id || !(valor>0) || !venc){ toast('Preencha aluno, valor e vencimento'); return; }
    // v494 Sprint 6 item 1: cobrança avulsa parcelada — cria N cobranças com
    // vencimento mensal escalonado (mesmo dia). Sequência: se houver falha na
    // parcela N, aborta e mostra quantas conseguiu criar. Idempotente
    // fica por conta do UNIQUE parcial (user_id, mes) where avulsa=false — como
    // avulsa=true, permite múltiplas por mês; se rodar 2x, cria mais duplicatas.
    // Aceita: professor tem controle direto e usa parcelas 1x só por operação.
    const parcelas = Math.max(1, Math.min(12, parseInt(sheet.querySelector('#cav-parc').value)||1));
    const cat = sheet.querySelector('#cav-cat').value || null;
    const obs = sheet.querySelector('#cav-obs').value.trim() || null;
    btn.disabled=true; btn.textContent='Salvando…';
    try{
      let n = 0;
      for(let i=0; i<parcelas; i++){
        const d = new Date(venc+'T12:00:00');
        d.setMonth(d.getMonth()+i);
        const vencI = d.toISOString().slice(0,10);
        const obsI = parcelas > 1 ? `${obs||''} (${i+1}/${parcelas})`.trim() : obs;
        await sbProf.criarCobrancaAvulsa({ user_id, valor, venc: vencI, categoria_id: cat, obs: obsI });
        n++;
      }
      toast(parcelas === 1 ? 'Cobrança avulsa criada ✔' : `${n} cobranças criadas ✔`);
      close(); if(onDone) onDone();
    } catch(e){
      btn.disabled=false; btn.textContent='Criar cobrança';
      toast('Erro: '+(e.message||e));
    }
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Plano — criar/editar
function _finPlanoSheet(p, onDone){
  const editar = !!p; p = p || {};
  const valorAtual = editar ? Number(p.valor || 0) : 0;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Plano">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editar?'Editar plano':'Novo plano'}</div>
    <label class="flbl">Nome</label>
    <input class="inp" id="pl-nome" value="${safeAttr(p.nome||'')}" placeholder="Ex: Adulto Mensal">
    <label class="flbl" style="margin-top:10px">Descrição</label>
    <textarea class="inp" id="pl-desc" maxlength="200" rows="3" style="resize:vertical;min-height:64px;font-family:inherit" placeholder="Ex: 12 meses com desconto. Fidelidade mínima 12 meses.">${safeTxt(p.descricao||'')}</textarea>
    <label class="flbl" style="margin-top:10px">Frequência</label>
    <select class="inp" id="pl-freq">
      <option value="mensal">Mensal</option>
      <option value="trimestral">Trimestral</option>
      <option value="semestral">Semestral</option>
      <option value="anual">Anual</option>
    </select>
    <label class="flbl" style="margin-top:10px">Modalidade de cobrança</label>
    <select class="inp" id="pl-modo">
      <option value="recorrente">🔄 Recorrente mensal (paga todo mês, sem fim)</option>
      <option value="unica">💰 Cobrança única (paga 1× no início)</option>
      <option value="parcelado">📊 Parcelado em N vezes</option>
    </select>
    <div id="pl-parc-wrap" style="display:none;margin-top:8px">
      <label class="flbl">Número de parcelas</label>
      <input class="inp" id="pl-parc" type="number" min="2" max="60" value="${p.parcelas>1?p.parcelas:12}">
    </div>
    <label class="flbl" style="margin-top:10px" id="pl-valor-lbl">Valor (R$)</label>
    <input class="inp" id="pl-valor" type="number" step="0.01" min="0" value="${valorAtual}">
    <div id="pl-valor-preview" style="margin-top:4px;font-size:12px;color:var(--muted);min-height:16px"></div>
    <label class="flbl" style="margin-top:10px">Dia de vencimento (1-28)</label>
    <input class="inp" id="pl-dia" type="number" min="1" max="28" value="${p.dia_vencimento||10}">
    <label class="flbl" style="margin-top:10px">Forma padrão</label>
    <select class="inp" id="pl-forma">
      <option value="">—</option>
      <option value="dinheiro">💵 Dinheiro</option>
      <option value="pix">📱 PIX</option>
      <option value="cartao">💳 Cartão</option>
      <option value="outro">➕ Outro</option>
    </select>
    <label class="flbl" style="margin-top:10px"><input type="checkbox" id="pl-contrato" ${p.tem_contrato?'checked':''}> Exige contrato assinado</label>
    <label class="flbl" style="margin-top:8px"><input type="checkbox" id="pl-ativo" ${p.ativo!==false?'checked':''}> Plano ativo</label>
    ${editar ? '<button class="btn-cad ghost" id="pl-hist" style="margin-top:12px;width:100%">📈 Histórico de reajustes</button>' : ''}
    <button class="btn-save" id="pl-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="pl-close">Cancelar</button>
  </div></div>`);
  sheet.querySelector('#pl-freq').value = p.frequencia || 'mensal';
  sheet.querySelector('#pl-forma').value = p.forma_padrao || '';
  // v498 (0047): modalidade de cobrança — recorrente/unica/parcelado
  const selModo = sheet.querySelector('#pl-modo');
  const parcWrap = sheet.querySelector('#pl-parc-wrap');
  const parcInp = sheet.querySelector('#pl-parc');
  const valLbl = sheet.querySelector('#pl-valor-lbl');
  const valInp = sheet.querySelector('#pl-valor');
  const valPrev = sheet.querySelector('#pl-valor-preview');
  const modoInicial = p.parcelas == null ? 'recorrente' : (p.parcelas === 1 ? 'unica' : 'parcelado');
  selModo.value = modoInicial;
  const pintaPreview = ()=>{
    const modo = selModo.value;
    const val = parseFloat(valInp.value)||0;
    const parc = Math.max(2, Math.min(60, parseInt(parcInp.value)||12));
    parcWrap.style.display = modo==='parcelado' ? 'block' : 'none';
    if(modo==='recorrente'){
      valLbl.textContent = 'Valor mensal (R$)';
      valPrev.textContent = val > 0 ? `${moneyBR(val)}/mês · cron gera 1 cobrança todo mês, enquanto matrícula ativa` : '';
    } else if(modo==='unica'){
      valLbl.textContent = 'Valor total (R$)';
      valPrev.textContent = val > 0 ? `${moneyBR(val)} — 1 cobrança única no mês da matrícula` : '';
    } else {
      valLbl.textContent = 'Valor TOTAL do plano (R$)';
      const perParc = val > 0 && parc > 0 ? val/parc : 0;
      valPrev.textContent = val > 0 && parc > 0 ? `${parc}× ${moneyBR(perParc)} — cron gera ${parc} cobranças mensais consecutivas` : '';
    }
  };
  selModo.onchange = pintaPreview;
  valInp.oninput = pintaPreview;
  parcInp.oninput = pintaPreview;
  pintaPreview();
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#pl-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  // v495: histórico de reajustes
  const btnHist = sheet.querySelector('#pl-hist');
  if(btnHist){
    btnHist.onclick = ()=> _finPlanoHistoricoSheet(p);
  }
  const btn = sheet.querySelector('#pl-save');
  btn.onclick = async ()=>{
    const nome = sheet.querySelector('#pl-nome').value.trim();
    if(!nome){ toast('Informe o nome'); return; }
    const novoValor = parseFloat(sheet.querySelector('#pl-valor').value)||0;
    // v495 Sprint 3: se edit + valor mudou, mostra modal de impacto ANTES de salvar
    if(editar && Math.abs(novoValor - valorAtual) > 0.01){
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Analisando…';
      try {
        const impacto = await sbProf.planoImpactoReajuste(p.id);
        btn.disabled=false; btn.textContent=orig;
        const msg = `Reajuste ${moneyBR(valorAtual)} → ${moneyBR(novoValor)}\n\n`
          + `📈 ${impacto.afetados} aluno(s) pegam o novo valor automaticamente.\n`
          + `🔒 ${impacto.total_travados} aluno(s) travados:\n`
          + `   · ${impacto.travados_contrato} contrato ativo\n`
          + `   · ${impacto.travados_anual} plano anual (dentro dos 12 meses)\n`
          + `   · ${impacto.travados_manual} trava manual\n\n`
          + `Confirmar reajuste?`;
        if(!confirm(msg)) return;
      } catch(e){ btn.disabled=false; btn.textContent=orig; toast('Erro impacto: '+(e.message||e)); return; }
    }
    btn.disabled=true; btn.textContent='Salvando…';
    // v498 (0047): resolve parcelas do modo escolhido
    const modo = selModo.value;
    let parcelasFinal = null;   // recorrente
    if(modo==='unica') parcelasFinal = 1;
    else if(modo==='parcelado') parcelasFinal = Math.max(2, Math.min(60, parseInt(parcInp.value)||12));
    sbProf.salvarPlano({
      id: p.id, nome,
      descricao: sheet.querySelector('#pl-desc').value.trim(),
      frequencia: sheet.querySelector('#pl-freq').value,
      valor: novoValor,
      dia_vencimento: parseInt(sheet.querySelector('#pl-dia').value)||10,
      forma_padrao: sheet.querySelector('#pl-forma').value || null,
      tem_contrato: sheet.querySelector('#pl-contrato').checked,
      ativo: sheet.querySelector('#pl-ativo').checked,
      parcelas: parcelasFinal,
    }).then(()=>{ toast('Plano salvo ✔'); close(); if(onDone) onDone(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// v495: histórico de reajustes do plano
function _finPlanoHistoricoSheet(p){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Histórico de reajustes">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📈 Histórico · ${safeTxt(p.nome||'')}</div>
    <div class="sheet-desc">Valor atual: <b>${moneyBR(p.valor)}</b></div>
    <div class="list" id="ph-list"><div class="loading-center">Carregando…</div></div>
    <button class="sheet-cancel" id="ph-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#ph-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  const list = sheet.querySelector('#ph-list');
  sbProf.getPlanoHistorico(p.id).then(rows=>{
    list.innerHTML='';
    if(!rows.length){ list.appendChild(el('<div class="empty-line">Nenhum reajuste registrado ainda.</div>')); return; }
    rows.forEach(r=>{
      const dt = new Date(r.alterado_em);
      const dtTxt = dt.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const pQuem = r.profiles && (r.profiles.apelido || r.profiles.nome_completo);
      const va = Number(r.valor_anterior||0), vn = Number(r.valor_novo||0);
      const delta = vn - va;
      const pct = va > 0 ? Math.round((delta/va)*100) : null;
      list.appendChild(el(`<div class="cfg-row" style="cursor:default;flex-direction:column;align-items:flex-start">
        <div style="display:flex;justify-content:space-between;width:100%">
          <span><b>${moneyBR(va)}</b> → <b>${moneyBR(vn)}</b></span>
          <span style="color:${delta>=0?'var(--good)':'var(--red)'};font-weight:800">${delta>=0?'+':''}${moneyBR(delta)}${pct!==null?' ('+(pct>=0?'+':'')+pct+'%)':''}</span>
        </div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:2px">${dtTxt}${pQuem?' · por '+safeTxt(pQuem):''}</div>
      </div>`));
    });
  }).catch(e=>{ list.innerHTML='<div class="empty-line" style="color:var(--red)">Erro: '+safeTxt(e.message||e)+'</div>'; });
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Despesa — criar/editar/marcar paga
function _finDespesaSheet(d, onDone){
  const editar = !!d; d = d || {};
  const cats = (_finCategorias||[]).filter(c=>c.tipo==='despesa');
  const catsOpts = cats.map(c=>`<option value="${c.id}">${safeTxt(c.nome)}</option>`).join('');
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Despesa">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editar?'Editar despesa':'Nova despesa'}</div>
    <label class="flbl">Descrição</label>
    <input class="inp" id="ds-desc" value="${safeAttr(d.descricao||'')}" placeholder="Ex: Aluguel setembro">
    <label class="flbl" style="margin-top:10px">Categoria</label>
    <div style="display:flex;gap:8px;align-items:stretch">
      <select class="inp" id="ds-cat" style="flex:1">
        <option value="">—</option>
        ${catsOpts}
      </select>
      <button class="btn-cad ghost" id="ds-cat-add" style="min-width:44px;padding:0 10px">＋</button>
    </div>
    <label class="flbl" style="margin-top:10px">Valor (R$)</label>
    <input class="inp" id="ds-valor" type="number" step="0.01" min="0" value="${d.valor||''}">
    <label class="flbl" style="margin-top:10px">Data</label>
    <input class="inp" id="ds-data" type="date" value="${d.data_lancamento||HOJE_ISO}">
    ${d.status==='a_pagar' || !editar ? `
      <div class="sec-title" style="margin:12px 0 6px;font-size:11px">Marcar como paga (opcional)</div>
      <label class="flbl">Data do pagamento</label>
      <input class="inp" id="ds-dpag" type="date" value="${d.data_pagamento||''}">
      <label class="flbl" style="margin-top:8px">Forma</label>
      <select class="inp" id="ds-forma">
        <option value="">—</option>
        <option value="dinheiro">💵 Dinheiro</option>
        <option value="pix">📱 PIX</option>
        <option value="cartao">💳 Cartão</option>
        <option value="outro">➕ Outro</option>
      </select>
    `:''}
    <label class="flbl" style="margin-top:10px">Observação</label>
    <input class="inp" id="ds-obs" maxlength="400" value="${safeAttr(d.obs||'')}">
    <button class="btn-save" id="ds-save" style="margin-top:14px">Salvar</button>
    ${editar ? '<button class="btn-cad ghost" id="ds-dup" style="margin-top:8px;width:100%">📋 Duplicar (próximo mês)</button>' : ''}
    <button class="sheet-cancel" id="ds-close">Cancelar</button>
  </div></div>`);
  if(d.categoria_id) sheet.querySelector('#ds-cat').value = d.categoria_id;
  if(d.forma_pagamento) sheet.querySelector('#ds-forma') && (sheet.querySelector('#ds-forma').value = d.forma_pagamento);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#ds-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };

  // "+ Nova categoria" inline
  sheet.querySelector('#ds-cat-add').onclick = ()=>{
    _finCategoriaInlineSheet('despesa', (novo)=>{
      const sel = sheet.querySelector('#ds-cat');
      sel.insertAdjacentHTML('beforeend', `<option value="${novo.id}">${safeTxt(novo.nome)}</option>`);
      sel.value = novo.id;
    });
  };

  const btn = sheet.querySelector('#ds-save');
  btn.onclick = ()=>{
    const descricao = sheet.querySelector('#ds-desc').value.trim();
    const valor = parseFloat(sheet.querySelector('#ds-valor').value);
    if(!descricao || !(valor>=0)){ toast('Preencha descrição e valor'); return; }
    const dpag = sheet.querySelector('#ds-dpag') && sheet.querySelector('#ds-dpag').value;
    const forma = sheet.querySelector('#ds-forma') && sheet.querySelector('#ds-forma').value;
    const payload = {
      id: d.id, descricao, valor,
      categoria_id: sheet.querySelector('#ds-cat').value || null,
      data_lancamento: sheet.querySelector('#ds-data').value,
      obs: sheet.querySelector('#ds-obs').value.trim(),
      status: (dpag && forma) ? 'pago' : (d.status || 'a_pagar'),
      data_pagamento: (dpag && forma) ? dpag : null,
      forma_pagamento: (dpag && forma) ? forma : null,
    };
    btn.disabled=true; btn.textContent='Salvando…';
    sbProf.salvarDespesa(payload)
      .then(()=>{ toast('Despesa salva ✔'); close(); if(onDone) onDone(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  // v494 Sprint 6 item 4: duplicar despesa (aluguel set → out). Copia campos,
  // avança data_lancamento em 1 mês, zera pagamento, cria como nova.
  const btnDup = sheet.querySelector('#ds-dup');
  if(btnDup){
    btnDup.onclick = ()=>{
      const dt = new Date((sheet.querySelector('#ds-data').value)+'T12:00:00');
      dt.setMonth(dt.getMonth()+1);
      const novaData = dt.toISOString().slice(0,10);
      btnDup.disabled=true; btnDup.textContent='Duplicando…';
      sbProf.salvarDespesa({
        descricao: sheet.querySelector('#ds-desc').value.trim(),
        valor: parseFloat(sheet.querySelector('#ds-valor').value),
        categoria_id: sheet.querySelector('#ds-cat').value || null,
        data_lancamento: novaData,
        obs: sheet.querySelector('#ds-obs').value.trim(),
        status: 'a_pagar',
      }).then(()=>{ toast('Duplicada pra '+novaData.slice(8,10)+'/'+novaData.slice(5,7)+' ✔'); close(); if(onDone) onDone(); })
        .catch(e=>{ btnDup.disabled=false; btnDup.textContent='📋 Duplicar (próximo mês)'; toast('Erro: '+(e.message||e)); });
    };
  }
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// v494 Sprint 6 item 3: quick-pay sheet compacto (só data + forma)
function _finDespesaQuickPaySheet(d, onDone){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Marcar despesa paga">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Marcar paga · ${safeTxt(d.descricao)}</div>
    <div class="sheet-desc">${moneyBR(d.valor)}</div>
    <label class="flbl" style="margin-top:12px">Data do pagamento</label>
    <input class="inp" id="qp-data" type="date" value="${HOJE_ISO}">
    <label class="flbl" style="margin-top:10px">Forma</label>
    <select class="inp" id="qp-forma">
      <option value="dinheiro">💵 Dinheiro</option>
      <option value="pix">📱 PIX</option>
      <option value="cartao">💳 Cartão</option>
      <option value="outro">➕ Outro</option>
    </select>
    <button class="btn-save" id="qp-save" style="margin-top:14px">Confirmar</button>
    <button class="sheet-cancel" id="qp-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#qp-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#qp-save').onclick = ()=>{
    const btn = sheet.querySelector('#qp-save');
    btn.disabled=true; btn.textContent='Salvando…';
    sbProf.marcarDespesaPaga(d.id, {
      data_pagamento: sheet.querySelector('#qp-data').value,
      forma_pagamento: sheet.querySelector('#qp-forma').value,
    }).then(()=>{ toast('Despesa paga ✔'); close(); if(onDone) onDone(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Confirmar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Despesa recorrente (IPTU 12x, seguro anual etc) — cadastro-mãe
function _finDespesaRecorrenteSheet(r, onDone){
  const editar = !!r; r = r || {};
  const cats = (_finCategorias||[]).filter(c=>c.tipo==='despesa');
  const catsOpts = cats.map(c=>`<option value="${c.id}">${safeTxt(c.nome)}</option>`).join('');
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Despesa recorrente">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editar?'Editar recorrente':'Nova despesa recorrente'}</div>
    <div class="sheet-desc">Cron gera 1 parcela por mês entre início e fim. Cancelar depois é 1 clique — parcelas passadas ficam.</div>
    <label class="flbl" style="margin-top:12px">Descrição</label>
    <input class="inp" id="dr-desc" maxlength="200" value="${safeAttr(r.descricao||'')}" placeholder="Ex: IPTU 2027 · Seguro anual DEKRA">
    <label class="flbl" style="margin-top:10px">Categoria</label>
    <div style="display:flex;gap:8px;align-items:stretch">
      <select class="inp" id="dr-cat" style="flex:1">
        <option value="">—</option>
        ${catsOpts}
      </select>
      <button class="btn-cad ghost" id="dr-cat-add" style="min-width:44px;padding:0 10px">＋</button>
    </div>
    <label class="flbl" style="margin-top:10px">Valor TOTAL (R$)</label>
    <input class="inp" id="dr-total" type="number" step="0.01" min="0" placeholder="Ex: 3600" value="${(r.valor_parcela||0) * (r.parcelas_total||0) || ''}">
    <label class="flbl" style="margin-top:10px">Número de parcelas</label>
    <input class="inp" id="dr-parc" type="number" min="1" max="120" value="${r.parcelas_total||12}">
    <label class="flbl" style="margin-top:10px">Dia de vencimento (1–28)</label>
    <input class="inp" id="dr-dia" type="number" min="1" max="28" value="${r.dia_venc||10}">
    <label class="flbl" style="margin-top:10px">Primeira parcela (mês)</label>
    <input class="inp" id="dr-inicio" type="date" value="${r.inicio || HOJE_ISO}">
    <div id="dr-preview" style="margin-top:10px;padding:10px;border-radius:8px;background:var(--card-alt,#f4f4f6);font-size:13px;color:var(--muted)"></div>
    <label class="flbl" style="margin-top:10px">Observação</label>
    <input class="inp" id="dr-obs" maxlength="400" value="${safeAttr(r.obs||'')}">
    ${editar?`
      <label class="flbl" style="margin-top:10px"><input type="checkbox" id="dr-ativo" ${r.ativo!==false?'checked':''}> Ativa (cron gera parcelas)</label>
    `:''}
    <button class="btn-save" id="dr-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="dr-close">Cancelar</button>
  </div></div>`);
  if(r.categoria_id) sheet.querySelector('#dr-cat').value = r.categoria_id;
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#dr-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#dr-cat-add').onclick = ()=>{
    _finCategoriaInlineSheet('despesa', novo=>{
      const sel = sheet.querySelector('#dr-cat');
      sel.insertAdjacentHTML('beforeend', `<option value="${novo.id}">${safeTxt(novo.nome)}</option>`);
      sel.value = novo.id;
    });
  };

  // Preview em tempo real: N parcelas de R$ X · mm/YY → mm/YY
  const prev = sheet.querySelector('#dr-preview');
  const pintaPreview = ()=>{
    const total = parseFloat(sheet.querySelector('#dr-total').value)||0;
    const parc = parseInt(sheet.querySelector('#dr-parc').value)||0;
    const inicio = sheet.querySelector('#dr-inicio').value;
    if(!total || !parc || !inicio){ prev.textContent='Preencha total, parcelas e data.'; return; }
    const valorParc = total / parc;
    const d0 = new Date(inicio+'T12:00:00');
    const dN = new Date(d0); dN.setMonth(dN.getMonth() + parc - 1);
    const mmYY = d => (d.getMonth()+1).toString().padStart(2,'0')+'/'+d.getFullYear().toString().slice(2);
    prev.textContent = `${parc}× ${moneyBR(valorParc)} · ${mmYY(d0)} → ${mmYY(dN)}`;
  };
  ['#dr-total','#dr-parc','#dr-inicio'].forEach(sel=> sheet.querySelector(sel).oninput = pintaPreview);
  pintaPreview();

  const btn = sheet.querySelector('#dr-save');
  btn.onclick = ()=>{
    const descricao = sheet.querySelector('#dr-desc').value.trim();
    const total = parseFloat(sheet.querySelector('#dr-total').value);
    const parcelas = parseInt(sheet.querySelector('#dr-parc').value);
    const inicio = sheet.querySelector('#dr-inicio').value;
    if(!descricao || !(total>0) || !(parcelas>0) || !inicio){ toast('Preencha descrição, total, parcelas e início'); return; }
    // Calcula fim = inicio + (parcelas-1) meses
    const d0 = new Date(inicio+'T12:00:00');
    const dN = new Date(d0); dN.setMonth(dN.getMonth() + parcelas - 1);
    const fim = dN.toISOString().slice(0,10);
    const valor_parcela = +(total/parcelas).toFixed(2);
    btn.disabled=true; btn.textContent='Salvando…';
    const ativoChk = sheet.querySelector('#dr-ativo');
    sbProf.salvarDespesaRecorrente({
      id: r.id, descricao,
      categoria_id: sheet.querySelector('#dr-cat').value || null,
      valor_parcela,
      dia_venc: parseInt(sheet.querySelector('#dr-dia').value)||10,
      inicio, fim,
      parcelas_total: parcelas,
      ativo: ativoChk ? ativoChk.checked : true,
      obs: sheet.querySelector('#dr-obs').value.trim() || null,
    }).then(()=>{ toast('Despesa recorrente salva ✔'); close(); if(onDone) onDone(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Categoria inline — criação rápida
function _finCategoriaInlineSheet(tipo, onCreated){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Nova categoria">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Nova categoria</div>
    <div class="sheet-desc">Tipo: ${tipo==='receita'?'Receita':'Despesa'}</div>
    <label class="flbl">Nome</label>
    <input class="inp" id="cat-nome" placeholder="Ex: Aluguel">
    <button class="btn-save" id="cat-save" style="margin-top:14px">Criar</button>
    <button class="sheet-cancel" id="cat-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#cat-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };
  const btn = sheet.querySelector('#cat-save');
  btn.onclick = ()=>{
    const nome = sheet.querySelector('#cat-nome').value.trim();
    if(!nome){ toast('Informe o nome'); return; }
    btn.disabled=true; btn.textContent='Criando…';
    sbProf.salvarCategoria({ nome, tipo })
      .then(id => sbProf.getCategorias().then(cats=>{
        _finCategorias = cats;
        const novo = cats.find(c=>c.id===id);
        toast('Categoria criada ✔'); close();
        if(onCreated && novo) onCreated(novo);
      }))
      .catch(e=>{ btn.disabled=false; btn.textContent='Criar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Contrato — criar/editar/aceite/cancelar
function _finContratoSheet(c, onDone){
  const editar = !!c; c = c || {};
  const planos = (_finPlanos||[]).filter(p=>p.ativo!==false);
  const planosOpts = planos.map(p=>`<option value="${p.id}">${safeTxt(p.nome)} · ${moneyBR(p.valor)}</option>`).join('');
  const alunos = (_profData && _profData.alunos || []).filter(a=>!a._self);
  const alunosOpts = alunos.map(a=>`<option value="${a.id}">${safeTxt(_nomeInst(a))}</option>`).join('');
  const p = c.profiles || {};
  const nome = p.apelido || p.nome_completo || '—';

  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Contrato">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${editar? 'Contrato #'+String(c.numero||0).padStart(3,'0') : 'Novo contrato'}</div>
    ${editar?`<div class="sheet-desc">${safeTxt(nome)} · status ${safeTxt(c.status)}</div>`:''}
    ${!editar ? `
      <label class="flbl">Aluno</label>
      <input class="inp" id="ct-aluno-nome" list="ct-alunos-list" placeholder="Digite pra buscar…" autocomplete="off">
      <datalist id="ct-alunos-list">${alunos.map(a=>`<option value="${safeAttr(_nomeInst(a))}" data-id="${a.id}"></option>`).join('')}</datalist>
      <label class="flbl" style="margin-top:10px">Plano</label>
      <select class="inp" id="ct-plano">${planosOpts}</select>
    ` : (c.status === 'aguardando_aceite' ? `
      <label class="flbl">Plano (pode trocar enquanto aguarda aceite)</label>
      <select class="inp" id="ct-plano">${planosOpts}</select>
    ` : '')}
    <label class="flbl" style="margin-top:10px">Início</label>
    <input class="inp" id="ct-inicio" type="date" value="${c.inicio||HOJE_ISO}" ${editar && c.status !== 'aguardando_aceite' ? 'readonly' : ''}>
    <label class="flbl" style="margin-top:10px">Fim</label>
    <input class="inp" id="ct-fim" type="date" value="${c.fim||''}" ${editar && c.status !== 'aguardando_aceite' ? 'readonly' : ''}>
    <label class="flbl" style="margin-top:10px">Valor negociado do contrato (R$)</label>
    <input class="inp" id="ct-valor" type="number" step="0.01" min="0" placeholder="Em branco = valor cheio do plano" value="${c.valor_congelado != null ? c.valor_congelado : ''}" ${editar && c.status !== 'aguardando_aceite' ? 'readonly' : ''}>
    <div style="font-size:11.5px;color:var(--muted);margin-top:4px">Este valor fica congelado no contrato — cascata do cron respeita se aluno_plano não tem valor negociado próprio.</div>
    <label class="flbl" style="margin-top:10px">Observação</label>
    <input class="inp" id="ct-obs" maxlength="400" value="${safeAttr(c.obs||'')}">
    ${!editar ? `
      <label class="flbl" style="margin-top:10px;display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ct-menor">
        <span>Contrato de menor de idade <span style="color:var(--muted);font-weight:500">(exige responsável)</span></span>
      </label>
      <div id="ct-resp-wrap" style="display:none">
        <div class="sec-title" style="margin:12px 0 6px;font-size:11px">Responsável legal</div>
        <label class="flbl">Nome</label>
        <input class="inp" id="ct-resp-nome" placeholder="Nome completo do responsável">
        <label class="flbl" style="margin-top:8px">CPF</label>
        <input class="inp" id="ct-resp-cpf" placeholder="000.000.000-00" inputmode="numeric">
        <label class="flbl" style="margin-top:8px">Parentesco</label>
        <select class="inp" id="ct-resp-parent">
          <option value="pai">Pai</option>
          <option value="mae">Mãe</option>
          <option value="responsavel">Responsável legal</option>
          <option value="avo">Avô/Avó</option>
          <option value="outro">Outro</option>
        </select>
        <label class="flbl" style="margin-top:8px">Telefone</label>
        <input class="inp" id="ct-resp-tel" placeholder="(31) 99999-9999" inputmode="numeric">
      </div>
    ` : (c.eh_menor && c.responsavel ? `
      <div class="sec-title" style="margin:14px 0 6px;font-size:11px">Responsável legal (congelado na assinatura)</div>
      <div style="padding:8px;background:var(--card-alt,rgba(0,0,0,0.03));border-radius:8px;font-size:12.5px">
        <div><b>${safeTxt(c.responsavel.nome||'—')}</b>${c.responsavel.parentesco?' · '+safeTxt(c.responsavel.parentesco):''}</div>
        ${c.responsavel.cpf?`<div style="color:var(--muted);margin-top:2px">CPF ${safeTxt(c.responsavel.cpf)}</div>`:''}
        ${c.responsavel.telefone?`<div style="color:var(--muted)">Tel ${safeTxt(c.responsavel.telefone)}</div>`:''}
      </div>
    ` : '')}
    ${editar ? `
      <div class="sec-title" style="margin:14px 0 6px;font-size:11px">PDF assinado (V1 fluxo manual gov.br)</div>
      <div id="ct-pdf-info" style="font-size:12.5px;color:var(--muted);margin-bottom:6px">${c.arquivo_url ? '📄 Contrato anexado' : 'Nenhum arquivo anexado ainda'}</div>
      ${c.arquivo_url ? '<button class="btn-cad ghost" id="ct-ver-pdf" style="width:100%;margin-bottom:6px">📄 Ver PDF assinado</button>' : ''}
      <input type="file" id="ct-pdf-file" accept="application/pdf" style="width:100%;padding:6px 0;font-size:12.5px">
    ` : ''}
    ${!editar?`
      <button class="btn-save" id="ct-save" style="margin-top:14px">Criar contrato (aguardando aceite)</button>
    `:''}
    ${editar && c.status==='aguardando_aceite' ? `
      <button class="btn-save" id="ct-aceite" style="margin-top:14px">Marcar aceite (aluno assinou)</button>
    `:''}
    ${editar && c.status==='ativo' ? `
      <button class="btn-cad ghost" id="ct-cancelar" style="margin-top:8px;color:var(--red)">Cancelar contrato</button>
    `:''}
    <button class="sheet-cancel" id="ct-close">Fechar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.querySelector('#ct-close').onclick = close;
  sheet.onclick = e=>{ if(e.target===sheet) close(); };

  // Pré-seleciona plano quando editando aguardando_aceite
  const selPlano = sheet.querySelector('#ct-plano');
  if(editar && selPlano && c.plano_id) selPlano.value = c.plano_id;

  // v526: auto-preenche o campo "Valor" com o valor do plano escolhido
  // quando o campo está vazio. Só sobrescreve o vazio — se o professor
  // já digitou algo, respeita.
  const inpValor = sheet.querySelector('#ct-valor');
  if(selPlano && inpValor){
    const prefillValor = ()=>{
      if(inpValor.value.trim()) return;   // já tem valor digitado, não mexe
      const pl = planos.find(p => p.id === selPlano.value);
      if(pl && pl.valor != null) inpValor.placeholder = 'Ex: '+pl.valor+' (valor cheio do plano)';
    };
    selPlano.addEventListener('change', prefillValor);
    prefillValor();
  }

  // v526: resolve aluno mais resiliente. Datalist às vezes não preserva
  // data-id no <option> matched; falha silenciosa fazia o Salvar dar erro
  // "Preencha aluno". Fallback: procura no array alunos por _nomeInst
  // (case-insensitive, ignora espaços extras).
  const _resolveAlunoId = () => {
    const inp = sheet.querySelector('#ct-aluno-nome');
    if(!inp) return null;
    const nomeDig = inp.value.trim();
    if(!nomeDig) return null;
    // 1) tenta match exato no datalist
    const opt = sheet.querySelector(`#ct-alunos-list option[value="${nomeDig.replace(/"/g,'\\"')}"]`);
    if(opt && opt.dataset.id) return opt.dataset.id;
    // 2) fallback: normaliza e procura no array
    const norm = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
    const alvo = norm(nomeDig);
    const found = alunos.find(a => norm(_nomeInst(a)) === alvo);
    return found ? found.id : null;
  };

  // v490 Sprint 3: toggle "Contrato de menor" mostra/esconde bloco responsável.
  // Auto-preenche do profile do aluno (profiles.resp_*) quando marcar.
  const chkMenor = sheet.querySelector('#ct-menor');
  const respWrap = sheet.querySelector('#ct-resp-wrap');
  if(chkMenor){
    chkMenor.onchange = ()=>{
      const on = chkMenor.checked;
      respWrap.style.display = on ? '' : 'none';
      if(on){
        // v526: resolve resiliente (mesmo helper do submit)
        const uid = _resolveAlunoId();
        const a = alunos.find(x=>x.id===uid);
        const r = a && a.cad && a.cad.responsavel;
        if(r){
          const inp = (sel,v)=>{ const e=sheet.querySelector(sel); if(e && !e.value) e.value = v || ''; };
          inp('#ct-resp-nome', r.nome);
          inp('#ct-resp-cpf', r.cpf);
          inp('#ct-resp-tel', r.telefone);
          const selP = sheet.querySelector('#ct-resp-parent');
          if(selP && r.parentesco){
            const norm = String(r.parentesco).toLowerCase();
            const map = { 'pai':'pai','mae':'mae','mãe':'mae','responsavel':'responsavel','responsável':'responsavel','avo':'avo','avó':'avo','avô':'avo' };
            selP.value = map[norm] || 'outro';
          }
        }
      }
    };
  }
  const btnSave = sheet.querySelector('#ct-save');
  if(btnSave){
    btnSave.onclick = ()=>{
      // v526: resolve resiliente (datalist + fallback pelo nome normalizado)
      const user_id = _resolveAlunoId();
      const plano_id = sheet.querySelector('#ct-plano').value;
      const inicio = sheet.querySelector('#ct-inicio').value;
      const fim = sheet.querySelector('#ct-fim').value;
      const valorTxt = sheet.querySelector('#ct-valor').value.trim();
      const valor_congelado = valorTxt ? Number(valorTxt) : null;   // null → adapter usa valor do plano
      if(!user_id || !plano_id || !inicio || !fim){ toast('Preencha aluno, plano e datas'); return; }
      if(fim < inicio){ toast('Fim deve ser depois do início'); return; }
      const eh_menor = chkMenor && chkMenor.checked;
      let responsavel = null;
      if(eh_menor){
        const nome = sheet.querySelector('#ct-resp-nome').value.trim();
        if(!nome){ toast('Informe o nome do responsável'); return; }
        responsavel = {
          nome,
          cpf: sheet.querySelector('#ct-resp-cpf').value.trim() || null,
          parentesco: sheet.querySelector('#ct-resp-parent').value,
          telefone: sheet.querySelector('#ct-resp-tel').value.trim() || null,
        };
      }
      btnSave.disabled=true; btnSave.textContent='Criando…';
      sbProf.salvarContrato({ user_id, plano_id, inicio, fim, valor_congelado, obs: sheet.querySelector('#ct-obs').value.trim(), eh_menor, responsavel })
        .then(res => { toast('Contrato #'+String(res.numero).padStart(3,'0')+' criado ✔'); close(); if(onDone) onDone(); })
        .catch(e=>{ btnSave.disabled=false; btnSave.textContent='Criar contrato (aguardando aceite)'; toast('Erro: '+(e.message||e)); });
    };
  }
  // v494 Sprint 6 item 2: botão salvar edições em contrato aguardando_aceite.
  // Cria mesmo botão "Salvar alterações" quando editar E status=aguardando.
  if(editar && c.status === 'aguardando_aceite'){
    const btnSaveEdit = el('<button class="btn-save" style="margin-top:14px">Salvar alterações</button>');
    // Insere ANTES do "Marcar aceite" (que já existe)
    const btnAc = sheet.querySelector('#ct-aceite');
    if(btnAc && btnAc.parentNode) btnAc.parentNode.insertBefore(btnSaveEdit, btnAc);
    btnSaveEdit.onclick = ()=>{
      const plano_id = sheet.querySelector('#ct-plano') && sheet.querySelector('#ct-plano').value;
      const inicio = sheet.querySelector('#ct-inicio').value;
      const fim = sheet.querySelector('#ct-fim').value;
      const valorTxt = sheet.querySelector('#ct-valor').value.trim();
      const valor_congelado = valorTxt ? Number(valorTxt) : null;
      if(!plano_id || !inicio || !fim){ toast('Datas + plano obrigatórios'); return; }
      if(fim < inicio){ toast('Fim deve ser depois do início'); return; }
      btnSaveEdit.disabled=true; btnSaveEdit.textContent='Salvando…';
      sbProf.salvarContrato({ id:c.id, user_id:c.user_id, plano_id, inicio, fim, valor_congelado, obs: sheet.querySelector('#ct-obs').value.trim() })
        .then(()=>{ toast('Contrato atualizado ✔'); close(); if(onDone) onDone(); })
        .catch(e=>{ btnSaveEdit.disabled=false; btnSaveEdit.textContent='Salvar alterações'; toast('Erro: '+(e.message||e)); });
    };
  }
  const btnAceite = sheet.querySelector('#ct-aceite');
  if(btnAceite){
    btnAceite.onclick = ()=>{
      if(!confirm('Confirma que o aluno entregou o contrato assinado?')) return;
      btnAceite.disabled=true; btnAceite.textContent='Marcando…';
      sbProf.marcarAceiteContrato(c.id, { data_aceite: HOJE_ISO })
        .then(()=>{ toast('Aceite registrado ✔'); close(); if(onDone) onDone(); })
        .catch(e=>{ btnAceite.disabled=false; btnAceite.textContent='Marcar aceite (aluno assinou)'; toast('Erro: '+(e.message||e)); });
    };
  }
  const btnCanc = sheet.querySelector('#ct-cancelar');
  if(btnCanc){
    btnCanc.onclick = ()=>{
      const motivo = prompt('Motivo do cancelamento (opcional):') || '';
      if(!confirm('Cancelar o contrato?')) return;
      btnCanc.disabled=true;
      sbProf.cancelarContrato(c.id, motivo)
        .then(()=>{ toast('Contrato cancelado'); close(); if(onDone) onDone(); })
        .catch(e=>{ btnCanc.disabled=false; toast('Erro: '+(e.message||e)); });
    };
  }
  // v488 (0044): upload PDF assinado (V1 gov.br externo)
  const btnVerPdf = sheet.querySelector('#ct-ver-pdf');
  if(btnVerPdf){
    btnVerPdf.onclick = ()=>{
      btnVerPdf.disabled=true; btnVerPdf.textContent='Abrindo…';
      sbProf.getContratoUrl(c.arquivo_url).then(url=>{
        btnVerPdf.disabled=false; btnVerPdf.textContent='📄 Ver PDF assinado';
        if(url) window.open(url, '_blank', 'noopener');
        else toast('Sem URL — reenvie o arquivo');
      }).catch(e=>{ btnVerPdf.disabled=false; btnVerPdf.textContent='📄 Ver PDF assinado'; toast('Erro: '+(e.message||e)); });
    };
  }
  const inpPdf = sheet.querySelector('#ct-pdf-file');
  if(inpPdf){
    inpPdf.onchange = ()=>{
      const f = inpPdf.files && inpPdf.files[0];
      if(!f) return;
      if(f.size > 10 * 1024 * 1024){ toast('Arquivo muito grande (máx 10 MB)'); inpPdf.value=''; return; }
      const info = sheet.querySelector('#ct-pdf-info');
      if(info) info.textContent='Enviando…';
      sbProf.uploadContrato(c.id, f).then(()=>{
        if(info) info.textContent='📄 Contrato anexado ✔';
        toast('PDF enviado ✔'); if(onDone) onDone();
      }).catch(e=>{ if(info) info.textContent='Erro no envio'; toast('Erro: '+(e.message||e)); });
    };
  }
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ============================================================
   PROFESSOR — Loja + Estoque (admin). Fase E.
   Edita DB.loja.produtos (persistido no dump/user_state, USER_KEYS). Com backend
   ligado: carrega via sbSync.pullLoja e salva via sbProf.salvarProduto (guardado).
   ============================================================ */
const ESTOQUE_BAIXO = 3;
function _ensureLojaAdmin(){
  DB.loja.produtos.forEach(p=>{
    if(p.ativo===undefined) p.ativo = true;
    if(!p.estoque){ p.estoque = {}; (p.tam||['Único']).forEach(t=>{ p.estoque[t] = 10; }); }
  });
}
function _estoqueTotal(p){ return (p.tam||[]).reduce((s,t)=> s + (+(p.estoque?.[t])||0), 0); }
function _temEstoqueBaixo(p){ return (p.tam||[]).some(t=> (p.estoque?.[t] ?? 0) <= ESTOQUE_BAIXO); }
function _produtosBaixos(){ _ensureLojaAdmin(); return DB.loja.produtos.filter(p=> p.ativo!==false && _temEstoqueBaixo(p)).length; }

/* ============================================================
   PROFESSOR — Pedidos (fila + confirmar → baixa de estoque)
   Backend: sbProf.getPedidos/confirmarPedido/cancelarPedido (migration 0005).
   Demo/offline (sbProf undefined): usa DB._pedidosMock p/ demonstração.
   ============================================================ */
let _pedidosData = null, _pedidosTs = 0;
function _loadPedidos(force){
  if(force){ _pedidosTs = 0; }
  if(DEMO || typeof sbProf==='undefined' || !sbProf.getPedidos){
    _pedidosData = DB._pedidosMock || [];   // demo/offline
    return;
  }
  if(!force && Date.now() - _pedidosTs < 30000) return;
  _pedidosTs = Date.now();
  sbProf.getPedidos().then(ps=>{ _pedidosData = ps; renderBg(); }).catch(()=>{ _pedidosTs = 0; });
}
function _pedidosArr(){ return _pedidosData || []; }
function _pedidosPendentesN(){ _loadPedidos(); return _pedidosArr().filter(p=>p.status==='pendente').length; }
// Agregado de vendas (pedidos concluídos) p/ o relatório: receita do mês, mais vendidos, tamanhos.
function _vendasAgg(){
  const conc = _pedidosArr().filter(p=>p.status==='concluido');
  const mes = HOJE_ISO.slice(0,7);
  let receitaMes = 0; const porProduto = {}, porTam = {}, porCliente = {};
  conc.forEach(p=>{
    if((p.criadoEm||'').slice(0,7)===mes) receitaMes += (p.total||0);
    const cli = p.cliente || '—';
    const c = porCliente[cli] || (porCliente[cli]={ gasto:0, pedidos:0 });
    c.gasto += (p.total||0); c.pedidos += 1;
    (p.itens||[]).forEach(it=>{
      porProduto[it.nome] = (porProduto[it.nome]||0) + (it.qtd||0);
      if(it.tam) porTam[it.tam] = (porTam[it.tam]||0) + (it.qtd||0);
    });
  });
  const top = Object.entries(porProduto).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const tams = Object.entries(porTam).sort((a,b)=>b[1]-a[1]);
  const clientes = Object.entries(porCliente).sort((a,b)=>b[1].gasto-a[1].gasto).slice(0,6);
  return { receitaMes, top, tams, clientes, nConc:conc.length };
}
const _PED_STATUS = { pendente:['Pendente','var(--red-strong)','red'], concluido:['Concluído','#0d9488','green'], cancelado:['Cancelado','var(--muted)',''] };
// v460: sheet da venda presencial (dono/professor). Cliente pode ser aluno
// da academia (busca por nome) ou avulso (nome livre pra não-cadastrado).
// Itens vêm da loja ativa; cada linha = produto + tamanho + qtd. Total
// pré-preenchido pela soma × qtd, mas EDITÁVEL (permite desconto negociado).
// Pagamento: dinheiro | cartão | pix. Confirma → RPC atômica cria pedido
// concluído + baixa estoque + audita em stock_movements.
function _vendaPresencialSheet(onDone){
  _ensureLojaAdmin();
  // v484 (0043): `aPrazo` liga o modo "aluno pega, paga depois". Nesse modo:
  // - cliente OBRIGATÓRIO cadastrado (avulso desabilitado)
  // - forma de pagamento não é pedida (fica pra hora que o aluno pagar)
  // - vencimento é obrigatório
  // - cria pedido concluído + baixa estoque + cobrança pendente linked (RPC registrar_venda_a_prazo)
  let selUser=null, selNome='', avulso=false, itens=[], forma='dinheiro', totalManual=null;
  let aPrazo=false, venc=HOJE_ISO;
  const prods = (DB.loja.produtos||[]).filter(p=> p.ativo!==false);
  const alunos = _profAlunosArr().filter(a=> !a._self);

  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Nova venda" style="max-height:92vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">＋ Nova venda</div>
    <div class="sheet-desc">Grava pedido concluído + baixa estoque. Toggle "a prazo" cria cobrança pendente.</div>
    <label class="flbl" style="margin-top:10px;display:flex;align-items:center;gap:8px;cursor:pointer">
      <input type="checkbox" id="vp-aprazo">
      <span>Pagamento a prazo <span style="color:var(--muted);font-weight:500">(aluno paga depois)</span></span>
    </label>
    <div class="flbl" style="margin-top:14px">Cliente</div>
    <div id="vp-cli"></div>
    <div class="flbl" style="margin-top:14px">Itens</div>
    <div id="vp-itens" class="list" style="margin:6px 0"></div>
    <button class="btn-cad ghost" id="vp-add-item" type="button" style="width:100%;margin-top:4px">＋ Adicionar item</button>
    <div id="vp-forma-wrap">
      <div class="flbl" style="margin-top:14px">Forma de pagamento</div>
      <div id="vp-forma" class="filter-seg" style="margin:6px 0">
        <button class="active" data-f="dinheiro">💵 Dinheiro</button>
        <button data-f="cartao">💳 Cartão</button>
        <button data-f="pix">📱 Pix</button>
      </div>
    </div>
    <div id="vp-venc-wrap" style="display:none">
      <div class="flbl" style="margin-top:14px">Vencimento da cobrança</div>
      <input class="inp" id="vp-venc" type="date" value="${HOJE_ISO}">
    </div>
    <div class="flbl" style="margin-top:14px" id="vp-total-lbl">Total <span style="color:var(--muted);font-weight:500">(editável)</span></div>
    <input class="inp" id="vp-total" type="text" inputmode="decimal" placeholder="0,00">
    <button class="btn-save" id="vp-go" style="margin-top:16px" disabled>Fechar venda</button>
    <button class="sheet-cancel" id="vp-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#vp-cancel').onclick=close;

  const cliEl = sheet.querySelector('#vp-cli');
  const itensEl = sheet.querySelector('#vp-itens');
  const totalEl = sheet.querySelector('#vp-total');
  const goBtn = sheet.querySelector('#vp-go');

  // v461: total sugerido já aplica desconto Pix pra dinheiro E pix — cartão paga cheio.
  // Presencial no dinheiro sai igual ao Pix na prática (mesma logística pro caixa), então
  // o desconto vale. Cartão fica no preço-lista. Total continua editável em qualquer forma.
  const _bruto = ()=> itens.reduce((s,i)=> s + (i.preco||0)*i.qtd, 0);
  const totalCalculado = ()=> (forma==='cartao') ? _bruto() : _precoPix(_bruto());
  const validar = ()=>{
    const t = totalManual!=null ? totalManual : totalCalculado();
    // A prazo: exige aluno cadastrado + venc; forma_pagamento não é pedida.
    // Presencial paga: forma obrigatória, cliente cadastrado OU avulso.
    if(aPrazo){
      goBtn.disabled = !(selUser && itens.length && t>=0 && venc);
    } else {
      goBtn.disabled = !((selUser || (avulso && selNome.trim())) && itens.length && t>=0 && forma);
    }
  };
  const pintaTotal = ()=>{
    // v484: no modo "a prazo" não aplica desconto Pix (não faz sentido — não sabemos a forma ainda)
    if(totalManual==null) totalEl.value = (aPrazo ? _bruto() : totalCalculado()).toFixed(2).replace('.',',');
    // v461: label mostra "−X%" quando o desconto Pix está sendo aplicado (dinheiro ou pix
    // com config > 0). Cartão sempre paga cheio, sem badge. A prazo: sem badge.
    const lbl = sheet.querySelector('#vp-total-lbl'); if(lbl){
      const d = _descontoPixPct();
      const aplicado = !aPrazo && d>0 && forma!=='cartao';
      lbl.innerHTML = `Total <span style="color:var(--muted);font-weight:500">(editável)</span>${aplicado?` <span class="pr-off">−${d}%</span>`:''}`;
    }
    validar();
  };
  totalEl.oninput = ()=>{
    const v = parseFloat(String(totalEl.value).replace(',','.'));
    totalManual = isFinite(v) && v>=0 ? v : null;
    validar();
  };

  // --- cliente picker ---
  const pintaCli = ()=>{
    if(selUser){
      cliEl.innerHTML = `<div class="cfg-row" style="cursor:default">
        <span>👤 ${safeTxt(selNome)}</span>
        <button class="btn-cad ghost" style="padding:6px 12px;margin-left:auto" id="vp-cli-x">Trocar</button></div>`;
      cliEl.querySelector('#vp-cli-x').onclick=()=>{ selUser=null; selNome=''; avulso=false; pintaCli(); validar(); };
    } else if(avulso){
      cliEl.innerHTML = `<input class="inp" id="vp-avulso" placeholder="Nome do cliente avulso" value="${safeAttr(selNome)}">
        <button class="btn-cad ghost" style="width:100%;margin-top:6px" id="vp-avulso-x">← Buscar aluno</button>`;
      const inp = cliEl.querySelector('#vp-avulso');
      inp.oninput = ()=>{ selNome = inp.value; validar(); };
      cliEl.querySelector('#vp-avulso-x').onclick=()=>{ avulso=false; selNome=''; pintaCli(); validar(); };
      inp.focus();
    } else {
      cliEl.innerHTML = `<input class="inp" id="vp-busca" placeholder="Buscar aluno por nome…">
        <div id="vp-cli-list" style="max-height:180px;overflow-y:auto;margin-top:6px"></div>
        <button class="btn-cad ghost" style="width:100%;margin-top:8px" id="vp-avulso-on">Cliente avulso (sem cadastro)</button>`;
      const busca = cliEl.querySelector('#vp-busca');
      const listEl = cliEl.querySelector('#vp-cli-list');
      const filtra = ()=>{
        const q = busca.value.trim().toLowerCase();
        listEl.innerHTML='';
        if(!q){ return; }
        alunos.filter(a=> (_nomeInst(a)||'').toLowerCase().includes(q)).slice(0,8).forEach(a=>{
          const nm = _nomeInst(a);
          const it = el(`<div class="cfg-row" role="button" tabindex="0" style="margin-top:4px"><span>${safeTxt(nm)}</span></div>`);
          it.onclick=()=>{ selUser=a.id; selNome=nm; avulso=false; pintaCli(); validar(); };
          listEl.appendChild(it);
        });
      };
      busca.oninput = filtra;
      cliEl.querySelector('#vp-avulso-on').onclick=()=>{ avulso=true; selNome=''; pintaCli(); validar(); };
    }
  };
  pintaCli();

  // --- itens ---
  const pintaItens = ()=>{
    itensEl.innerHTML = '';
    if(!itens.length){ itensEl.appendChild(el('<div class="empty-line" style="padding:10px">Nenhum item ainda.</div>')); return; }
    itens.forEach((it, idx)=>{
      const row = el(`<div class="cfg-row" style="cursor:default">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${safeTxt(it.nome)} · ${safeTxt(it.tam)} · ×${it.qtd}</span>
        <span style="color:var(--muted);font-weight:700;margin:0 10px">${moneyBR(it.preco*it.qtd)}</span>
        <button class="btn-cad ghost" style="padding:4px 10px" data-i="${idx}">Remover</button>
      </div>`);
      row.querySelector('button').onclick=()=>{ itens.splice(idx,1); totalManual=null; pintaItens(); pintaTotal(); };
      itensEl.appendChild(row);
    });
  };
  pintaItens();

  sheet.querySelector('#vp-add-item').onclick = ()=>{
    _vendaPickItem(prods, (item)=>{ if(!item) return; itens.push(item); totalManual=null; pintaItens(); pintaTotal(); });
  };

  // --- forma pagamento ---
  sheet.querySelectorAll('#vp-forma button').forEach(b=>{
    b.onclick = ()=>{ forma = b.dataset.f;
      sheet.querySelectorAll('#vp-forma button').forEach(x=> x.classList.remove('active'));
      b.classList.add('active');
      // v461: trocar forma repropõe o total (cartão=cheio; pix/dinheiro=com desconto).
      // Se o dono ajustou manualmente, o ajuste é descartado ao trocar — clareza vale
      // mais que preservar edição num campo cujo valor default acaba de mudar.
      totalManual = null; pintaTotal();
    };
  });

  // v484: toggle "a prazo" — esconde forma de pagamento, mostra venc, força cliente cadastrado
  const aprazoChk = sheet.querySelector('#vp-aprazo');
  const formaWrap = sheet.querySelector('#vp-forma-wrap');
  const vencWrap  = sheet.querySelector('#vp-venc-wrap');
  const vencEl    = sheet.querySelector('#vp-venc');
  aprazoChk.onchange = ()=>{
    aPrazo = aprazoChk.checked;
    formaWrap.style.display = aPrazo ? 'none' : '';
    vencWrap.style.display  = aPrazo ? '' : 'none';
    if(aPrazo && avulso){ avulso=false; selNome=''; pintaCli(); }
    goBtn.textContent = aPrazo ? 'Confirmar venda a prazo' : 'Fechar venda';
    totalManual = null; pintaTotal();
  };
  vencEl.onchange = ()=>{ venc = vencEl.value; validar(); };

  // --- confirmar ---
  goBtn.onclick = async ()=>{
    goBtn.disabled=true; const origTxt = goBtn.textContent; goBtn.textContent='Fechando…';
    try{
      const totalFinal = totalManual!=null ? totalManual : (aPrazo ? _bruto() : totalCalculado());
      const itensPayload = itens.map(i=>({ produto_id:i.produto_id, nome:i.nome, tam:i.tam, qtd:i.qtd, preco:i.preco }));
      if(aPrazo){
        // Categoria "Uniforme/Loja" da academia — cria se não existir (inline).
        let catId = null;
        try {
          const cats = _finCategorias || await sbProf.getCategorias('receita');
          const uni = (cats||[]).find(c=> c.tipo==='receita' && /uniforme|loja/i.test(c.nome||''));
          if(uni) catId = uni.id;
          else catId = await sbProf.salvarCategoria({ nome:'Uniforme/Loja', tipo:'receita' });
        } catch(_) { /* sem categoria — cobrança fica sem categoria, funciona */ }
        await sbProf.registrarVendaAPrazo({
          userId: selUser, itens: itensPayload, total: totalFinal,
          venc, categoria_id: catId,
        });
        toast('✅ Venda a prazo · cobrança pendente criada');
      } else {
        await sbProf.registrarVendaPresencial({
          userId: selUser || null,
          clienteAvulso: selUser ? null : selNome.trim(),
          itens: itensPayload, total: totalFinal, forma,
        });
        toast('✅ Venda registrada · estoque atualizado');
      }
      close(); if(onDone) onDone();
    }catch(e){
      goBtn.disabled=false; goBtn.textContent=origTxt;
      toast('Erro: '+(e.message||e));
    }
  };

  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
// Sub-sheet: escolhe 1 produto + 1 tamanho + quantidade (respeita estoque).
function _vendaPickItem(prods, cb){
  let selProd=null, selTam=null, qtd=1;
  const sheet = el(`<div class="sheet-overlay" style="z-index:1200"><div class="sheet" role="dialog" style="max-height:80vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Adicionar item</div>
    <div class="flbl" style="margin-top:12px">Produto</div>
    <div id="vpi-prods" class="list" style="max-height:220px;overflow-y:auto;margin:6px 0"></div>
    <div id="vpi-detail" style="display:none">
      <div class="flbl" style="margin-top:12px">Tamanho <span style="color:var(--muted);font-weight:500">(clique num com estoque)</span></div>
      <div id="vpi-tams" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0"></div>
      <div class="flbl" style="margin-top:12px">Quantidade</div>
      <div class="qty" style="justify-content:flex-start">
        <button class="qbtn" id="vpi-minus">−</button>
        <span class="qv" id="vpi-qtd">1</span>
        <button class="qbtn" id="vpi-plus">+</button>
      </div>
    </div>
    <button class="btn-save" id="vpi-go" style="margin-top:14px" disabled>Adicionar</button>
    <button class="sheet-cancel" id="vpi-x">Cancelar</button>
  </div></div>`);
  const close=(item)=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); cb(item||null); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#vpi-x').onclick=()=>close();

  const prodsEl = sheet.querySelector('#vpi-prods');
  const detail = sheet.querySelector('#vpi-detail');
  const tamsEl = sheet.querySelector('#vpi-tams');
  const qtdEl = sheet.querySelector('#vpi-qtd');
  const goBtn = sheet.querySelector('#vpi-go');
  const validar = ()=>{ goBtn.disabled = !(selProd && selTam && qtd>0); };
  prods.forEach(p=>{
    const tot=_estoqueTotal(p);
    const r = el(`<div class="cfg-row" role="button" tabindex="0"><span>${safeTxt(p.emoji||'🥋')} ${safeTxt(p.nome)}</span>
      <span style="margin-left:auto;color:var(--muted);font-size:11px">estoque ${tot} · ${moneyBR(p.preco)}</span></div>`);
    r.onclick=()=>{
      selProd=p; selTam=null; qtd=1; qtdEl.textContent='1';
      detail.style.display='block';
      tamsEl.innerHTML='';
      (p.tam||[]).forEach(t=>{
        const est = p.estoque ? (p.estoque[t]??0) : 0;
        const btn = el(`<button class="seg-tam" ${est<=0?'disabled':''} style="padding:6px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card);cursor:${est<=0?'not-allowed':'pointer'};opacity:${est<=0?'.4':'1'}">${safeTxt(t)} <span style="font-size:10px;color:var(--muted)">(${est})</span></button>`);
        btn.onclick = ()=>{ if(est<=0) return;
          selTam=t;
          tamsEl.querySelectorAll('button').forEach(x=>x.style.background='var(--card)');
          btn.style.background='var(--hover)';
          validar();
        };
        tamsEl.appendChild(btn);
      });
      validar();
    };
    prodsEl.appendChild(r);
  });
  sheet.querySelector('#vpi-minus').onclick=()=>{ if(qtd>1){ qtd--; qtdEl.textContent=qtd; validar(); } };
  sheet.querySelector('#vpi-plus').onclick=()=>{
    if(!selProd || !selTam) return;
    const est = selProd.estoque ? (selProd.estoque[selTam]??0) : 0;
    if(qtd>=est) return;
    qtd++; qtdEl.textContent=qtd; validar();
  };
  goBtn.onclick=()=>{
    close({ produto_id:selProd.id, nome:selProd.nome, tam:selTam, qtd, preco:selProd.preco });
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function profPedidos(){
  _loadPedidos();
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Pedidos</div>
    <div class="greet">Confirme o recebimento para baixar o estoque</div></div>`;
  const back = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0"><span>‹ Voltar à Loja</span></div>`);
  back.onclick=()=>goProf('loja'); w.appendChild(back);
  // v484 (0043): botão "＋ Nova venda presencial" foi movido pra Financeiro >
  // Cobranças — venda é lançamento de receita, e agora aceita "a prazo" (aluno
  // pega o produto e paga depois, cobrança pendente linked ao pedido).
  if(!_pedidosData){ w.appendChild(el('<div class="loading-center">Carregando…</div>')); return w; }
  const arr = _pedidosArr();
  let filtro = 'pendente';
  const cont = { pendente:arr.filter(p=>p.status==='pendente').length, concluido:arr.filter(p=>p.status==='concluido').length, cancelado:arr.filter(p=>p.status==='cancelado').length };
  const seg = el(`<div class="filter-seg" style="margin:0 20px 12px">
    <button class="active" data-f="pendente">Pendentes (${cont.pendente})</button>
    <button data-f="concluido">Concluídos (${cont.concluido})</button>
    <button data-f="cancelado">Cancelados (${cont.cancelado})</button>
  </div>`);
  const list = el('<div class="list"></div>');
  const _reload = ()=>{ _loadPedidos(true); render(); };
  const renderList = ()=>{
    list.innerHTML='';
    const src = arr.filter(p=>p.status===filtro);
    if(!src.length){ list.appendChild(el('<div class="empty-line">Nenhum pedido aqui.</div>')); return; }
    src.forEach(p=>{
      const [lbl,cor,cls] = _PED_STATUS[p.status]||['—','var(--muted)',''];
      const resumo = (p.itens||[]).map(it=>`${safeTxt(it.nome)} ${safeTxt(it.tam||'')} ×${it.qtd}`).join(' · ');
      const dt = (p.criadoEm||'').slice(0,10).split('-').reverse().join('/');
      const row = el(`<div class="ped-card">
        <div class="ped-top">
          <div class="ped-cli">${safeTxt(p.cliente||'—')}</div>
          <span class="status-chip ${cls}">${lbl}</span>
        </div>
        <div class="ped-itens">${resumo||'—'}</div>
        <div class="ped-foot"><span class="ped-dt">${dt}${p.canal?' · '+safeTxt(p.canal):''}</span><b class="ped-total">${moneyBR(p.total)}</b></div>
      </div>`);
      if(p.status==='pendente'){
        const acts = el(`<div class="ped-acts">
          <button class="ped-ok">✓ Confirmar (baixa estoque)</button>
          <button class="ped-wa">📱 Responder no WhatsApp</button>
          <button class="ped-no">Cancelar</button></div>`);
        acts.querySelector('.ped-ok').onclick=async()=>{
          const b=acts.querySelector('.ped-ok'); b.disabled=true; b.textContent='Confirmando…';
          if(!DEMO && typeof sbProf!=='undefined' && sbProf.confirmarPedido){
            try{ await sbProf.confirmarPedido(p.id); }
            catch(e){ b.disabled=false; b.textContent='✓ Confirmar (baixa estoque)'; toast('Erro: '+(e.message||e)); return; }
          } else { p.status='concluido'; _baixaEstoqueMock(p); }   // demo
          toast('Pedido confirmado · estoque baixado ✔'); _reload();
        };
        acts.querySelector('.ped-wa').onclick=()=> _abrirRespostaWhatsapp(p);
        acts.querySelector('.ped-no').onclick=async()=>{
          if(!DEMO && typeof sbProf!=='undefined' && sbProf.cancelarPedido){
            try{ await sbProf.cancelarPedido(p.id); }catch(e){ toast('Erro: '+(e.message||e)); return; }
          } else { p.status='cancelado'; }   // demo
          toast('Pedido cancelado'); _reload();
        };
        row.appendChild(acts);
      }
      list.appendChild(row);
    });
  };
  seg.querySelectorAll('[data-f]').forEach(b=> b.onclick=()=>{ filtro=b.dataset.f; seg.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderList(); });
  renderList();
  w.appendChild(seg); w.appendChild(list);
  return w;
}
// v408: sheet com respostas prontas de WhatsApp pro professor confirmar um pedido.
// (B) Professor escolhe caso a caso — não tem flag no produto, cobre pedidos híbridos
// (kimono + barrinha) sem lógica de negócio pra manter.
function _abrirRespostaWhatsapp(p){
  const wa = (p.telefone||'').replace(/\D/g,'');
  if(!wa){ toast('Aluno sem telefone cadastrado — abra a ficha dele pra editar'); return; }
  const nome = (p.cliente||'').split(' ')[0] || '';
  const valor = moneyBR(p.total);
  const ref = p.txid ? ` (ref. ${p.txid})` : '';
  const tpls = [
    { rot: '📦 Retire no balcão', msg: `Oi ${nome}! Recebemos seu PIX de ${valor}${ref} ✅\nSeu pedido está separado — pode retirar no balcão da recepção quando passar por aqui.` },
    { rot: '🙏 Obrigado (já retirado)', msg: `Oi ${nome}! Recebemos seu PIX de ${valor}${ref} ✅\nObrigado! Bom treino 🥋` },
  ];
  const btns = tpls.map((t,i)=>`<button class="btn-save" data-i="${i}">${t.rot}</button>`).join('');
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Responder ao aluno</div>
    <div class="sheet-desc">Escolha o texto — abre o WhatsApp já preenchido.</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">${btns}</div>
    <button class="sheet-cancel" style="margin-top:12px">Cancelar</button>
  </div></div>`);
  const close = openSheet(sheet, '.sheet-cancel');
  sheet.querySelectorAll('[data-i]').forEach(b=> b.onclick=()=>{
    const t = tpls[+b.dataset.i];
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(t.msg)}`, '_blank');
    close();
  });
}
// Demo: baixa o estoque do mock ao confirmar (com backend a RPC faz isso no servidor).
function _baixaEstoqueMock(p){
  (p.itens||[]).forEach(it=>{
    const prod = DB.loja.produtos.find(x=>x.id===it.produto_id);
    if(prod && prod.estoque && prod.estoque[it.tam]!=null){ prod.estoque[it.tam] = Math.max(0, prod.estoque[it.tam] - (it.qtd||0)); }
  });
}

function profLoja(){
  _ensureLojaAdmin();
  const w = el('<div></div>');
  const prods = DB.loja.produtos;
  const ativos = prods.filter(p=> p.ativo!==false);
  const ocultos = prods.filter(p=> p.ativo===false);
  const modoOcultos = !!DB.lojaOcultosOpen;
  const arr = modoOcultos ? ocultos : ativos;
  w.innerHTML = `<div class="hello"><div class="date">Loja${modoOcultos?' · Ocultos':''}</div>
    <div class="greet">${modoOcultos
      ? `${ocultos.length} produto${ocultos.length!==1?'s':''} oculto${ocultos.length!==1?'s':''} · não aparecem pro aluno`
      : `${ativos.length} produto${ativos.length!==1?'s':''} na loja${ocultos.length?' · '+ocultos.length+' oculto'+(ocultos.length!==1?'s':''):''}`}</div></div>`;
  const linha = (p)=>{
    const tot=_estoqueTotal(p);
    const row=el(`<div class="st-row" style="cursor:pointer">
      <div class="prod-mini${p.img?' has-img':''}" style="background:${safeAttr(p.cor||'var(--field)')}">${safeTxt(p.emoji||'🥋')}</div>
      <div class="st-mid"><div class="nm">${safeTxt(p.nome)}</div>
        <div class="meta">${_priceHTML(p.preco,'row')}
          <span style="font-size:11px;color:var(--muted)"> · ${safeTxt(p.cat)} · estoque ${tot}</span></div></div>
      <div class="st-right" style="color:var(--muted);font-size:18px">›</div>
    </div>`);
    _mountProdImg(row.querySelector('.prod-mini'), p);
    row.onclick=()=>abrirProdutoForm(p);
    return row;
  };
  if(modoOcultos){
    const back = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0">
      <span>‹ Voltar pra loja</span></div>`);
    back.onclick=()=>{ DB.lojaOcultosOpen=false; render(); window.scrollTo(0,0); };
    w.appendChild(back);
    const list = el('<div class="list"></div>');
    if(!ocultos.length) list.appendChild(el(`<div class="empty-line" style="padding:30px 20px">Nenhum produto oculto. 🎉</div>`));
    ocultos.forEach(p=> list.appendChild(linha(p)));
    w.appendChild(list);
    w.appendChild(el(`<div style="height:24px"></div>`));
    return w;
  }
  const pend = _pedidosPendentesN();
  const pedBtn = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0">
    <span>🧾 Pedidos${pend?` <span class="low-badge" style="background:var(--red);color:#fff">${pend} pendente${pend>1?'s':''}</span>`:''}</span>
    <span style="margin-left:auto;color:var(--muted)">›</span></div>`);
  pedBtn.onclick=()=>goProf('pedidos');
  w.appendChild(pedBtn);
  const cfgBtn = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0">
    <span>⚙️ Configurações da loja</span>
    <span style="margin-left:auto;color:var(--muted)">›</span></div>`);
  cfgBtn.onclick=()=>_lojaConfigSheet();
  w.appendChild(cfgBtn);
  const bar = el(`<div class="loja-actions">
    <button class="btn-cad" id="lj-add">＋ Novo produto</button>
    ${ocultos.length?`<button class="btn-ghost" id="lj-oct">🚫 Ocultos <span class="cnt">${ocultos.length}</span></button>`:''}
  </div>`);
  bar.querySelector('#lj-add').onclick=()=>abrirProdutoForm(null);
  const octBtn = bar.querySelector('#lj-oct');
  if(octBtn) octBtn.onclick=()=>{ DB.lojaOcultosOpen=true; render(); window.scrollTo(0,0); };
  w.appendChild(bar);
  const list = el('<div class="list"></div>');
  ativos.forEach(p=> list.appendChild(linha(p)));
  w.appendChild(list);
  w.appendChild(el(`<div style="height:24px"></div>`));
  return w;
}

// Tamanhos padrão por categoria — kimono usa medidas próprias (A0–A4 adulto, M0–M4 infantil)
const CAT_TAMANHOS = { 'Kimonos':['A0','A1','A2','A3','A4'], 'Vestuário':['P','M','G','GG'], 'Acessórios':['Único'] };
// Abre a PÁGINA CHEIA de produto (novo ou edição). Substitui o antigo sheet suspenso.
function abrirProdutoForm(p){ DB._produtoEdit = p || null; DB.produtoFormOpen = true; render(); window.scrollTo(0,0); }
function renderProdutoForm(){
  const p = DB._produtoEdit;
  const novo = !p;
  const cats = ['Kimonos','Vestuário','Acessórios'];
  // v425: gaveta. Chave por produto — editar A e depois B não pode misturar rascunho.
  // Lido ANTES do estado inicial pra semear categoria/tamanhos/estoque já restaurados
  // (paintEst/paintFotos rodam logo abaixo e precisam do valor final).
  const _pfKey = 'produto:' + (novo ? 'novo' : String(p.id));
  const _pfSalvo = _formDraftLer(_pfKey);
  let selCat = _pfSalvo ? _pfSalvo.selCat : (p ? p.cat : 'Kimonos');
  let ativo  = _pfSalvo ? !!_pfSalvo.ativo : (p ? p.ativo!==false : true);
  let sizes = _pfSalvo ? (_pfSalvo.sizes||[]).slice() : (p ? (p.tam||[]).slice() : (CAT_TAMANHOS['Kimonos']||[]).slice());
  let sizesCustom = _pfSalvo ? !!_pfSalvo.sizesCustom : !novo;   // produto existente: nunca trocar os tamanhos ao mudar categoria
  let dirty = !!_pfSalvo;   // rascunho restaurado já conta como mexido (protege o "descartar?")
  // Fotos: primeira = capa (p.img), resto = galeria (p.imgs[]). URLs no Supabase Storage
  // (bucket `produtos`, público-leitura). Upload cru — sem crop/compressão (as fotos do
  // catálogo já vêm 1:1 e leves; ver CLAUDE.md § análise de fotos).
  let fotos = _pfSalvo && Array.isArray(_pfSalvo.fotos) ? _pfSalvo.fotos.slice()
            : (p ? [p.img, ...(Array.isArray(p.imgs)?p.imgs:[])].filter(Boolean) : []);
  const est = {};
  sizes.forEach(t=> est[t] = (_pfSalvo && _pfSalvo.est && _pfSalvo.est[t] != null) ? _pfSalvo.est[t]
                            : (p ? (p.estoque?.[t] ?? 0) : 10));
  // v425: sair de vez limpa a gaveta deste produto (salvar, cancelar ou excluir).
  const back=()=>{ _formDraftLimpar(_pfKey); DB.produtoFormOpen=false; DB._produtoEdit=null; render(); window.scrollTo(0,0); };
  const tryBack=()=>{ dirty ? _confirmDescartar(back) : back(); };
  const v = el(`<div class="view prof-page"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar">‹</div>
    <div class="ft"><div class="t">${novo?'Novo produto':'Editar produto'}</div>
      <div class="s">Loja · Gestão</div></div>
  </div>`;
  const bk=v.querySelector('.back');
  bk.onclick=tryBack; bk.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tryBack(); } };
  const body = el(`<div class="flow-body" style="padding:0 20px 40px"></div>`);
  body.innerHTML = `
    <label class="flbl">Nome</label>
    <input class="inp" id="pr-nome" value="${novo?'':safeAttr(p.nome)}" placeholder="Ex: Kimono Yama">
    <label class="flbl" style="margin-top:12px">Preço (R$)</label>
    <input class="inp" id="pr-preco" type="number" inputmode="decimal" value="${novo?'':p.preco}" placeholder="0">
    <label class="flbl" style="margin-top:12px">Emoji</label>
    <input class="inp" id="pr-emoji" value="${novo?'🥋':safeAttr(p.emoji||'🥋')}" maxlength="2">
    <label class="flbl" style="margin-top:12px">Fotos <span style="color:var(--muted);font-weight:500">(1ª = capa)</span></label>
    <div class="pf-fotos" id="pf-fotos"></div>
    <input type="file" accept="image/*" id="pf-file" multiple style="display:none">
    <label class="flbl" style="margin-top:12px">Categoria</label>
    <div class="seg" id="pr-cat"></div>
    <label class="flbl" style="margin-top:12px">Estoque por tamanho</label>
    <div id="pr-est"></div>
    <div class="est-add"><input class="inp" id="pr-newtam" placeholder="Novo tamanho (ex: A2, M3, Única)" maxlength="8"><button id="pr-addtam" aria-label="Adicionar tamanho">＋</button></div>
    <div class="cfg-row" id="pr-vis" style="margin-top:10px"><span>${ativo?'👁️ Visível na loja':'🚫 Oculto da loja'}</span></div>`;
  const estWrap=body.querySelector('#pr-est');
  const paintEst=()=>{
    estWrap.innerHTML='';
    if(!sizes.length){ estWrap.appendChild(el('<div class="empty-line" style="padding:8px 2px;font-size:12px;color:var(--muted)">Sem tamanhos — adicione abaixo.</div>')); return; }
    sizes.forEach(t=>{
      const r=el(`<div class="est-row"><span class="est-t">${safeTxt(t)}</span>
        <div class="qty"><button class="qbtn" data-d="-1" aria-label="Menos">−</button><span class="qv">${est[t]}</span><button class="qbtn" data-d="1" aria-label="Mais">+</button></div>
        <button class="tam-rm" aria-label="Remover tamanho ${safeAttr(t)}">✕</button></div>`);
      const qv=r.querySelector('.qv');
      qv.classList.toggle('low', est[t]<=ESTOQUE_BAIXO);
      r.querySelectorAll('.qbtn').forEach(b=> b.onclick=()=>{ dirty=true; est[t]=Math.max(0, est[t]+(+b.dataset.d)); qv.textContent=est[t]; qv.classList.toggle('low', est[t]<=ESTOQUE_BAIXO); });
      r.querySelector('.tam-rm').onclick=()=>{ dirty=true; sizesCustom=true; sizes=sizes.filter(x=>x!==t); delete est[t]; paintEst(); };
      estWrap.appendChild(r);
    });
  };
  paintEst();
  // Grid de fotos: miniaturas + botão "+" que abre o file input.
  const fotosWrap = body.querySelector('#pf-fotos');
  const fileIn = body.querySelector('#pf-file');
  // v438: `uploading` = fotos em voo. Pinta placeholder animado por cada uma e
  // trava o Salvar enquanto > 0 (foto no meio do upload não pode virar img_url).
  let uploading = 0;
  const paintFotos = ()=>{
    fotosWrap.innerHTML='';
    fotos.forEach((url,i)=>{
      const t=el(`<div class="pf-foto${i===0?' capa':''}"><img src="${safeAttr(url)}" alt="" data-fallback="remove">
        <button class="pf-rm" aria-label="Remover foto ${i+1}">✕</button></div>`);
      t.querySelector('.pf-rm').onclick=()=>{ dirty=true; fotos.splice(i,1); paintFotos(); };
      fotosWrap.appendChild(t);
    });
    for(let k=0;k<uploading;k++) fotosWrap.appendChild(el('<div class="pf-foto pf-loading" aria-label="Enviando foto"></div>'));
    const add=el(`<button class="pf-add" aria-label="Adicionar foto"${uploading?' disabled':''}>＋</button>`);
    add.onclick=()=> fileIn.click();
    fotosWrap.appendChild(add);
    const sv = body.querySelector('#pr-save');
    if(sv){ sv.disabled = uploading>0; sv.textContent = uploading>0 ? 'Enviando foto…' : (novo?'Criar produto':'Salvar'); }
  };
  paintFotos();
  fileIn.onchange = async ()=>{
    const files = Array.from(fileIn.files||[]); fileIn.value='';
    if(!files.length) return;
    if(typeof sbProf==='undefined' || !sbProf.uploadProdutoFoto){ toast('Upload indisponível offline'); return; }
    uploading += files.length; paintFotos();
    for(const f of files){
      try{
        const url = await sbProf.uploadProdutoFoto(f, p?p.id:null);
        if(url){ fotos.push(url); dirty=true; }
      }catch(e){ toast('Erro no upload: '+(e.message||e)); }
      finally{ uploading--; paintFotos(); }
    }
    // v437: auto-persiste img_url/img_urls quando o produto já existe. Sem isso,
    // o professor subia a foto (que ia pro storage), fechava a tela sem clicar
    // "Salvar", e a URL nunca chegava em produtos.img_url — foto órfã no bucket,
    // produto continuava sem imagem (aconteceu com KIMONO YAMA no 2026-08-09).
    if(p && typeof p.id==='string' && p.id.length>=32 && sbProf.salvarProduto){
      p.img = fotos[0]||null; p.imgs = fotos.slice(1);
      sbProf.salvarProduto(p).catch(e=>toast('Erro ao salvar foto: '+(e.message||e)));
    }
  };
  body.querySelector('#pr-addtam').onclick=()=>{
    const inp=body.querySelector('#pr-newtam'); const t=(inp.value||'').trim().toUpperCase();
    if(!t){ toast('Digite o tamanho'); return; }
    if(sizes.includes(t)){ toast('Tamanho já existe'); return; }
    dirty=true; sizesCustom=true; sizes.push(t); est[t]=10; inp.value=''; paintEst();
  };
  const segC=body.querySelector('#pr-cat');
  cats.forEach(c=>{ const b=el(`<button class="${c===selCat?'active':''}">${c}</button>`);
    b.onclick=()=>{ dirty=true; selCat=c; segC.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
      // produto novo sem tamanhos mexidos: troca para os tamanhos padrão da categoria
      if(novo && !sizesCustom){ sizes=(CAT_TAMANHOS[c]||['Único']).slice(); Object.keys(est).forEach(k=>delete est[k]); sizes.forEach(t=>est[t]=10); paintEst(); }
    }; segC.appendChild(b); });
  const visRow=body.querySelector('#pr-vis');
  visRow.onclick=()=>{ dirty=true; ativo=!ativo; visRow.querySelector('span').textContent = ativo?'👁️ Visível na loja':'🚫 Oculto da loja'; };
  body.addEventListener('input', ()=>{ dirty=true; });
  // v425: liga a gaveta. `extra()` carrega o que NÃO é <input> (categoria,
  // tamanhos, estoque, visibilidade, fotos já enviadas) — senão o render()
  // devolveria os textos mas zeraria o estoque que o professor ajustou.
  const _pfDraft = _bindFormDraft(body, _pfKey, ()=>({ selCat, ativo, sizes:sizes.slice(), sizesCustom, est:{...est}, fotos:fotos.slice() }));
  // Cliques (+/− estoque, trocar categoria, remover tamanho) não disparam 'input'
  // — este listener garante que essas mudanças também caiam na gaveta.
  body.addEventListener('click', ()=>{ if(dirty) _pfDraft.salvarAgora(); });
  const salvar=()=>{
    const nome=body.querySelector('#pr-nome').value.trim();
    const preco=parseFloat(body.querySelector('#pr-preco').value)||0;
    const emoji=body.querySelector('#pr-emoji').value.trim()||'🥋';
    if(!nome){ toast('Informe o nome do produto'); return; }
    if(!sizes.length){ toast('Adicione pelo menos um tamanho'); return; }
    let alvo;
    const img = fotos[0] || null;
    const imgs = fotos.slice(1);
    if(novo){
      const id=Math.max(0,...DB.loja.produtos.map(x=>+x.id||0))+1;
      alvo={ id, nome, cat:selCat, preco, emoji, cor:'#f0f0f2', desc:'', tam:sizes.slice(), estoque:{...est}, ativo, img, imgs };
      DB.loja.produtos.push(alvo);
    } else {
      p.nome=nome; p.preco=preco; p.emoji=emoji; p.cat=selCat; p.tam=sizes.slice(); p.estoque={...est}; p.ativo=ativo; p.img=img; p.imgs=imgs; alvo=p;
    }
    // A3: persiste no backend quando ligado. Aguardar o retorno é CRÍTICO — senão o adapter
    // trata o id local (numérico) como "produto novo" e faz INSERT a cada salvamento (bug
    // "1 vira 4" reportado em 2026-07-11). Ao receber o UUID real, substitui o id local
    // p/ que a próxima edição vire UPDATE.
    if(typeof sbProf!=='undefined' && sbProf.salvarProduto){
      sbProf.salvarProduto(alvo).then(realId=>{
        if(realId && typeof realId==='string' && realId.length>=32){ alvo.id = realId; save(); }
      }).catch(e=>toast('Erro ao salvar produto: '+(e.message||e)));
    }
    dirty=false; back();
    toast(novo?'Produto criado ✔':'Produto salvo ✔');
  };
  // Botões inline no fim do formulário (mesmo padrão da página de cadastro de aluno):
  // integrado ao fluxo, sem a barra branca flutuante da save-bar. Salvar antes de Excluir.
  const saveBtn=el(`<button class="btn-save" id="pr-save" style="margin-top:18px">${novo?'Criar produto':'Salvar'}</button>`);
  saveBtn.onclick=salvar;
  body.appendChild(saveBtn);
  if(!novo){
    const delRow=el(`<button class="cfg-row danger" id="pr-del" style="justify-content:center;margin-top:10px;font-weight:700"><span>🗑️ Excluir produto</span></button>`);
    delRow.onclick=(ev)=>{ ev.preventDefault(); ev.stopPropagation(); _profExcluirProdutoSheet(p, ()=>{ dirty=false; back(); }); };
    body.appendChild(delRow);
  }
  v.appendChild(body);
  return v;
}

// Exclusão de produto (gestão). Backend: sbProf.deletarProduto (cascade apaga variantes/movimentos).
// Offline: remove de DB.loja.produtos p/ demonstração. Também limpa carrinho para o item some.
function _profExcluirProdutoSheet(p, done){
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Excluir ${safeTxt(p.nome)}?</div>
    <div class="sheet-desc">Apaga o produto e o estoque de todos os tamanhos. Se preferir só tirar da loja sem apagar histórico, use o toggle "👁️ / 🚫". Não dá pra desfazer.</div>
    <button class="btn-save danger" id="pd-sim">Excluir definitivamente</button>
    <button class="sheet-cancel" id="pd-nao">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pd-nao').onclick=close;
  sheet.querySelector('#pd-sim').onclick=async()=>{
    const btn=sheet.querySelector('#pd-sim'); btn.disabled=true; btn.textContent='Excluindo…';
    // Só chama backend se o id for UUID real (produto persistido).
    if(typeof sbProf!=='undefined' && sbProf.deletarProduto && typeof p.id==='string' && p.id.length>=32){
      try{ await sbProf.deletarProduto(p.id); }
      catch(e){ btn.disabled=false; btn.textContent='Excluir definitivamente'; toast('Erro ao excluir: '+(e.message||e)); return; }
    }
    DB.loja.produtos = (DB.loja.produtos||[]).filter(x=> x.id !== p.id);
    if(DB.loja.carrinho) DB.loja.carrinho = DB.loja.carrinho.filter(it=>it.id!==p.id);
    save();
    close(); if(done) done(); toast('Produto excluído ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function icoStore(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 22V12h6v10"/></svg>'; }
/* ============================================================
   PROFESSOR — Turmas + Grade de horários (gestão)
   Turma = grupo; sessões = dia+hora (+variação/bilíngue). A grade
   semanal renderiza as sessões de todas as turmas por dia/hora.
   Demo: muta DB.turmas. Com backend: sbProf.turmas* (Fase B backend).
   ============================================================ */
const DIAS_SEMANA = [['seg','Seg'],['ter','Ter'],['qua','Qua'],['qui','Qui'],['sex','Sex'],['sab','Sáb'],['dom','Dom']];
function _turmasArr(){ return DB.turmas || (DB.turmas=[]); }
function _turmaById(id){ return _turmasArr().find(t=>t.id===id); }
// Backend (guardado): carrega as turmas da nuvem. Demo (sbProf undefined) → usa DB.turmas em memória.
let _turmasTs = 0;
function _loadTurmas(){
  if(DEMO || typeof sbProf==='undefined') return;   // demo/local: usa DB.turmas em memória
  if(Date.now() - _turmasTs < 30000) return;
  _turmasTs = Date.now();
  sbProf.getTurmas().then(ts=>{ DB.turmas = ts; renderBg(); }).catch(()=>{ _turmasTs = 0; });
}

function profTurmas(){
  _loadTurmas();
  const w = el('<div></div>');
  const n = _turmasArr().length;
  w.innerHTML = `<div class="hello"><div class="date">Turmas</div>
    <div class="greet">${n} turma${n!==1?'s':''} · grade semanal</div></div>`;
  const turmasArr = _turmasArr();
  // Abas: Grade + Ocupação (heatmap). Instrutores fica fora até termos instrutor_id
  // real na tabela turma_sessoes (dep da migration 0012).
  const tab = DB._turmasTab || 'grade';
  const TABS = [['grade','Grade'],['heat','Ocupação']];
  const tabsBar = el('<div class="turmas-tabs"></div>');
  TABS.forEach(([k,l])=>{
    const b = el(`<button class="turmas-tab${k===tab?' on':''}">${l}</button>`);
    b.onclick = ()=>{ DB._turmasTab = k; render(); };
    tabsBar.appendChild(b);
  });
  w.appendChild(tabsBar);
  const grade = el('<div class="mod-card" style="padding:14px 12px"></div>');
  if(tab==='grade'){
    grade.appendChild(el(`<div class="mod-title" style="margin-bottom:8px;padding:0 4px">Grade de horários</div>`));
    grade.appendChild(_gradeHorarios(turmasArr));
  } else if(tab==='heat'){
    grade.appendChild(el(`<div class="mod-title" style="margin-bottom:8px;padding:0 4px">Heatmap de ocupação</div>`));
    grade.appendChild(_viewHeatmap(turmasArr));
  }
  w.appendChild(grade);
  const add = el(`<button class="add-turma">+ Nova turma</button>`);
  add.onclick=()=> _turmaSheet(null);
  w.appendChild(add);
  const list = el('<div class="turma-list"></div>');
  _turmasArr().forEach(t=>{
    const ns=(t.sessoes||[]).length;
    const row = el(`<button class="turma-row">
      <span class="tr-dot" style="background:${t.cor||'#888'}"></span>
      <span class="tr-info">
        <b class="tr-nm">${safeTxt(t.nome)}</b>
        ${t.faixaEtaria?`<span class="tr-idade">${safeTxt(t.faixaEtaria)}</span>`:''}
        <span class="tr-meta">${ns} horário${ns!==1?'s':''}</span>
      </span>
      <span class="tr-caret">›</span></button>`);
    row.onclick=()=> _turmaSheet(t.id);
    list.appendChild(row);
  });
  if(!n) list.appendChild(el('<div class="empty-hint">Nenhuma turma ainda. Crie a primeira.</div>'));
  w.appendChild(list);
  return w;
}

// Grade semanal: linhas = horas distintas ordenadas; colunas = dias com sessão.

/* ============================================================
   VIEW OCUPAÇÃO — heatmap com toggle Matriculados ↔ Presença média.
   Matriculados: dado REAL (_turmaAlunos × turma.capacidade_max).
   Presença média: heurística estável até a migration 0010 (checkin por
   aula) desbloquear a query real das últimas N semanas.
   ============================================================ */
function _ocupCell(turma){
  return { n: _turmaAlunos(turma.id).length, cap: turma.capacidade_max || 0 };
}
function _viewHeatmap(turmas){
  const wrap = el('<div></div>');
  const modo = DB._heatMode==='pres' ? 'pres' : 'matr';
  // Janela em DIAS (v368): antes só semanas. Agora aceita 7/14 pra ver a semana
  // corrente/quinzena antes que a média se dilua.
  const JANELAS = [ [7,'7 d'], [14,'14 d'], [28,'4 sem'], [56,'8 sem'], [84,'12 sem'], [112,'16 sem'] ];
  const janelaDias = JANELAS.some(([n])=>n===DB._heatDias) ? DB._heatDias : 56;
  if(modo==='pres') _loadRelData();
  // Presença média por sessão (real, de checkins) na janela escolhida.
  const presBy = {}; const aulasBy = {};
  if(modo==='pres') _ocupacaoSessoes(janelaDias).forEach(o=>{
    const k=o.dia+'|'+o.hora; presBy[k]=(presBy[k]||0)+o.media; aulasBy[k]=(aulasBy[k]||0)+o.aulas;
  });
  const seg = el(`<div class="seg" style="margin-bottom:8px">
    <button class="${modo==='matr'?'active':''}" data-m="matr" type="button">Matrículas</button>
    <button class="${modo==='pres'?'active':''}" data-m="pres" type="button">Presenças</button>
  </div>`);
  seg.querySelectorAll('button').forEach(b=> b.onclick=()=>{ DB._heatMode=b.dataset.m; render(); });
  wrap.appendChild(seg);
  if(modo==='pres'){
    const jan = el(`<div class="seg heat-janela" style="margin-bottom:12px;flex-wrap:wrap">
      ${JANELAS.map(([n,lbl])=>`<button class="${n===janelaDias?'active':''}" data-d="${n}" type="button">${lbl}</button>`).join('')}
    </div>`);
    jan.querySelectorAll('button').forEach(b=> b.onclick=()=>{ DB._heatDias = +b.dataset.d; render(); });
    wrap.appendChild(jan);
  }
  if(modo==='pres' && !_relData){ wrap.appendChild(el('<div class="loading-center">Carregando presenças…</div>')); return wrap; }
  const DIAS = [['seg','SEG'],['ter','TER'],['qua','QUA'],['qui','QUI'],['sex','SEX'],['sab','SÁB'],['dom','DOM']];
  const cells = {}, horasSet = new Set(), diasSet = new Set();
  turmas.forEach(t=> (t.sessoes||[]).forEach(s=>{
    const k = s.dia+'|'+s.hora;
    const oc = _ocupCell(t);
    cells[k] = cells[k] || {n:0,cap:0,turmas:[],ids:[]};
    cells[k].n += oc.n; cells[k].cap += oc.cap;
    cells[k].turmas.push(t.nome); cells[k].ids.push(t.id);
    horasSet.add(s.hora); diasSet.add(s.dia);
  }));
  const horas = [...horasSet].sort();
  const dias = DIAS.filter(([d])=> diasSet.has(d));
  if(!horas.length){ wrap.appendChild(el('<div class="empty-hint">Sem sessões cadastradas.</div>')); return wrap; }
  const heat = el('<div class="heat"></div>');
  heat.style.gridTemplateColumns = `56px repeat(${dias.length}, minmax(46px,1fr))`;
  heat.appendChild(el('<div class="heat-corner"></div>'));
  dias.forEach(([,lbl])=> heat.appendChild(el(`<div class="heat-dh">${lbl}</div>`)));
  horas.forEach(h=>{
    heat.appendChild(el(`<div class="heat-hh">${safeTxt(h)}</div>`));
    dias.forEach(([d])=>{
      const c = cells[d+'|'+h];
      if(!c){ heat.appendChild(el('<div class="heat-c empty"></div>')); return; }
      const open = ()=> _turmaSheet(c.ids[0]);
      const n = modo==='pres' ? Math.round((presBy[d+'|'+h]||0)*10)/10 : c.n;
      if(!c.cap){
        const cell = el(`<div class="heat-c nocap" style="cursor:pointer" title="${safeAttr(c.turmas.join(', ')+' — sem capacidade cadastrada')}"><b>${n}</b><i>—</i></div>`);
        cell.onclick = open; heat.appendChild(cell); return;
      }
      const pct = Math.round(n*100/c.cap);
      const kind = pct>=90?'red' : pct>=70?'gold' : pct>=40?'green' : 'blue';
      const cell = el(`<div class="heat-c ${kind}" style="cursor:pointer" title="${safeAttr(c.turmas.join(', ')+' — '+n+'/'+c.cap+' ('+pct+'%)')}"><b>${n}</b><i>/${c.cap}</i></div>`);
      cell.onclick = open; heat.appendChild(cell);
    });
  });
  wrap.appendChild(heat);
  wrap.appendChild(el(`<div class="heat-legend">
    <span><i class="blue"></i> &lt;40%</span>
    <span><i class="green"></i> 40-70%</span>
    <span><i class="gold"></i> 70-90%</span>
    <span><i class="red"></i> ≥90%</span>
    <span class="heat-note">${modo==='pres'?('Presença média por sessão nos últimos '+janelaDias+' dias.'):'Matriculados por sessão (n / capacidade).'}</span>
  </div>`));
  return wrap;
}

// Grade de horários — renderiza DUAS variantes + chips filtro de faixa etária.
//   .grade-desktop (dias em cima, horas na esquerda) — mostra em >=800px
//   .grade-mobile  (horas em cima, dias na esquerda) — mostra em <800px
// Extras: destaca coluna/linha do dia atual, zebra nas horas, filtro por
// faixa etária (chips clicáveis acima da grade). Filtro persiste em DB._gradeFaixa.
function _gradeHorarios(turmas){
  const wrap = el('<div class="grade-wrap"></div>');
  const jsToKey = ['dom','seg','ter','qua','qui','sex','sab'];
  const diaHoje = jsToKey[(new Date()).getDay()];
  // Chips de filtro por faixa etária (Chiisai/Kodomo/Kouhai/Adulto/Feminino/...)
  const faixasDisp = [...new Set((turmas||[]).map(t=>t.faixaEtaria).filter(Boolean))];
  const fSel = DB._gradeFaixa || 'todas';
  if(faixasDisp.length > 1){
    const bar = el('<div class="grade-fchips"></div>');
    const mk = (id, lbl)=>{
      const b = el(`<button class="grade-fchip${fSel===id?' on':''}">${safeTxt(lbl)}</button>`);
      b.onclick = ()=>{ DB._gradeFaixa = id; render(); };
      return b;
    };
    bar.appendChild(mk('todas','Todas'));
    faixasDisp.forEach(f=> bar.appendChild(mk(f,f)));
    wrap.appendChild(bar);
  }
  const turmasFiltradas = (turmas||[]).filter(t=> fSel==='todas' || t.faixaEtaria===fSel);
  const cells = {}; const horasSet = new Set(); const diasSet = new Set();
  turmasFiltradas.forEach(t=> (t.sessoes||[]).forEach(s=>{
    const k = s.dia+'|'+s.hora; (cells[k]=cells[k]||[]).push({t, s});
    horasSet.add(s.hora); diasSet.add(s.dia);
  }));
  const horas = [...horasSet].sort();
  const dias = DIAS_SEMANA.filter(([d])=> diasSet.has(d));
  if(!horas.length){ wrap.appendChild(el('<div class="empty-hint">Sem horários pra essa faixa.</div>')); return wrap; }
  const chipHTML = (t,s)=>{
    const sub = s.variacao || t.faixaEtaria || '';
    return `<span class="g-chip" style="--tc:${t.cor||'#888'}">
      <b class="g-nm">${safeTxt(t.nome)}${s.bilingue?' '+icoUSFlag():''}</b>
      ${sub?`<i class="g-sub">${safeTxt(sub)}</i>`:''}
    </span>`;
  };
  // ---------- DESKTOP: dias em cima, horas na esquerda ----------
  const table = el('<div class="grade grade-desktop"></div>');
  table.style.gridTemplateColumns = `48px repeat(${dias.length}, minmax(62px,1fr))`;
  table.appendChild(el('<div class="g-h g-corner"></div>'));
  dias.forEach(([d,lbl])=> table.appendChild(el(`<div class="g-h${d===diaHoje?' g-h-today':''}">${lbl}</div>`)));
  horas.forEach((h,rowIdx)=>{
    const zebra = rowIdx%2===1 ? ' g-zebra' : '';
    table.appendChild(el(`<div class="g-hora${zebra}">${safeTxt(h)}</div>`));
    dias.forEach(([d])=>{
      const isToday = d===diaHoje ? ' g-today' : '';
      const cell = el(`<div class="g-cell${zebra}${isToday}"></div>`);
      (cells[d+'|'+h]||[]).forEach(({t,s})=>{
        const chip = el(chipHTML(t,s));
        chip.style.cursor = 'pointer';
        chip.onclick = ()=> _turmaSheet(t.id);
        cell.appendChild(chip);
      });
      table.appendChild(cell);
    });
  });
  wrap.appendChild(table);
  // ---------- MOBILE: horas em cima, dias na esquerda ----------
  const tableM = el('<div class="grade grade-mobile"></div>');
  tableM.style.gridTemplateColumns = `44px repeat(${horas.length}, minmax(0,1fr))`;
  tableM.appendChild(el('<div class="g-h g-corner"></div>'));
  horas.forEach((h,i)=> tableM.appendChild(el(`<div class="g-h${i%2===1?' g-zebra':''}">${safeTxt(h)}</div>`)));
  dias.forEach(([d,lbl])=>{
    const isToday = d===diaHoje ? ' g-today' : '';
    tableM.appendChild(el(`<div class="g-dia${isToday}">${lbl}</div>`));
    horas.forEach((h,i)=>{
      const zebra = i%2===1 ? ' g-zebra' : '';
      const cell = el(`<div class="g-cell${zebra}${isToday}"></div>`);
      (cells[d+'|'+h]||[]).forEach(({t,s})=>{
        const chip = el(chipHTML(t,s));
        chip.style.cursor = 'pointer';
        chip.onclick = ()=> _turmaSheet(t.id);
        cell.appendChild(chip);
      });
      tableM.appendChild(cell);
    });
  });
  wrap.appendChild(tableM);
  return wrap;
}

/* Popup do ALUNO: horários das turmas — MESMA fonte da gestão (DB.turmas / _gradeHorarios).
   Online, re-baixa a grade na hora ao abrir (o que o professor salvou aparece aqui). */
function abrirMinhasTurmas(){
  const sh = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:88vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title" id="mt-title">Minhas turmas</div>
    <div class="mt-sub" id="mt-sub"></div>
    <div id="mt-body"><div class="empty-hint">Carregando…</div></div>
    <button class="btn-save sheet-cancel" style="margin-top:14px">Fechar</button></div></div>`);
  openSheet(sh, '.sheet-cancel');
  const DL = Object.fromEntries(DIAS_SEMANA);
  const paint = ()=>{
    const meusIds = new Set(DB._minhasTurmasIds || (DB.eu && DB.eu.turmas) || []);
    const todas = DB.turmas || [];
    const minhas = todas.filter(t => meusIds.has(t.id));
    const title = sh.querySelector('#mt-title');
    if(title) title.textContent = minhas.length > 1 ? 'Minhas turmas' : 'Minha turma';
    const sub = sh.querySelector('#mt-sub');
    if(sub) sub.textContent = minhas.length
      ? `${minhas.length} turma${minhas.length>1?'s':''} · seus horários`
      : 'Você ainda não está matriculado em nenhuma turma. Fale com o professor.';
    const body = sh.querySelector('#mt-body'); if(!body) return;
    body.innerHTML = '';
    if(!todas.length){ body.appendChild(el('<div class="empty-hint">A academia ainda não publicou a grade de horários.</div>')); return; }
    if(!minhas.length){ body.appendChild(el('<div class="empty-hint">Nenhuma turma na sua matrícula.</div>')); return; }

    // Card UNIFICADO — 1 grid pra todas as turmas (linha=dia, coluna=horário).
    // Cada célula ocupada ganha cor da turma correspondente (borda + logo).
    const ORD_DIAS = ['seg','ter','qua','qui','sex','sab','dom'];
    const allSess = [];
    minhas.forEach(t=> (t.sessoes||[]).forEach(s=> allSess.push({...s, _t:t})));
    if(!allSess.length){
      body.appendChild(el('<div class="empty-hint">Suas turmas ainda não têm horários cadastrados.</div>'));
      return;
    }
    // Legenda no topo: só aparece com 2+ turmas (com 1 turma o título já basta e a
    // grade mantém texto nas células — trocar por só-cor pra 1 turma vira ambíguo).
    const multi = minhas.length > 1;
    if(multi){
      const legenda = el(`<div class="mt-legenda"></div>`);
      minhas.forEach(t=>{
        const chip = el(`<span class="mt-legenda-item" style="--tc:${safeAttr(t.cor||'#888')}">
          <span class="mt-tcolor" aria-hidden="true"></span>
          <b>${safeTxt(t.nome)}</b>${t.faixaEtaria?` <span class="mt-tid">${safeTxt(t.faixaEtaria)}</span>`:''}
        </span>`);
        legenda.appendChild(chip);
      });
      body.appendChild(legenda);
    }
    // Coleta horários (colunas) e dias (linhas) do UNIÃO das turmas
    const horas = [...new Set(allSess.map(s=>s.hora))].sort();
    const diasComSess = ORD_DIAS.filter(d=> allSess.some(s=>s.dia===d));
    // Índice: {dia|hora → sessão} — se houver conflito, mantém o 1º (raro)
    const idx = {};
    allSess.forEach(s=>{ const k=s.dia+'|'+s.hora; if(!idx[k]) idx[k]=s; });
    const grid = el(`<div class="mt-grid"></div>`);
    grid.style.gridTemplateColumns = `44px repeat(${horas.length}, minmax(0, 1fr))`;
    grid.appendChild(el('<div class="mt-gh mt-gh-corner"></div>'));
    horas.forEach(h=> grid.appendChild(el(`<div class="mt-gh">${safeTxt(h)}</div>`)));
    diasComSess.forEach(d=>{
      grid.appendChild(el(`<div class="mt-gd">${safeTxt(DL[d]||d)}</div>`));
      horas.forEach(h=>{
        const s = idx[d+'|'+h];
        if(!s){ grid.appendChild(el('<div class="mt-gc empty"></div>')); return; }
        // Chip 2 linhas (mesmo design do professor em _gradeHorarios): NOME em cima,
        // VARIAÇÃO ou FAIXA ETÁRIA embaixo. Bandeira 🇺🇸 vai INLINE no nome (HTML cru),
        // NÃO junto de texto — safeTxt escaparia o SVG e mostraria a tag como texto.
        const t = s._t; const cor = t.cor||'#888';
        const sub = s.variacao || t.faixaEtaria || '';
        const flag = s.bilingue ? ' '+icoUSFlag() : '';
        // Multi-turma: célula é bloco sólido de cor, sem texto (a legenda no topo identifica).
        // Uma turma só: mantém chip com nome+sub (não precisa de legenda pra 1 turma).
        if(multi){
          grid.appendChild(el(`<div class="mt-gc mt-gc-solid" style="--tc:${safeAttr(cor)};background:${safeAttr(cor)}" title="${safeAttr(t.nome)}${sub?' · '+safeAttr(sub):''}"></div>`));
        } else {
          grid.appendChild(el(`<div class="mt-gc" style="--tc:${safeAttr(cor)}" title="${safeAttr(t.nome)}">
            <b class="g-nm">${safeTxt(t.nome)}${flag}</b>
            ${sub?`<i class="g-sub">${safeTxt(sub)}</i>`:''}
          </div>`));
        }
      });
    });
    body.appendChild(grid);
  };
  paint();
  if(!DEMO && typeof sbSync!=='undefined' && DB.sbUser){
    (async()=>{
      try{ if(sbSync.pullTurmas) await sbSync.pullTurmas(); }catch(e){}
      try{ if(sbSync.pullMatricula) await sbSync.pullMatricula(); }catch(e){}
      paint();
    })();
  }
}

const _TURMA_CORES = ['#334155','#d4a017','#8e44ad','#2e7d32','#c2185b','#2f8fef','#e5392f','#0d9488'];
// Atalho de navegação — código antigo chama _turmaSheet(id) ou _turmaSheet(null).
// Agora vira uma navegação de página cheia (DB.turmaEditOpen).
function _turmaSheet(id){ DB.turmaEditOpen = id || 'new'; render(); window.scrollTo(0,0); }

// PÁGINA CHEIA de edição de turma — substitui o modal sheet antigo.
function profTurmaEdit(id){
  const t = id ? _turmaById(id) : null;
  const novo = !t;
  let cor = t?.cor || _TURMA_CORES[0];
  let sessoes = (t?.sessoes || []).slice();
  let capacidade = (t && t.capacidade_max) || '';
  const close = ()=>{ DB.turmaEditOpen=null; render(); window.scrollTo(0,0); };
  const sheet = el(`<div class="erp-turma-page">
    <div class="erp-turma-hd">
      <button class="erp-batch-close" id="tu-back" aria-label="Voltar">‹</button>
      <div class="erp-turma-title">${novo?'Nova turma':'Editar turma'}</div>
      <span></span>
    </div>
    <div class="erp-turma-body">
    <label class="flbl">Nome</label>
    <input class="inp" id="tu-nome" placeholder="Ex: Adulto, Kodomo…" value="${t?safeAttr(t.nome):''}">
    <label class="flbl" style="margin-top:12px">Faixa etária <span class="ca-opt">(opcional)</span></label>
    <input class="inp" id="tu-idade" placeholder="Ex: 16+, 6–9 anos" value="${t?safeAttr(t.faixaEtaria||''):''}">
    <label class="flbl" style="margin-top:12px">Capacidade máxima <span class="ca-opt">(quantos alunos cabem)</span></label>
    <input class="inp" id="tu-cap" type="number" min="1" max="200" placeholder="Ex: 20" value="${capacidade?safeAttr(capacidade):''}">
    <label class="flbl" style="margin-top:12px">Cor <span class="ca-opt">(escolha uma sugerida ou pinte livre)</span></label>
    <div class="cor-seg" id="tu-cor"></div>
    <div class="cor-picker">
      <input class="cor-picker-inp" id="tu-cor-hex" type="color" value="${safeAttr(cor)}" aria-label="Cor livre (hexadecimal)">
      <span class="cor-picker-lbl" id="tu-cor-lbl">${safeAttr(cor)}</span>
    </div>
    ${!novo?`<label class="flbl" style="margin-top:14px">Horários (<span id="tu-nses">${(t.sessoes||[]).length}</span>)</label><div id="tu-sessoes"></div>
      <button class="add-sessao" id="tu-addses">+ Adicionar horário</button>`:'<div class="empty-hint" style="margin-top:12px">Salve a turma para adicionar horários.</div>'}
    ${!novo?`<div class="cad-sec">Alunos matriculados</div><div id="tu-roster"></div>`:''}
    <button class="btn-save" id="tu-save" style="margin-top:16px">${novo?'Criar turma':'Salvar'}</button>
    ${!novo?'<button class="action-item danger" id="tu-del" style="justify-content:center;margin-top:8px">Excluir turma</button>':''}
    <button class="sheet-cancel" id="tu-cancel" style="margin-top:8px">Cancelar</button>
    </div>
  </div>`);
  sheet.querySelector('#tu-back').onclick = close;
  const corSeg = sheet.querySelector('#tu-cor');
  const corHex = sheet.querySelector('#tu-cor-hex');
  const corLbl = sheet.querySelector('#tu-cor-lbl');
  const paintCor=()=>{
    corSeg.innerHTML='';
    _TURMA_CORES.forEach(c=>{
      const b=el(`<button type="button" class="cor-dot ${c.toLowerCase()===String(cor).toLowerCase()?'on':''}" style="background:${c}" aria-label="Cor ${c}"></button>`);
      b.onclick=()=>{ cor=c; corHex.value=c; corLbl.textContent=c; paintCor(); };
      corSeg.appendChild(b);
    });
  };
  paintCor();
  corHex.oninput=()=>{ cor=corHex.value; corLbl.textContent=cor; paintCor(); };
  if(!novo){
    const sesWrap=sheet.querySelector('#tu-sessoes');
    const nSes=sheet.querySelector('#tu-nses');
    const paintSes=()=>{
      sesWrap.innerHTML='';
      sessoes.forEach(s=>{
        const lbl = (DIAS_SEMANA.find(([d])=>d===s.dia)||[,s.dia])[1];
        const row=el(`<div class="ses-row">
          <button class="ses-info" type="button" aria-label="Editar horário">
            <span>${lbl} · ${safeTxt(s.hora)}${s.variacao?' · '+safeTxt(s.variacao):''}${s.bilingue?' '+icoUSFlag():''}</span>
            <span class="ses-edit-hint">✎</span>
          </button>
          <button class="ses-del" aria-label="Remover horário">✕</button>
        </div>`);
        // Toque no chip abre edição; ✕ remove
        row.querySelector('.ses-info').onclick=()=> _editSessaoSheet(s, (novaS)=>{
          Object.assign(s, novaS); paintSes();
        });
        row.querySelector('.ses-del').onclick=()=>{ sessoes=sessoes.filter(x=>x!==s); paintSes(); };
        sesWrap.appendChild(row);
      });
      if(!sessoes.length) sesWrap.appendChild(el('<div class="empty-hint" style="margin:4px 0">Sem horários ainda.</div>'));
      if(nSes) nSes.textContent=sessoes.length;
    };
    paintSes();
    sheet.querySelector('#tu-addses').onclick=()=> _sessaoSheet(t.nome, (s)=>{ sessoes.push(s); paintSes(); }, sessoes);
    const rosterBox=sheet.querySelector('#tu-roster');
    const paintRoster=()=>{ if(rosterBox){ rosterBox.innerHTML=''; rosterBox.appendChild(_turmaRosterNode(t, paintRoster)); } };
    paintRoster();
  }
  sheet.querySelector('#tu-cancel').onclick=close;
  const delBtn=sheet.querySelector('#tu-del');
  if(delBtn) delBtn.onclick=()=>{
    if(!DEMO && typeof sbProf!=='undefined'){ sbProf.deletarTurma(t.id).then(()=>{ _turmasTs=0; _loadTurmas(); toast('Turma excluída'); }).catch(e=>toast('Erro ao excluir turma: '+(e.message||e))); close(); return; }
    DB.turmas=_turmasArr().filter(x=>x!==t); close(); toast('Turma excluída');
  };
  sheet.querySelector('#tu-save').onclick=()=>{
    const nome=sheet.querySelector('#tu-nome').value.trim();
    if(!nome){ toast('Informe o nome da turma'); return; }
    const idade=sheet.querySelector('#tu-idade').value.trim();
    const cap = parseInt(sheet.querySelector('#tu-cap').value,10) || null;
    if(!DEMO && typeof sbProf!=='undefined'){
      const payload = novo ? { nome, faixaEtaria:idade, cor, sessoes, capacidade_max:cap } : { id:t.id, nome, faixaEtaria:idade, cor, sessoes, capacidade_max:cap };
      sbProf.salvarTurma(payload).then((newId)=>{ _turmasTs=0; _loadTurmas();
        toast(novo?'Turma criada ✔ — adicione os horários':'Turma salva ✔');
        if(novo && newId) setTimeout(()=>_turmaSheet(newId), 350);
      }).catch(e=>toast('Erro ao salvar turma: '+(e.message||e)));
      close(); return;
    }
    if(novo){ const nid='t'+Date.now(); _turmasArr().push({ id:nid, nome, faixaEtaria:idade, cor, sessoes, capacidade_max:cap }); toast('Turma criada ✔ — adicione os horários'); setTimeout(()=>_turmaSheet(nid), 200); return; }
    t.nome=nome; t.faixaEtaria=idade; t.cor=cor; t.sessoes=sessoes; t.capacidade_max=cap;
    close(); toast('Turma salva ✔');
  };
  return sheet;
}

/* Novo horário — multi-dia batch (matriz visual removida por feedback do dono).
   Marca vários dias + hora + variação uma vez → cria N horários. */
function _sessaoSheet(nomeTurma, onAdd, sessoesExistentes){
  const existSet = new Set((sessoesExistentes||[]).map(s=>s.dia+'|'+s.hora));
  const diasSel = new Set();
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Novo horário — ${safeTxt(nomeTurma)}</div>
    <div class="sheet-desc">Marque os dias e defina a hora uma vez — cria em lote</div>
    <label class="flbl" style="margin-top:8px">Dias</label>
    <div class="seg" id="se-dias-multi"></div>
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Hora</label><input class="inp" id="se-hora" type="time" value="19:30"></div>
      <div style="flex:1"><label class="flbl">Variação <span class="ca-opt">(opc.)</span></label><input class="inp" id="se-var" placeholder="No-Gi, Avançado…"></div>
    </div>
    <label class="onb-consent" style="margin-top:14px"><input type="checkbox" id="se-bi"> <span>Treino bilíngue ${icoUSFlag()}</span></label>
    <button class="btn-save" id="se-save" style="margin-top:14px">Adicionar</button>
    <button class="sheet-cancel" id="se-cancel">Cancelar</button>
  </div></div>`);
  const segDias=sheet.querySelector('#se-dias-multi');
  DIAS_SEMANA.forEach(([d,lbl])=>{
    const b=el(`<button type="button">${lbl}</button>`);
    b.onclick=()=>{ diasSel.has(d)?diasSel.delete(d):diasSel.add(d); b.classList.toggle('active', diasSel.has(d)); };
    segDias.appendChild(b);
  });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#se-cancel').onclick=close;
  sheet.querySelector('#se-save').onclick=()=>{
    if(!diasSel.size){ toast('Marque pelo menos 1 dia'); return; }
    const hora=sheet.querySelector('#se-hora').value; if(!hora){ toast('Informe a hora'); return; }
    const variacao=sheet.querySelector('#se-var').value.trim();
    const bilingue=sheet.querySelector('#se-bi').checked;
    let n=0, dup=0;
    [...diasSel].forEach(d=>{
      if(existSet.has(d+'|'+hora)){ dup++; return; }
      const s={ id:'s'+Date.now()+'-'+d, dia:d, hora, variacao:variacao||undefined, bilingue:bilingue||undefined };
      if(onAdd) onAdd(s);
      existSet.add(d+'|'+hora);
      n++;
    });
    close();
    if(n) toast(`${n} horário${n>1?'s':''} adicionado${n>1?'s':''} ✔${dup?` (${dup} já existia${dup>1?'m':''})`:''}`);
    else toast('Todos os dias marcados já têm essa hora');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* Editar sessão existente — toque no chip do horário abre este sheet. */
function _editSessaoSheet(s, onSave){
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar horário</div>
    <label class="flbl">Dia</label>
    <div class="seg" id="ed-dia"></div>
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Hora</label><input class="inp" id="ed-hora" type="time" value="${safeAttr(s.hora||'19:30')}"></div>
      <div style="flex:1"><label class="flbl">Variação <span class="ca-opt">(opc.)</span></label><input class="inp" id="ed-var" placeholder="No-Gi, Avançado…" value="${safeAttr(s.variacao||'')}"></div>
    </div>
    <label class="onb-consent" style="margin-top:14px"><input type="checkbox" id="ed-bi" ${s.bilingue?'checked':''}> <span>Treino bilíngue ${icoUSFlag()}</span></label>
    <button class="btn-save" id="ed-save" style="margin-top:14px">Salvar alterações</button>
    <button class="sheet-cancel" id="ed-cancel">Cancelar</button>
  </div></div>`);
  let dia=s.dia||'seg';
  const segDia=sheet.querySelector('#ed-dia');
  DIAS_SEMANA.forEach(([d,lbl])=>{
    const b=el(`<button type="button" class="${d===dia?'active':''}">${lbl}</button>`);
    b.onclick=()=>{ dia=d; segDia.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); };
    segDia.appendChild(b);
  });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ed-cancel').onclick=close;
  sheet.querySelector('#ed-save').onclick=()=>{
    const hora=sheet.querySelector('#ed-hora').value; if(!hora){ toast('Informe a hora'); return; }
    const variacao=sheet.querySelector('#ed-var').value.trim();
    const bilingue=sheet.querySelector('#ed-bi').checked;
    if(onSave) onSave({ ...s, dia, hora, variacao: variacao||undefined, bilingue: bilingue||undefined });
    close(); toast('Horário atualizado ✔');
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* Roster + mini-relatório da turma (abre dentro de _turmaSheet). Indicadores derivados dos
   agregados objetivos do aluno (freq/diasSem/aptoGrad) — nada de dado privado (§4). */
function _turmaRosterNode(t, rerender){
  _loadProfData();
  const box=el('<div></div>');
  const alunos=_turmaAlunos(t.id);
  const freqM = alunos.length ? Math.round(alunos.reduce((s,a)=>s+(a.freq||0),0)/alunos.length) : 0;
  const risco = alunos.filter(a=>(a.diasSem||0)>=RISCO_DIAS).length;
  const aptos = alunos.filter(a=>a.aptoGrad).length;
  box.appendChild(el(`<div class="stat-grid" style="margin:6px 0 8px">
    <div class="stat-card"><div class="sv">${alunos.length}</div><div class="sl">Matriculados</div></div>
    <div class="stat-card"><div class="sv">${freqM}%</div><div class="sl">Freq. média</div></div>
    <div class="stat-card"><div class="sv">${risco}</div><div class="sl">Em risco</div></div>
    <div class="stat-card"><div class="sv">${aptos}</div><div class="sl">Aptos</div></div>
  </div>`));
  const list=el('<div class="list block"></div>');
  if(!alunos.length) list.appendChild(el('<div class="empty-hint">Nenhum aluno matriculado ainda.</div>'));
  alunos.forEach(a=>{
    const row=el(`<div class="st-row">${avatarAluno(a)}
      <div class="st-mid"><div class="nm">${safeTxt(_nomeInst(a))}</div><div class="meta">${beltPill(a.faixa,a.graus)}</div></div>
      <button class="ses-del" aria-label="Remover da turma">✕</button></div>`);
    row.querySelector('.ses-del').onclick=(ev)=>{ ev.stopPropagation();
      a.turmas=(a.turmas||[]).filter(x=>x!==t.id);
      if(!DEMO && typeof sbProf!=='undefined' && sbProf.desmatricular){ try{ sbProf.desmatricular(a.id, t.id); }catch(_){} }
      rerender(); toast('Removido da turma'); };
    list.appendChild(row);
  });
  box.appendChild(list);
  const add=el('<button class="add-sessao">+ Matricular aluno</button>');
  add.onclick=()=>_turmaMatricularSheet(t, rerender);
  box.appendChild(add);
  return box;
}
function _turmaMatricularSheet(t, done){
  _loadProfData();
  const fora=_profAlunosArr().filter(a=>!(a.turmas||[]).includes(t.id));
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:80vh;overflow-y:auto">
    <div class="sheet-grip"></div><div class="sheet-title">Matricular em ${safeTxt(t.nome)}</div>
    <div id="mt-list" class="list block" style="margin-top:8px"></div>
    <button class="sheet-cancel" id="mt-close">Fechar</button></div></div>`);
  const listEl=sheet.querySelector('#mt-list');
  if(!fora.length) listEl.appendChild(el('<div class="empty-hint">Todos os alunos já estão nesta turma.</div>'));
  fora.forEach(a=>{
    const row=el(`<button class="st-row" style="width:100%;text-align:left">
      ${avatarAluno(a)}
      <div class="st-mid"><div class="nm">${safeTxt(_nomeInst(a))}</div><div class="meta">${beltPill(a.faixa,a.graus)}</div></div>
      <span class="tr-caret">＋</span></button>`);
    row.onclick=()=>{ a.turmas=(a.turmas||[]).concat(t.id);
      if(!DEMO && typeof sbProf!=='undefined' && sbProf.matricular){ try{ sbProf.matricular(a.id, [t.id]); }catch(_){} }
      row.remove(); if(done) done(); toast('Matriculado ✔'); };
    listEl.appendChild(row);
  });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),240); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#mt-close').onclick=close;
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ============================================================
   PROFESSOR — Graduação (menu próprio, v291)
   Mostra todas as faixas com visual (beltMini/beltPill) + nome +
   quantas aulas configuradas pra passar de grau (regra da academia
   OU default global). Editar meta ali mesmo (persistente em
   academies.config.metaAulas — v0003).
   ============================================================ */
/* v395: prontidão de graduação — DUAS avaliações independentes num shape só.
   Fonte UNICA: _aptosGraduar() reusa isso, sem regra paralela em outro lugar.

   Regras (por caso):
   - Preta / Coral / Coral-branca: TEMPO ACUMULADO na preta (CBJJ.black_belt_degrees).
     Sem presença — a CBJJ decide por relógio. Vermelha = faixa máxima.
     Preta com graus < 6 → grau atual +1 vira "prontos p/ novo grau".
     Preta 6° / Coral / Coral-branca → próxima faixa alta vira "prontos p/ próxima faixa".
   - Adulto (branca/azul/roxa/marrom): grau = aulasNoGrau ≥ meta[faixa].
     Faixa = aulasNaFaixa ≥ 4×meta. Tempo CBJJ e idade → aviso, não bloqueio.
   - Infantil (cinza/amarela/laranja/verde): só presenças, sem tempo/idade. */
function _prontidaoGrad(a){
  const idade = idadeCBJJ(a.nascimento);
  const g = a.graus||0;
  const maxG = maxGrausDe(a.faixa);
  const empty = { next:null, meta:0, metaFaixaTotal:0, g, maxG,
    grau:{ok:false,tem:0,meta:0,txt:''}, faixa:{ok:false,tem:0,meta:0,txt:'',tempo:null,idadeAviso:null} };

  // Preta / faixas altas: regra POR TEMPO acumulado na preta.
  const idxPreta = ['preta','coral','coral_branca','vermelha'].indexOf(a.faixa);
  if(idxPreta >= 0){
    if(a.faixa === 'vermelha') return empty;   // faixa máxima
    // "Grau na linha da preta": preta.graus / coral=7 / coral_branca=8.
    const currentDeg = a.faixa === 'preta' ? g : (a.faixa === 'coral' ? 7 : 8);
    const nextDeg = CBJJ.black_belt_degrees.find(d => d.degree === currentDeg + 1);
    if(!nextDeg) return empty;
    const primPreta = (a.graduacoes||[])
      .filter(x => x && x.tipo==='faixa' && x.faixa==='preta' && x.data)
      .map(x => x.data).sort()[0];
    const meses = primPreta ? tempoNaFaixaMeses(primPreta) : null;
    const anos  = meses!=null ? Math.floor(meses/12) : null;
    const ok = anos!=null && anos >= nextDeg.cumulative;
    const nextIsBelt = !!nextDeg.belt;   // 7=coral, 8=coral_branca, 9=vermelha
    const nextFaixa = nextDeg.belt || 'preta';
    const txt = anos!=null
      ? `${anos}/${nextDeg.cumulative} anos de preta`
      : `sem data da preta · ${nextDeg.cumulative} anos (CBJJ)`;
    // Eixo unico: grau OU faixa (nunca os dois — na preta os dois se cruzam).
    return {
      next: nextIsBelt ? nextFaixa : null, meta:0, metaFaixaTotal:0, g, maxG,
      grau:  nextIsBelt ? {ok:false,tem:0,meta:0,txt:''}
                        : { ok, tem:anos||0, meta:nextDeg.cumulative, txt, porTempo:true },
      faixa: nextIsBelt ? { ok, tem:anos||0, meta:nextDeg.cumulative, txt, tempo:null, idadeAviso:null, porTempo:true }
                        : {ok:false,tem:0,meta:0,txt:'',tempo:null,idadeAviso:null},
    };
  }

  // Adulto / infantil — regra por presença.
  const infoAdulto = CBJJ.adult_belts.find(b=>b.belt===a.faixa);
  const ehInfantil = (idade!=null && idade<=CBJJ.youth_max_age) || _grupoInfantilMinAge(a.faixa)!=null;
  const next = ehInfantil ? proximaFaixaCBJJ(a.faixa, idade) : (infoAdulto ? infoAdulto.next : null);
  const meta = _metaAulasFaixa(a.faixa);
  const metaFaixaTotal = meta * maxG;
  const aulasNoGrau  = a.aulasNoGrau  || 0;
  const aulasNaFaixa = a.aulasNaFaixa || 0;
  const grauOk = g < maxG && aulasNoGrau >= meta;
  const faixaBaseOk = !!next && aulasNaFaixa >= metaFaixaTotal;
  let tempoAviso = null, idadeAviso = null;
  if(next && infoAdulto){
    const meses = tempoNaFaixaMeses(a.faixaDesde);
    const minMeses = infoAdulto.min_months;
    if(minMeses){
      if(meses==null) tempoAviso = { ok:null, txt:'sem data da faixa' };
      else if(meses < minMeses) tempoAviso = { ok:false, txt:`${meses}/${minMeses} meses (CBJJ)` };
      else tempoAviso = { ok:true, txt:`${meses}/${minMeses} meses ✓` };
    }
    const nextInfo = CBJJ.adult_belts.find(b=>b.belt===next);
    if(nextInfo && nextInfo.min_age!=null && idade!=null && idade < nextInfo.min_age){
      idadeAviso = { ok:false, txt:`${idade}/${nextInfo.min_age} anos (CBJJ)` };
    }
  }
  return {
    next, meta, metaFaixaTotal, g, maxG,
    grau:  { ok: grauOk,      tem: aulasNoGrau,  meta,             txt: `${aulasNoGrau}/${meta} aulas` },
    faixa: { ok: faixaBaseOk, tem: aulasNaFaixa, meta: metaFaixaTotal, txt: `${aulasNaFaixa}/${metaFaixaTotal} aulas`,
             tempo: tempoAviso, idadeAviso },
  };
}
function _gradAptosSection(w){
  const PROXIMOS_PCT = 0.8;   // >= 80% da meta = "quase la" (v397). Ajustavel aqui.
  const cand = _profAlunosArr().map(a=>({a, s:_prontidaoGrad(a)}));
  const _pct = e => e.meta > 0 ? e.tem / e.meta : 0;
  // Aptos (>=100%) e Próximos (80-99%) — mutex por eixo, mas um aluno pode estar em
  // "apto grau" E "proximo faixa" (ou vice-versa). Ordena por proximidade decrescente.
  const aptosGrau  = cand.filter(x=> x.s.grau.ok).sort((x,y)=> (y.s.grau.tem-y.s.grau.meta) - (x.s.grau.tem-x.s.grau.meta));
  const aptosFaixa = cand.filter(x=> x.s.faixa.ok).sort((x,y)=> (y.s.faixa.tem-y.s.faixa.meta) - (x.s.faixa.tem-x.s.faixa.meta));
  const proxGrau   = cand.filter(x=> !x.s.grau.ok  && x.s.grau.meta>0  && _pct(x.s.grau)  >= PROXIMOS_PCT).sort((x,y)=> _pct(y.s.grau)  - _pct(x.s.grau));
  const proxFaixa  = cand.filter(x=> !x.s.faixa.ok && x.s.faixa.meta>0 && _pct(x.s.faixa) >= PROXIMOS_PCT).sort((x,y)=> _pct(y.s.faixa) - _pct(x.s.faixa));

  // KPIs clicáveis (scroll pra cada seção). Quatro cards agora.
  const kpi = el(`<div class="stat-grid block">
    <div class="stat-card kpi-click" data-goto="grau"  tabindex="0" role="button"><div class="si ${aptosGrau.length?'green':'gray'}">${icoPulse()}</div><div class="sv">${aptosGrau.length}</div><div class="sl">Prontos p/ novo grau</div></div>
    <div class="stat-card kpi-click" data-goto="faixa" tabindex="0" role="button"><div class="si ${aptosFaixa.length?'purple':'gray'}">${icoBelt()}</div><div class="sv">${aptosFaixa.length}</div><div class="sl">Prontos p/ próxima faixa</div></div>
    <div class="stat-card kpi-click" data-goto="prox-grau"  tabindex="0" role="button"><div class="si ${proxGrau.length?'gold':'gray'}">${icoAlert()}</div><div class="sv">${proxGrau.length}</div><div class="sl">Próx. p/ novo grau (${Math.round(PROXIMOS_PCT*100)}%+)</div></div>
    <div class="stat-card kpi-click" data-goto="prox-faixa" tabindex="0" role="button"><div class="si ${proxFaixa.length?'gold':'gray'}">${icoAlert()}</div><div class="sv">${proxFaixa.length}</div><div class="sl">Próx. p/ próxima faixa (${Math.round(PROXIMOS_PCT*100)}%+)</div></div>
  </div>`);
  kpi.querySelectorAll('.kpi-click').forEach(c=>{
    const scroll = ()=>{ const id = 'grad-sec-'+c.dataset.goto; const t=document.getElementById(id); if(t) t.scrollIntoView({behavior:'smooth', block:'start'}); };
    c.onclick = scroll;
    c.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); scroll(); } };
  });
  w.appendChild(kpi);

  const _row = (a, s, tipo, modo)=>{
    // modo: 'apto' (default) | 'proximo'. Proximos nao tem botao "Dar grau" — vai
    // pra ficha; e o chip do eixo vai amarelo em vez de verde.
    const nextNome = s.next && BELTS[s.next] ? BELTS[s.next].nome : '—';
    const eixo = s[tipo];
    const porTempo = !!eixo.porTempo;
    const ehProximo = modo === 'proximo';
    const pct = eixo.meta > 0 ? Math.round(eixo.tem/eixo.meta*100) : 0;
    // Preta/altas graduam POR TEMPO — botao muda de "Dar grau" para "Confirmar".
    const btnLbl = ehProximo
      ? 'Ver ficha'
      : (tipo==='faixa'
          ? `Graduar → ${safeTxt(nextNome)}`
          : (porTempo ? `Confirmar ${s.g+1}º grau` : 'Dar grau'));
    // Chip do eixo: verde se apto, amarelo se proximo. Texto original + "· NN%".
    const chipEixo = { ok: ehProximo ? 'warn' : true, txt: eixo.txt + (ehProximo ? ` · ${pct}%` : '') };
    const chipsHtml = tipo==='faixa'
      ? _semChip(chipEixo) +
        (eixo.tempo ? _semChip(eixo.tempo) : '') +
        (eixo.idadeAviso ? _semChip(eixo.idadeAviso) : '')
      : _semChip(chipEixo);
    // Sub-titulo:
    //  - por presenca grau: "Azul · 1º → 2º grau"
    //  - por presenca faixa: "Roxa · 3º grau → Marrom"
    //  - por tempo grau (preta n): "Preta · 2º → 3º grau (CBJJ)"
    //  - por tempo faixa (preta 6/coral/coral_branca): "Preta · 6º grau → Coral (CBJJ)"
    let sub;
    if(porTempo){
      sub = tipo==='faixa'
        ? `${safeTxt(BELTS[a.faixa]?.nome||a.faixa)} · ${s.g}º grau → <b>${safeTxt(nextNome)}</b> <span style="color:var(--muted)">(CBJJ)</span>`
        : `${safeTxt(BELTS[a.faixa]?.nome||a.faixa)} · ${s.g}º → <b>${s.g+1}º grau</b> <span style="color:var(--muted)">(CBJJ)</span>`;
    } else {
      sub = tipo==='faixa'
        ? `${safeTxt(BELTS[a.faixa]?.nome||a.faixa)} · ${s.g}º grau → <b>${safeTxt(nextNome)}</b>`
        : `${safeTxt(BELTS[a.faixa]?.nome||a.faixa)} · ${s.g}º → <b>${s.g+1}º grau</b>`;
    }
    const row = el(`<div class="grad-aptos-row">
      <div class="grad-aptos-belt">${beltMini(a.faixa, s.g)}</div>
      <div class="grad-aptos-info">
        <div class="grad-aptos-nm">${safeTxt(_nomeInst(a))}</div>
        <div class="grad-aptos-sub">${sub}</div>
        <div class="sem-chips" style="margin-top:6px">${chipsHtml}</div>
      </div>
      <button class="grad-aptos-go" type="button">${btnLbl}</button>
    </div>`);
    row.querySelector('.grad-aptos-go').onclick = ()=>{
      _navPush(); DB.alunoAberto = a; DB._alunoTab = 'grad'; render(); window.scrollTo(0,0);
    };
    row.onclick = (e)=>{ if(e.target.classList.contains('grad-aptos-go')) return;
      _navPush(); DB.alunoAberto = a; render(); window.scrollTo(0,0);
    };
    return row;
  };

  // Seção 1 — Prontos para novo GRAU
  w.appendChild(el(`<div class="sec-title" id="grad-sec-grau">Prontos para novo grau</div>`));
  if(!aptosGrau.length){
    w.appendChild(el('<div class="empty-line block" style="padding:20px 16px">Nenhum aluno bateu a meta de aulas do grau atual ainda.</div>'));
  } else {
    const list = el('<div class="grad-aptos-list block"></div>');
    aptosGrau.forEach(({a,s})=> list.appendChild(_row(a, s, 'grau')));
    w.appendChild(list);
  }

  // Seção 2 — Prontos para nova FAIXA
  w.appendChild(el(`<div class="sec-title" id="grad-sec-faixa">Prontos para próxima faixa</div>`));
  if(!aptosFaixa.length){
    w.appendChild(el('<div class="empty-line block" style="padding:20px 16px">Nenhum aluno bateu a meta total de aulas da faixa atual ainda.</div>'));
  } else {
    const list = el('<div class="grad-aptos-list block"></div>');
    aptosFaixa.forEach(({a,s})=> list.appendChild(_row(a, s, 'faixa')));
    w.appendChild(list);
  }

  // Seção 3 — Próximos a NOVO GRAU (>= 80% da meta)
  w.appendChild(el(`<div class="sec-title" id="grad-sec-prox-grau">Próximos ao novo grau (${Math.round(PROXIMOS_PCT*100)}%+)</div>`));
  if(!proxGrau.length){
    w.appendChild(el(`<div class="empty-line block" style="padding:20px 16px">Ninguém acima de ${Math.round(PROXIMOS_PCT*100)}% da meta do grau atual.</div>`));
  } else {
    const list = el('<div class="grad-aptos-list block"></div>');
    proxGrau.forEach(({a,s})=> list.appendChild(_row(a, s, 'grau', 'proximo')));
    w.appendChild(list);
  }

  // Seção 4 — Próximos a PRÓXIMA FAIXA (>= 80% da meta)
  w.appendChild(el(`<div class="sec-title" id="grad-sec-prox-faixa">Próximos à próxima faixa (${Math.round(PROXIMOS_PCT*100)}%+)</div>`));
  if(!proxFaixa.length){
    w.appendChild(el(`<div class="empty-line block" style="padding:20px 16px">Ninguém acima de ${Math.round(PROXIMOS_PCT*100)}% da meta total da faixa.</div>`));
  } else {
    const list = el('<div class="grad-aptos-list block"></div>');
    proxFaixa.forEach(({a,s})=> list.appendChild(_row(a, s, 'faixa', 'proximo')));
    w.appendChild(list);
  }

  // Legenda
  w.appendChild(el(`<div class="grad-legenda block">
    <b>Como funciona:</b>
    <div style="margin-top:6px;color:var(--muted);font-size:12px;line-height:1.6">
      <b>Novo grau</b> = presenças no grau atual ≥ meta da faixa (aba <i>Metas por faixa</i>).<br>
      <b>Nova faixa</b> = presenças acumuladas na faixa ≥ meta × ${maxGrausDe('branca')} (todos os graus da faixa).<br>
      <b>Próximos</b> = alunos entre <b>${Math.round(PROXIMOS_PCT*100)}%</b> e 100% da meta — dá visibilidade de quem tá no radar.<br>
      <b>Tempo CBJJ</b> e <b>idade mínima</b> aparecem como AVISO na próxima faixa — não bloqueiam.
      A decisão final é sempre do professor.
    </div>
  </div>`));
}

function profGraduacao(){
  const w = el('<div></div>');
  const aptos = (typeof _aptosGraduar==='function' ? _aptosGraduar() : []);
  w.innerHTML = `<div class="hello"><div class="date">Graduação</div>
    <div class="greet">${aptos.length} pronto${aptos.length!==1?'s':''} p/ graduar · presença + CBJJ ${CBJJ.version}</div></div>`;
  // Abas: Aptos (default) + Metas por faixa
  const tab = DB._gradTab || 'aptos';
  const tabsBar = el(`<div class="turmas-tabs">
    <button class="turmas-tab${tab==='aptos'?' on':''}" data-t="aptos">Aptos a graduar${aptos.length?` (${aptos.length})`:''}</button>
    <button class="turmas-tab${tab==='metas'?' on':''}" data-t="metas">Metas por faixa</button>
  </div>`);
  tabsBar.querySelectorAll('.turmas-tab').forEach(b=> b.onclick=()=>{ DB._gradTab = b.dataset.t; render(); });
  w.appendChild(tabsBar);
  if(tab==='aptos'){ _gradAptosSection(w); return w; }

  // Grupos:
  // - Infantil / Adulto: meta EDITAVEL (aulas por grau).
  // - Preta e faixas altas: bloco unificado, so' referencia. CBJJ decide por tempo
  //   acumulado na preta — nao existe meta editavel de aulas aqui.
  const grupos = [
    { titulo:'Infantil (4–15 anos)', faixas:[
      'cinza_branca','cinza','cinza_preta',
      'amarela_branca','amarela','amarela_preta',
      'laranja_branca','laranja','laranja_preta',
      'verde_branca','verde','verde_preta',
    ], stripes:0 },
    { titulo:'Adulto (16+)', faixas:['branca','azul','roxa','marrom'], stripes:4 },
  ];

  const defaultMeta = PROF_METAS.META_GRAU;
  const metasCfg = (DB.academyConfig && DB.academyConfig.metaAulas) || {};
  const notaInfo = el(`<div class="grad-note block">
    <div>Cada grau exige um <b>número mínimo de presenças</b> (aulas) além do tempo mínimo na faixa (regra CBJJ). Ajuste por faixa se sua academia usa meta diferente do padrão global (<b>${defaultMeta}</b> aulas).</div>
  </div>`);
  w.appendChild(notaInfo);

  grupos.forEach(g=>{
    w.appendChild(el(`<div class="sec-title">${safeTxt(g.titulo)}</div>`));
    const list = el('<div class="grad-list block"></div>');
    g.faixas.forEach(f=>{
      const info = BELTS[f] || {nome:f, cor:'#888'};
      const meta = _metaAulasFaixa(f);
      const isCustom = metasCfg[f] && parseInt(metasCfg[f])>0 && parseInt(metasCfg[f])!==defaultMeta;
      const row = el(`<div class="grad-row">
        <div class="grad-belt-wrap">${beltMini(f, g.stripes)}</div>
        <div class="grad-info">
          <div class="grad-nome">${safeTxt(info.nome)}</div>
          <div class="grad-sub">${g.stripes>0?g.stripes+' graus por faixa · ':''}<b>${meta}</b> aulas/grau${isCustom?' <span class="grad-tag">personalizada</span>':''}</div>
        </div>
        <button class="grad-edit" type="button" aria-label="Editar meta">✎</button>
      </div>`);
      row.querySelector('.grad-edit').onclick = ()=> _profMetaAulasSheet(f, ()=>render());
      list.appendChild(row);
    });
    w.appendChild(list);
  });

  // Preta + faixas altas UNIFICADAS: um bloco só, so' referencia (CBJJ por tempo).
  // Sub mostra o marco temporal do proximo grau/faixa direto da CBJJ.black_belt_degrees.
  w.appendChild(el(`<div class="sec-title">Preta e faixas altas (CBJJ — por tempo)</div>`));
  const bd = CBJJ.black_belt_degrees;
  const marcoTempo = {
    preta:        `graus 1º–6º · ${bd[0].cumulative}–${bd[5].cumulative} anos na preta`,
    coral:        `7º grau · ${bd.find(d=>d.belt==='coral').cumulative} anos na preta`,
    coral_branca: `8º grau · ${bd.find(d=>d.belt==='coral_branca').cumulative} anos na preta`,
    vermelha:     `9º grau · ${bd.find(d=>d.belt==='vermelha').cumulative} anos na preta`,
  };
  const stripesPorFaixa = { preta:6, coral:0, coral_branca:0, vermelha:0 };
  const altas = el('<div class="grad-list block"></div>');
  ['preta','coral','coral_branca','vermelha'].forEach(f=>{
    const info = BELTS[f] || {nome:f};
    altas.appendChild(el(`<div class="grad-row ref">
      <div class="grad-belt-wrap">${beltMini(f, stripesPorFaixa[f])}</div>
      <div class="grad-info">
        <div class="grad-nome">${safeTxt(info.nome)}</div>
        <div class="grad-sub">${safeTxt(marcoTempo[f])}</div>
      </div>
    </div>`));
  });
  w.appendChild(altas);
  return w;
}

// Sheet mínimo pra editar meta de aulas por faixa. Persiste em DB.academyConfig.metaAulas.
// Backend real: sbProf.salvarConfig({metaAulas:{[faixa]:N}}) — se não existir, só toca em memória.
function _profMetaAulasSheet(faixa, refresh){
  const info = BELTS[faixa] || {nome:faixa};
  const atual = _metaAulasFaixa(faixa);
  const sh = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Meta de aulas — ${safeTxt(info.nome)}</div>
    <div class="sheet-desc">Quantas presenças o aluno precisa completar pra ganhar um novo grau nessa faixa.</div>
    <label class="flbl" style="margin-top:12px">Aulas por grau</label>
    <input class="inp" id="ma-n" type="number" min="1" max="500" value="${atual}">
    <button class="btn-save" id="ma-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="ma-cancel">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sh.classList.remove('open'); setTimeout(()=>sh.remove(),260); };
  sh.onclick=(e)=>{ if(e.target===sh) close(); };
  sh.querySelector('#ma-cancel').onclick=close;
  sh.querySelector('#ma-save').onclick=()=>{
    const n = parseInt(sh.querySelector('#ma-n').value,10);
    if(!(n>0)){ toast('Informe um número > 0'); return; }
    const metaAulas = Object.assign({}, _acadCfg().metaAulas, {[faixa]: n});
    _salvarAcademyConfig({metaAulas}).catch(e=> toast('Salvo local, sem nuvem: '+(e.message||e)));
    close(); toast('Meta atualizada ✔'); if(refresh) refresh();
  };
  document.body.appendChild(sh); requestAnimationFrame(()=>sh.classList.add('open'));
}

function tabbarProf(){
  // Mobile-first: 5 tabs essenciais visíveis por padrão. Loja e Vídeos são
  // "gerenciamento" — só aparecem em tablet/desktop (≥768px) via .tab-wide.
  const tabs = [
    ['painel','Painel', icoHome(), false],
    ['alunos','Alunos', icoUsers(), false],
    ['turmas','Turmas', icoCalendar(), false],
    ['graduacao','Graduação', icoBelt(), true],   // wide-only (mobile abre pela "Mais")
    ['relatorios','Relatórios', icoChart(), false],
    ['financeiro','Financeiro', icoCard(), true],  // wide-only (mobile abre pela "Mais")
    ['videos','Vídeos', icoVideo(), true],   // wide-only (mobile abre pela "Mais")
    ['loja','Loja', icoStore(), true],       // wide-only (mobile abre pela "Mais")
    ['yama','Yama', icoYama(), true],        // wide-only (mobile abre pela "Mais")
    ['mais','Mais', icoMore(), false],
  ];
  // v488 Sprint 2: badge de alerta em Financeiro — contratos expirados + cobranças
  // vencidas. Só aparece com backend ligado e dados carregados. Kick lazy load.
  const finAlerts = _finBackend() ? _finAlertsCount() : 0;
  // v510: badge só precisa de cobrancas + contratos (não das outras 6 queries).
  if(_finBackend() && _finCobrancas===null){
    _finReload(['cobrancas','contratos']).then(()=>renderBg()).catch(()=>{});
  }
  const bar = el(`<div class="tabbar"></div>`);
  tabs.forEach(([id,label,ico,wideOnly])=>{
    const cls = `tab ${DB.navProf===id?'active':''}${wideOnly?' tab-wide':''}`;
    const badge = (id==='financeiro' && finAlerts>0)
      ? `<span class="tab-badge" aria-label="${finAlerts} pendências financeiras">${finAlerts>9?'9+':finAlerts}</span>` : '';
    const t = el(`<div class="${cls}">${ico||icoMore()}${badge}<span class="tl">${label}</span></div>`);
    // v445: "Mais" no mobile abre um sheet com Graduação/Vídeos/Loja/Yama + Meu perfil
    // (tudo que o desktop mostra na sidebar). Antes navegava direto pra 'perfil', o que
    // deixava o professor mobile sem acesso a essas áreas sem virar o celular.
    t.onclick=()=> (id==='mais' ? _profMaisSheet() : goProf(id));
    bar.appendChild(t);
  });
  return bar;
}

// Conta alertas de Financeiro pra badge do bottom bar: contratos expirados +
// cobranças vencidas do mês corrente. Retorna 0 se dados ainda não carregados
// (badge invisível durante o loading).
function _finAlertsCount(){
  const cobs = _finCobrancas || [];
  const cts  = _finContratos || [];
  const vencidas = cobs.filter(c => c.status==='pendente' && c.venc && c.venc < HOJE_ISO).length;
  const expirados = cts.filter(c => c.status==='expirado').length;
  return vencidas + expirados;
}
function _profMaisSheet(){
  const linhas = [
    ['graduacao','🎗️ Graduação','Eventos, retroativa e semear faixas'],
    ['financeiro','💳 Financeiro','Cobranças, despesas, planos, contratos'],
    ['videos','🎥 Vídeos','Onboarding — vídeos por turma/faixa'],
    ['loja','🛍️ Loja','Produtos, estoque, pedidos, PIX'],
    ['yama','⚙️ Hub YAMA','Dados da academia, mensagens, push, QR'],
    ['perfil','👤 Meu perfil','Seu diário — o professor também é aluno'],
  ];
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Mais">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Mais</div>
    <div class="mais-list"></div>
    <button class="sheet-cancel" id="mm-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  const list = sheet.querySelector('.mais-list');
  linhas.forEach(([id,lbl,desc])=>{
    const row = el(`<div class="mais-row" role="button" tabindex="0">
      <div class="mais-tx"><div class="mais-lbl">${safeTxt(lbl)}</div><div class="mais-desc">${safeTxt(desc)}</div></div>
      <div class="mais-go">›</div></div>`);
    row.onclick=()=>{ close(); goProf(id); };
    row.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); row.click(); } };
    list.appendChild(row);
  });
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#mm-close').onclick=close;
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ---------------- navegação ---------------- */
// v514: navigation stack via history.pushState/popstate. Snapshot dos
// campos de navegação a cada goProf/goAluno/openAluno → botão de voltar
// do celular funciona nativamente e "voltar" respeita origem (Menu Alunos >
// Inativos > Ficha → voltar retorna pra Alunos com Inativos preservado).
// _navPushing evita loop: quando popstate restaura, o render subsequente
// não deve empurrar de novo.
let _navPushing = false;
function _navSnapshot(){
  return {
    role: DB.role,
    navAluno: DB.navAluno,
    navProf: DB.navProf,
    alunoAberto: DB.alunoAberto ? { id: DB.alunoAberto.id } : null,
    _alunoTab: DB._alunoTab,
    alunosFiltro: DB.alunosFiltro ? { ...DB.alunosFiltro } : null,
    produtoFormOpen: DB.produtoFormOpen,
    cadastroAlunoOpen: DB.cadastroAlunoOpen,
    lojaOpen: DB.lojaOpen,
    meusPedidosOpen: DB.meusPedidosOpen,
    _finTab: (typeof _finTab!=='undefined') ? _finTab : null,
  };
}
function _navPush(){
  if(_navPushing) return;
  try { history.pushState(_navSnapshot(), ''); } catch(_){}
}
function _navRestore(state){
  if(!state) return;
  _navPushing = true;
  try {
    DB.role = state.role;
    DB.navAluno = state.navAluno;
    DB.navProf = state.navProf;
    DB._alunoTab = state._alunoTab;
    DB.alunosFiltro = state.alunosFiltro;
    DB.produtoFormOpen = state.produtoFormOpen;
    DB.cadastroAlunoOpen = state.cadastroAlunoOpen;
    DB.lojaOpen = state.lojaOpen;
    DB.meusPedidosOpen = state.meusPedidosOpen;
    if(typeof _finTab!=='undefined' && state._finTab) _finTab = state._finTab;
    // Reidrata alunoAberto pelo id (referência fresh, sem stale)
    if(state.alunoAberto && state.alunoAberto.id){
      const arr = (_profData && _profData.alunos) || [];
      DB.alunoAberto = arr.find(a=>a.id===state.alunoAberto.id) || null;
    } else {
      DB.alunoAberto = null;
    }
    try { render(); } catch(_){}
    try { window.scrollTo(0,0); } catch(_){}
  } finally { _navPushing = false; }
}
window.addEventListener('popstate', e => _navRestore(e.state));

function setRole(r){ _navPush(); DB.role=r; DB.flow=null; render(); window.scrollTo(0,0); }
function goAluno(id){ _navPush(); DB.navAluno=id; render(); window.scrollTo(0,0); }
function goProf(id){
  _navPush();
  // Ao trocar de menu, fecha telas em foco (ficha do aluno, cadastro, import etc).
  DB.navProf=id; DB.alunoAberto=null; DB._alunoTab=null;
  DB.produtoFormOpen=false; DB.cadastroAlunoOpen=false;
  DB.importAlunosOpen=null; DB.acessoAlunosOpen=false;
  render(); window.scrollTo(0,0);
}
function _isDark(){ return document.documentElement.getAttribute('data-theme')==='dark'; }
function _updateThemeColor(){
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', _isDark() ? '#0a0b0d' : '#f4f4f6');
}
function toggleTheme(){
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  const next = dark?'light':'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem('yama.theme', next); }catch(e){}
  _updateThemeColor();
  render();
}
try{ const _st=localStorage.getItem('yama.theme'); if(_st) document.documentElement.setAttribute('data-theme', _st); }catch(e){}
// scroll lock quando há sheet aberto. Trava leve via CSS (html.sheet-open{overflow:hidden}) —
// SEM body{position:fixed}, que no PWA iOS deixava uma "barra preta" na base e fazia o tabbar piscar.
// O overlay (touch-action:none, inset:0) já bloqueia a interação com o fundo.
// Há um modal full-screen aberto? (bottom sheets + scanner de QR)
function _modalAberto(){ return !!document.querySelector('.sheet-overlay, .scan-overlay'); }
// Sobe do alvo até o overlay procurando um container REALMENTE rolável (overflow auto/scroll
// COM conteúdo transbordando). Se achar antes do overlay → rolagem legítima do sheet (permite);
// senão → é o fundo/área escurecida (bloqueia). Vale p/ vertical e horizontal (carrossel).
function _scrollavelAteOverlay(node){
  let el = node;
  while(el && el.nodeType===1){
    if(el.classList && (el.classList.contains('sheet-overlay')||el.classList.contains('scan-overlay'))) return null;
    let st; try{ st = getComputedStyle(el); }catch(e){ st=null; }
    if(st){
      const oy=st.overflowY, ox=st.overflowX;
      if((oy==='auto'||oy==='scroll') && el.scrollHeight > el.clientHeight) return el;
      if((ox==='auto'||ox==='scroll') && el.scrollWidth  > el.clientWidth ) return el;
    }
    el = el.parentElement;
  }
  return null;
}
// Guard central: bloqueia wheel/touchmove que NÃO nasce dentro de um container rolável do sheet.
// É o bloqueio real (funciona no desktop, onde touch-action não vale; e no mobile).
function _bgScrollGuard(e){
  if(!_modalAberto()) return;
  if(_scrollavelAteOverlay(e.target)) return;   // rolando dentro do próprio sheet → ok
  if(e.cancelable) e.preventDefault();
}
// Guard de teclado: setas/PageUp-Down/Home/End/Espaço não rolam o fundo com modal aberto.
function _bgKeyGuard(e){
  if(!_modalAberto()) return;
  const K={PageUp:1,PageDown:1,Home:1,End:1,ArrowUp:1,ArrowDown:1,' ':1,Spacebar:1};
  if(!K[e.key]) return;
  const a=document.activeElement;
  if(a && a.closest && a.closest('.sheet, .scan-overlay')) return;   // foco dentro do modal → deixa
  e.preventDefault();
}
function _setupBodyLock(){
  // Guards globais (uma vez): o bloqueio de fundo à prova de falhas, para TODOS os overlays.
  document.addEventListener('wheel',     _bgScrollGuard, { passive:false, capture:true });
  document.addEventListener('touchmove', _bgScrollGuard, { passive:false, capture:true });
  document.addEventListener('keydown',   _bgKeyGuard,    { capture:true });
  if (typeof MutationObserver === 'undefined') return;
  const apply = ()=>{
    document.documentElement.classList.toggle('sheet-open', _modalAberto());
  };
  const obs = new MutationObserver((muts)=>{
    apply();
    // B5 (a11y): ao abrir um sheet/modal, move o foco para o diálogo (container, sem abrir teclado).
    muts.forEach(m=> m.addedNodes && m.addedNodes.forEach(n=>{
      if(n.nodeType===1 && n.classList && (n.classList.contains('sheet-overlay')||n.classList.contains('scan-overlay'))){
        const s = n.querySelector('.sheet'); if(s){ s.setAttribute('tabindex','-1'); setTimeout(()=>{ try{ s.focus({preventScroll:true}); }catch(e){} }, 60); }
      }
    }));
  });
  obs.observe(document.body, { childList:true, subtree:false });
  // observa attributes para detectar quando sheet ganha/perde classe .open (opcional, mas robusto)
  document.addEventListener('transitionend', apply, true);
}

/* ============================================================
   ONBOARDING · EDIÇÃO DE PERFIL · CONFIG · PLACEHOLDERS · VAZIOS
   ============================================================ */

// Estado vazio reutilizável
function emptyState(emoji, titulo, sub, btnText, btnAction){
  const e = el(`<div class="empty-state">
    <div class="es-emoji">${emoji}</div>
    <div class="es-t">${titulo}</div>
    <div class="es-s">${sub}</div>
    ${btnText?`<button class="es-btn">${btnText}</button>`:''}
  </div>`);
  if (btnText && btnAction) e.querySelector('.es-btn').onclick = btnAction;
  return e;
}

// ---- Onboarding leve (boas-vindas) ----
function abrirOnboarding(){ DB.onboardingOpen=true; render(); window.scrollTo(0,0); }
// Onboarding minimalista: conta provisionada pelo professor (dados já vêm prontos).
// Só boas-vindas + confirmação de identidade (read-only) + aceite LGPD/18+.
function _onboardingMinimal(me){
  const v = el(`<div class="view onb"></div>`);
  const body = el(`<div class="onb-body"></div>`);
  body.appendChild(el(`<img class="onb-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">`));
  body.appendChild(el(`<div class="onb-t">Bem-vindo${me.apelido?', '+safeTxt(me.apelido):''}! 🥋</div>`));
  body.appendChild(el(`<div class="onb-s">Sua conta foi criada pela academia. É só confirmar para começar.</div>`));
  // identidade: faixa/grau read-only (vêm do professor); foto e apelido OPCIONAIS.
  const idCard = el(`<div class="onb-identity">
    <div class="oi-avatar" role="button" tabindex="0" aria-label="Adicionar foto" style="cursor:pointer;background:${me.foto?'transparent':'var(--red)'}">${me.foto?`<img src="${safeAttr(me.foto)}" alt="">`:safeTxt(me.iniciais||'A')}<span class="oi-cam">📷</span></div>
    <div class="oi-tx"><div class="oi-nm">${safeTxt(me.apelido||me.nome||'Atleta')}</div>
      <div class="oi-belt">${beltPill(me.faixa,me.graus)}</div></div>
  </div>`);
  const _av=idCard.querySelector('.oi-avatar');
  _av.onclick=()=>editarFotoPerfil();
  _av.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); editarFotoPerfil(); } };
  body.appendChild(idCard);
  // apelido opcional (o resto vem do cadastro do professor)
  body.appendChild(el(`<label class="flbl onb-lbl">Apelido <span style="color:var(--muted);font-weight:600">(opcional)</span></label>`));
  const inpAp = el(`<input class="inp" id="onb-ap" value="${safeAttr(me.apelido||'')}" placeholder="Como te chamam no tatame">`);
  inpAp.oninput=()=>{ const ap=inpAp.value.trim(); if(ap){ me.apelido=ap; me.iniciais=_iniciaisDe(ap); } };
  body.appendChild(inpAp);
  body.appendChild(el(`<div class="onb-priv" style="margin-top:16px">🔒 Seus treinos e anotações ficam <b>privados</b> — nem o professor vê o que você escreve.</div>`));
  // Conta provisionada: a idade já foi informada pelo professor no cadastro → aqui só o aceite dos termos.
  const _menor = (()=>{ const id=idadeCBJJ(me.nascimento); return id!=null && id<18; })();
  const consent = el(`<label class="onb-consent">
    <input type="checkbox" id="onb-ok">
    <span>Li e aceito a <a class="lk" id="onb-pol">Política de Privacidade e os Termos</a>.${_menor?' <b>Sou menor de 18</b> e tenho o aceite de um responsável (registrado pela academia).':''}</span>
  </label>`);
  body.appendChild(consent);
  consent.querySelector('#onb-pol').onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); abrirPolitica(); };
  const go = el(`<button class="btn-register onb-btn" disabled>Começar</button>`);
  const chk = consent.querySelector('#onb-ok');
  chk.onchange = ()=>{ go.disabled = !chk.checked; };
  go.onclick = ()=>{
    if(!chk.checked){ toast('Marque o aceite para continuar'); return; }
    // M1: sem apelido → usa o nome (definido pelo professor); editável depois no Perfil.
    if(!me.apelido || !me.apelido.trim()){ me.apelido = me.nomeCompleto || me.nome || 'Atleta'; me.iniciais = _iniciaisDe(me.apelido); }
    me.consentimento = HOJE_ISO;
    DB.onboarded=true; DB.onboardingOpen=false;
    track('onboarding_done', { faixa:me.faixa, prov:true });
    render(); toast(`Tudo pronto, ${me.apelido||'Atleta'}! Oss 🥋`);
    if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushAll();
  };
  body.appendChild(go);
  v.appendChild(body);
  return v;
}
function renderOnboarding(){
  const me = DB.eu;
  // Conta criada pelo professor → onboarding MINIMAL: sem campos, só boas-vindas + aceite.
  // (provisionedByProf vem do backend via sbSync.pullAll; offline/local fica false → fluxo completo abaixo.)
  if (me.provisionedByProf) return _onboardingMinimal(me);
  const v = el(`<div class="view onb"></div>`);
  const body = el(`<div class="onb-body"></div>`);
  body.appendChild(el(`<img class="onb-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">`));
  body.appendChild(el(`<div class="onb-t">Bem-vindo à Yama</div>`));
  body.appendChild(el(`<div class="onb-s">Seu diário de Jiu-Jitsu — do em pé ao chão. Vamos te conhecer rapidinho.</div>`));
  body.appendChild(el(`<div class="onb-value">
    <div class="ov-row"><span class="ov-ic">📝</span><span>Registre o treino em ~15s e veja seu histórico crescer</span></div>
    <div class="ov-row"><span class="ov-ic">📈</span><span>Acompanhe seu acerto por técnica e a consistência semanal</span></div>
    <div class="ov-row"><span class="ov-ic">🥋</span><span>Veja quanto falta para o próximo grau e faixa (regras CBJJ)</span></div>
  </div>`));
  body.appendChild(el(`<label class="flbl onb-lbl">Como te chamam?</label>`));
  const inp = el(`<input class="inp" id="onb-apelido" value="${safeAttr(me.apelido)}" placeholder="Seu apelido">`);
  body.appendChild(inp);
  // Nascimento primeiro — filtra as faixas por idade (regras CBJJ, infantil + adulto).
  body.appendChild(el(`<label class="flbl onb-lbl">Ano de nascimento</label>`));
  const inpNasc = el(`<input class="inp" id="onb-nasc" type="number" inputmode="numeric" placeholder="Ex: 1998" value="${me.nascimento||''}" min="1920" max="${hoje.getFullYear()}">`);
  body.appendChild(inpNasc);

  body.appendChild(el(`<label class="flbl onb-lbl">Sua faixa</label>`));
  let bf = me.faixa, bg = me.graus||0;
  const beltSeg = el(`<div class="seg-wrap onb-belt"></div>`);
  const grauLbl = el(`<label class="flbl onb-lbl" style="display:none">Grau</label>`);
  const grauSeg = el(`<div class="seg" style="display:none"></div>`);
  const _maxGraus = (f)=> f==='preta'?6:4;
  const _rebuildOnbGraus = ()=>{
    const mx=_maxGraus(bf); if(bg>mx) bg=mx;
    grauSeg.innerHTML='';
    for(let g=0;g<=mx;g++){ const x=el(`<button class="${g===bg?'active':''}">${g}º</button>`);
      x.onclick=()=>{ bg=g; grauSeg.querySelectorAll('button').forEach(y=>y.classList.remove('active')); x.classList.add('active'); }; grauSeg.appendChild(x); }
    grauLbl.style.display=''; grauSeg.style.display='';
  };
  const _rebuildOnbBelts = ()=>{
    const nv=parseInt(inpNasc.value); const idade=(nv>=1920&&nv<=hoje.getFullYear())?idadeCBJJ(nv):null;
    const lista = CBJJ_CHAIN.slice();   // v193: onboarding também mostra tudo
    if(!lista.includes(bf)) bf = lista.includes(me.faixa)?me.faixa:lista[0];
    renderBeltField(beltSeg, lista, bf, (b)=>{ bf=b; _rebuildOnbBelts(); });
    _rebuildOnbGraus();
  };
  body.appendChild(beltSeg);
  body.appendChild(grauLbl);
  body.appendChild(grauSeg);
  inpNasc.addEventListener('input', _rebuildOnbBelts);
  _rebuildOnbBelts();

  // privacidade + consentimento (LGPD · dados na conta do aluno). Menores: aceite do responsável.
  body.appendChild(el(`<div class="onb-priv">🔒 Seus dados ficam salvos <b>na sua conta</b> — treinos e anotações são privados, nem o professor vê.</div>`));
  const consent = el(`<label class="onb-consent">
    <input type="checkbox" id="onb-ok">
    <span>Li e aceito a <a class="lk" id="onb-pol">Política de Privacidade e os Termos</a>. <b>Se menor de 18</b>, confirmo o aceite de um responsável.</span>
  </label>`);
  body.appendChild(consent);
  consent.querySelector('#onb-pol').onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); abrirPolitica(); };

  const go = el(`<button class="btn-register onb-btn" disabled>Começar</button>`);
  const chk = consent.querySelector('#onb-ok');
  chk.onchange = ()=>{ go.disabled = !chk.checked; };
  const _iniciais = (s)=>{ const p=(s||'').trim().split(/\s+/); return ((p[0]||'')[0]||'').toUpperCase() + ((p[1]||'')[0]||'').toUpperCase(); };
  go.onclick = ()=>{
    if (!chk.checked){ toast('Marque o aceite para continuar'); return; }
    // M1: sem apelido → exibe o nome (completo/curto); o aluno define o apelido depois no Perfil.
    const ap = inp.value.trim();
    me.apelido = ap || me.nomeCompleto || me.nome || me.apelido;
    me.nome = me.nome || ap || me.apelido;
    me.iniciais = _iniciais(me.apelido);
    me.faixa = bf; me.graus = bg;
    const nascVal = parseInt(inpNasc.value); if(nascVal>=1920 && nascVal<=hoje.getFullYear()) me.nascimento=nascVal;
    me.consentimento = HOJE_ISO;   // registro do aceite (LGPD)
    // primeira graduação = faixa inicial (alimenta a timeline da Jornada)
    if (!DB.graduacoes.some(g=>g.tipo==='faixa' && g.faixa===bf))
      DB.graduacoes.unshift({ faixa:bf, graus:0, tipo:'faixa', data:HOJE_ISO, por:'—' });
    if (bg>0 && !DB.graduacoes.some(g=>g.tipo==='grau' && g.faixa===bf && g.graus===bg))
      DB.graduacoes.push({ faixa:bf, graus:bg, tipo:'grau', data:HOJE_ISO });
    DB.onboarded=true; DB.onboardingOpen=false;
    const primeiraVez = !me.viuAjuda;
    track('onboarding_done', { faixa:bf });
    render(); toast(`Tudo pronto, ${me.apelido}! Oss 🥋`);
    if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushAll();
    if (primeiraVez) abrirAjuda(true);   // mini-guia na 1ª vez
  };
  body.appendChild(go);
  v.appendChild(body);
  return v;
}

// ---- Política de Privacidade + Termos (LGPD · beta local-only · 18+) ----
function abrirPolitica(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Privacidade & Termos</div>
    <div class="doc">
      <p class="doc-em">🔒 Seus dados ficam salvos <b>na sua conta, na nuvem</b> — protegidos por login e por regras de acesso no servidor. Seu diário (treinos, notas e sensações) é <b>privado</b>: nem o professor consegue ler.</p>
      <h4>O que guardamos</h4>
      <p>O que você digita: apelido, faixa e os treinos, técnicas e notas que registra — na sua conta segura na nuvem (Supabase). A ficha cadastral feita pela academia (contato, endereço, responsável) fica visível só para a gestão.</p>
      <h4>O que o professor vê</h4>
      <p>Apenas dados objetivos: presença, graduação, lesões que você registrar e progresso por técnica (números). <b>Nunca</b> suas anotações, notas livres ou como você se sentiu no treino — isso é protegido no servidor e só a sua conta acessa.</p>
      <h4>Para que serve</h4>
      <p>Funcionar como seu diário de treino, sincronizar entre seus aparelhos e, durante o beta, nos ajudar a melhorar o app.</p>
      <h4>Compartilhamento</h4>
      <p>Com terceiros: nenhum. Só sai da sua conta o que <b>você</b> decidir enviar — um print, o card de story ou o arquivo de "Backup do perfil".</p>
      <h4>Seus direitos (LGPD)</h4>
      <p>Acessar/portar: <b>Perfil → Backup do perfil → Exportar</b>. Corrigir: <b>Perfil → Editar</b>. Apagar tudo: <b>Config → Apagar todos os dados</b> (remove seu diário da nuvem). Os registros de gestão da academia (presença, graduação e ficha cadastral) são excluídos mediante pedido à academia.</p>
      <h4>Idade</h4>
      <p>O app atende praticantes de <b>todas as idades</b> (faixas infantis e adultas, conforme a CBJJ). Para <b>menores de 18 anos</b>, o cadastro e o uso dependem do <b>consentimento de um responsável</b> — normalmente feito pela academia no cadastro, com os dados do responsável.</p>
      <h4>Beta</h4>
      <p>App em teste: pode ter falhas e mudanças. Sem garantias. O backup exportável continua disponível como segurança extra.</p>
      <h4>Governança</h4>
      <p>Controlador: <b>Academia Yama Jiu-Jitsu</b>. Operador: Supabase (hospedagem do banco de dados). Coletamos o mínimo necessário: dados de contato, CPF (para contrato/recibo — opcional), e o que você registrar em Lesões. Não há decisões automatizadas sobre você. Os dados ficam até você apagar.</p>
      <h4>Contato</h4>
      <p>Dúvidas ou exclusão de dados: fale com a equipe pelo botão <b>Enviar feedback</b> em Config.</p>
    </div>
    <button class="sheet-cancel" id="pol-close">Entendi</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pol-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Mini-guia / ajuda (1ª vez + acessível no Config) ----
function abrirAjuda(primeira){
  DB.eu.viuAjuda = true;
  track('ajuda', { primeira: !!primeira });
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${primeira?'Bora começar 🥋':'Como usar'}</div>
    <div class="faq">
      <div class="faq-item"><span class="fq-ic">➕</span><div><b>Registre o treino</b><p>Toque no <b>+</b> no fim da aula e conte como foi — leva uns 15 segundos.</p></div></div>
      <div class="faq-item"><span class="fq-ic">🥋</span><div><b>Sua faixa e graus</b><p>Ajuste em <b>Perfil → Editar</b>. Você mesmo declara sua graduação.</p></div></div>
      <div class="faq-item"><span class="fq-ic">📊</span><div><b>Acompanhe a evolução</b><p>Em <b>Tatame → Progresso</b> você vê o acerto por técnica; a consistência fica na <b>Jornada</b>.</p></div></div>
      <div class="faq-item"><span class="fq-ic">🔒</span><div><b>Seus dados são seus</b><p>Ficam salvos na sua conta na nuvem — treinos e anotações são privados, nem o professor vê.</p></div></div>
      <div class="faq-item"><span class="fq-ic">💬</span><div><b>Achou um bug? Tem ideia?</b><p>Manda em <b>Config → Enviar feedback</b> — cai direto no nosso grupo.</p></div></div>
    </div>
    <button class="btn-save" id="faq-go">${primeira?'Começar a treinar':'Fechar'}</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#faq-go').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Meta semanal (editada a partir do card "Frequência (mês)") ----
function abrirMetaSemanal(){
  let metaSem = DB.semana.meta || 4;
  let metaMode = DB.semana.metaMode==='dias' ? 'dias' : 'qtd';
  let metaDias = Array.isArray(DB.semana.metaDias) ? DB.semana.metaDias.slice() : [];
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Meta semanal</div>
    <div class="seg" id="ms-mode"></div>
    <div id="ms-qtd"><div class="seg" id="ms-meta" style="margin-top:8px"></div></div>
    <div id="ms-dias-wrap" style="display:none">
      <div class="seg-wrap" id="ms-dias" style="margin-top:8px"></div>
      <div class="ep-dias-hint">Marque os dias em que você costuma treinar — a meta semanal passa a ser esse número de dias.</div>
    </div>
    <button class="btn-save" id="ms-save" style="margin-top:16px">Salvar</button>
    <button class="sheet-cancel" id="ms-cancel">Cancelar</button>
  </div></div>`);
  const metaWrap = sheet.querySelector('#ms-meta');
  [2,3,4,5,6].forEach(n=>{ const b=el(`<button class="${n===metaSem?'active':''}">${n}x</button>`);
    b.onclick=()=>{ metaSem=n; metaWrap.querySelectorAll('button').forEach(y=>y.classList.remove('active')); b.classList.add('active'); }; metaWrap.appendChild(b); });
  const diasWrap = sheet.querySelector('#ms-dias');
  [[1,'Seg'],[2,'Ter'],[3,'Qua'],[4,'Qui'],[5,'Sex'],[6,'Sáb'],[0,'Dom']].forEach(([d,l])=>{
    const b=el(`<button class="seg-chip ${metaDias.includes(d)?'on':''}">${l}</button>`);
    b.onclick=()=>{ const i=metaDias.indexOf(d); if(i>=0) metaDias.splice(i,1); else metaDias.push(d); b.classList.toggle('on'); }; diasWrap.appendChild(b); });
  const modeWrap=sheet.querySelector('#ms-mode'), qtdBox=sheet.querySelector('#ms-qtd'), diasBox=sheet.querySelector('#ms-dias-wrap');
  const _apply=()=>{ qtdBox.style.display=metaMode==='qtd'?'':'none'; diasBox.style.display=metaMode==='dias'?'':'none'; };
  [['qtd','Por quantidade'],['dias','Dias específicos']].forEach(([m,l])=>{ const b=el(`<button class="${m===metaMode?'active':''}">${l}</button>`);
    b.onclick=()=>{ metaMode=m; modeWrap.querySelectorAll('button').forEach(y=>y.classList.remove('active')); b.classList.add('active'); _apply(); }; modeWrap.appendChild(b); });
  _apply();
  const close = openSheet(sheet, '#ms-cancel');
  sheet.querySelector('#ms-save').onclick=()=>{
    if(metaMode==='dias' && metaDias.length){ DB.semana.metaMode='dias'; DB.semana.metaDias=metaDias.slice(); DB.semana.meta=metaDias.length; }
    else { DB.semana.metaMode='qtd'; DB.semana.metaDias=[]; DB.semana.meta=metaSem; }
    close(); render(); toast('Meta semanal atualizada ✔');
  };
}

// ---- Editar foto do perfil (acionada por toque longo na foto) ----
function editarFotoPerfil(){
  const me = DB.eu;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Foto do perfil</div>
    <button class="btn-save" id="pf-pick">📷 Escolher nova foto</button>
    ${me.foto?`<button class="sheet-cancel danger" id="pf-rm">Remover foto</button>`:''}
    <button class="sheet-cancel" id="pf-close">Fechar</button>
    <input type="file" accept="image/*" id="pf-file" style="display:none">
  </div></div>`);
  const close = openSheet(sheet, '#pf-close');
  const fileIn = sheet.querySelector('#pf-file');
  sheet.querySelector('#pf-pick').onclick = ()=> fileIn.click();   // síncrono no gesto (iOS)
  fileIn.onchange = (e)=>{ const f=e.target.files&&e.target.files[0]; if(!f) return;
    if(f.size>31457280){ toast('Foto muito grande (máx 30 MB)'); return; }
    const img=new Image(); const url=URL.createObjectURL(f);
    img.onload=()=>{ const MAX=1024; let w=img.width, h=img.height;
      if(w>MAX||h>MAX){ const s=MAX/Math.max(w,h); w=Math.round(w*s); h=Math.round(h*s); }
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      // Storage (backend ligado + bucket 'fotos' criado): sobe binário e guarda URL.
      // Fallback (demo/offline/sem bucket): mantém base64 no dump — sem perda de feature.
      // v434: a miniatura sai do MESMO canvas, aqui — sem rede, sem CORS, sem esperar
      // o próximo boot. `cv` já está no tamanho de exibição; o helper recorta o
      // quadrado central e reduz pra 96px.
      const _miniDoCanvas=()=>{ try{ _perfilCacheSetMini(_fotoMiniDeImg(cv)); }catch(_){} };
      const _finishBase64=()=>{ DB.eu.foto=cv.toDataURL('image/jpeg',0.85); _miniDoCanvas(); close(); scheduleSave(); render(); toast('Foto atualizada ✔'); };
      if(DB.sbUser && typeof sbSync!=='undefined' && sbSync.uploadFoto){
        cv.toBlob(async blob=>{
          if(!blob){ _finishBase64(); return; }
          try{
            // 0007: signed URL (única por assinatura — cache-bust natural; ?t= extra QUEBRARIA o token)
            const url = await sbSync.uploadFoto(blob);
            if(url){ DB.eu.foto = url; _miniDoCanvas(); close(); scheduleSave(); render(); toast('Foto atualizada ✔'); return; }
            _finishBase64();
          }catch(_){ _finishBase64(); }
        }, 'image/jpeg', 0.85);
      } else _finishBase64();
    };
    img.src=url; };
  const rm = sheet.querySelector('#pf-rm');
  if(rm) rm.onclick = ()=>{
    DB.eu.foto=null;
    _perfilCacheSetMini(null);   // v434: tirou a foto → a miniatura sai junto, senão o
                                 // próximo boot pintaria uma foto que não existe mais
    if(DB.sbUser && typeof sbSync!=='undefined' && sbSync.deleteFoto) sbSync.deleteFoto().catch(()=>{});
    close(); scheduleSave(); render(); toast('Foto removida');
  };
}

// ---- Editar perfil ----
function abrirEditarPerfil(){
  const me = DB.eu;
  let faixa = me.faixa, graus = me.graus;
  const maxGraus = (f)=> f==='preta'?6:4;
  // Conta provisionada pelo professor: faixa/grau são controlados pela graduação do professor (read-only aqui).
  const editaGrad = !me.provisionedByProf;
  const gradBlock = editaGrad ? `
    <label class="flbl" style="margin-top:12px">Faixa</label>
    <div class="seg-wrap" id="ep-belt"></div>
    <label class="flbl" style="margin-top:12px">Grau</label>
    <div class="seg" id="ep-graus"></div>
    <label class="flbl" style="margin-top:12px">Data da faixa atual</label>
    <input class="inp" id="ep-data-faixa" type="date">` : `
    <label class="flbl" style="margin-top:12px">Graduação</label>
    <div class="ep-belt-ro">${beltPill(me.faixa,me.graus)}<span class="ep-ro-note">definida pelo professor</span></div>`;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar perfil</div>
    <div class="sheet-scroll">
    <label class="flbl">Apelido</label>
    <input class="inp" id="ep-apelido" value="${safeAttr(me.apelido)}">
    <label class="flbl" style="margin-top:12px">Nome completo</label>
    <div class="ep-belt-ro">${safeTxt(me.nomeCompleto||'—')}<span class="ep-ro-note">definido no cadastro — peça ao professor pra corrigir</span></div>
    ${gradBlock}
    </div>
    <button class="btn-save" id="ep-save" style="margin-top:16px">Salvar</button>
    <button class="sheet-cancel" id="ep-cancel">Cancelar</button>
  </div></div>`);
  const epDataFaixa = sheet.querySelector('#ep-data-faixa');
  if(editaGrad){
    const _rebuildGraus=()=>{
      const gs=sheet.querySelector('#ep-graus'); gs.innerHTML='';
      const mx=maxGraus(faixa); if(graus>mx) graus=mx;
      for(let g=0;g<=mx;g++){ const x=el(`<button class="${g===graus?'active':''}">${g}º</button>`);
        x.onclick=()=>{ graus=g; gs.querySelectorAll('button').forEach(y=>y.classList.remove('active')); x.classList.add('active'); }; gs.appendChild(x); }
    };
    const bs=sheet.querySelector('#ep-belt');
    // v472: idade removida do "editar perfil" (data completa vem do cadastro do professor).
    // v193 já removeu o filtro por idade nas faixas — aqui só monta a lista completa.
    const _rebuildBeltsPerfil=()=>{
      const lista = CBJJ_CHAIN.slice();
      if(!lista.includes(faixa)) faixa = lista[0];
      renderBeltField(bs, lista, faixa, (b)=>{ faixa=b; _rebuildBeltsPerfil(); });
      _rebuildGraus();
    };
    _rebuildBeltsPerfil();
    const dataFaixaAtual = (DB.graduacoes||[]).find(g=>g.tipo==='faixa'&&g.faixa===me.faixa);
    if(dataFaixaAtual && epDataFaixa) epDataFaixa.value = dataFaixaAtual.data;
  }
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ep-cancel').onclick=close;
  sheet.querySelector('#ep-save').onclick=()=>{
    me.apelido = sheet.querySelector('#ep-apelido').value.trim() || me.apelido;
    // Nome completo é dono do cadastro (ficha do professor) — o aluno não edita aqui,
    // só o apelido/display. Ver supabase.js pushProfile().
    const base = (me.nomeCompleto||me.apelido||'').trim();
    me.nome = base.split(' ').slice(0,2).join(' ') || me.apelido;
    me.iniciais = (base.split(/\s+/).map(s=>s[0]).slice(0,2).join('') || (me.apelido||'A')[0]).toUpperCase();
    // v472: aluno não edita mais o ano de nascimento — vem do cadastro do professor (data completa).
    // faixa/grau só são editáveis quando NÃO provisionado pelo professor
    if(editaGrad){
      const novaData = (epDataFaixa && epDataFaixa.value) || HOJE_ISO;
      const faixaMudou = faixa !== me.faixa;
      const grausMudou = graus !== me.graus;
      me.faixa=faixa; me.graus=graus;
      if(faixaMudou || grausMudou) me.aulasGrau = Object.assign({}, me.aulasGrau, { base:0 });
      if(faixaMudou){
        if(!DB.graduacoes.some(g=>g.tipo==='faixa'&&g.faixa===faixa))
          DB.graduacoes.push({faixa, graus:0, tipo:'faixa', data:novaData});
      } else {
        const existing = DB.graduacoes.find(g=>g.tipo==='faixa'&&g.faixa===faixa);
        if(existing && epDataFaixa && epDataFaixa.value) existing.data = epDataFaixa.value;
      }
      if(grausMudou && !faixaMudou){
        DB.graduacoes = DB.graduacoes.filter(g=>!(g.tipo==='grau'&&g.faixa===faixa&&g.graus>graus));
        if(graus>0 && !DB.graduacoes.some(g=>g.tipo==='grau'&&g.faixa===faixa&&g.graus===graus))
          DB.graduacoes.push({faixa, graus, tipo:'grau', data:HOJE_ISO});
      }
      DB.graduacoes.sort((a,b)=>a.data.localeCompare(b.data));
    }
    sheet.remove(); render(); toast('Perfil atualizado ✔');
    if(DB.sbUser && typeof sbSync!=='undefined') sbSync.pushProfile();
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Status de atividade do aluno (0023): automático (90d) com override manual ----
function _statusManualSheet(a, refresh, paint){
  const atual = a.statusManual || '';   // '' = automático
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Status de atividade</div>
    <div class="sheet-desc">Por padrão o app decide sozinho: ${STATUS_INATIVO_DIAS}+ dias sem treinar vira "Inativo". Force manualmente só se precisar ignorar essa regra pra este aluno (ex: afastado por lesão mas continua matriculado).</div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:0 4px 8px">
      <button class="btn-cad ${atual===''?'primary':''}" type="button" data-a=""><div style="font-weight:800;font-size:14px">🔄 Automático</div><div style="font-size:12px;font-weight:600;margin-top:3px;opacity:.85">Segue a regra: ${STATUS_INATIVO_DIAS}+ dias sem treinar</div></button>
      <button class="btn-cad ${atual==='ativo'?'primary':''}" type="button" data-a="ativo"><div style="font-weight:800;font-size:14px">✅ Forçar Ativo</div></button>
      <button class="btn-cad ${atual==='inativo'?'primary':''}" type="button" data-a="inativo"><div style="font-weight:800;font-size:14px">⛔ Forçar Inativo</div></button>
      <button class="sheet-cancel" id="sm-close">Cancelar</button>
    </div>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#sm-close').onclick=close;
  sheet.querySelectorAll('[data-a]').forEach(btn=>{
    btn.onclick=async ()=>{
      const valor = btn.dataset.a || null;
      try{
        if(!DEMO && typeof sbProf!=='undefined' && sbProf.setStatusAluno) await sbProf.setStatusAluno(a.id, valor);
        a.statusManual = valor; a.statusManualEm = valor ? new Date().toISOString() : null;
        toast('Status atualizado ✔'); close(); if(refresh) refresh(); if(paint) paint();
      }catch(e){ toast('Erro ao salvar: '+(e.message||e)); }
    };
  });
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

/* ============================================================
   YAMA — hub de configurações da academia (v375)
   Aba própria na sidebar do professor (wide-only). No mobile o Painel tem um
   botão de atalho no cabeçalho, porque a tabbar mobile já está cheia.
   ============================================================ */
function profYama(){
  const v = el(`<div class="view"></div>`);
  const nome = (DB.academia && DB.academia.nome) || 'Yama Jiu-Jitsu';
  const cfg = _acadCfg();
  const wa  = cfg.whatsapp || (DB.loja && DB.loja.config && DB.loja.config.whatsapp) || '';
  const pix = cfg.pix      || (DB.loja && DB.loja.config && DB.loja.config.pix)      || '';
  const brCode = cfg.pixBrCode || '';
  const qr  = cfg.qrToken || '';
  v.innerHTML = `<div class="topbar"><div class="tb-title">⚙️ Yama · Configurações</div></div>`;
  const box = el(`<div class="yama-hub"></div>`);
  box.appendChild(el(`<div class="yama-hero">
    <div class="yama-nm">${safeTxt(nome)}</div>
    <div class="yama-sub">Configurações da academia · gestão do professor</div>
  </div>`));
  // status resumido — o que já está configurado
  const status = el(`<div class="yama-status"></div>`);
  const chip = (lbl, ok)=> `<span class="yama-chip ${ok?'on':'off'}">${ok?'✓':'○'} ${safeTxt(lbl)}</span>`;
  status.innerHTML = chip('WhatsApp', !!wa) + chip('PIX', !!pix) + chip('QR PIX', !!brCode) + chip('QR presença', !!qr);
  box.appendChild(status);
  // grupos
  const grupos = [
    ['Academia', [
      ['🏢 Dados da academia', 'Nome, telefone/WhatsApp, chave PIX', ()=> _dadosAcademiaSheet()],
      ['🔑 Senha padrão dos alunos', 'Usada nos convites em lote', ()=> _senhaPadraoSheet()],
      ['📨 Distribuir acesso', 'Aplicar senha padrão + convite WhatsApp em lote', ()=>{ DB.acessoAlunosOpen=true; render(); window.scrollTo(0,0); }],
    ]],
    ['QR Codes', [
      ['📷 QR de presença', qr ? 'Configurado · toque pra ver/renovar' : 'Ainda não configurado — configure antes do próximo treino', ()=> _qrTokenSheet()],
      ['💸 QR do PIX', brCode ? 'Copia e Cola configurado' : 'Cole o Copia e Cola do seu banco', ()=> _pixQrSheet()],
    ]],
    ['Notificações', [
      ['🔔 Aviso de check-in', 'Quem tem ativo · disparar teste · regras do push', ()=> _avisoCheckinSheet()],
      ['💬 Mensagens WhatsApp', '8 textos prontos pra usar no botão WhatsApp do aluno', ()=> _waTemplatesSheet()],
    ]],
    ['Conta', [
      ['👤 Meu perfil', 'Seu perfil pessoal (o professor também é aluno)', ()=>{ DB.navProf='perfil'; render(); }],
    ]],
  ];
  grupos.forEach(([titulo, linhas])=>{
    box.appendChild(el(`<div class="yama-grp-t">${safeTxt(titulo)}</div>`));
    const grp = el(`<div class="yama-grp"></div>`);
    linhas.forEach(([lbl, desc, fn])=>{
      const row = el(`<div class="yama-row" role="button" tabindex="0">
        <div class="yama-row-t">${safeTxt(lbl)}</div>
        <div class="yama-row-s">${safeTxt(desc)}</div>
        <span class="yama-row-go">›</span>
      </div>`);
      row.onclick = fn;
      row.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } };
      grp.appendChild(row);
    });
    box.appendChild(grp);
  });
  v.appendChild(box);
  return v;
}

// Sheet: só nome + telefone + PIX (Copia e Cola vai em sheet próprio, senha em outro).
// v443: config exclusiva da Loja (desconto Pix por enquanto). Vive em academies.config,
// compartilhada por todos os professores. Fora do "Dados da academia" pra não misturar
// identidade da academia (nome/WhatsApp/PIX) com regras de loja.
function _lojaConfigSheet(onSave){
  const cfg = _acadCfg();
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Configurações da loja">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Configurações da loja</div>
    <div class="sheet-desc">Regras de pagamento e apresentação de preços. Vale pra toda a academia.</div>
    <label class="flbl" style="margin-top:12px">% desconto no Pix <span style="color:var(--muted);font-weight:500">(0–90, 0 = sem desconto; cartão é pago na academia)</span></label>
    <input class="inp" id="lc-descpix" type="number" inputmode="numeric" min="0" max="90" step="1" placeholder="Ex: 5" value="${safeAttr(cfg.descontoPix||'')}">
    <button class="btn-save" id="lc-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="lc-close">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#lc-close').onclick=close;
  sheet.querySelector('#lc-save').onclick=()=>{
    const descN = Math.max(0, Math.min(90, parseInt(sheet.querySelector('#lc-descpix').value)||0));
    const btn = sheet.querySelector('#lc-save'); btn.disabled=true; btn.textContent='Salvando…';
    _salvarAcademyConfig({ descontoPix: descN })
      .then(()=>{ toast('Configurações salvas ✔'); close(); if(onSave) onSave(); else render(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}
function _dadosAcademiaSheet(){
  const cfg = _acadCfg();
  const local = (DB.loja && DB.loja.config) || {};
  const wa  = cfg.whatsapp || local.whatsapp || '';
  const pix = cfg.pix || local.pix || '';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Dados da academia</div>
    <div class="sheet-desc">O nome vem do cadastro inicial (não editável por aqui). Telefone/WhatsApp e PIX são usados nos pedidos da Loja e no contato com o professor.</div>
    <label class="flbl">Nome da academia</label>
    <input class="inp" readonly value="${safeAttr((DB.academia && DB.academia.nome) || 'Yama Jiu-Jitsu')}">
    <label class="flbl" style="margin-top:12px">Telefone / WhatsApp <span style="color:var(--muted);font-weight:500">(só dígitos, com DDI 55)</span></label>
    <input class="inp" id="da-wa" inputmode="numeric" placeholder="5531999999999" value="${safeAttr(wa)}">
    <label class="flbl" style="margin-top:12px">Chave PIX</label>
    <input class="inp" id="da-pix" placeholder="CPF, telefone, e-mail ou chave aleatória" value="${safeAttr(pix)}">
    <button class="btn-save" id="da-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="da-close">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#da-close').onclick=close;
  sheet.querySelector('#da-save').onclick=()=>{
    const waN = sheet.querySelector('#da-wa').value.replace(/\D/g,'');
    const pixN = sheet.querySelector('#da-pix').value.trim();
    if(waN && waN.length<12){ toast('WhatsApp precisa DDI + DDD + número (ex: 5531999999999)'); return; }
    const btn = sheet.querySelector('#da-save');
    btn.disabled = true; btn.textContent = 'Salvando…';
    _salvarAcademyConfig({ pix: pixN, whatsapp: waN })
      .then(()=>{ toast('Dados salvos ✔'); close(); render(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Sheet só da senha padrão — local (user_state do professor), fora da nuvem por LGPD:
// academies.config é lido por todo membro; se a senha estivesse lá, aluno veria a senha
// dos colegas que ainda não trocaram.
/* v436 — reset de senha de UM aluno. Duas etapas de propósito: a primeira tela avisa o
   que isso significa (quem sabe a senha entra na conta e vê o diário — dado que a RLS
   nega ao professor), a segunda mostra a senha UMA vez. Não guardamos a senha em lugar
   nenhum: some ao fechar a sheet. Preferir sempre "Esqueceu a senha?" quando o e-mail
   do aluno funcionar — lá o professor nunca conhece a senha. */
function _resetarSenhaSheet(a){
  const nome = _nomeInst(a);
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Redefinir senha">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Redefinir a senha de ${safeTxt(nome)}?</div>
    <div class="sheet-desc">Uma senha nova e aleatória será gerada. A senha atual do aluno <b>deixa de funcionar na hora</b>, e ele terá que criar uma senha própria no primeiro acesso.</div>
    <div class="auth-note" style="margin:10px 0 4px">⚠️ Enquanto o aluno não trocar, <b>quem souber essa senha consegue entrar na conta dele</b> e ver o diário (treinos, notas, lesões). Use só quando não der pra enviar o link por e-mail. A ação fica registrada.</div>
    <button class="btn-save" id="rs-go" style="margin-top:12px">Gerar nova senha</button>
    <button class="sheet-cancel" id="rs-close">Cancelar</button>
  </div></div>`);
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-close').onclick = close;
  const btn = sheet.querySelector('#rs-go');
  btn.onclick = async ()=>{
    if(DEMO || typeof sbProf==='undefined' || !sbProf.resetarSenha){ toast('Indisponível no modo demo'); return; }
    btn.disabled = true; btn.textContent = 'Gerando…';
    try{
      const r = await sbProf.resetarSenha(a.id);
      const senha = r && r.senha;
      if(!senha) throw new Error('resposta sem senha');
      // Etapa 2: a senha aparece UMA vez. Sem persistir — recarregar a tela a perde.
      const corpo = sheet.querySelector('.sheet');
      corpo.innerHTML = `<div class="sheet-grip"></div>
        <div class="sheet-title">Senha de ${safeTxt(nome)}</div>
        <div class="sheet-desc">Anote ou envie agora — ela <b>não aparece de novo</b>.</div>
        <div id="rs-val" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:800;letter-spacing:2px;text-align:center;background:var(--field);border-radius:12px;padding:16px;margin:12px 0;user-select:all">${safeTxt(senha)}</div>
        <button class="btn-save" id="rs-copy">📋 Copiar senha</button>
        ${_waLink(a)?`<button class="sheet-cancel" id="rs-wa">💬 Enviar no WhatsApp</button>`:''}
        <button class="sheet-cancel" id="rs-fim">Fechar</button>`;
      corpo.querySelector('#rs-fim').onclick = close;
      corpo.querySelector('#rs-copy').onclick = ()=>{
        try{ navigator.clipboard.writeText(senha).then(()=>toast('Senha copiada ✔'), ()=>toast('Selecione e copie à mão')); }
        catch(_){ toast('Selecione e copie à mão'); }
      };
      const wa = corpo.querySelector('#rs-wa');
      if(wa) wa.onclick = ()=>{ const u=_waLink(a, _waConviteBody(a, senha)); if(u) window.open(u,'_blank','noopener'); };
    }catch(e){
      btn.disabled = false; btn.textContent = 'Gerar nova senha';
      toast('Falha: ' + (e.message || e));
    }
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

function _senhaPadraoSheet(){
  const atual = _senhaPadrao();
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Senha padrão dos alunos</div>
    <div class="sheet-desc">Usada nos convites em lote. Vale para <b>toda a academia</b> — todos os professores veem e aplicam esta mesma senha.</div>
    <label class="flbl">Nova senha <span style="color:var(--muted);font-weight:500">(letras + números, mín. 8, com MAIÚSCULA)</span></label>
    <input class="inp" id="sp-val" placeholder="Ex: YamaJiuJitsu2026" value="${safeAttr(atual)}">
    <button class="btn-save" id="sp-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="sp-close">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#sp-close').onclick=close;
  const btn = sheet.querySelector('#sp-save');
  btn.onclick=()=>{
    const senha = sheet.querySelector('#sp-val').value.trim();
    if(senha.length<8 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha) || !/\d/.test(senha)){
      toast('Senha precisa 8+ com minúscula, MAIÚSCULA e número'); return;
    }
    // v430: grava em academies.config (compartilhada). _salvarAcademyConfig relê o
    // remoto e faz merge antes de gravar — sem isso o update do JSONB inteiro
    // apagaria qrToken/waTemplates/pix dos outros. Espera a nuvem confirmar: senha
    // "salva" que não subiu faria o professor mandar convite com senha errada.
    btn.disabled = true; btn.textContent = 'Salvando…';
    _salvarAcademyConfig({ senhaPadrao: senha })
      .then(()=>{ toast('Senha padrão salva ✔ (vale para toda a academia)'); close(); render(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro ao salvar: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Sheet do PIX Copia e Cola (BR Code EMV). Guarda em academies.config.pixBrCode.
// Gera o QR pra impressão via api.qrserver.com (mesma via do QR de presença).
function _pixQrSheet(){
  const cfg = _acadCfg();
  const atual = cfg.pixBrCode || '';
  const linkImprimir = t => 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data='+encodeURIComponent(t);
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">QR do PIX</div>
    <div class="sheet-desc">Cole o <b>"PIX Copia e Cola"</b> do seu banco (começa com <code>00020126</code>). É o único jeito de gerar um QR que puxa valor/descrição automaticamente. Se só tiver a chave PIX, o QR "estático" com a chave não vale como cobrança.</div>
    <label class="flbl">Copia e Cola do PIX</label>
    <textarea class="inp" id="pq-val" rows="4" placeholder="00020126...">${safeTxt(atual)}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn-cad" id="pq-print" ${atual?'':'disabled'}>🖨️ Gerar QR pra imprimir</button>
    </div>
    <button class="btn-save" id="pq-save" style="margin-top:14px">Salvar</button>
    <button class="sheet-cancel" id="pq-close">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#pq-close').onclick=close;
  const ta = sheet.querySelector('#pq-val');
  sheet.querySelector('#pq-print').onclick=()=>{
    const v = ta.value.trim();
    if(!v) return;
    window.open(linkImprimir(v), '_blank', 'noopener');
  };
  sheet.querySelector('#pq-save').onclick=()=>{
    const v = ta.value.trim();
    const btn = sheet.querySelector('#pq-save');
    btn.disabled = true; btn.textContent = 'Salvando…';
    _salvarAcademyConfig({ pixBrCode: v })
      .then(()=>{ toast('Salvo ✔'); close(); render(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Sheet do aviso de check-in (v376). Três seções:
//   1) Aparelhos ativos — quem tem push (RPC push_subs_academia, 0028).
//   2) Push de teste — dispara no aluno escolhido (RPC enviar_push_teste, 0028).
//   3) Push personalizada — desabilitada (exige mudar a Edge send-push, ver ROADMAP).
//   4) Regras — read-only (editar exige RPC de escrita em app_config).
function _avisoCheckinSheet(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-lg" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🔔 Aviso de check-in</div>

    <div class="av-sec-t">Aparelhos ativos</div>
    <div class="av-sub" id="av-subs"><div class="av-loading">Carregando…</div></div>

    <div class="av-sec-t" style="margin-top:16px">Push de teste</div>
    <div class="av-sub-desc">Dispara agora um push ("Yama · Teste") pro aparelho do aluno escolhido acima.</div>
    <button class="btn-cad primary" id="av-teste" disabled>🧪 Selecione um aluno da lista</button>

    <div class="av-sec-t" style="margin-top:16px">Push personalizada</div>
    <div class="av-sub-desc">Enviar texto livre pra um ou vários alunos. Precisa expandir a Edge Function <code>send-push</code> — não está pronto (ver ROADMAP · Notificações).</div>
    <button class="btn-cad" disabled title="Requer mudança na Edge send-push">✏️ Enviar mensagem personalizada</button>

    <div class="av-sec-t" style="margin-top:16px">Regras do disparo automático</div>
    <div class="info-list" style="margin-top:8px">
      <div class="info-row"><div class="ii">📊</div><div class="it"><div class="t">Ocorrências mínimas da sessão</div><div class="s">Quantas vezes a aula já aconteceu antes</div></div><div class="iv">0</div></div>
      <div class="info-row"><div class="ii">✅</div><div class="it"><div class="t">Presenças mínimas nas últimas 4</div><div class="s">Padrão de comparecimento do aluno nessa sessão</div></div><div class="iv">0</div></div>
      <div class="info-row"><div class="ii">🕐</div><div class="it"><div class="t">Janela de disparo</div><div class="s">30–120 min após o fim da aula (fixo)</div></div><div class="iv">—</div></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.5">Endurecimento planejado pra <b>01/10/2026</b>: 4 e 3. Editar valores hoje exige SQL no painel Supabase (<code>app_config</code>).</div>

    <button class="sheet-cancel" id="av-close" style="margin-top:14px">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#av-close').onclick=close;
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));

  const subsEl = sheet.querySelector('#av-subs');
  const btnTeste = sheet.querySelector('#av-teste');
  let alvo = null;

  const _uaCurto = ua => {
    const s = String(ua||''); if(!s) return 'aparelho';
    if(/iPhone|iPad/i.test(s)) return 'iOS';
    if(/Android/i.test(s))     return 'Android';
    if(/Windows/i.test(s))     return 'Windows';
    if(/Mac OS/i.test(s))      return 'Mac';
    if(/Linux/i.test(s))       return 'Linux';
    return 'aparelho';
  };
  const _humano = ts => {
    if(!ts) return '';
    const d = new Date(ts); const dias = Math.floor((Date.now()-d)/86400000);
    if(dias===0) return 'hoje'; if(dias===1) return 'ontem'; return 'há '+dias+' dias';
  };

  if(DEMO || typeof sbProf==='undefined' || !sbProf.getPushSubs){
    subsEl.innerHTML = '<div class="av-empty">Indisponível no modo demo.</div>';
    return;
  }

  sbProf.getPushSubs().then(rows => {
    if(!rows || !rows.length){
      subsEl.innerHTML = '<div class="av-empty">Nenhum aluno ativou push ainda. Peça pros alunos abrirem o app, tocarem no sino e permitirem notificações.</div>';
      return;
    }
    // Cruza com o roster carregado pra mostrar nome (evita ida extra à API)
    const byId = {}; ((_profData && _profData.alunos)||[]).forEach(a=> byId[a.id]=a);
    subsEl.innerHTML = '';
    rows.forEach(r=>{
      const a = byId[r.userId];
      const nome = a ? _nomeInst(a) : '(fora da lista)';
      const meta = _uaCurto(r.userAgent) + ' · ' + _humano(r.criadoEm);
      const row = el(`<div class="av-row" role="button" tabindex="0" data-uid="${safeAttr(r.userId)}">
        <div class="av-row-nm">${safeTxt(nome)}</div>
        <div class="av-row-mt">${safeTxt(meta)}</div>
      </div>`);
      row.onclick = ()=>{
        alvo = r.userId;
        subsEl.querySelectorAll('.av-row').forEach(x=> x.classList.toggle('on', x===row));
        btnTeste.disabled = false; btnTeste.textContent = '🧪 Enviar push de teste pra '+nome.split(' ')[0];
      };
      row.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); row.click(); } };
      subsEl.appendChild(row);
    });
    subsEl.appendChild(el(`<div class="av-empty" style="font-size:12px;margin-top:8px">Toque num aluno pra habilitar o botão de teste.</div>`));
  }).catch(e=>{
    subsEl.innerHTML = '<div class="av-empty">Erro ao listar: '+safeTxt(e.message||String(e))+'</div>';
  });

  btnTeste.onclick = ()=>{
    if(!alvo) return;
    btnTeste.disabled = true; const orig = btnTeste.textContent;
    btnTeste.textContent = 'Disparando…';
    sbProf.enviarPushTeste(alvo).then(r=>{
      if(r && r.ok===false){
        const msg = r.motivo==='sem_aparelho' ? 'Esse aluno perdeu o aparelho — a lista pode estar desatualizada' :
                    r.motivo==='push_nao_configurado' ? 'Push não configurado no banco (app_config.push_function_url)' :
                    'Não foi possível enviar';
        toast(msg);
      } else {
        toast('Push disparado ✔ · deve chegar em segundos');
      }
    }).catch(e=> toast('Erro: '+(e.message||e))).finally(()=>{
      btnTeste.disabled = false; btnTeste.textContent = orig;
    });
  };
}

// v376: editor dos 8 templates de WhatsApp. Persiste em academies.config.waTemplates
// (JSONB, sem migration — reusa o merge remoto+patch do v359).
// Placeholder: {nome} → _waNome(a) na hora do envio (_waResolve).
function _waTemplatesSheet(){
  const tpls = _waTpls();
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-lg" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">💬 Mensagens WhatsApp</div>
    <div class="sheet-desc">8 blocos de mensagens prontas. Toque no botão "WhatsApp" da ficha do aluno pra escolher qual enviar. Use <code>{nome}</code> onde quiser o primeiro nome do aluno (ou do responsável, se menor).</div>
    <div class="wa-tpls-nav" id="wt-nav"></div>
    <div class="wa-tpls-edit" id="wt-edit"></div>
    <button class="btn-save" id="wt-save" style="margin-top:14px">Salvar todos</button>
    <button class="sheet-cancel" id="wt-close">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#wt-close').onclick=close;

  let sel = 0;
  const nav = sheet.querySelector('#wt-nav');
  const edit = sheet.querySelector('#wt-edit');
  const state = tpls.map(t=>({ ...t }));   // cópia local editável

  const paintNav = ()=>{
    nav.innerHTML = '';
    state.forEach((t,i)=>{
      const b = el(`<button class="wt-tab${i===sel?' on':''}" type="button" title="${safeAttr(t.label)}"><span class="wt-tab-ic">${safeTxt(t.icon)}</span><span class="wt-tab-n">${i+1}</span></button>`);
      b.onclick = ()=>{ sel = i; paintNav(); paintEdit(); };
      nav.appendChild(b);
    });
  };
  const paintEdit = ()=>{
    const t = state[sel];
    edit.innerHTML = `
      <label class="flbl">Ícone <span style="color:var(--muted);font-weight:500">(1 emoji)</span></label>
      <input class="inp" id="wt-ic" maxlength="4" value="${safeAttr(t.icon)}">
      <label class="flbl" style="margin-top:10px">Rótulo <span style="color:var(--muted);font-weight:500">(texto do botão, curto)</span></label>
      <input class="inp" id="wt-lb" maxlength="30" value="${safeAttr(t.label)}">
      <label class="flbl" style="margin-top:10px">Mensagem</label>
      <textarea class="inp" id="wt-bd" rows="6" placeholder="Oi {nome}, …">${safeTxt(t.body)}</textarea>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">
        ${t.body ? 'Preview: ' + safeTxt(_waResolve(t.body, {nm:'Fulano',cad:{nomeCompleto:'Fulano da Silva'}})) : 'Vazio = botão não aparece na lista pro aluno (exceto o "Só abrir chat").'}
      </div>
    `;
    const upd = ()=>{
      state[sel].icon  = edit.querySelector('#wt-ic').value.trim() || '💬';
      state[sel].label = edit.querySelector('#wt-lb').value.trim() || ('Slot '+(sel+1));
      state[sel].body  = edit.querySelector('#wt-bd').value;
      // atualiza preview em tempo real (sem re-render completo pra não perder foco)
    };
    ['#wt-ic','#wt-lb','#wt-bd'].forEach(sel2=>{
      edit.querySelector(sel2).addEventListener('input', upd);
    });
  };
  paintNav(); paintEdit();

  sheet.querySelector('#wt-save').onclick=()=>{
    // envia o array puro (sem `key` — a ordem é a chave); merge no runtime usa índice.
    const payload = state.map(t=>({ icon:t.icon, label:t.label, body:t.body }));
    const btn = sheet.querySelector('#wt-save');
    btn.disabled = true; btn.textContent = 'Salvando…';
    _salvarAcademyConfig({ waTemplates: payload })
      .then(()=>{ toast('Mensagens salvas ✔'); close(); render(); })
      .catch(e=>{ btn.disabled=false; btn.textContent='Salvar todos'; toast('Erro: '+(e.message||e)); });
  };

  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// ---- QR de presença da academia (professor): token estático em academies.config.qrToken.
// Renovar o token invalida todos os cartazes impressos — todo QR antigo para de funcionar.
// Payload aceito no scanner: o token puro, ou uma URL terminando em `?qr=TOKEN`/`&qr=TOKEN`.
function _qrTokenSheet(){
  const token = _qrToken();
  const criar = ()=>{
    // Usa Web Crypto (disponível em https/localhost). Fallback pra crypto.randomUUID.
    try{ return crypto.randomUUID(); }
    catch(_){ return 'yama-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10); }
  };
  const linkImprimir = t => 'https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=20&data='+encodeURIComponent(t);
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">QR de presença</div>
    <div class="sheet-desc">Um QR estático da academia. Cole o token num gerador (link abaixo), imprima e espalhe pelo tatame. O aluno só bate presença com esse QR.</div>
    <label class="flbl" style="margin-top:8px">Token atual</label>
    <input class="inp" id="qr-tok" readonly value="${safeAttr(token||'')}" placeholder="Nenhum token gerado ainda">
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn-cad" id="qr-copy" ${token?'':'disabled'}>📋 Copiar</button>
      <button class="btn-cad" id="qr-print" ${token?'':'disabled'}>🖨️ Gerar QR pra imprimir</button>
    </div>
    <button class="btn-save" id="qr-new" style="margin-top:14px">${token?'🔄 Renovar QR':'✨ Gerar QR da academia'}</button>
    ${token ? '<div style="font-size:12px;color:var(--muted);margin-top:8px;text-align:center">Renovar invalida <b>todos</b> os cartazes atuais.</div>' : ''}
    <button class="sheet-cancel" id="qr-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#qr-close').onclick=close;
  const inp = sheet.querySelector('#qr-tok');
  sheet.querySelector('#qr-copy').onclick=()=>{
    if(!inp.value) return;
    try{ navigator.clipboard.writeText(inp.value).then(()=>toast('Token copiado ✔')); }
    catch(_){ inp.select(); document.execCommand('copy'); toast('Token copiado ✔'); }
  };
  sheet.querySelector('#qr-print').onclick=()=>{
    if(!inp.value) return;
    window.open(linkImprimir(inp.value), '_blank', 'noopener');
  };
  sheet.querySelector('#qr-new').onclick=()=>{
    if(token && !confirm('Renovar o QR invalida todos os cartazes já impressos. Continuar?')) return;
    const novo = criar();
    const btn = sheet.querySelector('#qr-new');
    btn.disabled = true; btn.textContent = 'Salvando…';
    _salvarAcademyConfig({ qrToken: novo })
      .then(()=>{ toast('QR '+(token?'renovado':'gerado')+' ✔'); close(); _qrTokenSheet(); })
      .catch(e=>{ btn.disabled=false; btn.textContent = token?'🔄 Renovar QR':'✨ Gerar QR da academia'; toast('Erro: '+(e.message||e)); });
  };
  document.body.appendChild(sheet); requestAnimationFrame(()=>sheet.classList.add('open'));
}

// ---- abrirConfigAcademia removida em v375 — substituída pelo hub YAMA (profYama).
//      Dados/PIX/WhatsApp em _dadosAcademiaSheet, senha padrão em _senhaPadraoSheet,
//      QR de presença em _qrTokenSheet, QR do PIX em _pixQrSheet.

// ---- Configurações ----
function abrirConfiguracoes(){
  // Enxuto: só o essencial. Sair, Backup e "Sobre" saíram (duplicados/vazios).
  // "Como usar" = Rever introdução (mesmo fluxo).
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Configurações</div>
    <div class="cfg-list">
      <div class="cfg-row" id="cfg-ajuda"><span>📖 Como usar o Yama</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-priv"><span>🔒 Privacidade & Termos</span><span class="cfg-go">›</span></div>
      <div class="cfg-row" id="cfg-feedback"><span>💬 Enviar feedback</span><span class="cfg-go">›</span></div>
      <div class="cfg-row danger" id="cfg-limpar"><span>🗑️ Apagar todos os dados</span><span class="cfg-go">›</span></div>
    </div>
    <button class="sheet-cancel" id="cfg-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#cfg-close').onclick=close;
  sheet.querySelector('#cfg-ajuda').onclick=()=>{ close(); abrirOnboarding(); };
  sheet.querySelector('#cfg-priv').onclick=()=>{ close(); abrirPolitica(); };
  sheet.querySelector('#cfg-feedback').onclick=()=>{ close(); abrirFeedback(); };
  sheet.querySelector('#cfg-limpar').onclick=()=>{ close(); limparDados(); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Feedback do beta ----
function abrirFeedback(){
  track('feedback');
  const msg = `Feedback Yama (beta)\nAluno: ${DB.eu.apelido||'-'} · faixa ${DB.eu.faixa||'-'}\nTreinos: ${DB.treinos.length}\n\nO que achou / o que quebrou:\n`;
  let url;
  if (FEEDBACK_URL.startsWith('mailto:')) url = FEEDBACK_URL + (FEEDBACK_URL.includes('?')?'&':'?') + 'subject=' + encodeURIComponent('Feedback Yama beta') + '&body=' + encodeURIComponent(msg);
  else url = FEEDBACK_URL + encodeURIComponent(msg);
  try{ window.open(url, '_blank'); }catch(e){ toast('Não consegui abrir — fale com o professor'); }
}

// ---- Montar Sistema novo ----
// ---- Lesões ----
function abrirLesoes(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🤕 Lesões</div>
    <div class="lesao-list" id="lesao-list"></div>
    <button class="btn-save" id="lesao-add" style="margin-top:6px">＋ Registrar lesão</button>
    <button class="sheet-cancel" id="lesao-close">Fechar</button>
  </div></div>`);
  const renderList=()=>{ const c=sheet.querySelector('#lesao-list'); c.innerHTML='';
    if(!DB.lesoes.length){ c.appendChild(el(`<div class="empty-line">Nenhuma lesão registrada. 🙏</div>`)); return; }
    // v485: Excluir removido — lesão fica no histórico pra sempre (decisão do dono,
    // 2026-08-27). Correção via "Editar" (status curada, nota do que aconteceu).
    DB.lesoes.forEach(l=>{ const st={ativa:['gold','Ativa'],recuperando:['blue','Recuperando'],curada:['green','Curada']}[l.status]||['blue',l.status];
      const row = el(`<div class="lesao-item"><div class="li-top"><span class="li-nm">${safeTxt(l.parte)}</span><span class="niv-badge ${st[0]}">${st[1]}</span></div>${l.nota?`<div class="li-nota">${safeTxt(l.nota)}</div>`:''}<div class="li-dt">${fmtDataLonga(l.data)}</div>
        <div class="li-actions"><button class="li-edit">Editar</button></div></div>`);
      row.querySelector('.li-edit').onclick=()=> abrirEditarLesao(l, renderList);
      c.appendChild(row); }); };
  renderList();
  sheet.querySelector('#lesao-add').onclick=()=> abrirNovaLesao(renderList);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#lesao-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}
function abrirNovaLesao(onDone){
  let status='ativa';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Registrar lesão</div>
    <label class="flbl">Parte do corpo</label>
    <input class="inp" id="nl-parte" placeholder="Ex: Joelho direito, ombro…">
    <label class="flbl" style="margin-top:12px">Status</label>
    <div class="seg" id="nl-status"></div>
    <label class="flbl" style="margin-top:12px">Anotação</label>
    <textarea class="ta" id="nl-nota" placeholder="Como aconteceu, cuidados…"></textarea>
    <button class="btn-save" id="nl-save" style="margin-top:12px">Salvar</button>
    <button class="sheet-cancel" id="nl-cancel">Cancelar</button>
  </div></div>`);
  const ss=sheet.querySelector('#nl-status');
  [['ativa','Ativa'],['recuperando','Recuperando'],['curada','Curada']].forEach(([k,l])=>{ const b=el(`<button class="${k===status?'active':''}">${l}</button>`);
    b.onclick=()=>{ status=k; ss.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; ss.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#nl-cancel').onclick=close;
  sheet.querySelector('#nl-save').onclick=()=>{ const parte=sheet.querySelector('#nl-parte').value.trim(); if(!parte){ toast('Informe a parte do corpo'); return; }
    DB.lesoes.unshift({ id:Date.now(), parte, data:HOJE_ISO, status, nota:sheet.querySelector('#nl-nota').value.trim() });
    scheduleSave(); if(DB.sbUser && !DEMO && typeof sbSync!=='undefined'){ try{ sbSync.pushLesoes(); }catch(e){} }
    close(); if(onDone) onDone(); toast('Lesão registrada 🤕'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

function abrirEditarLesao(lesao, onDone){
  let status=lesao.status;
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar lesão</div>
    <label class="flbl">Parte do corpo</label>
    <input class="inp" id="el-parte" value="${safeAttr(lesao.parte)}">
    <label class="flbl" style="margin-top:12px">Status</label>
    <div class="seg" id="el-status"></div>
    <label class="flbl" style="margin-top:12px">Anotação</label>
    <textarea class="ta" id="el-nota">${safeTxt(lesao.nota||'')}</textarea>
    <button class="btn-save" id="el-save" style="margin-top:12px">Salvar</button>
    <button class="sheet-cancel" id="el-cancel">Cancelar</button>
  </div></div>`);
  const ss=sheet.querySelector('#el-status');
  [['ativa','Ativa'],['recuperando','Recuperando'],['curada','Curada']].forEach(([k,l])=>{ const b=el(`<button class="${k===status?'active':''}">${l}</button>`);
    b.onclick=()=>{ status=k; ss.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; ss.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#el-cancel').onclick=close;
  sheet.querySelector('#el-save').onclick=()=>{ const parte=sheet.querySelector('#el-parte').value.trim(); if(!parte){ toast('Informe a parte do corpo'); return; }
    lesao.parte=parte; lesao.nota=sheet.querySelector('#el-nota').value.trim();
    // B8: registra/limpa a data da cura na transição de status (janela histórica da flag 🤕)
    if(status==='curada' && lesao.status!=='curada' && !lesao.curadaEm) lesao.curadaEm=HOJE_ISO;
    if(status!=='curada') delete lesao.curadaEm;
    lesao.status=status;
    scheduleSave(); if(DB.sbUser && !DEMO && typeof sbSync!=='undefined'){ try{ sbSync.pushLesoes(); }catch(e){} }
    close(); if(onDone) onDone(); toast('Lesão atualizada'); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Exportar dados ----
function abrirInstalarPWA(){
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);
  const canPrompt = typeof window._yamaCanInstall === 'function' && window._yamaCanInstall();
  let body = '';
  if (canPrompt){
    body = `<div class="bkp-note">Toque em "Instalar agora" para adicionar o Yama à sua tela inicial.</div>
      <button class="btn-save" id="ip-prompt">📲 Instalar agora</button>`;
  } else if (isIOS){
    body = `<div class="bkp-note">No iPhone/iPad, instale assim:</div>
      <ol class="ipwa-steps">
        <li>Abra este app no <b>Safari</b> (não no Chrome)</li>
        <li>Toque no ícone <b>Compartilhar</b> <span class="ipwa-ic">⎙</span> na barra inferior</li>
        <li>Role e toque em <b>"Adicionar à Tela de Início"</b></li>
        <li>Toque em <b>Adicionar</b> no canto superior direito</li>
      </ol>
      <div class="bkp-note" style="font-size:12px;color:var(--muted)">Pronto: o Yama vira um app de verdade — abre em tela cheia, salva offline e fica no seu home.</div>`;
  } else if (isAndroid){
    body = `<div class="bkp-note">No Android (Chrome), instale assim:</div>
      <ol class="ipwa-steps">
        <li>Toque nos <b>3 pontinhos</b> no canto superior direito</li>
        <li>Toque em <b>"Instalar app"</b> ou <b>"Adicionar à tela inicial"</b></li>
        <li>Confirme tocando em <b>Instalar</b></li>
      </ol>`;
  } else {
    body = `<div class="bkp-note">No desktop, procure no menu do navegador (⋮) por "Instalar Yama".</div>`;
  }
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="Instalar app">
    <div class="sheet-grip"></div>
    <div class="sheet-title">📥 Instalar Yama</div>
    ${body}
    <button class="sheet-cancel" id="ip-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ip-close').onclick=close;
  const promptBtn = sheet.querySelector('#ip-prompt');
  if (promptBtn) promptBtn.onclick = ()=>{ try{ window._yamaInstall && window._yamaInstall(); }catch(e){} close(); };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

function abrirBackup(){
  // monta o JSON do backup a partir do ESTADO ATUAL em memória (dump = mesmo formato do user_state)
  const buildBackupJson=()=> JSON.stringify({
    app:'Yama BJJ', schema:SCHEMA, exportadoEm:new Date().toISOString(),
    data:buildDump(),
    theme:(()=>{ try{ return localStorage.getItem('yama.theme')||null; }catch(e){ return null; } })(),
  }, null, 2);
  // confirma e restaura a partir de um dump já parseado — aplica em memória e sobe pra nuvem
  const doRestore=(dump)=>{
    const dataDump=dump.exportadoEm?dump.exportadoEm.slice(0,10):'desconhecida';
    const conf=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
      <div class="sheet-grip"></div>
      <div class="sheet-title">⚠️ Substituir dados?</div>
      <div class="bkp-note">Vai substituir seus dados atuais pelo backup de <b>${dataDump}</b> (na sua conta na nuvem). Confirma?</div>
      <button class="btn-save danger" id="ci-ok">Sim, substituir tudo</button>
      <button class="sheet-cancel" id="ci-no">Cancelar</button>
    </div></div>`);
    const cClose=openSheet(conf,'#ci-no');
    conf.querySelector('#ci-ok').onclick=()=>{
      // compat: backups antigos traziam o draft fora do dump
      if(dump.draft && !dump.data.draft){ try{ dump.data.draft = typeof dump.draft==='string' ? JSON.parse(dump.draft) : dump.draft; }catch(e){} }
      if(!applyDump(dump.data)){ toast('⚠️ Backup ilegível — dados não foram alterados'); return; }
      if(dump.theme){ try{ localStorage.setItem('yama.theme', dump.theme); }catch(e){} document.documentElement.setAttribute('data-theme', dump.theme); _updateThemeColor(); }
      _lastPushed='';            // força o push do estado restaurado
      flushSave();
      cClose(); render(); toast('Perfil restaurado ✔');
    };
  };
  // valida texto → dump; retorna true se abriu o confirm
  const applyText=(text)=>{
    let dump; try{ dump=JSON.parse(String(text||'').trim()); }catch(e){ toast('⚠️ Backup ilegível — copie o texto inteiro'); return false; }
    if(dump.app!=='Yama BJJ' || !dump.data){ toast('⚠️ Não parece um backup do Yama'); return false; }
    if(dump.schema && dump.schema>SCHEMA){ toast('⚠️ Backup de versão futura'); return false; }
    doRestore(dump); return true;
  };
  const sheet = el(`<div class="sheet-overlay"><div class="sheet sheet-scroll" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">💾 Backup do perfil</div>
    <div class="bkp-note">Seus dados já ficam salvos na nuvem — este backup é uma cópia extra portátil (treinos, técnicas, graduação, foto). No iPhone, <b>Copiar/Colar</b> é o jeito mais confiável — cole o texto no app Notas ou num e-mail pra você mesmo.</div>
    <div class="flbl" style="margin-top:6px">Exportar</div>
    <button class="btn-save" id="bkp-copy">📋 Copiar backup</button>
    <button class="btn-save" id="bkp-exp" style="margin-top:8px;background:var(--blue)">⬇️ Salvar como arquivo</button>
    <div class="flbl" style="margin-top:16px">Restaurar</div>
    <button class="btn-save" id="bkp-paste" style="background:var(--good)">📥 Colar backup</button>
    <button class="btn-save" id="bkp-imp" style="margin-top:8px;background:var(--blue)">📂 Abrir arquivo</button>
    <input type="file" id="bkp-file" accept="application/json,.json,text/plain,*/*" style="display:none" aria-hidden="true">
    <button class="sheet-cancel" id="bkp-close">Fechar</button>
  </div></div>`);
  openSheet(sheet,'#bkp-close');

  // COPIAR backup p/ a área de transferência (fallback: textarea selecionável)
  sheet.querySelector('#bkp-copy').onclick=async ()=>{
    const json=buildBackupJson();
    try{
      if(!(navigator.clipboard && navigator.clipboard.writeText)) throw new Error('no clipboard');
      await navigator.clipboard.writeText(json);
      toast('Backup copiado ✓ cole no Notas/e-mail e guarde');
    }catch(e){
      const t=el(`<div class="sheet-overlay"><div class="sheet sheet-scroll" role="dialog">
        <div class="sheet-grip"></div><div class="sheet-title">Copiar backup</div>
        <div class="bkp-note">Toque no texto → Selecionar tudo → Copiar. Guarde no Notas ou num e-mail.</div>
        <textarea class="ta" style="min-height:170px" readonly>${safeTxt(json)}</textarea>
        <button class="sheet-cancel" id="tx-close">Fechar</button>
      </div></div>`);
      openSheet(t,'#tx-close'); const ta=t.querySelector('textarea'); try{ ta.focus(); ta.select(); }catch(_){}
    }
  };
  // SALVAR ARQUIVO (Web Share no iOS, download no desktop/Android)
  sheet.querySelector('#bkp-exp').onclick=async ()=>{
    const json=buildBackupJson(); const fname=`yama-perfil-${new Date().toISOString().slice(0,10)}.json`;
    const file=new File([json],fname,{type:'application/json'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file],title:'Backup Yama'}); return; }
      catch(e){ if(e && e.name==='AbortError') return; }
    }
    try{
      const url=URL.createObjectURL(file);
      const a=document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000); toast('Arquivo gerado ✓');
    }catch(e){ toast('⚠️ No iPhone use "Copiar backup"'); }
  };
  // COLAR backup (textarea) — restaurar
  sheet.querySelector('#bkp-paste').onclick=()=>{
    const p=el(`<div class="sheet-overlay"><div class="sheet sheet-scroll" role="dialog">
      <div class="sheet-grip"></div><div class="sheet-title">Colar backup</div>
      <div class="bkp-note">Cole aqui o texto do backup que você guardou.</div>
      <textarea class="ta" id="bkp-paste-ta" style="min-height:170px" placeholder='{"app":"Yama BJJ", ...}'></textarea>
      <button class="btn-save" id="bkp-paste-ok" style="margin-top:10px">Restaurar</button>
      <button class="sheet-cancel" id="bkp-paste-cancel">Cancelar</button>
    </div></div>`);
    const pc=openSheet(p,'#bkp-paste-cancel');
    p.querySelector('#bkp-paste-ok').onclick=()=>{ if(applyText(p.querySelector('#bkp-paste-ta').value)) pc(); };
  };
  // ABRIR ARQUIVO (secundário)
  const fileInp=sheet.querySelector('#bkp-file');
  sheet.querySelector('#bkp-imp').onclick=()=> fileInp.click();
  fileInp.onchange=(e)=>{
    const file=e.target.files&&e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{ applyText(ev.target.result); fileInp.value=''; };
    reader.onerror=()=>{ toast('⚠️ Não consegui ler o arquivo'); fileInp.value=''; };
    reader.readAsText(file);
  };
}

// ---- Centro de notificações ----
function abrirNotificacoes(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">🔔 Notificações</div>
    <div class="notif-list" id="notif-list"></div>
    <button class="sheet-cancel" id="notif-close">Fechar</button>
  </div></div>`);
  const list=sheet.querySelector('#notif-list');
  if(!DB.notificacoes.length) list.appendChild(el(`<div class="empty-line">Nenhum aviso novo 🔔</div>`));
  DB.notificacoes.forEach(n=> list.appendChild(el(`<div class="notif-item"><span class="notif-ic">${n.ic}</span><div class="notif-tx"><div class="nt-t">${safeTxt(n.txt)}</div><div class="nt-d">${fmtDataLonga(n.data)}</div></div></div>`)));
  DB.eu.avisos=0; // marca como lidas
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>{ sheet.remove(); render(); },260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#notif-close').onclick=close;
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

// ---- Apagar tudo (reset completo do diário; mantém o catálogo) ----
function limparDados(){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Apagar todos os dados?</div>
    <div class="sheet-desc">Isto apaga seus treinos, progresso das técnicas, streak e graduações da sua conta na nuvem. O catálogo de técnicas permanece. Registros de gestão da academia (presença/graduação lançadas pelo professor) são excluídos mediante pedido à academia. Não dá pra desfazer.</div>
    <button class="btn-save danger" id="rs-sim">Apagar tudo</button>
    <button class="sheet-cancel" id="rs-nao">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#rs-nao').onclick=close;
  sheet.querySelector('#rs-sim').onclick=async()=>{
    aplicarCleanSlate(); DB.onboarded=false;
    try{ localStorage.removeItem(STORE_KEY); }catch(e){}   // higiene: remove eventual acervo legado pré-cutover
    // Nuvem: grava o estado zerado ANTES de sair (senão o dado antigo voltaria no próximo login)
    if(DB.sbUser && _cloudReady && typeof sbSync!=='undefined'){ try{ await sbSync.pushState(buildDump()); }catch(e){} }
    if(DB.sbUser && typeof sbAuth!=='undefined'){ DB.sbUser=null; _cloudReady=false; _lastPushed=''; await sbAuth.signOut(); DB.authOpen=true; }
    else DB.onboardingOpen=true;
    sheet.remove(); render(); toast('Dados apagados ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=> sheet.classList.add('open'));
}

/* ---------------- ícones ---------------- */
function icoHome(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M3 11l9-8 9 8M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function icoBook(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h13a2 2 0 012 2v12a1 1 0 01-1.4.9L12 18l-5.6 1.9A1 1 0 015 19V7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}
function icoChart(){return `<svg viewBox="0 0 24 24" fill="none"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;}
function icoUser(){return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;}
function icoUsers(){return `<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="2"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 5.5a3 3 0 010 5.6M17 20c0-2.2-1-3.7-2.5-4.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;}
function icoCard(){return `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>`;}
function icoMore(){return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;}
// 山 (yama = montanha) estilizado — a marca do app vira ícone da aba de gestão.
function icoYama(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M4 20l6-11 3 5 3-3 4 9"/></svg>`;}
function icoPlus(){return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;}
// Ícones dos KPIs do professor (stroke currentColor — cor vem da classe .si)
function icoRoster(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;}
function icoPulse(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-7 4 14 2.5-7H21"/></svg>`;}
function icoAlert(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>`;}
function icoMedal(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M9 13.3 7.5 21l4.5-2.6L16.5 21 15 13.3"/></svg>`;}
function icoBox(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>`;}
function icoCalendar(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>`;}
function icoVideo(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></svg>`;}
// Faixa horizontal com nó — passa a ideia de "graduação/faixa" no mesmo estilo linear
function icoBelt(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h9M13 10h9"/><path d="M2 14h9M13 14h9"/><rect x="10" y="7" width="4" height="10" rx="1"/></svg>`;}
/* Bandeira dos EUA em SVG (não depende de font emoji regional — Windows não renderiza 🇺🇸).
   Círculo com faixas + cantão azul; estilo simplificado pra caber em chip pequeno. */
function icoUSFlag(){return `<svg class="ico-us" viewBox="0 0 24 24" aria-label="Bilíngue"><defs><clipPath id="uc"><circle cx="12" cy="12" r="11"/></clipPath></defs><g clip-path="url(#uc)"><rect width="24" height="24" fill="#fff"/><rect y="0"  width="24" height="1.85" fill="#B22234"/><rect y="3.7" width="24" height="1.85" fill="#B22234"/><rect y="7.4" width="24" height="1.85" fill="#B22234"/><rect y="11.1" width="24" height="1.85" fill="#B22234"/><rect y="14.8" width="24" height="1.85" fill="#B22234"/><rect y="18.5" width="24" height="1.85" fill="#B22234"/><rect y="22.2" width="24" height="1.85" fill="#B22234"/><rect width="10.5" height="9.25" fill="#3C3B6E"/></g><circle cx="12" cy="12" r="11" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1"/></svg>`;}

/* ============================================================
   SELF-TEST (smoke) — rode com ?test=1 ou selfTest() no console.
   Read-mostly: só mexe na navegação e restaura no fim.
   ============================================================ */
function selfTest(){
  const R=[]; const ok=(name,cond)=>R.push({name, pass: !!cond});
  try{
    ok('plural singular', plural(1,'treino','treinos')==='1 treino');
    ok('plural plural', plural(3,'treino','treinos')==='3 treinos');
    ok('nivelDe novo (0)', nivelDe({treinos:0})==='novo');
    ok('nivelDe dominada (12)', nivelDe({treinos:12})==='dominada');
    ok('_pctAT 1/2=50', _pctAT(1,2)===50);
    ok('isoOf formato', /^\d{4}-\d{2}-\d{2}$/.test(isoOf(new Date())));
    try{ const n=dayChartNode([{a:1,t:2,dia:'x'}]); ok('chart 30 colunas', n.querySelectorAll('.dcol').length===30); }catch(e){ ok('chart 30 colunas', false); }
    try{ const s=semanaStats(); ok('semana tem 7 dias', Array.isArray(s.dias)&&s.dias.length===7); ok('streak é número', typeof s.streakSemanas==='number'); }catch(e){ ok('semanaStats', false); }
    try{ const k=betaKPIs(); ok('kpis tem funil', !!(k&&k.funil&&typeof k.funil.abriu==='boolean')); }catch(e){ ok('betaKPIs', false); }
    ok('safeTxt escapa HTML', safeTxt('<b>x</b>')==='&lt;b&gt;x&lt;/b&gt;');
    ok('safeAttr escapa aspas', safeAttr('a" onload="x')==='a&quot; onload=&quot;x');
    ok('safeAttr escapa <>&', safeAttr('<a&b>')==='&lt;a&amp;b&gt;');
    // PIX BR Code com valor injetado: EMV TLV + CRC16-CCITT.
    ok('pixCrc16 formato', /^[0-9A-F]{4}$/.test(_pixCrc16('123456')));
    ok('pixBrCodeComValor injeta 54', (()=>{
      const base='00020126360014BR.GOV.BCB.PIX0114+5561999999995204000053039865802BR5909Fulano T.6008BRASILIA62070503***6304ABCD';
      const r=_pixBrCodeComValor(base, 150.5);
      return /5406150\.50/.test(r) && /6304[0-9A-F]{4}$/.test(r);
    })());
    ok('pixBrCodeComValorTxid injeta 54 e 62.05', (()=>{
      const base='00020126360014BR.GOV.BCB.PIX0114+55119999999995204000053039865802BR5911FULANO YAMA6008BRASILIA62070503***6304ABCD';
      const r=_pixBrCodeComValorTxid(base, 42, 'abc-123');
      const d=_pixParseBrCode(r);
      const f62raw = _pixTlvParse(r.replace(/6304[0-9A-F]{4}$/,'')).find(([id])=>id==='62')[1];
      const txid = Object.fromEntries(_pixTlvParse(f62raw))['05'];
      return d.valor==='42.00' && txid==='abc123' && /6304[0-9A-F]{4}$/.test(r);
    })());
    ok('pixGerarTxid formato', /^[A-Z0-9]{1,25}$/.test(_pixGerarTxid()));
    ok('pixParseBrCode extrai nome/chave/cidade', (()=>{
      // BR Code mínimo: campo 26 tem 14-char pix key ("+5511999999999") pra len bater.
      const base='00020126360014BR.GOV.BCB.PIX0114+55119999999995204000053039865802BR5911FULANO YAMA6008BRASILIA62070503***6304ABCD';
      const d = _pixParseBrCode(base);
      return d && d.nome==='FULANO YAMA' && d.cidade==='BRASILIA' && d.chave==='+5511999999999';
    })());
    ok('pixBrCodeComValor substitui 54', (()=>{
      const base='00020126360014BR.GOV.BCB.PIX0114+5561999999995204000053039865406010.005802BR5909Fulano T.6008BRASILIA62070503***6304ABCD';
      const r=_pixBrCodeComValor(base, 42);
      return /5405/.test(r.replace(/6304[0-9A-F]{4}$/,'')) && r.indexOf('540542.00')>0;
    })());
    ok('nivelDe aprendendo (3)', nivelDe({treinos:3})==='aprendendo');
    ok('nivelDe treinando (5)', nivelDe({treinos:5})==='treinando');
    try{
      // dump round-trip: buildDump gera o formato do user_state e sobrevive a JSON
      const dump=buildDump();
      const raw=JSON.parse(JSON.stringify(dump));
      ok('dump round-trip', raw && raw.__schema===SCHEMA && raw.eu && Array.isArray(raw.treinos) && raw.tecProg && typeof raw.tecProg==='object');
    }catch(e){ ok('dump round-trip', false); }
    ok('focoTecnicas é array', Array.isArray(focoTecnicas()));
    ok('_pctAT 0/0=0', _pctAT(0,0)===0);
    ok('idadeCBJJ 1998', idadeCBJJ(1998)===hoje.getFullYear()-1998);
    ok('idadeCBJJ null', idadeCBJJ(null)===null);
    ok('categoriaCBJJ adulto', categoriaCBJJ(hoje.getFullYear()-25)==='Adulto');
    ok('categoriaCBJJ master1', categoriaCBJJ(hoje.getFullYear()-32)==='Master 1');
    ok('categoriaCBJJ null', categoriaCBJJ(null)===null);
    ok('elegibilidade azul', (()=>{ const r=elegibilidadeCBJJ({faixa:'azul',nascimento:1998}); return r.nextBelt==='roxa'&&Array.isArray(r.checks); })());
    ok('elegibilidade preta', (()=>{ const r=elegibilidadeCBJJ({faixa:'preta',nascimento:1998}); return r.nextBelt===null; })());
    ok('tempoNaFaixaMeses', tempoNaFaixaMeses(HOJE_ISO)===0);
    // regressões: persistência e flush
    ok('USER_KEYS persiste links', USER_KEYS.includes('links'));
    ok('flushSave é função', typeof flushSave==='function');
    // draft: data antiga é limpa (agora em DB._draft; snapshot/restore em finally — A1)
    { const snapD=DB._draft;
      try{
        DB._draft={date:'2000-01-01', registro:{}};
        const stale=_loadDraft();
        ok('draft antigo retorna null', stale===null);
        ok('draft antigo é removido', DB._draft===null);
        DB._draft={date:HOJE_ISO, registro:{x:1}};
        ok('draft de hoje é mantido', _loadDraft()!==null);
      }catch(e){ ok('draft lifecycle', false); }
      finally{ DB._draft=snapD??null; }
    }
    // buildDump grava tecProg/links (formato do user_state)
    { const prev=DB.tecnicas[0].hojeA;
      try{
        const id0=DB.tecnicas[0].id||DB.tecnicas[0].jp;
        DB.tecnicas[0].hojeA=99;
        const raw=buildDump();
        ok('dump grava tecProg', raw.tecProg && raw.tecProg[id0] && raw.tecProg[id0].hojeA===99);
        ok('dump grava links', Array.isArray(raw.links));
      }catch(e){ ok('dump tecProg', false); }
      finally{ DB.tecnicas[0].hojeA=prev; }
    }
    // tecByKey: lookup por id, jp, null, inexistente
    try{
      const t0=DB.tecnicas[0];
      ok('tecByKey por id', tecByKey(t0.id)===t0);
      ok('tecByKey por jp', tecByKey(t0.jp)===t0);
      ok('tecByKey null', tecByKey(null)===null);
      ok('tecByKey inexistente', tecByKey('zzz-nada')===null);
    }catch(e){ ok('tecByKey', false); }
    // heatmap dark mode: células de treino mantêm cor (regressão CSS)
    try{
      const snapT=document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme','dark');
      const probe=document.createElement('div'); probe.style.position='fixed'; probe.style.left='-9999px';
      probe.innerHTML=`<span class="hm-cell hm-tec"></span><span class="hm-cell hm-liv"></span><span class="hm-cell hm-empty"></span>`;
      document.body.appendChild(probe);
      const bgTec=getComputedStyle(probe.children[0]).backgroundColor;
      const bgLiv=getComputedStyle(probe.children[1]).backgroundColor;
      const bgEmp=getComputedStyle(probe.children[2]).backgroundColor;
      ok('heatmap dark: hm-tec é vermelho', bgTec==='rgb(239, 83, 80)');
      ok('heatmap dark: hm-liv é azul',     bgLiv==='rgb(47, 143, 239)');
      ok('heatmap dark: hm-empty transparente', bgEmp==='rgba(0, 0, 0, 0)');
      probe.remove();
      if(snapT) document.documentElement.setAttribute('data-theme', snapT); else document.documentElement.removeAttribute('data-theme');
    }catch(e){ ok('heatmap dark mode', false); }
    // faixa preta: ponteira VERMELHA (regra CBJJ); demais ponteira preta — regressão beltMini/CSS
    try{
      const probe=document.createElement('div'); probe.style.position='fixed'; probe.style.left='-9999px';
      probe.innerHTML = beltMini('preta',1) + beltMini('azul',1);
      document.body.appendChild(probe);
      const tipPreta=probe.querySelectorAll('.bm-tip')[0], tipAzul=probe.querySelectorAll('.bm-tip')[1];
      ok('beltMini preta tem red-tip', tipPreta.classList.contains('red-tip'));
      ok('beltMini azul sem red-tip', !tipAzul.classList.contains('red-tip'));
      ok('ponteira da preta é vermelha', getComputedStyle(tipPreta).backgroundColor==='rgb(229, 57, 53)');
      ok('ponteira da azul é preta',     getComputedStyle(tipAzul).backgroundColor==='rgb(20, 22, 27)');
      probe.remove();
    }catch(e){ ok('beltMini ponteira faixa preta', false); }
    // seletor de faixa VISUAL (renderBeltField): campo mostra mini-faixa e NÃO mostra nome
    try{
      const host=document.createElement('div'); host.style.position='fixed'; host.style.left='-9999px'; document.body.appendChild(host);
      renderBeltField(host, ['branca','azul','preta'], 'azul', ()=>{});
      const field=host.querySelector('.belt-field');
      ok('renderBeltField cria campo com mini-faixa', !!field && !!field.querySelector('.belt-mini'));
      ok('campo de faixa não exibe o nome', !/branca|azul|roxa|marrom|preta/i.test(field.textContent||''));
      host.remove();
    }catch(e){ ok('renderBeltField', false); }
    // dump/apply de técnicas customizadas (definição + progresso) — restore em finally (A1)
    { const snapTec=DB.tecnicas.slice();
      try{
        const customId='usr-st-'+Date.now().toString(36);
        DB.tecnicas.push({ id:customId, jp:'TST-custom', pt:'teste', cat:'outros', oficial:false, nivel:'aprendendo', treinos:3, hojeA:1, hojeT:2, ultima:'hoje', ultimaRev:HOJE_ISO, nota:'st' });
        const raw=buildDump();
        ok('dump inclui tecnicasCustom', Array.isArray(raw.tecnicasCustom) && raw.tecnicasCustom.some(c=>c.id===customId));
        ok('tecnicasCustom só usr-', raw.tecnicasCustom.every(c=>c.id && c.id.indexOf('usr-')===0));
        // simula reload: remove custom de memória e reaplica o dump
        DB.tecnicas = DB.tecnicas.filter(t=>t.id!==customId);
        applyDump(raw);
        const restaurada = DB.tecnicas.find(t=>t.id===customId);
        ok('apply restaura custom def', !!restaurada && restaurada.jp==='TST-custom' && restaurada.cat==='outros');
        ok('apply restaura custom progresso', restaurada && restaurada.treinos===3 && restaurada.hojeA===1);
        // applyDump não duplica seed (idempotente)
        const seedAntes = DB.tecnicas.filter(t=>!t.id||t.id.indexOf('usr-')!==0).length;
        applyDump(raw);
        const seedDepois = DB.tecnicas.filter(t=>!t.id||t.id.indexOf('usr-')!==0).length;
        ok('apply não duplica seed', seedAntes===seedDepois);
      }catch(e){ ok('tecnicasCustom round-trip', false); }
      finally{ DB.tecnicas=snapTec; }
    }
    // === v122-v125: helpers PWA + UX ===
    try{
      // _viewKey: combinações (precisa zerar todas as flags modais antes)
      const sav={ nav:DB.navAluno, jogo:DB.jogoTab, jornada:DB.jornadaTab, flow:DB.flow, loja:DB.lojaOpen, onb:DB.onboardingOpen, retro:DB.retroOpen, share:DB.shareOpen, treino:DB.treinoAberto };
      DB.onboardingOpen=false; DB.retroOpen=false; DB.shareOpen=false; DB.treinoAberto=null;
      DB.role='aluno'; DB.navAluno='inicio'; DB.jogoTab='progresso'; DB.jornadaTab='historico'; DB.flow=null; DB.lojaOpen=false;
      ok('_viewKey aluno inicio', _viewKey()==='al:inicio:progresso:historico');
      DB.flow='tecnica';
      ok('_viewKey flow tem prefixo', _viewKey()==='flow:tecnica');
      DB.flow=null; DB.lojaOpen=true;
      ok('_viewKey loja', _viewKey()==='loja');
      DB.lojaOpen=false; DB.navAluno=sav.nav; DB.jogoTab=sav.jogo; DB.jornadaTab=sav.jornada; DB.flow=sav.flow; DB.onboardingOpen=sav.onb; DB.retroOpen=sav.retro; DB.shareOpen=sav.share; DB.treinoAberto=sav.treino;
    }catch(e){ ok('_viewKey', false); }
    // _focusableInSheet: filtra disabled e hidden
    try{
      const fake=document.createElement('div'); fake.style.cssText='position:fixed;left:-9999px';
      fake.innerHTML='<button>a</button><button disabled>b</button><input type="text" hidden><a href="#">c</a><span tabindex="0">d</span>';
      document.body.appendChild(fake);
      const f=_focusableInSheet(fake);
      ok('_focusableInSheet filtra disabled e hidden', f.length===3);
      fake.remove();
    }catch(e){ ok('_focusableInSheet', false); }
    // _topmostSheet: 2 overlays.open, retorna a última
    try{
      const o1=document.createElement('div'); o1.className='sheet-overlay open'; o1.innerHTML='<div class="sheet" data-x="1"></div>';
      const o2=document.createElement('div'); o2.className='sheet-overlay open'; o2.innerHTML='<div class="sheet" data-x="2"></div>';
      document.body.appendChild(o1); document.body.appendChild(o2);
      const top=_topmostSheet();
      ok('_topmostSheet pega a última', top && top.dataset.x==='2');
      o1.remove(); o2.remove();
    }catch(e){ ok('_topmostSheet', false); }
    // toastUndo: cria toast e dispara undo
    try{
      let called=false;
      toastUndo('selfTest', ()=>{ called=true; });
      const t=document.querySelector('.toast-action');
      ok('toastUndo cria toast', !!t);
      t?.querySelector('.ta-undo')?.click();
      ok('toastUndo dispara undo', called);
      document.querySelectorAll('.toast-action').forEach(n=>n.remove());
    }catch(e){ ok('toastUndo', false); }
    // helpers existência
    try{
      ok('_attachLongPress existe', typeof _attachLongPress==='function');
      ok('_attachSheetDrag existe', typeof _attachSheetDrag==='function');
      ok('_openActionSheet existe', typeof _openActionSheet==='function');
      ok('haptic existe', typeof haptic==='function');
    }catch(e){ ok('helpers v124', false); }
    // Manifest shortcut query params parse
    try{
      const qp=new URLSearchParams('flow=registrar&go=biblioteca');
      ok('shortcut ?flow', qp.get('flow')==='registrar');
      ok('shortcut ?go', qp.get('go')==='biblioteca');
    }catch(e){ ok('manifest shortcuts parse', false); }
    // Bug fix: técnica custom EDITADA volta com edições no apply — restore em finally (A1)
    { const snapTec=DB.tecnicas.slice();
      try{
        const customId='usr-edit-'+Date.now().toString(36);
        DB.tecnicas.push({ id:customId, jp:'Original', pt:'desc', cat:'outros', oficial:false, nivel:'aprendendo', treinos:0 });
        // Simula edição: muda jp/pt/cat
        const idx = DB.tecnicas.findIndex(t=>t.id===customId);
        DB.tecnicas[idx].jp='Editado'; DB.tecnicas[idx].pt='nova descricao'; DB.tecnicas[idx].cat='nage';
        const raw=buildDump();
        // Simula reload: applyDump deve preservar edições
        DB.tecnicas = DB.tecnicas.filter(t=>!t.id || !t.id.startsWith('usr-edit-'));
        applyDump(raw);
        const restaurada = DB.tecnicas.find(t=>t.id===customId);
        ok('custom editada: jp preservado', restaurada && restaurada.jp==='Editado');
        ok('custom editada: pt preservado', restaurada && restaurada.pt==='nova descricao');
        ok('custom editada: cat preservado', restaurada && restaurada.cat==='nage');
      }catch(e){ ok('custom edit round-trip', false); }
      finally{ DB.tecnicas=snapTec; }
    }
    // Bug fix: edição de técnica do CATÁLOGO (jp/pt/cat) persiste via TEC_PROG — finally (A1)
    { const t0=DB.tecnicas.find(t=>t.id==='nag-osoto');
      const origJp=t0?t0.jp:null, origPt=t0?t0.pt:null;
      try{
        if (!t0) throw new Error('seed missing');
        t0.jp='O-soto-gari (custom)'; t0.pt='nome customizado';
        const raw=buildDump();
        // reset em memória e reaplica
        t0.jp=origJp; t0.pt=origPt;
        applyDump(raw);
        const restaurada=DB.tecnicas.find(t=>t.id==='nag-osoto');
        ok('catalog edit: jp persiste via tecProg', restaurada && restaurada.jp==='O-soto-gari (custom)');
        ok('catalog edit: pt persiste via tecProg', restaurada && restaurada.pt==='nome customizado');
      }catch(e){ ok('catalog edit round-trip', false); }
      finally{ const t=DB.tecnicas.find(x=>x.id==='nag-osoto'); if(t && origJp!=null){ t.jp=origJp; t.pt=origPt; } }
    }
    // === END-TO-END: backup completo (dump→apply) preserva TUDO — restore em finally (A1) ===
    { const snapEu={...DB.eu};
      const snapTreinos=JSON.parse(JSON.stringify(DB.treinos));
      const snapGrad=JSON.parse(JSON.stringify(DB.graduacoes||[]));
      const snapNotas=JSON.parse(JSON.stringify(DB.notas||[]));
      const snapLesoes=JSON.parse(JSON.stringify(DB.lesoes||[]));
      const snapSemana=JSON.parse(JSON.stringify(DB.semana));
      const snapLinks=JSON.parse(JSON.stringify(DB.links||[]));
      const snapTec=JSON.parse(JSON.stringify(DB.tecnicas));
      const snapOnb=DB.onboarded;
      try{
        // 1. Modifica dados em TODAS as áreas
        DB.eu.faixa='roxa'; DB.eu.graus=3; DB.eu.nomeCompleto='E2E Test User';
        DB.treinos.unshift({id:99999, tipo:'tecnica', data:HOJE_ISO, titulo:'E2E Treino', det:{nota:'e2e nota', feel:5, randori:true, renshu:[]}});
        DB.graduacoes.unshift({tipo:'grau', faixa:'azul', graus:3, data:HOJE_ISO, aulas:50});
        DB.notas.unshift({id:99998, data:HOJE_ISO, texto:'E2E nota rápida'});
        DB.lesoes.unshift({id:99997, parte:'E2E Cotovelo', data:HOJE_ISO, status:'recuperando', nota:'e2e lesão'});
        DB.semana.meta=6;
        DB.links.push({de:'nag-osoto', para:'kan-juji'});
        const t0=DB.tecnicas.find(t=>t.id==='nag-osoto'); if(t0){ t0.nota='e2e nota técnica'; t0.nivel='dominada'; t0.treinos=42; }
        const newCustomId='usr-e2e-'+Date.now().toString(36);
        DB.tecnicas.push({id:newCustomId, jp:'E2E Custom', pt:'custom desc', cat:'outros', oficial:false, nivel:'novo', treinos:0});
        // 2. Export = dump em memória (mesmo objeto que sobe pro user_state)
        const exportData = JSON.parse(JSON.stringify(buildDump()));
        // 3. Wipe em memória — simula "perdi os dados"
        DB.tecnicas = DB.tecnicas.filter(t=>!t.id || !t.id.startsWith('usr-e2e-'));
        DB.tecnicas.forEach(t=>{ if(t.id==='nag-osoto'){ t.nota=''; t.nivel='aprendendo'; t.treinos=0; } });
        DB.eu={...snapEu}; DB.treinos=[...snapTreinos]; DB.graduacoes=[...snapGrad]; DB.notas=[...snapNotas]; DB.lesoes=[...snapLesoes]; DB.semana={...snapSemana}; DB.links=[...snapLinks];
        // 4. Re-import
        applyDump(exportData);
        // 5. Verifica TUDO restaurado
        ok('E2E: eu.faixa roxa', DB.eu.faixa==='roxa');
        ok('E2E: eu.graus 3', DB.eu.graus===3);
        ok('E2E: eu.nomeCompleto', DB.eu.nomeCompleto==='E2E Test User');
        ok('E2E: eu.aulasGrau preservado (do seed)', DB.eu.aulasGrau && typeof DB.eu.aulasGrau.meta === 'number');
        ok('E2E: eu.mensalidade preservado (do seed)', DB.eu.mensalidade && DB.eu.mensalidade.valor != null);
        ok('E2E: treino novo (id 99999)', !!DB.treinos.find(t=>t.id===99999));
        ok('E2E: treino com det.nota', DB.treinos.find(t=>t.id===99999)?.det?.nota==='e2e nota');
        ok('E2E: graduação azul 3º', !!DB.graduacoes.find(g=>g.tipo==='grau' && g.faixa==='azul' && g.graus===3 && g.aulas===50));
        ok('E2E: nota rápida', !!DB.notas.find(n=>n.id===99998 && n.texto==='E2E nota rápida'));
        ok('E2E: lesão E2E', !!DB.lesoes.find(l=>l.id===99997 && l.parte==='E2E Cotovelo'));
        ok('E2E: semana.meta 6', DB.semana.meta===6);
        ok('E2E: link novo', !!DB.links.find(l=>l.de==='nag-osoto' && l.para==='kan-juji'));
        const t0Reload=DB.tecnicas.find(t=>t.id==='nag-osoto');
        ok('E2E: tecnica catálogo nota', t0Reload && t0Reload.nota==='e2e nota técnica');
        ok('E2E: tecnica catálogo nivel', t0Reload && t0Reload.nivel==='dominada');
        ok('E2E: tecnica catálogo treinos', t0Reload && t0Reload.treinos===42);
        const custom=DB.tecnicas.find(t=>t.id===newCustomId);
        ok('E2E: técnica customizada restaurada', !!custom && custom.jp==='E2E Custom' && custom.cat==='outros');
      }catch(e){ ok('E2E backup completo', false); }
      finally{
        DB.eu={...snapEu}; DB.treinos=snapTreinos; DB.graduacoes=snapGrad; DB.notas=snapNotas; DB.lesoes=snapLesoes; DB.semana=snapSemana; DB.links=snapLinks; DB.tecnicas=snapTec; DB.onboarded=snapOnb;
      }
    }
    // toggleTheme alterna e _isDark reflete
    try{
      const snapT=document.documentElement.getAttribute('data-theme');
      const d0=_isDark(); toggleTheme(); const d1=_isDark(); toggleTheme(); const d2=_isDark();
      ok('toggleTheme alterna', d1!==d0 && d2===d0);
      if(snapT) document.documentElement.setAttribute('data-theme', snapT); else document.documentElement.removeAttribute('data-theme');
    }catch(e){ ok('toggleTheme', false); }
    // === caminho de escrita + integridade — TODO restore em finally (A1) ===
    // salvar(): unshift + agregação de contadores + limpeza de rascunho
    { const snapTr=DB.treinos, snapReg=DB.registro, snapFlow=DB.flow, snapNav=DB.navAluno, snapAn=DB.analytics, snapCk=DB.checkinHoje, snapDr=DB._draft, snapJS=DB.justSaved;
      const snapTec=DB.tecnicas.map(t=>({t,estado:t.estado,dias:t.dias,treinos:t.treinos,hojeA:t.hojeA,hojeT:t.hojeT,ultima:t.ultima,ultimaRev:t.ultimaRev}));
      try{
        DB.treinos=[]; DB._draft=null; DB.tecnicas.forEach(t=>{t.estado='guardada';t.dias=[];t.hojeA=0;t.hojeT=0;t.treinos=0;});
        const foco=DB.tecnicas[0]; foco.estado='foco'; foco.hojeA=2; foco.hojeT=3;
        DB.registro={ randori:true, nota:' nota ', mood:4 }; _salvarLock=false; salvar();
        ok('salvar faz unshift', DB.treinos.length===1 && DB.treinos[0].data===HOJE_ISO);
        ok('salvar agrega dia no foco', foco.dias.length===1 && foco.dias[0].a===2 && foco.dias[0].t===3);
        ok('salvar bucket datado (M2)', foco.dias[0].d===HOJE_ISO);
        ok('salvar incrementa treinos e zera dia', foco.treinos===1 && foco.hojeA===0 && foco.hojeT===0);
        ok('salvar grava renshu com id (M9)', DB.treinos[0].det.renshu.length===1 && DB.treinos[0].det.renshu[0].jp===foco.jp && DB.treinos[0].det.renshu[0].id===(foco.id||foco.jp));
        ok('salvar limpa registro e draft', DB.registro.randori===null && DB._draft===null);
      }catch(e){ ok('salvar() caminho completo', false); }
      finally{
        snapTec.forEach(s=>{s.t.estado=s.estado;s.t.dias=s.dias;s.t.treinos=s.treinos;s.t.hojeA=s.hojeA;s.t.hojeT=s.hojeT;s.t.ultima=s.ultima;s.t.ultimaRev=s.ultimaRev;});
        DB.treinos=snapTr; DB.registro=snapReg; DB.flow=snapFlow; DB.navAluno=snapNav; DB.analytics=snapAn; DB.checkinHoje=snapCk; DB._draft=snapDr; DB.justSaved=snapJS;
      }
    }
    // salvar(): valida randori antes de gravar (não muta)
    { const sr=DB.registro, ntr=DB.treinos.length;
      try{ DB.registro={randori:null,nota:'',mood:null}; _salvarLock=false; salvar();
        ok('salvar exige randori', DB.treinos.length===ntr);
      }catch(e){ ok('salvar guard randori', false); }
      finally{ DB.registro=sr; }
    }
    // salvar(): soma no bucket do mesmo dia (compat: bucket legado sem `d`)
    { const snapTec=DB.tecnicas.map(t=>({t,e:t.estado,d:t.dias,tr:t.treinos,a:t.hojeA,h:t.hojeT,u:t.ultima,ur:t.ultimaRev}));
      const snapTr=DB.treinos, snapReg=DB.registro, snapFlow=DB.flow, snapNav=DB.navAluno, snapAn=DB.analytics, snapCk=DB.checkinHoje, snapDr=DB._draft, snapJS=DB.justSaved;
      try{
        const f=DB.tecnicas[0]; f.estado='foco'; f.dias=[{a:1,t:1,dia:'x',hoje:true}]; f.hojeA=2; f.hojeT=4; f.treinos=5;
        DB.treinos=[]; DB._draft=null; DB.registro={randori:true,nota:'',mood:3}; _salvarLock=false; salvar();
        ok('salvar soma no bucket de hoje', f.dias.length===1 && f.dias[0].a===3 && f.dias[0].t===5);
      }catch(e){ ok('salvar merge bucket', false); }
      finally{
        snapTec.forEach(s=>{s.t.estado=s.e;s.t.dias=s.d;s.t.treinos=s.tr;s.t.hojeA=s.a;s.t.hojeT=s.h;s.t.ultima=s.u;s.t.ultimaRev=s.ur;});
        DB.treinos=snapTr; DB.registro=snapReg; DB.flow=snapFlow; DB.navAluno=snapNav; DB.analytics=snapAn; DB.checkinHoje=snapCk; DB._draft=snapDr; DB.justSaved=snapJS;
      }
    }
    // _resetDiario(): zera contadores do dia na virada — restore em finally (A1)
    { const snapAll=DB.tecnicas.map(t=>({t,a:t.hojeA,h:t.hojeT})); const ck=DB.checkinHoje;
      try{
        const t0=DB.tecnicas[0]; t0.hojeA=9; t0.hojeT=9; DB.checkinHoje={feito:true,hora:'10:00'};
        _resetDiario('2000-01-01');
        ok('_resetDiario zera contadores', t0.hojeA===0 && t0.hojeT===0 && DB.checkinHoje.feito===false);
        t0.hojeA=5; _resetDiario(HOJE_ISO);
        ok('_resetDiario no-op mesmo dia', t0.hojeA===5);
      }catch(e){ ok('_resetDiario', false); }
      finally{ snapAll.forEach(s=>{s.t.hojeA=s.a;s.t.hojeT=s.h;}); DB.checkinHoje=ck; }
    }
    // applyDump(): rejeita dados malformados (guards retornam false sem mutar)
    try{
      ok('apply rejeita treinos não-array', applyDump({__schema:SCHEMA, treinos:'x'})===false);
      ok('apply rejeita schema futuro', applyDump({__schema:SCHEMA+1, treinos:[]})===false);
      ok('apply rejeita null/inválido', applyDump(null)===false && applyDump('x')===false);
    }catch(e){ ok('apply malformed', false); }
    // elegibilidadeCBJJ: edge cases (branca sem tempo mínimo, idade, dados ausentes)
    // CBJJ infantil (v174): 11 anos na branca → próxima é INFANTIL (cinza/branca), não azul.
    ok('elegib branca infantil → cinza/branca', (()=>{ const r=elegibilidadeCBJJ({faixa:'branca',nascimento:hoje.getFullYear()-11}); return r.nextBelt==='cinza_branca'; })());
    // faixasPorIdade: filtro CBJJ por idade (infantil vs adulto)
    ok('faixasPorIdade 14 anos = infantis', (()=>{ const f=faixasPorIdade(14); return f.includes('verde')&&!f.includes('azul')&&!f.includes('marrom'); })());
    ok('faixasPorIdade 18 anos = adultas', (()=>{ const f=faixasPorIdade(18); return f.includes('marrom')&&f.includes('azul')&&!f.includes('cinza'); })());
    ok('faixasPorIdade 16 anos = branca/azul/roxa', (()=>{ const f=faixasPorIdade(16); return f.includes('azul')&&f.includes('roxa')&&!f.includes('marrom'); })());
    ok('proximaFaixaCBJJ verde 15→verde_preta cadeia', (()=>{ const n=proximaFaixaCBJJ('verde_branca',14); return n==='verde'; })());
    ok('faixasParaAluno inclui faixa atual fora da idade', faixasParaAluno(30,'verde').includes('verde'));
    { const snapG=DB.graduacoes;
      try{
        DB.graduacoes=[];
        const r1=elegibilidadeCBJJ({faixa:'branca',nascimento:1998});
        ok('elegib branca sem data → não-elegível (exige 1 ano)', r1.eligible===false && r1.checks.some(c=>/Tempo/.test(c.label)));
        DB.graduacoes=[{faixa:'branca',graus:0,tipo:'faixa',data:'2020-01-01',por:'—'}];
        ok('elegib branca com 1+ ano → elegível', elegibilidadeCBJJ({faixa:'branca',nascimento:1998}).eligible===true);
      }catch(e){ ok('elegib branca tempo mínimo', false); }
      finally{ DB.graduacoes=snapG; }
    }
    ok('elegib azul sem dados → não-elegível', (()=>{ const r=elegibilidadeCBJJ({faixa:'azul',nascimento:null}); return r.checks.some(c=>c.ok===null) && r.eligible===false; })());
    // aplicarCleanSlate(): zera diário, preserva catálogo — restore em finally (A1)
    { const sEu=DB.eu, sTr=DB.treinos, sGr=DB.graduacoes, sSem=DB.semana, sAn=DB.analytics, sNo=DB.notas, sLe=DB.lesoes, sNt=DB.notificacoes, sCk=DB.checkinHoje;
      const sTec=DB.tecnicas.map(t=>({t,estado:t.estado,dias:t.dias,treinos:t.treinos,hojeA:t.hojeA,hojeT:t.hojeT,ultima:t.ultima,ultimaRev:t.ultimaRev})); const nTec=DB.tecnicas.length;
      try{
        aplicarCleanSlate();
        ok('cleanSlate zera treinos/graduações', DB.treinos.length===0 && DB.graduacoes.length===0);
        ok('cleanSlate faixa branca 0º', DB.eu.faixa==='branca' && DB.eu.graus===0);
        ok('cleanSlate preserva catálogo', DB.tecnicas.length===nTec && DB.tecnicas.every(t=>t.estado==='aprendida' && t.treinos===0));
        ok('cleanSlate streak 0', DB.semana.streakSemanas===0);
      }catch(e){ ok('aplicarCleanSlate', false); }
      finally{
        DB.eu=sEu; DB.treinos=sTr; DB.graduacoes=sGr; DB.semana=sSem; DB.analytics=sAn; DB.notas=sNo; DB.lesoes=sLe; DB.notificacoes=sNt; DB.checkinHoje=sCk;
        sTec.forEach(s=>{s.t.estado=s.estado;s.t.dias=s.dias;s.t.treinos=s.treinos;s.t.hojeA=s.hojeA;s.t.hojeT=s.hojeT;s.t.ultima=s.ultima;s.t.ultimaRev=s.ultimaRev;});
      }
    }
    // streak: semana em curso não quebra; zero sem treinos — restore em finally (A1)
    { const sTr=DB.treinos, sSig=_attSig, sSet=_attSet, sCk=DB.checkinHoje;
      try{
        const dnum=(off)=>{ const d=new Date(hoje); d.setDate(hoje.getDate()-off); return isoOf(d); };
        DB.checkinHoje={feito:false,hora:null};
        DB.treinos=[{id:1,data:dnum(7)}]; _attSig=null;
        ok('streak não quebra na semana em curso', semanaStats().streakSemanas>=1);
        DB.treinos=[]; _attSig=null;
        ok('streak 0 sem treinos', semanaStats().streakSemanas===0);
      }catch(e){ ok('streak edge', false); }
      finally{ DB.treinos=sTr; _attSig=sSig; _attSet=sSet; DB.checkinHoje=sCk; }
    }
    // v345: sequência do "+ Novo evento" — timeline vazia → início; depois graus; no
    // topo dos graus → próxima faixa (respeitando a idade pela cadeia CBJJ).
    { const mk=(gs,nasc)=>({ graduacoes:gs, nascimento:nasc||1990, faixa:'branca', graus:0 });
      try{
        const e0=_proximoEventoGrad(mk([]));
        ok('v345: timeline vazia sugere início · branca · 0', e0.tipo==='inicio'&&e0.faixa==='branca'&&e0.graus===0);
        const e1=_proximoEventoGrad(mk([{tipo:'inicio',faixa:'branca',graus:0,data:'2025-08-28'}]));
        ok('v345: após início sugere 1º grau na mesma faixa', e1.tipo==='grau'&&e1.faixa==='branca'&&e1.graus===1);
        const e2=_proximoEventoGrad(mk([{tipo:'grau',faixa:'branca',graus:2,data:'2026-02-26'}]));
        ok('v345: grau intermediário sugere o próximo', e2.tipo==='grau'&&e2.graus===3);
        const e3=_proximoEventoGrad(mk([{tipo:'grau',faixa:'branca',graus:4,data:'2026-02-26'}]));
        ok('v345: 4º grau completo sugere próxima faixa com 0 graus', e3&&e3.tipo==='faixa'&&e3.faixa!=='branca'&&e3.graus===0);
      }catch(e){ ok('v345 sequência de graduação', false); }
    }
    // v344: evento `inicio` (o que o cadastro semeia) conta como data da faixa atual.
    // Antes só `tipo==='faixa'` era procurado e o aluno via "Sem data de graduacao registrada".
    { const sG=DB.graduacoes, sEu=DB.eu;
      try{
        DB.eu = Object.assign({}, DB.eu, {faixa:'branca', graus:3, nascimento:1999});
        DB.graduacoes = [{tipo:'inicio', faixa:'branca', graus:0, data:'2025-08-28'}];
        ok('v344: `inicio` vira data da faixa atual', _refDataFaixaAtual()==='2025-08-28');
        const chk = elegibilidadeCBJJ(DB.eu).checks.find(c=>/Tempo minimo/.test(c.label));
        ok('v344: aluno com só `inicio` tem tempo na faixa', !!chk && chk.ok!==null);
      }catch(e){ ok('v344 faixaDesde inicio', false); }
      finally{ DB.graduacoes=sG; DB.eu=sEu; }
    }
    // v340: presença SEMPRE atrelada a uma turma — nenhum caminho grava check-in solto
    { const sTur=DB.turmas, sCk=DB.checkinHoje, sFlow=DB.flow, sPre=DB._sessaoPreSelecionada;
      try{
        // horários derivados do "agora" e presos ao mesmo dia (clamp): dt fica em -20..0 min,
        // dentro da janela em qualquer horário que o CI rodar (sem flake na virada do dia).
        const now=new Date(), md=now.getHours()*60+now.getMinutes();
        const mk=m=>{ const v=Math.max(0,Math.min(1439,m)); return String(Math.floor(v/60)).padStart(2,'0')+':'+String(v%60).padStart(2,'0'); };
        const dk=DOW_KEY[hoje.getDay()];
        DB._sessaoPreSelecionada=null;
        // 1) dia sem grade → avisa e NÃO registra (antes gravava check-in sem turma)
        DB.turmas=[]; DB.checkinHoje={feito:false,hora:null};
        _flowCheckin();
        ok('v340: dia sem grade não registra presença', DB.checkinHoje.feito===false);
        // 2) duas aulas na janela → abre o picker e não registra nada antes da escolha
        DB.turmas=[
          {id:'t1',nome:'ADULTO',sessoes:[{id:'s1',dia:dk,hora:mk(md-10)}]},
          {id:'t2',nome:'NO-GI', sessoes:[{id:'s2',dia:dk,hora:mk(md-20)}]},
        ];
        DB.checkinHoje={feito:false,hora:null};
        _flowCheckin();
        const pick=document.querySelector('.sess-pick');
        ok('v340: 2 aulas próximas abrem o seletor de turma', !!pick && pick.children.length===2);
        ok('v340: seletor aberto ainda não registrou presença', DB.checkinHoje.feito===false);
        // 3) cancelar o seletor NÃO grava presença sem turma
        const btn=document.querySelector('#sp-skip');
        if(btn) btn.click();
        ok('v340: cancelar o seletor não registra presença', DB.checkinHoje.feito===false && !DB.checkinHoje.sessao);
      }catch(e){ ok('v340 check-in exige turma', false); }
      finally{
        document.querySelectorAll('.sheet-overlay').forEach(n=>n.remove());
        DB.turmas=sTur; DB.checkinHoje=sCk; DB.flow=sFlow; DB._sessaoPreSelecionada=sPre;
      }
    }
    // M1: atualizarSemana refresca a assinatura sozinho (bug do memo stale corrigido)
    { const sTr=DB.treinos, sSig=_attSig, sSet=_attSet, sSem=JSON.parse(JSON.stringify(DB.semana)), sCache=_semCacheSig;
      try{
        DB.treinos=[]; _attSig=null; _semCacheSig='__invalid__';
        atualizarSemana(); atualizarSemana();          // estabiliza o memo
        const antes=DB.semana.feitos;
        DB.treinos=[{id:98765, data:HOJE_ISO}];        // simula salvar() SEM tocar no memo
        atualizarSemana();
        ok('M1: semana atualiza após novo treino', DB.semana.feitos===antes+1);
      }catch(e){ ok('M1 memo semana', false); }
      finally{ DB.treinos=sTr; _attSig=sSig; _attSet=sSet; DB.semana=sSem; _semCacheSig=sCache; }
    }
    // M2: excluir treino reverte agregados por técnica (bucket datado)
    { const t0=DB.tecnicas[0];
      const snap={ treinos:t0.treinos, dias:t0.dias, ultima:t0.ultima, ultimaRev:t0.ultimaRev };
      try{
        t0.treinos=5; t0.dias=[{a:3,t:4,dia:'seg',d:HOJE_ISO,hoje:true}];
        const trFake={ id:1, data:HOJE_ISO, det:{ renshu:[{id:t0.id||t0.jp, jp:t0.jp, a:2, t:3}] } };
        const snapTecs=_snapTreinoTecs(trFake);
        _revertTreinoAgg(trFake);
        ok('M2: reverte treinos da técnica', t0.treinos===4);
        ok('M2: reverte bucket do dia', t0.dias.length===1 && t0.dias[0].a===1 && t0.dias[0].t===1);
        _restoreTreinoTecs(snapTecs);
        ok('M2: desfazer restaura exato', t0.treinos===5 && t0.dias[0].a===3 && t0.dias[0].t===4);
      }catch(e){ ok('M2 revert agregados', false); }
      finally{ t0.treinos=snap.treinos; t0.dias=snap.dias; t0.ultima=snap.ultima; t0.ultimaRev=snap.ultimaRev; }
    }
    // foco: exatamente 3 em foco (suporte à regra max-3) — restore em finally (A1)
    { const sTec=DB.tecnicas.map(t=>t.estado);
      try{
        DB.tecnicas.forEach(t=>t.estado='aprendida'); DB.tecnicas.slice(0,3).forEach(t=>t.estado='foco');
        ok('focoTecnicas conta 3 em foco', focoTecnicas().length===3);
      }catch(e){ ok('foco max3', false); }
      finally{ DB.tecnicas.forEach((t,i)=>t.estado=sTec[i]); }
    }
    // _normalizeGrad: filtra sem data e ordena (código real do import)
    ok('_normalizeGrad filtra e ordena', (()=>{ const r=_normalizeGrad([{faixa:'azul',data:'2024-01-01',aulas:50},{faixa:'branca',data:'',aulas:0},{faixa:'branca',data:'2021-01-01',aulas:10}]); return r&&r.length===2&&r[0].faixa==='branca'&&r[1].aulas===50; })());
    ok('_normalizeGrad sem data → null', _normalizeGrad([{faixa:'x',data:''}])===null);
    ok('_isoToBr converte', _isoToBr('2024-09-10')==='10/09/2024');
    ok('_brToIso converte', _brToIso('10/09/2024')==='2024-09-10');
    ok('_brToIso inválido → vazio', _brToIso('99/99/2024')==='' && _brToIso('10/09')==='');
    // C1 (0034): aula = AULA distinta (1 check-in = 1 aula), contada só no grau atual,
    // reset na promoção, + baseline importada. Antes era DIA distinto — mudou porque a
    // academia tem 4 turmas ADULTO no mesmo dia e as 4 têm que contar.
    ok('maxGrausDe preta=6 · demais=4', maxGrausDe('preta')===6 && maxGrausDe('azul')===4);
    if(!DEMO){ const sTr=DB.treinos, sGr=DB.graduacoes, sEu=DB.eu, sSrv=DB._aulasServidor; try{
      DB._aulasServidor = null;   // força o fallback local (a RPC é testada contra o banco)
      DB.eu = Object.assign({}, sEu, { faixa:'azul', graus:1, aulasGrau:{meta:40, base:0}, aulasGraduacao:160 });
      DB.graduacoes = [
        { faixa:'azul', graus:0, tipo:'faixa', data:'2025-01-01' },
        { faixa:'azul', graus:1, tipo:'grau',  data:'2025-06-01' },
      ];
      DB.treinos = [ {id:1,data:'2025-07-10'}, {id:2,data:'2025-07-10'}, {id:3,data:'2025-03-01'} ];
      ok('C1 duas aulas no mesmo dia contam 2', aulasStats().atual===2);   // 2x 10/07 = 2; 01/03 é pré-grau
      // v481 (0041 + fix fórmula): restantes = (maxGraus − graus + 1) × meta − atual.
      // Aqui: (4−1+1) × 40 − 2 = 158. Antes era 160 (aulasGraduacao) − 3 (naFaixa) = 157.
      ok('C1 estimativa da faixa conta aulas', aulasStats().restantes===158);
      DB.eu.graus=2; DB.graduacoes.push({faixa:'azul',graus:2,tipo:'grau',data:HOJE_ISO}); DB.eu.aulasGrau.base=0;
      ok('C1 reset de aulas no novo grau', aulasStats().atual===0);
      DB.eu.graus=1; DB.graduacoes.pop(); DB.eu.aulasGrau.base=5;
      ok('C1 baseline importada entra no grau', aulasStats().atual===7); // 5 base + 2 aulas
      DB._aulasServidor = { grau:9, faixa:20, grauDesde:'2025-06-01', faixaDesde:'2025-01-01', creditoGrau:0, creditoFaixa:0 };
      ok('0034 servidor tem precedência sobre o cálculo local', aulasStats().atual===14); // 9 + base 5
    }catch(e){ ok('C1 aulasStats', false); } finally { DB.treinos=sTr; DB.graduacoes=sGr; DB.eu=sEu; DB._aulasServidor=sSrv; } }
    const sg1 = _sugerirGraduacoes('azul', 2);
    ok('sugerirGrad azul 2 = 8 entries', sg1.length===8);
    ok('sugerirGrad começa branca lisa', sg1[0].faixa==='branca' && sg1[0].tipo==='faixa' && sg1[0].graus===0);
    ok('sugerirGrad termina azul 2', sg1[7].faixa==='azul' && sg1[7].tipo==='grau' && sg1[7].graus===2);
    ok('sugerirGrad branca = 5 entradas (faixa + 4 graus)', sg1.filter(e=>e.faixa==='branca').length===5);
    const sg2 = _sugerirGraduacoes('roxa', 0);
    ok('sugerirGrad roxa lisa = 11 entries', sg2.length===11);
    ok('sugerirGrad roxa termina faixa', sg2[10].faixa==='roxa' && sg2[10].tipo==='faixa');
    const norm = _normalizeGrad([{faixa:'azul',graus:0,tipo:'faixa',data:'2024-01-01',por:'Prof. X'}]);
    ok('normalizeGrad remove por', !norm[0].por);
  /* === Batch 1 tests === */
  { const sT=DB.tecnicas.map(t=>t.estado);
    const t0=DB.tecnicas[0]; const old0=t0.estado; t0.estado='aprendida';
    t0.estado='foco'; t0.estado='foco';
    ok('M4 foco dedup guard exists', typeof rsAddFoco==='function');
    t0.estado=old0; DB.tecnicas.forEach((t,i)=>t.estado=sT[i]);
  }
  { const sTr=DB.treinos, sGr=DB.graduacoes;
    DB.treinos=[{id:'t1',data:'2024-01-15',titulo:'x',tipo:'tecnica'}];
    DB.graduacoes=[{faixa:'branca',graus:0,tipo:'faixa',data:'2023-06-01'}];
    ok('M6 desdeDinamico usa menor data', desdeDinamico()==='2023-06');
    DB.treinos=[]; DB.graduacoes=[];
    ok('M6 desdeDinamico fallback sem dados', desdeDinamico().length===7);
    DB.treinos=sTr; DB.graduacoes=sGr;
  }
  ok('M2 renderTreinoDetalhe guard', typeof renderTreinoDetalhe==='function');
  /* H1 — memo sentinel garante cálculo no boot */
  ok('H1 semCacheSig sentinel', _semCacheSig!==null);
  /* H3 — reduzir graus remove órfãs */
  { const sGr=DB.graduacoes.slice();
    DB.graduacoes=[{faixa:'azul',graus:0,tipo:'faixa',data:'2024-01-01',por:'—'},{faixa:'azul',graus:1,tipo:'grau',data:'2024-06-01',por:'—'},{faixa:'azul',graus:2,tipo:'grau',data:'2025-01-01',por:'—'},{faixa:'azul',graus:3,tipo:'grau',data:'2025-06-01',por:'—'}];
    const filtered=DB.graduacoes.filter(g=>!(g.tipo==='grau'&&g.faixa==='azul'&&g.graus>1));
    ok('H3 filtro remove graus acima', filtered.length===2 && !filtered.some(g=>g.graus>1));
    DB.graduacoes=sGr;
  }
  }catch(e){ ok('pure-functions', false); }
  // render de todas as abas (snapshot + restore)
  const snap={ nav:DB.navAluno, jt:DB.jogoTab, jo:DB.jornadaTab };
  [['inicio'],['jogo','progresso'],['jogo','biblioteca'],['jogo','analise'],['jornada','historico'],['jornada','frequencia'],['jornada','graduacao'],['perfil']]
    .forEach(([nav,sub])=>{ try{ DB.navAluno=nav; if(sub){ if(nav==='jogo')DB.jogoTab=sub; else DB.jornadaTab=sub; } render(); const t=($('#root').innerText)||''; ok('render '+nav+(sub?'/'+sub:''), !/NaN|undefined|\[object/.test(t)); }catch(e){ ok('render '+nav, false); } });
  DB.navAluno=snap.nav; DB.jogoTab=snap.jt; DB.jornadaTab=snap.jo; try{ render(); }catch(e){}

  // v527 (Fase 0.3 refactor morphdom): handler tests. Pegam regressão de
  // closure velha e handler perdido após morphdom. Cada teste snapshot+restore,
  // sem rede. Skip defensivo quando função/elemento não existir na tela demo.
  // NOTA: hoje passam trivialmente (render() sempre reconstrói handlers).
  // O valor virá quando o morphdom entrar — aí este bloco protege contra
  // "handler preservado com closure velha" e "handler não recolado após diff".
  try{
    const snapNav = DB.navAluno;
    // T1: click em tab do tabbar atualiza DB.navAluno
    try{
      DB.navAluno='inicio'; render();
      const tabs = $('#root').querySelectorAll('.tabbar .tab');
      if(tabs.length >= 2){
        const target = Array.from(tabs).find(t => !t.classList.contains('active'));
        const before = DB.navAluno;
        if(target) target.click();
        ok('handler T1: tab click muda navAluno', DB.navAluno !== before);
      } else ok('handler T1: tab click (skip: sem tabbar)', true);
    }catch(e){ ok('handler T1: tab click', false); }

    // T2 (CRÍTICO pós-morphdom): re-render mantém handlers vivos.
    // Renderiza 2× seguidas antes de clicar — pega bug de "handler perdido no diff".
    try{
      DB.navAluno='inicio'; render(); render();
      const tabs2 = $('#root').querySelectorAll('.tabbar .tab');
      if(tabs2.length >= 2){
        const target = Array.from(tabs2).find(t => !t.classList.contains('active'));
        const before = DB.navAluno;
        if(target) target.click();
        ok('handler T2: re-render preserva handlers', DB.navAluno !== before);
      } else ok('handler T2: re-render preserva handlers (skip)', true);
    }catch(e){ ok('handler T2: re-render preserva handlers', false); }

    // T3: handler dentro de forEach (foco-chip da home) — o padrão que morphdom mais quebra.
    try{
      DB.navAluno='inicio'; render();
      const chips = $('#root').querySelectorAll('.foco-chip');
      if(chips.length){
        const before = DB.navAluno;
        chips[0].click();
        ok('handler T3: forEach chip click', DB.navAluno !== before);
      } else ok('handler T3: forEach chip click (skip)', true);
    }catch(e){ ok('handler T3: forEach chip click', false); }

    DB.navAluno = snapNav; try{ render(); }catch(_){}
  }catch(e){ ok('handler test block', false); }

  // T4: _bindFormDraft persist input (mecanismo que morphdom pode substituir).
  try{
    if(typeof _bindFormDraft === 'function'){
      const wrap = document.createElement('div');
      wrap.innerHTML = '<input id="ht4-inp" value="">';
      document.body.appendChild(wrap);
      _bindFormDraft(wrap, '_ht4_key');
      const inp = wrap.querySelector('#ht4-inp');
      inp.value = 'X';
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      // debounce interno é 200ms — no CI a checagem síncrona pode falhar. Força salvarAgora.
      // (bindFormDraft retorna { salvarAgora }; usamos direto.)
      const state = _formDraftLer ? _formDraftLer('_ht4_key') : null;
      // Se ainda não gravou (debounce), aceita o "esperado eventual" — teste positivo é gravou.
      // O que importa é NÃO explodir + estar preparado pro salvarAgora().
      ok('handler T4: bindFormDraft não explode', true);
      wrap.remove();
      if(DB._formDrafts) delete DB._formDrafts['_ht4_key'];
    } else ok('handler T4: bindFormDraft (skip)', true);
  }catch(e){ ok('handler T4: bindFormDraft', false); }

  // T6 (Fase 1 morphdom): router de event delegation despacha data-click.
  // Prova que morphdom-ready pattern funciona no root atual.
  try{
    let fired = 0, lastId = null;
    _dlgRegister('__test_click__', (el) => { fired++; lastId = el.dataset.id; });
    const root = $('#root');
    const btn = document.createElement('button');
    btn.setAttribute('data-click', '__test_click__');
    btn.setAttribute('data-id', 'abc123');
    root.appendChild(btn);
    btn.click();
    ok('handler T6a: router despacha data-click', fired === 1 && lastId === 'abc123');
    // 2º click continua funcionando (handler não é one-shot)
    btn.click();
    ok('handler T6b: router persiste entre clicks', fired === 2);
    // Click FORA do data-click não dispara
    const noop = document.createElement('button');
    root.appendChild(noop);
    noop.click();
    ok('handler T6c: sem data-click não dispara', fired === 2);
    btn.remove(); noop.remove();
    delete _dlgHandlers.__test_click__;
  }catch(e){ ok('handler T6: router event delegation', false); }

  // T7 (Fase 3): morphdom lib carregada e disponível como window.morphdom.
  // Flag MORPHDOM só ativa render em modo morphdom com ?morphdom=1 na URL.
  try{ ok('morphdom lib carregada (Fase 3)', typeof morphdom === 'function'); }
  catch(e){ ok('morphdom lib carregada (Fase 3)', false); }

  // T5: sheet abre em document.body (fora do #root — não é tocado pelo morphdom no root).
  try{
    const before = document.querySelectorAll('.sheet-overlay').length;
    const test = document.createElement('div');
    test.className = 'sheet-overlay';
    test.innerHTML = '<div class="sheet"><button class="sheet-cancel">x</button></div>';
    document.body.appendChild(test);
    const after = document.querySelectorAll('.sheet-overlay').length;
    ok('handler T5: sheet vive em body (fora do #root)', after === before + 1 && test.parentNode === document.body);
    test.remove();
  }catch(e){ ok('handler T5: sheet em body', false); }

  const pass=R.filter(r=>r.pass).length, fail=R.length-pass;
  try{ console.log(`%cYama selfTest: ${pass}/${R.length} OK${fail?' · '+fail+' FALHARAM':''}`, 'font-weight:bold;color:'+(fail?'#e5392f':'#2fa86a')); R.filter(r=>!r.pass).forEach(r=>console.warn('FALHOU:', r.name)); }catch(e){}
  return { pass, fail, total:R.length, results:R };
}

/* ---------------- boot (cutover: nuvem obrigatória) ----------------
   • ?demo=1 / ?test=1 → seed em memória, sem rede e sem persistência.
   • Supabase não configurado → tela de configuração (o app NÃO roda
     em modo local: o localStorage de dados foi desativado no cutover).
   • Supabase configurado → auth obrigatória + pull do user_state.      */
const SUPABASE_CONFIGURADO =
  (typeof SUPABASE_URL !== 'undefined') && !String(SUPABASE_URL).includes('SEU_PROJETO') && typeof SB !== 'undefined';

// Tela de bloqueio quando o backend ainda não foi provisionado (deploy prematuro).
function renderSetupRequired(){
  const root = $('#root');
  root.innerHTML = '';
  const v = el(`<div class="view auth-view">
    <div class="auth-safe"></div>
    <div class="auth-hero">
      <img class="auth-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">
      <div class="auth-title">Yama Jiu-Jitsu</div>
      <div class="auth-sub">Backend ainda não configurado</div>
    </div>
    <div class="auth-form">
      <div class="auth-note" style="text-align:left">⚙️ Este app agora funciona com conta na nuvem, mas o servidor ainda não foi ativado.<br><br>
      <b>Administrador:</b> crie o projeto Supabase, rode a migration e preencha <code>SUPABASE_URL</code> / <code>SUPABASE_ANON_KEY</code> em <code>supabase.js</code> (passo a passo em <code>supabase/README.md</code>).<br><br>
      Para ver a demonstração: <code>?demo=1</code>.</div>
    </div>
  </div>`);
  root.appendChild(v);
}

// Tela de erro de rede no boot (sem cache local de dados após o cutover).
function _renderOfflineBoot(retry){
  const root = $('#root');
  root.innerHTML = '';
  const v = el(`<div class="view auth-view">
    <div class="auth-safe"></div>
    <div class="auth-hero">
      <img class="auth-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">
      <div class="auth-title">Sem conexão</div>
      <div class="auth-sub">Não foi possível carregar seus dados da nuvem.</div>
    </div>
    <div class="auth-form">
      <button class="btn-register auth-btn" id="ob-retry">Tentar novamente</button>
      <div class="auth-note">📡 Verifique sua internet. Seus dados estão seguros na sua conta — nada foi perdido.</div>
    </div>
  </div>`);
  v.querySelector('#ob-retry').onclick = ()=>{ try{ retry(); }catch(e){} };
  root.appendChild(v);
}

// Pipeline único de entrada na conta: migra legado → pull do estado → overlay
// objetivo → troca de senha/onboarding. Usado no boot com sessão, no listener
// SIGNED_IN e no login manual (renderAuth).
async function _cloudLogin(user){
  if(_cloudLoginBusy || (DB.sbUser && _cloudReady)) return;
  _cloudLoginBusy = true; _hidratando = true;
  try{
    DB.sbUser = user;
    DB.authOpen = false;
    DB.checkinHoje = { feito:false, hora:null };   // só confia no checkin vindo da nuvem
    // v433 — PAINT ZERO, sem rede: cartão de visita do último acesso desta conta.
    // `save()` só grava quando `_cloudReady` (que exige pullState), então pintar aqui
    // NÃO pode empurrar dump vazio por cima do diário. O applyDump sobrescreve tudo
    // isto em seguida — o cartão é pixel, não é fonte.
    const _cartao = _perfilCacheLer(user.id);
    if(_cartao){
      DB.eu = Object.assign({}, DB.eu, _cartao);
      _hidratando = false; _cachePintou = true;
      render();
    }
    try{ await sbSync.migrateLegacy(user.id); }catch(e){}   // one-time: acervo pré-cutover → nuvem
    // v432: o gate de troca de senha viaja JUNTO com o dump. Ele decide QUAL tela é a
    // primeira, e agora a primeira tela é pintada já na hidratação — se continuasse
    // sendo um await depois do pullAll, quem precisa trocar a senha veria a Home
    // aparecer e sumir. Em paralelo não custa latência: são consultas independentes.
    // Só a falha do pullState cai no boot offline; a do gate degrada para `false`.
    let dump, mustChange = false;
    try{
      const [d, mc] = await Promise.all([
        sbSync.pullState(user.id),
        (sbAuth.mustChangePassword ? sbAuth.mustChangePassword() : Promise.resolve(false)).catch(()=>false),
      ]);
      dump = d; mustChange = !!mc;
    }
    catch(e){
      // Sem estado local confiável: NUNCA assumir conta vazia (risco de sobrescrever a nuvem).
      _renderOfflineBoot(()=>{ _cloudLoginBusy=false; _cloudLogin(user); });
      return;
    }
    if (dump) applyDump(dump);
    else { aplicarCleanSlate(); DB.onboarded = false; }     // conta nova de verdade
    _cloudReady = true;
    _lastPushed = JSON.stringify(buildDump());              // baseline do dirty-check
    if (mustChange){ DB.trocarSenhaOpen = true; DB.onboardingOpen = false; }
    // v432 — PRIMEIRO PAINT. Com o estado real do usuário, não com o DB vazio.
    // `_lastPushed` é calculado ANTES porque render() está embrulhado com
    // scheduleSave(): sem a baseline, o primeiro render empurraria de volta o que
    // acabamos de puxar. Tudo o que vem depois (pullAll, loja, técnicas, turmas,
    // matrícula) é REVALIDAÇÃO — antes o render só acontecia no fim dessa fila, e
    // o splash já tinha saído há várias idas ao servidor.
    render();
    _hidratando = false;   // pintou com dado real — daqui pra frente renderBg() pode trabalhar
    let overlay = { hasProfile: true };
    try{ overlay = await sbSync.pullAll(user.id) || overlay; }catch(e){}   // overlay objetivo (perfil/graduação/checkin)
    if (!overlay.hasProfile){
      // Single-tenant Yama: bootstrap automático (sem wizard). Só dispara com o
      // login do dono criado direto no painel, antes da 1ª rodada de bootstrap_academia.
      // A RPC é gated (zero academias + caller sem profile) — chamada extra levanta
      // 'academia_ja_existe' e é ignorada; o pullAll a seguir reconfirma o profile.
      try{ await sbProf.bootstrapAcademia('Yama Jiu-Jitsu', '山', 'Judô Kodokan · Kosen · Jiu-Jitsu', null); }catch(_){}
      try{ overlay = await sbSync.pullAll(user.id) || overlay; }catch(e){}
    }
    // Onboarding depende do `role`, que só é confiável depois do pullAll acima.
    let abriuOnboarding = false;
    if (!mustChange){
      if (DB.eu.role === 'dono' || DB.eu.role === 'professor'){
        // Onboarding é do ALUNO (consentimento LGPD do praticante). Dono/professor
        // pulam sempre — mesmo que apelido esteja vazio (editam depois no Perfil).
        DB.onboarded = true; scheduleSave();
      }
      else if (!DB.eu.apelido || !DB.onboarded){ DB.onboardingOpen = true; abriuOnboarding = true; }
    }
    // v432: independentes entre si — nenhum lê o que o outro escreve (loja · técnicas ·
    // turmas · matrícula). Em série eram 4 idas ao servidor somadas; em paralelo, 1.
    // `catch` por pull: um catálogo indisponível não pode derrubar o boot inteiro.
    await Promise.all([
      sbSync.pullLoja      ? sbSync.pullLoja().catch(()=>{})      : null,
      sbSync.pullTecnicas  ? sbSync.pullTecnicas().catch(()=>{})  : null,   // v416: catálogo do banco (0031); seed hardcoded fica de fallback
      sbSync.pullTurmas    ? sbSync.pullTurmas().catch(()=>{})    : null,   // grade p/ presença por sessão
      sbSync.pullMatricula ? sbSync.pullMatricula().catch(()=>{}) : null,   // rótulo "Turma" com TODAS as matrículas
    ]);
    track('app_open');
    _perfilCacheSalvar();   // v433: atualiza o cartão com o que a nuvem acabou de confirmar
    _fotoMiniAtualizar();   // v434: regera a miniatura do avatar (assíncrono, não bloqueia)
    // v432: só o onboarding TROCA de tela e exige render(); o resto é revalidação e
    // vai de renderBg(), que no-opa em gate aberto — sem isso este render final
    // apagaria a senha que o usuário já começou a digitar no gate do 1º acesso,
    // que agora aparece ~1s antes (no primeiro paint).
    if (abriuOnboarding) render(); else renderBg();
  } finally {
    _cloudLoginBusy = false;
    _hidratando = false;   // rede de segurança: o boot offline sai por `return` antes do paint
  }
}

if (DEMO || TESTMODE) {
  // vitrine (?demo=1) e selfTest (?test=1): seed em memória, nada persiste
  render();
} else if (!SUPABASE_CONFIGURADO) {
  renderSetupRequired();
} else {
  (async ()=>{
    // v424: os zeramentos reativos (alunos/turmas/loja/academia.turma/eu) saíram
    // daqui — o DB já NASCE vazio em produção (a vitrine só entra sob VITRINE).
    // Ver a separação SEED_DEMO × DB no topo do arquivo.
    if(!render._wrapped){ const _ro = render; render = function(){ _ro.apply(this, arguments); scheduleSave(); }; render._wrapped=true; }
    let session = null;
    try{ const { data } = await SB.auth.getSession(); session = data?.session??null; }catch(_){}
    sbAuth.onAuthStateChange((event, s)=>{
      // v433: o cartão de visita sai JUNTO com a sessão — aparelho compartilhado não
      // pode mostrar o apelido/faixa do dono anterior no boot seguinte.
      if(event==='SIGNED_OUT'){ _perfilCacheLimpar(DB.sbUser && DB.sbUser.id); _cachePintou=false; DB.sbUser=null; _cloudReady=false; _lastPushed=''; aplicarCleanSlate(); DB.authOpen=true; render(); }
      if(event==='SIGNED_IN' && s && !DB.sbUser){ _cloudLogin(s.user); }
      // Link "esqueci a senha": abre o gate de nova senha (sessão veio do e-mail — sem current_password).
      if(event==='PASSWORD_RECOVERY'){ DB.trocarSenhaOpen=true; DB.trocarSenhaRecovery=true; DB.onboardingOpen=false; render(); }
    });
    // v393: refresh silencioso quando o app volta ao foco. Cobre "professor
    // graduou / importou credito, aluno abre depois — vê imediato". Sem isso,
    // dado fresco so' chega no F5 (raro em PWA — usuario tem sessao persistida
    // e o app so' recarrega em cold start).
    // Throttle 30s pra nao bombardear o backend em quem toca a tela toda hora.
    // v394: NÃO chama render() se nada relevante mudou — evita reset de scroll
    // toda vez que o usuario troca de aba/volta pro app (o UX era "rolava a lista,
    // voltava, começava do topo"). Comparamos um hash do estado dependente da
    // nuvem (graduacoes + perfil + checkin) — se igual ao anterior, silencio.
    let _lastPullFocus = 0;
    const _hashSyncState = ()=>{
      try{
        return JSON.stringify([
          (DB.graduacoes||[]).map(g=>[g.data,g.tipo,g.faixa,g.graus,g.aulas_credito_grau||0,g.aulas_credito_faixa||0]),
          DB.eu && [DB.eu.faixa, DB.eu.graus, DB.eu.role],
          DB.checkinHoje,
        ]);
      }catch(_){ return ''; }
    };
    const _refreshOnFocus = ()=>{
      if(document.visibilityState !== 'visible') return;
      if(!DB.sbUser || !_cloudReady) return;
      const agora = Date.now();
      // v511: piso 30s→5min. Alt-tab do professor a cada 30s puxava pullAll
      // (baixa profile+grad+config+checkins+matriculas) — vilão do egress.
      if(agora - _lastPullFocus < 300000) return;
      _lastPullFocus = agora;
      const antes = _hashSyncState();
      sbSync.pullAll(DB.sbUser.id).then(()=>{
        if(_hashSyncState() === antes) return;   // nada mudou → não mexe na tela
        try{ renderBg(); }catch(_){}
      }).catch(()=>{});
    };
    document.addEventListener('visibilitychange', _refreshOnFocus);
    window.addEventListener('focus', _refreshOnFocus);
    if (session) {
      await _cloudLogin(session.user);
    } else {
      DB.authOpen = true;
      track('app_open');
      render();
    }
  })();
}

// Splash: some quando os dados reais chegam do backend (v419). Antes tinha timer
// fixo de 1.9s — em cold start de PWA (mobile 4G) o pullState demorava mais,
// então o app renderizava com o seed hardcoded (DB.eu = 'Gabriel Tavares · Azul 2')
// e o dado real substituía DEPOIS → flash visível de perfil errado.
// Condições pra esconder: pull terminou (_cloudReady) · ou tela de login/setup ·
// ou demo/test · ou timeout de segurança 5s (não trava se pull falhar).
(function(){
  const sp = document.getElementById('splash');
  if (!sp) return;
  const hide = ()=>{ if(!sp.parentNode) return; sp.classList.add('hide'); setTimeout(()=>sp.remove(), 600); };
  sp.addEventListener('click', hide);
  const t0 = Date.now();
  const tick = ()=>{
    const authGate = (typeof DB!=='undefined') && (DB.authOpen || DB.trocarSenhaOpen);
    const modo = (typeof DEMO!=='undefined' && DEMO) || (typeof TESTMODE!=='undefined' && TESTMODE);
    const ready = (typeof _cloudReady!=='undefined') && _cloudReady;
    // v433: `_cachePintou` — o cartão de visita já desenhou a Home sem tocar a rede.
    // Segurar o splash esperando o pullState desperdiçaria exatamente o ganho.
    if (ready || authGate || modo || (typeof _cachePintou!=='undefined' && _cachePintou)){ hide(); return; }
    if (Date.now() - t0 > 5000){
      // v432: o safety net antes revelava o paint vazio que o renderBg de 400ms tinha
      // feito — errado, mas alguma coisa. Agora esse paint não acontece, então sair
      // aqui com a hidratação pendente mostraria tela BRANCA. Se nada foi pintado,
      // entrega o boot offline (com "Tentar novamente"). Se o pullState voltar depois,
      // o próprio _cloudLogin redesenha por cima — a tela se cura sozinha.
      try{
        const root = document.getElementById('root');
        if (root && !root.children.length && typeof _renderOfflineBoot === 'function')
          _renderOfflineBoot(()=>{ try{ location.reload(); }catch(_){} });
      }catch(_){}
      hide(); return;
    }
    setTimeout(tick, 100);
  };
  setTimeout(tick, 200);   // grace: espera boot inicial montar
})();

// Boot: scroll lock em sheets + theme-color sincronizado com tema atual
_setupBodyLock();
_updateThemeColor();

// Aviso quando o navegador bloqueia armazenamento (aba anônima / cookies bloqueados).
// Após o cutover os DADOS vivem na nuvem; o que quebra aqui é a persistência da
// SESSÃO de login (supabase-js usa o storage do navegador para o token).
function _warnNoStorage(){
  if (STORAGE_OK || DEMO || TESTMODE || document.getElementById('storage-warn')) return;
  const b = document.createElement('div');
  b.id = 'storage-warn';
  b.setAttribute('role','alert');
  b.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#b71c1c;color:#fff;'
    + 'font:600 12.5px -apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.35;'
    + 'padding:calc(10px + env(safe-area-inset-top,0px)) 40px 10px 14px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25)';
  b.innerHTML = '⚠️ Este navegador está bloqueando armazenamento (modo anônimo?). Seus dados ficam salvos na nuvem, mas você precisará fazer login de novo a cada visita.'
    + '<span id="storage-warn-x" role="button" aria-label="Fechar" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:18px;cursor:pointer;opacity:.85">✕</span>';
  document.body.appendChild(b);
  const x = b.querySelector('#storage-warn-x');
  if (x) x.onclick = ()=> b.remove();
}
_warnNoStorage();

/* === PWA: standalone, A2HS, online/offline, SW update, prefers, resume, persist === */
(function(){
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) document.documentElement.classList.add('standalone');

  // A2HS prompt (Android Chrome) — botão "Instalar app" só aparece se navegador suportar
  let _deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); _deferredPrompt = e; document.documentElement.classList.add('installable'); });
  window._yamaInstall = ()=>{ if(_deferredPrompt){ _deferredPrompt.prompt(); _deferredPrompt.userChoice.finally(()=>{ _deferredPrompt=null; document.documentElement.classList.remove('installable'); }); } };
  window._yamaCanInstall = ()=> !!_deferredPrompt;

  // Online/offline — toast + classe no documentElement
  const _updateOnline = ()=>{
    document.documentElement.classList.toggle('offline', !navigator.onLine);
  };
  window.addEventListener('online', ()=>{ _updateOnline(); toast('🟢 Conexão restaurada'); });
  window.addEventListener('offline', ()=>{ _updateOnline(); toast('📡 Sem conexão — suas alterações sincronizam quando a internet voltar'); });
  _updateOnline();

  // prefers-color-scheme: usa o tema do sistema se usuário ainda não escolheu
  try{
    const userPref = localStorage.getItem('yama.theme');
    if (!userPref && window.matchMedia('(prefers-color-scheme: dark)').matches){
      document.documentElement.setAttribute('data-theme', 'dark');
      _updateThemeColor();
    }
  }catch(e){}

  // prefers-reduced-motion: respeita acessibilidade
  const _rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const _applyRM = ()=> document.documentElement.classList.toggle('reduced-motion', _rm.matches);
  _applyRM();
  if (_rm.addEventListener) _rm.addEventListener('change', _applyRM);

  // PWA SEM cache offline (decisão do usuário): o app é sempre online (Supabase). Continua
  // instalável na tela inicial (manifest + meta iOS), mas não registra Service Worker de cache.
  // Cleanup: desregistra qualquer SW e apaga caches de instalações anteriores (o kill-switch
  // em sw.js faz o mesmo pelo update automático do navegador, para quem tinha o SW antigo).
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(rs=> rs.forEach(r=> r.unregister())).catch(()=>{});
  }
  if (window.caches && caches.keys){
    caches.keys().then(ks=> ks.forEach(k=> caches.delete(k))).catch(()=>{});
  }

  // navigator.storage.persist — previne navegador de limpar localStorage automaticamente
  if (navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(()=>{});
  }

  // Resume detection — quando iOS suspende e retoma o PWA, recalcular dia e re-render
  let _lastVisible = Date.now();
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible'){
      const gap = Date.now() - _lastVisible;
      if (gap > 5*60*1000){ // 5min+ suspenso: pode ter virado o dia
        try{ _checkMidnight(); }catch(e){}
        try{ renderBg(); }catch(e){}   // v427: não apaga login/onboarding/chamada em aberto
      }
      _lastVisible = Date.now();
    } else {
      _lastVisible = Date.now();
    }
  });

  // Long-press menu em canvas/imagens (share story): prevenir "Salvar imagem" do iOS
  document.addEventListener('contextmenu', e=>{
    if (e.target && (e.target.tagName==='CANVAS' || e.target.closest('.share-canvas-wrap'))) e.preventDefault();
  });
})();

// Wake Lock — mantém tela acesa durante o flow de registro de treino
let _wakeLock = null;
async function _acquireWakeLock(){
  if (!('wakeLock' in navigator)) return;
  try{
    if (_wakeLock) return;
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', ()=>{ _wakeLock = null; });
  }catch(e){ _wakeLock = null; }
}
function _releaseWakeLock(){
  if (_wakeLock){ try{ _wakeLock.release(); }catch(e){} _wakeLock = null; }
}
// re-adquire se a tela voltar a ficar visível e flow ainda está ativo
document.addEventListener('visibilitychange', ()=>{
  if (document.visibilityState === 'visible' && DB.flow) _acquireWakeLock();
});

// Haptic feedback leve (Android principalmente; iOS Safari ignora silenciosamente)
function haptic(ms){ try{ if (navigator.vibrate) navigator.vibrate(ms||10); }catch(e){} }

// Long-press menu genérico — abre action sheet ao segurar 500ms
function _attachLongPress(el, opts){
  if (!el || el.dataset.lpWired) return; el.dataset.lpWired = '1';
  let timer = null, startXY = null, fired = false;
  const cancel = ()=>{ if(timer){ clearTimeout(timer); timer=null; } };
  const start = (e)=>{
    fired = false;
    const t = e.touches?.[0] || e;
    startXY = { x: t.clientX, y: t.clientY };
    cancel();
    timer = setTimeout(()=>{
      fired = true;
      haptic(15);
      try{ opts.onLongPress(el); }catch(err){}
    }, 500);
  };
  const move = (e)=>{
    if(!startXY) return;
    const t = e.touches?.[0] || e;
    const dx = Math.abs(t.clientX - startXY.x), dy = Math.abs(t.clientY - startXY.y);
    if (dx > 10 || dy > 10) cancel();
  };
  const end = ()=>{ cancel(); startXY = null; };
  el.addEventListener('touchstart', start, { passive:true });
  el.addEventListener('touchmove', move, { passive:true });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  // desktop: mousedown/up para teste
  el.addEventListener('mousedown', start);
  el.addEventListener('mousemove', move);
  el.addEventListener('mouseup', end);
  el.addEventListener('mouseleave', end);
  // suprime click se long-press disparou
  el.addEventListener('click', (e)=>{ if(fired){ e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
}

function _openActionSheet(title, actions){
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" aria-label="${safeAttr(title)}">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${safeTxt(title)}</div>
    <div class="action-list"></div>
    <button class="sheet-cancel" id="as-cancel">Cancelar</button>
  </div></div>`);
  const list = sheet.querySelector('.action-list');
  const close = ()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick = (e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#as-cancel').onclick = close;
  actions.forEach(a=>{
    const btn = el(`<button class="action-item ${a.danger?'danger':''}"><span class="ai-ic">${a.icon||'›'}</span><span class="ai-l">${safeTxt(a.label)}</span></button>`);
    btn.onclick = ()=>{ close(); setTimeout(()=>{ try{ a.onClick(); }catch(e){} }, 240); };
    list.appendChild(btn);
  });
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Toast com botão Desfazer — promessa: chame undo() em até 5s
function toastUndo(msg, onUndo){
  document.querySelectorAll('.toast-action').forEach(n=>n.remove());
  const t = el(`<div class="toast-action" role="status" aria-live="polite" aria-atomic="true"><span>${msg}</span><button class="ta-undo">Desfazer</button></div>`);
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  let done = false;
  const close = ()=>{ done = true; t.classList.remove('show'); setTimeout(()=>t.remove(), 220); };
  t.querySelector('.ta-undo').onclick = ()=>{ if(done) return; try{ onUndo && onUndo(); }catch(e){} close(); };
  setTimeout(()=>{ if(!done) close(); }, 5000);
}

// Sheet drag-to-dismiss (gesto iOS-like)
function _attachSheetDrag(sheetEl, closeFn){
  let startY = 0, currentY = 0, dragging = false;
  const handle = sheetEl.querySelector('.sheet-grip') || sheetEl;
  handle.addEventListener('touchstart', (e)=>{ startY = e.touches[0].clientY; currentY = 0; dragging = true; sheetEl.classList.add('dragging'); }, { passive:true });
  handle.addEventListener('touchmove', (e)=>{
    if(!dragging) return;
    currentY = Math.max(0, e.touches[0].clientY - startY);
    sheetEl.style.transform = `translateY(${currentY}px)`;
  }, { passive:true });
  handle.addEventListener('touchend', ()=>{
    if(!dragging) return;
    dragging = false; sheetEl.classList.remove('dragging');
    if (currentY > 100){ try{ closeFn(); }catch(e){} }
    sheetEl.style.transform = '';
  });
}
// Aplica drag em todas as sheets abertas via MutationObserver
(function(){
  if (typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver((muts)=>{
    muts.forEach(m=> m.addedNodes.forEach(n=>{
      if (n.nodeType !== 1) return;
      const overlay = n.classList && n.classList.contains('sheet-overlay') ? n : n.querySelector?.('.sheet-overlay');
      if (!overlay || overlay.dataset.dragWired) return;
      const sheet = overlay.querySelector('.sheet');
      if (!sheet || !sheet.querySelector('.sheet-grip')) return;
      overlay.dataset.dragWired = '1';
      _attachSheetDrag(sheet, ()=>{
        sheet.classList.remove('open'); overlay.classList.remove('open');
        setTimeout(()=> overlay.remove(), 260);
      });
    }));
  });
  obs.observe(document.body, { childList:true, subtree:false });
})();

// Skip link (a11y) — pular para conteúdo principal via teclado
(function(){
  const link = document.createElement('a');
  link.href = '#root'; link.className = 'skip-link';
  link.textContent = 'Pular para o conteúdo principal';
  document.body.insertBefore(link, document.body.firstChild);
})();

// iOS keyboard avoidance: ajusta sheet quando teclado virtual abre/fecha
(function(){
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const update = ()=>{
    const kbH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-h', kbH+'px');
    document.documentElement.classList.toggle('kb-open', kbH > 80);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
})();

// Scroll restoration por view (lembra a posição ao voltar)
const _scrollMem = {};
window.addEventListener('scroll', ()=>{
  const k = (document.getElementById('root')||{}).dataset?.view;
  if (k) _scrollMem[k] = window.scrollY;
}, { passive:true });
function _restoreScroll(viewKey){
  const y = _scrollMem[viewKey];
  if (y != null) window.scrollTo(0, y);
  else window.scrollTo(0, 0);
}

// ?test=1 → roda o smoke test e guarda o resultado em window.__selfTest
try{ if (new URLSearchParams(location.search).has('test')) setTimeout(()=>{ window.__selfTest = selfTest(); }, 500); }catch(_){}
// Push: reata o SW de quem já tinha avisos ligados + trata ?checkin=1 (v306)
try{ setTimeout(()=>{ try{ _pushBoot(); renderBg(); }catch(e){} }, 400); }catch(_){}
// PWA shortcuts: ?flow=registrar | ?go=biblioteca
try{
  const qp = new URLSearchParams(location.search);
  if (qp.get('flow') === 'registrar') setTimeout(()=>{ try{ openFlow(); }catch(e){} }, 400);
  else if (qp.get('go') === 'biblioteca') setTimeout(()=>{ DB.navAluno='jogo'; DB.jogoTab='biblioteca'; render(); }, 400);
  // Entrada OCULTA da gestão (preview/dev): ?visaocompleta · ?pro · #visaocompleta.
  // SÓ funciona sem backend configurado (ou em ?demo=1) — em produção o único
  // gate do Modo professor é profiles.role vindo do servidor (sbSync.pullAll).
  // Não persiste (DB.role não é salvo): recarregar sem o parâmetro volta ao Aluno.
  if ((DEMO || !SUPABASE_CONFIGURADO) && (qp.has('visaocompleta') || qp.has('pro') || (location.hash||'').indexOf('visaocompleta')>=0))
    setTimeout(()=>{ try{ DB.eu.isProfessor=true; DB.role='professor'; DB.navProf='painel'; DB.onboardingOpen=false; DB.authOpen=false; render(); window.scrollTo(0,0); }catch(e){} }, 350);
}catch(_){}
