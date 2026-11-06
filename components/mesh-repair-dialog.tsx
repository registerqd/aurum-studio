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
import {
  DEFAULT_REMESH_OPTIONS,
  remeshGroup,
  type RemeshOptions,
  type RemeshReport,
} from "@/lib/topology-remesh";
import {
  DEFAULT_NORMAL_OPTIONS,
  reconstructNormalsInGroup,
  type NormalOptions,
  type NormalReport,
} from "@/lib/normals";
import type { MedalSettings } from "@/lib/types";

const STORAGE_KEY = "molda-mesh-options";

export interface MeshPipeline {
  repair: RepairOptions;
  remesh: RemeshOptions;
  normals: NormalOptions;
}

export const DEFAULT_PIPELINE: MeshPipeline = {
  repair: DEFAULT_REPAIR_OPTIONS,
  remesh: DEFAULT_REMESH_OPTIONS,
  normals: DEFAULT_NORMAL_OPTIONS,
};

export function loadPipeline(): MeshPipeline {
  if (typeof window === "undefined") return DEFAULT_PIPELINE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PIPELINE;
    const parsed = JSON.parse(raw) as Partial<MeshPipeline>;
    return {
      repair: { ...DEFAULT_REPAIR_OPTIONS, ...parsed.repair },
      remesh: { ...DEFAULT_REMESH_OPTIONS, ...parsed.remesh },
      normals: { ...DEFAULT_NORMAL_OPTIONS, ...parsed.normals },
    };
  } catch {
    return DEFAULT_PIPELINE;
  }
}

export function savePipeline(pipeline: MeshPipeline) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pipeline));
}

interface Props {
  svgText: string;
  settings: MedalSettings;
  onClose: () => void;
  onApplied: (pipeline: MeshPipeline) => void;
}

type Tab = "repair" | "topology" | "normals";

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "repair", label: "破面修复", hint: "焊接 · 去重 · 补洞" },
  { id: "topology", label: "拓扑重构", hint: "聚类 · 平滑 · 规整" },
  { id: "normals", label: "法线重构", hint: "平滑 · 硬边 · 翻转" },
];

export function MeshRepairDialog({ svgText, settings, onClose, onApplied }: Props) {
  const [pipeline, setPipeline] = useState<MeshPipeline>(() => loadPipeline());
  const [tab, setTab] = useState<Tab>("repair");
  const [repairReport, setRepairReport] = useState<RepairReport | null>(null);
  const [remeshReport, setRemeshReport] = useState<RemeshReport | null>(null);
  const [normalReport, setNormalReport] = useState<NormalReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchRepair(key: keyof RepairOptions, value: boolean | number) {
    setPipeline((p) => ({ ...p, repair: { ...p.repair, [key]: value } }));
  }
  function patchRemesh(key: keyof RemeshOptions, value: boolean | number) {
    setPipeline((p) => ({ ...p, remesh: { ...p.remesh, [key]: value } }));
  }
  function patchNormals(key: keyof NormalOptions, value: boolean | number | string) {
    setPipeline((p) => ({ ...p, normals: { ...p.normals, [key]: value } }));
  }

  function run() {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const group = buildMedalGroup(svgText, settings);
        const { total } = repairGroup(group, pipeline.repair);
        setRepairReport(total);
        const remeshed = remeshGroup(group, pipeline.remesh);
        setRemeshReport(remeshed.total);
        const normals = reconstructNormalsInGroup(group, pipeline.normals);
        setNormalReport(normals.report);
      } catch {
        setError("诊断失败，请确认当前设计已正确解析");
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  const watertight = repairReport?.watertight;

  return (
    <div className="png-modal-backdrop" role="dialog" aria-modal="true" aria-label="网格处理">
      <div className="png-modal" style={{ width: "min(860px, 96vw)" }}>
        <header className="png-modal-head">
          <div className="png-modal-title">
            <span className="png-modal-badge">
              <Wrench size={14} />
            </span>
            <div>
              <h2>网格处理 · 修复 / 拓扑 / 法线</h2>
              <p>补破面 · 顶点焊接 · 拓扑重构 · 法线重建，导出前自动应用</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="mesh-tabs">
          {TABS.map((item) => (
            <button
              className={tab === item.id ? "mesh-tab active" : "mesh-tab"}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <b>{item.label}</b>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>

        <div className="png-modal-body" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <section className="png-params-pane">
            {tab === "repair" ? (
              <>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>焊接容差</span>
                    <b>{pipeline.repair.weldTolerance}</b>
                  </div>
                  <input
                    max={0.01} min={0} step={0.0001} type="range"
                    value={pipeline.repair.weldTolerance}
                    onChange={(e) => patchRepair("weldTolerance", Number(e.target.value))}
                  />
                  <small>小于该距离的顶点合并</small>
                </label>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>补洞边数上限</span>
                    <b>{pipeline.repair.maxHoleEdges}</b>
                  </div>
                  <input
                    max={2048} min={3} step={16} type="range"
                    value={pipeline.repair.maxHoleEdges}
                    onChange={(e) => patchRepair("maxHoleEdges", Number(e.target.value))}
                  />
                  <small>过大的开口不自动封口</small>
                </label>
                {([["fillHoles", "自动补洞"], ["unifyWinding", "统一法线朝向"], ["removeDuplicates", "去重复面"]] as Array<[keyof RepairOptions, string]>).map(([k, label]) => (
                  <label className="png-toggle" key={k}>
                    <input
                      checked={Boolean(pipeline.repair[k])}
                      onChange={(e) => patchRepair(k, e.target.checked)}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </>
            ) : null}

            {tab === "topology" ? (
              <>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>聚类格子</span>
                    <b>{pipeline.remesh.cellSize.toFixed(4)}</b>
                  </div>
                  <input
                    max={0.05} min={0.0005} step={0.0005} type="range"
                    value={pipeline.remesh.cellSize}
                    onChange={(e) => patchRemesh("cellSize", Number(e.target.value))}
                  />
                  <small>越大拓扑越规整、面数越少</small>
                </label>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>平滑迭代</span>
                    <b>{pipeline.remesh.smoothIterations}</b>
                  </div>
                  <input
                    max={12} min={0} step={1} type="range"
                    value={pipeline.remesh.smoothIterations}
                    onChange={(e) => patchRemesh("smoothIterations", Number(e.target.value))}
                  />
                  <small>拉普拉斯松弛次数</small>
                </label>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>松弛强度</span>
                    <b>{pipeline.remesh.smoothStrength.toFixed(2)}</b>
                  </div>
                  <input
                    max={1} min={0} step={0.05} type="range"
                    value={pipeline.remesh.smoothStrength}
                    onChange={(e) => patchRemesh("smoothStrength", Number(e.target.value))}
                  />
                  <small>每步向邻域平均移动的比例</small>
                </label>
                <label className="png-toggle">
                  <input
                    checked={pipeline.remesh.preserveFeatures}
                    onChange={(e) => patchRemesh("preserveFeatures", e.target.checked)}
                    type="checkbox"
                  />
                  <span>保留锐利特征（限制位移）</span>
                </label>
              </>
            ) : null}

            {tab === "normals" ? (
              <>
                <div className="png-group-label">模式</div>
                <div className="segmented">
                  {(["angle", "smooth", "flat"] as const).map((mode) => (
                    <button
                      className={pipeline.normals.mode === mode ? "active" : ""}
                      key={mode}
                      onClick={() => patchNormals("mode", mode)}
                      type="button"
                    >
                      {mode === "angle" ? "按角度" : mode === "smooth" ? "全平滑" : "全硬边"}
                    </button>
                  ))}
                </div>
                <label className="png-param">
                  <div className="png-param-label">
                    <span>硬边阈值</span>
                    <b>{pipeline.normals.angleThreshold}°</b>
                  </div>
                  <input
                    max={120} min={5} step={1} type="range"
                    value={pipeline.normals.angleThreshold}
                    onChange={(e) => patchNormals("angleThreshold", Number(e.target.value))}
                  />
                  <small>夹角超过阈值处保留硬边</small>
                </label>
                <label className="png-toggle">
                  <input
                    checked={pipeline.normals.flip}
                    onChange={(e) => patchNormals("flip", e.target.checked)}
                    type="checkbox"
                  />
                  <span>翻转法线（壳体内外反了时用）</span>
                </label>
              </>
            ) : null}
          </section>

          <section className="png-params-pane">
            <div className="png-group-label">诊断结果</div>
            {repairReport ? (
              <>
                <div className={`repair-verdict ${watertight ? "repair-ok" : "repair-warn"}`}>
                  {watertight ? "实体封闭 · 可打印" : "仍有开放边，建议加大容差"}
                </div>
                <div className="repair-stat-grid">
                  {[
                    ["三角面", `${remeshReport?.afterTriangles ?? repairReport.outputTriangles}`],
                    ["顶点", `${normalReport?.outputVertices ?? repairReport.outputVertices}`],
                    ["已补洞", `${repairReport.holesFilled}`],
                    ["非流形边", `${repairReport.nonManifoldEdges}`],
                    ["拓扑合并", `${remeshReport?.mergedVertices ?? 0}`],
                    ["拓扑丢面", `${remeshReport?.droppedFaces ?? 0}`],
                    ["硬边数", `${normalReport?.hardEdges ?? 0}`],
                    ["法线模式", pipeline.normals.mode],
                  ].map(([label, value]) => (
                    <div className="repair-stat" key={label}>
                      <b>{value}</b>
                      <small>{label}</small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="repair-empty">点击「运行诊断」检查修复、拓扑与法线的处理效果</div>
            )}
            {error ? <div className="png-error">{error}</div> : null}
          </section>
        </div>

        <footer className="png-modal-foot">
          <div className="png-foot-hint">三步依次执行：修复 → 拓扑重构 → 法线重构</div>
          <div className="png-foot-actions">
            <button className="btn ghost" onClick={onClose} type="button">关闭</button>
            <button className="btn ghost" disabled={running} onClick={run} type="button">
              {running ? "处理中…" : "运行诊断"}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                savePipeline(pipeline);
                onApplied(pipeline);
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
