import { Schema } from 'effect'

export const HorizonSource = Schema.Literals(['sweep', 'frames', 'old-profile'])

export type HorizonSource = typeof HorizonSource.Type
