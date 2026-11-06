import type {
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import styles from "./inspector.module.css";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  fullWidth = false,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "icon";
}) {
  return (
    <button
      className={classes(
        styles.button,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        variant === "icon" && styles.icon,
        fullWidth && styles.fullWidth,
        className,
      )}
      {...props}
    />
  );
}

export function InspectorSection({
  action,
  children,
  icon,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          {icon}
          <span>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function InspectorStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

export function InspectorCard({
  children,
  title,
}: {
  children: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

export function FieldRow({
  children,
  label,
}: {
  children: ReactNode;
  label: ReactNode;
}) {
  return (
    <label className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.fieldGrid}>{children}</div>;
}

export function NumberField({
  ariaLabel,
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: {
  ariaLabel?: string;
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  value: number;
}) {
  return (
    <FieldRow label={label}>
      <span className={styles.numberField}>
        <input
          aria-label={ariaLabel}
          inputMode="decimal"
          max={max}
          min={min}
          onChange={(event) => {
            const nextValue = Number(event.target.value);

            if (Number.isFinite(nextValue)) {
              onChange(nextValue);
            }
          }}
          step={step}
          type="number"
          value={value}
        />
        {unit ? <small>{unit}</small> : null}
      </span>
    </FieldRow>
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={classes(styles.select, className)} {...props} />;
}

export function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: Array<{
    icon?: ReactNode;
    label: string;
    tooltip?: string;
    value: T;
  }>;
  value: T;
}) {
  return (
    <div
      className={styles.segmented}
      style={{ "--ds-segment-count": options.length } as CSSProperties}
    >
      {options.map((option) => (
        <button
          className={classes(
            styles.segment,
            option.value === value && styles.segmentActive,
          )}
          key={option.value}
          data-tooltip={option.tooltip}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function InspectorSummary({ children }: { children: ReactNode }) {
  return <div className={styles.summary}>{children}</div>;
}
