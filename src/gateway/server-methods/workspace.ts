import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { isPathInsideWithRealpath } from "../../security/scan-paths.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWorkspaceFilesListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_LIMIT = 50;
const SKIP_NAMES = new Set(["node_modules", ".git"]);

export interface WorkspaceFileEntry {
  path: string;
  isDirectory: boolean;
}

/**
 * List files in a workspace directory with prefix filtering and security checks.
 * Exported for testability — the RPC handler delegates to this.
 */
export async function listWorkspaceFiles(opts: {
  workspaceDir: string;
  prefix?: string;
  limit?: number;
}): Promise<{ ok: true; files: WorkspaceFileEntry[] } | { ok: false; error: string }> {
  const prefix = (opts.prefix ?? "").split(String.fromCharCode(0)).join("");

  if (prefix.includes("..")) {
    return { ok: false, error: "prefix must not contain '..'" };
  }

  const lastSlash = prefix.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? prefix.slice(0, lastSlash) : "";
  const nameFilter = lastSlash >= 0 ? prefix.slice(lastSlash + 1) : prefix;

  const workspaceDir = opts.workspaceDir;
  const targetDir = dirPart ? path.resolve(workspaceDir, dirPart) : workspaceDir;

  if (!isPathInsideWithRealpath(workspaceDir, targetDir, { requireRealpath: true })) {
    return { ok: true, files: [] };
  }

  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, 200);

  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files: WorkspaceFileEntry[] = [];

    for (const entry of entries) {
      if (files.length >= limit) {
        break;
      }
      if (entry.name.startsWith(".") || SKIP_NAMES.has(entry.name)) {
        continue;
      }
      if (nameFilter && !entry.name.toLowerCase().startsWith(nameFilter.toLowerCase())) {
        continue;
      }

      const absPath = path.join(targetDir, entry.name);
      if (!isPathInsideWithRealpath(workspaceDir, absPath, { requireRealpath: true })) {
        continue;
      }

      const isDir = entry.isDirectory();
      const relPath = path.relative(workspaceDir, absPath) + (isDir ? "/" : "");
      files.push({ path: relPath, isDirectory: isDir });
    }

    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    return { ok: true, files };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { ok: true, files: [] };
    }
    return { ok: false, error: String(err) };
  }
}

export const workspaceHandlers: GatewayRequestHandlers = {
  "workspace.files.list": async ({ params, respond }) => {
    if (!validateWorkspaceFilesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspace.files.list params: ${formatValidationErrors(validateWorkspaceFilesListParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const agentId = resolveSessionAgentId({ sessionKey: params.sessionKey, config: cfg });
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

    const result = await listWorkspaceFiles({
      workspaceDir,
      prefix: params.prefix,
      limit: params.limit,
    });

    if (!result.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
      return;
    }

    respond(true, { files: result.files });
  },
};
