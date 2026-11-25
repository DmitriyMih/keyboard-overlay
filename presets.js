// The service worker serializes writes from tabs sharing a site or a preset.
let presetQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.action !== "preset") return;
  const job = presetQueue.then(() => applyPresetCommand(message, sender));
  presetQueue = job.catch(() => {});
  job.then(reply, error => reply({ error: error.message }));
  return true;
});

async function applyPresetCommand(message, sender) {
  const tr = (ru, en) => message.language === "en" ? en : ru;
  const url = new URL(sender.tab?.url || sender.url);
  const site = url.origin === "null" ? url.protocol : url.origin;
  const stored = await chrome.storage.local.get("keyboardProfiles");
  let state = stored.keyboardProfiles;
  let changed = !state;
  if (!state) {
    const values = await chrome.storage.local.get(Object.keys(keyboardDefaults));
    state = { revision: 0, defaultId: null, presets: {}, sites: {} };
    if (Object.keys(values).length) {
      state.presets.initial = { name: "Мои настройки", values, revision: 0 };
      state.defaultId = "initial";
    }
  }
  function current() {
    const binding = state.sites[site];
    const id = binding?.draft ? null : binding ? binding.id : state.defaultId;
    const values = { ...keyboardDefaults, ...(binding?.draft || state.presets[id]?.values) };
    for (const key of ["releaseDelay", "historySeconds"]) {
      values[key] = Number.isFinite(values[key]) ? Math.max(0, Math.min(10, values[key])) : keyboardDefaults[key];
    }
    return { id, draft: !!binding?.draft, source: binding?.draft && state.presets[binding.source]?.name ? binding.source : null,
      sourceRevision: binding?.sourceRevision, values };
  }
  const active = current();
  const { command, id, name } = message;
  const preset = state.presets[id];
  if (["load", "update", "rename", "remove"].includes(command) && !preset) throw Error(tr("Пресет уже удалён.", "This preset has been deleted."));
  switch (command) {
    case "read": break;
    case "patch":
      state.sites[site] = { source: active.id || active.source, sourceRevision: state.presets[active.id]?.revision ?? active.sourceRevision,
        draft: { ...active.values, ...message.changes } };
      break;
    case "load": state.sites[site] = { id }; break;
    case "base": state.sites[site] = { id: null }; break;
    case "inherit": delete state.sites[site]; break;
    case "default":
      if (id !== null && !preset) throw Error(tr("Пресет уже удалён.", "This preset has been deleted."));
      state.defaultId = id;
      break;
    case "rename":
      if (!name?.trim()) throw Error(tr("Введите название пресета.", "Enter a preset name."));
      preset.name = name.trim();
      break;
    case "create":
    case "update": {
      if (!name?.trim()) throw Error(tr("Введите название пресета.", "Enter a preset name."));
      if (command === "update" && message.revision !== preset.revision) throw Error(tr("Пресет изменён в другой вкладке. Сохраните свои настройки отдельным пресетом.", "This preset changed in another tab. Save your settings as a separate preset."));
      const key = command === "create" ? crypto.randomUUID() : id;
      state.presets[key] = { name: name.trim(), values: message.values, revision: state.revision + 1 };
      state.sites[site] = { id: key };
      break;
    }
    case "remove":
      delete state.presets[id];
      if (state.defaultId === id) state.defaultId = null;
      for (const [origin, binding] of Object.entries(state.sites)) {
        if (binding.id === id) delete state.sites[origin];
      }
      break;
    default: throw Error(tr("Неизвестная команда пресета.", "Unknown preset command."));
  }
  if (changed || command !== "read") {
    state.revision++;
    await chrome.storage.local.set({ keyboardProfiles: state });
  }
  return { ...current(), revision: state.revision, defaultId: state.defaultId, inherited: !state.sites[site],
    presets: Object.entries(state.presets)
      .filter(([id, p]) => id !== "initial" || p.revision !== 0 || p.name !== "Мои настройки")
      .map(([id, p]) => ({ id, name: p.name, revision: p.revision })) };
}
