// Sección Avisos: anuncios y novedades de versión para todas las cuentas.
//
// Cada envío escribe una notificación por cuenta y dispara un push. No se
// puede deshacer, así que la sección tiene tres frenos: vista previa de cómo
// se va a ver, el número exacto de destinatarios en la confirmación, y el
// historial de lo ya enviado para no repetir un anuncio sin querer.

(function () {
  'use strict';

  var TIPOS = {
    general_announcement: {
      etiqueta: 'Anuncio',
      ayuda: 'Avisos puntuales: un corte, un evento, un pedido a los testers.',
      color: 'gris',
      icono: '📣',
    },
    patch_notes: {
      etiqueta: 'Novedades',
      ayuda: 'Qué trae la versión nueva. Conviene mandarlo cuando ya está publicada.',
      color: 'verde',
      icono: '✨',
    },
  };
  var ORDEN_TIPOS = ['general_announcement', 'patch_notes'];

  var MAX_TITULO = 80;
  var MAX_CUERPO = 1000;

  var TZ = 'America/Montevideo';
  var fmtFechaHora = new Intl.DateTimeFormat('es-UY', {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  function fechaHora(s) { return s ? fmtFechaHora.format(new Date(s)) : '—'; }

  function render(el, ctx) {
    var h = ctx.h;
    var estado = { tipo: 'general_announcement', cuentas: null, cancelado: false, enviando: false };

    el.appendChild(h('h1', { text: 'Avisos' }));
    el.appendChild(h('p', { class: 'bajada',
      text: 'Le llegan a todas las cuentas: al buzón de la campanita del perfil y como notificación al teléfono.' }));

    var avisoOk = h('div', { class: 'rep-ok', attrs: { role: 'status', hidden: true } });
    el.appendChild(avisoOk);

    // ── Tipo ──────────────────────────────────────────────────────────────
    var segmentos = h('div', { class: 'segmentos', attrs: { role: 'group', 'aria-label': 'Tipo de aviso' } });
    var ayuda = h('p', { class: 'rep-suave' });
    ORDEN_TIPOS.forEach(function (k) {
      var b = h('button', { attrs: { type: 'button' }, text: TIPOS[k].etiqueta });
      b.dataset.tipo = k;
      b.addEventListener('click', function () { estado.tipo = k; marcarTipo(); actualizar(); });
      segmentos.appendChild(b);
    });
    function marcarTipo() {
      Array.prototype.forEach.call(segmentos.children, function (b) {
        b.setAttribute('aria-pressed', String(b.dataset.tipo === estado.tipo));
      });
      ayuda.textContent = TIPOS[estado.tipo].ayuda;
    }

    // ── Campos ────────────────────────────────────────────────────────────
    var inputTitulo = h('input', { attrs: { id: 'aviso-titulo', type: 'text', maxlength: MAX_TITULO,
      placeholder: 'Título corto' } });
    var contadorTitulo = h('span', { class: 'rep-suave aviso-contador' });

    var txtCuerpo = h('textarea', { attrs: { id: 'aviso-cuerpo', rows: 5, maxlength: MAX_CUERPO,
      placeholder: 'Lo que querés contarles. Se lee dentro de la app y en la notificación.' } });
    var contadorCuerpo = h('span', { class: 'rep-suave aviso-contador' });

    inputTitulo.addEventListener('input', actualizar);
    txtCuerpo.addEventListener('input', actualizar);

    // ── Vista previa ──────────────────────────────────────────────────────
    var vpIcono  = h('span', { class: 'aviso-vp-icono' });
    var vpTitulo = h('div', { class: 'aviso-vp-titulo' });
    var vpCuerpo = h('div', { class: 'aviso-vp-cuerpo' });
    var vistaPrevia = h('div', { class: 'aviso-vp' },
      vpIcono,
      h('div', null, vpTitulo, vpCuerpo, h('div', { class: 'aviso-vp-fecha', text: 'ahora' })));

    var error = h('div', { class: 'aviso', attrs: { hidden: true } });
    var boton = h('button', { attrs: { type: 'submit', disabled: true }, text: 'Enviar a todas las cuentas' });

    var form = h('form', { class: 'tarjeta aviso-form', attrs: { novalidate: true } },
      segmentos,
      ayuda,
      h('div', { class: 'rep-campo' },
        h('label', { attrs: { for: 'aviso-titulo' }, text: 'Título' }), inputTitulo, contadorTitulo),
      h('div', { class: 'rep-campo' },
        h('label', { attrs: { for: 'aviso-cuerpo' }, text: 'Texto' }), txtCuerpo, contadorCuerpo),
      h('div', { class: 'rep-campo' },
        h('div', { class: 'rep-etiqueta', text: 'Así se va a ver' }), vistaPrevia),
      error,
      boton);
    el.appendChild(form);

    var historial = h('div', { class: 'aviso-historial' });
    el.appendChild(historial);

    marcarTipo();
    actualizar();
    contarCuentas();
    cargarHistorial();

    function actualizar() {
      var titulo = inputTitulo.value.trim();
      var cuerpo = txtCuerpo.value.trim();

      contadorTitulo.textContent = inputTitulo.value.length + ' / ' + MAX_TITULO;
      contadorCuerpo.textContent = txtCuerpo.value.length + ' / ' + MAX_CUERPO;

      vpIcono.textContent  = TIPOS[estado.tipo].icono;
      vpTitulo.textContent = titulo || 'Título del aviso';
      vpCuerpo.textContent = cuerpo || 'El texto que escribas va acá.';
      vistaPrevia.classList.toggle('vacia', !titulo && !cuerpo);

      boton.disabled = !titulo || !cuerpo || estado.enviando;
      error.hidden = true;
    }

    // Para poder decir en la confirmación a cuánta gente le llega.
    async function contarCuentas() {
      var res = await ctx.sb.rpc('admin_analytics_resumen');
      if (estado.cancelado || res.error) return;
      estado.cuentas = res.data && res.data.cuentas;
    }

    async function cargarHistorial() {
      var res = await ctx.sb.rpc('admin_avisos_enviados', { _limite: 20 });
      if (estado.cancelado) return;
      if (res.error) {
        historial.replaceChildren(ctx.error('No se pudo cargar el historial.', res.error));
        return;
      }
      dibujarHistorial(res.data || []);
    }

    function dibujarHistorial(lista) {
      historial.replaceChildren(h('h2', { class: 'aviso-historial-titulo', text: 'Enviados' }));
      if (!lista.length) {
        historial.appendChild(h('p', { class: 'rep-vacio', text: 'Todavía no mandaste ninguno.' }));
        return;
      }
      historial.appendChild(h('ul', { class: 'rep-historial' }, lista.map(function (a) {
        var t = TIPOS[a.type] || { etiqueta: a.type, color: 'gris' };
        return h('li', null,
          h('div', { class: 'rep-historial-fila' },
            h('span', { class: 'pastilla ' + t.color, text: t.etiqueta }),
            h('strong', { text: a.title }),
            h('span', { class: 'rep-suave', text: fechaHora(a.enviado_at) })),
          h('div', { class: 'rep-cita', text: a.body }),
          h('div', { class: 'rep-suave',
            text: a.destinatarios + (a.destinatarios === 1 ? ' cuenta · ' : ' cuentas · ') +
                  (a.leidos === 1 ? '1 lo leyó' : a.leidos + ' lo leyeron') }));
      })));
    }

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var titulo = inputTitulo.value.trim();
      var cuerpo = txtCuerpo.value.trim();
      if (!titulo || !cuerpo) return;

      var cuantas = estado.cuentas == null
        ? 'todas las cuentas'
        : estado.cuentas + (estado.cuentas === 1 ? ' cuenta' : ' cuentas');

      var resumen =
        TIPOS[estado.tipo].etiqueta + ': "' + titulo + '"\n\n' +
        cuerpo + '\n\n' +
        'Le va a llegar a ' + cuantas + ', con notificación al teléfono. No se puede deshacer.\n\n¿Lo mando?';
      if (!window.confirm(resumen)) return;

      estado.enviando = true;
      boton.disabled = true;
      boton.textContent = 'Enviando…';

      var res = await ctx.sb.rpc('admin_enviar_aviso', {
        _tipo: estado.tipo, _titulo: titulo, _cuerpo: cuerpo,
      });

      estado.enviando = false;
      boton.textContent = 'Enviar a todas las cuentas';
      if (estado.cancelado) return;

      if (res.error) {
        console.error(res.error);
        error.textContent = res.error.code === 'P0001'
          ? res.error.message
          : 'No se pudo enviar. Probá de nuevo.';
        error.hidden = false;
        boton.disabled = false;
        return;
      }

      var n = res.data && res.data.enviadas;
      avisoOk.textContent = 'Enviado a ' + n + (n === 1 ? ' cuenta.' : ' cuentas.');
      avisoOk.hidden = false;
      inputTitulo.value = '';
      txtCuerpo.value = '';
      actualizar();
      cargarHistorial();
    });

    return function () { estado.cancelado = true; };
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'avisos', titulo: 'Avisos', render: render });
})();
