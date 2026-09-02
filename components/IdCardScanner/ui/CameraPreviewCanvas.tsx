'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'

import type { ICameraFocusPoint } from '../camera/requestRearCameraStream'

const MAX_PIXEL_RATIO = 3
const FOCUS_INDICATOR_MS = 750

interface IFocusIndicator {
  id: number
  x: number
  y: number
}

interface ICameraPreviewCanvasProps {
  onFocusPoint?: (point: ICameraFocusPoint) => void
  videoRef: RefObject<HTMLVideoElement | null>
}

const mapCanvasPointToVideoPoint = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): ICameraFocusPoint | null => {
  if (!video.videoWidth || !video.videoHeight) return null

  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return null

  const x = clientX - rect.left
  const y = clientY - rect.top
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight)
  const sw = rect.width / scale
  const sh = rect.height / scale
  const sx = (video.videoWidth - sw) / 2
  const sy = (video.videoHeight - sh) / 2

  return {
    x: (sx + x / scale) / video.videoWidth,
    y: (sy + y / scale) / video.videoHeight,
  }
}

/**
 * Mirrors the camera feed onto a canvas that is repainted every animation frame.
 * The draw uses the same central-crop math as object-fit: cover, so the field of
 * view matches the video element in every orientation — and because every frame
 * is drawn from the current geometry, viewport rotations never show the stale
 * letterboxed texture that a plain <video> flashes while the browser refits it.
 */
const CameraPreviewCanvas = ({ onFocusPoint, videoRef }: ICameraPreviewCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [focusIndicator, setFocusIndicator] = useState<IFocusIndicator>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    let frameRequest = 0

    const drawFrame = () => {
      const video = videoRef.current
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return

      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
      const cw = Math.round(w * pixelRatio)
      const ch = Math.round(h * pixelRatio)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, w, h)

      if (
        video &&
        video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        // object-fit: cover equivalent — scale to cover the box, crop centrally
        const scale = Math.max(w / video.videoWidth, h / video.videoHeight)
        const sw = w / scale
        const sh = h / scale
        context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, w, h)
      }

      frameRequest = requestAnimationFrame(drawFrame)
    }

    frameRequest = requestAnimationFrame(drawFrame)
    return () => {
      cancelAnimationFrame(frameRequest)
    }
  }, [videoRef])

  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== undefined) clearTimeout(focusTimerRef.current)
    }
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 z-0 size-full touch-none"
        onPointerDown={(event) => {
          const canvas = canvasRef.current
          const video = videoRef.current
          if (!canvas || !video) return

          const rect = canvas.getBoundingClientRect()
          setFocusIndicator({
            id: Date.now(),
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          })

          if (focusTimerRef.current !== undefined) clearTimeout(focusTimerRef.current)
          focusTimerRef.current = setTimeout(() => {
            setFocusIndicator(undefined)
          }, FOCUS_INDICATOR_MS)

          const point = mapCanvasPointToVideoPoint(canvas, video, event.clientX, event.clientY)
          if (point) onFocusPoint?.(point)
        }}
      />

      {focusIndicator && (
        <div
          key={focusIndicator.id}
          aria-hidden="true"
          className="pointer-events-none absolute z-30 size-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: focusIndicator.x, top: focusIndicator.y }}
        >
          <div className="camera-focus-reticle size-full rounded-md border-2 border-tmn-primary shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_18px_rgba(255,90,0,0.45)]" />
        </div>
      )}
    </>
  )
}

export default CameraPreviewCanvas
