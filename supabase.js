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
  const sbAuth = {
    signIn: wrap(async (email, pw) => {
      const { data, error } = await SB.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      return { user: data.user };
    }),
    // Não usado p/ aluno (professor cadastra via Edge Function). Mantido p/ contrato.
    signUp: wrap(async (email, pw) => {
      const { data, error } = await SB.auth.signUp({ email, password: pw });
      if (error) throw error;
      return { session: data.session, user: data.user };
    }),
    signOut: wrap(async () => { const { error } = await SB.auth.signOut(); if (error) throw error; }),
    resetPw: wrap(async (email) => {
      const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: global.location.origin });
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
    changePassword: wrap(async (newPw) => {
      const { error } = await SB.auth.updateUser({ password: newPw });
      if (error) throw error;
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
          nascimento: prof.data.nascimento ?? d.eu.nascimento,
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
      if (grads.data) d.graduacoes = grads.data.map(g => ({ faixa: g.faixa, graus: g.graus, tipo: g.tipo, data: g.data, por: g.por || '—' }));
      if (lesoes.data) d.lesoes = lesoes.data.map(l => ({ id: l.id, parte: l.parte, status: l.status, nota: l.nota, data: l.data }));
      // progresso objetivo aplica nas técnicas locais (sem sobrescrever a anotação privada local)
      if (prog.data && Array.isArray(d.tecnicas)) {
        const byId = {}; prog.data.forEach(p => { byId[p.tecnica_id] = p; });
        d.tecnicas.forEach(t => { const p = byId[t.id || t.jp]; if (p) { t.estado = p.estado; t.nivel = p.nivel; t.treinos = p.treinos; t.ultima = p.ultima; } });
      }
      // check-in de hoje (+ sessão escolhida, se houver)
      const { data: ci } = await SB.from('checkins').select('hora, turma_id, tipo').eq('user_id', userId).eq('data', HOJE()).maybeSingle();
      d.checkinHoje = ci
        ? { feito: true, hora: ci.hora, sessao: (ci.turma_id || ci.tipo) ? { turmaId: ci.turma_id, label: ci.tipo } : null }
        : { feito: false, hora: null };
      return { hasProfile: !!prof.data };
    }),

    pushCheckin: wrap(async () => {
      const d = DB(); if (!d || !d.sbUser || !d.checkinHoje || !d.checkinHoje.feito) return;
      const u = d.sbUser;
      const ses = d.checkinHoje.sessao || null;   // presença por sessão (escolhida no check-in)
      const [enrR, acad] = await Promise.all([
        SB.from('enrollments').select('turma_id').eq('user_id', u.id).limit(1).maybeSingle(),
        myAcademyId(),
      ]);
      // upsert idempotente por (user, data) — A5: dedup por dia. turma_id/tipo guardam a
      // sessão escolhida (senão a turma da matrícula) p/ analítica de presença por aula.
      const turmaId = (ses && ses.turmaId) || (enrR.data ? enrR.data.turma_id : null);
      await SB.from('checkins').upsert({
        user_id: u.id, academy_id: acad, turma_id: turmaId,
        // tipo = VARIAÇÃO da sessão ('No-Gi', 'Avançado', 'Livre'…) ou 'Aula' (regular).
        // Alimenta o relatório "Presença por tipo de aula" (§7.1-A).
        tipo: ses ? (ses.variacao || 'Aula') : null,
        data: HOJE(), hora: d.checkinHoje.hora, via: 'app',
      }, { onConflict: 'user_id,data' });
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
      await SB.from('profiles').update({
        apelido: e.apelido, nome_completo: e.nomeCompleto, faixa: e.faixa,
        graus: e.graus, nascimento: e.nascimento, desde: e.desde,
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

    // Aluno registra o pedido (pendente) ao finalizar no WhatsApp. A baixa de estoque
    // só acontece quando o PROFESSOR confirma (RPC confirmar_pedido). itens: [{produto_id,nome,tam,qtd,preco}].
    registrarPedido: wrap(async (itens, total) => {
      const u = (await SB.auth.getUser()).data.user; if (!u) return null;
      const acad = await myAcademyId();
      const { data, error } = await SB.from('pedidos')
        .insert({ user_id: u.id, academy_id: acad, itens, total, status: 'pendente', canal: 'whatsapp' })
        .select('id').single();
      if (error) throw error;
      return data && data.id;
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
      foto: p.foto_url || null,   // §4 autoriza professor a ler foto do aluno (perfil visível)
      role: p.role || 'aluno',   // 'aluno' | 'professor' | 'dono' — badge na lista; KPIs contam só alunos
      faixa: p.faixa || 'branca', graus: p.graus || 0,
      nascimento: p.nascimento ?? null,   // ano — usado p/ filtrar faixas por idade (CBJJ) na graduação
      nascData: p.nascimento_data || null,   // data completa (opcional, migration 0002) — aniversariantes
      pres: presHoraById[p.id] || null,
      pago: mens ? mens.status : 'ok',
      mensValor: mens ? Number(mens.valor) : 0,
      mensVenc: mens && mens.venc ? mens.venc.slice(8, 10) + '/' + mens.venc.slice(5, 7) : '—',
      desde: p.desde || '—',
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
  const _diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return _isoLocal(d); };   // C1: data local
  let _alunosMemo = { t: 0, data: null };   // M6: evita 2ª query no getKPIs (cache curto)
  let _relMemo = { t: 0, data: null };      // relatórios agregados (cache 30s, mesmo ritmo do _loadProfData)

  const sbProf = {
    getAlunos: wrap(async () => {
      if (_alunosMemo.data && Date.now() - _alunosMemo.t < 4000) return _alunosMemo.data;
      const acad = await myAcademyId(); if (!acad) return [];
      // 120d: cobre as 16 semanas do cálculo de tendência de queda (freq4 vs base4)
      const hojeISO = HOJE(), mes = mesAtual(), d120 = _diasAtras(120);
      const [profs, hoje, mens, ckAll, grads, enrolls] = await Promise.all([
        // Todos os usuários da academia (aluno + professor + dono). O papel vai no
        // campo `role` de cada linha; os KPIs (getKPIs) filtram só 'aluno'.
        SB.from('profiles').select('*').eq('academy_id', acad).eq('ativo', true),
        SB.from('checkins').select('user_id,hora').eq('academy_id', acad).eq('data', hojeISO),               // M6: índice (academy_id,data)
        SB.from('mensalidades').select('user_id,valor,venc,status').eq('mes', mes),
        SB.from('checkins').select('user_id,data').eq('academy_id', acad).gte('data', d120),                 // M6
        SB.from('graduations').select('user_id,faixa,graus,tipo,data').eq('academy_id', acad),               // M6
        // Matrículas ativas — popula a.turmas em cada aluno (a UI de Turmas usa isso)
        SB.from('enrollments').select('user_id,turma_id').eq('status', 'ativo'),
      ]);
      const presById = {}; (hoje.data || []).forEach(c => { presById[c.user_id] = c.hora || '✓'; });
      const mensById = {}; (mens.data || []).forEach(m => { mensById[m.user_id] = m; });
      // agrega check-ins por aluno (dias distintos + último)
      const agg = {};
      (ckAll.data || []).forEach(c => {
        const a = agg[c.user_id] || (agg[c.user_id] = { dias: new Set(), last: null });
        a.dias.add(c.data); if (!a.last || c.data > a.last) a.last = c.data;
      });
      const gradByUser = {}; (grads.data || []).forEach(g => { (gradByUser[g.user_id] || (gradByUser[g.user_id] = [])).push(g); });
      const turmasByUser = {}; (enrolls.data || []).forEach(e => { (turmasByUser[e.user_id] || (turmasByUser[e.user_id] = [])).push(e.turma_id); });
      const out = (profs.data || []).map(p => {
        const base = mapAluno(p, presById, mensById);
        base.turmas = turmasByUser[p.id] || [];   // ids das turmas matriculadas (UI de Turmas usa)
        const a = agg[p.id];
        base.diasSem = (a && a.last) ? Math.max(0, Math.round((new Date(hojeISO) - new Date(a.last)) / 86400000)) : 999;
        const diasMes = a ? [...a.dias].filter(d => d.slice(0, 7) === mes).length : 0;
        base.freq = Math.min(100, Math.round(diasMes / _METAS().META_MES * 100));
        // aulas desde o início do grau/faixa atual → apto a graduar (aprox.)
        const gs = gradByUser[p.id] || [];
        const ref = (p.graus > 0
          ? gs.filter(g => g.tipo === 'grau' && g.faixa === p.faixa && g.graus === p.graus)
          : gs.filter(g => g.tipo === 'faixa' && g.faixa === p.faixa)
        ).map(g => g.data).sort().pop() || gs.filter(g => g.tipo === 'faixa' && g.faixa === p.faixa).map(g => g.data).sort().pop();
        const aulasNoGrau = a ? (ref ? [...a.dias].filter(d => d >= ref).length : a.dias.size) : 0;
        base.aulasNoGrau = aulasNoGrau;   // exposto p/ o semáforo de graduação (relatórios)
        base.aptoGrad = aulasNoGrau >= _METAS().META_GRAU;
        // Data da faixa ATUAL (última graduação tipo 'faixa' dessa faixa) → eixo "tempo CBJJ"
        base.faixaDesde = gs.filter(g => g.tipo === 'faixa' && g.faixa === p.faixa).map(g => g.data).sort().pop() || null;
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
      const soAlunos = alunos.filter(a => a.role === 'aluno');   // KPIs de negócio contam só alunos
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
        .select('msg, app_version, criado_em')
        .gte('criado_em', new Date(Date.now() - 86400000).toISOString())
        .order('criado_em', { ascending: false }).limit(50);
      return data || [];
    }),

    getAlunoDetalhe: wrap(async (id) => {
      const [prof, freq, grads, lesoes, prog, notas] = await Promise.all([
        SB.from('profiles').select('*').eq('id', id).single(),
        SB.from('checkins').select('data,tipo,hora').eq('user_id', id).order('data', { ascending: false }).limit(90),
        SB.from('graduations').select('*').eq('user_id', id).order('data'),
        SB.from('lesoes').select('*').eq('user_id', id).order('data', { ascending: false }),
        SB.from('technique_progress').select('*').eq('user_id', id), // objetivo, sem privado
        // Observações pedagógicas do professor (member_notes, migration 0002). Se a
        // tabela ainda não existir, o Promise.all não pode falhar → catch local.
        SB.from('member_notes').select('id,autor,texto,criado_em').eq('user_id', id)
          .order('criado_em', { ascending: false }).then(r => r).catch(() => ({ data: [] })),
      ]);
      return { perfil: prof.data, cad: cadFromProfile(prof.data),
        frequencia: freq.data || [], graduacoes: grads.data || [],
        lesoes: lesoes.data || [], progresso: prog.data || [],
        notas: (notas && notas.data) || [] };
    }),

    lancarPresenca: wrap(async (id, hora) => {
      // turma_id é só informativo; a dedup é por (user_id, data) — A5
      const [enrR, acad] = await Promise.all([
        SB.from('enrollments').select('turma_id').eq('user_id', id).limit(1).maybeSingle(),
        myAcademyId(),
      ]);
      await SB.from('checkins').upsert({ user_id: id, academy_id: acad, turma_id: enrR.data ? enrR.data.turma_id : null, data: HOJE(), hora, via: 'professor' },
        { onConflict: 'user_id,data' });
    }),
    removerPresenca: wrap(async (id) => {
      await SB.from('checkins').delete().eq('user_id', id).eq('data', HOJE());
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
      if (error) throw error;
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

    // Atualiza a ficha cadastral de um aluno existente (sob RLS de professor da academia).
    atualizarAluno: wrap(async (id, campos) => {
      await SB.from('profiles').update(campos).eq('id', id);
    }),

    setMensalidade: wrap(async (id, status) => {
      await SB.from('mensalidades').upsert({ user_id: id, status, mes: mesAtual() }, { onConflict: 'user_id,mes' });
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
      const [tR, sR] = await Promise.all([
        SB.from('turmas').select('id,nome,faixa_etaria,cor,ativo').eq('academy_id', acad).eq('ativo', true),
        SB.from('turma_sessoes').select('id,turma_id,dia,hora,variacao,bilingue').eq('academy_id', acad).eq('ativo', true),
      ]);
      const sesByTurma = {};
      (sR.data || []).forEach(s => { (sesByTurma[s.turma_id] || (sesByTurma[s.turma_id] = [])).push({ id: s.id, dia: s.dia, hora: s.hora, variacao: s.variacao || undefined, bilingue: s.bilingue || undefined }); });
      return (tR.data || []).map(t => ({ id: t.id, nome: t.nome, faixaEtaria: t.faixa_etaria || '', cor: t.cor, sessoes: sesByTurma[t.id] || [] }));
    }),
    // Cria/edita uma turma + substitui suas sessões (delete+insert sob RLS de professor/dono).
    salvarTurma: wrap(async (t) => {
      const acad = await myAcademyId();
      const row = { academy_id: acad, nome: t.nome, faixa_etaria: t.faixaEtaria || null, cor: t.cor || null, ativo: true };
      let turmaId = (typeof t.id === 'string' && t.id.length >= 32) ? t.id : null;  // uuid = editar; senão criar
      if (turmaId) { await SB.from('turmas').update(row).eq('id', turmaId); }
      else { const { data } = await SB.from('turmas').insert(row).select('id').single(); turmaId = data && data.id; }
      if (!turmaId) throw new Error('turma sem id');
      await SB.from('turma_sessoes').delete().eq('turma_id', turmaId);
      const rows = (t.sessoes || []).map(s => ({ turma_id: turmaId, academy_id: acad, dia: s.dia, hora: s.hora, variacao: s.variacao || null, bilingue: !!s.bilingue, ativo: true }));
      if (rows.length) await SB.from('turma_sessoes').insert(rows);
      return turmaId;
    }),
    deletarTurma: wrap(async (id) => {
      // Soft-delete: preserva histórico de presenças/matrículas ligadas à turma.
      // getTurmas já filtra por ativo=true (não reaparece na UI).
      // Também desativa as sessões pra sumir da grade semanal.
      await SB.from('turmas').update({ ativo: false }).eq('id', id);
      await SB.from('turma_sessoes').update({ ativo: false }).eq('turma_id', id);
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
        SB.from('checkins').select('user_id,data,hora,tipo,turma_id').eq('academy_id', acad).gte('data', d120),
        SB.from('graduations').select('user_id,faixa,graus,tipo,data').eq('academy_id', acad),
        SB.from('technique_progress').select('user_id,tecnica_id,estado,nivel,treinos,ultima,acerto_pct'),
        SB.from('lesoes').select('user_id,parte,status,data,nota'),
      ]);
      const out = { checkins: ck.data || [], graduacoes: grads.data || [], progresso: prog.data || [], lesoes: les.data || [] };
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
        await SB.from('produtos').update(row).eq('id', prodId);
      } else {
        const { data } = await SB.from('produtos').insert(row).select('id').single();
        prodId = data && data.id;
      }
      if (!prodId) return null;
      // variantes: upsert por (produto_id, tamanho) e remove tamanhos que saíram
      const tams = p.tam || [];
      const rows = tams.map(t => ({ produto_id: prodId, tamanho: t, estoque: (p.estoque && p.estoque[t]) || 0 }));
      // estratégia simples: apaga as variantes e regrava (catálogo pequeno)
      await SB.from('produto_variantes').delete().eq('produto_id', prodId);
      if (rows.length) await SB.from('produto_variantes').insert(rows);
      return prodId;
    }),
    deletarProduto: wrap(async (id) => {
      await SB.from('produtos').delete().eq('id', id);   // cascade apaga variantes/movimentos
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
        .select('id,user_id,itens,total,status,canal,criado_em, profiles(apelido,nome_completo)')
        .eq('academy_id', acad).order('criado_em', { ascending: false }).limit(200);
      return (data || []).map(p => ({
        id: p.id, itens: Array.isArray(p.itens) ? p.itens : [], total: Number(p.total),
        status: (p.status === 'aberto' ? 'pendente' : p.status), canal: p.canal, criadoEm: p.criado_em,
        cliente: p.profiles ? (p.profiles.apelido || p.profiles.nome_completo || '—') : '—',
      }));
    }),
    // Confirma o pedido → RPC baixa o estoque + audita + marca 'concluido' (atômico).
    confirmarPedido: wrap(async (id) => { const { error } = await SB.rpc('confirmar_pedido', { p_id: id }); if (error) throw error; }),
    // Cancela o pedido (sem baixa).
    cancelarPedido: wrap(async (id) => { const { error } = await SB.rpc('cancelar_pedido', { p_id: id }); if (error) throw error; }),
  };

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

  global.sbAuth = sbAuth;
  global.sbSync = sbSync;
  global.sbProf = sbProf;
  global.sbVideos = sbVideos;
})(window);
