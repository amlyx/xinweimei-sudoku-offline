const STORAGE = {
  settings: "zen_sudoku_settings",
  stats: "zen_sudoku_stats",
  games: "zen_sudoku_saved_games",
  theme: "zen_sudoku_theme",
};

const DIFFICULTIES = ["easy", "medium", "hard", "expert", "master"];
const DEFAULT_SETTINGS = {
  soundOn: true,
  musicOn: false,
  autoCheck: true,
  showTimer: true,
  blinkUnique: false,
  autoNotes: false,
};
const MAX_SAVED_GAMES = 8;
const MAX_UNDO = 100;

function readLocal(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("本机记录暂时无法写入", key, error);
  }
}

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function readSettings() {
  const saved = readLocal(STORAGE.settings, {});
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [
      key,
      typeof saved?.[key] === "boolean" ? saved[key] : value,
    ]),
  );
}

function readStats() {
  const saved = readLocal(STORAGE.stats, {}) ?? {};
  const oldDemo =
    saved.highestStreak === 24 && saved.currentStreak === 7 &&
    saved.winRate === 92 && saved.solvedCount === 342 &&
    saved.flawlessCount === 12 && saved.totalPlayed === 371;
  const stats = oldDemo ? {} : saved;
  const solvedCount = nonnegative(stats.solvedCount);
  // The original release counted both opening and winning each solved game.
  const opened = nonnegative(stats.totalPlayed) - (stats.countingVersion === 2 ? 0 : solvedCount);
  const totalPlayed = Math.max(solvedCount, opened);
  return {
    countingVersion: 2,
    highestStreak: nonnegative(stats.highestStreak),
    currentStreak: nonnegative(stats.currentStreak),
    winRate: totalPlayed ? Math.round(100 * solvedCount / totalPlayed) : 0,
    solvedCount,
    flawlessCount: Math.min(solvedCount, nonnegative(stats.flawlessCount)),
    totalPlayed,
    timesByDifficulty: Object.fromEntries(DIFFICULTIES.map((difficulty) => {
      const times = stats.timesByDifficulty?.[difficulty];
      return [difficulty, Array.isArray(times) ? times.filter((time) => Number.isFinite(time) && time >= 0) : []];
    })),
    achievementIds: Array.isArray(stats.achievementIds) ? stats.achievementIds.filter((id) => typeof id === "string") : [],
  };
}

function isDigit(value, allowEmpty = false) {
  return Number.isInteger(value) && value >= (allowEmpty ? 0 : 1) && value <= 9;
}

function readSavedGames() {
  const records = readLocal(STORAGE.games, []);
  if (!Array.isArray(records)) return [];
  return records.filter((game) =>
    game && typeof game.id === "string" && DIFFICULTIES.includes(game.difficulty) &&
    Array.isArray(game.grid) && game.grid.length === 9 &&
    game.grid.every((row) => Array.isArray(row) && row.length === 9 && row.every((cell) =>
      cell && isDigit(cell.value, true) && isDigit(cell.initialValue, true) &&
      isDigit(cell.solutionValue) && (!cell.initialValue || cell.value === cell.initialValue),
    )),
  ).map((game) => ({
    ...game,
    timeSeconds: nonnegative(game.timeSeconds),
    errorCount: nonnegative(game.errorCount),
    hintsUsed: nonnegative(game.hintsUsed),
    grid: game.grid.map((row) => row.map((cell) => ({
      ...cell,
      notes: Array.isArray(cell.notes) ? [...new Set(cell.notes.filter((value) => isDigit(value)))].sort() : [],
      isWrong: Boolean(cell.isWrong),
    }))),
  })).slice(0, MAX_SAVED_GAMES);
}

function readTheme(themes) {
  try {
    const stored = localStorage.getItem(STORAGE.theme);
    const theme = stored?.startsWith('"') ? JSON.parse(stored) : stored;
    return Object.hasOwn(themes, theme) ? theme : "zenith";
  } catch {
    return "zenith";
  }
}

function candidateNumbers(grid, row, col) {
  const used = new Set();
  const boxRow = row - row % 3;
  const boxCol = col - col % 3;
  for (let index = 0; index < 9; index++) {
    used.add(grid[row][index].value);
    used.add(grid[index][col].value);
    used.add(grid[boxRow + Math.floor(index / 3)][boxCol + index % 3].value);
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !used.has(value));
}

function refreshNotes(previous, next) {
  return next.map((row, rowIndex) => row.map((cell, colIndex) => {
    if (cell.value) return cell;
    const allowed = candidateNumbers(next, rowIndex, colIndex);
    const oldCell = previous?.[rowIndex]?.[colIndex];
    const oldAllowed = oldCell?.value === 0 ? candidateNumbers(previous, rowIndex, colIndex) : [];
    return {
      ...cell,
      notes: allowed.filter((value) => cell.notes.includes(value) || !oldAllowed.includes(value)),
    };
  }));
}

function replaceCell(grid, row, col, replacement) {
  return grid.map((cells, index) =>
    index === row ? cells.map((cell, column) => column === col ? replacement : cell) : cells,
  );
}

export function useSudokuGame(React, { themes, sound, generatePuzzle, isSolved, findHint, progress, dailyRandom, recordDailyCompletion }) {
  const { useEffect, useRef, useState } = React;
  const [tab, setTab] = useState("start");
  const [theme, setThemeState] = useState(() => readTheme(themes));
  const [difficultyPickerOpen, setDifficultyPickerOpen] = useState(false);
  const [settings, setSettings] = useState(readSettings);
  const [stats, setStats] = useState(readStats);
  const [savedGames, setSavedGames] = useState(() =>
    readSavedGames().map((record) => ({ ...record, completedPercent: progress(record.grid) })),
  );
  const [game, setGame] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notesMode, setNotesMode] = useState(false);
  const [history, setHistory] = useState([]);
  const currentGame = useRef(game);
  const currentSaves = useRef(savedGames);
  const currentStats = useRef(stats);
  const currentHistory = useRef(history);
  const colors = themes[theme];
  const playClick = () => sound.playClick(settings.soundOn);

  function storeStats(next) {
    currentStats.current = next;
    setStats(next);
    writeLocal(STORAGE.stats, next);
  }

  function storeSaves(next) {
    currentSaves.current = next;
    setSavedGames(next);
    writeLocal(STORAGE.games, next);
  }

  function saveGame(active) {
    if (!active || active.finished) return;
    const record = {
      id: active.id,
      difficulty: active.difficulty,
      grid: active.grid,
      dailyDate: active.dailyDate,
      timeSeconds: active.timeSeconds,
      errorCount: active.errorCount,
      hintsUsed: active.hintsUsed,
      autoNotes: settings.autoNotes,
      completedPercent: progress(active.grid),
      lastPlayed: new Date().toISOString(),
    };
    storeSaves([record, ...currentSaves.current.filter((saved) => saved.id !== active.id)].slice(0, MAX_SAVED_GAMES));
  }

  function commit(next, persist = true) {
    currentGame.current = next;
    setGame(next);
    if (persist) saveGame(next);
  }

  function setUndoHistory(next) {
    currentHistory.current = next;
    setHistory(next);
  }

  function resetControls() {
    setSelected(null);
    setUndoHistory([]);
    setNotesMode(false);
    setDifficultyPickerOpen(false);
  }

  function updateSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    writeLocal(STORAGE.settings, next);
  }

  function setTheme(next) {
    setThemeState(next);
    writeLocal(STORAGE.theme, next);
    playClick();
  }

  function resumeGame(id) {
    const saved = currentSaves.current.find((item) => item.id === id);
    if (!saved) return;
    playClick();
    resetControls();
    let grid = saved.grid.map((row) => row.map((cell) => ({
      ...cell,
      isWrong: settings.autoCheck && cell.value !== 0 && cell.value !== cell.solutionValue,
    })));
    if (settings.autoNotes && (saved.autoNotes === false ||
      (saved.autoNotes === undefined && !grid.some((row) => row.some((cell) => cell.notes.length))))) {
      grid = refreshNotes(null, grid);
    }
    commit({ ...saved, grid, isPaused: false, finished: false });
  }

  function startGame(difficulty, dailyDate) {
    if (!DIFFICULTIES.includes(difficulty)) return;
    const saved = dailyDate && currentSaves.current.find((item) => item.dailyDate === dailyDate);
    if (saved) {
      resumeGame(saved.id);
      return;
    }
    playClick();
    const { grid } = generatePuzzle(difficulty, dailyDate ? dailyRandom(dailyDate) : Math.random);
    resetControls();
    const opened = currentStats.current.totalPlayed + 1;
    storeStats({
      ...currentStats.current,
      totalPlayed: opened,
      winRate: Math.round(100 * currentStats.current.solvedCount / opened),
    });
    commit({
      id: globalThis.crypto?.randomUUID?.() ?? `sudoku-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      difficulty,
      dailyDate,
      grid: settings.autoNotes ? refreshNotes(null, grid) : grid,
      timeSeconds: 0,
      errorCount: 0,
      hintsUsed: 0,
      isPaused: false,
      finished: false,
    });
  }

  function leaveGame() {
    playClick();
    saveGame(currentGame.current);
    commit(null);
    resetControls();
    setTab("start");
  }

  function closeWin() {
    playClick();
    commit(null);
    resetControls();
    setTab("stats");
  }

  function togglePause() {
    const active = currentGame.current;
    if (!active || active.finished) return;
    playClick();
    commit({ ...active, isPaused: !active.isPaused });
  }

  function selectCell(row, col) {
    const active = currentGame.current;
    if (!active || active.isPaused || active.finished) return;
    playClick();
    setSelected({ row, col });
  }

  function toggleNotes() {
    const active = currentGame.current;
    if (!active || active.isPaused || active.finished) return;
    playClick();
    setNotesMode((previous) => !previous);
  }

  function finishGame(active) {
    commit({ ...active, finished: true }, false);
    storeSaves(currentSaves.current.filter((saved) => saved.id !== active.id));
    const previous = currentStats.current;
    const solvedCount = previous.solvedCount + 1;
    const totalPlayed = Math.max(solvedCount, previous.totalPlayed);
    const streak = previous.currentStreak + 1;
    storeStats({
      ...previous,
      solvedCount,
      totalPlayed,
      winRate: Math.round(100 * solvedCount / totalPlayed),
      highestStreak: Math.max(previous.highestStreak, streak),
      currentStreak: streak,
      flawlessCount: previous.flawlessCount + (active.errorCount === 0 ? 1 : 0),
      timesByDifficulty: {
        ...previous.timesByDifficulty,
        [active.difficulty]: [...previous.timesByDifficulty[active.difficulty], active.timeSeconds],
      },
      achievementIds: previous.achievementIds.includes("1") ? previous.achievementIds : [...previous.achievementIds, "1"],
    });
    if (active.dailyDate) recordDailyCompletion(active.dailyDate, active.timeSeconds, active.errorCount);
    sound.playVictory(settings.soundOn);
  }

  function makeMove(active, row, col, cell, mistake = false, hintUsed = false) {
    const oldCell = active.grid[row][col];
    let grid = replaceCell(active.grid, row, col, cell);
    if (settings.autoNotes && oldCell.value !== cell.value) grid = refreshNotes(active.grid, grid);
    setUndoHistory([...currentHistory.current, active.grid].slice(-MAX_UNDO));
    const next = {
      ...active,
      grid,
      errorCount: active.errorCount + (mistake ? 1 : 0),
      hintsUsed: active.hintsUsed + (hintUsed ? 1 : 0),
    };
    if (cell.value && isSolved(grid)) finishGame(next);
    else commit(next);
  }

  function enterNumber(value) {
    const active = currentGame.current;
    if (!active || !selected || active.isPaused || active.finished || !isDigit(value)) return;
    const { row, col } = selected;
    const cell = active.grid[row][col];
    if (cell.initialValue || (notesMode && cell.value)) return;
    if (notesMode) {
      const notes = cell.notes.includes(value) ? cell.notes.filter((note) => note !== value) : [...cell.notes, value].sort();
      makeMove(active, row, col, { ...cell, notes });
      playClick();
      return;
    }
    const nextValue = cell.value === value ? 0 : value;
    const mistake = nextValue !== 0 && nextValue !== cell.solutionValue;
    makeMove(active, row, col, { ...cell, value: nextValue, notes: [], isWrong: settings.autoCheck && mistake }, mistake);
    if (settings.autoCheck && nextValue && !mistake) sound.playChime(settings.soundOn);
    else playClick();
  }

  function erase() {
    const active = currentGame.current;
    if (!active || !selected || active.isPaused || active.finished) return;
    const { row, col } = selected;
    const cell = active.grid[row][col];
    if (cell.initialValue || (!cell.value && !cell.notes.length)) return;
    makeMove(active, row, col, { ...cell, value: 0, notes: [], isWrong: false });
    playClick();
  }

  function undo() {
    const active = currentGame.current;
    const previous = currentHistory.current;
    if (!active || active.isPaused || active.finished || previous.length === 0) return;
    commit({ ...active, grid: previous.at(-1) });
    setUndoHistory(previous.slice(0, -1));
    playClick();
  }

  function hint() {
    const active = currentGame.current;
    if (!active || active.isPaused || active.finished) return;
    const nextHint = findHint(active.grid);
    if (!nextHint) return;
    const { row, col, val } = nextHint;
    const cell = active.grid[row][col];
    setSelected({ row, col });
    makeMove(active, row, col, { ...cell, value: val, notes: [], isWrong: false }, false, true);
    sound.playChime(settings.soundOn);
  }

  useEffect(() => {
    document.body.style.backgroundColor = colors.surface;
    document.body.style.color = colors.text;
  }, [colors]);

  useEffect(() => {
    sound.updateMusic(settings.musicOn);
    return () => sound.stopMusic();
  }, [sound, settings.musicOn]);

  const timerGameId = game && !game.isPaused && !game.finished ? game.id : null;
  useEffect(() => {
    if (!timerGameId) return;
    const interval = setInterval(() => {
      const active = currentGame.current;
      if (document.hidden || !active || active.id !== timerGameId || active.isPaused || active.finished) return;
      const next = { ...active, timeSeconds: active.timeSeconds + 1 };
      commit(next, next.timeSeconds % 5 === 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [timerGameId]);

  useEffect(() => {
    function flush() {
      saveGame(currentGame.current);
    }
    function onVisibilityChange() {
      if (document.hidden) flush();
    }
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.defaultPrevented || event.isComposing || event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      const key = event.key.toLowerCase();
      if (key === "escape" && difficultyPickerOpen) {
        setDifficultyPickerOpen(false);
        return;
      }
      const active = currentGame.current;
      if (!active || active.finished) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "escape" || (key === " " && !event.target?.closest?.("button"))) {
        event.preventDefault();
        if (!event.repeat) togglePause();
        return;
      }
      if (active.isPaused) return;
      if (key.startsWith("arrow")) {
        const { row, col } = selected ?? { row: 0, col: 0 };
        const delta = { arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1] }[key];
        if (!delta) return;
        event.preventDefault();
        const [dr, dc] = delta;
        const clamp = (coordinate) => Math.max(0, Math.min(8, coordinate));
        selectCell(clamp(row + dr), clamp(col + dc));
        return;
      }
      if (event.repeat) return;
      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        enterNumber(Number(key));
      } else if (key === "backspace" || key === "delete" || key === "0") {
        event.preventDefault();
        erase();
      } else if (key === "n") {
        event.preventDefault();
        toggleNotes();
      } else if (key === "h") {
        event.preventDefault();
        hint();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return {
    tab, setTab, theme, setTheme, difficultyPickerOpen, setDifficultyPickerOpen, settings, updateSetting,
    colors, stats, savedGames, game, selected, notesMode, history,
    startGame, resumeGame, leaveGame, closeWin, togglePause, selectCell, toggleNotes, enterNumber, erase, undo, hint,
  };
}
