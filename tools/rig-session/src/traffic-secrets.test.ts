import { expect, test } from 'vitest'
import { sanitizeText, Secrets } from './sanitize.ts'
import { learnFromMessage } from './traffic-secrets.ts'

const vector = (name: string, ...elements: string[]) => `<setTextVector device="Test Mount" name="${name}">${elements.join('')}</setTextVector>`

test('the site, the ports and a serial number are learned from the traffic and removed wherever they appear', () => {
  const secrets = new Secrets()

  learnFromMessage('<defNumberVector device="Test Mount" name="GEOGRAPHIC_COORD"><defNumber name="LAT">12.534</defNumber><defNumber name="LONG">-14.75</defNumber></defNumberVector>', secrets)
  learnFromMessage(vector('DEVICE_PORT', '<oneText name="PORT">test-port-77</oneText>'), secrets)
  learnFromMessage(vector('SYSTEM_PORTS', '<oneText name="test-sysport-88">test-sysport-88</oneText>'), secrets)
  learnFromMessage(vector('CAMERA_INFO', '<oneText name="CAMERA_SERIAL">SN-TEST-4411</oneText>'), secrets)
  learnFromMessage(vector('OTHER', '<oneText name="NOTE">opened /dev/test-tty-9 ok</oneText>'), secrets)

  for (const secret of ['12.534', '345.25', 'test-port-77', 'test-sysport-88', 'SN-TEST-4411', '/dev/test-tty-9']) {
    expect(sanitizeText(`field ${secret} end`, secrets), secret).toBe('field [redacted] end')
  }
})

test('a message with nothing private teaches nothing', () => {
  const secrets = new Secrets()

  learnFromMessage('<setNumberVector device="Test Mount" name="EQUATORIAL_EOD_COORD"><oneNumber name="RA">6.5</oneNumber></setNumberVector>', secrets)

  expect(sanitizeText('RA 6.5 and 12.534', secrets)).toBe('RA 6.5 and 12.534')
})
