// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: trash-alt;

/**
 * Reset Keychain Credentials & Cache for Mi Movistar Widget
 * Run this script inside Scriptable to clear all stored tokens and cached data.
 */

async function resetMovistarSession() {
  const alert = new Alert();
  alert.title = "Reset Mi Movistar Credentials";
  alert.message = "This will remove your saved session token, phone number, and local usage cache from this iPhone.";
  alert.addDestructiveAction("Clear Everything");
  alert.addCancelAction("Cancel");

  const choice = await alert.presentAlert();
  if (choice === -1) {
    Script.complete();
    return;
  }

  const keys = ["MOVISTAR_TOKEN", "MOVISTAR_PHONE", "MOVISTAR_PASS", "MOVISTAR_SESS_EXP"];
  let clearedCount = 0;

  for (const key of keys) {
    if (Keychain.contains(key)) {
      Keychain.remove(key);
      clearedCount++;
    }
  }

  // Remove cached JSON file
  try {
    const fm = FileManager.local();
    const cachePath = fm.joinPath(fm.libraryDirectory(), "movistar_usage_cache.json");
    if (fm.fileExists(cachePath)) {
      fm.remove(cachePath);
    }
  } catch (e) {
    console.warn("Could not delete cache file: " + e.message);
  }

  const doneAlert = new Alert();
  doneAlert.title = "Cleared Successfully";
  doneAlert.message = `Removed ${clearedCount} Keychain entries and local cache. You can now re-authenticate from the main widget script.`;
  doneAlert.addAction("OK");
  await doneAlert.presentAlert();

  Script.complete();
}

await resetMovistarSession();
