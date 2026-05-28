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

// Formato de números con separador de miles (es-AR)
function formatNumber(n) {
  const num = Math.round(parseFloat(n) || 0);
  return num.toLocaleString('es-AR');
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
    action: () => openMiPropina()
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
    visible: () => isMaster() || isAdmin() || currentUser.editor_recetas,
    action: () => alert('Módulo "Mis recetas" - próximamente.')
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || isAdmin() || currentUser.editor_pedidos,
    action: () => alert('Módulo "Mis pedidos" - próximamente.')
  },
  {
    id: 'admin',
    icon: 'ti-settings',
    color: '#B4B2A9',
    title: 'Administración',
    desc: 'Usuarios y permisos',
    visible: () => isMaster() || isAdmin(),
    action: () => openAdministracion()
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
// MI PROPINA
// ============================================
async function openMiPropina() {
  showView('vMiPropina');
  const cont = document.getElementById('propinaContenido');
  const subtitle = document.getElementById('miPropinaSubtitle');
  cont.innerHTML = '<div class="loading">Cargando propinas...</div>';

  // Necesita empleado vinculado
  if (!currentUser.empleado_id) {
    subtitle.textContent = currentUser.nombre || currentUser.usuario;
    cont.innerHTML = `
      <div class="no-empleado">
        <i class="ti ti-info-circle"></i>
        <div>
          <div class="ne-title">No tenés propinas asignadas</div>
          <div class="ne-desc">Tu usuario no está vinculado a un colaborador. Si esto es un error, contactá a Recursos Humanos.</div>
        </div>
      </div>`;
    return;
  }

  // Cargar nombre del colaborador para el subtítulo
  if (!currentEmpleado && currentUser.empleado_id) {
    try {
      const emps = await api(`empleados?id=eq.${currentUser.empleado_id}&select=*`);
      if (emps && emps.length) currentEmpleado = emps[0];
    } catch(e) { /* ignore */ }
  }
  subtitle.textContent = 'Propinas acumuladas';

  // Cargar asignaciones con datos del cierre
  let asigs = [];
  try {
    asigs = await api(
      `propinas_asignaciones?empleado_id=eq.${currentUser.empleado_id}` +
      `&select=*,cierre:cierre_id(fecha,turno,local,pagado,pagado_en)` +
      `&order=id.desc`
    ) || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar propinas</div>';
    return;
  }

  const pendientes = asigs.filter(a => a.cierre && !a.cierre.pagado && a.monto > 0);

  const hoy = new Date();
  const limite = new Date(hoy.getFullYear(), hoy.getMonth() - 3, 1);
  const limiteStr = limite.toISOString().slice(0, 10);
  const pagadosRecientes = asigs.filter(a =>
    a.cierre && a.cierre.pagado && a.monto > 0 && a.cierre.fecha >= limiteStr
  );

  let html = '';

  // ===== 1. BOTÓN DE GESTIÓN (solo Master o Admin por ahora) =====
  if (isMaster() || isAdmin()) {
    html += `
      <button class="btn-gestion" onclick="abrirGestionPropinas()">
        <i class="ti ti-settings"></i> GESTIÓN DE PROPINAS
      </button>`;
  }

  // ===== 2. BANNER PENDIENTE =====
  const totalPendiente = pendientes.reduce((s, a) => s + parseFloat(a.monto || 0), 0);
  if (pendientes.length) {
    html += `
      <div class="propina-banner">
        <div class="propina-banner-label">Total pendiente de cobro</div>
        <div class="propina-banner-monto">$${formatNumber(totalPendiente)}</div>
        <div class="propina-banner-sub">${pendientes.length} ${pendientes.length === 1 ? 'cierre pendiente' : 'cierres pendientes'}</div>
      </div>`;
  } else {
    html += `
      <div class="propina-empty">
        <div class="propina-empty-icon">💰</div>
        <div class="propina-empty-title">No tenés propinas pendientes</div>
        <div class="propina-empty-desc">Cuando se carguen propinas para vos, las vas a ver acá.</div>
      </div>`;
  }

  // ===== 3. DETALLE DE PENDIENTES POR LOCAL =====
  if (pendientes.length) {
    const porLocal = {};
    pendientes.forEach(a => {
      const loc = a.cierre.local;
      if (!porLocal[loc]) porLocal[loc] = { total: 0, dias: [] };
      porLocal[loc].total += parseFloat(a.monto || 0);
      porLocal[loc].dias.push({
        fecha: a.cierre.fecha,
        turno: a.cierre.turno,
        puntos: parseFloat(a.puntos),
        monto: parseFloat(a.monto || 0)
      });
    });
    Object.values(porLocal).forEach(l => l.dias.sort((a, b) => b.fecha.localeCompare(a.fecha)));

    const turnoIcon = { mediodia: '🌤', noche: '🌙', evento: '🎉', especial: '⭐' };
    const turnoLbl = { mediodia: 'Mediodía', noche: 'Noche', evento: 'Evento', especial: 'Especial' };

    html += `<div class="pend-section-title">Detalle de pendientes</div>`;
    Object.entries(porLocal).forEach(([loc, data]) => {
      html += `
        <div class="pend-local">
          <div class="pend-local-header">
            <div class="pend-local-name"><i class="ti ti-map-pin"></i> ${esc(LOCAL_LABELS[loc] || loc)}</div>
            <div class="pend-local-total">$${formatNumber(data.total)}</div>
          </div>
          ${data.dias.map(d => {
            const pts = d.puntos === 1 ? '1 punto' : d.puntos === 0.5 ? '½ punto' : d.puntos + ' pts';
            return `
              <div class="pend-dia">
                <div class="pend-dia-info">
                  <span class="pend-dia-fecha">${fmtFechaCorta(d.fecha)}</span>
                  <span class="pend-dia-meta">${turnoIcon[d.turno] || ''} ${turnoLbl[d.turno] || d.turno} · ${pts}</span>
                </div>
                <div class="pend-dia-monto">$${formatNumber(d.monto)}</div>
              </div>`;
          }).join('')}
        </div>`;
    });
  }

  // ===== 4. HISTÓRICO COBRADO (últimos 4 meses) =====
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const buckets = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = `${MESES[d.getMonth()]} ${d.getFullYear()}`;
    buckets.push({ key, lbl, total: 0, cantidad: 0 });
  }
  pagadosRecientes.forEach(a => {
    const k = a.cierre.fecha.slice(0, 7);
    const b = buckets.find(x => x.key === k);
    if (b) { b.total += parseFloat(a.monto || 0); b.cantidad++; }
  });
  const totalCobrado = buckets.reduce((s, b) => s + b.total, 0);

  if (totalCobrado > 0 || pendientes.length) {
    html += `
      <div class="cobrado-box">
        <div class="cobrado-header">
          <div class="cobrado-title"><i class="ti ti-cash"></i> Histórico cobrado</div>
          <div class="cobrado-periodo">Últimos meses</div>
        </div>
        <div class="cobrado-grid">
          ${buckets.map((b, i) => `
            <div class="cobrado-mes${i === 0 ? ' actual' : ''}">
              <div class="cobrado-mes-label">${b.lbl}${i === 0 ? ' · Actual' : ''}</div>
              <div class="cobrado-mes-monto${b.total > 0 ? '' : ' cero'}">$${formatNumber(b.total)}</div>
              ${b.cantidad ? `<div class="cobrado-mes-cant">${b.cantidad} ${b.cantidad === 1 ? 'cierre' : 'cierres'}</div>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="cobrado-total">
          <span style="color:var(--c-muted)">Total cobrado:</span>
          <strong>$${formatNumber(totalCobrado)}</strong>
        </div>
      </div>`;
  }

  cont.innerHTML = html;
}

// Función placeholder para abrir gestión de propinas
window.abrirGestionPropinas = function() {
  toast('Gestión de propinas - próximamente disponible');
};

// ============================================
// ADMINISTRACIÓN - Panel principal
// ============================================
const ADMIN_SECTIONS = [
  {
    id: 'usuarios',
    icon: 'ti-users',
    color: '#7F77DD',
    title: 'Usuarios',
    desc: 'Crear, editar, resetear contraseñas',
    activa: true,
    action: () => openAdminUsuarios()
  },
  {
    id: 'editores',
    icon: 'ti-shield-check',
    color: '#5DCAA5',
    title: 'Editores y permisos',
    desc: 'Asignar qué puede editar cada Editor',
    activa: true,
    action: () => openAdminEditores()
  },
  {
    id: 'locales',
    icon: 'ti-building-store',
    color: '#C4622D',
    title: 'Locales',
    desc: 'Gestionar locales del grupo',
    activa: false,
    soloMaster: true
  },
  {
    id: 'historial',
    icon: 'ti-history',
    color: '#B4B2A9',
    title: 'Historial',
    desc: 'Auditoría de cambios',
    activa: false
  }
];

function openAdministracion() {
  if (!isMaster() && !isAdmin()) {
    showDashboard();
    return;
  }

  const grid = document.getElementById('adminGrid');
  grid.innerHTML = ADMIN_SECTIONS
    .filter(s => !s.soloMaster || isMaster())
    .map(s => {
      const cls = 'admin-card' + (s.activa ? '' : ' disabled');
      const arrowOrTag = s.activa
        ? `<div class="admin-card-arrow"><i class="ti ti-chevron-right"></i></div>`
        : `<span class="pronto-tag">Pronto</span>`;
      return `
        <button class="${cls}" data-id="${s.id}">
          <div class="admin-card-icon" style="background:${s.color}22">
            <i class="ti ${s.icon}" style="color:${s.color}"></i>
          </div>
          <div class="admin-card-text">
            <div class="admin-card-title">${s.title}</div>
            <div class="admin-card-desc">${s.desc}</div>
          </div>
          ${arrowOrTag}
        </button>`;
    }).join('');

  grid.querySelectorAll('.admin-card').forEach(c => {
    c.addEventListener('click', () => {
      const id = c.dataset.id;
      const sec = ADMIN_SECTIONS.find(s => s.id === id);
      if (sec && sec.activa && sec.action) {
        sec.action();
      } else {
        toast('Próximamente disponible');
      }
    });
  });

  showView('vAdmin');
}

window.openAdministracion = openAdministracion;

// ============================================
// ADMINISTRACIÓN - Usuarios
// ============================================
let ADMIN_USUARIOS_CACHE = [];
let ADMIN_EMPLEADOS_CACHE = [];
let ADMIN_FILTRO_ACTUAL = 'todos';
let EDITANDO_USER_ID = null;
let RESET_USER_ID = null;

async function openAdminUsuarios() {
  showView('vAdminUsuarios');
  document.getElementById('userSearch').value = '';
  ADMIN_FILTRO_ACTUAL = 'todos';
  // Reset pills visualmente
  document.querySelectorAll('.filter-pills .pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === 'todos');
  });

  await cargarUsuarios();
  await cargarEmpleados();
}

async function cargarUsuarios() {
  const lista = document.getElementById('usuariosLista');
  lista.innerHTML = '<div class="loading">Cargando usuarios...</div>';

  try {
    ADMIN_USUARIOS_CACHE = await api('roster_usuarios?select=*&order=nombre.asc') || [];
    renderUsuarios();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar usuarios</div>';
  }
}

async function cargarEmpleados() {
  try {
    ADMIN_EMPLEADOS_CACHE = await api('empleados?activo=eq.true&select=id,nombre,apellido,local,sector&order=nombre.asc') || [];
  } catch (e) {
    console.warn('Error al cargar empleados:', e);
    ADMIN_EMPLEADOS_CACHE = [];
  }
}

function renderUsuarios() {
  const lista = document.getElementById('usuariosLista');
  const search = (document.getElementById('userSearch').value || '').toLowerCase().trim();

  let users = ADMIN_USUARIOS_CACHE.slice();

  // Filtro por pill
  if (ADMIN_FILTRO_ACTUAL === 'inactivos') {
    users = users.filter(u => !u.activo);
  } else if (ADMIN_FILTRO_ACTUAL !== 'todos') {
    users = users.filter(u => u.activo && u.perfil === ADMIN_FILTRO_ACTUAL);
  } else {
    users = users.filter(u => u.activo);
  }

  // Filtro por búsqueda
  if (search) {
    users = users.filter(u => {
      const n = (u.nombre || '').toLowerCase();
      const us = (u.usuario || '').toLowerCase();
      return n.includes(search) || us.includes(search);
    });
  }

  // Header con conteo
  document.getElementById('usuariosCount').textContent =
    users.length + (users.length === 1 ? ' usuario' : ' usuarios');

  if (!users.length) {
    lista.innerHTML = `<div class="empty-list">No se encontraron usuarios${search ? ' con ese criterio' : ''}</div>`;
    return;
  }

  const perfilLabels = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  };

  lista.innerHTML = users.map(u => {
    const inicial = (u.nombre || u.usuario || '?').trim().charAt(0).toUpperCase();
    const inactiveCls = u.activo ? '' : ' inactive';
    const perfilCls = 'p-' + (u.perfil || 'usuario');
    const labelPerfil = perfilLabels[u.perfil] || 'Usuario';
    const inactiveTag = u.activo ? '' : ' · INACTIVO';
    const empleadoTag = u.empleado_id ? ' · vinculado' : '';

    // Botón activar/desactivar
    const toggleBtn = u.id === currentUser.id
      ? '' // no podés desactivarte a vos mismo
      : `<button class="btn-row-action" onclick="event.stopPropagation();toggleActivoUser(${u.id})"
            title="${u.activo ? 'Desactivar' : 'Activar'}">
          <i class="ti ti-${u.activo ? 'user-off' : 'user-check'}"></i>
        </button>`;

    return `
      <div class="user-row${inactiveCls}" data-id="${u.id}">
        <div class="user-avatar ${perfilCls}">${esc(inicial)}</div>
        <div class="user-info">
          <div class="user-name">${esc(u.nombre || u.usuario)}</div>
          <div class="user-meta">@${esc(u.usuario)} · ${labelPerfil}${empleadoTag}${inactiveTag}</div>
        </div>
        <div class="user-actions">
          <button class="btn-row-action" onclick="event.stopPropagation();abrirEditarUsuario(${u.id})" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
          <button class="btn-row-action" onclick="event.stopPropagation();abrirResetPass(${u.id})" title="Resetear contraseña">
            <i class="ti ti-key"></i>
          </button>
          ${toggleBtn}
        </div>
      </div>`;
  }).join('');
}

// Search en tiempo real
document.getElementById('userSearch').addEventListener('input', () => renderUsuarios());

// Filtros con pills
document.querySelectorAll('.filter-pills .pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.filter-pills .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    ADMIN_FILTRO_ACTUAL = p.dataset.filter;
    renderUsuarios();
  });
});

// ============================================
// MODAL CREAR / EDITAR USUARIO
// ============================================
window.abrirCrearUsuario = function() {
  EDITANDO_USER_ID = null;
  document.getElementById('userFormTitle').textContent = 'Nuevo usuario';
  document.getElementById('userNombre').value = '';
  document.getElementById('userUsuario').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = 'usuario';
  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = '';
  document.getElementById('userPasswordField').style.display = '';
  document.getElementById('userFormError').textContent = '';

  // Si no es Master, no puede crear Masters
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede crear Masters)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.abrirEditarUsuario = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  EDITANDO_USER_ID = id;
  document.getElementById('userFormTitle').textContent = 'Editar usuario';
  document.getElementById('userNombre').value = u.nombre || '';
  document.getElementById('userUsuario').value = u.usuario || '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userPerfil').value = u.perfil || 'usuario';

  document.getElementById('userEmpleado').innerHTML = '<option value="">Sin vincular (no tiene turnos)</option>' +
    ADMIN_EMPLEADOS_CACHE.map(e => {
      const lbl = `${e.nombre || ''} ${e.apellido || ''}`.trim() + (e.local ? ' · ' + (LOCAL_LABELS[e.local] || e.local) : '');
      return `<option value="${e.id}">${esc(lbl)}</option>`;
    }).join('');
  document.getElementById('userEmpleado').value = u.empleado_id || '';

  // En edición, ocultar password (se cambia con el botón de reset)
  document.getElementById('userPasswordField').style.display = 'none';
  document.getElementById('userFormError').textContent = '';

  // Reglas: solo Master puede asignar Master
  const optMaster = document.getElementById('optMaster');
  optMaster.disabled = !isMaster();
  optMaster.textContent = isMaster() ? 'Master (máximo nivel)' : 'Master (solo Master puede asignar Master)';

  document.getElementById('modalUserForm').classList.add('show');
};

window.closeUserFormModal = function() {
  document.getElementById('modalUserForm').classList.remove('show');
};

window.guardarUsuario = async function() {
  const errBox = document.getElementById('userFormError');
  errBox.textContent = '';

  const nombre = document.getElementById('userNombre').value.trim();
  const usuario = document.getElementById('userUsuario').value.trim().toLowerCase();
  const perfil = document.getElementById('userPerfil').value;
  const empleadoId = document.getElementById('userEmpleado').value;
  const password = document.getElementById('userPassword').value;

  if (!nombre) { errBox.textContent = 'Falta el nombre'; return; }
  if (!usuario) { errBox.textContent = 'Falta el usuario'; return; }
  if (!/^[a-z0-9_.-]+$/i.test(usuario)) {
    errBox.textContent = 'El usuario solo puede tener letras, números, _ . -';
    return;
  }

  // Validar permisos para perfil Master
  if (perfil === 'master' && !isMaster()) {
    errBox.textContent = 'Solo un Master puede asignar el perfil Master';
    return;
  }

  try {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    if (EDITANDO_USER_ID) {
      // Editando: verificar conflictos de username SOLO si cambió
      const original = ADMIN_USUARIOS_CACHE.find(u => u.id === EDITANDO_USER_ID);
      if (usuario !== (original.usuario || '').toLowerCase()) {
        const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
        if (existentes && existentes.length) {
          throw new Error('Ese usuario ya existe');
        }
      }

      await api(`roster_usuarios?id=eq.${EDITANDO_USER_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre,
          usuario,
          perfil,
          empleado_id: empleadoId ? parseInt(empleadoId) : null
        })
      });

      toast('✓ Usuario actualizado', 'success');
    } else {
      // Creando: requiere password
      if (!password || password.length < 6) {
        errBox.textContent = 'La contraseña debe tener al menos 6 caracteres';
        btn.disabled = false;
        btn.textContent = 'Guardar';
        return;
      }

      // Verificar que no exista
      const existentes = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=id`);
      if (existentes && existentes.length) {
        throw new Error('Ese usuario ya existe');
      }

      const passHash = await sha256(password);

      await api('roster_usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario,
          nombre,
          perfil,
          password_hash: passHash,
          empleado_id: empleadoId ? parseInt(empleadoId) : null,
          debe_cambiar_password: true,
          activo: true
        })
      });

      toast('✓ Usuario creado', 'success');
    }

    closeUserFormModal();
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al guardar';
  } finally {
    const btn = document.getElementById('btnGuardarUser');
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
};

// ============================================
// MODAL RESET PASSWORD
// ============================================
window.abrirResetPass = function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  RESET_USER_ID = id;
  document.getElementById('resetPassUser').textContent = `Usuario: ${u.nombre || u.usuario} (@${u.usuario})`;
  document.getElementById('resetPassValue').value = '';
  document.getElementById('resetPassError').textContent = '';
  document.getElementById('modalResetPass').classList.add('show');
};

window.closeResetPassModal = function() {
  document.getElementById('modalResetPass').classList.remove('show');
};

window.confirmarResetPass = async function() {
  const errBox = document.getElementById('resetPassError');
  errBox.textContent = '';
  const nueva = document.getElementById('resetPassValue').value;

  if (!nueva || nueva.length < 6) {
    errBox.textContent = 'Debe tener al menos 6 caracteres';
    return;
  }

  try {
    const hash = await sha256(nueva);
    await api(`roster_usuarios?id=eq.${RESET_USER_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password_hash: hash,
        debe_cambiar_password: true
      })
    });
    closeResetPassModal();
    toast('✓ Contraseña reseteada', 'success');
    await cargarUsuarios();
  } catch (err) {
    errBox.textContent = err.message || 'Error al resetear';
  }
};

// ============================================
// ACTIVAR / DESACTIVAR USUARIO
// ============================================
window.toggleActivoUser = async function(id) {
  const u = ADMIN_USUARIOS_CACHE.find(x => x.id === id);
  if (!u) return;
  if (u.id === currentUser.id) {
    toast('No podés desactivar tu propia cuenta', 'error');
    return;
  }

  // Aviso especial si se está por desactivar a un Master
  if (u.activo && u.perfil === 'master') {
    if (!confirm(`⚠️ ATENCIÓN: estás por desactivar a un Master (${u.nombre}).\n\nSi te quedás sin Masters, NADIE va a poder crear nuevos Masters ni editar Locales.\n\n¿Estás 100% seguro?`)) {
      return;
    }
  } else {
    const accion = u.activo ? 'desactivar' : 'activar';
    if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} a ${u.nombre || u.usuario}?`)) return;
  }

  try {
    await api(`roster_usuarios?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: !u.activo })
    });
    toast(`✓ Usuario ${u.activo ? 'desactivado' : 'activado'}`, 'success');
    await cargarUsuarios();
  } catch (err) {
    toast('Error al cambiar estado', 'error');
  }
};

// ============================================
// ADMINISTRACIÓN - Editores y permisos
// ============================================
const LOCALES_DISPONIBLES = [
  '1-AZUCA','2-AZAFRAN','3-NIETO','4-VIÑA COBOS','5-TRAPICHE','VINOBIEN'
];

let EDITORES_CACHE = [];
let LOCALES_EDITANDO_ID = null;

const PERMISOS_DEF = [
  { key: 'editor_rosters',    label: 'Rosters',       icon: 'ti-calendar-event', tipo: 'editor' },
  { key: 'editor_propinas',   label: 'Propinas',      icon: 'ti-cash',           tipo: 'editor' },
  { key: 'editor_biblioteca', label: 'Biblioteca',    icon: 'ti-books',          tipo: 'editor' },
  { key: 'editor_recetas',    label: 'Recetas',       icon: 'ti-chef-hat',       tipo: 'editor' },
  { key: 'editor_pedidos',    label: 'Pedidos',       icon: 'ti-shopping-cart',  tipo: 'editor' }
];

async function openAdminEditores() {
  showView('vAdminEditores');
  await cargarEditores();
}
window.openAdminEditores = openAdminEditores;

async function cargarEditores() {
  const lista = document.getElementById('editoresLista');
  lista.innerHTML = '<div class="loading">Cargando editores...</div>';

  try {
    EDITORES_CACHE = await api(
      `roster_usuarios?perfil=eq.editor&activo=eq.true&select=*&order=nombre.asc`
    ) || [];
    renderEditores();
  } catch (e) {
    lista.innerHTML = '<div class="empty-list" style="color:var(--c-error)">Error al cargar editores</div>';
  }
}

function renderEditores() {
  const lista = document.getElementById('editoresLista');
  document.getElementById('editoresCount').textContent =
    EDITORES_CACHE.length + (EDITORES_CACHE.length === 1 ? ' editor' : ' editores');

  if (!EDITORES_CACHE.length) {
    lista.innerHTML = `
      <div class="editor-empty">
        <div class="editor-empty-icon"><i class="ti ti-users-group"></i></div>
        <div class="editor-empty-title">No hay editores asignados</div>
        <div class="editor-empty-desc">
          Para que alguien aparezca acá, andá a <strong>Usuarios</strong> y cambiale el perfil a <strong>Editor</strong>.
        </div>
      </div>`;
    return;
  }

  lista.innerHTML = EDITORES_CACHE.map(u => {
    const inicial = (u.nombre || u.usuario || '?').trim().charAt(0).toUpperCase();
    const locales = u.locales_asignados || [];
    const localesTxt = locales.length
      ? locales.map(l => LOCAL_LABELS[l] || l).join(', ')
      : 'Sin locales asignados';
    const localesIco = locales.length ? 'ti-map-pin' : 'ti-map-pin-off';

    const perms = PERMISOS_DEF.map(p => {
      const activo = !!u[p.key];
      const cls = 'permiso-check' + (activo ? ' activo' : '') + (p.tipo === 'admin' ? ' admin-perm' : '');
      const icon = activo ? 'ti-check' : p.icon;
      return `
        <label class="${cls}" onclick="togglePermiso(${u.id}, '${p.key}', this)">
          <i class="ti ${icon}"></i>
          <span>${p.label}</span>
        </label>`;
    }).join('');

    return `
      <div class="editor-card" data-id="${u.id}">
        <div class="editor-card-head">
          <div class="editor-card-avatar">${esc(inicial)}</div>
          <div class="editor-card-info">
            <div class="editor-card-name">${esc(u.nombre || u.usuario)}</div>
            <div class="editor-card-meta">@${esc(u.usuario)}</div>
          </div>
        </div>

        <div class="editor-card-locales">
          <i class="ti ${localesIco}"></i>
          <span>${esc(localesTxt)}</span>
          <button class="editar-locales" onclick="abrirEditarLocales(${u.id})">Editar</button>
        </div>

        <div class="permisos-grid">
          ${perms}
        </div>
      </div>`;
  }).join('');
}

window.togglePermiso = async function(userId, key, labelEl) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;

  const nuevoValor = !user[key];

  // Update visual inmediato
  labelEl.classList.toggle('activo', nuevoValor);
  const icon = labelEl.querySelector('i.ti');
  if (nuevoValor) {
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add('ti-check');
  } else {
    const def = PERMISOS_DEF.find(p => p.key === key);
    icon.classList.remove(...Array.from(icon.classList).filter(c => c.startsWith('ti-')));
    icon.classList.add(def.icon);
  }

  // Actualizar caché local
  user[key] = nuevoValor;

  // Guardar en BD
  try {
    await api(`roster_usuarios?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: nuevoValor })
    });
  } catch (err) {
    toast('Error al guardar permiso', 'error');
    // Revertir cambio visual
    user[key] = !nuevoValor;
    labelEl.classList.toggle('activo', !nuevoValor);
  }
};

// ============================================
// MODAL: EDITAR LOCALES DE UN EDITOR
// ============================================
window.abrirEditarLocales = function(userId) {
  const user = EDITORES_CACHE.find(u => u.id === userId);
  if (!user) return;
  LOCALES_EDITANDO_ID = userId;

  document.getElementById('localesUserName').innerHTML =
    `<strong>${esc(user.nombre || user.usuario)}</strong>`;

  const asignados = user.locales_asignados || [];

  document.getElementById('localesGrid').innerHTML = LOCALES_DISPONIBLES.map(loc => {
    const activo = asignados.includes(loc);
    return `
      <label class="local-check${activo ? ' activo' : ''}" data-local="${loc}">
        <input type="checkbox" ${activo ? 'checked' : ''}>
        ${esc(LOCAL_LABELS[loc] || loc)}
      </label>`;
  }).join('');

  // Toggle visual
  document.querySelectorAll('#localesGrid .local-check').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      el.classList.toggle('activo');
      const cb = el.querySelector('input');
      cb.checked = el.classList.contains('activo');
    });
  });

  document.getElementById('localesError').textContent = '';
  document.getElementById('modalLocales').classList.add('show');
};

window.closeLocalesModal = function() {
  document.getElementById('modalLocales').classList.remove('show');
};

window.guardarLocales = async function() {
  if (!LOCALES_EDITANDO_ID) return;
  const errBox = document.getElementById('localesError');
  errBox.textContent = '';

  const checks = document.querySelectorAll('#localesGrid .local-check.activo');
  const nuevos = Array.from(checks).map(c => c.dataset.local);

  try {
    await api(`roster_usuarios?id=eq.${LOCALES_EDITANDO_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ locales_asignados: nuevos.length ? nuevos : null })
    });

    // Actualizar caché
    const user = EDITORES_CACHE.find(u => u.id === LOCALES_EDITANDO_ID);
    if (user) user.locales_asignados = nuevos;

    closeLocalesModal();
    toast('✓ Locales actualizados', 'success');
    renderEditores();
  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
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
