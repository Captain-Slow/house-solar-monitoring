import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkAreaComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  MarkAreaComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const THEME = "solar-dark";
let themeReady = false;
let swatch: CanvasRenderingContext2D | undefined;

function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/**
 * Resolves any CSS colour (oklch, hsl, a token value) to the legacy comma-separated `rgba()`
 * string that ECharts/zrender parse: they cannot read `var()` or modern colour syntax. The
 * colour is painted into a 1×1 canvas and read back; `alpha` scales the colour's own alpha.
 */
function resolve(css: string, alpha = 1): string {
  if (!swatch) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("A 2D canvas is required to resolve colours");
    swatch = context;
  }
  swatch.clearRect(0, 0, 1, 1);
  swatch.fillStyle = "rgba(0, 0, 0, 0)";
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = swatch.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${+((a / 255) * alpha).toFixed(3)})`;
}

/** `--chart-N` tokens are bare `H S% L%` triplets; every other token is a full colour. */
function tokenColor(name: string, alpha?: number): string {
  const value = token(name);
  return resolve(name.startsWith("--chart-") ? `hsl(${value})` : value, alpha);
}

/** Builds and registers the `solar-dark` theme from the CSS tokens, once, in the browser. */
function ensureTheme() {
  if (themeReady) return;
  const foreground = tokenColor("--foreground");
  const mutedForeground = tokenColor("--muted-foreground");
  const border = tokenColor("--border");
  const axis = {
    axisLine: { lineStyle: { color: border } },
    axisTick: { lineStyle: { color: border } },
    splitLine: { lineStyle: { color: border } },
    axisLabel: { color: mutedForeground },
  };
  echarts.registerTheme(THEME, {
    color: [
      "--chart-4",
      "--chart-2",
      "--chart-1",
      "--chart-3",
      "--chart-5",
    ].map((name) => tokenColor(name)),
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: token("--app-font-sans").replace(/\s+/g, " "),
      color: mutedForeground,
    },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    line: { lineStyle: { width: 1.5 } },
    legend: { textStyle: { color: foreground } },
    tooltip: {
      backgroundColor: tokenColor("--popover"),
      borderColor: border,
      textStyle: { color: foreground },
    },
    dataZoom: {
      borderColor: border,
      fillerColor: resolve(foreground, 0.1),
      textStyle: { color: mutedForeground },
      handleStyle: { color: mutedForeground, borderColor: border },
      moveHandleStyle: { color: border },
      dataBackground: {
        lineStyle: { color: border },
        areaStyle: { color: border },
      },
      selectedDataBackground: {
        lineStyle: { color: mutedForeground },
        areaStyle: { color: mutedForeground },
      },
    },
  });
  themeReady = true;
}

/**
 * A design token as an explicit `rgba()` string for chart options, optionally scaled to `alpha`.
 * Empty outside a browser, where the renderer is server-rendered in specs and no chart exists.
 */
export function chartColor(name: string, alpha?: number): string {
  if (typeof document === "undefined") return "";
  ensureTheme();
  return tokenColor(name, alpha);
}

export function Chart({
  option,
  label,
}: {
  option: EChartsCoreOption;
  label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    ensureTheme();
    const chart = echarts.init(node, THEME);
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);
  return (
    <div
      ref={element}
      className="h-[360px] w-full shrink-0"
      role="img"
      aria-label={label}
    />
  );
}
