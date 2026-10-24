import { ref } from 'vue'

/**
 * Resizable list-column width, persisted to localStorage.
 *
 * Returns a `width` ref to bind on the column, a `resizing` flag for styling
 * the handle while dragging, and an `onResizeStart` pointerdown handler to put
 * on the drag handle. The handle should sit between the column and the rest.
 */
export function useColResize(
  storageKey: string,
  fallback: number,
  min = 240,
  max = 720
): { width: ReturnType<typeof ref<number>>; resizing: ReturnType<typeof ref<boolean>>; onResizeStart: (e: PointerEvent) => void } {
  const stored = Number(localStorage.getItem(storageKey))
  const width = ref(
    Number.isFinite(stored) && stored > 0 && stored >= min && stored <= max ? stored : fallback
  )
  const resizing = ref(false)

  function onResizeStart(e: PointerEvent): void {
    e.preventDefault()
    resizing.value = true
    const startX = e.clientX
    const startW = width.value
    const prevSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    // keep text selection & cursor stable while dragging
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent): void => {
      width.value = Math.min(max, Math.max(min, startW + ev.clientX - startX))
    }
    const up = (): void => {
      resizing.value = false
      document.body.style.userSelect = prevSelect
      document.body.style.cursor = prevCursor
      localStorage.setItem(storageKey, String(Math.round(width.value)))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return { width, resizing, onResizeStart }
}
