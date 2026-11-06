"use client";

import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/inspector";
import { LOCALE_LABELS, SUPPORTED_LOCALES, useI18n, type Locale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    setIsOpen(false);
  }

  return (
    <div className="language-switcher" ref={rootRef}>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={t("Language")}
        className={isOpen ? "language-trigger active" : "language-trigger"}
        onClick={() => setIsOpen((current) => !current)}
        title={`${t("Language")}: ${LOCALE_LABELS[locale]}`}
        type="button"
        variant="icon"
      >
        <Languages size={15} />
      </Button>
      {isOpen ? (
        <div aria-label={t("Language")} className="language-menu" role="menu">
          {SUPPORTED_LOCALES.map((option) => (
            <button
              aria-checked={option === locale}
              className={option === locale ? "language-option selected" : "language-option"}
              key={option}
              onClick={() => selectLocale(option)}
              role="menuitemradio"
              type="button"
            >
              <span>{LOCALE_LABELS[option]}</span>
              {option === locale ? <Check aria-hidden="true" size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
