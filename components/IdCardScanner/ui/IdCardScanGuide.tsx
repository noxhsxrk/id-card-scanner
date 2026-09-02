import type { RefObject } from 'react'

import type { IScannerStatus } from '../detection/detectIdCard'
import { ID_CARD_ASPECT_RATIO } from '../detection/idCardDetectionConfig'
import type { ScreenOrientationMode } from '../useScreenOrientation'

import IdCardGuideCanvas from './IdCardGuideCanvas'

import cn from '@/utils/cn'

interface IIdCardScanGuideProps {
  guideCanvasRef: RefObject<HTMLCanvasElement | null>
  isSuccess?: boolean
  isViewportLandscape?: boolean
  orientation: ScreenOrientationMode
  scannerStatus: IScannerStatus
}

// Landscape frame mirrors the card ratio (portrait 53.98/85.6 → landscape 85.6/53.98 ≈ 3:2)
const LANDSCAPE_ASPECT_RATIO = String(1 / ID_CARD_ASPECT_RATIO)

const getFrameRotation = (isLockedLandscape: boolean, isLandscapeLeft: boolean): 0 | 90 | -90 => {
  if (!isLockedLandscape) return 0
  return isLandscapeLeft ? 90 : -90
}

const IdCardScanGuide = ({
  guideCanvasRef,
  isSuccess = false,
  isViewportLandscape = false,
  orientation,
  scannerStatus,
}: IIdCardScanGuideProps) => {
  const isLandscape = orientation === 'landscape-left' || orientation === 'landscape-right'
  const isLandscapeLeft = orientation === 'landscape-left'
  // Auto-rotate locked: the viewport stays portrait, so the overlay counter-rotates to appear upright.
  // A 2:3 element rotated ±90° reads as a 3:2 landscape frame to the user.
  const isLockedLandscape = isLandscape && !isViewportLandscape
  const frameRotation = getFrameRotation(isLockedLandscape, isLandscapeLeft)

  return (
    <div className="pointer-events-none relative z-10 flex flex-1 flex-col items-center justify-center">
      {/* Guide frame — centered between header and footer */}
      <div
        className={cn(
          'relative shrink-0 rounded-2xl transition-[width,height,transform] duration-300 ease-in-out',
          !isLandscape && 'w-4/5 max-w-sm',
          isViewportLandscape && 'h-[72dvh] w-auto max-w-none',
          // 32dvh keeps the rotated AABB (~270px) clear of the 40px/56px header+footer strips
          isLockedLandscape && 'h-[32dvh] w-auto',
        )}
        style={{
          aspectRatio: isViewportLandscape ? LANDSCAPE_ASPECT_RATIO : String(ID_CARD_ASPECT_RATIO),
          transform: `rotate(${frameRotation}deg)`,
        }}
      >
        <IdCardGuideCanvas
          canvasRef={guideCanvasRef}
          facePosition={isLandscape ? 'bottom-right' : 'bottom-left'}
          isSuccess={isSuccess}
          landscapeAspect={isViewportLandscape}
          scannerStatus={scannerStatus}
        />
      </div>
    </div>
  )
}

export default IdCardScanGuide
