import Phaser from 'phaser'

const SCROLL_WHEEL_MULTIPLIER = 0.8

export function bindScrollableViewport(
  scene: Phaser.Scene,
  viewportBackground: Phaser.GameObjects.Rectangle,
  applyScroll: (deltaY: number) => void,
  shouldHandleWheel?: (pointer: Phaser.Input.Pointer) => boolean,
  shouldStartDrag?: (pointer: Phaser.Input.Pointer) => boolean,
): void {
  const isPointerWithinViewport = (pointer: Phaser.Input.Pointer): boolean => {
    const bounds = viewportBackground.getBounds()
    const withinX = pointer.worldX >= bounds.left && pointer.worldX <= bounds.right
    const withinY = pointer.worldY >= bounds.top && pointer.worldY <= bounds.bottom
    return withinX && withinY
  }

  const handleWheel = (
    pointer: Phaser.Input.Pointer,
    _gameObjects: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void => {
    if (shouldHandleWheel && !shouldHandleWheel(pointer)) {
      return
    }
    if (isPointerWithinViewport(pointer)) {
      applyScroll(deltaY * SCROLL_WHEEL_MULTIPLIER)
    }
  }

  let dragPointerId: number | null = null
  let lastDragY = 0
  const handleViewportPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!isPointerWithinViewport(pointer)) {
      return
    }
    if (shouldStartDrag && !shouldStartDrag(pointer)) {
      return
    }
    dragPointerId = pointer.id
    lastDragY = pointer.worldY
  }
  const handlePointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (dragPointerId !== pointer.id) {
      return
    }
    const deltaY = lastDragY - pointer.worldY
    applyScroll(deltaY)
    lastDragY = pointer.worldY
  }
  const handlePointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (dragPointerId === pointer.id) {
      dragPointerId = null
    }
  }

  scene.input.on('wheel', handleWheel)
  viewportBackground.on('pointerdown', handleViewportPointerDown)
  scene.input.on('pointermove', handlePointerMove)
  scene.input.on('pointerup', handlePointerUp)
  scene.input.on('pointerupoutside', handlePointerUp)
  viewportBackground.once(Phaser.GameObjects.Events.DESTROY, () => {
    dragPointerId = null
    scene.input.off('wheel', handleWheel)
    viewportBackground.off('pointerdown', handleViewportPointerDown)
    scene.input.off('pointermove', handlePointerMove)
    scene.input.off('pointerup', handlePointerUp)
    scene.input.off('pointerupoutside', handlePointerUp)
  })
}
