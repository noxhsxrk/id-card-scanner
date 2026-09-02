/**
 * NOTE: Request the rear camera at a resolution sharp enough for OCR/edge
 * detection. The `ideal` value is a hint, so browsers can fall back gracefully.
 *
 * Multi-lens Android devices sometimes resolve `facingMode: environment` to an
 * ultra-wide/macro/depth lens. We first request permission, then use device
 * labels exposed after permission to reopen the likely rear main camera.
 */
const FOCUS_MODES = ['continuous', 'auto', 'single-shot'] as const

const REAR_CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 3840 },
  height: { ideal: 2160 },
  aspectRatio: { ideal: 16 / 9 },
  frameRate: { ideal: 30, max: 30 },
}

type FocusMode = (typeof FOCUS_MODES)[number]

interface IFocusCapabilities extends MediaTrackCapabilities {
  focusMode?: FocusMode[]
  pointsOfInterest?: ICameraFocusPoint[]
  zoom?: { max?: number; min?: number; step?: number }
}

interface IFocusConstraints extends MediaTrackConstraintSet {
  focusMode?: FocusMode
  pointsOfInterest?: ICameraFocusPoint[]
  zoom?: number
}

export interface ICameraFocusPoint {
  x: number
  y: number
}

const stopStream = (stream: MediaStream): void => {
  stream.getTracks().forEach((track) => track.stop())
}

const isExpectedCameraError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' ||
    error.name === 'PermissionDeniedError' ||
    error.name === 'NotFoundError' ||
    error.name === 'DevicesNotFoundError' ||
    error.name === 'NotReadableError' ||
    error.name === 'TrackStartError')

const scoreRearCameraDevice = (device: MediaDeviceInfo): number => {
  const label = device.label.toLowerCase()
  let score = 0

  if (device.kind !== 'videoinput') return Number.NEGATIVE_INFINITY

  if (/\b(back|rear|environment|world)\b/.test(label)) score += 40
  if (/\b(main|primary|1x|wide angle|wide-angle)\b/.test(label)) score += 20
  if (/\b(front|user|face|selfie)\b/.test(label)) score -= 100
  if (/\b(ultra|0\.5x|macro|depth|tele|telephoto|portrait)\b/.test(label)) score -= 35

  return score
}

export const selectPreferredRearCameraDevice = (devices: MediaDeviceInfo[]): MediaDeviceInfo | undefined =>
  devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({ device, index, score: scoreRearCameraDevice(device) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.device

const getPreferredRearCameraDevice = async (): Promise<MediaDeviceInfo | undefined> => {
  try {
    return selectPreferredRearCameraDevice(await navigator.mediaDevices.enumerateDevices())
  } catch {
    return undefined
  }
}

/**
 * Webviews commonly start the rear camera in manual focus, leaving the feed
 * soft until the user taps. Force continuous autofocus when the hardware
 * exposes it — best-effort only, never blocking the stream on failure.
 */
const applyAutofocus = async (stream: MediaStream): Promise<void> => {
  const track = stream.getVideoTracks()[0]
  if (!track) return

  try {
    const capabilities = track.getCapabilities() as IFocusCapabilities
    const modes = capabilities.focusMode
    if (!modes || modes.length === 0) return

    const mode = FOCUS_MODES.find((candidate) => modes.includes(candidate))
    if (!mode) return

    await track.applyConstraints({
      advanced: [{ focusMode: mode } satisfies IFocusConstraints],
    } as unknown as MediaTrackConstraints)
  } catch {
    // Autofocus is a soft hint — ignore unsupported/denied focus requests.
  }
}

const clampFocusPoint = ({ x, y }: ICameraFocusPoint): ICameraFocusPoint => ({
  x: Math.min(Math.max(x, 0), 1),
  y: Math.min(Math.max(y, 0), 1),
})

export const focusStreamAtPoint = async (
  stream: MediaStream | null | undefined,
  point: ICameraFocusPoint = { x: 0.5, y: 0.5 },
): Promise<void> => {
  const track = stream?.getVideoTracks()[0]
  if (!track) return

  try {
    const capabilities = track.getCapabilities() as IFocusCapabilities
    const modes = capabilities.focusMode ?? []
    const focusMode = (['single-shot', 'auto', 'continuous'] as const).find((candidate) => modes.includes(candidate))
    const focusConstraints: IFocusConstraints = {
      pointsOfInterest: [clampFocusPoint(point)],
    }

    if (focusMode) {
      focusConstraints.focusMode = focusMode
    }

    await track.applyConstraints({
      advanced: [focusConstraints],
    } as unknown as MediaTrackConstraints)
  } catch {
    // Android camera stacks differ widely; unsupported focus points must not break scanning.
  }
}

const applyDefaultZoom = async (stream: MediaStream): Promise<void> => {
  const track = stream.getVideoTracks()[0]
  if (!track) return

  try {
    const capabilities = track.getCapabilities() as IFocusCapabilities
    const min = capabilities.zoom?.min
    const max = capabilities.zoom?.max
    if (typeof min !== 'number' || typeof max !== 'number' || max <= min) return

    const zoom = Math.min(Math.max(1.25, min), max)
    await track.applyConstraints({
      advanced: [{ zoom } satisfies IFocusConstraints],
    } as unknown as MediaTrackConstraints)
  } catch {
    // Zoom is only a hint to avoid ultra-wide softness on Android multi-lens cameras.
  }
}

const tuneStreamForScanning = async (stream: MediaStream): Promise<void> => {
  await applyAutofocus(stream)
  await applyDefaultZoom(stream)
  await focusStreamAtPoint(stream)
}

const requestRearCameraStream = async (): Promise<MediaStream> => {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: REAR_CAMERA_CONSTRAINTS,
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    const preferredDevice = await getPreferredRearCameraDevice()
    const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId

    if (preferredDevice?.deviceId && preferredDevice.deviceId !== activeDeviceId) {
      try {
        const preferredStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...REAR_CAMERA_CONSTRAINTS,
            deviceId: { exact: preferredDevice.deviceId },
          },
        })
        stopStream(stream)
        await tuneStreamForScanning(preferredStream)
        return preferredStream
      } catch {
        // Keep the already working rear camera if deviceId selection is rejected.
      }
    }

    await tuneStreamForScanning(stream)
    return stream
  } catch (error) {
    if (isExpectedCameraError(error)) {
      throw error
    }

    const fallbackStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    })
    await tuneStreamForScanning(fallbackStream)
    return fallbackStream
  }
}

export default requestRearCameraStream
