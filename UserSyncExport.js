// I hope a UserSyncImport module wont be needed.
// Basically saves all your syncs to a directory for safe keeping.
(function IvLyricsUserSyncExportModule(root, factory) {
  "use strict";

  const api = factory(root || globalThis);

  if (root) {
    root.UserSyncExport = api;
  }
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createUserSyncExport(root) {
  "use strict";

  const PAGE_SIZE = 100;
  const FALLBACK_BASE_NAME = "ivLyrics-sync";

  // Spicetify subfiles share script scope: `Utils` is a top-level const, not a
  // window property. `SyncDataService`/`LyricsService` are assigned to window
  // explicitly, so both lookup styles are supported below.
  const getUtils = () => (typeof Utils !== "undefined" ? Utils : undefined);

  const getSyncDataService = () => {
    if (root?.SyncDataService) return root.SyncDataService;
    return typeof SyncDataService !== "undefined" ? SyncDataService : undefined;
  };

  const getLyricsService = () => {
    if (root?.LyricsService) return root.LyricsService;
    return typeof LyricsService !== "undefined" ? LyricsService : undefined;
  };

  const normalizeContribution = (item) => {
    if (!item || typeof item !== "object") return null;
    const trackId = String(item.trackId || "").trim();
    if (!trackId) return null;
    return {
      trackId,
      provider: String(item.provider || "").trim(),
      trackName: String(item.trackName || "").trim(),
      artists: String(item.artists || "").trim(),
    };
  };

  const defaultSanitize = (value, fallback) => {
    const utils = getUtils();
    if (utils && typeof utils.sanitizeFileName === "function") {
      return utils.sanitizeFileName(value, fallback);
    }
    return String(value || fallback || FALLBACK_BASE_NAME).replace(/[\\/:*?"<>|]/g, "-");
  };

  const buildExportFileName = (contribution, sanitize) => {
    const clean = typeof sanitize === "function" ? sanitize : defaultSanitize;
    const baseName = [contribution?.trackName, contribution?.artists]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("-");
    const fallbackBaseName = contribution?.trackId
      ? `sync-${contribution.trackId}`
      : FALLBACK_BASE_NAME;
    return `${clean(baseName, fallbackBaseName)}.json`;
  };

  const extractSyncBody = (fetched) => {
    if (!fetched || typeof fetched !== "object") return null;
    const body = fetched.syncData && typeof fetched.syncData === "object" && !Array.isArray(fetched.syncData)
      ? fetched.syncData
      : fetched;
    if (!body || !Array.isArray(body.lines) || body.lines.length === 0) return null;
    return body;
  };

  const collectAllContributions = async (fetchPage, pageSize) => {
    const limit = Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE));
    const items = [];
    const seen = new Set();
    let offset = 0;
    for (;;) {
      const page = await fetchPage(offset, limit);
      if (!Array.isArray(page) || page.length === 0) break;
      for (const entry of page) {
        const contribution = normalizeContribution(entry);
        if (!contribution) continue;
        const key = `${contribution.trackId}:${contribution.provider || "unknown"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(contribution);
      }
      if (page.length < limit) break;
      offset += limit;
    }
    return items;
  };

  const resolveOwnUserHash = () => {
    const utils = getUtils();
    if (utils && typeof utils.getUserHash === "function") {
      const hash = utils.getUserHash();
      if (hash) return hash;
    }
    const service = getLyricsService();
    if (service && typeof service.getUserHash === "function") {
      return service.getUserHash();
    }
    return "";
  };

  const listMyContributions = async () => {
    const utils = getUtils();
    if (!utils || typeof utils.fetchSyncCreatorProfile !== "function") {
      throw new Error("Creator profile API is unavailable.");
    }
    const userHash = resolveOwnUserHash();
    if (!userHash) {
      throw new Error("Cannot determine the current user.");
    }
    const fetchPage = async (offset, limit) => {
      const profile = await utils.fetchSyncCreatorProfile(userHash, { limit, offset });
      const contributions = profile?.contributions;
      return Array.isArray(contributions) ? contributions : [];
    };
    return collectAllContributions(fetchPage, PAGE_SIZE);
  };

  const fetchSyncBody = async (contribution) => {
    const service = getSyncDataService();
    if (!service || typeof service.getSyncData !== "function") {
      throw new Error("Sync data service is unavailable.");
    }
    const fetched = await service.getSyncData(
      contribution.trackId,
      contribution.provider || null,
      { trackId: contribution.trackId }
    );
    return extractSyncBody(fetched);
  };

  const uniqueFileName = (fileName, usedNames) => {
    if (!usedNames.has(fileName)) {
      usedNames.add(fileName);
      return fileName;
    }
    const dotIndex = fileName.lastIndexOf(".");
    const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";
    let counter = 2;
    let candidate = `${stem}-${counter}${extension}`;
    while (usedNames.has(candidate)) {
      counter += 1;
      candidate = `${stem}-${counter}${extension}`;
    }
    usedNames.add(candidate);
    return candidate;
  };

  const writeFileToDirectory = async (directoryHandle, fileName, text) => {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
  };

  const saveBodyAsDownload = async (fileName, text) => {
    const utils = getUtils();
    const blob = new Blob([text], { type: "application/json" });
    if (utils && typeof utils.saveBlobAs === "function") {
      await utils.saveBlobAs(blob, fileName, null);
      return;
    }
    const documentRef = root?.document;
    if (!documentRef) throw new Error("No file save method is available.");
    const url = URL.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = fileName;
    documentRef.body.appendChild(link);
    link.click();
    documentRef.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportMySyncs = async (options = {}) => {
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const contributions = await listMyContributions();
    if (contributions.length === 0) {
      const error = new Error("No synced tracks found for this user.");
      error.code = "NO_USER_SYNCS";
      throw error;
    }

    const windowRef = root;
    let directoryHandle = null;
    if (typeof options.directoryHandle !== "undefined") {
      directoryHandle = options.directoryHandle;
    } else if (windowRef && typeof windowRef.showDirectoryPicker === "function") {
      directoryHandle = await windowRef.showDirectoryPicker({ mode: "readwrite" });
    }

    const usedNames = new Set();
    let exported = 0;
    let skipped = 0;
    for (let index = 0; index < contributions.length; index += 1) {
      const contribution = contributions[index];
      onProgress?.({ current: index + 1, total: contributions.length, contribution });
      let body = null;
      try {
        body = await fetchSyncBody(contribution);
      } catch {
        body = null;
      }
      if (!body) {
        skipped += 1;
        continue;
      }
      const fileName = uniqueFileName(buildExportFileName(contribution), usedNames);
      const text = JSON.stringify(body, null, 2);
      if (directoryHandle) {
        await writeFileToDirectory(directoryHandle, fileName, text);
      } else {
        await saveBodyAsDownload(fileName, text);
      }
      exported += 1;
    }
    return { total: contributions.length, exported, skipped };
  };

  return {
    PAGE_SIZE,
    normalizeContribution,
    buildExportFileName,
    extractSyncBody,
    collectAllContributions,
    resolveOwnUserHash,
    listMyContributions,
    fetchSyncBody,
    exportMySyncs,
  };
});
