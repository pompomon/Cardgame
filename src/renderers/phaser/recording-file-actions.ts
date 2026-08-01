// Recording import/export DOM plumbing shared by the lobby and in-game menu
// "Load from File" / "Download Recording" actions. Extracted from
// PhaserRenderer.mount()/openRecordingFilePicker()/handleDownloadRecording().
import type { ControllerApi } from '../../app/controller'
import { BLOB_URL_REVOCATION_DELAY_MS } from './scene-config'

export interface RecordingFileInput {
  click: () => void
  remove: () => void
}

// Hidden file input for "Load from File" recorder action. Phaser lobby and
// menu entry points both trigger it via `click()`.
export function createRecordingFileInput(container: HTMLElement, getController: () => ControllerApi | null): RecordingFileInput {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'application/json,.json'
  fileInput.hidden = true
  fileInput.style.display = 'none'
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      getController()?.importRecordingJson(text)
    } catch {
      getController()?.reportStatus('Failed to read recording file.')
    }
    fileInput.value = ''
  }
  container.appendChild(fileInput)

  return {
    click: () => fileInput.click(),
    remove: () => fileInput.remove(),
  }
}

export function downloadRecordingJson(payload: string): void {
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cardgame-recording-${Date.now()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOCATION_DELAY_MS)
}
