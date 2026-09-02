'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { focusStreamAtPoint, type ICameraFocusPoint } from './camera/requestRearCameraStream'
import useCameraStream from './camera/useCameraStream'
import type { IScannerStatus } from './detection/detectIdCard'
import useIdCardDetection from './detection/useIdCardDetection'
import ID_CARD_SCANNER_CONFIG from './idCardScannerConfig'
import {
  mapGuideRectToVideoRect,
  expandCaptureRect,
  exportVideoRectAsJpeg,
  type IExportRotation,
  type IVideoRect,
} from './videoRect'

import type { IIdCardAnalyzeCode, IIdCardAnalyzeErrorCode, IIdCardAnalyzeWarningCode } from '@/api/postIdCardAnalyzeApi'

type IIdCardScanEvent =
  | { type: 'CAMERA_READY' }
  | { errorMessage: string; type: 'CAMERA_ERROR' }
  | { status: IScannerStatus; type: 'SCANNER_STATUS_UPDATED' }
  | { type: 'CAPTURE_COMPLETE' }
  | { type: 'VERIFY_SUCCESS' }
  | { code: IIdCardAnalyzeErrorCode; type: 'VERIFY_FAILED' }
  | { code: IIdCardAnalyzeWarningCode; type: 'VERIFY_WARNING' }
  | { type: 'WARNING_TIMEOUT_COMPLETE' }
  | { type: 'CAPTURE_RESET' }

interface IUseIdCardScannerOptions {
  captureRotation?: IExportRotation
  onScanSuccess: () => void
  verifyIdCardImage: (capturedImage: string) => Promise<IIdCardAnalyzeCode>
}

const nextScanState = (state: IIdCardScanState, event: IIdCardScanEvent): IIdCardScanState => {
  switch (state.phase) {
    case 'opening-camera':
      switch (event.type) {
        case 'CAMERA_READY':
          return { phase: 'detecting', scannerStatus: 'searching' }
        case 'CAMERA_ERROR':
          return { phase: 'camera-error', errorMessage: event.errorMessage }
        default:
          return state
      }

    case 'camera-error':
      switch (event.type) {
        case 'CAMERA_READY':
          return { phase: 'detecting', scannerStatus: 'searching' }
        default:
          return state
      }

    case 'detecting':
      switch (event.type) {
        case 'SCANNER_STATUS_UPDATED':
          return { phase: 'detecting', scannerStatus: event.status }
        case 'CAPTURE_COMPLETE':
          return { phase: 'verifying' }
        case 'CAMERA_ERROR':
          return { phase: 'camera-error', errorMessage: event.errorMessage }
        default:
          return state
      }

    case 'verifying':
      switch (event.type) {
        case 'VERIFY_SUCCESS':
          return { phase: 'success' }
        case 'VERIFY_FAILED':
          return { phase: 'failed', code: event.code }
        default:
          return state
      }

    case 'warning':
      switch (event.type) {
        case 'WARNING_TIMEOUT_COMPLETE':
          return { phase: 'detecting', scannerStatus: 'searching' }
        case 'CAMERA_ERROR':
          return { phase: 'camera-error', errorMessage: event.errorMessage }
        default:
          return state
      }

    case 'failed':
      switch (event.type) {
        case 'CAMERA_ERROR':
          return { phase: 'camera-error', errorMessage: event.errorMessage }
        case 'CAPTURE_RESET':
          return { phase: 'detecting', scannerStatus: 'searching' }
        default:
          return state
      }

    case 'success':
      return state
  }
}

type IIdCardScanState =
  | { phase: 'opening-camera' }
  | { errorMessage: string; phase: 'camera-error' }
  | { phase: 'detecting'; scannerStatus: IScannerStatus }
  | { phase: 'verifying' }
  | { code: IIdCardAnalyzeWarningCode; phase: 'warning' }
  | { code: IIdCardAnalyzeErrorCode; phase: 'failed' }
  | { phase: 'success' }

const useIdCardScanner = ({ captureRotation = 270, onScanSuccess, verifyIdCardImage }: IUseIdCardScannerOptions) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const guideCanvasRef = useRef<HTMLCanvasElement>(null)

  const [scanState, setScanState] = useState<IIdCardScanState>({ phase: 'opening-camera' })
  const [scannerStatus, setScannerStatus] = useState<IScannerStatus>('searching')
  const capturedRef = useRef(false)
  const capturedImageRef = useRef<string | undefined>(undefined)
  const cooldownUntilRef = useRef(0)
  const guideBoundsRef = useRef<IVideoRect | undefined>(undefined)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const verifyingRef = useRef(false)
  const verifyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const dispatch = useCallback((event: IIdCardScanEvent) => {
    setScanState((prevState) => nextScanState(prevState, event))
  }, [])

  const {
    activeCameraId,
    cameraState,
    cameraError,
    cameraErrorType,
    cameraDebugLogs,
    cameraDevices,
    retryCamera,
    switchCamera,
  } = useCameraStream(videoRef)

  const focusCameraAtPoint = useCallback((point: ICameraFocusPoint) => {
    const stream = videoRef.current?.srcObject
    if (!(stream instanceof MediaStream)) return

    void focusStreamAtPoint(stream, point)
  }, [])

  const onDetectionUpdate = useCallback(
    (status: IScannerStatus) => {
      setScannerStatus(status)
      dispatch({ type: 'SCANNER_STATUS_UPDATED', status })
    },
    [dispatch],
  )

  const { resetDetection } = useIdCardDetection({
    guideRef: guideCanvasRef,
    isEnabled: scanState.phase === 'detecting' && cameraState === 'ready',
    videoRef,
    onDetectionUpdate,
  })

  const retryScan = useCallback(() => {
    capturedRef.current = false
    capturedImageRef.current = undefined
    verifyingRef.current = false
    cooldownUntilRef.current = 0
    resetDetection()
    dispatch({ type: 'CAPTURE_RESET' })
  }, [dispatch, resetDetection])

  useEffect(() => {
    if (cameraState === 'ready') {
      dispatch({ type: 'CAMERA_READY' })
    } else if (cameraState === 'error' && cameraError) {
      dispatch({ type: 'CAMERA_ERROR', errorMessage: cameraError })
    }
  }, [cameraState, cameraError, dispatch])

  useEffect(() => {
    const phase = scanState.phase
    const now = Date.now()

    if (
      phase === 'detecting' &&
      scannerStatus === 'stable' &&
      !capturedRef.current &&
      !verifyingRef.current &&
      now > cooldownUntilRef.current
    ) {
      const video = videoRef.current
      const guide = guideCanvasRef.current
      if (!video || !guide) return

      const bounds = mapGuideRectToVideoRect(video, guide)
      if (!bounds) return

      guideBoundsRef.current = bounds

      const paddedRect = expandCaptureRect(bounds, video)
      const capturedImage = exportVideoRectAsJpeg(video, paddedRect, captureRotation)
      if (!capturedImage) return

      capturedRef.current = true
      capturedImageRef.current = capturedImage
      dispatch({ type: 'CAPTURE_COMPLETE' })
    }
  }, [scanState, scannerStatus, dispatch, captureRotation])

  useEffect(() => {
    if (scanState.phase !== 'verifying') return

    const capturedImage = capturedImageRef.current
    if (!capturedImage) return

    if (verifyingRef.current) return

    verifyingRef.current = true
    let isCancelled = false

    const submitForVerification = async () => {
      const result = await verifyIdCardImage(capturedImage)
      if (isCancelled) return

      if (result === 'PASSED') {
        sessionStorage.setItem('captured_id_card', capturedImage)
        dispatch({ type: 'VERIFY_SUCCESS' })
        successTimerRef.current = setTimeout(() => {
          onScanSuccess()
        }, ID_CARD_SCANNER_CONFIG.successFeedbackDurationMs)
        return
      }

      if (result === 'FAILED' || result === 'RECAPTURE') {
        dispatch({ type: 'VERIFY_FAILED', code: result })
        return
      }

      cooldownUntilRef.current = Date.now() + ID_CARD_SCANNER_CONFIG.retryCooldownMs
      resetDetection()
      capturedRef.current = false
      capturedImageRef.current = undefined
      verifyingRef.current = false
      dispatch({
        type: 'VERIFY_WARNING',
        code: result,
      })
      return
    }

    void submitForVerification()

    return () => {
      isCancelled = true
    }
  }, [scanState.phase, dispatch, verifyIdCardImage, onScanSuccess, resetDetection])

  useEffect(() => {
    if (scanState.phase !== 'verifying') return

    verifyTimerRef.current = setTimeout(() => {
      verifyingRef.current = false
      cooldownUntilRef.current = Date.now() + ID_CARD_SCANNER_CONFIG.retryCooldownMs
      resetDetection()
      capturedRef.current = false
      capturedImageRef.current = undefined
      dispatch({
        type: 'VERIFY_FAILED',
        code: 'FAILED',
      })
    }, ID_CARD_SCANNER_CONFIG.verifyTimeoutMs)

    return () => {
      if (verifyTimerRef.current !== undefined) {
        clearTimeout(verifyTimerRef.current)
        verifyTimerRef.current = undefined
      }
    }
  }, [scanState.phase, dispatch, resetDetection])

  useEffect(() => {
    if (scanState.phase === 'warning') {
      errorTimerRef.current = setTimeout(() => {
        dispatch({ type: 'WARNING_TIMEOUT_COMPLETE' })
      }, ID_CARD_SCANNER_CONFIG.retryCooldownMs)

      return () => {
        if (errorTimerRef.current !== undefined) {
          clearTimeout(errorTimerRef.current)
          errorTimerRef.current = undefined
        }
      }
    }
  }, [scanState.phase, dispatch])

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== undefined) clearTimeout(successTimerRef.current)
      if (errorTimerRef.current !== undefined) clearTimeout(errorTimerRef.current)
      if (verifyTimerRef.current !== undefined) clearTimeout(verifyTimerRef.current)
    }
  }, [])

  return {
    activeCameraId,
    cameraError,
    cameraErrorType,
    cameraDebugLogs,
    cameraDevices,
    cameraState,
    guideCanvasRef,
    focusCameraAtPoint,
    retryCamera,
    retryScan,
    scannerStatus,
    scanState,
    switchCamera,
    videoRef,
  }
}

export default useIdCardScanner
