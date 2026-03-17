import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listWorkspaceFiles } from "./workspace.js";

describe("listWorkspaceFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-files-test-"));
    // Create test structure:
    //   src/
    //     main.ts
    //     gateway/
    //       server.ts
    //   README.md
    //   .hidden/
    //     secret.txt
    //   node_modules/
    //     pkg/
    //   dist/
    //     out.js
    fs.mkdirSync(path.join(tmpDir, "src", "gateway"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "export {}");
    fs.writeFileSync(path.join(tmpDir, "src", "gateway", "server.ts"), "export {}");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# test");
    fs.mkdirSync(path.join(tmpDir, ".hidden"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".hidden", "secret.txt"), "secret");
    fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "dist", "out.js"), "");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists root files and directories", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/");
    expect(paths).toContain("dist/");
    expect(paths).toContain("README.md");
  });

  it("excludes hidden directories", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain(".hidden/");
  });

  it("excludes node_modules and .git", async () => {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.files.map((f) => f.path);
    expect(paths).not.toContain("node_modules/");
    expect(paths).not.toContain(".git/");
  });

  it("filters by prefix", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, prefix: "sr" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/");
    expect(result.files[0].isDirectory).toBe(true);
  });

  it("lists subdirectory with prefix containing slash", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, prefix: "src/" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("src/gateway/");
    expect(paths).toContain("src/main.ts");
  });

  it("filters subdirectory by name prefix", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, prefix: "src/ga" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("src/gateway/");
  });

  it("rejects path traversal in prefix", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, prefix: "../etc" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("..");
  });

  it("strips null bytes from prefix", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, prefix: "sr\0c" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // "sr\0c" → "src" after null strip → should match "src/"
    // Actually "sr" + "c" = "src" which doesn't match "src" because filter is "src" vs startsWith check
    // The null is stripped: "sr\0c" → "src", nameFilter = "src", should match "src"
    expect(result.files.some((f) => f.path === "src/")).toBe(true);
  });

  it("returns empty for nonexistent directory", async () => {
    const result = await listWorkspaceFiles({
      workspaceDir: tmpDir,
      prefix: "nonexistent/sub",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toEqual([]);
  });

  it("enforces limit", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir, limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files.length).toBeLessThanOrEqual(1);
  });

  it("sorts directories before files", async () => {
    const result = await listWorkspaceFiles({ workspaceDir: tmpDir });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const dirIdx = result.files.findIndex((f) => f.isDirectory);
    const fileIdx = result.files.findIndex((f) => !f.isDirectory);
    if (dirIdx >= 0 && fileIdx >= 0) {
      expect(dirIdx).toBeLessThan(fileIdx);
    }
  });

  it("rejects symlinks escaping workspace", async () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-outside-"));
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "escaped");
    try {
      fs.symlinkSync(outsideDir, path.join(tmpDir, "escape-link"));
      const result = await listWorkspaceFiles({ workspaceDir: tmpDir });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const paths = result.files.map((f) => f.path);
      expect(paths).not.toContain("escape-link/");
      expect(paths).not.toContain("escape-link");
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
