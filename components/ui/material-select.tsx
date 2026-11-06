"use client";

import { Check, ChevronDown } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { MATERIAL_PRESETS } from "@/lib/materials";
import type { MaterialId } from "@/lib/types";
import { FieldRow } from "./inspector";
import styles from "./material-select.module.css";

function MaterialPreview({ src }: { src: string }) {
  return (
    <span
      aria-hidden="true"
      className={styles.preview}
      style={{ "--material-preview-src": `url(${src})` } as CSSProperties}
    />
  );
}

export function MaterialSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: MaterialId) => void;
  value: MaterialId;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedMaterial =
    MATERIAL_PRESETS.find((material) => material.id === value) ?? MATERIAL_PRESETS[0];

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setIsOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <FieldRow label={label}>
      <div className={styles.root} ref={rootRef}>
        <button
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          className={styles.trigger}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <MaterialPreview src={selectedMaterial.previewSrc} />
          <span className={styles.name}>{selectedMaterial.name}</span>
          <ChevronDown
            className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ""}`}
            size={14}
          />
        </button>
        {isOpen ? (
          <div className={styles.menu} role="listbox">
            {MATERIAL_PRESETS.map((material) => {
              const selected = material.id === value;
              return (
                <button
                  aria-selected={selected}
                  className={`${styles.option} ${selected ? styles.selected : ""}`}
                  key={material.id}
                  onClick={() => {
                    onChange(material.id);
                    setIsOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <MaterialPreview src={material.previewSrc} />
                  <span className={styles.optionText}>
                    <span>{material.name}</span>
                    <small>
                      Metal {material.metalness.toFixed(2)} / Rough {material.roughness.toFixed(2)}
                    </small>
                  </span>
                  {selected ? <Check size={14} /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </FieldRow>
  );
}
