(() => {
  if (globalThis.keyboardOverlayInstalled) return;
  globalThis.keyboardOverlayInstalled = true;
  let preview;
  const main = window === window.top;
  const settings = { ...keyboardDefaults };
  const down = new Map();
  const fading = new Map();
  const recent = [];
  const localKeys = new Set();
  let extendChord = false;
  let ready = false;
  let host, panel, cards, log, shadow;
  let editor, form, controls, guideX, guideY, drag, expiryTimer, frame, geometry;
  let markers, profile, pendingWrites = 0;
  let opening = false;
  const standalone = location.href === chrome.runtime.getURL("popup.html?viewport");
  const directions = { up: "↑", down: "↓", left: "←", right: "→", center: "↔" };
  const titles = { up: "Вверх", down: "Вниз", left: "Влево", right: "Вправо", center: "В обе стороны" };
  let language = "ru";
  function tr(ru, en) { return language === "en" ? en : ru; }
  function directionTitle(dir) {
    return tr(titles[dir], dir === "center" ? "Both directions" : dir[0].toUpperCase() + dir.slice(1));
  }
  const sampleHistory = ["Shift + S", "Enter", "Tab", "Ctrl + C", "Esc", "↓", "Ctrl + V", "Space", "↑"];

  const symbols = {
    Shift: "⇧", Control: "⌃", Alt: "⌥", Meta: "⊞", Enter: "↵",
    Backspace: "⌫", Tab: "⇥", " ": "␣"
  };
  const names = {
    Control: "Ctrl", Meta: "Win", Escape: "Esc", " ": "Space",
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓"
  };
  if (/Mac/.test(navigator.platform)) {
    names.Meta = "Cmd";
    symbols.Meta = "⌘";
  }
  function label(key) {
    return Object.hasOwn(names, key) ? names[key] : key.length === 1 ? key.toUpperCase() : key;
  }
  function displayKey(key, code) {
    if (key && key !== "undefined" && key !== "Unidentified") return key;
    if (!code || ["undefined", "Unidentified", "Unspecified"].includes(code)) return "?";
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (code === "Space") return " ";
    return code.replace(/^(Alt|Control|Shift|Meta)(Left|Right)$/, "$1");
  }

  function mount() {
    host = document.createElement("div");
    host.style.setProperty("all", "initial", "important");
    for (const [property, value] of Object.entries({
      position: "fixed", inset: "0", "z-index": "2147483647", "pointer-events": "none"
    })) host.style.setProperty(property, value, "important");
    host.id = "keyboard-overlay-extension-" + chrome.runtime.id;
    document.getElementById(host.id)?.remove();
    host.setAttribute("aria-hidden", "true");
    shadow = host.attachShadow({ mode: "closed" });
    const style = new CSSStyleSheet();
    style.replaceSync(`
      section { position: absolute; inset: 0; overflow: hidden;
        gap: 12px; font: 500 var(--size)/1.1 Arial, sans-serif; user-select: none; direction: ltr; }
      .row { position: absolute; display: flex; width: max-content; max-width: 100%; flex-wrap: wrap; touch-action: none; align-items: center; gap: .14em; }
      .card { box-sizing: border-box; min-width: 1em; height: 1em; padding: 0 .12em;
        display: inline-flex; flex-direction: column; align-items: center; justify-content: center;
        background: white; border: max(1px, .024em) solid currentColor; border-radius: .23em;
        box-shadow: 0 .09em currentColor; }
      .letter { font-size: .46em; }
      .word { font-size: .28em; }
      .icon { font-size: .32em; margin-bottom: .08em; }
      .history { font-size: max(12px, .23em); }
      .controls button { position: absolute; pointer-events: auto; touch-action: manipulation;
        color: #181818; background: white; border: 1px solid #aaa; border-radius: 8px;
        height: 24px; min-width: 24px; padding: 0 4px; font: 600 14px system-ui; }
      .controls button[aria-pressed="true"] { color: white; background: #191b1c; }
      .controls button[data-align] { display: flex; flex-direction: column; justify-content: center; gap: 2px;
        color: black; background: white; border-color: black; padding: 0 5px; }
      .controls button[data-align="left"] { align-items: flex-start; }
      .controls button[data-align="center"] { align-items: center; }
      .controls button[data-align="right"] { align-items: flex-end; }
      .controls button[data-align] i { width: 13px; height: 2px; background: currentColor; }
      .controls button[data-align] i:nth-child(2) { width: 7px; }
      .guide { position: absolute; background: #0085a6; opacity: .75; }
      .vertical { width: 1px; inset-block: 0; }
      .horizontal { height: 1px; inset-inline: 0; }
      [hidden] { display: none !important; }
      .history span { position: absolute; width: max-content; white-space: nowrap; background: white; border: 1px solid currentColor; border-radius: 5px; padding: 3px 6px; }
      .history.editing span:first-child { pointer-events: auto; touch-action: none; cursor: grab; }
      .history span { overflow: hidden; text-overflow: ellipsis; box-sizing: border-box; max-width: calc(100% - 24px); }
      .card { max-width: 100%; overflow: hidden; }
      .row:empty, .history:empty { display: none; }
    `);
    shadow.adoptedStyleSheets = [style];
    panel = document.createElement("section");
    cards = document.createElement("div");
    cards.className = "row";
    log = document.createElement("div");
    log.className = "history";
    log.addEventListener("pointerdown", beginDrag);
    log.addEventListener("pointermove", moveDrag);
    log.addEventListener("pointerup", finishDrag);
    log.addEventListener("pointercancel", cancelPlacement);
    controls = document.createElement("div");
    controls.className = "controls";
    for (const dir of ["left", "up", "right", "down"]) {
      const button = document.createElement("button");
      button.textContent = directions[dir];
      button.onclick = () => saveOptions({ history: true, historyDirection: dir });
      controls.append(button);
    }
    const alignHistory = document.createElement("button");
    alignHistory.onclick = () => {
      const { alignments, alignment } = geometry;
      const next = alignments.find(value => value > alignment) ?? alignments[0];
      saveOptions({ historyAlignment: next });
    };
    controls.append(alignHistory);
    const grow = document.createElement("button");
    for (const button of [alignHistory, grow]) {
      for (let i = 0; i < 3; i++) button.append(document.createElement("i"));
    }
    grow.onclick = () => {
      const { growth, modes } = geometry;
      saveOptions({ growth: modes[(modes.indexOf(growth) + 1) % modes.length] });
    };
    controls.append(grow);
    guideX = document.createElement("i");
    guideY = document.createElement("i");
    guideX.className = "guide vertical";
    guideY.className = "guide horizontal";
    cards.addEventListener("pointerdown", beginDrag);
    cards.addEventListener("pointermove", moveDrag);
    cards.addEventListener("pointerup", finishDrag);
    cards.addEventListener("pointercancel", cancelPlacement);
    markers = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    markers.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
    const path = document.createElementNS(markers.namespaceURI, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#56899a");
    path.setAttribute("stroke-dasharray", "3 4");
    markers.append(path);
    for (let i = 0; i < 17; i++) markers.append(document.createElementNS(markers.namespaceURI, "circle"));
    panel.append(markers);
    panel.append(guideX, guideY, cards, log, controls);
    shadow.append(panel);
  }
  function render() {
    if (!main) return;
    const view = preview || settings;
    if (!chrome.runtime?.id) { host?.remove(); return; }
    if (!document.documentElement) return;
    if (!editor && (!view.enabled || (!down.size && !fading.size && !recent.length))) {
      host?.remove();
      return;
    }
    if (!host) mount();
    const parent = document.fullscreenElement || document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    panel.style.visibility = editor || view.enabled ? "visible" : "hidden";
    if (form) syncForm(view);
    controls.hidden = !editor;
    log.classList.toggle("editing", !!editor);
    cards.style.pointerEvents = editor ? "auto" : "none";
    cards.style.cursor = editor ? (drag ? "grabbing" : "grab") : "";
    panel.style.setProperty("--size", view.size + "px");
    panel.style.color = view.color;
    cards.style.opacity = log.style.opacity = view.opacity / 100;
    cards.replaceChildren();
    const visible = editor ? [{ key: "Shift" }, { key: "S" }] : [...down.values(), ...fading.values()].sort((a, b) => a.since - b.since);
    for (const { key } of visible) {
      const card = document.createElement("div");
      card.className = "card";
      if (Object.hasOwn(symbols, key)) {
        const icon = document.createElement("span");
        icon.className = "icon";
        icon.textContent = symbols[key];
        card.append(icon);
      }
      const name = document.createElement("span");
      name.textContent = label(key);
      name.className = name.textContent.length === 1 ? "letter" : "word";
      card.append(name);
      cards.append(card);
    }
    const entries = editor
      ? Array.from({ length: view.history ? view.historyLimit : 0 }, (_, i) => sampleHistory[i % sampleHistory.length])
      : recent.slice().reverse().map(item => item.chord);
    log.replaceChildren(...entries.map(chord => {
      const entry = document.createElement("span");
      entry.textContent = chord;
      return entry;
    }));
    positionOverlay(view);
  }

  function clamp(value, max) {
    return Math.max(0, Math.min(value, max));
  }

  function positionOverlay(view) {
    const width = panel.clientWidth, height = panel.clientHeight;
    const [side, align] = view.position.split("-");
    const custom = view.position === "custom";
    const half = view.size / 2;
    const minX = Math.min(width / 2, 12 + half), maxX = width - minX;
    const minY = Math.min(height / 2, 16 + half), maxY = Math.max(minY, height - 20 - half);
    let cx = custom ? Math.max(minX, Math.min(maxX, view.customX * width))
      : align === "center" ? width / 2 : align === "right" ? maxX : minX;
    const cy = custom ? Math.max(minY, Math.min(maxY, view.customY * height))
      : side === "top" ? minY : maxY;
    const roomLeft = cx - minX, roomRight = maxX - cx;
    const step = view.size * 1.14;
    let modes = [];
    if (roomLeft + .01 >= step) modes.push("left");
    if (roomLeft + .01 >= step / 2 && roomRight + .01 >= step / 2) modes.push("center");
    if (roomRight + .01 >= step) modes.push("right");
    if (!modes.length) modes = ["center"];
    let growth = modes.includes(view.growth) ? view.growth : modes[0];
    if (width >= 24 + view.size + step && (cy <= minY + 1 || cy >= maxY - 1)) {
      const rowLeft = cx - half - (growth === "left" ? step : growth === "center" ? step / 2 : 0);
      const rowRight = rowLeft + view.size + step;
      if (rowLeft <= 13 || rowRight >= width - 13) {
        growth = rowLeft <= 13 ? "right" : "left";
        cx = growth === "right" ? minX : maxX;
        modes = [growth];
      }
    }
    const leftEdge = cx - half, rightEdge = cx + half;
    const capacity = growth === "right" ? width - 12 - leftEdge : growth === "left" ? rightEdge - 12
      : 2 * Math.min(cx - 12, width - 12 - cx);
    const lineWidth = Math.max(1, capacity);
    const lineLeft = w => growth === "left" ? rightEdge - w : growth === "right" ? leftEdge : cx - w / 2;
    // A fixed two-key footprint keeps the orbit independent of the live chord.
    const refWidth = Math.min(lineWidth, view.size * 2.14);
    const bind = { x: lineLeft(refWidth), y: cy - half, w: refWidth, h: view.size };
    bind.h += Math.ceil(view.size * .09);
    const nodes = Array.from(log.children);
    const sizes = nodes.map(node => {
      node.hidden = false;
      return { w: node.offsetWidth, h: node.offsetHeight };
    });
    const typical = { w: Math.max(45, view.size * .9), h: Math.max(12, view.size * .23) + 9 };
    const first = sizes[0] || typical;
    const sides = ["up", "right", "down", "left"];
    const legacy = view.historyAngle == null ? sides.indexOf(view.historyDirection) :
      (Math.round(view.historyAngle / 90) + 5) % 4;
    const requested = view.historyDock ?? { side: legacy, t: .5 };
    // Choose a side using fixed geometry; live entry widths only determine how many fit.
    const basis = editor ? first : typical;
    const dock = visibleDock(bind, basis, requested, view.orbitRadius, width, height);
    const orbit = dockBox(bind, first, dock, view.orbitRadius);
    const reference = dockBox(bind, typical, dock, view.orbitRadius);
    geometry = { cx, cy, minX, maxX, minY, maxY, modes, growth, orbit, bind, dock };
    const allowed = sides.filter(dir => historyRun(dir, reference, [typical, typical], bind, width, height).length === 2);
    if (!allowed.length) allowed.push(view.historyDirection);
    const dir = resolveHistoryDirection(view.position, view.historyDirection, allowed);
    const automatic = historyAlignment(orbit, sizes, bind, width);
    let alignment = automatic;
    let plan = historyRun(dir, orbit, sizes, bind, width, height, alignment);
    const corner = (requested.anchor != null && requested.anchor < 12) || requested.t === 0 || requested.t === 1;
    const alignments = [];
    if (!corner && (dir === "up" || dir === "down") && sizes.length) {
      const layouts = [0, .5, 1].map(value => historyRun(dir, orbit, sizes, bind, width, height, value));
      const best = Math.max(plan.length, ...layouts.map(layout => layout.length));
      layouts.forEach((layout, i) => {
        const value = i / 2;
        if (!best || layout.length < Math.min(best, 2)) return;
        alignments.push(value);
        if (value === view.historyAlignment || (!alignments.includes(view.historyAlignment) && layout.length > plan.length)) {
          alignment = value;
          plan = layout;
        }
      });
    }
    geometry.alignments = alignments;
    geometry.alignment = alignment;
    const records = plan.slice(0, Math.min(view.historyLimit, nodes.length));
    cards.style.maxWidth = lineWidth + "px";
    const upward = cy > height / 2;
    cards.style.flexWrap = upward ? "wrap-reverse" : "wrap";
    cards.style.justifyContent = growth === "center" ? "center" : growth === "left" ? "flex-end" : "flex-start";
    const w = cards.offsetWidth || view.size, h = cards.offsetHeight || view.size;
    const x = lineLeft(w), y = upward ? cy + half - h : cy - half;
    cards.style.left = x + "px";
    cards.style.top = y + "px";

    const occupied = [{ x, y, w, h: h + Math.ceil(view.size * .09) }];
    nodes.forEach((node, i) => {
      const box = records[i];
      node.hidden = !box || overlaps(occupied[0], box);
      if (node.hidden) return;
      node.style.left = box.x + "px";
      node.style.top = box.y + "px";
      occupied.push(box);
    });
    let lineX = drag?.snapX == null ? null : cx;
    let lineY = drag?.snapY == null ? null : cy;
    const anchor = drag?.history ? drag.magnet : null;
    if (anchor != null) {
      if (anchor < 8) {
        const side = Math.floor(anchor / 2), end = anchor % 2;
        if (side % 2 === 0) lineX = bind.x + end * bind.w;
        else lineY = bind.y + end * bind.h;
      } else if (anchor < 12) {
        lineX = orbit.x + ([8, 11].includes(anchor) ? orbit.w : 0);
        lineY = orbit.y + (anchor < 10 ? orbit.h : 0);
      } else if (anchor % 2 === 0) lineX = bind.x + bind.w / 2;
      else lineY = bind.y + bind.h / 2;
    }
    guideX.hidden = lineX == null;
    guideY.hidden = lineY == null;
    if (lineX != null) guideX.style.left = lineX + "px";
    if (lineY != null) guideY.style.top = lineY + "px";
    drawGuides(view, bind, first, dock, width, height);
    if (!editor) return;
    const grow = controls.lastElementChild;
    grow.hidden = false;
    grow.title = tr("Направление роста клавиш", "Key growth direction") + " · " + directionTitle(growth);
    grow.setAttribute("aria-label", grow.title);
    grow.dataset.align = growth;
    grow.disabled = modes.length < 2;
    grow.style.maxWidth = bind.w + "px";
    grow.style.fontSize = bind.w < 85 ? "11px" : "14px";
    grow.style.left = (x + (w - grow.offsetWidth) / 2) + "px";
    grow.style.top = (y + occupied[0].h - grow.offsetHeight) + "px";
    occupied.push({ x: grow.offsetLeft, y: grow.offsetTop, w: grow.offsetWidth, h: grow.offsetHeight });
    const placeControl = (button, origin, preferred) => {
      const bw = button.offsetWidth, bh = button.offsetHeight;
      const spots = [
        [origin.x - bw - 5, origin.y + (origin.h - bh) / 2],
        [origin.x + (origin.w - bw) / 2, origin.y - bh - 5],
        [origin.x + origin.w + 5, origin.y + (origin.h - bh) / 2],
        [origin.x + (origin.w - bw) / 2, origin.y + origin.h + 5]
      ];
      const [px, py] = spots[preferred];
      // Search a small grid around the requested side, nearest available cell first.
      let chosen, distance = Infinity;
      for (let a = -4; a <= 4; a++) {
        for (let b = -4; b <= 4; b++) {
          const box = { x: clamp(px + a * 27, width - bw), y: clamp(py + b * 27, height - bh), w: bw, h: bh };
          const cost = Math.hypot(box.x - px, box.y - py);
          if (cost >= distance || occupied.some(item => overlaps(item, box, 3))) continue;
          chosen = box;
          distance = cost;
        }
      }
      button.hidden = !chosen;
      if (chosen) {
        button.style.left = chosen.x + "px";
        button.style.top = chosen.y + "px";
        occupied.push(chosen);
      }
    };
    const alignHistory = grow.previousElementSibling;
    alignHistory.hidden = !view.history || alignments.length < 2;
    if (!alignHistory.hidden) {
      const edge = alignment < .25 ? "left" : alignment > .75 ? "right" : "center";
      alignHistory.dataset.align = edge;
      const name = edge === "center" ? tr("по центру", "center") :
        edge === "left" ? tr("по левому краю", "left") : tr("по правому краю", "right");
      alignHistory.title = tr("Выравнивание истории", "History alignment") + " · " + name;
      alignHistory.setAttribute("aria-label", alignHistory.title);
      const side = orbit.x + orbit.w / 2 > width / 2 ? 0 : 2;
      placeControl(alignHistory, orbit, side);
      if (alignHistory.hidden) {
        alignHistory.hidden = false;
        placeControl(alignHistory, orbit, 2 - side);
      }
    }
    ["left", "up", "right", "down"].forEach((direction, i) => {
      const button = controls.children[i];
      button.title = tr("История ", "History ") + directionTitle(direction).toLowerCase();
      button.setAttribute("aria-label", button.title);
      button.hidden = !view.history || !allowed.includes(direction);
      if (button.hidden) return;
      button.setAttribute("aria-pressed", dir === direction);
      placeControl(button, orbit, i);
    });
    setChoices("growth", modes, growth);
    setChoices("historyDirection", allowed, dir);
    const count = nodes.filter(node => !node.hidden).length;
    form.elements.capacity.value = tr("На экране: ", "On screen: ") + count + tr(" из ", " of ") + view.historyLimit;
  }

  function overlaps(a, b, gap = 0) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x &&
      a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  }

  function inside(box, width, height) {
    return box.x >= 11.9 && box.y >= 11.9 && box.x + box.w <= width - 11.9 && box.y + box.h <= height - 11.9;
  }

  function dockBox(bind, size, dock, gap) {
    const anchor = dock.anchor;
    let { side, t } = dock;
    if (anchor >= 12 && anchor < 16) { side = anchor - 12; t = 0.5; }
    else if (anchor != null && anchor < 8) {
      side = Math.floor(anchor / 2);
      t = anchor % 2;
    }
    if (side != null) {
      const x = side === 1 ? bind.x + bind.w + gap : side === 3 ? bind.x - gap - size.w : bind.x + (bind.w - size.w) * t;
      const y = side === 2 ? bind.y + bind.h + gap : side === 0 ? bind.y - gap - size.h : bind.y + (bind.h - size.h) * t;
      return { ...size, x, y, side, t };
    }
    const hx = (bind.w + size.w) / 2, hy = (bind.h + size.h) / 2;
    let dx, dy;
    if (anchor >= 8) {
      dx = (anchor === 8 || anchor === 11 ? -1 : 1) * (hx + gap / Math.SQRT2);
      dy = (anchor < 10 ? -1 : 1) * (hy + gap / Math.SQRT2);
    } else {
      // Intersect the pointer ray with the rounded rectangle swept by the entry centre.
      const ux = Math.cos(dock.angle), uy = Math.sin(dock.angle);
      let low = 0, high = Math.hypot(hx, hy) + gap;
      for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (Math.hypot(Math.max(0, Math.abs(mid * ux) - hx), Math.max(0, Math.abs(mid * uy) - hy)) > gap) high = mid;
        else low = mid;
      }
      dx = high * ux;
      dy = high * uy;
    }
    return { ...size, x: bind.x + (bind.w - size.w) / 2 + dx, y: bind.y + (bind.h - size.h) / 2 + dy };
  }

  function visibleDock(bind, size, dock, gap, width, height) {
    const box = dockBox(bind, size, dock, gap);
    if (inside(box, width, height)) return dock;
    const angle = Math.atan2(box.y + (size.h-bind.h)/2 - bind.y, box.x + (size.w-bind.w)/2 - bind.x);
    for (let step = 1; step <= 180; step++) {
      for (const sign of [-1, 1]) {
        const candidate = { angle: angle + sign * step * Math.PI / 180 };
        if (inside(dockBox(bind, size, candidate, gap), width, height)) return candidate;
      }
    }
    return dock;
  }

  function drawGuides(view, bind, size, dock, width, height) {
    const show = editor && view.history;
    markers.style.display = show || (drag && !drag.history) ? "" : "none";
    if (!show && !drag) return;
    const path = markers.firstElementChild;
    path.style.display = show ? "" : "none";
    if (show) {
      let trace = "", move = true;
      for (let i = 0; i <= 96; i++) {
        const box = dockBox(bind, size, { angle: i * Math.PI / 48 }, view.orbitRadius);
        if (!inside(box, width, height)) { move = true; continue; }
        trace += (move ? "M" : "L") + (box.x + box.w/2) + " " + (box.y + box.h/2);
        move = false;
      }
      path.setAttribute("d", trace);
    }
    for (let anchor = 0; anchor < 16; anchor++) {
      const box = dockBox(bind, size, { anchor }, view.orbitRadius);
      const circle = markers.children[1 + anchor];
      circle.style.display = show && inside(box,width,height) ? "" : "none";
      const selected = anchor === (dock.anchor ?? (dock.t === 0 || dock.t === 1 ? dock.side * 2 + dock.t : -1));
      const cornerX = [0,1,0,0,0,1,1,1,1,0,0,1,.5,.5,.5,.5][anchor];
      const cornerY = [1,1,0,1,0,0,0,1,1,1,0,0,.5,.5,.5,.5][anchor];
      circle.setAttribute("cx", box.x + cornerX * box.w);
      circle.setAttribute("cy", box.y + cornerY * box.h);
      circle.setAttribute("r",selected ? 5 : 3.5);
      const color = anchor >= 12 ? "#4054bd" : anchor < 8 ? "#00758c" : "#8751aa";
      circle.setAttribute("stroke",color); circle.setAttribute("fill",selected ? color : "white");
    }
    const cross = markers.lastElementChild;
    cross.style.display = drag?.snapX != null && drag?.snapY != null ? "" : "none";
    cross.setAttribute("cx", geometry.cx); cross.setAttribute("cy", geometry.cy);
    cross.setAttribute("r", 5); cross.setAttribute("fill", "#00758c");
  }

  function historyAlignment(first, sizes, bind, width) {
    const widest = Math.max(...sizes.map(size => size.w));
    const middle = first.x + first.w / 2;
    // Move the column as a unit; entries near either edge share that edge.
    const alignment = middle > width - widest / 2 - 12 || bind.x + bind.w >= width - 13 ? 1 :
      middle < widest / 2 + 12 || bind.x <= 13 ? 0 : .5;
    return first.side === 1 ? 0 : first.side === 3 ? 1 : first.t ?? alignment;
  }

  function historyRun(dir, first, sizes, bind, width, height, align = historyAlignment(first, sizes, bind, width)) {
    const vertical = dir === "up" || dir === "down";
    const boxes = [];
    for (const size of sizes) {
      const previous = boxes.at(-1);
      let x = first.x, y = first.y;
      if (vertical) {
        x = first.x + (first.w - size.w) * align;
        if (previous) y = dir === "up" ? previous.y - size.h - 5 : previous.y + previous.h + 5;
      } else if (previous) {
        x = dir === "left" ? previous.x - size.w - 5 : previous.x + previous.w + 5;
        y += (first.h - size.h) / 2;
      }
      const box = { ...size, x, y };
      if (x < 11.9 || y < 11.9 || x + size.w > width - 11.9 || y + size.h > height - 11.9 || overlaps(box, bind)) break;
      boxes.push(box);
    }
    return boxes;
  }

  function setChoices(id, values, selected) {
    const select = form.elements[id];
    const key = language + values.join();
    if (select.dataset.choices !== key) {
      select.replaceChildren(...values.map(value => new Option(directions[value] + " " + directionTitle(value), value)));
      select.dataset.choices = key;
    }
    select.value = selected;
  }

  function beginDrag(event) {
    if (!editor || drag || event.button !== 0 || !event.isPrimary) return;
    const history = event.currentTarget === log;
    if (history && event.target !== log.firstElementChild) return;
    event.preventDefault();
    drag = { history, owner: event.currentTarget, id: event.pointerId, startX: event.clientX, startY: event.clientY,
      cx: geometry.cx, cy: geometry.cy, previous: { ...preview }, moved: false };
    if (history) {
      drag.orbitX = geometry.orbit.x + geometry.orbit.w / 2;
      drag.orbitY = geometry.orbit.y + geometry.orbit.h / 2;
      drag.magnet = geometry.dock.anchor ?? (geometry.dock.t === 0 || geometry.dock.t === 1 ? geometry.dock.side * 2 + geometry.dock.t : null);
    } else {
      drag.growth = geometry.growth;
      drag.rowWidth = cards.getBoundingClientRect().width;
    }
    drag.owner.setPointerCapture(event.pointerId);
  }

  function snap(value, targets, previous) {
    if (previous != null && Math.abs(value - previous) < 21) return previous;
    return targets.find(point => Math.abs(value - point) < 11);
  }

  function moveDrag(event) {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    if (drag.history) {
      const { bind, orbit } = geometry;
      const px = drag.orbitX + dx, py = drag.orbitY + dy;
      const angle = Math.atan2(py - bind.y - bind.h/2, px - bind.x - bind.w/2);
      const gap = preview.orbitRadius, width = panel.clientWidth, height = panel.clientHeight;
      const free = visibleDock(bind, orbit, { angle }, gap, width, height);
      const point = dockBox(bind, orbit, free, gap);
      let nearest = null, nearestDistance = Infinity;
      for (let anchor = 0; anchor < 16; anchor++) {
        const box = dockBox(bind, orbit, { anchor }, gap);
        if (!inside(box,width,height)) continue;
        const distance = Math.hypot(box.x - point.x, box.y - point.y);
        if (anchor === drag.magnet && distance <= 14) { nearest = anchor; break; }
        if (distance <= 8 && distance < nearestDistance) { nearest = anchor; nearestDistance = distance; }
      }
      drag.animateSnap ||= nearest != null && nearest !== drag.magnet;
      drag.magnet = nearest;
      preview.historyDock = nearest == null ? free : { anchor: nearest };
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!drag?.history) return;
        const first = log.firstElementChild;
        const before = first?.getBoundingClientRect();
        positionOverlay(preview);
        if (drag.animateSnap && before && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          log.getAnimations().forEach(animation => animation.cancel());
          const after = first.getBoundingClientRect();
          log.animate([{ transform: "translate(" + (before.x - after.x) + "px," + (before.y - after.y) + "px)" },
            { transform: "none" }], { duration: 115, easing: "ease-out" });
        }
        drag.animateSnap = false;
      });
      return;
    }
    const x = drag.cx + dx, y = drag.cy + dy;
    const width = panel.clientWidth, height = panel.clientHeight;
    const room = Math.min(geometry.maxX - geometry.minX, Math.max(preview.size * 1.14, drag.rowWidth - preview.size));
    const leftRoom = drag.growth === "left" ? room : drag.growth === "center" ? room / 2 : 0;
    const minX = geometry.minX + leftRoom, maxX = geometry.maxX - (room - leftRoom);
    drag.snapX = snap(x, [minX, Math.max(minX, Math.min(maxX, width / 2)), maxX], drag.snapX);
    drag.snapY = snap(y, [geometry.minY, height / 2, geometry.maxY], drag.snapY);
    preview.position = "custom";
    preview.growth = drag.growth;
    preview.customX = Math.max(minX, Math.min(maxX, drag.snapX ?? x)) / width;
    preview.customY = clamp((drag.snapY ?? y) / height, 1);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!drag) return;
      positionOverlay(preview);
    });
  }

  function finishDrag(event) {
    if (drag?.id !== event.pointerId) return;
    moveDrag(event);
    if (drag.history) {
      const changed = drag.moved;
      releaseDrag();
      if (changed) saveOptions({ historyDock: preview.historyDock });
      return;
    }
    const moved = drag.moved;
    if (moved) {
      positionOverlay(preview);
      preview.customX = geometry.cx / panel.clientWidth;
      preview.growth = geometry.growth;
    }
    releaseDrag();
    if (moved) {
      saveOptions({ position: "custom", growth: preview.growth, customX: preview.customX, customY: preview.customY });
    } else render();
  }

  function releaseDrag() {
    if (drag && drag.owner.hasPointerCapture(drag.id)) drag.owner.releasePointerCapture(drag.id);
    cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
  }

  function cancelPlacement() {
    if (!drag) return;
    preview = drag.previous;
    releaseDrag();
    render();
  }

  function saveOptions(changes) {
    if (changes.historyDirection && !preview.historyDock) changes.historyDock = { ...geometry.dock };
    Object.assign(preview, changes);
    Object.assign(settings, changes);
    runPreset("patch", { changes });
    render();
  }

  async function presetRequest(command, extra = {}) {
    const result = await chrome.runtime.sendMessage({ action: "preset", command, language, ...extra });
    if (!result || result.error) throw Error(result?.error || tr("Не удалось загрузить настройки.", "Could not load settings."));
    return result;
  }

  function applyProfile(result) {
    if (profile && result.revision < profile.revision) return;
    profile = result;
    if (!drag) {
      Object.assign(settings, result.values);
      if (preview) Object.assign(preview, settings);
    }
    if (!settings.enabled || !settings.history) { recent.length = 0; extendChord = false; }
    if (!settings.enabled) { clearHeld(); localKeys.clear(); }
    expireHistory();
    ready = true;
    render();
  }

  let refreshInFlight = false;
  let refreshRequested = false;
  let needsRefresh = false;
  async function refreshProfiles() {
    refreshRequested = true;
    if (refreshInFlight || !chrome.runtime?.id) return;
    refreshInFlight = true;
    try {
      while (refreshRequested && chrome.runtime?.id) {
        refreshRequested = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const result = await presetRequest("read");
            if (!pendingWrites) applyProfile(result);
            needsRefresh = false;
            break;
          } catch (error) {
            needsRefresh = true;
            if (!chrome.runtime?.id) return;
            const disconnected = /message (channel|port) closed|receiving end does not exist|could not establish connection/i.test(error.message);
            if (!disconnected || attempt === 2) {
              if (form) form.elements.profileError.value = error.message;
              else if (!disconnected) console.warn("Keyboard overlay:", error.message);
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
          }
        }
      }
    } finally { refreshInFlight = false; }
  }
  window.addEventListener("focus", () => { if (needsRefresh) refreshProfiles(); });
  async function runPreset(command, extra = {}) {
    pendingWrites++;
    try {
      const result = await presetRequest(command, extra);
      if (!profile || result.revision >= profile.revision) profile = result;
      if (pendingWrites === 1) applyProfile(profile);
      if (form) form.elements.profileError.value = "";
    } catch (error) {
      if (form) {
        delete form.elements.profileList.dataset.key;
        syncPresets();
        form.elements.profileError.value = error.message;
      }
    } finally {
      pendingWrites--;
    }
  }

  function syncPresets() {
    if (!profile) return;
    const el = form.elements;
    const selected = profile.presets.find(p => p.id === profile.id);
    const source = profile.presets.find(p => p.id === profile.source);
    const key = JSON.stringify([language, profile.presets, profile.id, profile.defaultId]);
    if (el.profileList.dataset.key !== key) {
      const options = form.querySelector("#profileOptions");
      const menu = form.querySelector("#profileMenu");
      menu.hidden = true;
      options.after(menu);
      el.profileList.hidden = !profile.presets.length;
      form.querySelector("#profileLabel").hidden = el.profileList.hidden;
      if (el.profileList.hidden) {
        options.hidden = true;
        el.profileList.setAttribute("aria-expanded", "false");
      }
      el.profileList.textContent = selected?.name || tr("Выбрать пресет", "Choose preset");
      options.replaceChildren(...profile.presets.map(({ id, name }) => {
        const row = document.createElement("div");
        row.className = "preset-row";
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = name;
        choice.dataset.select = id;
        choice.setAttribute("aria-pressed", String(id === profile.id));
        const star = document.createElement("button");
        const current = id === profile.defaultId;
        star.type = "button";
        star.textContent = current ? "★" : "☆";
        star.disabled = current;
        star.dataset.favorite = id;
        star.title = (current ? tr("Пресет по умолчанию", "Default preset") :
          tr("Сделать по умолчанию", "Set as default")) + " · " + name;
        star.setAttribute("aria-label", star.title);
        const actions = document.createElement("button");
        actions.type = "button";
        actions.textContent = "⋯";
        actions.dataset.actions = id;
        actions.title = tr("Действия с пресетом", "Preset actions") + " · " + name;
        actions.setAttribute("aria-label", actions.title);
        actions.setAttribute("aria-expanded", "false");
        actions.setAttribute("aria-controls", "profileMenu");
        row.append(choice, star, actions);
        return row;
      }));
      el.profileList.dataset.key = key;
    }
    el.saveCopy.hidden = false;
    el.updateOriginal.hidden = !source;
    if (source) el.updateOriginal.textContent = tr("Обновить «", "Update “") + source.name + tr("»", "”");
  }

  function setupPresets() {
    const el = form.elements;
    const menu = form.querySelector("#profileMenu");
    const options = form.querySelector("#profileOptions");
    function showOptions(open) {
      closeMenu();
      options.hidden = !open;
      el.profileList.setAttribute("aria-expanded", String(open));
    }
    function closeMenu() {
      options.querySelector('[data-actions][aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
      menu.hidden = true;
    }
    menu.onclick = event => event.stopPropagation();
    form.onfocusout = event => {
      if (!form.querySelector("#profiles").contains(event.relatedTarget)) {
        showOptions(false);
      }
    };
    form.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (!options.hidden) el.profileList.focus();
      showOptions(false);
    });
    el.profileList.onclick = () => {
      showOptions(options.hidden);
      if (!options.hidden) options.querySelector('[aria-pressed="true"]')?.focus();
    };
    options.onclick = event => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      const { select, favorite, actions } = button.dataset;
      if (actions) {
        const open = menu.hidden || menu.dataset.id !== actions;
        closeMenu();
        if (open) {
          button.parentElement.after(menu);
          menu.dataset.id = actions;
          menu.hidden = false;
          button.setAttribute("aria-expanded", "true");
        }
        return;
      }
      if (favorite) {
        const name = button.previousElementSibling.textContent;
        if (!confirm(tr("Сделать «" + name + "» пресетом по умолчанию?", "Set “" + name + "” as the default preset?"))) return;
        runPreset("default", { id: favorite });
      } else if (select) runPreset("load", { id: select });
      el.profileList.focus();
      showOptions(false);
    };
    el.saveCopy.onclick = () => {
      const name = prompt(tr("Название нового пресета", "New preset name"));
      if (name?.trim()) runPreset("create", { name, values: { ...preview } });
    };
    el.updateOriginal.onclick = () => {
      const source = profile.presets.find(p => p.id === profile.source);
      if (source) runPreset("update", { id: source.id, revision: profile.sourceRevision, name: source.name, values: { ...preview } });
    };
    el.renameProfile.onclick = () => {
      const selected = profile.presets.find(p => p.id === menu.dataset.id);
      if (!selected) return;
      const name = prompt(tr("Название пресета", "Preset name"), selected.name);
      if (name?.trim() && name !== selected.name) runPreset("rename", { id: selected.id, name });
    };
    el.removeProfile.onclick = () => {
      const selected = profile.presets.find(p => p.id === menu.dataset.id);
      if (selected && confirm(tr("Удалить пресет «" + selected.name + "»?", "Delete preset “" + selected.name + "”?"))) runPreset("remove", { id: selected.id });
    };
  }

  function syncForm(view) {
    syncPresets();
    for (const [id, value] of Object.entries(view)) {
      const field = form.elements.namedItem(id);
      if (!field || id === "growth" || id === "historyDirection") continue;
      if (field.type === "checkbox") field.checked = value;
      else if (field.type !== "number" || shadow.activeElement !== field) field.value = value;
    }
    for (const field of form.querySelectorAll("[data-range]")) {
      if (shadow.activeElement !== field) field.value = view[field.dataset.range].toLocaleString(language);
    }
    form.elements.historyLimit.disabled = !view.history;
    form.elements.capacity.hidden = !view.history;
    form.elements.autoExpire.disabled = !view.history;
    form.elements.historySeconds.hidden = !view.history || !view.autoExpire;
    form.querySelector("#secondsLabel").hidden = !view.history || !view.autoExpire;
    form.elements.clearHistory.disabled = !view.history;
    form.elements.historyDirection.disabled = !view.history;
  }

  function applyEditorTheme(value) {
    const theme = value === "dark" || value === "system" ? value : "light";
    editor.dataset.theme = theme;
    form.elements.editorTheme.value = theme;
  }

  function applyEditorLanguage(value) {
    language = value === "en" ? "en" : "ru";
    editor.lang = language;
    form.elements.editorLanguage.value = language;
    for (const node of editor.querySelectorAll("[data-en]")) {
      node.dataset.ru ??= node.textContent;
      node.textContent = tr(node.dataset.ru, node.dataset.en);
    }
    const header = editor.querySelector("header");
    header.title = tr("Перетащить панель настроек", "Drag the settings panel");
    const close = header.querySelector("button");
    close.title = tr("Закрыть настройки", "Close settings");
    close.setAttribute("aria-label", close.title);
    form.querySelector(".sections").setAttribute("aria-label", tr("Раздел настроек", "Settings section"));
    if (standalone) {
      document.documentElement.lang = language;
      document.title = header.querySelector("h1").textContent;
    }
    render();
  }

  async function openEditor() {
    if (editor || opening) return;
    opening = true;
    try {
      const [saved, template, preferences] = await Promise.all([
        presetRequest("read"),
        chrome.runtime.sendMessage({ action: "editorTemplate" }),
        chrome.storage.local.get(["editorTheme", "editorLanguage"])
      ]);
      if (template?.error) throw Error(template.error);
      profile = saved;
      Object.assign(settings, saved.values);
      preview = { ...settings };
      if (!host) mount();
      const doc = new DOMParser().parseFromString(template.html, "text/html");
      if (shadow.adoptedStyleSheets.length === 1) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(template.css);
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      }
      editor = document.createElement("aside");
      editor.className = "editor";
      const right = settings.position.endsWith("right") || (settings.position === "custom" && settings.customX > .5);
      editor.style[right ? "left" : "right"] = "8px";
      editor.style.top = "8px";
      const header = document.createElement("header");
      const close = document.createElement("button");
      close.textContent = "×";
      close.onclick = closeEditor;
      header.append(doc.querySelector("h1"), close);
      enablePanelDrag(header, close);
      form = doc.querySelector("form");
      form.hidden = false;
      applyEditorTheme(preferences.editorTheme);
      form.elements.editorLanguage.onchange = async event => {
        const previous = language;
        const next = event.target.value;
        applyEditorLanguage(next);
        try {
          await chrome.storage.local.set({ editorLanguage: next });
        } catch (error) {
          if (editor && language === next) {
            applyEditorLanguage(previous);
            form.elements.profileError.value = error.message;
          }
        }
      };
      form.elements.editorTheme.onchange = async event => {
        const previous = editor.dataset.theme;
        const theme = event.target.value;
        applyEditorTheme(theme);
        try {
          await chrome.storage.local.set({ editorTheme: theme });
        } catch (error) {
          if (editor && editor.dataset.theme === theme) {
            applyEditorTheme(previous);
            form.elements.profileError.value = error.message;
          }
        }
      };
      setupPresets();
      const sections = form.querySelectorAll(".sections button");
      for (const section of sections) {
        section.onclick = () => {
          for (const button of sections) {
            const active = button === section;
            button.setAttribute("aria-pressed", String(active));
            form.querySelector("#" + button.getAttribute("aria-controls")).hidden = !active;
          }
        };
      }
      form.onsubmit = event => event.preventDefault();
      for (const field of form.querySelectorAll("[data-range]")) {
        const range = form.elements[field.dataset.range];
        field.min = range.min;
        field.max = range.max;
        field.step = range.step;
        field.onblur = () => { field.value = preview[field.dataset.range].toLocaleString(language); };
      }
      form.addEventListener("input", ({ target }) => {
        const key = target.dataset.range || target.id;
        if (!(key in keyboardDefaults)) return;
        if (target.inputMode === "decimal") {
          const text = target.value.trim().replace(",", ".");
          if (!/^(?:\d+|\d*\.\d+)$/.test(text)) return;
          const seconds = Number(text);
          if (seconds < Number(target.min) || seconds > Number(target.max) || !Number.isInteger(seconds * 10)) return;
          saveOptions({ [key]: seconds });
          return;
        }
        if (target.type === "number" && (!target.validity.valid || !target.value)) return;
        const value = target.type === "checkbox" ? target.checked :
          ["range", "number"].includes(target.type) ? target.valueAsNumber : target.value;
        saveOptions({ [key]: value });
      });
      form.addEventListener("change", ({ target }) => {
        if (target.type === "number") target.value = preview[target.dataset.range || target.id];
      });
      form.elements.clearHistory.onclick = () => {
        recent.length = 0;
        extendChord = false;
        expireHistory();
        render();
      };
      for (const type of ["keydown", "keyup", "click", "pointerdown"]) {
        editor.addEventListener(type, event => event.stopPropagation());
      }
      editor.append(header, form);
      shadow.append(editor);
      host.removeAttribute("aria-hidden");
      applyEditorLanguage(preferences.editorLanguage);
    } finally { opening = false; }
  }

  function enablePanelDrag(header, close) {
    let offset;
    header.onpointerdown = event => {
      if (event.target === close || event.button !== 0) return;
      const box = editor.getBoundingClientRect();
      offset = { x: event.clientX - box.left, y: event.clientY - box.top };
      header.setPointerCapture(event.pointerId);
    };
    header.onpointermove = event => {
      if (!offset) return;
      editor.style.right = "auto";
      editor.style.left = clamp(event.clientX - offset.x, host.clientWidth - editor.offsetWidth) + "px";
      editor.style.top = clamp(event.clientY - offset.y, host.clientHeight - editor.offsetHeight) + "px";
    };
    header.onlostpointercapture = () => { offset = null; };
  }

  function closeEditor() {
    releaseDrag();
    editor.remove();
    if (profile) Object.assign(settings, profile.values);
    editor = form = preview = null;
    host.setAttribute("aria-hidden", "true");
    render();
    if (standalone) window.close();
  }

  function expireHistory() {
    clearTimeout(expiryTimer);
    if (recent.length > settings.historyLimit) recent.splice(0, recent.length - settings.historyLimit);
    if (!settings.autoExpire || !recent.length) return;
    const lifetime = settings.historySeconds * 1000;
    const now = Date.now();
    while (recent.length && recent[0].time + lifetime <= now) recent.shift();
    if (recent.length) expiryTimer = setTimeout(() => {
      expireHistory();
      render();
    }, recent[0].time + lifetime - now);
  }
  function clearFading() {
    for (const item of fading.values()) clearTimeout(item.timer);
    fading.clear();
  }
  function clearHeld() {
    down.clear();
    clearFading();
    extendChord = false;
  }
  function receive({ type, id, key }) {
    if (!ready || !settings.enabled) return;
    if (type === "clear") clearHeld();
    if (type === "down") {
      if (down.has(id)) return;
      clearFading();
      down.set(id, { key: displayKey(key, id), since: performance.now() });
      if (settings.history) {
        if (extendChord) recent.pop();
        recent.push({ chord: Array.from(down.values(), item => label(item.key)).join(" + "), time: Date.now() });
        expireHistory();
        extendChord = true;
      }
    }
    if (type === "up") {
      const item = down.get(id);
      if (!item) return;
      down.delete(id);
      extendChord = false;
      const delayMs = settings.releaseDelay * 1000;
      if (delayMs > 0) {
        item.timer = setTimeout(() => { fading.delete(id); render(); }, delayMs);
        fading.set(id, item);
      }
    }
    render();
  }
  function send(type, id, key) {
    const event = { channel: "keyboard-overlay", type, id, key };
    if (main) receive(event);
    else if (chrome.runtime.id) chrome.runtime.sendMessage(event).catch(() => {});
  }
  if (main) {
    window.addEventListener("resize", render);
    window.addEventListener("keydown", event => {
      if (drag && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPlacement();
      }
    }, true);
  }
  if (standalone) globalThis.openKeyboardEditor = openEditor;
  if (main && !standalone) {
    chrome.runtime.onMessage.addListener((event, sender, reply) => {
      if (event.action === "openEditor") {
        openEditor().then(() => reply(true), () => reply(false));
        return true;
      }
      if (event.channel === "keyboard-overlay") receive(event);
    });
    document.addEventListener("fullscreenchange", render);
  }
  function passwordField(event) {
    return event.composedPath().some(node => node instanceof HTMLInputElement && node.type === "password");
  }
  function reset() {
    localKeys.clear();
    send("clear");
  }
  document.addEventListener("focusin", event => { if (passwordField(event)) reset(); }, true);
  window.addEventListener("keydown", event => {
    if ((editor && event.composedPath().includes(host)) || !chrome.runtime?.id || !ready || !settings.enabled || !event.isTrusted || event.repeat || passwordField(event)) return;
    const id = event.code || event.key;
    localKeys.add(id);
    send("down", id, event.key);
  }, true);
  window.addEventListener("keyup", event => {
    if (event.isTrusted && localKeys.delete(event.code || event.key)) send("up", event.code || event.key);
  }, true);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.editorTheme && editor) applyEditorTheme(changes.editorTheme.newValue);
    if (area === "local" && changes.editorLanguage && editor) applyEditorLanguage(changes.editorLanguage.newValue);
    if (area === "local" && changes.keyboardProfiles && !pendingWrites) refreshProfiles();
  });
  refreshProfiles();
})();
