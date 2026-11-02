/**
 * localStorage keys that belong to the app's "config" and are therefore
 * included in config export / import. Only UI preferences live here — the
 * accounts and the MCP switch are stored by the main process.
 */
export const UI_PREF_KEYS = ['gm.relColWidth', 'gm.runsColWidth'] as const

export type UiPrefKey = (typeof UI_PREF_KEYS)[number]