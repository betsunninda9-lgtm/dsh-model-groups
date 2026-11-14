import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, transformSource } from './native-patches.mjs';
import { applyModelCapabilities, validateCapabilityBatch } from '../src/capability-defaults.js';

const manifestPath = fileURLToPath(new URL('../native/pi-ai.patch.json', import.meta.url));
const legacyLabel = 'multi-key revision before per-entry API overrides';

/** Literal deltas on the real, previously patched pi-ai 0.2.2-rc.1 source. */
export function protocolReplacements() {
  return [
    {
      before: '\tapiKeyEnv: z.string().role("credential-ref").required(),\n\tmodels: z.array(modelProfile).required()\n});',
      after: '\tapiKeyEnv: z.string().role("credential-ref").required(),\n\tapi: z.union(supportedProtocols()),\n\tsortOrder: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),\n\tmodels: z.array(modelProfile).required()\n});',
    },
    {
      before: '\t\t\tcredentialRef(entry.apiKeyEnv);\n\t\t\tif (!Array.isArray(entry.models))',
      after: '\t\t\tcredentialRef(entry.apiKeyEnv);\n\t\t\tif (entry.api !== void 0 && !supportedProtocols().includes(entry.api)) throw new Error(`llm-pi-ai: provider "${provider}" key entry "${id}" api must be a supported protocol`);\n\t\t\tif (entry.sortOrder !== void 0 && (!Number.isSafeInteger(entry.sortOrder) || entry.sortOrder < 0)) throw new Error(`llm-pi-ai: provider "${provider}" key entry "${id}" sortOrder must be a nonnegative safe integer`);\n\t\t\tif (!Array.isArray(entry.models))',
    },
    {
      before: '\t\t\tconst child = resolveProfiles({ [provider]: {\n\t\t\t\t...source,\n\t\t\t\tmultiKey: false,',
      after: '\t\t\tconst child = resolveProfiles({ [provider]: {\n\t\t\t\t...source,\n\t\t\t\t...entry.api === void 0 ? {} : { api: entry.api },\n\t\t\t\tmultiKey: false,',
    },
    {
      before: '\tif (request.keyEntryId !== void 0 && selectedStored === void 0) throw new LlmError("multi-key model discovery requires an existing provider key entry", "INVALID_CONFIG");\n\tif (request.provider !== void 0) {',
      after: '\tif (request.keyEntryId !== void 0 && selectedStored === void 0) throw new LlmError("multi-key model discovery requires an existing provider key entry", "INVALID_CONFIG");\n\tconst api = request.api !== void 0 ? request.api : selectedStored?.api !== void 0 ? selectedStored.api : "openai-completions";\n\tif (!supportedProtocols().includes(api)) throw new LlmError(`pi-ai model discovery api must be a supported protocol`, "INVALID_CONFIG");\n\t// A selected entry must probe its effective protocol, not a catalog for another API.\n\tconst entryProtocol = request.keyEntryId !== void 0 && (request.api !== void 0 || selectedStored.api !== void 0);\n\tif (!entryProtocol && request.provider !== void 0) {',
    },
    {
      before: '\tif (request.baseURL === void 0 || request.baseURL.length === 0) throw new LlmError(`pi-ai ships no catalog for provider "${request.provider ?? ""}", so its models can only come from its endpoint; set a baseURL, or enter this provider\'s models by hand`, "DISCOVERY_FAILED");\n\tconst api = request.api ?? "openai-completions";\n\tif (!LISTABLE_PROTOCOLS.has(api)) throw new LlmError(`pi-ai protocol "${api}" has no model listing this build can read; enter this provider\'s models by hand`, "DISCOVERY_UNSUPPORTED");\n\tconst url = listingUrl(request.baseURL, api);',
      after: '\tconst baseURL = request.baseURL ?? selectedStored?.baseURL;\n\tif (baseURL === void 0 || baseURL.length === 0) throw new LlmError(`pi-ai ships no catalog for provider "${request.provider ?? ""}", so its models can only come from its endpoint; set a baseURL, or enter this provider\'s models by hand`, "DISCOVERY_FAILED");\n\tif (!LISTABLE_PROTOCOLS.has(api)) throw new LlmError(`pi-ai protocol "${api}" has no model listing this build can read; enter this provider\'s models by hand`, "DISCOVERY_UNSUPPORTED");\n\tconst url = listingUrl(baseURL, api);',
    },
    {
      before: '\t\t\tname: entry.keyEntryName,\n\t\t\tapiKeyEnv: entry.apiKeyEnv,\n\t\t\tmodels: entry.piProvider?.getModels(),',
      after: '\t\t\tname: entry.keyEntryName,\n\t\t\tapiKeyEnv: entry.apiKeyEnv,\n\t\t\tapi: entry.api,\n\t\t\tmodels: entry.piProvider?.getModels(),',
    },
    {
      before: '\t\tif (profile === void 0) throw new LlmError(`provider "${provider}" has no key entry "${keyEntryId}"`, "INVALID_CONFIG");\n\t\treturn {\n\t\t\theaders: profile.headers,',
      after: '\t\tif (profile === void 0) throw new LlmError(`provider "${provider}" has no key entry "${keyEntryId}"`, "INVALID_CONFIG");\n\t\treturn {\n\t\t\tapi: profile.api,\n\t\t\tbaseURL: profile.baseURL ?? catalogProvider(provider)?.baseUrl,\n\t\t\theaders: profile.headers,',
    },
    {
      // Anthropic's SDK appends `/v1/messages` itself, while OpenAI protocols
      // append `/chat/completions`. A relay that publishes its root as `.../v1`
      // therefore works for chat and doubles the segment for Anthropic. Normalize
      // the model's base for that protocol so both spellings reach one path.
      before: 'function listingUrl(baseURL, api) {\n\tconst base = baseURL.replace(/\\/+$/, "");',
      after: '/** Strip trailing slashes and one trailing `/v1`, the segment the Anthropic SDK adds itself. */\nfunction anthropicRoot(baseURL) {\n\tconst base = baseURL.replace(/\\/+$/, "");\n\treturn base.endsWith("/v1") ? base.slice(0, -3) : base;\n}\nfunction listingUrl(baseURL, api) {\n\tconst base = baseURL.replace(/\\/+$/, "");',
    },
    {
      before: '\t\tconst baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;\n\t\tif (baseUrl === void 0) invalid(provider, `model "${entry.id}" needs a baseURL; the installed catalog does not describe this route`);',
      after: '\t\tconst configuredBaseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;\n\t\tif (configuredBaseUrl === void 0) invalid(provider, `model "${entry.id}" needs a baseURL; the installed catalog does not describe this route`);\n\t\tconst baseUrl = api === "anthropic-messages" ? anthropicRoot(configuredBaseUrl) : configuredBaseUrl;',
    },
    {
      // listingUrl already normalized that segment; reuse the same rule so a
      // patched build cannot drift between the listing path and the wire path.
      before: '\tif (api !== "anthropic-messages") return `${base}/models`;\n\treturn `${base.endsWith("/v1") ? base.slice(0, -3) : base}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`;',
      after: '\tif (api !== "anthropic-messages") return `${base}/models`;\n\treturn `${anthropicRoot(base)}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`;',
    },
    {
      // The comment above listingUrl documented the old asymmetry as intended.
      // Now that model requests normalize too, say what actually happens.
      before: '* gateway documentation publishes both spellings of the same root. Only this\n* listing URL normalizes that segment; model requests receive the configured\n* `baseURL` unchanged.\n*/',
      after: '* gateway documentation publishes both spellings of the same root. Anthropic\n* listings and model requests both normalize it, because the Anthropic SDK\n* appends `/v1/messages` on its own while OpenAI protocols append\n* `/chat/completions`; without this, one root would work for chat and double\n* the segment for Anthropic.\n*/',
    },
    {
      before: 'const modelProfile = z.object({\n\tid: z.string().required(),\n\t...modelFields\n});',
      after: `${applyModelCapabilities.toString()}\n${validateCapabilityBatch.toString()}\nconst capabilityBatchProfile = z.union([z.object({ vision: z.boolean(), reasoning: z.boolean() })]);\nconst capabilityDefaultsProfile = z.union([z.object({ vision: z.boolean().required(), reasoning: z.boolean().required() })]);\nconst capabilityOverridesProfile = z.union([z.object({ vision: z.union([z.boolean(), z.const("original")]), reasoning: z.union([z.boolean(), z.const("original")]) })]);\nconst modelProfile = z.object({\n\tid: z.string().required(),\n\t...modelFields,\n\tcapabilityOverrides: capabilityOverridesProfile\n});`,
    },
    {
      before: '\tsortOrder: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),\n\tmodels: z.array(modelProfile).required()',
      after: '\tsortOrder: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),\n\tcapabilityDefaults: capabilityDefaultsProfile,\n\tcapabilityBatch: capabilityBatchProfile,\n\tmodels: z.array(modelProfile).required()',
    },
    {
      before: '\t\tassertWireModels(source.models, "models");',
      after: '\t\tassertWireModels(source.models, "models");\n\t\tfor (const model of source.models ?? []) applyModelCapabilities(model);',
    },
    {
      before: '\t\t\tassertWireModels(entry.models, `key entry "${id}" models`);',
      after: '\t\t\tassertWireModels(entry.models, `key entry "${id}" models`);\n\t\t\tapplyModelCapabilities({}, entry.capabilityDefaults);\n\t\t\tvalidateCapabilityBatch(entry.capabilityBatch);\n\t\t\tfor (const model of entry.models) applyModelCapabilities(model, entry.capabilityDefaults);',
    },
    {
      before: '\t\t\t\tmodels: entry.models,',
      after: '\t\t\t\tmodels: entry.models.map(model => applyModelCapabilities(model, entry.capabilityDefaults)),',
    },
  ];
}

function applyLiterals(source, replacements) {
  let result = source;
  for (const { before, after } of replacements) {
    if (result.split(before).length !== 2) throw new Error('Expected exactly one protocol patch anchor');
    result = result.replace(before, after);
  }
  return result;
}

/** Build only exact, hash-verified revisions; unknown old variants are retained. */
export function buildProtocolArtifact(previous, sources) {
  const revisions = [previous, ...(previous.variants ?? []).map(variant => ({ ...previous, ...variant, current: variant.current === true }))];
  // A retained earlier protocol beta is reversible too, but is not the
  // pre-protocol multi-key revision onto which these deltas are applied.
  const schemaAnchor = protocolReplacements()[0].before;
  const legacy = revisions.filter(revision => revision.current !== true && !revision.replacements.some(replacement => replacement.before === schemaAnchor));
  if (legacy.length === 0) throw new Error('Missing legacy pi-ai revisions');
  const legacyReplacements = legacy[0].replacements;
  const replacements = [...legacyReplacements, ...protocolReplacements()];
  const verified = new Map();
  for (const source of sources) {
    const hash = sha256(source);
    const revision = revisions.find(candidate => candidate.resultSha256 === hash) ?? revisions.find(candidate => candidate.baseSha256 === hash);
    if (!revision) throw new Error(`Unrecognized pi-ai source ${hash}`);
    const pristine = hash === revision.baseSha256 ? source : transformSource(source, revision, true);
    const old = legacy.find(candidate => candidate.baseSha256 === revision.baseSha256);
    if (!old) throw new Error('Missing legacy revision for pristine base');
    const oldPatched = transformSource(pristine, old);
    const result = applyLiterals(oldPatched, protocolReplacements());
    const current = { baseSha256: old.baseSha256, resultSha256: sha256(result), current: true, replacements };
    if (transformSource(pristine, current) !== result || transformSource(result, current, true) !== pristine) throw new Error('Protocol patch roundtrip mismatch');
    verified.set(old.baseSha256, current);
  }
  const primary = verified.get(previous.baseSha256);
  if (!primary) throw new Error('The primary pi-ai pristine base must be verified');
  const variants = [];
  const seen = new Set([primary.resultSha256]);
  const regenerated = new Set([...verified.values()].map(revision => revision.resultSha256));
  // Preserve every old output together with its ORIGINAL literals, never new ones.
  for (const revision of revisions) {
    if (seen.has(revision.resultSha256) || regenerated.has(revision.resultSha256)) continue;
    seen.add(revision.resultSha256);
    variants.push({
      source: revision.source ?? legacyLabel,
      baseSha256: revision.baseSha256,
      resultSha256: revision.resultSha256,
      ...(revision.current === true && !verified.has(revision.baseSha256) ? { current: true } : {}),
      replacements: revision.replacements,
    });
  }
  for (const current of verified.values()) {
    if (current === primary || seen.has(current.resultSha256)) continue;
    const old = legacy.find(revision => revision.baseSha256 === current.baseSha256);
    variants.push({
      source: `${old.source ?? 'pi-ai 0.2.2-rc.1'} with per-entry API overrides`,
      baseSha256: current.baseSha256,
      resultSha256: current.resultSha256,
      current: true,
    });
    seen.add(current.resultSha256);
  }
  // A recognized legacy-only build cannot safely accept the new UI/schema half.
  return { ...previous, ...primary, requiresCurrent: true, variants };
}

function main(args) {
  const sources = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--source' || !args[index + 1]) throw new Error('Usage: node scripts/pi-ai-protocol.mjs --source <known-pi-ai-index.js> [--source <another-known-source>]');
    sources.push(fs.readFileSync(path.resolve(args[++index]), 'utf8'));
  }
  if (sources.length === 0) throw new Error('At least one real --source is required; this generator never modifies a host');
  const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifact = buildProtocolArtifact(previous, sources);
  fs.writeFileSync(manifestPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ target: artifact.target, current: [artifact, ...artifact.variants].filter(revision => revision.current === true).map(({ baseSha256, resultSha256 }) => ({ baseSha256, resultSha256 })) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
