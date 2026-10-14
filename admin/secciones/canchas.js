// Sección Canchas: las propuestas que manda la gente desde el mapa.
//
// A la izquierda la cola, de la más vieja a la más nueva; a la derecha la
// ficha, que es directamente el formulario de edición. No hay un "editar":
// se revisa corrigiendo, y el botón de aceptar guarda lo que haya en pantalla.
// Es el caso normal —el nombre está bien pero la dirección quedó a medias— y
// obligar a rechazar por eso sería absurdo.
//
// admin_canchas_pendientes, admin_aprobar_cancha y admin_rechazar_cancha
// comprueban en la base que quien llama es admin. Lo de acá es solo para
// avisar antes y no mandar un pedido que va a fallar.

(function () {
  'use strict';

  var TIPOS = {
    indoor:  'Indoor',
    playa:   'Playa',
    cesped:  'Césped',
    cemento: 'Cemento',
  };

  var MOTIVOS = [
    { id: 'ya_existe',           etiqueta: 'Ya existe',
      ayuda: 'Esa cancha ya está en el mapa.' },
    { id: 'ubicacion_incorrecta', etiqueta: 'Ubicación incorrecta',
      ayuda: 'El punto no cae donde está la cancha.' },
    { id: 'no_es_cancha',        etiqueta: 'No es una cancha de vóley',
      ayuda: 'El lugar no corresponde.' },
    { id: 'faltan_datos',        etiqueta: 'Faltan datos',
      ayuda: 'No alcanza para poder cargarla.' },
    { id: 'privado_sin_permiso', etiqueta: 'Privada sin autorización',
      ayuda: 'Es un lugar privado y no tenemos permiso para publicarlo.' },
    { id: 'inapropiado',         etiqueta: 'Contenido inapropiado',
      ayuda: 'El nombre, la descripción o las fotos no van.' },
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

  function render(el, ctx) {
    var h = ctx.h;
    var estado = { lista: [], seleccionada: null, cancelado: false, enviando: false };
    var temporizadorAviso = null;

    el.appendChild(h('h1', { text: 'Canchas propuestas' }));
    el.appendChild(h('p', { class: 'bajada',
      text: 'De la más vieja a la más nueva. Se puede corregir cualquier campo antes de aceptar: se guarda lo que quede en pantalla.' }));

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

      var res = await ctx.sb.rpc('admin_canchas_pendientes');
      if (estado.cancelado) return;
      if (res.error) {
        colLista.replaceChildren(ctx.error('No se pudieron cargar las propuestas.', res.error));
        return;
      }

      estado.lista = res.data || [];
      dibujarLista();

      if (estado.lista.length) seleccionar(estado.lista[0].id);
      else colDetalle.replaceChildren(h('div', { class: 'tarjeta rep-vacio-ficha',
        text: 'No hay canchas esperando revisión.' }));
    }

    function dibujarLista() {
      colLista.replaceChildren();
      if (!estado.lista.length) {
        colLista.appendChild(h('p', { class: 'rep-vacio', text: 'Nada pendiente.' }));
        return;
      }
      estado.lista.forEach(function (c) {
        var item = h('button', {
          class: 'rep-item' + (estado.seleccionada === c.id ? ' activo' : ''),
          attrs: { type: 'button' },
          on: { click: function () { seleccionar(c.id); } },
        },
          h('div', { class: 'rep-item-cuerpo' },
            h('div', { class: 'rep-item-fila' },
              h('strong', { text: c.name || 'Sin nombre' }),
              h('span', { class: 'rep-suave', text: antiguedad(c.created_at) })),
            h('div', { class: 'rep-item-motivo rep-suave', text: c.address || 'Sin dirección' }),
            h('div', { class: 'rep-item-pie' },
              h('span', { class: 'rep-suave',
                text: (c.submitter_name || 'Cuenta borrada') +
                      (c.department_name ? ' · ' + c.department_name : '') }),
              !(c.photos && c.photos.length) ? null
                : h('span', { class: 'pastilla', text: c.photos.length + (c.photos.length === 1 ? ' foto' : ' fotos') })))
        );
        colLista.appendChild(item);
      });
    }

    function seleccionar(id) {
      estado.seleccionada = id;
      dibujarLista();
      var c = estado.lista.filter(function (x) { return x.id === id; })[0];
      colDetalle.replaceChildren(c ? ficha(c) : h('div', { class: 'tarjeta rep-vacio-ficha',
        text: 'Esa propuesta ya no está.' }));
    }

    // ── La ficha, que es el formulario ────────────────────────────────────

    function ficha(c) {
      var campos = {};
      var selector = selectorFotos(c);

      function texto(clave, etiqueta, valor, opciones) {
        var o = opciones || {};
        var input = h(o.largo ? 'textarea' : 'input', {
          class: 'cancha-input',
          attrs: o.largo ? { rows: 3 } : { type: o.tipo || 'text' },
        });
        input.value = valor == null ? '' : String(valor);
        campos[clave] = input;
        return h('label', { class: 'cancha-campo' },
          h('span', { class: 'cancha-etiqueta', text: etiqueta }), input);
      }

      function seleccion(clave, etiqueta, valor, opciones) {
        var sel = h('select', { class: 'cancha-input' });
        opciones.forEach(function (o) {
          var op = h('option', { text: o.etiqueta });
          op.value = o.valor;
          sel.appendChild(op);
        });
        sel.value = valor == null ? '' : String(valor);
        campos[clave] = sel;
        return h('label', { class: 'cancha-campo' },
          h('span', { class: 'cancha-etiqueta', text: etiqueta }), sel);
      }

      function marca(clave, etiqueta, valor) {
        var input = h('input', { attrs: { type: 'checkbox' } });
        input.checked = !!valor;
        campos[clave] = input;
        return h('label', { class: 'rep-opcion' }, input, h('span', { text: etiqueta }));
      }

      var tipos = [{ valor: '', etiqueta: 'Sin definir' }].concat(
        Object.keys(TIPOS).map(function (k) { return { valor: k, etiqueta: TIPOS[k] }; }));

      var mapa = (c.latitude != null && c.longitude != null)
        ? 'https://www.google.com/maps/search/?api=1&query=' + c.latitude + ',' + c.longitude
        : null;

      return h('div', { class: 'rep-ficha' },
        h('div', { class: 'rep-ficha-cabecera' },
          h('h2', { text: c.name || 'Sin nombre' }),
          h('span', { class: 'rep-item-pie',
            text: 'Propuesta por ' + (c.submitter_name || 'una cuenta borrada') + ' · ' + fecha(c.created_at) })),

        selector.nodo,

        h('div', { class: 'rep-bloque' },
          h('h3', { text: 'Datos' }),
          texto('name', 'Nombre', c.name),
          texto('address', 'Dirección', c.address),
          h('div', { class: 'cancha-fila' },
            texto('latitude', 'Latitud', c.latitude),
            texto('longitude', 'Longitud', c.longitude)),
          mapa && h('a', { class: 'cancha-enlace', text: 'Ver el punto en Google Maps',
            attrs: { href: mapa, target: '_blank', rel: 'noopener noreferrer' } }),
          h('div', { class: 'cancha-fila' },
            seleccion('court_type', 'Tipo', c.court_type, tipos),
            h('div', { class: 'cancha-campo' },
              h('span', { class: 'cancha-etiqueta', text: 'Departamento' }),
              h('div', { class: 'cancha-solo-lectura' + (c.department_name ? '' : ' vacio'),
                text: c.department_name || 'Ninguno: el punto parece estar fuera de Uruguay' }))),
          h('p', { class: 'cancha-ayuda',
            text: 'El departamento sale de la ubicación y se vuelve a calcular al aceptar. ' +
                  'Si está mal, lo que hay que corregir es el punto.' }),
          texto('surface_detail', 'Detalle de la superficie', c.surface_detail),
          texto('description', 'Descripción', c.description, { largo: true }),
          texto('notes', 'Notas', c.notes, { largo: true })),

        h('div', { class: 'rep-bloque' },
          h('h3', { text: 'Acceso' }),
          h('div', { class: 'rep-opciones' },
            marca('is_public', 'Es pública', c.is_public),
            marca('is_rentable', 'Se alquila', c.is_rentable),
            marca('has_scheduled_activity', 'Tiene actividad con horarios', c.has_scheduled_activity),
            marca('activity_is_free', 'La actividad es gratis', c.activity_is_free)),
          texto('rental_contact', 'Contacto para alquilar', c.rental_contact),
          texto('contact_instagram', 'Instagram', c.contact_instagram)),

        decision(c, campos, selector));
    }

    // Las fotos de la propuesta: arrancan todas marcadas, en el orden en que
    // llegaron. Desmarcar una la descarta; volver a marcarla la pone al final.
    // El número es el lugar en la cancha: la primera es la portada del mapa.
    //
    // elegidas() devuelve null si la base todavía no manda los ids (migración
    // 20261014140000 sin correr): en ese caso se publican todas, como antes.
    function selectorFotos(c) {
      var lista = c.fotos;
      if (!lista) {
        var urls = c.photos || [];
        return {
          elegidas: function () { return null; },
          total: urls.length,
          nodo: !urls.length
            ? h('p', { class: 'rep-suave', text: 'La propuesta no trae fotos.' })
            : h('div', { class: 'cancha-fotos' }, urls.map(function (u) {
                return h('a', { attrs: { href: u, target: '_blank', rel: 'noopener noreferrer' } },
                  h('img', { class: 'cancha-foto', attrs: { src: u, alt: '', loading: 'lazy' } }));
              })),
        };
      }
      if (!lista.length) {
        return { elegidas: function () { return []; }, total: 0,
          nodo: h('p', { class: 'rep-suave', text: 'La propuesta no trae fotos.' }) };
      }

      var elegidas = lista.map(function (f) { return f.id; });
      var numeros = {};
      var contador = h('span', { class: 'pastilla gris' });

      function actualizar() {
        contador.textContent = elegidas.length === lista.length
          ? 'Se publican todas'
          : elegidas.length === 0 ? 'No se publica ninguna'
          : 'Se publican ' + elegidas.length + ' de ' + lista.length;
        Object.keys(numeros).forEach(function (id) {
          var i = elegidas.indexOf(id);
          numeros[id].textContent = i >= 0 ? (i === 0 ? '1 · portada' : String(i + 1)) : '';
        });
      }

      var grilla = h('div', { class: 'foto-elegibles' }, lista.map(function (f) {
        var marca = h('input', { attrs: { type: 'checkbox' } });
        marca.checked = true;
        var numero = h('span', { class: 'foto-orden' });
        numeros[f.id] = numero;
        marca.addEventListener('change', function () {
          if (marca.checked) elegidas.push(f.id);
          else elegidas = elegidas.filter(function (x) { return x !== f.id; });
          actualizar();
        });
        return h('div', { class: 'foto-elegible' },
          h('label', { class: 'foto-elegible-marco' },
            h('img', { class: 'cancha-foto', attrs: { src: f.url, alt: '', loading: 'lazy' } }),
            h('span', { class: 'foto-elegible-pie' }, marca, h('span', { text: 'Publicar' }), numero)),
          h('a', { class: 'foto-ampliar', text: 'Ver grande',
            attrs: { href: f.url, target: '_blank', rel: 'noopener noreferrer' } }));
      }));

      actualizar();

      return {
        elegidas: function () { return elegidas.slice(); },
        total: lista.length,
        nodo: h('div', { class: 'rep-bloque' },
          h('div', { class: 'rep-ficha-cabecera' }, h('h3', { text: 'Fotos' }), contador),
          h('p', { class: 'rep-suave',
            text: 'Desmarcá las que no van. El orden en que quedan marcadas es el orden en la cancha.' }),
          grilla),
      };
    }

    // ── Aceptar o rechazar ────────────────────────────────────────────────

    function decision(c, campos, selector) {
      var motivoElegido = null;
      var detalle = h('textarea', { class: 'cancha-input',
        attrs: { rows: 3, placeholder: 'Información adicional para quien la propuso (opcional)' } });

      var opciones = h('div', { class: 'rep-opciones' });
      MOTIVOS.forEach(function (m) {
        var radio = h('input', { attrs: { type: 'radio', name: 'motivo-cancha' } });
        radio.value = m.id;
        radio.addEventListener('change', function () {
          motivoElegido = m.id;
          botonRechazar.disabled = false;
        });
        opciones.appendChild(h('label', { class: 'rep-opcion' }, radio,
          h('span', null, h('strong', { text: m.etiqueta }),
            h('span', { class: 'rep-suave', text: ' — ' + m.ayuda }))));
      });

      // Avisar es lo normal; el silencio se pide. Sirve cuando alguien manda
      // la misma cancha tres veces: se resuelve una avisando y las repetidas
      // se descartan calladas, para no mandarle tres avisos por lo mismo.
      var avisar = h('input', { attrs: { type: 'checkbox', id: 'cancha-avisar' } });
      avisar.checked = true;
      var avisarFila = h('label', { class: 'rep-opcion cancha-avisar' }, avisar,
        h('span', null,
          h('strong', { text: 'Avisarle a quien la propuso' }),
          h('span', { class: 'rep-suave',
            text: ' — sin esto, se resuelve en silencio y no le llega nada.' })));

      var botonAceptar = h('button', { attrs: { type: 'button' }, text: 'Aceptar y publicar',
        on: { click: aceptar } });
      var botonRechazar = h('button', { class: 'boton-secundario', attrs: { type: 'button', disabled: true },
        text: 'Rechazar', on: { click: rechazar } });

      async function aceptar() {
        if (estado.enviando) return;

        var nombre = campos.name.value.trim();
        if (!nombre) { window.alert('La cancha necesita un nombre.'); return; }

        var lat = parseFloat(campos.latitude.value);
        var lon = parseFloat(campos.longitude.value);
        if (isNaN(lat) || isNaN(lon)) {
          window.alert('Sin latitud y longitud la cancha no puede aparecer en el mapa.');
          return;
        }

        // La misma regla que la app exige al proponer. Acá se puede seguir
        // igual: puede ser una propuesta vieja, o un dato que se va a sumar.
        var pideContacto = campos.is_rentable.checked || campos.has_scheduled_activity.checked;
        if (pideContacto && !campos.rental_contact.value.trim() && !campos.contact_instagram.value.trim() &&
            !window.confirm('Se alquila o tiene actividad con horarios, pero no tiene teléfono ni Instagram: ' +
              'quien la vea en el mapa no va a tener a quién consultar. ¿Publicarla igual?')) return;

        var elegidas = selector.elegidas();
        var textoFotos = '';
        if (elegidas && selector.total) {
          textoFotos = elegidas.length === 0 ? ' Sin fotos: se descartan las ' + selector.total + '.'
            : elegidas.length < selector.total ? ' Con ' + elegidas.length + ' de las ' + selector.total + ' fotos; el resto se descarta.'
            : '';
        }

        if (!window.confirm('Se publica "' + nombre + '" en el mapa' +
            (avisar.checked ? ' y le llega el aviso a quien la propuso.' : ', sin avisarle a nadie.') +
            textoFotos)) return;

        estado.enviando = true;
        botonAceptar.disabled = true;
        var args = {
          _court_id: c.id,
          _notificar: avisar.checked,
          _campos: {
            name: nombre,
            address: campos.address.value.trim(),
            latitude: lat,
            longitude: lon,
            court_type: campos.court_type.value,
            surface_detail: campos.surface_detail.value.trim(),
            description: campos.description.value.trim(),
            notes: campos.notes.value.trim(),
            is_public: campos.is_public.checked,
            is_rentable: campos.is_rentable.checked,
            has_scheduled_activity: campos.has_scheduled_activity.checked,
            activity_is_free: campos.activity_is_free.checked,
            rental_contact: campos.rental_contact.value.trim(),
            contact_instagram: campos.contact_instagram.value.trim(),
          },
        };
        // Solo si la base ya sabe elegir fotos; si no, el parámetro no existe.
        if (elegidas) args._fotos = elegidas;
        var res = await ctx.sb.rpc('admin_aprobar_cancha', args);
        estado.enviando = false;
        botonAceptar.disabled = false;
        if (estado.cancelado) return;

        if (res.error) {
          window.alert('No se pudo aceptar: ' + res.error.message);
          return;
        }
        mostrarOk('"' + nombre + '" ya está en el mapa' + (avisar.checked ? '.' : ', sin aviso.'));
        terminar();
      }

      async function rechazar() {
        if (estado.enviando || !motivoElegido) return;
        if (!window.confirm(avisar.checked
            ? 'Se rechaza la propuesta y le llega el aviso con el motivo.'
            : 'Se rechaza la propuesta en silencio: no le llega nada.')) return;

        estado.enviando = true;
        botonRechazar.disabled = true;
        var res = await ctx.sb.rpc('admin_rechazar_cancha', {
          _court_id: c.id,
          _motivo: motivoElegido,
          _detalle: detalle.value.trim() || null,
          _notificar: avisar.checked,
        });
        estado.enviando = false;
        botonRechazar.disabled = false;
        if (estado.cancelado) return;

        if (res.error) {
          window.alert('No se pudo rechazar: ' + res.error.message);
          return;
        }
        mostrarOk(avisar.checked ? 'Propuesta rechazada.' : 'Propuesta rechazada, sin aviso.');
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
        h('div', { class: 'cancha-acciones' }, botonAceptar),
        h('p', { class: 'rep-suave', text: 'O rechazarla, eligiendo un motivo:' }),
        opciones,
        detalle,
        h('div', { class: 'cancha-acciones' }, botonRechazar));
    }

    return function () {
      estado.cancelado = true;
      clearTimeout(temporizadorAviso);
    };
  }

  // No hay una función de conteo aparte: la cola es corta y la misma consulta
  // que llena la sección sirve para el número del menú.
  function insignia(ctx) {
    return ctx.sb.rpc('admin_canchas_pendientes').then(function (res) {
      return res.error ? null : (res.data || []).length;
    });
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'canchas', titulo: 'Canchas', render: render, insignia: insignia });
})();
