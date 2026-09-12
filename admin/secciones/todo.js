// Sección TO-DO: la lista de pendientes del proyecto.
//
// Reemplaza el bloc de notas. Todo vive en admin_todos y pasa por funciones
// que comprueban que quien llama es admin.
//
// Cada cambio va a la base y después se recarga la lista entera: son decenas
// de ítems, no miles, y así nunca se ve algo distinto de lo que quedó
// guardado.

(function () {
  'use strict';

  var TZ = 'America/Montevideo';
  var fmtFecha = new Intl.DateTimeFormat('es-UY', { timeZone: TZ, day: 'numeric', month: 'short' });
  function fecha(s) { return s ? fmtFecha.format(new Date(s)) : ''; }

  function render(el, ctx) {
    var h = ctx.h;
    var estado = { items: [], lista: null, verHechas: false, cancelado: false, guardando: false };

    el.appendChild(h('h1', { text: 'TO-DO' }));
    el.appendChild(h('p', { class: 'bajada',
      text: 'Lo que falta hacer. Las destacadas van arriba; las hechas, al final.' }));

    // ── Alta ──────────────────────────────────────────────────────────────
    var inputTexto = h('input', { attrs: { type: 'text', placeholder: 'Qué falta hacer', maxlength: 500 } });
    var inputLista = h('input', { attrs: { type: 'text', placeholder: 'Lista', maxlength: 40,
      list: 'todo-listas', value: 'General' } });
    var datalist = h('datalist', { attrs: { id: 'todo-listas' } });
    var botonAgregar = h('button', { attrs: { type: 'submit' }, text: 'Agregar' });

    var formAlta = h('form', { class: 'todo-alta' }, inputTexto, inputLista, datalist, botonAgregar);
    formAlta.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var texto = inputTexto.value.trim();
      if (!texto) return;
      guardar({ _texto: texto, _lista: inputLista.value.trim() || 'General' }, function () {
        inputTexto.value = '';
        inputTexto.focus();
      });
    });
    el.appendChild(formAlta);

    // ── Filtros ───────────────────────────────────────────────────────────
    var filtros = h('div', { class: 'segmentos', attrs: { role: 'group', 'aria-label': 'Listas' } });
    var chkHechas = h('input', { attrs: { type: 'checkbox' } });
    chkHechas.addEventListener('change', function () { estado.verHechas = chkHechas.checked; dibujar(); });
    var contador = h('span', { class: 'rep-suave' });

    el.appendChild(h('div', { class: 'todo-barra' },
      filtros,
      h('label', { class: 'rep-check' }, chkHechas, 'Ver las hechas'),
      contador));

    var error = h('div', { class: 'aviso', attrs: { hidden: true } });
    el.appendChild(error);

    var contenedor = h('div', { class: 'todo-contenedor' });
    el.appendChild(contenedor);

    cargar();

    // ── Datos ─────────────────────────────────────────────────────────────

    async function cargar() {
      var res = await ctx.sb.rpc('admin_todos_lista');
      if (estado.cancelado) return;
      if (res.error) {
        contenedor.replaceChildren(ctx.error('No se pudo cargar la lista.', res.error));
        return;
      }
      estado.items = res.data || [];
      dibujar();
    }

    function fallo(e) {
      console.error(e);
      error.textContent = e && e.code === 'P0001' ? e.message : 'No se pudo guardar. Probá de nuevo.';
      error.hidden = false;
    }

    async function guardar(args, despues) {
      if (estado.guardando) return;
      estado.guardando = true;
      error.hidden = true;
      var res = await ctx.sb.rpc('admin_todo_guardar', args);
      estado.guardando = false;
      if (estado.cancelado) return;
      if (res.error) { fallo(res.error); return; }
      if (despues) despues();
      cargar();
    }

    async function borrar(item) {
      if (!window.confirm('¿Borrar "' + item.texto + '"?')) return;
      error.hidden = true;
      var res = await ctx.sb.rpc('admin_todo_borrar', { _id: item.id });
      if (estado.cancelado) return;
      if (res.error) { fallo(res.error); return; }
      cargar();
    }

    // ── Pintado ───────────────────────────────────────────────────────────

    function dibujar() {
      var listas = [];
      estado.items.forEach(function (t) {
        if (listas.indexOf(t.lista) === -1) listas.push(t.lista);
      });
      listas.sort();

      // Sugerencias para el campo de alta.
      datalist.replaceChildren();
      listas.forEach(function (l) { datalist.appendChild(h('option', { attrs: { value: l } })); });

      // Un filtro por lista, con cuántas pendientes tiene cada una.
      if (estado.lista && listas.indexOf(estado.lista) === -1) estado.lista = null;
      filtros.replaceChildren();
      [null].concat(listas).forEach(function (l) {
        var pendientes = estado.items.filter(function (t) {
          return !t.hecho && (l === null || t.lista === l);
        }).length;
        var b = h('button', { attrs: { type: 'button', 'aria-pressed': String(estado.lista === l) },
          text: (l === null ? 'Todas' : l) + ' (' + pendientes + ')' });
        b.addEventListener('click', function () { estado.lista = l; dibujar(); });
        filtros.appendChild(b);
      });

      var visibles = estado.items.filter(function (t) {
        if (estado.lista !== null && t.lista !== estado.lista) return false;
        return estado.verHechas || !t.hecho;
      });

      var delFiltro = estado.items.filter(function (t) {
        return estado.lista === null || t.lista === estado.lista;
      });
      var hechas = delFiltro.filter(function (t) { return t.hecho; }).length;
      contador.textContent = delFiltro.length
        ? hechas + ' de ' + delFiltro.length + (delFiltro.length === 1 ? ' hecha' : ' hechas')
        : '';

      contenedor.replaceChildren();
      if (!visibles.length) {
        contenedor.appendChild(h('p', { class: 'rep-vacio',
          text: estado.items.length ? 'Nada pendiente por acá.' : 'Todavía no hay nada anotado.' }));
        return;
      }

      // Agrupadas por lista, salvo que ya se esté filtrando por una.
      var grupos = estado.lista !== null ? [estado.lista] : listas;
      grupos.forEach(function (l) {
        var delGrupo = visibles.filter(function (t) { return t.lista === l; });
        if (!delGrupo.length) return;
        contenedor.appendChild(h('div', { class: 'todo-grupo' },
          estado.lista === null && h('h2', { class: 'todo-grupo-titulo', text: l }),
          h('ul', { class: 'todo-items' }, delGrupo.map(fila))));
      });
    }

    function fila(t) {
      var chk = h('input', { attrs: { type: 'checkbox', checked: t.hecho } });
      chk.addEventListener('change', function () {
        guardar({ _id: t.id, _hecho: chk.checked });
      });

      var texto = h('span', { class: 'todo-texto', text: t.texto });

      var estrella = h('button', {
        class: 'todo-icono' + (t.destacado ? ' activo' : ''),
        attrs: { type: 'button', title: t.destacado ? 'Quitar de destacadas' : 'Destacar' },
        text: t.destacado ? '★' : '☆',
      });
      estrella.addEventListener('click', function () {
        guardar({ _id: t.id, _destacado: !t.destacado });
      });

      var editar = h('button', { class: 'todo-icono', attrs: { type: 'button', title: 'Editar' }, text: '✎' });
      editar.addEventListener('click', function () { editarEnLinea(t, texto); });

      var borrarBtn = h('button', { class: 'todo-icono', attrs: { type: 'button', title: 'Borrar' }, text: '×' });
      borrarBtn.addEventListener('click', function () { borrar(t); });

      return h('li', { class: 'todo-item' + (t.hecho ? ' hecha' : '') },
        h('label', { class: 'todo-check' }, chk),
        texto,
        t.hecho && t.done_at && h('span', { class: 'rep-suave todo-fecha', text: fecha(t.done_at) }),
        h('div', { class: 'todo-acciones' }, estrella, editar, borrarBtn));
    }

    // Editar en el lugar: el texto se convierte en un campo y vuelve a ser
    // texto al guardar, al apretar Escape o al perder el foco.
    function editarEnLinea(t, texto) {
      var input = h('input', { class: 'todo-editar', attrs: { type: 'text', value: t.texto, maxlength: 500 } });
      texto.replaceWith(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      var cerrado = false;
      function terminar(guardarlo) {
        if (cerrado) return;
        cerrado = true;
        var nuevo = input.value.trim();
        if (guardarlo && nuevo && nuevo !== t.texto) guardar({ _id: t.id, _texto: nuevo });
        else input.replaceWith(texto);
      }
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') terminar(true);
        if (ev.key === 'Escape') terminar(false);
      });
      input.addEventListener('blur', function () { terminar(true); });
    }

    return function () { estado.cancelado = true; };
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'todo', titulo: 'TO-DO', render: render });
})();
