// Public primitives are supplied by the client host. The small semantic
// fallbacks also let the same editor render in isolated browser tests.
export function createLegacyPrimitives(React, supplied = {}) {
  const h = React.createElement;
  const css = key => `dsh-mg-native-${key}`;
  const glyph = d => ({ size = 16 }) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d }));
  function Switch({ checked, label, onChange, disabled, ...props }) {
    return h('input', { ...props, className: 'dsh-mg-native-switch', type: 'checkbox', role: 'switch', 'aria-label': label, checked, disabled, onChange: event => onChange?.(event.target.checked) });
  }
  function Checkbox({ checked, label, onChange, disabled }) {
    return h('label', { className: 'dsh-mg-native-checkbox' }, h('input', { type: 'checkbox', checked, disabled, onChange: event => onChange?.(event.target.checked) }), label);
  }
  function Modal({ open, onClose, title, description, footer, children, className = '', closeLabel = '关闭', ...props }) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const node = ref.current;
      if (!node) return;
      if (open && !node.open) node.showModal?.();
      else if (!open && node.open) node.close?.();
    }, [open]);
    if (!open) return null;
    return h('dialog', { ...props, ref, className: `dsh-mg-native-modal ${className}`, onCancel: event => { event.preventDefault(); onClose?.(); }, onClick: event => { if (event.target === event.currentTarget) onClose?.(); } },
      h('div', { className: 'dsh-mg-native-modalHead' }, h('h2', null, title), h('button', { type: 'button', className: css('iconButton'), 'aria-label': closeLabel, onClick: onClose }, '×')),
      description ? h('p', { className: css('advancedHint') }, description) : null,
      h('div', { className: 'dsh-mg-native-modalBody' }, children), h('div', { className: css('editorActions') }, footer));
  }
  return {
    Switch, Checkbox, Modal,
    Button: ({ children, variant, size, className = '', ...props }) => h('button', { type: 'button', ...props, className: `${css(variant === 'ghost' ? 'linkButton' : 'secondaryButton')} ${className}` }, children),
    Tooltip: ({ children, label }) => h('span', { title: label, style: { display: 'contents' } }, children),
    AnimatedRows: ({ children, className }) => h('div', { className }, children),
    IconDragHandleOutlineRegular: glyph('M5 3h.01M11 3h.01M5 8h.01M11 8h.01M5 13h.01M11 13h.01'),
    IconChevronRightOutlineRegular: glyph('m6 4 4 4-4 4'),
    IconChevronDownOutlineRegular: glyph('m4 6 4 4 4-4'),
    IconTrashOutlineRegular: glyph('M3 4h10M6 4V2.5h4V4M4.5 4l.5 9h6l.5-9M7 6.5v4M9 6.5v4'),
    IconPlusOutlineRegular: glyph('M8 3v10M3 8h10'),
    ...supplied,
  };
}
