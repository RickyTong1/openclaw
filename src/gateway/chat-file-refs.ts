/**
 * @file references: parse `@file <path>` from message text, read workspace files,
 * and format content for agent prompt injection.
 *
 * Security: all file reads go through openBoundaryFileSync with workspace boundary checks.
 */

import fs from "node:fs";
import path from "node:path";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import { isPathInsideWithRealpath } from "../security/scan-paths.js";

// ============================================================================
// Constants
// ============================================================================

export const FILE_REF_PREFIX = "@file";
const FILE_REF_PATTERN = /(?:^|\s)@file\s+(\S+)/g;
const DEFAULT_MAX_FILE_BYTES = 100 * 1024; // 100KB per file
const DEFAULT_MAX_TOTAL_BYTES = 500 * 1024; // 500KB total
const DEFAULT_MAX_FILES = 10;

// ============================================================================
// Types
// ============================================================================

export type ChatFileRef = {
  path: string;
  resolvedPath: string;
  content: string;
  sizeBytes: number;
};

export type FileRefResolutionResult =
  | { ok: true; refs: ChatFileRef[] }
  | { ok: false; error: string; failedPath: string };

export type ResolveFileReferencesParams = {
  paths: string[];
  workspaceDir: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
  /** When true, error messages omit resolved absolute paths (for channel safety). */
  redactPaths?: boolean;
};

// ============================================================================
// Parse
// ============================================================================

/** Extract `@file <path>` references from message text. Returns deduplicated paths. */
export function parseFileRefsFromMessage(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(FILE_REF_PATTERN)) {
    const filePath = match[1];
    if (!seen.has(filePath)) {
      seen.add(filePath);
      refs.push(filePath);
    }
  }
  return refs;
}

/** Strip all `@file <path>` references from message text. */
export function stripFileRefsFromMessage(text: string): string {
  return text
    .replace(/(?:^|\s)@file\s+\S+/g, "")
    .replace(/  +/g, " ")
    .trim();
}

// ============================================================================
// Resolve
// ============================================================================

/** Read files from workspace with full security checks. */
export function resolveFileReferences(
  params: ResolveFileReferencesParams,
): FileRefResolutionResult {
  const {
    paths,
    workspaceDir,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    redactPaths = false,
  } = params;

  if (paths.length > maxFiles) {
    return {
      ok: false,
      error: `too many file references (${paths.length}), maximum is ${maxFiles}`,
      failedPath: paths[maxFiles],
    };
  }

  const refs: ChatFileRef[] = [];
  let totalBytes = 0;

  for (const filePath of paths) {
    if (!filePath || filePath.includes("\0")) {
      return { ok: false, error: "invalid file path", failedPath: filePath };
    }

    const absolutePath = path.resolve(workspaceDir, filePath);

    // Boundary check: must stay inside workspace.
    // requireRealpath=true ensures we reject when realpath fails (broken symlink, ELOOP, etc.)
    // rather than defaulting to allow.
    if (!isPathInsideWithRealpath(workspaceDir, absolutePath, { requireRealpath: true })) {
      return {
        ok: false,
        error: redactPaths
          ? "file not accessible"
          : `file reference escapes workspace: ${filePath}`,
        failedPath: filePath,
      };
    }

    const opened = openBoundaryFileSync({
      absolutePath,
      rootPath: workspaceDir,
      boundaryLabel: "@file",
      maxBytes: maxFileBytes,
      rejectHardlinks: true,
    });

    if (!opened.ok) {
      return {
        ok: false,
        error: redactPaths ? "file not accessible" : `cannot read file: ${filePath}`,
        failedPath: filePath,
      };
    }

    let content: string;
    try {
      content = fs.readFileSync(opened.fd, "utf-8");
    } catch {
      return {
        ok: false,
        error: redactPaths ? "file not accessible" : `failed to read file: ${filePath}`,
        failedPath: filePath,
      };
    } finally {
      fs.closeSync(opened.fd);
    }

    // Reject binary content: check for null bytes in the entire content
    if (content.includes("\0")) {
      return {
        ok: false,
        error: redactPaths ? "file not accessible" : `binary file not supported: ${filePath}`,
        failedPath: filePath,
      };
    }

    const sizeBytes = Buffer.byteLength(content, "utf-8");
    totalBytes += sizeBytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        error: `total file size exceeds limit (${Math.round(maxTotalBytes / 1024)}KB)`,
        failedPath: filePath,
      };
    }

    refs.push({
      path: filePath,
      resolvedPath: absolutePath,
      content,
      sizeBytes,
    });
  }

  return { ok: true, refs };
}

// ============================================================================
// Format
// ============================================================================

/** Format resolved file refs as an XML block for agent prompt injection. */
export function formatFileRefsForPrompt(refs: ChatFileRef[]): string {
  if (refs.length === 0) {
    return "";
  }
  const blocks = refs.map(
    (ref) =>
      `<file path="${escapeXmlAttr(ref.path)}">\n<![CDATA[${escapeCdata(ref.content)}]]>\n</file>`,
  );
  return `<attached_files>\n${blocks.join("\n")}\n</attached_files>`;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape CDATA end delimiter inside content so it cannot break out of a CDATA section. */
function escapeCdata(s: string): string {
  return s.replace(/]]>/g, "]]]]><![CDATA[>");
}
