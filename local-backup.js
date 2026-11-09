const keys = [
  "zen_sudoku_daily_completions",
  "zen_sudoku_saved_games",
  "zen_sudoku_settings",
  "zen_sudoku_stats",
  "zen_sudoku_theme",
];
const format = "zenith-sudoku-local-backup";
const difficulties = ["easy", "medium", "hard", "expert", "master"];
export const maxBackupBytes = 4 * 1024 * 1024;

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const natural = value => Number.isSafeInteger(value) && value >= 0;
const digit = (value, min) => Number.isInteger(value) && value >= min && value <= 9;

function validDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = new Date(`${key}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

const validators = {
  zen_sudoku_daily_completions(value) {
    return record(value) && Object.entries(value).every(([date, result]) =>
      validDate(date) && record(result) && natural(result.bestTimeSeconds) && natural(result.bestErrorCount)
    );
  },
  zen_sudoku_saved_games(value) {
    return Array.isArray(value) && value.length <= 8 && value.every(game =>
      record(game) && typeof game.id === "string" && game.id.length > 0 &&
      difficulties.includes(game.difficulty) && natural(game.timeSeconds) &&
      (game.dailyDate === undefined || typeof game.dailyDate === "string" && validDate(game.dailyDate)) &&
      Array.isArray(game.grid) && game.grid.length === 9 && game.grid.every(row =>
        Array.isArray(row) && row.length === 9 && row.every(cell =>
          record(cell) && digit(cell.value, 0) && digit(cell.initialValue, 0) &&
          digit(cell.solutionValue, 1) && (cell.initialValue === 0 || cell.value === cell.initialValue) &&
          Array.isArray(cell.notes) && cell.notes.every(note => digit(note, 1))
        )
      )
    );
  },
  zen_sudoku_settings(value) {
    return record(value) && Object.values(value).every(setting => typeof setting === "boolean");
  },
  zen_sudoku_stats(value) {
    const counters = ["highestStreak", "currentStreak", "winRate", "solvedCount", "flawlessCount", "totalPlayed"];
    return record(value) && counters.every(key => natural(value[key])) &&
      record(value.timesByDifficulty) && Object.entries(value.timesByDifficulty).every(([difficulty, times]) =>
        difficulties.includes(difficulty) && Array.isArray(times) && times.every(natural)
      ) && Array.isArray(value.achievementIds) && value.achievementIds.every(id => typeof id === "string");
  },
  zen_sudoku_theme(value) {
    return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(value);
  },
};

function parseRecord(key, raw) {
  if (key === "zen_sudoku_theme" && !raw.startsWith('"')) return raw;
  return JSON.parse(raw);
}

export function parseBackup(text) {
  let backup;
  try {
    backup = JSON.parse(text);
    if (!record(backup) || backup.format !== format || backup.version !== 1 ||
        typeof backup.savedAt !== "string" || !Number.isFinite(Date.parse(backup.savedAt)) ||
        !record(backup.records) || Object.keys(backup.records).length !== keys.length) {
      throw new Error("Invalid backup envelope");
    }
    for (const key of keys) {
      if (!Object.hasOwn(backup.records, key)) throw new Error("Missing backup field");
      const raw = backup.records[key];
      if (raw !== null && (typeof raw !== "string" || !validators[key](parseRecord(key, raw)))) {
        throw new Error("Invalid local data");
      }
    }
  } catch {
    throw new Error("无法读取这份备份，请选择由信为美数独导出的 JSON 文件。");
  }
  return backup;
}

export function exportBackup(storage = localStorage) {
  const backup = {
    format,
    version: 1,
    savedAt: new Date().toISOString(),
    records: Object.fromEntries(keys.map(key => [key, storage.getItem(key)])),
  };
  const text = JSON.stringify(backup, null, 2);
  if (new Blob([text]).size > maxBackupBytes) throw new Error("本机记录超过备份大小限制。");
  parseBackup(text);
  return text;
}

function writeRecord(storage, key, raw) {
  if (raw === null) storage.removeItem(key);
  else storage.setItem(key, raw);
}

export function restoreBackup(text, storage = localStorage) {
  const {records} = parseBackup(text);
  const before = keys.map(key => [key, storage.getItem(key)]);
  const written = [];
  try {
    for (const [key, oldValue] of before) {
      writeRecord(storage, key, records[key]);
      written.push([key, oldValue]);
    }
  } catch (error) {
    for (const [key, raw] of written.reverse()) writeRecord(storage, key, raw);
    throw error;
  }
}
