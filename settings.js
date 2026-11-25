var keyboardDefaults = Object.freeze({
  enabled: true, size: 64, color: "#191b1c", opacity: 100,
  position: "bottom-center", history: true, historyDirection: "up", releaseDelay: 1.5,
  orbitRadius: 12, historyDock: null, historyAngle: null, historyAlignment: null, growth: "center", customX: 0.5, customY: 0.5, historyLimit: 6, autoExpire: true, historySeconds: 1.5
});

function historyDirections(position) {
  if (position === "custom") return ["up", "down", "left", "right"];
  const [side, align] = position.split("-");
  const directions = [side === "top" ? "down" : "up"];
  if (align !== "left") directions.push("left");
  if (align !== "right") directions.push("right");
  return directions;
}

function resolveHistoryDirection(position, preferred, allowed = historyDirections(position)) {
  if (allowed.includes(preferred)) return preferred;
  const opposite = { up: "down", down: "up", left: "right", right: "left" };
  return allowed.includes(opposite[preferred]) ? opposite[preferred] : allowed[0];
}
