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
  fecharRetro:  ()=>fecharRetro(),
  fecharTreino: ()=>fecharTreino(),
  fecharShare:  ()=>fecharShare(),
  closeFlow:    ()=>closeFlow(),
  closeLoja:    ()=>closeLoja(),
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
const hoje = DEMO ? new Date(2026, 5, 3) : (()=>{ const d=new Date(); d.setHours(0,0,0,0); return d; })();
const isoOf = (d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let HOJE_ISO = isoOf(hoje);
function _checkMidnight(){ const now=new Date(); now.setHours(0,0,0,0); if(now.getTime()!==hoje.getTime()){ hoje.setTime(now.getTime()); HOJE_ISO=isoOf(hoje); _resetDiario(''); render(); } }
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
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2200); }

// ---- ViaCEP: auto-preenche endereço a partir do CEP (API pública, sem chave) ----
// Uso: bindViaCEP(cepInput, {logr, bairro, cidade, uf, num}) — busca no blur/enter.
function _maskCEP(v){ const d=String(v||'').replace(/\D/g,'').slice(0,8); return d.length>5?d.slice(0,5)+'-'+d.slice(5):d; }
function bindViaCEP(cepInp, fields){
  if(!cepInp) return;
  cepInp.addEventListener('input', ()=>{ const p=cepInp.selectionStart; cepInp.value=_maskCEP(cepInp.value); try{ cepInp.setSelectionRange(p,p); }catch(_){}});
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
  const fg = (DB.graduacoes||[]).find(x=>x.tipo==='faixa' && x.faixa===eu.faixa);
  const mesesNaFaixa = fg ? tempoNaFaixaMeses(fg.data) : null;
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
function beltPill(b, graus){
  // guard: faixa desconhecida vinda do backend não pode crashar nem injetar HTML
  const x = BELTS[b] || { cor:'#9e9e9e', nome:safeTxt(b||'—') }; const g = graus!=null ? ` · ${graus}º` : '';
  return `<span class="belt-pill" style="background:${x.cor}22;color:${b==='branca'?'#888':x.cor}">
    <span class="belt-bar" style="background:${x.cor}"></span>${x.nome}${g}</span>`;
}
// Mini-faixa visual: corpo colorido + ponteira dos graus (preta; VERMELHA na faixa preta — regra CBJJ) + ponta colorida
function beltMini(b, graus){
  const x = BELTS[b] || { cor:'#9e9e9e' };
  const stripes = '<i></i>'.repeat(graus||0);
  const red = b==='preta' ? ' red-tip' : '';
  const bic = x.bar ? ' bicolor' : '';   // faixas infantis/corais: listra central
  const barVar = x.bar ? `;--bar:${x.bar}` : '';
  return `<span class="belt-mini${bic}" style="--bc:${x.cor}${barVar}">
    <span class="bm-body"></span><span class="bm-tip${red}">${stripes}</span><span class="bm-end"></span></span>`;
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

/* ---------------- ESTADO COMPARTILHADO (o "banco") ---------------- */
const DB = {
  role: 'aluno',                 // 'aluno' | 'professor'
  academia: { nome:'Yama Jiu-Jitsu', kanji:'山', artes:'Judô Kodokan · Kosen · Jiu-Jitsu', turma:'Adulto · Gi · 19h30' },
  professor: { nome:'Prof. Ricardo Maciel' },

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

  // >>> ponto de integração nº3: check-in fundido ao registro do treino
  checkinHoje: { feito:false, hora:null },
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

  // biblioteca pessoal de técnicas — id estável (chave de persistência), jp=display, pt=tradução
  // Para "outros" (BJJ moderno) o jp aceita nome em PT/EN consagrado (sem japonês inventado).
  tecnicas: [
    // Tachi-waza · Nage-waza (quedas / projeções) — oficiais do Kodokan
    { id:'nag-osoto', jp:'O-soto-gari', pt:'Grande ceifada externa', cat:'nage', oficial:true, nivel:'treinando', treinos:8, ultima:'01 jun', ultimaRev:'2026-05-20', nota:'Desequilibrar pra trás (kuzushi), plantar o pé de apoio e ceifar a perna como um pêndulo.' },
    { id:'nag-ouchi', jp:'O-uchi-gari', pt:'Grande ceifada interna', cat:'nage', oficial:true, nivel:'aprendendo', treinos:3, ultima:'29 mai', ultimaRev:'2026-05-29', nota:'Enganchar por dentro e empurrar na diagonal; cuidado pra não cair junto.' },
    { id:'nag-seoi', jp:'Seoi-nage', pt:'Projeção por sobre o ombro', cat:'nage', oficial:true, nivel:'treinando', treinos:9, ultima:'31 mai', ultimaRev:'2026-05-18', nota:'Entrar girando, quadril abaixo do dele, cotovelo preso. Puxar a manga pra cima.' },
    { id:'nag-uchimata', jp:'Uchi-mata', pt:'Projeção por dentro da coxa', cat:'nage', oficial:true, nivel:'aprendendo', treinos:2, ultima:'15 mai', ultimaRev:'2026-05-15', nota:'Carregar o peso pra frente e levantar a coxa interna num só tempo.' },
    { id:'nag-tomoe', jp:'Tomoe-nage', pt:'Projeção em círculo (sacrifício)', cat:'nage', oficial:true, nivel:'aprendendo', treinos:2, ultima:'12 mai', ultimaRev:'2026-05-12', nota:'Sentar sob o oponente, pé no quadril, projetar por cima da cabeça. Ponte do Kosen pro chão.' },
    { id:'nag-kanibasami', jp:'Kani-basami', pt:'Tesoura voadora', cat:'nage', oficial:true, nivel:'aprendendo', treinos:2, ultima:'14 mai', ultimaRev:'2026-05-14', nota:'Yoko-sutemi-waza Kodokan: derruba prendendo o corpo entre as pernas como uma tesoura. Banida na competição esportiva.' },
    { id:'nag-obitori', jp:'Obi-tori-gaeshi', pt:'Inversão pegando a faixa', cat:'nage', oficial:true, nivel:'treinando', treinos:5, ultima:'27 mai', ultimaRev:'2026-05-24', nota:'Nage-waza Kodokan (reconhecida em 1997): agarra a faixa/cintura por baixo e inverte.' },
    { id:'nag-tawara', jp:'Tawara-gaeshi', pt:'Inversão "fardo de arroz"', cat:'nage', oficial:true, nivel:'treinando', treinos:4, ultima:'23 mai', ultimaRev:'2026-05-18', nota:'Yoko-sutemi-waza Kodokan: defendendo, abraça o tronco e rola o oponente por cima da cabeça como um saco.' },
    // Ne-waza · Osaekomi-waza (imobilizações / controle) — oficiais do Kodokan
    { id:'osa-kesa', jp:'Kesa-gatame', pt:'Imobilização em echarpe', cat:'osaekomi', oficial:true, nivel:'dominada', treinos:12, ultima:'02 jun', ultimaRev:'2026-06-02', nota:'Prender cabeça e braço, quadril baixo, perna-freio atrás pra não ser rolado.' },
    { id:'osa-kuzure-kesa', jp:'Kuzure-kesa-gatame', pt:'Echarpe modificada', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:6, ultima:'30 mai', ultimaRev:'2026-05-30', nota:'Underhook no braço de longe em vez de prender a cabeça — mais estável contra a fuga.' },
    { id:'osa-kata', jp:'Kata-gatame', pt:'Imobilização pelo ombro', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:5, ultima:'28 mai', ultimaRev:'2026-05-28', nota:'O ombro empurra o braço contra o pescoço; junta as mãos e abre a base.' },
    { id:'osa-kami', jp:'Kami-shiho-gatame', pt:'Cem quilos (norte-sul)', cat:'osaekomi', oficial:true, nivel:'treinando', treinos:7, ultima:'27 mai', ultimaRev:'2026-05-27', nota:'Pegar a cintura/faixa, peito no peito, cabeça de um lado. Andar na ponta dos pés se ele virar.' },
    { id:'osa-yoko', jp:'Yoko-shiho-gatame', pt:'Cem quilos cruzado (lateral)', cat:'osaekomi', oficial:true, nivel:'dominada', treinos:10, ultima:'25 mai', ultimaRev:'2026-05-25', nota:'Bloquear quadril e pescoço, pressão de peito, joelhos colados pra matar a recuperação de guarda.' },
    { id:'osa-tate', jp:'Tate-shiho-gatame', pt:'Montada (cem quilos montado)', cat:'osaekomi', oficial:true, nivel:'aprendendo', treinos:3, ultima:'21 mai', ultimaRev:'2026-05-21', nota:'Ganchos por dentro, peso no peito, mãos no chão pra não ser rolado.' },
    // Ne-waza · Shime-waza (estrangulamentos)
    { id:'shi-hadaka', jp:'Hadaka-jime', pt:'Mata-leão', cat:'shime', oficial:true, nivel:'dominada', treinos:14, ultima:'30 mai', ultimaRev:'2026-05-30', nota:'Esconder o queixo, mão de bandeira, fechar o triângulo de braços.' },
    { id:'shi-okurieri', jp:'Okuri-eri-jime', pt:'Estrangulamento pela gola deslizante', cat:'shime', oficial:true, nivel:'treinando', treinos:5, ultima:'24 mai', ultimaRev:'2026-05-24', nota:'Pela costas: mão profunda na gola, a outra puxa a lapela oposta pra fechar.' },
    { id:'shi-sankaku', jp:'Sankaku-jime', pt:'Triângulo', cat:'shime', oficial:true, nivel:'treinando', treinos:7, ultima:'28 mai', ultimaRev:'2026-05-16', nota:'Ângulo é tudo — sair pra fora antes de fechar a perna. Especialidade do Kosen.' },
    // Ne-waza · Kansetsu-waza (chaves articulares)
    { id:'kan-juji', jp:'Juji-gatame', pt:'Chave de braço cruzada (armlock)', cat:'kansetsu', oficial:true, nivel:'treinando', treinos:8, ultima:'26 mai', ultimaRev:'2026-05-26', nota:'Prender o braço, juntar os joelhos, subir o quadril devagar pra não perder.' },
    { id:'kan-udegarami', jp:'Ude-garami', pt:'Chave de braço dobrada (kimura/americana)', cat:'kansetsu', oficial:true, nivel:'treinando', treinos:6, ultima:'23 mai', ultimaRev:'2026-05-23', nota:'Figura-de-quatro no braço; pulso colado ao corpo e gira o ombro.' },
    { id:'kan-waki', jp:'Ude-hishigi-waki-gatame', pt:'Chave de braço sob a axila', cat:'kansetsu', oficial:true, nivel:'aprendendo', treinos:2, ultima:'10 mai', ultimaRev:'2026-05-10', nota:'Prender o braço na axila e pressionar o cotovelo. Cuidado: entra rápido.' },
    // Kosen · ne-waza — guarda e jogo por baixo (Kodokan ou jargão documentado)
    { id:'kos-hikikomi', jp:'Hikikomi', pt:'Puxada para a guarda', cat:'kosen', oficial:false, nivel:'dominada', treinos:15, ultima:'02 jun', ultimaRev:'2026-06-01', nota:'Marca do Kosen: puxar direto pro chão. Pegada firme e senta já entrando com o gancho.' },
    { id:'kos-hikikomi-gaeshi', jp:'Hikikomi-gaeshi', pt:'Puxada com rolamento (raspagem)', cat:'kosen', oficial:false, nivel:'treinando', treinos:6, ultima:'31 mai', ultimaRev:'2026-05-17', nota:'Puxa pra guarda e usa o impulso pra rolar por cima — a raspagem clássica do Kosen.' },
    { id:'kos-dojime', jp:'Dō-jime', pt:'Tesoura de tronco', cat:'kosen', oficial:false, nivel:'treinando', treinos:4, ultima:'19 mai', ultimaRev:'2026-05-19', nota:'Comprime o tronco com as pernas. Banida no judô esportivo em 1925, viva no ne-waza Kosen.' },
    { id:'kos-ashigarami', jp:'Ashi-garami', pt:'Entrelaçamento de pernas (chave de perna)', cat:'kosen', oficial:false, nivel:'aprendendo', treinos:3, ultima:'22 mai', ultimaRev:'2026-05-13', nota:'Enrosca a perna e controla o joelho/tornozelo. O Kosen explora muito o que o judô esportivo baniu.' },
    { id:'kos-tate-sankaku', jp:'Tate-sankaku', pt:'Triângulo montado', cat:'kosen', oficial:false, nivel:'treinando', treinos:6, ultima:'29 mai', ultimaRev:'2026-05-21', nota:'Sankaku por cima, controlando da montada. Posição de domínio muito explorada no ne-waza Kosen.' },
    // Outros · BJJ moderno (nomes em PT consagrados, ou EN quando universal)
    { id:'out-guarda-fechada', jp:'Guarda fechada', pt:'Closed guard', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Base do jogo por baixo: pernas travadas no quadril, postura quebrada, controle de pegada. Masterizar até a faixa branca.' },
    { id:'out-guarda-aberta', jp:'Guarda aberta', pt:'Open guard', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Pernas livres, pés no quadril/joelhos do oponente. Ponto de partida das guardas modernas. Masterizar até a azul.' },
    { id:'out-meia-guarda', jp:'Meia-guarda', pt:'Half guard', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Uma perna do oponente entre as suas. Underhook é a chave. Masterizar até a azul.' },
    { id:'out-tartaruga', jp:'Tartaruga', pt:'Turtle', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Posição defensiva de quatro apoios. Proteger pescoço e cotovelos colados. Masterizar até a azul.' },
    { id:'out-guarda-borboleta', jp:'Guarda borboleta', pt:'Butterfly guard', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Ganchos por dentro das coxas, postura sentada, underhook ou pegada cruzada. Masterizar até a roxa.' },
    { id:'out-guarda-aranha', jp:'Guarda aranha', pt:'Spider guard', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Pegada nas mangas + pés nos bíceps. Controle de distância e ângulos. Masterizar até a roxa.' },
    { id:'out-delariva', jp:'De La Riva', pt:'Guarda De La Riva', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Gancho externo na coxa do oponente em pé. Criada por Ricardo De La Riva. Base do jogo moderno + entrada do berimbolo. Masterizar até a roxa.' },
    { id:'out-zguard', jp:'Z-guard', pt:'Z-guard (knee shield)', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Meia-guarda com joelho atravessado no peito do oponente. Quadro forte = oponente longe. Masterizar até a roxa.' },
    { id:'out-rasp-pendulo', jp:'Raspagem do pêndulo', pt:'Pendulum sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Underhook na perna + balanço da perna livre como pêndulo. Termina na montada. Masterizar até a azul.' },
    { id:'out-rasp-tesoura', jp:'Raspagem de tesoura', pt:'Scissor sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Canela atravessada na barriga, fecha as pernas em tesoura. Raspagem clássica da fechada. Masterizar até a azul.' },
    { id:'out-rasp-borboleta', jp:'Raspagem da borboleta', pt:'Butterfly sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Da borboleta: eleva com o gancho + underhook, joga lateral. Direção do underhook. Masterizar até a roxa.' },
    { id:'out-rasp-aranha', jp:'Raspagem da aranha', pt:'Spider sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Estica um braço, dobra o outro, gira o quadril. Várias variações (lasso, joelho na linha). Masterizar até a roxa.' },
    { id:'out-rasp-delariva', jp:'Raspagem De La Riva', pt:'DLR sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Gancho DLR + pegada manga/tornozelo. Desequilibra para fora. Entrada também pro berimbolo. Masterizar até a roxa.' },
    { id:'out-berimbolo', jp:'Berimbolo', pt:'Berimbolo (inversão para as costas)', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Popularizado pelos irmãos Mendes (~2009). Inverte o corpo por baixo girando da DLR pra pegar as costas. Mecânica do quadril é tudo. Masterizar até a roxa.' },
    { id:'out-rasp-xguard', jp:'Raspagem X-guard', pt:'X-guard sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Sistema X-guard de Marcelo Garcia: eleva a perna do oponente, desequilibra para trás ou para o lado. Masterizar até a roxa.' },
    { id:'out-rasp-balao', jp:'Raspagem balão', pt:'Balloon sweep', cat:'outros', oficial:false, nivel:'novo', treinos:0, ultima:'—', ultimaRev:null, nota:'Eleva o oponente com as duas pernas em forma de balão e rola por cima. Útil contra base forte. Masterizar até a roxa.' },
  ],

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

  // loja da academia (retirada na recepção, sem frete)
  loja: {
    cat: 'Todos',
    carrinho: [],   // { id, tam, qtd }
    // Catálogo REAL da Yama (importado de marketplace.youdraw.com.br/pages/store/yama-jiu-jitsu,
    // 2026-07-10). Imagens locais em loja/ (CSP 'self'). `img` opcional — fallback = emoji.
    produtos: [
      { id:1, nome:'Moletom Yama — Coleção Classic', cat:'Vestuário', preco:210.35, emoji:'🧥', cor:'#f0f0f2', img:'loja/moletom-yama.jpg', desc:'O moletom da Coleção Clássica Yama Jiu Jitsu foi criado para quem valoriza tradição, identidade e simplicidade.', tam:['P','M','G','GG','EG'] },
      { id:2, nome:'Camiseta Yama Jiu Jitsu — Coleção Classic', cat:'Vestuário', preco:131.29, emoji:'👕', cor:'#fdecec', img:'loja/camiseta-classic.jpg', desc:'A camiseta Classic Yama Jiu Jitsu traduz a essência da marca em sua forma mais pura.', tam:['P','M','G','GG','EG'] },
      { id:3, nome:"Seiryoku Zen'yō — Oversized", cat:'Vestuário', preco:180.91, emoji:'👕', cor:'#eaf4fe', img:'loja/seiryoku-zenyo.jpg', desc:'Inspirada no princípio Seiryoku Zen’yō: o máximo de eficiência com o mínimo de esforço.', tam:['P','M','G','GG','EG'] },
      { id:4, nome:'SAKURA JUDO', cat:'Vestuário', preco:147.94, emoji:'🌸', cor:'#fdecec', img:'loja/sakura-judo.jpg', desc:'Camiseta oversized da linha Sakura.', tam:['P','M','G','GG'] },
      { id:5, nome:'JIU JITSU SAKURA', cat:'Vestuário', preco:148.48, emoji:'🌸', cor:'#fef7e0', img:'loja/jiu-jitsu-sakura.jpg', desc:'Camiseta oversized da linha Sakura.', tam:['P','M','G','GG'] },
      { id:6, nome:'Body Infantil Yama — Coleção Classic', cat:'Vestuário', preco:53.06, emoji:'👶', cor:'#e7f6ef', img:'loja/body-infantil.png', desc:'O body infantil da Coleção Clássica, para quem faz parte da história desde cedo.', tam:['P','M','G','GG'] },
      { id:7, nome:'YAMA KIDS (0–3 anos)', cat:'Vestuário', preco:109.48, emoji:'🧒', cor:'#eaf4fe', img:'loja/yama-kids-0-3.jpg', desc:'Camiseta infantil Yama.', tam:['0','2'] },
      { id:8, nome:'YAMA Kids (4–9 anos)', cat:'Vestuário', preco:113.56, emoji:'🧒', cor:'#e7f6ef', img:'loja/yama-kids-4-9.jpg', desc:'Camiseta infantil Yama.', tam:['4','6','8'] },
    ],
  },

  // metas pessoais (removido)

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
window.DB = DB;   // expõe p/ o adapter (supabase.js lê global.DB; `const` não cria propriedade em window)

// Metas compartilhadas app ↔ adapter (fonte única — evita divergência entre painel
// do professor e cálculo do "self" do aluno logado). O adapter lê window.PROF_METAS
// lazy dentro das funções (adapter carrega antes do app; o valor só é usado depois).
// META_TEC: técnicas em nível ≥ treinando p/ o eixo "técnicas" do semáforo de graduação
// (aproximação Gymdesk-style até existir currículo por faixa — calibrável pelo dono).
const PROF_METAS = { META_MES:12, META_GRAU:40, RISCO_DIAS:14, META_TEC:8 };
window.PROF_METAS = PROF_METAS;
const isHoje = (s) => s === HOJE_ISO;

/* ============================================================
   MIGRAÇÃO — modelo de dados unificado (Etapa 1 da fusão Tatame+Renshū)
   Aditivo: cada técnica ganha `estado` (foco|arma|guardada|aprendida) e
   `dias[]` (histórico diário de 30 dias) · DB.links substitui DB.sistemas.
   ============================================================ */
const FOCO_INICIAL = ['Sankaku-jime','Hikikomi-gaeshi','Juji-gatame']; // máx 3 em treino (todas existem no catálogo)
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
  t.estado = FOCO_INICIAL.includes(t.jp) ? 'foco' : (t.nivel==='dominada' ? 'arma' : 'aprendida');
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
const APP_VERSION = 'v269';   // bate com app.js?v=N — mostrado no Perfil p/ confirmar a versão no aparelho
window.APP_VERSION = APP_VERSION;   // usado pelo adapter (sbSync.logError)
// >>> canal de feedback dos testers. WhatsApp (https://wa.me/55DDDNUMERO) ou e-mail (mailto:voce@exemplo.com)
const _FB = [55,31,99,62,48,90,9]; const FEEDBACK_URL = 'https://wa.me/'+_FB.join('')+'?text=';
// Loja da academia. LOJA_WHATSAPP = só dígitos com DDI. LOJA_PIX = chave PIX (telefone).
const LOJA_WHATSAPP = '5531996248909'; const LOJA_PIX = '31996248909';
// Código de presença do totem (fixo — ver CLAUDE.md). Com backend vira o código rotativo da aula.
const PRESENCA_CODE = '0000';
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
// modo teste (?test=1): roda o selfTest sobre o seed em memória, sem rede nem persistência
const TESTMODE = (()=>{ try{ return new URLSearchParams(location.search).has('test'); }catch(e){ return false; } })();

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
    .then(()=> _setSyncDot(true))
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
    window.addEventListener('error', (ev)=>{ report(String((ev&&(ev.message||ev.error))||''), { src:String((ev&&ev.filename)||'').split('/').pop(), ln:ev&&ev.lineno }); });
    window.addEventListener('unhandledrejection', (ev)=>{ report('promise: '+String((ev&&ev.reason&&ev.reason.message)||(ev&&ev.reason)||''), null); });
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
    <div class="rs-top"><div class="rs-nm-wrap"><span class="rs-name">${safeTxt(t.jp)}</span><div class="rs-sub">${safeTxt(t.pt||'')}</div></div>
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
      wrap.appendChild(el(`<div class="fsec-title"><span class="ico">🎯</span> O que deu certo no rolê?</div>`));
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
  if(ehHoje && !DB.checkinHoje.feito){
    DB.checkinHoje={feito:true,hora:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})};
  } // semana/streak são recalculados em atualizarSemana()
  const aula=aulaDoDia();
  const novoId = Date.now();
  const tecLabel = reps.length ? ('Renshū · '+det.renshu.map(r=>r.jp).join(', ')) : (reg.randori?'Treino com randori':'Treino (sem randori)');
  DB.treinos.unshift({ id:novoId, tipo:aula.tipo, data:dataTreino, titulo:aula.label, tecnica:tecLabel, mood:FEEL_LABEL[reg.mood], feel:reg.mood, det });
  if(!ehHoje) DB.treinos.sort((a,b)=> (b.data||'').localeCompare(a.data||''));   // treino de ontem entra na posição certa
  DB.justSaved = novoId;   // marca o treino recém-salvo p/ oferecer compartilhar na Home (efêmero, some no reload)
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
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${safeTxt(t.jp)}</div><div class="ts">${safeTxt(t.pt||'')} · ${plural(t.treinos||0,'treino','treinos')}</div></div><span class="rs-pk-go">＋</span></div>`);
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
  if (DB.trocarSenhaOpen) return 'trocarSenha';
  if (DB.onboardingOpen) return 'onb';
  if (DB.retroOpen) return 'retro';
  if (DB.lojaOpen) return 'loja';
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
  'loja':'Loja','share':'Compartilhar treino','treino':'Detalhe do treino','retro':'Retrospectiva',
  'onb':'Boas-vindas','trocarSenha':'Trocar senha','bootstrap':'Primeiro acesso',
  'prof:painel':'Painel','prof:alunos':'Alunos','prof:presencas':'Presenças',
  'prof:graduacoes':'Graduações','prof:turmas':'Turmas','prof:relatorios':'Relatórios',
  'prof:loja':'Loja · Gestão','prof:pedidos':'Pedidos',
  'flow:checkin':'Check-in','flow:registrar':'Registrar treino',
  'produtoForm':'Produto','cadastroAluno':'Cadastro de aluno',
};
function _announceRoute(viewKey){
  const reg = document.getElementById('route-announce'); if(!reg) return;
  const base = viewKey.split(':').slice(0,2).join(':');   // ignora sub-abas (jogoTab/jornadaTab)
  const nome = _ROUTE_NOMES[base] || _ROUTE_NOMES[viewKey] || null;
  if(nome) reg.textContent = nome;
}
function render(){
  if (!DEMO) atualizarSemana();        // semana/streak sempre derivados dos treinos reais
  const root = $('#root');
  const curView = _viewKey();
  const sameView = root.dataset.view === curView;
  // memoriza scrollY da view atual antes de trocar
  if (root.dataset.view && root.dataset.view !== curView && typeof _scrollMem !== 'undefined') _scrollMem[root.dataset.view] = window.scrollY;
  root.dataset.view = curView;
  if (!sameView) _announceRoute(curView);   // a11y: leitor de tela anuncia a troca de tela (SPA)
  document.body.setAttribute('data-role', DB.role||'aluno'); // hook do shell responsivo do professor (§7)
  // páginas cheias do professor não têm sidebar → zera o padding fantasma da .phone (desktop)
  root.classList.toggle('no-anim', sameView);
  root.innerHTML = '';
  // Login (Fase 0): só dispara quando o backend está ligado e não há sessão (authOpen).
  // Offline authOpen é sempre false → inerte. Sem este branch a tela de login nunca aparecia no cutover.
  if (DB.authOpen){ root.appendChild(renderAuth()); return; }
  if (DB.trocarSenhaOpen){ root.appendChild(renderTrocarSenha()); return; }
  if (DB.onboardingOpen){ root.appendChild(renderOnboarding()); return; }
  if (DB.retroOpen){ root.appendChild(renderRetro()); return; }
  // renderPresenca removido do roteador — presença agora é parte do flow unificado
  if (DB.lojaOpen){ root.appendChild(renderLoja()); return; }
  // Páginas cheias do professor: mantém a sidebar (tabbarProf vira sidebar no desktop via MQ).
  if (DB.produtoFormOpen){ root.appendChild(renderProdutoForm()); if (DB.role!=='aluno') root.appendChild(tabbarProf()); return; }
  if (DB.cadastroAlunoOpen){ root.appendChild(renderCadastroAluno()); if (DB.role!=='aluno') root.appendChild(tabbarProf()); return; }
  if (DB.shareOpen){ root.appendChild(renderShare()); return; }
  if (DB.treinoAberto){ root.appendChild(renderTreinoDetalhe()); return; }
  if (DB.flow){ root.appendChild(renderFlow(DB.flow)); return; }
  if (DB.role === 'aluno') root.appendChild(renderAluno());
  else root.appendChild(renderProfessor());
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
function _treinoDays(){ return new Set((DB.treinos||[]).map(t=>t.data).filter(Boolean)); }
function _countSince(set, sinceISO){ if(!sinceISO) return set.size; let c=0; set.forEach(d=>{ if(d>=sinceISO) c++; }); return c; }
// data em que o grau ATUAL começou (entrada de grau; cai p/ a faixa se grau 0 ou sem registro)
function _refDataGrauAtual(){
  const me=DB.eu, g=DB.graduacoes||[]; let e=null;
  if(me.graus>0) e=g.find(x=>x.tipo==='grau' && x.faixa===me.faixa && x.graus===me.graus);
  if(!e) e=g.find(x=>x.tipo==='faixa' && x.faixa===me.faixa);
  return e ? e.data : null;
}
// data em que a FAIXA atual começou
function _refDataFaixaAtual(){ const e=(DB.graduacoes||[]).find(x=>x.tipo==='faixa' && x.faixa===DB.eu.faixa); return e?e.data:null; }
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
  if(DEMO){ const atual=me.aulasGrau.atual||0;
    return { meta, atual, pct:Math.round(atual/meta*100), faltam:Math.max(0,meta-atual), restantes:me.aulasGraduacao||0 }; }
  const dias=_treinoDays();
  const noGrau=base + _countSince(dias, _refDataGrauAtual());        // aulas no grau atual
  const atual=noGrau;
  const naFaixa=base + _countSince(dias, _refDataFaixaAtual());      // aulas na faixa atual (estimativa p/ próxima faixa)
  const restantes=Math.max(0, (me.aulasGraduacao||160) - naFaixa);
  return { meta, atual, pct:Math.round(atual/meta*100), faltam:Math.max(0,meta-atual), restantes };
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
  const sub = dateMode ? dataLabel(t) : t.tecnica;
  const right = dateMode ? feelBadge(t)
                         : `<div class="day">${diaRelativo(t.data)}</div>${feelBadge(t)}`;
  const lesao = lesaoAtivaEm(t.data);
  const lesaoBadge = lesao ? `<span class="lesao-flag" title="Lesão ativa: ${safeAttr(lesao.parte)}" aria-label="Treino durante lesão: ${safeAttr(lesao.parte)}">🤕</span>` : '';
  const e = el(`<div class="h-item h-${t.tipo}${lesao?' has-lesao':''}">
    <div class="h-ic">${t.tipo==='tecnica'?'🥋':'⚡'}</div>
    <div class="h-tx"><div class="t">${safeTxt(t.titulo)}${lesaoBadge}</div><div class="d">${safeTxt(sub)}</div></div>
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
      _openActionSheet(t.titulo||'Treino', [
        { icon:'👁️', label:'Abrir detalhes', onClick:()=> abrirTreino(t.id) },
        { icon:'🗑️', label:'Excluir treino', danger:true, onClick:()=>{
          const snap = {...t}, idx = DB.treinos.findIndex(x=>x.id===t.id);
          const snapTecs = _snapTreinoTecs(t);           // M2: guarda o estado das técnicas p/ Desfazer
          _revertTreinoAgg(t);                           // M2: reverte treinos/dias das técnicas
          DB.treinos = DB.treinos.filter(x=>x.id!==t.id);
          render(); scheduleSave();
          toastUndo('Treino excluído', ()=>{ DB.treinos.splice(idx, 0, snap); _restoreTreinoTecs(snapTecs); render(); scheduleSave(); });
        } },
      ]);
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
  const ds=(DB.treinos||[]).map(t=>t.data).filter(Boolean).sort();
  if(ds.length===0) return 0;
  const p=ds[0].split('-').map(Number); const first=new Date(p[0],p[1]-1,p[2]); first.setHours(0,0,0,0);
  const semanas=Math.max(1,(hoje-first)/(86400000*7));   // semanas decorridas (≥1)
  return DB.treinos.length/semanas;                       // média de treinos por semana
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
    // mês de cada coluna: a que tem o dia 1; a primeira coluna herda seu mês de início
    const colMonth = weeks.map(wk=>{ for(const c of wk){ if(c && c.date.getDate()===1) return c.date.getMonth(); } return null; });
    if(colMonth[0]==null){ const f=weeks[0].find(c=>c); if(f) colMonth[0]=f.date.getMonth(); }
    const cols = weeks.map((wk,wi)=>{
      let cells=''; for(let r=0;r<6;r++){ const cell=wk[r]; const dn=cell?cell.date.getDate():''; cells+=`<span class="${cell?hmCellClass(cell):'hm-cell hm-empty'}">${dn}</span>`; }
      const lbl = colMonth[wi]!=null ? meses[colMonth[wi]] : '';
      return `<div class="hm-col"><span class="hm-clbl">${lbl}</span>${cells}</div>`;
    }).join('');
    const days=['S','T','Q','Q','S','S'];
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
    // Renshū do rolê: acerto por técnica praticada
    if (det.renshu && det.renshu.length){
      body.appendChild(el(`<div class="fsec-title" style="margin-top:6px"><span class="ico">🎯</span> No rolê de hoje</div>`));
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
      if(renshuEdits.length){
        bodyEl.appendChild(el(`<div class="fsec-title" style="margin-top:12px"><span class="ico">🎯</span> Renshū — acertos no rolê</div>`));
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
      } else {
        const focos = focoTecnicas();
        if(focos.length){
          bodyEl.appendChild(el(`<div class="fsec-title" style="margin-top:12px"><span class="ico">🎯</span> Adicionar Renshū retroativo</div>`));
          bodyEl.appendChild(el(`<div class="sheet-desc" style="margin:0 0 8px;font-size:12px">Técnicas em foco — toque para incluir no treino</div>`));
          focos.forEach(ft=>{
            const btn = el(`<button class="rs-pick" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px;margin-bottom:4px;border:1.5px solid var(--line);border-radius:10px;background:var(--field);cursor:pointer">
              <span style="font-size:13px;font-weight:700">${safeTxt(ft.jp)}</span><span style="color:var(--good);font-weight:800">＋</span></button>`);
            btn.onclick=()=>{ renshuEdits.push({id:ft.id||ft.jp, jp:ft.jp, a:0, t:0}); rebuildBody(); };
            bodyEl.appendChild(btn);
          });
        }
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
    if(randori && renshuEdits.length) t.det.renshu=renshuEdits;
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
    ctx.fillStyle='#fff'; ctx.font=`900 84px ${SF}`; ctx.fillText((DB.checkinHoje&&DB.checkinHoje.hora)||'19h',ix,cy+58);
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
      ctx.fillStyle='rgba(255,255,255,.7)'; ctx.font=`800 18px ${SF}`; ctx.fillText('de acerto no rolê',ix,cy+150);
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

  // ===== Acerto geral no tempo (agregado foco + arsenal) — topo =====
  const agg = [];
  for(let i=0;i<30;i++){ let a=0,tt=0,dia='';
    ativas.forEach(t=>{ const d=(t.dias||[])[i]; if(d){ a+=d.a; tt+=d.t; dia=d.dia; } });
    agg.push({a,t:tt,dia}); }
  const aggTot = agg.reduce((s,d)=>({a:s.a+d.a,t:s.t+d.t}),{a:0,t:0});
  const aggP = _pctAT(aggTot.a, aggTot.t);
  w.appendChild(el(`<div class="sec-title" style="margin-top:6px">Acerto geral no tempo</div>`));
  const aggCard = el(`<div class="sc-card" style="margin:0 20px 16px"></div>`);
  aggCard.appendChild(el(`<div class="sc-big"><b style="color:${corPct(aggP)}">${aggP}%</b><span>de acerto geral</span><i>foco + arsenal</i></div>`));
  aggCard.appendChild(dayChartNode(agg));
  w.appendChild(aggCard);

  // ===== KPIs focados em técnica =====
  const arsenalArr = ativas.map(t=>({t,...totaisTec(t)})).filter(x=>x.T>0 && x.p>=meta).sort((a,b)=>b.p-a.p);
  const acertoMedio = Math.round(_media(ativas.map(t=>totaisTec(t).p)));
  w.appendChild(el(`<div class="kpis block">
    <div class="kpi"><div class="v blue">${DB.tecnicas.length}</div><div class="l">Técnicas</div></div>
    <div class="kpi"><div class="v red">${arsenalArr.length}</div><div class="l">No arsenal</div></div>
    <div class="kpi"><div class="v green">${acertoMedio}%</div><div class="l">Acerto médio</div></div>
  </div>`));

  // ===== Arsenal confiável (técnicas acima da média — vindo do Seu Jogo) =====
  w.appendChild(el(`<div class="sec-title" style="margin-top:14px">Arsenal confiável</div>`));
  if (arsenalArr.length){
    const al = el(`<div class="arsenal-list"></div>`);
    arsenalArr.forEach(({t,p})=>{
      const row = el(`<div class="ars-row">
        <div class="ars-tx"><div class="tn">${safeTxt(t.jp)}</div><div class="ts">${safeTxt(t.pt||'')}</div></div>
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

  // domínio por categoria (o que já aprendi)
  w.appendChild(el(`<div class="sec-title" style="margin-top:16px">Domínio por categoria</div>`));
  const dom = el(`<div class="dom-list"></div>`);
  CAT_ORDER.forEach(cat=>{
    const itens = DB.tecnicas.filter(t=>t.cat===cat);
    if (!itens.length) return;
    const d = itens.filter(t=>nivelDe(t)==='dominada').length;
    const tr = itens.filter(t=>nivelDe(t)==='treinando').length;
    const ap = itens.filter(t=>nivelDe(t)==='aprendendo').length;
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
    <div class="dchart-leg"><span class="dl-key"><i class="dl-sw dl-above"></i> acima da média</span><span class="dl-key"><i class="dl-sw dl-below"></i> abaixo</span><span class="dl-key dl-meta"><i class="dl-dash"></i> média · ${meta}%</span></div>
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
    const row = el(`<div class="rs-pick"><div class="rs-pk-tx"><div class="tn">${safeTxt(t.jp)}</div><div class="ts">${safeTxt(t.pt||'')}</div></div><span class="rs-pk-go">＋</span></div>`);
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

  // KPIs (3 colunas dos níveis com progresso real)
  w.appendChild(el(`<div class="kpis block" style="margin-top:6px">
    <div class="kpi"><div class="v gold">${cont.aprendendo}</div><div class="l">Aprendendo</div></div>
    <div class="kpi"><div class="v blue">${cont.treinando}</div><div class="l">Treinando</div></div>
    <div class="kpi"><div class="v green">${cont.dominada}</div><div class="l">Dominadas</div></div>
  </div>`));

  // 🔁 Revisão espaçada
  const due = tecnicasParaRevisar();
  if (due.length){
    w.appendChild(el(`<div class="sec-row"><div class="sec-title" style="margin:0">🔁 Revisar · ${due.length}</div>
      <span style="font-size:12px;color:var(--muted);font-weight:700">faz tempo que não treina</span></div>`));
    const rl = el(`<div class="tec-list"></div>`);
    due.slice(0,4).forEach(({t,i,dias})=>{
      const row = el(`<div class="tec-row rev-row">
        <div class="tec-ic rev-ic">🔁</div>
        <div class="tec-tx"><div class="tn">${safeTxt(t.jp)}</div>
          <div class="ts">${safeTxt(t.pt)} · faz ${dias} dias</div></div>
        <button class="rev-ok" title="Revisei">✓</button></div>`);
      row.querySelector('.rev-ok').onclick = (e)=>{ e.stopPropagation(); marcarRevisado(i); };
      row.onclick = ()=> bibToggle(t.jp);
      rl.appendChild(row);
    });
    w.appendChild(rl);
  }

  // adicionar técnica
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

  const bibNivel = DB._bibNivel || null;
  const fbar = el(`<div class="bib-filter-bar"></div>`);
  [['novo','Catálogo','muted',cont.novo],['aprendendo','Aprendendo','gold',cont.aprendendo],['treinando','Treinando','blue',cont.treinando],['dominada','Dominadas','green',cont.dominada]].forEach(([id,l,cls,n])=>{
    const b = el(`<button class="bib-fchip ${cls} ${bibNivel===id?'on':''}">${l} · ${n}</button>`);
    b.onclick = ()=>{ DB._bibNivel = bibNivel===id ? null : id; render(); };
    fbar.appendChild(b);
  });
  w.appendChild(fbar);

  const searchResults = el(`<div class="bib-search-results"></div>`);
  w.appendChild(searchResults);

  const filterByNivel = (arr)=> bibNivel ? arr.filter(t=>nivelDe(t)===bibNivel) : arr;

  // 📚 Catálogo — por categoria, accordion fechado, 1 categoria por vez
  const catBlock = el(`<div></div>`);
  catBlock.appendChild(el(`<div class="bib-div">📚 Catálogo · por categoria</div>`));
  CAT_ORDER.forEach(cat=>{
    const itensTotais = DB.tecnicas.filter(t=>t.cat===cat);
    const itens = filterByNivel(itensTotais);
    if(!itensTotais.length) return;
    const c = CATS[cat];
    const open = DB.bibCat===cat;
    const dueN = itens.filter(t=>(t.treinos||0)>0 && revInfo(t).due).length;
    const tagCls = cat==='outros' ? 'mod' : (cat==='kosen' ? 'kosen' : 'oficial');
    const tagTxt = cat==='outros' ? 'BJJ moderno' : (cat==='kosen' ? 'não-oficial' : 'Kodokan');
    const head = el(`<div class="cat-acc ${open?'open':''} ${bibNivel && !itens.length?'dim':''}" data-cat="${cat}">
      <div class="cat-emoji" title="${c.nome}">${c.emoji}</div>
      <div class="cat-tx"><div class="cn">${c.nome}</div><div class="cs">${c.sub}</div></div>
      ${dueN?`<span class="cat-due" title="a revisar">${dueN}🔁</span>`:''}
      <span class="cat-tag ${tagCls}">${tagTxt}</span>
      <span class="cat-acc-n">${bibNivel?`${itens.length}/${itensTotais.length}`:itensTotais.length}</span>
      <span class="cat-caret">${open?'⌄':'›'}</span>
    </div>`);
    head.onclick = ()=>{ DB.bibCat = open?null:cat; DB.bibExp=null; render(); };
    catBlock.appendChild(head);
    if(open){
      const children = el(`<div class="cat-children"></div>`);
      if(!itens.length){ children.appendChild(el(`<div class="empty-line" style="padding:10px 20px">Nenhuma técnica nesse filtro</div>`)); }
      else itens.forEach(t=> children.appendChild(bibCardNode(t, t.estado)));
      catBlock.appendChild(children);
    }
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
        <div class="rep-st">${safeTxt(t.pt||'')} · ${stat}${subs.length?` · ${subs.length} sub`:''}${pres.length?` · ${pres.length} pré`:''}${isCustom?' · customizada':''}</div></div>
      <span class="rep-caret">${exp?'⌄':'›'}</span>
    </div>
    ${exp?`<div class="rep-sub">
      <div class="rs-lab">Estatísticas</div>
      ${bibStats(t)}
      ${t.nota?`<div class="rs-lab">Sua anotação</div><div class="det-nota">${safeTxt(t.nota)}</div>`:''}
      <div class="rs-lab">Revisão espaçada</div>
      <div class="bib-rev ${r.due?'due':''}">${r.due?`faz ${r.dias} dias — passou do intervalo de ${r.alvo}d`:`em dia · revisada faz ${r.dias}d (intervalo ${r.alvo}d)`}</div>
      ${st==='guardada'?`<button class="rs-add voltar" data-act="voltar">↩ voltar a praticar</button>`:(st==='aprendida'?`<button class="rs-add voltar" data-act="voltar">＋ colocar no foco</button>`:'')}
      <div class="rs-lab">Vem de (pré-técnicas)</div>
      ${pres.length?pres.map(s=>`<div class="rs-item"><span>${safeTxt(_tecLabel(s))} →</span><button data-del-de="${safeAttr(s)}" data-del-para="${safeAttr(key)}">✕</button></div>`).join(''):'<div class="rs-empty">nada apontando pra cá ainda</div>'}
      <div class="rs-lab">Leva pra (subtécnicas)</div>
      ${subs.length?subs.map(s=>`<div class="rs-item"><span>→ ${safeTxt(_tecLabel(s))}</span><button data-del-de="${safeAttr(key)}" data-del-para="${safeAttr(s)}">✕</button></div>`).join(''):'<div class="rs-empty">nenhuma ainda</div>'}
      <button class="rs-add" data-act="connect">＋ conectar subtécnica</button>
      <div class="bib-actions">
        <button class="bib-btn" data-act="revisar">Marcar revisado</button>
        <button class="bib-btn ghost" data-act="editar">Editar</button>
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
    card.querySelector('[data-act="editar"]').onclick=(e)=>{ e.stopPropagation(); bibEditar(t.jp); };
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
  const fg = (DB.graduacoes||[]).find(x=>x.tipo==='faixa' && x.faixa===me.faixa);
  const mesesFaixa = fg ? tempoNaFaixaMeses(fg.data) : null;
  let tempoTxt='—';
  if(mesesFaixa!=null){ const an=Math.floor(mesesFaixa/12), rm=mesesFaixa%12; tempoTxt=((an?an+'a ':'')+(rm?rm+'m':'')).trim()||'0m'; }

  w.appendChild(el(`<div class="mod-card" style="margin-top:6px">
    <div class="mod-title">Faixa atual: <b style="color:var(--ink)">${belt.nome} · ${me.graus}º grau</b></div>
    <div class="belt-rank${belt.bar?' bicolor':''}" style="--bc:${belt.cor}${belt.bar?';--bar:'+belt.bar:''}"><span class="br-body"></span><span class="br-tip${curRed?' red-tip':''}">${stripes}</span><span class="br-end"></span></div>
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

  const ag = aulasStats();
  const paceSem = DEMO ? 3 : Math.round(paceSemanal()*10)/10;
  const grauLbl = (me.graus >= maxGrausDe(me.faixa)) ? 'p/ proxima faixa' : 'p/ proximo grau';
  w.appendChild(el(`<div class="mod-card aulas-card">
    <div class="mod-title" style="font-size:13px">Progresso por aulas</div>
    <div class="mod-grid">
      <div class="mc"><div class="big" style="font-size:18px">${ag.atual}/${ag.meta}</div>
        <div class="lbl">${ag.atual>=ag.meta?aptoMsg(me, me.graus>=maxGrausDe(me.faixa), ag.atual-ag.meta):plural(ag.faltam,'aula','aulas')+' '+grauLbl}</div>
        <div class="mini-bar"><span style="width:${ag.pct}%"></span></div></div>
      <div class="mc bd"><div class="big" style="font-size:18px">~${ag.restantes}</div>
        <div class="lbl">aulas p/ proxima faixa · ${paceSem}/sem</div></div>
    </div>
  </div>`));

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
    const titulo = g.tipo==='faixa' ? `Faixa ${x.nome}` : `${g.graus}º grau · ${x.nome}`;
    const [y,m,d] = g.data.split('-');
    const dataFmt = `${d}/${m}/${y}`;
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
// Categorias no continuum da arte única — do em pé ao chão
// Categorias — taxonomia Kodokan oficial (referência: CBJ + Kodokan Judo Institute).
// `kanji` = caractere principal do nome da categoria. `sub` = tradução PT documentada.
const CATS = {
  nage:     { nome:'Nage-waza', sub:'Técnicas de projeção', emoji:'投' },
  osaekomi: { nome:'Osaekomi-waza', sub:'Técnicas de imobilização (solo)', emoji:'押' },
  shime:    { nome:'Shime-waza', sub:'Técnicas de estrangulamento', emoji:'絞' },
  kansetsu: { nome:'Kansetsu-waza', sub:'Técnicas de luxação articular', emoji:'関' },
  kosen:    { nome:'Kosen · ne-waza', sub:'Tradição Kosen · técnicas de solo', emoji:'寝' },
  outros:   { nome:'Outros', sub:'BJJ moderno · guardas e raspagens', emoji:'柔' },
};
const CAT_ORDER = ['nage','osaekomi','shime','kansetsu','kosen','outros'];

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
      <div><div class="tec-sheet-name">${safeTxt(t.jp)}</div>
        <div class="ts">${safeTxt(t.pt)}</div></div>
      <span class="niv-badge ${cor}" style="margin-left:auto">${nl}</span>
    </div>
    <div class="tec-sheet-meta">${tag}<span class="meta-dot">·</span><span>${c.nome}</span><span class="meta-dot">·</span><span>${plural(t.treinos||0,'treino','treinos')} · últ. ${t.ultima}</span></div>
    <div class="flbl" style="margin-top:16px">Sua anotação</div>
    <div class="det-nota">${safeTxt(t.nota||'—')}</div>
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
    <label class="flbl">Nome (japonês)</label>
    <input class="inp" id="et-jp" placeholder="Ex: Juji-gatame" value="${safeAttr(t.jp)}">
    <label class="flbl" style="margin-top:12px">Tradução (PT)</label>
    <input class="inp" id="et-pt" placeholder="Ex: Chave de braço cruzada" value="${safeAttr(t.pt)}">
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
    const data = { jp, pt:sheet.querySelector('#et-pt').value.trim(), cat, oficial:cat!=='kosen'&&cat!=='outros', nivel:niv, nota:sheet.querySelector('#et-nota').value.trim() };
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
      <div class="ld-head"><span class="ld-t">🛍️ Loja Yama</span><a class="ld-link">ver tudo ›</a></div>
      <div class="ld-ticker" aria-label="Vitrine rolante da Loja Yama"><div class="ld-track"></div></div>
    </div>`);
    lojaWrap.querySelector('.ld-link').onclick = ()=> openLoja();
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
    _prodsAtivos.forEach(p=> track.appendChild(_mkCard(p)));   // clone p/ loop infinito
    w.appendChild(lojaWrap);
    // Auto-scroll suave via rAF (substitui a marquee CSS). Pausa no toque/hover
    // e retoma 2.5s depois do último gesto. Loop: quando passa da metade (cards
    // duplicados), volta scrollLeft pra 0 sem behavior. Respeita reduced-motion.
    const ticker = lojaWrap.querySelector('.ld-ticker');
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      let paused=false, resumeAt=0, raf=0;
      const step = (ts)=>{
        if(!paused && ts >= resumeAt){
          const half = track.scrollWidth/2;
          if(ticker.scrollLeft >= half) ticker.scrollLeft -= half;
          else ticker.scrollLeft += 0.4;
        }
        raf = requestAnimationFrame(step);
      };
      const bump = ()=>{ paused=true; resumeAt = performance.now()+2500; };
      const release = ()=>{ paused=false; };
      ticker.addEventListener('pointerdown', bump, { passive:true });
      ticker.addEventListener('pointerup', release, { passive:true });
      ticker.addEventListener('pointercancel', release, { passive:true });
      ticker.addEventListener('mouseenter', bump);
      ticker.addEventListener('mouseleave', release);
      raf = requestAnimationFrame(step);
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
  if(_rowWa){ const _gw=()=>toast('Fale com o professor pelo WhatsApp da academia'); _rowWa.onclick=_gw; _rowWa.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _gw(); } }; }
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
    <div class="info-row" id="row-config" role="button" tabindex="0" aria-label="Configurações" style="cursor:pointer"><div class="ii">⚙️</div><div class="it"><div class="t">Configurações</div></div><div class="iv">›</div></div>
  </div>`);
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
      const f = el(`<div class="tab fab-tab" role="button" tabindex="0" aria-label="Registrar treino"><div class="fb" aria-hidden="true">+</div><span class="tl">${label}</span></div>`);
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
const CHECKIN_JANELA_MIN = 30;   // janela de ±30 min p/ liberar o check-in de uma sessão
function _sessaoLabel(s){ return `${s.turmaNome} · ${s.hora}${s.variacao?' · '+s.variacao:''}`; }
function sessoesDeHoje(){
  const dk = DOW_KEY[hoje.getDay()]; const out=[];
  (DB.turmas||[]).forEach(t=>{ (t.sessoes||[]).forEach(s=>{ if(s.dia===dk) out.push({ turmaId:t.id, turmaNome:t.nome, cor:t.cor, hora:s.hora, variacao:s.variacao, bilingue:s.bilingue }); }); });
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
function _sessoesNaJanela(min){
  min = min || CHECKIN_JANELA_MIN;
  const arr = sessoesDeHoje().map(s=>({ ...s, _dt:_minutosAte(s.hora) }))
    .filter(s => s._dt!=null && Math.abs(s._dt) <= min);
  arr.sort((a,b)=> Math.abs(a._dt) - Math.abs(b._dt));
  return arr;
}
// Set de turmaIds que já receberam check-in hoje (dedup por turma, não por dia).
function _turmasComCheckin(){
  const set = new Set();
  const p = DB.checkinHoje && DB.checkinHoje.porTurma;
  if(p) Object.keys(p).forEach(k=>set.add(k));
  return set;
}
// Sessões elegíveis p/ check-in AGORA: dentro da janela E cuja turma ainda não foi feita.
function _sessoesElegiveis(){
  const feitas = _turmasComCheckin();
  return _sessoesNaJanela().filter(s => !feitas.has(s.turmaId));
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
    // sem grade hoje ou fora de qualquer janela → mantém retrocompat (check-in sem sessão)
    const todas = sessoesDeHoje();
    if(todas.length === 0){ _finalizarCheckin(null); return; }
    const feitas = _turmasComCheckin();
    const restantes = todas.filter(s => !feitas.has(s.turmaId));
    if(restantes.length === 0){ toast('Você já fez check-in em todas as aulas de hoje ✔'); DB.flow=null; render(); return; }
    toast('Fora do horário da aula (janela de ±' + CHECKIN_JANELA_MIN + ' min)'); DB.flow=null; render(); return;
  }
  if(ses.length > 1){ _sessaoPickSheet(ses, s=>_finalizarCheckin(s)); return; }
  _finalizarCheckin(ses[0]);   // 1 sessão elegível: direto
}
function _finalizarCheckin(sessao){
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  // variacao viaja junto → pushCheckin grava o TIPO da aula (No-Gi/Avançado/…/Aula) no checkin.
  const s = sessao ? { turmaId:sessao.turmaId, label:_sessaoLabel(sessao), variacao:sessao.variacao||null } : null;
  // Dedup por TURMA (não por dia): acumula em porTurma; mantém {feito,hora,sessao} p/ retrocompat.
  const prev = DB.checkinHoje || {};
  const porTurma = Object.assign({}, prev.porTurma || {});
  if(s) porTurma[s.turmaId] = { hora, label:s.label };
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
    <button class="sheet-cancel" id="sp-skip">Não sei / pular</button>
  </div></div>`);
  const list = sheet.querySelector('.sess-pick');
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sessoes.forEach(s=>{
    const row = el(`<button class="cfg-row" style="width:100%;text-align:left;font-family:inherit;cursor:pointer">
      <span><b style="color:${safeAttr(s.cor||'var(--ink)')}">${safeTxt(s.hora)}</b> · ${safeTxt(s.turmaNome)}${s.variacao?' · '+safeTxt(s.variacao):''}${s.bilingue?' '+icoUSFlag():''}</span></button>`);
    row.onclick=()=>{ close(); onPick(s); };
    list.appendChild(row);
  });
  // Código já foi validado: fechar por fora NÃO perde o check-in — confirma sem sessão.
  sheet.onclick=(e)=>{ if(e.target===sheet){ close(); onPick(null); } };
  sheet.querySelector('#sp-skip').onclick=()=>{ close(); onPick(null); };
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
   TOTEM DE PRESENÇA — Fase 1 do flow (escanear QR ou digitar código)
   Código fixo PRESENCA_CODE ('0000'). Com backend vira código rotativo da aula.
   ============================================================ */
let _otp = '';
function icoQRbig(){
  // QR estilizado (3 marcadores de posição + módulos) — só visual.
  const m = (x,y)=>`<rect x="${x}" y="${y}" width="22" height="22" rx="3" fill="currentColor"/><rect x="${x+5}" y="${y+5}" width="12" height="12" rx="1.5" fill="var(--card)"/><rect x="${x+8}" y="${y+8}" width="6" height="6" fill="currentColor"/>`;
  const d=[[40,4],[52,4],[4,40],[16,52],[40,40],[52,52],[64,40],[40,52],[52,64],[64,64],[4,64]];
  const dots=d.map(([x,y])=>`<rect x="${x}" y="${y}" width="8" height="8" rx="1.5" fill="currentColor"/>`).join('');
  return `<svg viewBox="0 0 86 86" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${m(2,2)}${m(62,2)}${m(2,62)}${dots}</svg>`;
}
function _atualizaOtp(){
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((b,i)=>{
    b.textContent = _otp[i] || '';
    b.classList.toggle('filled', i < _otp.length);
    b.classList.toggle('active', i === _otp.length);
  });
}
function presencaDigit(n){
  if(_otp.length >= 4) return;
  _otp += n; _atualizaOtp();
  if(_otp.length === 4) setTimeout(confirmarPresenca, 160);
}
function presencaBack(){ _otp = _otp.slice(0,-1); _atualizaOtp(); }
async function presencaScan(){
  if(!('BarcodeDetector' in window)){ toast('Câmera/QR não suportado aqui — use o código'); return; }
  let stream;
  try{ stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' } }); }
  catch(e){ toast('Sem acesso à câmera — use o código'); return; }
  let det; try{ det = new BarcodeDetector({ formats:['qr_code'] }); }catch(e){ stream.getTracks().forEach(t=>t.stop()); toast('Leitor de QR indisponível — use o código'); return; }
  const ov = el(`<div class="scan-overlay">
    <video autoplay playsinline muted></video>
    <div class="scan-frame"></div>
    <div class="scan-hint">Aponte para o QR da aula</div>
    <button class="scan-close">Cancelar</button>
  </div>`);
  const video = ov.querySelector('video'); video.srcObject = stream;
  let stop=false;
  const close=()=>{ stop=true; try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){} ov.remove(); };
  ov.querySelector('.scan-close').onclick=close;
  document.body.appendChild(ov);
  const tick=async()=>{
    if(stop) return;
    try{
      const codes = await det.detect(video);
      if(codes && codes.length){
        const val = (codes[0].rawValue||'').trim();
        // aceita o código puro, "YAMA:0000" ou qualquer payload que contenha o código da aula
        if(val===PRESENCA_CODE || val.includes(PRESENCA_CODE) || /yama/i.test(val)){ close(); _otp=''; _flowCheckin(); return; }
      }
    }catch(e){}
    requestAnimationFrame(tick);
  };
  video.onloadedmetadata=()=>{ video.play().catch(()=>{}); requestAnimationFrame(tick); };
}
function confirmarPresenca(){
  if(_otp === PRESENCA_CODE){ _otp = ''; _flowCheckin(); return; }
  _otp = '';
  const row = document.querySelector('.otp-row');
  if(row){ row.classList.add('shake'); setTimeout(()=>row.classList.remove('shake'), 420); }
  _atualizaOtp();
  toast('Código incorreto ✕');
}
function _renderPhase1(){
  _otp = '';
  const v = el(`<div class="view"></div>`);
  v.innerHTML = `<div class="flow-head">
    <div class="back" role="button" tabindex="0" aria-label="Voltar" data-click="closeFlow">‹</div>
    <div class="ft"><div class="t">Check-in</div>
      <div class="s">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div></div>
  </div>`;
  const body = el(`<div class="presenca-body"></div>`);
  if(DB.flow && DB.flow.aviso2x){
    const n = DB.treinos.filter(t=>t.data===HOJE_ISO).length;
    body.appendChild(el(`<div style="background:var(--red-tint);color:var(--red-strong);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;margin:0 0 16px;text-align:center">Você já registrou ${plural(n,'treino','treinos')} hoje</div>`));
  }
  const qr = el(`<div class="qr-card">
    <div class="qr-frame">${icoQRbig()}</div>
    <button class="btn-scan">📷 Escanear QR da aula</button>
    <div class="qr-hint">Aponte para o QR exibido no tatame</div>
  </div>`);
  qr.querySelector('.btn-scan').onclick = presencaScan;
  body.appendChild(qr);
  body.appendChild(el(`<div class="or-div"><span>ou digite o código</span></div>`));
  body.appendChild(el(`<div class="otp-row">${[0,1,2,3].map(()=>'<div class="otp-box"></div>').join('')}</div>`));
  const kp = el(`<div class="keypad"></div>`);
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k=>{
    if(k===''){ kp.appendChild(el('<div></div>')); return; }
    const b = el(`<button class="key" aria-label="${k==='⌫'?'Apagar':k}">${k}</button>`);
    b.onclick = ()=> k==='⌫' ? presencaBack() : presencaDigit(k);
    kp.appendChild(b);
  });
  body.appendChild(kp);
  body.appendChild(el(`<div style="height:24px"></div>`));
  v.appendChild(body);
  setTimeout(_atualizaOtp, 0);
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

/* Totem de presença = Fase 1 do flow (_renderPhase1): QR + código PRESENCA_CODE.
   Código correto → _flowCheckin() confirma a presença. */

/* ============================================================
   LOJA — produtos da academia (retirada na recepção)
   ============================================================ */
function openLoja(){ DB.lojaOpen=true; render(); window.scrollTo(0,0); }
function closeLoja(){ DB.lojaOpen=false; render(); }
function setLojaCat(c){ DB.loja.cat=c; render(); }
// B6: o badge só conta itens de produtos ainda disponíveis (ativos)
function carrinhoQtd(){ return DB.loja.carrinho.reduce((s,i)=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return (p && p.ativo!==false) ? s+i.qtd : s; },0); }
function carrinhoTotal(){ return DB.loja.carrinho.reduce((s,i)=>{ const p=DB.loja.produtos.find(x=>x.id===i.id); return (p && p.ativo!==false) ? s+p.preco*i.qtd : s; },0); }

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
    slidesEl.addEventListener('scroll', ()=>{
      const i = Math.round(slidesEl.scrollLeft / (slidesEl.clientWidth||1));
      heroEl.querySelectorAll('.hero-dots span').forEach((d,j)=> d.classList.toggle('on', j===i));
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
      const c = el(`<div class="prod-card${allSold?' sold-out':''}" data-nm="${safeAttr((p.nome||'').toLowerCase())}">
        <div class="prod-img${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${safeTxt(p.emoji)}
          ${allSold?'<span class="prod-sold-badge">Esgotado</span>':''}
        </div>
        <div class="prod-info">
          <div class="prod-name">${safeTxt(p.nome)}</div>
          <div class="prod-price">${moneyBR(p.preco)}</div>
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
    <div class="prod-hero${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${safeTxt(p.emoji)}${_prodImgHTML(p)}</div>
    <div class="prod-sheet-name">${safeTxt(p.nome)}</div>
    <div class="prod-sheet-price">${moneyBR(p.preco)}</div>
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
  const pixRow = LOJA_PIX ? `<div style="display:flex;align-items:center;gap:8px;background:var(--field);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:10px">
    <span style="font-size:11px;font-weight:800;color:var(--muted)">PIX</span>
    <code style="flex:1;min-width:0;font-size:12.5px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeTxt(LOJA_PIX)}</code>
    <button id="cart-pix-copy" style="border:none;background:var(--red);color:#fff;font-size:12px;font-weight:800;padding:6px 12px;border-radius:99px;cursor:pointer">Copiar</button>
  </div>` : '';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Sua sacola</div>
    <div class="cart-items"></div>
    <div class="cart-total"><span>Total</span><b>${moneyBR(carrinhoTotal())}</b></div>
    ${pixRow}
    <div class="cart-pickup">📍 Retire na recepção da Yama — sem frete · pague no PIX e confirme o pedido no WhatsApp</div>
    <button class="btn-save" style="margin-top:6px">📲 Enviar pedido no WhatsApp</button>
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
        <div class="ci-img${p.img?' has-img':''}" style="background:${safeAttr(p.cor)}">${safeTxt(p.emoji)}${_prodImgHTML(p)}</div>
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
    totalEl.textContent = moneyBR(carrinhoTotal());
  };
  const _cartChanged = ()=>{
    scheduleSave();
    const btn = document.querySelector('.cart-btn');   // atualiza o badge do topo sem re-render pesado
    if(btn){ const q=carrinhoQtd(); btn.innerHTML='🛍️'+(q?`<span class="cart-badge">${q}</span>`:''); }
    if(!DB.loja.carrinho.length){ close(); toast('Sacola vazia'); return; }
    renderItems();
  };
  renderItems();
  const pixBtn = sheet.querySelector('#cart-pix-copy');
  if(pixBtn) pixBtn.onclick = async ()=>{ try{ await navigator.clipboard.writeText(LOJA_PIX); toast('Chave PIX copiada ✓'); }catch(e){ toast('Copie a chave: '+LOJA_PIX); } };
  sheet.querySelector('.btn-save').onclick = ()=>{ close(); finalizarCompra(); };
}

// Monta o pedido e abre o WhatsApp da academia (sem backend; pagamento via PIX).
function finalizarCompra(){
  if (!LOJA_WHATSAPP){ toast('⚠️ Loja sem WhatsApp configurado'); return; }
  const linhas = DB.loja.carrinho.map(i=>{ const p=DB.loja.produtos.find(x=>x.id===i.id);
    return `• ${p.nome} (${i.tam}) x${i.qtd} — ${moneyBR(p.preco*i.qtd)}`; }).join('\n');
  const pix = LOJA_PIX ? `\nPagamento via PIX: ${LOJA_PIX}` : '\nPagamento via PIX.';
  const msg = `Olá! Quero comprar na Loja Yama:\n${linhas}\n\nTotal: ${moneyBR(carrinhoTotal())}${pix}\nVou retirar na recepção.`;
  // A3 (auditoria): popup bloqueado retorna null SEM lançar exceção — só limpamos
  // a sacola quando a janela do WhatsApp realmente abriu, senão o pedido se perdia.
  let win = null;
  try{ win = window.open(`https://wa.me/${LOJA_WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank'); }catch(e){ win = null; }
  if(!win){ toast('⚠️ Não consegui abrir o WhatsApp — permita pop-ups e tente de novo. Sua sacola foi mantida.'); return; }
  // Registra o pedido (pendente) no backend p/ o professor confirmar depois → baixa de estoque.
  // Guardado: só com backend real (offline/demo não registra). Não bloqueia o fluxo se falhar.
  if(DB.sbUser && !DEMO && typeof sbSync!=='undefined' && sbSync.registrarPedido){
    const itens = DB.loja.carrinho.map(i=>{ const p=DB.loja.produtos.find(x=>x.id===i.id);
      return { produto_id:i.id, nome:p?p.nome:'', tam:i.tam, qtd:i.qtd, preco:p?p.preco:0 }; });
    try{ sbSync.registrarPedido(itens, carrinhoTotal()); }catch(e){}
  }
  DB.loja.carrinho = [];
  if (DB.lojaOpen) render();
  scheduleSave();
  toast('Pedido aberto no WhatsApp ✔');
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

/* Troca de senha no 1º acesso (P1): disparada quando sbAuth.mustChangePassword() é true. */
function renderTrocarSenha(){
  const v = el('<div class="view auth-view"></div>');
  v.appendChild(el('<div class="auth-safe"></div>'));
  v.appendChild(el(`<div class="auth-hero">
    <img class="auth-logo" src="brand/logo.png?v=2" data-fallback="logo" alt="">
    <div class="auth-title">Defina sua senha</div>
    <div class="auth-sub">Primeiro acesso — crie uma senha pessoal para continuar.</div>
  </div>`));
  const form = el('<div class="auth-form"></div>');
  form.appendChild(el('<label class="flbl">Nova senha</label>'));
  const pw1 = el(`<input class="inp" type="password" id="ts-pw1" placeholder="Mínimo 8 caracteres" autocomplete="new-password">`);
  form.appendChild(pw1);
  form.appendChild(el('<label class="flbl" style="margin-top:12px">Confirmar senha</label>'));
  const pw2 = el(`<input class="inp" type="password" id="ts-pw2" placeholder="Repita a senha" autocomplete="new-password" style="margin-top:6px">`);
  form.appendChild(pw2);
  const btn = el('<button class="btn-register auth-btn">Salvar e continuar</button>');
  btn.onclick = async ()=>{
    const p1=pw1.value, p2=pw2.value;
    if(p1.length<8){ toast('Senha: mínimo 8 caracteres'); return; }
    if(p1!==p2){ toast('As senhas não coincidem'); return; }
    btn.disabled=true; btn.textContent='Salvando…';
    try{
      if(typeof sbAuth!=='undefined') await sbAuth.changePassword(p1);
      DB.trocarSenhaOpen=false;
      if(!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen=true;
      render(); toast('Senha definida ✔');
    }catch(err){
      btn.disabled=false; btn.textContent='Salvar e continuar';
      toast('Erro: '+(err.message||err));
    }
  };
  form.appendChild(btn);
  form.appendChild(el('<div class="auth-note">🔒 Você entrou com uma senha provisória. Defina a sua para manter a conta segura.</div>'));
  v.appendChild(form);
  return v;
}

/* ============================================================
   PROFESSOR — cache de dados Supabase
   ============================================================ */
let _profData = null;
let _profTs   = 0;

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
  const fg=(DB.graduacoes||[]).filter(g=>g.tipo==='faixa'&&g.faixa===me.faixa).map(g=>g.data).sort().pop()||null;
  const dias=[...new Set(datas)];
  const _dISO=n=>{ const d=new Date(); d.setDate(d.getDate()-n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
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
function _profSetPresenca(a, hora){
  if(a._self) DB.checkinHoje = hora ? {feito:true,hora} : {feito:false,hora:null};
  else a.pres = hora;
  // !DEMO: com credenciais reais o sbProf existe até no ?demo=1 — o demo não pode disparar a nuvem
  if(!DEMO && typeof sbProf!=='undefined'){ try{ hora ? sbProf.lancarPresenca(a.id,hora) : sbProf.removerPresenca(a.id); }catch(e){} }
}
function _profSetPago(a, status){
  if(a._self) DB.eu.mensalidade = Object.assign({}, DB.eu.mensalidade, {status});
  else a.pago = status;
  if(!DEMO && typeof sbProf!=='undefined'){ try{ sbProf.setMensalidade(a.id,status); }catch(e){} }
}
/* Graduação RETROATIVA: registra o histórico de faixas (aluno vindo de outra academia).
   Perfil só muda se a data for a mais recente (não rebaixa). Online exige a 0003. */
function _gradRetroSheet(a){
  const sh=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Graduação retroativa — ${safeTxt(a.nm)}</div>
    <div class="sheet-desc">Registre faixas do passado para montar a linha do tempo. A faixa atual só muda se esta for a graduação mais recente.</div>
    <label class="flbl">Faixa</label>
    <select class="inp" id="gr-faixa">${CBJJ_CHAIN.map(f=>`<option value="${f}">${BELTS[f]?.nome||f}</option>`).join('')}</select>
    <label class="flbl" style="margin-top:12px">Tipo</label>
    <div class="seg" id="gr-tipo"><button class="active" data-t="faixa">Faixa nova</button><button data-t="grau">Grau</button></div>
    <label class="flbl" style="margin-top:12px">Graus</label>
    <select class="inp" id="gr-graus">${[0,1,2,3,4,5,6].map(n=>`<option value="${n}">${n}</option>`).join('')}</select>
    <label class="flbl" style="margin-top:12px">Data da graduação</label>
    <input class="inp" id="gr-data" type="date" max="${HOJE_ISO}">
    <button class="btn-save" id="gr-save" style="margin-top:14px">Registrar</button>
    <button class="sheet-cancel">Cancelar</button></div></div>`);
  let tipo='faixa';
  sh.querySelectorAll('#gr-tipo button').forEach(b=> b.onclick=()=>{ tipo=b.dataset.t;
    sh.querySelectorAll('#gr-tipo button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); });
  sh.querySelector('#gr-save').onclick=()=>{
    const faixa=sh.querySelector('#gr-faixa').value;
    const graus=parseInt(sh.querySelector('#gr-graus').value)||0;
    const data=sh.querySelector('#gr-data').value;
    if(!data){ toast('Informe a data'); return; }
    if(data>HOJE_ISO){ toast('Data no futuro'); return; }
    const por=(DB.professor&&DB.professor.nome)||'Professor';
    const reg={faixa, graus, tipo, data, por};
    if(a._self){
      DB.graduacoes.push(reg); DB.graduacoes.sort((x,y)=>x.data.localeCompare(y.data));
      const ultima=DB.graduacoes[DB.graduacoes.length-1];
      if(ultima===reg){ DB.eu.faixa=faixa; DB.eu.graus=graus; }
    } else {
      a.graduacoes=(a.graduacoes||[]); a.graduacoes.push(reg); a.graduacoes.sort((x,y)=>x.data.localeCompare(y.data));
      if(a.graduacoes[a.graduacoes.length-1]===reg){ a.faixa=faixa; a.graus=graus; }
    }
    if(!DEMO && typeof sbProf!=='undefined'){
      sbProf.graduarAluno(a.id, faixa, graus, tipo, por, data)
        .then(()=>toast('Graduação registrada ✔'))
        .catch(()=>toast('Não salvou na nuvem — data retroativa exige a migration 0003'));
    } else toast('Graduação registrada ✔');
    sh.remove(); _profTs=0; _loadProfData(); render();
  };
  openSheet(sh,'.sheet-cancel');
}

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
    _profData = { alunos, kpis }; render();
  }).catch(_=>{ _profTs = 0; });
  // regras da academia (meta de aulas por faixa) — 1 fetch por sessão
  if(!DB.academyConfig && sbProf.getConfig) sbProf.getConfig().then(c=>{ DB.academyConfig=c||{}; }).catch(()=>{});
}

function renderProfessor(){
  _loadProfData();
  const v = el(`<div class="view"></div>`);
  v.innerHTML = topbar('Painel do professor');
  const body = el('<div></div>');
  // Ficha do aluno em tela cheia tem precedência sobre as abas (voltar limpa DB.alunoAberto).
  if (DB.alunoAberto){ body.appendChild(profAlunoDetalhe(DB.alunoAberto)); v.appendChild(body); v.appendChild(tabbarProf()); return v; }
  const nav = DB.navProf;
  if (nav==='painel')    body.appendChild(profPainel());
  if (nav==='alunos')    body.appendChild(profAlunos());
  if (nav==='turmas')    body.appendChild(profTurmas());
  if (nav==='relatorios')body.appendChild(profRelatorios());
  if (nav==='loja')      body.appendChild(profLoja());
  if (nav==='pedidos')   body.appendChild(profPedidos());
  if (nav==='financeiro')body.appendChild(profFinanceiro());
  if (nav==='videos')    body.appendChild(profVideosOnboard());
  if (nav==='perfil')    body.appendChild(alunoPerfil());   // "Mais": o professor também é aluno (mesmo DB.eu)
  v.appendChild(body);
  v.appendChild(tabbarProf());
  return v;
}

function profPainel(){
  const w = el('<div></div>');
  const d = _profData;
  const alunos   = d ? d.alunos : [];
  const kpis     = d ? d.kpis   : { total:0, ativos:0, treinosTotal:0, shares:0, erros:0, receitaMes:0 };
  const presentes = alunos.filter(a=>a.pres).length;
  const vencidos  = alunos.filter(a=>a.pago==='late').length;

  w.innerHTML = `<div class="hello"><div class="greet">${diasSem[hoje.getDay()]}, ${fmtData(hoje)}</div>
    <div class="date">Olá, ${safeTxt(DB.professor.nome)} 🥋</div></div>`;

  // KPI financeiro (Mensalidades pagas) fica na aba Financeiro (Fase F) — no painel
  // mostramos "Ativos (14d)", KPI de retenção real (evita R$ 0,00 enquanto o financeiro é placeholder).
  w.appendChild(el(`<div class="stat-grid block">
    <div class="stat-card"><div class="si red">${icoUsers()}</div><div class="sv">${d?presentes:'…'}</div><div class="sl">Presentes hoje</div></div>
    <div class="stat-card"><div class="si blue">${icoRoster()}</div><div class="sv">${d?kpis.total:'…'}</div><div class="sl">Alunos</div></div>
    <div class="stat-card"><div class="si green">${icoPulse()}</div><div class="sv">${d?kpis.ativos:'…'}</div><div class="sl">Ativos (14d)</div></div>
    <div class="stat-card"><div class="si gold">${icoAlert()}</div><div class="sv">${d?vencidos:'…'}</div><div class="sl">Vencidos</div></div>
  </div>`));

  // "O que fazer hoje" — alertas acionáveis (§7.1)
  if(d){
    const _aptos=_aptosGraduar().length, _risco=_emRisco().length, _baixos=_produtosBaixos();
    const _pend=_pedidosPendentesN();
    const _nvFx=_aptosNovaFaixa().length;
    const _anivHj=_aniversariantesHoje().length;
    const _anivMes=_aniversariantes().length;
    const _sem7 = alunos.filter(a=>(a.diasSem||0)>=7).length;
    const alerts=[];
    if(kpis.erros>0) alerts.push(['🐞', `${kpis.erros} erro${kpis.erros>1?'s':''} de app nas últimas 24h`, 'Ver detalhes ›', ()=>_profErrosSheet(), 'red']);
    if(_pend>0) alerts.push(['🧾', `${_pend} pedido${_pend>1?'s':''} pendente${_pend>1?'s':''}`, 'Ver pedidos ›', ()=>goProf('pedidos'), 'red']);
    if(_anivHj>0) alerts.push(['🎂', `${_anivHj} aniversariante hoje`, 'Mandar parabéns ›', ()=>{ DB.relTab='retencao'; goProf('relatorios'); }, 'good']);
    if(_nvFx>0)  alerts.push(['🎖️', `${_nvFx} apto${_nvFx>1?'s':''} a nova faixa`, 'Ver relatórios ›', ()=>{ DB.relTab='graduacao'; goProf('relatorios'); }, 'good']);
    if(_aptos>0) alerts.push(['🥋', `${_aptos} apto${_aptos>1?'s':''} a graduar`, 'Ver relatórios ›', ()=>{ DB.relTab='graduacao'; goProf('relatorios'); }, 'good']);
    if(_risco>0) alerts.push(['⚠️', `${_risco} em risco de evasão`, 'Ver risco ›', ()=>{ DB.relTab='risco'; goProf('relatorios'); }, 'gold']);
    if(_sem7>0 && _sem7!==_risco) alerts.push(['👋', `${_sem7} aluno${_sem7>1?'s':''} há 7+ dias sem treinar`, 'Ver risco ›', ()=>{ DB.relTab='risco'; goProf('relatorios'); }, 'gold']);
    if(_anivMes>_anivHj) alerts.push(['🗓️', `${_anivMes} aniversariante${_anivMes>1?'s':''} este mês`, 'Ver lista ›', ()=>{ DB.relTab='retencao'; goProf('relatorios'); }, 'gold']);
    if(_baixos>0) alerts.push(['📦', `${_baixos} produto${_baixos>1?'s':''} com estoque baixo`, 'Ver loja ›', ()=>goProf('loja'), 'gold']);
    if(alerts.length){
      w.appendChild(el(`<div class="sec-title" style="margin:4px 20px 8px">O que fazer hoje</div>`));
      alerts.forEach(([ic,tx,go,fn,kind])=>{
        const al=el(`<div class="alert-row block ${kind}" role="button" tabindex="0" aria-label="${safeAttr(tx)}"><span class="ar-ic">${ic}</span>
          <span class="ar-tx">${tx}</span><span class="ar-go">${go}</span></div>`);
        al.onclick=fn; al.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); fn(); } }; w.appendChild(al);
      });
    }
  }

  w.appendChild(el(`<div class="sec-row"><div class="sec-title">Check-ins de hoje</div>
    <a data-click="verAlunos">Ver todos</a></div>`));
  const list = el('<div class="list block"></div>');
  if(!d){
    list.appendChild(el('<div class="loading-center">Carregando dados da nuvem…</div>'));
  } else if(!presentes){
    list.appendChild(el('<div class="empty-line">Nenhum check-in ainda hoje.</div>'));
  } else {
    alunos.filter(a=>a.pres).slice(0,4).forEach(a=>{
      list.appendChild(el(`<div class="ci-row"><span class="ci-dot"></span>
        ${avatarAluno(a, 'width:36px;height:36px;font-size:13px')}
        <div><div style="font-size:13.5px;font-weight:700">${safeTxt(a.nm)}</div>
          <div style="font-size:11.5px;color:var(--muted);font-weight:600">${BELTS[a.faixa]?.nome||safeTxt(a.faixa)} · ${safeTxt(a.graus)}º grau</div></div>
        <span class="ci-time">${safeTxt(a.pres)}</span></div>`));
    });
  }
  w.appendChild(list);

  if(d && kpis.treinosTotal > 0){
    w.appendChild(el('<div class="sec-title" style="margin:16px 20px 8px">Beta KPIs</div>'));
    w.appendChild(el(`<div class="list block">
      <div class="mt-row"><span>Alunos com treino</span><b>${kpis.ativos}</b></div>
      <div class="mt-row"><span>Total de treinos</span><b>${kpis.treinosTotal}</b></div>
      <div class="mt-row"><span>Stories compartilhados</span><b>${kpis.shares}</b></div>
      <div class="mt-row"><span>Erros de app (24h)</span><b>${kpis.erros}</b></div>
    </div>`));
  }

  // Trilha administrativa (0008): quem fez o quê na gestão
  if(d){
    const aud = el(`<div class="list block"><div class="mt-row" role="button" tabindex="0" aria-label="Atividade da gestão" style="cursor:pointer"><span>📜 Atividade da gestão</span><b style="color:var(--muted)">›</b></div></div>`);
    const row = aud.querySelector('.mt-row');
    row.onclick = ()=>_profAuditSheet();
    row.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _profAuditSheet(); } };
    w.appendChild(aud);
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
      return `<div class="mt-row" style="flex-direction:column;align-items:flex-start;gap:2px">
        <b style="font-size:12.5px;word-break:break-word">${safeTxt(r.msg||'—')}</b>
        <span style="font-size:11px;color:var(--muted)">${quando}${r.app_version?' · v'+safeTxt(r.app_version):''}</span></div>`;
    }).join('');
  }).catch(()=>{ list.innerHTML='<div class="empty-line">Falha ao carregar os erros.</div>'; });
}

/* DataTable de alunos: busca + filtros + seleção múltipla + ações em lote (§7).
   Offline: muta os objetos mock (refletindo na hora). Com backend: chama sbProf. */
let _selAlunos = new Set();
const _alunoKey = a => a.id || a.nm;

function profAlunos(){
  const w = el('<div></div>');
  const alunos = (_profData?.alunos)||[];
  const presentes = alunos.filter(a=>a.pres).length;
  w.innerHTML = `<div class="hello"><div class="date">Alunos</div>
    <div class="greet">${_profData?alunos.length+' cadastrados · '+presentes+' presentes hoje':'Carregando…'}</div></div>`;

  // Mapa turma_id → nome curto (pra coluna Turmas do modo ERP)
  _loadTurmas();
  const turmaMap = {}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });

  let filtro = 'todos', busca = '', filtroEt = 'todos';
  let sortKey='nm', sortDir='asc';   // ERP: coluna clicada + sentido
  const PAGE = 20; let shown = PAGE;   // paginação: prepara p/ 200+ alunos
  const srch = el(`<div class="dt-search"><span class="dt-search-ic" aria-hidden="true">🔎</span><input class="dt-search-inp" type="search" aria-label="Buscar pessoa" placeholder="Buscar por nome…"></div>`);
  const seg = el(`<div class="filter-seg">
    <button class="active" data-f="todos">Todos</button>
    <button data-f="presentes">Presentes</button>
    <button data-f="sumidos">Sumidos</button>
    <button data-f="vencidos">Vencidos</button>
  </div>`);
  // Chip filter por faixa etária derivada (Kids 3-5, Kids 6-9, Juvenil, Adulto)
  const chipsEt = el(`<div class="et-chips"></div>`);
  const _mkChip=(id,lbl)=>{ const b=el(`<button class="et-chip ${filtroEt===id?'on':''}">${lbl}</button>`);
    b.onclick=()=>{ filtroEt=id; shown=PAGE; chipsEt.querySelectorAll('.et-chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); refresh(); };
    return b; };
  chipsEt.appendChild(_mkChip('todos','Todas as idades'));
  FAIXA_ETARIA_OPCOES.forEach(op=> chipsEt.appendChild(_mkChip(op,op)));
  const bulk = el(`<div class="bulk-bar" hidden></div>`);
  // Header da tabela ERP — só aparece em desktop (CSS controla)
  const head = el(`<div class="erp-head" role="row">
    <div class="erp-c erp-c-check" aria-hidden="true"></div>
    <div class="erp-c erp-c-avatar" aria-hidden="true"></div>
    <button class="erp-c erp-c-name"   data-sort="nm">Nome</button>
    <button class="erp-c erp-c-belt"   data-sort="faixa">Faixa</button>
    <div class="erp-c erp-c-turmas">Turmas</div>
    <button class="erp-c erp-c-pres"   data-sort="pres">Últ. presença</button>
    <button class="erp-c erp-c-days"   data-sort="diasSem">Dias sem</button>
    <div class="erp-c erp-c-pay">Pgto</div>
    <div class="erp-c erp-c-wa" aria-hidden="true"></div>
  </div>`);
  const list = el('<div class="list erp-tbl"></div>');

  const refresh = ()=>{ renderList(); updateBulk(); paintHead(); };

  const updateBulk = ()=>{
    const n = _selAlunos.size;
    bulk.hidden = n===0;
    if(!n) return;
    bulk.innerHTML = `<span class="bb-n">${n} selecionado${n>1?'s':''}</span>
      <button class="bb-btn" data-a="pres">✓ Presença</button>
      <button class="bb-btn" data-a="grad">🥋 Graduar</button>
      <button class="bb-x" data-a="clear">Limpar</button>`;
    bulk.querySelector('[data-a="pres"]').onclick=()=>_bulkPresenca((_profData?.alunos)||[], refresh);
    bulk.querySelector('[data-a="grad"]').onclick=()=>_bulkGraduar((_profData?.alunos)||[], refresh);
    bulk.querySelector('[data-a="clear"]').onclick=()=>{ _selAlunos.clear(); refresh(); };
  };

  const paintHead = ()=>{
    head.querySelectorAll('[data-sort]').forEach(b=>{
      const k=b.dataset.sort; b.classList.toggle('sort-on', sortKey===k);
      b.classList.toggle('sort-desc', sortKey===k && sortDir==='desc');
    });
  };

  const _cmp = (a,b)=>{
    const dir = sortDir==='asc'?1:-1;
    if(sortKey==='faixa'){
      const ORD=['branca','cinza','amarela','laranja','verde','azul','roxa','marrom','preta','coral','vermelha'];
      const ai=ORD.indexOf(a.faixa), bi=ORD.indexOf(b.faixa);
      if(ai!==bi) return (ai-bi)*dir;
      return ((a.graus||0)-(b.graus||0))*dir;
    }
    if(sortKey==='diasSem') return ((a.diasSem||0)-(b.diasSem||0))*dir;
    if(sortKey==='pres'){
      const ap=a.pres?1:0, bp=b.pres?1:0;
      if(ap!==bp) return (bp-ap)*dir;   // presentes primeiro (asc)
      return String(a.pres||'').localeCompare(String(b.pres||''))*dir;
    }
    return String(a.nm||'').localeCompare(String(b.nm||''))*dir;
  };

  const renderList = ()=>{
    list.innerHTML='';
    if(!_profData){ list.appendChild(el('<div class="loading-center">Carregando dados da nuvem…</div>')); return; }
    // M4: lê os dados VIVOS de _profData — o array capturado no render ficava
    // desatualizado após um cadastro (o aluno novo não aparecia na lista)
    let arr = ((_profData?.alunos)||[]).filter(a=> filtro==='todos' ? true : filtro==='presentes' ? !!a.pres : filtro==='sumidos' ? (a.diasSem||0)>0 : a.pago==='late');
    if(filtroEt!=='todos') arr = arr.filter(a=> _faixaEtariaLbl(a.nascimento) === filtroEt);
    if(busca){ const q=busca.toLowerCase(); arr = arr.filter(a=> (a.nm||'').toLowerCase().includes(q)); }
    // "Sumidos" ignora o sort escolhido (contexto exige quem sumiu mais)
    if(filtro==='sumidos') arr.sort((a,b)=> (b.diasSem||0)-(a.diasSem||0));
    else arr.sort(_cmp);
    if(!arr.length){ list.appendChild(el(`<div class="empty-line">Nenhum aluno encontrado.</div>`)); return; }
    const totalN = arr.length;
    arr.slice(0, shown).forEach(a=>{
      const payMap={ok:['pay-ok','Em dia'],late:['pay-late','Vencido'],soon:['pay-soon','A vencer']};
      const [cls,txt]=payMap[a.pago]||['pay-ok','—'];
      const sel=_selAlunos.has(_alunoKey(a));
      const turmasTx = (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(', ') || '—';
      const presTx = a.pres ? '✓ '+safeTxt(a.pres) : 'ausente';
      const daysTx = (a.diasSem||0) > 0 ? (a.diasSem+'d') : '—';
      const metaMobile = filtro==='sumidos' ? ((a.diasSem||0)+'d sem treinar') : (a.pres?'✓ '+safeTxt(a.pres):'ausente hoje');
      const row=el(`<div class="st-row dt-row${sel?' sel':''}${a._self?' dt-self':''}" style="cursor:pointer">
        <button class="row-check${sel?' on':''}" aria-label="Selecionar ${safeAttr(a.nm)}">${sel?'✓':''}</button>
        ${avatarAluno(a)}
        <div class="st-mid"><div class="nm">${safeTxt(a.nm)}${a.role&&a.role!=='aluno'?` <span class="role-badge ${a.role==='dono'?'dono':'prof'}">${a.role==='dono'?'Dono':'Professor'}</span>`:''}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${metaMobile}</span></div></div>
        <div class="erp-c erp-c-belt-cell">${beltPill(a.faixa,a.graus)}</div>
        <div class="erp-c erp-c-turmas-cell" title="${safeAttr(turmasTx)}">${safeTxt(turmasTx)}</div>
        <div class="erp-c erp-c-pres-cell">${presTx}</div>
        <div class="erp-c erp-c-days-cell${(a.diasSem||0)>=7?' warn':''}">${daysTx}</div>
        <div class="st-right"><span class="pay-badge ${cls}">${txt}</span></div>
        <button class="erp-c erp-c-wa-btn wa-ico" aria-label="WhatsApp ${safeAttr(a.nm)}" title="Mandar WhatsApp">💬</button>
      </div>`);
      const waBtn = row.querySelector('.wa-ico');
      if(waBtn) waBtn.onclick=(e)=>{ e.stopPropagation(); _waSheet(a); };
      const chk = row.querySelector('.row-check');
      // toggle incremental: atualiza só esta linha + a barra (não reconstrói a lista toda)
      chk.onclick=(e)=>{ e.stopPropagation(); const k=_alunoKey(a); const on=!_selAlunos.has(k);
        if(on) _selAlunos.add(k); else _selAlunos.delete(k);
        chk.classList.toggle('on',on); chk.textContent=on?'✓':''; row.classList.toggle('sel',on);
        updateBulk(); };
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

  refresh();
  w.appendChild(srch); w.appendChild(seg); w.appendChild(chipsEt); w.appendChild(actions); w.appendChild(bulk); w.appendChild(head); w.appendChild(list);
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
    const titulo=g.tipo==='faixa'?`Faixa ${x.nome}`:`${g.graus}º grau · ${x.nome}`;
    const [y,m,d]=g.data.split('-'); const dataFmt=`${d}/${m}/${y}`;
    tl.appendChild(el(`<div class="tl-item">
      <div class="tl-rail"><span class="tl-dot" style="background:${x.cor}"></span><span class="tl-conn"></span></div>
      <div class="tl-tx"><div class="tl-belt">${beltMini(g.faixa, g.tipo==='grau'?g.graus:0)}</div>
        <div class="t">${safeTxt(titulo)}</div><div class="dt">${dataFmt}${g.por&&g.por!=='—'?' · '+safeTxt(g.por):''}</div></div></div>`));
  });
  return tl;
}

// Alunos matriculados numa turma (UI/offline: lê a.turmas; backend real vem no passo 2-backend).
function _turmaAlunos(turmaId){ return _profAlunosArr().filter(a=>(a.turmas||[]).includes(turmaId)); }

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
        <div class="meta">${chip} <span style="color:var(--muted)">· ${dataFmt}</span></div></div></div>`));
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
  // Top 8 por nº de treinos (mais praticadas)
  const top=arr.slice().sort((a,b)=>(b.treinos||0)-(a.treinos||0)).slice(0,8);
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
    const ultimaFmt = ultima ? (()=>{ const [y,m,d]=(''+ultima).split('-'); return `${d}/${m}`; })() : '—';
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
  const _dISO=n=>{ const d=new Date(); d.setDate(d.getDate()-n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
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
  let selFaixa='branca', selGraus=0, step=0; const selTurmas=new Set();
  const STEPS=['Dados do aluno','Endereço','Responsável','Graduação'];
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
      <div class="cad-row" style="margin-top:12px">
        <div style="flex:1"><label class="flbl">Telefone / WhatsApp</label>
          <input class="inp" id="ca-tel" type="tel" inputmode="tel" placeholder="(31) 99999-9999"></div>
        <div style="width:120px"><label class="flbl">Nascimento</label>
          <input class="inp" id="ca-nasc" type="number" inputmode="numeric" placeholder="1998" min="1920" max="${hoje.getFullYear()}"></div>
      </div>
      <label class="flbl" style="margin-top:12px">Data de nascimento completa <span class="ca-opt">(opcional — habilita aniversariantes)</span></label>
      <input class="inp" id="ca-nascdata" type="date">
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
    </div>

    <div class="cad-step" data-step="3" hidden>
      <div class="cad-sec">Graduação & administrativo</div>
      <label class="flbl">Faixa <span class="ca-opt" id="ca-faixa-hint">(informe o nascimento p/ filtrar por idade — CBJJ)</span></label>
      <div id="ca-faixa"></div>
      <label class="flbl" style="margin-top:12px">Graus</label>
      <div class="seg" id="ca-graus"></div>
      <label class="flbl" style="margin-top:12px">Data de início <span class="ca-opt">(opcional)</span></label>
      <input class="inp" id="ca-inicio" type="date" value="${HOJE_ISO}">
      <label class="flbl" style="margin-top:12px">Observações <span class="ca-opt">(opcional)</span></label>
      <textarea class="ta" id="ca-obs" placeholder="Anotações administrativas (não vê no app do aluno)"></textarea>
      <label class="flbl" style="margin-top:12px">Turmas <span class="ca-opt">(matrícula — toque para selecionar)</span></label>
      <div id="ca-turmas" class="turma-chips"></div>
    </div>

    <div class="cad-nav">
      <button class="sheet-cancel" id="ca-back">Cancelar</button>
      <button class="btn-save" id="ca-next">Continuar</button>
    </div>`;
  const back=()=>{ DB.cadastroAlunoOpen=false; render(); window.scrollTo(0,0); };
  const close=back;   // "Cancelar" no passo 0 e os fluxos de sucesso voltam pra lista
  let _caDirty=false; body.addEventListener('input',()=>{ _caDirty=true; });
  const tryClose=()=>{ if(_caDirty) _confirmDescartar(back); else back(); };
  const _bk=v.querySelector('.back');
  _bk.onclick=tryClose; _bk.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); tryClose(); } };
  // Chips de turmas (matrícula) na etapa Graduação
  _turmaChips(sheet.querySelector('#ca-turmas'), selTurmas, ()=>{ _caDirty=true; });
  // Faixa filtrada por idade (CBJJ) — campo VISUAL de mini-faixas; reconstrói ao digitar o nascimento.
  const segF=sheet.querySelector('#ca-faixa');
  const hintF=sheet.querySelector('#ca-faixa-hint');
  const nascInp=sheet.querySelector('#ca-nasc');
  const segG=sheet.querySelector('#ca-graus');
  const _rebuildCadGraus=()=>{   // B5: graus acompanham a faixa (preta=6; demais=4) — reconstrói ao trocar a faixa
    const mx=maxGrausDe(selFaixa); if(selGraus>mx) selGraus=mx;
    segG.innerHTML='';
    for(let g=0;g<=mx;g++){ const b=el(`<button class="${g===selGraus?'active':''}">${g}º</button>`);
      b.onclick=()=>{ selGraus=g; segG.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segG.appendChild(b); }
  };
  const _rebuildCadFaixas=()=>{
    // v193: filtro por idade removido — o professor escolhe a faixa. Mostra a cadeia inteira (CBJJ_CHAIN).
    const nv=parseInt(nascInp.value); const idade=(nv>=1920&&nv<=hoje.getFullYear())?idadeCBJJ(nv):null;
    const faixas=CBJJ_CHAIN.slice();
    if(!faixas.includes(selFaixa)) selFaixa=faixas[0];
    if(hintF) hintF.textContent = idade!=null ? `(${idade} anos${categoriaCBJJ(nv)?' · '+categoriaCBJJ(nv):''})` : '';
    renderBeltField(segF, faixas, selFaixa, (f)=>{ selFaixa=f; _rebuildCadFaixas(); _rebuildCadGraus(); });
    _rebuildCadGraus();
  };
  nascInp.addEventListener('input', _rebuildCadFaixas);
  _rebuildCadFaixas();
  // ViaCEP: digita CEP → auto-preenche logradouro/bairro/cidade/UF, foca no número
  bindViaCEP(sheet.querySelector('#ca-cep'), {
    logr:   sheet.querySelector('#ca-logr'),
    bairro: sheet.querySelector('#ca-bairro'),
    cidade: sheet.querySelector('#ca-cidade'),
    uf:     sheet.querySelector('#ca-uf'),
    num:    sheet.querySelector('#ca-num'),
  });
  // wizard: uma etapa por vez (Dados → Endereço → Responsável → Graduação)
  const stepsEl=sheet.querySelector('#ca-steps');
  const backBtn=sheet.querySelector('#ca-back');
  const nextBtn=sheet.querySelector('#ca-next');
  const scroller=null;   // página cheia: o scroll é da janela (showStep usa window.scrollTo)
  const val=id=>{ const e=sheet.querySelector('#'+id); return e?e.value.trim():''; };
  const paintSteps=()=>{ stepsEl.innerHTML=STEPS.map((s,i)=>`<span class="cad-dot ${i===step?'on':''} ${i<step?'done':''}"></span>`).join(''); };
  const showStep=(n)=>{
    step=Math.max(0,Math.min(STEPS.length-1,n));
    sheet.querySelectorAll('.cad-step').forEach(sec=>{ sec.hidden=(+sec.dataset.step!==step); });
    backBtn.textContent = step===0 ? 'Cancelar' : 'Voltar';
    nextBtn.textContent = step===STEPS.length-1 ? 'Cadastrar e gerar senha' : 'Continuar';
    paintSteps();
    if(scroller) scroller.scrollTop=0; else window.scrollTo(0,0);
  };
  const validateStep=()=>{
    // Decisão do dono (2026-07-10): só nome + e-mail são obrigatórios (e-mail = login da conta).
    // O resto é opcional — se preenchido, valida o formato.
    if(step===0){
      if(!val('ca-nome')){ toast('Informe o nome completo'); return false; }
      const email=val('ca-email').toLowerCase();
      if(!email || !email.includes('@')){ toast('Informe um e-mail válido (será o login do aluno)'); return false; }
      const nv=val('ca-nasc');
      if(nv && !(parseInt(nv)>=1920 && parseInt(nv)<=hoje.getFullYear())){ toast('Ano de nascimento inválido'); return false; }
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
    const nascVal=parseInt(val('ca-nasc'));
    const nascimento=(nascVal>=1920 && nascVal<=hoje.getFullYear())?nascVal:null;
    const nascData=val('ca-nascdata')||null;
    const telefone=val('ca-tel');
    const cep=val('ca-cep'), logradouro=val('ca-logr'), numero=val('ca-num'), bairro=val('ca-bairro'), cidade=val('ca-cidade'), uf=val('ca-uf').toUpperCase();
    const resp_nome=val('ca-rnome'), resp_telefone=val('ca-rtel'), resp_parentesco=val('ca-rpar');
    const data_inicio=val('ca-inicio')||HOJE_ISO, observacoes=val('ca-obs');
    const senha=_gerarSenhaProvisoria();
    const dados={ nome_completo:nome, apelido, email, faixa:selFaixa, graus:selGraus, nascimento, desde:HOJE_ISO.slice(0,7),
      telefone, cep, logradouro, numero, bairro, cidade, uf,
      resp_nome, resp_telefone, resp_parentesco, data_inicio, observacoes };
    const turmas=[...selTurmas];
    if(!DEMO && typeof sbProf!=='undefined'){   // demo nunca dispara a nuvem
      try{ const r=await sbProf.criarAluno(dados);
        const novoId=(r&&(r.user_id||r.id))||null;   // a Edge retorna user_id (não id)
        // Matrícula nas turmas marcadas — enrollments reais (enroll_prof_write já existe na 0001).
        if(turmas.length && novoId && sbProf.matricular){ try{ await sbProf.matricular(novoId, turmas); }catch(_){}}
        // Data completa de nascimento (opcional): a Edge não conhece a coluna — update pós-cadastro.
        if(nascData && novoId && sbProf.atualizarAluno){ try{ await sbProf.atualizarAluno(novoId, {nascimento_data:nascData}); }catch(_){}}
        _profData=null; _profTs=0; _loadProfData();   // M4: invalida o cache ANTES de voltar p/ o novo aluno aparecer
        back(); _senhaProvisoriaSheet(email, (r&&r.senha_provisoria)||senha); return; }
      catch(e){ toast('Erro ao cadastrar: '+(e.message||e)); return; }
    }
    // offline (mock): adiciona à lista com a ficha cadastral (vista no detalhe do aluno)
    const novo={ id:'mock-'+Date.now(), nm:apelido||nome, ini:_iniciaisDe(apelido||nome), cor:_corAluno(nome),
      faixa:selFaixa, graus:selGraus, nascimento, nascData, pres:null, pago:'ok', mensValor:0, mensVenc:'—', desde:dados.desde, turmas,
      cad:{ nomeCompleto:nome, email, nascimento, telefone,
        endereco:{ cep, logradouro, numero, bairro, cidade, uf },
        responsavel:{ nome:resp_nome, telefone:resp_telefone, parentesco:resp_parentesco },
        dataInicio:data_inicio, obs:observacoes } };
    // grava no mock persistente (DB.alunos); _loadProfData reconstrói _profData = [self, ...DB.alunos]
    DB.alunos = DB.alunos || []; DB.alunos.unshift(novo);
    _profData=null; _profTs=0; _loadProfData();   // M4: invalida o cache p/ o novo aluno aparecer já
    close(); _senhaProvisoriaSheet(email, senha); refresh();
  };
  showStep(0);
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
      desde:HOJE_ISO.slice(0,7), telefone:val('cpf-tel'), data_inicio:HOJE_ISO };
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

function _bulkPresenca(alunos, refresh){
  const hora = new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const sel = alunos.filter(a=>_selAlunos.has(_alunoKey(a)));
  if(!sel.length) return;
  sel.forEach(a=> _profSetPresenca(a, hora));   // roteia _self p/ DB.checkinHoje
  _selAlunos.clear(); refresh(); render();
  toast(`Presença lançada para ${sel.length} aluno${sel.length>1?'s':''} ✔`);
}

function _bulkGraduar(alunos, refresh){
  const sel = alunos.filter(a=>_selAlunos.has(_alunoKey(a)));
  if(!sel.length) return;
  // v193: filtro por idade removido — professor escolhe qualquer faixa (mais simples, evita bugs).
  let faixas = CBJJ_CHAIN.slice();
  const mistas = new Set(sel.map(a=>{ const i=idadeCBJJ(a.nascimento); return i==null?'?':(i<=CBJJ.youth_max_age?'infantil':'adulto'); }));
  let selFaixa = faixas.includes(sel[0].faixa)?sel[0].faixa:faixas[0], selGraus = 0, selTipo = 'graduação';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Graduar ${sel.length} aluno${sel.length>1?'s':''}</div>
    <div class="sheet-desc">Aplica a mesma faixa/grau a todos os selecionados.${(mistas.has('infantil')&&mistas.has('adulto'))?' <b style="color:var(--gold)">⚠️ Seleção mistura infantil e adulto — só faixas válidas p/ todos aparecem.</b>':''}</div>
    <label class="flbl">Nova faixa</label>
    <div class="seg" id="bg-faixa"></div>
    <label class="flbl" style="margin-top:12px">Graus</label>
    <div class="seg" id="bg-graus"></div>
    <label class="flbl" style="margin-top:12px">Tipo</label>
    <div class="seg" id="bg-tipo"></div>
    <button class="btn-save" id="bg-save" style="margin-top:14px">Confirmar graduação</button>
    <button class="sheet-cancel" id="bg-cancel">Cancelar</button>
  </div></div>`);
  const segGraus=sheet.querySelector('#bg-graus');
  // B5: graus acompanham a faixa (preta = até 6; demais = até 4)
  const _rebuildGrausBulk=()=>{
    const mx=maxGrausDe(selFaixa); if(selGraus>mx) selGraus=mx;
    segGraus.innerHTML='';
    for(let g=0;g<=mx;g++){ const b=el(`<button class="${g===selGraus?'active':''}">${g}º</button>`);
      b.onclick=()=>{ selGraus=g; segGraus.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segGraus.appendChild(b); }
  };
  const segFaixa=sheet.querySelector('#bg-faixa');
  const _paintFaixaBulk=()=> renderBeltField(segFaixa, faixas, selFaixa, (f)=>{ selFaixa=f; _paintFaixaBulk(); _rebuildGrausBulk(); });
  _paintFaixaBulk();
  _rebuildGrausBulk();
  const segTipo=sheet.querySelector('#bg-tipo');
  ['graduação','grau'].forEach(t=>{ const b=el(`<button class="${t===selTipo?'active':''}">${t}</button>`);
    b.onclick=()=>{ selTipo=t; segTipo.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segTipo.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#bg-cancel').onclick=close;
  sheet.querySelector('#bg-save').onclick=()=>{
    close();
    sel.forEach(a=> _profGraduarApply(a, selFaixa, selGraus, selTipo));  // roteia _self p/ DB.graduacoes/DB.eu
    _selAlunos.clear(); refresh(); render();
    toast(`${sel.length} aluno${sel.length>1?'s':''} graduado${sel.length>1?'s':''} para ${BELTS[selFaixa].nome} ${selGraus}º ✔`);
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}

// Ficha do aluno em TELA CHEIA (navegação via DB.alunoAberto), não bottom sheet.
// _profAlunoSheet(a) (usado em todo o app) vira um atalho que navega para cá.
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
  const sheet = el(`<div class="aluno-full">
    <div class="rel-back" role="button" tabindex="0" id="pa-back"><span>‹ Voltar</span></div>
    <div class="rel-det-h">${safeTxt(a.nm)}</div>
    <div class="sheet-desc" style="margin:0 20px 12px">${BELTS[a.faixa]?.nome||safeTxt(a.faixa)} · ${safeTxt(a.graus)}º grau</div>
    <div class="aluno-full-body">
    ${ficha}
    <div class="grad-tl-sec">
      <div class="ficha-h">Linha do tempo de graduação</div>
      <div id="pa-grad-tl"><div class="tl-empty">Carregando…</div></div>
    </div>
    <div class="grad-tl-sec">
      <div class="ficha-h">Lesões</div>
      <div id="pa-lesoes"><div class="tl-empty">Carregando…</div></div>
    </div>
    <div class="grad-tl-sec">
      <div class="ficha-h">Progresso de técnica</div>
      <div id="pa-prog"><div class="tl-empty">Carregando…</div></div>
    </div>
    <div class="grad-tl-sec">
      <div class="ficha-h">Perfil de treino</div>
      <div id="pa-perfil"><div class="tl-empty">Carregando…</div></div>
    </div>
    <div class="grad-tl-sec">
      <div class="ficha-h">Observações do professor</div>
      <div id="pa-obs"></div>
    </div>
    <div class="cfg-list">
      ${a.pres
        ?'<div class="cfg-row danger" id="pa-rem"><span>❌ Remover presença</span></div>'
        :'<div class="cfg-row" id="pa-add"><span>✓ Lançar presença agora</span></div>'}
      ${a.pago==='late'
        ?'<div class="cfg-row" id="pa-pago"><span>💰 Marcar como pago</span></div>'
        :'<div class="cfg-row danger" id="pa-late"><span>⚠️ Marcar como vencido</span></div>'}
      ${_waLink(a)?'<div class="cfg-row" id="pa-wa"><span>💬 Chamar no WhatsApp</span></div>':''}
      <div class="cfg-row" id="pa-grad"><span>🥋 Graduar</span></div>
      <div class="cfg-row" id="pa-retro"><span>🕰️ Registrar graduação retroativa</span></div>
      <div class="cfg-row" id="pa-ficha"><span>✏️ Editar ficha cadastral</span></div>
      ${(DB.eu && DB.eu.role==='dono' && !a._self)?'<div class="cfg-row" id="pa-promo"><span>⬆️ Promover a professor</span></div>':''}
      ${(a._self||a.role==='professor'||a.role==='dono')?'':'<div class="cfg-row danger" id="pa-del"><span>🗑️ Excluir aluno</span></div>'}
    </div>
  </div></div>`);
  const close=()=>{ DB.alunoAberto=null; render(); window.scrollTo(0,0); };
  const refresh=()=>{ _profData=null; _profTs=0; _loadProfData(); };
  const backBtn=sheet.querySelector('#pa-back');
  if(backBtn){ backBtn.onclick=close; backBtn.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); close(); } }; }
  const waRow=sheet.querySelector('#pa-wa');
  if(waRow) waRow.onclick=()=>{ const u=_waLink(a); if(u) window.open(u,'_blank','noopener'); };
  const retroRow=sheet.querySelector('#pa-retro');
  if(retroRow) retroRow.onclick=()=>{ _gradRetroSheet(a); };
  // Painéis gerenciais: graduação (timeline) + lesões + progresso de técnica.
  // Reusa uma única chamada getAlunoDetalhe (backend); self usa dados locais; senão fallback ao mock.
  const tlBox=sheet.querySelector('#pa-grad-tl'), lesBox=sheet.querySelector('#pa-lesoes'), progBox=sheet.querySelector('#pa-prog');
  const perfBox=sheet.querySelector('#pa-perfil'), obsBox=sheet.querySelector('#pa-obs');
  const fillAll=(grads, lesoes, prog, freq)=>{
    if(tlBox){ tlBox.innerHTML=''; tlBox.appendChild(_gradTimelineNode(grads)); }
    if(lesBox){ lesBox.innerHTML=''; lesBox.appendChild(_lesoesPanelNode(lesoes)); }
    if(progBox){ progBox.innerHTML=''; progBox.appendChild(_progressoPanelNode(prog)); }
    if(perfBox){ perfBox.innerHTML=''; perfBox.appendChild(_perfilTreinoNode(freq)); }
    if(obsBox){ obsBox.innerHTML=''; obsBox.appendChild(_obsPanelNode(a)); }
  };
  const selfFreq=()=> (DB.treinos||[]).filter(t=>t.data).map(t=>({data:t.data, hora:null, tipo:t.tipo||null}));
  if(a._self) fillAll(DB.graduacoes||[], DB.lesoes||[], _selfProgresso(), selfFreq());
  else if(Array.isArray(a.graduacoes)||Array.isArray(a.lesoes)||Array.isArray(a.progresso))
    fillAll(a.graduacoes||[], a.lesoes||[], a.progresso||[], a.frequencia||[]);
  else if(!DEMO && typeof sbProf!=='undefined' && sbProf.getAlunoDetalhe){
    sbProf.getAlunoDetalhe(a.id).then(d=>{
      a.graduacoes=(d&&d.graduacoes)||[]; a.lesoes=(d&&d.lesoes)||[]; a.progresso=(d&&d.progresso)||[];
      a.frequencia=(d&&d.frequencia)||[]; a.notas=(d&&d.notas)||[];
      fillAll(a.graduacoes, a.lesoes, a.progresso, a.frequencia);
    }).catch(()=>fillAll([],[],[],[]));
  } else fillAll([],[],[],[]);
  const r1=sheet.querySelector('#pa-add');
  const r2=sheet.querySelector('#pa-rem');
  const r3=sheet.querySelector('#pa-pago');
  const r4=sheet.querySelector('#pa-late');
  // _self → escreve nos dados reais do aluno (DB.checkinHoje/mensalidade); senão no mock. Ver _profSet*.
  // Presença/pagamento: muta e re-renderiza a própria tela do aluno (fica nela).
  if(r1) r1.onclick=()=>{ _profSetPresenca(a,hora); refresh(); render(); toast('Presença lançada ✔'); };
  if(r2) r2.onclick=()=>{ _profSetPresenca(a,null); refresh(); render(); toast('Presença removida'); };
  if(r3) r3.onclick=()=>{ _profSetPago(a,'ok');   refresh(); render(); toast('Marcado como pago ✔'); };
  if(r4) r4.onclick=()=>{ _profSetPago(a,'late'); refresh(); render(); toast('Marcado como vencido'); };
  // Graduar/editar ficha/promover: abrem sheet POR CIMA da tela cheia (sem sair dela).
  sheet.querySelector('#pa-grad').onclick=()=>{ _profGraduarSheet(a, refresh); };
  sheet.querySelector('#pa-ficha').onclick=()=>{ _profEditarFichaSheet(a, refresh); };
  const rPromo=sheet.querySelector('#pa-promo');
  if(rPromo) rPromo.onclick=()=>{ _profPromoverSheet(a, refresh); };
  const rDel=sheet.querySelector('#pa-del');
  if(rDel) rDel.onclick=()=>{ _profExcluirAlunoSheet(a, ()=>{ DB.alunoAberto=null; refresh(); render(); }); };   // excluiu → volta à lista
  return sheet;
}
// Atalho: todo o app chama _profAlunoSheet(a) — agora navega para a tela cheia.
function _profAlunoSheet(a){ DB.alunoAberto=a; render(); window.scrollTo(0,0); }

/* Promover aluno → professor (só dono). Preserva a conta/histórico; muda o papel
   no servidor via Edge Function promote-professor (gated is_dono). */
function _profPromoverSheet(a, refresh){
  const sheet=el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Promover ${safeTxt(a.nm)} a professor?</div>
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
      close(); toast(`${a.nm} agora é professor(a) ✔`);
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
    <div class="sheet-title">Excluir ${safeTxt(a.nm)}?</div>
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

// Edita a ficha cadastral de um aluno já existente (mesma estrutura do cadastro, sem senha/faixa).
function _profEditarFichaSheet(a, refresh){
  const c = a.cad || {};
  const e = c.endereco || {}, r = c.responsavel || {};
  const apelidoAtual = a._self ? (DB.eu.apelido||'') : (a.nm||'').replace(/\s*\(você\)$/,'');
  const sheet=el(`<div class="sheet-overlay aluno-detail"><div class="sheet" role="dialog" style="max-height:90vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Editar ficha</div>
    <div class="sheet-desc">Atualiza os dados cadastrais. (Faixa/grau são alterados em "Graduar".)</div>

    <div class="cad-sec">Dados do aluno</div>
    <label class="flbl">Nome completo</label>
    <input class="inp" id="fe-nome" value="${safeAttr(c.nomeCompleto||a.nm||'')}">
    <label class="flbl" style="margin-top:12px">E-mail</label>
    <input class="inp" id="fe-email" type="email" inputmode="email" value="${safeAttr(c.email||'')}">
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Telefone / WhatsApp</label><input class="inp" id="fe-tel" type="tel" inputmode="tel" value="${safeAttr(c.telefone||'')}"></div>
      <div style="width:120px"><label class="flbl">Nascimento</label><input class="inp" id="fe-nasc" type="number" inputmode="numeric" min="1920" max="${hoje.getFullYear()}" value="${safeAttr(c.nascimento||a.nascimento||'')}"></div>
    </div>
    <label class="flbl" style="margin-top:12px">Data de nascimento completa <span class="ca-opt">(opcional — habilita aniversariantes)</span></label>
    <input class="inp" id="fe-nascdata" type="date" value="${safeAttr(a.nascData||'')}">
    <label class="flbl" style="margin-top:12px">Apelido <span class="ca-opt">(como aparece no app)</span></label>
    <input class="inp" id="fe-apelido" value="${safeAttr(apelidoAtual)}">

    <div class="cad-sec">Endereço</div>
    <div class="cad-row">
      <div style="width:130px"><label class="flbl">CEP</label><input class="inp" id="fe-cep" value="${safeAttr(e.cep||'')}"></div>
      <div style="flex:1"><label class="flbl">Logradouro</label><input class="inp" id="fe-logr" value="${safeAttr(e.logradouro||'')}"></div>
    </div>
    <div class="cad-row" style="margin-top:12px">
      <div style="width:90px"><label class="flbl">Número</label><input class="inp" id="fe-num" value="${safeAttr(e.numero||'')}"></div>
      <div style="flex:1"><label class="flbl">Bairro</label><input class="inp" id="fe-bairro" value="${safeAttr(e.bairro||'')}"></div>
    </div>
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Cidade</label><input class="inp" id="fe-cidade" value="${safeAttr(e.cidade||'')}"></div>
      <div style="width:70px"><label class="flbl">UF</label><input class="inp" id="fe-uf" maxlength="2" value="${safeAttr(e.uf||'')}"></div>
    </div>

    <div class="cad-sec">Responsável / ponto de apoio</div>
    <label class="flbl">Nome do responsável</label>
    <input class="inp" id="fe-rnome" value="${safeAttr(r.nome||'')}">
    <div class="cad-row" style="margin-top:12px">
      <div style="flex:1"><label class="flbl">Telefone</label><input class="inp" id="fe-rtel" type="tel" inputmode="tel" value="${safeAttr(r.telefone||'')}"></div>
      <div style="width:130px"><label class="flbl">Parentesco</label><input class="inp" id="fe-rpar" value="${safeAttr(r.parentesco||'')}"></div>
    </div>

    <div class="cad-sec">Administrativo</div>
    <label class="flbl">Data de início <span class="ca-opt">(opcional)</span></label>
    <input class="inp" id="fe-inicio" type="date" value="${safeAttr(c.dataInicio||'')}">
    <label class="flbl" style="margin-top:12px">Observações <span class="ca-opt">(opcional)</span></label>
    <textarea class="ta" id="fe-obs">${safeTxt(c.obs||'')}</textarea>

    <div class="cad-sec">Turmas</div>
    <div id="fe-turmas" class="turma-chips"></div>

    <button class="btn-save" id="fe-save" style="margin-top:16px">Salvar ficha</button>
    <button class="sheet-cancel" id="fe-cancel">Cancelar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  const selTurmas=new Set(a.turmas||[]);
  let _feDirty=false; sheet.addEventListener('input',()=>{ _feDirty=true; });
  _turmaChips(sheet.querySelector('#fe-turmas'), selTurmas, ()=>{ _feDirty=true; });
  // ViaCEP no editar ficha (mesma lógica do cadastro)
  bindViaCEP(sheet.querySelector('#fe-cep'), {
    logr:   sheet.querySelector('#fe-logr'),
    bairro: sheet.querySelector('#fe-bairro'),
    cidade: sheet.querySelector('#fe-cidade'),
    uf:     sheet.querySelector('#fe-uf'),
    num:    sheet.querySelector('#fe-num'),
  });
  sheet.onclick=(ev)=>{ if(ev.target===sheet){ _feDirty?_confirmDescartar(close):close(); } };
  sheet.querySelector('#fe-cancel').onclick=close;
  sheet.querySelector('#fe-save').onclick=()=>{
    const val=id=>{ const el2=sheet.querySelector('#'+id); return el2?el2.value.trim():''; };
    const nome=val('fe-nome'), email=val('fe-email').toLowerCase(), telefone=val('fe-tel');
    const nascData=val('fe-nascdata')||null;
    let nascVal=parseInt(val('fe-nasc'));
    if(!(nascVal>=1920) && nascData) nascVal=parseInt(nascData.slice(0,4));   // ano deriva da data completa
    const nascimento=(nascVal>=1920&&nascVal<=hoje.getFullYear())?nascVal:(c.nascimento||null);
    const apelido=val('fe-apelido')||nome.split(/\s+/)[0]||'';
    const resp_nome=val('fe-rnome'), resp_telefone=val('fe-rtel');
    if(!nome){ toast('Informe o nome completo'); return; }
    if(!email || !email.includes('@')){ toast('Informe um e-mail válido'); return; }
    if(!telefone){ toast('Informe o telefone/WhatsApp'); return; }
    if(!resp_nome || !resp_telefone){ toast('Informe o responsável (nome e telefone)'); return; }
    const cad={ nomeCompleto:nome, email, nascimento, telefone,
      endereco:{ cep:val('fe-cep'), logradouro:val('fe-logr'), numero:val('fe-num'), bairro:val('fe-bairro'), cidade:val('fe-cidade'), uf:val('fe-uf').toUpperCase() },
      responsavel:{ nome:resp_nome, telefone:resp_telefone, parentesco:val('fe-rpar') },
      dataInicio:val('fe-inicio'), obs:val('fe-obs') };
    if(a._self){ DB.eu.cad=cad; DB.eu.nomeCompleto=nome; DB.eu.apelido=apelido; DB.eu.iniciais=_iniciaisDe(apelido); if(nascimento) DB.eu.nascimento=nascimento; if(nascData) DB.eu.nascData=nascData; }
    else { a.cad=cad; a.nm=apelido; a.ini=_iniciaisDe(apelido); }
    a.nascData=nascData||a.nascData||null;
    a.turmas=[...selTurmas];
    // Sincroniza o CONJUNTO de turmas (upsert marcadas + delete desmarcadas) — enrollments reais.
    if(!DEMO && !a._self && typeof sbProf!=='undefined' && sbProf.sincronizarTurmas){ sbProf.sincronizarTurmas(a.id, a.turmas).catch(()=>{ toast('Turmas não sincronizadas (rede)'); }); }
    // com backend: atualiza o profile (campos cadastrais). nascimento_data vai em update
    // SEPARADO: se a migration 0002 ainda não rodou, a coluna nova não pode derrubar a ficha.
    if(!DEMO && typeof sbProf!=='undefined' && sbProf.atualizarAluno){
      try{ sbProf.atualizarAluno(a.id, Object.assign({nome_completo:nome, apelido, email, nascimento}, _cadToDB(cad))); }catch(ex){}
      if(nascData){ try{ sbProf.atualizarAluno(a.id, {nascimento_data:nascData}); }catch(ex){} }
    }
    close(); refresh(); render(); toast('Ficha atualizada ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
// mapeia a ficha (cad) para as colunas snake_case do profiles (backend)
function _cadToDB(cad){
  const e=cad.endereco||{}, r=cad.responsavel||{};
  return { telefone:cad.telefone, cep:e.cep, logradouro:e.logradouro, numero:e.numero, bairro:e.bairro, cidade:e.cidade, uf:e.uf,
    resp_nome:r.nome, resp_telefone:r.telefone, resp_parentesco:r.parentesco, data_inicio:cad.dataInicio||null, observacoes:cad.obs };
}
function _profGraduarSheet(a, refresh){
  // v193: sem filtro por idade — professor decide a faixa (todas disponíveis).
  const idade = idadeCBJJ(a.nascimento);
  const faixas = CBJJ_CHAIN.slice();
  let selFaixa = a.faixa||'branca', selGraus = a.graus||0;
  const catTxt = idade!=null ? (categoriaCBJJ(a.nascimento)||'') : '';
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>
    <div class="sheet-title">Graduar ${safeTxt(a.nm)}</div>
    <div class="sheet-desc">Atual: ${BELTS[a.faixa]?.nome||safeTxt(a.faixa)} · ${safeTxt(a.graus)}º grau${idade!=null?` · ${idade} anos${catTxt?' · '+safeTxt(catTxt):''}`:' · idade não informada'}</div>
    <label class="flbl">Nova faixa</label>
    <div class="seg" id="gr-faixa"></div>
    <label class="flbl" style="margin-top:12px">Graus</label>
    <div class="seg" id="gr-graus"></div>
    <label class="flbl" style="margin-top:12px">Tipo</label>
    <div class="seg" id="gr-tipo"></div>
    <button class="btn-save" id="gr-save" style="margin-top:14px">Confirmar graduação</button>
    <button class="sheet-cancel" id="gr-cancel">Cancelar</button>
  </div></div>`);
  let selTipo = 'graduação';
  const segGraus = sheet.querySelector('#gr-graus');
  // B5: graus acompanham a faixa (preta = até 6; demais = até 4)
  const _rebuildGrausProf=()=>{
    const mx=maxGrausDe(selFaixa); if(selGraus>mx) selGraus=mx;
    segGraus.innerHTML='';
    for(let g=0;g<=mx;g++){ const b=el(`<button class="${g===selGraus?'active':''}">${g}º</button>`);
      b.onclick=()=>{ selGraus=g; segGraus.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segGraus.appendChild(b); }
  };
  const segFaixa = sheet.querySelector('#gr-faixa');
  const _paintFaixaProf=()=> renderBeltField(segFaixa, faixas, selFaixa, (f)=>{ selFaixa=f; _paintFaixaProf(); _rebuildGrausProf(); });
  _paintFaixaProf();
  _rebuildGrausProf();
  const segTipo = sheet.querySelector('#gr-tipo');
  ['graduação','grau'].forEach(t=>{ const b=el(`<button class="${t===selTipo?'active':''}">${t}</button>`);
    b.onclick=()=>{ selTipo=t; segTipo.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }; segTipo.appendChild(b); });
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#gr-cancel').onclick=close;
  sheet.querySelector('#gr-save').onclick=()=>{
    close();
    _profGraduarApply(a, selFaixa, selGraus, selTipo);  // _self → escreve em DB.graduacoes/DB.eu (reflete na Jornada)
    refresh(); render(); toast(`${a.nm} graduado para ${BELTS[selFaixa].nome} ${selGraus}º grau ✔`);
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
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
    _relData = d || {checkins:[],graduacoes:[],progresso:[],lesoes:[]}; render();
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

/* ---- Templates de WhatsApp: textos prontos por contexto (professor edita antes de enviar) ---- */
const WA_TEMPLATES = {
  sumido7:   { icon:'👋', label:'Sumido 1 semana',    body:(a)=>`Oi ${_waNome(a)}, senti sua falta no tatame essa semana. Tá tudo bem? Te espero na próxima aula 🥋` },
  sumido30:  { icon:'💪', label:'Sumido 1 mês',       body:(a)=>`Oi ${_waNome(a)}, notei que faz um tempo que você não vem treinar. Vamos marcar sua volta? Se precisar de qualquer ajuda, chama aqui.` },
  aniv:      { icon:'🎂', label:'Aniversário',        body:(a)=>`Oi ${_waNome(a)}, parabéns pelo seu dia! 🎂 Que venha mais um ano de tatame — a Yama torce por você.` },
  gradProx:  { icon:'🥋', label:'Graduação próxima',  body:(a)=>`Oi ${_waNome(a)}, você tá quase pronto pra próxima graduação — continue firme, tá muito perto!` },
  bemVindo:  { icon:'🙌', label:'Boas-vindas',        body:(a)=>`Oi ${_waNome(a)}, seja bem-vindo(a) à Yama Jiu-Jitsu! Qualquer dúvida sobre horários ou material, me chama aqui.` },
};
function _waNome(a){
  const c=a.cad||{}; const r=c.responsavel||{};
  const idade=idadeCBJJ(a.nascimento);
  if(idade!=null && idade<18 && r.nome) return r.nome.split(/\s+/)[0];
  return (a.nm||'').split(/\s+/)[0];
}
/* Abre wa.me com template pré-pronto e registra o envio (evita mandar 2× na mesma semana). */
function _waSend(a, tplKey){
  const tpl = WA_TEMPLATES[tplKey]; if(!tpl) return;
  const url = _waLink(a, tpl.body(a));
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
    <div class="sheet-title">WhatsApp · ${safeTxt(a.nm||'')}</div>
    <div class="sheet-desc">Escolha o texto — abre o seu WhatsApp com a mensagem pronta pra editar/enviar.</div>
    <div class="wa-tpl-grid" id="wa-tpl"></div>
    <button class="sheet-cancel" id="wa-close">Fechar</button>
  </div></div>`);
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),200); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#wa-close').onclick=close;
  const grid = sheet.querySelector('#wa-tpl');
  Object.entries(WA_TEMPLATES).forEach(([k,t])=>{
    const b = el(`<button class="wa-tpl"><span class="wa-tpl-ic">${t.icon}</span><span class="wa-tpl-lbl">${safeTxt(t.label)}</span></button>`);
    b.onclick=()=>{ _waSend(a,k); close(); render(); };
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

/* Apto = eixo AULAS verde E eixo TEMPO não-vermelho (sem dado não bloqueia — informativo).
   Antes era só nº de aulas; agora a regra CBJJ de tempo/idade entra no critério. */
function _aptosGraduar(){
  return _profAlunosArr().filter(a=>{
    const s=_semaforoGrad(a);
    return !!s.next && !!s.aulas && s.aulas.ok===true && (!s.tempo || s.tempo.ok!==false);
  });
}

/* ---- Ocupação por sessão (grade × presença média). Aproximação documentada: o checkin
   guarda a turma (não a sessão); sessões da MESMA turma no MESMO dia dividem a média. ---- */
function _ocupacaoSessoes(){
  if(!_relData) return [];
  const DIA_IDX={dom:0,seg:1,ter:2,qua:3,qui:4,sex:5,sab:6};
  const agg={};
  _relData.checkins.forEach(c=>{
    if(!c.turma_id) return;
    const dow=new Date(c.data+'T12:00:00').getDay();
    const k=c.turma_id+'|'+dow;
    const o=agg[k]||(agg[k]={pres:0,datas:new Set()});
    o.pres++; o.datas.add(c.data);
  });
  const out=[];
  (DB.turmas||[]).forEach(t=>{
    (t.sessoes||[]).forEach(s=>{
      const dow=DIA_IDX[s.dia]; if(dow==null) return;
      const nMesmoDia=(t.sessoes||[]).filter(x=>x.dia===s.dia).length || 1;
      const a=agg[t.id+'|'+dow];
      const media=a ? Math.round(a.pres/a.datas.size/nMesmoDia*10)/10 : 0;
      out.push({ turma:t.nome, cor:t.cor, dia:s.dia, hora:s.hora, variacao:s.variacao, media });
    });
  });
  out.sort((x,y)=> y.media-x.media || (x.hora||'').localeCompare(y.hora||''));
  return out;
}
function _presencaPorTipo(){
  if(!_relData) return [];
  const m={};
  _relData.checkins.forEach(c=>{ if(c.tipo) m[c.tipo]=(m[c.tipo]||0)+1; });
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
  const cls=x.ok===true?'ok':x.ok===false?'no':'na';
  const ic=x.ok===true?'✓':x.ok===false?'✗':'·';
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
      <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div>
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
  const TABS=[['visao','Visão geral'],['risco','Risco'],['alunos','Alunos (Excel)'],['retencao','Retenção'],['tecnicas','Técnicas'],['graduacao','Graduação'],['loja','Loja']];
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
          <div class="nm">${safeTxt(a.nm)}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span class="risco-motivo">${safeTxt(_riscoMotivo(a)||((a.diasSem||0)+'d sem treinar'))}</span></div>
        </div>
        <div class="risco-score">${a.diasSem||0}<small>d</small></div>
        ${wa?`<button class="risco-wa" aria-label="WhatsApp ${safeAttr(a.nm)}">💬 WhatsApp</button>`:''}
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
  const alunos = _profAlunosArr().filter(a=>!(a.role==='professor'||a.role==='dono'));
  _loadTurmas(); const turmaMap = {}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });

  let busca='', filtroEt='todos', filtroRisco='todos';
  const wrap = el('<div class="xls-wrap"></div>');

  const bar = el(`<div class="xls-bar">
    <div class="dt-search"><span class="dt-search-ic" aria-hidden="true">🔎</span><input class="dt-search-inp" type="search" placeholder="Buscar por nome, e-mail, telefone…"></div>
    <div class="xls-filters"></div>
    <button class="btn-cad ghost" id="xls-csv">⬇ Exportar CSV</button>
  </div>`);
  const chips = bar.querySelector('.xls-filters');
  const _chip=(lbl,cur,set,val)=>{ const b=el(`<button class="et-chip ${cur===val?'on':''}">${lbl}</button>`); b.onclick=()=>{ set(val); rebuild(); }; return b; };
  const paintChips=()=>{
    chips.innerHTML='';
    chips.appendChild(_chip('Todas idades', filtroEt, v=>filtroEt=v, 'todos'));
    FAIXA_ETARIA_OPCOES.forEach(op=> chips.appendChild(_chip(op, filtroEt, v=>filtroEt=v, op)));
    chips.appendChild(el(`<span class="xls-sep"></span>`));
    RISCO_NIVEIS.forEach(([id,lbl])=> chips.appendChild(_chip(lbl, filtroRisco, v=>filtroRisco=v, id)));
    chips.appendChild(_chip('Todos', filtroRisco, v=>filtroRisco=v, 'todos'));
  };
  bar.querySelector('.dt-search-inp').oninput=(e)=>{ busca=e.target.value.trim().toLowerCase(); rebuild(); };
  bar.querySelector('#xls-csv').onclick=()=>_xlsExportCSV(getRows());

  const scroll = el('<div class="xls-scroll"></div>');
  const table  = el('<table class="xls-tbl"></table>');
  scroll.appendChild(table);

  const COLS = [
    ['Nome',        a => a.nm],
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
    if(filtroEt!=='todos')    arr = arr.filter(a=>_faixaEtariaLbl(a.nascimento)===filtroEt);
    if(filtroRisco!=='todos') arr = arr.filter(a=>_riscoNivel(a)===filtroRisco);
    if(busca){
      arr = arr.filter(a=>{
        const bag = [a.nm, a.cad?.email, a.cad?.telefone, a.cad?.endereco?.cidade].join(' ').toLowerCase();
        return bag.includes(busca);
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
      return `<tr data-id="${safeAttr(a.id||a.nm)}">${cells}<td class="xls-act"><button class="wa-ico" data-nm="${safeAttr(a.nm)}" title="WhatsApp">💬</button></td></tr>`;
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

/* Exporta linhas visíveis do "Alunos (Excel)" pra CSV (UTF-8 BOM, aceita Excel/Sheets). */
function _xlsExportCSV(rows){
  const cols = ['Nome','E-mail','Telefone','Nascimento','Idade','Faixa etária','Faixa','Turmas','Últ. presença','Dias sem','Nível risco','Pgto','Cidade','Bairro','UF','Responsável','Tel. resp.','Data início'];
  const _esc=(s)=>{ const t=String(s==null?'':s); return /[";,\n]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t; };
  const linhas = [cols.join(';')];
  _loadTurmas(); const turmaMap={}; (typeof _turmasArr==='function'?_turmasArr():[]).forEach(t=>{ turmaMap[t.id]=t.nome; });
  rows.forEach(a=>{
    linhas.push([
      a.nm, a.cad?.email||'', a.cad?.telefone||'',
      a.nascData ? a.nascData.split('-').reverse().join('/') : (a.nascimento||''),
      idadeCBJJ(a.nascimento)||'',
      _faixaEtariaLbl(a.nascimento)||'',
      (BELTS[a.faixa]?BELTS[a.faixa].nome:a.faixa||'')+(a.graus?' · '+a.graus+'º':''),
      (a.turmas||[]).map(id=>turmaMap[id]).filter(Boolean).join(', '),
      a.pres||'ausente', a.diasSem||0,
      (RISCO_NIVEIS.find(x=>x[0]===_riscoNivel(a))||[])[1]||'',
      a.pago==='ok'?'Em dia':a.pago==='late'?'Vencido':a.pago==='soon'?'A vencer':'—',
      a.cad?.endereco?.cidade||'', a.cad?.endereco?.bairro||'', a.cad?.endereco?.uf||'',
      a.cad?.responsavel?.nome||'', a.cad?.responsavel?.telefone||'',
      a.cad?.dataInicio||a.desde||'',
    ].map(_esc).join(';'));
  });
  const csv = '﻿'+linhas.join('\r\n');   // BOM UTF-8 pro Excel abrir com acentos
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `yama-alunos-${HOJE_ISO}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast(`CSV exportado (${rows.length} linha${rows.length>1?'s':''})`);
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

  // Presença por tipo de aula (§7.1-A) — agora REAL: o check-in por sessão grava a variação.
  w.appendChild(_secTitleLink('Presença por tipo de aula (120 dias)','tipoAula'));
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
      <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div>
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
        <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div>
          <div class="meta">${beltPill(a.faixa,a.graus)} <span style="font-size:11px;color:var(--muted)">${a.diasSem!=null?a.diasSem+'d sem treinar':''}</span></div></div>
        <div class="st-right">${apto?'<span class="status-chip green">apto</span>':'<span style="color:var(--muted)">›</span>'}</div></div>`);
      row.onclick=()=>_profAlunoSheet(a);
      lst.appendChild(row);
    });
    w.appendChild(lst);
  });
}
function _relDetTipoAula(w, secTitle, note){
  w.appendChild(el(`<div class="rel-det-h">Presença por tipo de aula · 120 dias</div>`));
  const tipos=_presencaPorTipo();
  if(!tipos.length){ w.appendChild(note('Sem check-ins com tipo de aula ainda. O tipo é gravado quando o aluno faz check-in numa sessão da grade.')); return; }
  const tot=tipos.reduce((s,[,n])=>s+n,0)||1;
  const max=Math.max(1,...tipos.map(([,n])=>n));
  w.appendChild(el(`<div class="stat-grid block" style="margin-top:4px">
    <div class="stat-card"><div class="sv">${tot}</div><div class="sl">Check-ins</div></div>
    <div class="stat-card"><div class="sv">${tipos.length}</div><div class="sl">Tipos</div></div>
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
  w.appendChild(el('<div class="empty-line" style="padding:8px 20px;font-size:11px;color:var(--muted)">Média de presentes por aula. Sessões da mesma turma no mesmo dia dividem a média.</div>'));
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
  w.appendChild(secTitle(`Em risco de evasão (ausência ${RISCO_DIAS}+ dias ou queda ≥50%)`));
  const risco=_emRisco();
  const riscoList=el('<div class="list block"></div>');
  if(!risco.length) riscoList.appendChild(el('<div class="empty-line">Ninguém em risco. 🎉</div>'));
  else risco.sort((a,b)=>(b.diasSem||0)-(a.diasSem||0)).forEach(a=>{
    const wa=_waLink(a);
    const right = wa
      ? `<a class="wa-btn" href="${safeAttr(wa)}" target="_blank" rel="noopener" aria-label="Chamar ${safeAttr(a.nm)} no WhatsApp">WhatsApp</a>`
      : '<span style="color:var(--muted)">›</span>';
    const row=alunoRow(a, `<span style="font-size:11px;color:var(--red-strong);font-weight:700">${safeTxt(_riscoMotivo(a)||'')}</span>`, right);
    const waEl=row.querySelector('.wa-btn');
    if(waEl) waEl.onclick=(e)=>e.stopPropagation();   // o toque no botão não abre o detalhe
    riscoList.appendChild(row);
  });
  w.appendChild(riscoList);

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
    const metaAulas={};
    sh.querySelectorAll('.rf-inp').forEach(i=>{ const v=parseInt(i.value); if(v>0) metaAulas[i.dataset.f]=v; });
    DB.academyConfig=Object.assign({}, DB.academyConfig, {metaAulas});
    if(!DEMO && typeof sbProf!=='undefined' && sbProf.salvarConfig){
      sbProf.salvarConfig(DB.academyConfig).then(()=>toast('Regras salvas ✔'))
        .catch(()=>toast('Não salvou na nuvem — o banco precisa da migration 0003'));
    } else toast('Regras salvas ✔');
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

function profFinanceiro(){
  const w = el('<div></div>');
  if(!_profData){ w.innerHTML='<div class="card card-pad" style="margin:20px;text-align:center;color:var(--muted)">Sem dados financeiros no modo local.</div>'; return w; }
  const alunos   = (_profData?.alunos)||[];
  const vencidos = alunos.filter(a=>a.pago==='late');
  const aVencer  = alunos.filter(a=>a.pago==='soon');
  const pagos    = alunos.filter(a=>a.pago==='ok');
  const receita    = pagos.reduce((s,a)=>s+(a.mensValor||0),0);
  const aReceber   = aVencer.reduce((s,a)=>s+(a.mensValor||0),0);
  const vencidoVal = vencidos.reduce((s,a)=>s+(a.mensValor||0),0);
  const mesAtual   = new Date().toLocaleDateString('pt-BR',{month:'long'});

  w.innerHTML = `<div class="hello"><div class="date">Financeiro</div>
    <div class="greet">${mesAtual} · mensalidades</div></div>`;
  w.appendChild(el(`<div class="fin-head">
    <div class="lbl">Recebido no mês</div><div class="big">${_profData?moneyBR(receita):'…'}</div>
    <div class="row">
      <div class="c"><div class="v green">${_profData?moneyBR(aReceber):'…'}</div><div class="l">A receber</div></div>
      <div class="c"><div class="v red">${_profData?moneyBR(vencidoVal):'…'}</div><div class="l">Vencido</div></div>
      <div class="c"><div class="v">${_profData?pagos.length:'…'}</div><div class="l">Pagos</div></div>
    </div></div>`));

  let filtro = 'vencidos';
  const seg = el(`<div class="filter-seg">
    <button class="active" data-f="vencidos">Vencidos (${vencidos.length})</button>
    <button data-f="avencer">A vencer (${aVencer.length})</button>
    <button data-f="pagos">Pagos (${pagos.length})</button>
  </div>`);
  const list = el('<div class="list"></div>');

  const renderFin = ()=>{
    list.innerHTML='';
    if(!_profData){ list.appendChild(el('<div class="loading-center">Carregando…</div>')); return; }
    const src = filtro==='vencidos'?vencidos : filtro==='avencer'?aVencer : pagos;
    if(!src.length){ list.appendChild(el('<div class="empty-line">Nenhum nesta categoria.</div>')); return; }
    src.forEach(a=>{
      const row=el(`<div class="st-row" style="cursor:pointer">
        ${avatarAluno(a)}
        <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div>
          <div class="meta"><span style="font-size:11.5px;color:var(--muted);font-weight:600">Vence ${safeTxt(a.mensVenc||'—')}</span></div></div>
        <div class="st-right">
          <div style="font-size:14.5px;font-weight:800;color:${a.pago==='late'?'var(--red)':'var(--ink)'}">${a.mensValor>0?moneyBR(a.mensValor):'—'}</div>
        </div>
      </div>`);
      row.onclick=()=>_profAlunoSheet(a);
      list.appendChild(row);
    });
  };

  seg.querySelectorAll('[data-f]').forEach(b=>{
    b.onclick=()=>{
      filtro=b.dataset.f;
      seg.querySelectorAll('[data-f]').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); renderFin();
    };
  });
  renderFin();
  w.appendChild(seg); w.appendChild(list);
  return w;
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
  sbProf.getPedidos().then(ps=>{ _pedidosData = ps; render(); }).catch(()=>{ _pedidosTs = 0; });
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
function profPedidos(){
  _loadPedidos();
  const w = el('<div></div>');
  w.innerHTML = `<div class="hello"><div class="date">Pedidos</div>
    <div class="greet">Confirme o recebimento para baixar o estoque</div></div>`;
  const back = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0"><span>‹ Voltar à Loja</span></div>`);
  back.onclick=()=>goProf('loja'); w.appendChild(back);
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
          <button class="ped-no">Cancelar</button></div>`);
        acts.querySelector('.ped-ok').onclick=async()=>{
          const b=acts.querySelector('.ped-ok'); b.disabled=true; b.textContent='Confirmando…';
          if(!DEMO && typeof sbProf!=='undefined' && sbProf.confirmarPedido){
            try{ await sbProf.confirmarPedido(p.id); }
            catch(e){ b.disabled=false; b.textContent='✓ Confirmar (baixa estoque)'; toast('Erro: '+(e.message||e)); return; }
          } else { p.status='concluido'; _baixaEstoqueMock(p); }   // demo
          toast('Pedido confirmado · estoque baixado ✔'); _reload();
        };
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
  const baixos = prods.filter(p=> p.ativo!==false && _temEstoqueBaixo(p)).length;
  const ocultos = prods.filter(p=> p.ativo===false).length;
  w.innerHTML = `<div class="hello"><div class="date">Loja</div>
    <div class="greet">${prods.length} produtos${baixos?' · '+baixos+' com estoque baixo':''}${ocultos?' · '+ocultos+' ocultos':''}</div></div>`;
  const pend = _pedidosPendentesN();
  const pedBtn = el(`<div class="cfg-row" style="margin:0 20px 10px" role="button" tabindex="0">
    <span>🧾 Pedidos${pend?` <span class="low-badge" style="background:var(--red);color:#fff">${pend} pendente${pend>1?'s':''}</span>`:''}</span>
    <span style="margin-left:auto;color:var(--muted)">›</span></div>`);
  pedBtn.onclick=()=>goProf('pedidos');
  w.appendChild(pedBtn);
  const addBtn = el(`<div class="dt-add-wrap"><button class="btn-cad">＋ Novo produto</button></div>`);
  addBtn.querySelector('button').onclick=()=>abrirProdutoForm(null);
  w.appendChild(addBtn);
  const list = el('<div class="list"></div>');
  prods.forEach(p=>{
    const baixo=_temEstoqueBaixo(p), tot=_estoqueTotal(p);
    const row=el(`<div class="st-row" style="cursor:pointer">
      <div class="prod-mini${p.img?' has-img':''}" style="background:${safeAttr(p.cor||'var(--field)')}">${safeTxt(p.emoji||'🥋')}</div>
      <div class="st-mid"><div class="nm">${safeTxt(p.nome)}${p.ativo===false?' <span class="prod-hidden">oculto</span>':''}</div>
        <div class="meta"><span style="font-weight:800;color:var(--ink)">${moneyBR(p.preco)}</span>
          <span style="font-size:11px;color:var(--muted)"> · ${safeTxt(p.cat)} · estoque ${tot}</span>
          ${baixo&&p.ativo!==false?'<span class="low-badge">estoque baixo</span>':''}</div></div>
      <div class="st-right" style="color:var(--muted);font-size:18px">›</div>
    </div>`);
    _mountProdImg(row.querySelector('.prod-mini'), p);   // nó cacheado → sem flash no re-render
    row.onclick=()=>abrirProdutoForm(p);
    list.appendChild(row);
  });
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
  let selCat = p ? p.cat : 'Kimonos';
  let ativo  = p ? p.ativo!==false : true;
  let sizes = p ? (p.tam||[]).slice() : (CAT_TAMANHOS['Kimonos']||[]).slice();
  let sizesCustom = !novo;   // produto existente: nunca trocar os tamanhos ao mudar categoria
  let dirty = false;
  // Fotos: primeira = capa (p.img), resto = galeria (p.imgs[]). URLs no Supabase Storage
  // (bucket `produtos`, público-leitura). Upload cru — sem crop/compressão (as fotos do
  // catálogo já vêm 1:1 e leves; ver CLAUDE.md § análise de fotos).
  let fotos = p ? [p.img, ...(Array.isArray(p.imgs)?p.imgs:[])].filter(Boolean) : [];
  const est = {}; sizes.forEach(t=> est[t] = p ? (p.estoque?.[t] ?? 0) : 10);
  const back=()=>{ DB.produtoFormOpen=false; DB._produtoEdit=null; render(); window.scrollTo(0,0); };
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
  const paintFotos = ()=>{
    fotosWrap.innerHTML='';
    fotos.forEach((url,i)=>{
      const t=el(`<div class="pf-foto${i===0?' capa':''}"><img src="${safeAttr(url)}" alt="" data-fallback="remove">
        <button class="pf-rm" aria-label="Remover foto ${i+1}">✕</button></div>`);
      t.querySelector('.pf-rm').onclick=()=>{ dirty=true; fotos.splice(i,1); paintFotos(); };
      fotosWrap.appendChild(t);
    });
    const add=el(`<button class="pf-add" aria-label="Adicionar foto">＋</button>`);
    add.onclick=()=> fileIn.click();
    fotosWrap.appendChild(add);
  };
  paintFotos();
  fileIn.onchange = async ()=>{
    const files = Array.from(fileIn.files||[]); fileIn.value='';
    if(!files.length) return;
    if(typeof sbProf==='undefined' || !sbProf.uploadProdutoFoto){ toast('Upload indisponível offline'); return; }
    toast('Enviando '+files.length+' foto'+(files.length>1?'s':'')+'…');
    for(const f of files){
      try{
        const url = await sbProf.uploadProdutoFoto(f, p?p.id:null);
        if(url){ fotos.push(url); dirty=true; paintFotos(); }
      }catch(e){ toast('Erro no upload: '+(e.message||e)); }
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
  sbProf.getTurmas().then(ts=>{ DB.turmas = ts; render(); }).catch(()=>{ _turmasTs = 0; });
}

function profTurmas(){
  _loadTurmas();
  const w = el('<div></div>');
  const n = _turmasArr().length;
  w.innerHTML = `<div class="hello"><div class="date">Turmas</div>
    <div class="greet">${n} turma${n!==1?'s':''} · grade semanal</div></div>`;
  const grade = el('<div class="mod-card" style="padding:14px 12px"></div>');
  grade.appendChild(el(`<div class="mod-title" style="margin-bottom:8px;padding:0 4px">Grade de horários</div>`));
  grade.appendChild(_gradeHorarios(_turmasArr()));
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
function _gradeHorarios(turmas){
  const wrap = el('<div class="grade-wrap"></div>');
  const cells = {}; const horasSet = new Set(); const diasSet = new Set();
  (turmas||[]).forEach(t=> (t.sessoes||[]).forEach(s=>{
    const k = s.dia+'|'+s.hora; (cells[k]=cells[k]||[]).push({t, s});
    horasSet.add(s.hora); diasSet.add(s.dia);
  }));
  const horas = [...horasSet].sort();
  const dias = DIAS_SEMANA.filter(([d])=> diasSet.has(d));
  if(!horas.length){ wrap.appendChild(el('<div class="empty-hint">Sem horários. Adicione sessões às turmas.</div>')); return wrap; }
  const table = el('<div class="grade"></div>');
  table.style.gridTemplateColumns = `48px repeat(${dias.length}, minmax(62px,1fr))`;
  table.appendChild(el('<div class="g-h g-corner"></div>'));
  dias.forEach(([d,lbl])=> table.appendChild(el(`<div class="g-h">${lbl}</div>`)));
  horas.forEach(h=>{
    table.appendChild(el(`<div class="g-hora">${safeTxt(h)}</div>`));
    dias.forEach(([d])=>{
      const cell = el('<div class="g-cell"></div>');
      (cells[d+'|'+h]||[]).forEach(({t,s})=>{
        // Chip 2 linhas: NOME em cima, VARIAÇÃO (prioritária) ou FAIXA ETÁRIA embaixo.
        // Bandeira 🇺🇸 no canto quando bilíngue.
        const sub = s.variacao || t.faixaEtaria || '';
        cell.appendChild(el(`<span class="g-chip" style="--tc:${t.cor||'#888'}">
          <b class="g-nm">${safeTxt(t.nome)}${s.bilingue?' '+icoUSFlag():''}</b>
          ${sub?`<i class="g-sub">${safeTxt(sub)}</i>`:''}
        </span>`));
      });
      table.appendChild(cell);
    });
  });
  wrap.appendChild(table);
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
    // Legenda no topo: cor + nome de cada turma (só faz sentido pra 2+; pra 1 turma vira título)
    const legenda = el(`<div class="mt-legenda"></div>`);
    minhas.forEach(t=>{
      const chip = el(`<span class="mt-legenda-item" style="--tc:${safeAttr(t.cor||'#888')}">
        <span class="mt-tcolor" aria-hidden="true"></span>
        <b>${safeTxt(t.nome)}</b>${t.faixaEtaria?` <span class="mt-tid">${safeTxt(t.faixaEtaria)}</span>`:''}
      </span>`);
      legenda.appendChild(chip);
    });
    body.appendChild(legenda);
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
        const t = s._t; const cor = t.cor||'#888';
        const src = t.logo || 'brand/logo.png?v=2';
        const logoHTML = `<img class="mt-gd-logo" src="${safeAttr(src)}" alt="" data-fallback="remove">`;
        const extras = [s.variacao, s.bilingue?icoUSFlag():null].filter(Boolean).join(' · ');
        grid.appendChild(el(`<div class="mt-gc" style="--tc:${safeAttr(cor)}" title="${safeAttr(t.nome)}">${logoHTML}${extras?`<i>${safeTxt(extras)}</i>`:''}</div>`));
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
function _turmaSheet(id){
  const t = id ? _turmaById(id) : null;
  const novo = !t;
  let cor = t?.cor || _TURMA_CORES[0];
  let sessoes = (t?.sessoes || []).slice();   // cópia de trabalho: horários só gravam no Salvar (Cancelar descarta)
  const sheet = el(`<div class="sheet-overlay"><div class="sheet" role="dialog" style="max-height:90vh;overflow-y:auto">
    <div class="sheet-grip"></div>
    <div class="sheet-title">${novo?'Nova turma':'Editar turma'}</div>
    <label class="flbl">Nome</label>
    <input class="inp" id="tu-nome" placeholder="Ex: Adulto, Kodomo…" value="${t?safeAttr(t.nome):''}">
    <label class="flbl" style="margin-top:12px">Faixa etária <span class="ca-opt">(opcional)</span></label>
    <input class="inp" id="tu-idade" placeholder="Ex: 16+, 6–9 anos" value="${t?safeAttr(t.faixaEtaria||''):''}">
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
    <button class="sheet-cancel" id="tu-cancel">Cancelar</button>
  </div></div>`);
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
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#tu-cancel').onclick=close;
  const delBtn=sheet.querySelector('#tu-del');
  if(delBtn) delBtn.onclick=()=>{
    if(!DEMO && typeof sbProf!=='undefined'){ sbProf.deletarTurma(t.id).then(()=>{ _turmasTs=0; _loadTurmas(); }).catch(e=>toast('Erro: '+(e.message||e))); close(); toast('Turma excluída'); return; }
    DB.turmas=_turmasArr().filter(x=>x!==t); close(); render(); toast('Turma excluída');
  };
  sheet.querySelector('#tu-save').onclick=()=>{
    const nome=sheet.querySelector('#tu-nome').value.trim();
    if(!nome){ toast('Informe o nome da turma'); return; }
    const idade=sheet.querySelector('#tu-idade').value.trim();
    if(!DEMO && typeof sbProf!=='undefined'){   // backend real: persiste turma + sessões
      const payload = novo ? { nome, faixaEtaria:idade, cor, sessoes } : { id:t.id, nome, faixaEtaria:idade, cor, sessoes };
      sbProf.salvarTurma(payload).then((newId)=>{ _turmasTs=0; _loadTurmas();
        // atalho: turma nova reabre direto na edição (adicionar horários + matricular sem procurar)
        if(novo && newId) setTimeout(()=>_turmaSheet(newId), 350);
      }).catch(e=>toast('Erro: '+(e.message||e)));
      close(); toast(novo?'Turma criada ✔ — adicione os horários':'Turma salva ✔'); return;
    }
    if(novo){ const nid='t'+Date.now(); _turmasArr().push({ id:nid, nome, faixaEtaria:idade, cor, sessoes }); close(); render(); toast('Turma criada ✔ — adicione os horários'); setTimeout(()=>_turmaSheet(nid), 300); return; }
    t.nome=nome; t.faixaEtaria=idade; t.cor=cor; t.sessoes=sessoes;
    close(); render(); toast('Turma salva ✔');
  };
  document.body.appendChild(sheet);
  requestAnimationFrame(()=>sheet.classList.add('open'));
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
      <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div><div class="meta">${beltPill(a.faixa,a.graus)}</div></div>
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
      <div class="st-mid"><div class="nm">${safeTxt(a.nm)}</div><div class="meta">${beltPill(a.faixa,a.graus)}</div></div>
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

function tabbarProf(){
  // Mobile-first: 5 tabs essenciais visíveis por padrão. Loja e Vídeos são
  // "gerenciamento" — só aparecem em tablet/desktop (≥768px) via .tab-wide.
  const tabs = [
    ['painel','Painel', icoHome(), false],
    ['alunos','Alunos', icoUsers(), false],
    ['turmas','Turmas', icoCalendar(), false],
    ['relatorios','Relatórios', icoChart(), false],
    ['videos','Vídeos', icoVideo(), true],   // wide-only
    ['loja','Loja', icoStore(), true],       // wide-only
    ['perfil','Mais', icoMore(), false],
  ];
  const bar = el(`<div class="tabbar"></div>`);
  tabs.forEach(([id,label,ico,wideOnly])=>{
    const cls = `tab ${DB.navProf===id?'active':''}${wideOnly?' tab-wide':''}`;
    const t = el(`<div class="${cls}">${ico||icoMore()}<span class="tl">${label}</span></div>`);
    t.onclick=()=> goProf(id);
    bar.appendChild(t);
  });
  return bar;
}

/* ---------------- navegação ---------------- */
function setRole(r){ DB.role=r; DB.flow=null; render(); window.scrollTo(0,0); }
function goAluno(id){ DB.navAluno=id; render(); window.scrollTo(0,0); }
function goProf(id){ DB.navProf=id; render(); window.scrollTo(0,0); }
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
      <p>Controlador: <b>Academia Yama Jiu-Jitsu</b>. Operador: Supabase (hospedagem do banco de dados). Coletamos o mínimo (sem CPF ou dados de saúde além do que você registrar em Lesões). Não há decisões automatizadas sobre você. Os dados ficam até você apagar.</p>
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
      const _finishBase64=()=>{ DB.eu.foto=cv.toDataURL('image/jpeg',0.85); close(); scheduleSave(); render(); toast('Foto atualizada ✔'); };
      if(DB.sbUser && typeof sbSync!=='undefined' && sbSync.uploadFoto){
        cv.toBlob(async blob=>{
          if(!blob){ _finishBase64(); return; }
          try{
            // 0007: signed URL (única por assinatura — cache-bust natural; ?t= extra QUEBRARIA o token)
            const url = await sbSync.uploadFoto(blob);
            if(url){ DB.eu.foto = url; close(); scheduleSave(); render(); toast('Foto atualizada ✔'); return; }
            _finishBase64();
          }catch(_){ _finishBase64(); }
        }, 'image/jpeg', 0.85);
      } else _finishBase64();
    };
    img.src=url; };
  const rm = sheet.querySelector('#pf-rm');
  if(rm) rm.onclick = ()=>{
    DB.eu.foto=null;
    if(DB.sbUser && typeof sbSync!=='undefined' && sbSync.deleteFoto) sbSync.deleteFoto().catch(()=>{});
    close(); scheduleSave(); render(); toast('Foto removida');
  };
}

// ---- Editar perfil ----
function abrirEditarPerfil(){
  const me = DB.eu;
  let faixa = me.faixa, graus = me.graus, nascimento = me.nascimento;
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
    <input class="inp" id="ep-nome" value="${safeAttr(me.nomeCompleto)}">
    <label class="flbl" style="margin-top:12px">Ano de nascimento</label>
    <input class="inp" id="ep-nasc" type="number" inputmode="numeric" placeholder="Ex: 1998" value="${nascimento||''}" min="1920" max="${hoje.getFullYear()}">
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
    const epNasc=sheet.querySelector('#ep-nasc');
    // faixas filtradas por idade (CBJJ) — reconstrói ao mudar o ano de nascimento
    const _rebuildBeltsPerfil=()=>{
      const nv=parseInt(epNasc.value); const idade=(nv>=1920&&nv<=hoje.getFullYear())?idadeCBJJ(nv):null;
      const lista = CBJJ_CHAIN.slice();   // v193: perfil também sem filtro por idade
      if(!lista.includes(faixa)) faixa = lista[0];
      renderBeltField(bs, lista, faixa, (b)=>{ faixa=b; _rebuildBeltsPerfil(); });
      _rebuildGraus();
    };
    if(epNasc) epNasc.addEventListener('input', _rebuildBeltsPerfil);
    _rebuildBeltsPerfil();
    const dataFaixaAtual = (DB.graduacoes||[]).find(g=>g.tipo==='faixa'&&g.faixa===me.faixa);
    if(dataFaixaAtual && epDataFaixa) epDataFaixa.value = dataFaixaAtual.data;
  }
  const close=()=>{ sheet.classList.remove('open'); setTimeout(()=>sheet.remove(),260); };
  sheet.onclick=(e)=>{ if(e.target===sheet) close(); };
  sheet.querySelector('#ep-cancel').onclick=close;
  sheet.querySelector('#ep-save').onclick=()=>{
    me.apelido = sheet.querySelector('#ep-apelido').value.trim() || me.apelido;
    me.nomeCompleto = sheet.querySelector('#ep-nome').value.trim() || me.nomeCompleto;
    const base = (me.nomeCompleto||me.apelido||'').trim();
    me.nome = base.split(' ').slice(0,2).join(' ') || me.apelido;
    me.iniciais = (base.split(/\s+/).map(s=>s[0]).slice(0,2).join('') || (me.apelido||'A')[0]).toUpperCase();
    const nv=parseInt(sheet.querySelector('#ep-nasc').value); me.nascimento=(nv>=1920&&nv<=hoje.getFullYear())?nv:me.nascimento;
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
    DB.lesoes.forEach(l=>{ const st={ativa:['gold','Ativa'],recuperando:['blue','Recuperando'],curada:['green','Curada']}[l.status]||['blue',l.status];
      const row = el(`<div class="lesao-item"><div class="li-top"><span class="li-nm">${safeTxt(l.parte)}</span><span class="niv-badge ${st[0]}">${st[1]}</span></div>${l.nota?`<div class="li-nota">${safeTxt(l.nota)}</div>`:''}<div class="li-dt">${fmtDataLonga(l.data)}</div>
        <div class="li-actions"><button class="li-edit">Editar</button><button class="li-del">Excluir</button></div></div>`);
      row.querySelector('.li-edit').onclick=()=> abrirEditarLesao(l, renderList);
      row.querySelector('.li-del').onclick=()=>{
        const cf = el(`<div class="sheet-overlay"><div class="sheet" role="dialog">
          <div class="sheet-grip"></div>
          <div class="sheet-title">Excluir lesão?</div>
          <div class="sheet-desc">Esta lesão será removida permanentemente. Não dá pra desfazer.</div>
          <button class="btn-save danger" id="ld-ok">Excluir</button>
          <button class="sheet-cancel" id="ld-no">Cancelar</button>
        </div></div>`);
        const closeCf = openSheet(cf, '#ld-no');
        cf.querySelector('#ld-ok').onclick=()=>{ DB.lesoes=DB.lesoes.filter(x=>x.id!==l.id); closeCf(); renderList(); scheduleSave(); if(DB.sbUser && !DEMO && typeof sbSync!=='undefined'){ try{ sbSync.pushLesoes(); }catch(e){} } toast('Lesão excluída'); };
      };
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
// Ícones dos KPIs do professor (stroke currentColor — cor vem da classe .si)
function icoRoster(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;}
function icoPulse(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-7 4 14 2.5-7H21"/></svg>`;}
function icoAlert(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>`;}
function icoBelt(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5"/><path d="M9 13.3 7.5 21l4.5-2.6L16.5 21 15 13.3"/></svg>`;}
function icoBox(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/></svg>`;}
function icoCalendar(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>`;}
function icoVideo(){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2z"/></svg>`;}
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
    // C1: aulas = DIA distinto, contadas só no grau atual, reset na promoção, + baseline importada
    ok('maxGrausDe preta=6 · demais=4', maxGrausDe('preta')===6 && maxGrausDe('azul')===4);
    if(!DEMO){ const sTr=DB.treinos, sGr=DB.graduacoes, sEu=DB.eu; try{
      DB.eu = Object.assign({}, sEu, { faixa:'azul', graus:1, aulasGrau:{meta:40, base:0}, aulasGraduacao:160 });
      DB.graduacoes = [
        { faixa:'azul', graus:0, tipo:'faixa', data:'2025-01-01' },
        { faixa:'azul', graus:1, tipo:'grau',  data:'2025-06-01' },
      ];
      DB.treinos = [ {id:1,data:'2025-07-10'}, {id:2,data:'2025-07-10'}, {id:3,data:'2025-03-01'} ];
      ok('C1 aulas dedup mesmo dia no grau', aulasStats().atual===1);   // 2x 10/07 = 1; 01/03 é pré-grau
      ok('C1 estimativa da faixa dedup', aulasStats().restantes===158); // 160 - 2 dias na faixa
      DB.eu.graus=2; DB.graduacoes.push({faixa:'azul',graus:2,tipo:'grau',data:HOJE_ISO}); DB.eu.aulasGrau.base=0;
      ok('C1 reset de aulas no novo grau', aulasStats().atual===0);
      DB.eu.graus=1; DB.graduacoes.pop(); DB.eu.aulasGrau.base=5;
      ok('C1 baseline importada entra no grau', aulasStats().atual===6); // 5 base + 1 dia
    }catch(e){ ok('C1 aulasStats', false); } finally { DB.treinos=sTr; DB.graduacoes=sGr; DB.eu=sEu; } }
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
let _cloudLoginBusy = false;
async function _cloudLogin(user){
  if(_cloudLoginBusy || (DB.sbUser && _cloudReady)) return;
  _cloudLoginBusy = true;
  try{
    DB.sbUser = user;
    DB.authOpen = false;
    DB.checkinHoje = { feito:false, hora:null };   // só confia no checkin vindo da nuvem
    try{ await sbSync.migrateLegacy(user.id); }catch(e){}   // one-time: acervo pré-cutover → nuvem
    let dump;
    try{ dump = await sbSync.pullState(user.id); }
    catch(e){
      // Sem estado local confiável: NUNCA assumir conta vazia (risco de sobrescrever a nuvem).
      _renderOfflineBoot(()=>{ _cloudLoginBusy=false; _cloudLogin(user); });
      return;
    }
    if (dump) applyDump(dump);
    else { aplicarCleanSlate(); DB.onboarded = false; }     // conta nova de verdade
    _cloudReady = true;
    _lastPushed = JSON.stringify(buildDump());              // baseline do dirty-check
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
    let mustChange = false;
    try{ mustChange = !!(sbAuth.mustChangePassword && await sbAuth.mustChangePassword()); }catch(e){}
    if (mustChange){ DB.trocarSenhaOpen = true; DB.onboardingOpen = false; }
    else if (DB.eu.role === 'dono' || DB.eu.role === 'professor'){
      // Onboarding é do ALUNO (consentimento LGPD do praticante). Dono/professor
      // pulam sempre — mesmo que apelido esteja vazio (editam depois no Perfil).
      DB.onboarded = true; scheduleSave();
    }
    else if (!DB.eu.apelido || !DB.onboarded) DB.onboardingOpen = true;
    try{ if(sbSync.pullLoja) await sbSync.pullLoja(); }catch(e){}
    try{ if(sbSync.pullTurmas) await sbSync.pullTurmas(); }catch(e){}   // grade p/ presença por sessão
    try{ if(sbSync.pullMatricula) await sbSync.pullMatricula(); }catch(e){}   // rótulo "Turma" com TODAS as matrículas
    track('app_open');
    render();
  } finally {
    _cloudLoginBusy = false;
  }
}

if (DEMO || TESTMODE) {
  // vitrine (?demo=1) e selfTest (?test=1): seed em memória, nada persiste
  render();
} else if (!SUPABASE_CONFIGURADO) {
  renderSetupRequired();
} else {
  (async ()=>{
    DB.alunos = [];   // M13: alunos fictícios são só da vitrine — produção usa o backend
    DB.turmas = [];   // grade demo não vale p/ aluno real — pullTurmas popula do backend no login
    if(DB.loja) DB.loja.produtos = [];   // catálogo mock é só da vitrine — pullLoja popula do backend
    DB.academia = Object.assign({}, DB.academia, { turma:null });  // sem turma mock; pullAll preenche a real (kanji/artes ficam de fallback da marca)
    if(!render._wrapped){ const _ro = render; render = function(){ _ro.apply(this, arguments); scheduleSave(); }; render._wrapped=true; }
    let session = null;
    try{ const { data } = await SB.auth.getSession(); session = data?.session??null; }catch(_){}
    sbAuth.onAuthStateChange((event, s)=>{
      if(event==='SIGNED_OUT'){ DB.sbUser=null; _cloudReady=false; _lastPushed=''; aplicarCleanSlate(); DB.authOpen=true; render(); }
      if(event==='SIGNED_IN' && s && !DB.sbUser){ _cloudLogin(s.user); }
    });
    if (session) {
      await _cloudLogin(session.user);
    } else {
      DB.authOpen = true;
      track('app_open');
      render();
    }
  })();
}

// Splash: some após o app montar
(function(){
  const sp = document.getElementById('splash');
  if (!sp) return;
  const hide = ()=>{ sp.classList.add('hide'); setTimeout(()=>sp.remove(), 600); };
  sp.addEventListener('click', hide);          // toque pula a splash
  setTimeout(hide, 1900);
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
        try{ render(); }catch(e){}
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
