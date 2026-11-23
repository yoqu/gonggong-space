import type { TextSpan } from './sources.ts';

/** A string literal's own text: one span for a quoted string, one for each static part of a template. */
export type StringLiteral = TextSpan[];

export interface StringScan {
  /** In the order each literal ends. */
  literals: StringLiteral[];
  /**
   * The literals a script call reads as code or markup (an argument of setAttribute, createElement, setTimeout,
   * eval…): their text is not words the film shows.
   */
  script: Set<StringLiteral>;
}

interface TemplateFrame {
  spans: TextSpan[];
  braces: number;
  tagged: boolean;
}

/** After these words a `/` starts a regular expression, not a division. */
const REGEX_PRECEDING_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
/** How far a regular expression literal is looked for. */
const REGEX_LOOKAHEAD = 2000;
/** `if (…) /re/` starts a regular expression after the parenthesis. */
const CONTROL_FLOW_KEYWORDS = new Set(['if', 'while', 'for', 'with']);
const WORD_PATTERN = /[\w$\u0080-\uffff]+/y;
const NEWLINE_PATTERN = /[\n\r\u2028\u2029]/;
const SCRIPT_STRING_CALLEES = new Set(['setAttribute', 'setAttributeNS', 'createElement', 'createElementNS', 'setTimeout', 'setInterval', 'Function', 'eval']);
/** How many leading arguments of these calls are script strings (the others are plain values). */
const SCRIPT_STRING_ARGUMENT_COUNTS = new Map([
  ['setTimeout', 1],
  ['setInterval', 1],
  ['createElement', 1],
  ['createElementNS', 2],
]);

/**
 * The string literals of a script: a small lexer that knows strings, templates (their static parts, between the
 * `${…}`), comments and regular expressions, and skips the rest. `null` when the script does not read to its end
 * (an unclosed string, comment or template).
 */
export function scanStringLiterals(source: string): StringScan | null {
  const literals: StringLiteral[] = [];
  const script = new Set<StringLiteral>();
  const templates: TemplateFrame[] = [];
  /** For each open bracket, whether its strings are script strings. */
  const scriptContexts: boolean[] = [];
  const argumentsLeft = new Map<number, number>();
  /** For each open parenthesis, whether it follows a control-flow keyword. */
  const parentheses: boolean[] = [];
  let offset = 0;
  let lastWord = '';
  let previousWord = '';
  let canEndExpression = false;
  let budget = 8 * source.length + 10 * REGEX_LOOKAHEAD;

  const pushContext = (isScript: boolean, argumentCount = 0): void => {
    scriptContexts.push(isScript);
    if (argumentCount > 0) argumentsLeft.set(scriptContexts.length - 1, argumentCount);
    else argumentsLeft.delete(scriptContexts.length - 1);
  };
  const markScript = (literal: StringLiteral): StringLiteral => {
    if (scriptContexts[scriptContexts.length - 1] === true) script.add(literal);
    return literal;
  };
  const readTemplate = (): boolean => {
    const frame = templates[templates.length - 1]!;
    const start = offset;
    for (; offset < source.length; offset++) {
      if (source[offset] === '\\') offset++;
      else if (source[offset] === '`') {
        frame.spans.push({ start, end: offset++, ...(frame.tagged ? { tagged: true } : {}) });
        literals.push(templates.pop()!.spans);
        canEndExpression = true;
        return true;
      } else if (source[offset] === '$' && source[offset + 1] === '{') {
        frame.spans.push({ start, end: offset, ...(frame.tagged ? { tagged: true } : {}) });
        offset += 2;
        canEndExpression = false;
        pushContext(false);
        return true;
      }
    }
    return false;
  };
  const skipRegex = (): boolean => {
    let inClass = false;
    for (let at = offset + 1; at < Math.min(source.length, offset + REGEX_LOOKAHEAD) && !NEWLINE_PATTERN.test(source[at]!); at++) {
      budget--;
      if (source[at] === '\\') at++;
      else if (source[at] === '[') inClass = true;
      else if (source[at] === ']') inClass = false;
      else if (source[at] === '/' && !inClass) {
        offset = at + 1;
        return true;
      }
    }
    return false;
  };

  while (offset < source.length) {
    const character = source[offset]!;
    const frame = templates[templates.length - 1];
    const comment = character === '/' && (source[offset + 1] === '/' || source[offset + 1] === '*');
    if (/\s/.test(character)) offset++;
    else if (character === '/' && source[offset + 1] === '/') {
      while (offset < source.length && !NEWLINE_PATTERN.test(source[offset]!)) offset++;
    } else if (character === '/' && source[offset + 1] === '*') {
      const close = source.indexOf('*/', offset + 2);
      if (close < 0) return null;
      offset = close + 2;
    } else if (character === "'" || character === '"') {
      const start = ++offset;
      for (; source[offset] !== character; offset++) {
        if (offset >= source.length || source[offset] === '\n' || source[offset] === '\r') return null;
        if (source[offset] === '\\') offset++;
      }
      literals.push(markScript([{ start, end: offset++ }]));
      canEndExpression = true;
    } else if (character === '`') {
      templates.push({ spans: markScript([]), braces: 0, tagged: canEndExpression });
      offset++;
      if (!readTemplate()) return null;
    } else if (character === '}' && frame !== undefined && frame.braces === 0) {
      scriptContexts.pop();
      offset++;
      if (!readTemplate()) return null;
    } else if (character === '{' || character === '}') {
      if (frame !== undefined) frame.braces += character === '{' ? 1 : -1;
      if (character === '{') pushContext(false);
      else scriptContexts.pop();
      canEndExpression = character === '}';
      offset++;
    } else if (character === '/') {
      canEndExpression = !canEndExpression && skipRegex();
      if (budget < 0) return null;
      if (!canEndExpression) offset++;
    } else if (character === '(' || character === '[') {
      if (character === '(') parentheses.push(CONTROL_FLOW_KEYWORDS.has(previousWord));
      pushContext(
        character === '(' && (SCRIPT_STRING_CALLEES.has(lastWord) || (!canEndExpression && scriptContexts[scriptContexts.length - 1] === true)),
        character === '(' ? (SCRIPT_STRING_ARGUMENT_COUNTS.get(lastWord) ?? 0) : 0,
      );
      canEndExpression = false;
      offset++;
    } else if (character === ')' || character === ']') {
      scriptContexts.pop();
      canEndExpression = character === ']' || parentheses.pop() !== true;
      offset++;
    } else if (character === '=' && source[offset + 1] === '>') {
      if (scriptContexts.length > 0) scriptContexts[scriptContexts.length - 1] = false;
      canEndExpression = false;
      offset += 2;
    } else if (character === ',') {
      const left = argumentsLeft.get(scriptContexts.length - 1);
      if (left === 1) {
        argumentsLeft.delete(scriptContexts.length - 1);
        scriptContexts[scriptContexts.length - 1] = false;
      } else if (left !== undefined) argumentsLeft.set(scriptContexts.length - 1, left - 1);
      previousWord = '';
      lastWord = '';
      canEndExpression = false;
      offset++;
    } else if ((character === '+' || character === '-') && source[offset + 1] === character) offset += 2;
    else {
      WORD_PATTERN.lastIndex = offset;
      const word = WORD_PATTERN.exec(source)?.[0];
      previousWord = source[offset - 1] === '.' ? '' : (word ?? '');
      lastWord = word ?? '';
      canEndExpression = word !== undefined && !REGEX_PRECEDING_KEYWORDS.has(previousWord);
      offset += word?.length ?? 1;
      continue;
    }
    if (!/\s/.test(character) && !comment) previousWord = lastWord = '';
  }
  return templates.length === 0 ? { literals, script } : null;
}
