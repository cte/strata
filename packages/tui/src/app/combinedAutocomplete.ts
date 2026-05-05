import type { AutocompleteProvider, AutocompleteSuggestions } from "../editor.js";

/**
 * Tries each provider in order and returns the first non-empty suggestion set.
 */
export class CombinedAutocompleteProvider implements AutocompleteProvider {
  constructor(private readonly providers: readonly AutocompleteProvider[]) {}

  provide(text: string, cursor: number): AutocompleteSuggestions | undefined {
    for (const provider of this.providers) {
      const result = provider.provide(text, cursor);
      if (result !== undefined && result.items.length > 0) {
        return result;
      }
    }
    return undefined;
  }
}
