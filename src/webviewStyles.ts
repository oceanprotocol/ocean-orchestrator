export function webviewCss(): string {
  return `
/* =========================================================================
   CUSTOM PROPERTIES — spacing scale, radius, type scale
   ========================================================================= */
:root {
  /* 8px spacing scale */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;

  /* Radius: 4px for interactive elements, 6px for structural containers */
  --radius-sm: 4px;
  --radius-md: 6px;

  /* Type scale — all relative to inherited font-size */
  --fs-xs: 0.75em;
  --fs-sm: 0.85em;
  --fs-base: 1em;
  --fs-lg: 1.1em;
  --fs-xl: 1.25em;

  /* Motion — one easing only */
  --transition: 150ms ease;
}

/* =========================================================================
   RESET & BASE
   ========================================================================= */
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.5;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}

a {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}

/* =========================================================================
   TYPOGRAPHY HELPERS
   ========================================================================= */

/* Section label — small-caps, letter-spaced, muted */
.label-section {
  display: block;
  font-size: var(--fs-xs);
  font-variant: small-caps;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
  margin-bottom: var(--sp-2);
}

.text-muted {
  color: var(--vscode-descriptionForeground);
  font-size: var(--fs-sm);
}

.text-xs {
  font-size: var(--fs-xs);
  color: var(--vscode-descriptionForeground);
}

.mono {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--fs-sm);
}

/* =========================================================================
   TOOLBAR
   ========================================================================= */
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  position: sticky;
  top: 0;
  z-index: 10;
}

.toolbar-title {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
}

/* =========================================================================
   LAYOUT HELPERS
   ========================================================================= */
.content {
  padding: var(--sp-4);
}

.section {
  margin-bottom: var(--sp-5);
}

.section:last-child {
  margin-bottom: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.col {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* =========================================================================
   CARD
   ========================================================================= */
.card {
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
}

.card + .card {
  margin-top: var(--sp-3);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.card-title {
  font-size: var(--fs-base);
  font-weight: 600;
  margin: 0;
}

/* =========================================================================
   BUTTONS
   ========================================================================= */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  font-family: inherit;
  font-size: var(--fs-sm);
  font-weight: 500;
  padding: var(--sp-1) var(--sp-3);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition), border-color var(--transition), opacity var(--transition);
  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
  line-height: 1.4;
  user-select: none;
}

.btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.btn:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Primary — filled, high emphasis */
.btn-pri {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: transparent;
}

.btn-pri:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

/* Danger — error-tinted, destructive actions */
.btn-danger {
  background: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
  border-color: transparent;
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.85;
}

/* Ghost — outline only, lowest emphasis */
.btn-ghost {
  background: transparent;
  color: var(--vscode-foreground);
  border-color: var(--vscode-panel-border);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-panel-border);
}

/* Size variants */
.btn-sm {
  font-size: var(--fs-xs);
  padding: 5px var(--sp-3);
}

.btn-icon {
  padding: var(--sp-1);
  min-width: 26px;
}

/* =========================================================================
   INPUTS & SELECTS
   ========================================================================= */
.input,
input[type="text"],
input[type="number"],
input[type="url"],
select,
textarea {
  font-family: inherit;
  font-size: var(--fs-base);
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: var(--radius-sm);
  padding: var(--sp-1) var(--sp-2);
  width: 100%;
  box-sizing: border-box;
  transition: border-color var(--transition);
  line-height: 1.4;
}

.input:focus,
input[type="text"]:focus,
input[type="number"]:focus,
input[type="url"]:focus,
select:focus,
textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.input.invalid,
input.invalid {
  border-color: var(--vscode-errorForeground);
}

label {
  display: block;
  font-size: var(--fs-sm);
  color: var(--vscode-descriptionForeground);
  margin-bottom: var(--sp-1);
}

/* =========================================================================
   RANGE SLIDER
   ========================================================================= */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 2px;
  background: var(--vscode-scrollbarSlider-background);
  border-radius: 1px;
  outline: none;
  cursor: pointer;
  padding: 0;
  border: none;
  margin: var(--sp-2) 0;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vscode-button-background);
  cursor: pointer;
  border: none;
  transition: background var(--transition);
}

input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vscode-button-background);
  cursor: pointer;
  border: none;
  transition: background var(--transition);
}

input[type="range"]:hover::-webkit-slider-thumb {
  background: var(--vscode-button-hoverBackground);
}

input[type="range"]:hover::-moz-range-thumb {
  background: var(--vscode-button-hoverBackground);
}

input[type="range"]:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 3px;
}

.range-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.range-value {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--fs-sm);
  color: var(--vscode-foreground);
  min-width: 3.5em;
  text-align: right;
  flex-shrink: 0;
}

/* =========================================================================
   TABLE
   ========================================================================= */
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-md);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

thead {
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
}

th {
  text-align: left;
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
}

td {
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--vscode-panel-border);
  vertical-align: middle;
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr.clickable {
  cursor: pointer;
}

tbody tr.clickable:hover {
  background: var(--vscode-list-hoverBackground);
}

/* =========================================================================
   STATUS DOTS & BADGES
   Signature: Running is the ONLY animated state — a breathing pulse ring.
   All others are static; stillness carries meaning (done or broken = no motion).
   ========================================================================= */

/* Keyframe — used only by .status-dot.running */
@keyframes status-pulse {
  0%   { box-shadow: 0 0 0 0 var(--pulse-color, currentColor); }
  70%  { box-shadow: 0 0 0 5px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes status-pulse {
    0%, 100% { box-shadow: none; }
  }
}

/* Dot — inline, used next to text */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  vertical-align: middle;
}

.status-dot.running {
  background: var(--vscode-charts-blue);
  --pulse-color: var(--vscode-charts-blue);
  animation: status-pulse 2s ease-in-out infinite;
}

.status-dot.completed {
  background: var(--vscode-charts-green, var(--vscode-testing-iconPassed));
}

.status-dot.failed {
  background: var(--vscode-errorForeground);
}

.status-dot.stopped {
  background: var(--vscode-descriptionForeground);
}

.status-dot.queued {
  background: var(--vscode-charts-yellow);
}

/* Badge — pill with background, used in tables and cards */
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 2px var(--sp-2);
  border-radius: 10px;
  white-space: nowrap;
  line-height: 1.5;
}

.status-badge::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-badge.running {
  color: var(--vscode-charts-blue);
  background: transparent;
  background: color-mix(in srgb, var(--vscode-charts-blue) 12%, transparent);
}

.status-badge.running::before {
  animation: status-pulse 2s ease-in-out infinite;
  --pulse-color: var(--vscode-charts-blue);
}

.status-badge.completed {
  color: var(--vscode-charts-green, var(--vscode-testing-iconPassed));
  background: transparent;
  background: color-mix(in srgb, var(--vscode-charts-green, var(--vscode-testing-iconPassed)) 12%, transparent);
}

.status-badge.failed {
  color: var(--vscode-errorForeground);
  background: transparent;
  background: color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent);
}

.status-badge.stopped {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-list-hoverBackground);
}

.status-badge.queued {
  color: var(--vscode-charts-yellow);
  background: transparent;
  background: color-mix(in srgb, var(--vscode-charts-yellow) 12%, transparent);
}

/* =========================================================================
   EMPTY & LOCKED STATES
   ========================================================================= */
.empty-state {
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: var(--fs-sm);
}

.empty-state strong {
  display: block;
  color: var(--vscode-foreground);
  font-size: var(--fs-base);
  margin-bottom: var(--sp-2);
}

.locked-state {
  padding: var(--sp-6) var(--sp-4);
  text-align: center;
  color: var(--vscode-descriptionForeground);
}

.locked-state strong {
  display: block;
  color: var(--vscode-foreground);
  font-size: var(--fs-lg);
  margin-bottom: var(--sp-2);
}

/* =========================================================================
   MODAL
   ========================================================================= */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--vscode-widget-shadow, #000) 45%, transparent);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-backdrop.open {
  display: flex;
}

.modal-card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-md);
  padding: var(--sp-5);
  min-width: 420px;
  max-width: 580px;
  max-height: 80vh;
  overflow: auto;
}

.modal-card h3 {
  margin: 0 0 var(--sp-4);
  font-size: var(--fs-lg);
}

.modal-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--vscode-panel-border);
}

/* =========================================================================
   TOAST NOTIFICATION
   ========================================================================= */
.toast {
  position: fixed;
  bottom: var(--sp-5);
  left: 50%;
  transform: translateX(-50%);
  background: var(--vscode-notifications-background, var(--vscode-editor-background));
  color: var(--vscode-notifications-foreground, var(--vscode-foreground));
  border: 1px solid var(--vscode-panel-border);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  display: none;
  z-index: 200;
  max-width: 80%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast.open {
  display: block;
}

.toast.error {
  border-color: var(--vscode-errorForeground);
  color: var(--vscode-errorForeground);
}

/* =========================================================================
   LOADING OVERLAY
   ========================================================================= */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--vscode-widget-shadow, #000) 20%, transparent);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 50;
  color: var(--vscode-foreground);
  font-size: var(--fs-sm);
}

.loading-overlay.open {
  display: flex;
}

/* =========================================================================
   DIVIDER
   ========================================================================= */
.divider {
  border: none;
  border-top: 1px solid var(--vscode-panel-border);
  margin: var(--sp-4) 0;
}

/* =========================================================================
   CODE INLINE
   ========================================================================= */
code {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--fs-xs);
  background: var(--vscode-textBlockQuote-background);
  padding: 1px var(--sp-1);
  border-radius: var(--radius-sm);
}
`
}
