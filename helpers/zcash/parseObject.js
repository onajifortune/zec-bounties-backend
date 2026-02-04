/**
 * Extracts and cleans the first JSON object block {...} from raw terminal output.
 * @param {string} rawOutput - The string captured from zingo-cli stdout.
 * @returns {Object|null} - The parsed JSON object or null if not found.
 */
function parseZingoObject(rawOutput) {
  if (!rawOutput) return null;

  // 1. Regex to find everything from the FIRST '{' to the LAST '}'
  // This handles cases where there might be text before or after the JSON.
  const jsonMatch = rawOutput.match(/\{([\s\S]*)\}/);

  if (!jsonMatch) {
    console.warn("No JSON object block found in Zingo output.");
    return null;
  }

  try {
    // 2. Clean Zingo-specific formatting:
    let cleanJson = jsonMatch[0]
      .replace(/(\d)_(\d)/g, "$1$2") // Remove underscores from numbers (29_000 -> 29000)
      .replace(/(?<!")(\b\w+\b):/g, '"$1":') // Ensure keys are double-quoted
      .replace(/,\s*}/g, "}") // Remove trailing commas before closing brace
      .replace(/,\s*]/g, "]"); // Remove trailing commas before closing bracket

    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Failed to parse Zingo Object:", error.message);
    // Return the raw match so you can at least see the text
    return { raw: jsonMatch[0] };
  }
}

module.exports = { parseZingoObject };
