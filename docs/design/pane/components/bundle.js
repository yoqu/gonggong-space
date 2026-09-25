/* @ds-bundle: {"format":4,"namespace":"Pane","components":[{"name":"Button"},{"name":"Switch"},{"name":"Checkbox"},{"name":"RadioGroup"},{"name":"TextField"},{"name":"SearchField"},{"name":"SegmentedControl"},{"name":"Slider"},{"name":"ProgressIndicator"},{"name":"PopUpButton"},{"name":"Menu"},{"name":"Sidebar"},{"name":"Toolbar"},{"name":"Window"},{"name":"Alert"},{"name":"TabView"},{"name":"GroupBox"},{"name":"Icon"},{"name":"Avatar"},{"name":"Tag"},{"name":"ConversationList"},{"name":"ChatHeader"},{"name":"Message"},{"name":"MessageActions"},{"name":"Reactions"},{"name":"ReadReceipt"},{"name":"ThreadSummary"},{"name":"FileAttachment"},{"name":"ImageAttachment"},{"name":"DocLink"},{"name":"MessageCard"},{"name":"ChatNotice"},{"name":"PinnedBanner"},{"name":"Composer"},{"name":"NavRail"},{"name":"ChatInfoPanel"},{"name":"ThreadPanel"},{"name":"Popover"},{"name":"MentionPicker"},{"name":"ProfileCard"},{"name":"EmojiPicker"},{"name":"VoiceMessage"},{"name":"LinkPreview"},{"name":"CodeBlock"},{"name":"MeetingCard"},{"name":"EventCard"},{"name":"EmptyState"},{"name":"Skeleton"},{"name":"TypingIndicator"},{"name":"NotificationBanner"},{"name":"ContextMenu"},{"name":"Table"},{"name":"Sheet"},{"name":"Dialog"},{"name":"SecureField"},{"name":"TextArea"},{"name":"Stepper"},{"name":"ComboBox"},{"name":"Form"},{"name":"CheckboxGroup"},{"name":"Divider"},{"name":"Link"},{"name":"HelpButton"},{"name":"Calendar"},{"name":"DatePicker"},{"name":"Disclosure"},{"name":"Tooltip"},{"name":"Kbd"},{"name":"Toast"},{"name":"HUD"},{"name":"TokenField"},{"name":"PullDownButton"},{"name":"PathControl"},{"name":"LevelIndicator"},{"name":"ColorWell"},{"name":"DropZone"}]} */
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

  /* Keyboard: move focus among items (select-follows-focus lists call click) */
  function keyNav(e, root, selector, opts) {
    opts = opts || {};
    var keys = opts.horizontal ? { next: 'ArrowRight', prev: 'ArrowLeft' } : { next: 'ArrowDown', prev: 'ArrowUp' };
    var cols = opts.cols || 0;
    if ([keys.next, keys.prev, 'Home', 'End'].concat(cols ? ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] : []).indexOf(e.key) < 0) return;
    var els = Array.prototype.slice.call(root.querySelectorAll(selector)).filter(function (x) { return !x.disabled; });
    if (!els.length) return;
    var i = els.indexOf(document.activeElement);
    var n = i;
    if (cols) n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : e.key === 'ArrowUp' ? i - cols : e.key === 'Home' ? 0 : els.length - 1;
    else n = e.key === keys.next ? i + 1 : e.key === keys.prev ? i - 1 : e.key === 'Home' ? 0 : els.length - 1;
    n = Math.max(0, Math.min(els.length - 1, n));
    e.preventDefault();
    els[n].focus();
    if (opts.select) els[n].click();
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
    calendar: 'M3.5 4.5h11c.6 0 1 .4 1 1v9c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1v-9c0-.6.4-1 1-1z M2.5 8h13 M6 2.8v3.2 M12 2.8v3.2',
    message: 'M9 14.6c3.6 0 6.5-2.5 6.5-5.6S12.6 3.4 9 3.4 2.5 5.9 2.5 9c0 1.4.6 2.7 1.6 3.7L3.6 15.4l3-1.2c.8.3 1.6.4 2.4.4z',
    contacts: 'M4 2.8h10c.6 0 1 .4 1 1v10.4c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V3.8c0-.6.4-1 1-1z M9 8.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5.8 12.6c.5-1.5 1.7-2.3 3.2-2.3s2.7.8 3.2 2.3',
    apps: 'M3.2 3.2h4.6v4.6H3.2z M10.2 3.2h4.6v4.6h-4.6z M3.2 10.2h4.6v4.6H3.2z M12.5 10v5 M10 12.5h5',
    globe: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M2.5 9h13 M9 2.5c1.8 1.8 2.6 4 2.6 6.5s-.8 4.7-2.6 6.5 M9 2.5C7.2 4.3 6.4 6.5 6.4 9s.8 4.7 2.6 6.5',
    copy: 'M6.5 6.5h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H6.5c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1z M3.5 11.5v-8c0-.6.4-1 1-1h7',
    undo: 'M6.5 3.8L3 7.3l3.5 3.5 M3.3 7.3h7.2c2.5 0 4.5 2 4.5 4.4s-2 4.4-4.5 4.4H8',
    mappin: 'M9 15.8s5-4.5 5-8.3a5 5 0 1 0-10 0c0 3.8 5 8.3 5 8.3z M9 9.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
    record: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'chevron-down': 'M4.5 7L9 11.5 13.5 7',
    'chevron-up': 'M4.5 11L9 6.5 13.5 11',
    eye: 'M1.8 9s2.7-5 7.2-5 7.2 5 7.2 5-2.7 5-7.2 5S1.8 9 1.8 9z M9 11.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
    'eye-slash': 'M1.8 9s2.7-5 7.2-5 7.2 5 7.2 5-2.7 5-7.2 5S1.8 9 1.8 9z M9 11.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z M3 3l12 12',
    capslock: 'M9 3L3.5 9h3v3.5h5V9h3z M6.5 15h5',
    external: 'M10.5 3h4.5v4.5 M15 3L8.5 9.5 M13 10.5v3.5c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V6c0-.6.4-1 1-1h3.5',
    speaker: 'M3 7v4h3l4 3.2V3.8L6 7z M12.5 6.5a3.5 3.5 0 0 1 0 5 M14.5 4.5a6.3 6.3 0 0 1 0 9',
    'speaker-slash': 'M3 7v4h3l4 3.2V3.8L6 7z M12.5 7l3.5 4 M16 7l-3.5 4',
    link: 'M7.8 10.2a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1 M10.2 7.8a3 3 0 0 0-4.2 0l-2.3 2.3a3 3 0 0 0 4.2 4.2l1-1',
    'hard-drive': 'M2.5 10.5l1.8-5.8c.2-.6.7-1 1.3-1h6.8c.6 0 1.1.4 1.3 1l1.8 5.8v3c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1z M2.6 10.5h12.8 M12.5 12.6h.8',
    upload: 'M9 12V3.2 M5.8 6.2L9 3l3.2 3.2 M3 11.5v2.3c0 .9.7 1.7 1.7 1.7h8.6c.9 0 1.7-.8 1.7-1.7v-2.3',
    appearance: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 2.5v13',
    hand: 'M6 9.5V4.2a1 1 0 0 1 2 0v4 M8 8V3.2a1 1 0 0 1 2 0V8 M10 8V4a1 1 0 0 1 2 0v5 M12 7.5a1 1 0 0 1 2 0v3.3c0 2.6-2 4.7-4.6 4.7-1.6 0-2.8-.6-3.8-1.9L3.4 10.6a1 1 0 0 1 1.5-1.3L6 10.4',
    battery: 'M2.5 6h11.5c.3 0 .5.2.5.5v5c0 .3-.2.5-.5.5H2.5c-.3 0-.5-.2-.5-.5v-5c0-.3.2-.5.5-.5z M16 8v2 M4 7.8h6v2.4H4z',
    lock2: 'M4.5 8.2h9v7h-9z M6.3 8.2V6a2.7 2.7 0 0 1 5.4 0v2.2',
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
    var rest = Object.assign({}, props); ['variant', 'size', 'icon', 'className', 'children', 'loading'].forEach(function (k) { delete rest[k]; });
    var iconOnly = props.icon && (props.children === undefined || props.children === null);
    return h('button', Object.assign({ type: 'button' }, rest, {
      disabled: props.disabled || props.loading, 'aria-busy': props.loading || undefined,
      className: cx('pn-btn', variant !== 'default' && 'pn-btn--' + variant, size !== 'regular' && 'pn-btn--' + size, iconOnly && 'pn-btn--icon', props.loading && 'pn-btn--loading', props.className)
    }), props.loading ? h(ProgressIndicator, { variant: 'spinner', 'aria-label': '正在处理' }) : props.icon && renderIcon(props.icon), props.children);
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
  var fieldSeq = 0;
  function useId(prefix) { var r = useRef(null); if (!r.current) r.current = prefix + (++fieldSeq); return r.current; }
  function omit(o, keys) { var r = Object.assign({}, o); keys.forEach(function (k) { delete r[k]; }); return r; }
  function fieldHint(props, id, extra) {
    if (props.error) return h('span', { id: id, className: 'pn-field__hint pn-field__hint--error' }, props.error, extra);
    if (props.hint || extra) return h('span', { id: id, className: 'pn-field__hint' }, props.hint, extra);
    return null;
  }
  function TextField(props) {
    var id = useId('pn-f-'), hid = id + '-h';
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : '');
    var ref = useRef(null);
    var rest = omit(props, ['label', 'hint', 'error', 'size', 'className', 'style', 'prefix', 'suffix', 'clearable', 'onClear', 'value', 'defaultValue', 'onChange', 'inputRef', 'trailing']);
    var affixed = props.prefix || props.suffix || props.clearable || props.trailing;
    var input = h('input', Object.assign({ type: 'text' }, rest, { id: id, ref: function (el) { ref.current = el; if (props.inputRef) props.inputRef.current = el; }, value: st[0],
      'aria-invalid': !!props.error || undefined, 'aria-describedby': props.error || props.hint ? hid : undefined,
      onChange: function (e) { st[1](e.target.value); props.onChange && props.onChange(e); },
      className: cx('pn-input', props.size === 'large' && 'pn-input--large', props.error && 'pn-input--invalid', affixed && 'pn-input--bare') }));
    var control = affixed ? h('span', { className: cx('pn-inputwrap', props.size === 'large' && 'pn-inputwrap--large', props.error && 'pn-input--invalid', props.disabled && 'pn-disabled') },
      props.prefix ? h('span', { className: 'pn-inputwrap__affix' }, renderIconMaybe(props.prefix)) : null,
      input,
      props.clearable && st[0] ? h('button', { type: 'button', className: 'pn-search__clear pn-inputwrap__clear', 'aria-label': '清除', onClick: function () { st[1](''); props.onClear && props.onClear(); ref.current && ref.current.focus(); } }, h(Icon, { name: 'xmark', weight: 2.6 })) : null,
      props.trailing || null,
      props.suffix ? h('span', { className: 'pn-inputwrap__affix' }, renderIconMaybe(props.suffix)) : null) : input;
    return h('div', { className: cx('pn-field', props.className), style: props.style },
      props.label ? h('label', { htmlFor: id, className: 'pn-field__label' }, props.label) : null,
      control, fieldHint(props, hid));
  }
  function renderIconMaybe(x) { return typeof x === 'string' && Object.prototype.hasOwnProperty.call(P, x) ? h(Icon, { name: x }) : x; }


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
    var ref = useRef(null);
    var hasSel = items.some(function (it) { return it.value === st[0]; });
    return h('div', { ref: ref, role: 'radiogroup', 'aria-label': props['aria-label'], className: cx('pn-seg', props.size && props.size !== 'regular' && 'pn-seg--' + props.size, props.className),
        onKeyDown: function (e) { keyNav(e, ref.current, '.pn-seg__item', { horizontal: true, select: true }); } },
      items.map(function (it, i) {
        var on = st[0] === it.value;
        return h('button', { key: it.value, type: 'button', role: 'radio', className: 'pn-seg__item', 'aria-checked': on, 'aria-pressed': on, 'aria-label': it.label ? undefined : it['aria-label'],
          tabIndex: on || (!hasSel && i === 0) ? 0 : -1,
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
    var items = props.items || [];
    var hasCheckCol = items.some(function (x) { return x.checked !== undefined; });
    var hasIconCol = items.some(function (x) { return !!x.icon; });
    var selectable = [];
    items.forEach(function (it, i) { if (!it.separator && !it.header && !it.disabled) selectable.push(i); });
    var initial = -1;
    items.forEach(function (it, i) { if (props.activeValue !== undefined && props.activeValue === (it.value !== undefined ? it.value : it.label)) initial = i; });
    var a = useState(initial), active = a[0], setActive = a[1];
    var sb = useState(props.defaultOpenSubmenu != null ? props.defaultOpenSubmenu : -1), openSub = sb[0], setOpenSub = sb[1];
    var sk = useState(false), subKb = sk[0], setSubKb = sk[1];
    var ref = useRef(null);
    useEffect(function () { if (props.autoFocus && ref.current) ref.current.focus(); }, []);
    function valueOf(it) { return it.value !== undefined ? it.value : it.label; }
    function move(d) {
      if (!selectable.length) return;
      var pos = selectable.indexOf(active);
      var np = pos < 0 ? (d > 0 ? 0 : selectable.length - 1) : (pos + d + selectable.length) % selectable.length;
      setActive(selectable[np]);
    }
    function onKeyDown(e) {
      if (e.defaultPrevented) return;
      var cur = items[active];
      if ((e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') && cur && cur.submenu) { e.preventDefault(); setOpenSub(active); setSubKb(true); return; }
      if (e.key === 'ArrowLeft' && props.isSubmenu && props.onClose) { e.preventDefault(); props.onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpenSub(-1); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setOpenSub(-1); move(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(selectable[0]); }
      else if (e.key === 'End') { e.preventDefault(); setActive(selectable[selectable.length - 1]); }
      else if ((e.key === 'Enter' || e.key === ' ') && active >= 0) { e.preventDefault(); props.onSelect && props.onSelect(valueOf(items[active])); }
      else if (e.key === 'Escape' && props.onClose) { e.preventDefault(); e.stopPropagation(); props.onClose(); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        var k = e.key.toLowerCase();
        var hit = selectable.filter(function (i) { return String(items[i].label).toLowerCase().indexOf(k) === 0; })[0];
        if (hit !== undefined) setActive(hit);
      }
    }
    return h('div', { ref: ref, role: 'menu', tabIndex: -1, className: cx('pn-menu', props.className), style: props.style, onKeyDown: onKeyDown,
        'aria-activedescendant': active >= 0 ? 'pn-mi-' + active : undefined, onMouseLeave: function () { setActive(-1); } },
      items.map(function (it, i) {
        if (it.separator) return h('div', { key: 's' + i, role: 'separator', className: 'pn-menu__sep' });
        if (it.header) return h('div', { key: 'h' + i, className: 'pn-menu__header', role: 'presentation' }, it.header);
        var btn = h('button', { key: it.value || it.label, id: 'pn-mi-' + i, type: 'button', tabIndex: -1, role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked, disabled: it.disabled,
          'aria-haspopup': it.submenu ? 'menu' : undefined, 'aria-expanded': it.submenu ? openSub === i : undefined,
          'data-active': i === active ? 'true' : undefined,
          className: cx('pn-menu__item', it.destructive && 'pn-menu__item--destructive'),
          onMouseEnter: function () { if (!it.disabled) { setActive(i); setOpenSub(it.submenu ? i : -1); setSubKb(false); } },
          onClick: function () { if (it.submenu) { setOpenSub(i); return; } props.onSelect && props.onSelect(valueOf(it)); } },
          hasCheckCol ? h('span', { className: 'pn-menu__check' }, it.checked ? h(Icon, { name: 'check', weight: 2 }) : null) : null,
          hasIconCol ? h('span', { className: 'pn-menu__icon' }, it.icon ? renderIcon(it.icon) : null) : null,
          h('span', { className: 'pn-menu__label' }, it.label),
          it.shortcut ? h('span', { className: 'pn-menu__shortcut' }, it.shortcut) : null,
          it.submenu ? h('span', { className: 'pn-menu__sub' }, h(Icon, { name: 'chevron-right', weight: 2.2 })) : null);
        if (!it.submenu) return btn;
        return h('div', { key: 'w' + i, className: 'pn-menu__subwrap', role: 'none' }, btn,
          openSub === i ? h(Menu, { items: it.submenu, isSubmenu: true, autoFocus: subKb, activeValue: subKb ? valueOf(it.submenu.filter(function (x) { return !x.separator && !x.header && !x.disabled; })[0] || {}) : undefined,
            className: 'pn-menu--sub', onSelect: props.onSelect, onClose: function () { setOpenSub(-1); ref.current && ref.current.focus(); } }) : null);
      }));
  }


  /* ---------- PopUpButton ---------- */
  function PopUpButton(props) {
    var options = props.options || [];
    var st = useControlled(props.value, props.defaultValue !== undefined ? props.defaultValue : options[0] && options[0].value);
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var ref = useRef(null);
    function close(refocus) { setOpen(false); if (refocus && ref.current) { var b = ref.current.querySelector('.pn-popup__btn'); b && b.focus(); } }
    useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', onDoc);
      return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    var current = options.filter(function (x) { return x.value === st[0]; })[0];
    return h('div', { ref: ref, className: cx('pn-popup', props.className) },
      h(Button, { className: 'pn-popup__btn', size: props.size, disabled: props.disabled, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': props['aria-label'], onClick: function () { setOpen(!open); },
          onKeyDown: function (e) { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } } },
        h('span', null, current ? current.label : props.placeholder), h('span', { className: 'pn-popup__chev' }, h(Icon, { name: 'chevron-updown', weight: 2.2 }))),
      open ? h(Menu, { autoFocus: !props.defaultOpen, activeValue: st[0], style: { minWidth: '100%' }, onClose: function () { close(true); },
        items: options.map(function (x) { return { label: x.label, value: x.value, checked: x.value === st[0] }; }),
        onSelect: function (v) { st[1](v); close(true); props.onChange && props.onChange(v); } }) : null);
  }


  /* ---------- Sidebar ---------- */
  function Sidebar(props) {
    var st = useControlled(props.selected, props.defaultSelected);
    var ref = useRef(null);
    var cs = useState(props.defaultCollapsed || []), collapsed = cs[0], setCollapsed = cs[1];
    var es = useState(props.defaultExpanded || []), expanded = es[0], setExpanded = es[1];
    var sections = props.sections || [];
    var first = sections[0] && sections[0].items && sections[0].items[0];
    var anySel = false;
    (function walk(list) { (list || []).forEach(function (it) { if (it.id === st[0]) anySel = true; walk(it.children); }); })(sections.reduce(function (acc, s) { return acc.concat(s.items || []); }, []));
    function toggle(arr, set, key) { set(arr.indexOf(key) >= 0 ? arr.filter(function (x) { return x !== key; }) : arr.concat([key])); }
    function renderItems(items, level, tree) {
      var out = [];
      (items || []).forEach(function (it) {
        var on = st[0] === it.id, hasKids = it.children && it.children.length, open = expanded.indexOf(it.id) >= 0;
        out.push(h('button', { key: it.id, type: 'button', className: 'pn-sidebar__item', 'aria-current': on ? 'true' : undefined, 'aria-expanded': hasKids ? open : undefined, 'aria-level': level > 1 || hasKids ? level : undefined,
            tabIndex: on || (!anySel && first && first.id === it.id) ? 0 : -1, style: level > 1 ? { paddingLeft: 8 + (level - 1) * 14 } : null,
            onClick: function () { st[1](it.id); props.onSelect && props.onSelect(it.id); },
            onKeyDown: function (e) { if (!hasKids) return; if (e.key === 'ArrowRight' && !open) { e.preventDefault(); e.stopPropagation(); toggle(expanded, setExpanded, it.id); } else if (e.key === 'ArrowLeft' && open) { e.preventDefault(); e.stopPropagation(); toggle(expanded, setExpanded, it.id); } } },
          hasKids ? h('span', { className: cx('pn-disclosure', 'pn-sidebar__disc', open && 'pn-disclosure--open'), 'aria-hidden': true, onClick: function (e) { e.stopPropagation(); toggle(expanded, setExpanded, it.id); } }, h(Icon, { name: 'chevron-right', weight: 2 })) : level > 1 || tree ? h('span', { className: 'pn-disclosure-spacer' }) : null,
          it.icon ? h('span', { className: cx('pn-sidebar__icon', props.iconStyle === 'tile' && 'pn-sidebar__icon--tile'), style: props.iconStyle === 'tile' ? { background: it.color || 'var(--accent-fill)' } : { color: it.color || 'var(--accent)' } }, renderIcon(it.icon)) : null,
          h('span', { className: 'pn-sidebar__label' }, it.label),
          it.badge != null ? h('span', { className: 'pn-sidebar__badge' }, it.badge) : null));
        if (hasKids && open) out = out.concat(renderItems(it.children, level + 1, tree));
      });
      return out;
    }
    return h('nav', { ref: ref, className: cx('pn-sidebar', props.className), style: props.style, 'aria-label': props['aria-label'] || '侧栏',
        onKeyDown: function (e) { keyNav(e, ref.current, '.pn-sidebar__item', { select: true }); } },
      sections.map(function (sec, si) {
        var key = sec.id || sec.title || si, isCol = collapsed.indexOf(key) >= 0;
        var anyTree = (sec.items || []).some(function (it) { return it.children && it.children.length; });
        return h('div', { key: si, className: 'pn-sidebar__section' },
          sec.title ? (sec.collapsible
            ? h('button', { type: 'button', className: 'pn-sidebar__title pn-sidebar__title--btn', 'aria-expanded': !isCol, onClick: function () { toggle(collapsed, setCollapsed, key); } },
                h('span', null, sec.title), h('span', { className: cx('pn-sidebar__chev', !isCol && 'pn-sidebar__chev--open') }, h(Icon, { name: 'chevron-right', weight: 2 })))
            : h('div', { className: 'pn-sidebar__title' }, sec.title)) : null,
          isCol ? null : renderItems(sec.items, 1, anyTree));
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
    var railcol = props.rail ? h('div', { className: 'pn-window__railcol' }, h('div', { className: 'pn-window__lights pn-window__lights--rail' }, lights), props.rail) : null;
    if (props.sidebar || props.rail) {
      body = h('div', { className: 'pn-window__body' }, railcol,
        props.sidebar ? h('div', { className: cx('pn-window__sidebarcol', props.rail && 'pn-window__sidebarcol--rail') }, props.rail ? null : h('div', { className: 'pn-window__lights' }, lights), props.sidebar) : null,
        h('div', { className: 'pn-window__main' }, props.toolbar || h(Toolbar, { title: props.title }), h('div', { className: 'pn-window__content', style: props.contentStyle }, props.children)),
        props.inspector ? h('aside', { className: 'pn-window__inspector' }, props.inspector) : null);
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
    var clickable = !!props.onClick;
    var inner = [
      h('div', { key: 'l', className: 'pn-group__text' }, h('div', { className: props.destructive ? 'pn-group__danger' : null }, props.label), props.description ? h('div', { className: 'pn-group__desc' }, props.description) : null),
      props.value != null || props.chevron || clickable ? h('div', { key: 'r', className: 'pn-group__trail' }, props.children, props.value != null ? h('span', { className: 'pn-group__value' }, props.value) : null, (props.chevron || clickable) && !props.destructive ? h(Icon, { name: 'chevron-right', weight: 1.8 }) : null) : props.children
    ];
    return clickable
      ? h('button', { type: 'button', className: cx('pn-group__row', 'pn-group__row--button', props.destructive && 'pn-group__row--danger'), onClick: props.onClick }, inner)
      : h('div', { className: 'pn-group__row' }, inner);
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
    return h('button', { type: 'button', role: 'listitem', className: 'pn-conv', 'aria-current': props.selected ? 'true' : undefined, tabIndex: props.tabIndex, onClick: props.onClick },
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
    var ref = useRef(null);
    var items = props.items || [];
    var anySel = items.some(function (it) { return it.id === st[0]; });
    return h('div', { className: cx('pn', 'pn-convlist', props.className), style: props.style },
      props.header ? h('div', { className: 'pn-convlist__header' }, props.header) : null,
      h('div', { ref: ref, className: 'pn-convlist__items', role: 'list', 'aria-label': props['aria-label'] || '会话',
          onKeyDown: function (e) { keyNav(e, ref.current, '.pn-conv', { select: true }); } },
        items.map(function (it, i) {
          return h(ConversationItem, { key: it.id, item: it, selected: st[0] === it.id, tabIndex: st[0] === it.id || (!anySel && i === 0) ? 0 : -1, onClick: function () { st[1](it.id); props.onSelect && props.onSelect(it.id); } });
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
      props.addable ? h(Popover, { placement: 'top-start', 'aria-label': '添加表情回复', defaultOpen: props.defaultPickerOpen, className: 'pn-reaction__picker',
          trigger: h('button', { type: 'button', className: 'pn-reaction pn-reaction--add', 'aria-label': '添加表情回复' }, h(Icon, { name: 'smile' })) },
          h(EmojiPicker, { onSelect: function (e) { props.onToggle && props.onToggle(e); } }))
      : props.onAdd ? h('button', { type: 'button', className: 'pn-reaction pn-reaction--add', 'aria-label': '添加表情回复', onClick: props.onAdd }, h(Icon, { name: 'smile' })) : null);
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
  function MessageList(props) {
    var ref = useRef(null);
    var count = React.Children.count(props.children);
    useEffect(function () {
      if (!props.stickToBottom || !ref.current) return;
      var sc = ref.current.parentElement;
      while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      if (sc && sc !== document.body) sc.scrollTop = sc.scrollHeight;
    }, [count, props.stickToBottom]);
    return h('div', { ref: ref, className: cx('pn', 'pn-msglist', props.className), style: props.style, role: 'log', 'aria-label': props['aria-label'] || '消息' }, props.children);
  }

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
    if (kind === 'recalled') return h('div', { className: 'pn-notice pn-notice--system' }, h('span', null, props.children || '你撤回了一条消息',
      props.action ? h('button', { type: 'button', className: 'pn-notice__action', onClick: props.action.onClick }, props.action.label) : null));
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
  function filterMembers(members, query, includeAll) {
    var q = String(query || '').toLowerCase();
    var list = (members || []).filter(function (m) { return !q || String(m.name).toLowerCase().indexOf(q) >= 0 || String(m.pinyin || '').toLowerCase().indexOf(q) === 0; });
    if (includeAll && (!q || '所有人'.indexOf(q) >= 0 || 'all'.indexOf(q) === 0)) list = [{ id: '__all', name: '所有人', subtitle: (members || []).length + ' 人', all: true }].concat(list);
    return list.slice(0, 8);
  }
  function Composer(props) {
    var st = useControlled(props.value, props.defaultValue || '');
    var ref = useRef(null);
    var init = null;
    if (props.defaultMentionOpen) { var m0 = /(^|[^A-Za-z0-9_])@([^\s@]{0,20})$/.exec(props.defaultValue || ''); if (m0) init = { start: m0.index + m0[1].length, query: m0[2] }; }
    var ms = useState(init), mention = ms[0], setMention = ms[1];
    var ep = useState(!!props.defaultEmojiOpen), emojiOpen = ep[0], setEmojiOpen = ep[1];
    var rootRef = useRef(null);
    useEffect(function () {
      if (!emojiOpen) return;
      function onDoc(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setEmojiOpen(false); }
      function onKey(e) { if (e.key === 'Escape') setEmojiOpen(false); }
      document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [emojiOpen]);
    var ai = useState(0), active = ai[0], setActive = ai[1];
    var members = props.mentions || null;
    var list = mention && members ? filterMembers(members, mention.query, props.mentionAll !== false) : [];
    useEffect(function () { var t = ref.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 114) + 'px'; }, [st[0]]);
    function set(v) { st[1](v); props.onChange && props.onChange(v); }
    function send() { var v = String(st[0] || '').trim(); if (!v) return; props.onSend && props.onSend(v); if (props.value === undefined) set(''); setMention(null); }
    function detect(v, caret) {
      if (!members) return;
      var m = /(^|[^A-Za-z0-9_])@([^\s@]{0,20})$/.exec(v.slice(0, caret));
      setMention(m ? { start: m.index + m[1].length, query: m[2] } : null); setActive(0);
    }
    function caretTo(pos) { setTimeout(function () { var t = ref.current; if (t) { t.focus(); t.setSelectionRange(pos, pos); } }, 0); }
    function insertAtCaret(text) {
      var v = String(st[0] || ''), t = ref.current, c = t ? t.selectionStart : v.length;
      var nv = v.slice(0, c) + text + v.slice(c); set(nv); caretTo(c + text.length); return { value: nv, caret: c + text.length };
    }
    function pick(item) {
      var v = String(st[0] || ''), t = ref.current, c = t && document.activeElement === t ? t.selectionStart : v.length;
      var ins = '@' + item.name + ' ';
      var nv = v.slice(0, mention.start) + ins + v.slice(c);
      set(nv); setMention(null); caretTo(mention.start + ins.length);
      props.onMention && props.onMention(item);
    }
    function onKeyDown(e) {
      if (e.nativeEvent.isComposing) return;
      if (mention && list.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % list.length); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + list.length) % list.length); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[Math.min(active, list.length - 1)]); return; }
        if (e.key === 'Escape') { e.preventDefault(); setMention(null); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    }
    function toolClick(t) {
      if (t.onClick) return t.onClick();
      if (t.icon === 'at') { var r = insertAtCaret('@'); detect(r.value, r.caret); }
      if (t.icon === 'smile') { setMention(null); setEmojiOpen(!emojiOpen); }
    }
    return h('div', { ref: rootRef, className: cx('pn', 'pn-composer', props.className), style: props.style },
      emojiOpen ? h(EmojiPicker, { className: 'pn-composer__popover', recent: props.recentEmoji, onSelect: function (e) { insertAtCaret(e); setEmojiOpen(false); } }) : null,
      mention && list.length ? h(MentionPicker, { className: 'pn-composer__popover', items: list, query: mention.query, activeIndex: active, onActiveChange: setActive, onSelect: pick }) : null,
      props.replyTo ? h('div', { className: 'pn-composer__reply' },
        h('div', { className: 'pn-quote' }, h('b', null, '回复 ' + props.replyTo.author + '：'), props.replyTo.text),
        props.onCancelReply ? h('button', { type: 'button', className: 'pn-pinned__close', 'aria-label': '取消回复', onClick: props.onCancelReply }, h(Icon, { name: 'xmark', weight: 2.2 })) : null) : null,
      h('textarea', { ref: ref, rows: 1, value: st[0], placeholder: props.placeholder || '发送给 ' + (props.recipient || '…'), 'aria-label': props['aria-label'] || '消息输入', disabled: props.disabled,
        'aria-autocomplete': members ? 'list' : undefined, 'aria-expanded': members ? !!(mention && list.length) : undefined,
        onChange: function (e) { set(e.target.value); detect(e.target.value, e.target.selectionStart); },
        onKeyDown: onKeyDown, onBlur: function () { setTimeout(function () { if (ref.current && document.activeElement !== ref.current) setMention(null); }, 150); } }),
      h('div', { className: 'pn-composer__bar' },
        (props.tools || DEFAULT_TOOLS).map(function (t, i) {
          return h('button', { key: i, type: 'button', className: 'pn-composer__tool', 'aria-label': t.label, title: t.label, 'aria-pressed': t.icon === 'smile' ? emojiOpen : undefined, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { toolClick(t); } }, h(Icon, { name: t.icon }));
        }),
        props.accessory ? h('span', { className: 'pn-composer__accessory' }, props.accessory) : null,
        props.hint !== false ? h('span', { className: 'pn-composer__hint' }, props.hint || 'Enter 发送 · ⇧Enter 换行') : h('span', { style: { marginLeft: 'auto' } }),
        h('button', { type: 'button', className: 'pn-composer__send', 'aria-label': '发送', disabled: !String(st[0] || '').trim(), onClick: send }, h(Icon, { name: 'send', weight: 2.2 }))));
  }



  /* ---------- NavRail ---------- */
  function NavRail(props) {
    var st = useControlled(props.selected, props.defaultSelected !== undefined ? props.defaultSelected : props.items && props.items[0] && props.items[0].id);
    function item(it) {
      var on = st[0] === it.id;
      return h('button', { key: it.id, type: 'button', className: 'pn-rail__item', 'aria-current': on ? 'page' : undefined, title: it.label, tabIndex: on ? 0 : -1,
          onClick: function () { st[1](it.id); props.onSelect && props.onSelect(it.id); } },
        h('span', { className: 'pn-rail__tile' }, renderIcon(it.icon),
          it.badge ? h('span', { className: 'pn-rail__badge' }, h(Badge, { count: it.badge, muted: it.muted })) : it.dot ? h('span', { className: 'pn-rail__dot', 'aria-label': '有新内容' }) : null),
        h('span', { className: 'pn-rail__label' }, it.label));
    }
    var railRef = useRef(null);
    return h('nav', { ref: railRef, className: cx('pn', 'pn-rail', props.className), style: props.style, 'aria-label': props['aria-label'] || '应用导航',
        onKeyDown: function (e) { keyNav(e, railRef.current, '.pn-rail__item', { select: true }); } },
      props.avatar ? h('div', { className: 'pn-rail__me' }, h(Avatar, Object.assign({ size: 32 }, props.avatar))) : null,
      h('div', { className: 'pn-rail__items' }, (props.items || []).map(item)),
      props.footer ? h('div', { className: 'pn-rail__items pn-rail__footer' }, props.footer.map(item)) : null);
  }


  /* ---------- ChatInfoPanel (inspector) ---------- */
  function ChatInfoPanel(props) {
    var members = props.members || [];
    var shown = members.slice(0, props.maxMembers || 9);
    return h('div', { className: cx('pn', 'pn-info', props.className), style: props.style, role: 'complementary', 'aria-label': props.title || '群设置' },
      h('div', { className: 'pn-info__head' }, h('span', null, props.title || '群设置'),
        props.onClose ? h('button', { type: 'button', className: 'pn-info__close', 'aria-label': '关闭', onClick: props.onClose }, h(Icon, { name: 'xmark', weight: 2 })) : null),
      h('div', { className: 'pn-info__scroll' },
        h('div', { className: 'pn-info__id' },
          props.avatar || h(Avatar, { name: props.name, size: 56, shape: props.group === false ? 'circle' : 'square' }),
          h('div', { className: 'pn-info__name' }, props.name, (props.tags || []).map(function (t, i) { return h(Tag, { key: i, tone: t.tone }, t.label); })),
          props.description ? h('div', { className: 'pn-info__desc' }, props.description) : null),
        props.shortcuts && props.shortcuts.length ? h('div', { className: 'pn-info__shortcuts' }, props.shortcuts.map(function (s, i) {
          return h('button', { key: i, type: 'button', className: 'pn-info__shortcut', onClick: s.onClick }, h('span', { className: 'pn-info__shortcut-icon' }, renderIcon(s.icon)), h('span', null, s.label));
        })) : null,
        members.length ? h('section', { className: 'pn-info__section' },
          h('div', { className: 'pn-info__section-head' }, h('span', null, '群成员 ', h('span', { className: 'pn-info__count' }, props.memberCount || members.length)),
            props.onShowAllMembers ? h('button', { type: 'button', className: 'pn-info__link', onClick: props.onShowAllMembers }, '查看全部') : null),
          h('div', { className: 'pn-info__members' },
            props.onAddMember ? h('button', { type: 'button', className: 'pn-info__member', onClick: props.onAddMember }, h('span', { className: 'pn-info__add' }, h(Icon, { name: 'plus', weight: 1.8 })), h('span', null, '添加')) : null,
            shown.map(function (m, i) { return h('div', { key: i, className: 'pn-info__member' }, h(Avatar, Object.assign({ size: 36 }, m)), h('span', null, m.name)); }))) : null,
        props.children,
        props.settings && props.settings.length ? h(GroupBox, null, props.settings.map(function (r, i) { return h(GroupRow, Object.assign({ key: i }, r), r.control); })) : null,
        props.danger ? h(GroupBox, null, h(GroupRow, { label: props.danger.label, destructive: true, onClick: props.danger.onClick || function () {} })) : null));
  }


  /* ---------- ThreadPanel ---------- */
  function ThreadPanel(props) {
    var replies = React.Children.toArray(props.children);
    return h('div', { className: cx('pn', 'pn-threadpanel', props.className), style: props.style, role: 'complementary', 'aria-label': props.title || '话题' },
      h('div', { className: 'pn-info__head' },
        h('div', { className: 'pn-threadpanel__titles' }, h('span', null, props.title || '话题'), props.subtitle ? h('span', { className: 'pn-threadpanel__sub' }, props.subtitle) : null),
        props.onClose ? h('button', { type: 'button', className: 'pn-info__close', 'aria-label': '关闭话题', onClick: props.onClose }, h(Icon, { name: 'xmark', weight: 2 })) : null),
      h('div', { className: 'pn-threadpanel__scroll' },
        h('div', { className: 'pn-threadpanel__root' }, props.root),
        h('div', { className: 'pn-threadpanel__count', role: 'separator' }, (props.replyCount != null ? props.replyCount : replies.length) + ' 条回复'),
        h('div', { className: 'pn-threadpanel__replies' }, replies)),
      props.composer !== false ? h('div', { className: 'pn-threadpanel__composer' },
        h(Composer, Object.assign({ placeholder: '回复话题', hint: false, tools: DEFAULT_TOOLS.slice(0, 4),
          accessory: props.alsoSend !== false ? h(Checkbox, { label: '同时发送到群聊', defaultChecked: !!props.alsoSendDefault }) : null }, props.composerProps))) : null);
  }


  /* ---------- Popover ---------- */
  function Popover(props) {
    var st = useControlled(props.open, !!props.defaultOpen);
    var ref = useRef(null);
    function setOpen(v) { st[1](v); props.onOpenChange && props.onOpenChange(v); }
    useEffect(function () {
      if (!st[0]) return;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      function onKey(e) { if (e.key === 'Escape') setOpen(false); }
      document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [st[0]]);
    return h('span', { ref: ref, className: cx('pn-popover-anchor', props.className) },
      h('span', { className: 'pn-popover-trigger', onClick: function () { setOpen(!st[0]); } }, props.trigger),
      st[0] ? h('div', { role: 'dialog', 'aria-label': props['aria-label'], className: cx('pn', 'pn-popover', 'pn-popover--' + (props.placement || 'bottom-start')), style: { width: props.width } }, props.children) : null);
  }

  /* ---------- MentionPicker ---------- */
  function MentionPicker(props) {
    var items = props.items || filterMembers(props.members, props.query, props.includeAll !== false);
    var active = props.activeIndex || 0;
    var q = String(props.query || '');
    function hl(name) {
      if (!q) return name;
      var i = String(name).toLowerCase().indexOf(q.toLowerCase());
      return i < 0 ? name : [name.slice(0, i), h('b', { key: 'b' }, name.slice(i, i + q.length)), name.slice(i + q.length)];
    }
    return h('div', { className: cx('pn', 'pn-mentionpicker', props.className), style: props.style, role: 'listbox', 'aria-label': '选择要提及的人' },
      h('div', { className: 'pn-mentionpicker__head' }, q ? '匹配「' + q + '」' : '群成员'),
      items.length ? items.map(function (m, i) {
        return h('div', { key: m.id || m.name, role: 'option', 'aria-selected': i === active, className: 'pn-mentionpicker__item',
            onMouseEnter: function () { props.onActiveChange && props.onActiveChange(i); },
            onMouseDown: function (e) { e.preventDefault(); props.onSelect && props.onSelect(m); } },
          m.all ? h('span', { className: 'pn-mentionpicker__all' }, h(Icon, { name: 'at', weight: 1.8 })) : h(Avatar, { name: m.name, src: m.avatar, size: 24, status: m.status }),
          h('span', { className: 'pn-mentionpicker__name' }, hl(m.name)),
          m.subtitle ? h('span', { className: 'pn-mentionpicker__sub' }, m.subtitle) : null);
      }) : h('div', { className: 'pn-mentionpicker__empty' }, '没有匹配的成员'));
  }

  /* ---------- ProfileCard ---------- */
  function ProfileCard(props) {
    return h('div', { className: cx('pn', 'pn-profile', props.className), style: props.style },
      h('div', { className: 'pn-profile__top' },
        h(Avatar, { name: props.name, src: props.avatar, size: 56, status: props.status }),
        h('div', { className: 'pn-profile__id' },
          h('div', { className: 'pn-profile__name' }, props.name, (props.tags || []).map(function (t, i) { return h(Tag, { key: i, tone: t.tone }, t.label); })),
          props.statusText ? h('div', { className: 'pn-profile__status' }, h('span', { className: 'pn-profile__dot pn-avatar__status--' + (props.status || 'online') }), props.statusText) : null,
          props.title ? h('div', { className: 'pn-profile__title' }, props.title) : null)),
      props.fields && props.fields.length ? h('dl', { className: 'pn-profile__fields' }, props.fields.map(function (f, i) {
        return h(React.Fragment, { key: i }, h('dt', null, f.label), h('dd', null, f.value));
      })) : null,
      props.actions && props.actions.length ? h('div', { className: 'pn-profile__actions' }, props.actions.map(function (a, i) {
        return h(Button, { key: i, variant: a.variant || (i === 0 ? 'primary' : 'default'), icon: a.icon, 'aria-label': a.label, onClick: a.onClick, style: a.text === false ? null : { flex: 1 } }, a.text === false ? undefined : a.label);
      })) : null);
  }


  /* ---------- EmojiPicker ---------- */
  var EMOJI = [
    { id: 'smile', label: '笑脸', items: [['😀','笑 开心'],['😄','大笑 开心'],['😂','笑哭'],['🤣','打滚笑'],['😊','微笑 害羞'],['🙂','微笑'],['😉','眨眼'],['😍','喜欢 爱心眼'],['🥳','庆祝 派对'],['😎','酷 墨镜'],['🤔','思考 想'],['😮','惊讶 哇'],['😅','尴尬 汗'],['😴','困 睡觉'],['😢','难过 哭'],['😭','大哭'],['😡','生气'],['🤯','爆炸 震惊'],['🥲','含泪笑'],['😬','紧张'],['🤗','拥抱'],['🫡','敬礼 收到'],['🙃','倒脸'],['😇','天使']] },
    { id: 'hand', label: '手势', items: [['👍','赞 好 同意'],['👎','踩 不同意'],['👌','好的 OK'],['🙏','谢谢 拜托'],['👏','鼓掌'],['🙌','举手 庆祝'],['💪','加油 强'],['🤝','握手 合作'],['👋','你好 再见 挥手'],['✌️','耶 胜利'],['🤞','祈祷 好运'],['👀','看 关注'],['✋','举手 停'],['🫶','比心'],['☝️','一 注意'],['👉','这里 指']] },
    { id: 'symbol', label: '符号', items: [['✅','完成 对 已处理'],['❌','错 不行'],['⭕','对 可以'],['❗','重要 注意'],['❓','问题 疑问'],['🔥','火 热门'],['✨','闪亮 新'],['🎉','庆祝 撒花'],['❤️','爱心 喜欢'],['💯','满分 一百'],['⚡','闪电 加急'],['🚀','火箭 上线 发布'],['📌','置顶 固定'],['📎','附件'],['📅','日程 日历'],['☕','咖啡 休息'],['🍵','茶'],['🎯','目标'],['💡','想法 灯泡'],['⏰','闹钟 时间']] }
  ];
  var QUICK = ['👍', '✅', '🎉', '😄', '🙏', '👀'];
  function EmojiPicker(props) {
    var q = useState(''), query = q[0], setQuery = q[1];
    var c = useState(props.defaultCategory || 'recent'), cat = c[0], setCat = c[1];
    var recent = props.recent || QUICK.concat(['🔥', '💪']);
    var cats = [{ value: 'recent', label: '常用' }].concat(EMOJI.map(function (x) { return { value: x.id, label: x.label }; }));
    var all = [];
    EMOJI.forEach(function (g) { g.items.forEach(function (it) { all.push(it); }); });
    var items = query ? all.filter(function (it) { return it[1].indexOf(query) >= 0; })
      : cat === 'recent' ? recent.map(function (e) { var f = all.filter(function (it) { return it[0] === e; })[0]; return f || [e, e]; })
      : (EMOJI.filter(function (g) { return g.id === cat; })[0] || EMOJI[0]).items;
    return h('div', { className: cx('pn', 'pn-emoji', props.className), style: props.style, role: 'dialog', 'aria-label': '选择表情' },
      h(SearchField, { placeholder: '搜索表情', value: query, onChange: setQuery, style: { minWidth: 0, width: '100%' } }),
      !query ? h(SegmentedControl, { size: 'small', items: cats, value: cat, onChange: setCat, 'aria-label': '表情分类' }) : null,
      items.length ? h('div', { className: 'pn-emoji__grid', role: 'listbox', 'aria-label': query ? '搜索结果' : '表情', onKeyDown: function (e) { keyNav(e, e.currentTarget, '.pn-emoji__cell', { cols: 8 }); } }, items.map(function (it) {
        return h('button', { key: it[0], type: 'button', role: 'option', className: 'pn-emoji__cell', title: it[1].split(' ')[0], 'aria-label': it[1].split(' ')[0],
          onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { props.onSelect && props.onSelect(it[0]); } }, it[0]);
      })) : h('div', { className: 'pn-emoji__empty' }, '没有找到相关表情'));
  }


  /* ---------- VoiceMessage ---------- */
  function fmtDur(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function VoiceMessage(props) {
    var secs = props.duration || 5;
    var p = useState(!!props.playing), playing = p[0], setPlaying = p[1];
    var pl = useState(!!props.played), played = pl[0], setPlayed = pl[1];
    var n = Math.max(12, Math.min(36, Math.round(10 + secs * 0.9)));
    var seed = hashIndex(String(props.seed || secs), 9973) + 7, bars = [];
    for (var i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; bars.push(0.25 + (seed % 1000) / 1000 * 0.75); }
    var prog = props.progress != null ? props.progress : playing ? 0.35 : 0;
    return h('div', { className: cx('pn-voice', props.className) },
      h('div', { className: 'pn-voice__row' },
        h('button', { type: 'button', className: 'pn-voice__play', 'aria-label': playing ? '暂停' : '播放语音', 'aria-pressed': playing,
            onClick: function () { setPlaying(!playing); setPlayed(true); props.onPlay && props.onPlay(!playing); } },
          h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'currentColor', 'aria-hidden': true },
            playing ? [h('rect', { key: 1, x: 3.5, y: 2.5, width: 3, height: 11, rx: 1 }), h('rect', { key: 2, x: 9.5, y: 2.5, width: 3, height: 11, rx: 1 })] : h('path', { d: 'M4.5 2.8v10.4c0 .6.6.9 1.1.6l8.2-5.2c.5-.3.5-1 0-1.3L5.6 2.2c-.5-.3-1.1 0-1.1.6z' }))),
        h('span', { className: 'pn-voice__wave', 'aria-hidden': true }, bars.map(function (b, i) {
          return h('i', { key: i, style: { height: Math.round(b * 20) + 'px' }, className: i / n < prog ? 'on' : null });
        })),
        h('span', { className: 'pn-voice__dur' }, fmtDur(secs)),
        !played ? h('span', { className: 'pn-voice__unread', 'aria-label': '未听' }) : null),
      props.transcript ? h('div', { className: 'pn-voice__text' }, props.transcript) : null);
  }

  /* ---------- LinkPreview ---------- */
  function LinkPreview(props) {
    return h('a', { className: cx('pn-link', props.className), href: props.url || '#', target: '_blank', rel: 'noopener noreferrer', style: props.style },
      props.image ? h('span', { className: 'pn-link__img' }, h('img', { src: props.image, alt: '' })) : null,
      h('span', { className: 'pn-link__body' },
        h('span', { className: 'pn-link__site' }, h(Icon, { name: 'globe' }), props.site || String(props.url || '').replace(/^https?:\/\//, '').split('/')[0]),
        h('span', { className: 'pn-link__title' }, props.title),
        props.description ? h('span', { className: 'pn-link__desc' }, props.description) : null));
  }

  /* ---------- CodeBlock ---------- */
  function CodeBlock(props) {
    var c = useState(false), copied = c[0], setCopied = c[1];
    function copy() {
      try { navigator.clipboard && navigator.clipboard.writeText(props.code); } catch (e) {}
      setCopied(true); setTimeout(function () { setCopied(false); }, 1500);
    }
    return h('div', { className: cx('pn-code', props.className), style: props.style },
      h('div', { className: 'pn-code__head' }, h('span', null, props.filename || props.language || '代码'),
        h('button', { type: 'button', className: 'pn-code__copy', onClick: copy, 'aria-live': 'polite' }, h(Icon, { name: copied ? 'check' : 'copy' }), copied ? '已拷贝' : '拷贝')),
      h('pre', { className: 'pn-code__pre', tabIndex: 0 }, h('code', null, props.code)));
  }


  /* ---------- MeetingCard ---------- */
  function MeetingCard(props) {
    var status = props.status || 'scheduled';
    var tag = status === 'live' ? h(Tag, { tone: 'green' }, h('span', { className: 'pn-live' }), '进行中')
      : status === 'ended' ? h(Tag, { tone: 'gray' }, '已结束') : h(Tag, { tone: 'blue' }, props.startsIn || '即将开始');
    var ppl = props.participants || [];
    return h('div', { className: cx('pn-card', 'pn-meet', 'pn-meet--' + status, props.className), style: props.style },
      h('div', { className: 'pn-meet__top' },
        h('span', { className: 'pn-meet__icon' }, h(Icon, { name: 'video' })),
        h('div', { className: 'pn-meet__titles' }, h('div', { className: 'pn-meet__title' }, props.title), h('div', { className: 'pn-meet__time' }, props.time)),
        tag),
      h('dl', { className: 'pn-meet__meta' },
        props.meetingId ? [h('dt', { key: 'a' }, '会议号'), h('dd', { key: 'b', className: 'pn-meet__id' }, props.meetingId)] : null,
        props.host ? [h('dt', { key: 'c' }, '发起人'), h('dd', { key: 'd' }, props.host)] : null,
        status === 'ended' && props.duration ? [h('dt', { key: 'e' }, '时长'), h('dd', { key: 'f' }, props.duration)] : null),
      h('div', { className: 'pn-meet__foot' },
        ppl.length ? h('span', { className: 'pn-meet__ppl' }, h(AvatarGroup, { people: ppl, size: 20, max: 4 }),
          h('span', null, status === 'live' ? (props.joined || ppl.length) + ' 人在会中' : status === 'ended' ? ppl.length + ' 人参加' : ppl.length + ' 人受邀')) : h('span'),
        status === 'ended'
          ? (props.onReplay ? h(Button, { icon: 'record', onClick: props.onReplay }, '查看回放') : null)
          : h(Button, { variant: 'primary', onClick: props.onJoin }, '加入会议')));
  }

  /* ---------- EventCard ---------- */
  function EventCard(props) {
    var r = useControlled(props.rsvp, props.defaultRsvp || null);
    return h('div', { className: cx('pn-card', 'pn-event', props.className), style: props.style },
      h('div', { className: 'pn-event__top' },
        h('div', { className: 'pn-event__date', 'aria-label': props.month + props.day + '日 ' + (props.weekday || '') },
          h('span', { className: 'pn-event__month' }, props.weekday || props.month), h('span', { className: 'pn-event__day' }, props.day)),
        h('div', { className: 'pn-event__body' },
          h('div', { className: 'pn-event__title' }, props.title),
          h('div', { className: 'pn-event__line' }, h(Icon, { name: 'clock' }), props.time),
          props.location ? h('div', { className: 'pn-event__line' }, h(Icon, { name: 'mappin' }), props.location) : null,
          props.organizer ? h('div', { className: 'pn-event__line' }, h(Icon, { name: 'person' }), props.organizer + ' 组织' + (props.attendees ? ' · ' + props.attendees + ' 人' : '')) : null)),
      props.rsvp !== false ? h('div', { className: 'pn-event__foot' },
        h('span', null, r[0] === 'accepted' ? '你已接受' : r[0] === 'declined' ? '你已拒绝' : r[0] === 'tentative' ? '你已回复待定' : '是否参加？'),
        h(SegmentedControl, { size: 'small', 'aria-label': '回复日程', value: r[0] || '', onChange: function (v) { r[1](v); props.onRsvp && props.onRsvp(v); },
          items: [{ value: 'accepted', label: '接受' }, { value: 'tentative', label: '待定' }, { value: 'declined', label: '拒绝' }] })) : null);
  }


  /* ---------- EmptyState ---------- */
  function EmptyState(props) {
    return h('div', { className: cx('pn', 'pn-empty', props.compact && 'pn-empty--compact', props.className), style: props.style },
      props.icon !== false ? h('span', { className: 'pn-empty__icon', 'aria-hidden': true }, renderIcon(props.icon || 'message')) : null,
      h('div', { className: 'pn-empty__title' }, props.title),
      props.description ? h('div', { className: 'pn-empty__desc' }, props.description) : null,
      props.action ? h('div', { className: 'pn-empty__action' }, props.action) : null);
  }

  /* ---------- Skeleton ---------- */
  function Skeleton(props) {
    var n = props.count || 3, v = props.variant || 'text', rows = [];
    for (var i = 0; i < n; i++) {
      var w = [72, 48, 86, 60, 78][i % 5];
      if (v === 'conversation') rows.push(h('div', { key: i, className: 'pn-skel__conv' }, h('i', { className: 'pn-skel pn-skel--circle', style: { width: 40, height: 40 } }),
        h('span', { className: 'pn-skel__lines' }, h('i', { className: 'pn-skel', style: { width: (w - 20) + '%' } }), h('i', { className: 'pn-skel', style: { width: w + '%' } }))));
      else if (v === 'message') rows.push(h('div', { key: i, className: cx('pn-skel__msg', i % 3 === 2 && 'pn-skel__msg--self') }, h('i', { className: 'pn-skel pn-skel--circle', style: { width: 32, height: 32 } }),
        h('span', { className: 'pn-skel__lines' }, i % 3 !== 2 ? h('i', { className: 'pn-skel', style: { width: 64, height: 10 } }) : null, h('i', { className: 'pn-skel pn-skel--bubble', style: { width: (w * 3) + 'px' } }))));
      else if (v === 'block') rows.push(h('i', { key: i, className: 'pn-skel pn-skel--block', style: { width: props.width || '100%', height: props.height || 120 } }));
      else rows.push(h('i', { key: i, className: 'pn-skel', style: { width: i === n - 1 ? '60%' : '100%' } }));
    }
    return h('div', { className: cx('pn-skeleton', 'pn-skeleton--' + v, props.className), style: props.style, role: 'status', 'aria-busy': true, 'aria-label': props.label || '正在载入' }, rows);
  }

  /* ---------- TypingIndicator ---------- */
  function TypingIndicator(props) {
    return h('div', { className: cx('pn-typing', props.className), role: 'status', 'aria-live': 'polite' },
      props.bubble !== false ? h('span', { className: 'pn-typing__bubble', 'aria-hidden': true }, h('i'), h('i'), h('i')) : null,
      props.name ? h('span', { className: 'pn-typing__text' }, (Array.isArray(props.name) ? (props.name.length > 2 ? props.name.slice(0, 2).join('、') + ' 等 ' + props.name.length + ' 人' : props.name.join('、')) : props.name) + ' 正在输入…') : null);
  }


  /* ---------- NotificationBanner ---------- */
  function NotificationBanner(props) {
    var app = props.app || { name: '消息' };
    var appIcon = app.icon || h('span', { className: 'pn-notif__appicon' }, h(Icon, { name: 'message', weight: 1.8 }));
    return h('div', { className: cx('pn', 'pn-notif', props.stacked && 'pn-notif--stacked', props.className), style: props.style, role: 'alert', 'aria-label': app.name + '：' + props.title },
      props.stacked ? h('span', { className: 'pn-notif__layer', 'aria-hidden': true }) : null,
      h('div', { className: 'pn-notif__card' },
        props.onClose ? h('button', { type: 'button', className: 'pn-notif__close', 'aria-label': '关闭通知', onClick: props.onClose }, h(Icon, { name: 'xmark', weight: 2.2 })) : null,
        h('div', { className: 'pn-notif__main' },
          props.avatar ? h('span', { className: 'pn-notif__lead' }, h(Avatar, Object.assign({ size: 38 }, props.avatar)), h('span', { className: 'pn-notif__badge' }, appIcon)) : h('span', { className: 'pn-notif__lead' }, appIcon),
          h('div', { className: 'pn-notif__text' },
            h('div', { className: 'pn-notif__top' }, h('span', { className: 'pn-notif__title' }, props.title), h('span', { className: 'pn-notif__time' }, props.time || '现在')),
            props.subtitle ? h('div', { className: 'pn-notif__subtitle' }, props.subtitle) : null,
            h('div', { className: 'pn-notif__body' }, props.body),
            props.stacked ? h('div', { className: 'pn-notif__more' }, '另外 ' + props.stacked + ' 条通知') : null)),
        props.actions && props.actions.length ? h('div', { className: 'pn-notif__actions' }, props.actions.map(function (a, i) {
          return h('button', { key: i, type: 'button', className: 'pn-notif__action', onClick: a.onClick }, a.label);
        })) : null));
  }

  /* ---------- ContextMenu ---------- */
  function messageMenuItems(opts) {
    opts = opts || {};
    var items = [{ label: '回复', value: 'reply', icon: 'reply' }, { label: '回复话题', value: 'thread', icon: 'thread' }, { label: '转发', value: 'forward', icon: 'forward' },
      { separator: true }, { label: '拷贝', value: 'copy', shortcut: '⌘C' }, { label: '置顶', value: 'pin' }, { label: '标记为待办', value: 'todo' }, { label: '多选', value: 'select' }];
    if (opts.self) items.push({ separator: true }, { label: '编辑', value: 'edit' }, { label: '撤回', value: 'recall', destructive: true });
    else items.push({ separator: true }, { label: '删除', value: 'delete', destructive: true });
    return items;
  }
  function ContextMenu(props) {
    var init = props.defaultPosition || null;
    var s = useState(init), pos = s[0], setPos = s[1];
    var ref = useRef(null);
    useEffect(function () {
      if (!pos) return;
      function close(e) { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'mousedown' && ref.current && ref.current.querySelector('.pn-menu') && ref.current.querySelector('.pn-menu').contains(e.target)) return; setPos(null); }
      document.addEventListener('mousedown', close); document.addEventListener('keydown', close); window.addEventListener('blur', close);
      return function () { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); window.removeEventListener('blur', close); };
    }, [pos]);
    return h('div', { ref: ref, className: cx('pn-ctx', props.className), style: props.style,
        onContextMenu: function (e) { e.preventDefault(); var r = ref.current.getBoundingClientRect(); setPos({ x: e.clientX - r.left, y: e.clientY - r.top, kb: false }); props.onOpen && props.onOpen(); },
        onKeyDown: function (e) { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setPos({ x: 16, y: 16, kb: true }); props.onOpen && props.onOpen(); } } },
      props.children,
      pos ? h(Menu, { items: props.items || [], activeValue: props.activeValue, autoFocus: !props.defaultPosition || pos.kb !== undefined, onClose: function () { setPos(null); }, style: { position: 'absolute', left: pos.x, top: pos.y, zIndex: 40, minWidth: 200 },
        onSelect: function (v) { setPos(null); props.onSelect && props.onSelect(v); } }) : null);
  }


  /* ---------- Table (NSTableView / outline) ---------- */
  function Table(props) {
    var columns = props.columns || [];
    var multiple = props.multiple !== false;
    var sel = useControlled(props.selection, props.defaultSelection || []);
    var so = useControlled(props.sort, props.defaultSort || null);
    var ex = useState(props.defaultExpanded || []), expanded = ex[0], setExpanded = ex[1];
    var anchor = useRef(null), ref = useRef(null);
    var isTree = (props.rows || []).some(function (r) { return r.children && r.children.length; });
    var tpl = columns.map(function (c) { return typeof c.width === 'number' ? c.width + 'px' : c.width || 'minmax(0, 1fr)'; }).join(' ');
    function cmp(a, b) {
      var s = so[0]; if (!s) return 0;
      var col = columns.filter(function (c) { return c.key === s.key; })[0] || {};
      var va = col.sortValue ? col.sortValue(a) : a[s.key], vb = col.sortValue ? col.sortValue(b) : b[s.key];
      var r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'zh-Hans-CN', { numeric: true });
      return s.dir === 'desc' ? -r : r;
    }
    var visible = [];
    (function walk(rows, level) {
      var list = (rows || []).slice();
      if (so[0] && props.sortRows !== false) list.sort(cmp);
      list.forEach(function (r) {
        visible.push({ row: r, level: level });
        if (r.children && expanded.indexOf(r.id) >= 0) walk(r.children, level + 1);
      });
    })(props.rows, 1);
    var ids = visible.map(function (v) { return v.row.id; });
    function setSel(next) { sel[1](next); props.onSelectionChange && props.onSelectionChange(next); }
    function toggleExpand(id, open) {
      var on = expanded.indexOf(id) >= 0; if (open === on) return;
      setExpanded(on ? expanded.filter(function (x) { return x !== id; }) : expanded.concat([id]));
    }
    function clickRow(e, id) {
      if (multiple && (e.metaKey || e.ctrlKey)) { var cur = sel[0]; setSel(cur.indexOf(id) >= 0 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id])); anchor.current = id; return; }
      if (multiple && e.shiftKey && anchor.current != null) {
        var a = ids.indexOf(anchor.current), b = ids.indexOf(id); if (a < 0) a = b;
        setSel(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); return;
      }
      setSel([id]); anchor.current = id;
    }
    useEffect(function () {
      if (!ref.current || !sel[0].length) return;
      var last = ref.current.querySelector('[data-row-id="' + String(sel[0][sel[0].length - 1]).replace(/"/g, '') + '"]');
      if (last && ref.current.contains(document.activeElement)) last.scrollIntoView({ block: 'nearest' });
    }, [sel[0]]);
    function onKeyDown(e) {
      var cur = sel[0], last = cur.length ? cur[cur.length - 1] : null, i = ids.indexOf(last);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        var id = ids[n]; if (id == null) return;
        if (multiple && e.shiftKey) { var a = ids.indexOf(anchor.current != null ? anchor.current : id); var arr = ids.slice(Math.min(a, n), Math.max(a, n) + 1); if (n < a) arr.reverse(); setSel(arr); }
        else { setSel([id]); anchor.current = id; }
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && isTree && last != null) {
        e.preventDefault();
        var v = visible[i]; if (!v) return;
        if (e.key === 'ArrowRight') { if (v.row.children) toggleExpand(v.row.id, true); }
        else if (v.row.children && expanded.indexOf(v.row.id) >= 0) toggleExpand(v.row.id, false);
        else { for (var k = i - 1; k >= 0; k--) if (visible[k].level < v.level) { setSel([visible[k].row.id]); anchor.current = visible[k].row.id; break; } }
      } else if (e.key === 'a' && (e.metaKey || e.ctrlKey) && multiple) { e.preventDefault(); setSel(ids.slice()); }
      else if (e.key === 'Enter' && last != null && props.onOpen) { e.preventDefault(); props.onOpen(visible[i].row); }
    }
    return h('div', { ref: ref, className: cx('pn', 'pn-table', props.active && 'pn-table--active', props.density === 'compact' && 'pn-table--compact', props.alternating === false && 'pn-table--plain', props.className),
        style: Object.assign({ maxHeight: props.maxHeight, height: props.height }, props.style), role: isTree ? 'treegrid' : 'grid', 'aria-label': props['aria-label'], 'aria-multiselectable': multiple, tabIndex: 0, onKeyDown: onKeyDown },
      h('div', { className: 'pn-table__head', role: 'row', style: { gridTemplateColumns: tpl } }, columns.map(function (c) {
        var sorted = so[0] && so[0].key === c.key ? so[0].dir : null;
        return h('div', { key: c.key, role: 'columnheader', 'aria-sort': sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined,
            className: cx('pn-table__th', c.sortable && 'pn-table__th--sortable', sorted && 'pn-table__th--sorted', c.align && 'pn-align-' + c.align),
            onClick: c.sortable ? function () { var nd = sorted === 'asc' ? 'desc' : 'asc'; var ns = { key: c.key, dir: nd }; so[1](ns); props.onSortChange && props.onSortChange(ns); } : undefined },
          h('span', null, c.title), sorted ? h(Icon, { name: sorted === 'asc' ? 'chevron-up' : 'chevron-down', weight: 2 }) : null);
      })),
      visible.length ? h('div', { className: 'pn-table__body', role: 'rowgroup' }, visible.map(function (v, idx) {
        var r = v.row, on = sel[0].indexOf(r.id) >= 0, open = expanded.indexOf(r.id) >= 0;
        return h('div', { key: r.id, 'data-row-id': r.id, role: 'row', 'aria-selected': on, 'aria-level': isTree ? v.level : undefined, 'aria-expanded': r.children ? open : undefined,
            className: cx('pn-table__row', idx % 2 === 1 && 'pn-table__row--alt'), style: { gridTemplateColumns: tpl },
            onMouseDown: function (e) { if (e.button === 0) clickRow(e, r.id); }, onDoubleClick: function () { props.onOpen && props.onOpen(r); } },
          columns.map(function (c, ci) {
            var content = c.render ? c.render(r) : r[c.key];
            return h('div', { key: c.key, role: 'gridcell', className: cx('pn-table__td', c.align && 'pn-align-' + c.align, c.secondary && 'pn-table__td--secondary', c.mono && 'pn-table__td--mono') },
              ci === 0 && isTree ? h('span', { className: 'pn-table__tree', style: { paddingLeft: (v.level - 1) * 16 } },
                r.children ? h('button', { type: 'button', tabIndex: -1, className: cx('pn-disclosure', open && 'pn-disclosure--open'), 'aria-label': open ? '折叠' : '展开',
                    onMouseDown: function (e) { e.stopPropagation(); }, onClick: function () { toggleExpand(r.id, !open); } }, h(Icon, { name: 'chevron-right', weight: 2 })) : h('span', { className: 'pn-disclosure-spacer' }),
                h('span', { className: 'pn-table__cell' }, content)) : h('span', { className: 'pn-table__cell' }, content));
          }));
      })) : h('div', { className: 'pn-table__empty' }, props.emptyText || '没有项目'));
  }


  /* ---------- Sheet / Dialog (modal, focus-trapped) ---------- */
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function useModal(open, onClose, panelRef) {
    useEffect(function () {
      if (!open) return;
      var prev = document.activeElement;
      var panel = panelRef.current;
      var t = setTimeout(function () {
        if (!panel) return;
        var auto = panel.querySelector('[data-autofocus]') || panel.querySelector('input, textarea, select') || panel.querySelector(FOCUSABLE);
        (auto || panel).focus();
      }, 0);
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); return; }
        if (e.key !== 'Tab' || !panel) return;
        var els = Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE)); if (!els.length) return;
        var first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      return function () { clearTimeout(t); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
    }, [open]);
  }
  function ModalBody(props, kind) {
    return [
      props.title ? h('div', { key: 't', className: 'pn-sheet__title', id: props._titleId }, props.title) : null,
      props.message ? h('div', { key: 'm', className: 'pn-sheet__message' }, props.message) : null,
      props.children != null ? h('div', { key: 'c', className: 'pn-sheet__content' }, props.children) : null,
      props.actions && props.actions.length ? h('div', { key: 'a', className: 'pn-sheet__actions' },
        props.footer ? h('div', { className: 'pn-sheet__footer' }, props.footer) : null,
        props.actions.map(function (a, i) {
          return h(Button, { key: i, variant: a.variant, onClick: a.onClick, disabled: a.disabled, 'data-autofocus': a.autoFocus ? true : undefined, style: { minWidth: 80 } }, a.label);
        })) : null];
  }
  var modalSeq = 0;
  function Sheet(props) {
    var ref = useRef(null), idRef = useRef('pn-sheet-' + (++modalSeq));
    useModal(!!props.open && props.trapFocus !== false, props.onClose, ref);
    if (!props.open) return null;
    return h('div', { className: cx('pn', 'pn-sheet-layer', props.className) },
      h('div', { className: 'pn-scrim', onMouseDown: props.closeOnScrim ? props.onClose : undefined }),
      h('div', { ref: ref, role: 'dialog', 'aria-modal': true, 'aria-labelledby': props.title ? idRef.current : undefined, 'aria-label': props.title ? undefined : props['aria-label'], tabIndex: -1,
          className: 'pn-sheet', style: { width: props.width || 480 } }, ModalBody(Object.assign({ _titleId: idRef.current }, props))));
  }
  function Dialog(props) {
    var ref = useRef(null), idRef = useRef('pn-dialog-' + (++modalSeq));
    useModal(!!props.open, props.onClose, ref);
    if (!props.open) return null;
    return h('div', { className: cx('pn', 'pn-dialog-layer', props.contained && 'pn-dialog-layer--contained', props.className) },
      h('div', { className: 'pn-scrim', onMouseDown: props.closeOnScrim !== false ? props.onClose : undefined }),
      h('div', { ref: ref, role: props.role || 'dialog', 'aria-modal': true, 'aria-labelledby': props.title ? idRef.current : undefined, 'aria-label': props.title ? undefined : props['aria-label'], tabIndex: -1,
          className: cx('pn-dialog', props.bare && 'pn-dialog--bare'), style: { width: props.bare ? undefined : props.width || 420 } },
        props.bare ? props.children : ModalBody(Object.assign({ _titleId: idRef.current }, props))));
  }


  /* ---------- SecureField ---------- */
  function SecureField(props) {
    var v = useState(false), shown = v[0], setShown = v[1];
    var c = useState(false), caps = c[0], setCaps = c[1];
    function keys(e) { if (e.getModifierState) setCaps(e.getModifierState('CapsLock')); }
    return h(TextField, Object.assign({}, omit(props, ['revealable']), {
      type: shown ? 'text' : 'password', autoComplete: props.autoComplete || 'current-password', onKeyDown: keys, onKeyUp: keys, onBlur: function () { setCaps(false); },
      hint: caps ? h('span', { className: 'pn-caps' }, h(Icon, { name: 'capslock' }), '大写锁定已打开') : props.hint,
      trailing: [caps ? h('span', { key: 'c', className: 'pn-inputwrap__affix', title: '大写锁定已打开' }, h(Icon, { name: 'capslock' })) : null,
        props.revealable !== false ? h('button', { key: 'r', type: 'button', className: 'pn-inputwrap__btn', 'aria-label': shown ? '隐藏密码' : '显示密码', 'aria-pressed': shown, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { setShown(!shown); } }, h(Icon, { name: shown ? 'eye-slash' : 'eye' })) : null]
    }));
  }

  /* ---------- TextArea ---------- */
  function TextArea(props) {
    var id = useId('pn-ta-'), hid = id + '-h';
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : '');
    var ref = useRef(null);
    useEffect(function () { if (!props.autoGrow || !ref.current) return; var t = ref.current; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, props.maxHeight || 240) + 'px'; }, [st[0]]);
    var rest = omit(props, ['label', 'hint', 'error', 'className', 'style', 'value', 'defaultValue', 'onChange', 'autoGrow', 'maxHeight', 'showCount']);
    var count = props.maxLength && props.showCount !== false ? h('span', { className: 'pn-field__count', 'aria-live': 'polite' }, String(st[0]).length + ' / ' + props.maxLength) : null;
    return h('div', { className: cx('pn-field', 'pn-field--wide', props.className), style: props.style },
      props.label ? h('label', { htmlFor: id, className: 'pn-field__label' }, props.label) : null,
      h('textarea', Object.assign({ rows: 3 }, rest, { id: id, ref: ref, value: st[0], 'aria-invalid': !!props.error || undefined, 'aria-describedby': props.error || props.hint || count ? hid : undefined,
        className: cx('pn-input', 'pn-textarea', props.error && 'pn-input--invalid'), onChange: function (e) { st[1](e.target.value); props.onChange && props.onChange(e); } })),
      fieldHint(props, hid, count));
  }

  /* ---------- Stepper (number field + NSStepper) ---------- */
  function Stepper(props) {
    var id = useId('pn-st-');
    var min = props.min != null ? props.min : -Infinity, max = props.max != null ? props.max : Infinity, step = props.step || 1;
    var prec = props.precision != null ? props.precision : (String(step).split('.')[1] || '').length;
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : Math.max(0, min === -Infinity ? 0 : min));
    var d = useState(null), draft = d[0], setDraft = d[1];
    function clamp(n) { return Math.min(max, Math.max(min, n)); }
    function set(n) { n = clamp(Number(n.toFixed(prec))); st[1](n); setDraft(null); props.onChange && props.onChange(n); }
    function commit() { if (draft == null) return; var n = parseFloat(draft); if (isNaN(n)) setDraft(null); else set(n); }
    var shown = draft != null ? draft : st[0].toFixed(prec);
    return h('div', { className: cx('pn-field', 'pn-field--auto', props.className), style: props.style },
      props.label ? h('label', { htmlFor: id, className: 'pn-field__label' }, props.label) : null,
      h('span', { className: 'pn-stepper' },
        h('input', { id: id, className: 'pn-input pn-stepper__input', inputMode: 'decimal', role: 'spinbutton', 'aria-valuemin': isFinite(min) ? min : undefined, 'aria-valuemax': isFinite(max) ? max : undefined, 'aria-valuenow': st[0],
          'aria-label': props.label ? undefined : props['aria-label'], disabled: props.disabled, value: shown, style: { width: props.width || 72 },
          onChange: function (e) { setDraft(e.target.value); }, onBlur: commit,
          onKeyDown: function (e) { if (e.key === 'ArrowUp') { e.preventDefault(); set(st[0] + step * (e.shiftKey ? 10 : 1)); } else if (e.key === 'ArrowDown') { e.preventDefault(); set(st[0] - step * (e.shiftKey ? 10 : 1)); } else if (e.key === 'Enter') commit(); } }),
        props.unit ? h('span', { className: 'pn-stepper__unit' }, props.unit) : null,
        h('span', { className: 'pn-stepper__arrows' },
          h('button', { type: 'button', tabIndex: -1, 'aria-label': '增加', disabled: props.disabled || st[0] >= max, onClick: function () { set(st[0] + step); } }, h(Icon, { name: 'chevron-up', weight: 2.4 })),
          h('button', { type: 'button', tabIndex: -1, 'aria-label': '减少', disabled: props.disabled || st[0] <= min, onClick: function () { set(st[0] - step); } }, h(Icon, { name: 'chevron-down', weight: 2.4 })))));
  }

  /* ---------- ComboBox ---------- */
  function ComboBox(props) {
    var id = useId('pn-cb-'), lid = id + '-l';
    var opts = (props.options || []).map(function (o) { return typeof o === 'string' ? { value: o, label: o } : o; });
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : '');
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var f = useState(false), filtering = f[0], setFiltering = f[1];
    var a = useState(-1), active = a[0], setActive = a[1];
    var ref = useRef(null);
    var q = String(st[0] || '').toLowerCase();
    var list = filtering && q ? opts.filter(function (x) { return String(x.label).toLowerCase().indexOf(q) >= 0; }) : opts;
    useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', onDoc); return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    function choose(x) { st[1](x.label); setOpen(false); setFiltering(false); setActive(-1); props.onChange && props.onChange(x.value, x); }
    return h('div', { ref: ref, className: cx('pn-field', 'pn-combo', props.className), style: props.style },
      props.label ? h('label', { htmlFor: id, className: 'pn-field__label' }, props.label) : null,
      h('span', { className: 'pn-inputwrap' },
        h('input', { id: id, className: 'pn-input pn-input--bare', role: 'combobox', 'aria-expanded': open, 'aria-controls': lid, 'aria-autocomplete': 'list', placeholder: props.placeholder,
          'aria-activedescendant': open && active >= 0 ? lid + '-' + active : undefined, value: st[0], disabled: props.disabled,
          onChange: function (e) { st[1](e.target.value); setFiltering(true); setOpen(true); setActive(0); props.onInput && props.onInput(e.target.value); },
          onKeyDown: function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { setOpen(true); setActive(0); } else setActive(Math.min(list.length - 1, active + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
            else if (e.key === 'Enter' && open && list[active]) { e.preventDefault(); choose(list[active]); }
            else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
          } }),
        h('button', { type: 'button', tabIndex: -1, className: 'pn-inputwrap__btn pn-combo__btn', 'aria-label': '显示选项', onClick: function () { setFiltering(false); setOpen(!open); setActive(-1); } }, h(Icon, { name: 'chevron-down', weight: 2.2 }))),
      open && list.length ? h('div', { id: lid, role: 'listbox', className: 'pn-menu pn-combo__list' }, list.map(function (x, i) {
        return h('div', { key: x.value, id: lid + '-' + i, role: 'option', 'aria-selected': i === active, 'data-active': i === active ? 'true' : undefined, className: 'pn-menu__item',
          onMouseEnter: function () { setActive(i); }, onMouseDown: function (e) { e.preventDefault(); choose(x); } },
          h('span', { className: 'pn-menu__label' }, x.label), x.detail ? h('span', { className: 'pn-menu__shortcut' }, x.detail) : null);
      })) : null);
  }


  /* ---------- Form layout (macOS preferences style) ---------- */
  function Form(props) {
    var lw = props.labelWidth;
    return h('form', { className: cx('pn', 'pn-form', props.className), style: Object.assign({ gridTemplateColumns: (lw == null ? 'max-content' : typeof lw === 'number' ? lw + 'px' : lw) + ' minmax(0, 1fr)' }, props.style),
      onSubmit: function (e) { e.preventDefault(); props.onSubmit && props.onSubmit(e); }, 'aria-label': props['aria-label'] }, props.children);
  }
  function FormRow(props) {
    return h(React.Fragment, null,
      h('div', { className: cx('pn-form__label', props.align === 'top' && 'pn-form__label--top') }, props.label ? props.label + (props.colon === false ? '' : '：') : null),
      h('div', { className: cx('pn-form__control', props.align === 'top' && 'pn-form__control--top') }, props.children,
        props.hint ? h('div', { className: 'pn-form__hint' }, props.hint) : null));
  }
  function FormActions(props) { return h('div', { className: 'pn-form__actions' }, props.children); }

  /* ---------- CheckboxGroup ---------- */
  function CheckboxGroup(props) {
    var st = useControlled(props.value, props.defaultValue || []);
    return h('div', { role: 'group', 'aria-label': props['aria-label'], className: cx('pn-radiogroup', props.direction === 'row' && 'pn-radiogroup--row', props.className) },
      (props.options || []).map(function (o) {
        var on = st[0].indexOf(o.value) >= 0;
        return h(Checkbox, { key: o.value, label: o.label, checked: on, disabled: props.disabled || o.disabled, onChange: function (c) {
          var next = c ? st[0].concat([o.value]) : st[0].filter(function (x) { return x !== o.value; }); st[1](next); props.onChange && props.onChange(next); } });
      }));
  }

  /* ---------- Divider ---------- */
  function Divider(props) {
    if (props.vertical) return h('span', { role: 'separator', 'aria-orientation': 'vertical', className: cx('pn-divider', 'pn-divider--v', props.className), style: props.style });
    return h('div', { role: 'separator', className: cx('pn-divider', props.label && 'pn-divider--label', props.className), style: props.style }, props.label ? h('span', null, props.label) : null);
  }

  /* ---------- Link ---------- */
  function Link(props) {
    var rest = omit(props, ['external', 'className', 'children']);
    return h('a', Object.assign({ href: '#' }, rest, { className: cx('pn-link-text', props.className), target: props.external ? '_blank' : props.target, rel: props.external ? 'noopener noreferrer' : props.rel }),
      props.children, props.external ? h(Icon, { name: 'external', weight: 1.6, label: '（在新窗口打开）' }) : null);
  }

  /* ---------- HelpButton ---------- */
  function HelpButton(props) {
    var btn = h('button', { type: 'button', className: 'pn-helpbtn', 'aria-label': props['aria-label'] || '帮助', onClick: props.help ? undefined : props.onClick }, '?');
    if (!props.help) return btn;
    return h(Popover, { trigger: btn, placement: props.placement || 'top-start', defaultOpen: props.defaultOpen, width: 260, 'aria-label': '帮助' }, h('div', { className: 'pn-helptext' }, props.help));
  }


  /* ---------- Calendar / DatePicker ---------- */
  function toYMD(v) {
    if (!v) return null;
    if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v)); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function ymdStr(o) { return o.y + '-' + ('0' + o.m).slice(-2) + '-' + ('0' + o.d).slice(-2); }
  function ymdCmp(a, b) { return (a.y - b.y) || (a.m - b.m) || (a.d - b.d); }
  function addDays(o, n) { var dt = new Date(o.y, o.m - 1, o.d + n); return toYMD(dt); }
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function fmtDate(o, withWeek) { if (!o) return ''; var w = new Date(o.y, o.m - 1, o.d).getDay(); return o.y + '年' + o.m + '月' + o.d + '日' + (withWeek ? ' 星期' + WEEK[w] : ''); }
  function Calendar(props) {
    var st = useControlled(props.value, props.defaultValue || null);
    var sel = toYMD(st[0]);
    var today = toYMD(props.today || new Date());
    var start = props.weekStart != null ? props.weekStart : 1;
    var f = useState(sel || today), focus = f[0], setFocus = f[1];
    var vm = useState({ y: (sel || today).y, m: (sel || today).m }), view = vm[0], setView = vm[1];
    var min = toYMD(props.min), max = toYMD(props.max);
    var marks = (props.marks || []).map(function (x) { return ymdStr(toYMD(x)); });
    var gridRef = useRef(null), kb = useRef(false);
    useEffect(function () { if (kb.current && gridRef.current) { var el = gridRef.current.querySelector('[tabindex="0"]'); el && el.focus(); kb.current = false; } });
    function out(o) { return (min && ymdCmp(o, min) < 0) || (max && ymdCmp(o, max) > 0); }
    function go(o) { setFocus(o); if (o.y !== view.y || o.m !== view.m) setView({ y: o.y, m: o.m }); }
    function pick(o) { if (out(o)) return; st[1](ymdStr(o)); go(o); props.onChange && props.onChange(ymdStr(o)); }
    function shiftMonth(n) { var dt = new Date(view.y, view.m - 1 + n, 1); setView({ y: dt.getFullYear(), m: dt.getMonth() + 1 }); var nf = toYMD(new Date(dt.getFullYear(), dt.getMonth(), Math.min(focus.d, new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()))); setFocus(nf); }
    var first = new Date(view.y, view.m - 1, 1), lead = (first.getDay() - start + 7) % 7;
    var cells = []; for (var i = 0; i < 42; i++) cells.push(toYMD(new Date(view.y, view.m - 1, 1 - lead + i)));
    var focusIn = focus.y === view.y && focus.m === view.m ? ymdStr(focus) : ymdStr({ y: view.y, m: view.m, d: 1 });
    return h('div', { className: cx('pn', 'pn-cal', props.className), style: props.style, role: 'group', 'aria-label': props['aria-label'] || '日历' },
      h('div', { className: 'pn-cal__head' },
        h('span', { className: 'pn-cal__title', 'aria-live': 'polite' }, view.y + '年' + view.m + '月'),
        h('span', { className: 'pn-cal__nav' },
          h('button', { type: 'button', className: 'pn-inputwrap__btn', 'aria-label': '上个月', onClick: function () { shiftMonth(-1); } }, h(Icon, { name: 'chevron-left', weight: 2 })),
          h('button', { type: 'button', className: 'pn-cal__today', onClick: function () { go(today); } }, '今天'),
          h('button', { type: 'button', className: 'pn-inputwrap__btn', 'aria-label': '下个月', onClick: function () { shiftMonth(1); } }, h(Icon, { name: 'chevron-right', weight: 2 })))),
      h('div', { className: 'pn-cal__week', 'aria-hidden': true }, [0, 1, 2, 3, 4, 5, 6].map(function (k) { return h('span', { key: k }, WEEK[(k + start) % 7]); })),
      h('div', { ref: gridRef, className: 'pn-cal__grid', role: 'grid',
          onKeyDown: function (e) {
            var map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
            if (map[e.key]) { e.preventDefault(); kb.current = true; go(addDays(focus, map[e.key])); }
            else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); kb.current = true; shiftMonth(e.key === 'PageUp' ? -1 : 1); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(focus); }
          } },
        cells.map(function (o) {
          var key = ymdStr(o), other = o.m !== view.m, isSel = sel && ymdCmp(o, sel) === 0, isToday = ymdCmp(o, today) === 0, dis = out(o);
          return h('button', { key: key, type: 'button', role: 'gridcell', 'aria-selected': !!isSel, 'aria-current': isToday ? 'date' : undefined, 'aria-label': fmtDate(o, true), disabled: dis,
              tabIndex: key === focusIn ? 0 : -1, className: cx('pn-cal__day', other && 'pn-cal__day--other', isSel && 'pn-cal__day--sel', isToday && 'pn-cal__day--today'),
              onClick: function () { pick(o); } }, o.d, marks.indexOf(key) >= 0 ? h('i', { className: 'pn-cal__mark', 'aria-hidden': true }) : null);
        })));
  }
  function DatePicker(props) {
    var st = useControlled(props.value, props.defaultValue || null);
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var v = toYMD(st[0]);
    var trigger = h('button', { type: 'button', className: cx('pn-btn', 'pn-datepicker'), 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-label': (props.label || '日期') + '：' + (v ? fmtDate(v, true) : '未选择'), disabled: props.disabled },
      h(Icon, { name: 'calendar' }), h('span', { className: v ? null : 'pn-datepicker__ph' }, v ? fmtDate(v, props.showWeekday !== false) : props.placeholder || '选择日期'),
      h('span', { className: 'pn-popup__chev' }, h(Icon, { name: 'chevron-updown', weight: 2.2 })));
    return h('div', { className: cx('pn-field', 'pn-field--auto', props.className), style: props.style },
      props.label ? h('span', { className: 'pn-field__label' }, props.label) : null,
      h(Popover, { trigger: trigger, open: open, onOpenChange: setOpen, placement: props.placement || 'bottom-start', 'aria-label': '选择日期' },
        h(Calendar, { value: st[0], min: props.min, max: props.max, marks: props.marks, today: props.today, onChange: function (d) { st[1](d); setOpen(false); props.onChange && props.onChange(d); } })));
  }


  /* ---------- Disclosure ---------- */
  function Disclosure(props) {
    var st = useControlled(props.open, !!props.defaultOpen);
    var id = useId('pn-dc-');
    function t() { st[1](!st[0]); props.onToggle && props.onToggle(!st[0]); }
    return h('div', { className: cx('pn-disc', props.variant === 'group' && 'pn-disc--group', props.className), style: props.style },
      h('button', { type: 'button', className: 'pn-disc__head', 'aria-expanded': st[0], 'aria-controls': id, onClick: t },
        h('span', { className: cx('pn-disclosure', st[0] && 'pn-disclosure--open') }, h(Icon, { name: 'chevron-right', weight: 2 })),
        h('span', { className: 'pn-disc__title' }, props.title),
        props.summary && !st[0] ? h('span', { className: 'pn-disc__summary' }, props.summary) : null),
      st[0] ? h('div', { id: id, className: 'pn-disc__body' }, props.children) : null);
  }


  /* ---------- Tooltip (help tag) ---------- */
  function Tooltip(props) {
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var id = useId('pn-tip-'), timer = useRef(null);
    function show(now) { clearTimeout(timer.current); timer.current = setTimeout(function () { setOpen(true); }, now ? 0 : (props.delay != null ? props.delay : 600)); }
    function hide() { clearTimeout(timer.current); setOpen(false); }
    useEffect(function () { return function () { clearTimeout(timer.current); }; }, []);
    var child = React.Children.only(props.children);
    var trigger = React.cloneElement(child, { 'aria-describedby': id });
    return h('span', { className: 'pn-tip-anchor', onMouseEnter: function () { show(false); }, onMouseLeave: hide, onFocus: function () { show(true); }, onBlur: hide,
        onKeyDown: function (e) { if (e.key === 'Escape') hide(); } },
      trigger,
      h('span', { id: id, role: 'tooltip', className: cx('pn-tip', 'pn-tip--' + (props.placement || 'top'), open && 'pn-tip--open') }, props.content,
        props.shortcut ? h('span', { className: 'pn-tip__kbd' }, props.shortcut) : null));
  }

  /* ---------- Kbd ---------- */
  function Kbd(props) {
    var keys = props.keys || [props.children];
    return h('span', { className: cx('pn-kbds', props.className) }, keys.map(function (k, i) { return h('kbd', { key: i, className: 'pn-kbd' }, k); }));
  }

  /* ---------- Toast / HUD ---------- */
  function Toast(props) {
    useEffect(function () {
      if (!props.open || !props.duration || !props.onClose) return;
      var t = setTimeout(props.onClose, props.duration); return function () { clearTimeout(t); };
    }, [props.open, props.duration]);
    if (props.open === false) return null;
    return h('div', { className: cx('pn', 'pn-toast', props.className), style: props.style, role: 'status', 'aria-live': 'polite' },
      props.icon ? h('span', { className: 'pn-toast__icon', style: props.iconColor ? { color: props.iconColor } : null }, renderIcon(props.icon)) : null,
      h('span', { className: 'pn-toast__msg' }, props.message),
      props.action ? h('button', { type: 'button', className: 'pn-toast__action', onClick: props.action.onClick }, props.action.label) : null);
  }
  function HUD(props) {
    if (props.open === false) return null;
    return h('div', { className: cx('pn', 'pn-hud', props.className), style: props.style, role: 'status', 'aria-live': 'polite' },
      h('span', { className: 'pn-hud__icon' }, renderIcon(props.icon || 'check')),
      props.title ? h('span', { className: 'pn-hud__title' }, props.title) : null,
      props.level != null ? h('span', { className: 'pn-hud__level', 'aria-hidden': true }, Array.apply(null, Array(16)).map(function (_, i) { return h('i', { key: i, className: i < Math.round(props.level * 16) ? 'on' : null }); })) : null);
  }

  /* ---------- TokenField ---------- */
  function TokenField(props) {
    var id = useId('pn-tk-'), lid = id + '-l';
    var st = useControlled(props.value, props.defaultValue || []);
    var t = useState(''), text = t[0], setText = t[1];
    var a = useState(0), active = a[0], setActive = a[1];
    var ref = useRef(null);
    var tokens = st[0].map(function (x) { return typeof x === 'string' ? { label: x } : x; });
    var sugg = text ? (props.suggestions || []).map(function (x) { return typeof x === 'string' ? { label: x } : x; })
      .filter(function (x) { return String(x.label).toLowerCase().indexOf(text.toLowerCase()) >= 0 && !tokens.some(function (k) { return k.label === x.label; }); }).slice(0, 6) : [];
    function set(next) { st[1](next); props.onChange && props.onChange(next); }
    function add(tok) { var label = String(tok.label || '').trim(); if (!label) return; if (tokens.some(function (k) { return k.label === label; })) { setText(''); return; } set(st[0].concat([tok.tone || tok.detail ? tok : label])); setText(''); setActive(0); }
    function remove(i) { set(st[0].filter(function (_, j) { return j !== i; })); ref.current && ref.current.focus(); }
    return h('div', { className: cx('pn-field', 'pn-tokenfield', props.className), style: props.style },
      props.label ? h('label', { htmlFor: id, className: 'pn-field__label' }, props.label) : null,
      h('div', { className: 'pn-tokenfield__box', onMouseDown: function (e) { if (e.target === e.currentTarget) { e.preventDefault(); ref.current && ref.current.focus(); } } },
        tokens.map(function (k, i) {
          return h('span', { key: k.label + i, className: cx('pn-token', k.tone && 'pn-token--' + k.tone) }, k.label,
            h('button', { type: 'button', tabIndex: -1, className: 'pn-token__x', 'aria-label': '移除 ' + k.label, onClick: function () { remove(i); } }, h(Icon, { name: 'xmark', weight: 2.4 })));
        }),
        h('input', { id: id, ref: ref, className: 'pn-tokenfield__input', value: text, placeholder: tokens.length ? '' : props.placeholder, role: 'combobox', 'aria-expanded': sugg.length > 0, 'aria-controls': lid, 'aria-autocomplete': 'list',
          'aria-activedescendant': sugg.length ? lid + '-' + active : undefined,
          onChange: function (e) { var v = e.target.value; if (/[,，;；]$/.test(v)) { add({ label: v.slice(0, -1) }); return; } setText(v); setActive(0); },
          onKeyDown: function (e) {
            if (e.nativeEvent.isComposing) return;
            if (sugg.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length); }
            else if (e.key === 'Enter' || (e.key === 'Tab' && text)) { if (text) { e.preventDefault(); add(sugg[active] || { label: text }); } }
            else if (e.key === 'Backspace' && !text && tokens.length) { remove(tokens.length - 1); }
            else if (e.key === 'Escape') setText('');
          },
          onBlur: function () { if (text && props.commitOnBlur !== false) add({ label: text }); } })),
      sugg.length ? h('div', { id: lid, role: 'listbox', className: 'pn-menu pn-combo__list' }, sugg.map(function (x, i) {
        return h('div', { key: x.label, id: lid + '-' + i, role: 'option', 'aria-selected': i === active, 'data-active': i === active ? 'true' : undefined, className: 'pn-menu__item',
          onMouseEnter: function () { setActive(i); }, onMouseDown: function (e) { e.preventDefault(); add(x); } }, h('span', { className: 'pn-menu__label' }, x.label), x.detail ? h('span', { className: 'pn-menu__shortcut' }, x.detail) : null);
      })) : null,
      props.hint ? h('span', { className: 'pn-field__hint' }, props.hint) : null);
  }


  /* ---------- PullDownButton (button + menu, fixed title) ---------- */
  function PullDownButton(props) {
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var ref = useRef(null);
    function close(refocus) { setOpen(false); if (refocus && ref.current) { var b = ref.current.querySelector('.pn-btn'); b && b.focus(); } }
    useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', onDoc); return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    return h('div', { ref: ref, className: cx('pn-popup', 'pn-pulldown', props.className), style: props.style },
      h(Button, { variant: props.variant, size: props.size, icon: props.icon, disabled: props.disabled, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': props['aria-label'],
          className: cx('pn-pulldown__btn', !props.label && 'pn-pulldown__btn--icon'), onClick: function () { setOpen(!open); },
          onKeyDown: function (e) { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); } } },
        props.label, h('span', { className: 'pn-pulldown__chev', 'aria-hidden': true }, h(Icon, { name: 'chevron-down', weight: 2.2 }))),
      open ? h(Menu, { autoFocus: !props.defaultOpen, items: props.items || [], style: { minWidth: 200, left: props.align === 'end' ? 'auto' : 0, right: props.align === 'end' ? 0 : 'auto' },
        onClose: function () { close(true); }, onSelect: function (v) { close(true); props.onSelect && props.onSelect(v); } }) : null);
  }


  /* ---------- PathControl ---------- */
  function PathControl(props) {
    var items = props.items || [], max = props.maxItems || 5;
    var hidden = items.length > max ? items.slice(1, items.length - (max - 2)) : [];
    var shown = hidden.length ? [items[0], { __more: true }].concat(items.slice(items.length - (max - 2))) : items;
    function seg(it, i, last) {
      if (it.__more) return h(PullDownButton, { key: 'more', variant: 'plain', size: 'small', 'aria-label': '显示上层文件夹', className: 'pn-path__more', label: '…',
        items: hidden.map(function (x) { return { label: x.label, value: String(x.id), icon: x.icon || 'folder' }; }), onSelect: function (v) { props.onSelect && props.onSelect(v); } });
      return h('button', { key: it.id, type: 'button', className: cx('pn-path__seg', last && 'pn-path__seg--last'), 'aria-current': last ? 'location' : undefined, onClick: function () { props.onSelect && props.onSelect(it.id); } },
        it.icon ? h('span', { className: 'pn-path__icon', style: it.color ? { color: it.color } : null }, renderIcon(it.icon)) : null, h('span', null, it.label));
    }
    var out = [];
    shown.forEach(function (it, i) {
      if (i) out.push(h('span', { key: 's' + i, className: 'pn-path__sep', 'aria-hidden': true }, h(Icon, { name: 'chevron-right', weight: 2 })));
      out.push(seg(it, i, i === shown.length - 1));
    });
    return h('nav', { className: cx('pn', 'pn-path', props.className), style: props.style, 'aria-label': props['aria-label'] || '路径' }, out);
  }

  /* ---------- LevelIndicator ---------- */
  var STAR = 'M9 1.8l2.2 4.5 4.9.7-3.6 3.5.9 4.9L9 13.1l-4.4 2.3.9-4.9L1.9 7l4.9-.7z';
  function LevelIndicator(props) {
    var kind = props.kind || 'capacity', max = props.max != null ? props.max : kind === 'rating' ? 5 : 100;
    var st = useControlled(props.value, props.defaultValue != null ? props.defaultValue : 0);
    var v = Math.max(0, Math.min(max, st[0]));
    var tone = props.critical != null && v >= props.critical ? 'critical' : props.warning != null && v >= props.warning ? 'warning' : 'normal';
    function set(n) { n = Math.max(0, Math.min(max, n)); st[1](n); props.onChange && props.onChange(n); }
    if (kind === 'rating') {
      var editable = !!props.editable;
      return h('span', { className: cx('pn-rating', editable && 'pn-rating--edit', props.className), role: editable ? 'slider' : 'img', tabIndex: editable ? 0 : undefined,
          'aria-label': (props['aria-label'] || '评分') + '：' + v + ' / ' + max, 'aria-valuemin': editable ? 0 : undefined, 'aria-valuemax': editable ? max : undefined, 'aria-valuenow': editable ? v : undefined,
          onKeyDown: editable ? function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(v + 1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(v - 1); } else if (/^[0-9]$/.test(e.key)) set(+e.key); } : undefined },
        Array.apply(null, Array(max)).map(function (_, i) {
          return h('svg', { key: i, viewBox: '0 0 18 18', width: props.size || 14, height: props.size || 14, className: i < v ? 'on' : null, 'aria-hidden': true, onClick: editable ? function () { set(i + 1 === v ? 0 : i + 1); } : undefined },
            h('path', { d: STAR, strokeLinejoin: 'round' }));
        }));
    }
    var pct = v / max * 100;
    var label = props.label || null;
    if (kind === 'discrete') {
      var n = props.segments || 10, on = Math.round(v / max * n);
      return h('span', { className: cx('pn-level', 'pn-level--discrete', 'pn-level--' + tone, props.className), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': v, 'aria-label': props['aria-label'], style: props.style },
        Array.apply(null, Array(n)).map(function (_, i) { return h('i', { key: i, className: i < on ? 'on' : null }); }));
    }
    return h('div', { className: cx('pn-levelwrap', props.className), style: props.style },
      label ? h('div', { className: 'pn-levelwrap__label' }, label) : null,
      h('span', { className: cx('pn-level', 'pn-level--' + tone), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': v, 'aria-label': props['aria-label'] },
        (props.parts || [{ value: v }]).map(function (p, i) { return h('i', { key: i, style: { width: (p.value / max * 100) + '%', background: p.color }, title: p.label }); })),
      props.parts && props.parts.some(function (p) { return p.label; }) ? h('div', { className: 'pn-levelwrap__legend' }, props.parts.map(function (p, i) {
        return h('span', { key: i }, h('i', { style: { background: p.color } }), p.label);
      })) : null);
  }

  /* ---------- ColorWell ---------- */
  var SWATCHES = ['#ff383c', '#ff8d28', '#ffcc00', '#34c759', '#00c8b3', '#00c3d0', '#00c0e8', '#0088ff', '#6155f5', '#cb30e0', '#ff2d55', '#ac7f5e', '#8e8e93', '#1c1c1e', '#ffffff'];
  function ColorWell(props) {
    var st = useControlled(props.value, props.defaultValue || '#0088ff');
    var o = useState(!!props.defaultOpen), open = o[0], setOpen = o[1];
    var d = useState(null), draft = d[0], setDraft = d[1];
    var colors = props.colors || SWATCHES;
    function set(c) { st[1](c); props.onChange && props.onChange(c); }
    if (props.inline) {
      var names = props.names || [];
      return h('div', { className: cx('pn-colorrow', props.className), role: 'radiogroup', 'aria-label': props['aria-label'] || '颜色', style: props.style,
          onKeyDown: function (e) { keyNav(e, e.currentTarget, '.pn-colorrow__dot', { horizontal: true, select: true }); } },
        colors.map(function (c, i) {
          var on = String(st[0]).toLowerCase() === c.toLowerCase();
          return h('button', { key: c, type: 'button', role: 'radio', 'aria-checked': on, 'aria-label': names[i] || c, title: names[i] || c, tabIndex: on ? 0 : -1, className: 'pn-colorrow__dot', style: { '--pn-c': c }, onClick: function () { set(c); } });
        }));
    }
    var hexOk = draft == null || /^#?[0-9a-f]{6}$/i.test(draft);
    return h('div', { className: cx('pn-field', 'pn-field--auto', props.className), style: props.style },
      props.label ? h('span', { className: 'pn-field__label' }, props.label) : null,
      h(Popover, { open: open, onOpenChange: setOpen, placement: 'bottom-start', 'aria-label': '选择颜色', width: 232,
        trigger: h('button', { type: 'button', className: 'pn-colorwell', 'aria-label': (props['aria-label'] || '颜色') + '：' + st[0], 'aria-haspopup': 'dialog', 'aria-expanded': open }, h('span', { style: { background: st[0] } })) },
        h('div', { className: 'pn-colorwell__grid' }, colors.map(function (c) {
          var on = String(st[0]).toLowerCase() === c.toLowerCase();
          return h('button', { key: c, type: 'button', className: cx('pn-colorwell__sw', on && 'pn-colorwell__sw--on'), style: { background: c }, 'aria-label': c, 'aria-pressed': on, onClick: function () { set(c); setOpen(false); } });
        })),
        h('div', { className: 'pn-colorwell__hex' },
          h('span', { className: 'pn-colorwell__preview', style: { background: hexOk && draft ? (draft[0] === '#' ? draft : '#' + draft) : st[0] } }),
          h(TextField, { 'aria-label': '十六进制颜色', value: draft != null ? draft : st[0], error: hexOk ? null : '格式为 #RRGGBB', style: { flex: 1, minWidth: 0 },
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) { if (e.key === 'Enter' && draft && hexOk) { set((draft[0] === '#' ? draft : '#' + draft).toLowerCase()); setDraft(null); setOpen(false); } } }))));
  }


  /* ---------- DropZone ---------- */
  function DropZone(props) {
    var d = useState(!!props.defaultDragging), over = d[0], setOver = d[1];
    var ref = useRef(null), depth = useRef(0);
    function take(list) { var arr = Array.prototype.slice.call(list || []); if (!props.multiple) arr = arr.slice(0, 1); if (arr.length) props.onFiles && props.onFiles(arr); }
    var files = props.files || [];
    return h('div', { className: cx('pn', 'pn-dropwrap', props.className), style: props.style },
      h('div', { className: cx('pn-drop', over && 'pn-drop--over', props.disabled && 'pn-disabled', props.compact && 'pn-drop--compact'), role: 'group', 'aria-label': props['aria-label'] || '上传文件',
          onDragEnter: function (e) { e.preventDefault(); depth.current++; setOver(true); },
          onDragOver: function (e) { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = 'copy'); },
          onDragLeave: function () { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
          onDrop: function (e) { e.preventDefault(); depth.current = 0; setOver(false); take(e.dataTransfer && e.dataTransfer.files); } },
        h('span', { className: 'pn-drop__icon', 'aria-hidden': true }, renderIcon(props.icon || 'upload')),
        h('div', { className: 'pn-drop__text' },
          h('div', { className: 'pn-drop__title' }, over ? (props.overTitle || '松开以添加') : (props.title || '将文件拖到这里')),
          props.description ? h('div', { className: 'pn-drop__desc' }, props.description) : null),
        h('input', { ref: ref, type: 'file', hidden: true, accept: props.accept, multiple: props.multiple, onChange: function (e) { take(e.target.files); e.target.value = ''; } }),
        h(Button, { size: props.compact ? 'small' : 'regular', disabled: props.disabled, onClick: function () { ref.current && ref.current.click(); } }, props.buttonLabel || '选择文件…')),
      files.length ? h('div', { className: 'pn-drop__list', role: 'list' }, files.map(function (f, i) {
        var ext = (String(f.name).split('.').pop() || '').toLowerCase(), k = FILE_KINDS[ext] || ['gray', ext.toUpperCase().slice(0, 4) || 'FILE'];
        return h('div', { key: f.name + i, role: 'listitem', className: 'pn-drop__file' },
          h('span', { className: 'pn-filetile pn-filetile--sm', style: { background: 'var(--tint-' + k[0] + ')', color: 'var(--tint-' + k[0] + '-text)' } }, k[1]),
          h('div', { className: 'pn-drop__fbody' },
            h('div', { className: 'pn-drop__fname' }, f.name),
            f.error ? h('div', { className: 'pn-field__hint pn-field__hint--error' }, f.error)
              : f.progress != null && f.progress < 100 ? h(ProgressIndicator, { value: f.progress, 'aria-label': f.name + ' 上传进度', style: { width: '100%', height: '4px' } })
              : h('div', { className: 'pn-drop__fmeta' }, [f.size, f.progress === 100 ? '已上传' : null].filter(Boolean).join(' · '))),
          props.onRemove ? h('button', { type: 'button', className: 'pn-inputwrap__btn', 'aria-label': '移除 ' + f.name, onClick: function () { props.onRemove(i, f); } }, h(Icon, { name: 'xmark', weight: 2 })) : null);
      })) : null);
  }

  var api = { Button: Button, Switch: Switch, Checkbox: Checkbox, RadioGroup: RadioGroup, TextField: TextField, SearchField: SearchField, SegmentedControl: SegmentedControl,
    Slider: Slider, ProgressIndicator: ProgressIndicator, PopUpButton: PopUpButton, Menu: Menu, Sidebar: Sidebar, Toolbar: Toolbar, ToolbarGroup: ToolbarGroup,
    ToolbarButton: ToolbarButton, Window: Window, TrafficLights: TrafficLights, Alert: Alert, TabView: TabView, GroupBox: GroupBox, GroupRow: GroupRow, Icon: Icon,
    Avatar: Avatar, AvatarGroup: AvatarGroup, Tag: Tag, Badge: Badge, ConversationList: ConversationList, ConversationItem: ConversationItem, ChatHeader: ChatHeader,
    Mention: Mention, Reactions: Reactions, ReadReceipt: ReadReceipt, ThreadSummary: ThreadSummary, MessageActions: MessageActions, Message: Message, MessageList: MessageList,
    FileAttachment: FileAttachment, ImageAttachment: ImageAttachment, DocLink: DocLink, MessageCard: MessageCard, ChatNotice: ChatNotice, PinnedBanner: PinnedBanner, Composer: Composer ,
    NavRail: NavRail ,
    ChatInfoPanel: ChatInfoPanel ,
    ThreadPanel: ThreadPanel ,
    Popover: Popover, MentionPicker: MentionPicker, ProfileCard: ProfileCard ,
    EmojiPicker: EmojiPicker ,
    VoiceMessage: VoiceMessage, LinkPreview: LinkPreview, CodeBlock: CodeBlock ,
    MeetingCard: MeetingCard, EventCard: EventCard ,
    EmptyState: EmptyState, Skeleton: Skeleton, TypingIndicator: TypingIndicator ,
    NotificationBanner: NotificationBanner, ContextMenu: ContextMenu, messageMenuItems: messageMenuItems ,
    Table: Table ,
    Sheet: Sheet, Dialog: Dialog ,
    SecureField: SecureField, TextArea: TextArea, Stepper: Stepper, ComboBox: ComboBox ,
    Form: Form, FormRow: FormRow, FormActions: FormActions, CheckboxGroup: CheckboxGroup, Divider: Divider, Link: Link, HelpButton: HelpButton ,
    Calendar: Calendar, DatePicker: DatePicker ,
    Disclosure: Disclosure ,
    Tooltip: Tooltip, Kbd: Kbd, Toast: Toast, HUD: HUD, TokenField: TokenField ,
    PullDownButton: PullDownButton ,
    PathControl: PathControl, LevelIndicator: LevelIndicator, ColorWell: ColorWell ,
    DropZone: DropZone };
  window.Pane = Object.assign(window.Pane || {}, api);
})();
