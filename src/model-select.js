// Model picker adapted from DeepSeek Harness 0.2.1-rc.2 (MIT; see LICENSE).
//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
function r(e) {
	var t, f, n = "";
	if ("string" == typeof e || "number" == typeof e) n += e;
	else if ("object" == typeof e) if (Array.isArray(e)) {
		var o = e.length;
		for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
	} else for (f in e) e[f] && (n && (n += " "), n += f);
	return n;
}
function clsx() {
	for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
	return n;
}
//#endregion
//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-model-selection/src/client/ModelSelect.module.css.mjs
const css = "._7KE1Ra_root{min-width:0;position:relative}._7KE1Ra_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:360px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}@media (hover:hover){._7KE1Ra_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}._7KE1Ra_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}._7KE1Ra_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._7KE1Ra_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}._7KE1Ra_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}._7KE1Ra_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}._7KE1Ra_triggerLabel,._7KE1Ra_triggerEffort{display:var(--dsh-composer-model-text-display,block)}._7KE1Ra_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}._7KE1Ra_chevronOpen{transform:rotate(180deg)}._7KE1Ra_menu{box-sizing:border-box;z-index:1100;width:max-content;min-width:min(240px, calc(100vw - 32px), var(--dsh-anchored-max-width,100vw));max-width:min(420px, calc(100vw - 32px), var(--dsh-anchored-max-width,100vw));max-height:min(360px, calc(100vh - 96px), var(--dsh-anchored-max-height,100vh));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}._7KE1Ra_status,._7KE1Ra_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}._7KE1Ra_error,._7KE1Ra_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}._7KE1Ra_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}._7KE1Ra_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}._7KE1Ra_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}._7KE1Ra_searchRow ._7KE1Ra_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}._7KE1Ra_searchRow ._7KE1Ra_searchWithQuery{padding-right:34px}._7KE1Ra_searchClear{corner-shape:round;width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}._7KE1Ra_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}@media (hover:hover){._7KE1Ra_searchClear:hover{background:var(--dsw-alias-interactive-bg-hover);outline:none}}._7KE1Ra_searchRow ._7KE1Ra_search:focus-within{border-color:#0000}._7KE1Ra_searchRow ._7KE1Ra_search input{padding:0;font-size:12px;line-height:normal}@media (pointer:coarse){._7KE1Ra_searchRow ._7KE1Ra_search input{font-size:16px}}._7KE1Ra_searchRow ._7KE1Ra_search input::placeholder{color:var(--dsw-alias-label-caption)}._7KE1Ra_groups:not([hidden]){min-height:0;overflow:hidden auto}._7KE1Ra_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}._7KE1Ra_option:focus-visible,._7KE1Ra_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._7KE1Ra_modelOption{max-width:100%}@media (hover:hover){._7KE1Ra_option:not(._7KE1Ra_modelOption):hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}._7KE1Ra_selected{background:0 0}._7KE1Ra_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._7KE1Ra_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}._7KE1Ra_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}._7KE1Ra_badgedName{vertical-align:baseline;white-space:nowrap;align-items:center;gap:4px;max-width:100%;display:inline-flex}._7KE1Ra_badgedNameText{text-overflow:ellipsis;min-width:0;overflow:hidden}._7KE1Ra_badge{flex:none}._7KE1Ra_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}._7KE1Ra_check svg{width:14px;height:14px}._7KE1Ra_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}._7KE1Ra_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}@media (hover:hover){._7KE1Ra_cell:hover{background:var(--dsw-alias-interactive-bg-hover)}}._7KE1Ra_cellLabel{white-space:nowrap;flex:none}._7KE1Ra_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}._7KE1Ra_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}";
const tagId = "dsh-model-groups/ModelSelect.css";
function installModelSelectStyles() {
	if (typeof document === "undefined" || document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-model-groups";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
var ModelSelect_module_css_default = {
	"badge": "_7KE1Ra_badge",
	"badgedName": "_7KE1Ra_badgedName",
	"badgedNameText": "_7KE1Ra_badgedNameText",
	"cell": "_7KE1Ra_cell",
	"cellChevron": "_7KE1Ra_cellChevron",
	"cellLabel": "_7KE1Ra_cellLabel",
	"cellValue": "_7KE1Ra_cellValue",
	"check": "_7KE1Ra_check",
	"chevron": "_7KE1Ra_chevron",
	"chevronOpen": "_7KE1Ra_chevronOpen",
	"empty": "_7KE1Ra_empty",
	"error": "_7KE1Ra_error",
	"groups": "_7KE1Ra_groups",
	"menu": "_7KE1Ra_menu",
	"modelName": "_7KE1Ra_modelName",
	"modelOption": "_7KE1Ra_modelOption",
	"option": "_7KE1Ra_option",
	"optionActive": "_7KE1Ra_optionActive",
	"optionCopy": "_7KE1Ra_optionCopy",
	"retry": "_7KE1Ra_retry",
	"root": "_7KE1Ra_root",
	"search": "_7KE1Ra_search",
	"searchClear": "_7KE1Ra_searchClear",
	"searchRow": "_7KE1Ra_searchRow",
	"searchWithQuery": "_7KE1Ra_searchWithQuery",
	"selected": "_7KE1Ra_selected",
	"status": "_7KE1Ra_status",
	"trigger": "_7KE1Ra_trigger",
	"triggerEffort": "_7KE1Ra_triggerEffort",
	"triggerIcon": "_7KE1Ra_triggerIcon",
	"triggerLabel": "_7KE1Ra_triggerLabel",
	"warning": "_7KE1Ra_warning"
};
//#endregion
//#region lib/types/client/provider-order.js
/** Shared provider display order for the composer and command model pickers. */
/**
* Put the account and official providers first, preserving every other relative order.
* @param groups - Provider groups in catalog order.
* @returns a sorted copy; model order within each group is unchanged.
*/
function orderModelProviders(groups) {
	return groups.toSorted((left, right) => (left.id === "deepseek-account" ? 0 : left.id === "deepseek-official" ? 1 : 2) - (right.id === "deepseek-account" ? 0 : right.id === "deepseek-official" ? 1 : 2));
}
//#endregion
//#region lib/types/client/ModelSelect.js
/**
* ModelSelect: the composer's named model seat (`conversation.input.model`).
* Two-level selection per figma 496:26454's MenuDropdown: the root menu is
* the Model / Effort row pair (label + current value + a right chevron),
* each drilling into its own list — the provider-grouped model list over
* the shared directory, and the effort levels. The trigger (313:14108's
* ToggleButton) shows both: model name + effort in the caption tone.
* Model catalogs above four entries show search, which retains focus while
* ↑/↓ cycle the highlighted result; Enter and Tab accept it. Smaller model
* catalogs, root panes, and effort panes move focus between rows. Escape and Shift+Tab leave a drilled pane first and otherwise close
* back to the trigger. A drilled pane focuses the current effort or model
* search field. Provider headings paint their background only while pinned
* by scrolling. Clearing a query restores the full list and search focus.
* Selecting restores trigger focus without a ring until the trigger loses focus
* or the menu reopens. Model names match a case-insensitive ordered subsequence
* within each provider group, ranked by
* prefix, alignment score, then catalog order. Returning to the root pane
* hands focus back to the cell that opened it. Data and submission ride the
* same per-session ModelDirectory as the /model popup; exact-model reasoning
* metadata and the selected effort come from the Host rather than a
* client-owned vocabulary. A rejected selection announces through the shared
* transient Toast anchored to the composer card; the in-menu strip with
* Retry remains the catalog-load surface. While the directory's pending
* selection is unsettled, the trigger shows a spinner in place of its
* chevron, and each row whose value that selection carries shows one in place
* of its check mark.
*/
/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real (Menu primitive's measure pass). */
const MEASURE_STYLE = {
	visibility: "hidden",
	left: 0,
	top: 0
};
/**
* Render the composer model seat.
* @param props - owner share (locked) + injected face (shared directory
* store/verbs) + the standard locale seat.
* @returns the trigger and, while open, the two-level menu.
*/
// Lay out the entire cascade together: positioning a child alone can put it
// over an ancestor when neither side has room for another full-size card.
function layoutModelFlyouts(rect, viewportWidth, viewportHeight, count) {
 const margin = Math.min(12, Math.max(0, viewportWidth / 8));
 const available = Math.max(1, viewportWidth - margin * 2);
 const preferredWidth = rect.width > 0 ? rect.width : 280;
 const width = Math.min(preferredWidth, available / count);
 const height = Math.min(rect.height > 0 ? rect.height : 360, Math.max(1, viewportHeight - margin * 2));
 const leftRoom = rect.left - margin;
 const rightRoom = viewportWidth - margin - (rect.left + preferredWidth);
 const direction = leftRoom >= width * (count - 1) ? -1
  : rightRoom >= width * (count - 1) ? 1 : leftRoom >= rightRoom ? -1 : 1;
 const desiredLeft = direction < 0 ? rect.left - width * (count - 1) : rect.left;
 const start = Math.max(margin, Math.min(desiredLeft, viewportWidth - margin - width * count));
 const top = Math.max(margin, Math.min(rect.top, viewportHeight - margin - height));
 return Array.from({ length: count }, (_, index) => ({
  left: start + width * (direction < 0 ? count - 1 - index : index),
  top, width, height,
  // Override the native menu's intrinsic minimum and maximum at narrow widths.
  minWidth: 0, maxWidth: width, maxHeight: height,
 }));
}

function ModelSelect({ locked, available, directory, load, select, t, renderSlot, providersForm, nativeMetadata }) {
	const preferences = react.useSyncExternalStore(groupPreferences.subscribe, groupPreferences.getSnapshot);
	const configuration = react.useSyncExternalStore(listener => providersForm?.subscribe(listener) ?? (() => {}), () => providersForm?.getSnapshot() ?? EMPTY_PROVIDERS_SNAPSHOT);
	const providers = configuration.status === 'ready' ? (configuration.value?.providers ?? {}) : undefined;
	const text = (zh, en) => t("menu.model") === "模型" ? zh : en;
	const state = (0, react.useSyncExternalStore)((fn) => directory.subscribe(fn), () => directory.getSnapshot());
	const [open, setOpen] = (0, react.useState)(false);
	const [pane, setPane] = (0, react.useState)("root");
	const [query, setQuery] = (0, react.useState)("");
	const [highlightedIndex, setHighlightedIndex] = (0, react.useState)(null);
	const [selectionFocus, setSelectionFocus] = (0, react.useState)(false);
	const [menuMode, setLocalMenuMode] = (0, react.useState)(() => getMenuMode());
	const [activeFlyout, setActiveFlyout] = (0, react.useState)(null);
	const [activeSubFlyout, setActiveSubFlyout] = (0, react.useState)(null);
	const flyoutTimerRef = (0, react.useRef)(null);
	const subFlyoutTimerRef = (0, react.useRef)(null);
	const flyoutRef = (0, react.useRef)(null);
	const subFlyoutRef = (0, react.useRef)(null);
	const lastActionRef = (0, react.useRef)("load");

	const switchMode = (mode) => {
		setLocalMenuMode(mode);
		setMenuMode(mode);
		setActiveFlyout(null);
		setActiveSubFlyout(null);
	};

	const clearFlyoutTimer = () => {
		if (flyoutTimerRef.current !== null) {
			clearTimeout(flyoutTimerRef.current);
			flyoutTimerRef.current = null;
		}
		if (subFlyoutTimerRef.current !== null) {
			clearTimeout(subFlyoutTimerRef.current);
			subFlyoutTimerRef.current = null;
		}
	};

	const triggerFlyout = (entry, anchorEl) => {
		clearFlyoutTimer();
		if (activeFlyout?.key === entry.key) return;
		setActiveSubFlyout(null);
		const rect = activeFlyout?.anchorRect ?? (menuRef.current ?? anchorEl).getBoundingClientRect();
		setActiveFlyout({ key: entry.key, entry, anchorRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
	};

	const triggerSubFlyout = (childGroup) => {
		clearFlyoutTimer();
		if (activeSubFlyout?.key === childGroup.key) return;
		setActiveSubFlyout({ key: childGroup.key, childGroup });
	};

	const scheduleCloseFlyout = (delay = 240) => {
		clearFlyoutTimer();
		flyoutTimerRef.current = setTimeout(() => {
			setActiveFlyout(null);
			setActiveSubFlyout(null);
		}, delay);
	};

	const scheduleCloseSubFlyout = (delay = 240) => {
		// Leaving the key panel must not let an older parent-leave timer
		// destroy both the provider and key panels.
		clearFlyoutTimer();
		subFlyoutTimerRef.current = setTimeout(() => {
			setActiveSubFlyout(null);
		}, delay);
	};
	(0, react.useEffect)(() => () => clearFlyoutTimer(), []);
	const [toast, setToast] = (0, react.useState)(null);
	const toastSeq = (0, react.useRef)(0);
	const rootRef = (0, react.useRef)(null);
	const triggerRef = (0, react.useRef)(null);
	const searchRef = (0, react.useRef)(null);
	const menuRef = (0, react.useRef)(null);
	const groupsRef = (0, react.useRef)(null);
	const [menuPos, setMenuPos] = (0, react.useState)(null);
	const itemRefs = (0, react.useRef)([]);
	const id = (0, react.useId)();
	const accountProviderName = t("provider.account");
	const groups = (0, react.useMemo)(() => orderModelProviders(state.groups).map((group) => ({
		...group,
		provider: {
			id: group.id,
			name: group.id === "deepseek-account" ? accountProviderName : group.name
		}
	})), [state.groups, accountProviderName]);
	const choices = (0, react.useMemo)(() => groups.flatMap((group) => group.models.map((model) => ({
		group,
		model,
		selection: {
			provider: group.id,
			model: model.id,
			...model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }
		}
	}))), [groups]);
	const showSearch = choices.length > 4;
	const searching = showSearch && query.trim() !== "";
	// Explicit metadata opts into native routes; omitted metadata keeps the alias
	// compatibility path byte-for-byte in charge of the legacy catalog.
	const nativeMode = nativeMetadata !== undefined && nativeMetadata !== null;
	const fullHierarchy = react.useMemo(() => nativeMode
		? buildNativeHierarchy(groups, nativeMetadata, preferences, state.current)
		: buildModelHierarchy(groups, providers, preferences, state.current), [groups, providers, preferences, state.current, nativeMetadata, nativeMode]);
	const displayGroups = react.useMemo(() => filterModelHierarchy(fullHierarchy, showSearch ? query : "", _deepseek_ai_dsh_client_ui_primitives.rankByName), [fullHierarchy, query, showSearch]);
	const expansionKeys = react.useMemo(() => hierarchyExpansionKeys(fullHierarchy), [fullHierarchy]);
	const providerCount = fullHierarchy.length;
	const visibleModels = react.useMemo(() => visibleHierarchyModels(displayGroups), [displayGroups]);
	const currentVisibleIndex = visibleModels.findIndex((model) => model.provider === state.current?.provider && model.model === state.current.model);
	const activeModelIndex = Math.min(highlightedIndex ?? Math.max(0, currentVisibleIndex), visibleModels.length - 1);
	const currentChoice = choices[state.current === null ? -1 : choices.findIndex((c) => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)];
	const reasoning = currentChoice?.model.reasoning;
	const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
	const effortLabel = currentChoice === void 0 ? void 0 : reasoning === void 0 ? state.retainedEffort : effectiveEffort === void 0 ? t("effort.providerDefault") : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
	const effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [...reasoning.defaultEffort === void 0 ? [{
		key: "provider-default",
		effort: void 0,
		label: t("effort.providerDefault")
	}] : [], ...reasoning.efforts.map((effort) => ({
		key: `effort:${effort.id}`,
		effort: effort.id,
		label: effort.name
	}))], [reasoning, t]);
	const { pending } = state;
	const busy = pending !== null;
	/** Group headers and bulk buttons; the only focus targets when every group is collapsed. */
	const groupControls = () => [...(menuRef.current?.querySelectorAll("[data-group-bulk]:not(:disabled), [data-group-toggle]:not(:disabled)") ?? [])];
	const reload = () => {
		lastActionRef.current = "load";
		load();
	};
	(0, react.useEffect)(() => {
		if (!open) return;
		const closeOutside = (event) => {
			if (rootRef.current?.contains(event.target) === true) return;
			if (menuRef.current?.contains(event.target) === true) return;
			if (flyoutRef.current?.contains(event.target) === true) return;
			if (subFlyoutRef.current?.contains(event.target) === true) return;
			setOpen(false);
			setActiveFlyout(null);
			setActiveSubFlyout(null);
		};
		document.addEventListener("pointerdown", closeOutside);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
		};
	}, [open]);
	(0, react.useLayoutEffect)(() => {
		if (!showSearch) {
			setQuery("");
			setHighlightedIndex(null);
		}
	}, [showSearch]);
	const paneFocus = (0, react.useRef)(null);
	const previousShowSearch = (0, react.useRef)(showSearch);
	(0, react.useEffect)(() => {
		const changedSearchMode = previousShowSearch.current !== showSearch;
		previousShowSearch.current = showSearch;
		const intent = paneFocus.current ?? (changedSearchMode && pane === "model" ? "drill" : null);
		paneFocus.current = null;
		if (!open || intent === null) return;
		if (intent === "drill") {
			// Never focus the search field here: on touch devices that raises the
			// on-screen keyboard the moment the model list opens. Land on the
			// current row so arrow keys and Enter still work without an IME.
			(menuRef.current?.querySelector("[role=\"menuitemradio\"][aria-checked=\"true\"]:not([disabled])") ?? itemRefs.current.find((item) => item !== null && !item.disabled) ?? groupControls()[0] ?? triggerRef.current)?.focus();
			return;
		}
		const cell = itemRefs.current[intent === "effort" ? 1 : 0];
		(cell !== null && cell !== void 0 && !cell.disabled ? cell : triggerRef.current)?.focus();
	}, [
		open,
		pane,
		showSearch
	]);
	(0, react.useEffect)(() => {
		const viewport = groupsRef.current;
		if (viewport === null) return;
		return (0, _deepseek_ai_dsh_client_ui_primitives.observeStickyMenuGroups)(viewport);
	}, [
		available,
		open,
		pane,
		displayGroups
	]);
	(0, react.useLayoutEffect)(() => {
		// Folding should not scroll away from the heading the user just pressed.
		if (document.activeElement?.matches?.("[data-group-toggle], [data-group-bulk]")) return;
		if (open && pane === "model" && activeModelIndex >= 0) itemRefs.current[activeModelIndex]?.scrollIntoView({ block: "nearest" });
	}, [
		open,
		pane,
		activeModelIndex,
		visibleModels
	]);
	(0, react.useLayoutEffect)(() => {
		if (!available || !open) {
			setMenuPos(null);
			return;
		}
		const place = () => {
			/* v8 ignore next 2 -- the trigger ref is attached whenever the menu is open. */
			const rect = triggerRef.current?.getBoundingClientRect();
			if (rect === void 0) return;
			const MARGIN = 12;
			const winW = window.innerWidth;
			const winH = window.innerHeight;
			const lw = menuRef.current?.offsetWidth ?? 0;
			const lh = menuRef.current?.offsetHeight ?? 0;
			// 窄屏（手机竖屏等）优先居中并确保不会超出屏幕左右
			let x;
			if (winW <= 480) {
				x = Math.max(MARGIN, (winW - lw) / 2);
			} else {
				x = rect.right - lw;
				if (lw > 0) x = Math.min(Math.max(x, MARGIN), winW - lw - MARGIN);
			}
			let y = rect.top - 8 - lh;
			// 如果上方空间不够容纳弹窗，向下弹出
			if (y < MARGIN && rect.bottom + 8 + lh <= winH - MARGIN) {
				y = rect.bottom + 8;
			} else {
				if (lh > 0) y = Math.min(Math.max(y, MARGIN), winH - lh - MARGIN);
			}
			setMenuPos({
				left: Math.round(x),
				top: Math.round(y)
			});
		};
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		const menu = menuRef.current;
		const observer = typeof ResizeObserver !== "undefined" && menu !== null ? new ResizeObserver(place) : null;
		if (menu !== null) observer?.observe(menu);
		return () => {
			observer?.disconnect();
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [
		available,
		open,
		pane,
		state,
		query
	]);
	const cascade = open && pane === "model" && menuMode === "panel" && !searching && activeFlyout
		? layoutModelFlyouts({ ...activeFlyout.anchorRect, ...(menuPos ?? {}) }, window.innerWidth, window.innerHeight, activeSubFlyout ? 3 : 2)
		: null;
	if (!available) return null;
	const show = () => {
		setSelectionFocus(false);
		triggerRef.current?.focus();
		setQuery("");
		setHighlightedIndex(null);
		if (currentChoice === void 0) paneFocus.current = "drill";
		setPane(currentChoice === void 0 ? "model" : "root");
		setOpen(true);
		reload();
	};
	const changeQuery = (next) => {
		setQuery(next);
		setHighlightedIndex(0);
	};
	const close = (restoreFocus = false) => {
		setOpen(false);
		setPane("root");
		setActiveFlyout(null);
		setActiveSubFlyout(null);
		if (restoreFocus) queueMicrotask(() => {
			triggerRef.current?.focus();
		});
	};
	const closeAfterSelection = () => {
		setSelectionFocus(true);
		close(true);
	};
	const drill = (next) => {
		setQuery("");
		setHighlightedIndex(null);
		paneFocus.current = "drill";
		setPane(next);
	};
	/** Leave a drilled pane for the root one, handing the keyboard back to its cell. */
	const back = (from) => {
		paneFocus.current = from;
		setPane("root");
	};
	const moveFocus = (offset) => {
		const items = itemRefs.current.filter((item) => item !== null);
		if (items.length === 0) return;
		const active = items.findIndex((item) => item === document.activeElement);
		items[active === -1 ? offset > 0 ? 0 : items.length - 1 : (active + offset + items.length) % items.length]?.focus();
	};
	const onRootKeyDown = (event) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Escape" && open) {
			event.preventDefault();
			if (pane !== "root" && currentChoice !== void 0) back(pane);
			else close(true);
			return;
		}
		if (!open) return;
		if (pane === "model" && (event.key === "ArrowDown" || event.key === "ArrowUp") && event.target !== searchRef.current) {
			event.preventDefault();
			const rows = [...(menuRef.current?.querySelectorAll('[data-group-bulk]:not(:disabled), [data-group-toggle]:not(:disabled), [data-model-choice]:not(:disabled)') ?? [])];
			const at = rows.indexOf(document.activeElement);
			rows[at < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (at + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
			return;
		}
		if (pane === "model" && event.target instanceof HTMLButtonElement && event.target.matches("[data-group-toggle]")) {
			if ((event.key === 'ArrowLeft' && event.target.getAttribute('aria-expanded') === 'true') || (event.key === 'ArrowRight' && event.target.getAttribute('aria-expanded') === 'false')) {
				event.preventDefault();
				event.target.click();
			}
			return;
		}
		if (pane === "model" && showSearch && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault();
			if (!busy && visibleModels.length > 0) {
				setHighlightedIndex((activeModelIndex + (event.key === "ArrowDown" ? 1 : -1) + visibleModels.length) % visibleModels.length);
				searchRef.current?.focus();
			}
			return;
		}
		if (pane === "model" && showSearch && event.target instanceof HTMLInputElement && (event.key === "Enter" || event.key === "Tab" && !event.shiftKey)) {
			if (event.key === "Tab" && visibleModels.length === 0) return;
			event.preventDefault();
			const highlighted = visibleModels[activeModelIndex];
			if (!busy && highlighted !== void 0) choose(highlighted);
			return;
		}
		if (event.key === "Tab" && event.shiftKey && pane === "model" && showSearch && document.activeElement === searchRef.current) {
			const controls = groupControls();
			if (controls.length > 0) {
				event.preventDefault();
				controls[0].focus();
				return;
			}
		}
		if (event.key === "Tab") {
			if (event.shiftKey) {
				event.preventDefault();
				if (pane !== "root" && currentChoice !== void 0) back(pane);
				else close(true);
				return;
			}
			const focused = document.activeElement;
			const rows = itemRefs.current.filter((item) => item !== null);
			if (focused instanceof HTMLButtonElement && rows.includes(focused)) {
				event.preventDefault();
				focused.click();
				return;
			}
			if (focused !== triggerRef.current) return;
			event.preventDefault();
			if (pane === "model" && showSearch) {
				setHighlightedIndex(null);
				searchRef.current?.focus();
				return;
			}
			(menuRef.current?.querySelector("[role=\"menuitemradio\"][aria-checked=\"true\"]:not([disabled])") ?? rows.find((item) => !item.disabled) ?? groupControls()[0])?.focus();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (itemRefs.current.some((item) => item !== null)) moveFocus(event.key === "ArrowDown" ? 1 : -1);
			else groupControls()[0]?.focus();
		}
	};
	const settleSelection = (result) => {
		if (result === void 0) return;
		if (result.ok) {
			if (rootRef.current !== null) closeAfterSelection();
			return;
		}
		const { error } = result;
		toastSeq.current += 1;
		setToast({
			seq: toastSeq.current,
			text: error.code === "session/writer-held" ? t("error.sessionInUse") : t("error.action", { message: `${error.code}: ${error.message}` })
		});
	};
	const submit = (selection) => {
		lastActionRef.current = "select";
		setSelectionFocus(true);
		triggerRef.current?.focus();
		select(selection).then(settleSelection);
	};
	const choose = (selection) => {
		if (state.current?.provider === selection.provider && state.current.model === selection.model) {
			closeAfterSelection();
			return;
		}
		submit(selection);
	};
	const chooseEffort = (effort) => {
		if (state.current === null) return;
		if (effectiveEffort === effort) {
			closeAfterSelection();
			return;
		}
		submit({
			provider: state.current.provider,
			model: state.current.model,
			...effort === void 0 ? {} : { reasoningEffort: effort }
		});
	};
	const waiting = currentChoice === void 0 && state.status === "loading";
	const currentKey = nativeMode ? undefined : decodeKeyModelId(state.current?.model);
	const nativeRoot = nativeMode ? fullHierarchy.find(entry => entry.kind === 'multi'
		? entry.children.some(child => child.id === state.current?.provider)
		: entry.id === state.current?.provider) : undefined;
	const nativeChild = nativeRoot?.kind === 'multi' ? nativeRoot.children.find(child => child.id === state.current?.provider) : undefined;
	const currentSource = currentChoice === undefined ? '' : nativeMode
		? nativeChild ? `${nativeRoot.name} / ${nativeChild.name}` : nativeRoot?.name ?? currentChoice.group.provider.name
		: currentKey ? `${currentChoice.group.provider.name} / ${keyEntryName(providers, currentChoice.group.id, currentKey.entryId)}` : currentChoice.group.provider.name;
	const modelLabel = waiting ? t("trigger.loading") : currentChoice === undefined ? t("trigger.fallback") : `${currentChoice.model.name} · ${currentSource}`;
	const triggerLabel = effortLabel === void 0 ? modelLabel : `${modelLabel} · ${effortLabel}`;
	const triggerAria = waiting ? t("trigger.loading") : currentChoice === void 0 ? t("trigger.selectAria") : effortLabel === void 0 ? t("trigger.aria", { model: modelLabel }) : t("trigger.ariaEffort", {
		model: modelLabel,
		effort: effortLabel
	});
	const renderModelLabel = (provider, model, placement, selected) => {
		// The label child slot is declared by the shipped picker's own entry; if this
		// bundle ever runs without it, degrade to the plain name instead of throwing.
		let label;
		try {
			label = renderSlot("conversation.input.model.label", {
				provider,
				model,
				placement,
				selected
			}, { fallback: model.name });
		} catch {
			label = model.name;
		}
		return (0, react_jsx_runtime.jsx)("span", {
			"data-provider-id": provider.id,
			"data-model-id": model.id,
			children: label
		});
	};
	let itemIndex = 0;
	let modelIndex = 0;
	const itemRef = () => {
		const at = itemIndex++;
		return (node) => {
			itemRefs.current[at] = node;
		};
	};
	const renderModels = (group, direct = false) => group.models.map(model => {
		const index = modelIndex++;
		const selected = state.current?.provider === group.id && state.current.model === model.id;
		return react_jsx_runtime.jsxs('button', {
			ref: itemRef(), type: 'button', role: 'menuitemradio',
			'aria-checked': selected, id: `${id}-model-${index}`,
			'data-model-choice': '', 'data-provider-id': group.id, 'data-model-id': model.id,
			tabIndex: showSearch ? -1 : 0,
			onFocus: () => setHighlightedIndex(index),
			'data-highlighted': index === activeModelIndex ? '' : undefined,
			className: clsx(ModelSelect_module_css_default.option, ModelSelect_module_css_default.modelOption, selected && ModelSelect_module_css_default.selected, index === activeModelIndex && ModelSelect_module_css_default.optionActive),
			onMouseMove: busy || index === activeModelIndex ? undefined : () => setHighlightedIndex(index),
			title: `${model.name} · ${group.provider.name} (${group.id})`, disabled: busy,
			onClick: () => choose({ provider: group.id, model: model.id }),
			children: [
				react_jsx_runtime.jsxs('span', { className: ModelSelect_module_css_default.optionCopy, children: [
					react_jsx_runtime.jsx('span', { className: ModelSelect_module_css_default.modelName, children: renderModelLabel(group.provider, model, 'option', selected) }),
					direct && react_jsx_runtime.jsx('span', { className: 'dsh-mg-source', children: group.provider.name }),
				] }),
				react_jsx_runtime.jsx('span', { className: ModelSelect_module_css_default.check, children: pending?.provider === group.id && pending.model === model.id ? react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: 'ongoing' }) : selected ? react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null }),
			],
		}, `${group.id}/${model.id}`);
	});
	const renderHeading = (key, name, expanded, count, current, contentId, major = false, route = '') => react_jsx_runtime.jsx('div', {
		'data-menu-group-heading': major ? '' : undefined,
		className: clsx('dsh-mg-groupHeading', major ? 'dsh-mg-majorHeading' : 'dsh-mg-minorHeading'),
		children: react_jsx_runtime.jsxs('button', {
			type: 'button', id: `${contentId}-heading`, 'data-group-toggle': key,
			'aria-expanded': expanded, 'aria-controls': contentId, disabled: busy || searching,
			title: searching ? text('搜索时自动展开，清空搜索后恢复', 'Expanded during search; clearing restores your groups') : route || name,
			onClick: () => { setHighlightedIndex(null); groupPreferences.setExpanded([key], !expanded); },
			children: [
				react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: expanded ? 'dsh-mg-groupArrow dsh-mg-groupArrowOpen' : 'dsh-mg-groupArrow', size: 14 }),
				react_jsx_runtime.jsx('span', { className: 'dsh-mg-groupName', children: name }),
				current && react_jsx_runtime.jsx('span', { className: 'dsh-mg-currentBadge', children: text('当前', 'Current') }),
				react_jsx_runtime.jsx('span', { className: 'dsh-mg-groupCount', children: count }),
			],
		}),
	});
	const renderHierarchy = () => displayGroups.map((entry, index) => {
		const providerId = `${id}-provider-${index}`;
		const isFlyoutMode = menuMode === 'panel' && !searching;
		const isFlyoutActive = activeFlyout?.key === entry.key;

		return react_jsx_runtime.jsxs('section', {
			role: 'group', 'aria-labelledby': `${providerId}-heading`, 'data-menu-group': '', 'data-provider-group': entry.id,
			onMouseEnter: (e) => {
				if (isFlyoutMode) {
					clearFlyoutTimer();
					triggerFlyout(entry, e.currentTarget);
				}
			},
			onMouseLeave: () => {
				if (isFlyoutMode) scheduleCloseFlyout();
			},
			children: [
				react_jsx_runtime.jsx('span', { 'aria-hidden': true, 'data-menu-group-start': '', className: 'dsh-mg-groupStart' }),
				react_jsx_runtime.jsx('div', {
					'data-menu-group-heading': '',
					className: clsx('dsh-mg-groupHeading', 'dsh-mg-majorHeading', isFlyoutActive && 'dsh-mg-active-heading'),
					children: react_jsx_runtime.jsxs('button', {
						type: 'button', id: `${providerId}-heading`, 'data-group-toggle': entry.key,
						'aria-expanded': isFlyoutMode ? isFlyoutActive : entry.expanded,
						'aria-controls': providerId, disabled: busy || searching,
						title: searching ? text('搜索时自动展开，清空搜索后恢复', 'Expanded during search; clearing restores your groups') : entry.id || entry.name,
						onClick: (e) => {
							if (isFlyoutMode) {
								if (isFlyoutActive) { clearFlyoutTimer(); setActiveFlyout(null); setActiveSubFlyout(null); }
								else triggerFlyout(entry, e.currentTarget);
							} else {
								setHighlightedIndex(null);
								groupPreferences.setExpanded([entry.key], !entry.expanded);
							}
						},
						children: [
							react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, {
								className: (isFlyoutMode ? isFlyoutActive : entry.expanded) ? 'dsh-mg-groupArrow dsh-mg-groupArrowOpen' : 'dsh-mg-groupArrow',
								size: 14
							}),
							react_jsx_runtime.jsx('span', { className: 'dsh-mg-groupName', children: entry.name }),
							entry.current && react_jsx_runtime.jsx('span', { className: 'dsh-mg-currentBadge', children: text('当前', 'Current') }),
							react_jsx_runtime.jsx('span', { className: 'dsh-mg-groupCount', children: entry.modelCount }),
						],
					}),
				}),
				!isFlyoutMode && react_jsx_runtime.jsx('div', {
					id: providerId, hidden: !entry.expanded, className: entry.kind === 'multi' ? 'dsh-mg-majorContent' : undefined,
					children: entry.expanded && (entry.kind !== 'multi' ? renderModels(entry.group) : entry.children.map((group, childIndex) => {
						const keyId = `${providerId}-key-${childIndex}`;
						const name = group.legacy ? text('原单密钥（兼容旧会话）', 'Legacy single key (existing session)') : group.name;
						return react_jsx_runtime.jsxs('section', {
							role: 'group', 'aria-labelledby': `${keyId}-heading`, 'data-key-entry': group.entryId ?? '@legacy',
							children: [
								renderHeading(group.key, name, group.expanded, group.models.length, group.current, keyId, false, `${entry.name} / ${name}`),
								react_jsx_runtime.jsx('div', { id: keyId, hidden: !group.expanded, className: 'dsh-mg-minorContent', children: group.expanded && renderModels(group) }),
							],
						}, group.key);
					}))
				}),
			],
		}, entry.key);
	});
	return (0, react_jsx_runtime.jsxs)("div", {
		ref: rootRef,
		className: ModelSelect_module_css_default.root,
		"data-model-groups-plugin": "0.3.0",
		onKeyDown: onRootKeyDown,
		onMouseDown: (event) => {
			if (event.target instanceof Element && event.target.closest("[data-group-toggle], [data-group-bulk]") !== null) return;
			if (event.target instanceof Element && event.target.closest("button") !== null) event.preventDefault();
		},
		children: [
			(0, react_jsx_runtime.jsxs)("button", {
				ref: triggerRef,
				type: "button",
				className: ModelSelect_module_css_default.trigger,
				"aria-label": triggerAria,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"aria-controls": open ? `${id}-menu` : void 0,
				title: triggerLabel,
				"aria-busy": busy,
				"data-selection-focus": selectionFocus ? "" : void 0,
				onBlur: () => {
					setSelectionFocus(false);
				},
				disabled: locked,
				onClick: () => {
					if (open) close(true);
					else show();
				},
				children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutlineRegular, {
						className: ModelSelect_module_css_default.triggerIcon,
						size: 16
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ModelSelect_module_css_default.triggerLabel,
						children: currentChoice === void 0 ? modelLabel : react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [renderModelLabel(currentChoice.group.provider, currentChoice.model, "trigger", true), react_jsx_runtime.jsx('span', { className: 'dsh-mg-triggerSource', children: ` · ${currentSource}` })] })
					}),
					effortLabel !== void 0 && (0, react_jsx_runtime.jsx)("span", {
						className: ModelSelect_module_css_default.triggerEffort,
						children: effortLabel
					}),
					busy ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: clsx(ModelSelect_module_css_default.chevron, open && ModelSelect_module_css_default.chevronOpen) })
				]
			}),
			open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
				ref: menuRef,
				id: `${id}-menu`,
				className: clsx(ModelSelect_module_css_default.menu, cascade && "dsh-mg-cascade-panel"),
				"data-flyout-level": cascade ? "0" : undefined,
				style: cascade?.[0] ?? menuPos ?? MEASURE_STYLE,
				role: pane === "model" ? "group" : "menu",
				"aria-label": t("menu.aria"),
				"aria-busy": state.status === "loading" || busy,
				children: [
					pane === "root" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("button", {
						ref: itemRef(),
						type: "button",
						role: "menuitem",
						className: ModelSelect_module_css_default.cell,
						onClick: () => {
							drill("model");
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.cellLabel,
								children: t("menu.model")
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.cellValue,
								children: currentChoice === void 0 ? modelLabel : react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, { children: [renderModelLabel(currentChoice.group.provider, currentChoice.model, "menu", true), ` · ${currentSource}`] })
							}),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.cellChevron })
						]
					}), reasoning !== void 0 && (0, react_jsx_runtime.jsxs)("button", {
						ref: itemRef(),
						type: "button",
						role: "menuitem",
						className: ModelSelect_module_css_default.cell,
						onClick: () => {
							drill("effort");
						},
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.cellLabel,
								children: t("menu.effort")
							}),
							(0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.cellValue,
								children: effortLabel
							}),
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.cellChevron })
						]
					})] }),
					pane === "model" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						showSearch && (0, react_jsx_runtime.jsxs)("div", {
							className: ModelSelect_module_css_default.searchRow,
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								ref: searchRef,
								className: clsx(ModelSelect_module_css_default.search, query !== "" && ModelSelect_module_css_default.searchWithQuery),
								type: "text",
								role: "searchbox",
								"aria-label": t("search.placeholder"),
								"aria-controls": `${id}-models`,
								"aria-activedescendant": activeModelIndex < 0 ? void 0 : `${id}-model-${activeModelIndex}`,
								placeholder: t("search.placeholder"),
								value: query,
								readOnly: busy,
								onChange: (event) => {
									changeQuery(event.target.value);
								}
							}), query !== "" && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ModelSelect_module_css_default.searchClear,
								"aria-label": t("search.clear"),
								disabled: busy,
								onClick: () => {
									changeQuery("");
									searchRef.current?.focus();
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFillRegular, {})
							})]
						}),
						choices.length > 0 && react_jsx_runtime.jsxs("div", {
							className: "dsh-mg-toolbar",
							role: "group",
							"aria-label": text("模型分组", "Model groups"),
							children: [
								react_jsx_runtime.jsx("span", { className: "dsh-mg-summary", children: searching ? text("搜索中 · 展开匹配", "Search active") : text(`${providerCount} 供应商 · ${fullHierarchy.reduce((sum, entry) => sum + entry.modelCount, 0)} 模型`, `${providerCount} providers · ${fullHierarchy.reduce((sum, entry) => sum + entry.modelCount, 0)} models`) }),
								react_jsx_runtime.jsxs("div", {
									className: "dsh-mg-toolbar-actions",
									children: [true, false].map(expanded => react_jsx_runtime.jsx("button", {
										type: "button", "data-group-bulk": expanded ? "expand" : "collapse",
										disabled: busy || searching || expansionKeys.length === 0,
										onClick: () => { setHighlightedIndex(null); groupPreferences.setExpanded(expansionKeys, expanded); },
										children: expanded ? text("展开全部", "Expand") : text("收起全部", "Collapse"),
									}, String(expanded)))
								})
							],
						}),
						state.status === "loading" && (0, react_jsx_runtime.jsx)("div", {
							className: ModelSelect_module_css_default.status,
							children: t("status.loading")
						}),
						state.error !== null && lastActionRef.current === "load" && (0, react_jsx_runtime.jsxs)("div", {
							className: ModelSelect_module_css_default.error,
							children: [(0, react_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ModelSelect_module_css_default.retry,
								onClick: reload,
								children: t("retry")
							})]
						}),
						state.failures.map((failure) => (0, react_jsx_runtime.jsxs)("div", {
							className: ModelSelect_module_css_default.warning,
							children: [(0, react_jsx_runtime.jsx)("span", { children: t("warning.groupLoad", {
								name: failure.id === "deepseek-account" ? t("provider.account") : failure.name,
								message: failure.message
							}) }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: ModelSelect_module_css_default.retry,
								onClick: reload,
								children: t("retry")
							})]
						}, failure.id)),
						(0, react_jsx_runtime.jsx)("div", {
							ref: groupsRef,
							id: `${id}-models`,
							className: clsx(ModelSelect_module_css_default.groups, "scrollable"),
							role: "menu",
							"aria-label": t("menu.model"),
							hidden: displayGroups.length === 0,
							children: renderHierarchy()
						}),
						state.status === "ready" && displayGroups.length === 0 && (0, react_jsx_runtime.jsx)("div", {
							className: ModelSelect_module_css_default.empty,
							role: "status",
							children: t(choices.length === 0 ? "empty.models" : "search.empty")
						}),
						!searching && choices.length > 0 && react_jsx_runtime.jsxs("div", {
							className: "dsh-mg-modebar",
							children: [
								react_jsx_runtime.jsx("span", { children: text("展示模式", "View") }),
								react_jsx_runtime.jsxs("div", {
									style: { display: "flex", gap: "6px" },
									children: [
										react_jsx_runtime.jsx("button", {
											type: "button",
											className: "dsh-mg-mode-btn",
											"data-active": menuMode === "panel",
											onClick: () => switchMode("panel"),
											children: text("侧边面板", "Flyout"),
										}),
										react_jsx_runtime.jsx("button", {
											type: "button",
											className: "dsh-mg-mode-btn",
											"data-active": menuMode === "inline",
											onClick: () => switchMode("inline"),
											children: text("原地折叠", "Inline"),
										}),
									]
								})
							]
						})
					] }),
					pane === "effort" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [state.error !== null && lastActionRef.current === "load" && (0, react_jsx_runtime.jsxs)("div", {
						className: ModelSelect_module_css_default.error,
						children: [(0, react_jsx_runtime.jsx)("span", { children: t("error.action", { message: state.error }) }), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: ModelSelect_module_css_default.retry,
							onClick: reload,
							children: t("action.reload")
						})]
					}), effortChoices.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: ModelSelect_module_css_default.empty,
						children: t("empty.efforts")
					}) : effortChoices.map((level) => (0, react_jsx_runtime.jsxs)("button", {
						ref: itemRef(),
						type: "button",
						role: "menuitemradio",
						"aria-checked": effectiveEffort === level.effort,
						className: clsx(ModelSelect_module_css_default.option, effectiveEffort === level.effort && ModelSelect_module_css_default.selected),
						disabled: busy,
						onClick: () => {
							chooseEffort(level.effort);
						},
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.optionCopy,
							children: (0, react_jsx_runtime.jsx)("span", {
								className: ModelSelect_module_css_default.modelName,
								children: level.label
							})
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ModelSelect_module_css_default.check,
							children: pending !== null && pending.provider === state.current?.provider && pending.model === state.current.model && pending.reasoningEffort === level.effort ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "ongoing" }) : effectiveEffort === level.effort ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, {}) : null
						})]
					}, level.key))] })
				]
			}), document.body),
			cascade !== null && activeFlyout !== null && (0, react_dom.createPortal)(
				react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
					ref: flyoutRef,
					className: clsx(ModelSelect_module_css_default.menu, "dsh-mg-cascade-panel"),
					"data-flyout-level": "1",
					style: { ...cascade[1], position: "fixed", margin: 0 },
					onMouseEnter: clearFlyoutTimer,
					onMouseLeave: () => scheduleCloseFlyout(200),
					onMouseDown: (e) => {
						if (e.target instanceof Element && e.target.closest("button") !== null) e.preventDefault();
					},
					children: react_jsx_runtime.jsx("div", {
						className: clsx(ModelSelect_module_css_default.groups, "scrollable"),
						children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.MenuGroup, {
							label: `${activeFlyout.entry.name} (${activeFlyout.entry.modelCount})`,
							children: activeFlyout.entry.kind !== "multi" ? renderModels(activeFlyout.entry.group) : activeFlyout.entry.children.map((childGroup) => {
								const name = childGroup.legacy ? text("原单密钥（兼容旧会话）", "Legacy single key (existing session)") : childGroup.name;
								const isSubActive = activeSubFlyout?.key === childGroup.key;
								return react_jsx_runtime.jsxs("button", {
									type: "button",
									className: clsx(ModelSelect_module_css_default.option, isSubActive && ModelSelect_module_css_default.optionActive),
									"data-active": isSubActive ? "true" : "false",
									onMouseEnter: (e) => {
										clearFlyoutTimer();
										triggerSubFlyout(childGroup, e.currentTarget);
									},
									onMouseLeave: () => scheduleCloseSubFlyout(200),
									onClick: (e) => {
										if (isSubActive) setActiveSubFlyout(null);
										else triggerSubFlyout(childGroup, e.currentTarget);
									},
									children: [
										react_jsx_runtime.jsx("span", { className: ModelSelect_module_css_default.modelName, children: name }),
										childGroup.current && react_jsx_runtime.jsx("span", { className: "dsh-mg-currentBadge", children: text("当前", "Current") }),
										react_jsx_runtime.jsx("span", { className: "dsh-mg-groupCount", children: childGroup.models.length }),
										react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { className: ModelSelect_module_css_default.cellChevron, size: 12 }),
									]
								}, childGroup.key);
							})
						})
					})
				}),
				document.body
			),
			cascade !== null && activeSubFlyout !== null && (0, react_dom.createPortal)(
				react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.MenuSurface, {
					ref: subFlyoutRef,
					className: clsx(ModelSelect_module_css_default.menu, "dsh-mg-cascade-panel"),
					"data-flyout-level": "2",
					style: { ...cascade[2], position: "fixed", margin: 0 },
					onMouseEnter: clearFlyoutTimer,
					onMouseLeave: () => scheduleCloseSubFlyout(200),
					onMouseDown: (e) => {
						if (e.target instanceof Element && e.target.closest("button") !== null) e.preventDefault();
					},
					children: react_jsx_runtime.jsx("div", {
						className: clsx(ModelSelect_module_css_default.groups, "scrollable"),
						children: react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.MenuGroup, {
							label: `${activeSubFlyout.childGroup.legacy ? text("原单密钥（兼容旧会话）", "Legacy single key (existing session)") : activeSubFlyout.childGroup.name} (${activeSubFlyout.childGroup.models.length})`,
							children: renderModels(activeSubFlyout.childGroup)
						})
					})
				}),
				document.body
			),
			toast !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
				text: toast.text,
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
				anchor: rootRef.current?.closest("[data-composer-card]") ?? null,
				onDone: () => {
					setToast(null);
				}
			}, toast.seq)
		]
	});
}
