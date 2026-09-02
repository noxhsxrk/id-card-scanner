'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import classifyCameraError, { type ICameraErrorType } from './classifyCameraError'
import mapCameraErrorToMessage from './mapCameraErrorToMessage'
import queryCameraPermissionState from './queryCameraPermissionState'
import requestRearCameraStream from './requestRearCameraStream'

type ICameraAccessState = 'idle' | 'requesting' | 'ready' | 'error'

const MAX_DEBUG_LOGS = 18

const formatLogTime = (): string => new Date().toLocaleTimeString('th-TH', { hour12: false })

const summarizeTrackSettings = (settings: MediaTrackSettings): string => {
  const summary = {
    deviceId: settings.deviceId,
    facingMode: settings.facingMode,
    frameRate: settings.frameRate,
    height: settings.height,
    width: settings.width,
    zoom: (settings as MediaTrackSettings & { zoom?: number }).zoom,
  }

  return JSON.stringify(summary)
}

const getCameraLabel = (devices: MediaDeviceInfo[], deviceId?: string): string =>
  devices.find((device) => device.deviceId === deviceId)?.label || deviceId || 'unknown camera'

const useCameraStream = (videoRef: RefObject<HTMLVideoElement | null>) => {
  const [cameraState, setCameraState] = useState<ICameraAccessState>('idle')
  const [cameraError, setCameraError] = useState<string>()
  const [cameraErrorType, setCameraErrorType] = useState<ICameraErrorType>()
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [activeCameraId, setActiveCameraId] = useState<string>()
  const [cameraDebugLogs, setCameraDebugLogs] = useState<string[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const cameraRequestIdRef = useRef(0)

  const appendDebugLog = useCallback((message: string) => {
    setCameraDebugLogs((logs) => [`${formatLogTime()} ${message}`, ...logs].slice(0, MAX_DEBUG_LOGS))
  }, [])

  const refreshCameraDevices = useCallback(async () => {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
      setCameraDevices(devices)
      appendDebugLog(`devices: ${devices.map((device, index) => `${index + 1}:${device.label || device.deviceId}`).join(' | ')}`)
      return devices
    } catch (error) {
      appendDebugLog(`enumerateDevices failed: ${error instanceof Error ? error.name : String(error)}`)
      return []
    }
  }, [appendDebugLog])

  const stopCamera = useCallback(() => {
    cameraRequestIdRef.current += 1
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [videoRef])

  const startCamera = useCallback(async (deviceId?: string) => {
    stopCamera()
    const requestId = cameraRequestIdRef.current
    setActiveCameraId(deviceId)
    setCameraState('requesting')
    appendDebugLog(`opening: ${deviceId || 'auto rear camera'}`)

    try {
      const stream = await requestRearCameraStream(deviceId)
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        appendDebugLog('error: video element is missing')
        setCameraError('เกิดข้อผิดพลาดในการเปิดกล้อง กรุณาลองใหม่อีกครั้ง')
        setCameraState('error')
        return
      }

      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()

      if (requestId !== cameraRequestIdRef.current) return

      const devices = await refreshCameraDevices()
      if (requestId !== cameraRequestIdRef.current) return

      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings()
      const activeDeviceId = settings?.deviceId
      setActiveCameraId(activeDeviceId)
      appendDebugLog(`active: ${getCameraLabel(devices, activeDeviceId)}`)
      if (settings) appendDebugLog(`settings: ${summarizeTrackSettings(settings)}`)

      setCameraState('ready')
    } catch (error) {
      if (requestId !== cameraRequestIdRef.current) return

      appendDebugLog(`error: ${error instanceof Error ? `${error.name} ${error.message}` : String(error)}`)
      if (error instanceof TypeError) {
        stopCamera()
        setCameraError('เบราว์เซอร์นี้ไม่รองรับ Camera API กรุณาใช้ Safari หรือ Chrome รุ่นล่าสุด')
        setCameraErrorType('generic')
      } else {
        // Query the permission state AFTER the failure — WebKit only settles it
        // once the first getUserMedia request has been made. A NotAllowedError
        // while still 'prompt' means the prompt never appeared (host app does
        // not allow camera); 'denied' means the user refused it before.
        const permissionState = await queryCameraPermissionState()
        if (requestId !== cameraRequestIdRef.current) return
        stopCamera()
        setCameraError(mapCameraErrorToMessage(error))
        setCameraErrorType(classifyCameraError(error, permissionState))
      }
      setCameraState('error')
    }
  }, [appendDebugLog, refreshCameraDevices, stopCamera, videoRef])

  const switchCamera = useCallback(
    (deviceId: string) => {
      void startCamera(deviceId)
    },
    [startCamera],
  )

  useEffect(() => {
    const visibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const video = videoRef.current
      if (video && video.paused && streamRef.current?.active) {
        void video.play().catch(() => void startCamera())
      }
    }

    document.addEventListener('visibilitychange', visibilityChange)
    // Camera is started on user request only — the overlay shows an intro screen first
    // so the native permission prompt appears in a proper user-gesture context.

    return () => {
      document.removeEventListener('visibilitychange', visibilityChange)
      stopCamera()
    }
  }, [startCamera, stopCamera, videoRef])

  return {
    activeCameraId,
    cameraError,
    cameraErrorType,
    cameraDebugLogs,
    cameraDevices,
    cameraState,
    retryCamera: startCamera,
    switchCamera,
  }
}

export default useCameraStream
