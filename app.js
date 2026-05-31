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

// Lista de locales - se carga dinámicamente desde la base al iniciar sesión
// LOCALES_DB es el array completo de objetos {slug, nombre, orden, activo}
// LOCAL_LABELS es un diccionario {slug: nombre_visible} que se construye a partir de LOCALES_DB
let LOCALES_DB = [];
let LOCAL_LABELS = {};

// Helpers para acceder a los locales
function getLocalesActivos() {
  // Devuelve los slugs de los locales activos (para usar en selectores normales)
  return LOCALES_DB.filter(l => l.activo).map(l => l.slug);
}

function getLocalesTodos() {
  // Devuelve los slugs de todos los locales (activos + reservados) - para Admin
  return LOCALES_DB.map(l => l.slug);
}

function localLabel(slug) {
  // Devuelve el nombre visible de un slug (o el slug si no encuentra match)
  return LOCAL_LABELS[slug] || slug;
}

async function cargarLocalesDesdeBase() {
  try {
    const data = await api('locales?order=orden.asc');
    LOCALES_DB = data || [];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
  } catch (e) {
    console.error('Error al cargar locales:', e);
    // Fallback de emergencia para que la app no se rompa si falla la query
    LOCALES_DB = [
      { slug: '1-AZUCA',     nombre: 'Azuca',            orden: 1, activo: true },
      { slug: '2-AZAFRAN',   nombre: 'Azafrán',          orden: 2, activo: true },
      { slug: '3-NIETO',     nombre: 'Nieto Senetiner',  orden: 3, activo: true },
      { slug: '4-VIÑA COBOS', nombre: 'Viña Cobos',      orden: 4, activo: true },
      { slug: '5-TRAPICHE',  nombre: 'Espacio Trapiche', orden: 5, activo: true },
      { slug: 'VINOBIEN',    nombre: 'Vinobien',         orden: 6, activo: true }
    ];
    LOCAL_LABELS = {};
    LOCALES_DB.forEach(l => { LOCAL_LABELS[l.slug] = l.nombre; });
  }
}

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
const TOAST_ICONS = {
  success: 'ti-circle-check',
  error: 'ti-alert-circle',
  warning: 'ti-alert-triangle',
  '': 'ti-info-circle'
};
function toast(msg, kind = 'success') {
  const el = document.getElementById('toast');
  // Si no se pasa kind, asumimos success (es lo más común al guardar)
  const k = kind || 'success';
  const icon = TOAST_ICONS[k] || TOAST_ICONS.success;
  el.className = 'toast show ' + k;
  el.innerHTML = `<i class="ti ${icon}"></i><span>${esc(msg)}</span>`;
  if (toastTimeout) clearTimeout(toastTimeout);
  // Toasts de error duran más para que se alcancen a leer
  const duracion = k === 'error' ? 4500 : 3200;
  toastTimeout = setTimeout(() => {
    el.className = 'toast';
  }, duracion);
}

// ============================================
// MODAL DE CONFIRMACIÓN / ALERTA UNIVERSAL
// ============================================
let _confirmResolve = null;

/**
 * showConfirm(opciones) - muestra un modal de confirmación.
 * Devuelve una Promise<boolean>: true si confirma, false si cancela.
 * opciones: { title, msg, type, okLabel, cancelLabel, danger }
 *   - type: 'warning' (default), 'danger', 'info', 'success'
 *   - danger: si true, el botón OK se pinta rojo
 */
function showConfirm(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = '¿Estás seguro?',
      msg = '',
      type = 'warning',
      okLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.warning);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    const btnOk = document.getElementById('confirmBtnOk');
    const btnCancel = document.getElementById('confirmBtnCancel');
    btnOk.textContent = okLabel;
    btnCancel.textContent = cancelLabel;
    btnOk.className = danger ? 'btn-danger' : 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

/**
 * showAlert(opciones) - como showConfirm pero solo botón OK (informativo).
 * opciones: { title, msg, type, okLabel }
 */
function showAlert(opciones = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const {
      title = 'Atención',
      msg = '',
      type = 'info',
      okLabel = 'Entendido'
    } = opciones;

    const iconBox = document.getElementById('confirmIcon');
    const iconI = iconBox.querySelector('i');
    iconBox.className = 'modal-confirm-icon ' + (type === 'warning' ? '' : type);

    const ICONS = {
      warning: 'ti-alert-triangle',
      danger:  'ti-alert-octagon',
      info:    'ti-info-circle',
      success: 'ti-circle-check'
    };
    iconI.className = 'ti ' + (ICONS[type] || ICONS.info);

    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMsg').textContent = msg;

    // Ocultar botón cancelar, dejar solo OK
    document.getElementById('confirmBtnCancel').style.display = 'none';
    const btnOk = document.getElementById('confirmBtnOk');
    btnOk.textContent = okLabel;
    btnOk.className = 'btn-primary';

    document.getElementById('modalConfirm').style.display = 'flex';
  });
}

function closeConfirm(result) {
  document.getElementById('modalConfirm').style.display = 'none';
  // Restaurar botón cancelar para próximas confirmaciones
  document.getElementById('confirmBtnCancel').style.display = '';
  if (_confirmResolve) {
    const r = _confirmResolve;
    _confirmResolve = null;
    r(result);
  }
}

// ============================================
// CIERRE UNIFICADO DE MODALES
// (click afuera + tecla Escape)
// ============================================
document.addEventListener('click', (e) => {
  // Si el click es directamente sobre el overlay (no en el contenido), cerrarlo
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    const card = e.target.querySelector('.modal-card');
    if (card && card.hasAttribute('data-prevent-close')) return;
    e.target.style.display = 'none';
    // Si era el modal de confirmación, resolver como cancelar
    if (e.target.id === 'modalConfirm' && _confirmResolve) {
      const r = _confirmResolve;
      _confirmResolve = null;
      r(false);
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Buscar el modal abierto más reciente y cerrarlo
    const modales = document.querySelectorAll('.modal-overlay');
    for (let i = modales.length - 1; i >= 0; i--) {
      const m = modales[i];
      if (m.style.display === 'flex') {
        m.style.display = 'none';
        if (m.id === 'modalConfirm' && _confirmResolve) {
          const r = _confirmResolve;
          _confirmResolve = null;
          r(false);
        }
        break;
      }
    }
  }
});

// Exponer al window
window.closeConfirm = closeConfirm;
window.showConfirm = showConfirm;
window.showAlert = showAlert;

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
    visible: () => isMaster() || isAdmin() || (currentUser.locales_asignados && currentUser.locales_asignados.length > 0),
    action: () => openMiBiblioteca()
  },
  {
    id: 'recetas',
    icon: 'ti-chef-hat',
    color: '#D85A30',
    title: 'Mis recetas',
    desc: 'Recetas y menús del local',
    visible: () => isMaster() || isAdmin() || currentUser.editor_recetas,
    action: () => toast('Módulo "Mis recetas" - próximamente', 'warning')
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || isAdmin() || currentUser.editor_pedidos,
    action: () => toast('Módulo "Mis pedidos" - próximamente', 'warning')
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

    // Cargar lista de locales desde la base (necesario para que toda la app
    // muestre los nombres correctos de los locales)
    await cargarLocalesDesdeBase();

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

    openMiPerfil();
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

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Saludo según hora del día + nombre de pila
  const primerNombre = nombre.trim().split(/\s+/)[0];
  const hora = new Date().getHours();
  let saludo, emoji;
  if (hora >= 5 && hora < 12) {
    saludo = 'Buenos días';
    emoji = '☀️';
  } else if (hora >= 12 && hora < 20) {
    saludo = 'Buenas tardes';
    emoji = '🌤️';
  } else {
    saludo = 'Buenas noches';
    emoji = '🌙';
  }
  document.getElementById('greetingText').textContent = `${saludo}, ${primerNombre}`;
  document.getElementById('greetingEmoji').textContent = emoji;

  // User pill
  document.getElementById('userPillName').textContent = nombre;
  document.getElementById('userPillRole').textContent = roleLabel;

  // Avatar: inicial + color según perfil
  const avatarEl = document.getElementById('userPillAvatar');
  avatarEl.textContent = obtenerIniciales(nombre);
  avatarEl.className = 'user-pill-avatar avatar-' + perfil;

  document.getElementById('datetime').textContent = fmtDateTime(new Date());

  renderDashboardCards();
  showView('vDash');
}

// Devuelve hasta 2 iniciales del nombre (ej: "Matías Fraga" → "MF")
function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/);
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
  return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
}

// ============================================
// MI PERFIL
// ============================================
async function openMiPerfil() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  const nombre = currentUser.nombre || currentUser.usuario;
  const perfil = currentUser.perfil || 'usuario';
  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[perfil] || 'Usuario';

  // Avatar grande
  const avatar = document.getElementById('perfilAvatar');
  avatar.textContent = obtenerIniciales(nombre);
  avatar.className = 'perfil-avatar avatar-' + perfil;

  // Datos básicos
  document.getElementById('perfilNombre').textContent = nombre;
  document.getElementById('perfilUsuario').textContent = '@' + (currentUser.usuario || '');

  const badge = document.getElementById('perfilBadge');
  badge.textContent = roleLabel;
  badge.className = 'perfil-badge ' + perfil;

  // Empleado
  document.getElementById('perfilEmpleado').textContent =
    currentUser.empleado_id ? '#' + currentUser.empleado_id : 'Sin asignar';

  // Tipo de perfil expandido
  const perfilDescripciones = {
    master:  'Master · Control total',
    admin:   'Admin · Administra todo menos Locales',
    editor:  'Editor · Permisos según módulo',
    usuario: 'Usuario · Solo lectura de lo propio'
  };
  document.getElementById('perfilTipo').textContent =
    perfilDescripciones[perfil] || roleLabel;

  // Locales asignados
  const filaLocales = document.getElementById('perfilLocalesRow');
  const elLocales = document.getElementById('perfilLocales');

  if (perfil === 'master' || perfil === 'admin') {
    elLocales.textContent = 'Todos los locales';
  } else {
    const locs = currentUser.locales_asignados || [];
    if (locs.length === 0) {
      elLocales.textContent = 'Sin locales asignados';
      elLocales.style.color = '#E24B4A';
    } else {
      const nombresVisibles = locs.map(slug => localLabel(slug)).join(', ');
      elLocales.textContent = nombresVisibles;
      elLocales.style.color = '';
    }
  }

  showView('vMiPerfil');
}

window.openMiPerfil = openMiPerfil;

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

// ============================================
// GESTIÓN DE PROPINAS
// ============================================

let PROP_CIERRES = [];
let PROP_LOCAL_SEL = null;  // local seleccionado para filtrar
let PROP_CONFIG = null;     // cache de propinas_config

// ¿Quién puede entrar al módulo?
function puedeGestionarPropinas() {
  return isMaster() || isAdmin() || currentUser.editor_propinas === true;
}

// ¿Quién puede tocar configuración y marcar como pagado?
function puedeAdminPropinas() {
  return isMaster() || isAdmin();
}

// Locales que puede operar este usuario
function localesPropinasUsuario() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  // Editor: solo sus locales asignados que estén activos
  const asignados = currentUser.locales_asignados || [];
  return asignados.filter(loc => getLocalesActivos().includes(loc));
}

async function abrirGestionPropinas() {
  if (!puedeGestionarPropinas()) {
    toast('No tenés permiso para gestionar propinas', 'error');
    return;
  }

  showView('vGestionPropinas');
  document.getElementById('propGestTabla').innerHTML = '<div class="loading">Cargando cierres...</div>';
  document.getElementById('propGestKpis').innerHTML = '';

  // Cargar config + cierres en paralelo
  try {
    const [configs, cierres] = await Promise.all([
      api('propinas_config?id=eq.1'),
      api('propinas_cierres?order=fecha.desc,id.desc')
    ]);
    PROP_CONFIG = (configs && configs[0]) ? configs[0] : null;
    PROP_CIERRES = cierres || [];
  } catch (e) {
    document.getElementById('propGestTabla').innerHTML =
      '<div class="loading" style="color:var(--c-error)">Error al cargar datos</div>';
    return;
  }

  // Pre-seleccionar el primer local del usuario si no hay selección
  const localesUser = localesPropinasUsuario();
  if (!PROP_LOCAL_SEL || !localesUser.includes(PROP_LOCAL_SEL)) {
    PROP_LOCAL_SEL = localesUser[0] || null;
  }

  renderPropGestHeader();
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
}

function renderPropGestHeader() {
  const subtitle = document.getElementById('propGestSubtitle');
  // Agregar botón Configurar al header si tiene permiso
  const headerBlock = subtitle.parentElement.parentElement;

  // Eliminar botón previo si existe (para evitar duplicados al re-renderizar)
  const oldBtn = headerBlock.querySelector('.btn-config-propinas');
  if (oldBtn) oldBtn.remove();

  if (puedeAdminPropinas()) {
    const btn = document.createElement('button');
    btn.className = 'btn-config-propinas';
    btn.title = 'Configurar tipos de cambio';
    btn.innerHTML = '<i class="ti ti-settings"></i>';
    btn.onclick = openConfigPropinas;
    headerBlock.appendChild(btn);
  }

  subtitle.textContent = puedeAdminPropinas()
    ? 'Cierres registrados · podés editarlos y marcar como pagados'
    : 'Cierres registrados de tus locales';
}

function renderPropGestLocales() {
  const cont = document.getElementById('propGestLocales');
  const locales = localesPropinasUsuario();

  if (locales.length === 0) {
    cont.innerHTML = '<div class="bib-empty"><i class="ti ti-map-pin-off"></i><div class="bib-empty-title">No tenés locales asignados</div></div>';
    return;
  }

  if (locales.length === 1) {
    // Si solo tiene un local, no mostrar selector
    cont.innerHTML = '';
    return;
  }

  cont.innerHTML = locales.map(slug => `
    <button class="bib-chip ${PROP_LOCAL_SEL === slug ? 'active' : ''}"
            onclick="selectPropLocal('${esc(slug).replace(/'/g, "\\'")}')">
      <i class="ti ti-map-pin"></i>${esc(localLabel(slug))}
    </button>
  `).join('');
}

function selectPropLocal(slug) {
  PROP_LOCAL_SEL = slug;
  renderPropGestLocales();
  renderPropGestKpis();
  renderPropGestTabla();
}

function cierresLocalActual() {
  if (!PROP_LOCAL_SEL) return [];
  return PROP_CIERRES.filter(c => c.local === PROP_LOCAL_SEL);
}

function renderPropGestKpis() {
  const cont = document.getElementById('propGestKpis');
  const cierres = cierresLocalActual();

  const total = cierres.length;
  const pendientes = cierres.filter(c => !c.pagado).length;
  const pagados = total - pendientes;

  const bruto = cierres.reduce((s, c) => s + parseFloat(c.total_bruto || 0), 0);
  const netoPendiente = cierres.filter(c => !c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);
  const netoPagado = cierres.filter(c => c.pagado).reduce((s, c) => s + parseFloat(c.total_neto || 0), 0);

  cont.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Cierres</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">${pendientes} pendiente${pendientes !== 1 ? 's' : ''} · ${pagados} pagado${pagados !== 1 ? 's' : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total bruto acumulado</div>
      <div class="kpi-value">$${formatNumber(bruto)}</div>
    </div>
    <div class="kpi-card highlight">
      <div class="kpi-label">Neto a liquidar</div>
      <div class="kpi-value">$${formatNumber(netoPendiente)}</div>
      <div class="kpi-sub">+$${formatNumber(netoPagado)} ya pagados</div>
    </div>
  `;
}

function renderPropGestTabla() {
  const cont = document.getElementById('propGestTabla');
  const cierres = cierresLocalActual();

  if (cierres.length === 0) {
    cont.innerHTML = `
      <div class="prop-empty">
        <i class="ti ti-cash-off"></i>
        <div class="prop-empty-title">No hay cierres todavía</div>
        <div class="prop-empty-desc">${PROP_LOCAL_SEL
          ? 'Cuando se cargue el primer cierre de ' + localLabel(PROP_LOCAL_SEL) + ', aparecerá acá.'
          : 'Elegí un local para ver sus cierres.'}</div>
      </div>`;
    return;
  }

  const TURNOS_LABEL = {
    mediodia: '🍲 Mediodía',
    'mediodía': '🍲 Mediodía',
    noche: '🌙 Noche',
    evento: '🎉 Evento',
    especial: '⭐ Especial'
  };

  let html = `
    <div class="prop-tabla">
      <div class="prop-tabla-header">
        <span>Fecha</span>
        <span>Turno</span>
        <span>Bruto</span>
        <span>Neto</span>
        <span>Puntos</span>
        <span>Estado</span>
      </div>`;

  cierres.forEach(c => {
    const fecha = c.fecha ? fmtFechaCorta(c.fecha) : '—';
    const turnoKey = (c.turno || '').toLowerCase();
    const turnoLabel = TURNOS_LABEL[turnoKey] || (c.turno || '—');
    const estadoCls = c.pagado ? 'pagado' : 'cerrado';
    const estadoTxt = c.pagado ? '✓ Pagado' : 'Cerrado';

    // Solo Admin/Master puede togglear pagado
    const estadoClickable = puedeAdminPropinas() ? `onclick="togglePagado(${c.id})"` : '';
    const estadoTitle = puedeAdminPropinas()
      ? (c.pagado ? 'title="Click para volver a Cerrado"' : 'title="Click para marcar como Pagado"')
      : '';

    html += `
      <div class="prop-tabla-row">
        <span class="prop-fecha">${fecha}</span>
        <span class="prop-turno">${turnoLabel}</span>
        <span class="prop-monto">$${formatNumber(c.total_bruto || 0)}</span>
        <span class="prop-monto">$${formatNumber(c.total_neto || 0)}</span>
        <span>${c.total_puntos || 0}</span>
        <span class="prop-estado ${estadoCls}" ${estadoClickable} ${estadoTitle}>${estadoTxt}</span>
      </div>`;
  });

  html += '</div>';
  cont.innerHTML = html;
}

// Helper para formatear fecha corta tipo "18-may"
function fmtFechaCorta(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T00:00:00');
  const dia = d.getDate();
  const mes = MESES_CORTO[d.getMonth()];
  return `${dia}-${mes}`;
}

// Toggle pagado / cerrado
async function togglePagado(cierreId) {
  if (!puedeAdminPropinas()) return;
  const c = PROP_CIERRES.find(x => x.id === cierreId);
  if (!c) return;

  if (!c.pagado) {
    // Confirmar marcar como pagado
    const ok = await showConfirm({
      title: '¿Marcar como pagado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\nNeto: $${formatNumber(c.total_neto || 0)}\n\nAl marcar como pagado, los empleados dejarán de verlo en sus pendientes.`,
      type: 'success',
      okLabel: 'Sí, marcar pagado',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    // Confirmar revertir a cerrado
    const ok = await showConfirm({
      title: '¿Revertir a Cerrado?',
      msg: `Cierre del ${fmtFechaCorta(c.fecha)} · ${c.turno}\n\nAl revertir, volverá a aparecer como pendiente en los empleados.`,
      type: 'warning',
      okLabel: 'Revertir',
      cancelLabel: 'Cancelar',
      danger: true
    });
    if (!ok) return;
  }

  try {
    const body = c.pagado
      ? { pagado: false, pagado_en: null, pagado_por: null, actualizado_en: new Date().toISOString() }
      : { pagado: true, pagado_en: new Date().toISOString(), pagado_por: currentUser.id, actualizado_en: new Date().toISOString() };

    await api(`propinas_cierres?id=eq.${cierreId}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache local
    Object.assign(c, body);

    toast(c.pagado ? 'Marcado como pagado' : 'Vuelto a Cerrado');
    renderPropGestKpis();
    renderPropGestTabla();
  } catch (e) {
    toast('Error al actualizar', 'error');
  }
}

// Placeholder para nuevo cierre (Fase 2)
function nuevoCierrePlaceholder() {
  toast('Carga de cierres - próximamente (Fase 2)', 'warning');
}

// ============================================
// CONFIGURACIÓN DE PROPINAS
// ============================================
async function openConfigPropinas() {
  if (!puedeAdminPropinas()) return;

  // Si no hay config cargada, traerla
  if (!PROP_CONFIG) {
    try {
      const data = await api('propinas_config?id=eq.1');
      PROP_CONFIG = (data && data[0]) ? data[0] : null;
    } catch (e) {
      toast('Error al cargar configuración', 'error');
      return;
    }
  }

  if (!PROP_CONFIG) {
    toast('No se encontró configuración', 'error');
    return;
  }

  document.getElementById('configUSD').value = PROP_CONFIG.cambio_usd || '';
  document.getElementById('configEUR').value = PROP_CONFIG.cambio_eur || '';
  document.getElementById('configBRL').value = PROP_CONFIG.cambio_brl || '';
  document.getElementById('configPct').value = PROP_CONFIG.porcentaje_admin || '';

  // Última actualización
  const ultima = PROP_CONFIG.actualizado_en
    ? `Última actualización: ${new Date(PROP_CONFIG.actualizado_en).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })}`
    : 'Sin actualización previa';
  document.getElementById('configUltima').textContent = ultima;

  document.getElementById('modalConfigPropinas').style.display = 'flex';
}

function closeConfigPropinas() {
  document.getElementById('modalConfigPropinas').style.display = 'none';
}

async function guardarConfigPropinas() {
  const usd = parseFloat(document.getElementById('configUSD').value);
  const eur = parseFloat(document.getElementById('configEUR').value);
  const brl = parseFloat(document.getElementById('configBRL').value);
  const pct = parseFloat(document.getElementById('configPct').value);

  if (isNaN(usd) || usd <= 0) { toast('USD inválido', 'error'); return; }
  if (isNaN(eur) || eur <= 0) { toast('EUR inválido', 'error'); return; }
  if (isNaN(brl) || brl <= 0) { toast('BRL inválido', 'error'); return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { toast('Porcentaje inválido (0-100)', 'error'); return; }

  const btn = document.getElementById('btnGuardarConfig');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const body = {
      cambio_usd: usd,
      cambio_eur: eur,
      cambio_brl: brl,
      porcentaje_admin: pct,
      actualizado_en: new Date().toISOString(),
      actualizado_por: currentUser.id
    };
    await api('propinas_config?id=eq.1', {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    // Actualizar cache
    PROP_CONFIG = Object.assign({}, PROP_CONFIG, body);

    toast('Configuración actualizada');
    closeConfigPropinas();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar configuración';
  }
}

// Exponer al window
window.abrirGestionPropinas = abrirGestionPropinas;
window.selectPropLocal = selectPropLocal;
window.togglePagado = togglePagado;
window.nuevoCierrePlaceholder = nuevoCierrePlaceholder;
window.openConfigPropinas = openConfigPropinas;
window.closeConfigPropinas = closeConfigPropinas;
window.guardarConfigPropinas = guardarConfigPropinas;

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
    activa: true,
    soloMaster: true,
    action: () => openAdminLocales()
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
    const ok = await showConfirm({
      title: 'Desactivar a un Master',
      msg: `Estás por desactivar a un Master (${u.nombre}).\n\nSi te quedás sin Masters, NADIE va a poder crear nuevos Masters ni editar Locales.\n\n¿Seguro que querés continuar?`,
      type: 'danger',
      danger: true,
      okLabel: 'Sí, desactivar',
      cancelLabel: 'Cancelar'
    });
    if (!ok) return;
  } else {
    const accion = u.activo ? 'desactivar' : 'activar';
    const ok = await showConfirm({
      title: `¿${accion.charAt(0).toUpperCase() + accion.slice(1)} usuario?`,
      msg: `Vas a ${accion} a ${u.nombre || u.usuario}.`,
      type: u.activo ? 'warning' : 'info',
      okLabel: u.activo ? 'Desactivar' : 'Activar',
      danger: u.activo
    });
    if (!ok) return;
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
// LOCALES_DISPONIBLES ya no es una constante: ahora se obtiene dinámicamente
// con getLocalesActivos() desde la base.

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

  document.getElementById('localesGrid').innerHTML = getLocalesActivos().map(loc => {
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
window.doLogout = async function() {
  const ok = await showConfirm({
    title: '¿Cerrar sesión?',
    msg: 'Vas a salir de AZUCAPP. Tendrás que volver a iniciar sesión.',
    type: 'info',
    okLabel: 'Cerrar sesión',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
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

        // Cargar lista de locales antes de mostrar nada
        await cargarLocalesDesdeBase();

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

// ============================================
// MÓDULO: BIBLIOTECA
// ============================================

let BIB_CATEGORIAS = [];     // cache de categorías
let BIB_CONTENIDOS = [];     // cache de contenidos visibles
let BIB_FILTRO_CAT = null;   // null = "Todas", o id de categoría
let BIB_EDITANDO_CONT = null; // contenido que se está editando (o null = nuevo)
let BIB_EDITANDO_CAT = null;  // categoría que se está editando (o null = nueva)
let BIB_TIPO_SEL = 'pdf';    // tipo seleccionado en modal
let BIB_LOCALES_SEL = [];    // locales seleccionados en modal
let BIB_ICONO_SEL = 'ti-folder'; // ícono seleccionado en modal categoría

// Definición de tipos de contenido
const BIB_TIPOS = [
  { key: 'pdf',   label: 'PDF',   icon: 'ti-file-text',        cls: 'bib-icon-pdf' },
  { key: 'doc',   label: 'Doc',   icon: 'ti-file-description', cls: 'bib-icon-doc' },
  { key: 'video', label: 'Video', icon: 'ti-brand-youtube',    cls: 'bib-icon-video' },
  { key: 'audio', label: 'Audio', icon: 'ti-brand-spotify',    cls: 'bib-icon-audio' }
];

// Íconos disponibles para categorías
const BIB_ICONOS_CAT = [
  'ti-folder', 'ti-building-bank', 'ti-school', 'ti-clipboard-list',
  'ti-shield', 'ti-sparkles', 'ti-chef-hat', 'ti-tools',
  'ti-heart', 'ti-flame', 'ti-bell', 'ti-bookmark',
  'ti-star', 'ti-bulb', 'ti-trophy', 'ti-coffee',
  'ti-map', 'ti-camera', 'ti-music', 'ti-message',
  'ti-calendar', 'ti-target', 'ti-rocket', 'ti-leaf'
];

// ¿Puede el usuario administrar la biblioteca?
function puedeAdminBib() {
  return isMaster() || isAdmin() || currentUser.editor_biblioteca === true;
}

// ¿Puede gestionar categorías y borrar? (solo Admin/Master)
function puedeAdminBibCat() {
  return isMaster() || isAdmin();
}

// Locales del usuario actual (o todos si es master/admin)
function localesUsuarioActual() {
  if (isMaster() || isAdmin()) return getLocalesActivos();
  return currentUser.locales_asignados || [];
}

// ============================================
// VISTA USUARIO: Mi Biblioteca
// ============================================
async function openMiBiblioteca() {
  showView('vBiblioteca');
  const cont = document.getElementById('bibContenido');
  const chips = document.getElementById('bibChips');
  cont.innerHTML = '<div class="loading">Cargando biblioteca...</div>';
  chips.innerHTML = '';

  // Cargar categorías y contenidos en paralelo
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?activo=eq.true&order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    cont.innerHTML = '<div class="loading" style="color:var(--c-error)">Error al cargar biblioteca</div>';
    return;
  }

  // Filtrar contenidos por locales del usuario
  const localesUser = localesUsuarioActual();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    if (!c.locales || c.locales.length === 0) return false;
    return c.locales.some(loc => localesUser.includes(loc));
  });

  // Render chips de categorías
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibChips(visibles) {
  const chips = document.getElementById('bibChips');
  // Solo mostrar categorías que tengan al menos un contenido visible
  const catsConContenido = BIB_CATEGORIAS.filter(cat =>
    visibles.some(c => c.categoria_id === cat.id)
  );

  let html = `<button class="bib-chip ${BIB_FILTRO_CAT === null ? 'active' : ''}" onclick="filtrarBibCat(null)">Todas</button>`;
  catsConContenido.forEach(cat => {
    html += `<button class="bib-chip ${BIB_FILTRO_CAT === cat.id ? 'active' : ''}" onclick="filtrarBibCat(${cat.id})">
      <i class="ti ${esc(cat.icono || 'ti-folder')}"></i>${esc(cat.nombre)}
    </button>`;
  });
  chips.innerHTML = html;
}

function filtrarBibCat(catId) {
  BIB_FILTRO_CAT = catId;
  // Re-render con filtro aplicado
  const localesUser = localesUsuarioActual();
  const visibles = BIB_CONTENIDOS.filter(c => {
    if (isMaster() || isAdmin()) return true;
    if (!c.locales || c.locales.length === 0) return false;
    return c.locales.some(loc => localesUser.includes(loc));
  });
  renderBibChips(visibles);
  renderBibContenidos(visibles);
}

function renderBibContenidos(visibles) {
  const cont = document.getElementById('bibContenido');
  const filtrados = BIB_FILTRO_CAT === null
    ? visibles
    : visibles.filter(c => c.categoria_id === BIB_FILTRO_CAT);

  let html = '';

  // ===== BOTÓN DE GESTIÓN (solo Editor con permiso, Admin o Master) =====
  if (puedeAdminBib()) {
    html += `
      <button class="btn-gestion" onclick="openAdminBiblioteca()">
        <i class="ti ti-settings"></i> GESTIÓN DE BIBLIOTECA
      </button>`;
  }

  if (filtrados.length === 0) {
    html += `
      <div class="bib-empty">
        <i class="ti ti-books-off"></i>
        <div class="bib-empty-title">No hay contenido disponible</div>
        <div class="bib-empty-desc">${BIB_FILTRO_CAT === null
          ? 'Cuando se cargue material, aparecerá acá.'
          : 'No hay material en esta categoría para tus locales.'}</div>
      </div>`;
    cont.innerHTML = html;
    return;
  }

  html += '<div class="bib-grid">';
  filtrados.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    html += `
      <a class="bib-card" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
        <div class="bib-card-top">
          <div class="bib-card-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
          <span class="bib-card-tipo">${tipo.label}</span>
        </div>
        <div class="bib-card-titulo">${esc(c.titulo)}</div>
        <div class="bib-card-cat">
          <i class="ti ${esc(cat ? cat.icono : 'ti-folder')}"></i>
          ${esc(cat ? cat.nombre : 'Sin categoría')}
        </div>
      </a>`;
  });
  html += '</div>';
  cont.innerHTML = html;
}

// ============================================
// VISTA ADMIN: Administrar Biblioteca
// ============================================
async function openAdminBiblioteca() {
  if (!puedeAdminBib()) {
    toast('No tenés permiso', 'error');
    return;
  }
  showView('vAdminBiblioteca');

  // Tab de categorías solo visible para Admin/Master
  document.getElementById('bibTabCategorias').style.display =
    puedeAdminBibCat() ? 'inline-flex' : 'none';

  // Subtítulo según rol
  document.getElementById('adminBibSubtitle').textContent =
    puedeAdminBibCat() ? 'Gestión de contenidos y categorías' : 'Gestión de contenidos';

  // Mostrar tab contenidos por defecto
  switchBibTab('contenidos');

  // Cargar datos
  await recargarBibAdmin();
}

async function recargarBibAdmin() {
  try {
    const [cats, conts] = await Promise.all([
      api('biblioteca_categorias?activo=eq.true&order=orden.asc'),
      api('biblioteca_contenidos?activo=eq.true&order=creado_en.desc')
    ]);
    BIB_CATEGORIAS = cats || [];
    BIB_CONTENIDOS = conts || [];
  } catch (e) {
    toast('Error al cargar datos', 'error');
    return;
  }
  renderBibAdminLista();
  renderBibAdminCategorias();
}

function switchBibTab(tab) {
  const tabCont = document.getElementById('bibTabContenidos');
  const tabCat  = document.getElementById('bibTabCategorias');
  const panCont = document.getElementById('bibPanelContenidos');
  const panCat  = document.getElementById('bibPanelCategorias');

  if (tab === 'contenidos') {
    tabCont.classList.add('active');
    tabCat.classList.remove('active');
    panCont.style.display = 'block';
    panCat.style.display = 'none';
  } else {
    tabCont.classList.remove('active');
    tabCat.classList.add('active');
    panCont.style.display = 'none';
    panCat.style.display = 'block';
  }
}

function renderBibAdminLista() {
  const cont = document.getElementById('bibAdminLista');
  if (BIB_CONTENIDOS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-files-off"></i>
        <div class="bib-empty-title">No hay contenidos cargados</div>
        <div class="bib-empty-desc">Tocá "Agregar contenido" para sumar el primero.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CONTENIDOS.forEach(c => {
    const tipo = BIB_TIPOS.find(t => t.key === c.tipo) || BIB_TIPOS[0];
    const cat = BIB_CATEGORIAS.find(k => k.id === c.categoria_id);
    const locTxt = (!c.locales || c.locales.length === 0)
      ? 'Sin locales'
      : (c.locales.length === getLocalesActivos().length
          ? 'Todos los locales'
          : c.locales.length + ' local' + (c.locales.length > 1 ? 'es' : ''));

    const btnDelete = puedeAdminBibCat()
      ? `<button class="bib-btn-delete" onclick="borrarContenido(${c.id})" title="Borrar"><i class="ti ti-trash"></i></button>`
      : '';

    html += `
      <div class="bib-admin-item">
        <div class="bib-admin-item-icon ${tipo.cls}"><i class="ti ${tipo.icon}"></i></div>
        <div class="bib-admin-item-info">
          <div class="bib-admin-item-titulo">${esc(c.titulo)}</div>
          <div class="bib-admin-item-meta">${esc(cat ? cat.nombre : 'Sin categoría')} · ${locTxt}</div>
        </div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalContenido(${c.id})" title="Editar"><i class="ti ti-edit"></i></button>
          ${btnDelete}
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function renderBibAdminCategorias() {
  const cont = document.getElementById('bibAdminCategorias');
  if (BIB_CATEGORIAS.length === 0) {
    cont.innerHTML = `
      <div class="bib-empty">
        <i class="ti ti-folder-off"></i>
        <div class="bib-empty-title">No hay categorías</div>
        <div class="bib-empty-desc">Creá la primera categoría para empezar a organizar el contenido.</div>
      </div>`;
    return;
  }

  let html = '';
  BIB_CATEGORIAS.forEach(cat => {
    const count = BIB_CONTENIDOS.filter(c => c.categoria_id === cat.id).length;
    html += `
      <div class="bib-cat-item">
        <div class="bib-cat-icon-box"><i class="ti ${esc(cat.icono || 'ti-folder')}"></i></div>
        <div class="bib-cat-nombre">${esc(cat.nombre)}</div>
        <div class="bib-cat-count">${count} contenido${count !== 1 ? 's' : ''}</div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalCategoria(${cat.id})" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="bib-btn-delete" onclick="borrarCategoria(${cat.id})" title="Borrar"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

// ============================================
// MODAL: AGREGAR / EDITAR CONTENIDO
// ============================================
function openModalContenido(contId) {
  BIB_EDITANDO_CONT = contId;
  const c = contId ? BIB_CONTENIDOS.find(x => x.id === contId) : null;

  document.getElementById('modalContenidoTitle').textContent = c ? 'Editar contenido' : 'Nuevo contenido';
  document.getElementById('contTitulo').value = c ? c.titulo : '';
  document.getElementById('contUrl').value = c ? c.url : '';

  // Categorías
  const selectCat = document.getElementById('contCategoria');
  selectCat.innerHTML = BIB_CATEGORIAS.map(cat =>
    `<option value="${cat.id}">${esc(cat.nombre)}</option>`
  ).join('');
  if (c) selectCat.value = c.categoria_id;
  else if (BIB_CATEGORIAS.length) selectCat.value = BIB_CATEGORIAS[0].id;

  // Tipo
  BIB_TIPO_SEL = c ? c.tipo : 'pdf';
  renderTipoGrid();
  actualizarHintUrl();

  // Locales
  BIB_LOCALES_SEL = c && c.locales ? c.locales.slice() : [];
  renderLocalesChips();

  document.getElementById('modalContenido').style.display = 'flex';
}

function closeModalContenido() {
  document.getElementById('modalContenido').style.display = 'none';
  BIB_EDITANDO_CONT = null;
}

function renderTipoGrid() {
  const cont = document.getElementById('contTipoGrid');
  cont.innerHTML = BIB_TIPOS.map(t => `
    <button class="tipo-btn ${BIB_TIPO_SEL === t.key ? 'active' : ''}" onclick="selectTipo('${t.key}')">
      <i class="ti ${t.icon}"></i>${t.label}
    </button>
  `).join('');
}

function selectTipo(key) {
  BIB_TIPO_SEL = key;
  renderTipoGrid();
  actualizarHintUrl();
}

function actualizarHintUrl() {
  const hint = document.getElementById('contUrlHint');
  const placeholders = {
    pdf:   'Ej: link de Google Drive, Dropbox o cualquier PDF online',
    doc:   'Ej: link de Google Docs, Word online o similar',
    video: 'Ej: link de YouTube o Vimeo',
    audio: 'Ej: link de Spotify, Apple Podcasts, etc.'
  };
  hint.textContent = placeholders[BIB_TIPO_SEL] || 'Pegá el link completo';
}

function renderLocalesChips() {
  const cont = document.getElementById('contLocales');
  cont.innerHTML = getLocalesActivos().map(loc => {
    const activo = BIB_LOCALES_SEL.includes(loc);
    return `<button class="loc-chip ${activo ? 'active' : ''}" onclick="toggleLocalChip('${loc}')">
      ${activo ? '<i class="ti ti-check"></i>' : ''}${esc(LOCAL_LABELS[loc] || loc)}
    </button>`;
  }).join('');
}

function toggleLocalChip(loc) {
  const idx = BIB_LOCALES_SEL.indexOf(loc);
  if (idx >= 0) BIB_LOCALES_SEL.splice(idx, 1);
  else BIB_LOCALES_SEL.push(loc);
  renderLocalesChips();
}

async function guardarContenido() {
  const titulo = document.getElementById('contTitulo').value.trim();
  const url = document.getElementById('contUrl').value.trim();
  const categoria_id = parseInt(document.getElementById('contCategoria').value, 10);

  if (!titulo) { toast('Falta el título', 'error'); return; }
  if (!url) { toast('Falta el link', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) { toast('El link debe empezar con http:// o https://', 'error'); return; }
  if (!categoria_id) { toast('Elegí una categoría', 'error'); return; }
  if (BIB_LOCALES_SEL.length === 0) { toast('Elegí al menos un local', 'error'); return; }

  const btn = document.getElementById('btnGuardarContenido');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const body = {
    titulo,
    categoria_id,
    tipo: BIB_TIPO_SEL,
    url,
    locales: BIB_LOCALES_SEL,
    actualizado_en: new Date().toISOString()
  };

  try {
    if (BIB_EDITANDO_CONT) {
      // UPDATE
      await api(`biblioteca_contenidos?id=eq.${BIB_EDITANDO_CONT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Contenido actualizado');
    } else {
      // INSERT
      body.creado_por = currentUser.id;
      await api('biblioteca_contenidos', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Contenido agregado');
    }
    closeModalContenido();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function borrarContenido(id) {
  const c = BIB_CONTENIDOS.find(x => x.id === id);
  if (!c) return;
  const ok = await showConfirm({
    title: '¿Borrar contenido?',
    msg: `Vas a eliminar "${c.titulo}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    // Soft delete
    await api(`biblioteca_contenidos?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() })
    });
    toast('Contenido borrado');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// ============================================
// MODAL: AGREGAR / EDITAR CATEGORÍA
// ============================================
function openModalCategoria(catId) {
  if (!puedeAdminBibCat()) return;
  BIB_EDITANDO_CAT = catId;
  const c = catId ? BIB_CATEGORIAS.find(x => x.id === catId) : null;

  document.getElementById('modalCategoriaTitle').textContent = c ? 'Editar categoría' : 'Nueva categoría';
  document.getElementById('catNombre').value = c ? c.nombre : '';

  BIB_ICONO_SEL = c ? (c.icono || 'ti-folder') : 'ti-folder';
  renderIconPicker();

  document.getElementById('modalCategoria').style.display = 'flex';
}

function closeModalCategoria() {
  document.getElementById('modalCategoria').style.display = 'none';
  BIB_EDITANDO_CAT = null;
}

function renderIconPicker() {
  const cont = document.getElementById('catIconPicker');
  cont.innerHTML = BIB_ICONOS_CAT.map(ic => `
    <div class="icon-opt ${BIB_ICONO_SEL === ic ? 'active' : ''}" onclick="selectIcono('${ic}')">
      <i class="ti ${ic}"></i>
    </div>
  `).join('');
}

function selectIcono(ic) {
  BIB_ICONO_SEL = ic;
  renderIconPicker();
}

async function guardarCategoria() {
  const nombre = document.getElementById('catNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarCategoria');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const body = { nombre, icono: BIB_ICONO_SEL };

  try {
    if (BIB_EDITANDO_CAT) {
      await api(`biblioteca_categorias?id=eq.${BIB_EDITANDO_CAT}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      toast('Categoría actualizada');
    } else {
      // Orden = el siguiente al máximo actual
      const maxOrden = BIB_CATEGORIAS.reduce((m, c) => Math.max(m, c.orden || 0), 0);
      body.orden = maxOrden + 1;
      await api('biblioteca_categorias', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      toast('Categoría creada');
    }
    closeModalCategoria();
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

async function borrarCategoria(id) {
  const cat = BIB_CATEGORIAS.find(c => c.id === id);
  if (!cat) return;

  const contCount = BIB_CONTENIDOS.filter(c => c.categoria_id === id).length;
  if (contCount > 0) {
    await showAlert({
      title: 'No se puede borrar',
      msg: `La categoría "${cat.nombre}" tiene ${contCount} contenido(s) asignado(s).\n\nMové o borrá esos contenidos primero.`,
      type: 'warning',
      okLabel: 'Entendido'
    });
    return;
  }

  const ok = await showConfirm({
    title: '¿Borrar categoría?',
    msg: `Vas a eliminar la categoría "${cat.nombre}".\n\nEsta acción no se puede deshacer.`,
    type: 'danger',
    danger: true,
    okLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  try {
    await api(`biblioteca_categorias?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: false })
    });
    toast('Categoría borrada');
    await recargarBibAdmin();
  } catch (e) {
    toast('Error al borrar', 'error');
  }
}

// Exponer funciones globalmente (para onclick desde HTML)
window.openMiBiblioteca = openMiBiblioteca;
window.openAdminBiblioteca = openAdminBiblioteca;
window.filtrarBibCat = filtrarBibCat;
window.switchBibTab = switchBibTab;
window.openModalContenido = openModalContenido;
window.closeModalContenido = closeModalContenido;
window.selectTipo = selectTipo;
window.toggleLocalChip = toggleLocalChip;
window.guardarContenido = guardarContenido;
window.borrarContenido = borrarContenido;
window.openModalCategoria = openModalCategoria;
window.closeModalCategoria = closeModalCategoria;
window.selectIcono = selectIcono;
window.guardarCategoria = guardarCategoria;
window.borrarCategoria = borrarCategoria;

// ============================================
// ADMIN: GESTIÓN DE LOCALES
// ============================================

let LOCAL_EDITANDO = null;   // slug del local que se está editando
let LOCAL_ACTIVO_SEL = true; // estado seleccionado en el modal

async function openAdminLocales() {
  if (!isMaster()) {
    toast('Solo Master puede gestionar locales', 'error');
    showDashboard();
    return;
  }
  showView('vAdminLocales');
  await recargarLocalesAdmin();
}

async function recargarLocalesAdmin() {
  // Refrescar caché en memoria
  await cargarLocalesDesdeBase();
  renderLocalesAdmin();
}

function renderLocalesAdmin() {
  const cont = document.getElementById('localesAdminLista');
  const count = document.getElementById('localesAdminCount');

  const activos = LOCALES_DB.filter(l => l.activo).length;
  count.textContent = `${activos} activo${activos !== 1 ? 's' : ''} de ${LOCALES_DB.length}`;

  if (LOCALES_DB.length === 0) {
    cont.innerHTML = `<div class="bib-empty">
      <i class="ti ti-building-skyscraper"></i>
      <div class="bib-empty-title">No hay locales cargados</div>
      <div class="bib-empty-desc">Algo raro pasó con la base. Avisá al equipo técnico.</div>
    </div>`;
    return;
  }

  let html = '';
  LOCALES_DB.forEach(l => {
    const cls = 'local-admin-item' + (l.activo ? '' : ' inactivo');
    const badgeCls = l.activo ? 'activo' : 'inactivo';
    const badgeTxt = l.activo ? 'Activo' : 'Oculto';
    const icon = l.activo ? 'ti-building-store' : 'ti-building-store';
    html += `
      <div class="${cls}">
        <div class="local-admin-item-icon"><i class="ti ${icon}"></i></div>
        <div class="local-admin-item-info">
          <div class="local-admin-item-nombre">
            ${esc(l.nombre)}
            <span class="local-badge ${badgeCls}">${badgeTxt}</span>
          </div>
          <div class="local-admin-item-slug">${esc(l.slug)}</div>
        </div>
        <div class="bib-admin-item-actions">
          <button class="bib-btn-edit" onclick="openModalLocal('${esc(l.slug).replace(/'/g, "\\'")}')" title="Editar">
            <i class="ti ti-edit"></i>
          </button>
        </div>
      </div>`;
  });
  cont.innerHTML = html;
}

function openModalLocal(slug) {
  const l = LOCALES_DB.find(x => x.slug === slug);
  if (!l) { toast('Local no encontrado', 'error'); return; }

  LOCAL_EDITANDO = slug;
  LOCAL_ACTIVO_SEL = l.activo;

  document.getElementById('localSlug').value = l.slug;
  document.getElementById('localNombre').value = l.nombre;
  actualizarToggleLocal();
  document.getElementById('modalLocal').style.display = 'flex';
}

function closeModalLocal() {
  document.getElementById('modalLocal').style.display = 'none';
  LOCAL_EDITANDO = null;
}

function setLocalActivo(val) {
  LOCAL_ACTIVO_SEL = val;
  actualizarToggleLocal();
}

function actualizarToggleLocal() {
  const btnAct = document.getElementById('localToggleActivo');
  const btnIna = document.getElementById('localToggleInactivo');
  const hint = document.getElementById('localEstadoHint');

  btnAct.classList.toggle('active', LOCAL_ACTIVO_SEL);
  btnIna.classList.toggle('active-off', !LOCAL_ACTIVO_SEL);

  hint.textContent = LOCAL_ACTIVO_SEL
    ? 'Cuando está activo, aparece en toda la app.'
    : 'Oculto: no aparece en ningún selector de la app.';
}

async function guardarLocal() {
  if (!LOCAL_EDITANDO) return;
  const nombre = document.getElementById('localNombre').value.trim();
  if (!nombre) { toast('Falta el nombre', 'error'); return; }

  const btn = document.getElementById('btnGuardarLocal');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    await api(`locales?slug=eq.${encodeURIComponent(LOCAL_EDITANDO)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nombre,
        activo: LOCAL_ACTIVO_SEL,
        actualizado_en: new Date().toISOString()
      })
    });
    toast('Local actualizado');
    closeModalLocal();
    await recargarLocalesAdmin();
  } catch (e) {
    toast('Error al guardar', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// Exponer funciones globalmente
window.openAdminLocales = openAdminLocales;
window.openModalLocal = openModalLocal;
window.closeModalLocal = closeModalLocal;
window.setLocalActivo = setLocalActivo;
window.guardarLocal = guardarLocal;

init();

})();
