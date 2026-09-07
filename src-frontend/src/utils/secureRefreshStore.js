/**
 * Native-only refresh persistence (issue #19).
 *
 * Web/PWA: refresh lives in an httpOnly Secure cookie - never here.
 * Android/Capacitor: EncryptedSharedPreferences via
 * capacitor-secure-storage-plugin (Keystore-backed) when installed.
 *
 * capacitor-secure-storage-plugin is a package.json dependency; CI runs
 * `npx cap sync android` before assembleRelease. A Gradle-only rebuild
 * without cap sync will miss the plugin and fall back to cookies.
 */
import {registerPlugin} from "@capacitor/core";
import {isNativeApp} from "./serverUrl";

const KEY = "wc_refresh";
const SecureStoragePlugin = registerPlugin("SecureStoragePlugin");

let memoryMirror = null;

export function cacheNativeRefresh(token) {
  memoryMirror = token || null;
}

export function peekNativeRefresh() {
  return memoryMirror;
}

export async function getSecureRefresh() {
  if (!isNativeApp()) return null;
  if (memoryMirror) return memoryMirror;
  try {
    const {value} = await SecureStoragePlugin.get({key: KEY});
    memoryMirror = value || null;
    return memoryMirror;
  } catch {
    return null;
  }
}

export async function setSecureRefresh(token) {
  if (!isNativeApp()) return;
  memoryMirror = token || null;
  if (!token) {
    await clearSecureRefresh();
    return;
  }
  try {
    await SecureStoragePlugin.set({key: KEY, value: token});
  } catch {
    /* plugin missing until npm i + cap sync */
  }
}

export async function clearSecureRefresh() {
  memoryMirror = null;
  if (!isNativeApp()) return;
  try {
    await SecureStoragePlugin.remove({key: KEY});
  } catch {
    /* best effort */
  }
}
