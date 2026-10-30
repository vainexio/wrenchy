import { Fragment, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { matchScore } from '../../src/shared/search.js';

// The dashboard's building blocks: icons, buttons that show they're working, fields with hints and counters, toasts
// for every result, confirm dialogs (never the browser's), and the save bar that follows unsaved changes.

// ------------------------------------------------------------------ icons (stroke icons, 24 x 24)
const PATHS = {
  shield: 'M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6l7-3z M9 12l2 2 4-4',
  tag: 'M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9z M7.5 7.5h.01',
  megaphone: 'M4 10v4a1 1 0 001 1h2l5 4V5L7 9H5a1 1 0 00-1 1z M16 9a4 4 0 010 6 M19 6a8 8 0 010 12',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1 M9.5 10a3 3 0 100-6 3 3 0 000 6z M21 19v-1a4 4 0 00-3-3.9 M15 4.1a3 3 0 010 5.8',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12 M18 6L6 18',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 16v-4 M12 8h.01 M12 21a9 9 0 100-18 9 9 0 000 18z',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  send: 'M21 3L10 14 M21 3l-7 18-4-7-7-4 18-7z',
  refresh: 'M4 4v5h5 M20 20v-5h-5 M5.6 15a7 7 0 0011.6 2.4L20 15 M18.4 9A7 7 0 006.8 6.6L4 9',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14z M20 20l-4-4',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3 M10 16l-4-4 4-4 M6 12h10',
  game: 'M7 9v4 M5 11h4 M15 10h.01 M18 12h.01 M8 5h8a5 5 0 015 5v3a4 4 0 01-7 2.6L13 14h-2l-1 1.6A4 4 0 013 13v-3a5 5 0 015-5z',
  chat: 'M21 12a8 8 0 01-11.7 7.1L4 20l1.1-4.6A8 8 0 1121 12z',
  clock: 'M12 7v5l3 2 M12 21a9 9 0 100-18 9 9 0 000 18z',
  chevron: 'M6 9l6 6 6-6',
  userPlus: 'M15 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1 M8.5 10a3 3 0 100-6 3 3 0 000 6z M19 8v6 M16 11h6',
  pause: 'M12 21a9 9 0 100-18 9 9 0 000 18z M10 9v6 M14 9v6',
  ban: 'M12 21a9 9 0 100-18 9 9 0 000 18z M5.6 5.6l12.8 12.8',
  file: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z M14 3v5h5 M9 13h6 M9 17h6',
  undo: 'M9 14L4 9l5-5 M4 9h11a5 5 0 010 10h-3',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6z M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
};

export function Icon({ name, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {PATHS[name].split(' M').map((d, i) => (
        <path key={i} d={i ? `M${d}` : d} />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ buttons
/** A button that shows a spinner while `loading` (and can't be pressed twice). variant: primary | danger | ghost |
 *  ghost-danger | discord; size: sm; icon: an Icon name before the label. */
export function Button({ variant, size, icon, loading, className = '', children, title, ...props }) {
  const classes = ['btn', variant, size, !children && icon ? 'icon' : '', loading ? 'loading' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} aria-busy={loading || undefined} title={title} aria-label={!children ? title : undefined} {...props} disabled={props.disabled || loading}>
      {icon && <Icon name={icon} />}
      {children}
      {loading && <span className="spinner" aria-hidden="true" />}
    </button>
  );
}

export function LinkButton({ href, icon = 'external', children, size }) {
  return (
    <a className={`btn ${size ?? ''}`} href={href} target="_blank" rel="noreferrer">
      {children}
      <Icon name={icon} />
    </a>
  );
}

// ------------------------------------------------------------------ fields
const CONTROLS = new Set(['input', 'select', 'textarea']);

/** A labelled field: its label (and a live counter when `max` and `value` are given), the control, a hint or an error.
 *  A single input / select / textarea child gets an id the label points at (and the hint or error as its description). */
export function Field({ label, hint, error, max, value, className = '', children }) {
  const id = useId();
  const length = typeof value === 'string' ? value.length : null;
  const single = isValidElement(children) && CONTROLS.has(children.type);
  const control = single
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? `${id}-note` : undefined })
    : children;
  return (
    <div className={`field ${className}`}>
      {(label || max) && (
        <label className="field-label" htmlFor={single ? id : undefined}>
          <span>{label}</span>
          {max && length !== null && length > max * 0.6 && (
            <span className={`count${length > max ? ' over' : ''}`}>
              {length}/{max}
            </span>
          )}
        </label>
      )}
      {control}
      {error ? (
        <span className="field-error" id={`${id}-note`}>
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-note`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      {(label || description) && (
        <span className="toggle-text">
          {label}
          {description && <small>{description}</small>}
        </span>
      )}
    </label>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ search, pickers, filters
/** `value`, once it has stopped changing for `ms`. */
export function useDebounced(value, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** A search box with a clear button. Esc clears it; with `shortcut`, pressing / anywhere on the page focuses it. */
export function SearchInput({ value, onChange, placeholder = 'Search…', label, shortcut, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);
  return (
    <div className={`search-input ${className}`}>
      <Icon name="search" />
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

/**
 * A button that opens a floating panel under it. `trigger(props)` renders the button (spread props onto it);
 * `children(close)` the panel. Closes on Esc (focus goes back to the button) and on a click outside.
 */
export function Popover({ trigger, children, align = 'start', className = '', label }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(align);
  const box = useRef(null);
  const button = useRef(null);
  const panel = useRef(null);
  // (one that would run off the screen opens to the other side)
  useLayoutEffect(() => {
    if (!open) return setSide(align);
    const r = panel.current?.getBoundingClientRect();
    if (!r || window.innerWidth <= 600) return undefined;
    if (side === 'start' && r.right > window.innerWidth - 8) setSide('end');
    else if (side === 'end' && r.left < 8) setSide('start');
    return undefined;
  }, [open, side]);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const node = box.current;
    const onDown = (e) => !node?.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    document.addEventListener('mousedown', onDown);
    node?.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      node?.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return (
    <div className="popover-wrap" ref={box}>
      {trigger({ ref: button, onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      {open && (
        <div ref={panel} className={`popover ${side} ${className}`} role="dialog" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * A search box over a list you pick from with the keyboard (↑ ↓ Enter; Esc closes the popover around it) or the
 * mouse. items: [{ key, content, disabled?, section? }] in order; a new `section` starts a heading.
 */
export function SearchList({ query, onQuery, placeholder, items, onPick, loading, empty, footer }) {
  const id = useId();
  const listRef = useRef(null);
  const enabled = items.flatMap((it, i) => (it.disabled ? [] : [i]));
  const [active, setActive] = useState(enabled[0] ?? -1);
  const signature = items.map((it) => `${it.key}${it.disabled ? '!' : ''}`).join('|');
  useEffect(() => setActive(enabled[0] ?? -1), [signature]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const move = (step) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    setActive(enabled[(at + step + enabled.length) % enabled.length]);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active] && !items[active].disabled) onPick(items[active]);
    }
  };
  return (
    <div className="searchlist">
      <div className="search-input">
        <Icon name="search" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {loading && <span className="spinner" aria-label="Searching" />}
      </div>
      <ul className="searchlist-items" role="listbox" id={`${id}-list`} ref={listRef}>
        {items.map((it, i) => (
          <Fragment key={it.key}>
            {it.section && it.section !== items[i - 1]?.section && (
              <li className="searchlist-section" role="presentation">
                {it.section}
              </li>
            )}
            <li
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={i === active}
              aria-disabled={it.disabled || undefined}
              className={`searchlist-item${i === active ? ' active' : ''}${it.disabled ? ' disabled' : ''}`}
              onMouseMove={() => !it.disabled && i !== active && setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !it.disabled && onPick(it)}
            >
              {it.content}
            </li>
          </Fragment>
        ))}
      </ul>
      {!items.length && !loading && empty && <div className="searchlist-empty">{empty}</div>}
      {footer && <div className="searchlist-foot">{footer}</div>}
    </div>
  );
}

/**
 * A filter as a button that opens its choices: one (radio; '' = any) or several (`multi`, checkboxes). options:
 * [{ value, label, count? }]. Long lists get a search box. anyLabel null = no "any" choice (a sort order); `quiet`
 * doesn't highlight the button for having a choice.
 */
export function FilterMenu({ label, options, value, onChange, multi = false, anyLabel = 'Any', quiet = false, align }) {
  const [query, setQuery] = useState('');
  const selected = multi ? value : value ? [value] : [];
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const shown = query ? options.filter((o) => matchScore([o.label], query) !== null) : options;
  const toggle = (v) => onChange(selected.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll('.menu-item')];
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const item = (o, checked, onPick, close) => (
    <button
      key={o.value || 'any'}
      type="button"
      role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
      aria-checked={checked}
      className={`menu-item${checked ? ' checked' : ''}`}
      onClick={() => {
        onPick();
        if (!multi) close();
      }}
    >
      <span className={multi ? 'check-box' : 'check-dot'} aria-hidden="true">
        {checked && multi && <Icon name="check" />}
      </span>
      <span className="grow">{o.label}</span>
      {o.count !== undefined && <span className="menu-count">{o.count}</span>}
    </button>
  );
  return (
    <Popover
      label={label}
      align={align}
      trigger={(props) => (
        <button type="button" className={`filter-btn${quiet ? ' quiet' : selected.length ? ' on' : ''}`} {...props}>
          <span>{label}</span>
          {names.length > 0 && (
            <b>
              {names[0]}
              {names.length > 1 ? ` +${names.length - 1}` : ''}
            </b>
          )}
          <Icon name="chevron" />
        </button>
      )}
    >
      {(close) => (
        <div className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {options.length > 8 && !quiet && (
            <div className="menu-search">
              <SearchInput value={query} onChange={setQuery} placeholder={`Find a ${label.toLowerCase()}…`} />
            </div>
          )}
          <div className="menu-items">
            {!multi && !query && anyLabel !== null && item({ value: '', label: anyLabel }, !value, () => onChange(''), close)}
            {shown.map((o) => item(o, selected.includes(o.value), () => (multi ? toggle(o.value) : onChange(o.value)), close))}
            {!shown.length && <div className="searchlist-empty">Nothing called that</div>}
          </div>
          {multi && selected.length > 0 && (
            <div className="menu-foot">
              <button type="button" className="link-btn" onClick={() => onChange([])}>
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/** "Showing 12 of 80 people", each filter in use as a chip that removes it, Clear all, then `children` (sort...). */
export function FilterSummary({ shown, total, noun, chips, onClear, children }) {
  return (
    <div className="filter-summary" aria-live="polite">
      <span>
        Showing <b>{shown}</b> of {total} {noun}
      </span>
      {chips.map((c) => (
        <span key={c.key} className="chip">
          {c.label}
          <button type="button" aria-label={`Remove filter: ${c.label}`} title="Remove filter" onClick={c.onRemove}>
            ✕
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" className="link-btn" onClick={onClear}>
          Clear all
        </button>
      )}
      {children && <div className="summary-tools">{children}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ layout
export function PageHead({ title, description, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-tools">{children}</div>}
    </header>
  );
}

export function Card({ title, description, aside, footer, children, className = '', bodyClass = 'card-body' }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {children !== undefined && <div className={bodyClass}>{children}</div>}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function Badge({ tone, dot, children, title }) {
  return (
    <span className={`badge ${tone ?? ''} ${dot ? 'dot' : ''}`} title={title}>
      {children}
    </span>
  );
}

const NOTICE_ICON = { ok: 'check', error: 'alert', warn: 'alert', info: 'info' };
export function Notice({ tone = 'info', children }) {
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={NOTICE_ICON[tone]} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon = 'info', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      {title && <b>{title}</b>}
      {children && <div>{children}</div>}
    </div>
  );
}

const STARTING = /not connected|starting/i;

/**
 * A placeholder page while a tab loads: a heading and a few grey blocks, then a word if it takes long. With `error`,
 * what went wrong and Try again (by itself every few seconds while Wrenchy is still starting up) instead of loading
 * forever.
 */
export function PageSkeleton({ error, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, []);
  const starting = Boolean(error && STARTING.test(error.message));
  useEffect(() => {
    if (!starting || !onRetry) return undefined;
    const id = setTimeout(onRetry, 3000);
    return () => clearTimeout(id);
  }, [error]);
  if (error && !starting) {
    return (
      <Card>
        <Empty icon="alert" title="This page didn’t load">
          <p className="muted" style={{ margin: '0 0 12px' }}>{error.message}</p>
          {onRetry && (
            <Button icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          )}
        </Empty>
      </Card>
    );
  }
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      {(starting || slow) && (
        <Notice tone="info">
          {starting ? 'Wrenchy is still starting up. Trying again in a moment…' : 'Still loading… the first visit after Wrenchy restarts takes a little longer.'}
        </Notice>
      )}
      <div className="skeleton" style={{ height: 34, width: 260 }} />
      <div className="skeleton" style={{ height: 16, width: 420, maxWidth: '100%' }} />
      <div className="skeleton" style={{ height: 220 }} />
      <div className="skeleton" style={{ height: 140 }} />
    </div>
  );
}

/** A page's sections as tabs under its heading. tabs: [{ value, label, icon?, count? }]. */
export function Tabs({ value, onChange, tabs, label }) {
  return (
    <nav className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          className={`tab${value === t.value ? ' active' : ''}`}
          onClick={() => value !== t.value && onChange(t.value)}
        >
          {t.icon && <Icon name={t.icon} />}
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** A checkbox on its own (selecting rows). */
export function Check({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="check"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** A dialog with anything in it (a form): Esc or a click outside closes it. `actions` are its buttons. */
export function Modal({ title, children, actions, onClose }) {
  const id = useId();
  const box = useRef(null);
  useEffect(() => {
    box.current?.querySelector('textarea, input, select, button.primary, button.danger')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={box}>
        <h2 id={id}>{title}</h2>
        <div className="dialog-body">{children}</div>
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
const ToastContext = createContext(() => {});
const TOAST_ICON = { ok: 'check', error: 'alert', info: 'info' };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { id, tone: 'ok', ...toast }]);
      setTimeout(() => dismiss(id), toast.tone === 'error' ? 8000 : 4500);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            <Icon name={TOAST_ICON[t.tone]} />
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              {t.text && <div className="toast-text">{t.text}</div>}
              {t.link && (
                <a href={t.link.href} target="_blank" rel="noreferrer">
                  {t.link.label}
                </a>
              )}
            </div>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** toast({ title, text?, tone?: 'ok' | 'error' | 'info', link?: { href, label } }) */
export const useToast = () => useContext(ToastContext);

// ------------------------------------------------------------------ confirm dialogs
const ConfirmContext = createContext(async () => true);

export function ConfirmProvider({ children }) {
  const [ask, setAsk] = useState(null); // { title, text, confirmLabel, danger, resolve }
  const confirmRef = useRef(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), []);
  const close = (answer) => {
    ask?.resolve(answer);
    setAsk(null);
  };
  useEffect(() => {
    if (!ask) return undefined;
    confirmRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
            <h2 id="dialog-title">{ask.title}</h2>
            {ask.text && <p>{ask.text}</p>}
            <div className="dialog-actions">
              <Button onClick={() => close(false)}>{ask.cancelLabel ?? 'Cancel'}</Button>
              <button ref={confirmRef} type="button" className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>
                {ask.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** await confirm({ title, text?, confirmLabel?, danger? }) -> true / false */
export const useConfirm = () => useContext(ConfirmContext);

// ------------------------------------------------------------------ the save bar
/** Floats at the bottom while there are unsaved changes: Discard and Save, Ctrl/Cmd+S saves. `blocked` says why it
 *  can't be saved yet. `nudge` (a number that changes) shakes it, when someone tries to leave with unsaved changes. */
export function SaveBar({ dirty, busy, blocked, onSave, onDiscard, nudge }) {
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (!nudge) return undefined;
    setShake(true);
    const id = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(id);
  }, [nudge]);
  useEffect(() => {
    if (!dirty) return undefined;
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!busy && !blocked) onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, busy, blocked, onSave]);
  if (!dirty && !busy) return null;
  return (
    <div className={`savebar${shake ? ' shake' : ''}`} role="region" aria-label="Unsaved changes">
      <div className="savebar-text">
        <span className="status-dot" />
        <span>{blocked ?? 'You have unsaved changes'}</span>
      </div>
      <Button variant="ghost" disabled={busy} onClick={onDiscard}>
        Discard
      </Button>
      <Button variant="primary" icon="check" loading={busy} disabled={Boolean(blocked)} onClick={onSave}>
        Save changes
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ time
export function ago(date) {
  if (!date) return null;
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function day(date) {
  return date ? new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
