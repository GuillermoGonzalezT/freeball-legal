// Sección Analytics: números generales y evolución de cuentas y Premium.
//
// Los datos salen de admin_analytics_resumen() y admin_analytics_serie(), que
// comprueban en la base que quien pregunta es admin.

(function () {
  'use strict';

  var fmtNum = new Intl.NumberFormat('es-UY');
  var fmtPct = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1, signDisplay: 'always' });

  var COLOR_CUENTAS = '#5AAFC7';
  var COLOR_PREMIUM = '#E0A526';

  // Se recuerda el período elegido mientras la pestaña siga abierta, para no
  // volver a "7 días" cada vez que se entra a la sección.
  var rangoElegido = '7d';

  // ── Fechas ──────────────────────────────────────────────────────────────
  // Las fechas viajan como 'AAAA-MM-DD' y ya vienen cortadas a la hora de
  // Uruguay por la base. Acá se tratan como UTC para que el huso de la compu
  // no corra ningún día.

  function aFecha(s) { return new Date(s + 'T00:00:00Z'); }
  function aTexto(d) { return d.toISOString().slice(0, 10); }
  function sumarDias(s, n) { var d = aFecha(s); d.setUTCDate(d.getUTCDate() + n); return aTexto(d); }
  function diasEntre(a, b) { return Math.round((aFecha(b) - aFecha(a)) / 864e5); }
  function formatear(s, opciones) {
    return aFecha(s).toLocaleDateString('es-UY', Object.assign({ timeZone: 'UTC' }, opciones));
  }
  function fechaLarga(s) {
    return formatear(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fechaCorta(s) {
    return formatear(s, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Períodos ────────────────────────────────────────────────────────────
  // Cada período pide un punto extra al principio —el total del día anterior
  // al período— para poder decir cuánto cambió DURANTE el período.

  function armarRangos(resumen) {
    var hoy = resumen.hoy;
    var lista = [
      { id: '7d',  etiqueta: '7 días',  desde: sumarDias(hoy, -7),  hasta: hoy, paso: 'day' },
      { id: '30d', etiqueta: '30 días', desde: sumarDias(hoy, -30), hasta: hoy, paso: 'day' },
    ];

    // Un botón por año calendario, desde el año del primer dato. El año en
    // curso llega hasta hoy, no hasta el 31 de diciembre.
    var anioHoy = Number(hoy.slice(0, 4));
    var anioPrimero = resumen.primer_dia ? Number(resumen.primer_dia.slice(0, 4)) : anioHoy;
    for (var y = anioPrimero; y <= anioHoy; y++) {
      var fin = y + '-12-31';
      lista.push({
        id: 'y' + y, etiqueta: String(y),
        desde: (y - 1) + '-12-31', hasta: fin < hoy ? fin : hoy, paso: 'day',
      });
    }

    // Histórico: el paso se agranda con el tiempo para que la gráfica no se
    // vuelva ilegible.
    var inicio = sumarDias(resumen.primer_dia || hoy, -1);
    var span = diasEntre(inicio, hoy);
    lista.push({
      id: 'todo', etiqueta: 'Histórico', desde: inicio, hasta: hoy,
      paso: span <= 92 ? 'day' : span <= 731 ? 'week' : 'month',
    });

    return lista;
  }

  function etiquetaEje(dia, rango) {
    if (rango.paso === 'month') return formatear(dia, { month: 'short', year: 'numeric' });
    if (rango.paso === 'week') return formatear(dia, { day: 'numeric', month: 'short', year: '2-digit' });
    return formatear(dia, { day: 'numeric', month: 'short' });
  }

  // ── Cálculos ────────────────────────────────────────────────────────────

  // Cuánto cambió entre el primer y el último valor con datos del período.
  function variacion(puntos, clave) {
    var conDatos = puntos.filter(function (p) { return p[clave] != null; });
    if (!conDatos.length) return null;
    var inicial = conDatos[0][clave];
    var final = conDatos[conDatos.length - 1][clave];
    return {
      final: final,
      diferencia: final - inicial,
      porcentaje: inicial > 0 ? ((final - inicial) / inicial) * 100 : null,
      desde: conDatos[0].dia,
    };
  }

  // ── Render ──────────────────────────────────────────────────────────────

  function render(el, ctx) {
    var crear = ctx.crear;
    var graficas = [];
    var cancelado = false;

    function destruirGraficas() {
      graficas.forEach(function (g) { g.destroy(); });
      graficas = [];
    }

    el.appendChild(crear('h1', null, 'Analytics'));
    var bajada = crear('p', 'bajada', 'Cargando…');
    el.appendChild(bajada);

    ctx.sb.rpc('admin_analytics_resumen').then(function (res) {
      if (cancelado) return;
      if (res.error) {
        bajada.textContent = '';
        el.appendChild(ctx.error('No se pudieron cargar los datos.', res.error));
        return;
      }
      var resumen = res.data;
      bajada.textContent = 'Datos al ' + fechaCorta(resumen.hoy) + ', hora de Uruguay.';

      el.appendChild(tarjetasResumen(resumen));

      var rangos = armarRangos(resumen);
      if (!rangos.some(function (r) { return r.id === rangoElegido; })) rangoElegido = '7d';

      var selector = crear('div', 'segmentos');
      selector.setAttribute('role', 'group');
      selector.setAttribute('aria-label', 'Período');
      rangos.forEach(function (r) {
        var b = crear('button', null, r.etiqueta);
        b.type = 'button';
        b.dataset.rango = r.id;
        b.addEventListener('click', function () {
          if (rangoElegido === r.id) return;
          rangoElegido = r.id;
          marcarSelector();
          cargarSerie();
        });
        selector.appendChild(b);
      });
      el.appendChild(selector);

      function marcarSelector() {
        Array.prototype.forEach.call(selector.children, function (b) {
          b.setAttribute('aria-pressed', String(b.dataset.rango === rangoElegido));
        });
      }
      marcarSelector();

      var zonaGraficas = crear('div', 'graficas');
      el.appendChild(zonaGraficas);

      // Si se cambia de período dos veces rápido, solo vale la última
      // respuesta; las anteriores pueden llegar después y se descartan.
      var pedido = 0;

      function cargarSerie() {
        var rango = rangos.find(function (r) { return r.id === rangoElegido; });
        var este = ++pedido;
        zonaGraficas.classList.add('actualizando');

        ctx.sb.rpc('admin_analytics_serie', {
          _desde: rango.desde, _hasta: rango.hasta, _paso: rango.paso,
        }).then(function (res) {
          if (cancelado || este !== pedido) return;
          zonaGraficas.classList.remove('actualizando');
          destruirGraficas();
          zonaGraficas.replaceChildren();

          if (res.error) {
            zonaGraficas.appendChild(ctx.error('No se pudo cargar la evolución.', res.error));
            return;
          }
          var puntos = res.data || [];

          zonaGraficas.appendChild(tarjetaGrafica({
            titulo: 'Cuentas', unidad: 'cuentas', clave: 'cuentas', color: COLOR_CUENTAS,
            puntos: puntos, rango: rango,
          }));

          var notaPremium = null;
          if (resumen.premium_desde && resumen.premium_desde > rango.desde) {
            notaPremium = 'El registro de Premium empezó el ' + fechaCorta(resumen.premium_desde) +
              '. Antes de esa fecha no hay datos.';
          }
          zonaGraficas.appendChild(tarjetaGrafica({
            titulo: 'Premium', unidad: 'Premium', clave: 'premium', color: COLOR_PREMIUM,
            puntos: puntos, rango: rango, nota: notaPremium,
          }));
        });
      }

      cargarSerie();
    });

    function tarjetasResumen(r) {
      var pctPremium = r.cuentas > 0
        ? new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 }).format((r.premium / r.cuentas) * 100) + ' % de las cuentas'
        : '—';

      var datos = [
        { titulo: 'Cuentas',          valor: r.cuentas,          detalle: 'Creadas, sin contar las borradas' },
        { titulo: 'Premium',          valor: r.premium,          detalle: pctPremium },
        { titulo: 'Partidos activos', valor: r.partidos_activos, detalle: 'Abiertos ahora' },
        { titulo: 'Partidos jugados', valor: r.partidos_jugados, detalle: 'Desde el inicio' },
      ];

      var grilla = crear('div', 'kpis');
      datos.forEach(function (d) {
        var t = crear('div', 'tarjeta kpi');
        t.appendChild(crear('div', 'kpi-titulo', d.titulo));
        t.appendChild(crear('div', 'kpi-valor', fmtNum.format(d.valor)));
        t.appendChild(crear('div', 'kpi-detalle', d.detalle));
        grilla.appendChild(t);
      });
      return grilla;
    }

    function tarjetaGrafica(o) {
      var t = crear('div', 'tarjeta grafica');
      var cabecera = crear('div', 'grafica-cabecera');
      cabecera.appendChild(crear('h2', null, o.titulo));

      var v = variacion(o.puntos, o.clave);
      var linea = crear('div', 'grafica-resumen');
      if (!v) {
        linea.appendChild(crear('span', 'grafica-sin-datos', 'Sin datos en este período'));
      } else {
        linea.appendChild(crear('span', 'grafica-valor', fmtNum.format(v.final)));
        var sentido = v.diferencia > 0 ? 'sube' : v.diferencia < 0 ? 'baja' : 'igual';
        var flecha = sentido === 'sube' ? '▲ ' : sentido === 'baja' ? '▼ ' : '';
        var texto = 'Sin cambios';
        if (sentido !== 'igual') {
          texto = flecha + (v.diferencia > 0 ? '+' : '') + fmtNum.format(v.diferencia);
          if (v.porcentaje != null) texto += ' (' + fmtPct.format(v.porcentaje) + ' %)';
        }
        linea.appendChild(crear('span', 'variacion ' + sentido, texto));
        linea.appendChild(crear('span', 'grafica-desde', 'respecto al ' + fechaCorta(v.desde)));
      }
      cabecera.appendChild(linea);
      t.appendChild(cabecera);

      var lienzo = crear('div', 'grafica-lienzo');
      var canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Evolución de ' + o.titulo.toLowerCase());
      lienzo.appendChild(canvas);
      t.appendChild(lienzo);

      if (o.nota) t.appendChild(crear('p', 'grafica-nota', o.nota));

      graficas.push(new window.Chart(canvas, {
        type: 'line',
        data: {
          labels: o.puntos.map(function (p) { return etiquetaEje(p.dia, o.rango); }),
          datasets: [{
            data: o.puntos.map(function (p) { return p[o.clave]; }),
            borderColor: o.color,
            backgroundColor: o.color + '22',
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            // Con muchos puntos se dibuja solo la línea. Un punto suelto —el
            // primer día de datos de Premium, por ejemplo— no tiene línea que
            // lo muestre, así que ese sí se dibuja.
            pointRadius: function (c) {
              var d = c.dataset.data, i = c.dataIndex;
              if (d.length <= 40) return 3;
              var suelto = d[i] != null &&
                (i === 0 || d[i - 1] == null) && (i === d.length - 1 || d[i + 1] == null);
              return suelto ? 3 : 0;
            },
            pointHoverRadius: 5,
            pointBackgroundColor: o.color,
            spanGaps: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: function (items) { return fechaLarga(o.puntos[items[0].dataIndex].dia); },
                label: function (item) { return ' ' + fmtNum.format(item.parsed.y) + ' ' + o.unidad; },
              },
            },
          },
          scales: {
            // Desde cero a propósito: con números chicos, un eje recortado
            // hace que pasar de 10 a 11 parezca una explosión.
            y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#EEF2F7' } },
            x: { ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkip: true }, grid: { display: false } },
          },
        },
      }));

      return t;
    }

    // Lo llama el panel al salir de la sección.
    return function () {
      cancelado = true;
      destruirGraficas();
    };
  }

  if (window.Chart) {
    window.Chart.defaults.font.family = "'Poppins', -apple-system, 'Segoe UI', Roboto, sans-serif";
    window.Chart.defaults.color = '#6B7A99';
  }

  window.ADMIN_SECCIONES = window.ADMIN_SECCIONES || [];
  window.ADMIN_SECCIONES.push({ id: 'analytics', titulo: 'Analytics', render: render });
})();
