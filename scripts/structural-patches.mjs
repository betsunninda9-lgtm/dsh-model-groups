import { tokenContextEdit } from './token-context.mjs';

// Apply the changed regions of a recipe, retaining host edits outside those regions.
// Hashes remain useful for historical recipes/backups, but are not a build allowlist.
const failureDetails = new WeakMap();
function patchFailure(code, message) {
  const error = new Error(message);
  failureDetails.set(error, { code, replacementIndex: null });
  return error;
}
const cache = new Map();
function changes(before, after) {
  const key = JSON.stringify([before, after]);
  if (cache.has(key)) return cache.get(key);
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (a.length * b.length > 4_000_000) throw patchFailure('FRAGMENT_TOO_LARGE', 'Patch fragment is too large');
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const edits = [];
  let i = 0, j = 0, offset = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { offset += a[i++].length; j++; continue; }
    const start = offset;
    let old = '', next = '';
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) break;
      if (j < b.length && (i === a.length || rows[i][j + 1] >= rows[i + 1][j])) next += b[j++];
      else { old += a[i]; offset += a[i++].length; }
    }
    let prefix = 0, suffix = 0;
    while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
    while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
    edits.push({ start: start + prefix, end: start + old.length - suffix, text: next.slice(prefix, next.length - suffix) });
  }
  if (cache.size >= 512) cache.delete(cache.keys().next().value);
  cache.set(key, edits);
  return edits;
}
function uniqueIndex(source, needle) {
  if (!needle) return -1;
  const at = source.indexOf(needle);
  return at >= 0 && source.indexOf(needle, at + 1) < 0 ? at : -1;
}
function insertedFragmentPresent(source, before, after) {
  let delta = 0;
  for (const edit of changes(before, after)) {
    const at = edit.start + delta;
    delta += edit.text.length - (edit.end - edit.start);
    if (edit.start !== edit.end || !edit.text.trim()) continue;
    if (tokenContextEdit(source, after, { start: at, end: at + edit.text.length, text: '' }) !== undefined) return true;
    // An insertion can still match its old, zero-length span after it was
    // applied. Detect its individual postimage, including when another edit in
    // this same replacement is absent. Whole-replacement checks miss that case.
    for (const width of [240, 120, 60, 30]) {
      const left = after.slice(Math.max(0, at - width), at);
      const right = after.slice(at + edit.text.length, at + edit.text.length + width);
      for (const [l, r] of [[left, right], [left, ''], ['', right]]) {
        if ((l + r).trim().length < 24) continue;
        if (source.includes(l + edit.text + r)) return true;
      }
    }
  }
  return false;
}
function fragment(source, before, after) {
  // Complete old anchors cannot contain an already inserted interior span. Only
  // edge insertions leave the whole old anchor intact; inspect their adjacency
  // rather than matching an unrelated identical postimage elsewhere in a bundle.
  if (source.includes(before)) {
    for (const edit of changes(before, after)) {
      if (edit.start !== edit.end || !edit.text.trim()) continue;
      if (edit.start === 0 && source.includes(edit.text + before)
        || edit.end === before.length && source.includes(before + edit.text)) {
        throw patchFailure('INSERTION_PRESENT', 'Patch insertion already present; partial or duplicate patch');
      }
    }
    return source.split(before).join(after);
  }
  if (insertedFragmentPresent(source, before, after)) throw patchFailure('INSERTION_PRESENT', 'Patch insertion already present; partial or duplicate patch');
  let result = source;
  for (const edit of [...changes(before, after)].reverse()) {
    const old = before.slice(edit.start, edit.end);
    let found = false;
    // Only the changed span is replaced. Context locates it; context is never
    // copied over the host, including custom headers inserted next to schemas.
    for (const width of [240, 120, 60, 30]) {
      const left = before.slice(Math.max(0, edit.start - width), edit.start);
      const right = before.slice(edit.end, edit.end + width);
      for (const [l, r] of [[left, right], [left, ''], ['', right]]) {
        if ((l + old + r).trim().length < 24) continue;
        const at = uniqueIndex(result, l + old + r);
        if (at < 0) continue;
        result = result.slice(0, at + l.length) + edit.text + result.slice(at + l.length + old.length);
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) {
      const tokenResult = tokenContextEdit(result, before, edit);
      if (tokenResult === undefined) throw patchFailure('FRAGMENT_MISSING_OR_AMBIGUOUS', 'Patch fragment missing or ambiguous');
      result = tokenResult;
    }
  }
  return result;
}
export function transformFragments(source, recipe, reverse = false) {
  let result = source;
  const replacements = reverse ? [...recipe.replacements].reverse() : recipe.replacements;
  for (const [offset, { before, after }] of replacements.entries()) {
    const replacementIndex = reverse ? replacements.length - 1 - offset : offset;
    try {
      if (typeof before !== 'string' || !before || typeof after !== 'string' || !after) throw patchFailure('INVALID_RECIPE', 'Invalid structural patch recipe');
      result = fragment(result, reverse ? after : before, reverse ? before : after);
    } catch (error) {
      if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
        failureDetails.set(error, { code: failureDetails.get(error)?.code ?? 'INTERNAL_ERROR', replacementIndex });
      }
      throw error;
    }
  }
  return result;
}
export function structuralRevision(source, candidates, { knownOriginal = false } = {}) {
  return evaluateStructuralRevision(source, candidates, knownOriginal);
}
function evaluateStructuralRevision(source, candidates, knownOriginal, report) {
  const emit = (recipe, phase, code, replacementIndex = null, candidateCount = null) => report?.({
    recipeIndex: recipe ? candidates.indexOf(recipe) : null, replacementIndex, phase, code, candidateCount,
  });
  const failed = (recipe, phase, error) => {
    const detail = failureDetails.get(error);
    emit(recipe, phase, detail?.code ?? 'INTERNAL_ERROR', detail?.replacementIndex ?? null);
  };
  const current = candidates.filter(item => item.current === true);
  const latest = current.length ? current : [candidates[0]];
  const distinct = items => [...new Map(items.map(item => [JSON.stringify(item.replacements), item])).values()];
  function resolve(observed, patched) {
    const matches = [];
    for (const recipe of distinct(observed)) {
      // A partly present recipe is not a pristine build. A complete known reverse
      // must succeed first; otherwise adding another copy would hide corruption.
      const partialIndex = !patched ? recipe.replacements.findIndex(({ before, after }) => after.length > before.length && after.length >= 64 && source.includes(after)) : -1;
      if (partialIndex >= 0) { emit(recipe, 'pristine_guard', 'PARTIAL_POSTIMAGE', partialIndex); continue; }
      let phase = 'observe_reverse';
      try {
        const original = patched ? transformFragments(source, recipe, true) : source;
        phase = 'observe_roundtrip';
        if (patched && transformFragments(original, recipe) !== source) { emit(recipe, phase, 'ROUNDTRIP_MISMATCH'); continue; }
        for (const target of distinct(latest)) {
          let targetPhase = 'target_forward';
          try {
            const result = transformFragments(original, target);
            if (result === original) { emit(target, targetPhase, 'NO_CHANGE'); continue; }
            targetPhase = 'target_roundtrip';
            if (transformFragments(result, target, true) !== original) { emit(target, targetPhase, 'ROUNDTRIP_MISMATCH'); continue; }
            matches.push({ original, latest: result, artifact: recipe, state: patched ? 'patched' : 'pristine' });
          } catch (error) { failed(target, targetPhase, error); }
        }
      } catch (error) { failed(recipe, phase, error); }
    }
    const unique = [...new Map(matches.map(item => [JSON.stringify([item.original, item.latest]), item])).values()];
    if (unique.length > 1) {
      emit(null, 'resolve', 'REVISION_AMBIGUOUS', null, unique.length);
      throw patchFailure('REVISION_AMBIGUOUS', 'Ambiguous structural patch revision');
    }
    return unique[0];
  }
  // Exact historical recipes already establish ownership. Never reinterpret a
  // native current-looking span as plugin code when the pristine source is known.
  if (knownOriginal) return resolve(latest, false);
  // A complete reverse roundtrip recognizes existing patches even when an App
  // update changed unrelated code. Do not apply a second layer over them.
  return resolve(latest, true) || resolve(candidates.filter(item => !latest.includes(item)), true) || resolve(latest, false);
}

// This result deliberately excludes revisions, source bytes and caught error data.
// Indices refer to the caller's fixed recipe/replacement order, even on reverse.
export function diagnoseStructuralRevision(source, candidates, { knownOriginal = false } = {}) {
  const diagnostics = [];
  const record = detail => { if (diagnostics.length < 128) diagnostics.push(detail); };
  try {
    const revision = evaluateStructuralRevision(source, candidates, knownOriginal, record);
    return { matched: !!revision, diagnostics };
  } catch (error) {
    if (failureDetails.get(error)?.code !== 'REVISION_AMBIGUOUS') {
      record({ recipeIndex: null, replacementIndex: null, phase: 'resolve', code: 'INTERNAL_ERROR', candidateCount: null });
    }
    return { matched: false, diagnostics };
  }
}
