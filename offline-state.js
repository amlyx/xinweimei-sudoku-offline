const dailyStorageKey = "zen_sudoku_daily_completions";

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function validDateKey(key) {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split("-").map(Number);
  return localDateKey(new Date(year, month - 1, day)) === key;
}

export function readDailyCompletions() {
  try {
    const saved = JSON.parse(localStorage.getItem(dailyStorageKey));
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([date, record]) =>
        validDateKey(date) &&
        record && Number.isInteger(record.bestTimeSeconds) && record.bestTimeSeconds >= 0 &&
        Number.isInteger(record.bestErrorCount) && record.bestErrorCount >= 0
      )
    );
  } catch {
    return {};
  }
}

export function recordDailyCompletion(dateKey, timeSeconds, errorCount) {
  if (!validDateKey(dateKey) || !Number.isFinite(timeSeconds) || !Number.isFinite(errorCount)) return;
  const completions = readDailyCompletions();
  const previous = completions[dateKey];
  const time = Math.max(0, Math.floor(timeSeconds));
  const errors = Math.max(0, Math.floor(errorCount));
  completions[dateKey] = {
    bestTimeSeconds: previous ? Math.min(previous.bestTimeSeconds, time) : time,
    bestErrorCount: previous ? Math.min(previous.bestErrorCount, errors) : errors,
  };
  try {
    localStorage.setItem(dailyStorageKey, JSON.stringify(completions));
  } catch {
    // The solved game remains playable when storage is unavailable.
  }
}

// Stable, date-specific PRNG. No global randomness or timezone changes are needed.
export function dailyRandom(dateKey) {
  let state = 2166136261;
  for (const character of dateKey) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let sample = Math.imul(state ^ (state >>> 15), 1 | state);
    sample ^= sample + Math.imul(sample ^ (sample >>> 7), 61 | sample);
    return ((sample ^ (sample >>> 14)) >>> 0) / 4294967296;
  };
}
