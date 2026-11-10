// Degraded but usable selector: shown only if the grouped picker itself throws.
// Deliberately primitive-free and flat so it cannot fail the same way.
function FallbackModelSelect({ available, directory, select, t, providersForm, nativeMetadata }) {
	const state = (0, react.useSyncExternalStore)((fn) => directory.subscribe(fn), () => directory.getSnapshot());
	const configuration = react.useSyncExternalStore(fn => providersForm?.subscribe(fn) ?? (() => {}), () => providersForm?.getSnapshot() ?? EMPTY_PROVIDERS_SNAPSHOT);
	const providers = configuration.status === 'ready' ? (configuration.value?.providers ?? {}) : undefined;
	const [open, setOpen] = (0, react.useState)(false);
	if (!available) return null;
	const label = typeof t === 'function' ? t('menu.model') : '模型';
	const current = state.current ?? null;
	const nativeMode = nativeMetadata !== undefined && nativeMetadata !== null;
	// Flatten without expansion/filtering: a degraded picker must retain every
	// directory route, even when metadata is malformed or legacy aliases exist.
	const models = nativeMode ? buildNativeHierarchy(state.groups ?? [], nativeMetadata, {}, current).flatMap(root => {
		const groups = root.kind === 'multi' ? root.children : [root.group];
		return groups.flatMap(group => group.models.map(model => ({
			provider: group.id,
			providerName: root.kind === 'multi'
				? `${root.name} / ${group.name} · ${group.provider?.name ?? group.group?.name ?? group.id} (${group.id})`
				: `${root.name} (${group.id})`,
			model,
		})));
	}) : (state.groups ?? []).flatMap(group => {
		const profile = Object.hasOwn(providers ?? {}, group.id) ? providers[group.id] : undefined;
		const multi = profile?.multiKey === true || (providers === undefined && group.models.some(model => decodeKeyModelId(model.id)));
		return group.models.flatMap(model => {
			const key = decodeKeyModelId(model.id);
			if (key) {
				if (!multi || (providers !== undefined && !Object.hasOwn(profile?.keyEntries ?? {}, key.entryId))) return [];
			} else if (model.id.startsWith(KEY_MODEL_PREFIX) || (multi && (current?.provider !== group.id || current?.model !== model.id))) return [];
			const providerName = group.name ?? group.id;
			return [{ provider: group.id, providerName: key ? `${providerName} / ${keyEntryName(providers, group.id, key.entryId)}` : providerName, model }];
		});
	});
	const active = models.find((entry) => entry.provider === current?.provider && entry.model.id === current?.model);
	const choose = (entry) => {
		setOpen(false);
		select({
			provider: entry.provider,
			model: entry.model.id,
			...(entry.model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: entry.model.reasoning.defaultEffort }),
		});
	};
	return react.createElement('div', { className: 'dsh-mg-root' },
		react.createElement('button', {
			type: 'button',
			className: 'dsh-mg-trigger',
			'aria-haspopup': 'menu',
			'aria-expanded': open,
			onClick: () => setOpen(!open),
		}, react.createElement('span', { className: 'dsh-mg-triggerLabel' }, nativeMode && active ? `${active.model.name ?? active.model.id} · ${active.providerName}` : active?.model.name ?? current?.model ?? label)),
		open ? react.createElement('div', { className: 'dsh-mg-menu', role: 'menu', style: { left: 12, bottom: 60, top: 'auto' } },
			models.map((entry) => react.createElement('button', {
				key: entry.provider + '/' + entry.model.id,
				type: 'button',
				role: 'menuitemradio',
				'aria-checked': entry === active,
				className: 'dsh-mg-row',
				onClick: () => choose(entry),
			}, entry.model.name ?? entry.model.id, react.createElement('span', { className: 'dsh-mg-rowHint' }, entry.providerName)))) : null);
}

// Last line of defence: a broken grouped picker must never blank the model seat.
class ModelSeatBoundary extends react.Component {
	static getDerivedStateFromError() {
		return { failed: true };
	}
	constructor(props) {
		super(props);
		this.state = { failed: false };
	}
	componentDidCatch(error) {
		try {
			console.error('[dsh-model-groups] grouped picker failed, falling back', error);
		} catch {}
	}
	render() {
		if (this.state.failed) return react.createElement(FallbackModelSelect, this.props);
		return react.createElement(ModelSelect, this.props);
	}
}
