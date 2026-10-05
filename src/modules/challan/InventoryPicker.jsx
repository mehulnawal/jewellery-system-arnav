import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { auditInventorySize, discoverInventory } from "../../utils/inventoryDiscovery.js";
import { isValidSize, normalizeSize } from "../../utils/dimensions.js";
import { pieceValue } from "../../utils/pieces";
import "./inventoryPicker.css";

export default function InventoryPicker({
  value,
  inventoryId,
  inventory,
  error,
  onChange,
  onSelect,
  autoFocus,
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [highlighted, setHighlighted] = useState(0),
    [position, setPosition] = useState(null);
  const input = useRef(),
    list = useRef(),
    id = useId();
  const selected = inventory.find((row) => row.id === inventoryId);
  const { matches, counts } = useMemo(() => discoverInventory(inventory, query), [inventory, query]);
  useEffect(() => {
    if (import.meta.env.DEV && open) {
      console.info('[Inventory picker]', { query, source: counts.source, eligible: counts.eligible, matched: counts.filtered, matchedPhysicalIds: query ? matches.map(row => row.id) : [] });
      if (isValidSize(query, true)) console.info('[Inventory size audit]', auditInventorySize(inventory, query));
    }
  }, [open, query, inventory, matches, counts.source, counts.eligible, counts.filtered]);
  const active = Math.min(highlighted, Math.max(0, matches.length - 1));
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = input.current.getBoundingClientRect(),
        margin = 8;
      const below = window.innerHeight - rect.bottom - margin,
        above = rect.top - margin;
      const up = below < 230 && above > below,
        height = Math.min(330, Math.max(0, up ? above : below) - margin);
      const width = Math.min(
        Math.max(rect.width, 350),
        window.innerWidth - 2 * margin,
      );
      const next = {
        position: "fixed",
        left: Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - width - margin),
        ),
        width,
        maxHeight: height,
        ...(up
          ? { top: "auto", bottom: window.innerHeight - rect.top + 4 }
          : { bottom: "auto", top: rect.bottom + 4 }),
      };
      setPosition((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const outside = (event) => {
      if (
        !input.current?.contains(event.target) &&
        !list.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(() => {
    const target = list.current?.children[active];
    if (!open || !target) return;
    // Scroll the list itself, never scrollIntoView (which can move the form).
    const parent = list.current;
    if (target.offsetTop < parent.scrollTop)
      parent.scrollTop = target.offsetTop;
    else if (
      target.offsetTop + target.offsetHeight >
      parent.scrollTop + parent.clientHeight
    )
      parent.scrollTop =
        target.offsetTop + target.offsetHeight - parent.clientHeight;
  }, [active, open]);
  const choose = (row) => {
    if (!row) return;
    if (import.meta.env.DEV) console.info('[Inventory selection]', { physicalRecordId: row.id, sku: row.sku, rawSize: row.size });
    onSelect(row);
    setOpen(false);
  };
  const browse = () => {
    setQuery("");
    setHighlighted(0);
    setOpen(true);
  };
  return (
    <div className="sku-picker inventory-picker">
      <input
        ref={input}
        role="combobox"
        aria-label="Inventory picker"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={
          open && matches.length ? `${id}-${active}` : undefined
        }
        value={open ? query : value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder="Search SKU..."
        title="Search Size, Shape, Type or SKU"
        onFocus={browse}
        onClick={() => {
          if (!open) browse();
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) browse();
            else
              setHighlighted(
                (active +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  matches.length) %
                  (matches.length || 1),
              );
          }
          if (event.key === "Enter" && open) {
            event.preventDefault();
            choose(matches[active]);
          }
        }}
      />
      {error && <small role="alert">{error}</small>}
      {selected && (
        <small className="stock-availability">
          Avail: {Number(selected.weight || 0).toFixed(3)} ct /{" "}
          {pieceValue(selected.pieces ?? selected.quantity ?? selected.qty)} pcs
        </small>
      )}
      {open &&
        position &&
        createPortal(
          <div
            ref={list}
            id={id}
            className="sku-menu inventory-picker-popover"
            role="listbox"
            aria-label="Available Inventory"
            style={position}
          >
            {matches.length ? (
              matches.map((row, index) => (
                <button
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  key={row.id}
                  className={index === active ? "keyboard-active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(row)}
                  type="button"
                >
                  <b>{row.sku}</b>
                  <span>
                    Size {normalizeSize(row.size)} mm · {row.shape} · {row.type}
                  </span>
                  <small>
                    Available: {Number(row.weight || 0).toFixed(3)} ct ·{" "}
                    {pieceValue(row.pieces ?? row.quantity ?? row.qty)} pcs
                    {row.box ? ` · Box ${row.box}` : ""}
                  </small>
                  <small className="inventory-picker-record">
                    Record {row.id}
                  </small>
                </button>
              ))
            ) : (
              <p>{error || "No available Inventory matches this search."}</p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
