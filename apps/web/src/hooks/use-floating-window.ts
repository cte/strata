import * as React from "react";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";

export interface FloatingWindowGeometry {
  /** Distance from the viewport left edge, in pixels. */
  x: number;
  /** Distance from the viewport top edge, in pixels. */
  y: number;
  /** Expanded window width, in pixels. */
  width: number;
  /** Expanded window height, in pixels. */
  height: number;
  /** Whether the window is collapsed to just its header bar. */
  collapsed: boolean;
}

export interface FloatingWindowController {
  /** Inline `position: fixed` style for the window root element. */
  style: React.CSSProperties;
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  /** Spread onto the element that should initiate a drag (the header). */
  dragHandleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  /** Spread onto the bottom-right resize affordance. */
  resizeHandleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
  };
  isDragging: boolean;
  isResizing: boolean;
}

export interface UseFloatingWindowOptions {
  storageKey: string;
  minWidth?: number;
  minHeight?: number;
  /** Header height kept on-screen while collapsed and used for drag clamping. */
  headerHeight?: number;
  /** Margin kept between the window and the viewport edges. */
  margin?: number;
}

const DEFAULT_MIN_WIDTH = 360;
const DEFAULT_MIN_HEIGHT = 240;
const DEFAULT_HEADER_HEIGHT = 40;
const DEFAULT_MARGIN = 12;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function defaultGeometry(
  minWidth: number,
  minHeight: number,
  margin: number,
): FloatingWindowGeometry {
  const { width: vw, height: vh } = viewportSize();
  const width = clamp(Math.round(vw * 0.42), minWidth, Math.max(minWidth, vw - margin * 2));
  const height = clamp(Math.round(vh * 0.6), minHeight, Math.max(minHeight, vh - margin * 2));
  return {
    width,
    height,
    x: Math.max(margin, vw - width - margin * 2),
    y: Math.max(margin, vh - height - margin * 2),
    collapsed: false,
  };
}

/**
 * Owns the geometry of a draggable, resizable, collapsible floating window.
 * Position/size/collapsed state persist to localStorage and stay clamped
 * inside the viewport across drags, resizes, and window resizes.
 */
export function useFloatingWindow(options: UseFloatingWindowOptions): FloatingWindowController {
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const headerHeight = options.headerHeight ?? DEFAULT_HEADER_HEIGHT;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const [geometry, setGeometry] = useLocalStorageState<FloatingWindowGeometry>(
    options.storageKey,
    () => defaultGeometry(minWidth, minHeight, margin),
  );

  const [isDragging, setIsDragging] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);

  const clampGeometry = React.useCallback(
    (next: FloatingWindowGeometry): FloatingWindowGeometry => {
      const { width: vw, height: vh } = viewportSize();
      const width = clamp(next.width, minWidth, Math.max(minWidth, vw - margin * 2));
      const visibleHeight = next.collapsed ? headerHeight : next.height;
      const x = clamp(next.x, margin, Math.max(margin, vw - width - margin));
      const y = clamp(next.y, margin, Math.max(margin, vh - visibleHeight - margin));
      return { ...next, width, x, y };
    },
    [headerHeight, margin, minHeight, minWidth],
  );

  // Keep the window inside the viewport when the browser window resizes.
  React.useEffect(() => {
    const onResize = () => setGeometry((current) => clampGeometry(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampGeometry, setGeometry]);

  const dragStateRef = React.useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const resizeStateRef = React.useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const onDragPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      // Ignore clicks that originate on interactive controls inside the header.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-no-drag]") !== null) return;
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        startX: geometry.x,
        startY: geometry.y,
      };
      setIsDragging(true);

      const onMove = (move: PointerEvent) => {
        const state = dragStateRef.current;
        if (state === null || move.pointerId !== state.pointerId) return;
        const dx = move.clientX - state.originX;
        const dy = move.clientY - state.originY;
        setGeometry((current) =>
          clampGeometry({ ...current, x: state.startX + dx, y: state.startY + dy }),
        );
      };
      const onUp = (up: PointerEvent) => {
        if (dragStateRef.current?.pointerId !== up.pointerId) return;
        dragStateRef.current = null;
        setIsDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [clampGeometry, geometry.x, geometry.y, setGeometry],
  );

  const onResizePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      resizeStateRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        startWidth: geometry.width,
        startHeight: geometry.height,
      };
      setIsResizing(true);

      const onMove = (move: PointerEvent) => {
        const state = resizeStateRef.current;
        if (state === null || move.pointerId !== state.pointerId) return;
        const dx = move.clientX - state.originX;
        const dy = move.clientY - state.originY;
        const { width: vw, height: vh } = viewportSize();
        setGeometry((current) => {
          const width = clamp(
            state.startWidth + dx,
            minWidth,
            Math.max(minWidth, vw - current.x - margin),
          );
          const height = clamp(
            state.startHeight + dy,
            minHeight,
            Math.max(minHeight, vh - current.y - margin),
          );
          return { ...current, width, height };
        });
      };
      const onUp = (up: PointerEvent) => {
        if (resizeStateRef.current?.pointerId !== up.pointerId) return;
        resizeStateRef.current = null;
        setIsResizing(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [geometry.height, geometry.width, margin, minHeight, minWidth, setGeometry],
  );

  const setCollapsed = React.useCallback(
    (collapsed: boolean) => setGeometry((current) => clampGeometry({ ...current, collapsed })),
    [clampGeometry, setGeometry],
  );
  const toggleCollapsed = React.useCallback(
    () => setGeometry((current) => clampGeometry({ ...current, collapsed: !current.collapsed })),
    [clampGeometry, setGeometry],
  );

  const style: React.CSSProperties = {
    position: "fixed",
    left: geometry.x,
    top: geometry.y,
    width: geometry.width,
    height: geometry.collapsed ? undefined : geometry.height,
  };

  return {
    style,
    collapsed: geometry.collapsed,
    toggleCollapsed,
    setCollapsed,
    dragHandleProps: {
      onPointerDown: onDragPointerDown,
      style: { cursor: isDragging ? "grabbing" : "grab", touchAction: "none" },
    },
    resizeHandleProps: { onPointerDown: onResizePointerDown },
    isDragging,
    isResizing,
  };
}
