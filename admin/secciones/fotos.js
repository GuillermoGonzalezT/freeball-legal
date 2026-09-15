// Sección Fotos: las que la gente aporta a canchas publicadas que no tenían.
//
// A la izquierda las canchas con aportes pendientes, de la más vieja a la más
// nueva. A la derecha, las fotos agrupadas por persona. Se eligen hasta tres
// entre todas, en orden —la primera es la portada del mapa—, y las que no se
// eligen se descartan. Si no sirve ninguna, se descartan todas con un motivo.
//
// admin_fotos_aportadas y admin_resolver_fotos comprueban en la base que quien
// llama es admin; lo de acá solo evita mandar pedidos que van a fallar.

(function () {
  'use strict';

  var MAXIMO = 3;

  var MOTIVOS = [
    { id: 'no_se_ve',       etiqueta: 'No se ve la cancha',   ayuda: 'Las fotos no la muestran.' },
    { id: 'no_corresponde', etiqueta: 'No es esta cancha',    ayuda: 'Son de otro lugar.' },
    { id: 'calidad',        etiqueta: 'Mala calidad',         ayuda: 'Borrosas, oscuras o muy chicas.' },
    { id: 'inapropiado',    etiqueta: 'Contenido inapropiado', ayuda: 'Hay algo que no se puede publicar.' },
  ];

  function fecha(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('es-UY') + ' ' +
           d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
  }

  function antiguedad(iso) {
    var horas = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (horas < 1) return 'hace minutos';
    if (horas < 24) return 'hace ' + Math.floor(horas) + ' h';
    var dias = Math.floor(horas / 24);
    return 'hace ' + dias + (dias === 1 ? ' día' : ' días');
  }

  function cuantasFotos(c) {
    return (c.aportes || []).reduce(function (n, a) { return n + (a.photos || []).length; }, 0);
  }

  function render(el, ctx) {
    var h = ctx.h;
    var estado = { lista: [], seleccionada: null, cancelado: false, enviando: false };
    var temporizadorAviso = null;

    el.appendChild(h('h1', { text: 'Fotos aportadas' }));
    el.appendChild(h('p', { class: 'bajada',
      text: 'Fotos que mandó la gente para canchas publicadas que no tenían. Elegí hasta tres, en orden: las que no elijas se descartan.' }));

    var avisoOk = h('div', { class: 'rep-ok', attrs: { role: 'status', hidden: true } });
    el.appendChild(avisoOk);

    var colLista = h('div', { class: 'rep-lista' });
    var colDetalle = h('div', { class: 'rep-detalle' });
    el.appendChild(h('div', { class: 'rep-layout' }, colLista, colDetalle));

    cargarLista();

    function mostrarOk(texto) {
      avisoOk.textContent = texto;
      avisoOk.hidden = false;
      clearTimeout(temporizadorAviso);
      temporizadorAviso = setTimeout(function () { avisoOk.hidden = true; }, 5000);
    }

    // ── La cola ───────────────────────────────────────────────────────────

    async function cargarLista() {
      colLista.replaceChildren(h('p', { class: 'rep-vacio', text: 'Cargando…' }));
      colDetalle.replaceChildren();

      var res = await ctx.sb.rpc('admin_fotos_aportadas');
      if (estado.cancelado) return;
      if (res.error) {
        colLista.replaceChildren(ctx.error('No se pudieron cargar las fotos.', res.error));
        return;
      }

      estado.lista = res.data || [];
      dibujarLista();

      if (estado.lista.length) seleccionar(estado.lista[0].court_id);
      else colDetalle.replaceChildren(h('div', { class: 'tarjeta rep-vacio-ficha',
        text: 'No hay fotos esperando revisión.' }));
    }

    function dibujarLista() {
      colLista.replaceChildren();
      if (!estado.lista.length) {
        colLista.appendChild(h('p', { class: 'rep-vacio', text: 'Nada pendiente.' }));
        return;
      }
      estado.lista.forEach(function (c) {
        var aportes = (c.aportes || []).length;
        var fotos = cuantasFotos(c);
        colLista.appendChild(h('button', {
          class: 'rep-item' + (estado.seleccionada === c.court_id ? ' activo' : ''),
          attrs: { type: 'button' },
          on: { click: function () { seleccionar(c.court_id); } },
        },
          h('div', { class: 'rep-item-cuerpo' },
            h('div', { class: 'rep-item-fila' },
              h('strong', { text: c.name || 'Sin nombre' }),
              h('span', { class: 'rep-suave', text: antiguedad(c.primera) })),
            h('div', { class: 'rep-item-motivo rep-suave', text: c.address || 'Sin dirección' }),
            h('div', { class: 'rep-item-pie' },
              h('span', { class: 'pastilla', text: fotos + (fotos === 1 ? ' foto' : ' fotos') }),
              aportes > 1 ? h('span', { class: 'pastilla amarilla', text: aportes + ' personas' }) : null))
        ));
      });
    }

    function seleccionar(id) {
      estado.seleccionada = id;
      dibujarLista();
      var c = estado.lista.filter(function (x) { return x.court_id === id; })[0];
      colDetalle.replaceChildren(c ? ficha(c) : h('div', { class: 'tarjeta rep-vacio-ficha',
        text: 'Esa cancha ya no tiene fotos pendientes.' }));
    }

    // ── La ficha ──────────────────────────────────────────────────────────

    function ficha(c) {
      var disponibles = Math.max(0, MAXIMO - (c.publicadas || 0));
      var elegidas = [];      // ids, en el orden en que se marcaron
      var numeros = {};       // id → el span que muestra su lugar

      var contador = h('span', { class: 'pastilla gris' });
      // El click se conecta en decision(), que es donde vive publicar().
      var botonPublicar = h('button', { attrs: { type: 'button', disabled: true },
        text: 'Publicar las elegidas' });

      function actualizar() {
        contador.textContent = elegidas.length + ' de ' + disponibles + ' elegidas';
        botonPublicar.disabled = elegidas.length === 0;
        Object.keys(numeros).forEach(function (id) {
          var i = elegidas.indexOf(id);
          numeros[id].textContent = i >= 0 ? (i === 0 ? '1 · portada' : String(i + 1)) : '';
        });
      }

      function foto(f) {
        var marca = h('input', { attrs: { type: 'checkbox' } });
        var numero = h('span', { class: 'foto-orden' });
        numeros[f.id] = numero;

        marca.addEventListener('change', function () {
          if (marca.checked) {
            if (elegidas.length >= disponibles) {
              marca.checked = false;
              window.alert('Una cancha puede tener hasta ' + MAXIMO + ' fotos.');
              return;
            }
            elegidas.push(f.id);
          } else {
            elegidas = elegidas.filter(function (x) { return x !== f.id; });
          }
          actualizar();
        });

        return h('div', { class: 'foto-elegible' },
          h('label', { class: 'foto-elegible-marco' },
            h('img', { class: 'cancha-foto', attrs: { src: f.url, alt: '', loading: 'lazy' } }),
            h('span', { class: 'foto-elegible-pie' }, marca, h('span', { text: 'Publicar' }), numero)),
          h('a', { class: 'foto-ampliar', text: 'Ver grande',
            attrs: { href: f.url, target: '_blank', rel: 'noopener noreferrer' } }));
      }

      var grupos = (c.aportes || []).map(function (a) {
        return h('div', { class: 'rep-bloque' },
          h('h3', { text: a.submitter_name || 'Cuenta borrada' }),
          h('p', { class: 'rep-suave', text: 'Mandó ' + (a.photos || []).length +
            ((a.photos || []).length === 1 ? ' foto' : ' fotos') + ' · ' + fecha(a.created_at) }),
          h('div', { class: 'foto-elegibles' }, (a.photos || []).map(foto)));
      });

      actualizar();

      return h('div', { class: 'rep-ficha' },
        h('div', { class: 'rep-ficha-cabecera' },
          h('div', null,
            h('h2', { text: c.name || 'Sin nombre' }),
            h('span', { class: 'rep-suave', text: c.address || 'Sin dirección' })),
          contador),
        c.publicadas ? h('p', { class: 'rep-alerta',
          text: 'Esta cancha ya tiene ' + c.publicadas + ' foto(s) publicadas: podés sumar ' + disponibles + ' más.' }) : null,
        grupos,
        decision(c, function () { return elegidas; }, botonPublicar));
    }

    // ── Publicar o descartar ──────────────────────────────────────────────

    function decision(c, obtenerElegidas, botonPublicar) {
      var motivoElegido = null;
      var detalle = h('textarea', { class: 'cancha-input',
        attrs: { rows: 3, placeholder: 'Información adicional para quienes las mandaron (opcional)' } });

      var opciones = h('div', { class: 'rep-opciones' });
      MOTIVOS.forEach(function (m) {
        var radio = h('input', { attrs: { type: 'radio', name: 'motivo-fotos' } });
        radio.value = m.id;
        radio.addEventListener('change', function () {
          motivoElegido = m.id;
          botonDescartar.disabled = false;
        });
        opciones.appendChild(h('label', { class: 'rep-opcion' }, radio,
          h('span', null, h('strong', { text: m.etiqueta }),
            h('span', { class: 'rep-suave', text: ' — ' + m.ayuda }))));
      });

      var avisar = h('input', { attrs: { type: 'checkbox' } });
      avisar.checked = true;
      var avisarFila = h('label', { class: 'rep-opcion cancha-avisar' }, avisar,
        h('span', null,
          h('strong', { text: 'Avisarles a quienes las mandaron' }),
          h('span', { class: 'rep-suave',
            text: ' — a quien no le elegiste ninguna le llega que se eligieron otras.' })));

      var botonDescartar = h('button', { class: 'boton-secundario', attrs: { type: 'button', disabled: true },
        text: 'Descartar todas', on: { click: descartar } });

      botonPublicar.addEventListener('click', publicar);

      async function publicar() {
        var elegidas = obtenerElegidas();
        if (estado.enviando || !elegidas.length) return;
        if (!window.confirm('Se publican ' + elegidas.length + (elegidas.length === 1 ? ' foto' : ' fotos') +
            ' en "' + (c.name || 'la cancha') + '" y se descarta el resto' +
            (avisar.checked ? '. Les llega un aviso a quienes las mandaron.' : ', sin avisarle a nadie.'))) return;

        estado.enviando = true;
        botonPublicar.disabled = true;
        var res = await ctx.sb.rpc('admin_resolver_fotos', {
          _court_id: c.court_id,
          _elegidas: elegidas,
          _notificar: avisar.checked,
        });
        estado.enviando = false;
        botonPublicar.disabled = false;
        if (estado.cancelado) return;

        if (res.error) {
          window.alert('No se pudieron publicar: ' + res.error.message);
          return;
        }
        mostrarOk('Fotos publicadas en "' + (c.name || 'la cancha') + '"' + (avisar.checked ? '.' : ', sin aviso.'));
        terminar();
      }

      async function descartar() {
        if (estado.enviando || !motivoElegido) return;
        if (!window.confirm(avisar.checked
            ? 'Se descartan todas las fotos y les llega el aviso con el motivo.'
            : 'Se descartan todas las fotos en silencio: no le llega nada a nadie.')) return;

        estado.enviando = true;
        botonDescartar.disabled = true;
        var res = await ctx.sb.rpc('admin_resolver_fotos', {
          _court_id: c.court_id,
          _elegidas: [],
          _motivo: motivoElegido,
          _detalle: detalle.value.trim() || null,
          _notificar: avisar.checked,
        });
        estado.enviando = false;
        botonDescartar.disabled = false;
        if (estado.cancelado) return;

        if (res.error) {
          window.alert('No se pudieron descartar: ' + res.error.message);
          return;
        }
        mostrarOk(avisar.checked ? 'Fotos descartadas.' : 'Fotos descartadas, sin aviso.');
        terminar();
      }

      function terminar() {
        estado.seleccionada = null;
        ctx.actualizarInsignias();
        cargarLista();
      }

      return h('div', { class: 'rep-bloque' },
        h('h3', { text: 'Decisión' }),
        avisarFila,
        h('p', { class: 'rep-suave', text: 'El orden en que las marcás es el orden en la cancha: la primera es la portada del mapa.' }),
        h('div', { class: 'cancha-acciones' }, botonPublicar),
        h('p', { class: 'rep-suave', text: 'O descartar todas, eligiendo un motivo:' }),
        opciones,
        detalle,
        h('div', { class: 'cancha-acciones' }, botonDescartar));
    }

    return function () {
      estado.cancelado = true;
      clearTimeout(temporizadorAviso);
    };
  }

  function insignia(ctx) {
    return ctx.sb.rpc('admin_fotos_aportadas').then(function (res) {
      return res.error ? null : (res.data || []).length;
    });
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'fotos', titulo: 'Fotos', render: render, insignia: insignia });
})();
