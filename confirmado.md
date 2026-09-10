---
title: Cuenta confirmada
permalink: /confirmado/
---

<!--
  Destino de los correos de confirmación de Supabase (Authentication → URL
  Configuration → Site URL). No está enlazada desde el índice a propósito: solo
  se llega desde el correo.

  Supabase agrega al final de la URL los tokens de la sesión recién creada
  (#access_token=...&refresh_token=...). Esta página no los usa para nada, así
  que el script los borra de la barra de direcciones y del historial: no tiene
  sentido dejar un token de sesión guardado en el navegador de alguien.

  Si el enlace venció o ya se usó, Supabase manda en cambio #error=...; en ese
  caso se muestra otro mensaje, porque decir "tu cuenta quedó confirmada"
  cuando no es cierto sería peor que no decir nada.
-->

<div id="ok" markdown="1">

# ¡Listo, tu cuenta quedó confirmada!

Ya podés volver a **FreeBall** e iniciar sesión con tu correo y tu contraseña.

Disfrutá de la app. 🏐

</div>

<div id="error" style="display:none" markdown="1">

# Este enlace ya no es válido

Puede que ya lo hayas usado antes, o que haya vencido.

**Probá iniciar sesión en FreeBall**: si tu cuenta ya estaba confirmada, vas a
poder entrar normalmente.

Si no podés, escribinos a [appfreeball@gmail.com](mailto:appfreeball@gmail.com)
y lo resolvemos.

</div>

<script>
  (function () {
    var hash = window.location.hash || '';

    if (hash.indexOf('error') !== -1) {
      document.getElementById('ok').style.display = 'none';
      document.getElementById('error').style.display = 'block';
    }

    // Sacar los tokens de la URL sin recargar la página.
    if (hash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  })();
</script>
