// Scoped styles rendered by React: no global DOM mutation, primitive imports, or portal.
export const styles = `
.mg-ui { color:var(--dsw-alias-label-primary, inherit); font:inherit; min-width:0; max-width:100%; overflow-wrap:anywhere; container-type:inline-size; }
.mg-ui *, .mg-ui *::before, .mg-ui *::after { box-sizing:border-box; }
.mg-ui button,.mg-ui input,.mg-ui select,.mg-ui textarea { font:inherit; color:inherit; min-height:44px; max-width:100%; border:1px solid var(--dsw-alias-border-l1, #8888); border-radius:8px; background:var(--dsw-alias-interactive-bg-hover, transparent); }
.mg-ui button { padding:9px 12px; white-space:normal; overflow-wrap:anywhere; cursor:pointer; text-align:start; }
.mg-ui button:disabled { opacity:.55; cursor:not-allowed; }
.mg-ui button[aria-pressed=true] { border-color:var(--dsw-alias-state-business-primary, currentColor); background:var(--dsw-alias-interactive-bg-hover, #8882); }
.mg-ui :focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, currentColor); outline-offset:2px; }
.mg-ui input,.mg-ui select,.mg-ui textarea { width:100%; padding:9px; }
.mg-ui textarea { min-height:100px; resize:vertical; }
.mg-ui label { display:grid; gap:6px; min-width:0; }
.mg-ui fieldset { min-width:0; border:1px solid var(--dsw-alias-border-l1, #8888); border-radius:10px; padding:12px; margin:0; }
.mg-ui legend { overflow-wrap:anywhere; max-width:100%; }
.mg-ui .mg-stack { display:flex; flex-direction:column; gap:10px; min-width:0; }
.mg-ui .mg-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.mg-ui .mg-panel { border:1px solid var(--dsw-alias-border-l1, #8888); border-radius:12px; padding:12px; background:var(--dsw-alias-bg-base, transparent); margin-block:8px; }
.mg-ui .mg-columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; align-items:start; }
.mg-ui .mg-list { display:flex; flex-direction:column; gap:6px; min-width:0; }
.mg-ui .mg-child { margin-inline-start:10px; border-inline-start:2px solid var(--dsw-alias-border-l1, #8888); padding-inline-start:10px; }
.mg-ui .mg-muted { opacity:.75; font-size:.9em; }
.mg-ui .mg-error { color:var(--dsw-alias-label-primary, inherit); border-inline-start:3px solid currentColor; padding:8px; }
.mg-ui .mg-current { margin:0; }
.mg-ui .mg-model-text { display:var(--dsh-composer-model-text-display, inline); }
.mg-ui .mg-model-icon { display:var(--dsh-composer-model-icon-display, none); }
@container (max-width:600px) { .mg-ui .mg-columns { grid-template-columns:minmax(0,1fr); } .mg-ui .mg-child { margin-inline-start:4px; padding-inline-start:6px; } }
@media (max-width:600px) { .mg-ui .mg-columns { grid-template-columns:minmax(0,1fr); } }
`;
