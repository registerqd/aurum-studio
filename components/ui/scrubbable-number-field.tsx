"use client";

import {
  PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "./inspector";
import styles from "./scrubbable-number-field.module.css";

function getNumericPrecision(step: number) {
  if (step >= 1) return 0;
  return step < 0.01 ? 3 : 2;
}

function formatNumericValue(value: number, step: number) {
  return Number.isFinite(value) ? value.toFixed(getNumericPrecision(step)) : "";
}

function normalizeNumericValue(value: number, step: number, min?: number, max?: number) {
  const base = typeof min === "number" ? min : 0;
  const precision = getNumericPrecision(step) + 2;
  const stepped = step > 0 ? Math.round((value - base) / step) * step + base : value;
  const aboveMin = typeof min === "number" ? Math.max(min, stepped) : stepped;
  const clamped = typeof max === "number" ? Math.min(max, aboveMin) : aboveMin;
  return Number(clamped.toFixed(precision));
}

function getNumericDragDelta(movementX: number, step: number, min?: number, max?: number) {
  if (typeof min === "number" && typeof max === "number" && max > min) {
    return (movementX / 180) * (max - min);
  }
  return movementX * step;
}

export function ScrubbableNumberField({
  max,
  min,
  onChange,
  onChangeEnd,
  onChangeStart,
  step,
  unit,
  value,
}: {
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  onChangeStart?: () => void;
  step: number;
  unit?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(() => formatNumericValue(value, step));
  const [isEditing, setIsEditing] = useState(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onChangeEndRef = useRef(onChangeEnd);
  const onChangeStartRef = useRef(onChangeStart);
  const dragCleanupRef = useRef<() => void>(() => undefined);
  const isDraggingRef = useRef(false);
  const propValueRef = useRef(value);

  useLayoutEffect(() => {
    propValueRef.current = value;
    if (!isDraggingRef.current) {
      valueRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onChangeEndRef.current = onChangeEnd;
  }, [onChangeEnd]);

  useEffect(() => {
    onChangeStartRef.current = onChangeStart;
  }, [onChangeStart]);

  useEffect(() => () => dragCleanupRef.current(), []);

  function commitDraft() {
    const nextValue = Number(draft);
    setIsEditing(false);
    if (!Number.isFinite(nextValue)) return;
    const normalized = normalizeNumericValue(nextValue, step, min, max);
    valueRef.current = normalized;
    onChangeRef.current(normalized);
    onChangeEndRef.current?.(normalized);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current();
    valueRef.current = propValueRef.current;
    isDraggingRef.current = true;
    onChangeStartRef.current?.();
    const target = event.currentTarget;
    let isActive = true;

    const cleanup = (exitPointerLock = true, commit = false) => {
      if (!isActive) return;
      isActive = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      if (exitPointerLock && document.pointerLockElement === target) document.exitPointerLock();
      dragCleanupRef.current = () => undefined;
      const finalValue = valueRef.current;
      isDraggingRef.current = false;
      if (commit) onChangeEndRef.current?.(finalValue);
      valueRef.current = propValueRef.current;
    };
    const handleMouseMove = (mouseEvent: globalThis.MouseEvent) => {
      const delta = getNumericDragDelta(mouseEvent.movementX, step, min, max);
      const nextValue = normalizeNumericValue(valueRef.current + delta, step, min, max);
      if (nextValue === valueRef.current) return;
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);
    };
    const handleMouseUp = () => cleanup(true, true);
    const handlePointerLockChange = () => {
      if (document.pointerLockElement !== target) cleanup(false, true);
    };

    dragCleanupRef.current = cleanup;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp, { once: true });
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    try {
      target.requestPointerLock();
    } catch {
      // Document-level dragging remains available when pointer lock is restricted.
    }
  }

  return (
    <span className={styles.field}>
      <button aria-label="Drag value" className={styles.dragZone} onPointerDown={startDrag} type="button" />
      <span className={styles.inputWrap}>
        <input
          className={styles.input}
          inputMode="decimal"
          onBlur={commitDraft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => {
            setDraft(formatNumericValue(valueRef.current, step));
            setIsEditing(true);
            onChangeStartRef.current?.();
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setIsEditing(false);
              event.currentTarget.blur();
            }
          }}
          spellCheck={false}
          value={isEditing ? draft : formatNumericValue(value, step)}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </span>
      <button aria-label="Drag value" className={styles.dragZone} onPointerDown={startDrag} type="button" />
    </span>
  );
}

export function NumberControl({
  label,
  max,
  min,
  onChange,
  onReset,
  step = 0.1,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  onReset?: () => void;
  step?: number;
  value: number;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.control} ${onReset ? styles.withReset : ""}`}>
        <ScrubbableNumberField max={max} min={min} onChange={onChange} step={step} value={Number.isFinite(value) ? value : 0} />
        {onReset ? (
          <Button aria-label={`Reset ${label}`} onClick={onReset} type="button" variant="icon">
            <RotateCcw size={12} />
          </Button>
        ) : null}
      </span>
    </label>
  );
}

export function RangeControl({
  label,
  max,
  min,
  onChange,
  step,
  unit = "",
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  unit?: string;
  value: number;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <ScrubbableNumberField max={max} min={min} onChange={onChange} step={step} unit={unit} value={value} />
    </label>
  );
}
