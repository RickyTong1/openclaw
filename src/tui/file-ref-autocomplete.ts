/**
 * Wraps CombinedAutocompleteProvider to transform @path completions into @file path format.
 *
 * pi-tui's built-in @ completion outputs `@path/to/file`.
 * We transform this to `@file path/to/file` for unambiguous file reference syntax.
 */

import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { FILE_REF_PREFIX } from "../gateway/chat-file-refs.js";

/**
 * Wraps a provider to rewrite `@<path>` completions to `@file <path>`.
 * Slash commands and plain path completions pass through unchanged.
 */
export class FileRefAutocompleteProvider implements AutocompleteProvider {
  constructor(private inner: AutocompleteProvider) {}

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): { items: AutocompleteItem[]; prefix: string } | null {
    const result = this.inner.getSuggestions(lines, cursorLine, cursorCol);
    if (!result) {
      return null;
    }

    // Detect @ file completions: prefix starts with @ but not /
    if (result.prefix.startsWith("@") && !result.prefix.startsWith("/")) {
      return {
        items: result.items.map((item) => ({
          ...item,
          // Transform @path → @file path
          value: item.value.startsWith("@")
            ? `${FILE_REF_PREFIX} ${item.value.slice(1)}`
            : item.value,
        })),
        // Transform prefix: @query → @file query
        prefix: `${FILE_REF_PREFIX} ${result.prefix.slice(1)}`,
      };
    }

    return result;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    // For @file completions, do simple text replacement.
    // The prefix was inflated from "@<query>" to "@file <query>" by getSuggestions,
    // but the editor line still contains the original "@<query>" text.
    // Recover the original prefix length: "@" (1 char) vs "@file " (6 chars) = 5 extra.
    if (prefix.startsWith(FILE_REF_PREFIX)) {
      const currentLine = lines[cursorLine] || "";
      const originalPrefixLen = prefix.length - FILE_REF_PREFIX.length;
      const beforePrefix = currentLine.slice(0, cursorCol - originalPrefixLen);
      const afterCursor = currentLine.slice(cursorCol);
      const isDirectory = item.label.endsWith("/");
      const suffix = isDirectory ? "" : " ";
      const newLine = `${beforePrefix}${item.value}${suffix}${afterCursor}`;
      const newLines = [...lines];
      newLines[cursorLine] = newLine;
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + suffix.length,
      };
    }

    // Delegate non-@file completions to inner provider
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }
}
