import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { FileRefAutocompleteProvider } from "./file-ref-autocomplete.js";

function createMockProvider(
  suggestions: { items: AutocompleteItem[]; prefix: string } | null,
): AutocompleteProvider {
  return {
    getSuggestions: () => suggestions,
    applyCompletion: (_lines, _cursorLine, _cursorCol, item, _prefix) => ({
      lines: [item.value],
      cursorLine: 0,
      cursorCol: item.value.length,
    }),
  };
}

describe("FileRefAutocompleteProvider", () => {
  describe("getSuggestions", () => {
    it("transforms @ prefix to @file prefix", () => {
      const inner = createMockProvider({
        items: [{ value: "@src/main.ts", label: "main.ts" }],
        prefix: "@src",
      });
      const provider = new FileRefAutocompleteProvider(inner);
      const result = provider.getSuggestions(["@src"], 0, 4);
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe("@file src");
      expect(result!.items[0].value).toBe("@file src/main.ts");
    });

    it("passes through slash command completions unchanged", () => {
      const inner = createMockProvider({
        items: [{ value: "help", label: "help" }],
        prefix: "/hel",
      });
      const provider = new FileRefAutocompleteProvider(inner);
      const result = provider.getSuggestions(["/hel"], 0, 4);
      expect(result!.prefix).toBe("/hel");
      expect(result!.items[0].value).toBe("help");
    });

    it("returns null when inner returns null", () => {
      const inner = createMockProvider(null);
      const provider = new FileRefAutocompleteProvider(inner);
      expect(provider.getSuggestions(["hello"], 0, 5)).toBeNull();
    });

    it("handles directory completions", () => {
      const inner = createMockProvider({
        items: [{ value: "@src/", label: "src/" }],
        prefix: "@sr",
      });
      const provider = new FileRefAutocompleteProvider(inner);
      const result = provider.getSuggestions(["@sr"], 0, 3);
      expect(result!.items[0].value).toBe("@file src/");
    });
  });

  describe("applyCompletion", () => {
    it("applies @file completion with trailing space for files", () => {
      const inner = createMockProvider(null);
      const provider = new FileRefAutocompleteProvider(inner);
      // Editor still has original "@src" text; prefix was inflated by getSuggestions
      const result = provider.applyCompletion(
        ["check @src"],
        0,
        10,
        { value: "@file src/main.ts", label: "main.ts" },
        "@file src",
      );
      expect(result.lines[0]).toBe("check @file src/main.ts ");
      expect(result.cursorCol).toBe(24); // after the trailing space
    });

    it("applies @file completion without trailing space for directories", () => {
      const inner = createMockProvider(null);
      const provider = new FileRefAutocompleteProvider(inner);
      // Editor still has original "@sr" text
      const result = provider.applyCompletion(
        ["@sr"],
        0,
        3,
        { value: "@file src/", label: "src/" },
        "@file sr",
      );
      expect(result.lines[0]).toBe("@file src/");
      expect(result.cursorCol).toBe(10); // at end, no space
    });

    it("delegates non-@file completions to inner provider", () => {
      const inner = createMockProvider(null);
      const provider = new FileRefAutocompleteProvider(inner);
      const result = provider.applyCompletion(
        ["/hel"],
        0,
        4,
        { value: "help", label: "help" },
        "/hel",
      );
      // Inner mock just returns [item.value]
      expect(result.lines[0]).toBe("help");
    });
  });
});
