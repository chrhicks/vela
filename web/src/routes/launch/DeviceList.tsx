import styles from './DeviceList.module.css'
import type { Device } from './stub.ts'

interface DeviceListProps {
  readonly devices: ReadonlyArray<Device>
}

export function DeviceList({ devices }: DeviceListProps) {
  return (
    <dl className={styles.devices}>
      {devices.map(device => (
        <div key={device.name} className={styles.device}>
          <div className={styles.row}>
            <dt className={styles.name}>{device.name}</dt>
            <dd className={styles.state}>{device.state}</dd>
          </div>

          {device.changes.map((change, index) => (
            <div key={`${change.property}-${index}`} className={`${styles.row} ${styles.change}`}>
              <dt>{change.property}</dt>
              <dd>
                {change.from} → {change.to}
              </dd>
            </div>
          ))}
        </div>
      ))}
    </dl>
  )
}
