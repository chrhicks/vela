import { Caption } from './Caption.tsx'
import styles from './Log.module.css'

export interface LogLine {
  readonly at: string
  readonly text: string
}

interface LogProps {
  readonly heading: string
  readonly lines: ReadonlyArray<LogLine>
}

export function Log({ heading, lines }: LogProps) {
  return (
    <section className={styles.log}>
      <Caption>{heading}</Caption>

      <ol className={styles.lines}>
        {lines.map(line => (
          <li key={`${line.at} ${line.text}`} className={styles.line}>
            <time className={styles.at}>{line.at}</time>
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
