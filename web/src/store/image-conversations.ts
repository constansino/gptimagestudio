"use client";

import localforage from "localforage";

import {
  fetchConfig,
  type ImageModel,
  type ImageQuality,
  type ImageResolutionAccess,
  type ImageTaskLogEntry,
  type InpaintSourceReference,
} from "@/lib/api";
import webConfig from "@/constants/common-env";
import { httpRequest } from "@/lib/request";
import {
  getStoredAuthIdentity,
  getStoredAuthIdentitySync,
  type StoredAuthIdentity,
} from "@/store/auth";

export type ImageMode = "generate" | "edit";

export type StoredSourceImage = {
  id: string;
  role: "image" | "mask";
  name: string;
  dataUrl?: string;
  url?: string;
};

export type StoredImage = {
  id: string;
  status?: "loading" | "success" | "error";
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  file_id?: string;
  gen_id?: string;
  conversation_id?: string;
  parent_message_id?: string;
  source_account_id?: string;
  error?: string;
};

export type ImageConversationStatus =
  | "queued"
  | "running"
  | "generating"
  | "success"
  | "error"
  | "cancelled";

export type ImageConversationTurn = {
  id: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  count: number;
  parallel?: number;
  size?: string;
  resolutionAccess?: ImageResolutionAccess;
  quality?: ImageQuality;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  sourceReference?: InpaintSourceReference;
  images: StoredImage[];
  createdAt: string;
  status: ImageConversationStatus;
  error?: string;
  taskId?: string;
  queuePosition?: number;
  waitingReason?: string;
  waitingDetail?: string;
  waitingSince?: string;
  startedAt?: string;
  finishedAt?: string;
  taskLogs?: ImageTaskLogEntry[];
  cancelRequested?: boolean;
};

export type ImageConversation = {
  id: string;
  title: string;
  mode: ImageMode;
  prompt: string;
  model: ImageModel;
  count: number;
  parallel?: number;
  size?: string;
  resolutionAccess?: ImageResolutionAccess;
  quality?: ImageQuality;
  scale?: string;
  sourceImages?: StoredSourceImage[];
  images: StoredImage[];
  createdAt: string;
  status: ImageConversationStatus;
  error?: string;
  turns?: ImageConversationTurn[];
};

export type ImageConversationStorageMode = "browser" | "server";

const imageConversationStorage = localforage.createInstance({
  name: "chatgpt2api-studio",
  storeName: "image_conversations",
});

const LEGACY_IMAGE_CONVERSATIONS_KEY = "items";
const IMAGE_CONVERSATION_STORAGE_MODE_KEY =
  "chatgpt2api:image-conversation-storage-mode";
const SHARED_EXAMPLES_SEEDED_KEY = "items:shared-examples-seeded";
let cachedConversations: ImageConversation[] | null = null;
let cachedConversationsStorageMode: ImageConversationStorageMode | null = null;
let cachedConversationsScope: string | null = null;
let loadPromise: Promise<ImageConversation[]> | null = null;
let loadPromiseScope: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let cachedImageConversationStorageMode: "browser" | "server" | null =
  readPersistedImageConversationStorageMode();
let cachedImageConversationStorageModeScope: string | null =
  getCurrentConversationScopeSync();

function sortConversations(items: ImageConversation[]) {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sanitizeStorageScope(value: string) {
  return String(value || "anonymous")
    .trim()
    .replace(/[^a-zA-Z0-9:_.-]/g, "_");
}

function imageConversationsKeyForScope(scope: string) {
  return `${LEGACY_IMAGE_CONVERSATIONS_KEY}:${sanitizeStorageScope(scope)}`;
}

function storageModeKeyForScope(scope: string | null) {
  return scope
    ? `${IMAGE_CONVERSATION_STORAGE_MODE_KEY}:${sanitizeStorageScope(scope)}`
    : IMAGE_CONVERSATION_STORAGE_MODE_KEY;
}

function getCurrentConversationScopeSync() {
  return getStoredAuthIdentitySync()?.scope ?? null;
}

async function getCurrentAuthIdentity(): Promise<StoredAuthIdentity | null> {
  return getStoredAuthIdentity();
}

async function getCurrentConversationScope() {
  return (await getCurrentAuthIdentity())?.scope ?? "anonymous";
}

function mergeConversationLists(
  sharedItems: ImageConversation[],
  scopedItems: ImageConversation[],
) {
  const merged = new Map<string, ImageConversation>();
  sharedItems.map(normalizeConversation).forEach((item) => {
    merged.set(item.id, item);
  });
  scopedItems.map(normalizeConversation).forEach((item) => {
    merged.set(item.id, item);
  });
  return sortConversations([...merged.values()]);
}

function hasSeededSharedExamples(scope: string) {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return (
      window.localStorage.getItem(
        `${SHARED_EXAMPLES_SEEDED_KEY}:${sanitizeStorageScope(scope)}`,
      ) === "1"
    );
  } catch {
    return true;
  }
}

function markSharedExamplesSeeded(scope: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      `${SHARED_EXAMPLES_SEEDED_KEY}:${sanitizeStorageScope(scope)}`,
      "1",
    );
  } catch {
    // Ignore localStorage write failures.
  }
}

function readPersistedImageConversationStorageMode(
  scope = getCurrentConversationScopeSync(),
): ImageConversationStorageMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(
      storageModeKeyForScope(scope),
    );
    return raw === "server" ? "server" : raw === "browser" ? "browser" : null;
  } catch {
    return null;
  }
}

function persistImageConversationStorageMode(
  mode: ImageConversationStorageMode | null,
  scope = getCurrentConversationScopeSync(),
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const key = storageModeKeyForScope(scope);
    if (mode) {
      window.localStorage.setItem(key, mode);
      return;
    }
    window.localStorage.removeItem(key);
  } catch {
    // Ignore localStorage write failures and keep using in-memory state.
  }
}

async function loadConversationCache(): Promise<ImageConversation[]> {
  const identity = await getCurrentAuthIdentity();
  const scope = identity?.scope ?? "anonymous";
  const storageKey = imageConversationsKeyForScope(scope);

  if (
    cachedConversations &&
    cachedConversationsStorageMode === "browser" &&
    cachedConversationsScope === scope
  ) {
    return cachedConversations;
  }

  if (!loadPromise || loadPromiseScope !== scope) {
    loadPromiseScope = scope;
    loadPromise = (async () => {
      const scopedItems =
        (await imageConversationStorage.getItem<ImageConversation[]>(
          storageKey,
        )) || [];
      let sharedItems =
        (await imageConversationStorage.getItem<ImageConversation[]>(
          LEGACY_IMAGE_CONVERSATIONS_KEY,
        )) || [];

      if (
        sharedItems.length === 0 &&
        scopedItems.length > 0 &&
        identity?.isAdmin &&
        !hasSeededSharedExamples(scope)
      ) {
        sharedItems = scopedItems;
        await imageConversationStorage.setItem(
          LEGACY_IMAGE_CONVERSATIONS_KEY,
          sharedItems,
        );
        markSharedExamplesSeeded(scope);
      }
      cachedConversations = mergeConversationLists(sharedItems, scopedItems);
      cachedConversationsStorageMode = "browser";
      cachedConversationsScope = scope;
      return cachedConversations;
    })().finally(() => {
      if (loadPromiseScope === scope) {
        loadPromise = null;
        loadPromiseScope = null;
      }
      });
  }

  return loadPromise;
}

export function getCachedImageConversationsSnapshot():
  | ImageConversation[]
  | null {
  if (!cachedConversations) {
    return null;
  }
  const currentScope = getCurrentConversationScopeSync();
  if (!currentScope || cachedConversationsScope !== currentScope) {
    return null;
  }
  if (!cachedImageConversationStorageMode) {
    return null;
  }
  if (
    cachedConversationsStorageMode &&
    cachedImageConversationStorageMode &&
    cachedConversationsStorageMode !== cachedImageConversationStorageMode
  ) {
    return null;
  }
  return sortConversations(cachedConversations.map(normalizeConversation));
}

function setCachedConversationsSnapshot(
  items: ImageConversation[],
  storageMode: ImageConversationStorageMode,
  scope = getCurrentConversationScopeSync() ?? "anonymous",
) {
  cachedConversations = sortConversations(items.map(normalizeConversation));
  cachedConversationsStorageMode = storageMode;
  cachedConversationsScope = scope;
  return cachedConversations;
}

export function setCachedImageConversationStorageMode(
  mode: ImageConversationStorageMode | null,
) {
  const scope = getCurrentConversationScopeSync();
  cachedImageConversationStorageMode = mode;
  cachedImageConversationStorageModeScope = scope;
  persistImageConversationStorageMode(mode, scope);
}

async function persistConversationCache() {
  const scope = await getCurrentConversationScope();
  const storageKey = imageConversationsKeyForScope(scope);
  const snapshot = sortConversations(
    (cachedConversations || []).map(normalizeConversation),
  );
  cachedConversations = snapshot;
  cachedConversationsStorageMode = "browser";
  cachedConversationsScope = scope;
  writeQueue = writeQueue.then(async () => {
    await imageConversationStorage.setItem(storageKey, snapshot);
  });
  await writeQueue;
}

function normalizeStorageMode(
  value: string | null | undefined,
): ImageConversationStorageMode {
  return value === "server" ? "server" : "browser";
}

function toAbsoluteImageURL(raw: string | undefined) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^(data:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  const base = webConfig.apiUrl.replace(/\/$/, "");
  return `${base}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

async function blobToDataURL(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

async function imageURLToDataURL(raw: string) {
  const response = await fetch(toAbsoluteImageURL(raw));
  if (!response.ok) {
    throw new Error(`读取图片失败 (${response.status})`);
  }
  const blob = await response.blob();
  return blobToDataURL(blob);
}

async function materializeConversationImagesForBrowser(
  conversation: ImageConversation,
): Promise<ImageConversation> {
  const materializedTurns = await Promise.all(
    (conversation.turns || []).map(async (turn) => {
      const sourceImages = await Promise.all(
        (turn.sourceImages || []).map(async (source) => {
          if (source.dataUrl || !source.url) {
            return source;
          }
          return {
            ...source,
            dataUrl: await imageURLToDataURL(source.url),
          };
        }),
      );
      const images = await Promise.all(
        (turn.images || []).map(async (image) => {
          if (image.b64_json || !image.url) {
            return image;
          }
          const dataUrl = await imageURLToDataURL(image.url);
          const commaIndex = dataUrl.indexOf(",");
          return {
            ...image,
            b64_json: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : "",
          };
        }),
      );
      return normalizeTurn({
        ...turn,
        sourceImages,
        images,
      });
    }),
  );
  return normalizeConversation({
    ...conversation,
    turns: materializedTurns,
  });
}

function normalizeStoredImage(image: StoredImage): StoredImage {
  if (
    image.status === "loading" ||
    image.status === "error" ||
    image.status === "success"
  ) {
    return image;
  }
  return {
    ...image,
    status: image.b64_json || image.url ? "success" : "loading",
  };
}

function normalizeImageQuality(
  value: ImageConversationTurn["quality"],
): ImageQuality | undefined {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : undefined;
}

function normalizeResolutionAccess(
  value: ImageConversationTurn["resolutionAccess"],
): ImageResolutionAccess | undefined {
  return value === "free" || value === "paid" ? value : undefined;
}

function normalizeImageMode(value: unknown): ImageMode {
  // Keep old local history readable after the deprecated upscale mode was removed.
  return value === "edit" || value === "upscale" ? "edit" : "generate";
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeTurn(turn: ImageConversationTurn): ImageConversationTurn {
  return {
    ...turn,
    mode: normalizeImageMode(turn.mode),
    parallel: normalizeOptionalPositiveInteger(turn.parallel),
    resolutionAccess: normalizeResolutionAccess(turn.resolutionAccess),
    quality: normalizeImageQuality(turn.quality),
    sourceImages: Array.isArray(turn.sourceImages) ? turn.sourceImages : [],
    sourceReference: normalizeSourceReference(turn.sourceReference),
    images: (turn.images || []).map(normalizeStoredImage),
    status:
      turn.status === "queued" ||
      turn.status === "running" ||
      turn.status === "generating" ||
      turn.status === "success" ||
      turn.status === "error" ||
      turn.status === "cancelled"
        ? turn.status
        : "success",
  };
}

function normalizeSourceReference(
  value: ImageConversationTurn["sourceReference"],
): InpaintSourceReference | undefined {
  if (!value) {
    return undefined;
  }
  const originalFileID = String(value.original_file_id || "").trim();
  const originalGenID = String(value.original_gen_id || "").trim();
  const sourceAccountID = String(value.source_account_id || "").trim();
  if (!originalFileID || !originalGenID || !sourceAccountID) {
    return undefined;
  }
  const conversationID = String(value.conversation_id || "").trim();
  const parentMessageID = String(value.parent_message_id || "").trim();
  return {
    original_file_id: originalFileID,
    original_gen_id: originalGenID,
    conversation_id: conversationID || undefined,
    parent_message_id: parentMessageID || undefined,
    source_account_id: sourceAccountID,
  };
}

export function normalizeConversation(
  conversation: ImageConversation,
): ImageConversation {
  const turns =
    Array.isArray(conversation.turns) && conversation.turns.length > 0
      ? conversation.turns.map(normalizeTurn)
      : [
          normalizeTurn({
            id: `${conversation.id}-legacy`,
            title: conversation.title,
            mode: normalizeImageMode(conversation.mode),
            prompt: conversation.prompt,
            model: conversation.model,
            count: conversation.count,
            parallel: conversation.parallel,
            size: conversation.size,
            resolutionAccess: conversation.resolutionAccess,
            quality: conversation.quality,
            scale: conversation.scale,
            sourceImages: conversation.sourceImages,
            images: conversation.images || [],
            createdAt: conversation.createdAt,
            status: conversation.status,
            error: conversation.error,
          }),
        ];

  const latestTurn = turns[turns.length - 1];
  return {
    ...conversation,
    title: latestTurn.title,
    mode: latestTurn.mode,
    prompt: latestTurn.prompt,
    model: latestTurn.model,
    count: latestTurn.count,
    parallel: latestTurn.parallel,
    size: latestTurn.size,
    resolutionAccess: latestTurn.resolutionAccess,
    quality: latestTurn.quality,
    scale: latestTurn.scale,
    sourceImages: latestTurn.sourceImages,
    images: latestTurn.images,
    createdAt: latestTurn.createdAt,
    status: latestTurn.status,
    error: latestTurn.error,
    turns,
  };
}

async function getImageConversationStorageMode() {
  const scope = await getCurrentConversationScope();
  if (
    cachedImageConversationStorageMode &&
    cachedImageConversationStorageModeScope === scope
  ) {
    return cachedImageConversationStorageMode;
  }
  const persistedMode = readPersistedImageConversationStorageMode(scope);
  if (persistedMode) {
    cachedImageConversationStorageMode = persistedMode;
    cachedImageConversationStorageModeScope = scope;
    return persistedMode;
  }
  try {
    const config = await fetchConfig();
    const mode =
      config.storage.imageConversationStorage === "server"
        ? "server"
        : "browser";
    cachedImageConversationStorageMode = mode;
    cachedImageConversationStorageModeScope = scope;
    persistImageConversationStorageMode(mode, scope);
    return mode;
  } catch (error) {
    if (
      cachedImageConversationStorageMode &&
      cachedImageConversationStorageModeScope === scope
    ) {
      return cachedImageConversationStorageMode;
    }
    cachedImageConversationStorageMode = "browser";
    cachedImageConversationStorageModeScope = scope;
    persistImageConversationStorageMode("browser", scope);
    return "browser";
  }
}

async function listServerImageConversations(): Promise<ImageConversation[]> {
  const data = await httpRequest<{ items: ImageConversation[] }>(
    "/api/image/conversations",
  );
  return setCachedConversationsSnapshot(data.items || [], "server");
}

export async function listServerImageConversationsSnapshot(): Promise<
  ImageConversation[]
> {
  return listServerImageConversations();
}

async function getServerImageConversation(
  id: string,
): Promise<ImageConversation | null> {
  try {
    const data = await httpRequest<{ item: ImageConversation }>(
      `/api/image/conversations/${encodeURIComponent(id)}`,
    );
    return data.item ? normalizeConversation(data.item) : null;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function saveServerImageConversation(
  conversation: ImageConversation,
): Promise<ImageConversation> {
  const normalized = normalizeConversation(conversation);
  const data = await httpRequest<{ item: ImageConversation }>(
    `/api/image/conversations/${encodeURIComponent(normalized.id)}`,
    {
      method: "PUT",
      body: normalized,
    },
  );
  const savedConversation = normalizeConversation(data.item);
  const currentItems =
    cachedConversationsStorageMode === "server" && cachedConversations
      ? cachedConversations
      : [];
  setCachedConversationsSnapshot(
    [
      savedConversation,
      ...currentItems.filter((item) => item.id !== savedConversation.id),
    ],
    "server",
  );
  return savedConversation;
}

export async function exportLocalImageConversationsSnapshot(): Promise<
  ImageConversation[]
> {
  const items = await loadConversationCache();
  return sortConversations(items.map(normalizeConversation));
}

export async function replaceLocalImageConversations(
  items: ImageConversation[],
): Promise<void> {
  setCachedConversationsSnapshot(items, "browser");
  await persistConversationCache();
}

export async function exportServerImageConversationsSnapshot(): Promise<
  ImageConversation[]
> {
  return listServerImageConversations();
}

export async function importServerImageConversations(
  items: ImageConversation[],
): Promise<void> {
  for (const item of items) {
    await saveServerImageConversation(item);
  }
}

export async function importImageConversationsToServerTarget(
  items: ImageConversation[],
  storage: {
    backend: string;
    imageDir: string;
    sqlitePath: string;
    redisAddr: string;
    redisPassword: string;
    redisDb: number;
    redisPrefix: string;
    imageConversationStorage: "browser" | "server" | string;
    imageDataStorage: "browser" | "server" | string;
  },
): Promise<void> {
  await httpRequest("/api/image/conversations/import", {
    method: "POST",
    body: {
      items,
      storage,
    },
  });
}

export async function migrateImageConversationStorage(options: {
  from: ImageConversationStorageMode;
  to: ImageConversationStorageMode;
  targetImageDataStorage: "browser" | "server";
  sourceItems?: ImageConversation[];
}): Promise<{ migrated: number }> {
  const from = normalizeStorageMode(options.from);
  const to = normalizeStorageMode(options.to);
  if (from === to) {
    return { migrated: 0 };
  }

  const sourceItems =
    options.sourceItems ??
    (from === "server"
      ? await exportServerImageConversationsSnapshot()
      : await exportLocalImageConversationsSnapshot());

  if (sourceItems.length === 0) {
    if (to === "browser") {
      await replaceLocalImageConversations([]);
    }
    return { migrated: 0 };
  }

  if (to === "server") {
    await importServerImageConversations(sourceItems);
    return { migrated: sourceItems.length };
  }

  const nextItems =
    options.targetImageDataStorage === "browser"
      ? await Promise.all(
          sourceItems.map((item) =>
            materializeConversationImagesForBrowser(item),
          ),
        )
      : sourceItems.map(normalizeConversation);
  await replaceLocalImageConversations(nextItems);
  return { migrated: nextItems.length };
}

export async function listImageConversations(): Promise<ImageConversation[]> {
  if ((await getImageConversationStorageMode()) === "server") {
    return listServerImageConversations();
  }
  const items = await loadConversationCache();
  return sortConversations(items.map(normalizeConversation));
}

export async function getImageConversation(
  id: string,
): Promise<ImageConversation | null> {
  if ((await getImageConversationStorageMode()) === "server") {
    return getServerImageConversation(id);
  }
  const items = await loadConversationCache();
  return items.find((item) => item.id === id) ?? null;
}

export async function saveImageConversation(
  conversation: ImageConversation,
): Promise<void> {
  if ((await getImageConversationStorageMode()) === "server") {
    await saveServerImageConversation(conversation);
    return;
  }
  const items = await loadConversationCache();
  cachedConversations = sortConversations([
    normalizeConversation(conversation),
    ...items.filter((item) => item.id !== conversation.id),
  ]);
  await persistConversationCache();
}

export async function updateImageConversation(
  id: string,
  updater: (current: ImageConversation | null) => ImageConversation,
): Promise<ImageConversation> {
  if ((await getImageConversationStorageMode()) === "server") {
    const current = await getServerImageConversation(id);
    return saveServerImageConversation(updater(current));
  }
  const items = await loadConversationCache();
  const current = items.find((item) => item.id === id) ?? null;
  const nextConversation = normalizeConversation(updater(current));
  cachedConversations = sortConversations([
    nextConversation,
    ...items.filter((item) => item.id !== id),
  ]);
  await persistConversationCache();
  return nextConversation;
}

export async function deleteImageConversation(id: string): Promise<void> {
  if ((await getImageConversationStorageMode()) === "server") {
    await httpRequest(`/api/image/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (cachedConversationsStorageMode === "server" && cachedConversations) {
      setCachedConversationsSnapshot(
        cachedConversations.filter((item) => item.id !== id),
        "server",
      );
    }
    return;
  }
  const items = await loadConversationCache();
  cachedConversations = items.filter((item) => item.id !== id);
  await persistConversationCache();
}

export async function clearImageConversations(): Promise<void> {
  if ((await getImageConversationStorageMode()) === "server") {
    await httpRequest("/api/image/conversations", { method: "DELETE" });
    setCachedConversationsSnapshot([], "server");
    return;
  }
  const identity = await getCurrentAuthIdentity();
  const scope = identity?.scope ?? "anonymous";
  const storageKey = imageConversationsKeyForScope(scope);
  cachedConversations = [];
  cachedConversationsStorageMode = "browser";
  cachedConversationsScope = scope;
  loadPromise = null;
  loadPromiseScope = null;
  writeQueue = writeQueue.then(async () => {
    await imageConversationStorage.removeItem(storageKey);
  });
  await writeQueue;
}
