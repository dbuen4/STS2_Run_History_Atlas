export interface Camera {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  isDragging: boolean;
  lastMouseX: number;
  lastMouseY: number;
}

export interface Point {
  x: number;
  y: number;
}

export function createCamera(): Camera {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
    isDragging: false,
    lastMouseX: 0,
    lastMouseY: 0,
  };
}

export function resetCamera(camera: Camera): void {
  camera.x = 0;
  camera.y = 0;
  camera.zoom = 1;
  camera.targetX = 0;
  camera.targetY = 0;
  camera.targetZoom = 1;
  camera.isDragging = false;
  camera.lastMouseX = 0;
  camera.lastMouseY = 0;
}

function getCameraPosition(camera: Camera, useTarget: boolean): Pick<Camera, "x" | "y" | "zoom"> {
  return useTarget
    ? { x: camera.targetX, y: camera.targetY, zoom: camera.targetZoom }
    : { x: camera.x, y: camera.y, zoom: camera.zoom };
}

function getCanvasCoordinates(screenX: number, screenY: number, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: screenX - rect.left,
    y: screenY - rect.top,
  };
}

function canvasToNdc(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): Point {
  return {
    x: (canvasX / canvas.clientWidth) * 2 - 1,
    y: -((canvasY / canvas.clientHeight) * 2 - 1),
  };
}

function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
  canvas: HTMLCanvasElement,
  useTarget: boolean = false
): Point {
  const canvasPoint = getCanvasCoordinates(screenX, screenY, canvas);
  const ndcPoint = canvasToNdc(canvasPoint.x, canvasPoint.y, canvas);
  const position = getCameraPosition(camera, useTarget);

  return {
    x: ndcPoint.x * position.zoom + position.x,
    y: ndcPoint.y * position.zoom + position.y,
  };
}

export function worldToCanvas(
  worldX: number,
  worldY: number,
  camera: Camera,
  canvas: HTMLCanvasElement
): Point {
  const ndcX = (worldX - camera.x) / camera.zoom;
  const ndcY = (worldY - camera.y) / camera.zoom;

  return {
    x: ((ndcX + 1) * canvas.clientWidth) / 2,
    y: ((1 - ndcY) * canvas.clientHeight) / 2,
  };
}

export function stepCamera(camera: Camera, easing: number = 0.16): boolean {
  const nextX = camera.x + (camera.targetX - camera.x) * easing;
  const nextY = camera.y + (camera.targetY - camera.y) * easing;
  const nextZoom = camera.zoom + (camera.targetZoom - camera.zoom) * easing;
  const changed =
    Math.abs(nextX - camera.x) > 0.0001 ||
    Math.abs(nextY - camera.y) > 0.0001 ||
    Math.abs(nextZoom - camera.zoom) > 0.0001;

  camera.x = Math.abs(camera.targetX - nextX) < 0.0001 ? camera.targetX : nextX;
  camera.y = Math.abs(camera.targetY - nextY) < 0.0001 ? camera.targetY : nextY;
  camera.zoom = Math.abs(camera.targetZoom - nextZoom) < 0.0001 ? camera.targetZoom : nextZoom;
  return changed;
}

export function setupCameraControls(
  canvas: HTMLCanvasElement,
  camera: Camera,
  updateCamera: () => void
): void {
  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    camera.isDragging = true;
    canvas.setPointerCapture(event.pointerId);
    const point = getCanvasCoordinates(event.clientX, event.clientY, canvas);
    camera.lastMouseX = point.x;
    camera.lastMouseY = point.y;
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (!camera.isDragging) {
      return;
    }

    const point = getCanvasCoordinates(event.clientX, event.clientY, canvas);
    const dx = point.x - camera.lastMouseX;
    const dy = point.y - camera.lastMouseY;

    camera.targetX -= (dx / canvas.clientWidth) * 2 * camera.targetZoom;
    camera.targetY += (dy / canvas.clientHeight) * 2 * camera.targetZoom;
    camera.lastMouseX = point.x;
    camera.lastMouseY = point.y;
    updateCamera();
  });

  const stopDragging = (event?: PointerEvent): void => {
    camera.isDragging = false;
    if (event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
  canvas.addEventListener("pointerleave", () => {
    if (!camera.isDragging) {
      return;
    }

    camera.isDragging = false;
  });

  canvas.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      event.preventDefault();

      const before = screenToWorld(event.clientX, event.clientY, camera, canvas, true);
      const zoomFactor = Math.exp(event.deltaY * 0.0015);
      camera.targetZoom = Math.max(0.12, Math.min(8, camera.targetZoom * zoomFactor));
      const after = screenToWorld(event.clientX, event.clientY, camera, canvas, true);

      camera.targetX += before.x - after.x;
      camera.targetY += before.y - after.y;
      updateCamera();
    },
    { passive: false }
  );
}
