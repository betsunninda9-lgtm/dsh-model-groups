import { tokenizer } from 'acorn';

const tokenCache = new Map();
function tokens(source) {
  if (tokenCache.has(source)) return tokenCache.get(source);
  const result = [];
  let end = 0;
  for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module' })) {
    result.push({ start: token.start, end: token.end, newline: /[\r\n\u2028\u2029]/.test(source.slice(end, token.start)), key: JSON.stringify([token.type.label, source.slice(token.start, token.end)]) });
    end = token.end;
  }
  if (tokenCache.size >= 16) tokenCache.delete(tokenCache.keys().next().value);
  tokenCache.set(source, result);
  return result;
}

// Tokenize context, never normalize or regenerate the host source. The changed
// bytes must still match exactly, so the existing exact reverse roundtrip holds.
export function tokenContextEdit(source, before, edit) {
  try {
    const recipe = tokens(before), observed = tokens(source);
    if (recipe.some(t => t.start < edit.start && t.end > edit.start || t.start < edit.end && t.end > edit.end)) return;
    const left = recipe.filter(t => t.end <= edit.start).slice(-8);
    const right = recipe.filter(t => t.start >= edit.end).slice(0, 8);
    if (left.length < 4 || right.length < 4) return;
    // Restrict offsets to token edges: a boundary inside a string/template or
    // arbitrary whitespace cannot be reconstructed safely from token positions.
    const old = before.slice(edit.start, edit.end);
    const edgeStart = left.at(-1).end === edit.start ? 'left' : right[0].start === edit.start ? 'right' : null;
    if (!edgeStart && !old) return;
    const matches = [];
    const equal = (at, expected) => expected.every((t, i) => observed[at + i]?.key === t.key && (!i || observed[at + i].newline === t.newline));
    for (let i = 0; i <= observed.length - left.length; i++) {
      if (!equal(i, left)) continue;
      const l = observed[i + left.length - 1];
      for (let j = i + left.length; j < Math.min(observed.length, i + left.length + 128); j++) {
        if (!equal(j, right)) continue;
        const r = observed[j];
        const hasLineBreak = text => /[\r\n\u2028\u2029]/.test(text);
        if (hasLineBreak(source.slice(l.end, r.start)) !== hasLineBreak(before.slice(left.at(-1).end, right[0].start))) continue;
        if (!old) {
          if (j !== i + left.length) continue;
          const at = edgeStart === 'left' ? l.end : r.start;
          matches.push([at, at]);
        } else {
          // A deletion/replacement may only remove its exact original bytes.
          const at = source.indexOf(old, l.end);
          if (at < 0 || at + old.length > r.start) continue;
          if (source.slice(l.end, at).trim() || source.slice(at + old.length, r.start).trim()) continue;
          matches.push([at, at + old.length]);
        }
      }
    }
    const unique = [...new Map(matches.map(m => [m.join(':'), m])).values()];
    if (unique.length !== 1) return;
    const [start, end] = unique[0];
    return source.slice(0, start) + edit.text + source.slice(end);
  } catch { return; }
}
