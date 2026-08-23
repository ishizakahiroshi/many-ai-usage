/**
 * Shared vocabulary for breakdown legend chips (Grok: "Grok Build 44% · チャット 1% · API 1%").
 *
 * Only the word list is shared. What each call site does with a match stays different on purpose:
 * picker suppresses an explicit click on a chip, read falls back to the card headline, and
 * selector demotes chips while scoring candidates. Before this module the same list was copied to
 * five places and had already drifted — scoring missed "Code Review" while everything else had it.
 */

/** Product / channel names that appear as legend chips beside a percentage. */
export const BREAKDOWN_LABEL_PATTERN = /(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー)/i;

/**
 * The chip vocabulary plus the heading a breakdown block is filed under. Used where a section
 * label is in scope (picker), not where only a chip's own text is read.
 */
export const BREAKDOWN_SECTION_PATTERN = /(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー|内訳)/i;
