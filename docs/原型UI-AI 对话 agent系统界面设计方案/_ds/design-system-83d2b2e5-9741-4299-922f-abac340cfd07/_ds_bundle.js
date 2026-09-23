/* @ds-bundle: {"format":4,"namespace":"DesignSystem_83d2b2","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CardHeader","sourcePath":"components/core/Card.jsx"},{"name":"CardTitle","sourcePath":"components/core/Card.jsx"},{"name":"CardDescription","sourcePath":"components/core/Card.jsx"},{"name":"CardContent","sourcePath":"components/core/Card.jsx"},{"name":"CardFooter","sourcePath":"components/core/Card.jsx"},{"name":"Checkbox","sourcePath":"components/core/Checkbox.jsx"},{"name":"CloseButton","sourcePath":"components/core/CloseButton.jsx"},{"name":"TrafficLights","sourcePath":"components/core/CloseButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Textarea","sourcePath":"components/core/Input.jsx"},{"name":"Progress","sourcePath":"components/core/Progress.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Skeleton","sourcePath":"components/core/Skeleton.jsx"},{"name":"Slider","sourcePath":"components/core/Slider.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Table","sourcePath":"components/core/Table.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"StepIndicator","sourcePath":"components/feedback/StepIndicator.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"ToastStack","sourcePath":"components/feedback/Toast.jsx"},{"name":"DropdownMenu","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"MenuItem","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"MenuLabel","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"MenuSeparator","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"Modal","sourcePath":"components/overlays/Modal.jsx"},{"name":"Window","sourcePath":"components/overlays/Window.jsx"},{"name":"StatusBar","sourcePath":"components/overlays/Window.jsx"},{"name":"ActionBar","sourcePath":"components/patterns/ActionBar.jsx"},{"name":"ModalFooter","sourcePath":"components/patterns/ActionBar.jsx"},{"name":"PanelHeader","sourcePath":"components/patterns/PanelHeader.jsx"},{"name":"PillGroup","sourcePath":"components/patterns/PillGroup.jsx"},{"name":"SettingsPageHeader","sourcePath":"components/patterns/SettingsPageHeader.jsx"},{"name":"SidebarNav","sourcePath":"components/patterns/SettingsPageHeader.jsx"},{"name":"SummaryCard","sourcePath":"components/patterns/SummaryCard.jsx"},{"name":"MetaPair","sourcePath":"components/patterns/SummaryCard.jsx"},{"name":"ColorField","sourcePath":"components/primitives/ColorField.jsx"},{"name":"Divider","sourcePath":"components/primitives/Divider.jsx"},{"name":"Eyebrow","sourcePath":"components/primitives/Eyebrow.jsx"},{"name":"Field","sourcePath":"components/primitives/Field.jsx"},{"name":"FieldGrid","sourcePath":"components/primitives/Field.jsx"},{"name":"MediaPlaceholder","sourcePath":"components/primitives/MediaPlaceholder.jsx"},{"name":"NumberField","sourcePath":"components/primitives/NumberField.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"d08b990c4d3a","components/core/Button.jsx":"183c6c8d5a3b","components/core/Card.jsx":"fd685c6ab039","components/core/Checkbox.jsx":"178e8c980541","components/core/CloseButton.jsx":"2805d5060542","components/core/Input.jsx":"d0bfeb55a3c9","components/core/Progress.jsx":"0931c4a919f9","components/core/Select.jsx":"ac4ba1547e70","components/core/Skeleton.jsx":"efa904eed4d6","components/core/Slider.jsx":"bd079b7575a1","components/core/Switch.jsx":"d945b3c51a6b","components/core/Table.jsx":"37bfa8069c05","components/core/Tabs.jsx":"ec363df99163","components/feedback/Alert.jsx":"49752c6aaf63","components/feedback/EmptyState.jsx":"f22b3db6a637","components/feedback/Spinner.jsx":"9791342eec37","components/feedback/StepIndicator.jsx":"57216ebcb3a0","components/feedback/Toast.jsx":"8947e69f4a5e","components/overlays/DropdownMenu.jsx":"8c349d766009","components/overlays/Modal.jsx":"08b647edec0d","components/overlays/Window.jsx":"4789edc1027d","components/patterns/ActionBar.jsx":"3ee80d6b2d46","components/patterns/PanelHeader.jsx":"cb2946282732","components/patterns/PillGroup.jsx":"82ee7ba6ff02","components/patterns/SettingsPageHeader.jsx":"b00a7867836b","components/patterns/SummaryCard.jsx":"049aa76df37f","components/primitives/ColorField.jsx":"adb083df6737","components/primitives/Divider.jsx":"a581a02736df","components/primitives/Eyebrow.jsx":"689b1dd921b1","components/primitives/Field.jsx":"c9aa2332edc4","components/primitives/MediaPlaceholder.jsx":"380c5a6a6da2","components/primitives/NumberField.jsx":"424cd359405f","ui_kits/desktop-app/Icon.jsx":"f668de4780df","ui_kits/desktop-app/ScriptWorkbench.jsx":"0a622af01185","ui_kits/desktop-app/SettingsScreen.jsx":"7ed68048861b","ui_kits/desktop-app/VideoEditor.jsx":"91a06e255055","ui_kits/desktop-app/WelcomeScreen.jsx":"56c1aa603c4e","ui_kits/homepage/Sections.jsx":"9f848e95c2bf"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.DesignSystem_83d2b2 = window.DesignSystem_83d2b2 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
const V = {
  default: {
    background: 'var(--color-control-bg)',
    color: 'var(--color-text-primary)'
  },
  secondary: {
    background: 'var(--color-control-bg)',
    color: 'var(--color-text-muted)'
  },
  outline: {
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: '1px solid var(--color-separator)'
  },
  info: {
    background: 'rgba(10,132,255,0.15)',
    color: '#409CFF'
  },
  success: {
    background: 'rgba(50,215,75,0.15)',
    color: '#32D74B'
  },
  warning: {
    background: 'rgba(255,159,10,0.15)',
    color: '#FFD60A'
  },
  destructive: {
    background: 'rgba(255,69,58,0.15)',
    color: '#FF453A'
  }
};
function Badge({
  variant = 'default',
  size = 'sm',
  color,
  children,
  style
}) {
  const v = V[variant] || V.default;
  const custom = color ? {
    color,
    background: 'color-mix(in srgb, ' + color + ' 10%, transparent)'
  } : null;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      border: v.border || '1px solid transparent',
      fontWeight: 600,
      letterSpacing: '0.02em',
      lineHeight: 1.2,
      padding: size === 'xs' ? '2px 6px' : '2px 8px',
      fontSize: size === 'xs' ? 9 : 10,
      borderRadius: size === 'xs' ? 'var(--radius-sm)' : 'var(--radius-pill)',
      ...v,
      ...custom,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const VARIANTS = {
  default: {
    background: 'var(--color-control-bg)',
    color: '#fff',
    border: '1px solid transparent'
  },
  primary: {
    background: 'var(--color-system-blue)',
    color: '#fff',
    border: '1px solid transparent'
  },
  secondary: {
    background: 'var(--color-control-bg)',
    color: '#fff',
    border: '1px solid transparent'
  },
  outline: {
    background: 'transparent',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-control)'
  },
  ghost: {
    background: 'rgba(255,255,255,0.05)',
    color: 'var(--color-text-muted)',
    border: '1px solid transparent'
  },
  accent: {
    background: 'rgba(10,132,255,0.10)',
    color: 'var(--color-system-blue)',
    border: '1px solid rgba(10,132,255,0.25)'
  },
  destructive: {
    background: 'rgba(255,69,58,0.10)',
    color: 'var(--color-danger)',
    border: '1px solid rgba(255,69,58,0.25)'
  },
  success: {
    background: 'var(--color-success)',
    color: '#fff',
    border: '1px solid transparent'
  },
  warning: {
    background: 'var(--color-warning)',
    color: '#000',
    border: '1px solid transparent'
  },
  link: {
    background: 'transparent',
    color: 'var(--color-text-primary)',
    border: '1px solid transparent',
    textDecoration: 'underline',
    textUnderlineOffset: '4px'
  }
};
const SIZES = {
  xs: {
    height: 22,
    borderRadius: 5,
    padding: '0 8px',
    fontSize: 10,
    icon: 10
  },
  sm: {
    height: 26,
    borderRadius: 'var(--radius-md)',
    padding: '0 10px',
    fontSize: 11,
    icon: 12
  },
  md: {
    height: 30,
    borderRadius: 'var(--radius-lg)',
    padding: '0 14px',
    fontSize: 12,
    icon: 14
  },
  lg: {
    height: 36,
    borderRadius: 'var(--radius-lg)',
    padding: '0 16px',
    fontSize: 13,
    icon: 16
  },
  icon: {
    height: 30,
    width: 30,
    borderRadius: 'var(--radius-lg)',
    padding: 0,
    fontSize: 12,
    icon: 14
  }
};
function Button({
  variant = 'default',
  size = 'md',
  children,
  leftIcon,
  rightIcon,
  loading = false,
  loadingText,
  fullWidth = false,
  iconOnly = false,
  disabled,
  style,
  onClick,
  title,
  type = 'button',
  ...rest
}) {
  const key = iconOnly ? 'icon' : SIZES[size] ? size : 'md';
  const s = SIZES[key];
  const v = VARIANTS[variant] || VARIANTS.default;
  const isDisabled = disabled || loading;
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const filled = variant === 'primary' || variant === 'default' || variant === 'secondary' || variant === 'success' || variant === 'warning';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    title: title,
    disabled: isDisabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      whiteSpace: 'nowrap',
      fontFamily: 'var(--font-sans)',
      fontWeight: 500,
      lineHeight: 1,
      cursor: isDisabled ? 'default' : 'pointer',
      transition: 'background var(--motion-fast), color var(--motion-fast), filter var(--motion-fast), transform 80ms ease',
      height: s.height,
      width: iconOnly ? s.width : fullWidth ? '100%' : undefined,
      borderRadius: s.borderRadius,
      padding: s.padding,
      fontSize: s.fontSize,
      filter: hover && !isDisabled && filled ? 'brightness(1.1)' : 'none',
      transform: press && !isDisabled ? 'scale(0.96)' : 'none',
      opacity: isDisabled ? 0.5 : 1,
      background: hover && !isDisabled && !filled && variant !== 'link' ? variant === 'outline' ? 'rgba(58,58,60,0.5)' : variant === 'ghost' ? 'rgba(255,255,255,0.1)' : variant === 'accent' ? 'rgba(10,132,255,0.2)' : variant === 'destructive' ? 'rgba(255,69,58,0.2)' : v.background : v.background,
      color: v.color,
      border: v.border,
      textDecoration: v.textDecoration
    }
  }, rest), loading ? /*#__PURE__*/React.createElement(Spin, {
    size: s.icon
  }) : leftIcon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: s.icon,
      height: s.icon,
      flexShrink: 0,
      display: 'inline-flex'
    }
  }, leftIcon) : null, loading ? loadingText || null : children, !loading && rightIcon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: s.icon,
      height: s.icon,
      flexShrink: 0,
      display: 'inline-flex'
    }
  }, rightIcon) : null);
}
function Spin({
  size
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      border: '2px solid currentColor',
      borderRightColor: 'transparent',
      borderRadius: '50%',
      display: 'inline-block',
      animation: 'lj-spin 0.85s linear infinite'
    }
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes lj-spin{to{transform:rotate(360deg)}}'));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderRadius: 'var(--radius-2xl)',
      border: '1px solid var(--color-separator)',
      background: 'var(--color-panel-elevated)',
      color: 'var(--color-text-primary)',
      transition: 'border-color var(--motion-fast)',
      ...style
    }
  }, rest), children);
}
function CardHeader({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      padding: '14px 16px',
      borderBottom: '1px solid var(--color-separator)',
      ...style
    }
  }, children);
}
function CardTitle({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1,
      color: 'var(--color-text-primary)',
      ...style
    }
  }, children);
}
function CardDescription({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 12,
      lineHeight: 'var(--line-height-normal)',
      color: 'var(--color-text-secondary)',
      ...style
    }
  }, children);
}
function CardContent({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 16px',
      ...style
    }
  }, children);
}
function CardFooter({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--color-separator)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Checkbox.jsx
try { (() => {
function Checkbox({
  label,
  checked = false,
  indeterminate = false,
  onChange,
  disabled,
  size = 'md'
}) {
  const box = size === 'sm' ? 14 : 16;
  const active = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: 'var(--color-text-primary)',
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'default' : 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      width: box,
      height: box,
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked),
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      margin: 0,
      cursor: disabled ? 'default' : 'pointer'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: box,
      height: box,
      color: '#fff',
      borderRadius: size === 'sm' ? 4 : 'var(--radius-sm)',
      transition: 'all var(--motion-fast)',
      background: active ? 'var(--color-system-blue)' : 'var(--color-panel-elevated)',
      border: '1px solid ' + (active ? 'var(--color-system-blue)' : 'var(--color-border-control)')
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: size === 'sm' ? 6 : 8,
      height: 2,
      background: '#fff',
      borderRadius: 1
    }
  }) : checked ? /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 16 16",
    width: box - 5,
    height: box - 5,
    fill: "none"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "3.5 8.5 6.5 11.5 12.5 4.5",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })) : null)), label ? /*#__PURE__*/React.createElement("span", null, label) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/core/CloseButton.jsx
try { (() => {
function CloseButton({
  onClick,
  title = 'Close'
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    title: title,
    "aria-label": title,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 14,
      height: 14,
      borderRadius: '50%',
      border: 'none',
      background: '#FF5F57',
      cursor: 'pointer',
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "8",
    height: "8",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "rgba(0,0,0,0.55)",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    style: {
      opacity: hover ? 1 : 0,
      transition: 'opacity var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })));
}
function TrafficLights({
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(CloseButton, {
    onClick: onClose
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: '#FEBC2E'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: '#28C840'
    }
  }));
}
Object.assign(__ds_scope, { CloseButton, TrafficLights });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/CloseButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    height: 32,
    fontSize: 12,
    padding: '0 10px'
  },
  md: {
    height: 36,
    fontSize: 13,
    padding: '0 12px'
  },
  lg: {
    height: 40,
    fontSize: 15,
    padding: '0 16px'
  }
};
function Input({
  size = 'md',
  error,
  success,
  leftIcon,
  rightIcon,
  style,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? 'rgba(255,69,58,0.6)' : success ? 'rgba(50,215,75,0.6)' : focus ? 'var(--color-system-blue)' : 'var(--color-border-control)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%'
    }
  }, leftIcon ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 14,
      height: 14,
      color: 'var(--color-text-muted)',
      pointerEvents: 'none'
    }
  }, leftIcon) : null, /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      display: 'flex',
      width: '100%',
      height: s.height,
      fontSize: s.fontSize,
      padding: s.padding,
      paddingLeft: leftIcon ? 36 : undefined,
      paddingRight: rightIcon || error || success ? 36 : undefined,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid ' + borderColor,
      background: 'var(--color-panel-elevated)',
      color: 'var(--color-text-primary)',
      boxShadow: focus && !error && !success ? '0 0 0 3px rgba(10,132,255,0.2)' : 'none',
      transition: 'border-color var(--motion-base), box-shadow var(--motion-base)',
      outline: 'none',
      ...style
    }
  }, rest)), rightIcon ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 14,
      height: 14,
      color: 'var(--color-text-muted)'
    }
  }, rightIcon) : null);
}
function Textarea({
  size = 'md',
  error,
  resize = 'vertical',
  style,
  ...rest
}) {
  const pad = size === 'sm' ? '6px 10px' : size === 'lg' ? '10px 16px' : '8px 12px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 15 : 13;
  const minH = size === 'sm' ? 60 : size === 'lg' ? 100 : 80;
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("textarea", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      display: 'flex',
      width: '100%',
      minHeight: minH,
      padding: pad,
      fontSize: fs,
      resize,
      lineHeight: 'var(--line-height-normal)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid ' + (error ? 'rgba(255,69,58,0.6)' : focus ? 'var(--color-system-blue)' : 'var(--color-border-control)'),
      background: 'var(--color-panel-elevated)',
      color: 'var(--color-text-primary)',
      boxShadow: focus && !error ? '0 0 0 3px rgba(10,132,255,0.2)' : 'none',
      transition: 'border-color var(--motion-base), box-shadow var(--motion-base)',
      outline: 'none',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Input, Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Progress.jsx
try { (() => {
const H = {
  sm: 4,
  md: 8,
  lg: 12
};
const C = {
  default: 'var(--color-system-blue)',
  success: 'var(--color-success)',
  warning: 'var(--color-brand-warm)',
  danger: 'var(--color-danger)'
};
function Progress({
  value = 0,
  max = 100,
  size = 'md',
  variant = 'default',
  indeterminate = false,
  showValue = false
}) {
  const pct = Math.min(100, Math.max(0, value / max * 100));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: H[size],
      overflow: 'hidden',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-control-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      borderRadius: 'var(--radius-pill)',
      background: C[variant],
      width: indeterminate ? '35%' : pct + '%',
      transition: 'width 0.4s var(--ease-apple)',
      animation: indeterminate ? 'lj-sweep 1.2s ease-in-out infinite' : 'none'
    }
  }), /*#__PURE__*/React.createElement("style", null, '@keyframes lj-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(388%)}}')), showValue && !indeterminate ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      textAlign: 'right',
      fontSize: 11,
      color: 'var(--color-text-muted)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, Math.round(pct), "%") : null);
}
Object.assign(__ds_scope, { Progress });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Progress.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function Select({
  options = [],
  value,
  placeholder = 'Select...',
  onChange,
  disabled,
  fullWidth = true,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-block',
      width: fullWidth ? '100%' : undefined,
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled,
    onClick: () => setOpen(v => !v),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      height: 36,
      padding: '0 12px',
      fontSize: 13,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid ' + (open ? 'var(--color-system-blue)' : 'var(--color-border-control)'),
      background: 'var(--color-panel-elevated)',
      color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
      boxShadow: open ? '0 0 0 3px rgba(10,132,255,0.2)' : 'none',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'border-color var(--motion-fast), box-shadow var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, selected ? selected.label : placeholder), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      marginLeft: 8,
      opacity: 0.5,
      transform: open ? 'rotate(180deg)' : 'none',
      transition: 'transform var(--motion-base)'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }))), open ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'calc(100% + 4px)',
      left: 0,
      minWidth: '100%',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      padding: 4,
      gap: 2,
      borderRadius: 'var(--radius-dropdown)',
      border: '1px solid var(--color-border-control)',
      background: 'var(--color-panel-elevated)',
      boxShadow: 'var(--shadow-dropdown)'
    }
  }, options.map(o => /*#__PURE__*/React.createElement(Row, {
    key: o.value,
    option: o,
    active: o.value === value,
    onPick: () => {
      setOpen(false);
      onChange && onChange(o.value);
    }
  }))) : null);
}
function Row({
  option,
  active,
  onPick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    role: "option",
    "aria-selected": active,
    onClick: option.disabled ? undefined : onPick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      padding: '6px 8px',
      fontSize: 13,
      borderRadius: 'var(--radius-lg)',
      cursor: option.disabled ? 'not-allowed' : 'pointer',
      opacity: option.disabled ? 0.5 : 1,
      background: active || hover ? 'var(--color-system-blue)' : 'transparent',
      color: active || hover ? '#fff' : 'var(--color-text-primary)',
      transition: 'background var(--motion-fast), color var(--motion-fast)'
    }
  }, option.label);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Skeleton.jsx
try { (() => {
function Skeleton({
  width = '100%',
  height = 12,
  radius = 'var(--radius-sm)',
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      height,
      borderRadius: radius,
      background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.05) 100%)',
      backgroundSize: '200% 100%',
      animation: 'lj-shimmer 1.6s linear infinite',
      ...style
    }
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes lj-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}'));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/core/Slider.jsx
try { (() => {
const TRACK = {
  sm: 4,
  md: 8,
  lg: 12
};
const THUMB = {
  sm: 12,
  md: 16,
  lg: 20
};
function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  size = 'md',
  showValue = false,
  disabled
}) {
  const ref = React.useRef(null);
  const [drag, setDrag] = React.useState(false);
  const pct = (value - min) / (max - min) * 100;
  const set = clientX => {
    if (!ref.current || disabled) return;
    const r = ref.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const raw = min + p * (max - min);
    onChange && onChange(Math.max(min, Math.min(max, Math.round(raw / step) * step)));
  };
  React.useEffect(() => {
    if (!drag) return;
    const mv = e => set(e.clientX);
    const up = () => setDrag(false);
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    };
  });
  const t = TRACK[size],
    th = THUMB[size];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      opacity: disabled ? 0.5 : 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    ref: ref,
    onMouseDown: e => {
      setDrag(true);
      set(e.clientX);
    },
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      height: th,
      cursor: disabled ? 'not-allowed' : 'pointer',
      userSelect: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%',
      height: t,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-control-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: '100%',
      width: pct + '%',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-system-blue)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 'calc(' + pct + '% - ' + th / 2 + 'px)',
      width: th,
      height: th,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: drag ? '0 0 0 6px rgba(10,132,255,0.22), 0 4px 14px rgba(10,132,255,0.35)' : '0 1px 3px rgba(0,0,0,0.25)',
      transform: drag ? 'scale(1.18)' : 'none',
      transition: drag ? 'none' : 'transform var(--motion-fast), box-shadow var(--motion-fast)'
    }
  })), showValue ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      textAlign: 'right',
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value) : null);
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Slider.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function Switch({
  label,
  checked = false,
  onChange,
  disabled
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: 'var(--color-text-primary)',
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'default' : 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: e => onChange && onChange(e.target.checked),
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      margin: 0,
      cursor: disabled ? 'default' : 'pointer'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      width: 44,
      height: 24,
      padding: 2,
      borderRadius: 'var(--radius-pill)',
      background: checked ? 'var(--color-system-blue)' : 'var(--color-control-bg)',
      transition: 'background var(--duration-base) var(--ease-apple)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      transform: 'translateX(' + (checked ? 20 : 0) + 'px)',
      transition: 'transform var(--duration-base) var(--ease-apple)'
    }
  }))), label ? /*#__PURE__*/React.createElement("span", null, label) : null);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Table.jsx
try { (() => {
function Table({
  columns = [],
  rows = [],
  onRowClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)',
      overflow: 'hidden',
      background: 'var(--color-window-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: 28,
      alignItems: 'center',
      padding: '0 12px',
      gap: 12,
      borderBottom: '1px solid var(--color-separator)',
      background: 'var(--color-panel-bg)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.key,
    style: {
      flex: c.width ? '0 0 ' + c.width : 1,
      minWidth: 0,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--color-text-muted)',
      textAlign: c.align || 'left'
    }
  }, c.label))), rows.map((r, i) => /*#__PURE__*/React.createElement(Row, {
    key: i,
    row: r,
    columns: columns,
    onClick: onRowClick,
    last: i === rows.length - 1
  })));
}
function Row({
  row,
  columns,
  onClick,
  last
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick ? () => onClick(row) : undefined,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      minHeight: 32,
      alignItems: 'center',
      padding: '0 12px',
      gap: 12,
      fontSize: 12,
      color: 'var(--color-text-secondary)',
      borderBottom: last ? 'none' : '1px solid var(--color-separator)',
      background: hover ? 'var(--color-bg-hover)' : 'transparent',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'background var(--motion-fast)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.key,
    style: {
      flex: c.width ? '0 0 ' + c.width : 1,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textAlign: c.align || 'left',
      color: c.primary ? 'var(--color-text-primary)' : undefined,
      fontVariantNumeric: c.numeric ? 'tabular-nums' : undefined
    }
  }, row[c.key])));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Table.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
function Tabs({
  value,
  onChange,
  items = [],
  size = 'md'
}) {
  const h = size === 'sm' ? 28 : 32;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      height: h,
      padding: 2,
      gap: 2,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)',
      background: 'var(--color-control-bg)'
    }
  }, items.map(it => {
    const active = it.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      type: "button",
      role: "tab",
      "aria-selected": active,
      disabled: it.disabled,
      onClick: () => onChange && onChange(it.value),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        padding: '0 10px',
        height: h - 6,
        borderRadius: 'var(--radius-md)',
        fontSize: 12,
        fontWeight: 500,
        cursor: it.disabled ? 'default' : 'pointer',
        opacity: it.disabled ? 0.5 : 1,
        transition: 'all var(--motion-fast)',
        border: active ? '1px solid var(--color-separator)' : '1px solid transparent',
        background: active ? 'var(--color-window-bg)' : 'transparent',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
      }
    }, it.icon ? /*#__PURE__*/React.createElement("span", {
      style: {
        width: 14,
        height: 14,
        display: 'inline-flex'
      }
    }, it.icon) : null, it.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
const V = {
  info: {
    bg: 'rgba(10,132,255,0.08)',
    border: 'rgba(10,132,255,0.25)',
    icon: '#409CFF'
  },
  success: {
    bg: 'rgba(50,215,75,0.08)',
    border: 'rgba(50,215,75,0.25)',
    icon: '#32D74B'
  },
  warning: {
    bg: 'rgba(255,159,10,0.08)',
    border: 'rgba(255,159,10,0.25)',
    icon: '#FF9F0A'
  },
  error: {
    bg: 'rgba(255,69,58,0.08)',
    border: 'rgba(255,69,58,0.25)',
    icon: '#FF453A'
  }
};
function Alert({
  variant = 'info',
  title,
  description,
  icon,
  children,
  dismissible = false,
  onDismiss,
  style
}) {
  const [open, setOpen] = React.useState(true);
  const v = V[variant] || V.info;
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "alert",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '12px 14px',
      borderRadius: 10,
      background: v.bg,
      border: '1px solid ' + v.border,
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      marginTop: 2,
      width: 16,
      height: 16,
      color: v.icon
    }
  }, icon) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title ? /*#__PURE__*/React.createElement("h5", {
    style: {
      margin: 0,
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.2,
      color: 'var(--color-text-primary)'
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: title ? '4px 0 0' : 0,
      fontSize: 13,
      lineHeight: 'var(--line-height-relaxed)',
      color: 'var(--color-text-secondary)'
    }
  }, description) : null, children), dismissible ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => {
      setOpen(false);
      onDismiss && onDismiss();
    },
    "aria-label": "Dismiss",
    style: {
      flexShrink: 0,
      padding: 4,
      borderRadius: 8,
      border: 'none',
      background: 'transparent',
      color: v.icon,
      opacity: 0.6,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))) : null);
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function EmptyState({
  eyebrow,
  title,
  description,
  actions,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      gap: 8,
      padding: 16,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border-subtle)',
      background: 'color-mix(in srgb, var(--color-panel-subtle) 70%, var(--color-panel-bg))',
      ...style
    }
  }, eyebrow ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--color-text-disabled)'
    }
  }, eyebrow) : null, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 650,
      color: 'var(--color-text-primary)'
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 320,
      fontSize: 10,
      lineHeight: 'var(--line-height-relaxed)',
      color: 'var(--color-text-secondary)'
    }
  }, description) : null, actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      marginTop: 2
    }
  }, actions) : null);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function Spinner({
  size = 14,
  color = 'var(--color-text-muted)'
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: size,
      height: size,
      border: '2px solid ' + color,
      borderRightColor: 'transparent',
      borderRadius: '50%',
      animation: 'lj-spinner 0.85s linear infinite',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes lj-spinner{to{transform:rotate(360deg)}}'));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StepIndicator.jsx
try { (() => {
function StepIndicator({
  steps = []
}) {
  return /*#__PURE__*/React.createElement("ol", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 4,
      margin: 0,
      padding: 0,
      listStyle: 'none'
    }
  }, steps.map(s => {
    const done = s.status === 'completed',
      err = s.status === 'error',
      active = s.status === 'active';
    return /*#__PURE__*/React.createElement("li", {
      key: s.label,
      "data-status": s.status,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 28,
        padding: '0 10px',
        border: '1px solid var(--color-separator)',
        borderRadius: 'var(--radius-pill)',
        background: done || err || active ? 'var(--color-panel-elevated)' : 'var(--color-control-bg)',
        color: err ? 'var(--color-danger)' : done || active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        transition: 'all var(--motion-fast)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        flexShrink: 0
      }
    }, active ? /*#__PURE__*/React.createElement(__ds_scope.Spinner, {
      size: 14,
      color: "currentColor"
    }) : done ? /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.5",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M20 6 9 17l-5-5"
    })) : err ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1
      }
    }, "!") : /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'currentColor',
        opacity: 0.72
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1
      }
    }, s.label));
  }));
}
Object.assign(__ds_scope, { StepIndicator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StepIndicator.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
const C = {
  info: '#409CFF',
  success: '#32D74B',
  warning: '#FF9F0A',
  error: '#FF453A'
};
function Toast({
  type = 'info',
  title,
  message,
  icon,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 320,
      maxWidth: 420,
      borderRadius: 10,
      border: '1px solid var(--color-border-control)',
      background: 'var(--color-panel-elevated)',
      boxShadow: 'var(--shadow-toast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: 16
    }
  }, icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      flexShrink: 0,
      color: C[type]
    }
  }, icon) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      marginBottom: 2
    }
  }, title) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--color-text-secondary)'
    }
  }, message)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Close",
    style: {
      border: 'none',
      background: 'transparent',
      color: 'var(--color-text-muted)',
      cursor: 'pointer',
      padding: 0,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))));
}
function ToastStack({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 16,
      right: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      zIndex: 'var(--z-toast)'
    }
  }, children);
}
Object.assign(__ds_scope, { Toast, ToastStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/overlays/DropdownMenu.jsx
try { (() => {
function DropdownMenu({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      minWidth: 220,
      padding: 6,
      borderRadius: 'var(--radius-dropdown)',
      border: '1px solid var(--color-border-control)',
      background: 'var(--color-panel-elevated)',
      boxShadow: 'var(--shadow-dropdown)',
      ...style
    }
  }, children);
}
function MenuItem({
  children,
  shortcut,
  destructive,
  disabled,
  checked,
  onSelect
}) {
  const [hover, setHover] = React.useState(false);
  const hl = hover && !disabled;
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "menuitem",
    disabled: disabled,
    onClick: onSelect,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      width: '100%',
      alignItems: 'center',
      gap: 8,
      padding: '7px 14px',
      fontSize: 13,
      textAlign: 'left',
      border: 'none',
      borderRadius: 'var(--radius-lg)',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: hl ? destructive ? 'var(--color-danger)' : 'var(--color-system-blue)' : 'transparent',
      color: hl ? '#fff' : destructive ? 'var(--color-danger)' : 'var(--color-text-primary)',
      transition: 'background var(--motion-fast), color var(--motion-fast)'
    }
  }, checked !== undefined ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, checked ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })) : null) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, children), shortcut ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontSize: 11,
      letterSpacing: '0.1em',
      color: hl ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)'
    }
  }, shortcut) : null);
}
function MenuLabel({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 14px',
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--color-text-muted)'
    }
  }, children);
}
function MenuSeparator() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '4px -2px',
      height: 1,
      background: 'var(--color-separator)'
    }
  });
}
Object.assign(__ds_scope, { DropdownMenu, MenuItem, MenuLabel, MenuSeparator });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/DropdownMenu.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Modal.jsx
try { (() => {
const W = {
  sm: 448,
  md: 448,
  lg: 896,
  xl: 1152
};
function Modal({
  open = true,
  title,
  children,
  footer,
  size = 'md',
  onClose,
  inline = false
}) {
  if (!open) return null;
  const panel = /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      maxWidth: W[size],
      background: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-border-control)',
      borderRadius: 14,
      boxShadow: 'var(--shadow-modal)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '16px 24px',
      borderBottom: '1px solid var(--color-separator)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.CloseButton, {
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text-primary)'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16,
      overflowY: 'auto'
    }
  }, children), footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '12px 16px',
      borderTop: '1px solid var(--color-separator)'
    }
  }, footer) : null);
  if (inline) return panel;
  return /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    },
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      background: 'rgba(0,0,0,0.6)',
      zIndex: 'var(--z-modal)'
    }
  }, panel);
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Modal.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Window.jsx
try { (() => {
function Window({
  title,
  subtitle,
  leading,
  actions,
  children,
  height,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: height || '100%',
      width: '100%',
      overflow: 'hidden',
      borderRadius: 'var(--radius-window)',
      border: '1px solid var(--color-separator)',
      background: 'var(--color-window-bg)',
      boxShadow: 'var(--shadow-window)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 44,
      padding: '0 16px',
      flexShrink: 0,
      borderBottom: '1px solid var(--color-separator)',
      background: 'var(--color-titlebar-bg)',
      userSelect: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 168,
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.TrafficLights, null), leading), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 300,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      lineHeight: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%'
    }
  }, title), subtitle ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)',
      lineHeight: 1
    }
  }, subtitle) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      minWidth: 168,
      justifyContent: 'flex-end',
      zIndex: 1
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }
  }, children));
}
function StatusBar({
  left,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 28,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderTop: '1px solid var(--color-border-subtle)',
      background: 'var(--color-panel-bg)',
      fontSize: 11,
      color: 'var(--color-text-tertiary)',
      userSelect: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 0
    }
  }, left), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, right));
}
Object.assign(__ds_scope, { Window, StatusBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Window.jsx", error: String((e && e.message) || e) }); }

// components/patterns/ActionBar.jsx
try { (() => {
function ActionBar({
  start,
  center,
  end,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      ...style
    }
  }, start ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, start) : null, center ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flex: 1,
      minWidth: 0
    }
  }, center) : null, end ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginLeft: 'auto'
    }
  }, end) : null);
}
function ModalFooter({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { ActionBar, ModalFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/ActionBar.jsx", error: String((e && e.message) || e) }); }

// components/patterns/PanelHeader.jsx
try { (() => {
function PanelHeader({
  eyebrow,
  title,
  description,
  meta,
  leading,
  actions,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 6,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 6,
      minWidth: 0
    }
  }, leading ? /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0
    }
  }, leading) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, eyebrow ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'var(--color-text-disabled)'
    }
  }, eyebrow) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text-primary)'
    }
  }, title), meta ? /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0
    }
  }, meta) : null), description ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2,
      fontSize: 10,
      lineHeight: 'var(--line-height-normal)',
      color: 'var(--color-text-secondary)'
    }
  }, description) : null)), actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0
    }
  }, actions) : null);
}
Object.assign(__ds_scope, { PanelHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/PanelHeader.jsx", error: String((e && e.message) || e) }); }

// components/patterns/PillGroup.jsx
try { (() => {
const S = {
  sm: {
    padding: '4px 12px',
    fontSize: 11,
    radius: 'var(--radius-md)'
  },
  md: {
    padding: '5px 16px',
    fontSize: 12,
    radius: 'var(--radius-lg)'
  },
  lg: {
    padding: '7px 18px',
    fontSize: 13,
    radius: 'var(--radius-lg)'
  }
};
function PillGroup({
  items = [],
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  style
}) {
  const s = S[size] || S.md;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: fullWidth ? 'flex' : 'inline-flex',
      width: fullWidth ? '100%' : 'fit-content',
      maxWidth: '100%',
      gap: 2,
      padding: 3,
      background: 'var(--color-panel-elevated)',
      borderRadius: size === 'sm' ? 'var(--radius-lg)' : 'var(--radius)',
      ...style
    }
  }, items.map(it => /*#__PURE__*/React.createElement(Pill, {
    key: it.value,
    item: it,
    active: it.value === value,
    s: s,
    grow: fullWidth,
    onClick: () => onChange && onChange(it.value)
  })));
}
function Pill({
  item,
  active,
  s,
  grow,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: item.disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      flex: grow ? '1 1 0' : undefined,
      minWidth: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      border: 'none',
      cursor: item.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      padding: s.padding,
      fontSize: s.fontSize,
      lineHeight: 1.2,
      borderRadius: s.radius,
      opacity: item.disabled ? 0.35 : 1,
      fontWeight: active ? 600 : 500,
      background: active ? 'var(--color-system-blue)' : hover ? 'var(--color-panel-subtle)' : 'transparent',
      color: active ? 'var(--color-text-primary)' : hover ? 'var(--color-text-secondary-strong)' : 'var(--color-text-secondary)',
      transition: 'background var(--motion-fast), color var(--motion-fast)'
    }
  }, item.icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      display: 'inline-flex'
    }
  }, item.icon) : null, item.label);
}
Object.assign(__ds_scope, { PillGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/PillGroup.jsx", error: String((e && e.message) || e) }); }

// components/patterns/SettingsPageHeader.jsx
try { (() => {
function SettingsPageHeader({
  title,
  description,
  actions,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      font: 'var(--type-large-heading)',
      color: 'var(--color-text-primary)'
    }
  }, title), description ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: 13,
      color: 'var(--color-text-secondary)'
    }
  }, description) : null), actions ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0
    }
  }, actions) : null);
}
function SidebarNav({
  items = [],
  value,
  onChange,
  title,
  onBack
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 16,
      width: 240,
      flexShrink: 0,
      borderRight: '1px solid var(--color-separator)',
      background: 'var(--color-panel-bg)',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 0 12px'
    }
  }, onBack ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onBack,
    "aria-label": "\u8FD4\u56DE",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-md)',
      border: 'none',
      background: 'var(--color-control-bg)',
      color: 'var(--color-text-primary)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M19 12H5M12 19l-7-7 7-7"
  }))) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      color: 'var(--color-text-primary)'
    }
  }, title)), items.map(it => /*#__PURE__*/React.createElement(NavRow, {
    key: it.value,
    item: it,
    active: it.value === value,
    onClick: () => onChange && onChange(it.value)
  })));
}
function NavRow({
  item,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      height: 32,
      padding: '0 10px',
      textAlign: 'left',
      border: '1px solid ' + (active ? 'rgba(10,132,255,0.25)' : 'transparent'),
      borderRadius: 'var(--radius-lg)',
      cursor: 'pointer',
      background: active ? 'rgba(10,132,255,0.10)' : hover ? 'var(--color-bg-hover)' : 'transparent',
      color: active ? 'var(--color-system-blue)' : 'var(--color-text-secondary)',
      fontSize: 13,
      fontWeight: active ? 600 : 500,
      transition: 'background var(--motion-fast), color var(--motion-fast)'
    }
  }, item.icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14,
      height: 14,
      display: 'inline-flex',
      flexShrink: 0
    }
  }, item.icon) : null, item.label);
}
Object.assign(__ds_scope, { SettingsPageHeader, SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/SettingsPageHeader.jsx", error: String((e && e.message) || e) }); }

// components/patterns/SummaryCard.jsx
try { (() => {
function SummaryCard({
  title,
  meta,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 6,
      padding: 12,
      border: '1px solid var(--color-separator)',
      borderRadius: 'var(--radius-lg)',
      background: 'transparent',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 'var(--line-height-tight)',
      color: 'var(--color-text-primary)'
    }
  }, title), meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      fontSize: 10,
      lineHeight: 1,
      color: 'var(--color-text-muted)'
    }
  }, meta) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4,
      minWidth: 0,
      fontSize: 10,
      lineHeight: 'var(--line-height-normal)',
      color: 'var(--color-text-secondary)'
    }
  }, children));
}
function MetaPair({
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--color-text-primary)',
      fontVariantNumeric: 'tabular-nums',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, value));
}
Object.assign(__ds_scope, { SummaryCard, MetaPair });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/patterns/SummaryCard.jsx", error: String((e && e.message) || e) }); }

// components/primitives/ColorField.jsx
try { (() => {
function ColorField({
  value = '#0A84FF',
  onChange,
  swatches,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      width: 30,
      height: 30,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border-control)',
      background: value,
      cursor: 'pointer',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "color",
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    style: {
      position: 'absolute',
      inset: 0,
      opacity: 0,
      cursor: 'pointer'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--color-text-secondary)'
    }
  }, label || value.toUpperCase()), swatches ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: 4,
      marginLeft: 4
    }
  }, swatches.map(s => /*#__PURE__*/React.createElement("button", {
    key: s,
    type: "button",
    onClick: () => onChange && onChange(s),
    "aria-label": s,
    style: {
      width: 18,
      height: 18,
      padding: 0,
      borderRadius: 'var(--radius-sm)',
      background: s,
      cursor: 'pointer',
      border: '1px solid ' + (s.toLowerCase() === value.toLowerCase() ? 'var(--color-system-blue)' : 'var(--color-separator)')
    }
  }))) : null);
}
Object.assign(__ds_scope, { ColorField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/ColorField.jsx", error: String((e && e.message) || e) }); }

// components/primitives/Divider.jsx
try { (() => {
function Divider({
  label,
  orientation = 'horizontal',
  style
}) {
  if (orientation === 'vertical') return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      alignSelf: 'stretch',
      background: 'var(--color-separator)',
      flexShrink: 0,
      ...style
    }
  });
  if (label) return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--color-separator)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--color-separator)'
    }
  }));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--color-separator)',
      ...style
    }
  });
}
Object.assign(__ds_scope, { Divider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/Divider.jsx", error: String((e && e.message) || e) }); }

// components/primitives/Eyebrow.jsx
try { (() => {
function Eyebrow({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      lineHeight: 1,
      color: 'var(--color-text-disabled)',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/primitives/Field.jsx
try { (() => {
function Field({
  label,
  hint,
  error,
  required = false,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, label ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 650,
      letterSpacing: '0.01em',
      color: 'var(--color-text-secondary)'
    }
  }, label), required ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--color-danger)'
    }
  }, "*") : null) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, children), error ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--color-danger)',
      lineHeight: 'var(--line-height-normal)'
    }
  }, error) : null, !error && hint ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)',
      lineHeight: 'var(--line-height-normal)'
    }
  }, hint) : null);
}
function FieldGrid({
  columns = 2,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))',
      gap: 12,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Field, FieldGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/Field.jsx", error: String((e && e.message) || e) }); }

// components/primitives/MediaPlaceholder.jsx
try { (() => {
function MediaPlaceholder({
  label,
  ratio = '16 / 9',
  icon,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 6,
      aspectRatio: ratio,
      width: '100%',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)',
      background: 'var(--color-preview-bg)',
      color: 'var(--color-text-quaternary)',
      ...style
    }
  }, icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18
    }
  }, icon) : null, label ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase'
    }
  }, label) : null);
}
Object.assign(__ds_scope, { MediaPlaceholder });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/MediaPlaceholder.jsx", error: String((e && e.message) || e) }); }

// components/primitives/NumberField.jsx
try { (() => {
function NumberField({
  value = 0,
  min,
  max,
  step = 1,
  unit,
  onChange,
  disabled,
  width = 96
}) {
  const clamp = n => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      width,
      height: 30,
      padding: '0 6px 0 10px',
      gap: 4,
      borderRadius: 'var(--radius-lg)',
      border: '1px solid ' + (focus ? 'var(--color-system-blue)' : 'var(--color-border-control)'),
      background: 'var(--color-panel-elevated)',
      opacity: disabled ? 0.5 : 1,
      boxShadow: focus ? '0 0 0 3px rgba(10,132,255,0.2)' : 'none',
      transition: 'border-color var(--motion-fast), box-shadow var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "text",
    value: value,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onChange: e => {
      const n = Number(e.target.value);
      if (!Number.isNaN(n)) onChange && onChange(clamp(n));
    },
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      background: 'transparent',
      color: 'var(--color-text-primary)',
      fontSize: 12,
      fontVariantNumeric: 'tabular-nums',
      outline: 'none'
    }
  }), unit ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)'
    }
  }, unit) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, /*#__PURE__*/React.createElement(Stepper, {
    dir: "up",
    onClick: () => !disabled && onChange && onChange(clamp(Number(value) + step))
  }), /*#__PURE__*/React.createElement(Stepper, {
    dir: "down",
    onClick: () => !disabled && onChange && onChange(clamp(Number(value) - step))
  })));
}
function Stepper({
  dir,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    "aria-label": dir,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 14,
      height: 10,
      padding: 0,
      border: 'none',
      borderRadius: 3,
      cursor: 'pointer',
      background: hover ? 'var(--color-bg-hover)' : 'transparent',
      color: 'var(--color-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "8",
    height: "8",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, dir === 'up' ? /*#__PURE__*/React.createElement("path", {
    d: "m18 15-6-6-6 6"
  }) : /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  })));
}
Object.assign(__ds_scope, { NumberField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/NumberField.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop-app/Icon.jsx
try { (() => {
// Lucide icon wrapper — the app uses lucide-react throughout; here we load lucide from CDN.
function Icon({
  name,
  size = 14,
  color = 'currentColor',
  strokeWidth = 2
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const host = ref.current;
    if (!host || !window.lucide) return;
    host.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    host.appendChild(i);
    window.lucide.createIcons({
      attrs: {
        width: size,
        height: size,
        'stroke-width': strokeWidth
      },
      nameAttr: 'data-lucide'
    });
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      color,
      flexShrink: 0
    }
  });
}

// Workspace tabs — 32px bar, active tab is a 10% white chip with a blue underline.
function WorkspaceTabs({
  value,
  onChange,
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 32,
      padding: '0 16px',
      gap: 2,
      background: 'var(--color-panel-bg)',
      borderBottom: '1px solid var(--color-separator)',
      flexShrink: 0,
      userSelect: 'none'
    }
  }, items.map((it, idx) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: it.value
  }, it.separator ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 14,
      margin: '0 4px',
      background: 'var(--color-separator)'
    }
  }) : null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => onChange(it.value),
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 26,
      padding: '0 12px',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      transition: 'background var(--motion-fast), color var(--motion-fast)',
      background: it.value === value ? 'rgba(255,255,255,0.1)' : 'transparent',
      color: it.value === value ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: it.icon,
    size: 14
  }), it.label, it.dot ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: 'var(--color-system-blue)'
    }
  }) : null, it.value === value ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: -3,
      left: 8,
      right: 8,
      height: 2,
      background: 'var(--color-brand-accent)'
    }
  }) : null))));
}

// Left / right panel scaffold: fixed width, hairline border, panel background.
function SidePanel({
  width,
  side = 'left',
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      background: 'var(--color-panel-bg)',
      [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--color-separator)',
      ...style
    }
  }, children);
}
function PanelSection({
  title,
  actions,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 12,
      borderBottom: '1px solid var(--color-separator)',
      ...style
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--color-text-primary)'
    }
  }, title), actions) : null, children);
}
Object.assign(window, {
  Icon,
  WorkspaceTabs,
  SidePanel,
  PanelSection
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop-app/Icon.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop-app/ScriptWorkbench.jsx
try { (() => {
const {
  Button,
  Badge,
  PillGroup,
  Select,
  Input,
  Divider,
  ActionBar,
  Eyebrow
} = window.DesignSystem_83d2b2;
const SCRIPT = ['# 存储芯片量价齐升，这波行情能走多远？', '', '你好，欢迎回到一叶知秋。今天我们聊存储。', '', '三星单季利润暴增 755%，香农芯创净利飙升 87 倍。这不是行业景气，这是产业底层逻辑正在发生断裂式重构。', '', '## 一、量价齐升到底在讲什么', '', '过去两年，存储行业最大的变量不是需求回暖，而是 HBM 把先进产能吃掉了一大块。当 AI 服务器抢走晶圆，通用 DRAM 的供给天然就紧张。', '', '所以你看到的价格上涨，本质是产能结构的重新分配，而不是简单的周期反弹。', '', '## 二、行情是昙花一现，还是 AI 长期红利', '', '我的判断是：这一轮里，龙头拿到的是结构性红利，二三线拿到的是价格红利。前者可持续，后者不可持续。'];
function FileTab({
  name,
  active,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      height: 34,
      padding: '0 12px',
      border: 'none',
      borderBottom: '2px solid ' + (active ? 'var(--color-system-blue)' : 'transparent'),
      background: 'transparent',
      cursor: 'pointer',
      fontSize: 12,
      color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14,
    color: active ? 'var(--color-system-blue)' : 'currentColor'
  }), name, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 12
  }));
}
function FileRow({
  title,
  file,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      cursor: 'pointer',
      borderBottom: '1px solid var(--color-separator)',
      background: active ? 'var(--color-bg-hover)' : hover ? 'var(--color-bg-subtle)' : 'transparent',
      transition: 'background var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14,
    color: "var(--color-text-tertiary)"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--color-text-primary)'
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-muted)',
      fontFamily: 'var(--font-mono)'
    }
  }, file)));
}
function ScriptWorkbench({
  onGenerateVideo
}) {
  const [tab, setTab] = React.useState('script.md');
  const [scope, setScope] = React.useState('drafts');
  const [pending, setPending] = React.useState(2);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(SidePanel, {
    width: 332
  }, /*#__PURE__*/React.createElement(PanelSection, {
    title: "\u5DE5\u4F5C\u6587\u4EF6",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "xs",
      variant: "secondary"
    }, "\u66F4\u6362\u76EE\u5F55")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 0'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder-open",
    size: 14,
    color: "var(--color-text-tertiary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--color-text-primary)'
    }
  }, "04-19-AI\u79D1\u6280\u4E3B\u7EBF\u6295\u8D44\u903B\u8F91")), /*#__PURE__*/React.createElement(PillGroup, {
    fullWidth: true,
    value: scope,
    onChange: setScope,
    items: [{
      value: 'all',
      label: '全部文件'
    }, {
      value: 'drafts',
      label: '稿件资源'
    }]
  }), /*#__PURE__*/React.createElement(Input, {
    placeholder: "\u641C\u7D22\u7A3F\u4EF6...",
    size: "sm",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 13
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 12px 6px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "\u539F\u59CB\u6587\u7A3F"), /*#__PURE__*/React.createElement(Badge, {
    size: "xs",
    variant: "secondary"
  }, "1")), /*#__PURE__*/React.createElement(FileRow, {
    title: "\u539F\u59CB\u6587\u7A3F",
    file: "original.md",
    active: tab === 'original.md',
    onClick: () => setTab('original.md')
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 12px 6px'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "\u53E3\u64AD\u811A\u672C"), /*#__PURE__*/React.createElement(Badge, {
    size: "xs",
    variant: "secondary"
  }, "1")), /*#__PURE__*/React.createElement(FileRow, {
    title: "\u53E3\u64AD\u811A\u672C",
    file: "script.md",
    active: tab === 'script.md',
    onClick: () => setTab('script.md')
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 12px',
      borderBottom: '1px solid var(--color-separator)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(FileTab, {
    name: "original.md",
    active: tab === 'original.md',
    onClick: () => setTab('original.md')
  }), /*#__PURE__*/React.createElement(FileTab, {
    name: "script.md",
    active: tab === 'script.md',
    onClick: () => setTab('script.md')
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "history",
      size: 13
    }),
    rightIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-down",
      size: 12
    })
  }, "\u5386\u53F2\u7248\u672C")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement(ActionBar, {
    start: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 600
      }
    }, "\u5BA1\u67E5\u53D1\u73B0\u95EE\u9898"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--color-text-muted)'
      }
    }, "\u5F53\u524D\u9636\u6BB5: \u5BA1\u67E5\u6709\u95EE\u9898\uFF08\u81EA\u52A8\uFF09")), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 200
      }
    }, /*#__PURE__*/React.createElement(Select, {
      value: "auto",
      options: [{
        value: 'auto',
        label: '自动判断'
      }, {
        value: 'manual',
        label: '人工确认'
      }]
    }))),
    end: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      leftIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "user",
        size: 13
      }),
      rightIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "chevron-down",
        size: 12
      })
    }, "\u4E00\u53F6\u77E5\u79CB"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      rightIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "chevron-down",
        size: 12
      })
    }, "Qwen / qwen3.6-plus"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: () => setPending(0)
    }, "\u5168\u90E8\u63A5\u53D7\u5EFA\u8BAE"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      leftIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "search",
        size: 13
      })
    }, "\u91CD\u65B0\u5BA1\u67E5"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      leftIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "refresh-cw",
        size: 13
      })
    }, "\u91CD\u65B0\u751F\u6210"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      leftIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "copy",
        size: 13
      })
    }, "\u590D\u5236\u53E3\u64AD\u7A3F"))
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    size: "sm",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "film",
      size: 13
    }),
    onClick: onGenerateVideo
  }, "\u751F\u6210\u89C6\u9891"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '16px 24px',
      background: 'var(--color-window-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 880,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.75,
      color: 'var(--color-text-secondary)',
      whiteSpace: 'pre-wrap'
    }
  }, SCRIPT.map((line, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      color: line.startsWith('#') ? 'var(--color-text-primary)' : undefined,
      fontWeight: line.startsWith('#') ? 600 : 400,
      background: i === 8 && pending > 0 ? 'rgba(255,214,10,0.08)' : 'transparent'
    }
  }, line || '\u00a0')))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderTop: '1px solid var(--color-separator)',
      background: 'var(--color-panel-bg)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-up",
    size: 13,
    color: "var(--color-text-tertiary)"
  }), /*#__PURE__*/React.createElement(Badge, {
    color: "#FFD60A"
  }, pending, " \u5F85\u5904\u7406"), /*#__PURE__*/React.createElement(Badge, {
    variant: "secondary"
  }, "2 \u5FFD\u7565"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-muted)'
    }
  }, "/ 4 \u6761\u6279\u6CE8"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 13
    }),
    onClick: () => setPending(0)
  }, "\u5168\u90E8\u5FFD\u7565"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 13
    }),
    onClick: () => setPending(0)
  }, "\u5168\u90E8\u91C7\u7EB3")))));
}
Object.assign(window, {
  ScriptWorkbench
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop-app/ScriptWorkbench.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop-app/SettingsScreen.jsx
try { (() => {
const {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Divider,
  SidebarNav,
  SettingsPageHeader,
  Field,
  FieldGrid,
  Input,
  Select,
  Switch,
  Eyebrow
} = window.DesignSystem_83d2b2;
const NAV = [{
  value: 'ai',
  label: 'AI 基础配置',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "bot",
    size: 14
  })
}, {
  value: 'templates',
  label: '口播模板管理',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14
  })
}, {
  value: 'tts',
  label: 'TTS 语音合成',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "volume-2",
    size: 14
  })
}, {
  value: 'agent',
  label: 'AI Agent',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "cpu",
    size: 14
  })
}, {
  value: 'mcp',
  label: 'MCP 服务',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "server",
    size: 14
  })
}, {
  value: 'prompts',
  label: '提示词配置',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14
  })
}, {
  value: 'backup',
  label: '配置备份',
  icon: /*#__PURE__*/React.createElement(Icon, {
    name: "database",
    size: 14
  })
}];
function ProviderCard({
  name,
  url,
  models,
  isDefault,
  onTest
}) {
  return /*#__PURE__*/React.createElement(Card, {
    style: {
      background: 'var(--color-panel-elevated)'
    }
  }, /*#__PURE__*/React.createElement(CardContent, {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, name), isDefault ? /*#__PURE__*/React.createElement(Badge, {
    variant: "info"
  }, "\u9ED8\u8BA4") : null, /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 6
    }
  }, onTest ? /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    onClick: onTest
  }, "\u6D4B\u8BD5") : null, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "\u7F16\u8F91"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "destructive"
  }, "\u5220\u9664"))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--color-text-secondary)',
      wordBreak: 'break-all'
    }
  }, url), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, models.map(m => /*#__PURE__*/React.createElement(Badge, {
    key: m,
    size: "xs",
    variant: "secondary"
  }, m)))));
}
function SettingsScreen({
  onBack
}) {
  const [tab, setTab] = React.useState('ai');
  const [notify, setNotify] = React.useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(SidebarNav, {
    title: "\u7CFB\u7EDF\u8BBE\u7F6E",
    onBack: onBack,
    items: NAV,
    value: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      overflowY: 'auto',
      padding: '24px 32px'
    }
  }, tab === 'ai' ? /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 940,
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(SettingsPageHeader, {
    title: "AI \u57FA\u7840\u914D\u7F6E",
    description: "\u914D\u7F6E OpenAI \u517C\u5BB9\u63A5\u53E3\u4E0E\u5C01\u9762\u56FE\u50CF\u751F\u6210\u670D\u52A1"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "LLM Providers"), /*#__PURE__*/React.createElement(ProviderCard, {
    name: "Qwen",
    isDefault: true,
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ['qwen3.6-plus', 'qwen3-max']
  }), /*#__PURE__*/React.createElement(ProviderCard, {
    name: "\u706B\u5C71\u65B9\u821F",
    url: "https://ark.cn-beijing.volces.com/api/v3",
    models: ['doubao-seed-1.6']
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 13
    })
  }, "\u6DFB\u52A0 Provider"))), /*#__PURE__*/React.createElement(Divider, {
    label: "\u5C01\u9762\u56FE\u50CF\u751F\u6210"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "Image Providers"), /*#__PURE__*/React.createElement(ProviderCard, {
    name: "\u5373\u68A6",
    isDefault: true,
    url: "\u652F\u6301 1:1 / 16:9 / 9:16 / 4:3 / 3:4\uFF1B\u6700\u5927\u6279\u91CF 4",
    models: ['jimeng-5.0'],
    onTest: true
  })), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement(FieldGrid, {
    columns: 2
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u9ED8\u8BA4\u6A21\u578B",
    hint: "\u6B65\u9AA4\u7EA7\u7ED1\u5B9A\u53EF\u5728\u63D0\u793A\u8BCD\u914D\u7F6E\u4E2D\u8986\u76D6"
  }, /*#__PURE__*/React.createElement(Select, {
    value: "qwen3.6-plus",
    options: [{
      value: 'qwen3.6-plus',
      label: 'Qwen / qwen3.6-plus'
    }, {
      value: 'doubao',
      label: '火山方舟 / doubao-seed-1.6'
    }]
  })), /*#__PURE__*/React.createElement(Field, {
    label: "\u8BF7\u6C42\u8D85\u65F6",
    hint: "\u79D2"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "120"
  }))), /*#__PURE__*/React.createElement(Switch, {
    label: "\u957F\u8017\u65F6\u4EFB\u52A1\u5B8C\u6210\u540E\u53D1\u9001\u7CFB\u7EDF\u901A\u77E5",
    checked: notify,
    onChange: setNotify
  })) : /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 940,
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(SettingsPageHeader, {
    title: NAV.find(n => n.value === tab).label,
    description: "\u6B64\u754C\u9762\u5728\u6E90\u5DE5\u7A0B\u4E2D\u5B58\u5728\uFF0C\u672C UI Kit \u672A\u590D\u523B\u5176\u5185\u90E8\u7EC6\u8282\u3002"
  }), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(CardContent, null, /*#__PURE__*/React.createElement(CardDescription, null, "\u53C2\u8003 src/pages/Settings.tsx \u4E0E\u5BF9\u5E94\u7684 settings/ \u5B50\u7EC4\u4EF6\u5B9E\u73B0\u3002"))))));
}
Object.assign(window, {
  SettingsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop-app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop-app/VideoEditor.jsx
try { (() => {
const {
  Button,
  Badge,
  PillGroup,
  Tabs,
  Input,
  Slider,
  SummaryCard,
  MetaPair,
  PanelHeader,
  Divider,
  MediaPlaceholder,
  StepIndicator
} = window.DesignSystem_83d2b2;
const ASSETS = [{
  name: 'podcast-audio.mp3',
  kind: 'audio'
}, {
  name: 'podcast-subtitles.srt',
  kind: 'text'
}, {
  name: 'cover-6724eb6…',
  kind: 'image',
  src: '../../assets/lingji-cut-hero.png'
}, {
  name: 'end片段.mp4',
  kind: 'video'
}, {
  name: 'cover-0b718fc2…',
  kind: 'image',
  src: '../../assets/lingji-cut-hero.png'
}, {
  name: 'cover-1b9aac48…',
  kind: 'image',
  src: '../../assets/lingji-cut-hero.png'
}];
function AssetTile({
  asset
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      aspectRatio: '1 / 1',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      background: asset.kind === 'audio' ? '#7a5a10' : 'var(--color-preview-bg)',
      border: '1px solid ' + (hover ? 'var(--color-system-blue)' : 'var(--color-separator)'),
      cursor: 'pointer',
      transition: 'border-color var(--motion-fast)'
    }
  }, asset.src ? /*#__PURE__*/React.createElement("img", {
    src: asset.src,
    alt: "",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: asset.kind === 'audio' ? '#FF9F0A' : 'var(--color-system-blue)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: asset.kind === 'audio' ? 'music' : asset.kind === 'text' ? 'file-text' : 'play',
    size: 26
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: '4px 6px',
      fontSize: 10,
      color: 'var(--color-text-secondary)',
      background: 'linear-gradient(to top, rgba(0,0,0,0.72), transparent)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, asset.name));
}
function TimelineTrack({
  label,
  tag,
  color,
  width,
  offset = 0,
  locked,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 34,
      borderBottom: '1px solid rgba(255,255,255,0.04)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      flexShrink: 0,
      display: 'flex',
      justifyContent: 'center',
      color: 'var(--color-text-quaternary)'
    }
  }, locked ? /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 12
  }) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 5,
      bottom: 5,
      left: offset + '%',
      width: width + '%',
      borderRadius: 4,
      background: color,
      border: '1px solid rgba(255,255,255,0.10)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '0 8px',
      overflow: 'hidden'
    }
  }, tag ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.04em',
      color: 'var(--color-text-primary)',
      opacity: 0.9
    }
  }, tag) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, label), children)));
}
function VideoEditor() {
  const [panel, setPanel] = React.useState('assets');
  const [kind, setKind] = React.useState('all');
  const [playing, setPlaying] = React.useState(false);
  const [t, setT] = React.useState(0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement(SidePanel, {
    width: 300
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: panel,
    onChange: setPanel,
    items: [{
      value: 'assets',
      label: '素材',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "folder",
        size: 13
      })
    }, {
      value: 'ai',
      label: 'AI 助手',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "sparkles",
        size: 13
      })
    }]
  })), panel === 'assets' ? /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement(PanelSection, {
    title: "\u53E3\u64AD\u8D44\u6E90"
  }, /*#__PURE__*/React.createElement(Row, {
    name: "podcast-audio.mp3",
    icon: "music",
    action: "\u66FF\u6362\u97F3\u9891"
  }), /*#__PURE__*/React.createElement(Row, {
    name: "podcast-subtitles.srt",
    icon: "file-text",
    action: "\u66FF\u6362\u5B57\u5E55"
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    fullWidth: true,
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 13
    })
  }, "\u4ECE\u6587\u7A3F\u91CD\u65B0\u751F\u6210")), /*#__PURE__*/React.createElement(PanelSection, null, /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    placeholder: "\u641C\u7D22\u7D20\u6750...",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 13
    })
  }), /*#__PURE__*/React.createElement(PillGroup, {
    size: "sm",
    fullWidth: true,
    value: kind,
    onChange: setKind,
    items: [{
      value: 'all',
      label: '全部'
    }, {
      value: 'video',
      label: '视频'
    }, {
      value: 'audio',
      label: '音频'
    }, {
      value: 'text',
      label: '文字'
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 8
    }
  }, ASSETS.map(a => /*#__PURE__*/React.createElement(AssetTile, {
    key: a.name,
    asset: a
  }))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StepIndicator, {
    steps: [{
      label: 'TTS',
      status: 'completed'
    }, {
      label: '字幕',
      status: 'completed'
    }, {
      label: '内容分析',
      status: 'active'
    }, {
      label: '封面',
      status: 'pending'
    }]
  }), /*#__PURE__*/React.createElement(PanelHeader, {
    title: "AI \u4E00\u952E\u526A\u8F91",
    description: "\u4ECE\u53E3\u64AD\u7A3F\u751F\u6210\u5206\u955C\u3001\u4FE1\u606F\u5361\u4E0E\u5C01\u9762\u5019\u9009\uFF0C\u9010\u6B65\u6D41\u5F0F\u5199\u5165\u65F6\u95F4\u7EBF\u3002",
    style: {
      padding: 0
    }
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary",
    fullWidth: true,
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "wand-sparkles",
      size: 13
    })
  }, "\u5F00\u59CB\u4E00\u952E\u526A\u8F91"), /*#__PURE__*/React.createElement(Divider, {
    label: "\u5185\u5BB9\u5361\u7247"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, ['业绩狂飙背后的时代叩问', '量价齐升在讲什么', '结构性红利 vs 价格红利'].map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 10px',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)',
      background: 'var(--color-panel-elevated)'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    size: "xs",
    variant: "info"
  }, "AI"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-primary)',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, c), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontSize: 10,
      color: 'var(--color-text-muted)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "0", i + 1)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-window-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 16px',
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-secondary)'
    }
  }, "\u9884\u89C8"), /*#__PURE__*/React.createElement(Badge, {
    variant: "secondary"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "monitor",
    size: 11
  }), " 1920\xD71080")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'var(--color-preview-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 720,
      aspectRatio: '16 / 9',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)',
      background: 'linear-gradient(160deg, #16233a 0%, #0f1726 60%, #0b1220 100%)',
      padding: '32px 40px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 26,
      fontWeight: 700,
      color: '#4DA3FF',
      marginBottom: 20
    }
  }, "\u4E1A\u7EE9\u72C2\u98D9\u80CC\u540E\u7684\u65F6\u4EE3\u53E9\u95EE"), /*#__PURE__*/React.createElement("ul", {
    style: {
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, ['三星单季利润暴增755%，香农芯创净利飙升87倍', '科技产业底层逻辑正发生断裂式重构', '行情是昙花一现的周期躁动，还是AI长期红利？', '当下入场是搭上时代电梯，还是高位站岗？'].map(li => /*#__PURE__*/React.createElement("li", {
    key: li,
    style: {
      display: 'flex',
      gap: 10,
      fontSize: 15,
      color: '#E8EEF7'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#4DA3FF'
    }
  }, "\u2022"), li)))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      color: '#9FB2CC'
    }
  }, "2026\u5E744\u670815\u65E5"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '10px 16px',
      borderTop: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 150
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "volume-2",
    size: 14,
    color: "var(--color-text-secondary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-secondary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, String(Math.floor(t / 60)).padStart(2, '0'), ":", String(t % 60).padStart(2, '0'), " / 08:14")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    iconOnly: true,
    title: "\u4E0A\u4E00\u6BB5",
    onClick: () => setT(0)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "skip-back",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setPlaying(p => !p),
    title: playing ? '暂停' : '播放',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 38,
      height: 38,
      borderRadius: '50%',
      border: '1px solid var(--color-border-control)',
      background: 'var(--color-panel-elevated)',
      color: 'var(--color-text-primary)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: playing ? 'pause' : 'play',
    size: 16
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    iconOnly: true,
    title: "\u4E0B\u4E00\u6BB5",
    onClick: () => setT(494)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "skip-forward",
    size: 14
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      minWidth: 150,
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost"
  }, "1\xD7"), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "maximize-2",
    size: 13
  }))))), /*#__PURE__*/React.createElement(SidePanel, {
    width: 300,
    side: "right"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-secondary)'
    }
  }, "\u9879\u76EE\u6982\u89C8")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(PanelHeader, {
    title: "\u9879\u76EE\u6982\u89C8",
    meta: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: 'var(--color-text-muted)'
      }
    }, "\u5168\u5C40\u9762\u677F")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      lineHeight: 1.4
    }
  }, "\u5B58\u50A8\u82AF\u7247\u91CF\u4EF7\u9F50\u5347\uFF0C\u8FD9\u6CE2\u884C\u60C5\u80FD\u8D70\u591A\u8FDC\uFF1F #\u8D22\u7ECF\u4E8B\u4EF6\u8FFD\u8E2A #\u6295\u8D44\u6709\u98CE\u9669\u7406\u8D22\u9700\u8C28\u614E"), /*#__PURE__*/React.createElement("img", {
    src: "../../assets/lingji-cut-hero.png",
    alt: "",
    style: {
      width: '100%',
      aspectRatio: '16 / 9',
      objectFit: 'cover',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-separator)'
    }
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--color-text-muted)',
      marginBottom: 4
    }
  }, "\u9879\u76EE\u8DEF\u5F84"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      color: 'var(--color-text-secondary)',
      wordBreak: 'break-all'
    }
  }, "/Users/yoqu/Documents/self-boke/2026-04/\u5B58\u50A8\u82AF\u7247\u91CF\u4EF7\u9F50\u5347")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u76EE\u5F55\u5927\u5C0F",
    value: "99.0 MB"
  }), /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u521B\u5EFA\u65F6\u95F4",
    value: "2026-04-15 11:36"
  }), /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u5206\u8FA8\u7387",
    value: "1920 \xD7 1080"
  }), /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u5E27\u7387",
    value: "30 fps"
  }), /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u7D20\u6750\u6570\u91CF",
    value: "9"
  }), /*#__PURE__*/React.createElement(MetaPair, {
    label: "\u56FE\u5C42\u6570\u91CF",
    value: "9"
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 264,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      borderTop: '1px solid var(--color-separator)',
      background: 'var(--color-timeline-bg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      height: 36,
      padding: '0 12px',
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true,
    title: "\u64A4\u9500"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "undo-2",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true,
    title: "\u91CD\u505A"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "redo-2",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true,
    title: "\u6DFB\u52A0"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true,
    title: "\u62C6\u5206"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "scissors",
    size: 13
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "accent",
    iconOnly: true,
    title: "\u5438\u9644"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "magnet",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "minus",
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "100%"), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 13
  })), /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ghost",
    iconOnly: true
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "maximize-2",
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary)'
    }
  }, "1:1"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      height: 24,
      borderBottom: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 34,
      flexShrink: 0,
      fontSize: 10,
      color: 'var(--color-text-muted)',
      textAlign: 'center'
    }
  }, "\u8F68\u9053"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      height: '100%',
      overflow: 'hidden'
    }
  }, Array.from({
    length: 19
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: 'absolute',
      left: i * 5.2 + '%',
      top: 0,
      bottom: 0,
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      paddingLeft: 4,
      fontSize: 9,
      color: 'var(--color-text-quaternary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, "00:", String(i).padStart(2, '0'))), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: -1000,
      width: 2,
      background: 'var(--color-system-blue)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement(TimelineTrack, {
    label: "\u4F60\u597D\uFF0C\u6B22\u8FCE\u56DE\u5230\u4E00\u53F6\u77E5\u79CB\u2026",
    color: "var(--color-track-subtitle)",
    width: 22,
    locked: true
  }), /*#__PURE__*/React.createElement(TimelineTrack, {
    label: "2026\u5E744\u670815\u65E5",
    tag: "TXT",
    color: "var(--color-track-secondary)",
    width: 97
  }), /*#__PURE__*/React.createElement(TimelineTrack, {
    label: "\u4E1A\u7EE9\u72C2\u98D9\u80CC\u540E\u7684\u65F6\u4EE3\u53E9\u95EE",
    tag: "AI",
    color: "var(--color-track-primary)",
    width: 97
  }), /*#__PURE__*/React.createElement(TimelineTrack, {
    label: "\u9ED8\u8BA4\u80CC\u666F \xB7 cover-6724eb64-f111-47dd-ace1-9f7f24d38d3c.png",
    tag: "BG",
    color: "var(--color-track-audio)",
    width: 62
  }))));
}
function Row({
  name,
  icon,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 0'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 13,
    color: "var(--color-text-tertiary)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--color-text-primary)',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "secondary"
  }, action)));
}
Object.assign(window, {
  VideoEditor
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop-app/VideoEditor.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop-app/WelcomeScreen.jsx
try { (() => {
const {
  Button,
  Badge,
  PillGroup,
  Eyebrow,
  Table
} = window.DesignSystem_83d2b2;
const DRAFTS = [{
  name: '04-19-AI科技主线投资逻辑',
  created: '昨天',
  updated: '昨天',
  desc: '04-19-AI科技主线投资逻辑',
  cover: null
}, {
  name: '04-17',
  created: '周五',
  updated: '周六',
  desc: '04-17',
  cover: null
}, {
  name: '说说美伊战争对长期战略投资的影响…',
  created: '4月11日',
  updated: '周五',
  desc: '说说美伊战争对长期战略投资的影响（比亚迪、黄…',
  cover: '../../assets/screenshots/sonar-workbench.png'
}, {
  name: '存储芯片量价齐升，这波行情能走多…',
  created: '周三',
  updated: '周五',
  desc: '存储芯片量价齐升，这波行情能走多远？ #财经事…',
  cover: '../../assets/lingji-cut-hero.png'
}, {
  name: '《预见》第107集，内存涨价结束了…',
  created: '周三',
  updated: '周三',
  desc: '《预见》第107集，内存涨价结束了吗？《预见》…',
  cover: null
}];
function QuickAction({
  icon,
  label,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 56,
      height: 56,
      borderRadius: 'var(--radius-2xl)',
      background: hover ? 'var(--color-control-bg)' : 'var(--color-panel-elevated)',
      border: '1px solid var(--color-separator)',
      color: 'var(--color-text-primary)',
      transition: 'background var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 22
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary)'
    }
  }, label));
}
function DraftCard({
  draft,
  onOpen
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onOpen,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      background: 'var(--color-panel-elevated)',
      border: '1px solid ' + (hover ? 'var(--color-system-blue)' : 'var(--color-separator)'),
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      cursor: 'pointer',
      transform: hover ? 'translateY(-2px)' : 'none',
      boxShadow: hover ? 'var(--shadow-card)' : 'none',
      transition: 'transform var(--motion-fast), border-color var(--motion-fast), box-shadow var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%',
      paddingTop: '56.25%',
      background: 'var(--color-preview-bg)',
      overflow: 'hidden'
    }
  }, draft.cover ? /*#__PURE__*/React.createElement("img", {
    src: draft.cover,
    alt: "",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--color-system-blue)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "audio-lines",
    size: 34
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 16px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, draft.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary-strong)'
    }
  }, "\u521B\u5EFA: ", draft.created), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-secondary-strong)'
    }
  }, "\u66F4\u65B0: ", draft.updated)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--color-text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, draft.desc)));
}
function WelcomeScreen({
  onOpenProject
}) {
  const [view, setView] = React.useState('grid');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: 196,
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      border: '1px solid var(--color-separator)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/hero-bg.png",
    alt: "",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    leftIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 16
    }),
    onClick: onOpenProject,
    style: {
      background: 'rgba(28,28,30,0.72)',
      backdropFilter: 'blur(20px)'
    }
  }, "\u5F00\u59CB\u521B\u4F5C"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(QuickAction, {
    icon: "sparkles",
    label: "AI \u5199\u7A3F",
    onClick: onOpenProject
  }), /*#__PURE__*/React.createElement(QuickAction, {
    icon: "music",
    label: "\u5BFC\u5165\u97F3\u9891"
  }), /*#__PURE__*/React.createElement(QuickAction, {
    icon: "video",
    label: "\u6296\u97F3\u5BFC\u5165"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(Eyebrow, null, "\u672C\u5730\u8349\u7A3F"), /*#__PURE__*/React.createElement(PillGroup, {
    size: "sm",
    value: view,
    onChange: setView,
    items: [{
      value: 'grid',
      label: '网格',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "layout-grid",
        size: 13
      })
    }, {
      value: 'list',
      label: '列表',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "list",
        size: 13
      })
    }]
  })), view === 'grid' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 16
    }
  }, DRAFTS.map(d => /*#__PURE__*/React.createElement(DraftCard, {
    key: d.name,
    draft: d,
    onOpen: onOpenProject
  }))) : /*#__PURE__*/React.createElement(Table, {
    onRowClick: onOpenProject,
    columns: [{
      key: 'name',
      label: '工程',
      primary: true
    }, {
      key: 'created',
      label: '创建',
      width: 120
    }, {
      key: 'updated',
      label: '更新',
      width: 120
    }],
    rows: DRAFTS
  })));
}
Object.assign(window, {
  WelcomeScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop-app/WelcomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/homepage/Sections.jsx
try { (() => {
const {
  Button,
  Badge,
  Card,
  CardContent
} = window.DesignSystem_83d2b2;
const NAV = ['创作全流程', '功能特性', '宣传动画', '快速上手', '产品截图', '更新日志', '采风插件', '安装教程', '微信群'];
function Navbar() {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 50,
      background: 'var(--glass-bg)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      borderBottom: '1px solid rgba(39,39,42,0.5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1152,
      margin: '0 auto',
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color: 'var(--color-text-primary)',
      fontWeight: 600,
      fontSize: 17
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.svg",
    width: "28",
    height: "28",
    alt: ""
  }), "\u7075\u673A\u526A\u5F71"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 24
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement("a", {
    key: n,
    href: "#",
    style: {
      fontSize: 13,
      color: 'var(--color-text-secondary)'
    }
  }, n)), /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/yoqu/lingji-cut",
    style: {
      fontSize: 13,
      padding: '6px 16px',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--color-system-blue)',
      color: '#fff'
    }
  }, "GitHub"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      padding: '96px 24px 64px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(to bottom, rgba(0,122,255,0.05), transparent 60%)',
      pointerEvents: 'none'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1152,
      margin: '0 auto',
      textAlign: 'center',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 16px',
      borderRadius: 'var(--radius-pill)',
      background: 'rgba(0,122,255,0.10)',
      border: '1px solid rgba(0,122,255,0.20)',
      color: 'var(--color-system-blue)',
      fontSize: 13,
      marginBottom: 32
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--color-system-blue)'
    }
  }), "1.3.1 \u5DF2\u53D1\u5E03\uFF1A\u91C7\u98CE\u3001Agent\u3001\u53D1\u5E03\u95ED\u73AF\u5168\u9762\u5347\u7EA7"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 68,
      lineHeight: 1.1,
      fontWeight: 700,
      letterSpacing: '-0.02em'
    }
  }, "\u4ECE\u9009\u9898\u5230\u53D1\u5E03", /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: 44,
      fontWeight: 400,
      color: 'var(--color-text-secondary)',
      marginTop: 16,
      letterSpacing: 0
    }
  }, "\u4E00\u6761\u672C\u5730\u4F18\u5148\u7684 AI \u89C6\u9891\u6D41\u6C34\u7EBF")), /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: 768,
      margin: '24px auto 40px',
      fontSize: 19,
      lineHeight: 1.7,
      color: 'var(--color-text-secondary)'
    }
  }, "\u7075\u673A\u526A\u5F71\u628A Chrome \u91C7\u98CE\u3001\u7206\u6B3E\u62C6\u89E3\u3001AI \u5199\u7A3F\u3001\u5185\u7F6E Pi Agent\u3001\u4FE1\u606F\u5361\u52A8\u753B\u3001Remotion \u5BFC\u51FA\u548C\u591A\u5E73\u53F0\u53D1\u5E03\u6536\u8FDB\u4E00\u4E2A\u684C\u9762\u5DE5\u4F5C\u53F0\u3002\u7D20\u6750\u5728\u672C\u673A\uFF0C\u6D41\u7A0B\u4E0D\u65AD\u6863\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      marginBottom: 64
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/yoqu/lingji-cut/releases",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 32px',
      borderRadius: 'var(--radius-2xl)',
      background: 'var(--color-system-blue)',
      color: '#fff',
      fontWeight: 500,
      fontSize: 15
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 18
  }), "\u4E0B\u8F7D\u6700\u65B0\u7248\u672C"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 32px',
      borderRadius: 'var(--radius-2xl)',
      background: 'var(--color-panel-elevated)',
      border: '1px solid var(--color-separator)',
      color: 'var(--color-text-primary)',
      fontWeight: 500,
      fontSize: 15
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play-circle",
    size: 18
  }), "\u770B 43 \u79D2\u66F4\u65B0"), /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/yoqu/lingji-cut",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 32px',
      color: 'var(--color-text-secondary)',
      fontWeight: 500,
      fontSize: 15
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "external-link",
    size: 18
  }), "\u67E5\u770B\u6E90\u7801")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      border: '1px solid rgba(39,39,42,0.5)',
      boxShadow: 'var(--glow-blue)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/screenshots/video-workbench.png",
    alt: "\u7075\u673A\u526A\u5F71\u89C6\u9891\u7F16\u8F91\u5668",
    style: {
      width: '100%',
      display: 'block'
    }
  }))));
}
const FEATURES = [['radar', '灵机采风 Chrome 扩展', '监听抖音博主、主页滚动采集、无水印优先取流、本地转录，再把爆款拆解推送到待创作箱。'], ['pen-line', 'AI 写稿工作台', '管理 original.md 与 script.md，支持口播模板、版本历史、AI 审稿和一键重新生成。'], ['mic', '自动口播流程', '从文稿触发 TTS 语音合成、字幕解析、内容分析、封面候选和视觉卡片生成，增量流式呈现。'], ['sparkles', 'Motion Card 与逐拍动画', 'AI 生成 Remotion TSX 信息卡，并在出卡前写出动画脚本，让节奏、强调和转场更稳定。'], ['layers', '多比例封面工作台', '16:9、4:3、3:4 封面按平台取用，支持缺失比例补全、单独重生和提示词追溯。'], ['brain', '多 Provider AI 配置', '新增火山方舟、OpenAI Responses、Claude Code ACP 等 Provider，并支持默认模型和步骤级绑定。'], ['bot', '内置 Pi Agent', '开箱即用的对话 agent，零安装、复用应用 LLM 配置，直接改稿改视频，编辑器实时热重载。'], ['terminal', '命令行与自动化', '无头 lingji CLI 在终端里驱动音频、字幕分析、卡片、封面、导出等完整流水线。'], ['hard-drive', '本地优先架构', '项目、转录、摘要、配置和 Agent 编辑结果都优先保存在本机目录，数据不被平台锁死。']];
function FeatureCard({
  icon,
  title,
  desc
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      padding: 24,
      borderRadius: 'var(--radius-2xl)',
      background: 'var(--color-panel-bg)',
      border: '1px solid ' + (hover ? 'rgba(0,122,255,0.3)' : 'rgba(39,39,42,0.5)'),
      transition: 'border-color var(--motion-base), background var(--motion-base)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 'var(--radius-2xl)',
      background: hover ? 'rgba(0,122,255,0.2)' : 'rgba(0,122,255,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      color: 'var(--color-system-blue)',
      transition: 'background var(--motion-fast)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 20
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 8px',
      fontSize: 15,
      fontWeight: 600
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 13,
      lineHeight: 1.7,
      color: 'var(--color-text-secondary)'
    }
  }, desc));
}
function Features() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '96px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1152,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: 64
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 16px',
      fontSize: 38,
      fontWeight: 700
    }
  }, "1.3 \u4E4B\u540E\uFF0C\u521B\u4F5C\u94FE\u8DEF\u95ED\u73AF\u4E86"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 auto',
      maxWidth: 672,
      fontSize: 17,
      color: 'var(--color-text-secondary)'
    }
  }, "\u4E0D\u662F\u5806\u6309\u94AE\uFF0C\u800C\u662F\u628A\u9009\u9898\u3001\u5199\u7A3F\u3001\u5236\u4F5C\u3001\u5BFC\u51FA\u3001\u53D1\u5E03\u8FD9\u4E9B\u5272\u88C2\u6B65\u9AA4\u63A5\u6210\u4E00\u6761\u7EBF\u3002")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 20
    }
  }, FEATURES.map(([i, t, d]) => /*#__PURE__*/React.createElement(FeatureCard, {
    key: t,
    icon: i,
    title: t,
    desc: d
  })))));
}
const SHOTS = [['../../assets/screenshots/welcome.png', '欢迎页 · 本地草稿'], ['../../assets/screenshots/script-workbench.png', '写稿工作台'], ['../../assets/screenshots/ai-agent.png', 'AI Agent 配置'], ['../../assets/screenshots/publish-workbench.png', '一键多平台发布']];
function Screenshots() {
  const [active, setActive] = React.useState(0);
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '0 24px 96px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1152,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 32px',
      fontSize: 30,
      fontWeight: 700,
      textAlign: 'center'
    }
  }, "\u4EA7\u54C1\u622A\u56FE"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 24,
      flexWrap: 'wrap'
    }
  }, SHOTS.map(([, label], i) => /*#__PURE__*/React.createElement("button", {
    key: label,
    type: "button",
    onClick: () => setActive(i),
    style: {
      padding: '7px 16px',
      fontSize: 13,
      borderRadius: 'var(--radius-pill)',
      cursor: 'pointer',
      border: '1px solid ' + (i === active ? 'transparent' : 'var(--color-separator)'),
      background: i === active ? 'var(--color-system-blue)' : 'transparent',
      color: i === active ? '#fff' : 'var(--color-text-secondary)',
      transition: 'all var(--motion-fast)'
    }
  }, label))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      border: '1px solid rgba(39,39,42,0.5)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: SHOTS[active][0],
    alt: SHOTS[active][1],
    style: {
      width: '100%',
      display: 'block'
    }
  }))));
}
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid rgba(39,39,42,0.5)',
      padding: '48px 24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1152,
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      color: 'var(--color-text-secondary)',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.svg",
    width: "24",
    height: "24",
    alt: ""
  }), "\u7075\u673A\u526A\u5F71 \xB7 \u672C\u5730\u4F18\u5148\u7684\u5F00\u6E90 AI \u89C6\u9891\u521B\u4F5C\u5DE5\u4F5C\u53F0"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 20,
      fontSize: 13,
      color: 'var(--color-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://github.com/yoqu/lingji-cut"
  }, "GitHub"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "\u66F4\u65B0\u65E5\u5FD7"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "\u5FAE\u4FE1\u7FA4"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "\u5B89\u88C5\u6559\u7A0B"))));
}
Object.assign(window, {
  Navbar,
  Hero,
  Features,
  Screenshots,
  Footer
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/homepage/Sections.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.CloseButton = __ds_scope.CloseButton;

__ds_ns.TrafficLights = __ds_scope.TrafficLights;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.Progress = __ds_scope.Progress;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Table = __ds_scope.Table;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.StepIndicator = __ds_scope.StepIndicator;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.ToastStack = __ds_scope.ToastStack;

__ds_ns.DropdownMenu = __ds_scope.DropdownMenu;

__ds_ns.MenuItem = __ds_scope.MenuItem;

__ds_ns.MenuLabel = __ds_scope.MenuLabel;

__ds_ns.MenuSeparator = __ds_scope.MenuSeparator;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Window = __ds_scope.Window;

__ds_ns.StatusBar = __ds_scope.StatusBar;

__ds_ns.ActionBar = __ds_scope.ActionBar;

__ds_ns.ModalFooter = __ds_scope.ModalFooter;

__ds_ns.PanelHeader = __ds_scope.PanelHeader;

__ds_ns.PillGroup = __ds_scope.PillGroup;

__ds_ns.SettingsPageHeader = __ds_scope.SettingsPageHeader;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.SummaryCard = __ds_scope.SummaryCard;

__ds_ns.MetaPair = __ds_scope.MetaPair;

__ds_ns.ColorField = __ds_scope.ColorField;

__ds_ns.Divider = __ds_scope.Divider;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.FieldGrid = __ds_scope.FieldGrid;

__ds_ns.MediaPlaceholder = __ds_scope.MediaPlaceholder;

__ds_ns.NumberField = __ds_scope.NumberField;

})();
