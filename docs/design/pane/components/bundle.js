/* @ds-bundle: {"format":4,"namespace":"Pane","components":[{"name":"Button"},{"name":"Switch"},{"name":"Checkbox"},{"name":"RadioGroup"},{"name":"TextField"},{"name":"SearchField"},{"name":"SegmentedControl"},{"name":"Slider"},{"name":"ProgressIndicator"},{"name":"PopUpButton"},{"name":"Menu"},{"name":"Sidebar"},{"name":"Toolbar"},{"name":"Window"},{"name":"Alert"},{"name":"TabView"},{"name":"GroupBox"},{"name":"Icon"},{"name":"Avatar"},{"name":"Tag"},{"name":"ConversationList"},{"name":"ChatHeader"},{"name":"Message"},{"name":"MessageActions"},{"name":"Reactions"},{"name":"ReadReceipt"},{"name":"ThreadSummary"},{"name":"FileAttachment"},{"name":"ImageAttachment"},{"name":"DocLink"},{"name":"MessageCard"},{"name":"ChatNotice"},{"name":"PinnedBanner"},{"name":"Composer"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;

  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function useControlled(value, defaultValue) {
    var s = useState(defaultValue);
    var controlled = value !== undefined;
    return [controlled ? value : s[0], function (v) { if (!controlled) s[1](v); }];
  }

  /* ---------- Icon: original line glyphs in the spirit of SF Symbols (not Apple artwork) ---------- */
  var P = {
    folder: 'M2.5 5.2c0-.9.7-1.7 1.7-1.7h3l1.6 1.6h5c.9 0 1.7.8 1.7 1.7v6.1c0 .9-.8 1.6-1.7 1.6H4.2c-1 0-1.7-.7-1.7-1.6z M2.5 7.3h13',
    doc: 'M5 2.5h5.2L14 6.3v8.1c0 .6-.5 1.1-1.1 1.1H5c-.6 0-1.1-.5-1.1-1.1V3.6c0-.6.5-1.1 1.1-1.1z M10 2.7v3.8h3.8',
    clock: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 5.3V9l2.6 1.6',
    star: 'M9 2.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L9 12.4l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
    tray: 'M2.5 10.2l2-6.2c.2-.5.6-.8 1.1-.8h6.8c.5 0 .9.3 1.1.8l2 6.2v3.6c0 .9-.7 1.7-1.7 1.7H4.2c-.9 0-1.7-.8-1.7-1.7z M2.6 10.2h3.8l.9 1.9h3.4l.9-1.9h3.8',
    trash: 'M3.5 4.8h11 M7.2 4.8V3.3h3.6v1.5 M4.8 4.8l.7 9.6c0 .6.5 1.1 1.1 1.1h4.8c.6 0 1.1-.5 1.1-1.1l.7-9.6 M7.6 7.5v5.5 M10.4 7.5v5.5',
    cloud: 'M5.3 14.2a3.3 3.3 0 0 1-.5-6.6 4.4 4.4 0 0 1 8.5.9 2.9 2.9 0 0 1-.3 5.7z',
    gear: 'M9 11.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z M9 2.3v1.9 M9 13.8v1.9 M2.3 9h1.9 M13.8 9h1.9 M4.3 4.3l1.3 1.3 M12.4 12.4l1.3 1.3 M4.3 13.7l1.3-1.3 M12.4 5.6l1.3-1.3',
    plus: 'M9 3.5v11 M3.5 9h11',
    minus: 'M3.5 9h11',
    sidebar: 'M3.8 3.5h10.4c.7 0 1.3.6 1.3 1.3v8.4c0 .7-.6 1.3-1.3 1.3H3.8c-.7 0-1.3-.6-1.3-1.3V4.8c0-.7.6-1.3 1.3-1.3z M7 3.5v11 M4.2 6h1.2 M4.2 8h1.2',
    'chevron-left': 'M11 3.5L5.5 9l5.5 5.5',
    'chevron-right': 'M7 3.5L12.5 9 7 14.5',
    'chevron-updown': 'M5.5 7L9 3.5 12.5 7 M5.5 11L9 14.5l3.5-3.5',
    share: 'M9 11V2.8 M6.2 5.4L9 2.6l2.8 2.8 M6.3 7.6H5c-.8 0-1.5.7-1.5 1.5v5c0 .8.7 1.5 1.5 1.5h8c.8 0 1.5-.7 1.5-1.5v-5c0-.8-.7-1.5-1.5-1.5h-1.3',
    search: 'M8 13.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z M11.8 11.8l3.7 3.7',
    check: 'M3.8 9.4l3.3 3.3 7.1-7.4',
    xmark: 'M4.5 4.5l9 9 M13.5 4.5l-9 9',
    grid: 'M3 3h4.5v4.5H3z M10.5 3H15v4.5h-4.5z M3 10.5h4.5V15H3z M10.5 10.5H15V15h-4.5z',
    list: 'M6.5 4.5H15 M6.5 9H15 M6.5 13.5H15 M3 4.5h.5 M3 9h.5 M3 13.5h.5',
    tag: 'M2.8 3.8v4.5l6.9 6.9c.4.4 1.1.4 1.5 0l4-4c.4-.4.4-1.1 0-1.5L8.3 2.8H3.8c-.6 0-1 .4-1 1z M5.8 6.3h.1',
    download: 'M9 2.8v8.4 M5.8 8.2L9 11.4l3.2-3.2 M3 13.2v.8c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5v-.8',
    desktop: 'M2.5 3.5h13v8.5h-13z M6.5 15h5 M9 12v3',
    wifi: 'M2.6 7a9.3 9.3 0 0 1 12.8 0 M4.8 9.4a6.2 6.2 0 0 1 8.4 0 M7 11.8a3 3 0 0 1 4 0 M9 14.3h.01',
    bell: 'M4.5 12.5V8.2a4.5 4.5 0 0 1 9 0v4.3l1.2 1.3H3.3z M7.5 15.5h3',
    person: 'M9 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.5 15.5c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5',
    warning: 'M9 2.7l7 12.3H2z M9 7.2v3.6 M9 12.9h.01',
    smile: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M6.3 10.6c.7.9 1.6 1.4 2.7 1.4s2-.5 2.7-1.4 M6.8 7.2h.01 M11.2 7.2h.01',
    at: 'M11.8 9a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0z M11.8 9v1.2c0 1.2.8 1.9 1.7 1.9s1.9-.8 1.9-3.1A6.4 6.4 0 1 0 12 14.7',
    image: 'M3.5 3.5h11c.6 0 1 .4 1 1v9c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1v-9c0-.6.4-1 1-1z M2.8 12.3l3.6-3.6 3 3 2-2 3.8 3.8 M11.8 7.2h.01',
    paperclip: 'M14.6 8.6l-5.9 5.9a3.4 3.4 0 0 1-4.8-4.8L10 3.6a2.3 2.3 0 0 1 3.2 3.2l-6 6a1.1 1.1 0 0 1-1.6-1.6l5.5-5.5',
    scissors: 'M5 6.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5 15.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M6.6 5.9L15 13 M6.6 12.1L15 5',
    textformat: 'M2.8 14.5L6.4 4.5h.8l3.6 10 M4.1 11h5.4 M12.2 9.3c.4-.6 1-.9 1.7-.9 1 0 1.6.6 1.6 1.6v4.5 M15.5 11.8h-1.8c-1 0-1.6.5-1.6 1.3s.6 1.4 1.4 1.4c.9 0 2-.6 2-1.8',
    send: 'M9 14.5V3.8 M4.5 8.2L9 3.6l4.5 4.6',
    reply: 'M7.2 4.2L3 8.4l4.2 4.2 M3.3 8.4h6.9c2.9 0 4.8 1.9 4.8 4.9v.5',
    thread: 'M3 4.8c0-.9.7-1.6 1.6-1.6h8.8c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H8.2L5 15v-2.6h-.4c-.9 0-1.6-.7-1.6-1.6z M6 6.8h6 M6 9.2h4',
    forward: 'M10.8 4.2L15 8.4l-4.2 4.2 M14.7 8.4H7.8C4.9 8.4 3 10.3 3 13.3v.5',
    more: 'M4.2 9h.2 M8.9 9h.2 M13.6 9h.2',
    pin: 'M10.9 2.8l4.3 4.3 M12.6 4.5L9.5 7.6l-3.2-.4-1.6 1.6 4.5 4.5 1.6-1.6-.4-3.2 3.1-3.1 M6.9 11.1l-3.8 3.8',
    'bell-slash': 'M4.5 12.5V8.2a4.5 4.5 0 0 1 7.2-3.6 M13.5 7.8v4.7l1.2 1.3H5.6 M7.5 15.5h3 M3 3l12 12',
    video: 'M2.5 5.5c0-.6.4-1 1-1h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H3.5c-.6 0-1-.4-1-1z M12 8l3.5-2.3v6.6L12 10',
    phone: 'M6.2 2.8l1.5 3.3-1.6 1.2a8.6 8.6 0 0 0 4.6 4.6l1.2-1.6 3.3 1.5-.5 2.7c-.1.5-.6.8-1.1.8A11.5 11.5 0 0 1 2.7 4.4c0-.5.3-1 .8-1.1z',
    'person-add': 'M7.5 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 15.5c.5-3 2.7-4.5 5.5-4.5 1.2 0 2.3.3 3.2.8 M14 10.5v5 M11.5 13h5',
    megaphone: 'M3 7.3v3.4c0 .4.3.8.8.8h1.7l6.5 3.3V3.2L5.5 6.5H3.8c-.5 0-.8.4-.8.8z M14.5 7.2v3.6 M6.2 11.5l1 3.5',
    bolt: 'M10.2 2.5L4.5 10h4.3l-1 5.5L13.5 8H9.2z',
    sheet: 'M3 3.5h12v11H3z M3 7.2h12 M3 10.8h12 M7.5 3.5v11',
    slides: 'M2.5 3.5h13v8.5h-13z M9 12v3 M6.5 15.5h5',
    lock: 'M4.5 8.2h9v7h-9z M6.3 8.2V6a2.7 2.7 0 0 1 5.4 0v2.2',
    checklist: 'M3 4.8l1.2 1.2 2.2-2.4 M3 10.3l1.2 1.2 2.2-2.4 M9 5h6 M9 10.5h6 M9 14h6'
  };
  function Icon(props) {
    var name = props.name, size = props.size || 16;
    var d = P[name] || P.doc;
    return h('svg', { viewBox: '0 0 18 18', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: props.weight || 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', style: props.color ? { color: props.color } : props.style, 'aria-hidden': props.label ? undefined : true, 'aria-label': props.label, role: props.label ? 'img' : undefined, className: props.className },
      d.split(' M').map(function (seg, i) { return h('path', { key: i, d: (i ? 'M' : '') + seg }); }));
  }
  Icon.names = Object.keys(P);
  function renderIcon(icon) { return typeof icon === 'string' ? h(Icon, { name: icon }) : icon; }

  /* ---------- Button ---------- */
  function Button(props) {
    var variant = props.variant || 'default', size = props.size || 'regular';
    var rest = Object.assign({}, props); ['variant', 'size', 'icon', 'className', 'children'].forEach(function (k) { delete rest[k]; });
    var iconOnly = props.icon && (props.children === undefined || props.children === null);
    return h('button', Object.assign({ type: 'button' }, rest, {
      className: cx('pn-btn', variant !== 'default' && 'pn-btn--' + variant, size !== 'regular' && 'pn-btn--' + size, iconOnly && 'pn-btn--icon', props.className)
    }), props.icon && renderIcon(props.icon), props.children);
  }

  /* ---------- Switch ---------- */
  function Switch(props) {
    var st = useControlled(props.checked, !!props.defaultChecked);
    return h('label', { className: cx('pn-switch', props.size === 'small' && 'pn-switch--small', props.disabled && 'pn-switch--disabled', props.className) },
      props.label && props.labelPosition !== 'after' ? h('span', null, props.label) : null,
      h('input', { type: 'checkbox', role: 'switch', checked: st[0], disabled: props.disabled, 'aria-label': props.label ? undefined : props['aria-label'],
        onChange: function (e) { st[1](e.target.checked); props.onChange && props.onChange(e.target.checked); } }),
      h('span', { className: 'pn-switch__track' }, h('span', { className: 'pn-switch__knob' })),
      props.label && props.labelPosition === 'after' ? h('span', null, props.label) : null);
  }

  /* ---------- Checkbox ---------- */
  function Checkbox(props) {
    var st = useControlled(props.checked, !!props.defaultChecked);
    var ref = useRef(null);
    useEffect(function () { if (ref.current) ref.current.indeterminate = !!props.indeterminate; }, [props.indeterminate]);
    return h('label', { className: cx('pn-check', props.indeterminate && 'pn-check--mixed', props.disabled && 'pn-disabled', props.className) },
      h('input', { ref: ref, type: 'checkbox', checked: st[0], disabled: props.disabled, onChange: function (e) { st[1](e.target.checked); props.onChange && props.onChange(e.target.checked); } }),
      h('span', { className: 'pn-check__box' }, h(Icon, { name: props.indeterminate ? 'minus' : 'check', weight: 2.4 })),
      props.label != null ? h('span', null, props.label) : null);
  }

  /* ---------- RadioGroup ---------- */
  var radioSeq = 0;
  function RadioGroup(props) {
    var st = useControlled(props.value, props.defaultValue);
    var nameRef = useRef(props.name || 'pn-radio-' + (++radioSeq));
    return h('div', { role: 'radiogroup', 'aria-label': props['aria-label'], className: cx('pn-radiogroup', props.direction === 'row' && 'pn-radiogroup--row', props.className) },
      (props.options || []).map(function (o) {
        return h('label', { key: o.value, className: cx('pn-radio', (props.disabled || o.disabled) && 'pn-disabled') },
          h('input', { type: 'radio', name: nameRef.current, value: o.value, checked: st[0] === o.value, disabled: props.disabled || o.disabled,
            onChange: function () { st[1](o.value); props.onChange && props.onChange(o.value); } }),
          h('span', { className: 'pn-radio__dot' }), h('span', null, o.label));
      }));
  }

  /* ---------- TextField ---------- */
  function TextField(props) {
    var rest = Object.assign({}, props); ['label', 'hint', 'error', 'size', 'className', 'style'].forEach(function (k) { delete rest[k]; });
    return h('label', { className: cx('pn-field', props.className), style: props.style },
      props.label ? h('span', { className: 'pn-field__label' }, props.label) : null,
      h('input', Object.assign({ type: 'text' }, rest, { 'aria-invalid': !!props.error || undefined, className: cx('pn-input', props.size === 'large' && 'pn-input--large', props.error && 'pn-input--invalid') })),
      props.error ? h('span', { className: 'pn-field__hint pn-field__hint--error' }, props.error) : props.hint ? h('span', { className: 'pn-field__hint' }, props.hint) : null);
  }

  /* ---------- SearchField ---------- */
  function SearchField(props) {
    var st = useControlled(props.value, props.defaultValue || '');
    function set(v) { st[1](v); props.onChange && props.onChange(v); }
    return h('div', { className: cx('pn-search', props.className), style: props.style },
      h(Icon, { name: 'search', weight: 1.7 }),
      h('input', { type: 'search', className: 'pn-input', placeholder: props.placeholder || '搜索', value: st[0], 'aria-label': props['aria-label'] || props.placeholder || '搜索',
        onChange: function (e) { set(e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && props.onSubmit) props.onSubmit(st[0]); } }),
      st[0] ? h('button', { type: 'button', className: 'pn-search__clear', 'aria-label': '清除', onClick: function () { set(''); } }, h(Icon, { name: 'xmark', weight: 2.6 })) : null);
  }

  /* ---------- SegmentedControl ---------- */
  function SegmentedControl(props) {
    var items = props.items || [];
    var st = useControlled(props.value, props.defaultValue !== undefined ? props.defaultValue : items[0] && items[0].value);
    return h('div', { role: 'group', 'aria-label': props['aria-label'], className: cx('pn-seg', props.size && props.size !== 'regular' && 'pn-seg--' + props.size, props.className) },
      items.map(function (it) {
        return h('button', { key: it.value, type: 'button', className: 'pn-seg__item', 'aria-pressed': st[0] === it.value, 'aria-label': it.label ? undefined : it['aria-label'],
          onClick: function () { st[1](it.value); props.onChange && props.onChange(it.value); } }, it.icon && renderIcon(it.icon), it.label);
      }));
  }

  /* ---------- Slider ---------- */
  function Slider(props) {
    var min = props.min != null ? props.min : 0, max = props.max != null ? props.max : 100;
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : (min + max) / 2);
    var pct = ((st[0] - min) / (max - min)) * 100;
    var ticks = props.ticks ? Array.apply(null, Array(props.ticks)).map(function (_, i) { return h('i', { key: i }); }) : null;
    return h('div', { className: cx('pn-slider', props.disabled && 'pn-disabled', props.className), style: Object.assign({ '--pn-fill': pct + '%' }, props.style) },
      h('input', { type: 'range', min: min, max: max, step: props.step || 1, value: st[0], disabled: props.disabled, 'aria-label': props['aria-label'],
        onChange: function (e) { var v = Number(e.target.value); st[1](v); props.onChange && props.onChange(v); } }),
      ticks ? h('div', { className: 'pn-slider__ticks' }, ticks) : null,
      props.minLabel || props.maxLabel ? h('div', { className: 'pn-slider__labels' }, h('span', null, props.minLabel), h('span', null, props.maxLabel)) : null);
  }

  /* ---------- ProgressIndicator ---------- */
  function ProgressIndicator(props) {
    if (props.variant === 'spinner') {
      return h('svg', { className: 'pn-spinner', viewBox: '0 0 16 16', role: 'progressbar', 'aria-label': props['aria-label'] || '正在载入' },
        [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) {
          return h('rect', { key: i, x: 7.1, y: 1, width: 1.8, height: 4.2, rx: 0.9, fill: 'currentColor', opacity: 0.25 + i * 0.1, transform: 'rotate(' + (i * 45) + ' 8 8)' });
        }));
    }
    var indet = props.value == null;
    return h('div', { className: cx('pn-progress', indet && 'pn-progress--indeterminate', props.className), style: props.style, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': indet ? undefined : props.value, 'aria-label': props['aria-label'] },
      h('div', { className: 'pn-progress__bar', style: indet ? null : { width: props.value + '%' } }));
  }

  /* ---------- Menu ---------- */
  function Menu(props) {
    return h('div', { role: 'menu', className: cx('pn-menu', props.className), style: props.style },
      (props.items || []).map(function (it, i) {
        if (it.separator) return h('div', { key: 's' + i, role: 'separator', className: 'pn-menu__sep' });
        if (it.header) return h('div', { key: 'h' + i, className: 'pn-menu__header' }, it.header);
        var hasCheckCol = props.items.some(function (x) { return x.checked !== undefined; });
        return h('button', { key: it.value || it.label, type: 'button', role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked, disabled: it.disabled,
          'data-active': props.activeValue !== undefined && props.activeValue === (it.value || it.label) ? 'true' : undefined,
          className: cx('pn-menu__item', it.destructive && 'pn-menu__item--destructive'),
          onClick: function () { props.onSelect && props.onSelect(it.value !== undefined ? it.value : it.label); } },
          hasCheckCol ? h('span', { className: 'pn-menu__check' }, it.checked ? h(Icon, { name: 'check', weight: 2 }) : null) : null,
          it.icon ? h('span', { className: 'pn-menu__icon' }, renderIcon(it.icon)) : null,
          h('span', { className: 'pn-menu__label' }, it.label),
          it.shortcut ? h('span', { className: 'pn-menu__shortcut' }, it.shortcut) : null);
      }));
  }

  /* ---------- PopUpButton ---------- */
  function PopUpButton(props) {
    var options = props.options || [];
    var st = useControlled(props.value, props.defaultValue !== undefined ? props.defaultValue : options[0] && options[0].value);
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var ref = useRef(null);
    useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      function onKey(e) { if (e.key === 'Escape') setOpen(false); }
      document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);
    var current = options.filter(function (x) { return x.value === st[0]; })[0];
    return h('div', { ref: ref, className: cx('pn-popup', props.className) },
      h(Button, { className: 'pn-popup__btn', size: props.size, disabled: props.disabled, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: function () { setOpen(!open); } },
        h('span', null, current ? current.label : props.placeholder), h('span', { className: 'pn-popup__chev' }, h(Icon, { name: 'chevron-updown', weight: 2.2 }))),
      open ? h(Menu, { style: { minWidth: '100%' }, items: options.map(function (x) { return { label: x.label, value: x.value, checked: x.value === st[0] }; }),
        onSelect: function (v) { st[1](v); setOpen(false); props.onChange && props.onChange(v); } }) : null);
  }

  /* ---------- Sidebar ---------- */
  function Sidebar(props) {
    var st = useControlled(props.selected, props.defaultSelected);
    return h('nav', { className: cx('pn-sidebar', props.className), style: props.style, 'aria-label': props['aria-label'] || '侧栏' },
      (props.sections || []).map(function (sec, si) {
        return h('div', { key: si, className: 'pn-sidebar__section' },
          sec.title ? h('div', { className: 'pn-sidebar__title' }, sec.title) : null,
          (sec.items || []).map(function (it) {
            return h('button', { key: it.id, type: 'button', className: 'pn-sidebar__item', 'aria-current': st[0] === it.id ? 'true' : undefined,
              onClick: function () { st[1](it.id); props.onSelect && props.onSelect(it.id); } },
              it.icon ? h('span', { className: 'pn-sidebar__icon', style: { color: it.color || 'var(--accent)' } }, renderIcon(it.icon)) : null,
              h('span', { className: 'pn-sidebar__label' }, it.label),
              it.badge != null ? h('span', { className: 'pn-sidebar__badge' }, it.badge) : null);
          }));
      }));
  }

  /* ---------- Toolbar ---------- */
  function Toolbar(props) {
    return h('div', { className: cx('pn-toolbar', props.className), style: props.style, role: 'toolbar' },
      props.leading,
      props.title ? h('div', { className: 'pn-toolbar__title' }, h('b', null, props.title), props.subtitle ? h('span', null, props.subtitle) : null) : h('div', { style: { marginRight: 'auto' } }),
      props.children);
  }
  function ToolbarGroup(props) { return h('div', { className: cx('pn-toolbar__group', props.className) }, props.children); }
  function ToolbarButton(props) {
    return h('button', { type: 'button', className: 'pn-toolbar__btn', 'aria-label': props.label, title: props.label, 'aria-pressed': props.active, onClick: props.onClick },
      props.icon && renderIcon(props.icon), props.text);
  }

  /* ---------- Window ---------- */
  function TrafficLights(props) {
    return h('div', { className: cx('pn-lights', props.inactive && 'pn-lights--inactive'), 'aria-hidden': true }, h('i', { className: 'c' }), h('i', { className: 'm' }), h('i', { className: 'z' }));
  }
  function Window(props) {
    var style = Object.assign({ width: props.width, height: props.height }, props.style);
    var lights = h(TrafficLights, { inactive: props.inactive });
    var body;
    if (props.sidebar) {
      body = h('div', { className: 'pn-window__body' },
        h('div', { className: 'pn-window__sidebarcol' }, h('div', { className: 'pn-window__lights' }, lights), props.sidebar),
        h('div', { className: 'pn-window__main' }, props.toolbar || h(Toolbar, { title: props.title }), h('div', { className: 'pn-window__content', style: props.contentStyle }, props.children)));
    } else {
      body = h('div', { className: 'pn-window__main' },
        h('div', { className: 'pn-window__chrome' }, h('div', { className: 'pn-window__lights' }, lights), h('div', { style: { flex: 1 } }, props.toolbar || h(Toolbar, { title: props.title }))),
        h('div', { className: 'pn-window__content', style: props.contentStyle }, props.children));
    }
    return h('div', { className: cx('pn', 'pn-window', props.inactive && 'pn-window--inactive', props.className), style: style, role: 'group', 'aria-label': props.title }, body);
  }

  /* ---------- Alert ---------- */
  function Alert(props) {
    var actions = props.actions || [{ label: '好' }];
    return h('div', { role: 'alertdialog', 'aria-label': props.title, className: cx('pn', 'pn-alert', props.className), style: props.style },
      props.icon ? h('div', { className: 'pn-alert__icon' }, props.icon) : null,
      h('h2', { className: 'pn-alert__title' }, props.title),
      props.message ? h('p', { className: 'pn-alert__message' }, props.message) : null,
      props.suppression ? h(Checkbox, { className: 'pn-alert__suppress', label: props.suppression }) : null,
      h('div', { className: cx('pn-alert__actions', actions.length > 2 && 'pn-alert__actions--stack') },
        actions.map(function (a, i) { return h(Button, { key: i, size: 'large', variant: a.variant || 'default', onClick: a.onClick }, a.label); })));
  }

  /* ---------- TabView ---------- */
  function TabView(props) {
    var tabs = props.tabs || [];
    var st = useControlled(props.value, props.defaultValue !== undefined ? props.defaultValue : tabs[0] && tabs[0].value);
    var cur = tabs.filter(function (t) { return t.value === st[0]; })[0];
    return h('div', { className: cx('pn-tabs', props.className), style: props.style },
      h('div', { className: 'pn-tabs__bar' }, h(SegmentedControl, { items: tabs.map(function (t) { return { value: t.value, label: t.label }; }), value: st[0], onChange: function (v) { st[1](v); props.onChange && props.onChange(v); } })),
      h('div', { className: 'pn-tabs__panel', role: 'tabpanel' }, cur ? cur.content : null));
  }

  /* ---------- GroupBox ---------- */
  function GroupBox(props) { return h('div', { className: cx('pn-group', props.className), style: props.style }, props.children); }
  function GroupRow(props) {
    return h('div', { className: 'pn-group__row' },
      h('div', null, h('div', null, props.label), props.description ? h('div', { style: { fontSize: '11px', lineHeight: '14px', color: 'var(--label-secondary)' } }, props.description) : null),
      props.children);
  }

  /* ================= IM ================= */
  function hashIndex(str, n) { var x = 0; str = String(str || ''); for (var i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0; return x % n; }
  function initials(name, group) {
    name = String(name || '').trim(); if (!name) return '';
    if (/[㐀-鿿]/.test(name)) { var han = name.replace(/[^㐀-鿿]/g, ''); return group ? han.slice(0, 2) : han.slice(-2); }
    var parts = name.split(/\s+/); return ((parts[0] || '')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
  }

  /* ---------- Avatar / AvatarGroup ---------- */
  function Avatar(props) {
    var size = props.size || 32;
    var bg = props.color || 'var(--avatar-' + (hashIndex(props.name, 6) + 1) + ')';
    var txt = initials(props.name, props.shape === 'square');
    return h('span', { className: cx('pn-avatar', props.shape === 'square' && 'pn-avatar--square', props.className), title: props.name,
      role: 'img', 'aria-label': props.name + (props.status ? '（' + ({ online: '在线', busy: '忙碌', away: '离开' }[props.status] || '') + '）' : ''),
      style: Object.assign({ width: size, height: size, background: props.src ? 'var(--control-track)' : bg, fontSize: Math.round(size * (txt.length > 1 && /[㐀-鿿]/.test(txt) ? 0.34 : 0.4)) }, props.style) },
      props.src ? h('img', { src: props.src, alt: '' }) : txt,
      props.status ? h('span', { className: 'pn-avatar__status pn-avatar__status--' + props.status }) : null);
  }
  function AvatarGroup(props) {
    var max = props.max || 3, people = props.people || [];
    return h('span', { className: 'pn-avatars' },
      people.slice(0, max).map(function (p, i) { return h(Avatar, Object.assign({ key: i, size: props.size || 20 }, p)); }),
      people.length > max ? h('span', { className: 'pn-avatars__more' }, '+' + (people.length - max)) : null);
  }

  /* ---------- Tag / Badge ---------- */
  function Tag(props) {
    return h('span', { className: cx('pn-tag', 'pn-tag--' + (props.tone || 'gray'), props.className) }, props.icon && renderIcon(props.icon), props.children);
  }
  function Badge(props) {
    if (!props.count) return null;
    return h('span', { className: cx('pn-badge', props.muted && 'pn-badge--muted'), 'aria-label': props.count + ' 条未读' }, props.count > 99 ? '99+' : props.count);
  }

  /* ---------- ConversationList ---------- */
  function ConversationItem(props) {
    var it = props.item;
    var flag = it.urgent ? '[加急] ' : it.mention ? '[有人@我] ' : it.draft ? '[草稿] ' : null;
    var avatar = it.avatarNode || h(Avatar, { name: it.name, src: it.avatar, size: 40, status: it.status, shape: it.group ? 'square' : 'circle' });
    return h('button', { type: 'button', className: 'pn-conv', 'aria-current': props.selected ? 'true' : undefined, onClick: props.onClick },
      avatar,
      h('span', { className: 'pn-conv__body' },
        h('span', { className: 'pn-conv__line' },
          h('span', { className: 'pn-conv__name' }, it.name),
          (it.tags || []).map(function (t, i) { return h(Tag, { key: i, tone: t.tone }, t.label); }),
          h('span', { className: 'pn-conv__time' }, it.pinned ? h(Icon, { name: 'pin', label: '已置顶' }) : null, it.time)),
        h('span', { className: 'pn-conv__line' },
          h('span', { className: 'pn-conv__preview' }, flag ? h('span', { className: 'pn-conv__flag' }, flag) : null, it.draft || it.preview),
          it.muted ? h(Icon, { name: 'bell-slash', className: 'pn-conv__muted', label: '免打扰' }) : null,
          it.unread ? (it.muted && it.unreadDot ? h('span', { className: 'pn-conv__dot', 'aria-label': '有未读' }) : h(Badge, { count: it.unread, muted: it.muted })) : null)));
  }
  function ConversationList(props) {
    var st = useControlled(props.selected, props.defaultSelected);
    return h('div', { className: cx('pn', 'pn-convlist', props.className), style: props.style },
      props.header ? h('div', { className: 'pn-convlist__header' }, props.header) : null,
      h('div', { className: 'pn-convlist__items', role: 'list', 'aria-label': props['aria-label'] || '会话' },
        (props.items || []).map(function (it) {
          return h(ConversationItem, { key: it.id, item: it, selected: st[0] === it.id, onClick: function () { st[1](it.id); props.onSelect && props.onSelect(it.id); } });
        })));
  }

  /* ---------- ChatHeader ---------- */
  function ChatHeader(props) {
    var tabs = props.tabs || [];
    var st = useControlled(props.tab, props.defaultTab !== undefined ? props.defaultTab : tabs[0] && tabs[0].value);
    return h('div', { className: cx('pn-chathead', props.className), style: props.style },
      h('div', { className: 'pn-chathead__bar' },
        props.avatar !== undefined ? props.avatar : h(Avatar, { name: props.title, size: 32, shape: props.group ? 'square' : 'circle' }),
        h('div', { className: 'pn-chathead__titles' },
          h('div', { className: 'pn-chathead__title' }, h('span', null, props.title), (props.tags || []).map(function (t, i) { return h(Tag, { key: i, tone: t.tone }, t.label); })),
          props.subtitle ? h('div', { className: 'pn-chathead__sub' }, props.subtitle) : null),
        (props.actions && props.actions.length) ? h(ToolbarGroup, null, props.actions.map(function (a, i) { return h(ToolbarButton, { key: i, icon: a.icon, label: a.label, onClick: a.onClick, active: a.active }); })) : null,
        props.trailing),
      tabs.length ? h('div', { className: 'pn-chathead__tabs', role: 'tablist' }, tabs.map(function (t) {
        return h('button', { key: t.value, type: 'button', role: 'tab', className: 'pn-chathead__tab', 'aria-selected': st[0] === t.value,
          onClick: function () { st[1](t.value); props.onTabChange && props.onTabChange(t.value); } }, t.label);
      })) : null);
  }

  /* ---------- Mention ---------- */
  function Mention(props) { return h('span', { className: cx('pn-mention', props.me && 'pn-mention--me') }, '@' + props.name); }

  /* ---------- Reactions ---------- */
  function Reactions(props) {
    return h('div', { className: 'pn-reactions' },
      (props.items || []).map(function (r, i) {
        var users = r.users || [];
        var names = users.slice(0, 3).join('，') + (users.length > 3 ? ' 等 ' + users.length + ' 人' : '');
        return h('button', { key: i, type: 'button', className: cx('pn-reaction', r.mine && 'pn-reaction--mine'), 'aria-pressed': !!r.mine, 'aria-label': (r.label || r.emoji) + '：' + names,
          onClick: function () { props.onToggle && props.onToggle(r.emoji); } },
          h('span', { className: 'pn-reaction__emoji', 'aria-hidden': true }, r.emoji), h('span', null, props.compact ? users.length : names));
      }),
      props.onAdd ? h('button', { type: 'button', className: 'pn-reaction pn-reaction--add', 'aria-label': '添加表情回复', onClick: props.onAdd }, h(Icon, { name: 'smile' })) : null);
  }

  /* ---------- ReadReceipt ---------- */
  function ReadReceipt(props) {
    var total = props.total || 1, read = props.read || 0;
    var state = read <= 0 ? 'none' : read >= total ? 'all' : 'partial';
    var label = state === 'all' ? (total > 1 ? '全部已读' : '已读') : total > 1 ? (total - read) + ' 人未读' : '未读';
    return h('span', { className: 'pn-receipt pn-receipt--' + state, role: 'img', 'aria-label': label, title: label,
      style: state === 'partial' ? { '--pn-read': Math.round(read / total * 360) + 'deg' } : null },
      state === 'all' ? h(Icon, { name: 'check', weight: 2.6 }) : null);
  }

  /* ---------- ThreadSummary ---------- */
  function ThreadSummary(props) {
    return h('button', { type: 'button', className: 'pn-thread', onClick: props.onClick },
      h(AvatarGroup, { people: props.people || [], size: 20, max: 3 }),
      h('span', { className: 'pn-thread__count' }, props.count + ' 条回复'),
      props.lastTime ? h('span', { className: 'pn-thread__last' }, '最后回复 ' + props.lastTime) : null);
  }

  /* ---------- MessageActions ---------- */
  var DEFAULT_ACTIONS = [{ icon: 'smile', label: '表情回复' }, { icon: 'reply', label: '回复' }, { icon: 'thread', label: '回复话题' }, { icon: 'forward', label: '转发' }, { icon: 'more', label: '更多' }];
  function MessageActions(props) {
    return h('div', { className: cx('pn-msgactions', props.className), role: 'toolbar', 'aria-label': '消息操作' },
      (props.items || DEFAULT_ACTIONS).map(function (a, i) {
        return h('button', { key: i, type: 'button', 'aria-label': a.label, title: a.label, onClick: function () { a.onClick ? a.onClick() : props.onAction && props.onAction(a.label); } },
          h(Icon, { name: a.icon, weight: a.icon === 'more' ? 2.6 : 1.5 }));
      }));
  }

  /* ---------- Message ---------- */
  function Message(props) {
    var self = !!props.self, author = props.author || {};
    var showHead = !props.continued;
    var content = typeof props.children === 'string' ? h('p', null, props.children) : props.children;
    var reply = props.reply ? h('div', { className: 'pn-quote' }, h('b', null, '回复 ' + props.reply.author + '：'), props.reply.text) : null;
    var reactions = props.reactions && props.reactions.length ? h(Reactions, { items: props.reactions, onToggle: props.onReact }) : null;
    var body = props.bare
      ? h('div', { className: 'pn-msg__bare' }, reply, content, reactions)
      : h('div', { className: cx('pn-bubble', props.urgent && 'pn-bubble--urgent') }, reply, content, props.edited ? h('span', { className: 'pn-msg__edited' }, '（已编辑）') : null, reactions);
    var side = null;
    if (self) {
      if (props.status === 'sending') side = h(ProgressIndicator, { variant: 'spinner', 'aria-label': '正在发送' });
      else if (props.status === 'failed') side = h('button', { type: 'button', className: 'pn-msg__retry', 'aria-label': '发送失败，重新发送', title: '发送失败，点按重新发送', onClick: props.onRetry }, '!');
      else if (props.receipt) side = h(ReadReceipt, props.receipt);
    }
    return h('div', { className: cx('pn-msg', self && 'pn-msg--self', props.continued && 'pn-msg--cont', props.showActions && 'pn-msg--show-actions', props.className), style: props.style },
      showHead && props.showAvatar !== false ? h(Avatar, Object.assign({ size: 32, name: author.name, src: author.avatar, status: author.status }, author.avatarProps)) : h('span', { className: 'pn-msg__gutter' }),
      h('div', { className: 'pn-msg__col' },
        showHead ? h('div', { className: 'pn-msg__meta' },
          !self && author.name ? h('b', null, author.name) : null,
          (author.tags || []).map(function (t, i) { return h(Tag, { key: i, tone: t.tone }, t.label); }),
          props.urgent ? h(Tag, { tone: 'solid-red', icon: 'bolt' }, '加急') : null,
          props.time ? h('span', { className: 'pn-msg__time' }, props.time) : null) : null,
        h('div', { className: 'pn-msg__row' }, body, side ? h('span', { className: 'pn-msg__side' }, side) : null),
        props.thread ? h(ThreadSummary, props.thread) : null,
        props.actions === false ? null : h('div', { className: 'pn-msg__actions' }, h(MessageActions, { items: props.actions, onAction: props.onAction }))));
  }
  function MessageList(props) { return h('div', { className: cx('pn', 'pn-msglist', props.className), style: props.style, role: 'log', 'aria-label': props['aria-label'] || '消息' }, props.children); }

  /* ---------- Attachments ---------- */
  var FILE_KINDS = { pdf: ['red', 'PDF'], doc: ['blue', 'DOC'], docx: ['blue', 'DOC'], pages: ['orange', 'PAGES'], xls: ['green', 'XLS'], xlsx: ['green', 'XLS'], csv: ['green', 'CSV'], numbers: ['green', 'NUM'],
    ppt: ['orange', 'PPT'], pptx: ['orange', 'PPT'], key: ['blue', 'KEY'], zip: ['gray', 'ZIP'], rar: ['gray', 'RAR'], png: ['purple', 'PNG'], jpg: ['purple', 'JPG'], mp4: ['purple', 'MP4'], txt: ['gray', 'TXT'] };
  function FileAttachment(props) {
    var ext = (props.ext || String(props.name || '').split('.').pop() || '').toLowerCase();
    var k = FILE_KINDS[ext] || ['gray', ext.toUpperCase().slice(0, 4) || 'FILE'];
    return h('div', { className: cx('pn-card', 'pn-file', props.className), style: props.style },
      h('span', { className: 'pn-filetile', style: { background: 'var(--tint-' + k[0] + ')', color: 'var(--tint-' + k[0] + '-text)' } }, h(Icon, { name: 'doc' }), k[1]),
      h('span', { className: 'pn-file__body' },
        h('span', { className: 'pn-file__name' }, props.name),
        props.progress != null ? h(ProgressIndicator, { value: props.progress, 'aria-label': '上传进度' }) : null,
        h('span', { className: 'pn-file__meta' }, [props.size, props.meta].filter(Boolean).join(' · '))),
      props.onDownload !== false ? h(Button, { variant: 'glass', icon: 'download', 'aria-label': '下载', onClick: props.onDownload }) : null);
  }
  function ImageAttachment(props) {
    return h('figure', { className: cx('pn-image', props.className), style: Object.assign({ margin: 0, width: props.width }, props.style) },
      h('img', { src: props.src, alt: props.alt || '', width: props.width, height: props.height }));
  }
  var DOC_KINDS = { doc: ['blue', 'doc', '文档'], sheet: ['green', 'sheet', '表格'], base: ['purple', 'grid', '多维表格'], slides: ['orange', 'slides', '幻灯片'], wiki: ['blue', 'folder', '知识库'], mindnote: ['purple', 'share', '思维笔记'] };
  function DocLink(props) {
    var k = DOC_KINDS[props.kind || 'doc'] || DOC_KINDS.doc;
    return h('div', { className: cx('pn-card', 'pn-doc', props.className), style: props.style },
      h('div', { className: 'pn-doc__top' },
        h('span', { className: 'pn-filetile', style: { background: 'var(--tint-' + k[0] + ')', color: 'var(--tint-' + k[0] + '-text)', height: 36 } }, h(Icon, { name: k[1] })),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'pn-doc__title' }, props.title),
          h('div', { className: 'pn-doc__meta' }, [k[2], props.owner, props.updated].filter(Boolean).join(' · ')))),
      props.permission || props.action ? h('div', { className: 'pn-doc__foot' },
        props.permission ? h('span', null, h(Icon, { name: 'lock' }), props.permission) : h('span'),
        props.action || null) : null);
  }
  function MessageCard(props) {
    return h('div', { className: cx('pn-card', 'pn-mcard', 'pn-mcard--' + (props.template || 'blue'), props.className), style: props.style },
      h('div', { className: 'pn-mcard__head' }, props.icon ? renderIcon(props.icon) : null, h('span', { className: 'pn-mcard__title' }, props.title),
        props.status ? h(Tag, { tone: props.status.tone || 'gray' }, props.status.label) : null),
      h('div', { className: 'pn-mcard__body' },
        props.fields && props.fields.length ? h('div', { className: 'pn-mcard__fields' }, props.fields.map(function (f, i) {
          return h('div', { key: i, className: cx('pn-mcard__field', f.short && 'pn-mcard__field--short') }, h('span', { className: 'pn-mcard__label' }, f.label), h('span', { className: 'pn-mcard__value' }, f.value));
        })) : null,
        props.children,
        props.actions && props.actions.length ? h('div', { className: 'pn-mcard__actions' }, props.actions.map(function (a, i) {
          return h(Button, { key: i, variant: a.variant, onClick: a.onClick, disabled: a.disabled }, a.label);
        })) : null,
        props.note ? h('div', { className: 'pn-mcard__note' }, props.note) : null));
  }

  /* ---------- ChatNotice ---------- */
  function ChatNotice(props) {
    var kind = props.kind || 'system';
    if (kind === 'unread') return h('div', { className: 'pn-notice pn-notice--unread', role: 'separator' }, props.children || '以下为新消息');
    if (kind === 'urgent') return h('div', { className: 'pn-notice pn-notice--urgent' }, h('span', null, h(Icon, { name: 'bolt' }), props.children));
    if (kind === 'date') return h('div', { className: 'pn-notice pn-notice--date', role: 'separator' }, h('span', null, props.day ? h('b', null, props.day) : null, props.children));
    return h('div', { className: 'pn-notice pn-notice--system' }, h('span', null, props.children));
  }

  /* ---------- PinnedBanner ---------- */
  function PinnedBanner(props) {
    return h('div', { className: cx('pn-pinned', props.className), style: props.style, role: 'note' },
      h('span', { className: 'pn-pinned__icon', style: props.color ? { color: props.color } : null }, renderIcon(props.icon || 'megaphone')),
      h('span', { className: 'pn-pinned__title' }, props.title || '群公告'),
      h('span', { className: 'pn-pinned__text' }, props.text),
      props.action || null,
      props.onClose ? h('button', { type: 'button', className: 'pn-pinned__close', 'aria-label': '关闭', onClick: props.onClose }, h(Icon, { name: 'xmark', weight: 2.2 })) : null);
  }

  /* ---------- Composer ---------- */
  var DEFAULT_TOOLS = [{ icon: 'smile', label: '表情' }, { icon: 'at', label: '提及' }, { icon: 'image', label: '图片' }, { icon: 'paperclip', label: '文件' }, { icon: 'scissors', label: '截图' }, { icon: 'textformat', label: '格式' }];
  function Composer(props) {
    var st = useControlled(props.value, props.defaultValue || '');
    var ref = useRef(null);
    useEffect(function () { var t = ref.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 114) + 'px'; }, [st[0]]);
    function set(v) { st[1](v); props.onChange && props.onChange(v); }
    function send() { var v = String(st[0] || '').trim(); if (!v) return; props.onSend && props.onSend(v); if (props.value === undefined) set(''); }
    return h('div', { className: cx('pn', 'pn-composer', props.className), style: props.style },
      props.replyTo ? h('div', { className: 'pn-composer__reply' },
        h('div', { className: 'pn-quote' }, h('b', null, '回复 ' + props.replyTo.author + '：'), props.replyTo.text),
        props.onCancelReply ? h('button', { type: 'button', className: 'pn-pinned__close', 'aria-label': '取消回复', onClick: props.onCancelReply }, h(Icon, { name: 'xmark', weight: 2.2 })) : null) : null,
      h('textarea', { ref: ref, rows: 1, value: st[0], placeholder: props.placeholder || '发送给 ' + (props.recipient || '…'), 'aria-label': props['aria-label'] || '消息输入', disabled: props.disabled,
        onChange: function (e) { set(e.target.value); },
        onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } } }),
      h('div', { className: 'pn-composer__bar' },
        (props.tools || DEFAULT_TOOLS).map(function (t, i) {
          return h('button', { key: i, type: 'button', className: 'pn-composer__tool', 'aria-label': t.label, title: t.label, onClick: function () { if (t.onClick) t.onClick(); else if (t.icon === 'at') set(String(st[0] || '') + '@'); } }, h(Icon, { name: t.icon }));
        }),
        props.hint !== false ? h('span', { className: 'pn-composer__hint' }, props.hint || 'Enter 发送 · ⇧Enter 换行') : h('span', { style: { marginLeft: 'auto' } }),
        h('button', { type: 'button', className: 'pn-composer__send', 'aria-label': '发送', disabled: !String(st[0] || '').trim(), onClick: send }, h(Icon, { name: 'send', weight: 2.2 }))));
  }

  var api = { Button: Button, Switch: Switch, Checkbox: Checkbox, RadioGroup: RadioGroup, TextField: TextField, SearchField: SearchField, SegmentedControl: SegmentedControl,
    Slider: Slider, ProgressIndicator: ProgressIndicator, PopUpButton: PopUpButton, Menu: Menu, Sidebar: Sidebar, Toolbar: Toolbar, ToolbarGroup: ToolbarGroup,
    ToolbarButton: ToolbarButton, Window: Window, TrafficLights: TrafficLights, Alert: Alert, TabView: TabView, GroupBox: GroupBox, GroupRow: GroupRow, Icon: Icon,
    Avatar: Avatar, AvatarGroup: AvatarGroup, Tag: Tag, Badge: Badge, ConversationList: ConversationList, ConversationItem: ConversationItem, ChatHeader: ChatHeader,
    Mention: Mention, Reactions: Reactions, ReadReceipt: ReadReceipt, ThreadSummary: ThreadSummary, MessageActions: MessageActions, Message: Message, MessageList: MessageList,
    FileAttachment: FileAttachment, ImageAttachment: ImageAttachment, DocLink: DocLink, MessageCard: MessageCard, ChatNotice: ChatNotice, PinnedBanner: PinnedBanner, Composer: Composer };
  window.Pane = Object.assign(window.Pane || {}, api);
})();
