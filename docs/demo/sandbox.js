// Keep a reference to the demo editor so the page can operate its close button.
let demoRoot;
const attachDemoShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) {
  const root = attachDemoShadow.call(this, options);
  if (this.id === "keyboard-overlay-extension-interactive-demo") {
    demoRoot = root;
    Element.prototype.attachShadow = attachDemoShadow;
  }
  return root;
};
// Supply the extension APIs used by the editor. Demo profiles live in this tab only.
const demoListeners = [];
const demoStore = { editorLanguage: "en", editorTheme: "light" };
let demoSite = "https://site-a.example";
const demoTemplate = Promise.all(["popup.html", "popup.css"].map(async filename => {
  const response = await fetch("../../" + filename);
  if (!response.ok) throw Error("Could not load " + filename);
  return response.text();
})).then(([html, css]) => ({ html, css: css + `
  :host([data-scene]:not([data-scene="presets"])) .editor { display: none }
  @media(max-width: 760px) { :host([data-scene="presets"]) .editor { top: auto !important; bottom: 8px; max-height: 63vh } }
` }));

window.chrome ??= {};
chrome.storage = {
  onChanged: { addListener() {} },
  local: {
    async get(keys) {
      return Object.fromEntries([].concat(keys).filter(k => k in demoStore).map(k => [k, structuredClone(demoStore[k])]));
    },
    async set(items) { Object.assign(demoStore, structuredClone(items)); }
  }
};
chrome.runtime = {
  id: "interactive-demo",
  getURL: path => new URL("../../" + path, location.href).href,
  onMessage: { addListener(fn) { demoListeners.push(fn); } },
  async sendMessage(message) {
    if (message.action === "editorTemplate") return demoTemplate;
    return new Promise(resolve => {
      for (const listener of demoListeners) {
        if (listener(message, { tab: { url: demoSite } }, resolve)) return;
      }
    });
  }
};
