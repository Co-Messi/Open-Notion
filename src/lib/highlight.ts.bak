import { escapeHtml } from './html';

export const LANGUAGES = [
  'plain text', 'bash', 'c', 'c++', 'c#', 'css', 'go', 'html', 'java', 'javascript', 'json', 'kotlin', 'markdown',
  'php', 'python', 'ruby', 'rust', 'shell', 'sql', 'swift', 'typescript', 'yaml',
];

const KW: Record<string, string[]> = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'null', 'undefined', 'true', 'false', 'yield', 'static', 'get', 'set', 'interface', 'type', 'enum', 'implements', 'public', 'private', 'protected', 'readonly', 'as', 'void'],
  py: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'class', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'async', 'await', 'self', 'print'],
  c: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed', 'struct', 'union', 'enum', 'typedef', 'const', 'static', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'sizeof', 'include', 'define', 'class', 'public', 'private', 'protected', 'new', 'delete', 'namespace', 'using', 'template', 'auto', 'bool', 'true', 'false', 'nullptr', 'func', 'package', 'import', 'var', 'go', 'defer', 'chan', 'map', 'fn', 'let', 'mut', 'impl', 'pub', 'use', 'mod', 'match', 'string', 'String', 'val', 'fun', 'override', 'final', 'extends', 'implements', 'interface', 'throws', 'try', 'catch'],
  sql: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'AS', 'DISTINCT', 'HAVING', 'NULL', 'PRIMARY', 'KEY', 'COUNT', 'SUM', 'AVG', 'IN', 'IS', 'LIKE'],
  sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'echo', 'export', 'return', 'cd', 'ls', 'sudo', 'npm', 'git'],
};

function family(lang: string): keyof typeof KW | null {
  if (['javascript', 'typescript', 'json'].includes(lang)) return 'js';
  if (lang === 'python' || lang === 'ruby') return 'py';
  if (['c', 'c++', 'c#', 'java', 'go', 'rust', 'kotlin', 'swift', 'php'].includes(lang)) return 'c';
  if (lang === 'sql') return 'sql';
  if (lang === 'bash' || lang === 'shell') return 'sh';
  return null;
}

/** A small tokenizer good enough for readable highlighting of common languages. */
export function highlight(code: string, lang: string): string {
  const fam = family(lang);
  if (!fam && lang !== 'css' && lang !== 'html' && lang !== 'yaml') return escapeHtml(code);
  if (lang === 'html') {
    return escapeHtml(code)
      .replace(/(&lt;\/?)([a-zA-Z0-9-]+)/g, '$1<span class="tok-k">$2</span>')
      .replace(/([a-zA-Z-]+)=(&quot;[^&]*&quot;)/g, '<span class="tok-p">$1</span>=<span class="tok-s">$2</span>');
  }
  const kws = new Set(fam ? KW[fam].map(k => (fam === 'sql' ? k.toLowerCase() : k)) : []);
  const comment = fam === 'py' || fam === 'sh' || lang === 'yaml' ? /#.*/y : fam === 'sql' ? /--.*/y : /\/\/.*|\/\*[\s\S]*?(\*\/|$)/y;
  const str = /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/y;
  const num = /\b\d+(\.\d+)?\b/y;
  const word = /[A-Za-z_$][\w$]*/y;
  let out = '';
  let i = 0;
  const at = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(code);
    return m && m.index === i ? m[0] : null;
  };
  while (i < code.length) {
    let m: string | null;
    if ((m = at(comment))) {
      out += `<span class="tok-c">${escapeHtml(m)}</span>`;
    } else if ((m = at(str))) {
      out += `<span class="tok-s">${escapeHtml(m)}</span>`;
    } else if ((m = at(num))) {
      out += `<span class="tok-n">${m}</span>`;
    } else if ((m = at(word))) {
      const key = fam === 'sql' ? m.toLowerCase() : m;
      const next = code.slice(i + m.length).match(/^\s*\(/);
      if (kws.has(key)) out += `<span class="tok-k">${m}</span>`;
      else if (next) out += `<span class="tok-f">${m}</span>`;
      else if (lang === 'css' && code.slice(i + m.length).match(/^\s*:/)) out += `<span class="tok-p">${m}</span>`;
      else out += m;
    } else {
      m = code[i];
      out += escapeHtml(m);
    }
    i += m.length;
  }
  return out;
}
