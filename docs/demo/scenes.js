const scenarios = {
  placement: { hint: "Drag the large keys through the centre, then towards an edge. Watch the guides.", customX: .3, customY: .72 },
  orbit: { hint: "Drag the first history entry around the keys and release it at a snap point.", orbitRadius: 38 },
  alignment: { hint: "Click the alignment icon beside the history. Use an arrow to change its direction.", historyLimit: 4, historyDirection: "down", historyDock: { anchor: 14 } },
  growth: { hint: "Use the icon on the keys to choose leftward growth. Select Try keys and hold Ctrl, Shift and P.", customX: .80, growth: "center" },
  presets: { hint: "Save this layout as a preset. Open its list, select the star, then try it on site B.", customX: .22, customY: .72 }
};
const scene = document.querySelector("#scene");
const site = document.querySelector("#site");
const edit = document.querySelector("#edit");
const current = location.hash.slice(1);
scene.value = Object.hasOwn(scenarios, current) ? current : "placement";
scene.onchange = () => { location.hash = scene.value; };
window.onhashchange = () => location.reload();

async function openDemoEditor() {
  const opened = await new Promise(resolve => {
    for (const listener of demoListeners) if (listener({ action: "openEditor" }, {}, resolve)) break;
  });
  if (!opened) throw Error("Could not open the editor");
  document.querySelector("#keyboard-overlay-extension-interactive-demo").dataset.scene = scene.value;
}
async function initialize() {
  const { hint, ...values } = scenarios[scene.value];
  document.querySelector("#hint").textContent = hint;
  await chrome.runtime.sendMessage({ action: "preset", command: "patch", changes: {
    position: "custom", size: 60, customX: .5, customY: .55, historyLimit: 2, ...values
  } });
  await openDemoEditor();
  edit.hidden = scene.value !== "growth" && scene.value !== "presets";
  site.hidden = scene.value !== "presets";
  if (scene.value === "growth") {
    edit.textContent = "Try keys";
    edit.onclick = async () => {
      const close = demoRoot.querySelector(".editor header button");
      if (close) {
        close.click();
        edit.textContent = "Edit placement";
        edit.blur();
      } else {
        await openDemoEditor();
        edit.textContent = "Try keys";
      }
    };
  } else edit.onclick = openDemoEditor;
}
site.onclick = async () => {
  demoSite = "https://site-b.example";
  await chrome.runtime.sendMessage({ action: "preset", command: "read" });
  demoRoot.querySelector(".editor header button")?.click();
  await openDemoEditor();
  site.textContent = "Site B";
  site.disabled = true;
};
initialize().catch(error => { document.querySelector("#hint").textContent = error.message; });
