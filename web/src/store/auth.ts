"use client";

import localforage from "localforage";

export const AUTH_KEY_STORAGE_KEY = "chatgpt2api_auth_key";
const AUTH_IDENTITY_STORAGE_KEY = "chatgpt2api_auth_identity";

export type StoredAuthIdentity = {
  scope: string;
  userId: number;
  username: string;
  source: string;
  isAdmin: boolean;
};

const authStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "auth",
});

let cachedAuthIdentity: StoredAuthIdentity | null | undefined;

function decodeBase64UrlJSON(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deriveAuthIdentity(authKey: string): StoredAuthIdentity | null {
  const token = String(authKey || "").trim();
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length === 4 && parts[0] === "cigs" && parts[1] === "v1") {
    try {
      const payload = decodeBase64UrlJSON(parts[2]);
      const userId = Number(payload.uid || 0);
      const username = String(payload.username || "").trim();
      const source = String(payload.source || "session").trim() || "session";
      const fallbackKey = username || String(userId || "unknown");
      return {
        scope: `${source}:${userId > 0 ? userId : fallbackKey}`,
        userId,
        username,
        source,
        isAdmin: Boolean(payload.admin),
      };
    } catch {
      // Fall through to the legacy token scope below.
    }
  }

  return {
    scope: `legacy:${simpleHash(token)}`,
    userId: 0,
    username: "legacy",
    source: "legacy",
    isAdmin: false,
  };
}

function persistAuthIdentity(identity: StoredAuthIdentity | null) {
  cachedAuthIdentity = identity;
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (identity) {
      window.localStorage.setItem(
        AUTH_IDENTITY_STORAGE_KEY,
        JSON.stringify(identity),
      );
      return;
    }
    window.localStorage.removeItem(AUTH_IDENTITY_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures; the token itself is still persisted.
  }
}

export function getStoredAuthIdentitySync(): StoredAuthIdentity | null {
  if (cachedAuthIdentity !== undefined) {
    return cachedAuthIdentity;
  }
  if (typeof window === "undefined") {
    cachedAuthIdentity = null;
    return null;
  }
  try {
    const raw = window.localStorage.getItem(AUTH_IDENTITY_STORAGE_KEY);
    if (!raw) {
      cachedAuthIdentity = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredAuthIdentity>;
    if (typeof parsed.scope !== "string" || !parsed.scope.trim()) {
      cachedAuthIdentity = null;
      return null;
    }
    cachedAuthIdentity = {
      scope: parsed.scope.trim(),
      userId: Number(parsed.userId || 0),
      username: String(parsed.username || "").trim(),
      source: String(parsed.source || "").trim(),
      isAdmin: Boolean(parsed.isAdmin),
    };
    return cachedAuthIdentity;
  } catch {
    cachedAuthIdentity = null;
    return null;
  }
}

export async function getStoredAuthIdentity() {
  const authKey = await getStoredAuthKey();
  const identity = deriveAuthIdentity(authKey);
  persistAuthIdentity(identity);
  return identity;
}

export async function getStoredAuthKey() {
  if (typeof window === "undefined") {
    return "";
  }
  const value = await authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY);
  return String(value || "").trim();
}

export async function setStoredAuthKey(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  if (!normalizedAuthKey) {
    await clearStoredAuthKey();
    return;
  }
  persistAuthIdentity(deriveAuthIdentity(normalizedAuthKey));
  await authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedAuthKey);
}

export async function clearStoredAuthKey() {
  if (typeof window === "undefined") {
    return;
  }
  persistAuthIdentity(null);
  await authStorage.removeItem(AUTH_KEY_STORAGE_KEY);
}
