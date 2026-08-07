import { readFile } from "node:fs/promises";
import path from "node:path";

const JSON_WHITESPACE = /[\u0009\u000a\u000d\u0020]/u;
const JSON_VALUE_DELIMITER = /[\u0009\u000a\u000d\u0020,}\]]/u;

export const STRICT_JSON_ERROR_CODES = Object.freeze({
  INPUT_TYPE: "ERR_STRICT_JSON_INPUT_TYPE",
  LABEL_TYPE: "ERR_STRICT_JSON_LABEL_TYPE",
  SYNTAX: "ERR_STRICT_JSON_SYNTAX",
  DUPLICATE_KEY: "ERR_STRICT_JSON_DUPLICATE_KEY",
  LONE_SURROGATE: "ERR_STRICT_JSON_LONE_SURROGATE",
});

/**
 * Stable parse failure for strict JSON inputs.
 *
 * The class remains a SyntaxError so existing callers that catch JSON parse
 * failures keep working. `code` is the machine contract; `message` is for
 * diagnostics and may include the caller-provided label.
 */
export class StrictJsonError extends SyntaxError {
  constructor(code, message, { label, offset = null, cause } = {}) {
    super(message);
    this.name = "StrictJsonError";
    this.code = code;
    this.label = label;
    this.offset = offset;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, label, message, offset = null, cause) {
  throw new StrictJsonError(code, `${label} ${message}`, { label, offset, cause });
}

function assertNoLoneSurrogate(value, label, offset) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) {
        fail(
          STRICT_JSON_ERROR_CODES.LONE_SURROGATE,
          label,
          "contains a lone surrogate in a JSON string",
          offset,
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail(
        STRICT_JSON_ERROR_CODES.LONE_SURROGATE,
        label,
        "contains a lone surrogate in a JSON string",
        offset,
      );
    }
  }
}

/**
 * Parses a JSON text while enforcing the subset required by JCS/I-JSON
 * cryptographic contracts.
 *
 * In addition to JSON syntax, this rejects decoded duplicate object keys,
 * lone UTF-16 surrogates. Number parsing intentionally remains identical to
 * JSON.parse; each signed contract applies its own schema and JCS checks after
 * this lexical boundary.
 */
export function parseJsonRejectingDuplicateKeys(text, label = "JSON") {
  if (typeof text !== "string") {
    fail(
      STRICT_JSON_ERROR_CODES.INPUT_TYPE,
      "JSON",
      "input must be a string",
    );
  }
  if (typeof label !== "string") {
    fail(
      STRICT_JSON_ERROR_CODES.LABEL_TYPE,
      "JSON",
      "label must be a string",
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    fail(
      STRICT_JSON_ERROR_CODES.SYNTAX,
      label,
      "contains invalid JSON syntax",
      null,
      cause,
    );
  }

  let cursor = 0;

  function skipWhitespace() {
    while (cursor < text.length && JSON_WHITESPACE.test(text[cursor])) cursor += 1;
  }

  function parseStringToken() {
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const character = text[cursor];
      cursor += 1;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") {
        const value = JSON.parse(text.slice(start, cursor));
        assertNoLoneSurrogate(value, label, start);
        return value;
      }
    }

    // JSON.parse above has already established valid syntax. Keep a stable
    // defensive error if this scanner invariant is ever violated.
    fail(
      STRICT_JSON_ERROR_CODES.SYNTAX,
      label,
      "contains an unterminated JSON string",
      start,
    );
  }

  function consumePrimitive() {
    while (cursor < text.length && !JSON_VALUE_DELIMITER.test(text[cursor])) cursor += 1;
  }

  function parseValue() {
    skipWhitespace();
    const character = text[cursor];
    if (character === "{") {
      cursor += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        skipWhitespace();
        const keyOffset = cursor;
        const key = parseStringToken();
        if (keys.has(key)) {
          fail(
            STRICT_JSON_ERROR_CODES.DUPLICATE_KEY,
            label,
            `contains duplicate JSON object key ${JSON.stringify(key)}`,
            keyOffset,
          );
        }
        keys.add(key);
        skipWhitespace();
        cursor += 1; // JSON.parse already proved this token is ':'.
        parseValue();
        skipWhitespace();
        if (text[cursor] === "}") {
          cursor += 1;
          return;
        }
        cursor += 1; // JSON.parse already proved this token is ','.
      }
    } else if (character === "[") {
      cursor += 1;
      skipWhitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return;
      }
      while (cursor < text.length) {
        parseValue();
        skipWhitespace();
        if (text[cursor] === "]") {
          cursor += 1;
          return;
        }
        cursor += 1; // JSON.parse already proved this token is ','.
      }
    } else if (character === "\"") {
      parseStringToken();
    } else {
      consumePrimitive();
    }
  }

  parseValue();
  skipWhitespace();
  if (cursor !== text.length) {
    fail(
      STRICT_JSON_ERROR_CODES.SYNTAX,
      label,
      "contains trailing JSON data",
      cursor,
    );
  }
  return parsed;
}

export const parseStrictJson = parseJsonRejectingDuplicateKeys;

export async function readJsonRejectingDuplicateKeys(file, label = path.basename(file)) {
  return parseJsonRejectingDuplicateKeys(await readFile(file, "utf8"), label);
}
