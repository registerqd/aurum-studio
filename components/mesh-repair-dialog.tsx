"use client";

import { useState } from "react";
import { Wrench, X } from "lucide-react";
import { buildMedalGroup } from "@/lib/model-builder";
import {
  DEFAULT_REPAIR_OPTIONS,
  repairGroup,
  type RepairOptions,
  type RepairReport,
} from "@/lib/mesh-repair";
import type { MedalSettings } from "@/lib/types";

const STORAGE_KEY = "aurum-repair-options";

export function loadRepairOptions(): RepairOptions {
  if (typeof window === "undefined") return DEFAULT_REPAIR_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REPAIR_OPTIONS;
    return { ...DEFAULT_REPAIR_OPTIONS, ...(JSON.parse(raw) as Partial<RepairOptions>) };
  } catch {
    return DEFAULT_REPAIR_OPTIONS;
  }
}

export function saveRepairOptions(options: RepairOptions) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
}

interface MeshRepairDialogProps {
  svgText: string;
  settings: MedalSettings;
  onClose: () => void;
  onApplied: (options: RepairOptions) => void;
}

const FIELDS: Array<{
  key: keyof RepairOptions;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
}> = [
  { key: "weldTolerance", label: "焊接容差", hint: "小于该距离的顶点合并", step: 0.0001, min: 0, max: 0.01 },
  { key: "degenerateArea", label: "退化面阈值", hint: "面积低于此值的三角面删除", step: 0.000000001, min: 0, max: 0.000001 },
  { key: "maxHoleEdges", label: "补洞边数上限", hint: "过大的开口不自动封口", step: 16, min: 3, max: 2048 },
];

export function MeshRepairDialog({ svgText, settings, onClose, onApplied }: MeshRepairDialogProps) {
  const [options, setOptions] = useState<RepairOptions>(() => loadRepairOptions());
  const [report, setReport] = useState<RepairReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(key: keyof RepairOptions, value: boolean | number) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  function run() {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const group = buildMedalGroup(svgText, settings);
        const { total } = repairGroup(group, options);
        setReport(total);
      } catch {
        setError("诊断失败，请确认当前设计已正确解析");
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  return (
    <div className="png-modal-backdrop" role="dialog" aria-modal="true" aria-label="模型修复">
      <div className="png-modal" style={{ width: "min(720px, 94vw)" }}>
        <header className="png-modal-head">
          <div className="png-modal-title">
            <span className="png-modal-badge">
              <Wrench size={14} />
            </span>
            <div>
              <h2>模型修复 / 补破面</h2>
              <p>焊接顶点 · 去退化面 · 统一法线 · 封补开口</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="png-modal-body" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <section className="png-params-pane">
            <div className="png-group-label">参数</div>
            {FIELDS.map((field) => (
              <label className="png-param" key={field.key}>
                <div className="png-param-label">
                  <span>{field.label}</span>
                  <b>{String(options[field.key])}</b>
                </div>
                <input
                  max={field.max}
                  min={field.min}
                  onChange={(event) => patch(field.key, Number(event.target.value))}
                  step={field.step}
                  type="range"
                  value={Number(options[field.key])}
                />
                <small>{field.hint}</small>
              </label>
            ))}
            {([
              ["fillHoles", "自动补洞"],
              ["unifyWinding", "统一法线朝向"],
              ["removeDuplicates", "去重复面"],
              ["recomputeNormals", "重算法线"],
            ] as Array<[keyof RepairOptions, string]>).map(([key, label]) => (
              <label className="png-toggle" key={key}>
                <input
                  checked={Boolean(options[key])}
                  onChange={(event) => patch(key, event.target.checked)}
                  type="checkbox"
                />
                <span>{label}</span>
              </label>
            ))}
          </section>

          <section className="png-params-pane">
            <div className="png-group-label">诊断结果</div>
            {report ? (
              <>
                <div className={`repair-verdict ${report.watertight ? "repair-ok" : "repair-warn"}`}>
                  {report.watertight ? "实体封闭 · 可直接 3D 打印" : "仍有开放边，建议提高容差后重跑"}
                </div>
                <div className="repair-stat-grid">
                  {[
                    ["三角面", `${report.outputTriangles}`],
                    ["顶点", `${report.outputVertices}`],
                    ["焊接", `${report.weldedVertices}`],
                    ["退化面", `${report.degenerateRemoved}`],
                    ["重复面", `${report.duplicateRemoved}`],
                    ["边界环", `${report.boundaryLoops}`],
                    ["已补洞", `${report.holesFilled}`],
                    ["非流形边", `${report.nonManifoldEdges}`],
                  ].map(([label, value]) => (
                    <div className="repair-stat" key={label}>
                      <b>{value}</b>
                      <small>{label}</small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="repair-empty">点击「运行诊断」检查当前模型的可打印性</div>
            )}
            {error ? <div className="png-error">{error}</div> : null}
          </section>
        </div>

        <footer className="png-modal-foot">
          <div className="png-foot-hint">修复会在导出 GLB / STL / 3D 打印前自动应用</div>
          <div className="png-foot-actions">
            <button className="btn ghost" onClick={onClose} type="button">关闭</button>
            <button className="btn ghost" disabled={running} onClick={run} type="button">
              {running ? "诊断中…" : "运行诊断"}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                saveRepairOptions(options);
                onApplied(options);
                onClose();
              }}
              type="button"
            >
              保存并应用
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
