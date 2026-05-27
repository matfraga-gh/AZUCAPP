/* ============================================
   AZUCAPP - Lógica principal
   ============================================
   Estructura:
   1. Configuración (URL de Supabase, claves)
   2. Estado global (usuario logueado)
   3. Helpers (API, hash, display de fechas)
   4. Definición de módulos del dashboard
   5. Lógica de login
   6. Lógica de cambio de contraseña
   7. Lógica del dashboard
   8. Navegación entre vistas
============================================ */

(function() {
'use strict';

// ============================================
// 1. CONFIGURACIÓN
// ============================================
const SUPABASE_URL = 'https://vbnucvzjlcghrmqxjldp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VGfoUAU6e0zlXzkY2y8iBw_lYeOKU7K';

// URLs de las apps viejas (las completaremos en la siguiente sesión)
const URL_ROSTERS = 'https://matfraga.github.io/azuca-roster/';
const URL_RECETAS = 'https://matfraga.github.io/azuca-recetas/';

// ============================================
// 2. ESTADO GLOBAL
// ============================================
let currentUser = null;  // Datos del usuario logueado

// ============================================
// 3. HELPERS
// ============================================

// Llamada genérica a Supabase REST API
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
  // Elimino el header que reseteamos arriba
  delete opts.headers.headers;

  const url = SUPABASE_URL + '/rest/v1/' + path;
  const res = await fetch(url, opts);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error('API error ' + res.status + ': ' + txt);
  }

  // Algunas operaciones (PATCH sin return) devuelven 204 vacío
  if (res.status === 204) return null;

  return res.json();
}

// Hash SHA-256 para contraseñas (consistente con la app de Rosters)
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Formato amigable de fecha
function fmtDateTime(date) {
  const dias = ['Dom.', 'Lun.', 'Mar.', 'Mié.', 'Jue.', 'Vie.', 'Sáb.'];
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const dia = dias[date.getDay()];
  const fecha = date.getDate();
  const mes = meses[date.getMonth()];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');

  return `${dia} ${fecha} ${mes} · ${hh}:${mm}`;
}

// Guardar/leer sesión en localStorage
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
// 4. DEFINICIÓN DE MÓDULOS DEL DASHBOARD
// ============================================
const MODULES = [
  {
    id: 'semana',
    icon: 'ti-calendar-event',
    color: '#7F77DD',
    title: 'Mi semana',
    desc: 'Mis turnos asignados',
    visible: () => true,  // Todos lo ven
    action: () => openModule('semana')
  },
  {
    id: 'propina',
    icon: 'ti-cash',
    color: '#EF9F27',
    title: 'Mi propina',
    desc: 'Propinas acumuladas',
    visible: () => true,
    action: () => openModule('propina')
  },
  {
    id: 'biblioteca',
    icon: 'ti-books',
    color: '#5DCAA5',
    title: 'Mi biblioteca',
    desc: 'Capacitación y recursos',
    visible: () => true,
    action: () => openModule('biblioteca')
  },
  {
    id: 'recetas',
    icon: 'ti-chef-hat',
    color: '#D85A30',
    title: 'Mis recetas',
    desc: 'Recetas y menús del local',
    visible: () => isMaster() || currentUser.editor_recetas || currentUser.admin_recetas,
    action: () => openModule('recetas')
  },
  {
    id: 'pedidos',
    icon: 'ti-shopping-cart',
    color: '#378ADD',
    title: 'Mis pedidos',
    desc: 'Requerimientos y stock',
    visible: () => isMaster() || currentUser.editor_pedidos || currentUser.admin_pedidos,
    action: () => openModule('pedidos')
  },
  {
    id: 'admin',
    icon: 'ti-settings',
    color: '#B4B2A9',
    title: 'Administración',
    desc: 'Usuarios y permisos',
    visible: () => isMaster() || isAdmin(),
    action: () => openModule('admin')
  }
];

// Helpers de roles
function isMaster() {
  return currentUser && currentUser.perfil === 'master';
}

function isAdmin() {
  return currentUser && currentUser.perfil === 'admin';
}

// ============================================
// 5. LÓGICA DE LOGIN
// ============================================
async function doLogin(usuario, password) {
  try {
    // Buscar usuario
    const users = await api(`roster_usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=*`);

    if (!users || users.length === 0) {
      throw new Error('Usuario no encontrado');
    }

    const user = users[0];

    if (!user.activo) {
      throw new Error('Usuario inactivo');
    }

    // Verificar contraseña hasheada
    const hash = await sha256(password);
    if (hash !== user.password_hash) {
      throw new Error('Contraseña incorrecta');
    }

    // Login OK
    currentUser = user;
    saveSession(user);

    // Si tiene flag de cambio obligatorio → forzar cambio
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
// 6. CAMBIO DE CONTRASEÑA OBLIGATORIO (primer login)
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

    // Limpiar formulario
    document.getElementById('newPass1').value = '';
    document.getElementById('newPass2').value = '';

    showDashboard();

  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// 7. CAMBIO DE CONTRASEÑA VOLUNTARIO
// ============================================
document.getElementById('changePassVoluntaryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('voluntaryPassError');
  errBox.textContent = '';

  const currentP = document.getElementById('currentPass').value;
  const p1 = document.getElementById('voluntaryPass1').value;
  const p2 = document.getElementById('voluntaryPass2').value;

  // Verificar contraseña actual
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

    // Limpiar
    document.getElementById('currentPass').value = '';
    document.getElementById('voluntaryPass1').value = '';
    document.getElementById('voluntaryPass2').value = '';

    showDashboard();

  } catch (err) {
    errBox.textContent = 'Error al guardar: ' + err.message;
  }
});

// ============================================
// 8. DASHBOARD
// ============================================
function showDashboard() {
  if (!currentUser) {
    showView('vLogin');
    return;
  }

  // Nombre y rol
  document.getElementById('userDisplayName').textContent =
    currentUser.nombre || currentUser.usuario;

  const roleLabel = {
    master: 'Master',
    admin: 'Admin',
    editor: 'Editor',
    usuario: 'Usuario'
  }[currentUser.perfil] || 'Usuario';

  document.getElementById('userRoleLabel').textContent = roleLabel;

  // Fecha y hora
  document.getElementById('datetime').textContent = fmtDateTime(new Date());

  // Generar tarjetas según permisos
  renderDashboardCards();

  showView('vDash');
}

function renderDashboardCards() {
  const grid = document.getElementById('dashGrid');

  // Filtrar módulos visibles según permisos del usuario
  const visibleModules = MODULES.filter(m => m.visible());

  // Generar HTML
  grid.innerHTML = visibleModules.map((m, idx) => {
    // Si es un número impar de tarjetas y es la última, ocupar full row
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

  // Conectar eventos click
  grid.querySelectorAll('.dash-card').forEach(card => {
    card.addEventListener('click', () => {
      const modId = card.dataset.module;
      const mod = MODULES.find(m => m.id === modId);
      if (mod) mod.action();
    });
  });
}

// ============================================
// 9. ACCIONES DE MÓDULOS
// ============================================
function openModule(moduleId) {
  // Por ahora, esto es un placeholder. En la próxima sesión vamos a:
  // - Para semana/propina/biblioteca: redirigir a la app de Rosters
  // - Para recetas/pedidos: redirigir a la app de Recetas
  // - Para admin: abrir la pantalla de administración interna

  alert(`Módulo "${moduleId}" - próximamente conectado.\n\nEn la siguiente sesión vamos a conectar este botón con la app correspondiente.`);
}

// ============================================
// 10. LOGOUT
// ============================================
function doLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  clearSession();
  currentUser = null;
  // Limpiar campos
  document.getElementById('loginUsuario').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  showView('vLogin');
}

// ============================================
// 11. NAVEGACIÓN ENTRE VISTAS
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const v = document.getElementById(viewId);
  if (v) v.classList.add('active');
  window.scrollTo(0, 0);
}

function showChangePass() {
  document.getElementById('voluntaryPassError').textContent = '';
  showView('vChangePassVoluntary');
}

// Exponer funciones globales para los onclick del HTML
window.showDashboard = showDashboard;
window.showChangePass = showChangePass;
window.doLogout = doLogout;

// ============================================
// 12. INICIALIZACIÓN AL CARGAR LA PÁGINA
// ============================================
async function init() {
  // ¿Hay sesión guardada?
  const savedUser = loadSession();

  if (savedUser) {
    // Verificar contra la base que el usuario sigue existiendo y activo
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
    // Si falló, limpiar y mostrar login
    clearSession();
  }

  // No hay sesión válida → login
  showView('vLogin');

  // Actualizar fecha cada minuto
  setInterval(() => {
    const dt = document.getElementById('datetime');
    if (dt && currentUser) {
      dt.textContent = fmtDateTime(new Date());
    }
  }, 60000);
}

// Arrancar
init();

})();
