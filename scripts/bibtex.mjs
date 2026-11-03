// Small, dependency-free BibTeX reader for Zotero / Better BibTeX exports.
// Values remain text: the renderer never interprets bibliography fields as HTML.
export function parseBibTeX(source) {
  let position = 0;
  const entries = [];
  const strings = Object.assign(Object.create(null), {
    jan: 'January', feb: 'February', mar: 'March', apr: 'April',
    may: 'May', jun: 'June', jul: 'July', aug: 'August',
    sep: 'September', oct: 'October', nov: 'November', dec: 'December'
  });
  const fail = message => { throw new Error(`${message} near character ${position}`); };
  function skip() {
    while (position < source.length) {
      if (/\s/.test(source[position])) position++;
      else if (source[position] === '%') {
        while (position < source.length && source[position] !== '\n') position++;
      } else break;
    }
  }
  function take(character) {
    skip();
    if (source[position] !== character) fail(`Expected ${character}`);
    position++;
  }
  function word() {
    skip();
    const match = source.slice(position).match(/^[\w:./+?\-]+/);
    if (!match) fail('Expected a name or number');
    position += match[0].length;
    return match[0];
  }
  function delimited(open, close) {
    take(open);
    const start = position;
    let depth = 0;
    while (position < source.length) {
      const character = source[position++];
      if (character === '\\') { position++; continue; }
      if (character === close && depth === 0) return source.slice(start, position - 1);
      if (character === '{') depth++;
      else if (character === '}') depth--;
    }
    fail(`Unclosed ${open}`);
  }
  function value() {
    let result = '';
    do {
      skip();
      if (source[position] === '{') result += delimited('{', '}');
      else if (source[position] === '"') result += delimited('"', '"');
      else {
        const token = word();
        result += strings[token.toLowerCase()] ?? token;
      }
      skip();
      if (source[position] !== '#') return result;
      position++;
    } while (position < source.length);
    fail('Missing concatenated value');
  }
  while (position < source.length) {
    skip();
    // BibTeX permits free text between entries.
    if (source[position] !== '@') { position++; continue; }
    position++;
    const type = word().toLowerCase();
    skip();
    const open = source[position];
    const close = open === '{' ? '}' : ')';
    if (open !== '{' && open !== '(') fail('Expected an entry opening delimiter');
    if (type === 'comment') { delimited(open, close); continue; }
    take(open);
    if (type === 'preamble') {
      value(); skip();
      if (source[position] === ',') position++;
      take(close);
      continue;
    }
    if (type === 'string') {
      const name = word().toLowerCase();
      take('='); strings[name] = value(); skip();
      if (source[position] === ',') position++;
      take(close);
      continue;
    }
    skip();
    const start = position;
    while (position < source.length && source[position] !== ',' && source[position] !== close) position++;
    const key = source.slice(start, position).trim();
    if (!key) fail('Missing citation key');
    const fields = Object.create(null);
    if (source[position] === ',') {
      position++;
      while (true) {
        skip();
        if (source[position] === close) break;
        const name = word().toLowerCase();
        take('='); fields[name] = value(); skip();
        if (source[position] !== ',') break;
        position++;
      }
    }
    take(close);
    if (!fields.title) throw new Error(`Missing title in ${key}`);
    entries.push({ key, type, fields });
  }
  return entries;
}

// Split at separators outside protected groups (corporate authors, family names).
export function splitNames(value, separator = /\s+and\s+/iy) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\') { index++; continue; }
    if (value[index] === '{') depth++;
    if (value[index] === '}') depth--;
    if (depth !== 0) continue;
    separator.lastIndex = index;
    const match = separator.exec(value);
    if (match) {
      parts.push(value.slice(start, index).trim());
      index += match[0].length - 1;
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

export function plainTeX(value = '') {
  const accents = { "'": '\u0301', '`': '\u0300', '"': '\u0308', '^': '\u0302', '~': '\u0303',
    '=': '\u0304', '.': '\u0307', u: '\u0306', v: '\u030c', H: '\u030b', c: '\u0327', k: '\u0328', r: '\u030a' };
  const letters = { aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ss: 'ß', i: 'ı', j: 'ȷ', textendash: '–', textemdash: '—', textasciitilde: '~', textbackslash: '\\' };
  return value
    .replace(/\\(["'`^~=.uvHckr])\s*(?:\{(\\[ij]|[^{}])\}|(\\[ij]|[A-Za-z]))/g,
      (_, accent, braced, bare) => ((braced || bare).replace(/\\([ij])/, '$1') + accents[accent]).normalize('NFC'))
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\([a-zA-Z]+)\b\s*/g, (_, command) => letters[command] ?? '')
    .replace(/[{}$]/g, '')
    .replace(/---/g, '—').replace(/--/g, '–')
    .replace(/~/g, ' ').replace(/\s+/g, ' ').trim();
}
