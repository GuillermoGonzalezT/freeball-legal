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
  // Cada sección es { id, titulo, render(contenedor) }. Para sumar una nueva
  // alcanza con agregarla a esta lista: el menú y la navegación salen solos.

  var SECCIONES = [
    {
      id: 'inicio',
      titulo: 'Inicio',
      render: function (el) {
        el.appendChild(crear('h1', null, 'Inicio'));
        el.appendChild(crear('p', 'bajada', 'Panel de administración de FreeBall.'));
        var tarjeta = crear('div', 'tarjeta');
        tarjeta.appendChild(crear('h2', null, 'Todavía no hay secciones'));
        tarjeta.appendChild(crear('p', null,
          'Las herramientas de administración se van a ir sumando al menú de la izquierda.'));
        el.appendChild(tarjeta);
      },
    },
  ];

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
      var a = crear('a', null, s.titulo);
      a.href = '#' + s.id;
      a.dataset.seccion = s.id;
      menu.appendChild(a);
    });
  }

  function navegar() {
    var seccion = seccionActual();
    var contenido = $('contenido');
    contenido.replaceChildren();
    seccion.render(contenido);

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

  $('boton-salir').addEventListener('click', async function () {
    await cerrarSesion();
    mostrarVista('login');
  });

  // Si la sesión se pierde por su cuenta (token vencido que no se pudo
  // renovar), volver al login en vez de dejar un panel que ya no funciona.
  sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'SIGNED_OUT') mostrarVista('login');
  });

  // ── Arranque ────────────────────────────────────────────────────────────

  (async function () {
    var res = await sb.auth.getSession();
    var session = res.data && res.data.session;
    if (session) await entrar(session);
    else mostrarVista('login');
  })();
})();
