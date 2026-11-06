"use client";

import { Sparkles } from "lucide-react";
import {
  PointerEvent,
  WheelEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrubbableNumberField } from "@/components/ui/scrubbable-number-field";
import {
  commandEndpoint,
  parsePathData,
  replacePathData,
  serializePathData,
  simplifyPathData,
  type EditablePathCommand,
  type PathPoint,
} from "@/lib/svg-path-editor";
import type { SvgPathSummary } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

interface SvgPathEditorProps {
  activeSummary?: SvgPathSummary;
  backgroundColor: string;
  onSvgTextChange: (svgText: string) => void;
  onSvgTextPreviewChange: (svgText: string | null) => void;
  selectedPathIndexes: number[];
  svgText: string;
}

interface CommandGeometry {
  commandIndex: number;
  end: PathPoint;
  handles: Array<{ key: "c1" | "c2"; point: PathPoint; valueIndex: number }>;
}

interface HandleTarget {
  commandIndex: number;
  key: "c1" | "c2";
  point: PathPoint;
  valueIndex: number;
}

interface OptimizationInteraction {
  baselineD: string;
  pathIndex: number;
  previewActive: boolean;
  startingD: string;
}

function getSvgViewBox(svgText: string) {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = document.documentElement;
  const viewBox = root.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return viewBox as [number, number, number, number];
  return [0, 0, Number(root.getAttribute("width")) || 512, Number(root.getAttribute("height")) || 512] as const;
}

function geometryFor(commands: EditablePathCommand[]) {
  let current = { x: 0, y: 0 };
  return commands.flatMap<CommandGeometry>((command, commandIndex) => {
    const type = command.type.toUpperCase();
    const relative = command.type !== type;
    const offset = relative ? current : { x: 0, y: 0 };
    const endpoint = commandEndpoint(command, current);
    if (!endpoint) return [];
    const handles: CommandGeometry["handles"] = [];
    if (type === "C") {
      handles.push({ key: "c1", point: { x: command.values[0] + offset.x, y: command.values[1] + offset.y }, valueIndex: 0 });
      handles.push({ key: "c2", point: { x: command.values[2] + offset.x, y: command.values[3] + offset.y }, valueIndex: 2 });
    } else if (["S", "Q"].includes(type)) {
      handles.push({ key: "c1", point: { x: command.values[0] + offset.x, y: command.values[1] + offset.y }, valueIndex: 0 });
    }
    current = endpoint;
    return [{ commandIndex, end: endpoint, handles }];
  });
}

function commandStart(commands: EditablePathCommand[], commandIndex: number) {
  let current = { x: 0, y: 0 };
  for (let index = 0; index < commandIndex; index += 1) {
    current = commandEndpoint(commands[index], current) ?? current;
  }
  return current;
}

function convertLineToCubic(
  commands: EditablePathCommand[],
  commandIndex: number,
) {
  const command = commands[commandIndex];
  if (!command || !["L", "H", "V", "T"].includes(command.type.toUpperCase())) {
    return;
  }
  const start = commandStart(commands, commandIndex);
  const end = commandEndpoint(command, start);
  if (!end) return;
  commands[commandIndex] = {
    type: "C",
    values: [
      start.x + (end.x - start.x) / 3,
      start.y + (end.y - start.y) / 3,
      start.x + ((end.x - start.x) * 2) / 3,
      start.y + ((end.y - start.y) * 2) / 3,
      end.x,
      end.y,
    ],
  };
}

export function SvgPathEditor({
  activeSummary,
  backgroundColor,
  onSvgTextChange,
  onSvgTextPreviewChange,
  selectedPathIndexes,
  svgText,
}: SvgPathEditorProps) {
  const { t } = useI18n();
  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const { pan, zoom } = viewport;
  const [pathDraft, setPathDraft] = useState<{
    d: string;
    pathIndex: number;
    sourceSvgText?: string;
  } | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<{ pathIndex: number; commandIndex: number } | null>(null);
  const [optimization, setOptimization] = useState({
    baselineD: "",
    pathIndex: -1,
    resultD: "",
    strength: 0,
  });
  const panRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; commandIndex: number; valueIndex: number; axis: "x" | "y" | "both"; startX: number; startY: number; values: number[]; commands: EditablePathCommand[]; curveAnchor?: PathPoint; curveHandleMaxLength?: number; pairedCurveHandleMaxLength?: number; pairedCommandIndex?: number; pairedValueIndex?: number; pairedValues?: number[]; nextD: string } | null>(null);
  const latestSvgTextRef = useRef(svgText);
  const artworkRef = useRef<SVGGElement>(null);
  const draftPathMutationRef = useRef<{
    element: SVGPathElement;
    originalD: string | null;
  } | null>(null);
  const pathUpdateFrameRef = useRef(0);
  const pendingPathDataRef = useRef<string | null>(null);
  const optimizationFrameRef = useRef(0);
  const optimizationInteractionRef = useRef<OptimizationInteraction | null>(
    null,
  );
  const pendingOptimizationRef = useRef<{
    baselineD: string;
    pathIndex: number;
    strength: number;
  } | null>(null);
  const [viewX, viewY, viewWidth, viewHeight] = useMemo(() => getSvgViewBox(svgText), [svgText]);
  const svgInnerMarkup = useMemo(
    () => svgText.replace(/^.*?<svg[^>]*>|<\/svg>\s*$/gs, ""),
    [svgText],
  );
  const activeD = activeSummary?.tagName === "path" ? activeSummary.d : "";
  const draftD =
    selectedPathIndexes.length === 1 &&
    pathDraft &&
    (!pathDraft.sourceSvgText || pathDraft.sourceSvgText === svgText) &&
    pathDraft.pathIndex === activeSummary?.pathIndex
      ? pathDraft.d
      : null;
  const displayedD = draftD ?? activeD;
  const commands = useMemo(() => parsePathData(displayedD), [displayedD]);
  const geometry = useMemo(() => geometryFor(commands), [commands]);
  const selectedCommandIndex =
    selectedAnchor && selectedAnchor.pathIndex === activeSummary?.pathIndex
      ? selectedAnchor.commandIndex
      : null;
  const selectedGeometry =
    selectedCommandIndex === null
      ? null
      : geometry.find((item) => item.commandIndex === selectedCommandIndex) ?? null;
  const selectedHandles = useMemo<HandleTarget[]>(() => {
    if (!selectedGeometry) return [];
    const incoming = selectedGeometry.handles.filter((handle) => {
      const type = commands[selectedGeometry.commandIndex]?.type.toUpperCase();
      return handle.key === "c2" || (handle.key === "c1" && ["Q", "S"].includes(type));
    }).map((handle) => ({ ...handle, commandIndex: selectedGeometry.commandIndex }));
    const nextGeometry = geometry.find(
      (item) => item.commandIndex === selectedGeometry.commandIndex + 1,
    );
    const outgoing = nextGeometry?.handles
      .filter((handle) => handle.key === "c1" && ["C", "Q"].includes(commands[nextGeometry.commandIndex]?.type.toUpperCase()))
      .map((handle) => ({ ...handle, commandIndex: nextGeometry.commandIndex })) ?? [];
    return [...incoming, ...outgoing];
  }, [commands, geometry, selectedGeometry]);

  const optimizationMatchesActivePath =
    optimization.pathIndex === activeSummary?.pathIndex &&
    optimization.resultD === activeD;
  const strength = optimizationMatchesActivePath ? optimization.strength : 0;
  const baselineD = optimizationMatchesActivePath
    ? optimization.baselineD
    : activeD;

  useLayoutEffect(() => {
    const didChange = latestSvgTextRef.current !== svgText;
    latestSvgTextRef.current = svgText;
    if (!didChange || !optimizationInteractionRef.current) {
      return;
    }

    optimizationInteractionRef.current = null;
    window.cancelAnimationFrame(optimizationFrameRef.current);
    optimizationFrameRef.current = 0;
    pendingOptimizationRef.current = null;
    onSvgTextPreviewChange(null);
  }, [onSvgTextPreviewChange, svgText]);

  useEffect(() => {
    const interaction = optimizationInteractionRef.current;
    if (
      !interaction ||
      (selectedPathIndexes.length === 1 &&
        activeSummary?.pathIndex === interaction.pathIndex)
    ) {
      return;
    }

    interaction.previewActive = false;
    window.cancelAnimationFrame(optimizationFrameRef.current);
    optimizationFrameRef.current = 0;
    pendingOptimizationRef.current = null;
    setPathDraft(null);
    onSvgTextPreviewChange(null);
  }, [
    activeSummary?.pathIndex,
    onSvgTextPreviewChange,
    selectedPathIndexes,
  ]);

  useLayoutEffect(() => {
    const artwork = artworkRef.current;
    if (!artwork) return;
    draftPathMutationRef.current = null;
    artwork.innerHTML = svgInnerMarkup;
  }, [svgInnerMarkup]);

  useLayoutEffect(() => {
    const shapes = artworkRef.current?.querySelectorAll<SVGElement>(
      "path, rect, circle, ellipse, polygon, polyline, line",
    );
    const candidate =
      draftD !== null && activeSummary
        ? shapes?.[activeSummary.pathIndex]
        : undefined;
    const target =
      candidate?.tagName.toLowerCase() === "path"
        ? (candidate as SVGPathElement)
        : null;
    const previous = draftPathMutationRef.current;

    if (previous && previous.element !== target) {
      if (previous.originalD === null) {
        previous.element.removeAttribute("d");
      } else {
        previous.element.setAttribute("d", previous.originalD);
      }
      draftPathMutationRef.current = null;
    }

    if (!target || draftD === null) {
      return;
    }

    if (!draftPathMutationRef.current) {
      draftPathMutationRef.current = {
        element: target,
        originalD: target.getAttribute("d"),
      };
    }
    target.setAttribute("d", draftD);
  }, [activeSummary, draftD, svgInnerMarkup]);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(pathUpdateFrameRef.current);
      window.cancelAnimationFrame(optimizationFrameRef.current);
      onSvgTextPreviewChange(null);
    },
    [onSvgTextPreviewChange],
  );

  useEffect(
    () => () => {
      const mutation = draftPathMutationRef.current;
      if (!mutation) {
        return;
      }

      if (mutation.originalD === null) {
        mutation.element.removeAttribute("d");
      } else {
        mutation.element.setAttribute("d", mutation.originalD);
      }
    },
    [],
  );

  function publishPathData(pathIndex: number, nextD: string) {
    const nextSvgText = replacePathData(
      latestSvgTextRef.current,
      pathIndex,
      nextD,
    );
    if (nextSvgText === latestSvgTextRef.current) return;
    latestSvgTextRef.current = nextSvgText;
    onSvgTextChange(nextSvgText);
  }

  function schedulePathData(nextD: string) {
    pendingPathDataRef.current = nextD;
    if (pathUpdateFrameRef.current) return;
    pathUpdateFrameRef.current = window.requestAnimationFrame(() => {
      pathUpdateFrameRef.current = 0;
      const pendingPathData = pendingPathDataRef.current;
      pendingPathDataRef.current = null;
      if (pendingPathData !== null && activeSummary) {
        setPathDraft({ pathIndex: activeSummary.pathIndex, d: pendingPathData });
      }
    });
  }

  function scheduleOptimization(
    pathIndex: number,
    optimizationBaselineD: string,
    nextStrength: number,
  ) {
    pendingOptimizationRef.current = {
      baselineD: optimizationBaselineD,
      pathIndex,
      strength: nextStrength,
    };
    if (optimizationFrameRef.current) return;
    optimizationFrameRef.current = window.requestAnimationFrame(() => {
      optimizationFrameRef.current = 0;
      const pendingOptimization = pendingOptimizationRef.current;
      pendingOptimizationRef.current = null;
      if (!pendingOptimization) return;
      const interaction = optimizationInteractionRef.current;
      if (
        !interaction?.previewActive ||
        interaction.pathIndex !== pendingOptimization.pathIndex
      ) {
        return;
      }
      const nextD = simplifyPathData(
        pendingOptimization.baselineD,
        pendingOptimization.strength,
      );
      setPathDraft({
        pathIndex: pendingOptimization.pathIndex,
        sourceSvgText: latestSvgTextRef.current,
        d: nextD,
      });
      onSvgTextPreviewChange(
        replacePathData(
          latestSvgTextRef.current,
          pendingOptimization.pathIndex,
          nextD,
        ),
      );
    });
  }

  function commitCommands(nextCommands: EditablePathCommand[]) {
    if (!activeSummary) return;
    const nextD = serializePathData(nextCommands);
    setOptimization({
      baselineD: nextD,
      pathIndex: activeSummary.pathIndex,
      resultD: nextD,
      strength: 0,
    });
    setPathDraft(null);
    publishPathData(activeSummary.pathIndex, nextD);
  }

  function beginOptimization() {
    window.cancelAnimationFrame(optimizationFrameRef.current);
    optimizationFrameRef.current = 0;
    pendingOptimizationRef.current = null;
    onSvgTextPreviewChange(null);

    if (!activeSummary || !baselineD) {
      optimizationInteractionRef.current = null;
      return;
    }

    optimizationInteractionRef.current = {
      baselineD,
      pathIndex: activeSummary.pathIndex,
      previewActive: true,
      startingD: activeD,
    };
    setOptimization({
      baselineD,
      pathIndex: activeSummary.pathIndex,
      resultD: activeD,
      strength,
    });
  }

  function updateOptimization(nextStrength: number) {
    const interaction = optimizationInteractionRef.current;
    if (!interaction) return;
    setOptimization({
      pathIndex: interaction.pathIndex,
      strength: nextStrength,
      baselineD: interaction.baselineD,
      resultD: interaction.startingD,
    });
    scheduleOptimization(
      interaction.pathIndex,
      interaction.baselineD,
      nextStrength,
    );
  }

  function commitOptimization(nextStrength: number) {
    const interaction = optimizationInteractionRef.current;
    if (!interaction) {
      setPathDraft(null);
      onSvgTextPreviewChange(null);
      return;
    }
    optimizationInteractionRef.current = null;
    window.cancelAnimationFrame(optimizationFrameRef.current);
    optimizationFrameRef.current = 0;
    pendingOptimizationRef.current = null;
    const nextD = simplifyPathData(
      interaction.baselineD,
      nextStrength,
    );
    setOptimization({
      baselineD: interaction.baselineD,
      pathIndex: interaction.pathIndex,
      resultD: nextD,
      strength: nextStrength,
    });
    setPathDraft(null);
    onSvgTextPreviewChange(null);
    publishPathData(interaction.pathIndex, nextD);
  }

  function screenDeltaToSvg(dx: number, dy: number, element: SVGSVGElement) {
    const inverse = element.getScreenCTM()?.inverse();
    if (!inverse) return { x: 0, y: 0 };
    return {
      x: (dx * inverse.a + dy * inverse.c) / zoom,
      y: (dx * inverse.b + dy * inverse.d) / zoom,
    };
  }

  function getPairedHandle(commandIndex: number, valueIndex: number) {
    if (valueIndex === 2 && commands[commandIndex]?.type.toUpperCase() === "C") {
      const nextIndex = commandIndex + 1;
      if (commands[nextIndex]?.type.toUpperCase() === "C") return { commandIndex: nextIndex, valueIndex: 0 };
    }
    if (valueIndex === 0 && commands[commandIndex]?.type.toUpperCase() === "C") {
      const previousIndex = commandIndex - 1;
      if (commands[previousIndex]?.type.toUpperCase() === "C") return { commandIndex: previousIndex, valueIndex: 2 };
    }
    return null;
  }

  function beginPointDrag(event: PointerEvent<SVGCircleElement>, commandIndex: number, valueIndex: number, axis: "x" | "y" | "both" = "both", allowPair = false) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pair = allowPair ? getPairedHandle(commandIndex, valueIndex) : null;
    dragRef.current = { pointerId: event.pointerId, commandIndex, valueIndex, axis, startX: event.clientX, startY: event.clientY, values: [...commands[commandIndex].values], commands: commands.map((command) => ({ ...command, values: [...command.values] })), pairedCommandIndex: pair?.commandIndex, pairedValueIndex: pair?.valueIndex, pairedValues: pair ? [...commands[pair.commandIndex].values] : undefined, nextD: displayedD };
  }

  function beginCurveDragFromAnchor(
    event: PointerEvent<SVGCircleElement>,
    commandIndex: number,
  ) {
    const converted = commands.map((command) => ({
      ...command,
      values: [...command.values],
    }));
    convertLineToCubic(converted, commandIndex);
    convertLineToCubic(converted, commandIndex + 1);
    const outgoingIndex =
      converted[commandIndex + 1]?.type.toUpperCase() === "C"
        ? commandIndex + 1
        : null;
    const incomingIndex =
      converted[commandIndex]?.type.toUpperCase() === "C"
        ? commandIndex
        : null;
    const primaryIndex = outgoingIndex ?? incomingIndex;
    if (primaryIndex === null) return false;
    const primaryValueIndex = primaryIndex === outgoingIndex ? 0 : 2;
    const pairIndex = primaryIndex === outgoingIndex ? incomingIndex : outgoingIndex;
    const pairValueIndex = primaryIndex === outgoingIndex ? 2 : 0;
    const nextD = serializePathData(converted);
    const curveAnchor = commandEndpoint(
      converted[commandIndex],
      commandStart(converted, commandIndex),
    );
    if (!curveAnchor) return false;
    const incomingStart = commandStart(converted, commandIndex);
    const outgoingEnd = outgoingIndex === null
      ? null
      : commandEndpoint(
          converted[outgoingIndex],
          commandStart(converted, outgoingIndex),
        );
    const incomingMaxLength =
      incomingIndex === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(
            curveAnchor.x - incomingStart.x,
            curveAnchor.y - incomingStart.y,
          ) * 0.42;
    const outgoingMaxLength = outgoingEnd
      ? Math.hypot(
          outgoingEnd.x - curveAnchor.x,
          outgoingEnd.y - curveAnchor.y,
        ) * 0.42
      : Number.POSITIVE_INFINITY;
    const primaryMaxLength =
      primaryIndex === outgoingIndex ? outgoingMaxLength : incomingMaxLength;
    const pairedMaxLength =
      pairIndex === outgoingIndex ? outgoingMaxLength : incomingMaxLength;
    setPathDraft({
      pathIndex: activeSummary?.pathIndex ?? -1,
      d: nextD,
    });
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      commandIndex: primaryIndex,
      valueIndex: primaryValueIndex,
      axis: "both",
      startX: event.clientX,
      startY: event.clientY,
      values: [...converted[primaryIndex].values],
      commands: converted,
      curveAnchor,
      curveHandleMaxLength: primaryMaxLength,
      pairedCurveHandleMaxLength: pairedMaxLength,
      pairedCommandIndex: pairIndex ?? undefined,
      pairedValueIndex: pairIndex === null ? undefined : pairValueIndex,
      pairedValues: pairIndex === null ? undefined : [...converted[pairIndex].values],
      nextD,
    };
    return true;
  }

  function movePoint(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const rawDelta = screenDeltaToSvg(event.clientX - drag.startX, event.clientY - drag.startY, event.currentTarget);
      let delta = rawDelta;
      if (drag.curveAnchor) {
        const requestedLength = Math.hypot(rawDelta.x, rawDelta.y);
        const maxLength = event.metaKey && !event.altKey
          ? Math.min(
              drag.curveHandleMaxLength ?? Number.POSITIVE_INFINITY,
              drag.pairedCurveHandleMaxLength ?? Number.POSITIVE_INFINITY,
            )
          : drag.curveHandleMaxLength ?? Number.POSITIVE_INFINITY;
        if (requestedLength > maxLength && requestedLength > 0) {
          const scale = maxLength / requestedLength;
          delta = { x: rawDelta.x * scale, y: rawDelta.y * scale };
        }
      }
      const next = drag.commands.map((command) => ({ ...command, values: [...command.values] }));
      next[drag.commandIndex].values = [...drag.values];
      if (drag.curveAnchor) {
        next[drag.commandIndex].values[drag.valueIndex] =
          drag.curveAnchor.x + delta.x;
        next[drag.commandIndex].values[drag.valueIndex + 1] =
          drag.curveAnchor.y + delta.y;
      } else {
        if (drag.axis !== "y") next[drag.commandIndex].values[drag.valueIndex] += delta.x;
        if (drag.axis !== "x") next[drag.commandIndex].values[drag.valueIndex + (drag.axis === "y" ? 0 : 1)] += delta.y;
      }
      if (
        event.metaKey &&
        !event.altKey &&
        drag.pairedCommandIndex !== undefined &&
        drag.pairedValueIndex !== undefined &&
        drag.pairedValues
      ) {
        next[drag.pairedCommandIndex].values = [...drag.pairedValues];
        next[drag.pairedCommandIndex].values[drag.pairedValueIndex] =
          drag.curveAnchor
            ? drag.curveAnchor.x - delta.x
            : drag.pairedValues[drag.pairedValueIndex] - delta.x;
        next[drag.pairedCommandIndex].values[drag.pairedValueIndex + 1] =
          drag.curveAnchor
            ? drag.curveAnchor.y - delta.y
            : drag.pairedValues[drag.pairedValueIndex + 1] - delta.y;
      }
      drag.nextD = serializePathData(next);
      schedulePathData(drag.nextD);
      return;
    }
    const activePan = panRef.current;
    if (activePan?.pointerId === event.pointerId) {
      const inverse = event.currentTarget.getScreenCTM()?.inverse();
      if (!inverse) return;
      const dx = event.clientX - activePan.x;
      const dy = event.clientY - activePan.y;
      setViewport((current) => ({
        ...current,
        pan: {
          x: activePan.originX + dx * inverse.a + dy * inverse.c,
          y: activePan.originY + dx * inverse.b + dy * inverse.d,
        },
      }));
    }
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      window.cancelAnimationFrame(pathUpdateFrameRef.current);
      pathUpdateFrameRef.current = 0;
      pendingPathDataRef.current = null;
      commitCommands(parsePathData(dragRef.current.nextD));
      dragRef.current = null;
    }
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const canvas = event.currentTarget.querySelector(".svg-edit-canvas");
    if (!(canvas instanceof SVGSVGElement)) return;
    const inverse = canvas.getScreenCTM()?.inverse();
    if (!inverse) return;
    const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    setViewport((current) => {
      const nextZoom = Math.max(
        0.2,
        Math.min(8, current.zoom * Math.exp(-event.deltaY * 0.0015)),
      );
      const scale = nextZoom / current.zoom;
      return {
        zoom: nextZoom,
        pan: {
          x: pointer.x - (pointer.x - current.pan.x) * scale,
          y: pointer.y - (pointer.y - current.pan.y) * scale,
        },
      };
    });
  }

  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom}) translate(${-viewX} ${-viewY})`;
  const onlyPathSelected = selectedPathIndexes.length === 1 && activeSummary?.tagName === "path";

  return (
    <div className="svg-editor-panel">
      <div
        className="svg-editor-stage"
        onWheel={handleWheel}
        style={{ backgroundColor }}
      >
        <svg
          className="svg-edit-canvas"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y };
          }}
          onPointerMove={movePoint}
          onPointerUp={endPointer}
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        >
          <g ref={artworkRef} transform={transform} />
          {onlyPathSelected ? (
            <g className="svg-path-overlay" transform={transform}>
              <path className="svg-selected-path" d={displayedD} />
              {selectedGeometry ? selectedHandles.map((handle) => <line className="svg-handle-line" key={`line-${handle.commandIndex}-${handle.key}`} x1={selectedGeometry.end.x} x2={handle.point.x} y1={selectedGeometry.end.y} y2={handle.point.y} />) : null}
              {selectedHandles.map((handle) => <circle className="svg-curve-handle" cx={handle.point.x} cy={handle.point.y} key={`${handle.commandIndex}-${handle.key}`} onPointerDown={(event) => beginPointDrag(event, handle.commandIndex, handle.valueIndex, "both", true)} r={4 / zoom} />)}
              {geometry.flatMap((item) => [
                <circle className="svg-anchor" cx={item.end.x} cy={item.end.y} key={`anchor-${item.commandIndex}`} onPointerDown={(event) => {
                  const type = commands[item.commandIndex].type.toUpperCase();
                  const valueIndex = type === "C" ? 4 : ["S", "Q"].includes(type) ? 2 : type === "A" ? 5 : 0;
                  if (activeSummary) setSelectedAnchor({ pathIndex: activeSummary.pathIndex, commandIndex: item.commandIndex });
                  if ((event.metaKey || event.altKey) && beginCurveDragFromAnchor(event, item.commandIndex)) return;
                  beginPointDrag(event, item.commandIndex, valueIndex, type === "H" ? "x" : type === "V" ? "y" : "both");
                }} data-selected={selectedCommandIndex === item.commandIndex ? "true" : undefined} r={(selectedCommandIndex === item.commandIndex ? 6 : 4.5) / zoom} />,
              ])}
            </g>
          ) : null}
        </svg>
        {!onlyPathSelected ? <div className="svg-editor-empty">{t("Select one path layer to edit its anchors.")}</div> : null}
      </div>
      <div
        aria-disabled={!onlyPathSelected}
        className={onlyPathSelected ? "svg-optimize-popover" : "svg-optimize-popover disabled"}
      >
        <span className="svg-optimize-label">
          <Sparkles size={13} />
          {t("Optimize anchors")}
        </span>
        <span className="svg-optimize-input">
          <ScrubbableNumberField
            max={100}
            min={0}
            onChange={updateOptimization}
            onChangeEnd={commitOptimization}
            onChangeStart={beginOptimization}
            step={1}
            unit="%"
            value={strength}
          />
        </span>
      </div>
    </div>
  );
}
