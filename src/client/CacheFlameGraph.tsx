import type { CacheHistoryEntry } from "../shared/cache";
import { formatZoom } from "../shared/viewport";
import styles from "./CacheFlameGraph.module.css";

const GRAPH_WIDTH = 280;
const ROW_HEIGHT = 18;
const PADDING_X = 18;
const PADDING_Y = 18;
const LEGEND_COUNT = 5;

/**
 * Props for the cache flame graph.
 */
interface CacheFlameGraphProps {
  readonly entries: readonly CacheHistoryEntry[];
}

/**
 * Render a compact flame-graph style view of cached frame proximity.
 */
export function CacheFlameGraph({ entries }: CacheFlameGraphProps) {
  if (entries.length === 0) {
    return (
      <p className={styles.emptyState}>
        No cached frames yet. Explore a bit and the history will light up here.
      </p>
    );
  }

  const graphHeight = PADDING_Y * 2 + entries.length * ROW_HEIGHT;
  const innerWidth = GRAPH_WIDTH - PADDING_X * 2;
  const maxStrength = Math.max(...entries.map((entry) => entry.strength), 1);

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.graph}
        viewBox={`0 0 ${GRAPH_WIDTH} ${graphHeight}`}
        role="img"
        aria-label="Cache proximity flame graph"
      >
        <rect
          className={styles.glow}
          x={PADDING_X - 6}
          y={PADDING_Y - 8}
          width={innerWidth + 12}
          height={entries.length * ROW_HEIGHT + 16}
          rx={14}
        />
        <line
          className={styles.axisLine}
          x1={PADDING_X}
          x2={GRAPH_WIDTH - PADDING_X}
          y1={graphHeight - PADDING_Y}
          y2={graphHeight - PADDING_Y}
        />
        <line
          className={styles.currentLine}
          x1={GRAPH_WIDTH / 2}
          x2={GRAPH_WIDTH / 2}
          y1={PADDING_Y - 4}
          y2={graphHeight - PADDING_Y + 2}
        />
        <text className={styles.axisLabel} x={PADDING_X} y={12}>
          Farther
        </text>
        <text className={styles.axisLabel} x={GRAPH_WIDTH / 2 - 18} y={12}>
          Current
        </text>
        <text className={styles.axisLabel} x={GRAPH_WIDTH - PADDING_X - 26} y={12}>
          Hot
        </text>
        {entries.map((entry, index) => {
          const y = PADDING_Y + (entries.length - index - 1) * ROW_HEIGHT;
          const normalizedStrength = maxStrength > 0 ? entry.strength / maxStrength : 0;
          const width = Math.max(18, normalizedStrength * innerWidth);
          const x = (GRAPH_WIDTH - width) / 2;

          return (
            <g key={`${entry.zoom}-${entry.centerX}-${entry.centerY}-${entry.quality}-${index}`}>
              <title>{createEntryTitle(entry, index)}</title>
              <rect
                x={x}
                y={y}
                width={width}
                height={ROW_HEIGHT - 3}
                rx={8}
                fill={getEntryColor(entry, normalizedStrength)}
                opacity={0.45 + normalizedStrength * 0.5}
              />
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.legend}>
        {entries.slice(0, LEGEND_COUNT).map((entry, index) => (
          <div
            className={styles.legendRow}
            key={`${entry.zoom}-${entry.centerX}-${entry.centerY}-${entry.quality}-legend-${index}`}
          >
            <span
              className={`${styles.legendBadge} ${
                entry.quality === "preview" ? styles.legendBadgePreview : ""
              }`}
            >
              {entry.quality}
            </span>
            <span className={styles.legendLabel}>
              {formatZoom(entry.zoom)} at {entry.centerX.toFixed(4)}, {entry.centerY.toFixed(4)}
            </span>
            <span className={styles.legendValue}>score {entry.score.toFixed(2)}</span>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Build a human-readable tooltip for a graph bar.
 */
function createEntryTitle(entry: CacheHistoryEntry, index: number) {
  return `Frame ${index + 1}: ${entry.quality} ${formatZoom(entry.zoom)}, center ${entry.centerX.toFixed(
    5,
  )}, ${entry.centerY.toFixed(5)}, score ${entry.score.toFixed(3)}`;
}

/**
 * Map frame proximity to a warm flame-like hue.
 */
function getEntryColor(entry: CacheHistoryEntry, normalizedStrength: number) {
  if (entry.isExact) {
    return "hsl(192 94% 72%)";
  }

  if (entry.quality === "preview") {
    const lightness = 44 + normalizedStrength * 18;
    return `hsl(38 100% ${lightness}%)`;
  }

  const hue = 8 + (1 - normalizedStrength) * 42;
  const lightness = 42 + normalizedStrength * 20;
  return `hsl(${hue} 90% ${lightness}%)`;
}
