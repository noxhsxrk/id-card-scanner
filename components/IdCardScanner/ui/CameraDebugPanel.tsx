'use client'

interface ICameraDebugPanelProps {
  activeCameraId?: string
  devices: MediaDeviceInfo[]
  logs: string[]
  onSelectCamera: (deviceId: string) => void
}

const getDeviceName = (device: MediaDeviceInfo, index: number): string =>
  device.label || `Camera ${index + 1} (${device.deviceId.slice(0, 8)})`

const CameraDebugPanel = ({ activeCameraId, devices, logs, onSelectCamera }: ICameraDebugPanelProps) => (
  <details
    open
    className="absolute left-3 right-3 top-14 z-40 rounded-lg border border-white/15 bg-neutral-950/85 p-3 text-[11px] text-neutral-100 shadow-lg"
  >
    <summary className="cursor-pointer select-none font-graphik-medium text-xs">Camera debug</summary>

    <div className="mt-2 grid gap-2">
      <label className="grid gap-1">
        <span className="text-neutral-300">Camera</span>
        <select
          className="h-9 rounded-md border border-white/20 bg-neutral-900 px-2 text-xs text-neutral-100 outline-none focus:border-tmn-primary"
          value={activeCameraId ?? ''}
          onChange={(event) => {
            if (event.target.value) onSelectCamera(event.target.value)
          }}
        >
          <option value="" disabled>
            Auto / unknown
          </option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {getDeviceName(device, index)}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-md bg-black/45 p-2 font-mono text-[10px] leading-4 text-neutral-200">
        {logs.length > 0 ? (
          logs.map((log) => (
            <div key={log} className="break-all">
              {log}
            </div>
          ))
        ) : (
          <div className="text-neutral-400">No camera logs yet</div>
        )}
      </div>
    </div>
  </details>
)

export default CameraDebugPanel
