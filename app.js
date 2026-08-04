// ==========================================
// 1. IMPORTS & INITIALISATIE (Firebase v10)
// ==========================================
import { auth, db } from './firebase-config.js';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  collection, 
  doc, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc, 
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// App Status variabelen
let currentUser = null;
let tasks = [];
let streakData = { streak: 0, tokens: 2, history: {} };
let activeTask = null;
let selectedResistanceReason = null;
let wakeLock = null;

// Stopwatch variabelen (opwaarts tellen)
let stopwatchInterval = null;
let elapsedSeconds = 0;
let isStopwatchRunning = false;

// ==========================================
// 2. AUTH & INITIALISATIE LISTENERS
// ==========================================
onAuthStateChanged(auth, (user) => {
  const authContainer = document.getElementById('auth-container');
  const appContainer = document.getElementById('app-container');
  const userEmailDisplay = document.getElementById('user-email-display');

  if (user) {
    currentUser = user;
    if (authContainer) authContainer.classList.add('hidden');
    if (appContainer) appContainer.classList.remove('hidden');
    if (userEmailDisplay) userEmailDisplay.textContent = user.email;
    
    // Data inladen
    loadUserData();
    listenToTasks();
  } else {
    currentUser = null;
    tasks = [];
    if (authContainer) authContainer.classList.remove('hidden');
    if (appContainer) appContainer.classList.add('hidden');
  }
});

// Login Handler
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('auth-error');

    signInWithEmailAndPassword(auth, email, password).catch((err) => {
      errorEl.textContent = "Inloggen mislukt: " + err.message;
      errorEl.classList.remove('hidden');
    });
  });
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => signOut(auth));
}

// ==========================================
// 3. TABBLADEN NAVIGATIE
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

    btn.classList.add('active');
    const targetTab = btn.getAttribute('data-tab');
    document.getElementById(targetTab).classList.remove('hidden');

    if (targetTab === 'tab-planning') renderWeekPlanner();
    if (targetTab === 'tab-voortgang') renderMonthHeatmap();
  });
});

// ==========================================
// 4. STREAK & RUST-TOKENS LOGICA
// ==========================================
function loadUserData() {
  if (!currentUser) return;
  const userRef = doc(db, 'users', currentUser.uid);

  onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists() && docSnap.data().streakData) {
      streakData = docSnap.data().streakData;
    }
    checkAndApplyStreakRules();
    updateDashboardStrip();
  });
}

function checkAndApplyStreakRules() {
  const todayStr = getTodayString();
  const history = streakData.history || {};

  const currentMonth = todayStr.substring(0, 7);
  if (streakData.lastMonthReset !== currentMonth) {
    streakData.tokens = 2;
    streakData.lastMonthReset = currentMonth;
    saveStreakData();
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  if (!history[yesterdayStr] && streakData.tokens > 0) {
    history[yesterdayStr] = 'shield';
    streakData.tokens -= 1;
    streakData.history = history;
    saveStreakData();
  }
}

function saveStreakData() {
  if (!currentUser) return;
  const userRef = doc(db, 'users', currentUser.uid);
  setDoc(userRef, { streakData }, { merge: true });
}

function registerDayActivity() {
  const todayStr = getTodayString();
  if (!streakData.history) streakData.history = {};

  if (streakData.history[todayStr] !== 'active') {
    streakData.history[todayStr] = 'active';
    streakData.streak = (streakData.streak || 0) + 1;
    saveStreakData();
  }
}

function updateDashboardStrip() {
  const streakCount = document.getElementById('streak-count');
  const tokensCount = document.getElementById('tokens-count');
  if (streakCount) streakCount.textContent = streakData.streak || 0;
  if (tokensCount) tokensCount.textContent = streakData.tokens !== undefined ? streakData.tokens : 2;

  const dotsContainer = document.getElementById('week-strip-dots');
  if (!dotsContainer) return;
  dotsContainer.innerHTML = '';

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const status = (streakData.history && streakData.history[dateStr]) || 'none';

    const dot = document.createElement('div');
    dot.className = `dot ${status === 'active' ? 'active' : status === 'shield' ? 'shield' : ''}`;
    dot.title = `${dateStr}: ${status}`;
    if (status === 'shield') dot.textContent = '🛡️';
    dotsContainer.appendChild(dot);
  }
}

// ==========================================
// 5. FIRESTORE TAKEN REALTIME LISTENERS
// ==========================================
function listenToTasks() {
  const tasksRef = collection(db, 'taken');

  onSnapshot(tasksRef, (snapshot) => {
    tasks = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    renderTasks();
  });
}

// Slimme invoer met tijdsherkenning
const quickAddForm = document.getElementById('quick-add-form');
if (quickAddForm) {
  quickAddForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById('quick-task-title');
    let rawTitle = titleInput.value.trim();
    const energy = document.getElementById('quick-task-energy').value;
    let estimatedTime = parseInt(document.getElementById('quick-task-time').value, 10);

    const timeMatch = rawTitle.match(/(\d+)\s*(m|min|minuten)/i);
    if (timeMatch) {
      estimatedTime = parseInt(timeMatch[1], 10);
      rawTitle = rawTitle.replace(timeMatch[0], '').trim();
    }

    const newTask = {
      titel: rawTitle,
      energieniveau: energy,
      geschatte_tijd: estimatedTime || 15,
      status: 'open',
      aangemaakt_op: new Date().toISOString(),
      sluimer_trigger: null,
      micro_stappen: []
    };

    await addDoc(collection(db, 'taken'), newTask);
    titleInput.value = '';
  });
}

// ==========================================
// 6. TAKEN RENDERING & CATEGORISATIE
// ==========================================
function renderTasks() {
  const urgentList = document.getElementById('urgent-task-list');
  const quickwinList = document.getElementById('quickwin-task-list');
  const otherList = document.getElementById('other-task-list');
  const completedList = document.getElementById('completed-task-list');

  if (urgentList) urgentList.innerHTML = '';
  if (quickwinList) quickwinList.innerHTML = '';
  if (otherList) otherList.innerHTML = '';
  if (completedList) completedList.innerHTML = '';

  const energyFilter = document.getElementById('energy-filter');
  const selectedEnergy = energyFilter ? energyFilter.value : 'alle';
  const todayStr = getTodayString();

  let completedCount = 0;

  tasks.forEach(task => {
    const isCompleted = task.status === 'afgerond';

    if (isCompleted) {
      completedCount++;
      if (completedList) completedList.appendChild(createTaskElement(task));
      return;
    }

    const taskEnergy = task.energieniveau || task.energy || 'midden';
    const taskTime = task.geschatte_tijd || task.estimatedTime || 15;
    const taskSnooze = task.sluimer_trigger || task.snoozeDate;

    if (selectedEnergy !== 'alle' && taskEnergy !== selectedEnergy) return;

    const isSnoozed = taskSnooze && taskSnooze > todayStr;
    const isExpired = taskSnooze && taskSnooze < todayStr;

    if (isSnoozed) return;

    if (isExpired) {
      if (urgentList) urgentList.appendChild(createTaskElement(task, true));
    } else if (taskTime <= 15 && taskEnergy === 'laag') {
      if (quickwinList) quickwinList.appendChild(createTaskElement(task));
    } else {
      if (otherList) otherList.appendChild(createTaskElement(task));
    }
  });

  const countBadge = document.getElementById('completed-count');
  if (countBadge) countBadge.textContent = completedCount;
}

function createTaskElement(task, isExpired = false) {
  const li = document.createElement('li');
  li.className = 'task-card';
  li.onclick = () => openTaskModal(task);

  const mainDiv = document.createElement('div');
  mainDiv.className = 'task-main';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.status === 'afgerond';
  checkbox.onclick = (e) => {
    e.stopPropagation();
    const newStatus = task.status === 'afgerond' ? 'open' : 'afgerond';
    toggleTaskComplete(task.id, newStatus);
  };

  const titleSpan = document.createElement('span');
  titleSpan.className = 'task-title';
  titleSpan.textContent = task.titel || task.title || 'Naamloze taak';

  mainDiv.appendChild(checkbox);
  mainDiv.appendChild(titleSpan);

  const metaDiv = document.createElement('div');
  metaDiv.className = 'task-meta';

  if (isExpired) {
    const expiredBadge = document.createElement('span');
    expiredBadge.className = 'badge expired-badge';
    expiredBadge.textContent = 'Verlopen';
    metaDiv.appendChild(expiredBadge);
  }

  const timeBadge = document.createElement('span');
  timeBadge.className = 'badge time-badge';
  timeBadge.textContent = `⏱️ ${task.geschatte_tijd || task.estimatedTime || 15}m`;
  metaDiv.appendChild(timeBadge);

  li.appendChild(mainDiv);
  li.appendChild(metaDiv);

  return li;
}

async function toggleTaskComplete(taskId, newStatus) {
  const taskRef = doc(db, 'taken', taskId);
  await updateDoc(taskRef, { status: newStatus });
  if (newStatus === 'afgerond') {
    registerDayActivity();
  }
}

// ==========================================
// 7. MODAL, STOPWATCH & WAKE LOCK LOGICA
// ==========================================
function openTaskModal(task) {
  activeTask = task;
  document.getElementById('modal-task-title').textContent = task.titel || task.title;
  document.getElementById('modal-energy').value = task.energieniveau || task.energy || 'midden';
  document.getElementById('modal-time').value = task.geschatte_tijd || task.estimatedTime || 15;
  document.getElementById('modal-snooze-date').value = task.sluimer_trigger || task.snoozeDate || '';

  renderSubtasks();
  setupModalStopwatch(); // Reset stopwatch naar 00:00
  document.getElementById('task-modal').classList.remove('hidden');
}

const closeModalBtn = document.getElementById('close-modal');
if (closeModalBtn) {
  closeModalBtn.addEventListener('click', async () => {
    document.getElementById('task-modal').classList.add('hidden');
    resetStopwatch();
    await closeTaskModal();
  });
}

// --- Afronden knop in de Modal ---
const completeTaskBtn = document.getElementById('complete-task-btn');

if (completeTaskBtn) {
  completeTaskBtn.disabled = false; 

  completeTaskBtn.onclick = async () => {
    if (!activeTask) return;

    try {
      // 1. Lees het aantal herhaaldagen uit de HTML óf de actieve taak
      const repeatInput = document.getElementById('repeat-days') || document.getElementById('task-repeat');
      const repeatDays = repeatInput ? parseInt(repeatInput.value || 0, 10) : parseInt(activeTask.herhaal_dagen || 0, 10);

      // 2. Zet de huidige taak op afgerond
      const taskRef = doc(db, 'taken', activeTask.id);
      await updateDoc(taskRef, { 
        status: 'afgerond',
        completedAt: new Date()
      });

      // 3. Als herhaal_dagen > 0, maak een nieuwe vervolgtaak aan
      if (repeatDays > 0) {
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + repeatDays);
        const formattedNextDate = nextDate.toISOString().split('T')[0]; // "2026-08-05"

        await addDoc(collection(db, 'taken'), {
          titel: activeTask.titel || '',
          energieniveau: activeTask.energieniveau || 'laag',
          geschatte_tijd: activeTask.geschatte_tijd || 15,
          herhaal_dagen: repeatDays,
          sluimer_trigger: formattedNextDate, // Zorgt dat hij op de planner van morgen komt!
          status: 'open',
          aangemaakt_op: new Date()
        });
      }

      // 4. Reset stopwatch en sluit modal
      resetStopwatch();
      document.getElementById('task-modal').classList.add('hidden');

      // 5. Ververs de planner
      if (typeof loadTasks === 'function') {
        await loadTasks();
      } else if (typeof renderPlanner === 'function') {
        await renderPlanner();
      }

    } catch (err) {
      console.error('Fout bij afronden taak:', err);
    }
  };
  await closeTaskModal();
}

// Centraliseer het sluiten van de modal
async function closeTaskModal() {
  const modal = document.getElementById('task-modal');
  if (modal) modal.classList.add('hidden');

  // Ververs alle schermen die open kunnen staan
  if (typeof loadTasks === 'function') await loadTasks();
  if (typeof renderPlanner === 'function') await renderPlanner();
}

const saveTaskBtn = document.getElementById('save-task-btn');
if (saveTaskBtn) {
  saveTaskBtn.addEventListener('click', async () => {
    if (!activeTask) return;
    const taskRef = doc(db, 'taken', activeTask.id);
    await updateDoc(taskRef, {
      energieniveau: document.getElementById('modal-energy').value,
      geschatte_tijd: parseInt(document.getElementById('modal-time').value, 10),
      sluimer_trigger: document.getElementById('modal-snooze-date').value || null
    });
    document.getElementById('task-modal').classList.add('hidden');
    resetStopwatch();
  });
  await closeTaskModal();
}

const deleteTaskBtn = document.getElementById('delete-task-btn');
if (deleteTaskBtn) {
  deleteTaskBtn.addEventListener('click', async () => {
    if (activeTask && confirm('Taak verwijderen?')) {
      await deleteDoc(doc(db, 'taken', activeTask.id));
      document.getElementById('task-modal').classList.add('hidden');
      resetStopwatch();
    }
  });
}

const snooze1DayBtn = document.getElementById('snooze-1-day-btn');
if (snooze1DayBtn) {
  snooze1DayBtn.addEventListener('click', () => {
    document.getElementById('task-modal').classList.add('hidden');
    resetStopwatch();
    document.getElementById('resistance-modal').classList.remove('hidden');
  });
}

// --- Screen Wake Lock Logica (Knop variant) ---
const wakeLockBtn = document.getElementById('wake-lock-btn');

if (wakeLockBtn) {
  wakeLockBtn.addEventListener('click', async () => {
    if (wakeLock) {
      await releaseWakeLock();
    } else {
      await requestWakeLock();
    }
  });
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Scherm blijft actief.');
      updateWakeLockBtnUI(true);
    } else {
      alert('Je browser ondersteunt het automatisch aanhouden van het scherm helaas niet.');
      updateWakeLockBtnUI(false);
    }
  } catch (err) {
    console.error(`Wake Lock fout: ${err.name}, ${err.message}`);
    updateWakeLockBtnUI(false);
  }
}

async function releaseWakeLock() {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
  updateWakeLockBtnUI(false);
}

function updateWakeLockBtnUI(isActive) {
  if (!wakeLockBtn) return;

  if (isActive) {
    wakeLockBtn.textContent = '📱 Scherm aanhouden: AAN';
    wakeLockBtn.classList.remove('wake-lock-off');
    wakeLockBtn.classList.add('wake-lock-on');
  } else {
    wakeLockBtn.textContent = '📱 Scherm aanhouden: UIT';
    wakeLockBtn.classList.remove('wake-lock-on');
    wakeLockBtn.classList.add('wake-lock-off');
  }
}

// --- Stopwatch Logica (Telt omhoog) ---
function setupModalStopwatch() {
  elapsedSeconds = 0;
  isStopwatchRunning = false;
  if (stopwatchInterval) clearInterval(stopwatchInterval);
  updateStopwatchUI();
}

function startStopwatch() {
  isStopwatchRunning = true;
  const startBtn = document.getElementById('start-timer-btn');
  if (startBtn) startBtn.textContent = '⏸️ Pauzeer';

  // 💡 Toon de Wake Lock knop zodra de timer loopt
  if (wakeLockBtn) wakeLockBtn.classList.remove('hidden');

  stopwatchInterval = setInterval(() => {
    elapsedSeconds++;
    updateStopwatchUI();
  }, 1000);
}

function pauseStopwatch() {
  clearInterval(stopwatchInterval);
  isStopwatchRunning = false;
  const startBtn = document.getElementById('start-timer-btn');
  if (startBtn) startBtn.textContent = '▶️ Hervat';
  
  // Optioneel: Laat de knop zichtbaar zolang de timer gepauzeerd staat
}

function resetStopwatch() {
  clearInterval(stopwatchInterval);
  setupModalStopwatch();
  const startBtn = document.getElementById('start-timer-btn');
  if (startBtn) startBtn.textContent = '▶️ Start Timer';
  
  releaseWakeLock();
  
  // 💡 Verberg de knop weer als de timer gereset is
  if (wakeLockBtn) wakeLockBtn.classList.add('hidden');
}

function updateStopwatchUI() {
  const display = document.getElementById('timer-display');
  if (!display) return;
  
  const m = Math.floor(elapsedSeconds / 60);
  const s = elapsedSeconds % 60;
  display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const startTimerBtn = document.getElementById('start-timer-btn');
if (startTimerBtn) {
  startTimerBtn.addEventListener('click', () => {
    if (isStopwatchRunning) {
      pauseStopwatch();
    } else {
      startStopwatch();
    }
  });
}

const resetTimerBtn = document.getElementById('reset-timer-btn');
if (resetTimerBtn) {
  resetTimerBtn.addEventListener('click', resetStopwatch);
}

// ==========================================
// 8. WEERSTAND & TIPS MODALS
// ==========================================
document.querySelectorAll('.btn-resistance').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-resistance').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedResistanceReason = btn.getAttribute('data-reason');
    document.getElementById('confirm-resistance-btn').disabled = false;
  });
});

const confirmResistanceBtn = document.getElementById('confirm-resistance-btn');
if (confirmResistanceBtn) {
  confirmResistanceBtn.addEventListener('click', async () => {
    if (!activeTask || !selectedResistanceReason) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const snoozeDateStr = tomorrow.toISOString().split('T')[0];

    const taskRef = doc(db, 'taken', activeTask.id);
    await updateDoc(taskRef, {
      sluimer_trigger: snoozeDateStr,
      laatste_weerstand_reden: selectedResistanceReason
    });

    document.getElementById('resistance-modal').classList.add('hidden');
  });
}

const closeResistanceModalBtn = document.getElementById('close-resistance-modal');
if (closeResistanceModalBtn) {
  closeResistanceModalBtn.addEventListener('click', () => {
    document.getElementById('resistance-modal').classList.add('hidden');
  });
}

const openTipsBtn = document.getElementById('open-tips-btn');
if (openTipsBtn) {
  openTipsBtn.addEventListener('click', () => {
    renderTips();
    document.getElementById('tips-modal').classList.remove('hidden');
  });
}

const closeTipsModalBtn = document.getElementById('close-tips-modal');
if (closeTipsModalBtn) {
  closeTipsModalBtn.addEventListener('click', () => {
    document.getElementById('tips-modal').classList.add('hidden');
  });
}

function renderTips() {
  const tipsList = document.getElementById('tips-list');
  if (!tipsList) return;
  const defaultTips = [
    "Zet een timer voor exact 2 minuten en stop daarna direct als je wilt.",
    "Bedenk alleen de allereerste micro-stap (bijv. 'Loop naar de kast').",
    "Zet een vrolijk of energiek muziekje op voor je begint."
  ];

  tipsList.innerHTML = defaultTips.map(tip => `<li class="tip-item">💡 ${tip}</li>`).join('');
}

// ==========================================
// 9. SUBTAKEN (MICRO-STAPPEN)
// ==========================================
function renderSubtasks() {
  const list = document.getElementById('subtask-list');
  if (!list) return;
  list.innerHTML = '';
  const subtasks = activeTask.micro_stappen || activeTask.subtasks || [];

  subtasks.forEach((sub, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <input type="checkbox" ${sub.completed ? 'checked' : ''} id="sub-${index}">
      <span style="${sub.completed ? 'text-decoration: line-through' : ''}">${sub.title || sub.titel}</span>
    `;
    list.appendChild(li);

    const checkbox = li.querySelector(`#sub-${index}`);
    checkbox.onchange = () => toggleSubtask(index);
  });
}

async function toggleSubtask(index) {
  let subtasks = activeTask.micro_stappen || activeTask.subtasks || [];
  subtasks[index].completed = !subtasks[index].completed;

  const taskRef = doc(db, 'taken', activeTask.id);
  await updateDoc(taskRef, { micro_stappen: subtasks });
}

const addSubtaskForm = document.getElementById('add-subtask-form');
if (addSubtaskForm) {
  addSubtaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('subtask-title-input');
    let subtasks = activeTask.micro_stappen || activeTask.subtasks || [];

    subtasks.push({ titel: input.value, completed: false });

    const taskRef = doc(db, 'taken', activeTask.id);
    await updateDoc(taskRef, { micro_stappen: subtasks });
    input.value = '';
    renderSubtasks();
  });
}

// ==========================================
// 10. PLANNING & HEATMAP RENDERING
// ==========================================
function renderWeekPlanner() {
  const grid = document.getElementById('week-planner-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];

    const col = document.createElement('div');
    col.className = 'day-column';
    col.innerHTML = `<h4>${date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}</h4>`;

    const dayTasks = tasks.filter(t => {
  const isJuisteDatum = (t.sluimer_trigger || t.snoozeDate) === dateStr;
  const isNietAfgerond = t.status !== 'afgerond';
  
  return isJuisteDatum && isNietAfgerond;
});

dayTasks.forEach(t => {
  const item = document.createElement('div');
  item.className = 'day-task-item clickable';
  item.textContent = t.titel || t.title;
      
      // Klikken op geplande taak opent het modal venster
      item.onclick = () => openTaskModal(t);

      col.appendChild(item);
    });

    grid.appendChild(col);
  }
}

function renderMonthHeatmap() {
  const grid = document.getElementById('month-heatmap-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const status = (streakData.history && streakData.history[dateStr]) || 'none';

    const cell = document.createElement('div');
    cell.className = `heat-day ${status === 'active' ? 'level-2' : status === 'shield' ? 'level-shield' : 'level-0'}`;
    cell.textContent = d.getDate();
    cell.title = `${dateStr}: ${status}`;
    grid.appendChild(cell);
  }
}

// ==========================================
// 11. HELPERS & EVENT LISTENERS
// ==========================================
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

const energyFilterSelect = document.getElementById('energy-filter');
if (energyFilterSelect) {
  energyFilterSelect.addEventListener('change', renderTasks);
}