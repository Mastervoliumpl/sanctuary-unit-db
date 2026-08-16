// Parser for the Lua table literals the game ships as .santp / .lua data files.
//
// These files are pure data: no functions, requires, concatenation or conditionals,
// so a straight recursive-descent reader over the literal is enough. Anything that
// isn't a plain literal will throw rather than silently produce a wrong value.

export function parseLuaTable(source, { assignment } = {}) {
  const src = stripComments(source);

  // Files are of the form `SomeGlobal = { ... }`. Seek past the named assignment
  // when one is given so we don't accidentally latch onto an earlier table.
  let start = 0;
  if (assignment) {
    const at = src.indexOf(assignment);
    if (at === -1) throw new Error(`assignment "${assignment}" not found`);
    start = at + assignment.length;
  }
  const open = src.indexOf('{', start);
  if (open === -1) throw new Error('no table literal found');

  const reader = new Reader(src, open);
  const value = reader.readTable();
  return value;
}

function stripComments(src) {
  // Long comments first (--[[ ... ]]), then line comments. Neither form appears
  // inside string values in this dataset, so a plain regex pass is safe.
  return src.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\n]*/g, '');
}

class Reader {
  constructor(src, pos) {
    this.src = src;
    this.pos = pos;
  }

  skipSpace() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  readValue() {
    this.skipSpace();
    const ch = this.src[this.pos];
    if (ch === undefined) throw new Error('unexpected end of input');
    if (ch === '{') return this.readTable();
    if (ch === '"' || ch === "'") return this.readString();
    return this.readScalar();
  }

  readScalar() {
    const match = /^[^,;}\s]+/.exec(this.src.slice(this.pos));
    if (!match) throw new Error(`unparseable value at offset ${this.pos}`);
    const token = match[0];
    this.pos += token.length;

    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'nil') return null;

    const num = Number(token);
    if (!Number.isNaN(num)) return num;
    throw new Error(`unexpected bare token "${token}" at offset ${this.pos}`);
  }

  readString() {
    const quote = this.src[this.pos++];
    let out = '';
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      if (this.src[this.pos] === '\\') {
        const esc = this.src[this.pos + 1];
        out += { n: '\n', t: '\t', r: '\r' }[esc] ?? esc;
        this.pos += 2;
      } else {
        out += this.src[this.pos++];
      }
    }
    if (this.src[this.pos] !== quote) throw new Error('unterminated string');
    this.pos++;
    return out;
  }

  readTable() {
    this.pos++; // consume '{'
    const map = {};
    const list = [];
    let sawKey = false;
    let sawItem = false;

    for (;;) {
      this.skipSpace();
      if (this.src[this.pos] === '}') {
        this.pos++;
        break;
      }
      if (this.pos >= this.src.length) throw new Error('unterminated table');

      const key = this.tryReadKey();
      if (key === null) {
        sawItem = true;
        list.push(this.readValue());
      } else {
        sawKey = true;
        map[key] = this.readValue();
      }

      this.skipSpace();
      if (this.src[this.pos] === ',' || this.src[this.pos] === ';') this.pos++;
    }

    // Mixed tables don't occur in this dataset; if one ever does, surface it
    // loudly rather than dropping the array half on the floor.
    if (sawKey && sawItem) throw new Error('mixed array/map table is not supported');
    return sawItem || (!sawKey && !sawItem) ? list : map;
  }

  // Returns the key name, or null if this entry is a positional array item.
  tryReadKey() {
    const rest = this.src.slice(this.pos);

    // ["quoted key"] = value
    const bracket = /^\[\s*(["'])((?:[^\\]|\\.)*?)\1\s*\]\s*=(?!=)/.exec(rest);
    if (bracket) {
      this.pos += bracket[0].length;
      return bracket[2];
    }
    // bareKey = value  (the `(?!=)` guard keeps `==` from reading as assignment)
    const bare = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(rest);
    if (bare) {
      this.pos += bare[0].length;
      return bare[1];
    }
    return null;
  }
}
