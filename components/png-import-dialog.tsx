"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageDown, Layers, Sparkles, X } from "lucide-react";
import {
  DEFAULT_PNG_TO_SVG_OPTIONS,
  PNG_TO_SVG_PRESETS,
  convertImageDataToSvg,
  fileToImageData,
  renderLayersToDataUrl,
  type PngToSvgOptions,
  type PngToSvgResult,
} from "@/lib/png-to-svg";

interface PngImportDialogProps {
  file: File;
  onCancel: () => void;
  onApply: (svgText: string, name: string) => void;
}

interface SliderSpec {
  key: keyof PngToSvgOptions;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

const SLIDERS: SliderSpec[] = [
  { key: "colors", label: "色板数量", hint: "量化后的主色个数", min: 2, max: 24, step: 1, unit: "色" },
  { key: "gradientLayers", label: "渐变分层", hint: "把渐变拆成几层可堆叠的厚度", min: 1, max: 8, step: 1, unit: "层" },
  { key: "smoothing", label: "平滑", hint: "量化前的模糊半径，抗噪点", min: 0, max: 6, step: 1, unit: "px" },
  { key: "simplify", label: "简化强度", hint: "越大节点越少、轮廓越硬朗", min: 0, max: 6, step: 0.1 },
  { key: "minArea", label: "最小面积", hint: "过滤碎点，避免脏层", min: 0, max: 400, step: 4, unit: "px²" },
  { key: "backgroundTolerance", label: "背景容差", hint: "越大越容易去掉浅色底", min: 0, max: 120, step: 1 },
  { key: "outline", label: "描边", hint: "为每层加外扩描边，补缝隙", min: 0, max: 6, step: 0.5, unit: "px" },
  { key: "maxSize", label: "处理分辨率", hint: "长边像素，越高越精细也越慢", min: 128, max: 1024, step: 64, unit: "px" },
];

export function PngImportDialog({ file, onCancel, onApply }: PngImportDialogProps) {
  const [options, setOptions] = useState<PngToSvgOptions>({
    ...DEFAULT_PNG_TO_SVG_OPTIONS,
    maxSize: 512,
  });
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [result, setResult] = useState<PngToSvgResult | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [mode, setMode] = useState<"vector" | "source">("vector");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let revoked = false;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    fileToImageData(file, 1024)
      .then((data) => {
        if (!revoked) setImageData(data);
      })
      .catch(() => setError("无法读取这张图片，请换一张 PNG / JPG"));
    return () => {
      revoked = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (!imageData) return;
    if (timer.current) window.clearTimeout(timer.current);
    setBusy(true);
    timer.current = window.setTimeout(() => {
      try {
        const next = convertImageDataToSvg(imageData, options);
        setResult(next);
        setPreview(renderLayersToDataUrl(next.layers, next.width, next.height));
        setError(next.layers.length === 0 ? "没有提取到有效轮廓，试着降低最小面积或关闭去背景" : null);
      } catch {
        setError("矢量化失败，请调低分辨率后重试");
      } finally {
        setBusy(false);
      }
    }, 140);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [imageData, options]);

  const patch = useCallback((key: keyof PngToSvgOptions, value: number | boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const stats = result?.stats;
  const layerCount = result?.layers.length ?? 0;
  const gradientLayers = useMemo(
    () => result?.layers.filter((layer) => layer.fromGradient).length ?? 0,
    [result],
  );

  return (
    <div className="png-modal-backdrop" role="dialog" aria-modal="true" aria-label="位图转矢量">
      <div className="png-modal">
        <header className="png-modal-head">
          <div className="png-modal-title">
            <span className="png-modal-badge">
              <ImageDown size={14} />
            </span>
            <div>
              <h2>位图 → 矢量分层</h2>
              <p>{file.name}</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onCancel} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="png-modal-body">
          <section className="png-preview-pane">
            <div className="png-preview-toolbar">
              <div className="segmented">
                <button
                  className={mode === "vector" ? "active" : ""}
                  onClick={() => setMode("vector")}
                  type="button"
                >
                  矢量结果
                </button>
                <button
                  className={mode === "source" ? "active" : ""}
                  onClick={() => setMode("source")}
                  type="button"
                >
                  原图
                </button>
              </div>
              {busy ? <span className="png-pill">计算中…</span> : null}
            </div>
            <div className="png-preview-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="预览"
                src={mode === "vector" && preview ? preview : sourceUrl}
                style={{
                  imageRendering: mode === "vector" ? "auto" : "auto",
                  opacity: busy ? 0.55 : 1,
                }}
              />
            </div>
            <div className="png-stat-row">
              <div className="png-stat">
                <span>{layerCount}</span>
                <small>可挤出层</small>
              </div>
              <div className="png-stat">
                <span>{gradientLayers}</span>
                <small>渐变层</small>
              </div>
              <div className="png-stat">
                <span>{stats?.paletteSize ?? 0}</span>
                <small>色板</small>
              </div>
              <div className="png-stat">
                <span>{stats?.droppedComponents ?? 0}</span>
                <small>已滤碎块</small>
              </div>
            </div>
          </section>

          <section className="png-params-pane">
            <div className="png-presets">
              {PNG_TO_SVG_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="png-preset"
                  onClick={() =>
                    setOptions((prev) => ({ ...prev, ...preset.values }))
                  }
                  type="button"
                  title={preset.description}
                >
                  <Sparkles size={12} />
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="png-param-list">
              {SLIDERS.map((slider) => (
                <label className="png-param" key={slider.key}>
                  <div className="png-param-label">
                    <span>{slider.label}</span>
                    <b>
                      {options[slider.key]}
                      {slider.unit ?? ""}
                    </b>
                  </div>
                  <input
                    max={slider.max}
                    min={slider.min}
                    onChange={(event) => patch(slider.key, Number(event.target.value))}
                    step={slider.step}
                    type="range"
                    value={options[slider.key] as number}
                  />
                  <small>{slider.hint}</small>
                </label>
              ))}

              <label className="png-toggle">
                <input
                  checked={options.removeBackground}
                  onChange={(event) => patch("removeBackground", event.target.checked)}
                  type="checkbox"
                />
                <span>自动去除纯色背景</span>
              </label>
            </div>
          </section>
        </div>

        {error ? <div className="png-error">{error}</div> : null}

        <footer className="png-modal-foot">
          <div className="png-foot-hint">
            <Layers size={13} />
            生成后每层都会进入左侧结构树，可单独调厚度
          </div>
          <div className="png-foot-actions">
            <button className="btn ghost" onClick={onCancel} type="button">
              取消
            </button>
            <button
              className="btn primary"
              disabled={!result || layerCount === 0 || busy}
              onClick={() => {
                if (!result) return;
                const base = file.name.replace(/\.[^.]+$/, "");
                onApply(result.svg, `${base}.svg`);
              }}
              type="button"
            >
              导入 {layerCount} 层
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
