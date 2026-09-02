'use client'

import { useEffect } from 'react'

import CameraAccessOverlay from './ui/CameraAccessOverlay'
import CameraPreviewCanvas from './ui/CameraPreviewCanvas'
import IdCardScanGuide from './ui/IdCardScanGuide'
import IdCardScannerFooter from './ui/IdCardScannerFooter'
import IdCardScannerHeader from './ui/IdCardScannerHeader'
import ScanFailedModal from './ui/ScanFailedModal'
import useIdCardScanner from './useIdCardScanner'
import type { ScreenOrientationMode } from './useScreenOrientation'
import useScreenOrientation from './useScreenOrientation'
import type { IExportRotation } from './videoRect'

import type { IIdCardAnalyzeCode } from '@/api/postIdCardAnalyzeApi'
import cn from '@/utils/cn'
interface IIdCardScannerProps {
  onBack: () => void
  onSuccess: () => void
  onVerify: (capturedImage: string) => Promise<IIdCardAnalyzeCode>
}

const getLockedRotation = (isLockedLandscape: boolean, isLandscapeLeft: boolean): 0 | 90 | -90 => {
  if (!isLockedLandscape) return 0
  return isLandscapeLeft ? 90 : -90
}

const getCaptureRotation = (
  mode: ScreenOrientationMode,
  isViewportLandscape: boolean,
  isLockedLandscape: boolean,
): IExportRotation => {
  if (mode === 'upside-down') return 180
  if (isViewportLandscape) return 0
  if (!isLockedLandscape) return 270
  return mode === 'landscape-left' ? 270 : 90
}

const IdCardScanner = ({ onBack, onSuccess, onVerify }: IIdCardScannerProps) => {
  const { mode, isViewportLandscape, isLockedLandscape, isViewportUpsideDown } = useScreenOrientation()
  const isPhysicallyUpsideDown = mode === 'upside-down'
  const isUpsideDown = isPhysicallyUpsideDown && !isViewportUpsideDown
  const lockedRotation = getLockedRotation(isLockedLandscape, mode === 'landscape-left')
  const captureRotation = getCaptureRotation(mode, isViewportLandscape, isLockedLandscape)

  const {
    scanState,
    cameraState,
    cameraError,
    cameraErrorType,
    videoRef,
    guideCanvasRef,
    focusCameraAtPoint,
    retryCamera,
    retryScan,
    scannerStatus,
  } = useIdCardScanner({
    captureRotation,
    onScanSuccess: onSuccess,
    verifyIdCardImage: onVerify,
  })

  // Overlay layout changed without a viewport resize (locked-landscape counter-rotation) —
  // nudge listeners that cache frame geometry (e.g. detection ROI) to recompute.
  // Delayed past the 300ms frame/header transitions so the cached rect is the settled one.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 350)
    return () => {
      window.clearTimeout(timer)
    }
  }, [mode])

  return (
    <section
      className={cn(
        'relative isolate flex h-dvh w-full flex-col overflow-hidden bg-black',
        isUpsideDown && 'rotate-180',
      )}
    >
      {/* NOTE: The video stays mounted (stream source, detection sampling, ROI rect mapping)
          but invisible — the camera is displayed through CameraPreviewCanvas so the
          frame never depends on the browser's async object-fit refit during rotation. */}
      <video
        ref={videoRef}
        aria-label="video feed from camera"
        autoPlay
        className="invisible absolute inset-0 size-full object-cover"
        disablePictureInPicture
        muted
        playsInline
      />

      <CameraPreviewCanvas onFocusPoint={focusCameraAtPoint} videoRef={videoRef} />

      <div className="pointer-events-none absolute inset-0 bg-black/5" />

      <IdCardScannerHeader isViewportLandscape={isViewportLandscape} mode={mode} onBack={onBack} />

      <IdCardScanGuide
        guideCanvasRef={guideCanvasRef}
        isSuccess={scanState.phase === 'success'}
        isViewportLandscape={isViewportLandscape}
        orientation={mode}
        scannerStatus={scannerStatus}
      />

      <IdCardScannerFooter
        isViewportLandscape={isViewportLandscape}
        mode={mode}
        verificationWarning={scanState.phase === 'warning' ? scanState.code : undefined}
      />

      {scanState.phase === 'verifying' && (
        <div className="pointer-events-none absolute inset-0 z-[35] grid place-items-center">
          <div
            className={cn(
              'flex items-center gap-3 rounded-full bg-black/60 px-5 py-3',
              lockedRotation === 90 && 'rotate-90',
              lockedRotation === -90 && '-rotate-90',
            )}
          >
            <div className="size-5 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            <span className="font-graphik-medium text-sm text-white">กำลังตรวจสอบบัตร…</span>
          </div>
        </div>
      )}

      {scanState.phase === 'failed' &&
        (scanState.code === 'RECAPTURE' ? (
          <ScanFailedModal mode={mode} onBack={onBack} onRetry={retryScan} />
        ) : (
          <ScanFailedModal mode={mode} onBack={onBack} onRetry={retryScan} warningCode={scanState.code} />
        ))}

      <CameraAccessOverlay
        cameraError={cameraError}
        cameraErrorType={cameraErrorType}
        cameraState={cameraState}
        lockedRotation={lockedRotation}
        onBack={onBack}
        onRetryCamera={() => void retryCamera()}
      />
    </section>
  )
}

export default IdCardScanner
