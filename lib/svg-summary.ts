import type { SvgPathSummary } from "@/lib/types";

const ATTR_PATTERN = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
const TAG_PATTERN = /<\/?[\w:-]+(?:\s[^<>]*?)?>/g;
const STYLE_TAG_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const SHAPE_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
]);

interface ColorContext {
  fill?: string;
  stroke?: string;
}

interface StackEntry {
  tagName: string;
  context: ColorContext;
}

function getAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const openTag = tag.match(/^<[^>]+>/)?.[0] ?? tag;

  for (const match of openTag.matchAll(ATTR_PATTERN)) {
    attributes[match[1]] = match[3] ?? match[4] ?? "";
  }

  return attributes;
}

function getStyleValue(style: string | undefined, key: string): string | undefined {
  if (!style) {
    return undefined;
  }

  const normalizedKey = key.toLowerCase();

  for (const part of style.split(";")) {
    const separatorIndex = part.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim().toLowerCase();
    if (name === normalizedKey) {
      return part.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}

function cleanName(value: string | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function getTitle(tag: string) {
  return cleanName(tag.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
}

function getShapeName(attributes: Record<string, string>, tag: string, index: number) {
  return (
    cleanName(attributes["data-name"]) ||
    cleanName(attributes["inkscape:label"]) ||
    cleanName(attributes["aria-label"]) ||
    getTitle(tag) ||
    cleanName(attributes.id) ||
    `Shape ${index + 1}`
  );
}

function getGeometryDescription(tagName: string, attributes: Record<string, string>) {
  if (tagName === "path") {
    return attributes.d ?? "";
  }

  const keys = [
    "x",
    "y",
    "width",
    "height",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "points",
    "x1",
    "y1",
    "x2",
    "y2",
  ];

  return keys
    .filter((key) => attributes[key])
    .map((key) => `${key}=${attributes[key]}`)
    .join(" ");
}

function getTagName(tag: string) {
  return tag.match(/^<\/?\s*([^\s/>]+)/)?.[1]?.toLowerCase() ?? "";
}

function isClosingTag(tag: string) {
  return /^<\//.test(tag);
}

function isSelfClosingTag(tag: string) {
  return /\/\s*>$/.test(tag);
}

function stripCssComments(cssText: string) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseClassStyleRules(svgText: string): Record<string, ColorContext> {
  const rules: Record<string, ColorContext> = {};

  for (const styleMatch of svgText.matchAll(STYLE_TAG_PATTERN)) {
    const cssText = stripCssComments(styleMatch[1] ?? "");

    for (const ruleMatch of cssText.matchAll(CSS_RULE_PATTERN)) {
      const selectors = ruleMatch[1] ?? "";
      const declarations = ruleMatch[2] ?? "";
      const fill = getStyleValue(declarations, "fill");
      const stroke = getStyleValue(declarations, "stroke");

      if (fill === undefined && stroke === undefined) {
        continue;
      }

      for (const selector of selectors.split(",")) {
        for (const classMatch of selector.matchAll(/\.([_a-zA-Z][\w-]*)/g)) {
          const className = classMatch[1];
          rules[className] = {
            ...rules[className],
            ...(fill !== undefined ? { fill } : {}),
            ...(stroke !== undefined ? { stroke } : {}),
          };
        }
      }
    }
  }

  return rules;
}

function getClassContext(
  className: string | undefined,
  classRules: Record<string, ColorContext>,
): ColorContext {
  if (!className) {
    return {};
  }

  return className
    .split(/\s+/)
    .filter(Boolean)
    .reduce<ColorContext>(
      (context, name) => ({
        ...context,
        ...classRules[name],
      }),
      {},
    );
}

function resolveColorContext(
  inheritedContext: ColorContext,
  attributes: Record<string, string>,
  classRules: Record<string, ColorContext>,
): ColorContext {
  const classContext = getClassContext(attributes.class, classRules);
  const styleFill = getStyleValue(attributes.style, "fill");
  const styleStroke = getStyleValue(attributes.style, "stroke");

  return {
    fill:
      styleFill ??
      attributes.fill ??
      classContext.fill ??
      inheritedContext.fill,
    stroke:
      styleStroke ??
      attributes.stroke ??
      classContext.stroke ??
      inheritedContext.stroke,
  };
}

function getFullShapeTag(svgText: string, openTag: string, startIndex: number) {
  const tagName = getTagName(openTag);
  if (isSelfClosingTag(openTag)) {
    return openTag;
  }

  const closeTagPattern = new RegExp(`</${tagName}\\s*>`, "i");
  const afterOpenTag = startIndex + openTag.length;
  const closeMatch = closeTagPattern.exec(svgText.slice(afterOpenTag));

  if (!closeMatch || closeMatch.index === undefined) {
    return openTag;
  }

  return svgText.slice(
    startIndex,
    afterOpenTag + closeMatch.index + closeMatch[0].length,
  );
}

export function summarizeSvgPaths(svgText: string): SvgPathSummary[] {
  const classRules = parseClassStyleRules(svgText);
  const stack: StackEntry[] = [];
  const summaries: SvgPathSummary[] = [];

  for (const match of svgText.matchAll(TAG_PATTERN)) {
    const tag = match[0];
    const tagName = getTagName(tag);

    if (!tagName || tagName.startsWith("!")) {
      continue;
    }

    if (isClosingTag(tag)) {
      let stackIndex = -1;
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tagName === tagName) {
          stackIndex = index;
          break;
        }
      }

      if (stackIndex !== -1) {
        stack.length = stackIndex;
      }

      continue;
    }

    const attributes = getAttributes(tag);
    const inheritedContext = stack[stack.length - 1]?.context ?? {};
    const context = resolveColorContext(
      inheritedContext,
      attributes,
      classRules,
    );

    if (SHAPE_TAGS.has(tagName)) {
      const pathIndex = summaries.length;
      const fullTag = getFullShapeTag(svgText, tag, match.index ?? 0);

      summaries.push({
        pathIndex,
        name: getShapeName(attributes, fullTag, pathIndex),
        tagName,
        attributes,
        fill: context.fill ?? "",
        stroke: context.stroke ?? "",
        d: getGeometryDescription(tagName, attributes),
      });

      continue;
    }

    if (!isSelfClosingTag(tag)) {
      stack.push({ tagName, context });
    }
  }

  return summaries;
}
