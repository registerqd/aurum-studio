"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const SUPPORTED_LOCALES = ["en", "zh-CN", "ja", "ko", "es", "fr", "de", "pt-BR"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
};

type Messages = Record<string, string>;

const zhCN: Messages = {
  Language: "语言", New: "新建", "Import Showcase": "导入展示作品", Importing: "正在导入…", "Import showcase works": "导入展示作品",
  "Download JSON": "下载 JSON", Rename: "重命名", Delete: "删除",
  "Import works": "导入作品", "Export all works": "导出全部作品", "Close preview": "关闭预览",
  "Enable live 3D previews": "启用实时 3D 预览", "Disable live 3D previews": "停用实时 3D 预览",
  "Rename work": "重命名作品", "No showcase works were imported.": "未导入任何展示作品。",
  "Could not import showcase works.": "无法导入展示作品。", Ready: "就绪", "Loading work": "正在加载作品",
  "Loading work…": "正在加载作品…", Save: "保存", Saved: "已保存", Saving: "正在保存", "Save work": "保存作品",
  "Save failed": "保存失败", "Auto saved": "已自动保存", "Auto save failed": "自动保存失败",
  "Back to home": "返回主页", "Work name": "作品名称", "Presentation mode": "演示模式",
  "Open presentation mode": "打开演示模式", Source: "源文件", "Drop SVG here": "将 SVG 拖到此处",
  "or click to upload": "或点击上传", Objects: "对象", Inspector: "检查器", Shape: "形状", Material: "材质",
  Quality: "质量", Export: "导出", Color: "颜色", Thickness: "厚度", "Depth steps": "深度层级",
  Bevel: "倒角", "Bevel segments": "倒角分段", "Height offset": "高度偏移", "Curve segments": "曲线分段",
  "Curve precision": "曲线精度", "Path winding": "路径绕向", "Select a layer in the left sidebar.": "请在左侧边栏选择一个图层。",
  Radius: "半径", Width: "宽度", Height: "高度", "Corner radius": "圆角半径", "Reset to SVG color": "恢复 SVG 颜色",
  Dome: "穹顶", "Arc depth": "弧面深度", "Arc radius": "弧面半径", "Arc smoothness": "弧面平滑度",
  "Preview mode": "预览模式", "SVG editor": "SVG 编辑器", Grid: "网格", Shadow: "阴影", "Background color": "背景颜色",
  "Toggle grid": "切换网格", "Toggle shadow": "切换阴影", "Canvas background": "画布背景",
  "Presentation Mode": "演示模式", Close: "关闭", "Close presentation mode": "关闭演示模式", Mode: "模式",
  Rotate: "旋转", Flip: "翻转", Rotation: "旋转", Scale: "缩放", "Starting orientation": "起始方向",
  "Ending orientation": "结束方向", Motion: "运动", Speed: "速度", Amplitude: "幅度", Frequency: "频率",
  Interval: "间隔", Duration: "时长", "Frame rate": "帧率", Draft: "草稿", Standard: "标准", High: "高",
  Linear: "线性", Sine: "正弦", "X axis": "X 轴", "Y axis": "Y 轴", "Z axis": "Z 轴",
  "Export Queue": "导出队列", "Export queue": "导出队列", "No exports yet": "暂无导出任务",
  "Download again": "再次下载", Clear: "清除", Downloaded: "已下载", Queued: "已排队", Failed: "失败",
  "Starting export": "正在开始导出", "Preparing download": "正在准备下载", "Building mesh": "正在构建网格",
  Vector: "矢量", "Zoom out": "缩小", "Zoom in": "放大", "Optimize anchors": "优化锚点", Strength: "强度",
  "Reset anchor optimization": "重置锚点优化", "Select one path layer to edit its anchors.": "选择一个路径图层以编辑锚点。",
  "Always recalculated from the original path.": "始终从原始路径重新计算。", "Select one path to optimize.": "选择一个路径进行优化。",
  "Only SVG uploads are accepted": "仅支持上传 SVG", "Import cancelled": "导入已取消", "Import failed": "导入失败",
  "Finish loading SVG before exporting": "请等待 SVG 加载完成后再导出", "Selection cleared": "已清除选择",
  "Switch to dark mode": "切换到深色模式", "Switch to light mode": "切换到浅色模式", "Export JSON": "导出 JSON",
  Undo: "撤销", Redo: "重做", "Undid last edit": "已撤销上一步编辑", "Redid last edit": "已重做上一步编辑",
  "Undo (⌘Z / Ctrl+Z)": "撤销（⌘Z / Ctrl+Z）", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "重做（⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y）",
};

const ja: Messages = {
  Language: "言語", New: "新規", Save: "保存", Saved: "保存済み", Saving: "保存中", Ready: "準備完了", Rename: "名前を変更", Delete: "削除",
  "Loading work": "作品を読み込み中", "Back to home": "ホームへ戻る", "Work name": "作品名",
  "Presentation mode": "プレゼンテーションモード", Source: "ソース", "Drop SVG here": "SVGをここにドロップ",
  "or click to upload": "またはクリックしてアップロード", Objects: "オブジェクト", Inspector: "インスペクター",
  Shape: "形状", Material: "マテリアル", Quality: "品質", Export: "書き出し", Color: "カラー",
  Thickness: "厚さ", Bevel: "ベベル", "Bevel segments": "ベベル分割", "Curve segments": "曲線分割",
  "Presentation Mode": "プレゼンテーションモード", Close: "閉じる", Mode: "モード", Rotate: "回転", Flip: "反転",
  Scale: "スケール", Speed: "速度", Duration: "長さ", "Frame rate": "フレームレート",
  "Export Queue": "書き出しキュー", "Export queue": "書き出しキュー", "No exports yet": "書き出しはまだありません",
  "Download again": "再ダウンロード", Clear: "消去", Vector: "ベクター", Strength: "強度",
  Undo: "元に戻す", Redo: "やり直す", "Undid last edit": "直前の編集を元に戻しました", "Redid last edit": "直前の編集をやり直しました",
  "Undo (⌘Z / Ctrl+Z)": "元に戻す（⌘Z / Ctrl+Z）", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "やり直す（⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y）",
};

const ko: Messages = {
  Language: "언어", New: "새로 만들기", Save: "저장", Saved: "저장됨", Saving: "저장 중", Ready: "준비됨", Rename: "이름 변경", Delete: "삭제",
  "Loading work": "작업 불러오는 중", "Back to home": "홈으로", "Work name": "작업 이름", Source: "소스",
  "Drop SVG here": "여기에 SVG 놓기", "or click to upload": "또는 클릭하여 업로드", Objects: "개체",
  Inspector: "인스펙터", Shape: "모양", Material: "재질", Quality: "품질", Export: "내보내기", Color: "색상",
  "Presentation Mode": "프레젠테이션 모드", Mode: "모드", Rotate: "회전", Flip: "뒤집기", Scale: "크기",
  Speed: "속도", Duration: "길이", "Frame rate": "프레임 속도", "Export Queue": "내보내기 대기열",
  "Export queue": "내보내기 대기열", "No exports yet": "내보내기 항목 없음", Clear: "지우기",
  Undo: "실행 취소", Redo: "다시 실행", "Undid last edit": "마지막 편집을 취소했습니다", "Redid last edit": "마지막 편집을 다시 실행했습니다",
  "Undo (⌘Z / Ctrl+Z)": "실행 취소(⌘Z / Ctrl+Z)", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "다시 실행(⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)",
};

const es: Messages = {
  Language: "Idioma", New: "Nuevo", Save: "Guardar", Saved: "Guardado", Saving: "Guardando", Ready: "Listo", Rename: "Renombrar", Delete: "Eliminar",
  "Loading work": "Cargando proyecto", "Back to home": "Volver al inicio", "Work name": "Nombre del proyecto",
  Source: "Origen", "Drop SVG here": "Suelta el SVG aquí", "or click to upload": "o haz clic para subir",
  Objects: "Objetos", Inspector: "Inspector", Shape: "Forma", Material: "Material", Quality: "Calidad", Export: "Exportar",
  Color: "Color", Thickness: "Grosor", Bevel: "Bisel", "Presentation Mode": "Modo presentación", Mode: "Modo",
  Rotate: "Rotar", Flip: "Voltear", Scale: "Escala", Speed: "Velocidad", Duration: "Duración",
  "Frame rate": "Fotogramas por segundo", "Export Queue": "Cola de exportación", "Export queue": "Cola de exportación",
  "No exports yet": "Aún no hay exportaciones", "Download again": "Descargar de nuevo", Clear: "Borrar",
  Undo: "Deshacer", Redo: "Rehacer", "Undid last edit": "Se deshizo la última edición", "Redid last edit": "Se rehizo la última edición",
  "Undo (⌘Z / Ctrl+Z)": "Deshacer (⌘Z / Ctrl+Z)", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "Rehacer (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)",
};

const fr: Messages = {
  Language: "Langue", New: "Nouveau", Save: "Enregistrer", Saved: "Enregistré", Saving: "Enregistrement", Ready: "Prêt", Rename: "Renommer", Delete: "Supprimer",
  "Loading work": "Chargement du projet", "Back to home": "Retour à l’accueil", "Work name": "Nom du projet",
  Source: "Source", "Drop SVG here": "Déposez le SVG ici", "or click to upload": "ou cliquez pour importer",
  Objects: "Objets", Inspector: "Inspecteur", Shape: "Forme", Material: "Matériau", Quality: "Qualité", Export: "Exporter",
  Color: "Couleur", Thickness: "Épaisseur", Bevel: "Biseau", "Presentation Mode": "Mode présentation", Mode: "Mode",
  Rotate: "Rotation", Flip: "Retournement", Scale: "Échelle", Speed: "Vitesse", Duration: "Durée",
  "Frame rate": "Fréquence d’images", "Export Queue": "File d’exportation", "Export queue": "File d’exportation",
  "No exports yet": "Aucune exportation", "Download again": "Télécharger à nouveau", Clear: "Effacer",
  Undo: "Annuler", Redo: "Rétablir", "Undid last edit": "La dernière modification a été annulée", "Redid last edit": "La dernière modification a été rétablie",
  "Undo (⌘Z / Ctrl+Z)": "Annuler (⌘Z / Ctrl+Z)", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "Rétablir (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)",
};

const de: Messages = {
  Language: "Sprache", New: "Neu", Save: "Speichern", Saved: "Gespeichert", Saving: "Speichert", Ready: "Bereit", Rename: "Umbenennen", Delete: "Löschen",
  "Loading work": "Projekt wird geladen", "Back to home": "Zur Startseite", "Work name": "Projektname",
  Source: "Quelle", "Drop SVG here": "SVG hier ablegen", "or click to upload": "oder zum Hochladen klicken",
  Objects: "Objekte", Inspector: "Inspektor", Shape: "Form", Material: "Material", Quality: "Qualität", Export: "Export",
  Color: "Farbe", Thickness: "Dicke", Bevel: "Fase", "Presentation Mode": "Präsentationsmodus", Mode: "Modus",
  Rotate: "Drehen", Flip: "Wenden", Scale: "Skalierung", Speed: "Geschwindigkeit", Duration: "Dauer",
  "Frame rate": "Bildrate", "Export Queue": "Exportwarteschlange", "Export queue": "Exportwarteschlange",
  "No exports yet": "Noch keine Exporte", "Download again": "Erneut herunterladen", Clear: "Löschen",
  Undo: "Rückgängig", Redo: "Wiederholen", "Undid last edit": "Letzte Änderung rückgängig gemacht", "Redid last edit": "Letzte Änderung wiederholt",
  "Undo (⌘Z / Ctrl+Z)": "Rückgängig (⌘Z / Ctrl+Z)", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "Wiederholen (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)",
};

const ptBR: Messages = {
  Language: "Idioma", New: "Novo", Save: "Salvar", Saved: "Salvo", Saving: "Salvando", Ready: "Pronto", Rename: "Renomear", Delete: "Excluir",
  "Loading work": "Carregando projeto", "Back to home": "Voltar ao início", "Work name": "Nome do projeto",
  Source: "Origem", "Drop SVG here": "Solte o SVG aqui", "or click to upload": "ou clique para enviar",
  Objects: "Objetos", Inspector: "Inspetor", Shape: "Forma", Material: "Material", Quality: "Qualidade", Export: "Exportar",
  Color: "Cor", Thickness: "Espessura", Bevel: "Chanfro", "Presentation Mode": "Modo de apresentação", Mode: "Modo",
  Rotate: "Girar", Flip: "Virar", Scale: "Escala", Speed: "Velocidade", Duration: "Duração",
  "Frame rate": "Taxa de quadros", "Export Queue": "Fila de exportação", "Export queue": "Fila de exportação",
  "No exports yet": "Nenhuma exportação", "Download again": "Baixar novamente", Clear: "Limpar",
  Undo: "Desfazer", Redo: "Refazer", "Undid last edit": "A última edição foi desfeita", "Redid last edit": "A última edição foi refeita",
  "Undo (⌘Z / Ctrl+Z)": "Desfazer (⌘Z / Ctrl+Z)", "Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)": "Refazer (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)",
};

const messages: Record<Locale, Messages> = { en: {}, "zh-CN": zhCN, ja, ko, es, fr, de, "pt-BR": ptBR };
const STORAGE_KEY = "medal-forge-locale";

function resolveLocale(value?: string | null): Locale {
  if (!value) return "en";
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const language = value.split("-")[0].toLowerCase();
  return SUPPORTED_LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === language) ?? "en";
}

type I18nValue = string | number;
type I18nContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (key: string, values?: Record<string, I18nValue>) => string };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const detectedLocale = resolveLocale(stored || navigator.languages?.[0] || navigator.language);
    const frame = window.requestAnimationFrame(() => setLocaleState(detectedLocale));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    document.documentElement.lang = nextLocale;
  }, []);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const t = useCallback((key: string, values?: Record<string, I18nValue>) => {
    let result = messages[locale][key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) result = result.replaceAll(`{${name}}`, String(value));
    return result;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
