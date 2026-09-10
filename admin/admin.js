// Panel de administración de FreeBall.
//
// Esta página es pública: cualquiera puede abrirla y leer este archivo. Lo que
// hace acá es solo interfaz. Quién es admin lo decide la base (soy_admin()), y
// cada acción de administración tiene que volver a comprobarlo en el servidor.
// La clave anon es pública por diseño —es la misma que va dentro de la app—;
// la service_role nunca puede aparecer en este repositorio.

(function () {
  'use strict';

  var SUPABASE_URL = 'https://yviubkfezjllaarbshdo.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2aXVia2ZlempsbGFhcmJzaGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MDI3NTAsImV4cCI6MjA5ODA3ODc1MH0.A1VRnVGQm1-Omw-jcJUUs2E7yj4e8wZytXd9qioVrZc';

  // La sesión vive en sessionStorage: se va al cerrar la pestaña. En una
  // compu prestada no queda nadie logueado como admin por olvido.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.sessionStorage,
      storageKey: 'freeball-admin',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  // ── Secciones ───────────────────────────────────────────────────────────
  // Cada sección vive en su archivo de admin/secciones/ y se anota en
  // window.ADMIN_SECCIONES como { id, titulo, render(contenedor, ctx) }. Esos
  // archivos se cargan ANTES que este (ver index.html). render puede devolver
  // una función de limpieza, que se llama al salir de la sección.
  //
  // Para sumar una sección: crear el archivo y agregar su <script>. El menú y
  // la navegación salen solos, en el orden de los <script>.

  var SECCIONES = window.ADMIN_SECCIONES || [];
  var limpiarSeccion = null;

  // ── Utilidades ──────────────────────────────────────────────────────────

  var $ = function (id) { return document.getElementById(id); };

  // Todo el texto entra con textContent, nunca con innerHTML: cuando las
  // secciones muestren datos de usuarios (nombres, reportes), un nombre con
  // HTML adentro no puede ejecutar nada en la sesión de un admin.
  function crear(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto != null) el.textContent = texto;
    return el;
  }

  // Para armar bloques anidados sin una línea por elemento, con la misma
  // regla: el texto siempre como texto.
  //   h('div', { class: 'x', on: { click: fn } }, 'texto', h('b', null, 'hijo'))
  // props: class, text, title, attrs (atributos sueltos), on (eventos).
  // Los hijos null o false se ignoran, para poder escribir cond && h(...).
  function h(tag, props) {
    var el = document.createElement(tag);
    var p = props || {};
    if (p.class) el.className = p.class;
    if (p.text != null) el.textContent = p.text;
    if (p.title) el.title = p.title;
    if (p.attrs) Object.keys(p.attrs).forEach(function (k) {
      if (p.attrs[k] != null && p.attrs[k] !== false) el.setAttribute(k, p.attrs[k] === true ? '' : p.attrs[k]);
    });
    if (p.on) Object.keys(p.on).forEach(function (k) { el.addEventListener(k, p.on[k]); });
    for (var i = 2; i < arguments.length; i++) agregarHijo(el, arguments[i]);
    return el;
  }
  function agregarHijo(el, hijo) {
    if (hijo == null || hijo === false) return;
    if (Array.isArray(hijo)) { hijo.forEach(function (x) { agregarHijo(el, x); }); return; }
    el.appendChild(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }

  // Recuadro de error para las secciones. El detalle técnico va a la consola,
  // no a la pantalla.
  function cajaError(mensaje, error) {
    if (error) console.error(mensaje, error);
    var caja = crear('div', 'aviso', mensaje + ' Probá recargar la página.');
    return caja;
  }

  // Número al lado de cada sección en el menú. Una sección lo ofrece
  // definiendo insignia(ctx), que devuelve una promesa con un número; 0 o
  // null no muestra nada. Las secciones llaman a actualizarInsignias()
  // cuando algo cambió (por ejemplo, al resolver un reporte).
  function actualizarInsignias() {
    SECCIONES.forEach(function (s) {
      if (typeof s.insignia !== 'function') return;
      var a = $('menu').querySelector('[data-seccion="' + s.id + '"]');
      if (!a) return;
      Promise.resolve(s.insignia(ctx)).then(function (n) {
        var badge = a.querySelector('.insignia');
        if (!n) { if (badge) badge.remove(); return; }
        if (!badge) { badge = crear('span', 'insignia'); a.appendChild(badge); }
        badge.textContent = String(n);
      }).catch(function (e) { console.error('Insignia de ' + s.id, e); });
    });
  }

  // Lo que recibe cada sección para trabajar.
  var ctx = { sb: sb, crear: crear, h: h, error: cajaError, actualizarInsignias: actualizarInsignias };

  function mostrarVista(nombre) {
    $('vista-cargando').hidden = nombre !== 'cargando';
    $('vista-login').hidden = nombre !== 'login';
    $('vista-panel').hidden = nombre !== 'panel';
  }

  function mostrarError(mensaje) {
    var aviso = $('login-error');
    aviso.textContent = mensaje || '';
    aviso.hidden = !mensaje;
  }

  function traducirError(error) {
    var m = (error && error.message) || '';
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/email not confirmed/i.test(m)) return 'Esa cuenta todavía no confirmó su correo.';
    if (/fetch|network/i.test(m)) return 'No se pudo conectar. Revisá tu conexión.';
    return 'No se pudo iniciar sesión. Probá de nuevo.';
  }

  // ── Sesión ──────────────────────────────────────────────────────────────

  async function esAdmin() {
    var res = await sb.rpc('soy_admin');
    if (res.error) throw res.error;
    return res.data === true;
  }

  // scope 'local': cierra solo esta sesión. El valor por defecto es global y
  // también desconectaría la app del teléfono.
  function cerrarSesion() {
    return sb.auth.signOut({ scope: 'local' });
  }

  async function entrar(session) {
    var admin;
    try {
      admin = await esAdmin();
    } catch (e) {
      await cerrarSesion();
      mostrarVista('login');
      mostrarError('No se pudo verificar el acceso. Probá de nuevo en un rato.');
      return;
    }

    if (!admin) {
      await cerrarSesion();
      mostrarVista('login');
      mostrarError('Esta cuenta no tiene acceso al panel.');
      return;
    }

    $('usuario-email').textContent = session.user.email || '';
    armarMenu();
    navegar();
    mostrarVista('panel');
  }

  // ── Navegación ──────────────────────────────────────────────────────────
  // Por hash (#inicio), así cada sección tiene su dirección y el botón de
  // atrás del navegador funciona sin servidor.

  function seccionActual() {
    var id = location.hash.replace(/^#/, '');
    return SECCIONES.find(function (s) { return s.id === id; }) || SECCIONES[0];
  }

  function armarMenu() {
    var menu = $('menu');
    menu.replaceChildren();
    SECCIONES.forEach(function (s) {
      var a = crear('a');
      a.appendChild(crear('span', null, s.titulo));
      a.href = '#' + s.id;
      a.dataset.seccion = s.id;
      menu.appendChild(a);
    });
    actualizarInsignias();
  }

  function navegar() {
    if (limpiarSeccion) limpiarSeccion();
    limpiarSeccion = null;

    var contenido = $('contenido');
    contenido.replaceChildren();

    var seccion = seccionActual();
    if (!seccion) {
      contenido.appendChild(crear('p', 'bajada', 'Todavía no hay secciones.'));
      return;
    }

    // Un contenedor nuevo por visita: si la sección todavía está cargando
    // datos cuando se sale de ella, escribe en un elemento que ya no está en
    // la página y no pisa a la sección nueva.
    var el = crear('div');
    contenido.appendChild(el);
    var limpiar = seccion.render(el, ctx);
    if (typeof limpiar === 'function') limpiarSeccion = limpiar;

    Array.prototype.forEach.call($('menu').children, function (a) {
      if (a.dataset.seccion === seccion.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  window.addEventListener('hashchange', function () {
    if (!$('vista-panel').hidden) navegar();
  });

  // ── Eventos ─────────────────────────────────────────────────────────────

  $('form-login').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    mostrarError('');

    var email = $('email').value.trim();
    var pass = $('pass').value;
    if (!email || !pass) {
      mostrarError('Completá el correo y la contraseña.');
      return;
    }

    var boton = $('login-boton');
    boton.disabled = true;
    boton.textContent = 'Ingresando…';

    var res = await sb.auth.signInWithPassword({ email: email, password: pass });

    boton.disabled = false;
    boton.textContent = 'Ingresar';

    if (res.error) {
      mostrarError(traducirError(res.error));
      return;
    }
    $('pass').value = '';
    await entrar(res.data.session);
  });

  function salirDelPanel() {
    if (limpiarSeccion) limpiarSeccion();
    limpiarSeccion = null;
    $('contenido').replaceChildren();
    mostrarVista('login');
  }

  $('boton-salir').addEventListener('click', async function () {
    await cerrarSesion();
    salirDelPanel();
  });

  // Si la sesión se pierde por su cuenta (token vencido que no se pudo
  // renovar), volver al login en vez de dejar un panel que ya no funciona.
  sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'SIGNED_OUT') salirDelPanel();
  });

  // ── Arranque ────────────────────────────────────────────────────────────

  (async function () {
    var res = await sb.auth.getSession();
    var session = res.data && res.data.session;
    if (session) await entrar(session);
    else mostrarVista('login');
  })();
})();
