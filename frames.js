importScripts("settings.js", "presets.js");

// Static content scripts only start on navigation. Attach to already-open sites too.
chrome.runtime.onInstalled.addListener(async () => {
  const manifest = chrome.runtime.getManifest();
  const tabs = await chrome.tabs.query({ url: manifest.host_permissions });
  await Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: manifest.content_scripts[0].js
  })));
});

// Draw iframe input in the main viewport, including input from cross-origin frames.
chrome.runtime.onMessage.addListener((event, sender) => {
  if (sender.frameId > 0 && sender.tab && event.channel === "keyboard-overlay") {
    chrome.tabs.sendMessage(sender.tab.id, event, { frameId: 0 }).catch(() => {});
  }
});

chrome.action.onClicked.addListener(async tab => {
  const openHere = () => chrome.tabs.sendMessage(tab.id, { action: "openEditor" }, { frameId: 0 });
  try {
    if (!await openHere().catch(() => false)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: chrome.runtime.getManifest().content_scripts[0].js
      });
      if (!await openHere()) throw Error("Настройки не открылись");
    }
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.runtime.getManifest().action.default_title });
  } catch {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: "!" }),
      chrome.action.setTitle({ tabId: tab.id, title: "Settings are unavailable on this page. Open the site where you want to show keystrokes." })
    ]);
  }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.action !== "editorTemplate") return;
  Promise.all(["popup.html", "popup.css"].map(async file =>
    (await fetch(chrome.runtime.getURL(file))).text()
  )).then(([html, css]) => reply({ html, css }), error => reply({ error: error.message }));
  return true;
});
