/* ============================================
   AZUCAPP - Lógica principal
============================================ */

(function() {
'use strict';

// ============================================
// CONFIGURACIÓN
// ============================================
const SUPABASE_URL = 'https://vbnucvzjlcghrmqxjldp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VGfoUAU6e0zlXzkY2y8iBw_lYeOKU7K';

const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const LOCAL_LABELS = {
  '1-AZUCA': 'Azuca',
  '2-AZAFRAN': 'Azafrán',
  '3-NIETO': 'Nieto Senetiner',
  '4-VIÑA COBOS': 'Viña Cobos',
  '5-TRAPICHE': 'Espacio Trapiche',
  'VINOBIEN': 'Vinobien'
};

const TIPOS_INCIDENCIA = {
  tardanza: '⏰ Llegada tarde',
  ausencia: '❌ Ausencia',
  enfermedad: '🤒 Enfermedad',
  cambio_turno: '🔄 Cambio de turno',
  otro: '📝 Otro'
};

// ============================================
// ESTADO GLOBAL
// ============================================
let currentUser = null;
let currentEmpleado = null;   // Datos del colaborador vinculado al usuario
let semanaActual = null;      // Lunes de la semana visible (formato YYYY-MM-DD)

// ============================================
// HELPERS - API
// ============================================
async function api(path, options = {}) {
  const opts = {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers || {})
    },
    ...options
  };

  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, opts);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('API error ' + res.status + ': ' + txt);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ============================================
// HELPERS - Hash y sesión
// ============================================
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function saveSession(user) {
  localStorage.setItem('azucapp_user', JSON.stringify(user));
}

function loadSession() {
  try {
    const raw = localStorage.getItem('azucapp_user');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('azucapp_user');
}

// ============================================
// HELPERS - Fechas
// ============================================
function hoyStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parsearFecha(yyyymmdd) {
  // Evita problemas de timezone parseando manualmente
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function aFechaStr(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLunes(fechaStr) {
  const d = parsearFecha(fechaStr);
  const dow = d.getDay();  // 0=domingo, 1=lunes, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return aFechaStr(d);
}

function addDays(fechaStr, n) {
  const d = parsearFecha(fechaStr);
  d.setDate(d.getDate() + n);
  return aFechaStr(d);
}

function diasDeSemana(lunesStr) {
  return Array.from({length: 7}, (_, i) => addDays(lunesStr, i));
}

function fmtFechaCorta(fechaStr) {
  const d = parsearFecha(fechaStr);
  return `${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

function fmtSemana(lunesStr) {
  const dias = diasDeSemana(lunesStr);
  const d1 = parsearFecha(dias[0]);
  const d7 = parsearFecha(dias[6]);
  const m1 = MESES_CORTO[d1.getMonth()];
  const m7 = MESES_CORTO[d7.getMonth()];
  if (m1 === m7) {
    return `${d1.getDate()} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
  }
  return `${d1.getDate()} ${m1} – ${d7.getDate()} ${m7} ${d7.getFullYear()}`;
}

function fmtDateTime(date) {
  const dias = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'];
  const dia = dias[date.getDay()];
  const fecha = date.getDate();
  const mes = MESES_CORTO[date.getMonth()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dia} ${fecha} ${mes} · ${hh}:${mm}`;
}

function esHoy(fechaStr) {
  return fechaStr === hoyStr();
}

function esDiaPasado(fechaStr, turno) {
  const hoy = hoyStr();
  if (fechaStr < hoy) return true;
  if (fechaStr > hoy) return false;
  // Es hoy: si tiene turno con hora y ya pasó, considerar pasado
  if (turno && turno.hora_entrada && !turno.es_off && !turno.es_flex) {
    const ahora = new Date();
    const [h, m] = turno.hora_entrada.split(':').map(Number);
    if (ahora.getHours() > h || (ahora.getHours() === h && ahora.getMinutes() > m + 30)) {
      return true;
    }
  }
  return false;
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// TOAST
// ============================================
let toastTimeout = null;
function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    el.className = 'toast';
  }, 2800);
}

// ============================================
// MÓDULOS DEL DASHBOARD
// ============================================
const MODULES = [
  {
    id: 'semana',
    icon: 'ti-calendar-event',
    color: '#7F77DD',
    title: 'Mi semana',
    desc: 'Mis turnos asignados',
    visible: () => true,
    action: () => openMiSemana()
  },
  {
    id: 'propina',
    icon: 'ti-cash',
    color: '#EF9F27',
    title: 'Mi propina',
    desc: 'Propinas acumuladas',
    visible: () => true,
    action: () => alert('Módulo "Mi propina" - próximamente.')
  },
  {
    id: 'biblioteca',
    icon: 'ti-books',
    color: '#5DCAA5',
    title: 'Mi biblioteca',
    desc: 'Capacitación y recursos',
    visible: () => true,
    action: () => alert('Módulo "Mi biblioteca" - próximamente.')
  },
  {
    id: 'recetas',
    icon: 'ti-chef-hat',
    color: '#D85A30',
    title: 'Mis recetas',
    desc: 'Recetas y menús del local',
    visible: () => isMaster() || currentUser.editor_recetas || currentUser.admin_recetas,
    action: () => alert('Módulo "Mis recetas" - próximamente.')
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || currentUser.editor_pedidos || currentUser.admin_pedidos,
    action: () => alert('Módulo "Mis pedidos" - próximamente.')
  },
  {
    id: 'admin',
    icon: 'ti-settings',
    color: '#B4B2A9',
    title: 'Administración',
    desc: 'Usuarios y permisos',
    visible: () => isMaster() || isAdmin(),
    action: () => alert('Módulo "Administración" - próximamente.')
  }
];

function isMaster() {
  return currentUser && currentUser.perfil === 'master';
}

function isAdmin() {
  return currentUser && currentUser.perfil === 'admin';
}

// ============================================
// LÓGICA DE LOGIN
// ============================================
async function doLogin(usuario, password) {
  try {
    const users = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=*`);

    if (!users || users.length === 0) {
      throw new Error('Usuario no encontrado');
    }

    const user = users[0];

    if (!user.activo) {
      throw new Error('Usuario inactivo');
    }

    const hash = await sha256(password);
    if (hash !== user.password_hash) {
      throw new Error('Contraseña incorrecta');
    }

    currentUser = user;
    saveSession(user);

    if (user.debe_cambiar_password) {
      showView('vChangePass');
    } else {
      showDashboard();
    }

  } catch (err) {
    document.getElementById('loginError').textContent = err.message || 'Error al ingresar';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const password = document.getElementById('loginPassword').value;

  document.getElementById('loginError').textContent = '';
  document.getElementById('btnLogin').disabled = true;
  document.getElementById('btnLogin').textContent = 'Ingresando...';

  await doLogin(usuario, password);

  document.getElementById('btnLogin').disabled = false;
  document.getElementById('btnLogin').textContent = 'Ingresar';
});

// ============================================
// CAMBIO DE CONTRASEÑA OBLIGATORIO
// ============================================
document.getElementById('changePassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('changePassError');
  errBox.textContent = '';

  const p1 = document.getElementById('newPass1').value;
  const p2 = document.getElementById('newPass2').value;

  if (p1.length < 6) {
    errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    currentUser.debe_cambiar_password = false;
    saveSession(currentUser);

    document.getElementById('newPass1').value = '';
    document.getElementById('newPass2').value = '';

    showDashboard();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// CAMBIO DE CONTRASEÑA VOLUNTARIO
// ============================================
document.getElementById('changePassVoluntaryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('voluntaryPassError');
  errBox.textContent = '';

  const currentP = document.getElementById('currentPass').value;
  const p1 = document.getElementById('voluntaryPass1').value;
  const p2 = document.getElementById('voluntaryPass2').value;

  const currentHash = await sha256(currentP);
  if (currentHash !== currentUser.password_hash) {
    errBox.textContent = 'Contraseña actual incorrecta';
    return;
  }
  if (p1.length < 6) {
    errBox.textContent = 'La nueva contraseña debe tener al menos 6 caracteres';
    return;
  }
  if (p1 !== p2) {
    errBox.textContent = 'Las contraseñas no coinciden';
    return;
  }

  try {
    const newHash = await sha256(p1);
    await api(`roster_usuarios?id=eq.${currentUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: newHash,
        debe_cambiar_password: false
      })
    });

    currentUser.password_hash = newHash;
    saveSession(currentUser);

    document.getElementById('currentPass').value = '';
    document.getElementById('voluntaryPass1').value = '';
    document.getElementById('voluntaryPass2').value = '';

    showDashboard();
    toast('Contraseña actualizada', 'success');
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// DASHBOARD
// ============================================
function showDashboard() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  document.getElementById('userDisplayName').textContent =
    currentUser.nombre || currentUser.usuario;

  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[currentUser.perfil] || 'Usuario';

  document.getElementById('userRoleLabel').textContent = roleLabel;
  document.getElementById('datetime').textContent = fmtDateTime(new Date());

  renderDashboardCards();
  showView('vDash');
}

function renderDashboardCards() {
  const grid = document.getElementById('dashGrid');
  const visibleModules = MODULES.filter(m => m.visible());

  grid.innerHTML = visibleModules.map((m, idx) => {
    const isLastOdd = (idx === visibleModules.length - 1) && (visibleModules.length % 2 === 1);
    const fullClass = isLastOdd ? ' full' : '';

    return `
      <button class="dash-card${fullClass}" data-module="${m.id}">
        <div class="dash-icon" style="color: ${m.color}">
          <i class="ti ${m.icon}"></i>
        </div>
        <div class="dash-title">${m.title}</div>
        <div class="dash-desc">${m.desc}</div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const modId = card.dataset.module;
      const mod = MODULES.find(m => m.id === modId);
      if (mod) mod.action();
    });
  });
}

// ============================================
// MI SEMANA
// ============================================
async function openMiSemana() {
  showView('vMiSemana');

  // Inicializar fecha
  if (!semanaActual) {
    semanaActual = getLunes(hoyStr());
  }

  // Cargar datos del colaborador si tiene empleado_id
  currentEmpleado = null;
  if (currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) {
        currentEmpleado = emps[0];
      }
    } catch (e) {
      console.warn('Error cargando empleado:', e);
    }
  }

  // Renderizar
  await renderMiSemana();
}

async function renderMiSemana() {
  const subtitle = document.getElementById('miSemanaSubtitle');
  const weekNav = document.getElementById('weekNav');
  const diasGrid = document.getElementById('diasGrid');
  const comentBox = document.getElementById('comentarioGeneral');
  const noEmpBox = document.getElementById('noEmpleado');
  const reportarBox = document.getElementById('reportarWrap');

  // Caso 1: usuario sin empleado vinculado (ej: matfraga master)
  if (!currentEmpleado) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    weekNav.style.display = 'none';
    diasGrid.innerHTML = '';
    comentBox.style.display = 'none';
    noEmpBox.style.display = 'flex';
    reportarBox.style.display = 'none';
    return;
  }

  // Caso 2: usuario con empleado
  weekNav.style.display = 'flex';
  noEmpBox.style.display = 'none';
  reportarBox.style.display = 'block';

  const localLabel = LOCAL_LABELS[currentEmpleado.local] || currentEmpleado.local || '';
  subtitle.textContent = localLabel + (currentEmpleado.sector ? ' · ' + currentEmpleado.sector : '');

  document.getElementById('weekLabel').textContent = fmtSemana(semanaActual);

  // Mostrar loading
  diasGrid.innerHTML = '<div class="loading">Cargando turnos...</div>';

  const dias = diasDeSemana(semanaActual);
  let turnos = {};         // por día → turno
  let localesPorDia = {};  // por día → nombre del local
  let comentGeneral = '';
  let incPorDia = {};

  try {
    // Buscar TODAS las semanas (de cualquier local) con esta fecha de lunes
    // que tengan turnos para este empleado
    const semanas = await api(
      `roster_semanas?fecha_lunes=eq.${semanaActual}&select=id,local,comentario_general`
    );

    if (semanas && semanas.length) {
      // Construir mapa id→local para asignarlo después a cada turno
      const semanaIdToLocal = {};
      const semanaIds = [];
      semanas.forEach(s => {
        semanaIdToLocal[s.id] = s.local;
        semanaIds.push(s.id);
      });

      // Buscar todos los turnos del empleado en cualquiera de esas semanas
      const tts = await api(
        `roster_turnos?semana_id=in.(${semanaIds.join(',')})` +
        `&empleado_id=eq.${currentEmpleado.id}&select=*`
      ) || [];

      tts.forEach(t => {
        turnos[t.dia] = t;
        localesPorDia[t.dia] = semanaIdToLocal[t.semana_id];
      });

      // Para el comentario general, priorizar el del local principal del empleado
      const semanaPrincipal = semanas.find(s => s.local === currentEmpleado.local);
      if (semanaPrincipal && semanaPrincipal.comentario_general) {
        comentGeneral = semanaPrincipal.comentario_general;
      } else if (semanas.length === 1 && semanas[0].comentario_general) {
        comentGeneral = semanas[0].comentario_general;
      }
    }

    // Cargar incidencias del empleado en el rango de la semana
    const desde = dias[0];
    const hasta = dias[6];
    const incs = await api(
      `incidencias?empleado_id=eq.${currentEmpleado.id}` +
      `&fecha=gte.${desde}&fecha=lte.${hasta}` +
      `&select=*&order=creado_en.desc`
    ) || [];
    incs.forEach(inc => {
      if (!incPorDia[inc.fecha]) incPorDia[inc.fecha] = inc;
    });
  } catch (e) {
    diasGrid.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar la semana</div>';
    console.error(e);
    return;
  }

  // Detectar si el empleado tiene turnos en distintos locales esta semana
  const localesUnicos = [...new Set(Object.values(localesPorDia))];
  const esRotativo = localesUnicos.length > 1;

  // Renderizar la grilla
  diasGrid.innerHTML = dias.map((dia, i) => {
    const t = turnos[dia];
    const esOff = t && t.es_off;
    const esFlex = t && t.es_flex;
    const hoy = esHoy(dia);
    const pasado = esDiaPasado(dia, t);
    const inc = incPorDia[dia];
    const localTurno = localesPorDia[dia];

    let txt;
    if (esOff) {
      txt = 'OFF';
    } else if (esFlex) {
      txt = t.hora_entrada ? 'FLEX ' + t.hora_entrada.slice(0, 5) : 'FLEX';
    } else if (t && t.hora_entrada) {
      txt = t.hora_entrada.slice(0, 5);
    } else {
      txt = '—';
    }

    const classes = ['dia-card'];
    if (esOff) classes.push('off');
    if (esFlex) classes.push('flex');
    if (hoy) classes.push('hoy');
    if (pasado) classes.push('pasado');

    // Mostrar el local SOLO si el empleado es rotativo y tiene un turno con local
    const mostrarLocal = esRotativo && localTurno && !esOff && t && t.hora_entrada;
    if (mostrarLocal) classes.push('con-local');

    const dot = inc
      ? `<span class="inc-dot ${inc.estado}" onclick="verIncidencia(${inc.id})" title="Ver incidencia"></span>`
      : '';

    const hoyTag = hoy ? '<span class="hoy-label">HOY</span>' : '';

    const localTag = mostrarLocal
      ? `<div class="dia-local">${esc(LOCAL_LABELS[localTurno] || localTurno)}</div>`
      : '';

    const comentTurno = (t && t.comentario)
      ? `<div class="dia-comment"><i class="ti ti-message-circle"></i><span>${esc(t.comentario)}</span></div>`
      : '';

    return `
      <div class="${classes.join(' ')}">
        ${dot}
        <div class="dia-nombre">${DIAS_LARGO[i]}${hoyTag}</div>
        <div class="dia-fecha">${fmtFechaCorta(dia)}</div>
        <div class="dia-hora">${txt}</div>
        ${localTag}
        ${comentTurno}
      </div>
    `;
  }).join('');

  // Comentario general
  if (comentGeneral) {
    comentBox.innerHTML = `<i class="ti ti-message-2"></i><em>${esc(comentGeneral)}</em>`;
    comentBox.style.display = 'flex';
  } else {
    comentBox.style.display = 'none';
  }
}

window.cambiarSemanaEmp = function(n) {
  semanaActual = addDays(semanaActual, n * 7);
  renderMiSemana();
};

// ============================================
// MI SEMANA - Reportar incidencia
// ============================================
window.openIncidenciaModal = function() {
  const hoy = hoyStr();
  const inp = document.getElementById('incFecha');
  inp.value = hoy;
  inp.min = hoy;
  document.getElementById('incTipo').value = 'tardanza';
  document.getElementById('incDesc').value = '';
  document.getElementById('incError').textContent = '';
  document.getElementById('modalIncidencia').classList.add('show');
};

window.closeIncidenciaModal = function() {
  document.getElementById('modalIncidencia').classList.remove('show');
};

window.guardarIncidencia = async function() {
  const tipo = document.getElementById('incTipo').value;
  const fecha = document.getElementById('incFecha').value;
  const desc = document.getElementById('incDesc').value.trim();
  const errBox = document.getElementById('incError');
  errBox.textContent = '';

  if (!fecha) {
    errBox.textContent = 'Elegí una fecha';
    return;
  }
  const hoy = hoyStr();
  if (fecha < hoy) {
    errBox.textContent = 'No se pueden reportar incidencias de días pasados';
    return;
  }
  if (!desc) {
    errBox.textContent = 'Describí la incidencia';
    return;
  }
  if (!currentEmpleado) {
    errBox.textContent = 'Tu usuario no está vinculado a un colaborador';
    return;
  }

  // Si la incidencia es para HOY, validar que no se haya pasado la hora del turno + 30 min
  if (fecha === hoy) {
    try {
      const turnoHoy = await api(
        `roster_turnos?empleado_id=eq.${currentEmpleado.id}&dia=eq.${hoy}` +
        `&select=hora_entrada,es_off,es_flex&limit=1`
      );
      if (turnoHoy && turnoHoy.length && turnoHoy[0].hora_entrada
          && !turnoHoy[0].es_off && !turnoHoy[0].es_flex) {
        const ahora = new Date();
        const [h, m] = turnoHoy[0].hora_entrada.split(':').map(Number);
        const limite = new Date(ahora);
        limite.setHours(h, m + 30, 0, 0);
        if (ahora > limite) {
          errBox.textContent = 'Ya pasó la hora de tu turno + 30 min, no se puede reportar';
          return;
        }
      }
    } catch (e) {
      console.warn('Error validando turno hoy:', e);
    }
  }

  try {
    await api('incidencias', {
      method: 'POST',
      body: JSON.stringify({
        empleado_id: currentEmpleado.id,
        fecha,
        tipo,
        descripcion: desc,
        estado: 'pendiente'
      })
    });
    closeIncidenciaModal();
    toast('✓ Incidencia enviada', 'success');
    // Refrescar la vista para mostrar el indicador
    await renderMiSemana();
  } catch (err) {
    errBox.textContent = 'Error al enviar: ' + err.message;
  }
};

// ============================================
// MI SEMANA - Ver detalle de incidencia
// ============================================
window.verIncidencia = async function(id) {
  try {
    const incs = await api(`incidencias?id=eq.${id}&select=*`);
    if (!incs || !incs.length) {
      toast('No se encontró la incidencia', 'error');
      return;
    }
    const inc = incs[0];

    const estadoLabels = {
      pendiente: { label: '⏳ Pendiente', cls: 'pendiente' },
      aprobado: { label: '✓ Aceptada', cls: 'aprobado' },
      rechazado: { label: '✗ Denegada', cls: 'rechazado' }
    };
    const est = estadoLabels[inc.estado] || estadoLabels.pendiente;

    document.getElementById('incDetTitle').textContent = TIPOS_INCIDENCIA[inc.tipo] || inc.tipo;
    document.getElementById('incDetBody').innerHTML = `
      <div class="det-line">
        <div class="det-label">Fecha</div>
        <div class="det-value">${fmtFechaCorta(inc.fecha)}</div>
      </div>
      <div class="det-line">
        <div class="det-label">Estado</div>
        <div class="det-value"><span class="det-badge ${est.cls}">${est.label}</span></div>
      </div>
      <div class="det-line">
        <div class="det-label">Descripción</div>
        <div class="det-value">${esc(inc.descripcion || '—')}</div>
      </div>
    `;
    document.getElementById('modalIncDetalle').classList.add('show');
  } catch (e) {
    toast('Error al cargar la incidencia', 'error');
  }
};

window.closeIncDetalleModal = function() {
  document.getElementById('modalIncDetalle').classList.remove('show');
};

// ============================================
// LOGOUT
// ============================================
window.doLogout = function() {
  if (!confirm('¿Cerrar sesión?')) return;
  clearSession();
  currentUser = null;
  currentEmpleado = null;
  semanaActual = null;
  document.getElementById('loginUsuario').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  showView('vLogin');
};

// ============================================
// NAVEGACIÓN
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(viewId);
  if (v) v.classList.add('active');
  window.scrollTo(0, 0);
}

window.showDashboard = showDashboard;
window.showChangePass = function() {
  document.getElementById('voluntaryPassError').textContent = '';
  document.getElementById('currentPass').value = '';
  document.getElementById('voluntaryPass1').value = '';
  document.getElementById('voluntaryPass2').value = '';
  showView('vChangePassVoluntary');
};

// Cerrar modales clicando el overlay
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov) {
      ov.classList.remove('show');
    }
  });
});

// ============================================
// INICIALIZACIÓN
// ============================================
async function init() {
  const savedUser = loadSession();

  if (savedUser) {
    try {
      const fresh = await api(`roster_usuarios?id=eq.${savedUser.id}&select=*`);
      if (fresh && fresh[0] && fresh[0].activo) {
        currentUser = fresh[0];
        saveSession(currentUser);

        if (currentUser.debe_cambiar_password) {
          showView('vChangePass');
        } else {
          showDashboard();
        }
        return;
      }
    } catch(e) {
      console.warn('No se pudo verificar sesión:', e);
    }
    clearSession();
  }

  showView('vLogin');

  // Actualizar fecha cada minuto
  setInterval(() => {
    const dt = document.getElementById('datetime');
    if (dt && currentUser) {
      dt.textContent = fmtDateTime(new Date());
    }
  }, 60000);
}

init();

})();
