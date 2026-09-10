// Sección Reportes: la cola de moderación.
//
// A la izquierda la lista —pendientes del más viejo al más nuevo, para que
// ninguno se quede esperando—; a la derecha la ficha del reporte elegido, con
// todo lo necesario para decidir y el formulario de la decisión.
//
// Las funciones de la base (admin_reportes_lista, admin_reporte_detalle,
// admin_resolver_reporte, admin_levantar_suspension) comprueban que quien
// llama es admin. Lo que se valida acá es solo para avisar antes.

(function () {
  'use strict';

  var MOTIVOS = {
    harassment:            'Acoso o agresión',
    inappropriate_content: 'Contenido inapropiado',
    spam:                  'Spam o publicidad',
    fake_profile:          'Perfil falso',
    other:                 'Otro motivo',
  };

  // Cómo se nombra el motivo dentro de una frase del mensaje al usuario.
  var MOTIVO_EN_FRASE = {
    harassment:            'acoso o agresión',
    inappropriate_content: 'contenido inapropiado',
    spam:                  'spam o publicidad',
    fake_profile:          'perfil falso',
  };

  var CONTEXTOS = {
    profile:          'Desde el perfil',
    team_message:     'Por un mensaje en el chat de un equipo',
    match_message:    'Por un mensaje en el chat de un partido',
    friendly_message: 'Por un mensaje en el chat de un amistoso',
  };

  var DECISIONES = {
    descartar:             { etiqueta: 'Descartado',            opcion: 'Descartar',
                             ayuda: 'No hay incumplimiento. No se hace nada.',              color: 'gris' },
    aviso:                 { etiqueta: 'Aviso',                 opcion: 'Aviso',
                             ayuda: 'Advertencia sin sanción. Para faltas leves, la primera vez.', color: 'amarilla' },
    suspension:            { etiqueta: 'Suspensión',            opcion: 'Suspender',
                             ayuda: 'No puede entrar a la app durante un tiempo.',           color: 'naranja' },
    suspension_permanente: { etiqueta: 'Suspensión permanente', opcion: 'Suspensión permanente',
                             ayuda: 'No puede volver a entrar.',                             color: 'roja' },
    levantamiento:         { etiqueta: 'Suspensión levantada',  color: 'verde' },
  };
  var ORDEN_DECISIONES = ['descartar', 'aviso', 'suspension', 'suspension_permanente'];

  var DIAS = [1, 3, 7, 15, 30, 90];
  var DIAS_POR_DEFECTO = 7;

  // Los términos prometen actuar dentro de las 48 horas.
  var PLAZO_HORAS = 48;

  var TZ = 'America/Montevideo';
  var fmtFechaHora = new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  var fmtFecha = new Intl.DateTimeFormat('es-UY', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });

  function fechaHora(s) { return s ? fmtFechaHora.format(new Date(s)) : '—'; }
  function fecha(s) { return s ? fmtFecha.format(new Date(s)) : '—'; }

  function hace(s) {
    var min = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return 'hace ' + min + ' min';
    var hs = Math.floor(min / 60);
    if (hs < 24) return 'hace ' + hs + (hs === 1 ? ' hora' : ' horas');
    var d = Math.floor(hs / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  // null mientras está holgado; aviso cuando pasó la mitad del plazo.
  function estadoPlazo(creado) {
    var hs = (Date.now() - new Date(creado).getTime()) / 3600000;
    if (hs >= PLAZO_HORAS) return { color: 'roja', texto: 'Fuera de plazo' };
    if (hs >= PLAZO_HORAS / 2) {
      var quedan = Math.max(1, Math.ceil(PLAZO_HORAS - hs));
      return { color: 'amarilla', texto: 'Quedan ' + quedan + ' h' };
    }
    return null;
  }

  // La base guarda la permanente como cien años: Auth no acepta infinito.
  function esPermanente(fin) {
    return new Date(fin).getFullYear() - new Date().getFullYear() > 50;
  }

  function plantilla(decision, motivo, dias) {
    var por = MOTIVO_EN_FRASE[motivo]
      ? 'por ' + MOTIVO_EN_FRASE[motivo] + ', que va contra las normas de conducta de FreeBall'
      : 'por incumplir las normas de conducta de FreeBall';
    if (decision === 'aviso') {
      return 'Recibimos un reporte sobre tu cuenta ' + por.replace(', que va contra', ', algo que va contra') +
        '. Esta vez es solo un aviso: te pedimos que respetes las normas. Si se repite, podemos suspender tu cuenta.';
    }
    if (decision === 'suspension') {
      return 'Suspendimos tu cuenta por ' + dias + (dias === 1 ? ' día ' : ' días ') + por + '.';
    }
    if (decision === 'suspension_permanente') {
      return 'Suspendimos tu cuenta de forma permanente ' + por + '.';
    }
    return '';
  }

  // ── Piezas ──────────────────────────────────────────────────────────────

  function pastilla(h, color, texto) {
    return h('span', { class: 'pastilla ' + color, text: texto });
  }

  function pastillaDecision(h, decision) {
    var d = DECISIONES[decision];
    return d ? pastilla(h, d.color, d.etiqueta) : null;
  }

  function avatar(h, url, nombre, grande) {
    var iniciales = (nombre || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (p) { return p.charAt(0); }).join('').toUpperCase() || '?';
    var cont = h('div', { class: 'avatar' + (grande ? ' grande' : '') });
    if (url && /^https:\/\//.test(url)) {
      var img = h('img', { attrs: { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } });
      img.addEventListener('error', function () { img.remove(); cont.textContent = iniciales; });
      cont.appendChild(img);
    } else {
      cont.textContent = iniciales;
    }
    return cont;
  }

  function datos(h, filas) {
    return h('dl', { class: 'rep-datos' }, filas.map(function (f) {
      return [h('dt', { text: f[0] }), h('dd', { text: f[1] })];
    }));
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function render(el, ctx) {
    var h = ctx.h;
    var estado = { pestana: 'pendientes', lista: [], seleccionado: null, pedidoDetalle: 0, cancelado: false };
    var temporizadorAviso = null;

    el.appendChild(h('h1', { text: 'Reportes' }));
    el.appendChild(h('p', { class: 'bajada',
      text: 'Los pendientes van del más viejo al más nuevo. Los términos prometen actuar dentro de las 48 horas.' }));

    var avisoOk = h('div', { class: 'rep-ok', attrs: { role: 'status', hidden: true } });
    el.appendChild(avisoOk);

    var bPendientes = h('button', { attrs: { type: 'button' }, text: 'Pendientes',
      on: { click: function () { cambiarPestana('pendientes'); } } });
    var bResueltos = h('button', { attrs: { type: 'button' }, text: 'Resueltos',
      on: { click: function () { cambiarPestana('resueltos'); } } });
    el.appendChild(h('div', { class: 'segmentos', attrs: { role: 'group', 'aria-label': 'Estado' } },
      bPendientes, bResueltos));

    var colLista = h('div', { class: 'rep-lista' });
    var colDetalle = h('div', { class: 'rep-detalle' });
    el.appendChild(h('div', { class: 'rep-layout' }, colLista, colDetalle));

    marcarPestanas();
    cargarLista();

    function marcarPestanas() {
      bPendientes.setAttribute('aria-pressed', String(estado.pestana === 'pendientes'));
      bResueltos.setAttribute('aria-pressed', String(estado.pestana === 'resueltos'));
    }

    function cambiarPestana(p) {
      if (estado.pestana === p) return;
      estado.pestana = p;
      estado.seleccionado = null;
      marcarPestanas();
      cargarLista();
    }

    function mostrarOk(texto) {
      avisoOk.textContent = texto;
      avisoOk.hidden = false;
      clearTimeout(temporizadorAviso);
      temporizadorAviso = setTimeout(function () { avisoOk.hidden = true; }, 5000);
    }

    // ── Lista ─────────────────────────────────────────────────────────────

    async function cargarLista() {
      var pestana = estado.pestana;
      colLista.replaceChildren(h('p', { class: 'rep-vacio', text: 'Cargando…' }));
      colDetalle.replaceChildren();

      var res = await ctx.sb.rpc('admin_reportes_lista', { _pendientes: pestana === 'pendientes' });
      if (estado.cancelado || pestana !== estado.pestana) return;
      if (res.error) {
        colLista.replaceChildren(ctx.error('No se pudieron cargar los reportes.', res.error));
        return;
      }

      estado.lista = res.data || [];
      if (pestana === 'pendientes') bPendientes.textContent = 'Pendientes (' + estado.lista.length + ')';
      dibujarLista();

      // Se abre el primero: en pendientes es el más viejo, que es el que toca.
      if (estado.lista.length) seleccionar(estado.lista[0].id);
      else colDetalle.replaceChildren(h('div', { class: 'tarjeta rep-vacio-ficha',
        text: pestana === 'pendientes' ? 'No hay reportes pendientes.' : 'Todavía no hay reportes resueltos.' }));
    }

    function dibujarLista() {
      colLista.replaceChildren();
      if (!estado.lista.length) {
        colLista.appendChild(h('p', { class: 'rep-vacio', text: 'Nada por acá.' }));
        return;
      }
      var pendientes = estado.pestana === 'pendientes';

      estado.lista.forEach(function (r) {
        var plazo = pendientes ? estadoPlazo(r.created_at) : null;
        var otros = pendientes && r.pendientes_mismo_usuario > 1 ? r.pendientes_mismo_usuario - 1 : 0;

        colLista.appendChild(h('button', {
          class: 'rep-item' + (r.id === estado.seleccionado ? ' activo' : ''),
          attrs: { type: 'button', 'data-id': r.id },
          on: { click: function () { seleccionar(r.id); } },
        },
          avatar(h, r.reported_avatar, r.reported_name),
          h('div', { class: 'rep-item-cuerpo' },
            h('div', { class: 'rep-item-fila' },
              h('strong', { text: r.reported_name || 'Sin nombre' }),
              h('span', { class: 'rep-suave',
                text: pendientes ? hace(r.created_at) : fecha(r.resolved_at || r.created_at) })),
            h('div', { class: 'rep-item-motivo', text: MOTIVOS[r.reason] || r.reason }),
            h('div', { class: 'rep-item-pie' },
              h('span', { class: 'rep-suave', text: 'Reportado por ' + (r.reporter_name || 'Sin nombre') }),
              plazo && pastilla(h, plazo.color, plazo.texto),
              !pendientes && pastillaDecision(h, r.decision),
              otros > 0 && pastilla(h, 'gris', '+' + otros + (otros === 1 ? ' reporte más' : ' reportes más'))))));
      });
    }

    async function seleccionar(id) {
      estado.seleccionado = id;
      Array.prototype.forEach.call(colLista.querySelectorAll('.rep-item'), function (b) {
        b.classList.toggle('activo', b.dataset.id === id);
      });

      var este = ++estado.pedidoDetalle;
      colDetalle.replaceChildren(h('p', { class: 'rep-vacio', text: 'Cargando…' }));

      var res = await ctx.sb.rpc('admin_reporte_detalle', { _id: id });
      if (estado.cancelado || este !== estado.pedidoDetalle) return;
      if (res.error) {
        colDetalle.replaceChildren(ctx.error('No se pudo cargar el reporte.', res.error));
        return;
      }
      colDetalle.replaceChildren(ficha(res.data));
    }

    // ── Ficha ─────────────────────────────────────────────────────────────

    function ficha(d) {
      var r = d.reporte;
      var pendiente = r.status === 'pending';
      var plazo = pendiente ? estadoPlazo(r.created_at) : null;

      return h('div', { class: 'rep-ficha' },
        h('div', { class: 'rep-ficha-cabecera' },
          h('div', null,
            h('h2', { text: MOTIVOS[r.reason] || r.reason }),
            h('div', { class: 'rep-suave',
              text: 'Recibido el ' + fechaHora(r.created_at) + ' (' + hace(r.created_at) + ') · ' +
                    (CONTEXTOS[r.context_type] || CONTEXTOS.profile) })),
          pendiente
            ? pastilla(h, plazo ? plazo.color : 'gris', plazo ? plazo.texto : 'Pendiente')
            : pastillaDecision(h, r.decision)),

        h('div', { class: 'tarjeta rep-bloque' },
          h('h3', { text: 'Lo que escribió quien reporta' }),
          r.details
            ? h('p', { class: 'rep-cita', text: r.details })
            : h('p', { class: 'rep-suave', text: 'No agregó detalles.' })),

        h('div', { class: 'rep-personas' }, tarjetaReportado(d.reportado), tarjetaDenunciante(d.denunciante)),

        bloqueAntecedentes(d.antecedentes),
        d.otros_reportes.length > 0 && bloqueOtros(d.otros_reportes),

        pendiente ? formularioDecision(d) : bloqueResolucion(r));
    }

    function tarjetaReportado(p) {
      return h('div', { class: 'tarjeta rep-persona' },
        h('div', { class: 'rep-rol', text: 'Reportado' }),
        h('div', { class: 'rep-persona-cabeza' },
          avatar(h, p.avatar_url, p.full_name, true),
          h('div', null,
            h('strong', { text: p.full_name || 'Sin nombre' }),
            h('div', { class: 'rep-suave', text: p.email || '' }))),
        datos(h, [
          ['Cuenta creada', fecha(p.created_at)],
          ['Descripción', p.bio || '—'],
        ]),
        p.is_admin && h('p', { class: 'rep-alerta', text: 'Es administrador: no se lo puede sancionar desde el panel.' }),
        p.suspendido_hasta && bloqueSuspendido(p));
    }

    function bloqueSuspendido(p) {
      var boton = h('button', { class: 'boton-secundario', attrs: { type: 'button' }, text: 'Levantar suspensión' });
      boton.addEventListener('click', async function () {
        var nota = window.prompt(
          'Vas a levantar la suspensión de ' + (p.full_name || 'esta persona') +
          '. Va a poder volver a entrar a la app.\n\nNota interna (opcional):', '');
        if (nota === null) return;
        boton.disabled = true;
        var res = await ctx.sb.rpc('admin_levantar_suspension', { _user_id: p.id, _nota: nota });
        if (estado.cancelado) return;
        if (res.error) {
          boton.disabled = false;
          console.error(res.error);
          window.alert(res.error.code === 'P0001' ? res.error.message : 'No se pudo levantar la suspensión.');
          return;
        }
        mostrarOk('Suspensión levantada.');
        if (estado.seleccionado) seleccionar(estado.seleccionado);
      });

      return h('div', { class: 'rep-suspendido' },
        h('span', { text: esPermanente(p.suspendido_hasta)
          ? 'Cuenta suspendida de forma permanente'
          : 'Cuenta suspendida hasta el ' + fechaHora(p.suspendido_hasta) }),
        boton);
    }

    function tarjetaDenunciante(p) {
      var descartados = p.reportes_descartados || 0;
      return h('div', { class: 'tarjeta rep-persona' },
        h('div', { class: 'rep-rol', text: 'Quien reporta' }),
        h('div', { class: 'rep-persona-cabeza' },
          avatar(h, p.avatar_url, p.full_name, true),
          h('div', null,
            h('strong', { text: p.full_name || 'Sin nombre' }),
            h('div', { class: 'rep-suave', text: p.email || '' }))),
        datos(h, [
          ['Cuenta creada', fecha(p.created_at)],
          ['Reportes hechos', p.reportes_hechos + (descartados ? ' (' + descartados + ' descartados)' : '')],
        ]),
        // Alguien que reporta a todo el mundo también es una señal.
        descartados >= 2 && h('p', { class: 'rep-alerta',
          text: 'Varios de sus reportes anteriores se descartaron.' }));
    }

    function bloqueAntecedentes(lista) {
      return h('div', { class: 'tarjeta rep-bloque' },
        h('h3', { text: 'Antecedentes del reportado' }),
        lista.length === 0
          ? h('p', { class: 'rep-suave', text: 'Sin avisos ni sanciones anteriores.' })
          : h('ul', { class: 'rep-historial' }, lista.map(function (a) {
              var quitado = [a.removed_avatar && 'la foto', a.removed_bio && 'la descripción'].filter(Boolean);
              return h('li', null,
                h('div', { class: 'rep-historial-fila' },
                  pastillaDecision(h, a.kind),
                  h('span', { class: 'rep-suave',
                    text: fecha(a.created_at) + (a.created_by_name ? ' · ' + a.created_by_name : '') })),
                a.reason && h('div', { text: 'Motivo: ' + (MOTIVOS[a.reason] || a.reason) }),
                a.kind === 'suspension' && a.ends_at && h('div', { text: 'Hasta el ' + fechaHora(a.ends_at) }),
                quitado.length > 0 && h('div', { text: 'Se quitó ' + quitado.join(' y ') + '.' }),
                a.message && h('div', { class: 'rep-cita', text: a.message }),
                a.internal_note && h('div', { class: 'rep-suave', text: 'Nota interna: ' + a.internal_note }));
            })));
    }

    function bloqueOtros(lista) {
      var ESTADOS = { pending: ['gris', 'Pendiente'], reviewed: ['verde', 'Resuelto'], dismissed: ['gris', 'Descartado'] };
      return h('div', { class: 'tarjeta rep-bloque' },
        h('h3', { text: 'Otros reportes sobre esta persona (' + lista.length + ')' }),
        h('ul', { class: 'rep-historial' }, lista.map(function (o) {
          var e = ESTADOS[o.status] || ['gris', o.status];
          return h('li', null,
            h('div', { class: 'rep-historial-fila' },
              h('strong', { text: MOTIVOS[o.reason] || o.reason }),
              pastilla(h, e[0], e[1]),
              h('span', { class: 'rep-suave',
                text: fecha(o.created_at) + ' · reportado por ' + (o.reporter_name || 'Sin nombre') })),
            o.details && h('div', { class: 'rep-cita', text: o.details }));
        })));
    }

    function bloqueResolucion(r) {
      var a = r.accion;
      var quitado = a ? [a.removed_avatar && 'la foto', a.removed_bio && 'la descripción'].filter(Boolean) : [];
      return h('div', { class: 'tarjeta rep-bloque' },
        h('h3', { text: 'Resolución' }),
        h('div', { class: 'rep-historial-fila' },
          pastillaDecision(h, r.decision),
          h('span', { class: 'rep-suave',
            text: fechaHora(r.resolved_at) + (r.resolved_by_name ? ' · ' + r.resolved_by_name : '') })),
        a && a.kind === 'suspension' && a.ends_at && h('p', { text: 'Cuenta suspendida hasta el ' + fechaHora(a.ends_at) }),
        quitado.length > 0 && h('p', { text: 'Se quitó ' + quitado.join(' y ') + '.' }),
        a && a.message && [h('div', { class: 'rep-etiqueta', text: 'Mensaje para la persona' }),
                           h('p', { class: 'rep-cita', text: a.message })],
        r.resolution_note && [h('div', { class: 'rep-etiqueta', text: 'Nota interna' }),
                              h('p', { class: 'rep-cita', text: r.resolution_note })]);
    }

    // ── Decisión ──────────────────────────────────────────────────────────

    function formularioDecision(d) {
      var r = d.reporte;
      var p = d.reportado;
      var otrosPendientes = d.otros_reportes.filter(function (o) { return o.status === 'pending'; }).length;
      var previos = d.antecedentes.filter(function (a) { return a.kind !== 'levantamiento'; });

      var decision = null;
      var mensajeEditado = false;

      var radios = ORDEN_DECISIONES.map(function (k) {
        var info = DECISIONES[k];
        var input = h('input', { attrs: {
          type: 'radio', name: 'decision', value: k,
          disabled: p.is_admin && k !== 'descartar',
        } });
        input.addEventListener('change', function () { decision = k; actualizar(); });
        return h('label', { class: 'rep-opcion ' + info.color },
          input,
          h('span', null, h('strong', { text: info.opcion }), h('span', { class: 'rep-suave', text: info.ayuda })));
      });

      var selectDias = h('select', { attrs: { id: 'rep-dias' } }, DIAS.map(function (n) {
        return h('option', { attrs: { value: n, selected: n === DIAS_POR_DEFECTO }, text: n + (n === 1 ? ' día' : ' días') });
      }));
      selectDias.addEventListener('change', function () { if (!mensajeEditado) ponerPlantilla(); });
      var filaDias = h('div', { class: 'rep-campo' },
        h('label', { attrs: { for: 'rep-dias' }, text: 'Duración' }), selectDias);

      var chkFoto = h('input', { attrs: { type: 'checkbox', disabled: !p.avatar_url } });
      var chkBio = h('input', { attrs: { type: 'checkbox', disabled: !p.bio } });
      var filaContenido = h('div', { class: 'rep-campo' },
        h('div', { class: 'rep-etiqueta', text: 'Contenido' }),
        h('label', { class: 'rep-check' }, chkFoto, 'Quitar la foto de perfil' + (p.avatar_url ? '' : ' (no tiene)')),
        h('label', { class: 'rep-check' }, chkBio, 'Borrar la descripción' + (p.bio ? '' : ' (no tiene)')));

      var txtMensaje = h('textarea', { attrs: { id: 'rep-mensaje', rows: 4, maxlength: 1000 } });
      txtMensaje.addEventListener('input', function () { mensajeEditado = txtMensaje.value.trim() !== ''; });
      var filaMensaje = h('div', { class: 'rep-campo' },
        h('label', { attrs: { for: 'rep-mensaje' }, text: 'Mensaje para la persona' }),
        txtMensaje,
        h('p', { class: 'rep-suave rep-nota-campo',
          text: 'Todavía no se envía: queda guardado para cuando estén las notificaciones generales.' }));

      var txtNota = h('textarea', { attrs: { id: 'rep-nota', rows: 2, maxlength: 1000,
        placeholder: 'Por qué se decidió así. Solo la ven los administradores.' } });
      var filaNota = h('div', { class: 'rep-campo' },
        h('label', { attrs: { for: 'rep-nota' }, text: 'Nota interna (opcional)' }), txtNota);

      var chkIncluir = h('input', { attrs: { type: 'checkbox', checked: true } });
      var filaIncluir = otrosPendientes > 0 && h('label', { class: 'rep-check rep-incluir' }, chkIncluir,
        'Resolver también ' + (otrosPendientes === 1
          ? 'el otro reporte pendiente'
          : 'los otros ' + otrosPendientes + ' reportes pendientes') + ' sobre esta persona, con la misma decisión');

      var error = h('div', { class: 'aviso', attrs: { hidden: true } });
      var boton = h('button', { attrs: { type: 'submit', disabled: true }, text: 'Confirmar decisión' });

      function ponerPlantilla() {
        txtMensaje.value = plantilla(decision, r.reason, Number(selectDias.value));
      }

      function actualizar() {
        var sanciona = decision && decision !== 'descartar';
        filaDias.hidden = decision !== 'suspension';
        filaContenido.hidden = !sanciona;
        filaMensaje.hidden = !sanciona;
        if (sanciona && !mensajeEditado) ponerPlantilla();
        boton.disabled = !decision;
        error.hidden = true;
      }

      var form = h('form', { class: 'tarjeta rep-bloque rep-decision', attrs: { novalidate: true } },
        h('h3', { text: 'Decisión' }),
        h('p', { class: 'rep-suave', text: previos.length
          ? 'Tiene ' + previos.length + (previos.length === 1 ? ' antecedente' : ' antecedentes') +
            '. El último: ' + DECISIONES[previos[0].kind].etiqueta.toLowerCase() + ', el ' + fecha(previos[0].created_at) + '.'
          : 'Sin antecedentes. Para faltas leves, la primera vez corresponde un aviso.' }),
        h('div', { class: 'rep-opciones' }, radios),
        filaDias, filaContenido, filaMensaje, filaNota, filaIncluir,
        error, boton);

      actualizar();

      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        error.hidden = true;
        if (!decision) return;

        var sanciona = decision !== 'descartar';
        var dias = decision === 'suspension' ? Number(selectDias.value) : null;
        var mensaje = txtMensaje.value.trim();
        if (decision === 'aviso' && !mensaje) {
          error.textContent = 'El aviso necesita un mensaje.';
          error.hidden = false;
          return;
        }

        var nombre = p.full_name || 'esta persona';
        var partes = [{
          descartar: 'Descartar el reporte.',
          aviso: 'Registrar un aviso para ' + nombre + '.',
          suspension: 'Suspender a ' + nombre + ' por ' + dias + (dias === 1 ? ' día.' : ' días.'),
          suspension_permanente: 'Suspender a ' + nombre + ' DE FORMA PERMANENTE.',
        }[decision]];
        if (sanciona && chkFoto.checked) partes.push('Quitar su foto de perfil.');
        if (sanciona && chkBio.checked) partes.push('Borrar su descripción.');
        if (filaIncluir && chkIncluir.checked) {
          partes.push('Resolver también ' + (otrosPendientes === 1 ? 'el otro reporte pendiente.' : 'los otros ' + otrosPendientes + ' reportes pendientes.'));
        }
        if (!window.confirm(partes.join('\n') + '\n\n¿Confirmás?')) return;

        boton.disabled = true;
        boton.textContent = 'Guardando…';

        var res = await ctx.sb.rpc('admin_resolver_reporte', {
          _id: r.id,
          _decision: decision,
          _dias: dias,
          _mensaje: sanciona ? mensaje : null,
          _nota: txtNota.value,
          _quitar_foto: sanciona && chkFoto.checked,
          _borrar_bio: sanciona && chkBio.checked,
          _incluir_pendientes: !!(filaIncluir && chkIncluir.checked),
        });
        if (estado.cancelado) return;

        if (res.error) {
          console.error(res.error);
          boton.disabled = false;
          boton.textContent = 'Confirmar decisión';
          // P0001 son los mensajes de la propia función, escritos para mostrarse.
          error.textContent = res.error.code === 'P0001'
            ? res.error.message
            : 'No se pudo guardar la decisión. Probá de nuevo.';
          error.hidden = false;
          return;
        }

        var n = res.data && res.data.resueltos;
        mostrarOk(n > 1 ? 'Listo: ' + n + ' reportes resueltos.' : 'Listo: reporte resuelto.');
        ctx.actualizarInsignias();
        cargarLista();
      });

      return form;
    }

    return function () {
      estado.cancelado = true;
      clearTimeout(temporizadorAviso);
    };
  }

  function insignia(ctx) {
    return ctx.sb.rpc('admin_reportes_pendientes').then(function (res) {
      return res.error ? null : res.data;
    });
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'reportes', titulo: 'Reportes', render: render, insignia: insignia });
})();
