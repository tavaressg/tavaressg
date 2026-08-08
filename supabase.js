/* ============================================================
   supabase.js — Adapter de dados (PROFESSOR.md §2, §6)
   ------------------------------------------------------------
   ÚNICO ponto de acoplamento entre o app (app.js) e o Supabase.
   Trocar de backend no futuro = reescrever só este arquivo.

   ⚠️ ESTADO ATUAL: DESLIGADO.
   SUPABASE_URL contém 'SEU_PROJETO' → o boot de app.js detecta isso
   ([app.js] guard `SUPABASE_URL.includes('SEU_PROJETO')`) e mantém o
   app em modo localStorage puro. Nada de rede, zero dependências.

   PARA LIGAR (cutover — ver supabase/README.md):
     1. Crie o projeto Supabase e rode supabase/migrations/0001_init.sql + seed.sql.
     2. Deploy da Edge Function create-student (+ secret SERVICE_ROLE_KEY).
     3. Preencha SUPABASE_URL e SUPABASE_ANON_KEY abaixo (sem 'SEU_PROJETO').
   index.html e sw.js JÁ carregam/cacheiam este adapter e a lib —
   basta preencher as credenciais.

   PRIVACIDADE (§4, cutover "nuvem total"): o diário completo do aluno
   (treinos, notas, sensação, anotações) sobe como documento JSONB para
   public.user_state — tabela com RLS ESTRITAMENTE self (nem o professor lê).
   As tabelas relacionais expõem ao professor apenas agregados objetivos
   (checkins, graduations, technique_progress, lesoes).
   ============================================================ */
(function (global) {
  'use strict';

  // >>> EDITAR na Fase 0. Manter 'SEU_PROJETO' mantém o app em modo local.
  let SUPABASE_URL = 'https://ckjggpudinmzyabxejlo.supabase.co';
  let SUPABASE_ANON_KEY = 'sb_publishable_WC-_mRqEDgj7z5LFuxSg0g_ykp_YqYJ';

  // STAGING (dev-only): em localhost dá p/ apontar o app pro projeto de staging SEM
  // editar este arquivo (editar credencial aqui arrisca deploy com env errado).
  // Console:  localStorage['yama.env'] = JSON.stringify({url:'https://REF.supabase.co', key:'sb_publishable_...'})
  // Voltar:   delete localStorage['yama.env']   — ver confidencial/supabase/STAGING.md.
  // Inerte em produção: gate por hostname (localhost/127.0.0.1).
  if (/^(localhost|127\.0\.0\.1)$/.test(global.location.hostname)) {
    try {
      const env = JSON.parse(global.localStorage.getItem('yama.env') || 'null');
      if (env && env.url && env.key) {
        SUPABASE_URL = env.url; SUPABASE_ANON_KEY = env.key;
        console.warn('[supabase.js] ambiente OVERRIDE ativo (staging):', env.url);
      }
    } catch (_) {}
  }

  const LIGADO = !SUPABASE_URL.includes('SEU_PROJETO');

  // Enquanto desligado: expõe só as constantes (placeholder) e SAI.
  // Não define SB nem sbAuth/sbSync/sbProf → app.js cai no ramo localStorage.
  global.SUPABASE_URL = SUPABASE_URL;
  global.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  if (!LIGADO) return;

  // A partir daqui só roda com credenciais reais. Requer @supabase/supabase-js
  // carregado antes (global.supabase.createClient).
  if (!global.supabase || !global.supabase.createClient) {
    console.error('[supabase.js] biblioteca @supabase/supabase-js não carregada — adapter inativo.');
    return;
  }
  const SB = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  global.SB = SB;

  // C1 (auditoria pré-lançamento): datas-CALENDÁRIO sempre LOCAIS do aparelho —
  // mesmo calendário do app (HOJE_ISO). toISOString() é UTC e virava o dia às
  // 21h no Brasil (UTC-3): check-in/mês/frequência caíam no dia seguinte.
  // Timestamps completos (updated_at etc.) seguem em ISO/UTC — são timestamptz.
  const _isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const HOJE = () => _isoLocal(new Date());
  const DB = () => global.DB; // estado do app (definido por app.js — expõe window.DB)

  // ---- Fotos de perfil (0007: bucket PRIVADO, leitura via signed URL) ----
  // profiles.foto_url guarda o PATH ('{uid}/profile.jpg'); URL legada é normalizada.
  const FOTO_TTL = 86400;   // 24h — pullAll/getAlunos reassinam a cada boot/load
  const _fotoPath = (v) => v ? String(v).replace(/^.*\/fotos\//, '').split('?')[0] : null;
  async function signFoto(v) {
    const path = _fotoPath(v); if (!path) return null;
    try {
      const { data } = await SB.storage.from('fotos').createSignedUrl(path, FOTO_TTL);
      return (data && data.signedUrl) || null;
    } catch (_) { return null; }
  }

  // ---- helpers de erro padronizados (§6: try/catch → toast) ----
  function wrap(fn) {
    return async function () {
      try { return await fn.apply(null, arguments); }
      catch (e) {
        try { global.toast && global.toast('Erro de rede: ' + (e.message || e)); } catch (_) {}
        throw e;
      }
    };
  }

  /* ========================================================
     sbAuth — autenticação
     ======================================================== */
  // Senha do login vive SÓ em memória (nunca persistida): o painel Auth exige
  // "require current password" no updateUser — o gate do 1º acesso a envia junto.
  let _loginPw = null;

  const sbAuth = {
    signIn: wrap(async (email, pw) => {
      const { data, error } = await SB.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      _loginPw = pw;
      return { user: data.user };
    }),
    // Não usado p/ aluno (professor cadastra via Edge Function). Mantido p/ contrato.
    signUp: wrap(async (email, pw) => {
      const { data, error } = await SB.auth.signUp({ email, password: pw });
      if (error) throw error;
      return { session: data.session, user: data.user };
    }),
    signOut: wrap(async () => { _loginPw = null; const { error } = await SB.auth.signOut(); if (error) throw error; }),
    resetPw: wrap(async (email) => {
      // v430 BUG: era `location.origin`, que é só esquema+host e NUNCA inclui o caminho.
      // O app mora em https://tavaressg.github.io/tavaressg/ — o link do e-mail levava a
      // https://tavaressg.github.io/, que devolve 404 "Site not found" do GitHub Pages.
      // O aluno clicava, caía no erro, e o evento PASSWORD_RECOVERY nunca chegava no app:
      // "Esqueci minha senha" não recuperava nada. `pathname` recompõe a URL do app e
      // funciona igual em produção (subpasta), em localhost e num domínio próprio.
      // ⚠️ Exige que essa URL esteja em Authentication → URL Configuration → Redirect URLs.
      const volta = global.location.origin + global.location.pathname;
      const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: volta });
      if (error) throw error;
    }),
    onAuthStateChange: (cb) => SB.auth.onAuthStateChange((event, session) => cb(event, session)),

    // P1: troca de senha no 1º login.
    mustChangePassword: wrap(async () => {
      const u = (await SB.auth.getUser()).data.user;
      if (!u) return false;
      const { data } = await SB.from('profiles').select('must_change_pw').eq('id', u.id).single();
      return !!(data && data.must_change_pw);
    }),
    // true = a senha do login desta sessão está em memória (não precisa pedir ao usuário).
    hasLoginPw: () => !!_loginPw,
    // currentPw explícito > stash do login. Sessão de recovery (link de e-mail) não tem
    // nenhum dos dois — segue sem current_password (o servidor dispensa nesse fluxo).
    changePassword: wrap(async (newPw, currentPw) => {
      const cur = currentPw || _loginPw;
      const attrs = { password: newPw };
      if (cur) attrs.current_password = cur;
      const { error } = await SB.auth.updateUser(attrs);
      if (error) throw error;
      _loginPw = null;
      // M-4: baixa must_change_pw pela RPC controlada — o guard bloqueia update direto da flag.
      const { error: e2 } = await SB.rpc('mark_password_changed');
      if (e2) throw e2;
    }),

    // MFA / TOTP (hardening) — recomendado para o PROFESSOR (conta de maior privilégio).
    // Contrato completo do adapter; a UI de ativação (mostrar QR + confirmar código no
    // Perfil do professor) é o passo restante, a construir/testar com o backend ligado.
    // Ativar TOTP no dashboard: Authentication → Providers → habilitar MFA (TOTP).
    mfa: {
      listFactors: wrap(async () => await SB.auth.mfa.listFactors()),
      enroll: wrap(async () => {
        const { data, error } = await SB.auth.mfa.enroll({ factorType: 'totp' });
        if (error) throw error;
        return data;   // { id, totp: { qr_code, secret, uri } }
      }),
      challengeAndVerify: wrap(async (factorId, code) => {
        const { data, error } = await SB.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        return data;
      }),
      unenroll: wrap(async (factorId) => {
        const { error } = await SB.auth.mfa.unenroll({ factorId });
        if (error) throw error;
      }),
      // AAL atual: 'aal1' (só senha) vs 'aal2' (senha + TOTP). Use p/ exigir 2FA em ações sensíveis.
      aal: wrap(async () => await SB.auth.mfa.getAuthenticatorAssuranceLevel()),
    },

    // LGPD — exclusão COMPLETA da própria conta (cascade no servidor via Edge Function).
    // Sem user_id no corpo → a função exclui o próprio caller. Depois o app faz signOut.
    deleteAccount: wrap(async () => {
      const { error } = await SB.functions.invoke('delete-student', { body: {} });
      if (error) throw error;
    }),
  };

  /* ========================================================
     sbSync — sincronização do estado do aluno
     • user_state (JSONB, RLS self-only): o diário COMPLETO — fonte da
       verdade dos dados privados após o cutover "nuvem total".
     • Tabelas objetivas: perfil, checkin do dia, graduações, lesões,
       progresso — o que o professor pode ler.
     ======================================================== */
  // Guard multi-dispositivo: updated_at do estado que este cliente carregou/gravou
  // por último. pushState só sobrescreve se a nuvem ainda estiver nessa base
  // (senão outro aparelho gravou → conflito, o app re-baixa e reaplica).
  let _stateTs = null;

  const sbSync = {
    // ---- Estado privado completo (cutover): documento JSONB por usuário ----
    // Via RPC atômica push_user_state (guard multi-dispositivo). Em conflito,
    // rejeita com err.conflict=true (o app resolve re-baixando o estado novo).
    pushState: wrap(async (dump) => {
      const d = DB(); if (!d || !d.sbUser || !dump) return;
      const { data, error } = await SB.rpc('push_user_state', { p_data: dump, p_base: _stateTs });
      if (error) {
        if (/state_conflict/.test(error.message || '') || /state_conflict/.test(error.details || '')) {
          const e = new Error('state_conflict'); e.conflict = true; throw e;
        }
        throw error;
      }
      _stateTs = data;   // novo updated_at vira a base
    }),
    pullState: wrap(async (userId) => {
      const { data, error } = await SB.from('user_state').select('data, updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      _stateTs = data ? data.updated_at : null;   // base do guard multi-dispositivo
      return data ? data.data : null;
    }),
    // Migração one-time do acervo legado (localStorage pré-cutover) → nuvem.
    // Só migra se a nuvem ainda estiver vazia; depois remove as chaves locais.
    migrateLegacy: wrap(async (userId) => {
      let raw = null, draft = null;
      try { raw = global.localStorage.getItem('yama.v1'); draft = global.localStorage.getItem('yama.draft'); } catch (_) { return false; }
      if (!raw) return false;
      const cloud = await sbSync.pullState(userId);
      if (!cloud) {
        let dump; try { dump = JSON.parse(raw); } catch (_) { return false; }
        if (draft) { try { dump.draft = JSON.parse(draft); } catch (_) {} }
        await sbSync.pushState(dump);
      }
      try { global.localStorage.removeItem('yama.v1'); global.localStorage.removeItem('yama.draft'); } catch (_) {}
      return true;
    }),

    // Retorna { hasProfile } — false quando o auth.users existe mas public.profiles
    // ainda não (dono recém-criado no painel, antes do bootstrap_academia). O app usa
    // isso para desviar pro wizard de 1º acesso em vez do onboarding normal.
    pullAll: wrap(async (userId) => {
      const d = DB(); if (!d) return { hasProfile: false };
      const [prof, grads, lesoes, prog] = await Promise.all([
        SB.from('profiles').select('*').eq('id', userId).maybeSingle(),
        SB.from('graduations').select('*').eq('user_id', userId).order('data'),
        SB.from('lesoes').select('*').eq('user_id', userId).order('data'),
        SB.from('technique_progress').select('*').eq('user_id', userId),
      ]);
      if (prof.data) {
        // 0007: foto_url é PATH — assina p/ exibir (fallback: base64 legado no dump)
        const fotoSigned = await signFoto(prof.data.foto_url);
        d.eu = Object.assign({}, d.eu, {
          apelido: prof.data.apelido || d.eu.apelido,
          nomeCompleto: prof.data.nome_completo || d.eu.nomeCompleto,
          faixa: prof.data.faixa || d.eu.faixa,
          graus: prof.data.graus ?? d.eu.graus,
          nascimento: prof.data.nascimento ?? (prof.data.nascimento_data ? +String(prof.data.nascimento_data).slice(0, 4) : d.eu.nascimento),
          nascData: prof.data.nascimento_data || d.eu.nascData || null,
          foto: fotoSigned || d.eu.foto,
          desde: prof.data.desde || d.eu.desde,
          role: prof.data.role,
          // capacidade do "Modo professor" (validada no servidor) — dono tem os mesmos
          // poderes de professor + pode criar professores (is_professor() no SQL cobre os dois).
          isProfessor: prof.data.role === 'professor' || prof.data.role === 'dono',
          provisionedByProf: true,  // conta criada pela academia → onboarding minimal + faixa/grau read-only
        });
        // Cutover: substitui o SEED (Prof. Ricardo Maciel / Yama) pelos dados reais.
        // Sem isso o cabeçalho da gestão saudava com o nome fictício do mock.
        d.professor = Object.assign({}, d.professor, {
          nome: prof.data.apelido || prof.data.nome_completo || d.professor.nome,
        });
        // Academia real (dono/professor lê a própria via RLS academies_read).
        // Também traz `config` — regras da academia (metaAulas por faixa etc.) — para o ALUNO
        // enxergar dinamicamente sua meta de aulas por faixa (aulasStats consulta DB.academyConfig).
        if (prof.data.academy_id) {
          try {
            const { data: acad } = await SB.from('academies')
              .select('nome, kanji, artes, config').eq('id', prof.data.academy_id).maybeSingle();
            if (acad) {
              d.academia = Object.assign({}, d.academia, {
                nome: acad.nome || d.academia.nome,
                kanji: acad.kanji || d.academia.kanji,
                artes: acad.artes || d.academia.artes,
              });
              d.academyConfig = acad.config || {};
            }
          } catch (_) {}
        }
        // Turma real da matrícula (enroll_read deixa o próprio aluno ler a sua).
        // Sem isso o Perfil mostrava o mock 'Adulto · Gi · 19h30' pra todo mundo.
        try {
          const { data: en } = await SB.from('enrollments')
            .select('turmas(nome, faixa_etaria)').eq('user_id', userId)
            .eq('status', 'ativo').limit(1).maybeSingle();
          const t = en && en.turmas;
          d.academia = Object.assign({}, d.academia, {
            turma: t ? (t.faixa_etaria ? `${t.nome} · ${t.faixa_etaria}` : t.nome) : null,
          });
        } catch (_) { d.academia = Object.assign({}, d.academia, { turma: null }); }
      }
      if (grads.data) d.graduacoes = grads.data.map(g => ({
        faixa: g.faixa, graus: g.graus, tipo: g.tipo, data: g.data, por: g.por || '—',
        // 0029: credito de presencas importado do app antigo. aulasStats() no lado
        // do aluno le desses campos pra mostrar "40/48" — sem isso o aluno vira o
        // proprio app depois do import e continua vendo 0/48.
        aulas_credito_grau: g.aulas_credito_grau || 0,
        aulas_credito_faixa: g.aulas_credito_faixa || 0,
      }));
      if (lesoes.data) d.lesoes = lesoes.data.map(l => ({ id: l.id, parte: l.parte, status: l.status, nota: l.nota, data: l.data }));
      // progresso objetivo aplica nas técnicas locais (sem sobrescrever a anotação privada local)
      if (prog.data && Array.isArray(d.tecnicas)) {
        const byId = {}; prog.data.forEach(p => { byId[p.tecnica_id] = p; });
        d.tecnicas.forEach(t => { const p = byId[t.id || t.jp]; if (p) { t.estado = p.estado; t.nivel = p.nivel; t.treinos = p.treinos; t.ultima = p.ultima; } });
      }
      // 0034: aulas no grau / na faixa — MESMA RPC que o painel do professor usa
      // (o escopo mora dentro da função: professor vê a academia, aluno vê a si).
      // É o único jeito de o aluno contar aulas distintas: `DB.treinos` é o diário
      // e não tem turma nem hora, então nunca soube separar 06:30 de 19:30.
      try {
        const { data: ag } = await SB.rpc('aulas_por_aluno');
        const r = (ag || []).find(x => x.o_user_id === userId) || (ag || [])[0] || null;
        d._aulasServidor = r ? {
          grau: r.o_aulas_grau || 0, faixa: r.o_aulas_faixa || 0,
          grauDesde: r.o_grau_desde || null, faixaDesde: r.o_faixa_desde || null,
          creditoGrau: r.o_credito_grau || 0, creditoFaixa: r.o_credito_faixa || 0,
        } : null;
      } catch (_) { d._aulasServidor = null; }   // RPC ausente (pré-0034) → fallback local
      // check-in de hoje (+ sessão escolhida, se houver)
      const { data: ci } = await SB.from('checkins').select('hora, turma_id, tipo').eq('user_id', userId).eq('data', HOJE()).maybeSingle();
      d.checkinHoje = ci
        ? { feito: true, hora: ci.hora, sessao: (ci.turma_id || ci.tipo) ? { turmaId: ci.turma_id, label: ci.tipo } : null }
        : { feito: false, hora: null };
      return { hasProfile: !!prof.data };
    }),

    // v306: check-in por AULA. Se sessão escolhida → upsert em aulas (turma,data,hora)
    // pra vincular aula_id; senão, insere sem aula_id (histórico legado). Dedup real
    // fica na UNIQUE (user_id, aula_id) partial da migration 0010.
    pushCheckin: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser || !d.checkinHoje || !d.checkinHoje.feito) return;
      const ses = d.checkinHoje.sessao || null;
      // v358: escrita self via RPC checkin_self_registrar (0024). O adapter não
      // insere mais em `checkins` / `aulas` direto — o servidor resolve aula_id
      // (que o aluno não tem policy pra criar), checa matrícula ativa na turma
      // e retorna duplicado: true quando o índice único da 0010 rejeita 2×.
      // Sem sessão (turma_id) não chama a RPC — check-in solto foi descontinuado.
      if (!ses || !ses.turmaId) return;
      try {
        const { error } = await SB.rpc('checkin_self_registrar', {
          p_turma_id:     ses.turmaId,
          p_data:         HOJE(),
          p_hora_aula:    ses.hora || null,
          p_hora_checkin: d.checkinHoje.hora,
          p_tipo:         ses.variacao || 'Aula',
        });
        if (error) throw error;
      } catch (e) {
        // Duplicata (mesma aula, 2×) a RPC devolve ok:true/duplicado:true, então
        // não cai aqui — se caiu, é erro de verdade (matrícula, janela de data etc).
        if (!(e && String(e.message||'').includes('duplicate'))) throw e;
      }
    }),

    // Grade da academia p/ o aluno (RLS deixa qualquer membro ler turmas/sessões).
    // Popula DB.turmas → alimenta sessoesDeHoje() no check-in.
    pullTurmas: wrap(async () => {
      const d = DB(); if (!d) return;
      const ts = await sbProf.getTurmas();
      if (Array.isArray(ts)) d.turmas = ts;
    }),

    // Matrícula(s) do próprio aluno — atualiza o rótulo "Turma" do Perfil com TODAS as
    // turmas (o pullAll do boot pega só a 1ª). Usado pelo popup de horários (v199).
    pullMatricula: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser) return;
      const { data } = await SB.from('enrollments')
        .select('turma_id, turmas(nome)').eq('user_id', d.sbUser.id).eq('status', 'ativo');
      const rows = data || [];
      d._minhasTurmasIds = rows.map(r => r.turma_id);
      const nomes = rows.map(r => r.turmas && r.turmas.nome).filter(Boolean);
      d.academia = Object.assign({}, d.academia, {
        turma: nomes.length ? nomes.join(' + ') : ((d.academia && d.academia.turma) || null),
      });
    }),

    pushProfile: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser) return;
      const e = d.eu || {};
      // 0022: faixa/graus são DERIVADOS de `graduations` (trigger graduations_sync).
      // Mandar aqui era um caminho de drift perfil×timeline — e o UPDATE dessas
      // colunas foi revogado de `authenticated`.
      // nome_completo é dono do cadastro (ficha do professor) — o aluno edita só o
      // apelido. Mandar nome_completo aqui deixava o self-push sobrescrever a ficha
      // com o que quer que estivesse em e.nomeCompleto no momento (drift silencioso).
      await SB.from('profiles').update({
        apelido: e.apelido,
        nascimento: e.nascimento, desde: e.desde,
      }).eq('id', d.sbUser.id);
    }),

    // Agregados OBJETIVOS de técnica (§3) — sem texto livre.
    // acerto_pct: taxa agregada dos 30 dias (t.dias) — auditoria M11: o cálculo
    // anterior usava hojeA/hojeT, que salvar() zera antes do push (sempre null).
    pushProgress: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser || !Array.isArray(d.tecnicas)) return;
      const rows = d.tecnicas
        .filter(t => t.estado && t.estado !== 'novo')
        .map(t => {
          const dias = t.dias || [];
          const T = dias.reduce((s, x) => s + (x.t || 0), 0);
          const A = dias.reduce((s, x) => s + (x.a || 0), 0);
          return {
            user_id: d.sbUser.id,
            tecnica_id: t.id || t.jp,
            estado: t.estado,
            nivel: t.nivel ?? null,
            treinos: t.treinos ?? 0,
            ultima: t.ultima || null,
            acerto_pct: T > 0 ? Math.round((A / T) * 100) : null,
            atualizado_em: new Date().toISOString(),
          };
        });
      if (rows.length) await SB.from('technique_progress').upsert(rows, { onConflict: 'user_id,tecnica_id' });
    }),

    // Lesões do aluno (RW próprio sob RLS). Estratégia delete+insert (volume pequeno):
    // idempotente, sem duplicar a cada push e propaga EXCLUSÕES (auditoria B9 —
    // o upsert anterior criava linha nova a cada push, pois os ids locais não são uuid).
    pushLesoes: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser || !Array.isArray(d.lesoes)) return;
      // Transacional (RPC replace_lesoes): delete+insert atômico — uma falha no
      // insert não deixa o aluno sem lesões visíveis ao professor (auditoria).
      const rows = d.lesoes.map(l => ({
        parte: l.parte || null, status: l.status || null, nota: l.nota || null, data: l.data || HOJE(),
      }));
      const { error } = await SB.rpc('replace_lesoes', { p_rows: rows });
      if (error) throw error;
    }),

    // A3: carrega o catálogo da loja do backend. A RLS já filtra por papel
    // (aluno só recebe produtos ativos; professor recebe todos p/ gerir os ocultos).
    pullLoja: wrap(async () => {
      const d = DB(); if (!d || !d.loja) return;
      const prods = await sbProf.getProdutos();
      // Autoritativo: o catálogo vem SÓ do backend. Assume mesmo array vazio, senão
      // o mock persistido no dump legado (loja ∈ USER_KEYS) voltava como loja-fantasma.
      if (Array.isArray(prods)) d.loja.produtos = prods;
    }),

    // v416 (migration 0031): catálogo de técnicas vem do banco. RLS entrega globais
    // (academy_id null status ativa) + da própria academia + as próprias pendentes.
    // PRESERVA `usr-*` que já estão em DB.tecnicas (vindas do dump — técnicas
    // customizadas do aluno vivem em tecnicasCustom via buildDump/applyDump).
    // Se o pull falhar (rede/backend), o array atual (seed hardcoded como fallback)
    // continua valendo — o app não fica sem catálogo.
    pullTecnicas: wrap(async () => {
      const d = DB(); if (!d) return;
      const { data, error } = await SB.from('techniques')
        .select('id,tradicao,familia,subfamilia,jp,pt,oficial,status,academy_id')
        .order('familia');
      if (error) throw error;
      // v418: preserva PROGRESSO por técnica (estado/dias/hojeA/etc). O pull acontece
      // DEPOIS do applyDump — antes dessa preservação, sobrescrever DB.tecnicas apagava
      // o `estado='foco'` que o aluno acabou de setar (bug: foco não persistia no reload).
      const progPrev = new Map((d.tecnicas || []).map(t => [t.id || t.jp, t]));
      const arr = (data || []).map(t => {
        const base = {
          id: t.id, jp: t.jp, pt: t.pt || '', cat: t.familia,
          sub: t.subfamilia || undefined, oficial: !!t.oficial,
          _status: t.status, _acad: t.academy_id,
        };
        const prev = progPrev.get(t.id) || progPrev.get(t.jp);
        if (prev) {
          // Só copia campos de PROGRESSO — cat/jp/pt/oficial vêm do banco (autoritativo)
          ['estado','dias','hojeA','hojeT','treinos','ultima','ultimaRev','nota','nivel']
            .forEach(f => { if (prev[f] != null) base[f] = prev[f]; });
        }
        return base;
      });
      // Preserva customizadas (usr-*) vindas do dump — o pull traz só as do banco.
      const custom = (d.tecnicas || []).filter(t => t.id && t.id.indexOf('usr-') === 0);
      d.tecnicas = arr.concat(custom);
    }),
    // Aluno propõe técnica nova → status='pendente' na própria academia. Só o
    // professor edita/aprova (RLS techniques_update_prof). Hook pra o item 3 do
    // plano (fluxo de validação); UI vai vir depois.
    proporTecnica: wrap(async ({ jp, cat, sub, pt }) => {
      const u = (await SB.auth.getUser()).data.user; if (!u) return null;
      const acad = await myAcademyId();
      const trad = ['nage','osaekomi','shime','kansetsu'].includes(cat) ? 'kodokan' : 'jiu-jitsu';
      const id = 'usr-' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'').slice(0, 12) : String(Date.now()));
      const { data, error } = await SB.from('techniques')
        .insert({ id, academy_id: acad, tradicao: trad, familia: cat, subfamilia: sub || null, jp, pt: pt || null, status: 'pendente', created_by: u.id })
        .select('id').single();
      if (error) throw error;
      return data && data.id;
    }),

    // Aluno registra o pedido (pendente) ao finalizar no WhatsApp. A baixa de estoque
    // só acontece quando o PROFESSOR confirma (RPC confirmar_pedido). itens: [{produto_id,nome,tam,qtd,preco}].
    // txid (0030): identificador curto p/ conciliar com o extrato do banco — mesmo
    // valor injetado no campo 62.05 do BR Code mostrado ao aluno.
    registrarPedido: wrap(async (itens, total, txid) => {
      const u = (await SB.auth.getUser()).data.user; if (!u) return null;
      const acad = await myAcademyId();
      const { data, error } = await SB.from('pedidos')
        .insert({ user_id: u.id, academy_id: acad, itens, total, status: 'pendente', canal: 'whatsapp', txid: txid || null })
        .select('id').single();
      if (error) throw error;
      return data && data.id;
    }),
    // Histórico de compras do PRÓPRIO aluno (RLS pedidos_self_rw já restringe).
    getMeusPedidos: wrap(async () => {
      const u = (await SB.auth.getUser()).data.user; if (!u) return [];
      const { data, error } = await SB.from('pedidos')
        .select('id,itens,total,status,canal,txid,criado_em')
        .eq('user_id', u.id).order('criado_em', { ascending: false }).limit(50);
      if (error) throw error;
      return (data || []).map(p => ({
        id: p.id, itens: Array.isArray(p.itens) ? p.itens : [], total: Number(p.total),
        status: (p.status === 'aberto' ? 'pendente' : p.status), canal: p.canal, txid: p.txid, criadoEm: p.criado_em,
      }));
    }),
    // Avisa o(s) professor(es)/dono da academia por push que o PIX foi pago (0030).
    // Best-effort: se falhar (push não configurado etc.), não deve travar o fluxo do aluno.
    notificarPedidoPago: wrap(async (pedidoId) => {
      const { error } = await SB.rpc('notificar_pedido_pago', { p_id: pedidoId });
      if (error) throw error;
    }),

    // Conveniência: dispara os pushes objetivos juntos.
    // M11 (auditoria): NÃO é mais chamado a cada save() — o save() sobe só o
    // user_state (1 request, com dirty-check no app). pushAll roda em momentos-chave:
    // login, onboarding concluído, treino salvo, perfil/lesão editados.
    pushAll: wrap(async () => {
      await Promise.all([sbSync.pushProfile(), sbSync.pushCheckin(), sbSync.pushProgress(), sbSync.pushLesoes()]);
    }),

    trackEvent: wrap(async (e, props) => {
      // Analytics viaja dentro do user_state (dump) — sem tabela dedicada. No-op.
      void e; void props;
    }),

    // Foto → Storage (bucket 'fotos', PRIVADO desde a 0007). Grava o PATH em
    // profiles.foto_url (o professor assina na leitura) e retorna uma signed URL
    // (24h) p/ exibição imediata. path: {user_id}/profile.jpg — policy "dono do prefixo".
    // Se o bucket não existir, cai no catch → o app mantém base64 no dump como fallback.
    uploadFoto: wrap(async (blob) => {
      const d = DB(); if (!d || !d.sbUser || !blob) return null;
      const path = `${d.sbUser.id}/profile.jpg`;
      const { error } = await SB.storage.from('fotos').upload(path, blob, {
        contentType: 'image/jpeg', upsert: true, cacheControl: '3600',
      });
      if (error) throw error;
      // 0007: persiste o PATH (URL assinada expira; path não). Best-effort — a foto
      // já subiu; se o update falhar, o próximo upload corrige.
      try { await SB.from('profiles').update({ foto_url: path }).eq('id', d.sbUser.id); } catch (_) {}
      return await signFoto(path);
    }),
    deleteFoto: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser) return;
      const path = `${d.sbUser.id}/profile.jpg`;
      await SB.storage.from('fotos').remove([path]);
      try { await SB.from('profiles').update({ foto_url: null }).eq('id', d.sbUser.id); } catch (_) {}
    }),

    // Observabilidade mínima: registra erros do cliente na tabela client_errors
    // (RLS insert-only). Best-effort — não pode falhar a UX.
    logError: wrap(async (msg, ctx) => {
      const d = DB(); if (!d || !d.sbUser) return;
      try {
        await SB.from('client_errors').insert({
          user_id: d.sbUser.id, msg: String(msg||'').slice(0, 500),
          ctx: (ctx==null?null:String(ctx).slice(0, 1000)),
          app_version: (global.APP_VERSION||null),
        });
      } catch (_) { /* silencioso — observabilidade não pode ferir a UX */ }
    }),
  };

  /* ========================================================
     sbProf — visão do professor (leitura agregada + escritas operacionais)
     ======================================================== */

  // Monta a linha de aluno no formato que profAlunos()/profPainel() esperam.
  function mapAluno(p, presHoraById, mensById) {
    const nm = p.apelido || p.nome_completo || '—';
    const ini = nm.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
    const mens = mensById[p.id];
    return {
      id: p.id, nm, ini, cor: corDoNome(nm),
      matricula: p.matricula ?? null,   // 0011: código sequencial por academia (UI formata 00042)
      foto: p.foto_url || null,   // §4 autoriza professor a ler foto do aluno (perfil visível)
      role: p.role || 'aluno',   // 'aluno' | 'professor' | 'dono' — badge na lista; KPIs contam só alunos
      faixa: p.faixa || 'branca', graus: p.graus || 0,
      // ano — usado p/ filtrar faixas por idade (CBJJ). v344: DERIVA da data completa
      // quando a coluna `nascimento` está vazia (a ficha não edita mais o ano solto).
      nascimento: p.nascimento ?? (p.nascimento_data ? +String(p.nascimento_data).slice(0, 4) : null),
      nascData: p.nascimento_data || null,   // data completa (opcional, migration 0002) — aniversariantes
      pres: presHoraById[p.id] || null,
      pago: mens ? mens.status : 'ok',
      mensValor: mens ? Number(mens.valor) : 0,
      mensVenc: mens && mens.venc ? mens.venc.slice(8, 10) + '/' + mens.venc.slice(5, 7) : '—',
      desde: p.desde || '—',
      // Status de atividade: null = segue a regra automática (90d sem treinar); 'ativo'/'inativo'
      // = override do professor. Ver 0023 e _statusAluno() em app.js.
      statusManual: p.status_manual || null,
      statusManualEm: p.status_manual_em || null,
      cad: cadFromProfile(p),   // ficha cadastral (detalhe do aluno)
    };
  }
  // monta a ficha (cad) que o app espera a partir das colunas do profiles
  function cadFromProfile(p) {
    if (!p) return null;
    return {
      nomeCompleto: p.nome_completo, email: p.email, nascimento: p.nascimento, telefone: p.telefone,
      endereco: { cep: p.cep, logradouro: p.logradouro, numero: p.numero, bairro: p.bairro, cidade: p.cidade, uf: p.uf },
      responsavel: { nome: p.resp_nome, telefone: p.resp_telefone, parentesco: p.resp_parentesco },
      dataInicio: p.data_inicio, obs: p.observacoes,
      // 0017: opt-OUT — default true no banco. `undefined` (perfil antigo em
      // cache) vira true; só um false explícito desliga. Antes era opt-in (0013).
      aceitaContato: p.aceita_contato !== false,
    };
  }
  function corDoNome(nm) {
    const cores = ['#e5392f', '#2f6fe5', '#2fa86a', '#c98a2f', '#7a4fe0', '#0d9488'];
    let h = 0; for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) | 0;
    return cores[Math.abs(h) % cores.length];
  }

  // Fase 1 — agregados de retenção/evolução (§7.1) calculados de checkins + graduations.
  // Fonte única: window.PROF_METAS (definido em app.js). Fallback = valores default.
  const _METAS = () => global.PROF_METAS || { META_MES:12, META_GRAU:40, RISCO_DIAS:14 };
  // v372: janelas historicas capadas na data em que a academia comecou no app
  // (2026-07-20). Compartilhado com app.js via window.APP_INICIO_ISO. Fallback pra
  // caso o adapter seja carregado sem o app (raro). Cap DINAMICO: quando N dias
  // caiba depois dessa data, o cap deixa de morder sozinho.
  const _APP_INICIO = (typeof window !== 'undefined' && window.APP_INICIO_ISO) || '2026-07-20';
  const _diasAtras = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    const iso = _isoLocal(d);
    return iso < _APP_INICIO ? _APP_INICIO : iso;
  };
  let _alunosMemo = { t: 0, data: null };   // M6: evita 2ª query no getKPIs (cache curto)
  let _relMemo = { t: 0, data: null };      // relatórios agregados (cache 30s, mesmo ritmo do _loadProfData)

  const sbProf = {
    getAlunos: wrap(async () => {
      if (_alunosMemo.data && Date.now() - _alunosMemo.t < 4000) return _alunosMemo.data;
      const acad = await myAcademyId(); if (!acad) return [];
      // 120d: cobre as 16 semanas do cálculo de tendência de queda (freq4 vs base4)
      const hojeISO = HOJE(), mes = mesAtual(), d120 = _diasAtras(120);
      const [profs, hoje, mens, ckAll, grads, enrolls, aulasRpc] = await Promise.all([
        // Todos os usuários da academia (aluno + professor + dono). O papel vai no
        // campo `role` de cada linha; os KPIs (getKPIs) contam todos.
        SB.from('profiles').select('*').eq('academy_id', acad).eq('ativo', true),
        // v435: traz a TURMA junto — o card "Check-ins de hoje" mostrava só nome/faixa/hora
        // e o professor não sabia de qual aula era a presença. `turmas(nome)` é o embed;
        // o cliente recebe achatado em `presTurma` logo abaixo.
        SB.from('checkins').select('user_id,hora,turma_id,turmas(nome)').eq('academy_id', acad).eq('data', hojeISO),   // M6: índice (academy_id,data)
        SB.from('mensalidades').select('user_id,valor,venc,status').eq('mes', mes),
        SB.from('checkins').select('user_id,data').eq('academy_id', acad).gte('data', d120),                 // M6
        SB.from('graduations').select('user_id,faixa,graus,tipo,data,aulas_credito_grau,aulas_credito_faixa').eq('academy_id', acad),               // M6 + v391 (credito 0029)
        // Matrículas ativas — popula a.turmas em cada aluno (a UI de Turmas usa isso)
        SB.from('enrollments').select('user_id,turma_id').eq('status', 'ativo'),
        // 0034: aulas no grau / na faixa contadas NO SERVIDOR. Mesma RPC que o app do
        // aluno chama pra si (o escopo mora dentro da função) — fim das duas contagens
        // em JS que divergiam. Sem janela de data: `count(*)` não trafega linha.
        SB.rpc('aulas_por_aluno'),
      ]);
      const presById = {}; (hoje.data || []).forEach(c => { presById[c.user_id] = c.hora || '✓'; });
      // v435: turmas do dia por aluno. `pres` continua STRING (hora) — exports, ordenação
      // e filtros dependem disso; a turma vai num campo novo. Set porque desde a v429 o
      // aluno pode ter mais de um check-in no mesmo dia (4 turmas ADULTO, por ex.).
      const presTurmaById = {};
      (hoje.data || []).forEach(c => {
        const nome = c.turmas && c.turmas.nome; if (!nome) return;
        (presTurmaById[c.user_id] || (presTurmaById[c.user_id] = new Set())).add(nome);
      });
      const mensById = {}; (mens.data || []).forEach(m => { mensById[m.user_id] = m; });
      // agrega check-ins por aluno (dias distintos + último). `dias` continua sendo
      // DIA distinto: alimenta freq (% do mês), diasSem e a tendência freq4/base4 —
      // métricas de regularidade, que não podem virar volume. Aulas no grau/faixa
      // saíram daqui pra RPC 0034 (contam por AULA, sem janela).
      const agg = {};
      (ckAll.data || []).forEach(c => {
        const a = agg[c.user_id] || (agg[c.user_id] = { dias: new Set(), last: null });
        a.dias.add(c.data); if (!a.last || c.data > a.last) a.last = c.data;
      });
      // 0034: { user_id → {grau, faixa, grauDesde, faixaDesde, creditoGrau, creditoFaixa} }
      const aulasByUser = {};
      ((aulasRpc && aulasRpc.data) || []).forEach(r => {
        aulasByUser[r.o_user_id] = {
          grau: r.o_aulas_grau || 0, faixa: r.o_aulas_faixa || 0,
          grauDesde: r.o_grau_desde || null, faixaDesde: r.o_faixa_desde || null,
          creditoGrau: r.o_credito_grau || 0, creditoFaixa: r.o_credito_faixa || 0,
        };
      });
      const gradByUser = {}; (grads.data || []).forEach(g => { (gradByUser[g.user_id] || (gradByUser[g.user_id] = [])).push(g); });
      const turmasByUser = {}; (enrolls.data || []).forEach(e => { (turmasByUser[e.user_id] || (turmasByUser[e.user_id] = [])).push(e.turma_id); });
      const out = (profs.data || []).map(p => {
        const base = mapAluno(p, presById, mensById);
        // v435: fora do mapAluno de propósito — não mexe na assinatura dele, que tem
        // outros chamadores. Array (não Set) pra sobreviver a JSON/estruturação.
        base.presTurma = presTurmaById[p.id] ? [...presTurmaById[p.id]] : null;
        base.turmas = turmasByUser[p.id] || [];   // ids das turmas matriculadas (UI de Turmas usa)
        const a = agg[p.id];
        base.diasSem = (a && a.last) ? Math.max(0, Math.round((new Date(hojeISO) - new Date(a.last)) / 86400000)) : 999;
        const diasMes = a ? [...a.dias].filter(d => d.slice(0, 7) === mes).length : 0;
        base.freq = Math.min(100, Math.round(diasMes / _METAS().META_MES * 100));
        // aulas desde o início do grau/faixa atual → apto a graduar (aprox.)
        const gs = gradByUser[p.id] || [];
        // v345: a TIMELINE é a fonte da verdade da graduação. Sem nenhum evento, o
        // aluno é "não graduado" — a lista mostra isso em vez de uma faixa branca lisa
        // que ninguém registrou. (profiles.faixa segue como valor técnico.)
        base.semGrad = gs.length === 0;
        // 0034: âncoras, créditos e contagens vêm da RPC `aulas_por_aluno` — o MESMO
        // SQL que o app do aluno chama pra si. Antes isso era ~30 linhas de JS aqui e
        // outras ~20 no app.js (`aulasStats`), que contavam DIAS distintos dentro da
        // janela de 120d; agora é `count(*)` de check-ins (1 linha = 1 aula) sem janela.
        // Aluno com 4 turmas ADULTO no mesmo dia conta 4, não 1.
        const ag = aulasByUser[p.id] || null;
        base.aulasNoGrau   = ag ? ag.grau : null;      // null = RPC indisponível → UI mostra '—'
        base.creditoGrau   = ag ? ag.creditoGrau : 0;
        base.grauDesde     = ag ? ag.grauDesde : null;
        base.aulasNaFaixa  = ag ? ag.faixa : null;
        base.creditoFaixa  = ag ? ag.creditoFaixa : 0;
        base.faixaDesde    = ag ? ag.faixaDesde : null;
        base.aptoGrad      = ag ? (ag.grau >= _METAS().META_GRAU) : false;
        // Tendência de queda (risco v2): dias treinados nas últimas 4 semanas vs a média
        // por 4 semanas do trimestre anterior (semanas 5–16). Queda ≥50% = sinal de churn.
        if (a) {
          const dias = [...a.dias];
          const d28 = _diasAtras(28);
          base.freq4 = dias.filter(x => x >= d28).length;
          base.base4 = Math.round(dias.filter(x => x < d28).length / 3 * 10) / 10;
        } else { base.freq4 = 0; base.base4 = 0; }
        return base;
      });
      // 0007: foto_url é PATH e o bucket é privado — assina em LOTE p/ o roster
      // (policy fotos_prof_read). Nunca deixa path cru em a.foto (o <img> quebraria).
      const paths = [...new Set(out.map(a => _fotoPath(a.foto)).filter(Boolean))];
      if (paths.length) {
        try {
          const { data: signed } = await SB.storage.from('fotos').createSignedUrls(paths, FOTO_TTL);
          const byPath = {}; (signed || []).forEach(s => { if (s.signedUrl) byPath[s.path] = s.signedUrl; });
          out.forEach(a => { a.foto = a.foto ? (byPath[_fotoPath(a.foto)] || null) : null; });
        } catch (_) { out.forEach(a => { a.foto = null; }); }
      }
      _alunosMemo = { t: Date.now(), data: out };
      return out;
    }),

    getKPIs: wrap(async () => {
      const acad = await myAcademyId(); const mes = mesAtual();
      const [alunos, ckMes, errs] = await Promise.all([
        sbProf.getAlunos(),   // memoizado (M6) — não refaz as 5 queries
        SB.from('checkins').select('id', { count: 'exact', head: true }).eq('academy_id', acad).gte('data', mes + '-01'),
        // Observabilidade: erros de app nas últimas 24h (client_errors; a RLS já limita
        // a leitura ao professor da academia). Timestamp completo → ISO/UTC (C1 só vale p/ data-calendário).
        SB.from('client_errors').select('id', { count: 'exact', head: true })
          .gte('criado_em', new Date(Date.now() - 86400000).toISOString()),
      ]);
      const soAlunos = alunos;   // conta todo cadastro ativo (aluno, professor, dono) — bate com a lista de Alunos
      const presentes = soAlunos.filter(a => a.pres).length;
      const ativos = soAlunos.filter(a => (a.diasSem ?? 999) <= _METAS().RISCO_DIAS).length;   // treinou nos últimos 14d
      const receitaMes = soAlunos.filter(a => a.pago === 'ok').reduce((s, a) => s + (a.mensValor || 0), 0);
      return {
        total: soAlunos.length,
        ativos,
        treinosTotal: ckMes.count || 0,   // check-ins no mês (toda a academia)
        shares: 0, erros: errs.count || 0,
        receitaMes,
      };
    }),

    // Trilha administrativa (admin_audit, 0008) — quem fez o quê na gestão.
    // RLS (admin_audit_prof_read) limita à academia do caller; append-only.
    getAuditoria: wrap(async () => {
      const { data } = await SB.from('admin_audit')
        .select('actor_nome, action, alvo_nome, detail, criado_em')
        .order('criado_em', { ascending: false }).limit(50);
      return data || [];
    }),

    // Observabilidade: últimos erros de app (client_errors, 24h) — sheet do alerta no
    // painel do professor. RLS (client_errors_prof_read) limita à academia do caller.
    getErros: wrap(async () => {
      const { data } = await SB.from('client_errors')
        .select('msg, contexto, app_version, criado_em')
        .gte('criado_em', new Date(Date.now() - 86400000).toISOString())
        .order('criado_em', { ascending: false }).limit(50);
      return data || [];
    }),

    getAlunoDetalhe: wrap(async (id) => {
      const [prof, freq, grads, lesoes, prog, notas] = await Promise.all([
        SB.from('profiles').select('*').eq('id', id).single(),
        // v363: traz o nome da turma junto (histórico de presenças exibia só "Aula" fixo).
        // v426: traz aulas(hora) junto — `checkins.hora` é QUANDO foi registrado
        // (22:33 = professor marcando), não o horário da aula (19:30). O histórico
        // precisa do horário da AULA pra distinguir 2 aulas no mesmo dia.
        SB.from('checkins').select('id,data,tipo,hora,turma_id,turmas(nome),aulas(hora)').eq('user_id', id).order('data', { ascending: false }).limit(90),
        SB.from('graduations').select('*').eq('user_id', id).order('data'),
        SB.from('lesoes').select('*').eq('user_id', id).order('data', { ascending: false }),
        SB.from('technique_progress').select('*').eq('user_id', id), // objetivo, sem privado
        // Observações pedagógicas do professor (member_notes, migration 0002). Se a
        // tabela ainda não existir, o Promise.all não pode falhar → catch local.
        SB.from('member_notes').select('id,autor,texto,criado_em').eq('user_id', id)
          .order('criado_em', { ascending: false }).then(r => r).catch(() => ({ data: [] })),
      ]);
      // Achata turmas(nome) → turmaNome (o cliente não conhece o shape do embed).
      const frequencia = (freq.data || []).map(c => ({
        id: c.id, data: c.data, hora: c.hora, tipo: c.tipo,
        // horaAula = horário da AULA (19:30). `hora` fica como registro (22:33) —
        // a UI mostra horaAula e cai em `hora` só quando não há aula vinculada.
        horaAula: (c.aulas && c.aulas.hora) || null,
        turmaId: c.turma_id, turmaNome: (c.turmas && c.turmas.nome) || null,
      }));
      return { perfil: prof.data, cad: cadFromProfile(prof.data),
        frequencia, graduacoes: grads.data || [],
        lesoes: lesoes.data || [], progresso: prog.data || [],
        notas: (notas && notas.data) || [] };
    }),

    // v428: `lancarPresenca`/`removerPresenca` deletados. Sem chamador desde a v292
    // (que tirou o lançamento manual da ficha) e quebrados desde a 0027: o insert não
    // populava `aula_id`, e a constraint `checkins_fato` o exige. Escrita de presença
    // é só `marcarPresencaLote`; remoção, `removerPresencaBatch`/`removerCheckinId`.
    // v305: apaga um check-in específico do batch (clique errado no aluno).
    // Prefere aula_id real (turma+data+hora); cai em legado (turma+data sem aula_id).
    removerPresencaBatch: wrap(async (userId, turmaId, data, horaAula) => {
      let aulaId = null;
      try {
        let q = SB.from('aulas').select('id').eq('turma_id', turmaId).eq('data', data);
        q = horaAula ? q.eq('hora', horaAula) : q.is('hora', null);
        const { data: found } = await q.maybeSingle();
        if (found) aulaId = found.id;
      } catch (_) { /* segue p/ fallback legado */ }
      if (aulaId) {
        const { error } = await SB.from('checkins').delete().eq('user_id', userId).eq('aula_id', aulaId);
        if (error) throw error;
        return;
      }
      const { error } = await SB.from('checkins').delete().eq('user_id', userId).eq('turma_id', turmaId).eq('data', data).is('aula_id', null);
      if (error) throw error;
    }),

    // v305: apaga um check-in pelo id (histórico da ficha do aluno).
    removerCheckinId: wrap(async (checkinId) => {
      const { error } = await SB.from('checkins').delete().eq('id', checkinId);
      if (error) throw error;
    }),

    // Config da academia (academies.config, 0003) — 1º uso: meta de aulas por faixa
    getConfig: wrap(async () => {
      const acad = await myAcademyId(); if (!acad) return {};
      const { data } = await SB.from('academies').select('config').eq('id', acad).maybeSingle();
      return (data && data.config) || {};
    }),
    salvarConfig: wrap(async (cfg) => {
      const acad = await myAcademyId(); if (!acad) throw new Error('sem academia');
      const { error } = await SB.from('academies').update({ config: cfg || {} }).eq('id', acad);
      if (error) throw error;
    }),

    graduarAluno: wrap(async (id, faixa, graus, tipo, por, data) => {
      // M3: graduação atômica (insert + update) via RPC — evita estado parcial.
      // C1: envia a data LOCAL do aparelho (current_date do servidor é UTC).
      // data opcional = graduação RETROATIVA (histórico) — exige a 0003 no banco.
      const { error } = await SB.rpc('graduar_aluno', { p_user: id, p_faixa: faixa, p_graus: graus, p_tipo: tipo, p_por: por, p_data: data || HOJE() });
      if (error) throw error;
    }),

    criarAluno: wrap(async (dados) => {
      const { data, error } = await SB.functions.invoke('create-student', { body: dados });
      if (error) {
        // v307: supabase-js embrulha non-2xx em FunctionsHttpError com mensagem
        // genérica ("non-2xx status code"); o código real ({error:"rate_limited"})
        // vive em error.context. Sem extrair, a importação em lote não consegue
        // distinguir limite-por-hora de e-mail repetido — mesmo padrão do excluirAluno.
        let code = null;
        try { const body = await error.context.json(); code = body && body.error; }
        catch (_) { /* corpo não-JSON — mantém a mensagem crua */ }
        if (code) { const e = new Error(code); e.code = code; throw e; }
        throw error;
      }
      _alunosMemo = { t: 0, data: null };   // M4: invalida o memo p/ o novo aluno aparecer na lista
      return data; // { ok, user_id, email, senha_provisoria, warnings }
    }),

    // Exclui um aluno da academia (LGPD/gestão) via Edge Function — cascade no servidor.
    // Quando o backend retorna non-2xx, supabase-js embrulha em FunctionsHttpError e o corpo
    // (ex.: { error: "forbidden_delete_professor" }) vive em error.context. Extraímos p/ dar
    // uma mensagem clara em vez do genérico "Edge Function returned a non-2xx status code".
    excluirAluno: wrap(async (id) => {
      const { data, error } = await SB.functions.invoke('delete-student', { body: { user_id: id } });
      if (error) {
        let code = null;
        try { const body = await error.context.json(); code = body && body.error; }
        catch (_) { /* corpo não-JSON — mantém a mensagem crua */ }
        if (code) { const e = new Error(code); e.code = code; throw e; }
        throw error;
      }
      _alunosMemo = { t: 0, data: null };   // some da lista no próximo getAlunos
      return data; // { ok, deleted }
    }),

    // v308: aplica UMA senha padrão a todos os alunos que NUNCA acessaram.
    // A senha provisória individual só aparece uma vez, no retorno do cadastro —
    // na importação em lote ela se perde e o professor fica sem como dar acesso.
    // `dryRun` só conta/lista (usado pra montar a tela antes de aplicar).
    // Quem JÁ acessou nunca é tocado: trocar a senha de conta em uso é sequestro.
    senhaPadraoLote: wrap(async (senha, dryRun) => {
      const { data, error } = await SB.functions.invoke('senha-padrao', { body: { senha, dry_run: !!dryRun } });
      if (error) {
        let code = null;
        try { const b = await error.context.json(); code = b && (b.detail || b.error); }
        catch (_) { /* corpo não-JSON */ }
        if (code) { const e = new Error(code); e.code = code; throw e; }
        throw error;
      }
      return data;   // { ok, aplicadas, falhas, alunos:[{id,email,nome}] }
    }),

    // Atualiza a ficha cadastral de um aluno existente (sob RLS de professor da academia).
    atualizarAluno: wrap(async (id, campos) => {
      const { error } = await SB.from('profiles').update(campos).eq('id', id);
      if (error) throw error;
    }),

    // Status de atividade (0023): valor 'ativo'|'inativo'|null (null = volta a seguir a
    // regra automática de 90d). O carimbo de data/hora é do servidor (trigger), não daqui.
    setStatusAluno: wrap(async (id, valor) => {
      const { error } = await SB.from('profiles').update({ status_manual: valor }).eq('id', id);
      if (error) throw error;
    }),

    setMensalidade: wrap(async (id, status) => {
      const { error } = await SB.from('mensalidades').upsert({ user_id: id, status, mes: mesAtual() }, { onConflict: 'user_id,mes' });
      if (error) throw error;
    }),

    // ===== Fase B — Professores + Turmas (gestão 100% pelo app) =====
    // Dono cria professor (Edge Function service-role: auth user + profile role='professor').
    criarProfessor: wrap(async (dados) => {
      const { data, error } = await SB.functions.invoke('create-professor', { body: dados });
      if (error) throw error;
      return data; // { ok, user_id, email, senha_provisoria, warnings }
    }),
    // Promove um ALUNO existente a professor (preserva user_id/histórico). Só o dono.
    promoverProfessor: wrap(async (userId) => {
      const { data, error } = await SB.functions.invoke('promote-professor', { body: { user_id: userId } });
      if (error) throw error;
      _alunosMemo = { t: 0, data: null };   // sai da lista de alunos no próximo getAlunos
      return data; // { ok, user_id }
    }),
    // Bootstrap do 1º acesso do dono: cria academia + profile 'dono' (substitui o seed.sql). Gated no servidor.
    bootstrapAcademia: wrap(async (nome, kanji, artes, apelido) => {
      const { data, error } = await SB.rpc('bootstrap_academia', { p_nome: nome, p_kanji: kanji || null, p_artes: artes || null, p_apelido: apelido || null });
      if (error) throw error;
      return data; // academy_id (uuid)
    }),
    // Turmas (grupo) + sessões → shape do app: {id, nome, faixaEtaria, cor, sessoes:[{id,dia,hora,variacao,bilingue}]}
    getTurmas: wrap(async () => {
      const acad = await myAcademyId(); if (!acad) return [];
      // 0012: capacidade_max/duracao_min/instrutor_id fazem round-trip completo —
      // sem eles no select, salvar turma "perdia" capacidade e duração na recarga.
      const [tR, sR] = await Promise.all([
        SB.from('turmas').select('id,nome,faixa_etaria,cor,ativo,capacidade_max').eq('academy_id', acad).eq('ativo', true),
        SB.from('turma_sessoes').select('id,turma_id,dia,hora,variacao,bilingue,duracao_min,instrutor_id').eq('academy_id', acad).eq('ativo', true),
      ]);
      const sesByTurma = {};
      (sR.data || []).forEach(s => { (sesByTurma[s.turma_id] || (sesByTurma[s.turma_id] = [])).push({ id: s.id, dia: s.dia, hora: s.hora, variacao: s.variacao || undefined, bilingue: s.bilingue || undefined, duracao_min: s.duracao_min || 60, instrutor_id: s.instrutor_id || undefined }); });
      return (tR.data || []).map(t => ({ id: t.id, nome: t.nome, faixaEtaria: t.faixa_etaria || '', cor: t.cor, capacidade_max: t.capacidade_max || null, sessoes: sesByTurma[t.id] || [] }));
    }),
    // Cria/edita uma turma + substitui suas sessões (delete+insert sob RLS de professor/dono).
    salvarTurma: wrap(async (t) => {
      const acad = await myAcademyId();
      // 0012: capacidade_max opcional (heatmap de ocupação)
      const row = { academy_id: acad, nome: t.nome, faixa_etaria: t.faixaEtaria || null, cor: t.cor || null, ativo: true, capacidade_max: t.capacidade_max || null };
      let turmaId = (typeof t.id === 'string' && t.id.length >= 32) ? t.id : null;
      // Erros checados em TODOS os passos: um schema desatualizado precisa abortar AQUI,
      // antes do delete das sessões (incidente 2026-07-23: 0012 ausente apagou os horários).
      if (turmaId) { const { error: eU } = await SB.from('turmas').update(row).eq('id', turmaId); if (eU) throw eU; }
      else { const { data, error: eI } = await SB.from('turmas').insert(row).select('id').single(); if (eI) throw eI; turmaId = data && data.id; }
      if (!turmaId) throw new Error('turma sem id');
      const { error: eD } = await SB.from('turma_sessoes').delete().eq('turma_id', turmaId);
      if (eD) throw eD;
      // 0012: sessão com duracao_min + instrutor_id (opcionais, default 60min / sem instrutor)
      const rows = (t.sessoes || []).map(s => ({
        turma_id: turmaId, academy_id: acad, dia: s.dia, hora: s.hora,
        variacao: s.variacao || null, bilingue: !!s.bilingue, ativo: true,
        duracao_min: s.duracao_min || 60, instrutor_id: s.instrutor_id || null,
      }));
      if (rows.length) { const { error: eS } = await SB.from('turma_sessoes').insert(rows); if (eS) throw eS; }
      return turmaId;
    }),
    // 0010: batch check-in por AULA. Cria/reusa aula por (turma,data,hora) e
    // insere check-ins de vários alunos em transação (RPC no backend).
    // 0010a v3: retorna {criados, ignorados} pra o UI mostrar quantos entraram
    // e quantos foram ignorados (aluno já tinha check-in do dia). Se o backend
    // ainda estiver na v2 (int simples), o fallback interpreta como criados.
    marcarPresencaLote: wrap(async (turmaId, data, horaAula, userIds) => {
      const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const { data: r, error } = await SB.rpc('marcar_presenca_lote', {
        p_turma_id: turmaId, p_data: data,
        p_hora_aula: horaAula || null, p_hora_checkin: agora,
        p_user_ids: userIds || [],
      });
      if (error) throw error;
      if (r && typeof r === 'object') return r;   // { criados, ignorados }
      return { criados: r || 0, ignorados: 0 };
    }),
    // 0011: append em graduations. O trigger M3 já sincroniza profiles.faixa/graus
    // pra tipo 'faixa'/'grau'. Outros tipos (inicio/honra/retroativo) só registram
    // no histórico sem mudar a faixa atual — regra decidida no protótipo.
    salvarGraduacao: wrap(async (g) => {
      const acad = await myAcademyId();
      const { data: u } = await SB.auth.getUser();
      const row = {
        user_id: g.user_id, academy_id: acad,
        faixa: g.faixa, graus: g.graus || 0, tipo: g.tipo || 'grau',
        data: g.data, por: g.por || null, nota: g.nota || null,
        criado_por: u?.user?.id || null,
      };
      if (g.id) { const { error } = await SB.from('graduations').update(row).eq('id', g.id); if (error) throw error; return g.id; }
      const { data, error } = await SB.from('graduations').insert(row).select('id').single();
      if (error) throw error;
      return data && data.id;
    }),
    removerGraduacao: wrap(async (id) => {
      const { error } = await SB.from('graduations').delete().eq('id', id);
      if (error) throw error;
    }),
    // 0029: aplica credito de presencas legadas em lote. Recebe rows normalizadas
    // (email, dataAncora ISO, creditoGrau, creditoFaixa). Estrategia: pra cada
    // aluno acha o profile pelo email, acha a graduação MAIS RECENTE (ancora), e
    // faz UPDATE das colunas de credito. Se nao achar o aluno ou nao houver evento,
    // reporta skip — nunca cria linha nova (nao arriscamos mexer na linha do tempo).
    // Retorna { ok, skip:[msg], erro:[msg] } pra tela mostrar preview do resultado.
    importarCreditosPresencas: wrap(async (rows, origem) => {
      const acad = await myAcademyId(); if (!acad) throw new Error('sem academia');
      const stats = { ok: 0, skip: [], erro: [] };
      const origemTxt = origem || `import ${new Date().toISOString().slice(0, 10)}`;
      for (const row of rows || []) {
        const email = String(row.email || '').trim().toLowerCase();
        if (!email) { stats.skip.push(`(linha sem e-mail)`); continue; }
        try {
          const { data: profs, error: ep } = await SB.from('profiles')
            .select('id').eq('academy_id', acad).ilike('email', email).limit(2);
          if (ep) throw ep;
          if (!profs || !profs.length) { stats.skip.push(`${email}: aluno não encontrado`); continue; }
          if (profs.length > 1) { stats.skip.push(`${email}: e-mail duplicado`); continue; }
          const userId = profs[0].id;
          // Acha o evento MAIS RECENTE do aluno (a ancora usada pelo getAlunos)
          const { data: evts, error: eg } = await SB.from('graduations')
            .select('id,data,tipo,faixa,graus')
            .eq('user_id', userId)
            .order('data', { ascending: false })
            .order('id', { ascending: false })
            .limit(1);
          if (eg) throw eg;
          if (!evts || !evts.length) { stats.skip.push(`${email}: sem evento de graduação`); continue; }
          const { error: eu } = await SB.from('graduations').update({
            aulas_credito_grau: Math.max(0, row.creditoGrau | 0),
            aulas_credito_faixa: Math.max(0, row.creditoFaixa | 0),
            credito_origem: origemTxt,
          }).eq('id', evts[0].id);
          if (eu) throw eu;
          stats.ok++;
        } catch (e) {
          stats.erro.push(`${email}: ${e.message || e}`);
        }
      }
      _alunosMemo = { t: 0, data: null };   // invalida cache — proximo getAlunos ve os creditos
      return stats;
    }),
    deletarTurma: wrap(async (id) => {
      // Soft-delete: preserva histórico de presenças/matrículas ligadas à turma.
      // getTurmas já filtra por ativo=true (não reaparece na UI).
      // Também desativa as sessões pra sumir da grade semanal.
      const { error: eT } = await SB.from('turmas').update({ ativo: false }).eq('id', id);
      if (eT) throw eT;
      const { error: eS } = await SB.from('turma_sessoes').update({ ativo: false }).eq('turma_id', id);
      if (eS) throw eS;
    }),

    // v376/0028: gestão de push pelo professor.
    // Lista quem tem push ativo na academia (só metadata — chaves crypto ficam privadas).
    getPushSubs: wrap(async () => {
      const { data, error } = await SB.rpc('push_subs_academia');
      if (error) throw error;
      return (data || []).map(r => ({ userId: r.o_user_id, criadoEm: r.o_criado_em, userAgent: r.o_user_agent }));
    }),
    // Dispara push tipo 'teste' pra um aluno específico. Retorno: {ok, motivo?}
    enviarPushTeste: wrap(async (userId) => {
      const { data, error } = await SB.rpc('enviar_push_teste', { p_user_id: userId });
      if (error) throw error;
      return data || { ok: true };
    }),

    // ===== Matrícula aluno↔turma (enrollments) — fecha o "passo 2-backend" =====
    // A policy enroll_prof_write (0001) já autoriza professor/dono da academia.
    // matricular = ADITIVO (upsert das turmas passadas); desmatricular = remove uma.
    matricular: wrap(async (userId, turmaIds) => {
      const ids = (turmaIds || []).filter(Boolean);
      if (!ids.length) return;
      const rows = ids.map(t => ({ user_id: userId, turma_id: t, status: 'ativo' }));
      const { error } = await SB.from('enrollments').upsert(rows, { onConflict: 'user_id,turma_id' });
      if (error) throw error;
    }),
    desmatricular: wrap(async (userId, turmaId) => {
      const { error } = await SB.from('enrollments').delete().eq('user_id', userId).eq('turma_id', turmaId);
      if (error) throw error;
    }),
    // Sincroniza o CONJUNTO de turmas do aluno (ficha: chips multi-seleção) —
    // upsert das marcadas + delete das desmarcadas, num estado final consistente.
    sincronizarTurmas: wrap(async (userId, turmaIds) => {
      const alvo = new Set((turmaIds || []).filter(Boolean));
      const { data: atuais, error: e1 } = await SB.from('enrollments').select('turma_id').eq('user_id', userId);
      if (e1) throw e1;
      const tem = new Set((atuais || []).map(r => r.turma_id));
      const add = [...alvo].filter(t => !tem.has(t)).map(t => ({ user_id: userId, turma_id: t, status: 'ativo' }));
      const del = [...tem].filter(t => !alvo.has(t));
      if (add.length) { const { error } = await SB.from('enrollments').upsert(add, { onConflict: 'user_id,turma_id' }); if (error) throw error; }
      if (del.length) { const { error } = await SB.from('enrollments').delete().eq('user_id', userId).in('turma_id', del); if (error) throw error; }
    }),

    // ===== Relatórios agregados (§7.1) — matéria-prima objetiva, sem privado =====
    // checkins 120d (ocupação/tipo/coortes), graduations (tempo na faixa),
    // technique_progress (Camada 1 — RLS já limita à academia) e lesoes (agregado).
    getRelatorios: wrap(async () => {
      if (_relMemo.data && Date.now() - _relMemo.t < 30000) return _relMemo.data;
      const acad = await myAcademyId(); if (!acad) return null;
      const d120 = _diasAtras(120);
      const [ck, grads, prog, les] = await Promise.all([
        // aulas(hora) = hora AGENDADA da sessão (≠ checkins.hora, que é a hora que o
        // aluno bateu). É o que permite separar 2 horários da mesma turma no mesmo dia
        // (0010). Check-ins legados sem aula_id vêm com aulas=null → caem na média rateada.
        SB.from('checkins').select('user_id,data,hora,tipo,turma_id,aula_id,aulas(hora),turmas(nome)').eq('academy_id', acad).gte('data', d120),
        SB.from('graduations').select('user_id,faixa,graus,tipo,data').eq('academy_id', acad),
        SB.from('technique_progress').select('user_id,tecnica_id,estado,nivel,treinos,ultima,acerto_pct'),
        SB.from('lesoes').select('user_id,parte,status,data,nota'),
      ]);
      // achata aulas(hora) → aulaHora (o app não conhece o shape do embed)
      // 0025: turmaNome vem do JOIN (fonte única = FK), nunca de `tipo`. A coluna
      // `tipo` agora é só a VARIAÇÃO da sessão (NO-GI/LIVRE/…) ou 'Aula'.
      const checkins = (ck.data || []).map(c => ({
        user_id: c.user_id, data: c.data, hora: c.hora, tipo: c.tipo,
        turma_id: c.turma_id, aulaHora: (c.aulas && c.aulas.hora) || null,
        turmaNome: (c.turmas && c.turmas.nome) || null,
      }));
      const out = { checkins, graduacoes: grads.data || [], progresso: prog.data || [], lesoes: les.data || [] };
      _relMemo = { t: Date.now(), data: out };
      return out;
    }),

    // ===== Observações pedagógicas (member_notes, migration 0002) =====
    // Anotação do PROFESSOR sobre o aluno (gestão) — o aluno não tem policy de leitura.
    addNota: wrap(async (userId, texto, autor) => {
      const acad = await myAcademyId();
      const { data, error } = await SB.from('member_notes')
        .insert({ user_id: userId, academy_id: acad, texto: String(texto || '').slice(0, 1000), autor: autor || null })
        .select('id,autor,texto,criado_em').single();
      if (error) throw error;
      return data;
    }),
    delNota: wrap(async (id) => {
      const { error } = await SB.from('member_notes').delete().eq('id', id);
      if (error) throw error;
    }),

    // ===== A3 — Loja/Estoque (mapeia o shape do app ↔ produtos + produto_variantes) =====
    getProdutos: wrap(async () => {
      const acad = await myAcademyId(); if (!acad) return [];
      const [prodR, varR] = await Promise.all([
        SB.from('produtos').select('*').eq('academy_id', acad),
        SB.from('produto_variantes').select('*'),   // RLS limita à academia
      ]);
      const varsByProd = {};
      (varR.data || []).forEach(v => { (varsByProd[v.produto_id] || (varsByProd[v.produto_id] = [])).push(v); });
      return (prodR.data || []).map(p => _produtoToApp(p, varsByProd[p.id] || []));
    }),
    // Cria/edita um produto + suas variantes (estoque por tamanho). p no shape do app.
    salvarProduto: wrap(async (p) => {
      const acad = await myAcademyId();
      const row = { academy_id: acad, nome: p.nome, categoria: p.cat, preco: p.preco,
        emoji: p.emoji, cor: p.cor, descricao: p.desc, ativo: p.ativo !== false,
        img_url: p.img || null,      // 0003: foto principal
        img_urls: p.imgs || [] };    // 0004: fotos extras (galeria/carrossel)
      let prodId = (typeof p.id === 'string' && p.id.length >= 32) ? p.id : null;  // uuid = editar; senão criar
      if (prodId) {
        const { error: eU } = await SB.from('produtos').update(row).eq('id', prodId); if (eU) throw eU;
      } else {
        const { data, error: eI } = await SB.from('produtos').insert(row).select('id').single(); if (eI) throw eI;
        prodId = data && data.id;
      }
      if (!prodId) return null;
      // variantes: upsert por (produto_id, tamanho) e remove tamanhos que saíram
      const tams = p.tam || [];
      const rows = tams.map(t => ({ produto_id: prodId, tamanho: t, estoque: (p.estoque && p.estoque[t]) || 0 }));
      // estratégia simples: apaga as variantes e regrava (catálogo pequeno) — erros checados
      // p/ o delete nunca ficar órfão de um insert que falhou (mesma classe do incidente das turmas)
      const { error: eD } = await SB.from('produto_variantes').delete().eq('produto_id', prodId);
      if (eD) throw eD;
      if (rows.length) { const { error: eS } = await SB.from('produto_variantes').insert(rows); if (eS) throw eS; }
      return prodId;
    }),
    deletarProduto: wrap(async (id) => {
      const { error } = await SB.from('produtos').delete().eq('id', id);   // cascade apaga variantes/movimentos
      if (error) throw error;
    }),
    // Upload de foto do produto no bucket `produtos` (público-leitura, write só professor).
    // path: {academy_id}/{prodId|novo}/{ts}.jpg — retorna URL pública. Bucket precisa existir
    // no Supabase (public, RLS: SELECT * / INSERT/UPDATE/DELETE = professor da academia).
    uploadProdutoFoto: wrap(async (blob, prodId) => {
      const acad = await myAcademyId();
      const dir = (typeof prodId === 'string' && prodId.length >= 32) ? prodId : 'novo';
      const path = `${acad}/${dir}/${Date.now()}.jpg`;
      const { error } = await SB.storage.from('produtos').upload(path, blob, {
        contentType: blob.type || 'image/jpeg', upsert: false, cacheControl: '86400',
      });
      if (error) throw error;
      const { data } = SB.storage.from('produtos').getPublicUrl(path);
      return data && data.publicUrl;
    }),
    // Ajuste de estoque com auditoria (stock_movements).
    ajustarEstoque: wrap(async (varianteId, delta, motivo, por) => {
      const { data: v } = await SB.from('produto_variantes').select('estoque').eq('id', varianteId).single();
      const novo = Math.max(0, (v ? v.estoque : 0) + delta);
      await SB.from('produto_variantes').update({ estoque: novo }).eq('id', varianteId);
      await SB.from('stock_movements').insert({ variante_id: varianteId, delta, motivo, por });
    }),

    // ===== Pedidos (fila + baixa na confirmação — migration 0005) =====
    // Lista os pedidos da academia (mais recentes) + nome do cliente (join em profiles).
    getPedidos: wrap(async () => {
      const acad = await myAcademyId();
      const { data } = await SB.from('pedidos')
        .select('id,user_id,itens,total,status,canal,criado_em,txid, profiles(apelido,nome_completo,telefone)')
        .eq('academy_id', acad).order('criado_em', { ascending: false }).limit(200);
      return (data || []).map(p => ({
        id: p.id, itens: Array.isArray(p.itens) ? p.itens : [], total: Number(p.total),
        status: (p.status === 'aberto' ? 'pendente' : p.status), canal: p.canal, criadoEm: p.criado_em, txid: p.txid,
        cliente: p.profiles ? (p.profiles.apelido || p.profiles.nome_completo || '—') : '—',
        telefone: p.profiles ? (p.profiles.telefone || '') : '',   // v408: professor responde WhatsApp com msg pronta
      }));
    }),
    // Confirma o pedido → RPC baixa o estoque + audita + marca 'concluido' (atômico).
    confirmarPedido: wrap(async (id) => { const { error } = await SB.rpc('confirmar_pedido', { p_id: id }); if (error) throw error; }),
    // Cancela o pedido (sem baixa).
    cancelarPedido: wrap(async (id) => { const { error } = await SB.rpc('cancelar_pedido', { p_id: id }); if (error) throw error; }),
  };

  // Toda MUTAÇÃO (tudo que não é get*) invalida os memos e avisa a UI.
  // Sem isso, apagar uma presença só aparecia depois de recarregar o app — no
  // desktop era F5, no PWA obrigava a fechar e abrir. Um único ponto: cada write
  // já passa por aqui, então nenhum call site precisa lembrar de limpar cache.
  Object.keys(sbProf).forEach(k => {
    if (/^get/.test(k) || typeof sbProf[k] !== 'function') return;
    const fn = sbProf[k];
    sbProf[k] = async function () {
      const r = await fn.apply(this, arguments);
      _alunosMemo = { t: 0, data: null };
      _relMemo = { t: 0, data: null };
      try { global.onDadosMudaram && global.onDadosMudaram(); } catch (_) {}
      return r;
    };
  });

  // produtos(+variantes) → shape do app (tam[] + estoque{})
  function _produtoToApp(p, variantes) {
    const tam = [], estoque = {};
    (variantes || []).forEach(v => { tam.push(v.tamanho); estoque[v.tamanho] = v.estoque; });
    return { id: p.id, nome: p.nome, cat: p.categoria, preco: Number(p.preco), emoji: p.emoji,
      cor: p.cor, desc: p.descricao,
      img: p.img_url || null,                                                       // foto principal (compat)
      imgs: Array.isArray(p.img_urls) ? p.img_urls.filter(Boolean) : [],           // extras (0004)
      tam, estoque, ativo: p.ativo !== false };
  }

  async function myAcademyId() {
    const u = (await SB.auth.getUser()).data.user; if (!u) return null;
    const { data } = await SB.from('profiles').select('academy_id').eq('id', u.id).single();
    return data ? data.academy_id : null;
  }
  function mesAtual() { return HOJE().slice(0, 7); } // 'YYYY-MM' — C1: mês local, não UTC

  // Vídeos de onboarding — leitura/escrita da tabela academy_videos (0009).
  // Compartilhado entre professores da mesma academia (RLS na tabela).
  const sbVideos = {
    list: wrap(async () => {
      const { data } = await SB.from('academy_videos')
        .select('id, yt_id, title, is_short, ordem, publico_alvo')
        .eq('publico_alvo', 'branca_0')
        .order('ordem', { ascending: true });
      return (data || []).map(v => ({
        id: v.id, ytId: v.yt_id, title: v.title,
        isShort: !!v.is_short, ordem: v.ordem,
      }));
    }),
    add: wrap(async (ytId, title, isShort) => {
      // ordem = topo + 1 (aparece no fim; professor reordena depois)
      const { data: max } = await SB.from('academy_videos')
        .select('ordem').eq('publico_alvo', 'branca_0').order('ordem', { ascending: false }).limit(1);
      const ordem = ((max && max[0] && max[0].ordem) || 0) + 1;
      const { data, error } = await SB.from('academy_videos')
        .insert({ yt_id: ytId, title, is_short: !!isShort, ordem })
        .select().single();
      if (error) throw error;
      return { id: data.id, ytId: data.yt_id, title: data.title, isShort: !!data.is_short, ordem: data.ordem };
    }),
    update: wrap(async (id, patch) => {
      const p = {};
      if (patch.title != null) p.title = patch.title;
      if (patch.isShort != null) p.is_short = !!patch.isShort;
      if (patch.ordem != null) p.ordem = patch.ordem;
      const { error } = await SB.from('academy_videos').update(p).eq('id', id);
      if (error) throw error;
    }),
    delete: wrap(async (id) => {
      const { error } = await SB.from('academy_videos').delete().eq('id', id);
      if (error) throw error;
    }),
    // Reordenar em lote: recebe array de ids na ordem desejada; grava ordem 0..N-1.
    reorder: wrap(async (ids) => {
      if (!Array.isArray(ids) || !ids.length) return;
      // upsert em lote via patch individual (evita conflitos com unique/RLS)
      for (let i = 0; i < ids.length; i++) {
        await SB.from('academy_videos').update({ ordem: i }).eq('id', ids[i]);
      }
    }),
  };

  /* ========================================================
     sbPush — Web Push (0014). Aviso de check-in pendente.
     O cliente só registra/remove o PRÓPRIO aparelho: quem decide o que
     enviar é o cron no banco (enviar_avisos_checkin), nunca o app.
     Desativar = apagar a subscription; sem row, não há o que entregar.
     ======================================================== */
  const sbPush = {
    // Chave pública VAPID — pública por definição (vai no cliente).
    // Trocar aqui invalida todas as subscriptions existentes.
    VAPID_PUBLIC: 'BK-Bqte0ZY6fKKz_Y9wN0bp1e1g7SbgCjuzqnSoPgzQptnqTBccwHMvVPZ3WgPwKrsH1s_wgterUwsBZ6s_ItUE',

    suportado() {
      return typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
             typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
    },
    configurado() {
      return this.VAPID_PUBLIC && !this.VAPID_PUBLIC.startsWith('COLE_');
    },
    // base64url (formato VAPID) → Uint8Array (formato da PushManager API)
    _b64(base64) {
      const pad = '='.repeat((4 - base64.length % 4) % 4);
      const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    },

    async registrarSW() {
      if (!this.suportado()) return null;
      return navigator.serviceWorker.register('sw.js');
    },
    async estado() {
      if (!this.suportado()) return 'nao_suportado';
      if (Notification.permission === 'denied') return 'bloqueado';
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        return sub ? 'ativo' : 'inativo';
      } catch (_) { return 'inativo'; }
    },

    // Precisa ser chamado a partir de um clique do usuário (exigência do browser).
    ativar: wrap(async function () {
      if (!sbPush.suportado()) throw new Error('Este aparelho não suporta avisos');
      if (!sbPush.configurado()) throw new Error('Avisos ainda não configurados pela academia');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permissão de avisos negada');

      const reg = await sbPush.registrarSW();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: sbPush._b64(sbPush.VAPID_PUBLIC),
      });
      const j = sub.toJSON();
      const { data: u } = await SB.auth.getUser();
      if (!u?.user) throw new Error('sem sessão');
      const { error } = await SB.from('push_subscriptions').upsert({
        user_id: u.user.id,
        endpoint: j.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        user_agent: (navigator.userAgent || '').slice(0, 200),
        ultimo_erro: null,
      }, { onConflict: 'endpoint' });
      if (error) throw error;
      try { localStorage.setItem('yama.push.ativou', '1'); } catch (_) {}
      return true;
    }),

    desativar: wrap(async function () {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        const ep = sub.endpoint;
        try { await sub.unsubscribe(); } catch (_) {}
        await SB.from('push_subscriptions').delete().eq('endpoint', ep);
      }
      try { localStorage.removeItem('yama.push.ativou'); } catch (_) {}
      return true;
    }),

    // v378: auto-heal do zombie silencioso. Web Push é frágil — subscription pode
    // ser invalidada pelo provedor (APN/FCM) sem devolver 410 pra Edge, e a linha
    // no banco vira zumbi (aparelho não recebe mais nada, ninguém sabe). Este
    // método roda no boot pós-login e cobre 3 estados:
    //   - navegador tem sub + banco tem tudo ok → no-op.
    //   - navegador tem sub + banco NÃO conhece o endpoint → grava (pós-wipe).
    //   - navegador PERDEU a sub + aparelho já tinha ativado antes → re-inscreve.
    // Silencioso (retorno pra debug, sem toast pro usuário). Guard triplo:
    // suporte + permissão granted + flag "já ativou aqui" (localStorage), pra
    // não pedir permissão a quem nunca ligou.
    healSubscription: wrap(async function () {
      if (!sbPush.suportado()) return { ok: false, motivo: 'sem_suporte' };
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
        return { ok: false, motivo: 'sem_permissao' };
      }
      const { data: u } = await SB.auth.getUser();
      if (!u?.user) return { ok: false, motivo: 'sem_sessao' };
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return { ok: false, motivo: 'sem_sw' };
      const ua = (navigator.userAgent || '').slice(0, 200);
      let sub;
      try { sub = await reg.pushManager.getSubscription(); } catch (_) { sub = null; }

      if (sub) {
        // Navegador tem sub. Confirma que o banco a conhece; senão, grava.
        const { data: existente } = await SB.from('push_subscriptions')
          .select('id').eq('endpoint', sub.endpoint).maybeSingle();
        if (existente) return { ok: true, acao: 'ja_ok' };
        const j = sub.toJSON();
        const { error } = await SB.from('push_subscriptions').upsert({
          user_id: u.user.id, endpoint: j.endpoint,
          p256dh: j.keys.p256dh, auth: j.keys.auth,
          user_agent: ua, ultimo_erro: null,
        }, { onConflict: 'endpoint' });
        if (error) throw error;
        try { localStorage.setItem('yama.push.ativou', '1'); } catch (_) {}
        return { ok: true, acao: 'reencontrada' };
      }

      // Navegador não tem sub. Só re-inscreve se o aparelho JÁ ativou antes —
      // caso contrário virar aluno "empurrando" push sem consentimento explícito.
      let jaAtivou = false;
      try { jaAtivou = localStorage.getItem('yama.push.ativou') === '1'; } catch (_) {}
      if (!jaAtivou) return { ok: false, motivo: 'nunca_ativou' };

      let nova;
      try {
        nova = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: sbPush._b64(sbPush.VAPID_PUBLIC),
        });
      } catch (e) {
        // Provedor recusou (raro). Limpa a flag pra não retentar em loop no boot.
        try { localStorage.removeItem('yama.push.ativou'); } catch (_) {}
        return { ok: false, motivo: 'subscribe_falhou', erro: String(e && e.message || e) };
      }
      const j = nova.toJSON();
      const { error } = await SB.from('push_subscriptions').upsert({
        user_id: u.user.id, endpoint: j.endpoint,
        p256dh: j.keys.p256dh, auth: j.keys.auth,
        user_agent: ua, ultimo_erro: null,
      }, { onConflict: 'endpoint' });
      if (error) throw error;
      return { ok: true, acao: 'reinscreveu' };
    }),

    // Marca o aviso como lido (alimenta o backoff: 4 sem abrir → pausa 15 dias).
    marcarAberto: wrap(async () => {
      const { data: u } = await SB.auth.getUser();
      if (!u?.user) return;
      await SB.from('push_log').update({ aberto_em: new Date().toISOString() })
        .eq('user_id', u.user.id).is('aberto_em', null);
    }),
  };

  global.sbAuth = sbAuth;
  global.sbSync = sbSync;
  global.sbProf = sbProf;
  global.sbVideos = sbVideos;
  global.sbPush = sbPush;
})(window);
