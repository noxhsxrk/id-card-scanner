import { describe, expect, it } from 'vitest'

import { selectPreferredRearCameraDevice } from './requestRearCameraStream'

const createDevice = (label: string, deviceId = label, kind: MediaDeviceKind = 'videoinput'): MediaDeviceInfo =>
  ({
    deviceId,
    groupId: '',
    kind,
    label,
    toJSON: () => ({}),
  }) satisfies MediaDeviceInfo

describe('selectPreferredRearCameraDevice', () => {
  it('prefers the rear main camera over ultra-wide and front cameras', () => {
    const selected = selectPreferredRearCameraDevice([
      createDevice('Front Camera', 'front'),
      createDevice('Back Camera (ultra-wide-angle)', 'ultra'),
      createDevice('Back Camera (wide-angle)', 'main'),
    ])

    expect(selected?.deviceId).toBe('main')
  })

  it('does not choose unlabeled devices before permission exposes camera labels', () => {
    const selected = selectPreferredRearCameraDevice([createDevice('', 'unknown')])

    expect(selected).toBeUndefined()
  })

  it('ignores non-video devices', () => {
    const selected = selectPreferredRearCameraDevice([
      createDevice('Built-in Microphone', 'mic', 'audioinput'),
      createDevice('Front Camera', 'front'),
    ])

    expect(selected).toBeUndefined()
  })
})
